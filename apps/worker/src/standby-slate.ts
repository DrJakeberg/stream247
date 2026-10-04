import {
  buildScheduleOccurrences,
  findCurrentScheduleOccurrence,
  getCurrentScheduleMoment,
  getScheduleStartsInMinutes,
  listUpcomingScheduleOccurrences,
  overlayNextTimeLabel,
  viewerText
} from "@stream247/core";

// The standby and reconnect slate (M102).
//
// The slate is what viewers see when nothing titled is on air. Its plain-text lines always came from
// here; the scene picture did not. The scene renderer draws whatever payload was cached last, and only
// a programme or a Live Bridge cached one, so in scene mode a standby kept the lower third of the item
// that played before it: its title, under "Now playing", as if it were still on air. The worker now
// caches the payload built from these fields whenever it writes the slate.

type ScheduleBlocks = Parameters<typeof buildScheduleOccurrences>[0]["blocks"];
type ScheduleOccurrence = ReturnType<typeof buildScheduleOccurrences>[number];

export type StandbySlateQueueKind = "standby" | "reconnect" | "live";

/**
 * The kind the slate is drawn as.
 *
 * Callers pass the head of the queue, which can name the asset that is about to play. The slate is
 * not that asset, and drawn as one it reads "Now playing" over the schedule's title. Only the three
 * kinds a slate stands for are kept; everything else is a standby.
 */
export function resolveStandbySlateQueueKind(kind: string | null | undefined): StandbySlateQueueKind {
  return kind === "reconnect" || kind === "live" ? kind : "standby";
}

export type StandbySlateSceneInput = {
  queueKind: StandbySlateQueueKind;
  currentTitle: string;
  nextTitle: string;
  nextScheduleItem: ScheduleOccurrence | null;
  nextTimeLabel: string;
  currentCategory?: string;
  currentSourceName?: string;
  queueTitles: string[];
};

/**
 * What the slate says, from the schedule alone.
 *
 * Deliberately takes nothing about the programme that played before: not the playout row's current
 * title, not an asset. The current block's title (or "Standby") and the next block are all a slate
 * can truthfully name.
 */
export function buildStandbySlateSceneInput(args: {
  now: Date;
  timeZone: string;
  locale: string;
  scheduleBlocks: ScheduleBlocks;
  queuePreviewCount: number;
  queueKind: string | null | undefined;
}): StandbySlateSceneInput {
  const scheduleMoment = getCurrentScheduleMoment({ now: args.now, timeZone: args.timeZone });
  const occurrences = buildScheduleOccurrences({ date: scheduleMoment.date, blocks: args.scheduleBlocks });
  const currentItem = findCurrentScheduleOccurrence({ occurrences, currentTime: scheduleMoment.time });
  const upcomingItems = listUpcomingScheduleOccurrences({
    occurrences,
    currentTime: scheduleMoment.time,
    currentOccurrence: currentItem
  });
  const nextItem = upcomingItems[0] ?? null;

  return {
    queueKind: resolveStandbySlateQueueKind(args.queueKind),
    currentTitle: currentItem?.title || viewerText(args.locale, "overlay.title.standby"),
    nextTitle: nextItem ? nextItem.title : viewerText(args.locale, "overlay.next.resumesShortly"),
    nextScheduleItem: nextItem,
    nextTimeLabel: overlayNextTimeLabel(nextItem, args.locale, getScheduleStartsInMinutes(nextItem, args.now, args.timeZone)),
    currentCategory: currentItem?.categoryName,
    currentSourceName: currentItem?.sourceName,
    queueTitles: upcomingItems.slice(0, args.queuePreviewCount).map((item) => item.title)
  };
}

/**
 * Whether a starting playout has to build the scene payload before its first frame.
 *
 * Always when none is cached. Also when a programme starts over a cached slate: the first frame is
 * drawn before the cycle writes the programme's own payload, and it would otherwise show the
 * standby lower third over the new item for that first moment.
 */
export function shouldPrimeScenePayload(args: {
  hasPayload: boolean;
  payloadIsSlate: boolean;
  startingAsset: boolean;
}): boolean {
  return !args.hasPayload || (args.payloadIsSlate && args.startingAsset);
}
