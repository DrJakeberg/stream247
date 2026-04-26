import { describe, expect, it } from "vitest";
import {
  evaluateUplinkDestinationStall,
  selectUplinkStopStrategy
} from "../../apps/worker/src/multi-output";

const THRESHOLD_SECONDS = 300;
const THRESHOLD_MS = THRESHOLD_SECONDS * 1000;

describe("evaluateUplinkDestinationStall", () => {
  it("clears the stall timer when no destinations are tracked", () => {
    const decision = evaluateUplinkDestinationStall({
      destinationStatuses: [],
      stallStartedAt: 12345,
      nowMs: 99999,
      thresholdSeconds: THRESHOLD_SECONDS
    });

    expect(decision).toEqual({ decision: "clear", nextStallStartedAt: undefined });
  });

  it("clears the stall timer when at least one destination is healthy", () => {
    const decision = evaluateUplinkDestinationStall({
      destinationStatuses: ["ready", "error"],
      stallStartedAt: 1000,
      nowMs: 1_000_000,
      thresholdSeconds: THRESHOLD_SECONDS
    });

    expect(decision).toEqual({ decision: "clear", nextStallStartedAt: undefined });
  });

  it("clears the stall timer when destination is recovering, not in error", () => {
    const decision = evaluateUplinkDestinationStall({
      destinationStatuses: ["recovering"],
      stallStartedAt: 0,
      nowMs: 600_000,
      thresholdSeconds: THRESHOLD_SECONDS
    });

    expect(decision).toEqual({ decision: "clear", nextStallStartedAt: undefined });
  });

  it("starts the stall timer the first time every destination is in error", () => {
    const now = 5_000;
    const decision = evaluateUplinkDestinationStall({
      destinationStatuses: ["error"],
      stallStartedAt: undefined,
      nowMs: now,
      thresholdSeconds: THRESHOLD_SECONDS
    });

    expect(decision).toEqual({ decision: "wait", nextStallStartedAt: now });
  });

  it("preserves the existing stall start while still under threshold", () => {
    const start = 1_000;
    const now = start + THRESHOLD_MS - 1; // 1ms before threshold
    const decision = evaluateUplinkDestinationStall({
      destinationStatuses: ["error", "error"],
      stallStartedAt: start,
      nowMs: now,
      thresholdSeconds: THRESHOLD_SECONDS
    });

    expect(decision).toEqual({ decision: "wait", nextStallStartedAt: start });
  });

  it("returns restart exactly at the threshold boundary", () => {
    const start = 0;
    const now = THRESHOLD_MS;
    const decision = evaluateUplinkDestinationStall({
      destinationStatuses: ["error"],
      stallStartedAt: start,
      nowMs: now,
      thresholdSeconds: THRESHOLD_SECONDS
    });

    expect(decision).toEqual({ decision: "restart", nextStallStartedAt: undefined, stallSeconds: THRESHOLD_SECONDS });
  });

  it("returns restart with the rounded stall duration when well past threshold", () => {
    const start = 100_000;
    const now = start + 7 * 60 * 1000 + 250; // 7m 0.25s
    const decision = evaluateUplinkDestinationStall({
      destinationStatuses: ["error", "error"],
      stallStartedAt: start,
      nowMs: now,
      thresholdSeconds: THRESHOLD_SECONDS
    });

    expect(decision.decision).toBe("restart");
    if (decision.decision === "restart") {
      expect(decision.stallSeconds).toBe(420);
      expect(decision.nextStallStartedAt).toBeUndefined();
    }
  });

  it("never restarts when threshold is set to 0 (feature disabled)", () => {
    const start = 0;
    const now = 60 * 60 * 1000; // 1h
    const decision = evaluateUplinkDestinationStall({
      destinationStatuses: ["error"],
      stallStartedAt: start,
      nowMs: now,
      thresholdSeconds: 0
    });

    expect(decision.decision).toBe("wait");
  });

  it("returns SIGKILL with no escalation for destination-stalled stops (v1.5.8 regression)", () => {
    const strategy = selectUplinkStopStrategy("destination-stalled");
    expect(strategy.initialSignal).toBe("SIGKILL");
    expect(strategy.escalateToSigkillAfterMs).toBe(0);
  });

  it("returns SIGTERM with 5s SIGKILL escalation for normal planned stops", () => {
    for (const reason of ["destination-change", "scheduled-reconnect", "destination-missing", "relay-disabled", ""]) {
      const strategy = selectUplinkStopStrategy(reason);
      expect(strategy.initialSignal).toBe("SIGTERM");
      expect(strategy.escalateToSigkillAfterMs).toBe(5000);
    }
  });

  it("simulates the v1.5.7 soak failure: error continuous past threshold triggers restart", () => {
    // First failure observed at t=0
    const t0 = 0;
    const initial = evaluateUplinkDestinationStall({
      destinationStatuses: ["error"],
      stallStartedAt: undefined,
      nowMs: t0,
      thresholdSeconds: THRESHOLD_SECONDS
    });
    expect(initial).toEqual({ decision: "wait", nextStallStartedAt: t0 });

    // Still failing at t = 100s
    const mid = evaluateUplinkDestinationStall({
      destinationStatuses: ["error"],
      stallStartedAt: initial.nextStallStartedAt,
      nowMs: t0 + 100_000,
      thresholdSeconds: THRESHOLD_SECONDS
    });
    expect(mid).toEqual({ decision: "wait", nextStallStartedAt: t0 });

    // Past threshold at t = 301s → restart
    const restart = evaluateUplinkDestinationStall({
      destinationStatuses: ["error"],
      stallStartedAt: mid.nextStallStartedAt,
      nowMs: t0 + 301_000,
      thresholdSeconds: THRESHOLD_SECONDS
    });
    expect(restart.decision).toBe("restart");
    if (restart.decision === "restart") {
      expect(restart.stallSeconds).toBe(301);
    }
  });
});
