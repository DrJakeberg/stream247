type SnapshotFactory<T> = () => Promise<T | typeof SSE_CLOSE>;

type SseResponseOptions = {
  snapshotIntervalMs?: number;
  heartbeatIntervalMs?: number;
  errorMessage?: string;
};

/**
 * How many pushes may go unread before the connection is treated as dead.
 *
 * Generous on purpose: a backgrounded tab still drains its socket, so this only trips for a client
 * that is genuinely gone. At the default five-second snapshot interval it closes such a connection
 * within about twenty seconds.
 */
const UNREAD_PUSHES_BEFORE_CLOSE = 3;

let activeSseConnections = 0;

// One log line per stream event and message per minute (M127). A database outage fails every open
// connection's snapshot every few seconds, and the public live stream can have many of them.
const SNAPSHOT_FAILURE_LOG_INTERVAL_MS = 60_000;
const lastSnapshotFailureLog = new Map<string, { message: string; at: number }>();

function logSnapshotFailure(event: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  const now = Date.now();
  const last = lastSnapshotFailureLog.get(event);
  if (last && last.message === message && now - last.at < SNAPSHOT_FAILURE_LOG_INTERVAL_MS) {
    return;
  }
  lastSnapshotFailureLog.set(event, { message, at: now });
  console.error(`[sse:${event}] snapshot failed:`, message);
}

function registerSseConnection() {
  activeSseConnections += 1;
  let active = true;

  return () => {
    if (!active) {
      return;
    }
    active = false;
    activeSseConnections = Math.max(0, activeSseConnections - 1);
  };
}

/**
 * Returned by a snapshot factory to end the stream (M125): the broadcast stream re-checks its
 * session with every snapshot, so a member whose access was removed stops receiving at once.
 */
export const SSE_CLOSE = Symbol("sse-close");

export function getActiveSseConnectionCount(): number {
  return activeSseConnections;
}

export function createSseResponse<T>(request: Request, event: string, makeSnapshot: SnapshotFactory<T>, options: SseResponseOptions = {}) {
  const encoder = new TextEncoder();
  let snapshotInterval: NodeJS.Timeout | null = null;
  let heartbeatInterval: NodeJS.Timeout | null = null;
  let cleanupConnection: (() => void) | null = null;
  const snapshotIntervalMs = options.snapshotIntervalMs ?? 5000;
  const heartbeatIntervalMs = options.heartbeatIntervalMs ?? 15000;
  const errorMessage = options.errorMessage ?? "The live state could not be read.";

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      cleanupConnection = registerSseConnection();
      let closed = false;
      const close = () => {
        if (closed) {
          return;
        }
        closed = true;
        if (snapshotInterval) {
          clearInterval(snapshotInterval);
          snapshotInterval = null;
        }
        if (heartbeatInterval) {
          clearInterval(heartbeatInterval);
          heartbeatInterval = null;
        }
        cleanupConnection?.();
        cleanupConnection = null;
        try {
          controller.close();
        } catch {
          // The stream may already be closed if the client disconnected first.
        }
      };
      // Whether anyone is still draining what we enqueue.
      //
      // Disconnects are supposed to arrive as an abort on request.signal or as a cancel() on the
      // stream. Measured on this codebase, they often arrive as neither: after a run of the visual
      // suite the process held 22 registered connections while the container had *zero* established
      // sockets on its port. The clients were gone at the TCP level and nothing told the stream. It
      // is not a stale counter — those 22 kept polling, and Postgres was committing 115
      // transactions a second with no client attached anywhere.
      //
      // So the stream stops trusting the runtime to tell it, and checks instead. desiredSize is
      // null once the stream is closed or errored, and stops recovering above zero when the
      // consumer no longer reads. A live client drains between pushes; a dead one never does.
      let unreadPushes = 0;
      const clientIsGone = () => {
        const desiredSize = controller.desiredSize;
        if (desiredSize === null) {
          return true;
        }
        if (desiredSize > 0) {
          unreadPushes = 0;
          return false;
        }
        unreadPushes += 1;
        return unreadPushes > UNREAD_PUSHES_BEFORE_CLOSE;
      };
      const push = async () => {
        if (closed) {
          return;
        }
        if (clientIsGone()) {
          close();
          return;
        }
        try {
          const snapshot = await makeSnapshot();
          if (closed) {
            return;
          }
          if ((snapshot as unknown) === SSE_CLOSE) {
            close();
            return;
          }
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(snapshot)}\n\n`));
        } catch (error) {
          if (closed) {
            return;
          }
          // The client only ever sees the fixed text (M127): /api/channel/live/stream is public, and a
          // database error message names internal hosts and ports. The detail goes to the server log.
          logSnapshotFailure(event, error);
          controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ message: errorMessage })}\n\n`));
        }
      };

      // App Router route handlers expose disconnects through request.signal instead of res.on("close").
      //
      // This has to happen before the first await. It used to sit after the initial snapshot, and a
      // client that gave up while that snapshot was still being read from the database aborted
      // before anyone was listening — the event fired into nothing and the connection stayed
      // registered for the life of the process, still polling every few seconds.
      //
      // That window is widest exactly when it hurts most: the busier the server, the longer the
      // first snapshot takes, so every leaked connection makes the next one more likely to leak.
      // A run of the visual suite left 22 of 23 connections behind, and the process needed 16
      // seconds to answer its own health check while using no CPU at all — it was waiting, not
      // working.
      if (request.signal.aborted) {
        close();
        return;
      }
      request.signal.addEventListener("abort", close, { once: true });

      await push();

      // The client can disconnect during the snapshot above; without this, the timers below would
      // be created after close() had already run and nothing would ever clear them.
      if (closed) {
        return;
      }

      snapshotInterval = setInterval(() => void push(), snapshotIntervalMs);
      heartbeatInterval = setInterval(() => {
        if (closed) {
          return;
        }
        if (clientIsGone()) {
          close();
          return;
        }
        controller.enqueue(encoder.encode(": keep-alive\n\n"));
      }, heartbeatIntervalMs);
    },
    cancel() {
      if (snapshotInterval) {
        clearInterval(snapshotInterval);
        snapshotInterval = null;
      }
      if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
        heartbeatInterval = null;
      }
      cleanupConnection?.();
      cleanupConnection = null;
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
    }
  });
}
