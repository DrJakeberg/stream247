import {
  addDaysToDateString,
  buildScheduleOccurrences,
  getCurrentScheduleMoment,
  getScheduleInstant,
  getScheduleOccurrenceRunKey,
  type ScheduleBlock,
  type ScheduleOccurrence
} from "@stream247/core";

/**
 * A dated or one-off block takes the air at its start and gives it back at its end (owner decision 5.1 Q1,
 * 2026-10-01: "May a dated block take over the weekly block it overlaps, with the weekly block continuing
 * around it? yes"). Until M105 the worker only changed the pool it consulted: the item on air finished first
 * (graceful handoff), so a one-off 20:00-21:00 on a grid of multi-hour Twitch archives could be swallowed by
 * the archive running at 20:00, while Twitch, `/channel` and the week view announced it at 20:00 (review
 * finding R7, 2026-10-05). Between two weekly blocks the handoff stays graceful, as README and the operators
 * know it.
 *
 * The boundary is seen through the run the playout cycle recorded last (`playout.cuepointWindowKey`, written
 * at the end of every cycle with the run on air then): the first cycle whose run differs is the boundary.
 * Keying it on the last cycle rather than on the item's start keeps the operator's actions winning exactly
 * as they win over the schedule today: a Pin, Fallback, Play now or Live Bridge on air at the boundary
 * selects through its own arm, its cycles record the dated run, and once it ends nothing is cut; the
 * schedule goes on as after any override.
 */
export type ScheduleTakeover = {
  /** The run on air at the last cycle; "" when none was. */
  fromRunKey: string;
  /** The run on air now. */
  toRunKey: string;
  /** Which side is dated: the dated block starts ("start") or ends ("end"). */
  edge: "start" | "end";
};

/**
 * The occurrence a run key names, among the runs of `date` and of the day before (a cycle sees at most the
 * run of the previous minute; across midnight that is the day before). Null when the block was deleted or
 * edited since, so an unknown run never forces a cut.
 */
export function findScheduleRun(args: { runKey: string; date: string; blocks: ScheduleBlock[] }): ScheduleOccurrence | null {
  if (!args.runKey) {
    return null;
  }
  for (const date of [args.date, addDaysToDateString(args.date, -1)]) {
    const match = buildScheduleOccurrences({ date, blocks: args.blocks }).find(
      (occurrence) => getScheduleOccurrenceRunKey(occurrence) === args.runKey
    );
    if (match) {
      return match;
    }
  }
  return null;
}


/** The block a run key names (`<start date>:<block id>:<start minute>:<duration>`); "" for none. */
export function scheduleRunBlockId(runKey: string): string {
  const parts = runKey.split(":");
  return parts.length >= 4 ? parts.slice(1, -2).join(":") : "";
}

/**
 * True while the wall clock shows a minute for the second time: the hour the clock goes back in October in a
 * zone with daylight saving time. Blocks keep their wall-clock times (M101), so on that night a block that
 * ended in the repeated hour comes back after the block that followed it (review finding R8).
 */
export function isRepeatedWallClockMinute(now: Date, timeZone: string): boolean {
  const moment = getCurrentScheduleMoment({ now, timeZone });
  const [hours, minutes] = moment.time.split(":").map((value) => Number(value) || 0);
  const firstPass = getScheduleInstant({ date: moment.date, seconds: (hours * 60 + minutes) * 60, timeZone, ambiguous: "earlier" });
  return now.getTime() - firstPass.getTime() >= 60_000;
}

/**
 * Whether this cycle is a dated block's start or end: the run on air now differs from the last cycle's, and
 * the new run is dated or the one before it was. A dated block ending with no block after it is no takeover
 * (nothing takes the air back), so its item finishes like any block's last item.
 *
 * Two run changes are no boundary (review of M105, 2026-10-05):
 * - A new run of the same block. The run key carries the block's start and length, so an operator who
 *   extends tonight's one-off while it is on air (or edits its whole series) changes the run; read as a
 *   start, that cut the block's own item mid-play for the pool's next pick, and the cut item did not resume.
 *   The same holds for a dated block 24 h long whose next day's run follows its own.
 * - Any change while the wall clock repeats an hour. On the October fall-back night in Europe/Berlin, A
 *   00:00-02:30 and a dated B 02:30-06:00 air A, B from 02:30 CEST, A again from 02:00 CET and B again from
 *   02:30 CET; every change after the clock went back is one the channel has already seen, and each was a cut
 *   (three within an hour, the dated block's first item cut after 30 min). The item on air plays on there, as
 *   at a weekly boundary. A channel on UTC never repeats an hour.
 */
export function decideScheduleTakeover(args: {
  previousRunKey: string;
  current: ScheduleOccurrence | null;
  /** The channel's date now. */
  date: string;
  blocks: ScheduleBlock[];
  /** The instant the cycle judges, and the channel's zone. */
  now: Date;
  timeZone: string;
}): ScheduleTakeover | null {
  if (!args.current) {
    return null;
  }
  const toRunKey = getScheduleOccurrenceRunKey(args.current);
  if (toRunKey === args.previousRunKey || scheduleRunBlockId(args.previousRunKey) === args.current.blockId) {
    return null;
  }
  if (isRepeatedWallClockMinute(args.now, args.timeZone)) {
    return null;
  }
  if (args.current.dated) {
    return { fromRunKey: args.previousRunKey, toRunKey, edge: "start" };
  }
  const previous = findScheduleRun({ runKey: args.previousRunKey, date: args.date, blocks: args.blocks });
  return previous?.dated ? { fromRunKey: args.previousRunKey, toRunKey, edge: "end" } : null;
}

/**
 * What the cycle does when the item a takeover picked cannot be prepared (review of M105, 2026-10-05).
 *
 * At a dated block's start nothing has warmed the new block's first pick (the queue prefetch reads the block
 * on air), so its prepare runs inline. A Twitch archive that is not on disk, with
 * `TWITCH_VOD_CACHE_ALLOW_REMOTE_FALLBACK=0` as in `.env.production.example`, fails it at once while its
 * download runs (52 min for a 19 GB archive on the DUT), and so does a yt-dlp resolve that times out. The
 * catch took that for the programme's failure: the recovery plan cut the healthy item for the global
 * fallback, the generic fallback or the standby slate, and every later cycle picked the archive again and
 * kept the fallback until the download was done.
 *
 * "hold": the item on air plays on (the selection with the takeover set aside keeps it), the cycle records
 * the run before the boundary so that the next cycle tries the takeover again, and meanwhile the queue
 * prefetch warms the new block's pick. The cut comes once it is prepared, or the item ends by itself first.
 * "recover": nothing healthy is on air, a Restart is due, or nothing would keep the item; the recovery plan
 * runs as before.
 */
export function decideTakeoverPrepareFailure(input: {
  /** The selection that failed was a takeover's pick. */
  takeover: boolean;
  /** The playout process still runs. */
  processRunning: boolean;
  /** A Restart is due, which starts the item again from a fresh prepare. */
  restartRequested: boolean;
  /** What the selection picks with the takeover set aside, and what the running process plays. */
  heldAssetId: string;
  runningAssetId: string;
}): "hold" | "recover" {
  return input.takeover &&
    input.processRunning &&
    !input.restartRequested &&
    input.heldAssetId !== "" &&
    input.heldAssetId === input.runningAssetId
    ? "hold"
    : "recover";
}
