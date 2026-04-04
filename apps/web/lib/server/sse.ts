type SnapshotFactory<T> = () => Promise<T>;

export function createSseResponse<T>(request: Request, event: string, makeSnapshot: SnapshotFactory<T>) {
  const encoder = new TextEncoder();
  let snapshotInterval: NodeJS.Timeout | null = null;
  let heartbeatInterval: NodeJS.Timeout | null = null;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const push = async () => {
        try {
          const snapshot = await makeSnapshot();
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(snapshot)}\n\n`));
        } catch (error) {
          const message = error instanceof Error ? error.message : "Unknown SSE error.";
          controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ message })}\n\n`));
        }
      };

      await push();
      snapshotInterval = setInterval(() => void push(), 5000);
      heartbeatInterval = setInterval(() => controller.enqueue(encoder.encode(": keep-alive\n\n")), 15000);

      request.signal.addEventListener(
        "abort",
        () => {
          if (snapshotInterval) {
            clearInterval(snapshotInterval);
          }
          if (heartbeatInterval) {
            clearInterval(heartbeatInterval);
          }
          controller.close();
        },
        { once: true }
      );
    },
    cancel() {
      if (snapshotInterval) {
        clearInterval(snapshotInterval);
      }
      if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
      }
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive"
    }
  });
}
