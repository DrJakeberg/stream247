/**
 * A playout process that is alive and producing nothing.
 *
 * Observed on the test channel: ffmpeg had been running three hours and forty-three minutes, state
 * S, 0% CPU, blocked reading a remote source that had stopped delivering. Its -reconnect flags are
 * set and did not fire; it simply waited. The program feed stopped advancing, the uplink found no
 * material and exited "end of input" once a minute, and the channel was off air for four minutes
 * until something else eventually shook it loose.
 *
 * The uplink has had a watchdog for exactly this shape since earlier work — running is not the same
 * as working. Playout did not, which is why four minutes rather than fifteen seconds.
 *
 * The rule is deliberately narrow. Restarting playout interrupts whatever is on air, so it happens
 * only when there is a process to blame, it has had time to produce, and the feed has genuinely
 * stopped: a stale feed with no process running is a different problem, and a process still inside
 * its grace period has simply not started yet.
 */

import { resolvePlayoutFeedWatchdogMs, WATCHDOG_LIMITS, type ManagedWatchdogInput } from "@stream247/core";

export type PlayoutFeedHealthOptions = {
  /** How long the feed may stand still before the running process is held responsible. */
  staleMs: number;
  /** How long after a start a process is left alone, since a fresh one has produced nothing yet. */
  graceMs: number;
};

export const DEFAULT_PLAYOUT_FEED_STALE_MS = WATCHDOG_LIMITS.feedStallTimeoutSeconds.default * 1000;
export const DEFAULT_PLAYOUT_FEED_GRACE_MS = WATCHDOG_LIMITS.feedStallGraceSeconds.default * 1000;

/** M56 part 2: managed config first (seconds, clamped in core), env milliseconds second. */
export function getPlayoutFeedHealthOptions(
  env: NodeJS.ProcessEnv,
  managed?: ManagedWatchdogInput
): PlayoutFeedHealthOptions {
  return resolvePlayoutFeedWatchdogMs(managed ?? null, env);
}

export function shouldRestartStalledPlayout(args: {
  playoutRunning: boolean;
  processStartedAtMs: number;
  feedUpdatedAtMs: number;
  nowMs: number;
  options: PlayoutFeedHealthOptions;
}): boolean {
  if (!args.playoutRunning) {
    return false;
  }

  // No feed timestamp at all means bootstrapping or an unreadable playlist — neither is evidence
  // that this process is the thing at fault.
  if (!args.feedUpdatedAtMs) {
    return false;
  }

  if (args.nowMs - args.processStartedAtMs < args.options.graceMs) {
    return false;
  }

  return args.nowMs - args.feedUpdatedAtMs >= args.options.staleMs;
}
