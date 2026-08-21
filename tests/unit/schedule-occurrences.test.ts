import { describe, expect, it } from "vitest";
import {
  buildScheduleOccurrences,
  findCurrentScheduleOccurrence,
  findNextScheduleOccurrence,
  getScheduleOccurrenceMinuteRange,
  isScheduleOccurrenceOnAir,
  listUpcomingScheduleOccurrences,
  type ScheduleBlock
} from "@stream247/core";

// 2026-04-06 is a Monday, so dayOfWeek 1 == Monday throughout.
const MONDAY = "2026-04-06";
const TUESDAY = "2026-04-07";
const SUNDAY = "2026-04-05";

function block(overrides: Partial<ScheduleBlock> & Pick<ScheduleBlock, "id" | "dayOfWeek" | "startMinuteOfDay" | "durationMinutes">): ScheduleBlock {
  return {
    title: overrides.id,
    categoryName: "Category",
    sourceName: "Source",
    showId: "show-1",
    poolId: "pool-1",
    ...overrides
  } as ScheduleBlock;
}

describe("buildScheduleOccurrences", () => {
  it("returns the blocks scheduled on that weekday", () => {
    const occurrences = buildScheduleOccurrences({
      date: MONDAY,
      blocks: [
        block({ id: "morning", dayOfWeek: 1, startMinuteOfDay: 8 * 60, durationMinutes: 60 }),
        block({ id: "tuesday-only", dayOfWeek: 2, startMinuteOfDay: 8 * 60, durationMinutes: 60 })
      ]
    });

    expect(occurrences.map((entry) => entry.blockId)).toEqual(["morning"]);
  });

  it("carries a block that runs past midnight into the following day", () => {
    // The bug this guards: filtering only on the weekday of the queried date dropped the block at
    // 00:00 and the channel fell out of its programmed pool for the rest of the night.
    const blocks = [block({ id: "overnight", dayOfWeek: 1, startMinuteOfDay: 23 * 60, durationMinutes: 120 })];

    const monday = buildScheduleOccurrences({ date: MONDAY, blocks });
    const tuesday = buildScheduleOccurrences({ date: TUESDAY, blocks });

    expect(monday.map((entry) => entry.blockId)).toEqual(["overnight"]);
    expect(monday[0]?.carriesOverFromPreviousDay).toBe(false);
    expect(tuesday.map((entry) => entry.blockId)).toEqual(["overnight"]);
    expect(tuesday[0]?.carriesOverFromPreviousDay).toBe(true);
  });

  it("does not carry a block that ends exactly at midnight", () => {
    const blocks = [block({ id: "closes-at-midnight", dayOfWeek: 1, startMinuteOfDay: 22 * 60, durationMinutes: 120 })];

    expect(buildScheduleOccurrences({ date: TUESDAY, blocks })).toEqual([]);
  });

  it("carries across the week boundary from Sunday into Monday", () => {
    const blocks = [block({ id: "sunday-night", dayOfWeek: 0, startMinuteOfDay: 23 * 60, durationMinutes: 90 })];

    const monday = buildScheduleOccurrences({ date: MONDAY, blocks });

    expect(monday[0]?.blockId).toBe("sunday-night");
    expect(monday[0]?.carriesOverFromPreviousDay).toBe(true);
  });

  it("orders a carry-over before the day's own blocks", () => {
    const occurrences = buildScheduleOccurrences({
      date: MONDAY,
      blocks: [
        block({ id: "morning", dayOfWeek: 1, startMinuteOfDay: 6 * 60, durationMinutes: 60 }),
        block({ id: "sunday-night", dayOfWeek: 0, startMinuteOfDay: 23 * 60, durationMinutes: 180 })
      ]
    });

    expect(occurrences.map((entry) => entry.blockId)).toEqual(["sunday-night", "morning"]);
    expect(occurrences[0]?.effectiveStartMinuteOfDay).toBe(-60);
  });

  it("gives a carry-over a distinct key from its own-day occurrence", () => {
    const blocks = [block({ id: "overnight", dayOfWeek: 1, startMinuteOfDay: 23 * 60, durationMinutes: 120 })];

    const mondayKey = buildScheduleOccurrences({ date: MONDAY, blocks })[0]?.key;
    const tuesdayKey = buildScheduleOccurrences({ date: TUESDAY, blocks })[0]?.key;

    expect(mondayKey).not.toBe(tuesdayKey);
  });
});

describe("getScheduleOccurrenceMinuteRange", () => {
  it("extends past 1440 for a block running into the next day", () => {
    const [occurrence] = buildScheduleOccurrences({
      date: MONDAY,
      blocks: [block({ id: "overnight", dayOfWeek: 1, startMinuteOfDay: 23 * 60, durationMinutes: 120 })]
    });

    expect(getScheduleOccurrenceMinuteRange(occurrence!)).toEqual({ start: 1380, end: 1500 });
  });

  it("starts negative for a carry-over", () => {
    const [occurrence] = buildScheduleOccurrences({
      date: TUESDAY,
      blocks: [block({ id: "overnight", dayOfWeek: 1, startMinuteOfDay: 23 * 60, durationMinutes: 120 })]
    });

    expect(getScheduleOccurrenceMinuteRange(occurrence!)).toEqual({ start: -60, end: 60 });
  });
});

describe("isScheduleOccurrenceOnAir", () => {
  const blocks = [block({ id: "overnight", dayOfWeek: 1, startMinuteOfDay: 23 * 60, durationMinutes: 120 })];

  it("is on air from its start on its own day", () => {
    const [occurrence] = buildScheduleOccurrences({ date: MONDAY, blocks });

    expect(isScheduleOccurrenceOnAir(occurrence!, 23 * 60)).toBe(true);
    expect(isScheduleOccurrenceOnAir(occurrence!, 23 * 60 - 1)).toBe(false);
  });

  it("is not on air on its own morning", () => {
    // The old string comparison claimed it was: "00:30 < 01:00" matched the wrap branch.
    const [occurrence] = buildScheduleOccurrences({ date: MONDAY, blocks });

    expect(isScheduleOccurrenceOnAir(occurrence!, 30)).toBe(false);
  });

  it("is on air the next morning as a carry-over, up to but not including its end", () => {
    const [occurrence] = buildScheduleOccurrences({ date: TUESDAY, blocks });

    expect(isScheduleOccurrenceOnAir(occurrence!, 30)).toBe(true);
    expect(isScheduleOccurrenceOnAir(occurrence!, 59)).toBe(true);
    expect(isScheduleOccurrenceOnAir(occurrence!, 60)).toBe(false);
  });
});

describe("findCurrentScheduleOccurrence", () => {
  it("finds the carry-over that is genuinely on air after midnight", () => {
    const occurrences = buildScheduleOccurrences({
      date: TUESDAY,
      blocks: [
        block({ id: "overnight", dayOfWeek: 1, startMinuteOfDay: 23 * 60, durationMinutes: 120 }),
        block({ id: "tuesday-morning", dayOfWeek: 2, startMinuteOfDay: 8 * 60, durationMinutes: 60 })
      ]
    });

    expect(findCurrentScheduleOccurrence({ occurrences, currentTime: "00:30" })?.blockId).toBe("overnight");
  });

  it("returns nothing when the schedule genuinely has a gap", () => {
    const occurrences = buildScheduleOccurrences({
      date: MONDAY,
      blocks: [block({ id: "morning", dayOfWeek: 1, startMinuteOfDay: 8 * 60, durationMinutes: 60 })]
    });

    expect(findCurrentScheduleOccurrence({ occurrences, currentTime: "12:00" })).toBeNull();
  });

  it("lets a later block take over from an overrunning earlier one", () => {
    const occurrences = buildScheduleOccurrences({
      date: MONDAY,
      blocks: [
        block({ id: "long", dayOfWeek: 1, startMinuteOfDay: 8 * 60, durationMinutes: 240 }),
        block({ id: "takeover", dayOfWeek: 1, startMinuteOfDay: 10 * 60, durationMinutes: 60 })
      ]
    });

    expect(findCurrentScheduleOccurrence({ occurrences, currentTime: "09:30" })?.blockId).toBe("long");
    expect(findCurrentScheduleOccurrence({ occurrences, currentTime: "10:30" })?.blockId).toBe("takeover");
  });
});

describe("listUpcomingScheduleOccurrences", () => {
  const blocks = [
    block({ id: "overnight", dayOfWeek: 1, startMinuteOfDay: 23 * 60, durationMinutes: 120 }),
    block({ id: "tuesday-morning", dayOfWeek: 2, startMinuteOfDay: 8 * 60, durationMinutes: 60 }),
    block({ id: "tuesday-noon", dayOfWeek: 2, startMinuteOfDay: 12 * 60, durationMinutes: 60 })
  ];

  it("never offers a carry-over from last night as upcoming", () => {
    const occurrences = buildScheduleOccurrences({ date: TUESDAY, blocks });

    const upcoming = listUpcomingScheduleOccurrences({ occurrences, currentTime: "00:30" });

    expect(upcoming.map((entry) => entry.blockId)).toEqual(["tuesday-morning", "tuesday-noon"]);
  });

  it("reports the next block after the current one", () => {
    const occurrences = buildScheduleOccurrences({ date: TUESDAY, blocks });

    expect(findNextScheduleOccurrence({ occurrences, currentTime: "08:30" })?.blockId).toBe("tuesday-noon");
  });

  it("is empty at the end of the day", () => {
    const occurrences = buildScheduleOccurrences({ date: TUESDAY, blocks });

    expect(listUpcomingScheduleOccurrences({ occurrences, currentTime: "23:59" })).toEqual([]);
  });
});
