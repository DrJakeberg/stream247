import { describe, expect, it } from "vitest";
import { ProgrammeGapTracker } from "../../apps/worker/src/playout-gap.js";

describe("ProgrammeGapTracker", () => {
  it("measures a boundary covered by a fallback bridge", () => {
    const tracker = new ProgrammeGapTracker();
    tracker.openGap("asset_prev", 1_000);
    tracker.noteBridge("asset_fallback_a");

    const gap = tracker.closeGap("asset_next", 19_100);

    expect(gap).toEqual({
      fromAssetId: "asset_prev",
      toAssetId: "asset_next",
      gapMs: 18_100,
      bridgeStarts: 1
    });
  });

  it("reports a clean back-to-back boundary with no bridge", () => {
    const tracker = new ProgrammeGapTracker();
    tracker.openGap("asset_prev", 1_000);

    const gap = tracker.closeGap("asset_next", 1_120);

    expect(gap?.gapMs).toBe(120);
    expect(gap?.bridgeStarts).toBe(0);
  });

  it("counts every bridge that covered the same boundary", () => {
    const tracker = new ProgrammeGapTracker();
    tracker.openGap("asset_prev", 0);
    tracker.noteBridge("asset_fallback_a");
    tracker.noteBridge("asset_fallback_b");

    expect(tracker.closeGap("asset_next", 5_000)?.bridgeStarts).toBe(2);
  });

  it("closes a gap exactly once", () => {
    const tracker = new ProgrammeGapTracker();
    tracker.openGap("asset_prev", 0);

    expect(tracker.closeGap("asset_next", 500)).not.toBeNull();
    expect(tracker.closeGap("asset_after", 900)).toBeNull();
  });

  it("returns nothing when no gap was open", () => {
    const tracker = new ProgrammeGapTracker();

    expect(tracker.closeGap("asset_next", 500)).toBeNull();
    // A bridge with no open gap must not invent one.
    tracker.noteBridge("asset_fallback_a");
    expect(tracker.closeGap("asset_next", 900)).toBeNull();
  });

  it("keeps the most recent boundary when a second one opens before the first closed", () => {
    const tracker = new ProgrammeGapTracker();
    tracker.openGap("asset_one", 0);
    tracker.openGap("asset_two", 4_000);

    expect(tracker.closeGap("asset_next", 4_500)).toEqual({
      fromAssetId: "asset_two",
      toAssetId: "asset_next",
      gapMs: 500,
      bridgeStarts: 0
    });
  });

  it("never reports a negative gap from a clock that went backwards", () => {
    const tracker = new ProgrammeGapTracker();
    tracker.openGap("asset_prev", 10_000);

    expect(tracker.closeGap("asset_next", 9_000)?.gapMs).toBe(0);
  });
});
