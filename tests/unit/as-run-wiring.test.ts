import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { AsRunRecord } from "@stream247/core";
import { DECLARED_SCHEMA } from "../../packages/db/src/schema-manifest";
import { createAsRunLog, watchAsRunEnd, type AsRunEnd, type AsRunStore } from "../../apps/worker/src/as-run.js";

// M76. The playout writes the as-run log; none of it may cost the channel a switch or an exit.
const row = (id: string): AsRunRecord => ({
  id,
  startedAt: "2026-10-01T17:38:00.000Z",
  endedAt: "",
  targetKind: "asset",
  assetId: "asset_yt1",
  title: "Episode 12",
  sourceId: "source_jjwuu0f3",
  poolId: "",
  blockId: "",
  reasonCode: "scheduled_match",
  queueKind: "asset",
  inputKind: "remote",
  formatId: "18",
  formatCandidate: "progressive",
  plannedSeconds: 2700,
  airedSeconds: 0,
  endReason: "",
  exitCode: ""
});
const ended: AsRunEnd = { endedAt: "2026-10-01T17:38:04.000Z", airedSeconds: 4, endReason: "failed", exitCode: "8" };

function recordingStore(overrides: Partial<AsRunStore> = {}) {
  const writes: string[] = [];
  const store: AsRunStore = {
    // A start that takes longer than the process lived: the exit must still land after it.
    start: async (record) => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      writes.push(`start ${record.id}`);
    },
    end: async (id, end) => {
      writes.push(`end ${id} ${end.endReason}`);
    },
    closeOpen: async (endedAtIso) => {
      writes.push(`close ${endedAtIso}`);
    },
    ...overrides
  };
  return { store, writes };
}

describe("as-run write queue", () => {
  it("returns at once and writes boot, start and end in order, even when the start is the slow one", async () => {
    const { store, writes } = recordingStore();
    const log = createAsRunLog(store, () => undefined);
    log.boot("2026-10-01T17:37:50.000Z");
    const id = log.start(() => row("asrun_1"));
    log.end(id, () => ended);
    expect(id).toBe("asrun_1");
    expect(writes).toEqual([]);
    await log.settled();
    expect(writes).toEqual(["close 2026-10-01T17:37:50.000Z", "start asrun_1", "end asrun_1 failed"]);
  });

  it("logs a failed write as as_run.write_failed and goes on with the next one", async () => {
    const events: [string, Record<string, unknown>][] = [];
    const { store, writes } = recordingStore({
      start: async (record) => {
        if (record.id === "asrun_1") {
          throw new Error("connect ECONNREFUSED 10.0.0.5:5432");
        }
        writes.push(`start ${record.id}`);
      }
    });
    const log = createAsRunLog(store, (event, fields) => events.push([event, fields]));
    log.end(log.start(() => row("asrun_1")), () => ended);
    log.start(() => row("asrun_2"));
    await log.settled();
    expect(events).toEqual([["as_run.write_failed", { write: "start", id: "asrun_1", error: "connect ECONNREFUSED 10.0.0.5:5432" }]]);
    expect(writes).toEqual(["end asrun_1 failed", "start asrun_2"]);
  });

  it("never throws to the playout: a row that cannot be built, a throwing logger, a start that wrote nothing", async () => {
    const { store, writes } = recordingStore();
    const log = createAsRunLog(store, () => {
      throw new Error("stdout closed");
    });
    let id = "unset";
    expect(() => {
      id = log.start(() => {
        throw new Error("bad row");
      });
    }).not.toThrow();
    expect(id).toBe("");
    // The exit of a start without a row writes nothing.
    expect(() => log.end(id, () => ended)).not.toThrow();
    expect(() =>
      log.end("asrun_1", () => {
        throw new Error("bad end");
      })
    ).not.toThrow();
    const failing = createAsRunLog(
      recordingStore({
        end: () => {
          throw new Error("synchronous throw inside the store");
        }
      }).store,
      () => undefined
    );
    failing.end("asrun_1", () => ended);
    await expect(failing.settled()).resolves.toBeUndefined();
    await log.settled();
    expect(writes).toEqual([]);
  });
});

// The end of a run is watched from the spawn on: ffmpeg's main exit handler is attached only after the
// start's awaited writes, which an early exit and a failed spawn never wait for.
describe("as-run end watch", () => {
  const recordEnds = () => {
    const ends: [string, AsRunEnd][] = [];
    const store: AsRunStore = {
      start: async () => undefined,
      end: async (id, end) => {
        ends.push([id, end]);
      },
      closeOpen: async () => undefined
    };
    return { ends, log: createAsRunLog(store, () => undefined) };
  };
  const unplanned = () => ({ plannedReason: "", stopIntent: "" as const, naturalBoundary: false });

  it("ends a spawn that failed as failed with the error code and nothing aired; Node emits no exit for it", async () => {
    const { ends, log } = recordEnds();
    const child = spawn("/nonexistent/stream247-as-run-ffmpeg", [], { stdio: "ignore" });
    const startedAtMs = Date.now();
    const exitEvents: unknown[] = [];
    child.on("exit", (code) => exitEvents.push(code));
    const watch = watchAsRunEnd(child, { log, id: "asrun_1", startedAtMs, exitContext: unplanned });
    await new Promise((resolve) => child.on("close", resolve));
    await log.settled();
    expect(exitEvents).toEqual([]);
    expect(ends).toHaveLength(1);
    expect(ends[0]![0]).toBe("asrun_1");
    expect(ends[0]![1]).toMatchObject({ airedSeconds: 0, endReason: "failed", exitCode: "ENOENT" });
    expect(Date.parse(ends[0]![1].endedAt)).toBe(watch.exitedAtMs());
    expect(watch.exitedAtMs()).toBeGreaterThanOrEqual(startedAtMs);
  });

  it("completes the row of a process that exited before anything else listened, with its exit code", async () => {
    const { ends, log } = recordEnds();
    const child = spawn(process.execPath, ["-e", "process.exit(3)"], { stdio: "ignore" });
    const watch = watchAsRunEnd(child, { log, id: "asrun_2", startedAtMs: Date.now(), exitContext: unplanned });
    // The start's awaited runtime, incident and destination writes, which the exit does not wait for.
    await new Promise((resolve) => child.on("close", resolve));
    await log.settled();
    expect(ends).toEqual([["asrun_2", expect.objectContaining({ endReason: "failed", exitCode: "3" })]]);
    expect(watch.exitedAtMs()).toBeGreaterThan(0);
  });

  it("reads the stop facts when the exit is seen, and ends nothing on a failed kill of a running process", async () => {
    const { ends, log } = recordEnds();
    const child = Object.assign(new EventEmitter(), { pid: 4242 }) as unknown as ChildProcess;
    let plannedReason = "";
    const watch = watchAsRunEnd(child, {
      log,
      id: "asrun_3",
      startedAtMs: Date.parse("2026-10-01T17:38:00.000Z"),
      exitContext: () => ({ plannedReason, stopIntent: "", naturalBoundary: false }),
      now: () => Date.parse("2026-10-01T17:39:30.400Z")
    });
    child.emit("error", Object.assign(new Error("kill EPERM"), { code: "EPERM" }));
    expect(watch.exitedAtMs()).toBe(0);
    plannedReason = "switch";
    child.emit("exit", null, "SIGTERM");
    await log.settled();
    expect(ends).toEqual([
      ["asrun_3", { endedAt: "2026-10-01T17:39:30.400Z", airedSeconds: 90, endReason: "switch", exitCode: "SIGTERM" }]
    ]);
  });

  it("never throws into the exit when the stop facts cannot be read", async () => {
    const { ends, log } = recordEnds();
    const child = Object.assign(new EventEmitter(), { pid: 4242 }) as unknown as ChildProcess;
    watchAsRunEnd(child, {
      log,
      id: "asrun_4",
      startedAtMs: Date.now(),
      exitContext: () => {
        throw new Error("state gone");
      }
    });
    expect(() => child.emit("exit", 1, null)).not.toThrow();
    await log.settled();
    expect(ends).toEqual([]);
  });
});

// The worker module starts the playout on import, so its wiring is checked in its source.
describe("as-run wiring", () => {
  const read = (relative: string) => readFileSync(path.join(process.cwd(), relative), "utf8");
  const workerSource = read("apps/worker/src/index.ts");
  const dbSource = read("packages/db/src/index.ts");
  const flat = (source: string) => source.replace(/\s+/g, " ");
  const bodyOf = (source: string, signature: string) => {
    const start = source.indexOf(signature);
    expect(start).toBeGreaterThan(-1);
    const rest = source.slice(start + signature.length);
    const end = rest.search(/\n(?:export )?(?:async )?function /);
    return source.slice(start, end === -1 ? undefined : start + signature.length + end);
  };

  it("writes the start of every run after the spawn, without awaiting it", () => {
    const start = bodyOf(workerSource, "async function startOrSwitchPlayout(");
    const spawned = start.indexOf("playoutProcessStartedAtMs = Date.now();");
    const queued = start.indexOf("const asRunId = asRunLog.start(() =>");
    expect(spawned).toBeGreaterThan(-1);
    expect(queued).toBeGreaterThan(spawned);
    // Before the first await that follows the spawn: no runtime write or incident delays the row.
    expect(queued).toBeLessThan(start.indexOf("await updatePlayoutRuntime((playout) => ({", spawned));
    expect(flat(start)).toContain("const asRunStartedAtMs = playoutProcessStartedAtMs;");
    expect(flat(start)).toContain("blockId: args.asRun.blockId, poolId: args.asRun.poolId,");
    expect(workerSource).not.toMatch(/await asRunLog|asRunLog\.settled/);
    // Both call sites, so every path (programme, insert, fallback bridge, slate, live bridge) writes one.
    expect(
      workerSource.split("asRun: { ...asRunSchedule, queueKind: selection.queueKind, overrideMode: state.playout.overrideMode }")
    ).toHaveLength(3);
    expect(flat(start)).toContain("lifecycleStatus: args.lifecycleStatus, overrideMode: args.asRun.overrideMode }),");
    expect(flat(workerSource)).toContain('assetSourceId: selection.asset?.sourceId ?? "", reasonCode: selection.reasonCode });');
    expect(workerSource.split("await startOrSwitchPlayout({")).toHaveLength(3);
    expect(flat(workerSource)).toContain(
      "const asRunLog = createAsRunLog( { start: recordAsRunStart, end: recordAsRunEnd, closeOpen: closeOpenAsRunRecords }, logRuntimeEvent );"
    );
  });

  it("watches exactly its own row's end from the spawn on, and ranForMs measures to the same instant", () => {
    const start = bodyOf(workerSource, "async function startOrSwitchPlayout(");
    const watched = start.indexOf("const asRunExit = watchAsRunEnd(child, {");
    expect(watched).toBeGreaterThan(start.indexOf("const asRunId = asRunLog.start(() =>"));
    // Before the first statement after the spawn that awaits, and before the main exit handler is attached.
    const spawned = start.indexOf("const child = spawn(ffmpegBinary, command, {");
    const firstAwait = spawned + start.slice(spawned).search(/\n\s*(?:(?:const|let) \w+ = )?await /);
    expect(spawned).toBeGreaterThan(-1);
    expect(firstAwait).toBeGreaterThan(spawned);
    expect(watched).toBeGreaterThan(spawned);
    expect(watched).toBeLessThan(firstAwait);
    expect(watched).toBeLessThan(start.indexOf('child.on("exit", (code, signal) => {'));
    expect(flat(start)).toContain(
      'log: asRunLog, id: asRunId, startedAtMs: asRunStartedAtMs, exitContext: (code, signal) => ({ plannedReason: plannedStopReason, stopIntent: asRunStopIntent, naturalBoundary: plannedStopReason === "" && isNaturalPlayoutBoundary({ targetKind: asRunRunTargetKind, code, signal }) })'
    );
    const exit = flat(workerSource.slice(workerSource.indexOf('child.on("exit", (code, signal) => {')));
    expect(exit).toContain(
      'const exitedAtMs = asRunExit.exitedAtMs() || Date.now(); const ranForMs = playoutProcessStartedAtMs > 0 ? exitedAtMs - playoutProcessStartedAtMs : null; asRunStopIntent = "";'
    );
    expect(workerSource).not.toContain("asRunLog.end(");
  });

  it("says what a restart request was for, and forgets it when no process was there to stop", () => {
    expect(flat(workerSource)).toContain(
      'asRunStopIntent = asRunRestartIntentOf({ runningAssetId: playoutAssetId, skipAssetId: isTimestampActive(state.playout.skipUntil) ? state.playout.skipAssetId : "", nextAssetId: selection.asset?.id ?? "", selectedBeforeSlateAssetId }); await stopPlayoutProcess("restart-requested");'
    );
    // Taken from the selection the reconnect slate replaces, right before it does.
    expect(flat(workerSource)).toContain(
      'await writeStandbySlate(state, "reconnect"); selectedBeforeSlateAssetId = selection.asset?.id ?? ""; selection = { asset: null, queueKind: "reconnect",'
    );
    expect(flat(bodyOf(workerSource, "async function stopPlayoutProcess("))).toContain('plannedStopReason = ""; asRunStopIntent = ""; return;');
  });

  it("reads a Skip from the plain switch too, right before the stop that switch makes", () => {
    // Combination review: a Skip whose restart flag the end write of a cycle in flight erased moves the
    // programme on through the switch branch, where no intent was set and the row read `switch`.
    const cycle = flat(bodyOf(workerSource, "async function runPlayoutCycle("));
    const switchBranch = cycle.slice(cycle.indexOf("} else if (!targetAlreadyRunning) {"));
    expect(switchBranch).toContain(
      'asRunStopIntent = asRunSwitchIntentOf({ runningAssetId: playoutAssetId, skipAssetId: isTimestampActive(state.playout.skipUntil) ? state.playout.skipAssetId : "" }); try { await startOrSwitchPlayout({'
    );
    expect(switchBranch.indexOf("asRunStopIntent = asRunSwitchIntentOf(")).toBeLessThan(switchBranch.indexOf("await "));
    // The stop is the first thing that start makes, with nothing awaited before it that could let another
    // exit read the intent.
    expect(flat(bodyOf(workerSource, "async function startOrSwitchPlayout("))).toContain(
      'const switching = playoutProcess && !playoutProcess.killed; if (switching) { await stopPlayoutProcess("switch"); }'
    );
  });

  it("closes what the previous playout process left on air when the playout comes up", () => {
    expect(flat(bodyOf(workerSource, "async function runLoop("))).toContain(
      'if (mode === "playout") { asRunLog.boot(new Date().toISOString()); }'
    );
  });

  it("stores the log in its own table on every path an install can take, never from a whole-state write", () => {
    expect(dbSource.split("CREATE TABLE IF NOT EXISTS as_run_log (")).toHaveLength(3);
    expect(dbSource.split("CREATE INDEX IF NOT EXISTS as_run_log_started_at_idx ON as_run_log (started_at DESC);")).toHaveLength(3);
    expect(dbSource).toContain('id: "20261001_003_as_run_log"');
    expect(DECLARED_SCHEMA.as_run_log).toEqual([
      "aired_seconds",
      "asset_id",
      "block_id",
      "end_reason",
      "ended_at",
      "exit_code",
      "format_candidate",
      "format_id",
      "id",
      "input_kind",
      "planned_seconds",
      "pool_id",
      "queue_kind",
      "reason_code",
      "source_id",
      "started_at",
      "target_kind",
      "title"
    ]);
    expect(bodyOf(dbSource, "async function persistState(")).not.toMatch(/(INSERT INTO|DELETE FROM|UPDATE) as_run_log/);
    expect(bodyOf(dbSource, "async function hydrateState(")).not.toContain("as_run_log");
  });

  it("prunes in the write that appends, and never reopens or overlaps a closed row", () => {
    const start = flat(bodyOf(dbSource, "export async function recordAsRunStart("));
    expect(start).toContain("AS_RUN_RETENTION_DAYS * 86_400_000");
    expect(start.indexOf("await closeOpenAsRunRows(client, record.startedAt);")).toBeLessThan(start.indexOf("INSERT INTO as_run_log"));
    expect(start).toContain('await client.query("DELETE FROM as_run_log WHERE started_at < $1", [cutoffIso]);');
    expect(flat(bodyOf(dbSource, "export async function recordAsRunEnd("))).toContain("WHERE id = $1 AND ended_at = ''");
  });
});

describe("database pool and as-run write limits (M76 on-air review)", () => {
  const dbSource = readFileSync(path.join(process.cwd(), "packages/db/src/index.ts"), "utf8");
  const flatDb = dbSource.replace(/\s+/g, " ");

  it("listens for idle-client errors, so a dropped connection cannot exit the playout", () => {
    const getPool = flatDb.slice(flatDb.indexOf("function getPool(): Pool {"), flatDb.indexOf("function getEncryptionKey("));
    expect(getPool).toContain('pool.on("error", (error) => {');
    expect(getPool).toContain('event: "db.pool.idle_client_error"');
    // Registered before the pool is shared, so no query can run on a pool without the listener.
    expect(getPool.indexOf('pool.on("error"')).toBeLessThan(getPool.indexOf("globalThis.__stream247Pool = pool;"));
  });

  it("bounds every as-run write with a lock and a statement timeout, the end write included", () => {
    const helper = flatDb.slice(flatDb.indexOf("async function withAsRunTransaction<T>("), flatDb.indexOf("async function closeOpenAsRunRows("));
    expect(helper).toContain(`await client.query("SET LOCAL lock_timeout = '5s'");`);
    expect(helper).toContain(`await client.query("SET LOCAL statement_timeout = '15s'");`);
    const end = flatDb.slice(flatDb.indexOf("export async function recordAsRunEnd("));
    expect(end.slice(0, 600)).toContain("await withAsRunTransaction((client) =>");
  });

  it("indexes the open row in the baseline and the migration", () => {
    expect(dbSource.match(/CREATE INDEX IF NOT EXISTS as_run_log_open_idx ON as_run_log \(id\) WHERE ended_at = '';/g)).toHaveLength(2);
  });
});
