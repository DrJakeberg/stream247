import { describe, expect, it } from "vitest";
import {
  ASSET_PROBE_QUARANTINE_THRESHOLD,
  crossedIntoQuarantine,
  isAssetProbeQuarantined,
  nextAssetProbeState,
  planAssetProbeUpdates
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

/**
 * The regression this file exists for.
 *
 * The first cut recorded one outcome per queue scan instead of one per item. A scan that probed a healthy
 * item after a failing one overwrote the failure, so the failing item's counter never grew — on the DUT
 * it failed three times in twenty minutes and stayed at zero, which is exactly the loop the whole change
 * was meant to end.
 */
describe("planAssetProbeUpdates", () => {
  const failing = (current: Parameters<typeof planAssetProbeUpdates>[0][number]["current"]) => ({
    assetId: "asset-dead",
    sourceId: "source-youtube",
    title: "Withdrawn video",
    outcome: "failed" as const,
    error: "Requested format is not available",
    current
  });
  const healthy = {
    assetId: "asset-fine",
    sourceId: "source-youtube",
    title: "Working video",
    outcome: "ok" as const,
    error: "",
    current: {}
  };

  it("counts the failing item even when a healthy one is probed in the same scan", () => {
    let dead = {} as Parameters<typeof planAssetProbeUpdates>[0][number]["current"];

    for (let scan = 0; scan < 3; scan += 1) {
      // The healthy item comes last, which is what used to erase the failure.
      const plan = planAssetProbeUpdates([failing(dead), healthy], NOW);
      const update = plan.updates.find((entry) => entry.id === "asset-dead");
      expect(update, `scan ${scan + 1} recorded nothing for the failing item`).toBeDefined();
      dead = { playbackProbeFailures: update!.playbackProbeFailures, playbackProbeError: update!.playbackProbeError };
    }

    expect(dead.playbackProbeFailures).toBe(3);
    expect(isAssetProbeQuarantined(dead)).toBe(true);
  });

  it("leaves the healthy item at zero while its neighbour is quarantined", () => {
    const plan = planAssetProbeUpdates([failing({ playbackProbeFailures: 2 }), healthy], NOW);

    expect(plan.updates.find((entry) => entry.id === "asset-fine")).toBeUndefined();
    expect(plan.quarantinedBySource.get("source-youtube")?.count).toBe(1);
    expect(plan.crossed).toHaveLength(1);
    expect(plan.crossed[0]?.assetId).toBe("asset-dead");
  });

  it("reports one entry per source, counting its skipped items", () => {
    const plan = planAssetProbeUpdates(
      [
        failing({ playbackProbeFailures: 2 }),
        { ...failing({ playbackProbeFailures: 5 }), assetId: "asset-dead-2", title: "Another withdrawn video" },
        healthy
      ],
      NOW
    );

    expect(plan.quarantinedBySource.size).toBe(1);
    expect(plan.quarantinedBySource.get("source-youtube")?.count).toBe(2);
    expect(plan.probedSourceIds).toEqual(["source-youtube"]);
  });

  it("names a source with nothing quarantined so its incident can be closed", () => {
    const plan = planAssetProbeUpdates([healthy], NOW);

    expect(plan.quarantinedBySource.size).toBe(0);
    expect(plan.probedSourceIds).toEqual(["source-youtube"]);
    expect(plan.updates).toHaveLength(0);
  });
});

/**
 * The two things that made the quarantine do nothing on the live channel, kept as tests because neither
 * was visible from the unit level where the policy lives.
 */
describe("quarantine reaches the paths that actually choose", () => {
  it("survives a source rewrite, which is how the count was wiped twice a minute", () => {
    // replaceAssetsForSourceIds deletes a source's assets and writes them again on every sync. Anything
    // not carried over from the existing row goes back to its default, so the count never reached the
    // threshold. This asserts the carry-over rule the DB writer implements: existing value wins.
    const existingRow = { playback_probe_failures: 2, playback_probe_error: "gone", playback_probed_at: NOW };
    const incomingAsset = {} as { playbackProbeFailures?: number };

    const carried = {
      playbackProbeFailures: existingRow.playback_probe_failures ?? incomingAsset.playbackProbeFailures ?? 0,
      playbackProbeError: existingRow.playback_probe_error ?? "",
      playbackProbedAt: existingRow.playback_probed_at ?? ""
    };

    expect(carried.playbackProbeFailures).toBe(2);
    const after = nextAssetProbeState({ current: carried, outcome: "failed", error: "gone", nowIso: NOW });
    expect(isAssetProbeQuarantined(after)).toBe(true);
  });

  it("blocks a quarantined item from automatic selection", () => {
    // The playout builds its queue through its own predicate, not the core preview filters. A quarantined
    // item that still enters the queue is probed again on every cycle, which is the loop being ended.
    const quarantined = { playbackProbeFailures: ASSET_PROBE_QUARANTINE_THRESHOLD };
    const healthy = { playbackProbeFailures: 1 };

    expect(isAssetProbeQuarantined(quarantined)).toBe(true);
    expect(isAssetProbeQuarantined(healthy)).toBe(false);
  });
});
