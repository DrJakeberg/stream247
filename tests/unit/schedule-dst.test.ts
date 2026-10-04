import { describe, expect, it } from "vitest";
import {
  buildScheduleOccurrences,
  findCurrentScheduleOccurrence,
  getCurrentScheduleMoment,
  getScheduleEndInstant,
  getScheduleInstant,
  getScheduleOccurrenceAirWindowSeconds,
  getScheduleRunElapsedSeconds,
  toUtcIsoForLocalDateTime,
  type ScheduleBlock
} from "@stream247/core";
import type { AppState } from "@stream247/db";
import { getCuepointInsertPlan } from "../../apps/worker/src/cuepoints";
import { planTwitchScheduleSegments } from "../../apps/worker/src/twitch-schedule-plan";

// M101 (R3 C5, owner decision R3 Q4): blocks keep their wall-clock times across the switch nights (a block in
// 02:00-03:00 is skipped in March and airs twice in October); only the counts follow real time. Europe/Berlin
// switches on 2026-03-29, 2026-10-25 and 2027-03-28.

const BERLIN = "Europe/Berlin";

const block = (overrides: Partial<ScheduleBlock> & Pick<ScheduleBlock, "id" | "dayOfWeek" | "startMinuteOfDay" | "durationMinutes">): ScheduleBlock => ({
  title: overrides.id,
  categoryName: "Replay",
  sourceName: "Pool",
  poolId: "pool-1",
  ...overrides
});

function currentOccurrenceAt(blocks: ScheduleBlock[], iso: string, timeZone = BERLIN) {
  const moment = getCurrentScheduleMoment({ now: new Date(iso), timeZone });
  return findCurrentScheduleOccurrence({
    occurrences: buildScheduleOccurrences({ date: moment.date, blocks }),
    currentTime: moment.time
  });
}

describe("a local time maps to the instant the wall clock shows it", () => {
  it("maps a time that does not exist forward by the gap (P4)", () => {
    expect(toUtcIsoForLocalDateTime({ date: "2026-03-29", minuteOfDay: 150, timeZone: BERLIN })).toBe("2026-03-29T01:30:00.000Z");
    expect(toUtcIsoForLocalDateTime({ date: "2026-03-29", minuteOfDay: 120, timeZone: BERLIN })).toBe("2026-03-29T01:00:00.000Z");
    // New York springs forward at 02:00 on 2026-03-08: 02:30 is 03:30 EDT.
    expect(toUtcIsoForLocalDateTime({ date: "2026-03-08", minuteOfDay: 150, timeZone: "America/New_York" })).toBe(
      "2026-03-08T07:30:00.000Z"
    );
  });

  it("maps a time that exists twice to its first occurrence, or the second on request (P5)", () => {
    expect(toUtcIsoForLocalDateTime({ date: "2026-10-25", minuteOfDay: 150, timeZone: BERLIN })).toBe("2026-10-25T00:30:00.000Z");
    expect(toUtcIsoForLocalDateTime({ date: "2026-10-25", minuteOfDay: 150, timeZone: BERLIN, ambiguous: "later" })).toBe(
      "2026-10-25T01:30:00.000Z"
    );
  });

  it("leaves every other time as it was", () => {
    const cases: Array<[string, number, string, string]> = [
      ["2026-03-29", 60, BERLIN, "2026-03-29T00:00:00.000Z"],
      ["2026-03-29", 180, BERLIN, "2026-03-29T01:00:00.000Z"],
      ["2026-10-25", 60, BERLIN, "2026-10-24T23:00:00.000Z"],
      ["2026-10-25", 180, BERLIN, "2026-10-25T02:00:00.000Z"],
      ["2026-07-01", 720, BERLIN, "2026-07-01T10:00:00.000Z"],
      ["2026-01-15", 0, BERLIN, "2026-01-14T23:00:00.000Z"],
      ["2026-10-04", 1380, "UTC", "2026-10-04T23:00:00.000Z"],
      ["2026-10-04", 345, "Asia/Kolkata", "2026-10-04T00:15:00.000Z"]
    ];
    for (const [date, minuteOfDay, timeZone, expected] of cases) {
      expect(toUtcIsoForLocalDateTime({ date, minuteOfDay, timeZone }), `${date} ${minuteOfDay} ${timeZone}`).toBe(expected);
    }
    // getScheduleInstant reads seconds past a day and below zero on the neighbouring dates, as before.
    expect(getScheduleInstant({ date: "2026-10-24", seconds: 86_400 + 9_000, timeZone: BERLIN }).toISOString()).toBe(
      "2026-10-25T00:30:00.000Z"
    );
    expect(getScheduleInstant({ date: "2026-03-30", seconds: -3_600 + 30, timeZone: BERLIN }).toISOString()).toBe(
      "2026-03-29T21:00:30.000Z"
    );
  });
});

describe("cuepoints count real seconds (P8)", () => {
  // 2027-03-28 is a Sunday. Sunday 01:00 for 180 min, cuepoints at 90 min and 100 min.
  const sundayBlock = block({ id: "sun", dayOfWeek: 0, startMinuteOfDay: 60, durationMinutes: 180, cuepointOffsetsSeconds: [5_400, 6_000] });

  function stateWith(blocks: ScheduleBlock[]): AppState {
    return {
      scheduleBlocks: blocks,
      pools: [{ id: "pool-1", name: "Pool", sourceIds: ["source-1"], insertAssetId: "sting", insertEveryItems: 0 }],
      assets: [{ id: "sting", sourceId: "source-1", title: "Sting", status: "ready", includeInProgramming: true }],
      playout: { cuepointWindowKey: "", cuepointFiredKeys: [] }
    } as unknown as AppState;
  }

  it("reports 5 400 s, not 9 000 s, at 03:30 on the spring-forward day for a block from 01:00", () => {
    // 03:30 CEST = 01:30Z, 90 real minutes after 01:00 CET (00:00Z).
    const now = "2027-03-28T01:30:00.000Z";
    const occurrence = currentOccurrenceAt([sundayBlock], now);
    expect(occurrence?.blockId).toBe("sun");
    expect(getScheduleRunElapsedSeconds({ occurrence: occurrence!, now: new Date(now), timeZone: BERLIN })).toBe(5_400);

    // The worker fires the 90-minute cuepoint, not the 100-minute one as well: next is still ahead.
    const plan = getCuepointInsertPlan({
      state: stateWith([sundayBlock]),
      currentScheduleItem: occurrence,
      skippedAssetId: "",
      now: new Date(now),
      timeZone: BERLIN
    });
    expect(plan?.offsetSeconds).toBe(5_400);
    expect(plan?.nextOffsetSeconds).toBe(6_000);
  });

  it("counts the repeated hour on the fall-back day", () => {
    // 2026-10-25: 02:30 is first 00:30Z (CEST), then 01:30Z (CET).
    const sundayOctober = { ...sundayBlock };
    const first = "2026-10-25T00:30:00.000Z";
    const second = "2026-10-25T01:30:00.000Z";
    const firstOccurrence = currentOccurrenceAt([sundayOctober], first);
    const secondOccurrence = currentOccurrenceAt([sundayOctober], second);
    expect(firstOccurrence?.key).toBe(secondOccurrence?.key);
    expect(getScheduleRunElapsedSeconds({ occurrence: firstOccurrence!, now: new Date(first), timeZone: BERLIN })).toBe(5_400);
    expect(getScheduleRunElapsedSeconds({ occurrence: secondOccurrence!, now: new Date(second), timeZone: BERLIN })).toBe(9_000);
  });

  it("counts a block that starts in the repeated hour from its first occurrence", () => {
    const repeated = block({ id: "rep", dayOfWeek: 0, startMinuteOfDay: 120, durationMinutes: 60 });
    // 02:15 CEST (first pass) and 02:15 CET (second pass) on 2026-10-25.
    const first = "2026-10-25T00:15:00.000Z";
    const second = "2026-10-25T01:15:00.000Z";
    expect(getScheduleRunElapsedSeconds({ occurrence: currentOccurrenceAt([repeated], first)!, now: new Date(first), timeZone: BERLIN })).toBe(900);
    expect(getScheduleRunElapsedSeconds({ occurrence: currentOccurrenceAt([repeated], second)!, now: new Date(second), timeZone: BERLIN })).toBe(4_500);
  });

  it("counts a run carried over midnight from the evening before, and every other day as before", () => {
    const late = block({ id: "late", dayOfWeek: 6, startMinuteOfDay: 23 * 60, durationMinutes: 300 });
    // Saturday 2027-03-27 23:00 CET (22:00Z) to Sunday 03:30 CEST (01:30Z): 3.5 real hours, 4.5 on the wall clock.
    const now = "2027-03-28T01:30:00.000Z";
    const carry = currentOccurrenceAt([late], now);
    expect(carry?.carriesOverFromPreviousDay).toBe(true);
    expect(getScheduleRunElapsedSeconds({ occurrence: carry!, now: new Date(now), timeZone: BERLIN })).toBe(12_600);

    // An ordinary Sunday: 03:30 CEST is 2.5 h after 01:00 CEST, on the wall clock and in real time.
    const july = "2026-07-05T01:30:00.000Z";
    expect(getScheduleRunElapsedSeconds({ occurrence: currentOccurrenceAt([sundayBlock], july)!, now: new Date(july), timeZone: BERLIN })).toBe(
      9_000
    );
  });

  it("measures a cut block's air windows in real seconds when the zone is known", () => {
    // Weekly Sunday 01:00-04:00 cut by a window 03:00-03:30 on 2027-03-28: the second window starts 2 real hours in.
    const windows = getScheduleOccurrenceAirWindowSeconds(
      { effectiveStartMinuteOfDay: 60, date: "2027-03-28", airWindows: [{ start: 60, end: 180 }, { start: 210, end: 240 }] },
      BERLIN
    );
    expect(windows).toEqual([
      { start: 0, end: 3_600 },
      { start: 5_400, end: 7_200 }
    ]);
    // Without a zone the windows stay wall-clock seconds.
    expect(
      getScheduleOccurrenceAirWindowSeconds({ effectiveStartMinuteOfDay: 60, airWindows: [{ start: 60, end: 180 }, { start: 210, end: 240 }] })
    ).toEqual([
      { start: 0, end: 7_200 },
      { start: 9_000, end: 10_800 }
    ]);
  });
});

describe("the Twitch segment end follows real minutes", () => {
  const sunday = block({ id: "sun", dayOfWeek: 0, startMinuteOfDay: 60, durationMinutes: 180 });

  it("posts 01:00-04:00 as 120 minutes on the spring-forward night and 240 on the fall-back night", () => {
    const spring = planTwitchScheduleSegments({
      blocks: [sunday],
      currentDate: "2026-03-23",
      timeZone: BERLIN,
      now: new Date("2026-03-23T10:00:00.000Z")
    });
    expect(spring.segments).toEqual([expect.objectContaining({ startTime: "2026-03-29T00:00:00.000Z", durationMinutes: 120 })]);

    const autumn = planTwitchScheduleSegments({
      blocks: [sunday],
      currentDate: "2026-10-19",
      timeZone: BERLIN,
      now: new Date("2026-10-19T10:00:00.000Z")
    });
    expect(autumn.segments).toEqual([expect.objectContaining({ startTime: "2026-10-24T23:00:00.000Z", durationMinutes: 240 })]);

    const ordinary = planTwitchScheduleSegments({
      blocks: [sunday],
      currentDate: "2026-06-29",
      timeZone: BERLIN,
      now: new Date("2026-06-29T10:00:00.000Z")
    });
    expect(ordinary.segments).toEqual([expect.objectContaining({ startTime: "2026-07-04T23:00:00.000Z", durationMinutes: 180 })]);
  });

  it("posts a block in the repeated hour from its first start, and skips one in the skipped hour", () => {
    const night = block({ id: "night", dayOfWeek: 0, startMinuteOfDay: 120, durationMinutes: 60 });
    const autumn = planTwitchScheduleSegments({
      blocks: [night],
      currentDate: "2026-10-19",
      timeZone: BERLIN,
      now: new Date("2026-10-19T10:00:00.000Z")
    });
    // 02:00 CEST (00:00Z) to 03:00 CET (02:00Z): it airs twice, 120 real minutes.
    expect(autumn.segments).toEqual([expect.objectContaining({ startTime: "2026-10-25T00:00:00.000Z", durationMinutes: 120 })]);

    const spring = planTwitchScheduleSegments({
      blocks: [night],
      currentDate: "2026-03-23",
      timeZone: BERLIN,
      now: new Date("2026-03-23T10:00:00.000Z")
    });
    // 02:00-03:00 does not exist that night: 0 real minutes, so no segment.
    expect(spring.segments).toEqual([]);
    expect(spring.skippedCount).toBe(1);
  });

  it("ends a block at the first 02:00 on the fall-back night, where the clock never returns to before it", () => {
    const autumn = planTwitchScheduleSegments({
      blocks: [
        block({ id: "nightly", dayOfWeek: 6, startMinuteOfDay: 22 * 60, durationMinutes: 240 }),
        block({ id: "late", dayOfWeek: 0, startMinuteOfDay: 150, durationMinutes: 90 })
      ],
      currentDate: "2026-10-19",
      timeZone: BERLIN,
      now: new Date("2026-10-19T10:00:00.000Z")
    });
    // Saturday 22:00 CEST (20:00Z) to Sunday 02:00 CEST (00:00Z): 240 minutes, not 300.
    // Sunday 02:30 (first, 00:30Z) to 04:00 CET (03:00Z): 150 minutes.
    expect(autumn.segments.map((segment) => [segment.blockId, segment.startTime, segment.durationMinutes])).toEqual([
      ["nightly", "2026-10-24T20:00:00.000Z", 240],
      ["late", "2026-10-25T00:30:00.000Z", 150]
    ]);
    expect(getScheduleEndInstant({ date: "2026-10-25", seconds: 120 * 60, timeZone: BERLIN }).toISOString()).toBe("2026-10-25T00:00:00.000Z");
    expect(getScheduleEndInstant({ date: "2026-10-25", seconds: 150 * 60, timeZone: BERLIN }).toISOString()).toBe("2026-10-25T01:30:00.000Z");
    expect(getScheduleEndInstant({ date: "2026-10-25", seconds: 180 * 60, timeZone: BERLIN }).toISOString()).toBe("2026-10-25T02:00:00.000Z");
    expect(getScheduleEndInstant({ date: "2026-03-29", seconds: 180 * 60, timeZone: BERLIN }).toISOString()).toBe("2026-03-29T01:00:00.000Z");
    expect(getScheduleEndInstant({ date: "2026-07-05", seconds: 120 * 60, timeZone: BERLIN }).toISOString()).toBe("2026-07-05T00:00:00.000Z");
  });

  it("starts a block that begins in the skipped hour after the switch, not before it", () => {
    const gap = block({ id: "gap", dayOfWeek: 0, startMinuteOfDay: 150, durationMinutes: 120 });
    const spring = planTwitchScheduleSegments({
      blocks: [gap],
      currentDate: "2026-03-23",
      timeZone: BERLIN,
      now: new Date("2026-03-23T10:00:00.000Z")
    });
    // Start 02:30 maps forward to 03:30 CEST (01:30Z); the end 04:30 CEST is 02:30Z.
    expect(spring.segments).toEqual([expect.objectContaining({ startTime: "2026-03-29T01:30:00.000Z", durationMinutes: 60 })]);
  });
});
