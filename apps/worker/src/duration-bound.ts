/**
 * Deliberate end-of-asset for sources that reach their end without delivering EOF.
 *
 * The most frequent on-air fault, several times a day on the test channel: a remotely streamed VOD
 * (a CloudFront-backed Twitch asset too large to cache) reaches its end and ffmpeg never receives
 * EOF. The process stays alive reading nothing, the fps=60 filter manufactures video by duplicating
 * the last frame ("More than 1000 frames dup" in the logs), audio goes silent, the uplink encoder
 * stalls on the unusable feed and its watchdog restarts it after ~45 seconds — one viewer-visible
 * discontinuity — and only at 91 seconds of silence does the feed-audio watchdog finally rotate the
 * asset (uplink.encoder_stall.restart with stalledSeconds 50-60 at almost every asset end,
 * playout.feed_audio.restart with silentSeconds 91).
 *
 * When the asset's duration is known there is no reason to wait for an EOF that may never come:
 * once elapsed playback passes duration plus a margin, everything after that point is duplicated
 * last-frame, not content. The playout ends the asset deliberately through the same planned-stop
 * path every other intentional transition takes, so the switch happens before the watchdog cascade
 * begins instead of being rescued by it. This is scheduling, not fault handling — no incident is
 * raised, and the feed-audio watchdog stays in place as the net for the unknown-duration case.
 */

import { resolveDurationBoundMarginSeconds, WATCHDOG_LIMITS, type ManagedWatchdogInput } from "@stream247/core";

// Mirrors the playoutTargetKind union in index.ts: what kind of input the running process serves.
export type DurationBoundTargetKind = "asset" | "insert" | "standby" | "reconnect" | "live" | "";

export type DurationBoundOptions = {
  /** Seconds past the known duration before the asset is ended deliberately. */
  marginSeconds: number;
};

// Generous enough to never cut real content: metadata durations from yt-dlp are accurate to the
// second, so the asset should have ended well before the margin runs out — and cutting fifteen
// seconds of duplicated last-frame is invisible, while cutting real content is not. The margin
// also absorbs the wall-clock skew from brief remote rebuffering, where elapsed real time runs
// slightly ahead of the playback position.
export const DEFAULT_DURATION_BOUND_MARGIN_SECONDS = WATCHDOG_LIMITS.durationBoundMarginSeconds.default;

/** M56 part 2: managed config first (clamped 5..120 in core), env seconds second. */
export function getDurationBoundOptions(env: NodeJS.ProcessEnv, managed?: ManagedWatchdogInput): DurationBoundOptions {
  return {
    marginSeconds: resolveDurationBoundMarginSeconds(managed ?? null, env)
  };
}

export type DurationBoundInput = {
  targetKind: DurationBoundTargetKind;
  /** The asset's known duration in seconds; zero or less means unknown. */
  durationSeconds: number;
  /** When the playout process started, from the same clock the feed watchdogs use; zero means none. */
  processStartedAtMs: number;
  nowMs: number;
  marginSeconds: number;
};

/**
 * True once the running asset has played past its known duration plus the margin.
 *
 * Only file-like program content ("asset" and "insert") has a defined end. Live-bridge input is
 * open-ended by nature and must never be cut; standby and reconnect slates are synthetic and loop
 * until replaced.
 *
 * An unknown duration — missing, zero, or nonsense — is the rollback path: the decision never
 * fires and playout behaves exactly as it does today, with the feed-audio watchdog as the net.
 *
 * A margin of zero or less would allow cutting at or before the exact metadata duration, which is
 * precisely the risk the margin exists to avoid, so it is treated as invalid and never fires. The
 * env reader above already substitutes the default for such values; this guard covers callers.
 */
export function shouldEndAssetAtDurationBound(input: DurationBoundInput): boolean {
  if (input.targetKind !== "asset" && input.targetKind !== "insert") {
    return false;
  }
  if (!Number.isFinite(input.durationSeconds) || input.durationSeconds <= 0) {
    return false;
  }
  if (!Number.isFinite(input.processStartedAtMs) || input.processStartedAtMs <= 0) {
    return false;
  }
  if (!Number.isFinite(input.marginSeconds) || input.marginSeconds <= 0) {
    return false;
  }
  return input.nowMs - input.processStartedAtMs >= (input.durationSeconds + input.marginSeconds) * 1000;
}
