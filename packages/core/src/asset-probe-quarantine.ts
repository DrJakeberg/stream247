/**
 * When the playout stops choosing an item whose source will not serve it.
 *
 * Measured on the DUT, 2026-09-07: a YouTube item in a pool returned "Requested format is not available"
 * from yt-dlp on every prefetch. The probe caught it each time, the playout bridged with the fallback and
 * the channel stayed on air — and then the scheduler chose the same item again. Nothing recorded that the
 * item was unplayable, so the loop ran for hours: bridge, incident, self-resolve, bridge again. The item
 * showed as `ready` in the library the whole time and never aired.
 *
 * The failure count lives on the asset so the decision survives a worker restart, and it takes a few
 * failures rather than one because a probe can fail for reasons that pass on their own — a rate limit, a
 * DNS blip, a CDN reset. Three consecutive failures is not a blip; nothing seen on the DUT recovered after
 * two.
 *
 * Quarantine deliberately does NOT touch `includeInProgramming`. That flag is the operator's own choice
 * and overwriting it would lose what they set and lie about who decided. Quarantine is a separate, visible
 * state that the operator clears once the source is fixed or the item is replaced.
 */
export const ASSET_PROBE_QUARANTINE_THRESHOLD = 3;

export type AssetProbeState = {
  /** Consecutive prefetch probe failures. A success sets it back to zero. */
  playbackProbeFailures?: number;
  /** What the last failing probe said, for the person who has to decide what to do about it. */
  playbackProbeError?: string;
  playbackProbedAt?: string;
};

/** Has this item failed to probe often enough that automatic selection should pass it over? */
export function isAssetProbeQuarantined(asset: AssetProbeState): boolean {
  return (asset.playbackProbeFailures ?? 0) >= ASSET_PROBE_QUARANTINE_THRESHOLD;
}

/**
 * The next probe state for an item, given how the probe went.
 *
 * A success clears everything: an item that plays again is not on probation for what it did last week.
 */
export function nextAssetProbeState(args: {
  current: AssetProbeState;
  outcome: "ok" | "failed";
  error?: string;
  nowIso: string;
}): Required<AssetProbeState> {
  if (args.outcome === "ok") {
    return { playbackProbeFailures: 0, playbackProbeError: "", playbackProbedAt: args.nowIso };
  }
  return {
    playbackProbeFailures: (args.current.playbackProbeFailures ?? 0) + 1,
    playbackProbeError: (args.error ?? "").slice(0, 500),
    playbackProbedAt: args.nowIso
  };
}

/** Reached quarantine with this very failure — the moment worth telling someone about. */
export function crossedIntoQuarantine(before: AssetProbeState, after: AssetProbeState): boolean {
  return !isAssetProbeQuarantined(before) && isAssetProbeQuarantined(after);
}
