// Which sources a connector sync is allowed to replace wholesale.
//
// syncTwitchVodSources / syncYoutubePlaylistSources collect assets from every enabled source and
// then call replaceAssetsForSourceIds(allSourceIds, collectedAssets), which is a
// `DELETE FROM assets WHERE source_id = ANY(...)` followed by a re-insert of what was collected.
//
// Until v1.5.33 a source whose ingest threw contributed zero assets but stayed in that delete
// list, so one transient yt-dlp error wiped every asset of that source. Measured on the DUT
// (v1.5.31): the wipe emptied the scheduled pool, so choosePlaybackCandidate found no preferred
// asset, fell through to `global_fallback`, and — because the on-air asset's row no longer existed
// for the stickiness guards to find — cut the running programme mid-play via
// stopPlayoutProcess("switch"). The next worker sync re-inserted the rows and playout switched
// back, producing a strict fallback <-> programme alternation every 30-60s.
//
// The rule here is deliberately asymmetric, in the direction that protects the broadcast: a sync
// may only delete a source's stored assets when it has positive evidence that the source really
// holds that content. Absence of evidence (a throw, or an unexpectedly empty listing for a source
// that was populated a moment ago) keeps the existing rows. Stale rows are recoverable and
// invisible to viewers; deleted rows take the channel off air.

export interface SourceSyncOutcome {
  sourceId: string;
  /**
   * The per-source ingest did not complete, so nothing was learned about the source's content.
   *
   * Covers every way a sync can end without evidence, not just a throw: a caught yt-dlp error, a
   * URL that failed validation before any call went out, and a filesystem walk that could not
   * list some directory. All of them produce a short or empty listing that looks exactly like a
   * source that genuinely lost its content, which is why the distinction has to be carried here
   * rather than inferred from the asset count.
   */
  ingestFailed: boolean;
  /** Assets this sync collected for the source. */
  incomingAssetCount: number;
  /** Assets currently stored for the source. */
  storedAssetCount: number;
}

export type SourceReplaceDecision =
  // Safe to delete-and-reinsert this source's assets.
  | "replace"
  // The ingest threw — keep whatever is stored.
  | "keep-ingest-failed"
  // The ingest "succeeded" but returned nothing for a source that currently has assets. That is
  // far more often a soft failure (rate limit, empty playlist response, auth blip) than a channel
  // that genuinely lost its entire archive, so the stored rows stay.
  | "keep-empty-result";

export function decideSourceAssetReplacement(outcome: SourceSyncOutcome): SourceReplaceDecision {
  if (outcome.ingestFailed) {
    return "keep-ingest-failed";
  }
  if (outcome.incomingAssetCount === 0 && outcome.storedAssetCount > 0) {
    return "keep-empty-result";
  }
  return "replace";
}

/**
 * Source ids whose stored assets may be replaced wholesale by this sync.
 *
 * Per-source, so one failing source never blocks a healthy sibling from refreshing.
 */
export function selectReplaceableSourceIds(outcomes: SourceSyncOutcome[]): string[] {
  return outcomes.filter((outcome) => decideSourceAssetReplacement(outcome) === "replace").map((outcome) => outcome.sourceId);
}

/** The only thing this module needs to know about an asset. */
type AssetOfSource = { sourceId: string };

export type PreservedSourceAssets = {
  sourceId: string;
  decision: Exclude<SourceReplaceDecision, "replace">;
  storedAssetCount: number;
};

export type SourceAssetReplacementPlan<TAsset extends AssetOfSource> = {
  /** Source ids whose stored assets this sync may delete and rewrite. */
  replaceableSourceIds: string[];
  /** Assets to insert, already narrowed to the replaceable sources. */
  assetsToWrite: TAsset[];
  /** Sources whose stored assets stay untouched, with the reason — one log line each. */
  preserved: PreservedSourceAssets[];
};

/**
 * Turn a sync's raw results into "what may be deleted and what gets written".
 *
 * Pure on purpose: every wipe this repo has suffered came from a caller that computed the delete
 * list and the insert list in two different places and let them drift apart. Here they are one
 * value, so a source that is not replaceable cannot contribute a delete, and an asset cannot be
 * written for a source that is not being replaced.
 */
export function planSourceAssetReplacement<TAsset extends AssetOfSource>(args: {
  sources: readonly { id: string }[];
  storedAssets: readonly AssetOfSource[];
  incomingAssets: readonly TAsset[];
  failedSourceIds: ReadonlySet<string>;
}): SourceAssetReplacementPlan<TAsset> {
  const outcomes: SourceSyncOutcome[] = args.sources.map((source) => ({
    sourceId: source.id,
    ingestFailed: args.failedSourceIds.has(source.id),
    incomingAssetCount: args.incomingAssets.filter((asset) => asset.sourceId === source.id).length,
    storedAssetCount: args.storedAssets.filter((asset) => asset.sourceId === source.id).length
  }));

  const replaceable = new Set<string>();
  const preserved: PreservedSourceAssets[] = [];

  for (const outcome of outcomes) {
    const decision = decideSourceAssetReplacement(outcome);
    if (decision === "replace") {
      replaceable.add(outcome.sourceId);
      continue;
    }
    preserved.push({ sourceId: outcome.sourceId, decision, storedAssetCount: outcome.storedAssetCount });
  }

  return {
    replaceableSourceIds: [...replaceable],
    assetsToWrite: args.incomingAssets.filter((asset) => replaceable.has(asset.sourceId)),
    preserved
  };
}

export type SourceSyncStatusLabels = {
  /** The sync collected content. */
  ready: string;
  /** The sync completed with nothing, and there was nothing stored to protect. */
  empty: string;
  /** The sync produced no usable evidence, and stored assets were kept because of it. */
  preserved: string;
};

export const DEFAULT_SOURCE_SYNC_STATUS_LABELS: SourceSyncStatusLabels = {
  ready: "Ready",
  empty: "Ingestion failed",
  preserved: "Ingestion failed (assets preserved)"
};

export type SourceSyncStatusDescription = {
  /** Value for the source's `status` column. */
  status: string;
  /** Whether this sync deliberately kept previously stored assets instead of replacing them. */
  assetsPreserved: boolean;
  /** How many assets the source holds once this sync has been written. */
  effectiveAssetCount: number;
};

/**
 * Describe how a sync ended, in the terms an operator needs.
 *
 * "Ingestion failed" alone cannot be acted on: it reads identically whether the source still has
 * its archive or was just emptied, which is precisely the difference between "wait for the next
 * cycle" and "the channel is about to fall back". So the preserved case gets its own status and
 * reports the count that is actually still playable, rather than the zero this sync collected.
 */
export function describeSourceSyncStatus(
  outcome: SourceSyncOutcome,
  labels: SourceSyncStatusLabels = DEFAULT_SOURCE_SYNC_STATUS_LABELS
): SourceSyncStatusDescription {
  // The replacement rule holds back a failed source even when it stores nothing, because not
  // deleting is the safer invariant. The status must not inherit that rounding: telling an
  // operator assets were preserved when there were none to preserve is exactly the kind of
  // reassuring-but-wrong reading this finding is about.
  if (decideSourceAssetReplacement(outcome) !== "replace" && outcome.storedAssetCount > 0) {
    return {
      status: labels.preserved,
      assetsPreserved: true,
      effectiveAssetCount: outcome.storedAssetCount
    };
  }

  return {
    status: outcome.incomingAssetCount > 0 ? labels.ready : labels.empty,
    assetsPreserved: false,
    effectiveAssetCount: outcome.incomingAssetCount
  };
}

/**
 * The operator-facing sentence for a sync that produced nothing usable.
 *
 * Shared across connectors so the preserved case reads the same everywhere: what is still
 * playable, and that no action is needed unless it keeps happening.
 */
export function buildPreservedAssetsNote(storedAssetCount: number): string {
  return storedAssetCount > 0
    ? `This sync produced no usable listing, so the ${storedAssetCount} stored item(s) were kept and stay playable. The next sync retries.`
    : "This sync produced no usable listing. There were no stored items to keep. The next sync retries.";
}
