import {
  addDaysToDateString,
  buildScheduleOccurrences,
  toUtcIsoForLocalDateTime,
  type ScheduleBlock
} from "@stream247/core";

// Twitch accepts a segment between 30 and 1380 minutes; anything else is skipped and reported.
const TWITCH_SEGMENT_MIN_MINUTES = 30;
const TWITCH_SEGMENT_MAX_MINUTES = 1380;
// A segment that starts within this lead is left alone: it is about to air or already airing.
const TWITCH_SEGMENT_START_LEAD_MS = 5 * 60_000;

export type PlannedTwitchScheduleSegment = {
  key: string;
  blockId: string;
  title: string;
  categoryName: string;
  startTime: string;
  durationMinutes: number;
};

/**
 * The segments the Twitch schedule should hold for the 7 days from `currentDate`: one per run of a block,
 * keyed by its occurrence key, starting more than five minutes from `now`.
 *
 * A block crossing midnight appears in `buildScheduleOccurrences` twice, as the evening and as the next
 * day's carry-over. The carry-over is the same run, not a second one; sent with its own date and the block's
 * start minute it became a phantom segment a day late (Monday 23:00 also on Tuesday 23:00), so it is left out.
 */
export function planTwitchScheduleSegments(args: {
  blocks: ScheduleBlock[];
  currentDate: string;
  timeZone: string;
  now: Date;
}): { segments: PlannedTwitchScheduleSegment[]; skippedCount: number } {
  const segments: PlannedTwitchScheduleSegment[] = [];
  let skippedCount = 0;

  for (let offset = 0; offset < 7; offset += 1) {
    const date = addDaysToDateString(args.currentDate, offset);
    for (const occurrence of buildScheduleOccurrences({ date, blocks: args.blocks })) {
      if (occurrence.carriesOverFromPreviousDay) {
        continue;
      }
      const startTime = toUtcIsoForLocalDateTime({
        date: occurrence.date,
        minuteOfDay: occurrence.startMinuteOfDay,
        timeZone: args.timeZone
      });
      if (new Date(startTime).getTime() <= args.now.getTime() + TWITCH_SEGMENT_START_LEAD_MS) {
        continue;
      }
      if (occurrence.durationMinutes < TWITCH_SEGMENT_MIN_MINUTES || occurrence.durationMinutes > TWITCH_SEGMENT_MAX_MINUTES) {
        skippedCount += 1;
        continue;
      }
      segments.push({
        key: occurrence.key,
        blockId: occurrence.blockId,
        title: occurrence.title,
        categoryName: occurrence.categoryName,
        startTime,
        durationMinutes: occurrence.durationMinutes
      });
    }
  }

  return { segments, skippedCount };
}
