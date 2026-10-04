import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { decideHealthcheck, type HealthcheckPlayoutInput } from "../../apps/worker/src/healthcheck";
import {
  HEALTH_SELF_RESTART_AFTER_MS,
  HealthSelfRestartWatch,
  selfRestartReason
} from "../../apps/worker/src/health-self-restart";

const workerSource = readFileSync(path.join(process.cwd(), "apps/worker/src/index.ts"), "utf8");
const HLS_ENV = { STREAM247_RELAY_ENABLED: "1", STREAM247_UPLINK_INPUT_MODE: "hls" };

function playout(overrides: Partial<HealthcheckPlayoutInput> = {}): HealthcheckPlayoutInput {
  return {
    status: "running",
    heartbeatAt: "",
    workerHeartbeatAt: "",
    uplinkHeartbeatAt: "",
    uplinkStatus: "running",
    uplinkLastExitReason: "",
    programFeedStatus: "fresh",
    programFeedUpdatedAt: "",
    crashLoopDetected: false,
    ...overrides
  };
}

describe("a process restarts itself after five minutes unhealthy (M103, H8, owner Q7)", () => {
  it("uses the owner's five minutes", () => {
    expect(HEALTH_SELF_RESTART_AFTER_MS).toBe(300_000);
  });

  it("exits a worker whose heartbeat has been stale for five minutes, not before", () => {
    const watch = new HealthSelfRestartWatch();
    const lastHeartbeatMs = Date.parse("2026-10-04T08:00:00.000Z");
    const state = playout({ workerHeartbeatAt: new Date(lastHeartbeatMs).toISOString() });
    const verdicts = [];
    // The worker cycles every 30 s; its heartbeat is stale after 240 s.
    for (let nowMs = lastHeartbeatMs; nowMs <= lastHeartbeatMs + 600_000; nowMs += 30_000) {
      const failure = decideHealthcheck("worker", state, nowMs, {});
      const reason = selfRestartReason({ mode: "worker", failure, deliberateHold: "", feedAdvancing: false });
      verdicts.push({ nowMs, ...watch.observe(reason, nowMs) });
    }
    const firstUnhealthy = verdicts.find((entry) => entry.reason !== "");
    const firstExit = verdicts.find((entry) => entry.exit);
    expect(firstUnhealthy?.reason).toBe("Worker heartbeat is stale.");
    expect(firstExit?.nowMs).toBe((firstUnhealthy?.nowMs ?? 0) + 300_000);
    expect(verdicts.filter((entry) => entry.nowMs < (firstExit?.nowMs ?? 0)).every((entry) => !entry.exit)).toBe(true);
  });

  it("starts the five minutes again after one healthy reading or one that could not be taken", () => {
    const watch = new HealthSelfRestartWatch();
    watch.observe("Uplink heartbeat is stale.", 0);
    expect(watch.observe("Uplink heartbeat is stale.", 240_000).exit).toBe(false);
    expect(watch.observe(null, 255_000)).toEqual({ unhealthyForMs: 0, reason: "", exit: false });
    expect(watch.observe("Uplink heartbeat is stale.", 270_000).unhealthyForMs).toBe(0);
    expect(watch.observe("Uplink heartbeat is stale.", 569_999).exit).toBe(false);
    watch.observeUnknown();
    expect(watch.observe("Uplink heartbeat is stale.", 600_000).unhealthyForMs).toBe(0);
    expect(watch.observe("Uplink heartbeat is stale.", 900_000)).toEqual({
      unhealthyForMs: 300_000,
      reason: "Uplink heartbeat is stale.",
      exit: true
    });
  });

  it("never exits a playing playout whose feed advances, however long it reads unhealthy", () => {
    const watch = new HealthSelfRestartWatch();
    const startMs = Date.parse("2026-10-04T08:00:00.000Z");
    for (let nowMs = startMs; nowMs <= startMs + 3 * 3_600_000; nowMs += 15_000) {
      // The playout loop's own heartbeat is an hour old and the row says failed, but the feed on disk
      // keeps advancing: that is a channel on air, and it is never cut.
      const state = playout({ status: "failed", heartbeatAt: new Date(startMs - 3_600_000).toISOString() });
      const failure = decideHealthcheck("playout", state, nowMs, HLS_ENV);
      expect(failure).not.toBeNull();
      const reason = selfRestartReason({ mode: "playout", failure, deliberateHold: "", feedAdvancing: true });
      expect(watch.observe(reason, nowMs).exit).toBe(false);
    }
  });

  it("exits a playout whose feed has stalled for five minutes while it reads unhealthy", () => {
    const watch = new HealthSelfRestartWatch();
    const startMs = Date.parse("2026-10-04T08:00:00.000Z");
    const state = playout({ status: "running", heartbeatAt: new Date(startMs - 120_000).toISOString(), programFeedStatus: "stale" });
    let exitAtMs = 0;
    for (let nowMs = startMs; nowMs <= startMs + 600_000 && exitAtMs === 0; nowMs += 15_000) {
      const failure = decideHealthcheck("playout", state, nowMs, HLS_ENV);
      const reason = selfRestartReason({ mode: "playout", failure, deliberateHold: "", feedAdvancing: false });
      expect(reason).toBe("Playout heartbeat is stale.");
      if (watch.observe(reason, nowMs).exit) {
        exitAtMs = nowMs;
      }
    }
    expect(exitAtMs).toBe(startMs + 300_000);
  });

  it("does not count a deliberate hold or the playout's failed feed against the uplink", () => {
    const crashLoop = decideHealthcheck("playout", playout({ crashLoopDetected: true }), 0, HLS_ENV);
    expect(crashLoop).toBe("Playout crash-loop protection is active.");
    expect(selfRestartReason({ mode: "playout", failure: crashLoop, deliberateHold: "crash-loop-protection", feedAdvancing: false })).toBeNull();

    const nowMs = Date.parse("2026-10-04T08:00:00.000Z");
    const fresh = new Date(nowMs).toISOString();
    const feedFailed = decideHealthcheck("uplink", playout({ uplinkHeartbeatAt: fresh, programFeedStatus: "failed" }), nowMs, HLS_ENV);
    expect(feedFailed).toBe("Program feed is failed.");
    expect(selfRestartReason({ mode: "uplink", failure: feedFailed, deliberateHold: "", feedAdvancing: false })).toBeNull();

    const held = decideHealthcheck("uplink", playout({ uplinkHeartbeatAt: fresh, uplinkStatus: "failed" }), nowMs, HLS_ENV);
    expect(held).toMatch(/^Uplink failed/);
    expect(selfRestartReason({ mode: "uplink", failure: held, deliberateHold: "watchdog-backoff", feedAdvancing: false })).toBeNull();
    expect(selfRestartReason({ mode: "uplink", failure: held, deliberateHold: "", feedAdvancing: false })).toBe(held);

    // The uplink's own hung loop still counts.
    const stale = decideHealthcheck("uplink", playout({ uplinkHeartbeatAt: new Date(nowMs - 120_000).toISOString() }), nowMs, HLS_ENV);
    expect(selfRestartReason({ mode: "uplink", failure: stale, deliberateHold: "", feedAdvancing: true })).toBe("Uplink heartbeat is stale.");
  });

  it("runs after every cycle of every loop and exits through the restart policy", () => {
    const loop = workerSource.slice(workerSource.indexOf("async function runLoop("), workerSource.indexOf("const command = process.argv[2]"));
    expect(loop).toContain("const healthSelfRestart = new HealthSelfRestartWatch();");
    expect(loop).toContain("await enforceHealthSelfRestart(mode, healthSelfRestart);");
    const enforce = workerSource.slice(workerSource.indexOf("async function enforceHealthSelfRestart("), workerSource.indexOf("function requestImmediatePlayoutCycle("));
    expect(enforce).toContain("watch.observeUnknown();");
    expect(enforce).toContain("process.exit(1);");
    const read = workerSource.slice(workerSource.indexOf("async function readSelfRestartReason("), workerSource.indexOf("async function enforceHealthSelfRestart("));
    expect(read).toContain("decideHealthcheck(mode, state.playout, Date.now(), process.env)");
    expect(read).toContain('state.playout.crashLoopDetected ? "crash-loop-protection"');
    expect(read).toContain('(await readProgramFeedRuntimeStatus()).status === "fresh"');
  });
});
