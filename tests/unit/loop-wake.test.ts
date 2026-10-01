import { describe, expect, it } from "vitest";
import { LOOP_WAKE_IMMEDIATE_BURST_LIMIT, LoopWakeLatch } from "../../apps/worker/src/loop-wake.js";

describe("LoopWakeLatch", () => {
  it("wakes a waiter that is already armed", () => {
    const latch = new LoopWakeLatch();
    let woke = "";
    latch.arm(() => {
      woke = "yes";
    });

    expect(latch.request("ffmpeg-exit")).toBe("woke-waiter");
    expect(woke).toBe("yes");
    // The waiter is one-shot: it must not be invoked twice.
    expect(latch.request("second")).toBe("latched");
  });

  // The regression this module exists for: requestImmediatePlayoutCycle used to read a
  // `wakePlayoutLoop` handle that is only set *while the loop sleeps*. A wake requested from
  // inside a running cycle (the boundary fallback bridge, the deferred-prefetch follow-up) found
  // it null and was dropped on the floor, so the loop still slept its full 15s delay.
  it("latches a wake requested while no waiter is armed", () => {
    const latch = new LoopWakeLatch();

    expect(latch.request("boundary-fallback-bridge")).toBe("latched");
    expect(latch.takePending()).toBe("boundary-fallback-bridge");
  });

  it("consumes a latched wake exactly once (edge-triggered)", () => {
    const latch = new LoopWakeLatch();
    latch.request("deferred-prefetch");

    expect(latch.takePending()).toBe("deferred-prefetch");
    expect(latch.takePending()).toBe("");
  });

  it("coalesces repeated wakes requested during the same cycle", () => {
    const latch = new LoopWakeLatch();

    expect(latch.request("boundary-fallback-bridge")).toBe("latched");
    expect(latch.request("deferred-prefetch")).toBe("coalesced");
    expect(latch.takePending()).toBe("boundary-fallback-bridge");
    expect(latch.takePending()).toBe("");
  });

  it("disarms a waiter so a stale handle cannot be woken later", () => {
    const latch = new LoopWakeLatch();
    let calls = 0;
    const waiter = () => {
      calls += 1;
    };
    latch.arm(waiter);
    latch.disarm(waiter);

    expect(latch.request("ffmpeg-exit")).toBe("latched");
    expect(calls).toBe(0);
  });

  // Stability guard: an immediate wake must never become a spin. After a burst of back-to-back
  // immediate cycles the latch stops short-circuiting the delay, so the loop cannot starve the
  // event loop or hammer the database even if some future caller latches unconditionally.
  it("stops short-circuiting the delay after a burst of consecutive immediate wakes", () => {
    const latch = new LoopWakeLatch();

    for (let i = 0; i < LOOP_WAKE_IMMEDIATE_BURST_LIMIT; i += 1) {
      latch.request("boundary-fallback-bridge");
      expect(latch.takePending()).toBe("boundary-fallback-bridge");
    }

    latch.request("boundary-fallback-bridge");
    expect(latch.takePending()).toBe("");
  });

  it("resets the burst counter after one normally paced cycle", () => {
    const latch = new LoopWakeLatch();

    for (let i = 0; i < LOOP_WAKE_IMMEDIATE_BURST_LIMIT; i += 1) {
      latch.request("boundary-fallback-bridge");
      latch.takePending();
    }
    // A cycle with no latched wake — the loop slept normally.
    expect(latch.takePending()).toBe("");

    latch.request("boundary-fallback-bridge");
    expect(latch.takePending()).toBe("boundary-fallback-bridge");
  });
});
