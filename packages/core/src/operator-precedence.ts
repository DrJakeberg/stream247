/**
 * Which operator override holds the air right now (M78).
 *
 * One rule for three callers. The playout's override arm (choosePlaybackCandidate) selects a Pin or a
 * Fallback while it runs, its item is ready, and that item is not under a skip hold -- before M78 the arm
 * ignored the hold, so a Skip during a pin started the pinned item again from 0. The admin applies the
 * rule before it accepts a Play now (an insert the arm would preempt) and when Skip ends the override;
 * the worker's chat applies it before a viewer skip vote counts, because viewers never override the
 * operator. A Live Bridge comes before the override arm, so a pin left running under it does not hold
 * the air: without that condition the bot told chat during a live show that the operator had pinned
 * "this item".
 */
export type OperatorOverrideHold = "" | "asset" | "fallback";

export interface OperatorOverrideHoldInput {
  overrideMode: string;
  overrideAssetId: string;
  overrideUntil: string;
  skipAssetId: string;
  skipUntil: string;
  liveBridgeStatus: string;
  liveBridgeInputUrl: string;
  assets: ReadonlyArray<{ id: string; status: string }>;
  nowMs: number;
}

// The worker's isTimestampActive and the admin's isActiveUntil: "" is never active.
function isActiveAt(value: string, nowMs: number): boolean {
  return value !== "" && new Date(value).getTime() > nowMs;
}

export function resolveOperatorOverrideHold(input: OperatorOverrideHoldInput): OperatorOverrideHold {
  if (input.overrideAssetId === "" || !isActiveAt(input.overrideUntil, input.nowMs)) {
    return "";
  }
  // The worker's liveBridgeActive: its live arm returns before the override arm is reached.
  if (input.liveBridgeInputUrl !== "" && (input.liveBridgeStatus === "pending" || input.liveBridgeStatus === "active")) {
    return "";
  }
  if (isActiveAt(input.skipUntil, input.nowMs) && input.skipAssetId === input.overrideAssetId) {
    return "";
  }
  if (!input.assets.some((asset) => asset.id === input.overrideAssetId && asset.status === "ready")) {
    return "";
  }
  return input.overrideMode === "fallback" ? "fallback" : "asset";
}

export interface PassedSkipVoteInput extends OperatorOverrideHoldInput {
  // The item the room voted on, and the item the runtime row has on air when the worker applies the vote.
  votedAssetId: string;
  currentAssetId: string;
}

export type PassedSkipVoteDecision =
  | { kind: "apply" }
  | { kind: "paused"; hold: Exclude<OperatorOverrideHold, ""> }
  | { kind: "stale" };

/**
 * What the worker does with a chat skip vote that passed, judged on the runtime row as it is when the
 * vote is applied (up to a worker cycle after it passed).
 *
 * Under a Pin or Fallback it is paused: viewers never end the operator's override. A vote for an item
 * that is no longer on air, or that a Skip already holds out, is stale and writes nothing. Applied, it
 * replaced the skip hold and set the restart flag: after the operator's Skip had ended a pin, a vote the
 * room had passed on the item before it took the skip hold off the pinned item, and the pool's running
 * item rule restarted that item from 0. The same write restarted whatever came on air after the voted
 * item's natural end.
 */
export function decidePassedSkipVote(input: PassedSkipVoteInput): PassedSkipVoteDecision {
  const hold = resolveOperatorOverrideHold(input);
  if (hold !== "") {
    return { kind: "paused", hold };
  }
  if (input.votedAssetId === "" || input.votedAssetId !== input.currentAssetId) {
    return { kind: "stale" };
  }
  if (isActiveAt(input.skipUntil, input.nowMs) && input.skipAssetId === input.votedAssetId) {
    return { kind: "stale" };
  }
  return { kind: "apply" };
}

/**
 * What the bot says when a viewer asks to skip while the operator holds the air. One line, no operator
 * vocabulary, and it says when skipping comes back: a refusal without a reason is what makes a room type
 * the command again (chat-interaction.ts).
 */
export function formatChatSkipPausedReply(hold: Exclude<OperatorOverrideHold, "">): string {
  return hold === "fallback"
    ? "The operator has put the fallback on air — skip votes are paused until it ends."
    : "The operator has pinned this item — skip votes are paused until the pin ends.";
}
