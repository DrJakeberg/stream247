import { describe, expect, it } from "vitest";
import {
  decidePassedSkipVote,
  formatChatSkipPausedReply,
  resolveOperatorOverrideHold,
  type OperatorOverrideHoldInput,
  type PassedSkipVoteInput
} from "@stream247/core";

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
    ["the voted item's own earlier hold ran out", { skipAssetId: "asset_other", skipUntil: EARLIER }, { kind: "apply" }]
  ])("%s", (_name, overrides, expected) => {
    expect(decidePassedSkipVote(vote(overrides))).toEqual(expected);
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
  });

  it("fits one chat line", () => {
    for (const hold of ["asset", "fallback"] as const) {
      expect(formatChatSkipPausedReply(hold).length).toBeLessThan(120);
    }
  });
});
