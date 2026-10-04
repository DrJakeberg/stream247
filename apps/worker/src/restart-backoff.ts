/**
 * A growing pause between automatic restarts of the same thing (M103, H7).
 *
 * The crash-loop reset and the uplink watchdog used to restart at full speed for as long as the
 * fault lasted: an item that kills ffmpeg on every start was retried as soon as crash-loop
 * protection saw something playable, and an uplink that stalls again a minute after each restart
 * reconnected to Twitch every minute. Each restart is a visible cut and a fresh connection, and a
 * fault that a restart does not fix is not fixed by the twentieth one either.
 *
 * The first restart of a streak still happens at once, as before. Each further restart within the
 * streak waits longer, doubling from 15 s up to 5 min. A streak ends when a restart was followed by
 * `RESTART_BACKOFF_QUIET_MS` without a new trigger, so one bad hour does not slow down tomorrow.
 *
 * Kept in the process's memory on purpose: a container restart is itself a pause, and starting a
 * fresh process at the beginning of the sequence costs at most one immediate restart.
 */

export const RESTART_BACKOFF_FIRST_MS = 15_000;
export const RESTART_BACKOFF_MAX_MS = 5 * 60_000;
export const RESTART_BACKOFF_QUIET_MS = 10 * 60_000;

/** The pause before the restart that follows `previousRestarts` restarts of the same streak. */
export function restartBackoffDelayMs(previousRestarts: number): number {
  if (!Number.isFinite(previousRestarts) || previousRestarts <= 0) {
    return 0;
  }
  const doublings = Math.min(Math.floor(previousRestarts) - 1, 20);
  return Math.min(RESTART_BACKOFF_FIRST_MS * 2 ** doublings, RESTART_BACKOFF_MAX_MS);
}

export type RestartBackoffPlan = {
  /** How long to wait from the trigger before restarting; 0 restarts at once. */
  delayMs: number;
  /** This restart's position in its streak, counting from 1. */
  attempt: number;
};

/** One streak of restarts of one thing (the playout, or one uplink output profile). */
export class RestartBackoff {
  private restarts = 0;
  private lastRestartAtMs = Number.NaN;

  constructor(private readonly quietMs: number = RESTART_BACKOFF_QUIET_MS) {}

  /** The pause a restart triggered at `nowMs` has to wait. Does not record anything. */
  plan(nowMs: number): RestartBackoffPlan {
    const previous = this.streakAt(nowMs);
    return { delayMs: restartBackoffDelayMs(previous), attempt: previous + 1 };
  }

  /** A restart happened at `nowMs`. */
  recordRestart(nowMs: number): void {
    this.restarts = this.streakAt(nowMs) + 1;
    this.lastRestartAtMs = nowMs;
  }

  private streakAt(nowMs: number): number {
    if (!Number.isFinite(this.lastRestartAtMs) || nowMs - this.lastRestartAtMs > this.quietMs) {
      return 0;
    }
    return this.restarts;
  }
}

/**
 * The backoff part of an incident message, in absolute UTC (incident messages store no relative
 * time, M90). Empty for a restart that does not wait.
 */
export function describeRestartBackoff(plan: RestartBackoffPlan, resumeAtMs: number): string {
  if (plan.delayMs <= 0) {
    return "";
  }
  const at = new Date(resumeAtMs).toISOString().slice(0, 19).replace("T", " ");
  return `This is restart ${plan.attempt} in a row, so it waits ${formatBackoffDelay(plan.delayMs)} and restarts at ${at} UTC; each further repeat waits longer, up to 5 min.`;
}

export function formatBackoffDelay(delayMs: number): string {
  const seconds = Math.round(delayMs / 1000);
  if (seconds < 60) {
    return `${seconds} s`;
  }
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest === 0 ? `${minutes} min` : `${minutes} min ${rest} s`;
}

/**
 * The crash-loop incident's first sentence (M103). Since M90 the message ends with the catalogue's
 * operator action; it no longer sounds as if nothing happens without an operator when a playable item
 * is there and the reset is only waiting out its backoff.
 */
export function describeCrashLoopHold(input: {
  playableSelected: boolean;
  plan: RestartBackoffPlan;
  resumeAtMs: number;
}): string {
  if (!input.playableSelected) {
    return "FFmpeg exited repeatedly, so automatic restarts are paused until a playable item is selected.";
  }
  const backoff = describeRestartBackoff(input.plan, input.resumeAtMs);
  return backoff === ""
    ? "FFmpeg exited repeatedly. A playable item is selected, so playout restarts by itself now."
    : `FFmpeg exited repeatedly. A playable item is selected, so playout restarts by itself. ${backoff}`;
}
