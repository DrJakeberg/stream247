import { describe, expect, it } from "vitest";
import {
  DEFAULT_DESTINATION_FAILURE_COOLDOWN_SECONDS,
  getDestinationFailureSecondsRemaining,
  isDestinationFailureCoolingDown
} from "@stream247/core";

// Regression: the May 28 dest=error stuck-recovery shape on the v1.5.11 soak. The default
// cooldown was 300s, which meant a single-destination failure created a ~5 min broadcastReady=false
// window. v1.5.12 lowers the default to 60s so single-Twitch-destination outages bound at ~1 min
// while still backing off connection retries. These tests pin the new default and the recovery
// boundary so a future raise needs a deliberate change with a justification.
describe("destination failure cooldown defaults", () => {
  it("pins the default cooldown at 60 seconds", () => {
    expect(DEFAULT_DESTINATION_FAILURE_COOLDOWN_SECONDS).toBe(60);
  });

  it("reports cooling down 30s after a failure with the default", () => {
    const failureAt = new Date(1_000_000_000).toISOString();
    const now = 1_000_000_000 + 30_000;

    expect(
      isDestinationFailureCoolingDown(
        "error",
        failureAt,
        DEFAULT_DESTINATION_FAILURE_COOLDOWN_SECONDS,
        now
      )
    ).toBe(true);
    expect(
      getDestinationFailureSecondsRemaining(failureAt, DEFAULT_DESTINATION_FAILURE_COOLDOWN_SECONDS, now)
    ).toBe(30);
  });

  it("clears the cooldown 65s after a failure with the default (was still 4+ min remaining at the old 300s default)", () => {
    const failureAt = new Date(1_000_000_000).toISOString();
    const now = 1_000_000_000 + 65_000;

    expect(
      isDestinationFailureCoolingDown(
        "error",
        failureAt,
        DEFAULT_DESTINATION_FAILURE_COOLDOWN_SECONDS,
        now
      )
    ).toBe(false);
    expect(
      getDestinationFailureSecondsRemaining(failureAt, DEFAULT_DESTINATION_FAILURE_COOLDOWN_SECONDS, now)
    ).toBe(0);
  });

  it("never reports cooling down when the destination status is not 'error'", () => {
    const failureAt = new Date(1_000_000_000).toISOString();
    const now = 1_000_000_000 + 5_000; // well within any cooldown

    expect(isDestinationFailureCoolingDown("ready", failureAt, DEFAULT_DESTINATION_FAILURE_COOLDOWN_SECONDS, now)).toBe(false);
    expect(isDestinationFailureCoolingDown("recovering", failureAt, DEFAULT_DESTINATION_FAILURE_COOLDOWN_SECONDS, now)).toBe(false);
  });
});
