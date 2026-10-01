import { describe, expect, it } from "vitest";
import { createSseResponse, getActiveSseConnectionCount } from "@/lib/server/sse";

/**
 * These cover connection accounting, not payloads.
 *
 * A leaked SSE registration is not a counter being wrong — it is a timer that keeps reading the
 * database every few seconds for a client that left. Twenty-two of them made this server take 16
 * seconds to answer its own health check, with the container marked unhealthy and its CPU at zero:
 * it was waiting on the database, not computing.
 */

/** Reads the stream the way a browser does, so the response is actually consumed. */
async function readFirstChunk(response: Response) {
  const reader = response.body!.getReader();
  const chunk = await reader.read();
  reader.releaseLock();
  return chunk;
}

function snapshotAfter(ms: number) {
  return async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
    return { ok: true };
  };
}

describe("SSE connection teardown", () => {
  it("releases a connection when the client disconnects after it is established", async () => {
    const before = getActiveSseConnectionCount();
    const controller = new AbortController();
    const request = new Request("http://localhost/api/test", { signal: controller.signal });

    const response = createSseResponse(request, "test", async () => ({ ok: true }));
    await readFirstChunk(response);
    expect(getActiveSseConnectionCount()).toBe(before + 1);

    controller.abort();
    await new Promise((resolve) => setImmediate(resolve));

    expect(getActiveSseConnectionCount()).toBe(before);
  });

  it("releases a connection aborted while the first snapshot is still loading", async () => {
    // The regression this was written for. The abort listener was registered *after* the initial
    // snapshot was awaited, so a client that gave up during that read aborted before anything was
    // listening. Nothing threw and nothing logged; the connection simply stayed counted forever.
    const before = getActiveSseConnectionCount();
    const controller = new AbortController();
    const request = new Request("http://localhost/api/test", { signal: controller.signal });

    const response = createSseResponse(request, "test", snapshotAfter(50));
    const pending = readFirstChunk(response).catch(() => undefined);

    await new Promise((resolve) => setTimeout(resolve, 10));
    controller.abort();
    await pending;
    await new Promise((resolve) => setTimeout(resolve, 80));

    expect(getActiveSseConnectionCount()).toBe(before);
  });

  it("releases a connection whose request was already aborted before the stream started", async () => {
    const before = getActiveSseConnectionCount();
    const controller = new AbortController();
    controller.abort();
    const request = new Request("http://localhost/api/test", { signal: controller.signal });

    const response = createSseResponse(request, "test", async () => ({ ok: true }));
    await readFirstChunk(response).catch(() => undefined);
    await new Promise((resolve) => setImmediate(resolve));

    expect(getActiveSseConnectionCount()).toBe(before);
  });
});

describe("SSE liveness without a disconnect signal", () => {
  it("closes a connection whose consumer stopped reading, even with no abort and no cancel", async () => {
    // The case the fix above does not cover, and the one that actually ran the database at 115
    // transactions a second: the client is gone, but neither the abort nor the cancel arrives. The
    // stream has to notice on its own that nothing it enqueues is being read.
    const before = getActiveSseConnectionCount();
    const request = new Request("http://localhost/api/test");

    const response = createSseResponse(request, "test", async () => ({ ok: true }), {
      snapshotIntervalMs: 20,
      heartbeatIntervalMs: 10_000
    });

    // Read once, then abandon the reader without cancelling — the shape of a consumer that stops
    // draining while the runtime keeps the stream alive.
    const reader = response.body!.getReader();
    await reader.read();
    expect(getActiveSseConnectionCount()).toBe(before + 1);

    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(getActiveSseConnectionCount()).toBe(before);
  });

  it("keeps a connection open while the consumer is still reading", async () => {
    const before = getActiveSseConnectionCount();
    const controller = new AbortController();
    const request = new Request("http://localhost/api/test", { signal: controller.signal });

    const response = createSseResponse(request, "test", async () => ({ ok: true }), {
      snapshotIntervalMs: 20,
      heartbeatIntervalMs: 10_000
    });

    const reader = response.body!.getReader();
    const deadline = Date.now() + 250;
    while (Date.now() < deadline) {
      await reader.read();
    }

    expect(getActiveSseConnectionCount()).toBe(before + 1);

    controller.abort();
    reader.releaseLock();
    await new Promise((resolve) => setImmediate(resolve));
    expect(getActiveSseConnectionCount()).toBe(before);
  });
});
