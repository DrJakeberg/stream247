import { describe, expect, it } from "vitest";
import { findScheduleConflicts, type ScheduleBlock } from "@stream247/core";

// Applying a programme template used to skip the overlap check that every other way of creating a
// block already performs. The generated week landed on top of the existing one, and because the
// schedule editor refuses to save while conflicts exist, applying a template was enough to lock the
// editor with no way out but deleting blocks by hand.
//
// These pin the check the template route now runs, including the day-crossing case the templates
// themselves produce (an overnight block starting at 00:00 and one at 16:00 running eight hours).

function block(overrides: Partial<ScheduleBlock> & { id: string }): ScheduleBlock {
  return {
    id: overrides.id,
    title: overrides.title ?? "Block",
    categoryName: "Replay",
    dayOfWeek: overrides.dayOfWeek ?? 1,
    startMinuteOfDay: overrides.startMinuteOfDay ?? 0,
    durationMinutes: overrides.durationMinutes ?? 60,
    poolId: overrides.poolId ?? "pool-1",
    sourceName: "Pool",
    repeatMode: overrides.repeatMode ?? "single",
    repeatGroupId: overrides.repeatGroupId ?? ""
  } as ScheduleBlock;
}

describe("template application against an existing week", () => {
  it("reports the overlap a template laid over existing programming creates", () => {
    const existing = [block({ id: "existing", startMinuteOfDay: 10 * 60, durationMinutes: 4 * 60 })];
    const generated = [block({ id: "generated", startMinuteOfDay: 8 * 60, durationMinutes: 8 * 60 })];

    const conflicts = findScheduleConflicts([...existing, ...generated]);

    expect(conflicts).toEqual(expect.arrayContaining(["existing", "generated"]));
  });

  it("accepts a template that fits into the gaps", () => {
    const existing = [block({ id: "existing", startMinuteOfDay: 0, durationMinutes: 8 * 60 })];
    const generated = [block({ id: "generated", startMinuteOfDay: 8 * 60, durationMinutes: 8 * 60 })];

    expect(findScheduleConflicts([...existing, ...generated])).toEqual([]);
  });

  it("does not report a same-time block on a different day", () => {
    const monday = block({ id: "monday", dayOfWeek: 1, startMinuteOfDay: 8 * 60, durationMinutes: 60 });
    const tuesday = block({ id: "tuesday", dayOfWeek: 2, startMinuteOfDay: 8 * 60, durationMinutes: 60 });

    expect(findScheduleConflicts([monday, tuesday])).toEqual([]);
  });

  it("finds the three-part-day layout internally free of overlaps", () => {
    // The layout the template actually generates: 00:00-08:00, 08:00-16:00, 16:00-24:00.
    const generated = [
      block({ id: "overnight", startMinuteOfDay: 0, durationMinutes: 8 * 60 }),
      block({ id: "daytime", startMinuteOfDay: 8 * 60, durationMinutes: 8 * 60 }),
      block({ id: "prime", startMinuteOfDay: 16 * 60, durationMinutes: 8 * 60 })
    ];

    expect(findScheduleConflicts(generated)).toEqual([]);
  });

  it("catches an overlap that only exists because a block crosses midnight", () => {
    // A block running 23:00-01:00 wraps into the next day, where an early block already sits.
    const wrapping = block({ id: "wrapping", startMinuteOfDay: 23 * 60, durationMinutes: 120 });
    const early = block({ id: "early", startMinuteOfDay: 0, durationMinutes: 60 });

    expect(findScheduleConflicts([wrapping, early])).toEqual(expect.arrayContaining(["wrapping", "early"]));
  });
});
