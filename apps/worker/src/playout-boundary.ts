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

// An ffmpeg process that fails this quickly after start did not play any content — it failed at
// input-open time, which for a remote-resolved asset means the resolved URL was dead/expired.
export const IMMEDIATE_OPEN_FAILURE_MAX_MS = 15_000;

export interface ImmediateOpenFailureInput {
  exitCode: number | string | null;
  exitSignal: string | null;
  stderrSample: string;
  // Milliseconds the process ran before exiting, or null if unknown (treated as immediate).
  ranForMs: number | null;
}

/**
 * (A) Detect an immediate input-open failure: ffmpeg exits almost immediately because the
 * resolved remote URL is dead/expired (observed as exitCode=8 / "Error opening input" on a
 * scheduled YouTube googlevideo URL). Callers invalidate that asset's resolved-input cache so
 * the next attempt re-resolves a fresh URL instead of reusing the dead one. A signal-terminated
 * exit (SIGKILL/SIGTERM) is a planned/forced stop, not an open failure.
 */
export function isImmediateInputOpenFailure(input: ImmediateOpenFailureInput): boolean {
  if (input.exitSignal) {
    return false;
  }
  const codeNum = typeof input.exitCode === "number" ? input.exitCode : Number.parseInt(String(input.exitCode ?? ""), 10);
  const stderr = (input.stderrSample || "").toLowerCase();
  const openError =
    codeNum === 8 ||
    stderr.includes("error opening input") ||
    stderr.includes("server returned 4") ||
    stderr.includes("http error 4") ||
    stderr.includes("403 forbidden") ||
    stderr.includes("404 not found") ||
    stderr.includes("410 gone");
  const immediate = input.ranForMs === null || input.ranForMs <= IMMEDIATE_OPEN_FAILURE_MAX_MS;
  return immediate && openError;
}

export interface BroadcastCoverageInput {
  // A playout ffmpeg process is currently running and feeding the program feed.
  playoutProcessRunning: boolean;
}

/**
 * Broadcast coverage is "down" — a cold resolve would open a no-playout gap that drains the
 * program-feed buffer — whenever no playout process is currently running. This is true for BOTH
 * a failed exit (v1.5.14) AND a clean natural-boundary exit (the v1.5.14-soak gap: global_fallback
 * ended cleanly, the next scheduled Twitch VOD was cold, and the ~93s inline resolve left no
 * process running while the ~60s feed buffer drained). When a process is still running (steady
 * state, or fallback already covering after a bridge), a cold resolve is covered by the live feed,
 * so we keep the existing inline-resolve behavior.
 */
export function isBroadcastCoverageDown(input: BroadcastCoverageInput): boolean {
  return !input.playoutProcessRunning;
}

export interface BoundaryBridgeInput {
  // The selected scheduled asset needs a slow remote resolve (Twitch cache prep / yt-dlp).
  assetExpensive: boolean;
  // The selected asset's resolved input is already warm in the probe cache.
  cacheWarm: boolean;
  // The broadcast path has no running playout process (see isBroadcastCoverageDown) — true for a
  // failed exit AND a clean natural-boundary exit — so a multi-minute cold resolve would leave
  // broadcastReady=false rather than coasting on the program-feed buffer.
  broadcastDown: boolean;
  // A cheap (local) fallback asset is available to bridge with.
  fallbackAvailable: boolean;
}

/**
 * (B) Decide whether to bridge to the local fallback before doing a cold expensive remote
 * resolve. When the previous playout failed (broadcast going dark) and the next scheduled asset
 * needs a ~60-120s cold resolve, we start the instant local fallback first so broadcastReady
 * recovers in seconds; the scheduled asset then resolves on a later cycle while fallback covers,
 * and playout switches to it once ready. When broadcast is still coasting (clean boundary), or
 * the asset is cheap/warm, or no fallback exists, we keep the existing inline-resolve behavior.
 */
export function shouldBridgeToFallbackBeforeResolve(input: BoundaryBridgeInput): boolean {
  return input.assetExpensive && !input.cacheWarm && input.broadcastDown && input.fallbackAvailable;
}
