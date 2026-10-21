// A pool does not stay on a pick that cannot be prepared (M112).
//
// M98 measured it: a pool of three broken items picked its 404 item for over four minutes. The pick
// failed its inline resolve, the fallback covered the boundary, and the next cycle picked the same item
// again, because the rotation moves only when a pick starts. The queue was not probed while the fallback
// was on air, so the source breaker learned one failed item (it counts distinct items) and the per-item
// quarantine none (it counted only the queue's probes).
//
// Now a failed resolve is written to the probe cache like a failed queue probe, and the pool rotation
// passes over an item whose failure is still fresh (the cache keeps a failure for a minute): the next
// cycle picks the next item, the breaker hears each item it fails on, and quarantine counts the failure
// once per minute at most, as it does for the queue. An archive still downloading is no failure of its
// own (TwitchVodCachePendingError) and is neither recorded nor passed over.

export type CachedProbeView = { status: "ready" | "failed"; pendingDownload: boolean } | null;

/** Whether the pool rotation passes over an item with this fresh probe-cache entry. */
export function isPassedOverPoolPick(cached: CachedProbeView): boolean {
  return cached !== null && cached.status === "failed" && !cached.pendingDownload;
}

export type SelectionResolveFailureDecision =
  // Write the failure to the probe cache and count it for quarantine.
  | "record"
  // A fresh failure is already in the cache: leave it (and its time) as it is, count nothing.
  | "already-recorded"
  // Not a pick of the schedule, or an archive still downloading.
  | "ignore";

export function decideSelectionResolveFailure(args: {
  reasonCode: string;
  pendingDownload: boolean;
  cached: CachedProbeView;
}): SelectionResolveFailureDecision {
  if (args.reasonCode !== "scheduled_match" || args.pendingDownload) {
    return "ignore";
  }
  return isPassedOverPoolPick(args.cached) ? "already-recorded" : "record";
}
