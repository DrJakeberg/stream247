/**
 * What a source's sync history means, in sentences an operator can act on.
 *
 * Measured on the running channel on 2026-08-27: the Twitch source could not list its archive, and
 * the channel sat on the filler slate for hours. Every fact needed to understand that was already
 * stored -- `source_sync_runs` had a row every 30 seconds, each with a status, a summary and
 * `discovered_assets: 0` -- and none of it was on the surface an operator opens. The sources page
 * showed the word "Ingestion failed", a raw ISO timestamp, and three counts ("2 pool refs",
 * "20 schedule refs", "0 open incident(s)"). None of those answers the two questions actually being
 * asked in front of that page: is this happening now, and is the programme affected.
 *
 * So this turns the run history into the three things that were missing:
 *
 *  - WHEN it was last checked and WHAT it found, in words rather than a stored timestamp;
 *  - HOW LONG it has been finding nothing, because one empty listing is a blip that the preserve
 *    rule in `source-sync-scope.ts` already absorbs, and the fourth in a row is an outage;
 *  - WHAT IT MEANS -- which scheduled blocks draw on this source, and whether they still have
 *    something to play. That link (source -> pool -> block) is what nobody could see on the day.
 *
 * Pure, so both the web surfaces and the worker's incident decision read the same definition of
 * "this source has stopped delivering" instead of two that drift apart.
 */

export type SourceSyncRunView = {
  /** `"success" | "error" | "skipped"` as stored, widened because the column is unconstrained TEXT. */
  status: string;
  startedAt: string;
  finishedAt: string;
  discoveredAssets: number;
  errorMessage?: string;
};

/**
 * How many checks in a row may find nothing before it is worth telling somebody.
 *
 * Three. The worker cycle runs every 30 seconds and syncs every source on every cycle, so this puts
 * a drought on screen inside two minutes while still refusing to react to a single transient
 * response -- one empty listing from a rate limit or an auth blip is exactly the case the
 * asset-preserve rule handles silently and correctly, and reporting it would train an operator to
 * ignore the report. Three consecutive checks cannot be one bad answer. The outage this comes from
 * ran for hours, so the cost of waiting for the third check is not the thing to optimise.
 */
export const SOURCE_BARREN_RUN_ALERT_THRESHOLD = 3;

/** How many block names a sentence carries before it stops being a sentence. */
const MAX_NAMES_IN_SENTENCE = 3;

/** A run that taught the channel nothing, whatever the stored status word says about it. */
function isBarren(run: SourceSyncRunView): boolean {
  // The count, not the status. A "success" that discovered nothing leaves the schedule exactly as
  // empty-handed as an "error" does, and the connectors do write that combination.
  return !(run.discoveredAssets > 0);
}

/**
 * How many of the most recent checks found nothing, counting back until one that did.
 *
 * Runs must arrive newest-first, which is how `getSourceSyncRuns` returns them.
 */
export function countBarrenSyncRuns(runs: readonly SourceSyncRunView[]): number {
  let count = 0;
  for (const run of runs) {
    if (!isBarren(run)) {
      break;
    }
    count += 1;
  }

  return count;
}

/**
 * An elapsed span as somebody would say it.
 *
 * Every result ends in " ago", including the sub-minute case, so one substitution in the wording
 * baseline covers all of them. A shape that did not end that way -- "just now" was the obvious
 * candidate -- would slip past that pattern and rot the recorded surfaces within the hour.
 */
export function describeElapsed(elapsedMs: number): string {
  if (!Number.isFinite(elapsedMs)) {
    return "";
  }

  const minutes = Math.max(0, Math.floor(elapsedMs / 60_000));
  if (minutes < 1) {
    return "less than a minute ago";
  }
  if (minutes < 60) {
    return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 48) {
    return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  }

  const days = Math.floor(hours / 24);
  return `${days} days ago`;
}

function elapsedSince(iso: string, nowMs: number): number {
  const at = iso ? new Date(iso).getTime() : Number.NaN;
  return Number.isFinite(at) && Number.isFinite(nowMs) ? nowMs - at : Number.NaN;
}

/** "A", "A and B", "A, B and C", "A, B, C and 2 more". */
function joinNames(names: readonly string[]): string {
  const shown = names.slice(0, MAX_NAMES_IN_SENTENCE);
  const hidden = names.length - shown.length;
  const parts = hidden > 0 ? [...shown, `${hidden} more`] : shown;

  if (parts.length <= 1) {
    return parts[0] ?? "";
  }

  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

export type SourceHealthInput = {
  /** `sources.last_synced_at`; "" when the source has never been synced. Means last ATTEMPT. */
  lastSyncedAt: string;
  /** Newest first. May be empty for a source whose rows have aged out of the 250-row table. */
  runs: readonly SourceSyncRunView[];
  /** Assets currently stored for this source -- what a drought is or is not costing the channel. */
  storedAssetCount: number;
  /** Pools whose programming draws on this source. */
  poolNames: readonly string[];
  /** Scheduled blocks fed by those pools. */
  blockNames: readonly string[];
  nowMs: number;
};

export type SourceHealthReport = {
  /** Consecutive most-recent checks that found nothing. 0 while the newest one delivered. */
  barrenRuns: number;
  /** True once the drought has passed the threshold and is worth an operator's attention. */
  alerting: boolean;
  /** One sentence about the last check. Never empty. */
  headline: string;
  /** What the drought reaches, or "" when the source is delivering or nothing draws on it. */
  impact: string;
};

/** The clause that says whether the archive survived the drought. */
function describePreservation(storedAssetCount: number): string {
  // The distinction the operator actually needs. Since v1.5.33 a barren sync keeps the stored rows
  // instead of deleting them, so a drought with an archive behind it is a stale channel and a
  // drought without one is a dark channel. Those are different nights.
  //
  // The COUNT, not the fact of preservation. Since v1.5.34 the status badge on the same row already
  // reads "Ingestion failed (assets preserved)", and repeating "the stored videos are being kept"
  // two centimetres away would be one fact in two wordings — the thing an operator has to reconcile
  // rather than read. What the badge cannot say is how much is still playable, so that is what this
  // says.
  return storedAssetCount > 0
    ? `The ${storedAssetCount} stored video${storedAssetCount === 1 ? "" : "s"} stay playable.`
    : "Nothing is stored for it either.";
}

function describeLastCheck(input: SourceHealthInput, barrenRuns: number): string {
  const newest = input.runs[0];
  if (!newest) {
    const elapsed = describeElapsed(elapsedSince(input.lastSyncedAt, input.nowMs));
    return elapsed === "" ? "Never checked yet." : `Last checked ${elapsed}.`;
  }

  const checkedAt = describeElapsed(elapsedSince(newest.finishedAt || newest.startedAt, input.nowMs));

  if (barrenRuns === 0) {
    const found = newest.discoveredAssets;
    return `Last checked ${checkedAt}, found ${found} video${found === 1 ? "" : "s"}.`;
  }

  // The newest run's own status picks the verb: "failed" is a claim about what happened, and only
  // the last attempt can support it. A streak that mixes a throw with empty listings is described
  // by its most recent answer rather than by whichever member is the most alarming.
  const failed = newest.status === "error";
  const preservation = describePreservation(input.storedAssetCount);

  if (barrenRuns === 1) {
    return failed ? `The last check failed ${checkedAt}. ${preservation}` : `Nothing came back ${checkedAt}. ${preservation}`;
  }

  const oldestBarren = input.runs[barrenRuns - 1];
  const since = describeElapsed(elapsedSince(oldestBarren?.startedAt ?? "", input.nowMs));
  const sinceClause = since === "" ? "" : `, the first of them ${since}`;

  return failed
    ? `The last ${barrenRuns} checks failed${sinceClause}. ${preservation}`
    : `Nothing came back the last ${barrenRuns} times${sinceClause}. ${preservation}`;
}

function describeImpact(input: SourceHealthInput, alerting: boolean): string {
  // Only while something is wrong. "This source feeds two blocks" is true every minute of every
  // day; printed unconditionally it becomes furniture, and furniture is what an operator's eye
  // skips over at exactly the moment it matters.
  if (!alerting) {
    return "";
  }

  if (input.blockNames.length > 0) {
    const blocks = joinNames(input.blockNames);
    if (input.storedAssetCount > 0) {
      return `It feeds ${blocks} on the schedule, which keep playing the stored videos for now.`;
    }
    const subject = input.blockNames.length === 1 ? "that block has" : "those blocks have";
    return `It feeds ${blocks} on the schedule, and ${subject} nothing left to play.`;
  }

  if (input.poolNames.length > 0) {
    const pools = joinNames(input.poolNames);
    return input.storedAssetCount > 0
      ? `It feeds ${pools}, which no scheduled block uses right now.`
      : `It feeds ${pools}, which has nothing left from this source.`;
  }

  return "";
}

/** The whole per-source report: when, how many, since when, and what it costs the programme. */
export function describeSourceHealth(input: SourceHealthInput): SourceHealthReport {
  const barrenRuns = countBarrenSyncRuns(input.runs);
  const alerting = barrenRuns >= SOURCE_BARREN_RUN_ALERT_THRESHOLD;

  return {
    barrenRuns,
    alerting,
    headline: describeLastCheck(input, barrenRuns),
    impact: describeImpact(input, alerting)
  };
}
