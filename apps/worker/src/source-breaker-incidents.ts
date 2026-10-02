// The incident each source circuit breaker keeps (M75), decided without I/O so the lifecycle is a test.
//
// One incident per held source, keyed by source like playout.source-unplayable and for the same reason
// (incident-classes.ts): a source that stops serving its items is one fault. It is upserted on every cycle
// while the breaker holds the source, so its text follows the hold (open, then the trial), and resolved
// in the first cycle that finds the breaker closed, whoever closed it -- the playout itself included,
// when the breaker has nothing left to hold.

import {
  describeSourceBreaker,
  formatSourceBreakerTime as formatBreakerTime,
  SOURCE_BREAKER_MAX_COOLDOWN_SECONDS,
  type SourceBreakerRecord,
  type SourceBreakerView
} from "@stream247/core";

export type SourceBreakerIncidentAction =
  | { action: "upsert"; sourceId: string; fingerprint: string; title: string; message: string }
  | { action: "resolve"; sourceId: string; fingerprint: string; message: string }
  // Close the breaker itself: it holds a source no pool could pick anyway. The incident is resolved
  // with it when it is open.
  | { action: "close"; sourceId: string; fingerprint: string; message: string; incidentOpen: boolean };

const FINGERPRINT_PREFIX = "playout.source-breaker.";

export function sourceBreakerIncidentFingerprint(sourceId: string): string {
  return `${FINGERPRINT_PREFIX}${sourceId}`;
}

export function describeHeldSourceIncident(view: SourceBreakerView, quarantinedCount: number): string {
  const cause = `Probes failed on ${view.failedItemCount} different items of this source with no clean probe in between, last: ${view.lastError || "no error text"}.`;
  const hold =
    view.phase === "open"
      ? `Pools skip it since ${formatBreakerTime(view.openedAt)} and try one item of it after ${formatBreakerTime(view.retryAt)}.`
      : `The hold ran out at ${formatBreakerTime(view.retryAt)}: the next item a pool picks from it is a trial probe.`;
  const outcome = `A clean probe brings the source back and closes this; a failed one holds it twice as long (at most ${SOURCE_BREAKER_MAX_COOLDOWN_SECONDS / 3600} h).`;
  // Folded in here because the per-item incident of this source stands back while the breaker holds it.
  const quarantine =
    quarantinedCount > 0 ? ` ${quarantinedCount} of its items are also skipped one by one after failing their own probes.` : "";
  return `${cause} ${hold} ${outcome}${quarantine} Check the source, or close the breaker on its page once it is fixed.`;
}

/**
 * What to do with each breaker's incident. A breaker whose source is gone (deleted by a whole-state write,
 * which leaves the row) is resolved like a closed one: there is nothing left to hold.
 *
 * A closed breaker is resolved only while its incident is open in the cycle's snapshot. Every resolve is a
 * serialized state write, and a row stays behind for every source that ever failed a probe; the snapshot
 * is enough to know, because the only site that opens this incident is the playout's previous cycle.
 *
 * Two holds would otherwise never end (M75 review):
 * - A source deleted from its page loses its row in the same transaction, so no record is left to walk.
 *   Every open incident of this family without a row is resolved from its fingerprint.
 * - A breaker that holds a source no pool could pick anyway -- every item quarantined, excluded or cooling
 *   down, or the source in no pool -- is closed. Half-open, it would wait for a trial that no pick can
 *   start, and its incident would stand in for the per-item one with the wrong cause and the wrong action
 *   for as long as that lasts. That is the end state of the SABR case, once failed trials have
 *   quarantined the items one by one: quarantine owns the case, and its incident comes back.
 */
export function planSourceBreakerIncidents(args: {
  records: readonly SourceBreakerRecord[];
  sources: ReadonlyArray<{ id: string; name: string }>;
  quarantinedBySource: ReadonlyMap<string, { count: number }>;
  openFingerprints: ReadonlySet<string>;
  nowMs: number;
  /** Whether some pool could pick an item of the source if the breaker let it. */
  hasPoolCandidate: (sourceId: string) => boolean;
}): SourceBreakerIncidentAction[] {
  const fromRecords = args.records.flatMap((record): SourceBreakerIncidentAction[] => {
    const fingerprint = sourceBreakerIncidentFingerprint(record.sourceId);
    const incidentOpen = args.openFingerprints.has(fingerprint);
    const source = args.sources.find((entry) => entry.id === record.sourceId);
    if (!source) {
      return incidentOpen ? [{ action: "resolve", sourceId: record.sourceId, fingerprint, message: "The source no longer exists." }] : [];
    }
    const view = describeSourceBreaker(record, args.nowMs);
    if (!view) {
      return incidentOpen
        ? [{ action: "resolve", sourceId: record.sourceId, fingerprint, message: "The source is back in the pool rotation." }]
        : [];
    }
    if (!args.hasPoolCandidate(record.sourceId)) {
      return [
        {
          action: "close",
          sourceId: record.sourceId,
          fingerprint,
          incidentOpen,
          message:
            "No pool could pick an item of this source anyway (each is quarantined, excluded or cooling down, or no pool has the source), so there is nothing left to hold. Quarantined items are on the source's own incident."
        }
      ];
    }
    return [
      {
        action: "upsert",
        sourceId: record.sourceId,
        fingerprint,
        title: `${source.name} is held out of programming`,
        message: describeHeldSourceIncident(view, args.quarantinedBySource.get(record.sourceId)?.count ?? 0)
      }
    ];
  });
  const recorded = new Set(args.records.map((record) => record.sourceId));
  const withoutRow = [...args.openFingerprints]
    .filter((fingerprint) => fingerprint.startsWith(FINGERPRINT_PREFIX) && !recorded.has(fingerprint.slice(FINGERPRINT_PREFIX.length)))
    .map(
      (fingerprint): SourceBreakerIncidentAction => ({
        action: "resolve",
        sourceId: fingerprint.slice(FINGERPRINT_PREFIX.length),
        fingerprint,
        message: "The source no longer exists."
      })
    );
  return [...fromRecords, ...withoutRow];
}
