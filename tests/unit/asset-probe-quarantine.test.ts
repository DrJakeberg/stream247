import { describe, expect, it } from "vitest";
import {
  ASSET_PROBE_QUARANTINE_THRESHOLD,
  crossedIntoQuarantine,
  isAssetProbeQuarantined,
  nextAssetProbeState
} from "../../packages/core/src/asset-probe-quarantine";

const NOW = "2026-09-07T10:00:00.000Z";

/**
 * The rule that stops the playout choosing an item its source will not serve, written from the loop
 * measured on the DUT: probe fails, bridge, incident, self-resolve, choose the same item again.
 */
describe("asset probe quarantine", () => {
  it("lets a first failure pass, because probes fail for reasons that heal", () => {
    // A rate limit or a CDN reset looks exactly like a dead item on the first try. Quarantining on one
    // failure would pull healthy items out of the rotation every time the network hiccuped.
    const after = nextAssetProbeState({ current: {}, outcome: "failed", error: "rate limited", nowIso: NOW });

    expect(after.playbackProbeFailures).toBe(1);
    expect(isAssetProbeQuarantined(after)).toBe(false);
  });

  it("quarantines once the failures are consecutive and no longer explainable as a blip", () => {
    let state = {} as ReturnType<typeof nextAssetProbeState>;
    for (let attempt = 0; attempt < ASSET_PROBE_QUARANTINE_THRESHOLD; attempt += 1) {
      state = nextAssetProbeState({ current: state, outcome: "failed", error: "format not available", nowIso: NOW });
    }

    expect(state.playbackProbeFailures).toBe(ASSET_PROBE_QUARANTINE_THRESHOLD);
    expect(isAssetProbeQuarantined(state)).toBe(true);
    expect(state.playbackProbeError).toBe("format not available");
  });

  it("clears the whole record on a success rather than leaving an item on probation", () => {
    const failed = { playbackProbeFailures: 5, playbackProbeError: "gone", playbackProbedAt: "2026-09-01T00:00:00.000Z" };

    const after = nextAssetProbeState({ current: failed, outcome: "ok", nowIso: NOW });

    expect(after.playbackProbeFailures).toBe(0);
    expect(after.playbackProbeError).toBe("");
    expect(isAssetProbeQuarantined(after)).toBe(false);
  });

  it("reports the crossing once, not on every failure after it", () => {
    // The incident is raised at the crossing. Reporting it again on the fourth and fifth failure would
    // make the list noisier the longer nobody acted, which is backwards.
    const two = { playbackProbeFailures: 2 };
    const three = nextAssetProbeState({ current: two, outcome: "failed", error: "x", nowIso: NOW });
    const four = nextAssetProbeState({ current: three, outcome: "failed", error: "x", nowIso: NOW });

    expect(crossedIntoQuarantine(two, three)).toBe(true);
    expect(crossedIntoQuarantine(three, four)).toBe(false);
  });

  it("keeps the failing message short enough to store and read", () => {
    const after = nextAssetProbeState({ current: {}, outcome: "failed", error: "e".repeat(2000), nowIso: NOW });

    expect(after.playbackProbeError.length).toBe(500);
  });

  it("treats an asset that never probed as eligible", () => {
    expect(isAssetProbeQuarantined({})).toBe(false);
    expect(isAssetProbeQuarantined({ playbackProbeFailures: 0 })).toBe(false);
  });
});
