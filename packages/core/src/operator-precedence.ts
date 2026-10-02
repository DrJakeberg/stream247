import { viewerText } from "./viewer-messages/index.js";

/**
 * Which operator override holds the air right now (M78).
 *
 * One rule for three callers. The playout's override arm (choosePlaybackCandidate) selects a Pin or a
 * Fallback while it runs, its item is ready, and that item is not under a skip hold -- before M78 the arm
 * ignored the hold, so a Skip during a pin started the pinned item again from 0. The admin applies the
 * rule before it accepts a Play now (an insert the arm would preempt) and when Skip ends the override;
 * the worker's chat applies it (through resolveOperatorHold, which adds the operator's insert: M79) before
 * a viewer skip vote counts, because viewers never override the operator. A Live Bridge comes before the
 * override arm, so a pin left running under it does not hold the air: without that condition the bot
 * told chat during a live show that the operator had pinned "this item".
 */
export type OperatorOverrideHold = "" | "asset" | "fallback";

export interface OperatorOverrideHoldInput {
  overrideMode: string;
  overrideAssetId: string;
  overrideUntil: string;
  skipAssetId: string;
  skipUntil: string;
  // The Remove next hold (M89), its own field beside the skip hold. Optional: callers before M89 had none.
  removeNextAssetId?: string;
  removeNextUntil?: string;
  liveBridgeStatus: string;
  liveBridgeInputUrl: string;
  assets: ReadonlyArray<{ id: string; status: string }>;
  nowMs: number;
}

// The worker's isTimestampActive and the admin's isActiveUntil: "" is never active.
function isActiveAt(value: string, nowMs: number): boolean {
  return value !== "" && new Date(value).getTime() > nowMs;
}

// The worker's liveBridgeActive: its live arm returns before the override and insert arms are reached.
function liveBridgeTakesAir(input: OperatorOverrideHoldInput): boolean {
  return input.liveBridgeInputUrl !== "" && (input.liveBridgeStatus === "pending" || input.liveBridgeStatus === "active");
}

// What the override and insert arms both ask of the operator's item: ready, and not held out by a Skip
// or a Remove next.
function operatorItemSelectable(input: OperatorOverrideHoldInput, assetId: string): boolean {
  if (isAssetHeldOut(input, assetId, input.nowMs)) {
    return false;
  }
  return input.assets.some((asset) => asset.id === assetId && asset.status === "ready");
}

export interface AssetHoldsInput {
  skipAssetId: string;
  skipUntil: string;
  removeNextAssetId?: string;
  removeNextUntil?: string;
}

/**
 * The items the runtime row holds out of every selection arm right now: the skip hold (Skip, a passed
 * chat vote) and the Remove next hold (M89). Two fields on purpose: they shared one, so a Skip or a vote
 * that moved the skip hold to the item on air lifted the operator's Remove next, and the removed item
 * aired next (owner decision 2026-10-01, Q5: Remove next survives Skip and votes).
 */
export function heldOutAssetIds(input: AssetHoldsInput, nowMs: number): string[] {
  const held: string[] = [];
  if (input.skipAssetId !== "" && isActiveAt(input.skipUntil, nowMs)) {
    held.push(input.skipAssetId);
  }
  const removeNextAssetId = input.removeNextAssetId ?? "";
  if (removeNextAssetId !== "" && isActiveAt(input.removeNextUntil ?? "", nowMs) && !held.includes(removeNextAssetId)) {
    held.push(removeNextAssetId);
  }
  return held;
}

export function isAssetHeldOut(input: AssetHoldsInput, assetId: string, nowMs: number): boolean {
  return assetId !== "" && heldOutAssetIds(input, nowMs).includes(assetId);
}

export function resolveOperatorOverrideHold(input: OperatorOverrideHoldInput): OperatorOverrideHold {
  if (input.overrideAssetId === "" || !isActiveAt(input.overrideUntil, input.nowMs)) {
    return "";
  }
  if (liveBridgeTakesAir(input) || !operatorItemSelectable(input, input.overrideAssetId)) {
    return "";
  }
  return input.overrideMode === "fallback" ? "fallback" : "asset";
}

/**
 * What holds the air against a chat skip vote (M79): the Pin or Fallback above, or else the operator's
 * Play now / Insert, pending or on air. Owner decision 2026-10-01: a chat vote may not skip an operator
 * insert either. Before, a passed vote ran the operator's Skip on it, and the insert was cut.
 *
 * Only the chat asks this. The override arm, the Play now refusal and the admin's Skip keep
 * resolveOperatorOverrideHold: an insert is not an override, and the arm would select its item as one.
 *
 * The insert fields name only the operator's insert: Play now and Insert write `pending` (admin), the
 * cycle that starts it writes `active` (decideCycleEndInsert, only for an `operator_insert` selection).
 * A pool's automatic insert and a cue point insert select as `scheduled_insert` and never touch them,
 * so they stay skippable as before -- they are the schedule's content, not the operator's.
 *
 * In the worker's selection order: the live arm first, the override arm next (a pending insert under a
 * Pin is dropped as `preempted`, and the Pin's line is the true one), then the insert arm, which picks
 * the insert only while its item is ready and not skip-held. The operator's Skip of the insert writes
 * that skip hold, so the insert ends as before and votes count again.
 *
 * An `active` insert holds only while no other item is on air (combination review). The row can say
 * `active` while the fallback plays: an insert on air whose Restart, or whose playout container's
 * redeploy, could not prepare it again is covered by the recovery plan, and the row keeps the insert
 * until the next cycle ends it. Reading the status alone, the bot told chat "the operator is playing an
 * insert" over the fallback and refused every vote. Nothing on air ("") still holds: that is the gap of
 * a Restart, or the reconnect slate of direct mode, after which the insert starts again.
 */
export type OperatorHold = OperatorOverrideHold | "insert";

export interface OperatorHoldInput extends OperatorOverrideHoldInput {
  insertAssetId: string;
  insertStatus: string;
  // The item the runtime row has on air, "" for none.
  currentAssetId: string;
}

export function resolveOperatorHold(input: OperatorHoldInput): OperatorHold {
  const overrideHold = resolveOperatorOverrideHold(input);
  if (overrideHold !== "") {
    return overrideHold;
  }
  if (input.insertAssetId === "" || (input.insertStatus !== "pending" && input.insertStatus !== "active")) {
    return "";
  }
  if (liveBridgeTakesAir(input) || !operatorItemSelectable(input, input.insertAssetId)) {
    return "";
  }
  if (input.insertStatus === "active" && input.currentAssetId !== "" && input.currentAssetId !== input.insertAssetId) {
    return "";
  }
  return "insert";
}

export interface PassedSkipVoteInput extends OperatorHoldInput {
  // The item the room voted on; currentAssetId is the row's item on air when the worker applies the vote.
  votedAssetId: string;
}

export type PassedSkipVoteDecision =
  | { kind: "apply" }
  | { kind: "paused"; hold: Exclude<OperatorHold, ""> }
  | { kind: "stale" };

/**
 * What the worker does with a chat skip vote that passed, judged on the runtime row as it is when the
 * vote is applied (up to a worker cycle after it passed).
 *
 * Under a Pin or Fallback it is paused: viewers never end the operator's override; under the operator's
 * Play now / Insert too (M79): a vote the room passed before the cycle saw the insert is not applied
 * either, so it neither cuts the insert nor restarts playout while the insert is about to start. A vote
 * for an item that is no longer on air, or that a Skip already holds out, is stale and writes nothing.
 * Applied, it replaced the skip hold and set the restart flag: after the operator's Skip had ended a pin,
 * a vote the room had passed on the item before it took the skip hold off the pinned item, and the pool's
 * running item rule restarted that item from 0. The same write restarted whatever came on air after the
 * voted item's natural end.
 */
export function decidePassedSkipVote(input: PassedSkipVoteInput): PassedSkipVoteDecision {
  const hold = resolveOperatorHold(input);
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
export function formatChatSkipPausedReply(hold: Exclude<OperatorHold, "">, locale?: string): string {
  if (hold === "insert") {
    // One line for a pending and an active insert: the pending one takes the air at the next cycle.
    return viewerText(locale, "chat.skip.pausedInsert");
  }
  return viewerText(locale, hold === "fallback" ? "chat.skip.pausedFallback" : "chat.skip.pausedPin");
}
