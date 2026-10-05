// Per-cycle queue-prefetch planner.
//
// runPlayoutCycle prefetches upcoming queue assets to warm queueProbeCache. Resolving an
// uncached *remote* asset (Twitch VOD cache download + yt-dlp remote fallback, or a yt-dlp
// --get-url for a remote video) can each take up to its own timeout (~60-120s). Doing several
// of these sequentially inside one cycle can exceed LOOP_STALL_TIMEOUT_MS (300s), which makes
// runWithStallGuard misclassify a slow-but-progressing cycle as a hang and restart the playout
// container (observed as recurring playout-mode worker.loop.stalled during scheduled remote
// source cascades).
//
// This planner caps the number of *expensive* (remote) resolves awaited per cycle. Cheap
// resolves (already-cached entries, local files, direct media URLs) are never capped — they
// return effectively instantly. Deferred expensive candidates keep their "none" cache state and
// become candidates again on the next cycle, so the queue still warms over a few cycles without
// any single cycle blocking on 3-4 sequential remote resolves.

export type QueuePrefetchAction = "use-cache" | "refresh" | "skip-failed" | "resolve" | "defer";

export interface QueuePrefetchCandidate {
  // Fresh queueProbeCache state for this asset: "ready"/"failed" if a fresh probe exists,
  // otherwise "none".
  cacheStatus: "ready" | "failed" | "none";
  // True when resolving this asset requires a remote operation that can block for its full
  // timeout (Twitch VOD cache prep, or a resolvable remote video URL). Local files and
  // direct media URLs are not expensive.
  expensive: boolean;
  // A ready entry close to the end of its lifetime (isProbeRefreshDue).
  refreshDue?: boolean;
}

/**
 * Decide, for each queue candidate in order, what the cycle should do:
 *  - "use-cache":   a fresh ready probe exists; include it without resolving.
 *  - "refresh":     as "use-cache", and resolve it again in the background before the entry expires
 *                   (expensive items only, `maxRefreshes` per cycle; see isProbeRefreshDue).
 *  - "skip-failed": a fresh failed probe exists; skip it (cooldown handled by the cache TTL).
 *  - "resolve":     resolve it this cycle (awaited). Expensive resolves are capped.
 *  - "defer":       an expensive resolve beyond this cycle's budget; leave it for a later cycle.
 *
 * Cheap (non-expensive) uncached candidates are always "resolve" — they do not consume the
 * expensive budget. Expensive uncached candidates are "resolve" until `maxExpensiveResolves`
 * is reached, then "defer".
 */
export function planQueuePrefetch(
  candidates: QueuePrefetchCandidate[],
  maxExpensiveResolves = 1,
  maxRefreshes = 0
): QueuePrefetchAction[] {
  let expensiveBudget = Math.max(0, maxExpensiveResolves);
  let refreshBudget = Math.max(0, maxRefreshes);
  return candidates.map((candidate) => {
    if (candidate.cacheStatus === "ready") {
      if (candidate.refreshDue && candidate.expensive && refreshBudget > 0) {
        refreshBudget -= 1;
        return "refresh";
      }
      return "use-cache";
    }
    if (candidate.cacheStatus === "failed") {
      return "skip-failed";
    }
    if (!candidate.expensive) {
      return "resolve";
    }
    if (expensiveBudget > 0) {
      expensiveBudget -= 1;
      return "resolve";
    }
    return "defer";
  });
}

/**
 * Whether a ready probe entry is due for its early re-resolve (review finding R12, 2026-10-05).
 *
 * A ready entry lives five minutes and was re-resolved only once it had expired, so every warm remote item
 * went cold for the next scan (up to 15 s) plus its yt-dlp resolve, every five minutes. A scheduled insert
 * waits warm for its boundary as long as the item on air runs, an hour on a long archive, and a boundary in
 * one of those gaps bridged it and skipped it for good (M94, owner Q6) although nothing was wrong with it.
 * The pool's next item got a fallback bridge in the same gap. Now the entry is resolved again in its last
 * `aheadMs` while it is still used, and replaced only once the new resolve has succeeded.
 */
export function isProbeRefreshDue(input: { status: string; checkedAt: number; nowMs: number; ttlMs: number; aheadMs: number }): boolean {
  return input.status === "ready" && input.nowMs - input.checkedAt > input.ttlMs - input.aheadMs;
}

/**
 * Whether a ready probe entry names a format candidate that has failed to open since it was resolved (review
 * of M105, 2026-10-05). The exit handler drops the item's entry and records the candidate when ffmpeg cannot
 * open it, so the retry (M94, R13) resolves again from the next candidate. A resolve already in flight at
 * that moment, the R12 background refresh or a prefetch the cycle stopped waiting for, still lands
 * afterwards with the old candidate and wrote it back as ready; the retry took that entry and failed on the
 * same candidate, and the item, or a scheduled insert ("open-failed"), was skipped. Such an entry is neither
 * written nor used.
 */
export function isProbeCandidatePlayFailed(
  entry: { status: string; candidateId: string },
  playFailedCandidateIds: ReadonlySet<string>
): boolean {
  return entry.status === "ready" && entry.candidateId !== "" && playFailedCandidateIds.has(entry.candidateId);
}

/**
 * Per-cycle expensive-resolve budget, gated on broadcast coverage.
 *
 * When no playout process is running (post-boundary, the v1.5.16 soak failure), an awaited
 * ~60-120s remote resolve sits between the boundary and startOrSwitchPlayout while the ~60s
 * program-feed buffer drains — so the budget must be 0: start the selected asset (or fallback)
 * first, warm the queue on a later cycle once coverage is live. With a process running, the feed
 * is covered and the normal v1.5.13 cap applies.
 */
export function decideQueuePrefetchBudget(input: { coverageDown: boolean; defaultBudget: number }): number {
  return input.coverageDown ? 0 : Math.max(0, input.defaultBudget);
}

export type PrefetchResolveOutcome<T> =
  | { kind: "resolved"; value: T }
  | { kind: "failed"; error: unknown }
  | { kind: "abandoned" };

/**
 * Await an expensive prefetch resolve, but stop waiting the moment the covering playout process
 * dies. The resolve itself is not cancelled — the caller keeps its promise chain alive so a late
 * completion still lands in the probe cache — but the cycle is unblocked immediately so it can
 * start the next asset/fallback instead of letting the feed buffer drain behind an in-flight
 * yt-dlp/cache resolve (the exact 94s gap of the v1.5.16 soak failure: the boundary landed while
 * a prefetch resolve was already in flight, and the cycle could not start anything until it
 * finished). With no death signal (coverage already down), the resolve is awaited normally —
 * callers should not be resolving expensive candidates in that state at all (budget 0).
 */
export async function raceResolveAgainstDeath<T>(
  resolve: Promise<T>,
  death: Promise<unknown> | null
): Promise<PrefetchResolveOutcome<T>> {
  const tagged: Promise<PrefetchResolveOutcome<T>> = resolve.then(
    (value) => ({ kind: "resolved" as const, value }),
    (error) => ({ kind: "failed" as const, error })
  );
  if (!death) {
    return tagged;
  }
  return Promise.race([tagged, death.then(() => ({ kind: "abandoned" as const }))]);
}

/**
 * Count each probe result once. A cached entry is seen by every cycle while it lives (5 min when
 * ready, 60 s when failed, a cycle every 15 s), and until 2.1 every sighting counted: a ready entry
 * reset the quarantine counter to 0 some twenty times, and ONE failed resolve (a network outage at
 * night, say) added +4 and quarantined the asset for good -- quarantined assets are never probed
 * again. Returns true exactly once per entry, the first time it is asked; the caller counts then.
 */
export function takeUncountedProbeOutcome(entry: { outcomeCounted: boolean } | null | undefined): boolean {
  if (!entry || entry.outcomeCounted) {
    return false;
  }
  entry.outcomeCounted = true;
  return true;
}
