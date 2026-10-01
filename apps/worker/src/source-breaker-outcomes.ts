// Which probe outcomes the source circuit breaker (M75) hears, decided without I/O so the rule is a test.
//
// The queue scan records every probe once for per-item quarantine. The breaker takes the same outcomes
// minus one kind: a Twitch archive that is still downloading (TwitchVodCachePendingError). With remote
// fallback off, the default, the playout refuses such an archive until its file is there, and the
// download runner works one job at a time, tens of minutes each (vod-cache-jobs.ts). A single-source
// Twitch pool's queue holds four archives, so three of them waiting for their download were three
// distinct failed items within a minute: the breaker opened on a healthy source and held out its
// cached archives as well (M75 review, reproduced with the core planner). "Not downloaded yet" is
// neither a clean probe nor a failed one of the source, so it neither counts nor resets the count.
//
// A second kind never arrives here: the failures of the channel's own network outage (M82) are taken out
// of the scan's list before quarantine and this filter see it (probe-network-outage.ts).

import type { SourceBreakerOutcome } from "@stream247/core";

export type QueueProbeOutcome<TAsset extends { id: string; sourceId: string } = { id: string; sourceId: string }> = {
  asset: TAsset;
  outcome: "ok" | "failed";
  error: string;
  /** The failure was an archive whose download is queued or running. */
  pendingDownload?: boolean;
};

export function sourceBreakerOutcomesOf(probeOutcomes: readonly QueueProbeOutcome[]): SourceBreakerOutcome[] {
  return probeOutcomes
    .filter((probed) => !(probed.outcome === "failed" && probed.pendingDownload))
    .map((probed) => ({
      sourceId: probed.asset.sourceId,
      assetId: probed.asset.id,
      outcome: probed.outcome,
      error: probed.error
    }));
}
