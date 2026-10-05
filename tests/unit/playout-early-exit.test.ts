import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { decideInputOpenRetry, decideInputOpenRetryAfterExit } from "../../apps/worker/src/input-open-retry";
import { decideCycleEndStatus } from "../../apps/worker/src/playout-boundary";
import { hasChildExited } from "../../apps/worker/src/process-utils";

// M105, production v2.1.0 on 2026-10-02 10:24 UTC, right after a playout container restart: a YouTube pair
// started at 10:24:10, and the cycle 15 s later logged playout.boundary.fallback_bridge naming that very item,
// then playout.stop.deadline_exceeded (switch); the fallback aired 3 s and the next archive followed. The
// worker attached its exit handler only after the start's awaited writes, so an ffmpeg that ended during
// them was never handled: the handle stayed on the dead child, the selection kept "the item on air"
// (a handle that is not killed), the boundary found nothing running (exitCode set) and bridged the fallback
// for it, and the switch waited 20 s for an exit that had already happened.

const settle = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("a child that has already ended", () => {
  it("never reports its exit to a listener attached afterwards, which is what the stop waited for", async () => {
    const child = spawn(process.execPath, ["-e", "process.exit(3)"], { stdio: "ignore" });
    // The start's awaited writes, with nobody listening for the exit yet.
    await new Promise((resolve) => child.on("close", resolve));
    const late: unknown[] = [];
    child.once("exit", (code) => late.push(code));
    await settle(200);
    expect(late).toEqual([]);
    // Not killed, so the selection's old test still called it running; the exit code says otherwise.
    expect(child.killed).toBe(false);
    expect(child.exitCode).toBe(3);
    expect(hasChildExited(child)).toBe(true);
  });

  it("reads as ended after a failed spawn, which emits no exit at all", async () => {
    const child = spawn("/nonexistent/stream247-early-exit-ffmpeg", [], { stdio: "ignore" });
    await new Promise((resolve) => child.on("error", resolve));
    await settle(20);
    expect(hasChildExited(child)).toBe(true);
  });

  it("reads as running while it runs, and as ended once a signal ended it", async () => {
    const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 10000)"], { stdio: "ignore" });
    expect(hasChildExited(child)).toBe(false);
    const exited = new Promise((resolve) => child.once("exit", resolve));
    child.kill("SIGKILL");
    await exited;
    expect(child.signalCode).toBe("SIGKILL");
    expect(hasChildExited(child)).toBe(true);
  });
});

describe("decideCycleEndStatus: an exit written before the cycle end stands", () => {
  it.each([
    ["the exit of the item just started is written, nothing runs: failed stays", "running", "failed", false, "failed"],
    ["the crash-loop guard's degraded stays too", "running", "degraded", false, "degraded"],
    ["a process runs: the cycle's own status", "running", "failed", true, "running"],
    ["the exit is not written yet: the cycle's status, the exit write comes after it", "recovering", "switching", false, "recovering"],
    ["a clean early end (idle) is the cycle's to overwrite, as before", "running", "idle", false, "running"]
  ])("%s", (_case, computed, row, processRunning, expected) => {
    expect(decideCycleEndStatus({ computed, row, processRunning })).toBe(expected);
  });

  it("so the item that ended at its start is owed its one retry (M94) on the next cycle", () => {
    const T = Date.parse("2026-10-02T10:24:10.000Z");
    const exit = decideInputOpenRetryAfterExit({ previous: null, exitedAssetId: "yt-pair", immediateOpenFailure: true, nowMs: T });
    const row = (status: string) => ({
      retry: exit.next,
      runtimeStatus: status,
      runtimeCurrentAssetId: "yt-pair",
      runtimeReasonCode: "scheduled_match",
      processRunning: false,
      nowMs: T + 2_000
    });
    // Before: the cycle end wrote "running" over the exit's "failed", and the retry was lost.
    expect(decideInputOpenRetry(row("running"))).toBeNull();
    const status = decideCycleEndStatus({ computed: "running", row: "failed", processRunning: false });
    expect(decideInputOpenRetry(row(status))).toEqual({ assetId: "yt-pair", reasonCode: "scheduled_match" });
  });
});

// apps/worker/src/index.ts cannot be imported in a unit test (it starts the worker).
describe("the playout start, stop and selection after M105", () => {
  const workerSource = readFileSync(path.join(process.cwd(), "apps/worker/src/index.ts"), "utf8");
  const flat = (text: string) => text.replace(/\s+/g, " ");
  const bodyOf = (signature: string) => {
    const start = workerSource.indexOf(signature);
    expect(start, signature).toBeGreaterThan(-1);
    const ends = [workerSource.indexOf("\nfunction ", start + 1), workerSource.indexOf("\nasync function ", start + 1)].filter((index) => index > -1);
    return workerSource.slice(start, Math.min(...ends));
  };

  it("attaches the exit and stderr handlers before the first await after the spawn", () => {
    const start = bodyOf("async function startOrSwitchPlayout(");
    const spawned = start.indexOf("const child = spawn(ffmpegBinary, command, {");
    // The function's own first await after the spawn (two-space indent); the handlers' awaits run later.
    const firstAwait = spawned + start.slice(spawned).search(/\n  (?:(?:const|let) \w+ = )?await /);
    expect(spawned).toBeGreaterThan(-1);
    for (const listener of ['child.on("exit", (code, signal) => {', 'child.stderr?.on("data", (chunk) => {']) {
      const at = start.indexOf(listener);
      expect(at, listener).toBeGreaterThan(spawned);
      expect(at, listener).toBeLessThan(firstAwait);
    }
    // The first await is the start write, which leaves the row to the exit write of a child already gone.
    expect(flat(start.slice(firstAwait, firstAwait + 120))).toContain(
      "await updatePlayoutRuntime((playout) => (hasChildExited(child) ? playout : { ...playout,"
    );
    // Nor does a child already gone count as started successfully or mark the destinations active.
    const guard = start.indexOf("if (hasChildExited(child)) {\n    return;\n  }");
    expect(guard).toBeGreaterThan(firstAwait);
    expect(guard).toBeLessThan(start.indexOf('"playout.ffmpeg.exit",'));
  });

  it("stops a child that has already ended at once instead of waiting out the deadline", () => {
    const stop = flat(bodyOf("async function stopPlayoutProcess("));
    expect(stop).toContain("const alreadyExited = currentProcess !== null && hasChildExited(currentProcess);");
    expect(stop).toContain("if (!currentProcess || currentProcess.killed || alreadyExited) { playoutProcess = null;");
    expect(stop.indexOf("alreadyExited) {")).toBeLessThan(stop.indexOf("PLAYOUT_STOP_DEADLINE_MS"));
  });

  it("lets the cycle-end write keep an exit written before it", () => {
    const cycle = flat(bodyOf("async function runPlayoutCycle("));
    expect(cycle).toContain("status: decideCycleEndStatus<AppState[\"playout\"][\"status\"]>({ computed:");
    expect(cycle).toContain("row: playout.status, processRunning: isPlayoutProcessRunning() }),");
  });

  it("calls an item on air only while its process runs, the same test the boundary bridge uses", () => {
    const choose = flat(bodyOf("function choosePlaybackCandidate("));
    expect(choose).toContain("const processRunning = isPlayoutProcessRunning();");
    expect(flat(workerSource)).toContain(
      "return playoutProcess !== null && playoutProcess.exitCode === null && !playoutProcess.killed;"
    );
  });
});
