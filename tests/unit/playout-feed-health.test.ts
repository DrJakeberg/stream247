import { describe, expect, it } from "vitest";
import {
  DEFAULT_PLAYOUT_FEED_GRACE_MS,
  DEFAULT_PLAYOUT_FEED_STALE_MS,
  getPlayoutFeedHealthOptions,
  shouldRestartStalledPlayout
} from "../../apps/worker/src/playout-feed-health";

const NOW = new Date("2026-08-25T03:14:00.000Z").getTime();
const OPTIONS = { staleMs: DEFAULT_PLAYOUT_FEED_STALE_MS, graceMs: DEFAULT_PLAYOUT_FEED_GRACE_MS };

function scenario(overrides: Partial<Parameters<typeof shouldRestartStalledPlayout>[0]> = {}) {
  return shouldRestartStalledPlayout({
    playoutRunning: true,
    processStartedAtMs: NOW - 4 * 60 * 60 * 1000,
    feedUpdatedAtMs: NOW - 156_000,
    nowMs: NOW,
    options: OPTIONS,
    ...overrides
  });
}

describe("a playout process that is alive and producing nothing", () => {
  it("restarts the case that was actually observed", () => {
    // ffmpeg alive for 3h43m at 0% CPU, feed 156 seconds stale, channel off air.
    expect(scenario()).toBe(true);
  });

  it("leaves a feed that is merely a little behind", () => {
    expect(scenario({ feedUpdatedAtMs: NOW - 20_000 })).toBe(false);
  });

  it("blames nobody when no process is running", () => {
    // A stale feed with nothing running is a different fault, and restarting answers none of it.
    expect(scenario({ playoutRunning: false })).toBe(false);
  });

  it("leaves a process alone inside its grace period", () => {
    // A process that started thirty seconds ago has not produced a segment yet by definition.
    expect(scenario({ processStartedAtMs: NOW - 30_000 })).toBe(false);
  });

  it("acts once the grace period has passed and the feed is still standing still", () => {
    expect(
      scenario({ processStartedAtMs: NOW - DEFAULT_PLAYOUT_FEED_GRACE_MS - 1_000 })
    ).toBe(true);
  });

  it("does not treat a missing feed timestamp as a stall", () => {
    // Bootstrapping, or a playlist that cannot be read: neither is evidence against this process.
    expect(scenario({ feedUpdatedAtMs: 0 })).toBe(false);
  });

  it("reads its thresholds from the environment, with sane defaults", () => {
    expect(getPlayoutFeedHealthOptions({})).toEqual({
      staleMs: DEFAULT_PLAYOUT_FEED_STALE_MS,
      graceMs: DEFAULT_PLAYOUT_FEED_GRACE_MS
    });
    expect(getPlayoutFeedHealthOptions({ PLAYOUT_FEED_STALE_TIMEOUT_MS: "20000" }).staleMs).toBe(20_000);
    expect(getPlayoutFeedHealthOptions({ PLAYOUT_FEED_STALE_TIMEOUT_MS: "nonsense" }).staleMs).toBe(
      DEFAULT_PLAYOUT_FEED_STALE_MS
    );
  });

  it("waits longer than one segment before acting", () => {
    // Segments are two seconds. A threshold near that would restart playout on ordinary jitter,
    // which would be worse than the fault it is meant to catch.
    expect(DEFAULT_PLAYOUT_FEED_STALE_MS).toBeGreaterThanOrEqual(30_000);
  });

  it("resolves managed thresholds first, seconds in the GUI, milliseconds here (M56 part 2)", () => {
    const options = getPlayoutFeedHealthOptions({ PLAYOUT_FEED_STALE_TIMEOUT_MS: "20000" }, {
      feedStallTimeoutSeconds: "60",
      feedStallGraceSeconds: "45"
    });

    expect(options.staleMs).toBe(60_000);
    expect(options.graceMs).toBe(45_000);
  });
});
