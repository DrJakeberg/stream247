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

/**
 * Outcomes whose breaker write failed, kept for one more write (combination review).
 *
 * The scan marks a probe counted before the breaker hears of it (takeUncountedProbeOutcome), so a failed
 * write was not retried by the next cycle, as its comment said: no later scan produces the outcome again
 * until the probe cache expires (60 s for a failure, five minutes for a clean probe). A half-open trial
 * judged clean and lost that way went on air with its source still "held out of programming" until its
 * next item was probed, hours later for an archive.
 *
 * One more write and no further: an outcome the database refuses for what it is (its text) would
 * otherwise fail every write after it. `take` hands out what an earlier failed write left, oldest first,
 * then the new outcomes, and forgets the carried ones; `keep` stores the outcomes of a write that failed
 * and had not been tried before.
 */
export function createBreakerOutcomeCarry(limit = 40): {
  take: (fresh: readonly SourceBreakerOutcome[]) => SourceBreakerOutcome[];
  keep: (untried: readonly SourceBreakerOutcome[]) => void;
} {
  let carried: SourceBreakerOutcome[] = [];
  return {
    take(fresh) {
      const outcomes = [...carried, ...fresh];
      carried = [];
      return outcomes;
    },
    keep(untried) {
      carried = [...carried, ...untried].slice(-limit);
    }
  };
}
