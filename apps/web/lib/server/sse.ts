type SnapshotFactory<T> = () => Promise<T>;

type SseResponseOptions = {
  snapshotIntervalMs?: number;
  heartbeatIntervalMs?: number;
  errorMessage?: string;
};

let activeSseConnections = 0;

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
  const errorMessage = options.errorMessage ?? "Unknown SSE error.";

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
      const push = async () => {
        if (closed) {
          return;
        }
        try {
          const snapshot = await makeSnapshot();
          if (closed) {
            return;
          }
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(snapshot)}\n\n`));
        } catch (error) {
          if (closed) {
            return;
          }
          const message = error instanceof Error ? error.message : errorMessage;
          controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ message })}\n\n`));
        }
      };

      await push();
      snapshotInterval = setInterval(() => void push(), snapshotIntervalMs);
      heartbeatInterval = setInterval(() => {
        if (!closed) {
          controller.enqueue(encoder.encode(": keep-alive\n\n"));
        }
      }, heartbeatIntervalMs);

      // App Router route handlers expose disconnects through request.signal instead of res.on("close").
      request.signal.addEventListener("abort", close, { once: true });
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
