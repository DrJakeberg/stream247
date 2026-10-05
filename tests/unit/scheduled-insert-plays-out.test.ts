import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { asRunEndReasonOf } from "../../apps/worker/src/as-run";
import { isCurrentItemSlotFree } from "../../apps/worker/src/input-open-retry";
import { runningAssetTargetMatches, selectionTakesPoolPosition } from "../../apps/worker/src/playout-boundary";
import { keepsRunningScheduledInsert } from "../../apps/worker/src/scheduled-insert";

// M105, review finding R11: a scheduled insert (the pool's interval insert or a block's cuepoint item) whose
// item is not from the block pool's sources was cut at the next playout cycle for the pool's next pick.

type Item = { id: string; sourceId: string; seconds: number };
type Row = { assetId: string; startedAt: number; endedAt: number; endReason: string; queueKind: string };
type Selection = { assetId: string; reasonCode: string; trigger: "" | "pool-interval" | "cuepoint" };

const archives: Item[] = [
  { id: "a1", sourceId: "src-twitch", seconds: 600 },
  { id: "a2", sourceId: "src-twitch", seconds: 600 },
  { id: "a3", sourceId: "src-twitch", seconds: 600 }
];
// A YouTube sting under a pool of Twitch archives: the admin offers every ready item as the pool's insert.
const sting: Item = { id: "sting", sourceId: "src-yt", seconds: 45 };
const items = [...archives, sting];
const byId = (id: string) => items.find((item) => item.id === id)!;

/**
 * The selection arms of the worker's choosePlaybackCandidate that matter here, in its order, with the
 * worker's own decisions (the wiring is pinned below): the scheduled insert hold (R11), the cuepoint and
 * pool-interval inserts (slot free), the graceful hand-off of a running item from outside the pool, the
 * pool's running item, the pool's pick. A cycle every 15 s, and one at once after an item's natural end.
 */
function simulate(args: {
  hold: boolean;
  untilSeconds: number;
  insertEveryItems?: number;
  cuepointDueAtSeconds?: number;
  skipAt?: { seconds: number; assetId: string };
}) {
  const poolSourceIds = ["src-twitch"];
  const rows: Row[] = [];
  const runtime = { currentAssetId: "", reasonCode: "", status: "idle" };
  let running: { item: Item; kind: string; row: Row; endsAt: number } | null = null;
  let pointer = "";
  let itemsSinceInsert = 0;
  let counterResets = 0;
  const firedCuepoints: string[] = [];
  let skipHeld = "";

  const stop = (at: number, plannedReason: string) => {
    if (!running) return;
    running.row.endedAt = at;
    running.row.endReason = asRunEndReasonOf({ plannedReason, stopIntent: "", naturalBoundary: plannedReason === "", exitedCleanly: true });
    running = null;
  };
  const choose = (t: number): Selection => {
    const processRunning = running !== null;
    if (
      args.hold &&
      keepsRunningScheduledInsert({
        processRunning,
        scheduleTakeover: false,
        runtimeReasonCode: runtime.reasonCode,
        runtimeCurrentAssetId: runtime.currentAssetId,
        runningAssetId: running?.item.id ?? "",
        heldOutAssetIds: [skipHeld].filter(Boolean)
      })
    ) {
      return { assetId: runtime.currentAssetId, reasonCode: "scheduled_insert", trigger: "" };
    }
    const slotFree = isCurrentItemSlotFree({ currentAssetId: runtime.currentAssetId, status: runtime.status, processRunning });
    const cuepointKey = "run-1:300";
    if (args.cuepointDueAtSeconds !== undefined && t >= args.cuepointDueAtSeconds * 1000 && !firedCuepoints.includes(cuepointKey) && slotFree) {
      return { assetId: sting.id, reasonCode: "scheduled_insert", trigger: "cuepoint" };
    }
    if (args.insertEveryItems && slotFree && itemsSinceInsert >= args.insertEveryItems) {
      return { assetId: sting.id, reasonCode: "scheduled_insert", trigger: "pool-interval" };
    }
    const current = processRunning && runtime.currentAssetId && runtime.currentAssetId !== skipHeld ? byId(runtime.currentAssetId) : null;
    const inPool = Boolean(current && poolSourceIds.includes(current.sourceId));
    if (current && ["scheduled_match", "graceful_handoff", "manual_next"].includes(runtime.reasonCode) && !inPool) {
      return { assetId: current.id, reasonCode: "graceful_handoff", trigger: "" };
    }
    if (current && runtime.reasonCode !== "operator_insert" && inPool) {
      return { assetId: current.id, reasonCode: "scheduled_match", trigger: "" };
    }
    const from = archives.findIndex((item) => item.id === pointer);
    const next = archives[(from + 1) % archives.length]!;
    return { assetId: next.id, reasonCode: "scheduled_match", trigger: "" };
  };
  const cycle = (t: number) => {
    if (args.skipAt && t >= args.skipAt.seconds * 1000 && !skipHeld) {
      skipHeld = args.skipAt.assetId;
    }
    const selection = choose(t);
    const desiredKind = selection.reasonCode === "scheduled_insert" ? "insert" : "asset";
    const targetMatches =
      running !== null &&
      runningAssetTargetMatches({ desiredKind, desiredAssetId: selection.assetId, runningKind: running.kind, runningAssetId: running.item.id });
    if (!targetMatches) {
      stop(t, running ? "switch" : "");
      const item = byId(selection.assetId);
      const row: Row = { assetId: item.id, startedAt: t, endedAt: 0, endReason: "", queueKind: desiredKind };
      rows.push(row);
      running = { item, kind: desiredKind, row, endsAt: t + item.seconds * 1000 };
    }
    if (
      selectionTakesPoolPosition({
        selectionReasonCode: selection.reasonCode,
        selectedAssetId: selection.assetId,
        runtimeCurrentAssetId: runtime.currentAssetId,
        runtimeReasonCode: runtime.reasonCode
      })
    ) {
      pointer = selection.assetId;
      itemsSinceInsert += 1;
    }
    // The cycle end: an insert that starts resets the counter, a cuepoint insert fires its cuepoint.
    if (selection.reasonCode === "scheduled_insert" && runtime.currentAssetId !== selection.assetId) {
      itemsSinceInsert = 0;
      counterResets += 1;
    }
    if (selection.trigger === "cuepoint") {
      firedCuepoints.push("run-1:300");
    }
    runtime.currentAssetId = selection.assetId;
    runtime.reasonCode = selection.reasonCode;
    runtime.status = "running";
  };

  let tick = 0;
  while (tick <= args.untilSeconds * 1000) {
    if (running && running.endsAt <= tick) {
      const endedAt = running.endsAt;
      stop(endedAt, "");
      // The exit write: a natural end clears the item on air.
      runtime.currentAssetId = "";
      runtime.status = "idle";
      cycle(endedAt);
      // The exit asks for a cycle at once; the loop's own cycles follow every 15 s from there.
      tick = endedAt + 15_000;
      continue;
    }
    cycle(tick);
    tick += 15_000;
  }
  return { rows, counterResets, firedCuepoints };
}

const summary = (rows: Row[]) =>
  rows.map((row) => [row.assetId, row.queueKind, row.endedAt ? (row.endedAt - row.startedAt) / 1000 : "on air", row.endReason || "on air"]);

describe("keepsRunningScheduledInsert: the scheduled insert on air keeps the air", () => {
  const base = {
    processRunning: true,
    scheduleTakeover: false,
    runtimeReasonCode: "scheduled_insert",
    runtimeCurrentAssetId: "sting",
    runningAssetId: "sting",
    heldOutAssetIds: [] as string[]
  };

  it("holds a running scheduled insert, and nothing else", () => {
    expect(keepsRunningScheduledInsert(base)).toBe(true);
    for (const runtimeReasonCode of ["scheduled_match", "graceful_handoff", "manual_next", "operator_insert", "operator_override", ""]) {
      expect(keepsRunningScheduledInsert({ ...base, runtimeReasonCode }), runtimeReasonCode).toBe(false);
    }
    expect(keepsRunningScheduledInsert({ ...base, runtimeCurrentAssetId: "" })).toBe(false);
  });

  it("lets go once it has ended, when it is skipped or removed, and at a dated block's takeover", () => {
    expect(keepsRunningScheduledInsert({ ...base, processRunning: false })).toBe(false);
    expect(keepsRunningScheduledInsert({ ...base, heldOutAssetIds: ["sting"] })).toBe(false);
    expect(keepsRunningScheduledInsert({ ...base, heldOutAssetIds: ["a2"] })).toBe(true);
    expect(keepsRunningScheduledInsert({ ...base, scheduleTakeover: true })).toBe(false);
  });

  it("never holds an item the running process does not play: a stale row would start an ended insert again", () => {
    expect(keepsRunningScheduledInsert({ ...base, runningAssetId: "a2" })).toBe(false);
    expect(keepsRunningScheduledInsert({ ...base, runningAssetId: "" })).toBe(false);
  });
});

describe("R11 across playout cycles: a YouTube sting under a pool of Twitch archives", () => {
  it("before M105 the pool's interval insert was cut 15 s in for the pool's next pick", () => {
    const { rows } = simulate({ hold: false, insertEveryItems: 1, untilSeconds: 700 });
    expect(summary(rows).slice(0, 3)).toEqual([
      ["a1", "asset", 600, "natural-end"],
      ["sting", "insert", 15, "switch"],
      ["a2", "asset", "on air", "on air"]
    ]);
  });

  it("the pool's interval insert plays to its end, every time, and is counted once per start", () => {
    const { rows, counterResets } = simulate({ hold: true, insertEveryItems: 1, untilSeconds: 1400 });
    expect(summary(rows)).toEqual([
      ["a1", "asset", 600, "natural-end"],
      ["sting", "insert", 45, "natural-end"],
      ["a2", "asset", 600, "natural-end"],
      ["sting", "insert", 45, "natural-end"],
      ["a3", "asset", "on air", "on air"]
    ]);
    // Held for two cycles each time without resetting the counter again.
    expect(counterResets).toBe(2);
  });

  it("a cuepoint insert plays to its end and its cuepoint fires once", () => {
    const before = simulate({ hold: false, cuepointDueAtSeconds: 300, untilSeconds: 700 });
    expect(summary(before.rows)[1]).toEqual(["sting", "insert", 15, "switch"]);
    const { rows, firedCuepoints } = simulate({ hold: true, cuepointDueAtSeconds: 300, untilSeconds: 1300 });
    expect(summary(rows)).toEqual([
      ["a1", "asset", 600, "natural-end"],
      ["sting", "insert", 45, "natural-end"],
      ["a2", "asset", 600, "natural-end"],
      ["a3", "asset", "on air", "on air"]
    ]);
    expect(firedCuepoints).toEqual(["run-1:300"]);
  });

  it("a Skip of the insert on air still ends it, and the pool goes on", () => {
    const { rows } = simulate({ hold: true, insertEveryItems: 1, untilSeconds: 700, skipAt: { seconds: 620, assetId: "sting" } });
    expect(summary(rows).slice(0, 3)).toEqual([
      ["a1", "asset", 600, "natural-end"],
      ["sting", "insert", 30, "switch"],
      ["a2", "asset", "on air", "on air"]
    ]);
  });
});

// apps/worker/src/index.ts cannot be imported in a unit test (it starts the worker); this pins the wiring the
// simulation above stands for.
describe("R11 wiring in the worker", () => {
  const workerSource = readFileSync(path.join(process.cwd(), "apps/worker/src/index.ts"), "utf8");
  const flat = (text: string) => text.replace(/\s+/g, " ");
  const functionBody = (name: string) => {
    const start = workerSource.indexOf(`function ${name}(`);
    expect(start, `function ${name} not found`).toBeGreaterThan(-1);
    const ends = [workerSource.indexOf("\nfunction ", start + 1), workerSource.indexOf("\nasync function ", start + 1)].filter((index) => index > -1);
    return flat(workerSource.slice(start, Math.min(...ends)));
  };

  it("holds the insert after every operator arm and the takeover, ahead of the insert arms and the pool, with no trigger", () => {
    const choose = functionBody("choosePlaybackCandidate");
    const arm = choose.indexOf(
      "const runningScheduledInsert = keepsRunningScheduledInsert({ processRunning, scheduleTakeover: Boolean(scheduleTakeover), runtimeReasonCode: state.playout.selectionReasonCode, runtimeCurrentAssetId: state.playout.currentAssetId, runningAssetId: playoutAssetId, heldOutAssetIds: [skippedAssetId, removedNextAssetId].filter(Boolean) })"
    );
    expect(arm).toBeGreaterThan(-1);
    expect(choose.indexOf("const scheduleTakeover = takeoverPick ? scheduleTakeoverEdge : null;")).toBeGreaterThan(-1);
    expect(choose.indexOf("const scheduleTakeover = takeoverPick ? scheduleTakeoverEdge : null;")).toBeLessThan(arm);
    for (const operatorArm of ["if (liveBridgeActive)", "if (desiredAsset)", 'if (activeInsertAsset && state.playout.insertStatus !== "")', "if (retryAsset && retryDecision)"]) {
      expect(choose.indexOf(operatorArm), operatorArm).toBeGreaterThan(-1);
      expect(choose.indexOf(operatorArm), operatorArm).toBeLessThan(arm);
    }
    for (const later of ["if (cuepointInsertPlan && currentSlotFree)", "if (autoInsertAsset)", "const preferredAsset ="]) {
      expect(choose.indexOf(later), later).toBeGreaterThan(arm);
    }
    const selection = choose.slice(arm, choose.indexOf("if (cuepointInsertPlan && currentSlotFree)"));
    expect(selection).toContain('queueKind: "insert",');
    expect(selection).toContain('reasonCode: "scheduled_insert" as const,');
    expect(selection).not.toContain("insertTrigger");
    expect(selection).not.toContain("cuepointKey");
  });

  it("uses up a cuepoint or the counter only for an insert that starts", () => {
    const cycle = functionBody("runPlayoutCycle");
    expect(cycle).toContain('if (selection.insertTrigger === "cuepoint" && selection.cuepointKey && !cuepointFiredKeys.includes(selection.cuepointKey))');
    expect(cycle).toContain('selection.reasonCode === "scheduled_insert" && selection.asset && state.playout.currentAssetId !== selection.asset.id');
  });
});
