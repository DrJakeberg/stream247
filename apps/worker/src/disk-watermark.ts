/**
 * One watermark for the whole media volume, above the per-cache guardrails.
 *
 * Each cache already protects itself: the VOD cache refuses downloads below its min-free-bytes
 * floor, and the program feed sweep reclaims abandoned segments at boundaries. What none of them
 * sees is the volume as a whole — local uploads, thumbnails and the caches together can fill the
 * disk while every individual guardrail is satisfied. A full media volume stops playout, segment
 * writes and downloads at once, so this module decides — from measurements only, with no I/O of
 * its own — when the worker should start evicting and which stage runs next.
 *
 * The stages are ordered by how cheap the loss is: an unused VOD cache entry re-downloads itself,
 * an orphaned feed segment is garbage by definition, and a thumbnail regenerates on the next
 * library sync. One stage runs per worker cycle so the work a cycle does stays bounded, for the
 * same reason the feed sweep is capped. Nothing here ever names schedule-referenced media; the
 * stage implementations receive an explicit protection set built by collectDiskProtectedAssetIds.
 */

export const DISK_WATERMARK_STAGE_ORDER = ["vod-cache", "feed-segments", "thumbnails"] as const;

export type DiskWatermarkStage = (typeof DISK_WATERMARK_STAGE_ORDER)[number];

export type DiskWatermarkConfig = {
  enabled: boolean;
  /** Fraction of the volume that must stay free; below this an eviction episode starts. */
  triggerFreeRatio: number;
  /** Fraction of the volume at which an episode stops evicting. Above the trigger on purpose. */
  recoverFreeRatio: number;
};

const DEFAULT_TRIGGER_FREE_PERCENT = 10;
const DEFAULT_RECOVER_FREE_PERCENT = 15;

function readPercent(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 && parsed < 100 ? parsed : fallback;
}

export function getDiskWatermarkConfig(env: NodeJS.ProcessEnv): DiskWatermarkConfig {
  const triggerPercent = readPercent(env.STREAM247_DISK_WATERMARK_TRIGGER_PERCENT, DEFAULT_TRIGGER_FREE_PERCENT);
  const recoverPercent = readPercent(env.STREAM247_DISK_WATERMARK_RECOVER_PERCENT, DEFAULT_RECOVER_FREE_PERCENT);

  // The recovery watermark only means something above the trigger: with the pair equal or
  // inverted, every episode would end the moment it started and the monitor would do nothing
  // while looking configured. A misordered override is ignored whole rather than half-applied,
  // because "my numbers are in effect but swapped" is far harder to diagnose than "my numbers
  // were rejected".
  const ordered = recoverPercent > triggerPercent;
  return {
    enabled: env.STREAM247_DISK_WATERMARK_ENABLED !== "0",
    triggerFreeRatio: (ordered ? triggerPercent : DEFAULT_TRIGGER_FREE_PERCENT) / 100,
    recoverFreeRatio: (ordered ? recoverPercent : DEFAULT_RECOVER_FREE_PERCENT) / 100
  };
}

export type DiskWatermarkStageResult = {
  stage: DiskWatermarkStage;
  freedBytes: number;
};

export type DiskWatermarkDecision =
  /** Free space is fine and no episode is running. */
  | { kind: "idle" }
  /** Run exactly this one stage this cycle, then measure again next cycle. */
  | { kind: "run-stage"; stage: DiskWatermarkStage }
  /** The episode freed enough: free space is back above the recovery watermark. */
  | { kind: "recovered"; freedBytes: number }
  /** Every stage has run and free space is still below the recovery watermark. */
  | { kind: "exhausted"; freedBytes: number };

export function decideDiskWatermarkAction(args: {
  freeBytes: number;
  totalBytes: number;
  config: DiskWatermarkConfig;
  /** Stages already run in the current episode, in the order they ran. Empty means no episode. */
  completedStages: readonly DiskWatermarkStageResult[];
}): DiskWatermarkDecision {
  const { freeBytes, totalBytes, config, completedStages } = args;

  if (!config.enabled) {
    return { kind: "idle" };
  }

  // A volume that cannot be measured must read as "no opinion", never as pressure: statfs handing
  // back zeros or garbage would otherwise start deleting media in response to a measurement bug.
  if (!Number.isFinite(freeBytes) || !Number.isFinite(totalBytes) || totalBytes <= 0 || freeBytes < 0) {
    return { kind: "idle" };
  }

  const freeRatio = freeBytes / totalBytes;
  const freedBytes = completedStages.reduce((sum, result) => sum + result.freedBytes, 0);

  if (completedStages.length === 0) {
    return freeRatio < config.triggerFreeRatio
      ? { kind: "run-stage", stage: DISK_WATERMARK_STAGE_ORDER[0] }
      : { kind: "idle" };
  }

  // Mid-episode the bar is the recovery watermark, not the trigger. Stopping at the trigger would
  // leave free space hovering right at the edge and re-trigger a fresh episode a few cycles later;
  // recovering to a higher watermark buys real headroom, so eviction runs as occasional episodes
  // instead of permanent background churn. It also means an episode stops the moment it has freed
  // enough — later stages are never run just because they exist.
  if (freeRatio >= config.recoverFreeRatio) {
    return { kind: "recovered", freedBytes };
  }

  // Progression is by count, one stage per decision, so a stage that freed nothing simply advances
  // to the next and the episode can never revisit a stage or loop: after every stage has run once
  // the only possible answers are "recovered" or "exhausted".
  if (completedStages.length >= DISK_WATERMARK_STAGE_ORDER.length) {
    return { kind: "exhausted", freedBytes };
  }

  return { kind: "run-stage", stage: DISK_WATERMARK_STAGE_ORDER[completedStages.length] };
}

/**
 * The slice of application state the protection set is derived from. Structural on purpose so the
 * full AppState satisfies it directly while tests can build the few fields that matter.
 */
export type DiskProtectionState = {
  scheduleBlocks: ReadonlyArray<{ poolId?: string; sourceName: string; cuepointAssetId?: string }>;
  pools: ReadonlyArray<{
    id: string;
    sourceIds: readonly string[];
    cursorAssetId: string;
    insertAssetId: string;
    audioLaneAssetId: string;
  }>;
  sources: ReadonlyArray<{ id: string; name: string }>;
  assets: ReadonlyArray<{ id: string; sourceId: string; isGlobalFallback: boolean }>;
  playout: {
    currentAssetId: string;
    desiredAssetId: string;
    nextAssetId: string;
    prefetchedAssetId: string;
    transitionTargetAssetId: string;
    manualNextAssetId: string;
    queuedAssetIds: readonly string[];
    queueItems: ReadonlyArray<{ assetId: string }>;
  };
};

/**
 * Every asset id the schedule or the broadcast still references. Media belonging to any of these
 * must never be evicted under disk pressure: deleting it would make the channel re-download or
 * re-generate the very files it is about to play, on a machine that is struggling precisely
 * because its disk is full.
 *
 * The schedule side is deliberately generous. A block that names a pool can rotate onto any asset
 * of that pool's sources, so all of them count as referenced — not just the pool's cursor. A block
 * that names a source by name covers that source's assets the same way, and global fallback assets
 * are included because they are exactly what plays when everything else has gone wrong.
 */
export function collectDiskProtectedAssetIds(state: DiskProtectionState): Set<string> {
  const protectedIds = new Set<string>();
  const add = (assetId: string | undefined) => {
    if (assetId) {
      protectedIds.add(assetId);
    }
  };

  add(state.playout.currentAssetId);
  add(state.playout.desiredAssetId);
  add(state.playout.nextAssetId);
  add(state.playout.prefetchedAssetId);
  add(state.playout.transitionTargetAssetId);
  add(state.playout.manualNextAssetId);
  for (const assetId of state.playout.queuedAssetIds) {
    add(assetId);
  }
  for (const item of state.playout.queueItems) {
    add(item.assetId);
  }

  const referencedSourceIds = new Set<string>();
  for (const block of state.scheduleBlocks) {
    add(block.cuepointAssetId);

    if (block.poolId) {
      const pool = state.pools.find((entry) => entry.id === block.poolId);
      if (pool) {
        add(pool.cursorAssetId);
        add(pool.insertAssetId);
        add(pool.audioLaneAssetId);
        for (const sourceId of pool.sourceIds) {
          referencedSourceIds.add(sourceId);
        }
      }
    }

    if (block.sourceName) {
      const source = state.sources.find((entry) => entry.name === block.sourceName);
      if (source) {
        referencedSourceIds.add(source.id);
      }
    }
  }

  for (const asset of state.assets) {
    if (asset.isGlobalFallback || referencedSourceIds.has(asset.sourceId)) {
      add(asset.id);
    }
  }

  return protectedIds;
}
