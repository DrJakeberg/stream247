import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ASSET_PROBE_QUARANTINE_THRESHOLD,
  isAssetProbeQuarantined,
  planAssetProbeUpdates,
  QUARANTINE_REPROBE_INTERVAL_MS,
  QUARANTINE_REPROBE_OUTAGE_HOLD_MS,
  selectQuarantineReprobes,
  type QuarantineReprobeCandidate
} from "../../packages/core/src/asset-probe-quarantine";
import { isStaleProcessExit } from "../../apps/worker/src/process-exit-guard.js";
import { rearmStateIncidentFlags } from "../../apps/worker/src/state-incident-rearm.js";
import { sourceBreakerOutcomesOf } from "../../apps/worker/src/source-breaker-outcomes.js";

// M95 Self-Healing Fills The Gaps: H5, W7 and H9 of planning/research/robustness.md.
const root = path.resolve(import.meta.dirname, "../..");
const worker = readFileSync(path.join(root, "apps/worker/src/index.ts"), "utf8");

describe("H5: state incidents re-armed after a restart", () => {
  it("seeds the volume flags from the open rows only", () => {
    expect(rearmStateIncidentFlags([])).toEqual({ diskWatermarkIncidentRaised: false, systemVolumeIncidentOpen: false });
    expect(
      rearmStateIncidentFlags([
        { fingerprint: "disk.watermark.evicted", status: "open" },
        { fingerprint: "system.volume.low", status: "open" }
      ])
    ).toEqual({ diskWatermarkIncidentRaised: true, systemVolumeIncidentOpen: true });
    expect(rearmStateIncidentFlags([{ fingerprint: "disk.watermark.exhausted", status: "open" }]).diskWatermarkIncidentRaised).toBe(true);
    expect(
      rearmStateIncidentFlags([
        { fingerprint: "disk.watermark.evicted", status: "resolved" },
        { fingerprint: "system.volume.low", status: "resolved" },
        { fingerprint: "playout.ffmpeg.exit", status: "open" }
      ])
    ).toEqual({ diskWatermarkIncidentRaised: false, systemVolumeIncidentOpen: false });
  });

  it("runs as the first worker step, ahead of the monitors whose flags it seeds", () => {
    const steps = worker.slice(worker.indexOf("function buildWorkerCycleSteps(): CycleStep[] {"));
    const rearm = steps.indexOf('{ name: "state-incident-rearm", run: rearmStateIncidentsOnce }');
    expect(rearm).toBeGreaterThan(0);
    expect(rearm).toBeLessThan(steps.indexOf('{ name: "disk-watermark", run: enforceDiskWatermark }'));
    expect(rearm).toBeLessThan(steps.indexOf('{ name: "system-volume", run: observeSystemVolume }'));
    const body = worker.slice(worker.indexOf("async function rearmStateIncidentsOnce()"), worker.indexOf("// A channel timezone Intl rejects"));
    expect(body).toContain("rearmStateIncidentFlags(state.incidents)");
    expect(body).toContain("await resolveSecretKeyMismatchWhenSecretsDecrypt()");
    // Marked done only after both ran, so a failed read is tried again on the next cycle.
    expect(body.indexOf("stateIncidentFlagsRearmed = true")).toBeGreaterThan(body.indexOf("await resolveSecretKeyMismatchWhenSecretsDecrypt()"));
  });
});

describe("W7: a late exit of an abandoned ffmpeg", () => {
  const a = { name: "abandoned" };
  const b = { name: "replacement" };

  it("is stale when another process is current, or when the stop deadline abandoned it", () => {
    expect(isStaleProcessExit({ current: b, exiting: a, abandoned: true })).toBe(true);
    expect(isStaleProcessExit({ current: b, exiting: a, abandoned: false })).toBe(true);
    expect(isStaleProcessExit({ current: null, exiting: a, abandoned: true })).toBe(true);
  });

  it("is the current exit when the process is still current, or left the slot without being abandoned", () => {
    expect(isStaleProcessExit({ current: a, exiting: a, abandoned: false })).toBe(false);
    expect(isStaleProcessExit({ current: a, exiting: a, abandoned: true })).toBe(false);
    expect(isStaleProcessExit({ current: null, exiting: a, abandoned: false })).toBe(false);
  });

  // The static probe of R3 (U33) turned around: before M95 the handler cleared the module state with no
  // identity guard; now the guard returns before the first line that touches state the replacement owns.
  it("returns from the playout exit handler before touching the replacement's state", () => {
    const exitIdx = worker.indexOf('child.on("exit", (code, signal) => {');
    expect(exitIdx).toBeGreaterThan(0);
    const handler = worker.slice(exitIdx, worker.indexOf("playoutProcess = null;", exitIdx) + 40);
    const guard = handler.indexOf(
      "if (isStaleProcessExit({ current: playoutProcess, exiting: child, abandoned: abandonedPlayoutProcesses.has(child) })) {"
    );
    expect(guard).toBeGreaterThan(0);
    const returnAt = handler.indexOf("return;", guard);
    expect(returnAt).toBeGreaterThan(guard);
    for (const touch of [
      "const plannedReason = plannedStopReason;",
      'plannedStopReason = "";',
      "stopSceneRendererLoop();",
      "playoutProcess = null;",
      "inputOpenRetry = openRetry.next;"
    ]) {
      const at = worker.indexOf(touch, exitIdx);
      expect(at, touch).toBeGreaterThan(exitIdx + returnAt);
    }
    // The deadline is what abandons a process.
    const deadline = worker.slice(worker.indexOf('logRuntimeEvent("playout.stop.deadline_exceeded"'), worker.indexOf("}, PLAYOUT_STOP_DEADLINE_MS);"));
    expect(deadline.indexOf("abandonedPlayoutProcesses.add(currentProcess);")).toBeGreaterThan(0);
    expect(deadline.indexOf("abandonedPlayoutProcesses.add(currentProcess);")).toBeLessThan(deadline.indexOf("finalize();"));
  });

  // Checked for the same pattern: the uplink keeps no single module-level process. Each process has its
  // own runtime entry, and its exit handler removes that entry by identity and reads that entry's planned
  // reason, so a late exit can neither clear another process nor read its reason. There is no stop
  // deadline either: stopUplinkProcess waits for the exit itself.
  it("finds the uplink exit handler scoped to its own process", () => {
    const uplinkStart = worker.indexOf('child.on("exit", (code, signal) => {', worker.indexOf('const stopReason = runtime.plannedStopReason;') - 200);
    expect(uplinkStart).toBeGreaterThan(0);
    const handler = worker.slice(uplinkStart, worker.indexOf("async function runUplinkCycle"));
    expect(handler).toContain("const stopReason = runtime.plannedStopReason;");
    expect(handler).toContain('runtime.plannedStopReason = "";');
    expect(handler).toContain("uplinkProcesses = uplinkProcesses.filter((entry) => entry !== runtime);");
    expect(handler).not.toMatch(/\buplinkProcess\s*=/);
    const stop = worker.slice(worker.indexOf("async function stopUplinkProcess"), worker.indexOf("async function stopAllUplinkProcesses"));
    expect(stop).not.toContain("DEADLINE");
  });
});

describe("H9: quarantined items get one trial a day (owner Q1)", () => {
  const NOW = Date.parse("2026-10-03T12:00:00.000Z");
  const DAY = QUARANTINE_REPROBE_INTERVAL_MS;
  const ago = (ms: number) => new Date(NOW - ms).toISOString();
  const item = (id: string, sourceId: string, probedAt: string, extra: Partial<QuarantineReprobeCandidate> = {}): QuarantineReprobeCandidate => ({
    id,
    sourceId,
    status: "ready",
    includeInProgramming: true,
    playbackProbeFailures: ASSET_PROBE_QUARANTINE_THRESHOLD,
    playbackProbedAt: probedAt,
    ...extra
  });
  const select = (assets: QuarantineReprobeCandidate[], options: Partial<Parameters<typeof selectQuarantineReprobes>[0]> = {}) =>
    selectQuarantineReprobes({
      assets,
      nowMs: NOW,
      gatedSourceIds: new Set(),
      poolSourceIds: new Set(["yt", "tw"]),
      networkOutageSeenAtMs: 0,
      ...options
    }).map((asset) => asset.id);

  it("tries an item once its last probe is 24 h old, not before", () => {
    expect(select([item("a", "yt", ago(DAY - 60_000))])).toEqual([]);
    expect(select([item("a", "yt", ago(DAY))])).toEqual(["a"]);
    expect(select([item("a", "yt", "")])).toEqual(["a"]);
    expect(DAY).toBe(24 * 60 * 60_000);
  });

  it("tries one item per source per cycle, the one waiting longest", () => {
    expect(
      select([item("a", "yt", ago(DAY + 1_000)), item("b", "yt", ago(DAY + 5_000)), item("c", "tw", ago(2 * DAY)), item("d", "tw", ago(DAY))])
    ).toEqual(["b", "c"]);
  });

  it("never tries while the source breaker is open or half-open", () => {
    expect(select([item("a", "yt", ago(2 * DAY)), item("c", "tw", ago(2 * DAY))], { gatedSourceIds: new Set(["yt"]) })).toEqual(["c"]);
  });

  it("never tries while an outage verdict of the channel's own network holds", () => {
    const assets = [item("a", "yt", ago(2 * DAY))];
    expect(select(assets, { networkOutageSeenAtMs: NOW - 60_000 })).toEqual([]);
    expect(select(assets, { networkOutageSeenAtMs: NOW - QUARANTINE_REPROBE_OUTAGE_HOLD_MS })).toEqual(["a"]);
  });

  it("leaves items alone that are not quarantined, not ready, excluded by the operator or in no pool", () => {
    expect(
      select([
        item("free", "yt", ago(2 * DAY), { playbackProbeFailures: ASSET_PROBE_QUARANTINE_THRESHOLD - 1 }),
        item("pending", "yt", ago(2 * DAY), { status: "pending" }),
        item("excluded", "yt", ago(2 * DAY), { includeInProgramming: false }),
        item("orphan", "other", ago(2 * DAY))
      ])
    ).toEqual([]);
  });

  it("a clean trial clears the quarantine; a failed one changes nothing but the time of the try", () => {
    const nowIso = new Date(NOW).toISOString();
    const current = { playbackProbeFailures: ASSET_PROBE_QUARANTINE_THRESHOLD, playbackProbeError: "Requested format is not available", playbackProbedAt: ago(2 * DAY) };
    const ok = planAssetProbeUpdates([{ assetId: "a", sourceId: "yt", title: "A", outcome: "ok", error: "", current, reprobe: true }], nowIso);
    expect(ok.updates).toEqual([{ id: "a", playbackProbeFailures: 0, playbackProbeError: "", playbackProbedAt: nowIso }]);
    expect(isAssetProbeQuarantined(ok.updates[0]!)).toBe(false);

    const failed = planAssetProbeUpdates(
      [{ assetId: "a", sourceId: "yt", title: "A", outcome: "failed", error: "HTTP Error 403", current, reprobe: true }],
      nowIso
    );
    expect(failed.updates).toEqual([
      { id: "a", playbackProbeFailures: ASSET_PROBE_QUARANTINE_THRESHOLD, playbackProbeError: "HTTP Error 403", playbackProbedAt: nowIso }
    ]);
    expect(failed.crossed).toEqual([]);
    expect(failed.quarantinedBySource.get("yt")?.count).toBe(1);
    // The next trial is a day after this one.
    expect(select([item("a", "yt", nowIso)])).toEqual([]);
  });

  it("is never heard by the source breaker", () => {
    const asset = { id: "a", sourceId: "yt" };
    expect(sourceBreakerOutcomesOf([{ asset, outcome: "failed", error: "x", reprobe: true }])).toEqual([]);
    expect(sourceBreakerOutcomesOf([{ asset, outcome: "ok", error: "", reprobe: true }])).toEqual([]);
    expect(sourceBreakerOutcomesOf([{ asset, outcome: "failed", error: "x" }])).toHaveLength(1);
  });

  it("is wired into the queue scan only with something on air", () => {
    expect(worker).toContain("reprobe: isPlayoutProcessRunning() ? selectQuarantineReprobesOf(state) : []");
    expect(worker).toContain("reprobe: probed.reprobe");
    const of = worker.slice(worker.indexOf("function selectQuarantineReprobesOf("), worker.indexOf("// The insert checks (pool interval and cuepoint)"));
    expect(of).toContain("new Set([...gate.heldSourceIds, ...gate.trialSourceIds])");
    expect(of).toContain("networkOutageSeenAtMs");
  });
});

describe("U18: the soak counts uplink and relay restarts", () => {
  it("is valid shell and keeps one service list for the baseline and the check", () => {
    execFileSync("sh", ["-n", path.join(root, "scripts/soak-monitor.sh")]);
    const soak = readFileSync(path.join(root, "scripts/soak-monitor.sh"), "utf8");
    expect(soak).toContain('SOAK_RESTART_SERVICES="web worker playout uplink relay"');
    expect(soak.match(/for service in \$SOAK_RESTART_SERVICES; do/g)).toHaveLength(2);
    expect(soak).not.toMatch(/for service in web worker playout; do/);
    // Every long-running service of the compose file is in the list.
    const compose = readFileSync(path.join(root, "docker-compose.yml"), "utf8");
    for (const service of ["web", "worker", "playout", "uplink", "relay"]) {
      expect(compose).toMatch(new RegExp(`^  ${service}:`, "m"));
    }
  });
});
