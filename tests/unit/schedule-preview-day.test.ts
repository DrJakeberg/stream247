import { describe, expect, it } from "vitest";
import { buildScheduleOccurrences, shiftDateToDayOfWeek } from "@stream247/core";

// The schedule page's video timeline was empty on six days out of seven.
//
// A preview is built for a *date*, because resolving a pool into the individual videos that would
// play needs one. The page built it for today and then filtered the result by whichever day the
// user had selected — so every day except today's weekday matched nothing. The day selector could
// not reach the data it was selecting.

describe("resolving a weekday to a date", () => {
  // 2026-08-19 is a Wednesday (UTC day 3).
  const wednesday = "2026-08-19";

  it("returns the same date when it already is that weekday", () => {
    expect(shiftDateToDayOfWeek(wednesday, 3)).toBe(wednesday);
  });

  it("moves forward within the week", () => {
    expect(shiftDateToDayOfWeek(wednesday, 4)).toBe("2026-08-20");
    expect(shiftDateToDayOfWeek(wednesday, 6)).toBe("2026-08-22");
  });

  it("wraps to next week rather than looking backwards", () => {
    // Monday is behind us; the preview should describe programming still ahead.
    expect(shiftDateToDayOfWeek(wednesday, 1)).toBe("2026-08-24");
    expect(shiftDateToDayOfWeek(wednesday, 0)).toBe("2026-08-23");
  });

  it("crosses a month boundary", () => {
    expect(shiftDateToDayOfWeek("2026-08-31", 2)).toBe("2026-09-01");
  });

  it("returns the input unchanged rather than throwing on a malformed date", () => {
    expect(shiftDateToDayOfWeek("not-a-date", 3)).toBe("not-a-date");
  });

  it("normalises a weekday outside 0-6", () => {
    expect(shiftDateToDayOfWeek(wednesday, 10)).toBe(shiftDateToDayOfWeek(wednesday, 3));
    expect(shiftDateToDayOfWeek(wednesday, -4)).toBe(shiftDateToDayOfWeek(wednesday, 3));
  });
});

describe("occurrences for each weekday", () => {
  const blocks = [1, 2, 3, 4, 5, 6, 0].map((dayOfWeek) => ({
    id: `block-${dayOfWeek}`,
    title: `Day ${dayOfWeek}`,
    categoryName: "Replay",
    dayOfWeek,
    startMinuteOfDay: 10 * 60,
    durationMinutes: 60,
    poolId: "pool-1",
    sourceName: "Pool",
    repeatMode: "weekly" as const,
    repeatGroupId: ""
  }));

  it("yields the block for every weekday once the date matches it", () => {
    // Exactly what the page now does: resolve the selected weekday to a date first.
    for (const dayOfWeek of [0, 1, 2, 3, 4, 5, 6]) {
      const date = shiftDateToDayOfWeek("2026-08-19", dayOfWeek);
      const occurrences = buildScheduleOccurrences({ date, blocks });

      expect(occurrences.map((occurrence) => occurrence.blockId)).toContain(`block-${dayOfWeek}`);
    }
  });

  it("shows why filtering a single day's preview by weekday came up empty", () => {
    // One date only ever produces its own weekday (plus anything carried over from the day before).
    const occurrences = buildScheduleOccurrences({ date: "2026-08-19", blocks });
    const weekdays = new Set(occurrences.map((occurrence) => occurrence.dayOfWeek));

    expect(weekdays.has(3)).toBe(true);
    expect(weekdays.has(5)).toBe(false);
  });
});
