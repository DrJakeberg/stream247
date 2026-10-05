import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  RESTART_BACKOFF_MAX_MS,
  RESTART_BACKOFF_QUIET_MS,
  RestartBackoff,
  describeCrashLoopHold,
  describeRestartBackoff,
  restartBackoffDelayMs
} from "../../apps/worker/src/restart-backoff";

const workerSource = readFileSync(path.join(process.cwd(), "apps/worker/src/index.ts"), "utf8");

describe("restart backoff (M103, H7)", () => {
  it("restarts the first time at once, then doubles from 15 s up to 5 min", () => {
    const sequence = Array.from({ length: 9 }, (_, previous) => restartBackoffDelayMs(previous));
    expect(sequence).toEqual([0, 15_000, 30_000, 60_000, 120_000, 240_000, 300_000, 300_000, 300_000]);
    expect(RESTART_BACKOFF_MAX_MS).toBe(300_000);
    expect(restartBackoffDelayMs(1_000)).toBe(300_000);
    expect(restartBackoffDelayMs(Number.NaN)).toBe(0);
  });

  it("grows within a streak of restarts", () => {
    const backoff = new RestartBackoff();
    let now = 1_000_000;
    const delays: number[] = [];
    for (let restart = 0; restart < 8; restart += 1) {
      const plan = backoff.plan(now);
      expect(plan.attempt).toBe(restart + 1);
      delays.push(plan.delayMs);
      now += plan.delayMs;
      backoff.recordRestart(now);
      // The fault comes back a minute after each restart.
      now += 60_000;
    }
    expect(delays).toEqual([0, 15_000, 30_000, 60_000, 120_000, 240_000, 300_000, 300_000]);
  });

  it("starts again from an immediate restart after a quiet period", () => {
    const backoff = new RestartBackoff();
    backoff.recordRestart(0);
    backoff.recordRestart(60_000);
    expect(backoff.plan(120_000).delayMs).toBe(30_000);
    expect(backoff.plan(60_000 + RESTART_BACKOFF_QUIET_MS).delayMs).toBe(30_000);
    expect(backoff.plan(60_000 + RESTART_BACKOFF_QUIET_MS + 1)).toEqual({ delayMs: 0, attempt: 1 });
    backoff.recordRestart(60_000 + RESTART_BACKOFF_QUIET_MS + 1);
    expect(backoff.plan(60_000 + RESTART_BACKOFF_QUIET_MS + 2).delayMs).toBe(15_000);
  });

  it("states the pause and the restart time in UTC, never a relative time", () => {
    const resumeAtMs = Date.parse("2026-10-04T08:42:30.000Z");
    expect(describeRestartBackoff({ delayMs: 0, attempt: 1 }, resumeAtMs)).toBe("");
    const text = describeRestartBackoff({ delayMs: 120_000, attempt: 5 }, resumeAtMs);
    expect(text).toBe(
      "This is restart 5 in a row, so it waits 2 min and restarts at 2026-10-04 08:42:30 UTC; each further repeat waits longer, up to 5 min."
    );
    expect(text).not.toMatch(/\bago\b|\bin \d/);
  });
});

describe("the crash-loop incident message (M103)", () => {
  const resumeAtMs = Date.parse("2026-10-04T08:42:30.000Z");

  it("says playout restarts by itself when a playable item is selected", () => {
    const now = describeCrashLoopHold({ playableSelected: true, plan: { delayMs: 0, attempt: 1 }, resumeAtMs });
    expect(now).toBe("FFmpeg exited repeatedly. A playable item is selected, so playout restarts by itself now.");
    const later = describeCrashLoopHold({ playableSelected: true, plan: { delayMs: 30_000, attempt: 3 }, resumeAtMs });
    expect(later).toContain("playout restarts by itself");
    expect(later).toContain("waits 30 s and restarts at 2026-10-04 08:42:30 UTC");
    for (const text of [now, later]) {
      expect(text).not.toMatch(/Manual intervention/i);
      expect(text).not.toContain("paused until a playable item is selected");
    }
  });

  it("still says it waits for a playable item when there is none", () => {
    const text = describeCrashLoopHold({ playableSelected: false, plan: { delayMs: 30_000, attempt: 3 }, resumeAtMs });
    expect(text).toBe("FFmpeg exited repeatedly, so automatic restarts are paused until a playable item is selected.");
    expect(text).not.toMatch(/Manual intervention/i);
  });

  it("is what the worker writes, followed by the catalogue's action", () => {
    const at = workerSource.indexOf('fingerprint: "playout.crash-loop"');
    const object = workerSource.slice(workerSource.lastIndexOf("upsertIncident({", at), at);
    expect(object).toContain("describeCrashLoopHold({");
    expect(object).toContain("playableSelected: crashLoopPlayableSelected");
    expect(object).toContain('describeIncidentOperatorAction("playout.crash-loop")');
  });

  it("resets protection only once the backoff has passed", () => {
    const at = workerSource.indexOf('await stopPlayoutProcess("crash-loop-reset");');
    const guard = workerSource.slice(workerSource.lastIndexOf("if (", at), at);
    expect(guard).toContain("Date.now() >= crashLoopResumeAtMs");
    expect(guard).toContain("crashLoopResetBackoff.recordRestart(");
  });
});

describe("the uplink watchdog backs off (M103)", () => {
  // The decisions themselves are tested on the watchdog (tests/unit/uplink-watchdog.test.ts, R4 and R35);
  // runUplinkCycle needs a database and ffmpeg, so only its use of them is pinned here.
  it("decides every watchdog restart through the watchdog and holds a profile until its pause is over", () => {
    // Never encoded, encoder stall and destination stall are dark: held, unless the network was down.
    expect(workerSource.match(/const backoffNote = await planUplinkDarkRestart\(/g)).toHaveLength(3);
    // The storm stops its process only on a restart decision; while its restart waits it stays on air and
    // the stall check after it still runs.
    const storm = workerSource.slice(workerSource.indexOf('fault: "storm"'), workerSource.indexOf("uplinkWatchdog.stormOver(running.key);"));
    const restart = storm.slice(storm.indexOf('if (storm.action === "restart") {'), storm.indexOf("if (storm.first) {"));
    expect(restart).toContain('await stopUplinkProcess(running, "encoder-stalled"); continue;'.replace(" continue;", "\n        continue;"));
    expect(storm.slice(storm.indexOf("if (storm.first) {"))).not.toContain("stopUplinkProcess");
    expect(storm.slice(storm.indexOf("if (storm.first) {"))).not.toContain("continue;");
    const start = workerSource.indexOf("await startUplink(group, state.managedConfig);");
    const guard = workerSource.slice(start - 700, start);
    expect(guard).toContain("uplinkWatchdog.holdOf(group.key, Date.now(), uplinkOutputSignature(group.targets))");
    expect(guard).toContain("if (hold.untilMs > 0) {");
  });
});
