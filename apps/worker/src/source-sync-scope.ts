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
  /** The per-source ingest threw and was caught; nothing was learned about its content. */
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
