import { describe, expect, it } from "vitest";
import { createSseResponse, getActiveSseConnectionCount } from "../../apps/web/lib/server/sse";

describe("SSE response lifecycle", () => {
  it("tracks active connections and cleans up when the client disconnects", async () => {
    const abortController = new AbortController();
    const response = createSseResponse(
      new Request("http://localhost/api/broadcast/stream", { signal: abortController.signal }),
      "state",
      async () => ({ ok: true }),
      { snapshotIntervalMs: 60_000, heartbeatIntervalMs: 60_000 }
    );

    expect(getActiveSseConnectionCount()).toBe(1);

    const reader = response.body?.getReader();
    const chunk = await reader?.read();
    expect(new TextDecoder().decode(chunk?.value)).toContain("event: state");

    abortController.abort();
    await reader?.cancel().catch(() => undefined);

    expect(getActiveSseConnectionCount()).toBe(0);
  });
});
