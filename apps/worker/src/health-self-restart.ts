// A process that fails its own healthcheck for five minutes exits (M103, H8, owner Q7).
//
// Compose restarts a container when it exits, never because its healthcheck says "unhealthy", and
// there is no autoheal: a worker or uplink whose loop kept running but stopped proving it was alive
// stayed that way until someone restarted it by hand. Each process now asks the same question its
// container healthcheck asks (`decideHealthcheck`) after every cycle, and exits once the answer has
// been "unhealthy" for `HEALTH_SELF_RESTART_AFTER_MS` in a row, so the restart policy brings up a
// fresh one. No new dependency and no Docker socket.
//
// What never counts, because a restart cannot change it or would cut a playing channel:
// - a playout whose programme still advances (owner Q7: playout restarts only when its feed stalls).
//   In HLS mode that is a fresh feed on disk; without the HLS feed there is nothing to measure, so a
//   running playout ffmpeg counts as advancing and only a playout with no ffmpeg can restart itself;
// - a deliberate hold: crash-loop protection, an uplink waiting out its restart backoff (H7), an
//   uplink with no destination configured. The process is doing what it was told;
// - the uplink's "Program feed is failed": the feed is the playout's, restarting its reader does not
//   repair it;
// - a reading that could not be taken (the database is gone): the database outage rule (M86) owns
//   that case, and this streak starts again from zero.

import { PROGRAM_FEED_FAILED_HEALTHCHECK_MESSAGE, type HealthcheckMode } from "./healthcheck.js";

export const HEALTH_SELF_RESTART_AFTER_MS = 5 * 60_000;

export type SelfHealthInput = {
  mode: HealthcheckMode;
  /** `decideHealthcheck`'s verdict: an error message, or null when healthy. */
  failure: string | null;
  /** Why this process is deliberately not producing right now; "" when it is not holding. */
  deliberateHold: string;
  /** Playout only: the programme still advances (see the note above). Ignored for the other modes. */
  feedAdvancing: boolean;
};

/** The healthcheck failure that counts towards a self-restart, or null when none does. */
export function selfRestartReason(input: SelfHealthInput): string | null {
  if (input.failure === null || input.deliberateHold !== "") {
    return null;
  }
  if (input.mode === "playout" && input.feedAdvancing) {
    return null;
  }
  if (input.mode === "uplink" && input.failure === PROGRAM_FEED_FAILED_HEALTHCHECK_MESSAGE) {
    return null;
  }
  return input.failure;
}

export type SelfRestartVerdict = {
  /** How long the current streak of counting failures has lasted; 0 without one. */
  unhealthyForMs: number;
  /** The latest counting failure, "" without one. */
  reason: string;
  /** True once the streak has lasted the full bound: the process should exit. */
  exit: boolean;
};

export class HealthSelfRestartWatch {
  private unhealthySinceMs: number | null = null;

  constructor(private readonly exitAfterMs: number = HEALTH_SELF_RESTART_AFTER_MS) {}

  /** `reason` from `selfRestartReason`; null for a healthy reading. */
  observe(reason: string | null, nowMs: number): SelfRestartVerdict {
    if (reason === null) {
      this.unhealthySinceMs = null;
      return { unhealthyForMs: 0, reason: "", exit: false };
    }
    if (this.unhealthySinceMs === null || nowMs < this.unhealthySinceMs) {
      this.unhealthySinceMs = nowMs;
    }
    const unhealthyForMs = nowMs - this.unhealthySinceMs;
    return { unhealthyForMs, reason, exit: unhealthyForMs >= this.exitAfterMs };
  }

  /** The reading could not be taken; the streak starts again with the next counting failure. */
  observeUnknown(): void {
    this.unhealthySinceMs = null;
  }
}
