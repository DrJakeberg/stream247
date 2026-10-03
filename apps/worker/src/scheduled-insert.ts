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
  const fired = input.playout.cuepointWindowKey === input.runKey ? [...input.playout.cuepointFiredKeys] : [];
  if (!fired.includes(input.cuepointKey)) {
    fired.push(input.cuepointKey);
  }
  return { resetItemsSinceInsert: false, cuepoint: { cuepointWindowKey: input.runKey, cuepointFiredKeys: fired } };
}

export type ScheduledInsertSkipReason = "bridged" | "prepare-failed";

/** The incident's message: names the insert and says that the schedule goes on without it. */
export function describeSkippedInsert(input: {
  title: string;
  trigger: ScheduledInsertTrigger;
  reason: ScheduledInsertSkipReason;
  error?: string;
}): string {
  const kind = input.trigger === "cuepoint" ? "Cuepoint insert" : "Pool insert";
  const why =
    input.reason === "bridged"
      ? "was not ready when it was due (its source needs a remote resolve that had not finished)"
      : `could not be prepared${input.error ? ` (${input.error.slice(0, 200)})` : ""}`;
  return `${kind} ${input.title} ${why}, so it was skipped once and counted as played. The schedule continues; the next insert is tried as usual.`;
}
