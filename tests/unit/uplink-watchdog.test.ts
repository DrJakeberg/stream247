import { describe, expect, it } from "vitest";
import { RestartBackoff } from "../../apps/worker/src/restart-backoff";
import {
  UPLINK_HOLD_OPERATOR_HINT,
  UPLINK_NETWORK_OUTAGE_NOTE,
  UplinkWatchdog,
  type UplinkWatchdogFault
} from "../../apps/worker/src/uplink-watchdog";

// The nightly blip on the DUT: about 00:02 UTC, 220 s on 2026-10-02.
const T0 = Date.UTC(2026, 9, 2, 0, 2, 0);
const at = (seconds: number) => T0 + seconds * 1000;
const UP = { outage: false };
const DOWN = { outage: true };
const OUTPUT = "sha256-of-the-twitch-output";

type DarkFault = Exclude<UplinkWatchdogFault, "storm">;

/** The two rules for a dark-fault restart: M103 as merged, and the watchdog since M105. */
type RestartRule = {
  observe(outage: boolean, nowMs: number): void;
  restart(fault: DarkFault, nowMs: number, troubleSinceMs: number): { holdUntilMs: number; counted: boolean };
  heldUntil(nowMs: number): number;
};

function m103Rule(): RestartRule {
  // index.ts before M105: planUplinkWatchdogRestart, the network not asked.
  const backoff = new RestartBackoff();
  let holdUntilMs = 0;
  return {
    observe: () => undefined,
    restart(_fault, nowMs) {
      const plan = backoff.plan(nowMs);
      backoff.recordRestart(nowMs + plan.delayMs);
      holdUntilMs = plan.delayMs > 0 ? nowMs + plan.delayMs : 0;
      return { holdUntilMs, counted: true };
    },
    heldUntil: (nowMs) => (nowMs < holdUntilMs ? holdUntilMs : 0)
  };
}

function m105Rule(): RestartRule {
  const watchdog = new UplinkWatchdog();
  return {
    observe: (outage, nowMs) => void watchdog.observeNetwork({ outage }, nowMs),
    restart(fault, nowMs, troubleSinceMs) {
      const decision = watchdog.decide({ key: "720p", fault, nowMs, troubleSinceMs, output: OUTPUT });
      if (decision.action !== "restart") {
        throw new Error("a dark fault always restarts");
      }
      return { holdUntilMs: decision.holdUntilMs, counted: decision.counted };
    },
    heldUntil: (nowMs) => watchdog.holdOf("720p", nowMs, OUTPUT).untilMs
  };
}

/**
 * The uplink cycle every 15 s through a network outage, as production shows it: a process that cannot
 * reach Twitch errs a second after its start and its `out_time` stands still (the fifo queue fills); the
 * encoder-stall restart fires 45 s after the last advance, the destination-stall restart 60 s after the
 * first cycle that saw every destination in error, and an encoder-stall restart does not reset that
 * timer. Back on the network the fifo reconnects by itself, but the destination's status stays "error"
 * until the uplink starts it again (index.ts, startUplink), so the stall timer runs on. The outage check
 * runs as in runUplinkCycle: while a destination is in error, a hold is set or an outage is open.
 */
function simulateOutage(rule: RestartRule, outageFromS: number, outageUntilS: number, untilS: number) {
  const networkDown = (seconds: number) => seconds >= outageFromS && seconds < outageUntilS;
  let running = true;
  let lastAdvanceS = 0;
  let destinationError = false;
  let stallStartedS: number | null = null;
  const restarts: Array<{ atS: number; fault: DarkFault; counted: boolean; holdS: number }> = [];
  let backOnAirS: number | null = null;
  for (let seconds = 10; seconds <= untilS; seconds += 15) {
    const now = at(seconds);
    if (running && networkDown(seconds)) {
      destinationError = true;
    } else if (running) {
      lastAdvanceS = seconds;
    }
    rule.observe(networkDown(seconds), now);
    let restarted: DarkFault | null = null;
    let troubleSinceS = 0;
    if (running && networkDown(seconds) && seconds - lastAdvanceS >= 45) {
      restarted = "encoder-stall";
      troubleSinceS = lastAdvanceS;
    } else if (running && destinationError) {
      stallStartedS = stallStartedS ?? seconds;
      if (seconds - stallStartedS >= 60) {
        restarted = "destination-stall";
        troubleSinceS = stallStartedS;
        stallStartedS = null;
      }
    } else {
      stallStartedS = null;
    }
    if (restarted) {
      const decision = rule.restart(restarted, now, at(troubleSinceS));
      restarts.push({
        atS: seconds,
        fault: restarted,
        counted: decision.counted,
        holdS: decision.holdUntilMs > 0 ? (decision.holdUntilMs - now) / 1000 : 0
      });
      running = false;
    }
    if (!running && rule.heldUntil(now) === 0) {
      running = true;
      lastAdvanceS = seconds;
      destinationError = false;
    }
    if (backOnAirS === null && seconds >= outageUntilS && running) {
      backOnAirS = seconds;
    }
  }
  return { restarts, backOnAirS };
}

describe("the uplink watchdog and the channel's network outage (R35)", () => {
  it("held the uplink off air after the 220 s blip under M103, and is back with the network now", () => {
    const before = simulateOutage(m103Rule(), 0, 220, 900);
    expect(before.restarts.map((restart) => restart.holdS)).toEqual([0, 15, 30, 60]);
    // The network was back at 220 s; the profile waited out its 60 s hold until 265 s.
    expect(before.backOnAirS).toBe(265);

    const now = simulateOutage(m105Rule(), 0, 220, 900);
    expect(now.restarts.length).toBeGreaterThanOrEqual(4);
    expect(now.restarts.every((restart) => !restart.counted && restart.holdS === 0)).toBe(true);
    // The restart at 220 s is the stale destination stall after the fifo reconnected: still a restart, as
    // in 2.1, but neither counted nor held.
    expect(now.restarts.at(-1)).toMatchObject({ atS: 220, fault: "destination-stall", counted: false });
    expect(now.backOnAirS).toBe(220);
  });

  it("counts nothing of the outage, so the next fault on a working network restarts at once", () => {
    const watchdog = new UplinkWatchdog();
    watchdog.observeNetwork(DOWN, at(15));
    for (const seconds of [55, 70, 115, 145]) {
      const decision = watchdog.decide({
        key: "720p",
        fault: "encoder-stall",
        nowMs: at(seconds),
        troubleSinceMs: at(seconds - 45),
        output: OUTPUT
      });
      expect(decision).toMatchObject({ action: "restart", counted: false, holdUntilMs: 0, note: UPLINK_NETWORK_OUTAGE_NOTE });
    }
    expect(watchdog.observeNetwork(UP, at(225))).toBe("back");
    const later = watchdog.decide({
      key: "720p",
      fault: "encoder-stall",
      nowMs: at(400),
      troubleSinceMs: at(355),
      output: OUTPUT
    });
    expect(later).toMatchObject({ action: "restart", counted: true, holdUntilMs: 0, plan: { attempt: 1 } });
  });

  it("ends a hold and its streak once the network is back after an outage it saw", () => {
    const watchdog = new UplinkWatchdog();
    // Three restarts on a network the check found up: the third holds 30 s.
    for (const seconds of [0, 60, 120]) {
      watchdog.observeNetwork(UP, at(seconds));
      watchdog.decide({ key: "720p", fault: "never-encoded", nowMs: at(seconds), troubleSinceMs: at(seconds - 90), output: OUTPUT });
    }
    expect(watchdog.holdOf("720p", at(130), OUTPUT).untilMs).toBe(at(150));
    expect(watchdog.observeNetwork(DOWN, at(131))).toBe("down");
    expect(watchdog.holdOf("720p", at(135), OUTPUT).untilMs).toBe(at(150));
    expect(watchdog.observeNetwork(UP, at(140))).toBe("back");
    expect(watchdog.hasHolds(at(140))).toBe(false);
    expect(watchdog.holdOf("720p", at(140), OUTPUT).untilMs).toBe(0);
    expect(watchdog.observeNetwork(UP, at(150))).toBe("up");
  });

  it("keeps M103 on a working network, and an outage before the fault began does not excuse it", () => {
    const watchdog = new UplinkWatchdog();
    watchdog.observeNetwork(DOWN, at(0));
    expect(watchdog.observeNetwork(UP, at(30))).toBe("back");
    const holds = [100, 200, 300].map((seconds) => {
      const decision = watchdog.decide({
        key: "720p",
        fault: "destination-stall",
        nowMs: at(seconds),
        troubleSinceMs: at(seconds - 60),
        output: OUTPUT
      });
      expect(decision.action === "restart" && decision.counted).toBe(true);
      return decision.action === "restart" && decision.holdUntilMs > 0 ? (decision.holdUntilMs - at(seconds)) / 1000 : 0;
    });
    expect(holds).toEqual([0, 15, 30]);
  });

  it("changes nothing when the check itself failed", () => {
    const watchdog = new UplinkWatchdog();
    expect(watchdog.observeNetwork({ outage: false, checkFailed: true }, at(0))).toBe("unknown");
    watchdog.decide({ key: "720p", fault: "encoder-stall", nowMs: at(0), troubleSinceMs: at(-45), output: OUTPUT });
    const second = watchdog.decide({ key: "720p", fault: "encoder-stall", nowMs: at(60), troubleSinceMs: at(15), output: OUTPUT });
    expect(second).toMatchObject({ action: "restart", counted: true, holdUntilMs: at(75) });
    expect(second.note).toContain(UPLINK_HOLD_OPERATOR_HINT);
  });

  it("ends a hold and its streak when the operator changed the profile's output", () => {
    const watchdog = new UplinkWatchdog();
    watchdog.decide({ key: "720p", fault: "destination-stall", nowMs: at(0), troubleSinceMs: at(-60), output: OUTPUT });
    watchdog.decide({ key: "720p", fault: "destination-stall", nowMs: at(80), troubleSinceMs: at(20), output: OUTPUT });
    expect(watchdog.holdOf("720p", at(85), OUTPUT)).toEqual({ untilMs: at(95), outputChanged: false });
    expect(watchdog.holdOf("720p", at(86), "sha256-with-the-new-stream-key")).toEqual({ untilMs: 0, outputChanged: true });
    const next = watchdog.decide({ key: "720p", fault: "destination-stall", nowMs: at(200), troubleSinceMs: at(140), output: "sha256-with-the-new-stream-key" });
    expect(next).toMatchObject({ counted: true, holdUntilMs: 0, plan: { attempt: 1 } });
  });
});

describe("a discontinuity storm stays on air while its restart backs off (R4)", () => {
  it("storm, storm again two minutes later: the process keeps running until the pause is over", () => {
    const watchdog = new UplinkWatchdog();
    const storm = (seconds: number) =>
      watchdog.decide({ key: "720p", fault: "storm", nowMs: at(seconds), troubleSinceMs: at(seconds), output: OUTPUT });

    expect(storm(0)).toMatchObject({ action: "restart", holdUntilMs: 0, plan: { attempt: 1 } });
    const again = storm(120);
    expect(again).toMatchObject({ action: "keep", notBeforeMs: at(135), first: true, plan: { attempt: 2 } });
    expect(again.note).toContain("stays on air with this picture and is restarted at 2026-10-02 00:04:15 UTC");
    // The next cycle the storm lasts: still on air, reported once.
    expect(storm(130)).toMatchObject({ action: "keep", first: false });
    // At the end of the pause it still storms: restarted then, and started again in the same cycle.
    expect(storm(135)).toMatchObject({ action: "restart", holdUntilMs: 0, counted: true, plan: { attempt: 2 } });
    expect(watchdog.hasHolds(at(135))).toBe(false);
    expect(watchdog.holdOf("720p", at(135), OUTPUT).untilMs).toBe(0);
  });

  it("costs no restart when the storm ends during the pause", () => {
    const watchdog = new UplinkWatchdog();
    const storm = (seconds: number) =>
      watchdog.decide({ key: "720p", fault: "storm", nowMs: at(seconds), troubleSinceMs: at(seconds), output: OUTPUT });
    storm(0);
    storm(60);
    expect(storm(70)).toMatchObject({ action: "keep", notBeforeMs: at(75) });
    watchdog.stormOver("720p");
    // A later storm starts its own wait, at the streak's position (restart 2 again: none happened).
    expect(storm(200)).toMatchObject({ action: "keep", notBeforeMs: at(215), first: true, plan: { attempt: 2 } });
  });

  it("never holds a storming profile stopped, while a dark fault on the same profile still does", () => {
    const watchdog = new UplinkWatchdog();
    for (const seconds of [0, 20, 40, 60]) {
      watchdog.decide({ key: "720p", fault: "storm", nowMs: at(seconds), troubleSinceMs: at(seconds), output: OUTPUT });
      expect(watchdog.hasHolds(at(seconds))).toBe(false);
    }
    const stall = watchdog.decide({ key: "720p", fault: "encoder-stall", nowMs: at(100), troubleSinceMs: at(55), output: OUTPUT });
    expect(stall).toMatchObject({ action: "restart", counted: true });
    expect(stall.action === "restart" && stall.holdUntilMs).toBeGreaterThan(at(100));
  });
});
