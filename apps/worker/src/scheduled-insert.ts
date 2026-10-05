/**
 * Scheduled inserts (a pool's "insert every N items" and a block's cuepoints) from a remote source (M94,
 * R3 W1 in planning/research/robustness.md).
 *
 * A YouTube or Twitch insert never aired. The rotation leaves the insert out, so the queue scan never
 * warmed it; at the boundary it was cold, the local fallback was bridged in, and because the insert had
 * not started, neither the pool's counter nor the cuepoint was used up. The next boundary picked it again,
 * cold again, and the fallback flashed at every item boundary from then on. The owner's decision (Q6): an
 * insert that cannot be prepared is skipped once, counts as played, and raises an incident naming it.
 *
 * No I/O here; the worker applies what these decide.
 */

import { carryCuepointFiredKeys } from "@stream247/core";

export type ScheduledInsertTrigger = "pool-interval" | "cuepoint" | "";

export interface PoolInsertDueInput {
  insertAssetId: string;
  insertEveryItems: number;
  itemsSinceInsert: number;
  // The cycle starts a scheduled item that counts towards the cadence (selectionTakesPoolPosition).
  selectionTakesPosition: boolean;
  // The cycle's selection is a scheduled insert itself: the counter is reset when it starts.
  selectionIsScheduledInsert: boolean;
}

/**
 * Whether the pool's interval insert is the item after the one on air, so the queue scan warms it now.
 * The counter grows when a scheduled item starts; the insert is picked at the boundary where it has
 * reached the cadence.
 */
export function isPoolIntervalInsertDueNext(input: PoolInsertDueInput): boolean {
  if (!input.insertAssetId || input.insertEveryItems <= 0 || input.selectionIsScheduledInsert) {
    return false;
  }
  return input.itemsSinceInsert + (input.selectionTakesPosition ? 1 : 0) >= input.insertEveryItems;
}

export interface CuepointFields {
  cuepointWindowKey: string;
  cuepointFiredKeys: string[];
}

export interface ScheduledInsertSkipInput {
  trigger: ScheduledInsertTrigger;
  cuepointKey: string;
  // The run of the block on air (getScheduleOccurrenceRunKey); "" without one.
  runKey: string;
  playout: CuepointFields;
}

export interface ScheduledInsertSkip {
  // Reset the pool's items-since-insert counter, as a started interval insert does.
  resetItemsSinceInsert: boolean;
  // The cuepoint fields with this cuepoint fired, as a started cuepoint insert leaves them; null when
  // nothing changes.
  cuepoint: CuepointFields | null;
}

/**
 * What a scheduled insert that was bridged or failed to prepare uses up: exactly what starting it would
 * have used up, so the schedule goes on as if it had aired (owner Q6). Before M94 neither was written and
 * the same insert was due again at the next boundary, for good.
 */
export function decideScheduledInsertSkip(input: ScheduledInsertSkipInput): ScheduledInsertSkip {
  if (input.trigger === "pool-interval") {
    return { resetItemsSinceInsert: true, cuepoint: null };
  }
  if (input.trigger !== "cuepoint" || !input.cuepointKey || !input.runKey) {
    return { resetItemsSinceInsert: false, cuepoint: null };
  }
  const fired = carryCuepointFiredKeys({
    previousRunKey: input.playout.cuepointWindowKey,
    firedKeys: input.playout.cuepointFiredKeys,
    runKey: input.runKey
  });
  if (!fired.includes(input.cuepointKey)) {
    fired.push(input.cuepointKey);
  }
  return { resetItemsSinceInsert: false, cuepoint: { cuepointWindowKey: input.runKey, cuepointFiredKeys: fired } };
}

// open-failed (R13): started twice, the second time with the next format candidate, and refused both times.
export type ScheduledInsertSkipReason = "bridged" | "prepare-failed" | "start-failed" | "open-failed";

/** The incident's message: names the insert and says that the schedule goes on without it. */
export function describeSkippedInsert(input: {
  title: string;
  trigger: ScheduledInsertTrigger;
  reason: ScheduledInsertSkipReason;
  error?: string;
}): string {
  // The exit handler that reports an open failure no longer knows the trigger.
  const kind = input.trigger === "cuepoint" ? "Cuepoint insert" : input.trigger === "pool-interval" ? "Pool insert" : "Scheduled insert";
  const verb = input.reason === "start-failed" ? "started" : input.reason === "open-failed" ? "opened, on two tries" : "prepared";
  const why =
    input.reason === "bridged"
      ? "was not ready when it was due (its source needs a remote resolve that had not finished)"
      : `could not be ${verb}${input.error ? ` (${input.error.slice(0, 200)})` : ""}`;
  return `${kind} ${input.title} ${why}, so it was skipped once and counted as played. The schedule continues; the next insert is tried as usual.`;
}

export interface RunningScheduledInsertInput {
  processRunning: boolean;
  // A dated block's start or end (schedule-takeover.ts, R7): the new block takes the air from any item.
  scheduleTakeover: boolean;
  // The runtime row the cycle selected from: what is on air and why it was started.
  runtimeReasonCode: string;
  runtimeCurrentAssetId: string;
  // The item the running process plays (the worker's own record): a row that names another item is stale,
  // and holding it would start an insert that has ended again from 0.
  runningAssetId: string;
  // The skip hold and the Remove next hold in force (core heldOutAssetIds).
  heldOutAssetIds: string[];
}

/**
 * Whether the scheduled insert on air keeps the air until its end (review finding R11, 2026-10-05).
 *
 * A pool's interval insert or a block's cuepoint item is used up when it starts: the counter is reset and
 * the cuepoint fired by that cycle, so from the next cycle on neither insert arm names it. Only the pool
 * arm could hold it, and only when the item came from one of the pool's own sources. A sting from another
 * source (the admin offers every ready item as a pool insert or a cuepoint item, so a YouTube or local
 * sting under a pool of Twitch archives is the ordinary case) was cut 15 s later for the pool's next pick,
 * as-run `switch` -- since v2.1.0, and M94's own fixture hid it by putting the sting's source into the pool.
 *
 * Held means selected again as the same scheduled insert with no trigger: the cycle-end write leaves the
 * fired cuepoints and the counter alone (no trigger, and the item is already the one on air), so holding
 * it uses up nothing a second time. A Skip or Remove next of it, a dated block's takeover and every
 * operator arm (which come first) still end it; its natural end or its duration bound ends it as before.
 */
export function keepsRunningScheduledInsert(input: RunningScheduledInsertInput): boolean {
  return (
    input.processRunning &&
    !input.scheduleTakeover &&
    input.runtimeReasonCode === "scheduled_insert" &&
    input.runtimeCurrentAssetId !== "" &&
    input.runningAssetId === input.runtimeCurrentAssetId &&
    !input.heldOutAssetIds.includes(input.runtimeCurrentAssetId)
  );
}
