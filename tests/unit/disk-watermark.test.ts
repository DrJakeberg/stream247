import { describe, expect, it } from "vitest";
import {
  DISK_WATERMARK_STAGE_ORDER,
  collectDiskProtectedAssetIds,
  decideDiskWatermarkAction,
  getDiskWatermarkConfig,
  type DiskProtectionState,
  type DiskWatermarkStageResult
} from "../../apps/worker/src/disk-watermark";

// The global disk watermark: one monitor for the whole media volume, above the per-cache
// guardrails. Everything here is a pure decision — the wiring in the worker measures the volume
// and runs at most one eviction stage per cycle, so these tests pin down exactly when eviction
// starts, in which order the stages run, and when it stops.

const GB = 1024 ** 3;
const TOTAL_BYTES = 100 * GB;

function configFor(env: Record<string, string> = {}) {
  return getDiskWatermarkConfig(env as NodeJS.ProcessEnv);
}

function decideAt(freeGb: number, completedStages: DiskWatermarkStageResult[] = [], config = configFor()) {
  return decideDiskWatermarkAction({
    freeBytes: freeGb * GB,
    totalBytes: TOTAL_BYTES,
    config,
    completedStages
  });
}

describe("watermark configuration", () => {
  it("triggers well before full and recovers with headroom by default", () => {
    const config = configFor();

    expect(config.enabled).toBe(true);
    expect(config.triggerFreeRatio).toBeCloseTo(0.1);
    expect(config.recoverFreeRatio).toBeCloseTo(0.15);
  });

  it("accepts operator overrides in percent free", () => {
    const config = configFor({
      STREAM247_DISK_WATERMARK_TRIGGER_PERCENT: "5",
      STREAM247_DISK_WATERMARK_RECOVER_PERCENT: "8"
    });

    expect(config.triggerFreeRatio).toBeCloseTo(0.05);
    expect(config.recoverFreeRatio).toBeCloseTo(0.08);
  });

  it("has a kill switch", () => {
    expect(configFor({ STREAM247_DISK_WATERMARK_ENABLED: "0" }).enabled).toBe(false);
  });

  it("ignores a misordered pair whole rather than half-applying it", () => {
    // Recovery at or below the trigger would end every episode the instant it started — the
    // monitor would look configured and do nothing. Defaults for both are easier to diagnose
    // than an override that is silently in effect but swapped.
    for (const env of [
      { STREAM247_DISK_WATERMARK_TRIGGER_PERCENT: "20", STREAM247_DISK_WATERMARK_RECOVER_PERCENT: "10" },
      { STREAM247_DISK_WATERMARK_TRIGGER_PERCENT: "10", STREAM247_DISK_WATERMARK_RECOVER_PERCENT: "10" }
    ]) {
      const config = configFor(env);
      expect(config.triggerFreeRatio).toBeCloseTo(0.1);
      expect(config.recoverFreeRatio).toBeCloseTo(0.15);
    }
  });

  it("falls back to the default for a nonsense value", () => {
    const config = configFor({
      STREAM247_DISK_WATERMARK_TRIGGER_PERCENT: "lots",
      STREAM247_DISK_WATERMARK_RECOVER_PERCENT: "20"
    });

    expect(config.triggerFreeRatio).toBeCloseTo(0.1);
    expect(config.recoverFreeRatio).toBeCloseTo(0.2);
  });
});

describe("when eviction starts", () => {
  it("does nothing while free space is above the trigger", () => {
    expect(decideAt(40)).toEqual({ kind: "idle" });
    // Exactly at the watermark is still "above": eviction is for crossing it, not touching it.
    expect(decideAt(10)).toEqual({ kind: "idle" });
  });

  it("starts with the first stage once free space crosses the trigger", () => {
    expect(decideAt(5)).toEqual({ kind: "run-stage", stage: DISK_WATERMARK_STAGE_ORDER[0] });
  });

  it("evicts the cheapest loss first: VOD cache before feed segments before thumbnails", () => {
    // The order is part of the contract. A cached VOD re-downloads itself, an orphaned segment is
    // garbage by definition, a thumbnail regenerates on the next library sync — so the ladder
    // climbs from "free" to "cosmetic" and never needs to touch anything the schedule references.
    expect(DISK_WATERMARK_STAGE_ORDER).toEqual(["vod-cache", "feed-segments", "thumbnails"]);
  });

  it("does nothing when disabled, however full the disk is", () => {
    expect(decideAt(0.5, [], configFor({ STREAM247_DISK_WATERMARK_ENABLED: "0" }))).toEqual({ kind: "idle" });
  });

  it("reads an unmeasurable volume as no opinion, never as pressure", () => {
    // statfs handing back zeros or garbage must not start deleting media in response to a
    // measurement bug.
    const config = configFor();

    expect(decideDiskWatermarkAction({ freeBytes: 0, totalBytes: 0, config, completedStages: [] })).toEqual({
      kind: "idle"
    });
    expect(
      decideDiskWatermarkAction({ freeBytes: Number.NaN, totalBytes: TOTAL_BYTES, config, completedStages: [] })
    ).toEqual({ kind: "idle" });
    expect(
      decideDiskWatermarkAction({ freeBytes: -1, totalBytes: TOTAL_BYTES, config, completedStages: [] })
    ).toEqual({ kind: "idle" });
  });
});

describe("how an episode proceeds and ends", () => {
  it("advances one stage per decision, in order", () => {
    expect(decideAt(5, [{ stage: "vod-cache", freedBytes: 2 * GB }])).toEqual({
      kind: "run-stage",
      stage: "feed-segments"
    });
    expect(
      decideAt(5, [
        { stage: "vod-cache", freedBytes: 2 * GB },
        { stage: "feed-segments", freedBytes: GB }
      ])
    ).toEqual({ kind: "run-stage", stage: "thumbnails" });
  });

  it("advances past a stage that freed nothing", () => {
    expect(decideAt(5, [{ stage: "vod-cache", freedBytes: 0 }])).toEqual({
      kind: "run-stage",
      stage: "feed-segments"
    });
  });

  it("stops at the recovery watermark instead of emptying everything", () => {
    // 16% free is above the 15% recovery watermark: the remaining stages are never run just
    // because they exist.
    expect(decideAt(16, [{ stage: "vod-cache", freedBytes: 11 * GB }])).toEqual({
      kind: "recovered",
      freedBytes: 11 * GB
    });
  });

  it("keeps evicting between the trigger and the recovery watermark", () => {
    // The hysteresis that makes eviction episodic: a fresh measurement at 12% free is fine, but an
    // episode already underway pushes on to the recovery watermark so free space does not hover at
    // the edge and re-trigger a few cycles later.
    expect(decideAt(12)).toEqual({ kind: "idle" });
    expect(decideAt(12, [{ stage: "vod-cache", freedBytes: 2 * GB }])).toEqual({
      kind: "run-stage",
      stage: "feed-segments"
    });
  });

  it("reports exhaustion when every stage has run and the disk is still below recovery", () => {
    // This is the "disk genuinely full" case: nothing evictable is left and only an operator can
    // free space. The wiring turns it into a critical incident.
    const decision = decideAt(3, [
      { stage: "vod-cache", freedBytes: GB },
      { stage: "feed-segments", freedBytes: 0 },
      { stage: "thumbnails", freedBytes: 512 }
    ]);

    expect(decision).toEqual({ kind: "exhausted", freedBytes: GB + 512 });
  });

  it("terminates: driving decisions against stages that free nothing never loops", () => {
    // The pathological disk — full, with nothing evictable — is exactly when an unbounded loop
    // would hurt most. Progression is by count, so the episode must visit each stage once and
    // settle on "exhausted".
    const completed: DiskWatermarkStageResult[] = [];
    const visited: string[] = [];

    for (let step = 0; step < DISK_WATERMARK_STAGE_ORDER.length + 2; step += 1) {
      const decision = decideAt(1, completed);
      if (decision.kind !== "run-stage") {
        expect(decision).toEqual({ kind: "exhausted", freedBytes: 0 });
        break;
      }
      visited.push(decision.stage);
      completed.push({ stage: decision.stage, freedBytes: 0 });
    }

    expect(visited).toEqual([...DISK_WATERMARK_STAGE_ORDER]);
    expect(new Set(visited).size).toBe(visited.length);
  });
});

describe("what eviction may never touch", () => {
  function stateFixture(overrides: Partial<DiskProtectionState> = {}): DiskProtectionState {
    return {
      scheduleBlocks: [
        { poolId: "pool-1", sourceName: "", cuepointAssetId: "cuepoint-bumper" },
        { sourceName: "Replays" }
      ],
      pools: [
        {
          id: "pool-1",
          sourceIds: ["source-pool"],
          cursorAssetId: "pool-cursor",
          insertAssetId: "pool-insert",
          audioLaneAssetId: "pool-lane"
        }
      ],
      sources: [
        { id: "source-pool", name: "Pool videos" },
        { id: "source-replays", name: "Replays" },
        { id: "source-unscheduled", name: "Unscheduled" }
      ],
      assets: [
        { id: "asset-in-pool", sourceId: "source-pool", isGlobalFallback: false },
        { id: "asset-replay", sourceId: "source-replays", isGlobalFallback: false },
        { id: "asset-unscheduled", sourceId: "source-unscheduled", isGlobalFallback: false },
        { id: "asset-fallback", sourceId: "source-unscheduled", isGlobalFallback: true }
      ],
      playout: {
        currentAssetId: "asset-on-air",
        desiredAssetId: "",
        nextAssetId: "asset-next",
        prefetchedAssetId: "asset-prefetched",
        transitionTargetAssetId: "",
        manualNextAssetId: "",
        queuedAssetIds: ["asset-queued"],
        queueItems: [{ assetId: "asset-queue-item" }]
      },
      ...overrides
    };
  }

  it("protects everything the broadcast queue and playout runtime name", () => {
    const protectedIds = collectDiskProtectedAssetIds(stateFixture());

    for (const assetId of ["asset-on-air", "asset-next", "asset-prefetched", "asset-queued", "asset-queue-item"]) {
      expect(protectedIds.has(assetId)).toBe(true);
    }
  });

  it("protects every asset a scheduled pool can rotate onto, not just the cursor", () => {
    // A pool block can select any ready asset of its sources on rotation, so all of them count as
    // schedule-referenced. Protecting only the cursor would evict the very file the rotation picks
    // next.
    const protectedIds = collectDiskProtectedAssetIds(stateFixture());

    for (const assetId of ["asset-in-pool", "pool-cursor", "pool-insert", "pool-lane", "cuepoint-bumper"]) {
      expect(protectedIds.has(assetId)).toBe(true);
    }
  });

  it("protects the assets of a block that names its source by name", () => {
    expect(collectDiskProtectedAssetIds(stateFixture()).has("asset-replay")).toBe(true);
  });

  it("protects global fallback assets, which play exactly when everything else went wrong", () => {
    expect(collectDiskProtectedAssetIds(stateFixture()).has("asset-fallback")).toBe(true);
  });

  it("leaves an asset no schedule, queue or fallback references unprotected", () => {
    // The negative case is the point of the set: without it the monitor could never free anything.
    expect(collectDiskProtectedAssetIds(stateFixture()).has("asset-unscheduled")).toBe(false);
  });

  it("never adds the empty id a blank playout field would produce", () => {
    expect(collectDiskProtectedAssetIds(stateFixture()).has("")).toBe(false);
  });
});
