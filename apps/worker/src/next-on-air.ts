import {
  addDaysToDateString,
  buildScheduleOccurrences,
  findCurrentScheduleOccurrence,
  findNextScheduleOccurrence,
  formatViewerClock,
  getCurrentScheduleMoment,
  getScheduleEndInstant,
  getScheduleInstant,
  getScheduleOccurrenceRunKey,
  getScheduleStartsInMinutes,
  listScheduleAirSegments,
  overlayNextTimeLabel,
  viewerText,
  type ScheduleBlock,
  type ScheduleOccurrence
} from "@stream247/core";
import { decideScheduleTakeover } from "./schedule-takeover.js";

// What airs next (M107), for the on-air Next card, text mode, the slate and the chat bot's !next.
//
// Until M107 the card named the next schedule BLOCK (its first video and its window, "16:00-00:00") while
// !next named the playout's next queue item, so during a three-hour archive the picture announced the
// programme at 16:00 and the chat the next video (owner, 2026-10-06: what interests a viewer is what !next
// says, the next video). Both now ask this one function, with the playout row as it stands.
//
// It predicts what the worker's selection will do when the item on air ends, and nothing more: the item is
// not cut at a weekly block boundary (graceful handoff), so the block that is current at its expected end
// picks, through the same pool rotation and eligibility the worker uses (the caller's pickForBlock); a
// dated or one-off block cuts it at its start or end (M93, M105: schedule-takeover.ts decides which change
// is such a cut), and then that block's first pick is next, at that time. The operator's arms come first in
// the worker and so here: a Pin or Temporary fallback names no video (overrideHolds), a Play now or Insert
// on air is cut by no dated block (operatorInsertOnAir).

export type NextOnAirItem = { assetId: string; title: string };

export type NextOnAirPrediction =
  /** A video, with when it is expected to start; null when the item on air has no known end. */
  | { kind: "item"; assetId: string; title: string; startsAt: Date | null }
  /** Nothing plays, or nothing can be predicted: today's next block, with the title the card gives it. */
  | { kind: "block"; title: string; block: ScheduleOccurrence }
  | { kind: "none" };

/** What the playout row says, or what the playout cycle is about to write into it. */
export type NextOnAirPlayout = {
  /** False while nothing plays (standby, reconnect, off air): the next block is then all there is. */
  playing: boolean;
  /** The head of the queue: "live" for a Live Bridge, "insert" for an insert, "asset" for a video. */
  queueKind: string;
  currentAssetId: string;
  /** When the process playing the item started, ISO; items play from their start (no resume, M77). */
  processStartedAt: string;
  /** The queue's next item; empty when the queue has none. */
  nextAssetId: string;
  nextTitle: string;
  /** The operator's Move next / Replay previous: it takes over at the item's end, whatever block is current. */
  manualNextAssetId: string;
  /**
   * The operator's Play now / Insert: "pending" until the cycle that starts it, then "active" while it is on
   * air (decideCycleEndInsert), its item in insertAssetId.
   */
  insertAssetId: string;
  insertStatus: string;
  /**
   * A Pin or Temporary fallback (the row's override fields): its item and until when. The caller blanks
   * overrideAssetId when the override arm would not select it (core resolveOperatorOverrideHold: not ready,
   * held out by a Skip, under a Live Bridge), so a set id that has not run out means the override holds.
   */
  overrideAssetId: string;
  overrideUntil: string;
  /**
   * The schedule run the playout cycle recorded last (the row's cuepointWindowKey). A dated block's start or
   * end is judged against it, as the worker judges it; a takeover that waits keeps the run before the
   * boundary there. "" when none is recorded.
   */
  cuepointWindowKey: string;
};

/** How the worker sees a block's pick, an asset, and a block's card title; given by the worker. */
export type NextOnAirSources = {
  /** The viewer title and planned length (0 when unknown) of an asset by id; null when it is not known. */
  asset: (assetId: string) => { title: string; durationSeconds: number } | null;
  /** The worker's pick for a block: its pool's rotation from the stored positions, or the block's source. */
  pickForBlock: (block: ScheduleOccurrence) => NextOnAirItem | null;
  /** The card's title for a block: its pool's next video, else the block's own title. */
  blockTitle: (block: ScheduleOccurrence) => string;
};

// An item longer than this is not looked through block by block (a stuck duration, a 24-hour loop): its end
// is then treated as unknown. The longest Twitch archives on the DUT run about 12 hours.
const MAX_LOOKAHEAD_DAYS = 2;

/** The occurrence on air at an instant, as the worker's getCurrentScheduleItem reads it. */
export function scheduleOccurrenceAt(blocks: ScheduleBlock[], at: Date, timeZone: string): ScheduleOccurrence | null {
  const moment = getCurrentScheduleMoment({ now: at, timeZone });
  return findCurrentScheduleOccurrence({
    occurrences: buildScheduleOccurrences({ date: moment.date, blocks }),
    currentTime: moment.time
  });
}

/** Today's next block after `now`, as the worker's getNextScheduleItem reads it. */
export function nextScheduleBlockOfToday(blocks: ScheduleBlock[], now: Date, timeZone: string): ScheduleOccurrence | null {
  const moment = getCurrentScheduleMoment({ now, timeZone });
  const occurrences = buildScheduleOccurrences({ date: moment.date, blocks });
  return findNextScheduleOccurrence({
    occurrences,
    currentTime: moment.time,
    currentOccurrence: findCurrentScheduleOccurrence({ occurrences, currentTime: moment.time })
  });
}

/** Every instant in (from, until) at which an air window starts or ends. */
function listScheduleChanges(blocks: ScheduleBlock[], timeZone: string, from: Date, until: Date): Date[] {
  const lastDate = getCurrentScheduleMoment({ now: until, timeZone }).date;
  const instants = new Set<number>();
  let date = getCurrentScheduleMoment({ now: from, timeZone }).date;
  for (let day = 0; day <= MAX_LOOKAHEAD_DAYS + 1; day += 1) {
    for (const segment of listScheduleAirSegments(buildScheduleOccurrences({ date, blocks }))) {
      const edges = [
        getScheduleInstant({ date, seconds: segment.airStartMinute * 60, timeZone }),
        getScheduleEndInstant({ date, seconds: segment.airEndMinute * 60, timeZone })
      ];
      for (const edge of edges) {
        if (edge.getTime() > from.getTime() && edge.getTime() < until.getTime()) {
          instants.add(edge.getTime());
        }
      }
    }
    if (date === lastDate) {
      break;
    }
    date = addDaysToDateString(date, 1);
  }
  return [...instants].sort((left, right) => left - right).map((ms) => new Date(ms));
}

/**
 * The first dated takeover from now until the item's expected end that has an item to take the air with;
 * `at` is null for one that is due now (the worker's next cycle cuts, at no time worth printing).
 *
 * Judged as the worker judges it (getScheduleTakeover): against the run the playout recorded last, not the
 * run the clock shows now. A takeover without a pick waits and the item plays on (the worker's keep-arms,
 * review of M105), and the cycle records the run before the boundary again, so every later change is judged
 * against that run, and the weekly block coming back after the dated one is no change at all: the item then
 * plays to its end. Seeded from the clock instead, a dated block whose pick was still downloading at 20:10
 * made the card announce a cut at its end, 21:00, that never comes (review of M107).
 */
function findTakeover(args: {
  blocks: ScheduleBlock[];
  timeZone: string;
  now: Date;
  /** The item's expected end; null when unknown, and then only a takeover due now is looked at. */
  endsAt: Date | null;
  recordedRunKey: string;
  pickForBlock: NextOnAirSources["pickForBlock"];
  onAirAssetId: string;
}): { at: Date | null; item: NextOnAirItem } | null {
  // Verbatim, "" included: the worker reads "" before a dated block as a start too.
  let previousRunKey = args.recordedRunKey;
  const instants = [args.now, ...(args.endsAt ? listScheduleChanges(args.blocks, args.timeZone, args.now, args.endsAt) : [])];
  for (const at of instants) {
    const current = scheduleOccurrenceAt(args.blocks, at, args.timeZone);
    const takeover = decideScheduleTakeover({
      previousRunKey,
      current,
      date: getCurrentScheduleMoment({ now: at, timeZone: args.timeZone }).date,
      blocks: args.blocks,
      now: at,
      timeZone: args.timeZone
    });
    if (takeover && current) {
      const pick = args.pickForBlock(current);
      if (at === args.now && pick && args.onAirAssetId && pick.assetId === args.onAirAssetId) {
        // Due now, and its pick is already on air: the cycle that cut to it has not written its run yet (the
        // seconds between the playout's start write and the cycle's end write). It records the new run.
        previousRunKey = getScheduleOccurrenceRunKey(current);
        continue;
      }
      const item = notOnAir(pick, args.onAirAssetId);
      if (item) {
        return { at: at === args.now ? null : at, item };
      }
      continue;
    }
    previousRunKey = current ? getScheduleOccurrenceRunKey(current) : "";
  }
  return null;
}

/**
 * A candidate that is the item on air is no prediction. The queue never names it (getPoolPlaybackQueue
 * leaves it out), so a row that does is the row of the cycle before this item started; a pool's pick is it
 * in the moment before the cycle that started it stores the pool's position. "Next: <what is on air>" is
 * not what a viewer should read from such a stale candidate, so the next one (or the next block) is named
 * instead. The one exception is another pool that will really start it again (predictNextOnAir).
 */
function notOnAir(item: NextOnAirItem | null, onAirAssetId: string): NextOnAirItem | null {
  return item && item.title && !(onAirAssetId && item.assetId === onAirAssetId) ? item : null;
}

/**
 * A Pin or Temporary fallback holds the air (the caller has blanked one the override arm would not select).
 * The arm puts its item on air again whenever it ends until the override runs out; then a pinned item from
 * the running pool's sources plays on to its end and any other gives way to the pool's pick at once
 * (docs/operations.md, Pin on air). Which of these happens is the worker's to decide at that moment, and
 * a short clip pinned for an hour airs a dozen times first, so no video is predicted under it.
 */
function overrideHolds(playout: NextOnAirPlayout, now: Date): boolean {
  const until = Date.parse(playout.overrideUntil);
  return playout.overrideAssetId !== "" && Number.isFinite(until) && until > now.getTime();
}

/**
 * The operator's Play now / Insert is on air: the row's insert names the item on air ("pending" in the cycle
 * that starts it, until its end write says "active"). Its arm returns before the worker looks at a dated
 * block (choosePlaybackCandidate), so nothing cuts it; its cycles record the run on air, and the block
 * current at its end picks (schedule-takeover.ts).
 */
function operatorInsertOnAir(playout: NextOnAirPlayout): boolean {
  return (
    playout.insertAssetId !== "" &&
    playout.insertAssetId === playout.currentAssetId &&
    (playout.insertStatus === "active" || playout.insertStatus === "pending")
  );
}

/** When the item on air is expected to end: its start plus its planned length; null when either is unknown. */
function expectedEndOf(playout: NextOnAirPlayout, sources: NextOnAirSources, now: Date): Date | null {
  if (playout.queueKind === "live" || !playout.currentAssetId) {
    // A Live Bridge runs until the operator releases it.
    return null;
  }
  const startedAt = Date.parse(playout.processStartedAt);
  const durationSeconds = sources.asset(playout.currentAssetId)?.durationSeconds ?? 0;
  if (!Number.isFinite(startedAt) || !(durationSeconds > 0)) {
    return null;
  }
  const endsAt = startedAt + durationSeconds * 1000;
  // Past its planned end the item ends any moment, but not at a time worth printing; far ahead is a length
  // nobody plans (see MAX_LOOKAHEAD_DAYS).
  if (endsAt <= now.getTime() || endsAt - now.getTime() > MAX_LOOKAHEAD_DAYS * 86_400_000) {
    return null;
  }
  return new Date(endsAt);
}

/**
 * What airs next, and from when. In order:
 * - a Pin or Temporary fallback holds the air: today's next block (overrideHolds says why)
 * - an operator Play now / Insert waiting for the next cycle (it cuts whatever is on air)
 * - nothing plays: today's next block
 * - a dated or one-off block that takes the air before the item on air ends: its first pick, at that time
 *   (without a time when it is due now and waits for its pick to be prepared); never over a Live Bridge
 *   or the operator's Play now / Insert, which no dated block cuts
 * - the end is unknown (a Live Bridge, no length): the queue's next item, without a time
 * - the operator's Move next: at the item's end, whatever block is current then
 * - the item ends inside the block it plays in (or one with the same pool): the queue's next item
 * - it ends in another block (items are not cut at weekly boundaries): that block's pick
 * - anything that leaves no item: today's next block.
 */
export function predictNextOnAir(args: {
  playout: NextOnAirPlayout;
  now: Date;
  timeZone: string;
  scheduleBlocks: ScheduleBlock[];
  sources: NextOnAirSources;
}): NextOnAirPrediction {
  const { playout, now, timeZone, sources } = args;
  const blocks = args.scheduleBlocks;
  const onAirAssetId = playout.playing ? playout.currentAssetId : "";
  const onAirTitle = onAirAssetId ? sources.asset(onAirAssetId)?.title ?? "" : "";
  const fallback = (): NextOnAirPrediction => {
    const block = nextScheduleBlockOfToday(blocks, now, timeZone);
    if (!block) {
      return { kind: "none" };
    }
    // The card's title for a block is its pool's next video, and two pools that share a source (Twitch and
    // TwitchYoutube on the DUT) can both have the video on air next: "Next: <what is on air> · 16:00-00:00"
    // is the very card the owner reported (review of M107). The block's own name says what comes then.
    const title = sources.blockTitle(block);
    return { kind: "block", title: title && title !== onAirTitle ? title : block.title, block };
  };
  const item = (next: NextOnAirItem, startsAt: Date | null): NextOnAirPrediction => ({ kind: "item", ...next, startsAt });

  if (overrideHolds(playout, now)) {
    // Before the pending insert: the override arm comes first and drops a Play now under a Pin as preempted.
    return fallback();
  }

  const pendingInsert =
    playout.insertStatus === "pending" && playout.insertAssetId
      ? notOnAir({ assetId: playout.insertAssetId, title: sources.asset(playout.insertAssetId)?.title ?? "" }, onAirAssetId)
      : null;
  if (pendingInsert) {
    return item(pendingInsert, null);
  }
  if (!playout.playing) {
    return fallback();
  }

  const queued = notOnAir(playout.nextTitle ? { assetId: playout.nextAssetId, title: playout.nextTitle } : null, onAirAssetId);
  const endsAt = expectedEndOf(playout, sources, now);
  const takeover =
    playout.queueKind === "live" || operatorInsertOnAir(playout)
      ? null
      : findTakeover({
          blocks,
          timeZone,
          now,
          endsAt,
          recordedRunKey: playout.cuepointWindowKey,
          pickForBlock: sources.pickForBlock,
          onAirAssetId
        });
  if (takeover) {
    return item(takeover.item, takeover.at);
  }
  if (!endsAt) {
    return queued ? item(queued, null) : fallback();
  }
  if (queued && playout.manualNextAssetId && queued.assetId === playout.manualNextAssetId) {
    return item(queued, endsAt);
  }

  const blockNow = scheduleOccurrenceAt(blocks, now, timeZone);
  const blockAtEnd = scheduleOccurrenceAt(blocks, endsAt, timeZone);
  const sameBlock =
    blockNow && blockAtEnd
      ? getScheduleOccurrenceRunKey(blockNow) === getScheduleOccurrenceRunKey(blockAtEnd) ||
        Boolean(blockNow.poolId && blockNow.poolId === blockAtEnd.poolId)
      : !blockNow && !blockAtEnd;
  if (sameBlock && queued) {
    return item(queued, endsAt);
  }
  const pick = blockAtEnd ? sources.pickForBlock(blockAtEnd) : null;
  // Another pool picking the video on air is no stale row: that pool's position never moved past it (each
  // pool keeps its own, pool-rotation.ts), and its rotation does not leave out what just played, so the
  // worker starts the same video again at its end. That is what airs, so that is what is named.
  const replay = !sameBlock && pick?.title && onAirAssetId && pick.assetId === onAirAssetId ? pick : null;
  const predicted = replay ?? notOnAir(pick, onAirAssetId);
  return predicted ? item(predicted, endsAt) : fallback();
}

/**
 * The Next card's title and time from a prediction (M107). A video gets the time it is expected to start, as
 * the on-air clock writes it ("about 16:20", "ca. 16:20"), or no time; never a block's window, which is what
 * the card showed for a video before. A block keeps its window and "in N min" (M100). No next item at all
 * leaves the title empty for the caller's own wording, and the time is the no-next-block text.
 */
export function nextOnAirCardText(args: {
  prediction: NextOnAirPrediction;
  locale: string;
  timeZone: string;
  now: Date;
}): { nextTitle: string; nextTimeLabel: string } {
  const { prediction } = args;
  if (prediction.kind === "item") {
    const time = prediction.startsAt ? formatViewerClock(args.locale, prediction.startsAt, args.timeZone) : "";
    return {
      nextTitle: prediction.title,
      nextTimeLabel: time ? viewerText(args.locale, "overlay.next.expectedAt", { time }) : ""
    };
  }
  if (prediction.kind === "block") {
    const startsInMinutes = getScheduleStartsInMinutes(prediction.block, args.now, args.timeZone);
    return { nextTitle: prediction.title, nextTimeLabel: overlayNextTimeLabel(prediction.block, args.locale, startsInMinutes) };
  }
  return { nextTitle: "", nextTimeLabel: overlayNextTimeLabel(null, args.locale) };
}
