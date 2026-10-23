import { describe, expect, it, vi } from "vitest";
import * as React from "../../apps/web/node_modules/react";
import { renderToStaticMarkup } from "../../apps/web/node_modules/react-dom/server";
import {
  buildMaterializedProgrammingWeek,
  buildScheduleOccurrences,
  buildSchedulePreviewVideoSlots,
  countScheduleDatesInWindow,
  describeScheduleTakeover,
  findWeekdaysOutsideDateWindow,
  type ScheduleBlock
} from "@stream247/core";

// M119: suggestions 18 and 19 of planning/suggestions-2026-10-04.md. The Day lens speaks plainly and its
// video bars carry each pool's rotation from block to block (M97 "Not built", Known follow-ups); the block
// form says what a dated block takes over before it is saved and offers "for how many days" (M93 "Not
// built", R1 1.3 steps 5 and 8). The repeat-set check is in schedule-dated-blocks.test.ts.
// Components are rendered with React's state hooks returning their first value (as program-week-view.test.ts).

vi.mock("../../apps/web/node_modules/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../apps/web/node_modules/react")>();
  return {
    ...actual,
    useState: (initial: unknown) => [typeof initial === "function" ? (initial as () => unknown)() : initial, () => undefined],
    useTransition: () => [false, (callback: () => void) => callback()]
  };
});

vi.mock("../../apps/web/node_modules/next/navigation", () => ({
  useRouter: () => ({ refresh: () => undefined, replace: () => undefined })
}));

vi.mock("../../apps/web/node_modules/next/link", () => ({
  default: (props: { href: string; children?: unknown }) => React.createElement("a", { href: props.href }, props.children as never)
}));

vi.mock("../../apps/web/components/ui/Toast", () => ({
  useToast: () => ({ pushToast: () => undefined })
}));

import { ScheduleBlockForm } from "../../apps/web/components/schedule-block-form";
import { ScheduleEditorWorkspace } from "../../apps/web/components/schedule-editor-workspace";
import { ScheduleVideoTimeline } from "../../apps/web/components/schedule-video-timeline";
import { buildScheduleVideoTimelineSegments } from "../../apps/web/lib/schedule-video-timeline";

(globalThis as { React?: unknown }).React = React;

// 2026-10-05 is a Monday, 2026-10-01 a Thursday.
const MONDAY = "2026-10-05";

const block = (overrides: Partial<ScheduleBlock> & Pick<ScheduleBlock, "id" | "dayOfWeek" | "startMinuteOfDay" | "durationMinutes">): ScheduleBlock => ({
  title: overrides.id,
  categoryName: "Archive",
  sourceName: "Pool",
  poolId: "a",
  ...overrides
});

const pool = { id: "a", name: "Archive pool", sourceIds: ["source-a"], cursorAssetId: "", insertAssetId: "", insertEveryItems: 0, itemsSinceInsert: 0 };

const assets = Array.from({ length: 6 }, (_, index) => ({
  id: `a${index + 1}`,
  sourceId: "source-a",
  title: `a${index + 1}`,
  status: "ready",
  includeInProgramming: true,
  durationSeconds: 1800,
  createdAt: new Date(Date.UTC(2026, 8, 1, 0, index)).toISOString(),
  path: `/media/a${index + 1}.mp4`
}));

// Two one-hour blocks of one pool on Monday, 10:00 and 14:00, six 30-minute videos.
const twoBlocks = [
  block({ id: "Morning", dayOfWeek: 1, startMinuteOfDay: 600, durationMinutes: 60 }),
  block({ id: "Afternoon", dayOfWeek: 1, startMinuteOfDay: 840, durationMinutes: 60 })
];

function monday(nowMinuteOfDay?: number, blocks = twoBlocks) {
  return buildMaterializedProgrammingWeek({ startDate: MONDAY, blocks, pools: [pool], assets, nowMinuteOfDay })[0]!;
}

describe("18: the Day lens's video bars carry the rotation from block to block", () => {
  it("the second block of the pool starts with a3, where the first left off, not with a1 again", () => {
    const day = monday();
    const titles = day.blocks.map((entry) => buildScheduleVideoTimelineSegments(entry).map((segment) => segment.title));
    expect(titles).toEqual([
      ["a1", "a2"],
      ["a3", "a4"]
    ]);
    // Each bar fills its block: two halves.
    expect(buildScheduleVideoTimelineSegments(day.blocks[1]!).map((segment) => segment.widthPercent)).toEqual([50, 50]);
    // The function the bars were built from until M119 starts every block at the stored position.
    const occurrences = buildScheduleOccurrences({ date: MONDAY, blocks: twoBlocks });
    const before = occurrences.map((occurrence) => buildSchedulePreviewVideoSlots({ block: occurrence, pool, assets })[0]?.title);
    expect(before).toEqual(["a1", "a1"]);
  });

  it("a video that runs past the block is drawn up to the block's end", () => {
    const day = monday(undefined, [block({ id: "Short", dayOfWeek: 1, startMinuteOfDay: 600, durationMinutes: 45 })]);
    const segments = buildScheduleVideoTimelineSegments(day.blocks[0]!);
    expect(segments.map((segment) => [segment.title, Math.round(segment.widthPercent)])).toEqual([
      ["a1", 67],
      ["a2", 33]
    ]);
  });

  it("lists a block that has aired as such, with no videos to open", () => {
    const html = renderToStaticMarkup(React.createElement(ScheduleVideoTimeline, { blocks: monday(12 * 60).blocks, dayLabels: ["Sun", "Mon"] }));
    expect(html).toContain("Aired earlier today");
    expect(html.match(/Show videos/g)).toHaveLength(1);
    expect(html).toContain("1 h of different videos · 1 h planned");
  });
});

describe("18: the Day lens speaks plainly", () => {
  it("counts hours, says blocks, and has none of the internal words", () => {
    const allDay = [block({ id: "All day", dayOfWeek: 1, startMinuteOfDay: 0, durationMinutes: 1440 })];
    const html = renderToStaticMarkup(
      React.createElement(ScheduleEditorWorkspace, {
        blocks: allDay,
        conflicts: [],
        pools: [{ id: "a", name: "Archive pool", insertAssetId: "", insertEveryItems: 0, audioLaneAssetId: "", audioLaneVolumePercent: 100 }],
        assets: [],
        assetCatalog: [],
        showProfiles: [],
        timeZone: "UTC",
        materializedDays: [monday(undefined, allDay)],
        liveQueueItems: [],
        initialDay: 1,
        today: MONDAY
      })
    );
    expect(html).toContain("1 block");
    expect(html).toContain("1 repeats videos");
    expect(html).toContain("24 h scheduled · 24 h of video planned");
    expect(html).toContain("Mon · 00:00 · 24 h · Archive pool");
    expect(html).toContain("3 h of different videos · 24 h planned");
    expect(html).toContain("On air now");
    expect(html).not.toMatch(/\d+m (scheduled|projected)/);
    for (const word of ["materialized", "Unique fill", "Queue preview", "Live queue context", "runtime queue", "repeat risk"]) {
      expect(html).not.toContain(word);
    }
  });
});

describe("19: what a dated block takes over, before it is saved", () => {
  const evening = [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) =>
    block({ id: `evening-${dayOfWeek}`, title: "Evening", dayOfWeek, startMinuteOfDay: 18 * 60, durationMinutes: 300, repeatGroupId: "repeat-evening" })
  );

  it("names the weekly block, the span, the days and where the weekly block goes on", () => {
    expect(
      describeScheduleTakeover({
        dayOfWeeks: [0, 1, 2, 3, 4, 5, 6],
        startMinuteOfDay: 20 * 60,
        durationMinutes: 120,
        validFrom: "2026-10-01",
        validUntil: "2026-10-10",
        blocks: evening
      })
    ).toEqual(["Takes over 20:00–22:00 from Evening on 10 days (Thu 1 Oct to Sat 10 Oct); Evening continues at 22:00."]);
  });

  it("only counts the weekdays the set has, and says one date by its name", () => {
    expect(
      describeScheduleTakeover({ dayOfWeeks: [1], startMinuteOfDay: 20 * 60, durationMinutes: 180, validFrom: "2026-10-01", validUntil: "2026-10-10", blocks: evening })
    ).toEqual(["Takes over 20:00–23:00 from Evening on Mon 5 Oct."]);
  });

  it("reads past midnight both ways, and ignores dated blocks and the excluded block", () => {
    const late = block({ id: "late", title: "Late", dayOfWeek: 6, startMinuteOfDay: 23 * 60, durationMinutes: 120 });
    const night = block({ id: "night", title: "Night", dayOfWeek: 6, startMinuteOfDay: 0, durationMinutes: 360 });
    const otherSpecial = block({ id: "special", title: "Special", dayOfWeek: 0, startMinuteOfDay: 0, durationMinutes: 60, validFrom: "2026-10-04", validUntil: "2026-10-04" });
    // Once on Sun 4 Oct 00:30-01:00 inside Saturday's 23:00-01:00.
    expect(
      describeScheduleTakeover({ dayOfWeeks: [0], startMinuteOfDay: 30, durationMinutes: 30, validFrom: "2026-10-04", validUntil: "2026-10-04", blocks: [late, otherSpecial] })
    ).toEqual(["Takes over 00:30–01:00 from Late on Sun 4 Oct."]);
    // Once on Fri 2 Oct 23:30 for 2 h, into Saturday's 00:00-06:00.
    expect(
      describeScheduleTakeover({ dayOfWeeks: [5], startMinuteOfDay: 23 * 60 + 30, durationMinutes: 120, validFrom: "2026-10-02", validUntil: "2026-10-02", blocks: [night] })
    ).toEqual(["Takes over 00:00–01:30 from Night on Fri 2 Oct; Night continues at 01:30."]);
    expect(
      describeScheduleTakeover({ dayOfWeeks: [5], startMinuteOfDay: 23 * 60 + 30, durationMinutes: 120, validFrom: "2026-10-02", validUntil: "2026-10-02", blocks: [night], excludeIds: ["night"] })
    ).toEqual([]);
  });

  it("counts the days of a run and finds the weekdays of a set outside its dates", () => {
    expect(countScheduleDatesInWindow("2026-10-01", "2026-10-10")).toBe(10);
    expect(countScheduleDatesInWindow("2026-10-10", "2026-10-01")).toBe(0);
    expect(countScheduleDatesInWindow("2026-10-01", "")).toBe(0);
    expect(findWeekdaysOutsideDateWindow([5, 1, 3], "2026-10-05", "2026-10-06")).toEqual([3, 5]);
    expect(findWeekdaysOutsideDateWindow([1, 3, 5], "2026-10-01", "2026-10-10")).toEqual([]);
  });

  it("the block form shows the notice and the number of days for a dated block being edited", () => {
    const special = [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) =>
      block({
        id: `special-${dayOfWeek}`,
        title: "Abendspecial",
        dayOfWeek,
        startMinuteOfDay: 20 * 60,
        durationMinutes: 120,
        repeatMode: "daily",
        repeatGroupId: "repeat-special",
        validFrom: "2026-10-01",
        validUntil: "2026-10-10"
      })
    );
    const html = renderToStaticMarkup(
      React.createElement(ScheduleBlockForm, {
        pools: [{ id: "a", name: "Archive pool" }],
        assets: [],
        shows: [],
        block: special[4],
        blocks: [...evening, ...special],
        today: "2026-10-01"
      })
    );
    expect(html).toContain("For how many days");
    expect(html).toMatch(/type="number" value="10"/);
    expect(html).toContain("Takes over 20:00–22:00 from Evening on 10 days (Thu 1 Oct to Sat 10 Oct); Evening continues at 22:00.");
    // Saved without the set, only Thursday's copy runs: Thu 1 Oct and Thu 8 Oct.
    expect(html).not.toContain("do not fall between these dates");
  });
});
