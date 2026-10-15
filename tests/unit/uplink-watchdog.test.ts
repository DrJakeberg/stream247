import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  RESTART_BACKOFF_MAX_MS,
  RESTART_BACKOFF_QUIET_MS,
  RestartBackoff,
  restartBackoffDelayMs
} from "../../apps/worker/src/restart-backoff";
import {
  UPLINK_HOLD_OPERATOR_HINT,
  UPLINK_NETWORK_OUTAGE_NOTE,
  UPLINK_RECONNECT_GRACE_MS,
  UplinkWatchdog,
  describeReconnectGrace,
  uplinkDarkRestartLogLine,
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

// M109. The nightly blip is a forced reconnect of the DUT's internet line (2026-10-13: a hash of the public
// IP differed between 23:56:51 and 00:08:26 UTC); the line is back within seconds, but the far end can
// refuse the new publish for minutes while its host answers TCP, so R35's outage check says "up".
const utc = (stamp: string) => Date.parse(`${stamp}Z`);
const DAY_MS = 24 * 60 * 60_000;
const NEW_OUTPUT = "sha256-with-the-new-stream-key";

type GraceRestart = { counted: boolean; holdS: number; line: string; fields: Record<string, unknown>; note: string };

/** A dark-fault restart as planUplinkDarkRestart makes it: the decision, and the line the worker logs. */
function darkRestart(
  watchdog: UplinkWatchdog,
  input: { fault: DarkFault; nowMs: number; troubleSinceMs: number; onAirSinceMs?: number; output?: string }
): GraceRestart {
  const { fault, nowMs } = input;
  const decision = watchdog.decide({ key: "720p", output: OUTPUT, ...input });
  if (decision.action !== "restart") {
    throw new Error("a dark fault always restarts");
  }
  const line = uplinkDarkRestartLogLine(decision, { outputProfile: "720p", fault });
  return {
    counted: decision.counted,
    holdS: decision.holdUntilMs > 0 ? (decision.holdUntilMs - nowMs) / 1000 : 0,
    line: line?.event ?? "",
    fields: line?.fields ?? {},
    note: decision.note
  };
}

/**
 * The uplink log of seven nights under v2.3.0-rc.1 (lead, DUT, event names and times only). The restarts
 * are the measured ones; the fault an encoder-stall restart acts on began at its last `out_time` advance,
 * taken as the restart minus the 45 s stall threshold, and a destination-stall restart's at the first
 * cycle that saw every destination in error, taken as the restart minus the 60 s threshold unless the
 * timer survived an encoder-stall restart. The process that had been on air started at the reconnect of
 * the night before.
 * - Six normal nights: the first `destination.failure` between 00:02:05 and 00:02:56 UTC (2026-10-13:
 *   00:02:56), an encoder-stall restart 33 to 53 s later, on air 5 s after it. The lead's summary gives
 *   these nights as that range, not each night's second, so each is checked at both ends of it.
 * - 2026-10-09: `destination.failure` 00:02:18; `encoder_stall.restart` 00:03:11; process start 00:03:16;
 *   `destination_stall.restart` 00:03:31 with `uplink.watchdog.backoff` attempt 2, 15000 ms; start 00:03:46;
 *   `destination.failure` 00:03:47; `destination_stall.restart` 00:05:02 with attempt 3, 30000 ms; start
 *   00:05:32, on air. Every error: "Error opening rtmp://live.twitch.tv/app/…: I/O error".
 */
type NightRestart = { fault: DarkFault; at: string; troubleSince: string; onAirSince: string };

const iso = (ms: number) => new Date(ms).toISOString().slice(0, 19);

function normalNight(date: string, failure: string, stallAfterS: number, onAirSince: string): NightRestart[] {
  const restartMs = utc(`${date}T${failure}`) + stallAfterS * 1000;
  return [{ fault: "encoder-stall", at: iso(restartMs), troubleSince: iso(restartMs - 45_000), onAirSince }];
}

const OCTOBER_9: NightRestart[] = [
  { fault: "encoder-stall", at: "2026-10-09T00:03:11", troubleSince: "2026-10-09T00:02:26", onAirSince: "2026-10-08T00:03:00" },
  // The cycle at 00:02:26 was the first to see the destination in error; its timer survived the restart.
  { fault: "destination-stall", at: "2026-10-09T00:03:31", troubleSince: "2026-10-09T00:02:26", onAirSince: "2026-10-09T00:03:16" },
  { fault: "destination-stall", at: "2026-10-09T00:05:02", troubleSince: "2026-10-09T00:04:02", onAirSince: "2026-10-09T00:03:46" }
];

function week(failure: string, stallAfterS: number): Array<{ night: string; restarts: NightRestart[] }> {
  // On air since the restart of the 2026-10-06 blip at 00:02:37 (planning/archive/plans-m84-m109.md, M106),
  // the new process 5 s later.
  let onAirSince = "2026-10-06T00:02:42";
  return ["2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10", "2026-10-11", "2026-10-12", "2026-10-13"].map((night) => {
    const restarts =
      night === "2026-10-09" ? OCTOBER_9 : normalNight(night, night === "2026-10-13" ? "00:02:56" : failure, stallAfterS, onAirSince);
    onAirSince = night === "2026-10-09" ? "2026-10-09T00:05:32" : iso(utc(restarts[0].at) + 5_000);
    return { night, restarts };
  });
}

function replay(watchdog: UplinkWatchdog, restarts: NightRestart[], withOnAir = true): GraceRestart[] {
  return restarts.map((restart) =>
    darkRestart(watchdog, {
      fault: restart.fault,
      nowMs: utc(restart.at),
      troubleSinceMs: utc(restart.troubleSince),
      onAirSinceMs: withOnAir ? utc(restart.onAirSince) : undefined
    })
  );
}

describe("the uplink rides out the nightly reconnect (M109)", () => {
  it("grants five minutes, more than the 3 min 14 s refusal measured, no longer than M103's longest hold", () => {
    expect(UPLINK_RECONNECT_GRACE_MS).toBe(5 * 60_000);
    expect(UPLINK_RECONNECT_GRACE_MS).toBeGreaterThan(utc("2026-10-09T00:05:32") - utc("2026-10-09T00:02:18"));
    expect(UPLINK_RECONNECT_GRACE_MS).toBeLessThanOrEqual(RESTART_BACKOFF_MAX_MS);
  });

  for (const [failure, stallAfterS] of [
    ["00:02:05", 33],
    ["00:02:56", 53]
  ] as const) {
    it(`replays the seven nights of 2026-10-07..13 (normal nights: failure ${failure}, restart ${stallAfterS} s later)`, () => {
      // One watchdog through the week, as the uplink container ran it.
      const watchdog = new UplinkWatchdog();
      for (const { night, restarts } of week(failure, stallAfterS)) {
        const seen = replay(watchdog, restarts);
        expect(seen.map((restart) => restart.counted), night).toEqual(restarts.map(() => false));
        expect(seen.map((restart) => restart.holdS), night).toEqual(restarts.map(() => 0));
        expect(seen.map((restart) => restart.line), night).toEqual(restarts.map(() => "uplink.watchdog.reconnect_grace.uncounted"));
        // The incident's sentence names the night's episode in UTC, never an age (M90, U10).
        const since = utc(restarts[0].troubleSince);
        expect(seen.map((restart) => restart.note), night).toEqual(
          restarts.map(() => describeReconnectGrace(since, since + UPLINK_RECONNECT_GRACE_MS))
        );
        expect(seen.every((restart) => !/\bago\b|\bin \d/.test(restart.note)), night).toBe(true);
      }
    });
  }

  it("rides out 2026-10-09 with three uncounted restarts, no hold and no backoff line", () => {
    const watchdog = new UplinkWatchdog();
    const seen = replay(watchdog, OCTOBER_9);
    expect(seen.map((restart) => [restart.counted, restart.holdS])).toEqual([
      [false, 0],
      [false, 0],
      [false, 0]
    ]);
    expect(seen.map((restart) => restart.line)).not.toContain("uplink.watchdog.backoff");
    // The age is the episode's: since the fault of the process that had been on air began.
    expect(seen.map((restart) => restart.fields)).toEqual([
      { outputProfile: "720p", fault: "encoder-stall", faultAgeMs: 45_000 },
      { outputProfile: "720p", fault: "destination-stall", faultAgeMs: 65_000 },
      { outputProfile: "720p", fault: "destination-stall", faultAgeMs: 156_000 }
    ]);
    expect(watchdog.hasHolds(utc("2026-10-09T00:05:02"))).toBe(false);
    // The incident keeps its message until the next upsert, so it states the episode in UTC (M90, U10).
    expect(seen[2].note).toBe(
      "This output had been on air for at least 10 min when its stream stopped at 2026-10-09 00:02:26 UTC, and after a dropped connection a destination can refuse a new one for a few minutes, so its restarts until 2026-10-09 00:07:26 UTC do not count toward the restart backoff and the uplink starts again at once."
    );
    expect(seen[2].note).not.toMatch(/\bago\b|\bin \d/);
  });

  it("matches the measured holds of 2026-10-09 without the grace, as v2.3.0-rc.1 decided them", () => {
    // Without `onAirSinceMs` the watchdog cannot know the profile had been on air: M103 as before.
    const seen = replay(new UplinkWatchdog(), OCTOBER_9, false);
    expect(seen.map((restart) => [restart.counted, restart.holdS, restart.line])).toEqual([
      [true, 0, ""],
      [true, 15, "uplink.watchdog.backoff"],
      [true, 30, "uplink.watchdog.backoff"]
    ]);
    expect(seen.slice(1).map((restart) => restart.fields)).toEqual([
      { outputProfile: "720p", fault: "destination-stall", attempt: 2, backoffMs: 15_000 },
      { outputProfile: "720p", fault: "destination-stall", attempt: 3, backoffMs: 30_000 }
    ]);
  });

  it("holds as M103 once the episode is over, the streak counting from the first counted restart", () => {
    const watchdog = new UplinkWatchdog();
    const fault = utc("2026-10-14T00:02:00");
    const onAir = fault - DAY_MS;
    const at = (seconds: number) => fault + seconds * 1000;
    // Twitch refuses for longer than five minutes: after the encoder stall, a destination-stall restart
    // 75 s after each start ([restart, start of the process it stops], in seconds after the fault began).
    const restarts = [
      [53, Number.NaN],
      [68, 53],
      [143, 68],
      [218, 143],
      [293, 218],
      [368, 293],
      [443, 368],
      [533, 458],
      [638, 563]
    ].map(([seconds, startedS]) =>
      darkRestart(watchdog, {
        fault: seconds === 53 ? "encoder-stall" : "destination-stall",
        nowMs: at(seconds),
        // The 68 s restart acts on the timer the first process started at 8 s: it survived the restart.
        troubleSinceMs: seconds === 53 ? fault : at(seconds - 60),
        onAirSinceMs: seconds === 53 ? onAir : at(startedS)
      })
    );
    expect(restarts.map((restart) => restart.counted)).toEqual([false, false, false, false, false, true, true, true, true]);
    expect(restarts.map((restart) => restart.holdS)).toEqual([0, 0, 0, 0, 0, 0, 15, 30, 60]);
  });

  it("gives no grace to a profile that never delivered: a wrong stream key from the start, a new output", () => {
    const watchdog = new UplinkWatchdog();
    const start = utc("2026-10-14T12:00:00");
    const at = (seconds: number) => start + seconds * 1000;
    // Each process encodes from its start; the publish fails a second later, every time.
    const holds = [75, 165, 270].map((seconds, index) => {
      const startedS = [0, 75, 180][index];
      const restart = darkRestart(watchdog, {
        fault: "destination-stall",
        nowMs: at(seconds),
        troubleSinceMs: at(seconds - 60),
        onAirSinceMs: at(startedS)
      });
      expect(restart.counted).toBe(true);
      return restart.holdS;
    });
    expect(holds).toEqual([0, 15, 30]);
  });

  it("needs the full quiet time on air, and a process that never encoded was never on air", () => {
    const fault = utc("2026-10-14T00:02:00");
    const restartOf = (onAirSinceMs: number) =>
      darkRestart(new UplinkWatchdog(), { fault: "encoder-stall", nowMs: fault + 45_000, troubleSinceMs: fault, onAirSinceMs });
    expect(restartOf(fault - RESTART_BACKOFF_QUIET_MS).counted).toBe(false);
    expect(restartOf(fault - RESTART_BACKOFF_QUIET_MS + 1_000).counted).toBe(true);
    // index.ts passes NaN for a process that has not reported progress yet, however long it ran.
    expect(restartOf(Number.NaN).counted).toBe(true);
    const neverEncoded = darkRestart(new UplinkWatchdog(), {
      fault: "destination-stall",
      nowMs: fault + 60_000,
      troubleSinceMs: fault,
      onAirSinceMs: undefined
    });
    expect(neverEncoded.counted).toBe(true);
  });

  it("begins no new grace for a second fault shortly after an episode, the profile on air less than the quiet time", () => {
    const watchdog = new UplinkWatchdog();
    const fault = utc("2026-10-14T00:02:00");
    const at = (seconds: number) => fault + seconds * 1000;
    expect(darkRestart(watchdog, { fault: "encoder-stall", nowMs: at(45), troubleSinceMs: fault, onAirSinceMs: fault - DAY_MS }).counted).toBe(false);
    // On air again from 45 s. The line drops again at 400 s, after the episode, 355 s on air.
    const second = darkRestart(watchdog, { fault: "encoder-stall", nowMs: at(445), troubleSinceMs: at(400), onAirSinceMs: at(45) });
    expect(second).toMatchObject({ counted: true, holdS: 0, line: "" });
    const third = darkRestart(watchdog, { fault: "destination-stall", nowMs: at(520), troubleSinceMs: at(460), onAirSinceMs: at(445) });
    expect(third).toMatchObject({ counted: true, holdS: 15, line: "uplink.watchdog.backoff" });
    // Ten minutes on air since that restart's start, and the next fault is a reconnect again.
    const later = darkRestart(watchdog, { fault: "encoder-stall", nowMs: at(1_200), troubleSinceMs: at(1_155), onAirSinceMs: at(535) });
    expect(later).toMatchObject({ counted: false, line: "uplink.watchdog.reconnect_grace.uncounted" });
  });

  it("begins no grace within the quiet time after its own restart, even when the caller's on-air time is stale", () => {
    const watchdog = new UplinkWatchdog();
    const fault = utc("2026-10-14T00:02:00");
    const at = (seconds: number) => fault + seconds * 1000;
    // A counted restart of a profile that never delivered: the watchdog notes when it restarted it.
    expect(darkRestart(watchdog, { fault: "never-encoded", nowMs: fault, troubleSinceMs: fault - 30_000, onAirSinceMs: Number.NaN }).counted).toBe(true);
    // Six minutes later a caller reports an on-air time from before that restart. index.ts never does
    // (the process it restarted is a new one), so only the watchdog's own restart time can refuse it.
    const stale = darkRestart(watchdog, { fault: "encoder-stall", nowMs: at(400), troubleSinceMs: at(360), onAirSinceMs: fault - DAY_MS });
    expect(stale).toMatchObject({ counted: true, line: "uplink.watchdog.backoff" });
  });

  it("ends the episode when the operator changes the output: the new stream key never delivered", () => {
    const watchdog = new UplinkWatchdog();
    const fault = utc("2026-10-14T00:02:00");
    const at = (seconds: number) => fault + seconds * 1000;
    expect(darkRestart(watchdog, { fault: "encoder-stall", nowMs: at(45), troubleSinceMs: fault, onAirSinceMs: fault - DAY_MS }).counted).toBe(false);
    // The operator enters another stream key at 100 s; the uplink starts it (a destination change, not a
    // watchdog restart), and Twitch refuses it.
    const counted = [
      [175, 115, 100],
      [265, 205, 175],
      [370, 310, 280]
    ].map(([seconds, troubleS, startedS]) =>
      darkRestart(watchdog, { fault: "destination-stall", nowMs: at(seconds), troubleSinceMs: at(troubleS), onAirSinceMs: at(startedS), output: NEW_OUTPUT })
    );
    expect(counted.map((restart) => [restart.counted, restart.holdS])).toEqual([
      [true, 0],
      [true, 15],
      [true, 30]
    ]);
    // As before M109, the hold set on the new key ends when the output changes again.
    expect(watchdog.holdOf("720p", at(375), "sha256-with-a-third-stream-key")).toEqual({ untilMs: 0, outputChanged: true });
    // v2.3.0-rc.1 (no on-air signal) counted the restart before the change and, no hold running at the
    // change, went on with that streak: each restart of the new key one step longer
    // (planning/archive/plans-m84-m109.md, M109).
    const rc1 = new UplinkWatchdog();
    darkRestart(rc1, { fault: "encoder-stall", nowMs: at(45), troubleSinceMs: fault });
    const rc1Holds = [
      [175, 115],
      [265, 205],
      [370, 310]
    ].map(([seconds, troubleS]) =>
      darkRestart(rc1, { fault: "destination-stall", nowMs: at(seconds), troubleSinceMs: at(troubleS), output: NEW_OUTPUT }).holdS
    );
    expect(rc1Holds).toEqual([15, 30, 60]);
  });

  it("leaves the network outage rule first, and an episode it began still covers the reconnect after it", () => {
    const watchdog = new UplinkWatchdog();
    const fault = utc("2026-10-14T00:02:00");
    const at = (seconds: number) => fault + seconds * 1000;
    watchdog.observeNetwork(DOWN, at(20));
    const during = darkRestart(watchdog, { fault: "encoder-stall", nowMs: at(45), troubleSinceMs: fault, onAirSinceMs: fault - DAY_MS });
    expect(during).toMatchObject({ counted: false, line: "uplink.watchdog.network_outage.uncounted", note: UPLINK_NETWORK_OUTAGE_NOTE });
    expect(watchdog.observeNetwork(UP, at(90))).toBe("back");
    // The publish host answers again, Twitch still refuses: the fault began after the outage was seen.
    const after = darkRestart(watchdog, { fault: "destination-stall", nowMs: at(165), troubleSinceMs: at(105), onAirSinceMs: at(45) });
    expect(after).toMatchObject({
      counted: false,
      holdS: 0,
      line: "uplink.watchdog.reconnect_grace.uncounted",
      note: describeReconnectGrace(fault, fault + UPLINK_RECONNECT_GRACE_MS)
    });
    expect(after.fields).toEqual({ outputProfile: "720p", fault: "destination-stall", faultAgeMs: 165_000 });
  });

  it("covers the reconnect after a real outage only within five minutes of the fault, then R35's reset and M103", () => {
    // The 220 s outage of 2026-10-02, then a refusal like 2026-10-09's (194 s) until 414 s: network_back
    // does not lengthen the episode, so the restarts from 300 s on are M103's, as under v2.3.0-rc.1.
    const watchdog = new UplinkWatchdog();
    const fault = utc("2026-10-14T00:02:00");
    const at = (seconds: number) => fault + seconds * 1000;
    const seen: GraceRestart[] = [];
    watchdog.observeNetwork(DOWN, at(20));
    seen.push(darkRestart(watchdog, { fault: "encoder-stall", nowMs: at(45), troubleSinceMs: fault, onAirSinceMs: fault - DAY_MS }));
    watchdog.observeNetwork(DOWN, at(105));
    seen.push(darkRestart(watchdog, { fault: "destination-stall", nowMs: at(120), troubleSinceMs: at(60), onAirSinceMs: at(45) }));
    watchdog.observeNetwork(DOWN, at(180));
    seen.push(darkRestart(watchdog, { fault: "destination-stall", nowMs: at(195), troubleSinceMs: at(135), onAirSinceMs: at(120) }));
    expect(watchdog.observeNetwork(UP, at(225))).toBe("back");
    // Every [restart, its fault's beginning, the stopped process's start] after the network is back.
    for (const [seconds, troubleS, startedS] of [
      [285, 225, 195],
      [360, 300, 285],
      [435, 375, 360]
    ]) {
      seen.push(
        darkRestart(watchdog, { fault: "destination-stall", nowMs: at(seconds), troubleSinceMs: at(troubleS), onAirSinceMs: at(startedS) })
      );
    }
    expect(seen.map((restart) => [restart.line, restart.holdS])).toEqual([
      ["uplink.watchdog.network_outage.uncounted", 0],
      ["uplink.watchdog.network_outage.uncounted", 0],
      ["uplink.watchdog.network_outage.uncounted", 0],
      ["uplink.watchdog.reconnect_grace.uncounted", 0],
      ["", 0],
      ["uplink.watchdog.backoff", 15]
    ]);
    expect(seen.map((restart) => restart.counted)).toEqual([false, false, false, false, true, true]);
  });

  it("leaves the storm path alone: a storm is counted and waits on air as before, and begins no episode", () => {
    const watchdog = new UplinkWatchdog();
    const storm = (seconds: number) =>
      watchdog.decide({ key: "720p", fault: "storm", nowMs: at(seconds), troubleSinceMs: at(seconds), output: OUTPUT, onAirSinceMs: at(-86_400) });
    expect(storm(0)).toMatchObject({ action: "restart", counted: true, uncounted: null, plan: { attempt: 1 } });
    expect(storm(120)).toMatchObject({ action: "keep", notBeforeMs: at(135), plan: { attempt: 2 } });
    // A dark fault of the process the storm restarted: on air only since 0 s, so M103 decides, restart 2.
    const stall = darkRestart(watchdog, { fault: "encoder-stall", nowMs: at(200), troubleSinceMs: at(155), onAirSinceMs: at(0) });
    expect(stall).toMatchObject({ counted: true, holdS: 15 });
  });
});

/**
 * The uplink cycle every 15 s through a refusal of `refusalS` seconds from the first destination failure
 * (0 s) on a working network, with the default thresholds: an encoder-stall restart 45 s after the last
 * `out_time` advance and not within 60 s of a start, a destination-stall restart 60 s after the first cycle
 * that saw every destination in error, its timer surviving an encoder-stall restart. The process that had
 * been on air for a day stops advancing at the failure (its fifo queue fills). A process started while
 * Twitch refuses errs a second after its start and keeps encoding (2026-10-09: no encoder stall after the
 * first), or with `freeze`, the worst case, stops advancing at its start. Order within a cycle as in
 * runUplinkCycle: encoder checks, destination checks, then the start of every profile not held. The first
 * cycle after the failure comes `firstCycleS` later (2026-10-09: 8 s).
 */
function simulateRefusal(
  watchdog: UplinkWatchdog,
  { refusalS, untilS, freeze = false, firstCycleS = 8 }: { refusalS: number; untilS: number; freeze?: boolean; firstCycleS?: number }
) {
  const t0 = utc("2026-10-14T00:02:00");
  const now = (seconds: number) => t0 + seconds * 1000;
  const refused = (seconds: number) => seconds >= 0 && seconds < refusalS;
  let process: { startedS: number; original: boolean } | null = { startedS: -86_400, original: true };
  let lastAdvanceS = 0;
  let destinationError = false;
  let stallStartedS: number | null = null;
  const restarts: Array<{ atS: number; fault: DarkFault; counted: boolean; holdS: number }> = [];
  let backOnAirS: number | null = null;
  for (let seconds = firstCycleS; seconds <= untilS; seconds += 15) {
    if (process && refused(seconds)) {
      destinationError = true;
    }
    if (process && !(refused(seconds) && (process.original || freeze))) {
      lastAdvanceS = seconds;
    }
    let restarted: { fault: DarkFault; troubleSinceS: number } | null = null;
    if (process && seconds - process.startedS >= 60 && seconds - lastAdvanceS >= 45) {
      restarted = { fault: "encoder-stall", troubleSinceS: lastAdvanceS };
    } else if (process && destinationError) {
      stallStartedS = stallStartedS ?? seconds;
      if (seconds - stallStartedS >= 60) {
        restarted = { fault: "destination-stall", troubleSinceS: stallStartedS };
        stallStartedS = null;
      }
    } else {
      stallStartedS = null;
    }
    if (process && restarted) {
      const decision = darkRestart(watchdog, {
        fault: restarted.fault,
        nowMs: now(seconds),
        troubleSinceMs: now(restarted.troubleSinceS),
        onAirSinceMs: now(process.startedS)
      });
      restarts.push({ atS: seconds, fault: restarted.fault, counted: decision.counted, holdS: decision.holdS });
      process = null;
    }
    if (!process && watchdog.holdOf("720p", now(seconds), OUTPUT).untilMs === 0) {
      process = { startedS: seconds, original: false };
      lastAdvanceS = seconds;
      destinationError = refused(seconds);
      if (!refused(seconds) && backOnAirS === null) {
        backOnAirS = seconds;
      }
    }
  }
  return { restarts, backOnAirS };
}

describe("the bound of the reconnect grace (M109)", () => {
  it("restarts at once only in the first five minutes of a refusal that lasts an hour, then holds as M103", () => {
    for (const freeze of [false, true]) {
      const { restarts } = simulateRefusal(new UplinkWatchdog(), { refusalS: 3_600, untilS: 3_600, freeze });
      const uncounted = restarts.filter((restart) => !restart.counted);
      expect(uncounted.every((restart) => restart.atS < UPLINK_RECONNECT_GRACE_MS / 1000 && restart.holdS === 0)).toBe(true);
      // One episode an hour: 5 restarts as on 2026-10-09, 8 in the worst case (the header's bound).
      expect(uncounted.length).toBe(freeze ? 8 : 5);
      expect(restarts.slice(0, uncounted.length).every((restart) => !restart.counted)).toBe(true);
      // From then on M103 unchanged: 0, 15 s, 30 s, 1, 2, 4, then 5 min.
      const counted = restarts.slice(uncounted.length);
      expect(counted.every((restart) => restart.counted)).toBe(true);
      expect(counted.map((restart) => restart.holdS)).toEqual(counted.map((_, index) => restartBackoffDelayMs(index) / 1000));
      expect(counted.at(-1)?.holdS).toBe(RESTART_BACKOFF_MAX_MS / 1000);
    }
  });

  it("restarts at most once a cycle, so never more than 20 times uncounted in one episode", () => {
    const watchdog = new UplinkWatchdog();
    const fault = utc("2026-10-14T00:02:00");
    let uncounted = 0;
    // A fault in every cycle from the fault's first second, which no threshold of the worker allows.
    for (let seconds = 0; seconds < 3_600; seconds += 15) {
      const restart = darkRestart(watchdog, {
        fault: "destination-stall",
        nowMs: fault + seconds * 1000,
        troubleSinceMs: fault + Math.max(0, seconds - 15) * 1000,
        onAirSinceMs: seconds === 0 ? fault - DAY_MS : fault + (seconds - 15) * 1000
      });
      uncounted += restart.counted ? 0 : 1;
    }
    expect(uncounted).toBe(UPLINK_RECONNECT_GRACE_MS / 15_000);
  });

  it("puts the uplink on air within one destination-stall cycle of the end of a refusal, where M103's holds took longer", () => {
    // Every cycle phase and every refusal from 30 s to the end of the episode, 2026-10-09 (194 s) among them.
    let worstWithGrace = 0;
    let worstWithout = 0;
    for (let firstCycleS = 1; firstCycleS <= 15; firstCycleS += 1) {
      for (let refusalS = 30; refusalS < 300; refusalS += 1) {
        const withGrace = simulateRefusal(new UplinkWatchdog(), { refusalS, untilS: 1_800, firstCycleS });
        // Nothing held; a restart after the episode (a refusal that ended late in it) is restart 1 of M103.
        expect(withGrace.restarts.every((restart) => restart.holdS === 0 && restart.counted === restart.atS >= 300)).toBe(true);
        // Without `onAirSinceMs` the watchdog decides as v2.3.0-rc.1 did.
        const m103 = new UplinkWatchdog();
        const decide = m103.decide.bind(m103);
        m103.decide = (input) => decide({ ...input, onAirSinceMs: undefined });
        const without = simulateRefusal(m103, { refusalS, untilS: 1_800, firstCycleS });
        worstWithGrace = Math.max(worstWithGrace, withGrace.backOnAirS! - refusalS);
        worstWithout = Math.max(worstWithout, without.backOnAirS! - refusalS);
      }
    }
    // A process started just before the refusal ends is restarted 75 s after its start at the latest.
    expect(worstWithGrace).toBeLessThan(75);
    expect(worstWithout).toBeGreaterThan(120);
  });
});

describe("the worker passes the watchdog what the reconnect grace needs (M109)", () => {
  // runUplinkCycle needs a database and ffmpeg, so its use of the watchdog is pinned in the source, as in
  // tests/unit/restart-backoff.test.ts; the decisions and their log lines are tested above.
  const worker = readFileSync(path.join(process.cwd(), "apps/worker/src/index.ts"), "utf8");
  const plan = worker.slice(worker.indexOf("async function planUplinkDarkRestart("), worker.indexOf("async function runUplinkCycle("));

  it("says since when the running process was on air: its start once it has encoded", () => {
    expect(plan).toContain("onAirSinceMs: running.progress.seenProgress ? new Date(running.startedAt).getTime() : Number.NaN");
    expect(plan).toContain("output: uplinkOutputSignature(running.runtimeTargets)");
  });

  it("logs the line the decision names, and nothing else of its own", () => {
    expect(plan).toContain("const line = uplinkDarkRestartLogLine(decision, { outputProfile: running.key, fault });");
    expect(plan).toContain("logRuntimeEvent(line.event, line.fields);");
    expect(plan.match(/logRuntimeEvent\(/g)).toHaveLength(1);
  });

  it("names the line of each kind of restart", () => {
    const restart = { action: "restart", holdUntilMs: 0, counted: false, plan: { delayMs: 0, attempt: 0 }, note: "" } as const;
    const context = { outputProfile: "720p", fault: "destination-stall" } as const;
    expect(uplinkDarkRestartLogLine({ ...restart, uncounted: { by: "reconnect-grace", faultAgeMs: 65_000 } }, context)).toEqual({
      event: "uplink.watchdog.reconnect_grace.uncounted",
      fields: { outputProfile: "720p", fault: "destination-stall", faultAgeMs: 65_000 }
    });
    expect(uplinkDarkRestartLogLine({ ...restart, uncounted: { by: "network-outage" } }, context)).toEqual({
      event: "uplink.watchdog.network_outage.uncounted",
      fields: { outputProfile: "720p", fault: "destination-stall" }
    });
    const held = { ...restart, counted: true, uncounted: null, holdUntilMs: 1, plan: { delayMs: 15_000, attempt: 2 } };
    expect(uplinkDarkRestartLogLine(held, context)).toEqual({
      event: "uplink.watchdog.backoff",
      fields: { outputProfile: "720p", fault: "destination-stall", attempt: 2, backoffMs: 15_000 }
    });
    expect(uplinkDarkRestartLogLine({ ...restart, counted: true, uncounted: null, plan: { delayMs: 0, attempt: 1 } }, context)).toBeNull();
  });
});
