import { describe, expect, it } from "vitest";
import {
  findNextScheduleOccurrenceAcrossDays,
  listUpcomingScheduleOccurrencesAcrossDays,
  type ScheduleBlock
} from "@stream247/core";

const block = (id: string, dayOfWeek: number, startMinuteOfDay: number, durationMinutes: number): ScheduleBlock => ({
  id,
  title: id,
  categoryName: "Archive",
  sourceName: "Pool",
  dayOfWeek,
  startMinuteOfDay,
  durationMinutes
});

// 2026-10-05 is a Monday.
const blocks = [
  block("mon-evening", 1, 20 * 60, 240),
  block("tue-night", 2, 0, 360),
  block("tue-day", 2, 6 * 60, 14 * 60),
  // Crosses into Wednesday; its carry-over must not be listed again on Wednesday.
  block("tue-late", 2, 23 * 60, 120),
  block("wed-day", 3, 60, 19 * 60)
];

describe("upcoming schedule occurrences across days", () => {
  it("lists in airing order across midnight, starting with what findNext answers", () => {
    const upcoming = listUpcomingScheduleOccurrencesAcrossDays({ blocks, date: "2026-10-05", currentTime: "21:00", limit: 4 });

    expect(upcoming.map((occurrence) => occurrence.blockId)).toEqual(["tue-night", "tue-day", "tue-late", "wed-day"]);
    expect(upcoming[0]?.key).toBe(
      findNextScheduleOccurrenceAcrossDays({ blocks, date: "2026-10-05", currentTime: "21:00" })?.key
    );
  });

  it("starts with what is still ahead today and leaves out the block on air", () => {
    const upcoming = listUpcomingScheduleOccurrencesAcrossDays({ blocks, date: "2026-10-06", currentTime: "07:00", limit: 2 });

    expect(upcoming.map((occurrence) => occurrence.blockId)).toEqual(["tue-late", "wed-day"]);
  });

  it("returns nothing for an empty grid or a zero limit", () => {
    expect(listUpcomingScheduleOccurrencesAcrossDays({ blocks: [], date: "2026-10-05", currentTime: "21:00", limit: 3 })).toEqual([]);
    expect(listUpcomingScheduleOccurrencesAcrossDays({ blocks, date: "2026-10-05", currentTime: "21:00", limit: 0 })).toEqual([]);
  });
});
