/**
 * The conservative library sweep (M57): which asset rows may be removed, decided from data only.
 *
 * Source syncs replace assets per source and full-state writes rewrite the table wholesale, but
 * an asset whose SOURCE row is gone survives both untouched — those orphans are the unbounded
 * growth this sweep exists for. Deleting a row that anything still points at is the dangerous
 * failure, so removal requires all three, in this order:
 *
 *   (a) orphaned — the asset's source id matches no existing source;
 *   (b) unreferenced — no reference path in the schema names the asset. The paths, exhaustively:
 *       pools (cursor_asset_id, insert_asset_id, audio_lane_asset_id, and source_ids still
 *       listing the vanished source), schedule_blocks (cuepoint_asset_id; source_name resolves
 *       through an existing source, so it can only ever name non-orphans), curated sets
 *       (asset_collection_items), the playout runtime (current/previous/desired/next/prefetched/
 *       transition-target/manual-next/last-successful/override/insert/skip/cuepoint-last asset
 *       ids, queued_asset_ids and queue_items), chat (vote options and winner, viewer requests,
 *       the skip campaign), and the global-fallback flag on the asset itself;
 *   (c) observed orphaned for the whole protection window. The clock is the sweep's own mark
 *       (asset_retention_marks), written when an orphan is first SEEN — losing a source must
 *       never make weeks-old assets deletable the same day. The asset's own timestamps are a
 *       second, independent floor when they parse.
 *
 * Everything here is pure so each reference path is testable on its own; the executor in
 * index.ts hydrates the snapshot, keeps the marks, and only it ever deletes.
 */

export type AssetRetentionSnapshot = {
  sources: ReadonlyArray<{ id: string; name: string }>;
  assets: ReadonlyArray<{
    id: string;
    sourceId: string;
    isGlobalFallback: boolean;
    createdAt: string;
    updatedAt: string;
  }>;
  pools: ReadonlyArray<{
    sourceIds: readonly string[];
    cursorAssetId: string;
    insertAssetId: string;
    audioLaneAssetId: string;
  }>;
  scheduleBlocks: ReadonlyArray<{ cuepointAssetId?: string }>;
  assetCollections: ReadonlyArray<{ assetIds: readonly string[] }>;
  playout: {
    currentAssetId: string;
    previousAssetId: string;
    desiredAssetId: string;
    nextAssetId: string;
    prefetchedAssetId: string;
    transitionTargetAssetId: string;
    manualNextAssetId: string;
    lastSuccessfulAssetId: string;
    overrideAssetId: string;
    insertAssetId: string;
    skipAssetId: string;
    cuepointLastAssetId: string;
    queuedAssetIds: readonly string[];
    queueItems: ReadonlyArray<{ assetId: string }>;
  };
  chat: {
    voteWinnerAssetId: string;
    voteOptionAssetIds: readonly string[];
    viewerRequestAssetIds: readonly string[];
    skipVoteAssetId: string;
  };
  /** Asset id → ISO timestamp of when the sweep first saw the asset orphaned. */
  orphanFirstSeenAt: Readonly<Record<string, string>>;
};

/**
 * Why growth is retained, in numbers. The per-path counters overlap on purpose (one orphan can
 * be referenced from several places); keptOrphanedReferenced is the distinct total. Logged on
 * every sweep — enabled or not — so an operator can watch what WOULD happen before switching
 * deletion on.
 */
export type AssetRetentionCounters = {
  assetsTotal: number;
  keptWithSource: number;
  orphaned: number;
  keptOrphanedReferenced: number;
  keptOrphanedInProtectionWindow: number;
  keptAsGlobalFallback: number;
  deletable: number;
  referencedByPoolRuntime: number;
  referencedByPoolSource: number;
  referencedBySchedule: number;
  referencedByCollection: number;
  referencedByPlayout: number;
  referencedByQueue: number;
  referencedByChat: number;
};

export type AssetRetentionClassification = {
  /** Every currently orphaned asset id, for the executor's mark bookkeeping. */
  orphanedAssetIds: string[];
  deletableAssetIds: string[];
  counters: AssetRetentionCounters;
};

const DAY_MS = 24 * 60 * 60 * 1000;

function toSet(values: Iterable<string>): Set<string> {
  const set = new Set<string>();
  for (const value of values) {
    if (value) {
      set.add(value);
    }
  }
  return set;
}

function parseMs(value: string | undefined): number | null {
  const ms = Date.parse(value ?? "");
  return Number.isFinite(ms) ? ms : null;
}

export function classifyAssetRetention(
  snapshot: AssetRetentionSnapshot,
  args: { nowMs: number; protectionDays: number }
): AssetRetentionClassification {
  const sourceIds = toSet(snapshot.sources.map((source) => source.id));
  const poolRuntimeIds = toSet(
    snapshot.pools.flatMap((pool) => [pool.cursorAssetId, pool.insertAssetId, pool.audioLaneAssetId])
  );
  const poolSourceIds = toSet(snapshot.pools.flatMap((pool) => [...pool.sourceIds]));
  const scheduleIds = toSet(snapshot.scheduleBlocks.map((block) => block.cuepointAssetId ?? ""));
  const collectionIds = toSet(snapshot.assetCollections.flatMap((collection) => [...collection.assetIds]));
  const playoutIds = toSet([
    snapshot.playout.currentAssetId,
    snapshot.playout.previousAssetId,
    snapshot.playout.desiredAssetId,
    snapshot.playout.nextAssetId,
    snapshot.playout.prefetchedAssetId,
    snapshot.playout.transitionTargetAssetId,
    snapshot.playout.manualNextAssetId,
    snapshot.playout.lastSuccessfulAssetId,
    snapshot.playout.overrideAssetId,
    snapshot.playout.insertAssetId,
    snapshot.playout.skipAssetId,
    snapshot.playout.cuepointLastAssetId
  ]);
  const queueIds = toSet([
    ...snapshot.playout.queuedAssetIds,
    ...snapshot.playout.queueItems.map((item) => item.assetId)
  ]);
  const chatIds = toSet([
    snapshot.chat.voteWinnerAssetId,
    snapshot.chat.skipVoteAssetId,
    ...snapshot.chat.voteOptionAssetIds,
    ...snapshot.chat.viewerRequestAssetIds
  ]);

  const counters: AssetRetentionCounters = {
    assetsTotal: snapshot.assets.length,
    keptWithSource: 0,
    orphaned: 0,
    keptOrphanedReferenced: 0,
    keptOrphanedInProtectionWindow: 0,
    keptAsGlobalFallback: 0,
    deletable: 0,
    referencedByPoolRuntime: 0,
    referencedByPoolSource: 0,
    referencedBySchedule: 0,
    referencedByCollection: 0,
    referencedByPlayout: 0,
    referencedByQueue: 0,
    referencedByChat: 0
  };
  const orphanedAssetIds: string[] = [];
  const deletableAssetIds: string[] = [];
  const protectionMs = args.protectionDays * DAY_MS;

  for (const asset of snapshot.assets) {
    if (sourceIds.has(asset.sourceId)) {
      counters.keptWithSource += 1;
      continue;
    }

    counters.orphaned += 1;
    orphanedAssetIds.push(asset.id);

    let referenced = false;
    if (poolRuntimeIds.has(asset.id)) {
      counters.referencedByPoolRuntime += 1;
      referenced = true;
    }
    if (poolSourceIds.has(asset.sourceId)) {
      // The pool names the vanished source: its rotation would pick this asset back up the
      // moment the source returns, so the claim counts as a reference.
      counters.referencedByPoolSource += 1;
      referenced = true;
    }
    if (scheduleIds.has(asset.id)) {
      counters.referencedBySchedule += 1;
      referenced = true;
    }
    if (collectionIds.has(asset.id)) {
      counters.referencedByCollection += 1;
      referenced = true;
    }
    if (playoutIds.has(asset.id)) {
      counters.referencedByPlayout += 1;
      referenced = true;
    }
    if (queueIds.has(asset.id)) {
      counters.referencedByQueue += 1;
      referenced = true;
    }
    if (chatIds.has(asset.id)) {
      counters.referencedByChat += 1;
      referenced = true;
    }
    if (asset.isGlobalFallback) {
      counters.keptAsGlobalFallback += 1;
      referenced = true;
    }
    if (referenced) {
      counters.keptOrphanedReferenced += 1;
      continue;
    }

    // The protection window. A missing or unparsable mark means the clock starts THIS cycle —
    // the executor writes the mark, and only a later sweep may find it aged. The asset's own
    // timestamps are an additional floor whenever they parse; when they do not, the mark alone
    // decides, so legacy rows with broken timestamps are still sweepable — a week after they
    // were first seen orphaned, never sooner.
    const firstSeenMs = parseMs(snapshot.orphanFirstSeenAt[asset.id]);
    let eligibleAtMs = firstSeenMs === null ? Number.POSITIVE_INFINITY : firstSeenMs + protectionMs;
    const updatedMs = parseMs(asset.updatedAt);
    if (updatedMs !== null) {
      eligibleAtMs = Math.max(eligibleAtMs, updatedMs + protectionMs);
    }
    const createdMs = parseMs(asset.createdAt);
    if (createdMs !== null) {
      eligibleAtMs = Math.max(eligibleAtMs, createdMs + protectionMs);
    }

    if (args.nowMs < eligibleAtMs) {
      counters.keptOrphanedInProtectionWindow += 1;
      continue;
    }

    counters.deletable += 1;
    deletableAssetIds.push(asset.id);
  }

  return { orphanedAssetIds, deletableAssetIds, counters };
}

/**
 * The enable switch gates DELETION only, never the counting: a disabled sweep still classifies
 * and still logs, so the operator can watch the candidate counters before turning it on.
 */
export function selectAssetRetentionDeletions(
  classification: AssetRetentionClassification,
  deleteEnabled: boolean
): string[] {
  return deleteEnabled ? [...classification.deletableAssetIds] : [];
}
