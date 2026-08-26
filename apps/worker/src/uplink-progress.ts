/**
 * Stall detection for the uplink encoder.
 *
 * The uplink was supervised purely by process liveness: a running ffmpeg counted as a healthy
 * channel. In production it entered a state where it emitted 450 timestamp discontinuities a minute
 * and pushed well under its target bitrate, having lost its place in the sliding HLS window. Viewers
 * heard audio and video drift apart while every health surface reported "ok", and it never recovered
 * on its own.
 *
 * ffmpeg's own -progress output is the signal that separates "alive" from "working": out_time
 * advances only when frames are actually muxed. CPU is not a usable substitute -- consecutive
 * `docker stats` samples of a healthy uplink read 0.05% and 17.43% against a 30-second cgroup
 * average of 99%. This module turns the progress stream into a stall verdict and deliberately keeps
 * no I/O, so the thresholds can be tested without spawning anything.
 */

import { resolveUplinkWatchdogMs, WATCHDOG_LIMITS, type ManagedWatchdogInput } from "@stream247/core";

export type UplinkProgressState = {
  /** Highest out_time seen so far, in ffmpeg's own units. Only its monotonic growth matters. */
  lastValue: number;
  /** When lastValue last increased, or when tracking began if it never has. */
  lastAdvanceAtMs: number;
  /** False until ffmpeg reports its first progress block; startup is not a stall. */
  seenProgress: boolean;
  /** Partial line carried over between chunk boundaries. */
  pending: string;
};

export type UplinkStallOptions = {
  /** How long out_time may stand still before the uplink counts as stalled. */
  stallMs: number;
  /** Quiet period after start during which no verdict is given, for probing and connecting. */
  graceMs: number;
  /** How long an uplink may run without ever encoding a frame before it is restarted. */
  noProgressRestartMs: number;
};

export const DEFAULT_UPLINK_STALL_MS = WATCHDOG_LIMITS.uplinkStallTimeoutSeconds.default * 1000;
export const DEFAULT_UPLINK_GRACE_MS = WATCHDOG_LIMITS.uplinkStallGraceSeconds.default * 1000;
/** Long enough that a slow connect, a DNS retry and a reconnecting destination all resolve first. */
export const DEFAULT_UPLINK_NO_PROGRESS_RESTART_MS = WATCHDOG_LIMITS.uplinkNoProgressRestartSeconds.default * 1000;

/** M56 part 2: managed config first (seconds, clamped in core), env milliseconds second. */
export function getUplinkStallOptions(env: NodeJS.ProcessEnv, managed?: ManagedWatchdogInput): UplinkStallOptions {
  return resolveUplinkWatchdogMs(managed ?? null, env);
}

export function createUplinkProgressState(nowMs: number): UplinkProgressState {
  return { lastValue: 0, lastAdvanceAtMs: nowMs, seenProgress: false, pending: "" };
}

/**
 * Folds a chunk of -progress output into the state.
 *
 * ffmpeg emits `key=value` lines in blocks terminated by `progress=continue`. `out_time_ms` is
 * microseconds despite its name and `out_time_us` appears in newer builds; both are read, since
 * only the fact that the number grows is used.
 */
export function observeUplinkProgress(
  state: UplinkProgressState,
  chunk: string,
  nowMs: number
): UplinkProgressState {
  const buffered = state.pending + chunk;
  const lines = buffered.split("\n");
  // A chunk can end mid-line; hold the remainder back rather than parsing a truncated number.
  const pending = lines.pop() ?? "";

  let { lastValue, lastAdvanceAtMs, seenProgress } = state;

  for (const line of lines) {
    const separator = line.indexOf("=");
    if (separator === -1) {
      continue;
    }

    const key = line.slice(0, separator).trim();
    if (key !== "out_time_ms" && key !== "out_time_us") {
      continue;
    }

    const value = Number(line.slice(separator + 1).trim());
    if (!Number.isFinite(value) || value < 0) {
      continue;
    }

    seenProgress = true;
    if (value > lastValue) {
      lastValue = value;
      lastAdvanceAtMs = nowMs;
    }
  }

  return { lastValue, lastAdvanceAtMs, seenProgress, pending };
}

/**
 * True when ffmpeg is alive but has stopped producing output.
 *
 * Silent until ffmpeg has reported progress at least once. "Never produced output" is handled
 * separately by hasNeverProgressed, on a much longer clock: within the first minute it is
 * indistinguishable from a slow RTMP connect, but an hour of it is not.
 */
export function isUplinkStalled(
  state: UplinkProgressState,
  nowMs: number,
  startedAtMs: number,
  options: UplinkStallOptions
): boolean {
  if (nowMs - startedAtMs < options.graceMs) {
    return false;
  }
  if (!state.seenProgress) {
    return false;
  }
  return nowMs - state.lastAdvanceAtMs >= options.stallMs;
}

/**
 * True when ffmpeg has been running past its grace period without ever reporting progress.
 *
 * Worth reporting well before it is worth acting on, so this stays cheap to call every cycle.
 */
export function hasNeverProgressed(
  state: UplinkProgressState,
  nowMs: number,
  startedAtMs: number,
  options: UplinkStallOptions
): boolean {
  return !state.seenProgress && nowMs - startedAtMs >= options.graceMs;
}

/**
 * True when an uplink has never encoded a frame for so long that no benign explanation remains.
 *
 * This case was originally reported and never acted on, reasoning that a false positive costs a
 * restart loop while a false negative costs no more than the previous behaviour. That was wrong.
 * Observed in production: the uplink ran 65 minutes without a single frame and never opened an RTMP
 * connection, logging this state every 15 seconds while the channel was simply off the air. A
 * restart loop is noisy and visible in the restart tally; a silent dead uplink is neither.
 *
 * The threshold is minutes rather than seconds because a slow connect, a DNS retry and a
 * reconnecting destination all resolve far inside it.
 */
export function shouldRestartForNoProgress(
  state: UplinkProgressState,
  nowMs: number,
  startedAtMs: number,
  options: UplinkStallOptions
): boolean {
  return !state.seenProgress && nowMs - startedAtMs >= options.noProgressRestartMs;
}

/**
 * Whether a stalled out_time can be blamed on the uplink at all.
 *
 * An uplink reading the program feed legitimately stops advancing when that feed does, and no
 * number of restarts fixes a playout that is not producing. Acting on it anyway would turn a
 * playout outage into an uplink restart loop lasting exactly as long as the outage.
 */
export function canBlameUplinkForStall(inputMode: string, programFeedStatus: string): boolean {
  return inputMode !== "hls" || programFeedStatus === "fresh";
}

/**
 * Detection for a second way the uplink fails while looking healthy.
 *
 * When the playout process restarts, the program feed's timestamps restart with it. A long-lived
 * uplink that reads across that seam keeps encoding, but ffmpeg corrects each stream's
 * timeline separately: audio and video were observed receiving equal and opposite offsets of about
 * 122 seconds, which is what viewers hear as the tracks coming apart. It never recovers on its own,
 * and out_time keeps advancing the whole time, so the stall detector cannot see it.
 *
 * A clean uplink reports none of these at all, and reattaching it clears them completely, so a
 * sustained rate is both specific and actionable: restart and the seam is gone.
 */
export type UplinkDiscontinuityState = {
  windowStartedAtMs: number;
  count: number;
};

export const DEFAULT_DISCONTINUITY_WINDOW_MS = 60_000;
/** A healthy uplink reports zero; the observed failure ran at 450-530 per minute. */
export const DEFAULT_DISCONTINUITY_LIMIT = 120;

export function createUplinkDiscontinuityState(nowMs: number): UplinkDiscontinuityState {
  return { windowStartedAtMs: nowMs, count: 0 };
}

/** True when an ffmpeg stderr line reports the demuxer resynchronising a stream. */
export function isTimestampDiscontinuityLine(line: string): boolean {
  return line.includes("timestamp discontinuity");
}

export function observeDiscontinuityLine(
  state: UplinkDiscontinuityState,
  line: string,
  nowMs: number,
  windowMs: number = DEFAULT_DISCONTINUITY_WINDOW_MS
): UplinkDiscontinuityState {
  if (!isTimestampDiscontinuityLine(line)) {
    return state;
  }
  // A fixed window rather than a rolling one: the failure is sustained for as long as it lasts, so
  // it survives any window boundary, while a brief legitimate burst at a seam is discarded with the
  // window it landed in.
  if (nowMs - state.windowStartedAtMs >= windowMs) {
    return { windowStartedAtMs: nowMs, count: 1 };
  }
  return { windowStartedAtMs: state.windowStartedAtMs, count: state.count + 1 };
}

export function isDiscontinuityStorm(
  state: UplinkDiscontinuityState,
  nowMs: number,
  startedAtMs: number,
  options: UplinkStallOptions,
  limit: number = DEFAULT_DISCONTINUITY_LIMIT
): boolean {
  if (nowMs - startedAtMs < options.graceMs) {
    return false;
  }
  return state.count >= limit;
}
