/**
 * The uplink watchdog's restarts per output profile: M103's backoff (H7) as corrected by the review of
 * 2026-10-05 (findings R4 and R35, fixed in M105) and by the reconnect grace (M109).
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
 * - The channel's own network outage (R35). A restart of a dark fault (never encoded, `out_time` frozen,
 *   every destination in error) while the outage check finds every publish host unreachable, now or at any
 *   time since the fault began, is the network's: it restarts at once as before M103, is not counted and
 *   sets no hold. Once the check finds a publish host again after an outage it saw, every hold ends and
 *   every streak starts over. In uplink mode a destination goes back to "ready" only when the uplink starts
 *   it, so a reachable publish host is the first sign that the destinations can take the stream again.
 *   R35 assumed that the DUT's nightly blip (about 00:02 UTC) is such an outage. It is not: the blip is a
 *   forced reconnect of the internet line (a hash of the public IP differed between 23:56:51 and 00:08:26
 *   UTC on 2026-10-13). Every open TCP connection in the home network dies at that second, the RTMP
 *   uplink's too, and the line is back within seconds: on 2026-10-02 live.twitch.tv:1935 answered TCP from
 *   the playout container in every sample of the blip, and in seven nights under v2.3.0-rc.1 (2026-10-07
 *   to 2026-10-13) `uplink.watchdog.network_outage` never appeared, so the blip's restarts counted. R35
 *   stays for a real outage.
 * - The reconnect after a dropped connection (M109). In six of those nights the blip cost one encoder-stall
 *   restart (about 45 to 60 s dark). On 2026-10-09 Twitch refused every new publish (ffmpeg: "Error opening
 *   rtmp://live.twitch.tv/app/…: I/O error") for 3 min 14 s after the first destination failure while its
 *   host answered TCP; the restarts of the processes started meanwhile were restarts 2 and 3 of a streak,
 *   held 15 s and 30 s, about 45 s more dark air. Now a dark fault of a profile that had been on air (its
 *   process had encoded and run for `RESTART_BACKOFF_QUIET_MS` before the fault began, so no streak was
 *   running and M103 would make this restart the first of a new one anyway) begins a grace episode of
 *   `UPLINK_RECONNECT_GRACE_MS` from the fault's beginning. Every dark-fault restart of that profile inside
 *   the episode, of the processes started during it that never delivered as well, restarts at once, is not
 *   counted and sets no hold. After the episode M103 applies unchanged, its streak counting from the first
 *   counted restart. A profile that never delivered (a wrong stream key from the start, a new output) gets
 *   no grace, and an output changed during the episode ends it: the new output never delivered, and its
 *   restarts count from a new streak (v2.3.0-rc.1 went on with the streak of the restarts before the
 *   change unless a hold was running then). An episode also begins under R35, but `network_back` does not
 *   lengthen it: the reconnect after a real outage is covered only within the episode, and M103 decides
 *   the restarts after it.
 *
 * Unchanged from M103: a dark fault on a working network outside a grace episode holds the profile for its
 * pause. A hold also ends when the profile's output changes (the operator entered another stream key or
 * address, or other destinations): that start is not a repeat of the one that set the hold.
 *
 * Pure, the clock passed in, so the sequences are tested (tests/unit/uplink-watchdog.test.ts); the worker
 * asks the outage check, says since when the running process was on air, and acts on the decisions
 * (index.ts, planUplinkDarkRestart and runUplinkCycle).
 */

import {
  RESTART_BACKOFF_QUIET_MS,
  RestartBackoff,
  describeRestartBackoff,
  type RestartBackoffPlan
} from "./restart-backoff.js";

export type UplinkWatchdogFault = "never-encoded" | "storm" | "encoder-stall" | "destination-stall";

/**
 * How long a reconnect grace episode lasts from the beginning of the dark fault that began it (M109).
 *
 * The measured worst case: on 2026-10-09 Twitch refused every new publish from the first destination
 * failure at 00:02:18 UTC until the process started at 00:05:32 UTC stayed on air, 3 min 14 s, while its
 * host answered TCP. Five minutes covers that with 1 min 46 s of margin, and it is no longer than the
 * longest single hold M103 sets (`RESTART_BACKOFF_MAX_MS`): the grace never restarts at once for longer
 * than one hold of M103 keeps a profile dark. In five minutes of such a refusal M103 builds holds of 15 s,
 * 30 s and 1 min, dark air that only delays the reconnect the far end is waiting for.
 *
 * Bound. The uplink cycle restarts a profile at most once per cycle, and cycles are at least 15 s apart
 * (index.ts, runLoop), so an episode holds at most 20 uncounted restarts. With the default thresholds the
 * first restart comes at least 45 s after the fault began (the encoder-stall threshold), and a process
 * started inside the episode is restarted at the earliest 60 s after its start (the encoder-stall grace,
 * the destination-stall threshold), except that a destination-stall restart can follow an encoder-stall
 * restart by one cycle because its timer survives that restart: at most 8 per episode. A new episode needs
 * the profile on air for `RESTART_BACKOFF_QUIET_MS` without a restart, so episodes begin at least 10 min
 * apart: at most 6 an hour, so at most 48 uncounted restarts an hour with the default thresholds (120 with
 * any), and only on a line that comes back for ten minutes between faults, where M103 makes each fault's
 * first restart immediate anyway. A refusal that lasts an hour gets one episode: at most 8 uncounted
 * restarts, all in its first five minutes, and M103's holds from then on (tests/unit/uplink-watchdog.test.ts).
 * The DUT's seven nights show one to three.
 */
export const UPLINK_RECONNECT_GRACE_MS = 5 * 60_000;

/** Why a restart does not count toward the backoff. */
export type UplinkUncountedRestart =
  | { by: "network-outage" }
  | {
      by: "reconnect-grace";
      /** Since the beginning of the fault that began the grace episode. */
      faultAgeMs: number;
    };

export type UplinkWatchdogDecision =
  | {
      /** Stop the running process; it starts again in this cycle unless `holdUntilMs` lies ahead. */
      action: "restart";
      holdUntilMs: number;
      /**
       * False for a restart the channel's network outage (R35) or a reconnect grace episode (M109) covers:
       * it is not part of any streak.
       */
      counted: boolean;
      /** Why it is not counted; null when it is. */
      uncounted: UplinkUncountedRestart | null;
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

/**
 * The restart incident's sentence for a restart in a reconnect grace episode (M109), from the episode's
 * beginning and end. In absolute UTC: the incident keeps this message until its next upsert, and an
 * operator who reads it hours after the blip must not be told an age (M90, U10).
 */
export function describeReconnectGrace(sinceMs: number, untilMs: number): string {
  const utc = (ms: number) => new Date(ms).toISOString().slice(0, 19).replace("T", " ");
  return `This output had been on air for at least 10 min when its stream stopped at ${utc(sinceMs)} UTC, and after a dropped connection a destination can refuse a new one for a few minutes, so its restarts until ${utc(untilMs)} UTC do not count toward the restart backoff and the uplink starts again at once.`;
}

/**
 * The line a dark-fault restart logs besides the restart's own (index.ts, planUplinkDarkRestart): why it
 * is not counted, or the hold it sets; null for a counted restart that starts at once.
 */
export function uplinkDarkRestartLogLine(
  decision: UplinkWatchdogDecision,
  context: { outputProfile: string; fault: Exclude<UplinkWatchdogFault, "storm"> }
): { event: string; fields: Record<string, unknown> } | null {
  if (decision.action !== "restart") {
    return null;
  }
  const { outputProfile, fault } = context;
  if (decision.uncounted?.by === "network-outage") {
    return { event: "uplink.watchdog.network_outage.uncounted", fields: { outputProfile, fault } };
  }
  if (decision.uncounted?.by === "reconnect-grace") {
    return {
      event: "uplink.watchdog.reconnect_grace.uncounted",
      fields: { outputProfile, fault, faultAgeMs: decision.uncounted.faultAgeMs }
    };
  }
  if (decision.holdUntilMs > 0) {
    return {
      event: "uplink.watchdog.backoff",
      fields: { outputProfile, fault, attempt: decision.plan.attempt, backoffMs: decision.plan.delayMs }
    };
  }
  return null;
}

export class UplinkWatchdog {
  private readonly backoffs = new Map<string, RestartBackoff>();
  private readonly holds = new Map<string, { untilMs: number; output: string }>();
  private readonly stormWaits = new Map<string, { notBeforeMs: number; plan: RestartBackoffPlan }>();
  /** The reconnect grace episode of each profile (M109): from the fault's beginning until `untilMs`. */
  private readonly graceEpisodes = new Map<string, { sinceMs: number; untilMs: number; output: string }>();
  /** When the watchdog last restarted each profile, counted or not. */
  private readonly lastRestartAtMs = new Map<string, number>();
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
   * `output` identifies the profile's output as configured now. `onAirSinceMs` is since when the running
   * process was on air: its start once it has encoded, absent or NaN while it never has (M109).
   */
  decide(input: {
    key: string;
    fault: UplinkWatchdogFault;
    nowMs: number;
    troubleSinceMs: number;
    output: string;
    onAirSinceMs?: number;
  }): UplinkWatchdogDecision {
    const { key, nowMs } = input;
    const backoff = this.backoffOf(key);
    if (input.fault === "storm") {
      return this.restarted(key, nowMs, this.decideStorm(key, backoff, nowMs));
    }
    // A dark fault stops the process; a storm wait for it is moot.
    this.stormWaits.delete(key);
    // Asked before the outage rule so that an episode begins even when R35 decides its first restart.
    const grace = this.reconnectGrace({ ...input, onAirSinceMs: input.onAirSinceMs ?? Number.NaN });
    const outageDuringFault =
      this.outageOpen || (Number.isFinite(this.outageSeenAtMs) && this.outageSeenAtMs >= input.troubleSinceMs);
    if (outageDuringFault) {
      this.holds.delete(key);
      return this.restarted(key, nowMs, {
        action: "restart",
        holdUntilMs: 0,
        counted: false,
        uncounted: { by: "network-outage" },
        plan: { delayMs: 0, attempt: 0 },
        note: UPLINK_NETWORK_OUTAGE_NOTE
      });
    }
    if (grace) {
      // No hold is set, and none is cleared: a running process has none left, and the grace does not
      // shorten one.
      return this.restarted(key, nowMs, {
        action: "restart",
        holdUntilMs: 0,
        counted: false,
        uncounted: { by: "reconnect-grace", faultAgeMs: nowMs - grace.sinceMs },
        plan: { delayMs: 0, attempt: 0 },
        note: describeReconnectGrace(grace.sinceMs, grace.untilMs)
      });
    }
    const plan = backoff.plan(nowMs);
    const resumeAtMs = nowMs + plan.delayMs;
    backoff.recordRestart(resumeAtMs);
    if (plan.delayMs > 0) {
      this.holds.set(key, { untilMs: resumeAtMs, output: input.output });
    } else {
      this.holds.delete(key);
    }
    return this.restarted(key, nowMs, {
      action: "restart",
      holdUntilMs: plan.delayMs > 0 ? resumeAtMs : 0,
      counted: true,
      uncounted: null,
      plan,
      note: describeUplinkHold(plan, resumeAtMs)
    });
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
      return { action: "restart", holdUntilMs: 0, counted: true, uncounted: null, plan: waiting.plan, note: "" };
    }
    const plan = backoff.plan(nowMs);
    if (plan.delayMs <= 0) {
      backoff.recordRestart(nowMs);
      return { action: "restart", holdUntilMs: 0, counted: true, uncounted: null, plan, note: "" };
    }
    const notBeforeMs = nowMs + plan.delayMs;
    this.stormWaits.set(key, { notBeforeMs, plan });
    return { action: "keep", notBeforeMs, plan, first: true, note: describeStormWait(plan, notBeforeMs) };
  }

  /**
   * The reconnect grace episode this dark fault falls in (M109), begun by it when the profile had been on
   * air; null when there is none. The episode is tied to the output that had been on air: a fault of
   * another output (the operator changed the stream key, the address or the destinations) ends it.
   */
  private reconnectGrace(input: {
    key: string;
    nowMs: number;
    troubleSinceMs: number;
    output: string;
    onAirSinceMs: number;
  }): { sinceMs: number; untilMs: number } | null {
    const { key, nowMs } = input;
    const open = this.graceEpisodes.get(key);
    if (open && nowMs < open.untilMs && open.output === input.output) {
      return open;
    }
    this.graceEpisodes.delete(key);
    // On air for the quiet time before the fault began, with no restart of the profile in that time: no
    // streak was running, and the fault is the connection breaking, not a start that never took.
    const onAirMs = input.troubleSinceMs - input.onAirSinceMs;
    const lastRestartAtMs = this.lastRestartAtMs.get(key) ?? Number.NEGATIVE_INFINITY;
    if (!(onAirMs >= this.quietMs) || input.troubleSinceMs - lastRestartAtMs < this.quietMs) {
      return null;
    }
    const untilMs = input.troubleSinceMs + UPLINK_RECONNECT_GRACE_MS;
    if (nowMs >= untilMs) {
      return null;
    }
    const episode = { sinceMs: input.troubleSinceMs, untilMs, output: input.output };
    this.graceEpisodes.set(key, episode);
    return episode;
  }

  /** Records a restart decision's instant: the moment the profile starts again. */
  private restarted(key: string, nowMs: number, decision: UplinkWatchdogDecision): UplinkWatchdogDecision {
    if (decision.action === "restart") {
      this.lastRestartAtMs.set(key, Math.max(nowMs, decision.holdUntilMs));
    }
    return decision;
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
