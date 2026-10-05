/**
 * The uplink watchdog's restarts per output profile: M103's backoff (H7) as corrected by the review of
 * 2026-10-05 (findings R4 and R35, fixed in M105).
 *
 * M103 held every watchdog restart after the first of a streak: the profile's process was stopped and
 * not started again before its pause was over. That is right for a fault that is dark already, and wrong
 * for two others.
 *
 * - A discontinuity storm (R4) is a picture still on air: the process keeps encoding and delivering, with
 *   audio and video drifting apart. Stopping it for the pause turned a reconnect of a few seconds into
 *   15 s to 5 min of dark air, long enough for Twitch to end the broadcast. Now the restart waits, not the
 *   air: the process keeps running until its pause has passed and is restarted then, stopped and started
 *   in the same cycle, if it still storms. A storm that ends meanwhile costs no restart.
 * - The channel's own network outage (R35). The DUT loses its way out once a night (about 00:02 UTC, 220 s
 *   on 2026-10-02). Production logs an encoder-stall restart about 47 s after the uplink's "I/O error" and
 *   a destination-stall restart about 20 s later; under M103 the second was restart 2 of a streak and held
 *   the profile 15 s, and a longer blip built the hold up until the uplink could stay stopped after the
 *   network was back. A restart of a dark fault (never encoded, `out_time` frozen, every destination in
 *   error) while the outage check finds every publish host unreachable, now or at any time since the
 *   fault began, is the network's: it restarts at once as before M103, is not counted and sets no hold.
 *   Once the check finds a publish host again after an outage it saw, every hold ends and every streak
 *   starts over. In uplink mode a destination goes back to "ready" only when the uplink starts it, so a
 *   reachable publish host is the first sign that the destinations can take the stream again.
 *
 * Unchanged from M103: a dark fault on a working network holds the profile for its pause. A hold also
 * ends when the profile's output changes (the operator entered another stream key or address, or other
 * destinations): that start is not a repeat of the one that set the hold.
 *
 * Pure, the clock passed in, so the sequences are tested (tests/unit/uplink-watchdog.test.ts); the worker
 * asks the outage check and acts on the decisions (index.ts, runUplinkCycle).
 */

import {
  RESTART_BACKOFF_QUIET_MS,
  RestartBackoff,
  describeRestartBackoff,
  type RestartBackoffPlan
} from "./restart-backoff.js";

export type UplinkWatchdogFault = "never-encoded" | "storm" | "encoder-stall" | "destination-stall";

export type UplinkWatchdogDecision =
  | {
      /** Stop the running process; it starts again in this cycle unless `holdUntilMs` lies ahead. */
      action: "restart";
      holdUntilMs: number;
      /** False for a restart the channel's network outage caused: it is not part of any streak. */
      counted: boolean;
      plan: RestartBackoffPlan;
      /** The sentence the restart incident appends; "" when there is nothing to add. */
      note: string;
    }
  | {
      /** A storm whose restart waits out its pause: the process stays on air. */
      action: "keep";
      notBeforeMs: number;
      plan: RestartBackoffPlan;
      /** True on the cycle that began the wait, so it is logged and reported once. */
      first: boolean;
      note: string;
    };

export type UplinkNetworkObservation = "down" | "up" | "back" | "unknown";

export const UPLINK_HOLD_OPERATOR_HINT =
  "Changing this output's destinations or stream key under Studio → Output → Output destinations, or restarting the uplink container, ends the wait.";

export function describeUplinkHold(plan: RestartBackoffPlan, resumeAtMs: number): string {
  const backoff = describeRestartBackoff(plan, resumeAtMs);
  return backoff === "" ? "" : `${backoff} ${UPLINK_HOLD_OPERATOR_HINT}`;
}

export function describeStormWait(plan: RestartBackoffPlan, notBeforeMs: number): string {
  const at = new Date(notBeforeMs).toISOString().slice(0, 19).replace("T", " ");
  return `This would be restart ${plan.attempt} in a row, so the uplink stays on air with this picture and is restarted at ${at} UTC if the storm lasts; each further repeat waits longer, up to 5 min.`;
}

export const UPLINK_NETWORK_OUTAGE_NOTE =
  "The channel's own network was down meanwhile (no publish host could be reached), so this restart does not count toward the restart backoff and the uplink starts again at once.";

export class UplinkWatchdog {
  private readonly backoffs = new Map<string, RestartBackoff>();
  private readonly holds = new Map<string, { untilMs: number; output: string }>();
  private readonly stormWaits = new Map<string, { notBeforeMs: number; plan: RestartBackoffPlan }>();
  private outageSeenAtMs = Number.NaN;
  private outageOpen = false;

  constructor(private readonly quietMs: number = RESTART_BACKOFF_QUIET_MS) {}

  /**
   * What the network outage check said. "back": an outage this watchdog saw is over, so every hold and
   * every streak has ended. A check that failed is no evidence either way and changes nothing.
   */
  observeNetwork(verdict: { outage: boolean; checkFailed?: boolean }, nowMs: number): UplinkNetworkObservation {
    if (verdict.checkFailed) {
      return "unknown";
    }
    if (verdict.outage) {
      this.outageSeenAtMs = nowMs;
      this.outageOpen = true;
      return "down";
    }
    if (!this.outageOpen) {
      return "up";
    }
    this.outageOpen = false;
    this.backoffs.clear();
    this.holds.clear();
    this.stormWaits.clear();
    return "back";
  }

  /** An outage was seen and not yet seen over: the check has to be asked until it is. */
  get networkOutageOpen(): boolean {
    return this.outageOpen;
  }

  /**
   * The watchdog found `fault` on the profile `key`. `troubleSinceMs` is when the fault began (the
   * process's start for never encoded, the last advance of `out_time`, the first destination error);
   * `output` identifies the profile's output as configured now.
   */
  decide(input: {
    key: string;
    fault: UplinkWatchdogFault;
    nowMs: number;
    troubleSinceMs: number;
    output: string;
  }): UplinkWatchdogDecision {
    const { key, nowMs } = input;
    const backoff = this.backoffOf(key);
    if (input.fault === "storm") {
      return this.decideStorm(key, backoff, nowMs);
    }
    // A dark fault stops the process; a storm wait for it is moot.
    this.stormWaits.delete(key);
    const outageDuringFault =
      this.outageOpen || (Number.isFinite(this.outageSeenAtMs) && this.outageSeenAtMs >= input.troubleSinceMs);
    if (outageDuringFault) {
      this.holds.delete(key);
      return {
        action: "restart",
        holdUntilMs: 0,
        counted: false,
        plan: { delayMs: 0, attempt: 0 },
        note: UPLINK_NETWORK_OUTAGE_NOTE
      };
    }
    const plan = backoff.plan(nowMs);
    const resumeAtMs = nowMs + plan.delayMs;
    backoff.recordRestart(resumeAtMs);
    if (plan.delayMs > 0) {
      this.holds.set(key, { untilMs: resumeAtMs, output: input.output });
    } else {
      this.holds.delete(key);
    }
    return {
      action: "restart",
      holdUntilMs: plan.delayMs > 0 ? resumeAtMs : 0,
      counted: true,
      plan,
      note: describeUplinkHold(plan, resumeAtMs)
    };
  }

  /** The profile's running process does not storm (any more): a storm restart it waited for is dropped. */
  stormOver(key: string): void {
    this.stormWaits.delete(key);
  }

  /**
   * Whether the profile waits out a hold at `nowMs`: the instant it ends, or 0. A hold whose output has
   * changed since it was set ends now, and the profile's streak with it (`outputChanged`).
   */
  holdOf(key: string, nowMs: number, output: string): { untilMs: number; outputChanged: boolean } {
    const hold = this.holds.get(key);
    if (!hold) {
      return { untilMs: 0, outputChanged: false };
    }
    if (hold.output !== output) {
      this.holds.delete(key);
      this.backoffs.delete(key);
      return { untilMs: 0, outputChanged: true };
    }
    if (nowMs >= hold.untilMs) {
      this.holds.delete(key);
      return { untilMs: 0, outputChanged: false };
    }
    return { untilMs: hold.untilMs, outputChanged: false };
  }

  /** Any profile waiting out a hold at `nowMs`. */
  hasHolds(nowMs: number): boolean {
    return [...this.holds.values()].some((hold) => nowMs < hold.untilMs);
  }

  private decideStorm(key: string, backoff: RestartBackoff, nowMs: number): UplinkWatchdogDecision {
    const waiting = this.stormWaits.get(key);
    if (waiting && nowMs < waiting.notBeforeMs) {
      return { action: "keep", notBeforeMs: waiting.notBeforeMs, plan: waiting.plan, first: false, note: "" };
    }
    if (waiting) {
      this.stormWaits.delete(key);
      backoff.recordRestart(nowMs);
      return { action: "restart", holdUntilMs: 0, counted: true, plan: waiting.plan, note: "" };
    }
    const plan = backoff.plan(nowMs);
    if (plan.delayMs <= 0) {
      backoff.recordRestart(nowMs);
      return { action: "restart", holdUntilMs: 0, counted: true, plan, note: "" };
    }
    const notBeforeMs = nowMs + plan.delayMs;
    this.stormWaits.set(key, { notBeforeMs, plan });
    return { action: "keep", notBeforeMs, plan, first: true, note: describeStormWait(plan, notBeforeMs) };
  }

  private backoffOf(key: string): RestartBackoff {
    let backoff = this.backoffs.get(key);
    if (!backoff) {
      backoff = new RestartBackoff(this.quietMs);
      this.backoffs.set(key, backoff);
    }
    return backoff;
  }
}
