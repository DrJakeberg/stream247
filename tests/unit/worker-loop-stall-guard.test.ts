import { describe, expect, it } from "vitest";
import { runWithStallGuard } from "../../apps/worker/src/process-utils";

describe("runWithStallGuard", () => {
  it("reports completed and returns the value when the cycle resolves in time", async () => {
    const result = await runWithStallGuard(async () => "ok", 1000);
    expect(result).toEqual({ status: "completed", value: "ok" });
  });

  it("reports failed (not stalled) when the cycle rejects in time — loop can catch + retry", async () => {
    const err = new Error("fetch failed");
    const result = await runWithStallGuard(async () => {
      throw err;
    }, 1000);
    expect(result.status).toBe("failed");
    if (result.status === "failed") {
      expect(result.error).toBe(err);
      expect((result.error as Error).message).toBe("fetch failed");
    }
  });

  it("reports stalled when the cycle never settles within the window (the v1.5.9 hang shape)", async () => {
    const start = Date.now();
    const result = await runWithStallGuard<never>(() => new Promise<never>(() => {}), 50);
    expect(result.status).toBe("stalled");
    // It must resolve at roughly the stall window, not hang forever.
    expect(Date.now() - start).toBeLessThan(2000);
  });

  it("a transient fetch-failed rejection resolves fast, so the loop recovers without waiting on the stall window", async () => {
    const start = Date.now();
    const result = await runWithStallGuard(async () => {
      throw new Error("fetch failed");
    }, 60_000);
    expect(result.status).toBe("failed");
    // Crucially it returns immediately on rejection, not after the 60s ceiling.
    expect(Date.now() - start).toBeLessThan(2000);
  });

  it("prefers the cycle result over the stall when both could fire near the boundary", async () => {
    const result = await runWithStallGuard(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return 42;
    }, 1000);
    expect(result).toEqual({ status: "completed", value: 42 });
  });

  it("does not raise an unhandled rejection when the cycle rejects after a stall is already reported", async () => {
    let rejectLater: ((reason: unknown) => void) | undefined;
    const result = await runWithStallGuard<never>(
      () =>
        new Promise<never>((_, reject) => {
          rejectLater = reject;
        }),
      20
    );
    expect(result.status).toBe("stalled");
    // Settle the abandoned promise after the race already resolved as stalled.
    // The guard attached a rejection handler, so this must not throw/crash.
    rejectLater?.(new Error("late fetch failed"));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(result.status).toBe("stalled");
  });
});
