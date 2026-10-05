import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { shouldClearInsertOnExit } from "../../apps/worker/src/playout-boundary";
import { createFailedExitWrite } from "../../apps/worker/src/playout-exit-write";

// M105, review finding R3: an ffmpeg exit during a database outage had its runtime write refused and never
// retried; after the outage the operator insert that had ended still read as active and aired again from 0.

type Row = { status: string; currentAssetId: string; insertAssetId: string; insertStatus: "" | "pending" | "active" };
type Updater = (row: Row) => Row;

// The part of the worker's exit write this is about: a natural end leaves nothing on air and ends the insert.
const naturalEndOf = (): Updater => (row) => ({
  ...row,
  status: "idle",
  currentAssetId: "",
  ...(shouldClearInsertOnExit({ plannedReason: "", insertStatus: row.insertStatus, insertAssetId: row.insertAssetId, currentAssetId: row.currentAssetId })
    ? { insertAssetId: "", insertStatus: "" as const }
    : {})
});

// The worker's insert arm selects an insert while the row names one (choosePlaybackCandidate); with no
// process running the cycle then starts it.
const insertArmSelects = (row: Row) => row.insertAssetId !== "" && row.insertStatus !== "";

function database(initial: Row) {
  let row = initial;
  let up = true;
  return {
    setUp: (value: boolean) => {
      up = value;
    },
    row: () => row,
    write: async (updater: Updater) => {
      if (!up) {
        throw new Error("connect ECONNREFUSED 172.18.0.2:5432");
      }
      row = updater(row);
    }
  };
}

const onAirInsert: Row = { status: "running", currentAssetId: "insert-1", insertAssetId: "insert-1", insertStatus: "active" };

describe("an exit write the database refused is applied again", () => {
  it("before R3 the row after the outage still named the finished insert, and the insert arm took it again", async () => {
    const db = database(onAirInsert);
    db.setUp(false);
    await db.write(naturalEndOf()).catch(() => undefined);
    db.setUp(true);
    expect(insertArmSelects(db.row())).toBe(true);
  });

  it("is kept while the database is down and applied once it is back, so the insert stays ended", async () => {
    const db = database(onAirInsert);
    const kept = createFailedExitWrite<Updater>();
    const exit = naturalEndOf();
    db.setUp(false);
    await db.write(exit).catch(() => kept.fail(exit));
    expect(kept.pending()).toBe(true);

    // A cycle during the outage: applying it fails again, and it stays kept.
    await expect(kept.reapply(db.write)).rejects.toThrow("ECONNREFUSED");
    expect(kept.pending()).toBe(true);

    // The first cycle after the outage applies it before it reads.
    db.setUp(true);
    await expect(kept.reapply(db.write)).resolves.toBe(true);
    expect(db.row()).toEqual({ status: "idle", currentAssetId: "", insertAssetId: "", insertStatus: "" });
    expect(insertArmSelects(db.row())).toBe(false);
    // Once only.
    expect(kept.pending()).toBe(false);
    await expect(kept.reapply(db.write)).resolves.toBe(false);
  });

  it("is dropped when a new process starts, so it never overwrites that process's row", async () => {
    const db = database(onAirInsert);
    const kept = createFailedExitWrite<Updater>();
    kept.fail(naturalEndOf());
    kept.supersede();
    const started: Row = { status: "starting", currentAssetId: "a2", insertAssetId: "", insertStatus: "" };
    await db.write(() => started);
    await expect(kept.reapply(db.write)).resolves.toBe(false);
    expect(db.row()).toEqual(started);
  });

  it("keeps the latest refused exit, and one that replaced it while a reapply ran stays for the next cycle", async () => {
    const kept = createFailedExitWrite<Updater>();
    const first = naturalEndOf();
    const second = naturalEndOf();
    kept.fail(first);
    kept.fail(second);
    const applied: Updater[] = [];
    await kept.reapply(async (updater) => {
      applied.push(updater);
      kept.fail(first);
    });
    expect(applied).toEqual([second]);
    expect(kept.pending()).toBe(true);
  });
});

describe("R3 wiring in the worker", () => {
  const flat = readFileSync(path.join(process.cwd(), "apps/worker/src/index.ts"), "utf8").replace(/\s+/g, " ");

  it("keeps the exit write it could not apply, drops it at a spawn and applies it again before each state read", () => {
    expect(flat).toContain("const runtimeUpdate = updatePlayoutRuntime(exitRuntimeUpdate);");
    expect(flat).toContain("failedPlayoutExitWrite.fail(exitRuntimeUpdate);");
    expect(flat).toContain("playoutProcess = child; playoutProcessStartedAtMs = Date.now(); // This start's own write");
    expect(flat).toContain("failedPlayoutExitWrite.supersede();");
    expect(flat).toContain("if (await failedPlayoutExitWrite.reapply((updater) => updatePlayoutRuntime(updater))) {");
    expect(flat.match(/await pendingPlayoutExitUpdate; await reapplyFailedPlayoutExitWrite\(\);/g)?.length).toBe(2);
  });
});
