import { describe, expect, it } from "vitest";
import {
  decidePassedSkipVote,
  formatChatSkipPausedReply,
  resolveOperatorHold,
  resolveOperatorOverrideHold,
  type OperatorHoldInput,
  type OperatorOverrideHoldInput,
  type PassedSkipVoteInput
} from "@stream247/core";
import { decideCycleEndInsert, shouldClearInsertOnExit, type InsertFields } from "../../apps/worker/src/playout-boundary";

// M78. The rule the playout's override arm applies, shared with the admin (Play now refusal, Skip ending
// the override) and the worker's chat (a viewer skip vote neither starts nor counts while it holds).
const NOW = Date.parse("2026-10-01T12:00:00.000Z");
const LATER = "2026-10-01T13:00:00.000Z";
const EARLIER = "2026-10-01T11:00:00.000Z";

function input(overrides: Partial<OperatorOverrideHoldInput> = {}): OperatorOverrideHoldInput {
  return {
    overrideMode: "asset",
    overrideAssetId: "asset_pin",
    overrideUntil: LATER,
    skipAssetId: "",
    skipUntil: "",
    liveBridgeStatus: "",
    liveBridgeInputUrl: "",
    assets: [
      { id: "asset_pin", status: "ready" },
      { id: "asset_other", status: "ready" }
    ],
    nowMs: NOW,
    ...overrides
  };
}

describe("resolveOperatorOverrideHold", () => {
  it.each<[string, Partial<OperatorOverrideHoldInput>, string]>([
    ["a running Pin", {}, "asset"],
    ["a running Fallback", { overrideMode: "fallback" }, "fallback"],
    ["no override", { overrideMode: "schedule", overrideAssetId: "", overrideUntil: "" }, ""],
    ["an override that ran out (the worker clears it at its next cycle)", { overrideUntil: EARLIER }, ""],
    ["an override without an item", { overrideAssetId: "" }, ""],
    ["an override whose item is not ready", { assets: [{ id: "asset_pin", status: "missing" }] }, ""],
    ["an override whose item is gone", { assets: [{ id: "asset_other", status: "ready" }] }, ""],
    // The race M78 closes: a stale override of the item a Skip holds out does not restart it from 0.
    ["an override whose item is skip-held", { skipAssetId: "asset_pin", skipUntil: LATER }, ""],
    ["an override whose item's skip hold ran out", { skipAssetId: "asset_pin", skipUntil: EARLIER }, "asset"],
    ["an override while another item is skip-held", { skipAssetId: "asset_other", skipUntil: LATER }, "asset"],
    // The live arm comes before the override arm: a pin left running under a Live Bridge is not on air,
    // and the bot must not tell chat during the live show that the operator pinned "this item".
    ["a Pin under an active Live Bridge", { liveBridgeStatus: "active", liveBridgeInputUrl: "rtmp://bridge/live" }, ""],
    ["a Fallback under a pending Live Bridge", { overrideMode: "fallback", liveBridgeStatus: "pending", liveBridgeInputUrl: "rtmp://bridge/live" }, ""],
    ["a Pin while the bridge is releasing", { liveBridgeStatus: "releasing", liveBridgeInputUrl: "rtmp://bridge/live" }, "asset"],
    ["a Pin with a bridge status but no input (the worker's live arm needs both)", { liveBridgeStatus: "active" }, "asset"]
  ])("%s", (_name, overrides, expected) => {
    expect(resolveOperatorOverrideHold(input(overrides))).toBe(expected);
  });
});

describe("decidePassedSkipVote", () => {
  // The row as the worker reads it when it applies a vote that passed up to a cycle earlier.
  function vote(overrides: Partial<PassedSkipVoteInput> = {}): PassedSkipVoteInput {
    return {
      ...input({ overrideMode: "schedule", overrideAssetId: "", overrideUntil: "" }),
      insertAssetId: "",
      insertStatus: "",
      votedAssetId: "asset_other",
      currentAssetId: "asset_other",
      ...overrides
    };
  }

  it.each<[string, Partial<PassedSkipVoteInput>, ReturnType<typeof decidePassedSkipVote>]>([
    ["the voted item is on air and nothing holds it", {}, { kind: "apply" }],
    ["a Pin holds the air", { overrideMode: "asset", overrideAssetId: "asset_pin", overrideUntil: LATER }, { kind: "paused", hold: "asset" }],
    ["a Fallback holds the air", { overrideMode: "fallback", overrideAssetId: "asset_pin", overrideUntil: LATER }, { kind: "paused", hold: "fallback" }],
    // The race of the M78 review: the room passed a vote on the item before a Pin, the operator's Skip
    // then ended the Pin. The row is the operator's: override cleared, the pinned item held out and on air
    // until the restart. Applied, the vote took the hold off the pinned item and restarted it from 0.
    [
      "the voted item left the air and the operator's Skip holds out the item on air",
      { currentAssetId: "asset_pin", skipAssetId: "asset_pin", skipUntil: LATER },
      { kind: "stale" }
    ],
    ["the voted item ended and the next item is on air", { currentAssetId: "asset_pin" }, { kind: "stale" }],
    ["nothing is on air (a Live Bridge, a slate)", { currentAssetId: "" }, { kind: "stale" }],
    ["the operator's Skip of the same item got there first", { skipAssetId: "asset_other", skipUntil: LATER }, { kind: "stale" }],
    // Chat and operator holds share one slot: an earlier skip of another item does not block this vote.
    ["another item is still held out by an earlier skip", { skipAssetId: "asset_pin", skipUntil: LATER }, { kind: "apply" }],
    ["the voted item's own earlier hold ran out", { skipAssetId: "asset_other", skipUntil: EARLIER }, { kind: "apply" }],
    // M79: the room passed the vote before the cycle saw the operator's insert.
    ["a Play now is pending (the voted item is about to give way to it)", { insertAssetId: "asset_pin", insertStatus: "pending" }, { kind: "paused", hold: "insert" }],
    ["the operator's insert is on air and the vote was on it", { insertAssetId: "asset_other", insertStatus: "active" }, { kind: "paused", hold: "insert" }],
    // The operator's Skip ends an insert as before: its skip hold takes the insert out, and the vote on it is stale.
    [
      "the operator's Skip ended the insert the vote was on",
      { insertAssetId: "asset_other", insertStatus: "active", skipAssetId: "asset_other", skipUntil: LATER },
      { kind: "stale" }
    ]
  ])("%s", (_name, overrides, expected) => {
    expect(decidePassedSkipVote(vote(overrides))).toEqual(expected);
  });
});

// M79. Owner decision 2026-10-01: a chat skip vote may not skip a Play now / Insert either. The chat's rule:
// the Pin or Fallback first (the override arm comes first), then the insert the worker's insert arm selects.
describe("resolveOperatorHold", () => {
  // An operator insert on air and no override: asset_other is the insert's item.
  function held(overrides: Partial<OperatorHoldInput> = {}): OperatorHoldInput {
    return {
      ...input({ overrideMode: "schedule", overrideAssetId: "", overrideUntil: "" }),
      insertAssetId: "asset_other",
      insertStatus: "active",
      currentAssetId: "asset_other",
      ...overrides
    };
  }

  it.each<[string, Partial<OperatorHoldInput>, string]>([
    ["an operator insert on air", {}, "insert"],
    ["a Play now that has not aired yet", { insertStatus: "pending", currentAssetId: "asset_pin" }, "insert"],
    ["a Play now with nothing on air yet", { insertStatus: "pending", currentAssetId: "" }, "insert"],
    // Combination review: the row still says active, but the insert could not be prepared again after a
    // Restart (or a redeploy) and the fallback is what plays. The bot must not name an insert then.
    ["an active insert while another item is on air (the fallback covers a failed re-prepare)", { currentAssetId: "asset_pin" }, ""],
    // The gap of a Restart, and the reconnect slate of direct mode: the insert starts again after it.
    ["an active insert with nothing on air (a Restart's gap, the reconnect slate)", { currentAssetId: "" }, "insert"],
    // A pool's automatic insert and a cue point insert select as scheduled_insert and leave the insert
    // fields empty: they are the schedule's content and stay skippable.
    ["no operator insert (nothing, or a pool or cue point insert on air)", { insertAssetId: "", insertStatus: "" }, ""],
    ["an insert id without a status", { insertStatus: "" }, ""],
    ["an insert whose item is not ready (the worker drops it as unavailable)", { assets: [{ id: "asset_other", status: "missing" }] }, ""],
    ["an insert the operator's Skip holds out (the worker ends it)", { skipAssetId: "asset_other", skipUntil: LATER }, ""],
    ["an insert whose item's skip hold ran out", { skipAssetId: "asset_other", skipUntil: EARLIER }, "insert"],
    ["an insert while another item is skip-held", { skipAssetId: "asset_pin", skipUntil: LATER }, "insert"],
    // The live arm comes first, and since M78 its takeover ends the insert: the bot stays silent then.
    ["an insert under an active Live Bridge", { liveBridgeStatus: "active", liveBridgeInputUrl: "rtmp://bridge/live" }, ""],
    ["a pending insert under a pending Live Bridge", { insertStatus: "pending", liveBridgeStatus: "pending", liveBridgeInputUrl: "rtmp://bridge/live" }, ""],
    ["an insert while the bridge is releasing", { liveBridgeStatus: "releasing", liveBridgeInputUrl: "rtmp://bridge/live" }, "insert"],
    // The override arm comes before the insert arm (a pending insert under it is dropped as preempted).
    ["a pending insert under a Pin", { insertStatus: "pending", overrideMode: "asset", overrideAssetId: "asset_pin", overrideUntil: LATER }, "asset"],
    ["an insert under a Fallback", { overrideMode: "fallback", overrideAssetId: "asset_pin", overrideUntil: LATER }, "fallback"],
    ["an insert under a Pin that ran out", { overrideMode: "asset", overrideAssetId: "asset_pin", overrideUntil: EARLIER }, "insert"],
    ["a Pin and no insert", { insertAssetId: "", insertStatus: "", overrideMode: "asset", overrideAssetId: "asset_pin", overrideUntil: LATER }, "asset"]
  ])("%s", (_name, overrides, expected) => {
    expect(resolveOperatorHold(held(overrides))).toBe(expected);
  });

  it("leaves the override rule alone: an insert is not an override the playout's override arm would select", () => {
    expect(resolveOperatorOverrideHold(held())).toBe("");
    expect(resolveOperatorOverrideHold(held({ insertStatus: "pending" }))).toBe("");
  });
});

// M79. The table above feeds the rule hand-made rows. These are the rows the playout's own insert writes
// leave (playout-boundary.ts), so "votes count again after the insert" and "a pool or cue point insert stays
// skippable" fail here if the rule ever holds on past them. chat-control.test.ts only shows that the
// runtime pauses for whatever hold the worker hands it.
describe("resolveOperatorHold over the rows the playout writes", () => {
  const REQUESTED = "2026-10-01T11:59:00.000Z";
  const EMPTY: InsertFields = { insertAssetId: "", insertRequestedAt: "", insertStatus: "" };
  // The insert's item is asset_other; `onAir` is what the runtime row has on air beside these fields.
  const hold = (row: InsertFields, onAir = "asset_other") =>
    resolveOperatorHold({ ...input({ overrideMode: "schedule", overrideAssetId: "", overrideUntil: "" }), ...row, currentAssetId: onAir });

  // How an insert on air ends by itself: its EOF or a crash, its duration bound, a feed watchdog.
  it.each(["", "duration-bound", "feed-stalled"])("holds from the Play now until the insert's exit (%j), then lets go", (plannedReason) => {
    // The admin's Play now / Insert (broadcast.ts) writes pending.
    const pending: InsertFields = { insertAssetId: "asset_other", insertRequestedAt: REQUESTED, insertStatus: "pending" };
    expect(hold(pending, "asset_pin")).toBe("insert");

    // The cycle that starts it marks it active.
    const active = decideCycleEndInsert({ selectionIsOperatorInsert: true, selectedAssetId: "asset_other", row: pending, now: LATER });
    expect(hold(active)).toBe("insert");

    // The exit handler (index.ts) clears the fields when shouldClearInsertOnExit says so (M74: for each of
    // these reasons); an insert left active would start again from 0, and the hold with it.
    const exit = { plannedReason, insertStatus: active.insertStatus, insertAssetId: active.insertAssetId, currentAssetId: "asset_other" };
    const afterExit = shouldClearInsertOnExit(exit) ? EMPTY : active;
    expect(hold(afterExit)).toBe("");

    // The next cycle puts the schedule's item on air and leaves the cleared fields as they are.
    expect(
      hold(decideCycleEndInsert({ selectionIsOperatorInsert: false, selectedAssetId: "asset_pin", row: afterExit, now: LATER }), "asset_pin")
    ).toBe("");
  });

  // Combination review (M79 x M74). A Restart stops the insert as "restart-requested", which keeps it
  // (it is meant to start again); when it cannot be prepared again the recovery plan puts the fallback on
  // air and the cycle-end write leaves the row's insert as it is. The hold must not outlive the insert's
  // time on air: it paused every vote, with the insert line, over the fallback.
  it("lets go when a Restart's re-prepare fails and the fallback takes the air, although the row still says active", () => {
    const active: InsertFields = { insertAssetId: "asset_other", insertRequestedAt: REQUESTED, insertStatus: "active" };
    const exit = { plannedReason: "restart-requested", insertStatus: "active", insertAssetId: "asset_other", currentAssetId: "asset_other" };
    expect(shouldClearInsertOnExit(exit)).toBe(false);
    // Between the stop and the next start nothing is on air and the insert is still the next start.
    expect(hold(active, "")).toBe("insert");
    // The recovery plan's fallback (asset_pin here) is not an operator_insert selection: the row stands.
    const afterRecovery = decideCycleEndInsert({ selectionIsOperatorInsert: false, selectedAssetId: "asset_pin", row: active, now: LATER });
    expect(afterRecovery).toEqual(active);
    expect(hold(afterRecovery, "asset_pin")).toBe("");
  });

  it("never holds for a pool's automatic insert or a cue point insert: the cycle that starts one leaves the fields empty", () => {
    // Both select as scheduled_insert, so the worker passes selectionIsOperatorInsert false
    // (operator-precedence-wiring.test.ts pins that).
    const row = decideCycleEndInsert({ selectionIsOperatorInsert: false, selectedAssetId: "asset_other", row: EMPTY, now: LATER });
    expect(row).toEqual(EMPTY);
    expect(hold(row)).toBe("");
  });
});

describe("formatChatSkipPausedReply", () => {
  it("names what holds the air and when skipping comes back", () => {
    expect(formatChatSkipPausedReply("asset")).toBe(
      "The operator has pinned this item — skip votes are paused until the pin ends."
    );
    expect(formatChatSkipPausedReply("fallback")).toBe(
      "The operator has put the fallback on air — skip votes are paused until it ends."
    );
    // M79: one line for a pending and an active insert.
    expect(formatChatSkipPausedReply("insert")).toBe(
      "The operator is playing an insert — skip votes are paused until it ends."
    );
  });

  it("fits one chat line", () => {
    for (const hold of ["asset", "fallback", "insert"] as const) {
      expect(formatChatSkipPausedReply(hold).length).toBeLessThan(120);
    }
  });
});
