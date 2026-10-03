import { describe, expect, it } from "vitest";
import { buildMaterializedProgrammingWeek, type ScheduleBlock } from "@stream247/core";

const block = (overrides: Partial<ScheduleBlock> & Pick<ScheduleBlock, "id" | "dayOfWeek" | "startMinuteOfDay" | "durationMinutes">): ScheduleBlock => ({
  title: overrides.id,
  categoryName: "Archive",
  sourceName: "Pool",
  ...overrides
});

describe("week lens scheduled minutes", () => {
  it("counts a block that crosses midnight once, split over the two days", () => {
    // 2026-10-03 is a Saturday. Saturday 00:00-23:00 and 23:00-01:00, Sunday 01:00-24:00: a full grid.
    const week = buildMaterializedProgrammingWeek({
      startDate: "2026-10-03",
      blocks: [
        block({ id: "sat-day", dayOfWeek: 6, startMinuteOfDay: 0, durationMinutes: 23 * 60 }),
        block({ id: "sat-late", dayOfWeek: 6, startMinuteOfDay: 23 * 60, durationMinutes: 120 }),
        block({ id: "sun-day", dayOfWeek: 0, startMinuteOfDay: 60, durationMinutes: 23 * 60 })
      ],
      pools: [],
      assets: []
    });

    const [saturday, sunday] = week;
    expect(saturday?.date).toBe("2026-10-03");
    expect(saturday?.totalScheduledMinutes).toBe(1440);
    expect(sunday?.date).toBe("2026-10-04");
    // Since M97 the block past midnight is listed once, on Saturday, and Sunday still counts its hour.
    expect(saturday?.blocks.map((entry) => entry.blockId)).toEqual(["sat-day", "sat-late"]);
    expect(sunday?.blocks.map((entry) => entry.blockId)).toEqual(["sun-day"]);
    expect(sunday?.totalScheduledMinutes).toBe(1440);
  });

  it("counts a block that ends inside its own day at its full length", () => {
    const week = buildMaterializedProgrammingWeek({
      startDate: "2026-10-05",
      blocks: [block({ id: "mon-evening", dayOfWeek: 1, startMinuteOfDay: 20 * 60, durationMinutes: 240 })],
      pools: [],
      assets: []
    });

    expect(week[0]?.totalScheduledMinutes).toBe(240);
    expect(week[1]?.totalScheduledMinutes).toBe(0);
  });
});
