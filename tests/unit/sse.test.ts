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

describe("SSE error events", () => {
  it("sends the fixed message, never the raw error, and logs the detail on the server", async () => {
    // M127: the live stream is public. A failed snapshot used to stream error.message, which for a
    // database failure carries internal addresses.
    const abortController = new AbortController();
    const logged: unknown[][] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => {
      logged.push(args);
    };
    try {
      const response = createSseResponse(
        new Request("http://localhost/api/channel/live/stream", { signal: abortController.signal }),
        "live",
        async () => {
          throw new Error("connect ECONNREFUSED 10.0.0.5:5432");
        },
        { snapshotIntervalMs: 60_000, heartbeatIntervalMs: 60_000, errorMessage: "The live state could not be read." }
      );

      const reader = response.body?.getReader();
      const text = new TextDecoder().decode((await reader?.read())?.value);
      abortController.abort();
      await reader?.cancel().catch(() => undefined);

      expect(text).toContain("event: error");
      expect(text).toContain("The live state could not be read.");
      expect(text).not.toContain("10.0.0.5");
      expect(text).not.toContain("ECONNREFUSED");
      expect(logged.some((args) => args.join(" ").includes("ECONNREFUSED"))).toBe(true);
    } finally {
      console.error = originalError;
    }
  });

  it("logs a repeated snapshot failure once per minute, however many connections hit it", async () => {
    const logged: unknown[][] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => {
      logged.push(args);
    };
    const readFirstChunk = async (message: string) => {
      const abortController = new AbortController();
      const response = createSseResponse(
        new Request("http://localhost/api/channel/live/stream", { signal: abortController.signal }),
        "outage",
        async () => {
          throw new Error(message);
        },
        { snapshotIntervalMs: 60_000, heartbeatIntervalMs: 60_000 }
      );
      const reader = response.body?.getReader();
      const text = new TextDecoder().decode((await reader?.read())?.value);
      abortController.abort();
      await reader?.cancel().catch(() => undefined);
      return text;
    };
    try {
      for (let index = 0; index < 5; index += 1) {
        expect(await readFirstChunk("connect ECONNREFUSED 10.0.0.5:5432")).toContain("event: error");
      }
      expect(logged.filter((args) => args.join(" ").includes("[sse:outage]"))).toHaveLength(1);

      // A different failure is news and is logged at once.
      await readFirstChunk("password authentication failed");
      expect(logged.filter((args) => args.join(" ").includes("[sse:outage]"))).toHaveLength(2);
    } finally {
      console.error = originalError;
    }
  });
});
