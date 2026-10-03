import { describe, expect, it } from "vitest";
import {
  buildMaterializedProgrammingWeek,
  formatScheduleDayHeading,
  formatScheduleHours,
  walkPoolRotation,
  type ScheduleBlock
} from "@stream247/core";

// M97 (U5, U6): the week view shows what will play.

const block = (overrides: Partial<ScheduleBlock> & Pick<ScheduleBlock, "id" | "dayOfWeek" | "startMinuteOfDay" | "durationMinutes">): ScheduleBlock => ({
  title: overrides.id,
  categoryName: "Archive",
  sourceName: "Pool",
  poolId: "pool-1",
  ...overrides
});

const pool = {
  id: "pool-1",
  name: "Abendprogramm",
  sourceIds: ["source-1"],
  cursorAssetId: "",
  insertAssetId: "",
  insertEveryItems: 0,
  itemsSinceInsert: 0
};

const asset = (index: number, durationSeconds: number) => ({
  id: `item-${index}`,
  sourceId: "source-1",
  title: `Item ${index}`,
  status: "ready",
  includeInProgramming: true,
  durationSeconds,
  createdAt: `2026-09-0${index}T00:00:00.000Z`
});

// 2026-10-05 is a Monday.
const MONDAY = "2026-10-05";

describe("U5: each pool's rotation is carried across blocks in time order", () => {
  const assets = [asset(1, 3600), asset(2, 3600), asset(3, 3600)];

  it("three items, two blocks: the second block starts with item 2, not item 1", () => {
    const [monday] = buildMaterializedProgrammingWeek({
      startDate: MONDAY,
      blocks: [
        block({ id: "morning", dayOfWeek: 1, startMinuteOfDay: 10 * 60, durationMinutes: 60 }),
        block({ id: "evening", dayOfWeek: 1, startMinuteOfDay: 20 * 60, durationMinutes: 60 })
      ],
      pools: [pool],
      assets
    });
    expect(monday?.blocks.map((entry) => entry.items[0]?.assetId)).toEqual(["item-1", "item-2"]);
  });

  it("carries on across days and wraps like the worker's rotation", () => {
    const week = buildMaterializedProgrammingWeek({
      startDate: MONDAY,
      blocks: [1, 2, 3, 4, 5].map((dayOfWeek) => block({ id: `day-${dayOfWeek}`, dayOfWeek, startMinuteOfDay: 20 * 60, durationMinutes: 120 })),
      pools: [pool],
      assets
    });
    const projected = week.flatMap((day) => day.blocks.flatMap((entry) => entry.items.map((item) => item.assetId)));
    // The sequence is the worker's own walk (walkPoolRotation, createPoolRotation underneath), not a copy.
    const worker = walkPoolRotation({ pool, assets, isEligible: () => true, steps: projected.length }).map((pick) => pick.asset.id);
    expect(projected).toEqual(worker);
    expect(week[1]?.blocks[0]?.items.map((item) => item.assetId)).toEqual(["item-3", "item-1"]);
  });

  it("starts a pool's next block with its next item after a block of another pool in between", () => {
    const otherPool = { ...pool, id: "pool-2", name: "Other", sourceIds: ["source-2"] };
    const otherAsset = { ...asset(9, 3600), sourceId: "source-2" };
    const [monday] = buildMaterializedProgrammingWeek({
      startDate: MONDAY,
      blocks: [
        block({ id: "a", dayOfWeek: 1, startMinuteOfDay: 8 * 60, durationMinutes: 60 }),
        block({ id: "b", dayOfWeek: 1, startMinuteOfDay: 9 * 60, durationMinutes: 60, poolId: "pool-2" }),
        block({ id: "c", dayOfWeek: 1, startMinuteOfDay: 10 * 60, durationMinutes: 60 })
      ],
      pools: [pool, otherPool],
      assets: [...assets, otherAsset]
    });
    expect(monday?.blocks.map((entry) => entry.items[0]?.assetId)).toEqual(["item-1", "item-9", "item-2"]);
  });

  it("a block that has aired today takes nothing from the rotation; the block on air is filled from now", () => {
    const [monday] = buildMaterializedProgrammingWeek({
      startDate: MONDAY,
      blocks: [
        block({ id: "morning", dayOfWeek: 1, startMinuteOfDay: 8 * 60, durationMinutes: 60 }),
        block({ id: "noon", dayOfWeek: 1, startMinuteOfDay: 12 * 60, durationMinutes: 120 }),
        block({ id: "evening", dayOfWeek: 1, startMinuteOfDay: 20 * 60, durationMinutes: 60 })
      ],
      pools: [pool],
      assets,
      nowMinuteOfDay: 13 * 60
    });
    expect(monday?.blocks.map((entry) => entry.aired)).toEqual([true, false, false]);
    // 13:00-14:00 is left of the noon block: one item from the stored position, then the evening's.
    expect(monday?.blocks[1]?.items.map((item) => [item.assetId, item.startTime])).toEqual([["item-1", "13:00"]]);
    expect(monday?.blocks[2]?.items[0]?.assetId).toBe("item-2");
    // The hour that already ran still counts as filled.
    expect(monday?.totalProjectedMinutes).toBe(60 + 120 + 60);
  });
});

describe("U5: hours, dates and blocks past midnight", () => {
  it("a 24 h block reads '24 h', and so does its day", () => {
    const [monday] = buildMaterializedProgrammingWeek({
      startDate: MONDAY,
      blocks: [block({ id: "all-day", dayOfWeek: 1, startMinuteOfDay: 0, durationMinutes: 1440 })],
      pools: [pool],
      assets: [asset(1, 3600)]
    });
    expect(monday?.blocks[0]?.durationLabel).toBe("24 h");
    expect(monday?.blocks[0]?.timeLabel).toBe("00:00 → 24:00");
    expect(formatScheduleHours(monday?.totalScheduledMinutes ?? 0)).toBe("24 h");
    expect(formatScheduleHours(90)).toBe("1 h 30 min");
    expect(formatScheduleHours(45)).toBe("45 min");
  });

  it("puts the date on the day header", () => {
    expect(formatScheduleDayHeading("2026-10-03")).toBe("Sat 3 Oct");
    expect(formatScheduleDayHeading(MONDAY)).toBe("Mon 5 Oct");
  });

  it("an overnight block appears on one day only, shown once with '→ 01:00 Sun'", () => {
    // 2026-10-03 is a Saturday.
    const week = buildMaterializedProgrammingWeek({
      startDate: "2026-10-03",
      blocks: [block({ id: "sat-late", dayOfWeek: 6, startMinuteOfDay: 23 * 60, durationMinutes: 120 })],
      pools: [pool],
      assets: [asset(1, 3600), asset(2, 3600)]
    });
    const listed = week.filter((day) => day.blocks.some((entry) => entry.blockId === "sat-late")).map((day) => day.date);
    expect(listed).toEqual(["2026-10-03"]);
    expect(week[0]?.blocks[0]?.timeLabel).toBe("23:00 → 01:00 Sun");
    expect(week[0]?.blocks[0]?.durationLabel).toBe("2 h");
    // Sunday still counts the hour after midnight.
    expect(week[1]?.totalScheduledMinutes).toBe(60);
    expect(week[1]?.totalProjectedMinutes).toBe(60);
  });

  it("the first day keeps a block that started the day before the week", () => {
    // 2026-10-04 is a Sunday; the Saturday block runs into it.
    const [sunday] = buildMaterializedProgrammingWeek({
      startDate: "2026-10-04",
      blocks: [block({ id: "sat-late", dayOfWeek: 6, startMinuteOfDay: 23 * 60, durationMinutes: 120 })],
      pools: [pool],
      assets: [asset(1, 3600)]
    });
    expect(sunday?.blocks.map((entry) => entry.blockId)).toEqual(["sat-late"]);
    expect(sunday?.blocks[0]?.timeLabel).toBe("23:00 Sat → 01:00");
  });
});

describe("U5: the reason a block repeats, with numbers", () => {
  it("a block with 6 min of video in 24 h carries the reason 'plays ≈ 240 times'", () => {
    const [monday] = buildMaterializedProgrammingWeek({
      startDate: MONDAY,
      blocks: [block({ id: "all-day", dayOfWeek: 1, startMinuteOfDay: 0, durationMinutes: 1440 })],
      pools: [pool],
      assets: [asset(1, 120), asset(2, 120), asset(3, 120)]
    });
    const entry = monday?.blocks[0];
    expect(entry?.fillLabel).toBe("Repeats inside block");
    expect(entry?.repeatReason).toContain("plays ≈ 240 times");
    expect(entry?.repeatReason).toBe("6 min of video for a 24 h block: plays ≈ 240 times. Add videos to Abendprogramm.");
    // The whole block is projected, not the first 48 items: 720 two-minute plays fill 24 h.
    expect(entry?.projectedMinutes).toBe(1440);
    expect(entry?.items.length).toBe(48);
  });

  it("says nothing when the block does not repeat", () => {
    const [monday] = buildMaterializedProgrammingWeek({
      startDate: MONDAY,
      blocks: [block({ id: "short", dayOfWeek: 1, startMinuteOfDay: 20 * 60, durationMinutes: 60 })],
      pools: [pool],
      assets: [asset(1, 3600), asset(2, 3600)]
    });
    expect(monday?.blocks[0]?.fillStatus).toBe("balanced");
    expect(monday?.blocks[0]?.repeatReason).toBe("");
  });
});

describe("U5: repeat reasons by pool shape", () => {
  it("a one-source pool whose videos do not fill the block twice says so, not 'alternates'", () => {
    const [monday] = buildMaterializedProgrammingWeek({
      startDate: MONDAY,
      blocks: [block({ id: "evening", dayOfWeek: 1, startMinuteOfDay: 20 * 60, durationMinutes: 75 })],
      pools: [pool],
      assets: [asset(1, 30 * 60), asset(2, 30 * 60)]
    });
    expect(monday?.blocks[0]?.repeatReason).toBe(
      "1 h of video for a 1 h 15 min block: its first videos play again before it ends. Add videos to Abendprogramm."
    );
  });

  it("a block on air with nothing to play adds no filled minutes", () => {
    const [monday] = buildMaterializedProgrammingWeek({
      startDate: MONDAY,
      blocks: [block({ id: "noon", dayOfWeek: 1, startMinuteOfDay: 12 * 60, durationMinutes: 120 })],
      pools: [pool],
      assets: [],
      nowMinuteOfDay: 13 * 60
    });
    expect(monday?.blocks[0]?.fillStatus).toBe("empty");
    expect(monday?.totalProjectedMinutes).toBe(0);
  });
});

describe("M93 follow-up: a weekly block cut by a dated block projects only its air time", () => {
  it("weekly 18-22 under a dated 20-21 airs 3 h, and the item after the cut starts at 21:00", () => {
    const [monday] = buildMaterializedProgrammingWeek({
      startDate: MONDAY,
      blocks: [
        block({ id: "weekly", dayOfWeek: 1, startMinuteOfDay: 18 * 60, durationMinutes: 240 }),
        block({ id: "dated", dayOfWeek: 1, startMinuteOfDay: 20 * 60, durationMinutes: 60, poolId: "pool-2", validFrom: MONDAY, validUntil: MONDAY })
      ],
      pools: [pool],
      assets: [asset(1, 90 * 60), asset(2, 90 * 60), asset(3, 90 * 60)]
    });
    const weekly = monday?.blocks.find((entry) => entry.blockId === "weekly");
    expect(weekly?.durationLabel).toBe("3 h");
    // 2 h up to the cut, then one 90-min item in the last hour: 30 min late, not 4 h of block time filled.
    expect(weekly?.projectedMinutes).toBe(210);
    expect(weekly?.fillLabel).toBe("Ends 30m late");
    expect(weekly?.timeLabel).toBe("18:00 → 20:00 · 21:00 → 22:00");
    // Item 2 runs into the dated block and is cut at 20:00; item 3 starts when the weekly block is back.
    expect(weekly?.items.map((item) => [item.assetId, item.startTime, item.endTime])).toEqual([
      ["item-1", "18:00", "19:30"],
      ["item-2", "19:30", "20:00"],
      ["item-3", "21:00", "22:30"]
    ]);
  });
});
