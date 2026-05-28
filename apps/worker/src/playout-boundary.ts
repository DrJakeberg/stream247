export interface BoundaryProbe {
  status: "ready" | "failed";
  resolvedInput: string;
}

export interface BoundaryInputDecision {
  // "cache":   reuse the prefetched resolved input — no inline resolve at the boundary.
  // "resolve": fall through to an inline resolveAssetPlaybackInput call.
  source: "cache" | "resolve";
  input: string;
}

/**
 * Decide the playback input for an asset selected at a playout boundary.
 *
 * Prefers the input already resolved by the off-boundary queue prefetch so that a Twitch-VOD
 * cache / yt-dlp resolve never runs inline between the old ffmpeg exit and the new one. That
 * inline resolve is what left playout idle with an empty currentAsset (broadcastReady=false)
 * in the v1.5.10 CLEAN4 soak. On a stale/missing/failed probe (or one with no resolvedInput)
 * it returns "resolve", preserving the previous inline behavior — never worse than before.
 */
export function decideBoundaryPlaybackInput(probe: BoundaryProbe | null): BoundaryInputDecision {
  if (probe && probe.status === "ready" && probe.resolvedInput) {
    return { source: "cache", input: probe.resolvedInput };
  }
  return { source: "resolve", input: "" };
}
