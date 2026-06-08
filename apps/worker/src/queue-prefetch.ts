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

export type QueuePrefetchAction = "use-cache" | "skip-failed" | "resolve" | "defer";

export interface QueuePrefetchCandidate {
  // Fresh queueProbeCache state for this asset: "ready"/"failed" if a fresh probe exists,
  // otherwise "none".
  cacheStatus: "ready" | "failed" | "none";
  // True when resolving this asset requires a remote operation that can block for its full
  // timeout (Twitch VOD cache prep, or a resolvable remote video URL). Local files and
  // direct media URLs are not expensive.
  expensive: boolean;
}

/**
 * Decide, for each queue candidate in order, what the cycle should do:
 *  - "use-cache":   a fresh ready probe exists; include it without resolving.
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
  maxExpensiveResolves = 1
): QueuePrefetchAction[] {
  let expensiveBudget = Math.max(0, maxExpensiveResolves);
  return candidates.map((candidate) => {
    if (candidate.cacheStatus === "ready") {
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
