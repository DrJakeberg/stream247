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

import { SOURCE_BARREN_RUN_ALERT_THRESHOLD, countBarrenSyncRuns, type SourceSyncRunView } from "@stream247/core";

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

// ---------------------------------------------------------------------------
// Whether a source that keeps coming back empty belongs in the incident list.
//
// The rule above stops an empty listing from deleting an archive. It does not make the emptiness
// visible, and on 2026-08-27 that was the other half of the outage: the Twitch listing returned no
// entries without throwing, so the sync took its success path, wrote the run as "skipped" with zero
// discovered assets, and called resolveIncident on `source.<kind>.<id>` — closing the only entry
// that could have said anything. The sources page showed the words "Ingestion failed" and the
// incident list showed nothing, for hours, with the channel on the filler slate.
//
// This is deliberately not a new fingerprint. Per incident-classes.ts the keyed `source` family is
// already a STATE ("One named source fails to ingest until its next run succeeds; that run closes
// it per source"), and "answered with nothing" is the same open question for an operator as "threw"
// — same source, same consequence, resolved by the same event. A second fingerprint would list one
// broken source twice.

export interface SourceDroughtInput {
  /** This source's runs, newest first, including the one the current cycle has just produced. */
  runs: readonly SourceSyncRunView[];
  /** Assets currently stored for the source — evidence that it used to deliver. */
  storedAssetCount: number;
  /** True when at least one pool draws on this source, so its emptiness reaches the programme. */
  referencedByPool: boolean;
}

export type SourceDroughtDecision = {
  /**
   * `resolve` when the newest check delivered, `report` while the drought is worth an operator's
   * attention, `leave` when there is nothing to say and nothing to take back.
   */
  action: "resolve" | "report" | "leave";
  barrenRuns: number;
};

export function decideSourceDroughtIncident(input: SourceDroughtInput): SourceDroughtDecision {
  const barrenRuns = countBarrenSyncRuns(input.runs);

  if (input.runs.length > 0 && barrenRuns === 0) {
    return { action: "resolve", barrenRuns };
  }

  if (barrenRuns < SOURCE_BARREN_RUN_ALERT_THRESHOLD) {
    // Below the threshold this says nothing — and, importantly, does not resolve either. The old
    // code's unconditional resolve is what let an empty listing erase the entry a genuine failure
    // had raised one cycle earlier.
    return { action: "leave", barrenRuns };
  }

  // A source with an archive has demonstrably delivered before, so a drought is a regression. A
  // source with nothing stored only matters once something plays from it. Neither: an unused source
  // with an empty archive is a setting, not an incident, and reporting it would park a permanently
  // open entry in the list that no action can close.
  const matters = input.storedAssetCount > 0 || input.referencedByPool;

  return { action: matters ? "report" : "leave", barrenRuns };
}
