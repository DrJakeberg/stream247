import {
  addDaysToDateString,
  buildScheduleOccurrences,
  listScheduleAirSegments,
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
 * The segments the Twitch schedule should hold for the 7 days from `currentDate`: one per air window of a
 * run of a block, keyed by its occurrence key, starting more than five minutes from `now`.
 *
 * A block crossing midnight appears in `buildScheduleOccurrences` twice, as the evening and as the next
 * day's carry-over. The carry-over is the same run, not a second one; sent with its own date and the block's
 * start minute it became a phantom segment a day late (Monday 23:00 also on Tuesday 23:00), so it is left out.
 *
 * A weekly block cut around a dated one (M93) is sent as its windows, as on air: weekly 18-22 under a dated
 * 20-21 becomes 18-20, the dated 20-21 and 21-22 (`<key>@<minute>` for the second part). A window under 30
 * minutes is skipped like any short block. A dated run is sent only on the dates it airs.
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
    const runs = buildScheduleOccurrences({ date, blocks: args.blocks }).filter(
      (occurrence) => !occurrence.carriesOverFromPreviousDay
    );
    for (const segment of listScheduleAirSegments(runs)) {
      // A window of a run that crossed midnight may start after 00:00 of the next date.
      const dayShift = Math.floor(segment.airStartMinute / 1440);
      const startTime = toUtcIsoForLocalDateTime({
        date: dayShift === 0 ? segment.date : addDaysToDateString(segment.date, dayShift),
        minuteOfDay: segment.airStartMinute - dayShift * 1440,
        timeZone: args.timeZone
      });
      if (new Date(startTime).getTime() <= args.now.getTime() + TWITCH_SEGMENT_START_LEAD_MS) {
        continue;
      }
      const durationMinutes = segment.airEndMinute - segment.airStartMinute;
      if (durationMinutes < TWITCH_SEGMENT_MIN_MINUTES || durationMinutes > TWITCH_SEGMENT_MAX_MINUTES) {
        skippedCount += 1;
        continue;
      }
      segments.push({
        key: segment.key,
        blockId: segment.blockId,
        title: segment.title,
        categoryName: segment.categoryName,
        startTime,
        durationMinutes
      });
    }
  }

  return { segments, skippedCount };
}
