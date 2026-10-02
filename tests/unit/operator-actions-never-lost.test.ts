import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decidePassedSkipVote, heldOutAssetIds, isAssetHeldOut, nextPoolRotationAsset, resolveOperatorOverrideHold } from "@stream247/core";
import {
  decideCycleEndPendingAction,
  decideCycleEndRestartFlag,
  decideFailedCycleInsert,
  type InsertFields,
  type PendingActionFields
} from "../../apps/worker/src/playout-boundary";

const { mockAppendAuditEvent, mockReadAppState, mockUpdateDestinationRecord, mockUpdatePlayoutRuntime } = vi.hoisted(() => ({
  mockAppendAuditEvent: vi.fn(),
  mockReadAppState: vi.fn(),
  mockUpdateDestinationRecord: vi.fn(),
  mockUpdatePlayoutRuntime: vi.fn()
}));

vi.mock("@/lib/server/state", () => ({
  appendAuditEvent: mockAppendAuditEvent,
  readAppState: mockReadAppState,
  updateDestinationRecord: mockUpdateDestinationRecord,
  updatePlayoutRuntime: mockUpdatePlayoutRuntime
}));

import { runBroadcastAction } from "../../apps/web/lib/server/broadcast";

// M89. Restart, Hard reload, Recover outputs, Force reconnect, Refresh and Remove next do what the
// operator pressed. H4: the cycle's writes clear only the request the cycle read (planning/research/
// robustness.md W4). W2: Remove next has its own hold, which a Skip or a passed chat vote does not move
// (owner decision 2026-10-01, Q5).

const T0 = "2026-10-02T18:00:00.000Z";
const T1 = "2026-10-02T18:00:05.000Z";

describe("decideCycleEndRestartFlag", () => {
  it.each([
    ["same value: the cycle acted on it, cleared", T0, T0, false, ""],
    ["newer value: pressed while the cycle ran, kept", T0, T1, false, T1],
    ["the cycle read none, a press came in: kept", "", T1, false, T1],
    ["already cleared by an earlier write of the cycle: stays empty", T0, "", false, ""],
    ["nothing read, nothing written: empty", "", "", false, ""],
    ["reconnect window, same value: kept as the window start", T0, T0, true, T0],
    ["reconnect window, newer value: kept", T0, T1, true, T1]
  ])("%s", (_case, consumed, row, keepReconnectWindow, expected) => {
    expect(decideCycleEndRestartFlag({ consumed, row, keepReconnectWindow })).toBe(expected);
  });
});

describe("decideCycleEndPendingAction", () => {
  const none: PendingActionFields = { pendingAction: "", pendingActionRequestedAt: "" };
  const refreshT0: PendingActionFields = { pendingAction: "refresh", pendingActionRequestedAt: T0 };
  const refreshT1: PendingActionFields = { pendingAction: "refresh", pendingActionRequestedAt: T1 };
  const rebuildT1: PendingActionFields = { pendingAction: "rebuild_queue", pendingActionRequestedAt: T1 };

  it.each([
    ["same action and time: carried out, cleared", refreshT0, refreshT0, none],
    ["a second Refresh pressed meanwhile: kept", refreshT0, refreshT1, refreshT1],
    ["a queue rebuild (Move next, Remove next) written meanwhile: kept", refreshT0, rebuildT1, rebuildT1],
    ["the cycle read none, a Refresh came in: kept", none, refreshT1, refreshT1],
    ["already cleared by the handler: stays empty", refreshT0, none, none],
    ["nothing read, nothing written: empty", none, none, none]
  ])("%s", (_case, consumed, row, expected) => {
    expect(decideCycleEndPendingAction({ consumed, row })).toEqual(expected);
  });
});

describe("decideFailedCycleInsert", () => {
  const empty: InsertFields = { insertAssetId: "", insertRequestedAt: "", insertStatus: "" };
  const pendingX: InsertFields = { insertAssetId: "asset_x", insertRequestedAt: T0, insertStatus: "pending" };
  const pendingY: InsertFields = { insertAssetId: "asset_y", insertRequestedAt: T1, insertStatus: "pending" };
  const pendingXAgain: InsertFields = { insertAssetId: "asset_x", insertRequestedAt: T1, insertStatus: "pending" };

  it.each([
    ["the insert the cycle read: dropped", pendingX, pendingX, empty],
    ["a newer Play now of another item: kept", pendingX, pendingY, pendingY],
    ["the same item asked for again meanwhile: kept", pendingX, pendingXAgain, pendingXAgain],
    ["no insert read, a Play now came in: kept", empty, pendingY, pendingY],
    ["already cleared (Resume): stays empty", pendingX, empty, empty]
  ])("%s", (_case, consumed, row, expected) => {
    expect(decideFailedCycleInsert({ consumed, row })).toEqual(expected);
  });
});

// R3's W4 probe (cycle-end-erases-restart) as a test: the same sequence, with the worker's decisions.
describe("an operator request made while a playout cycle runs", () => {
  type Row = { restartRequestedAt: string } & PendingActionFields & { currentAssetId: string };
  const cycleEndWrite =
    (consumed: Row, selection: { reasonCode: string; assetId: string }) =>
    (playout: Row): Row => ({
      ...playout,
      currentAssetId: selection.assetId,
      restartRequestedAt: decideCycleEndRestartFlag({
        consumed: consumed.restartRequestedAt,
        row: playout.restartRequestedAt,
        keepReconnectWindow: selection.reasonCode === "scheduled_reconnect"
      }),
      ...decideCycleEndPendingAction({ consumed, row: playout })
    });

  it("survives the cycle-end write: Restart and Refresh reach the next cycle", () => {
    let row: Row = { restartRequestedAt: "", pendingAction: "", pendingActionRequestedAt: "", currentAssetId: "A" };
    const snapshotAtCycleStart = { ...row };
    // admin: Restart (also Hard reload, Recover outputs and Force reconnect write the flag), then Refresh
    row = { ...row, restartRequestedAt: T0, pendingAction: "", pendingActionRequestedAt: "" };
    row = { ...row, pendingAction: "refresh", pendingActionRequestedAt: T1 };
    row = cycleEndWrite(snapshotAtCycleStart, { reasonCode: "scheduled_match", assetId: "A" })(row);
    expect(row.restartRequestedAt).toBe(T0);
    expect(row.pendingAction).toBe("refresh");
  });

  it("clears what the cycle acted on, so one press restarts once", () => {
    let row: Row = { restartRequestedAt: T0, pendingAction: "refresh", pendingActionRequestedAt: T0, currentAssetId: "A" };
    const snapshotAtCycleStart = { ...row };
    row = cycleEndWrite(snapshotAtCycleStart, { reasonCode: "scheduled_match", assetId: "A" })(row);
    expect(row).toMatchObject({ restartRequestedAt: "", pendingAction: "", pendingActionRequestedAt: "" });
  });

  // The manual-next arm's own condition (index.ts choosePlaybackCandidate, pinned in
  // operator-play-now-wiring.test.ts): a Skip's restart flag that survives lets Move next start at once.
  const manualNextArmTaken = (playout: { currentAssetId: string; restartRequestedAt: string; status: string }, skippedAssetId: string) =>
    playout.currentAssetId === "" || (playout.restartRequestedAt !== "" && playout.currentAssetId === skippedAssetId) || playout.status === "standby";

  it("lets Move next followed by a Skip start the queued item at once, not one item later", () => {
    let row: Row = { restartRequestedAt: "", pendingAction: "", pendingActionRequestedAt: "", currentAssetId: "A" };
    const snapshotAtCycleStart = { ...row };
    // Skip of A while the cycle runs: skip hold on A and the restart flag.
    row = { ...row, restartRequestedAt: T0 };
    row = cycleEndWrite(snapshotAtCycleStart, { reasonCode: "scheduled_match", assetId: "A" })(row);
    expect(manualNextArmTaken({ currentAssetId: row.currentAssetId, restartRequestedAt: row.restartRequestedAt, status: "running" }, "A")).toBe(true);
  });
});

// The worker writes, pinned: index.ts cannot be imported in a unit test (it starts the worker).
describe("the playout cycle's writes use the decisions", () => {
  const workerSource = readFileSync(path.join(process.cwd(), "apps/worker/src/index.ts"), "utf8");
  const flat = workerSource.replace(/\s+/g, " ");

  it("never clears the restart flag or the pending action from a constant", () => {
    expect(workerSource).not.toMatch(/restartRequestedAt: ""/);
    expect(workerSource).not.toMatch(/restartRequestedAt: selection\.reasonCode === "scheduled_reconnect"/);
    expect(workerSource).not.toMatch(/pendingAction: ""/);
    expect(workerSource.match(/restartRequestedAt: decideCycleEndRestartFlag\(/g)?.length).toBe(3);
  });

  it("records what the cycle read where it decides, and hands it to every write", () => {
    expect(flat).toContain(
      'const restartRequested = Boolean(state.playout.restartRequestedAt) && selection.queueKind !== "live"; // What this cycle\'s writes may clear'
    );
    expect(flat).toContain("const consumedRequests = { restartRequestedAt: state.playout.restartRequestedAt, ...consumedPendingAction };");
    expect(flat).toContain(
      "const consumedPendingAction: PendingActionFields = { pendingAction: state.playout.pendingAction, pendingActionRequestedAt: state.playout.pendingActionRequestedAt }; if (state.playout.pendingAction === \"refresh\") {"
    );
    // The restart branch and the cycle end, each with its own reconnect rule as before M89.
    expect(flat).toContain(
      'restartRequestedAt: decideCycleEndRestartFlag({ consumed: consumedRequests.restartRequestedAt, row: playout.restartRequestedAt, keepReconnectWindow: reconnectActive || selection.reasonCode === "scheduled_reconnect" })'
    );
    expect(flat).toContain(
      'restartRequestedAt: decideCycleEndRestartFlag({ consumed: consumedRequests.restartRequestedAt, row: playout.restartRequestedAt, keepReconnectWindow: selection.reasonCode === "scheduled_reconnect" })'
    );
    // The start write.
    expect(flat).toContain(
      "restartRequestedAt: decideCycleEndRestartFlag({ consumed: args.consumed.restartRequestedAt, row: playout.restartRequestedAt, keepReconnectWindow: false })"
    );
    expect(flat).toContain("...decideCycleEndPendingAction({ consumed: args.consumed, row: playout }),");
    expect(flat.match(/consumed: consumedRequests \}\);/g)?.length).toBe(2);
    expect(flat.match(/\.\.\.decideCycleEndPendingAction\(\{ consumed: consumedPendingAction, row: playout \}\),/g)?.length).toBe(2);
    expect(flat).toContain("...decideCycleEndPendingAction({ consumed: consumedRequests, row: playout }),");
  });

  it("drops on a failed start only the insert the cycle read", () => {
    expect(flat.match(/\.\.\.decideFailedCycleInsert\(\{ consumed: consumedInsert, row: playout \}\),/g)?.length).toBe(2);
    expect(flat).toContain("...decideFailedCycleInsert({ consumed: state.playout, row: playout }),");
    expect(flat).not.toMatch(/queueItems: \[\], insertAssetId: "",/);
    // The prepare failure of an insert, as well.
    expect(flat).toContain(
      "...(playout.insertAssetId === failedAsset.id ? decideFailedCycleInsert({ consumed: state.playout, row: playout }) : {}),"
    );
  });

  it("leaves the Remove next hold alone when a chat vote is applied", () => {
    const start = flat.indexOf('if (effect.kind === "skip-passed") {');
    const applied = flat.slice(start, flat.indexOf('message: "Skipped by chat vote."', start));
    expect(applied).toContain("skipAssetId: effect.assetId,");
    expect(applied).not.toContain("removeNext");
  });

  it("holds the Remove next item out of the selection and the queue", () => {
    expect(flat).toContain(
      'const removedNextAssetId = isTimestampActive(state.playout.removeNextUntil) ? state.playout.removeNextAssetId : "";'
    );
    expect(flat).toContain("getCuepointInsertPlan({ state, currentScheduleItem, skippedAssetId, removedNextAssetId });");
    expect(flat).toContain(
      'removedNextAssetId: isTimestampActive(state.playout.removeNextUntil) ? state.playout.removeNextAssetId : "" }'
    );
    // An expired hold is cleared with the skip hold at the top of the cycle.
    expect(flat).toContain(
      'removeNextAssetId: isTimestampActive(playout.removeNextUntil) ? playout.removeNextAssetId : "", removeNextUntil: isTimestampActive(playout.removeNextUntil) ? playout.removeNextUntil : ""'
    );
  });
});

// R3's W2 probe (remove-next-vs-skip-hold) as a test.
describe("Remove next survives a Skip and a passed chat vote (W2, owner Q5)", () => {
  const assets = ["A", "B", "C", "D"].map((id, index) => ({
    id,
    sourceId: "src",
    title: id,
    status: "ready",
    createdAt: `2026-01-0${index + 1}T00:00:00.000Z`
  }));
  const now = Date.parse("2026-10-02T18:00:00.000Z");
  const in60 = new Date(now + 60 * 60_000).toISOString();

  type Holds = { skipAssetId: string; skipUntil: string; removeNextAssetId: string; removeNextUntil: string };
  // The worker's pool eligibility as far as the holds go (index.ts isPoolAssetEligible, pinned in
  // pool-rotation.test.ts).
  const pickAfter = (cursor: string, holds: Holds) =>
    nextPoolRotationAsset({
      pool: { sourceIds: ["src"], cursorAssetId: cursor },
      assets,
      isEligible: (asset) => asset.status === "ready" && !isAssetHeldOut(holds, asset.id, now)
    })?.asset.id;

  const afterRemoveNext = {
    overrideMode: "schedule",
    overrideAssetId: "",
    overrideUntil: "",
    skipAssetId: "",
    skipUntil: "",
    removeNextAssetId: "C",
    removeNextUntil: in60,
    liveBridgeStatus: "",
    liveBridgeInputUrl: "",
    insertAssetId: "",
    insertStatus: "",
    currentAssetId: "B",
    assets,
    nowMs: now
  };

  it("B on air, C removed, a passed vote on B: next is D", () => {
    expect(pickAfter("B", afterRemoveNext)).toBe("D");
    expect(decidePassedSkipVote({ ...afterRemoveNext, votedAssetId: "B" }).kind).toBe("apply");
    // The worker's write on "apply" (index.ts drainChatEffects): skip hold on B, nothing else of the holds.
    const afterVote = { ...afterRemoveNext, skipAssetId: "B", skipUntil: in60 };
    expect(heldOutAssetIds(afterVote, now)).toEqual(["B", "C"]);
    expect(pickAfter("B", afterVote)).toBe("D");
  });

  it("the operator's own Skip of B does not lift it either", () => {
    expect(pickAfter("B", { ...afterRemoveNext, skipAssetId: "B", skipUntil: in60 })).toBe("D");
  });

  it("runs out after its hour like the skip hold", () => {
    expect(isAssetHeldOut({ ...afterRemoveNext, removeNextUntil: new Date(now - 1).toISOString() }, "C", now)).toBe(false);
    expect(heldOutAssetIds({ skipAssetId: "", skipUntil: "" }, now)).toEqual([]);
  });

  it("keeps a Pin of the removed item off the override arm until the Pin lifts the hold", () => {
    const pinned = { ...afterRemoveNext, overrideMode: "asset", overrideAssetId: "C", overrideUntil: in60 };
    expect(resolveOperatorOverrideHold(pinned)).toBe("");
    expect(resolveOperatorOverrideHold({ ...pinned, removeNextAssetId: "", removeNextUntil: "" })).toBe("asset");
  });
});

describe("the admin's writes for Remove next (M89)", () => {
  type Playout = Record<string, unknown>;
  let runtime: Playout;
  let writes: Playout[];
  const assetOf = (id: string) => ({
    id,
    sourceId: "src",
    title: `Item ${id}`,
    path: `/app/data/media/${id}.mp4`,
    status: "ready",
    includeInProgramming: true,
    isGlobalFallback: id === "D",
    fallbackPriority: 100,
    cachePath: "",
    cacheStatus: ""
  });

  function seed(playout: Playout) {
    runtime = {
      status: "running",
      currentAssetId: "B",
      restartRequestedAt: "",
      overrideMode: "schedule",
      overrideAssetId: "",
      overrideUntil: "",
      manualNextAssetId: "",
      manualNextRequestedAt: "",
      insertAssetId: "",
      insertRequestedAt: "",
      insertStatus: "",
      skipAssetId: "",
      skipUntil: "",
      removeNextAssetId: "",
      removeNextUntil: "",
      pendingAction: "",
      pendingActionRequestedAt: "",
      liveBridgeStatus: "",
      liveBridgeInputUrl: "",
      previousAssetId: "C",
      queueItems: [
        { assetId: "B", title: "Item B" },
        { assetId: "C", title: "Item C" }
      ],
      ...playout
    };
    mockReadAppState.mockResolvedValue({ playout: runtime, assets: ["A", "B", "C", "D"].map(assetOf), destinations: [], managedConfig: {} });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    writes = [];
    mockAppendAuditEvent.mockResolvedValue(undefined);
    mockUpdatePlayoutRuntime.mockImplementation(async (updater: (current: Playout) => Playout) => {
      const next = await updater(runtime);
      writes.push(next);
      return next;
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("writes its own hold and leaves a skip hold in place", async () => {
    seed({ skipAssetId: "A", skipUntil: "2099-01-01T00:00:00.000Z" });
    await runBroadcastAction({ type: "remove_next" });
    const written = writes.at(-1)!;
    expect(written).toMatchObject({ removeNextAssetId: "C", skipAssetId: "A", pendingAction: "rebuild_queue" });
    expect(written.removeNextUntil).not.toBe("");
  });

  it("is kept by a later Skip of the item on air", async () => {
    seed({ removeNextAssetId: "C", removeNextUntil: "2099-01-01T00:00:00.000Z" });
    await runBroadcastAction({ type: "skip" });
    expect(writes.at(-1)).toMatchObject({ skipAssetId: "B", removeNextAssetId: "C", removeNextUntil: "2099-01-01T00:00:00.000Z" });
  });

  it("refuses a Play now of the removed item, and Resume clears the hold", async () => {
    seed({ removeNextAssetId: "C", removeNextUntil: "2099-01-01T00:00:00.000Z" });
    await expect(runBroadcastAction({ type: "play_now", assetId: "C" })).rejects.toThrow(/held out by a Skip or Remove next/);
    await runBroadcastAction({ type: "resume" });
    expect(writes.at(-1)).toMatchObject({ removeNextAssetId: "", removeNextUntil: "" });
  });

  it.each([
    ["Pin", { type: "override", assetId: "C" } as const],
    ["Move next", { type: "move_next", assetId: "C" } as const],
    ["Replay previous", { type: "replay_previous" } as const]
  ])("lifts the hold when the operator asks for the removed item again: %s", async (_name, action) => {
    seed({ removeNextAssetId: "C", removeNextUntil: "2099-01-01T00:00:00.000Z" });
    await runBroadcastAction(action);
    expect(writes.at(-1)).toMatchObject({ removeNextAssetId: "", removeNextUntil: "" });
  });

  it("lifts the hold for the Fallback item, and leaves a hold on another item", async () => {
    seed({ removeNextAssetId: "D", removeNextUntil: "2099-01-01T00:00:00.000Z" });
    await runBroadcastAction({ type: "fallback" });
    expect(writes.at(-1)).toMatchObject({ overrideAssetId: "D", removeNextAssetId: "" });
    seed({ removeNextAssetId: "C", removeNextUntil: "2099-01-01T00:00:00.000Z" });
    await runBroadcastAction({ type: "override", assetId: "A" });
    expect(writes.at(-1)).toMatchObject({ overrideAssetId: "A", removeNextAssetId: "C" });
  });
});
