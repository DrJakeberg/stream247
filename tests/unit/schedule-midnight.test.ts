import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildCuepointKey,
  buildMaterializedProgrammingWeek,
  buildScheduleOccurrences,
  findCurrentScheduleOccurrence,
  findScheduleConflicts,
  findScheduleConflictsInvolving,
  getScheduleOccurrenceRunKey,
  type ScheduleBlock
} from "@stream247/core";
import type { AppState } from "@stream247/db";
import { getCuepointInsertPlan } from "../../apps/worker/src/cuepoints";
import { planTwitchScheduleSegments } from "../../apps/worker/src/twitch-schedule-plan";
import { collectUpcomingPoolIds } from "../../apps/worker/src/vod-cache-release-policy";

// M88: a block that runs past midnight is one block everywhere. Before M88 its after-midnight part was a
// second block in four places: cuepoints fired again after 00:00 (C1), Twitch got a phantom segment a day
// late (C2), the overlap check compared it with the wrong weekday (C3), and the cache keep-rule saw it 23 h
// late (B3). The week lens counted it on both days (C6).

const block = (overrides: Partial<ScheduleBlock> & Pick<ScheduleBlock, "id" | "dayOfWeek" | "startMinuteOfDay" | "durationMinutes">): ScheduleBlock => ({
  title: overrides.id,
  categoryName: "Replay",
  sourceName: "Pool",
  poolId: "pool-1",
  ...overrides
});

function currentOccurrence(blocks: ScheduleBlock[], date: string, time: string) {
  return findCurrentScheduleOccurrence({ occurrences: buildScheduleOccurrences({ date, blocks }), currentTime: time });
}

describe("C1: cuepoints of a block crossing midnight", () => {
  // 2026-10-03 is a Saturday. Saturday 23:00 for 120 min with cuepoints at 900 s and 2700 s.
  const lateBlock = block({
    id: "late",
    dayOfWeek: 6,
    startMinuteOfDay: 23 * 60,
    durationMinutes: 120,
    cuepointOffsetsSeconds: [900, 2700]
  });

  function stateWith(playout: Partial<AppState["playout"]>): AppState {
    return {
      scheduleBlocks: [lateBlock],
      pools: [{ id: "pool-1", name: "Pool", sourceIds: ["source-1"], insertAssetId: "sting", insertEveryItems: 0 }],
      assets: [{ id: "sting", sourceId: "source-1", title: "Sting", status: "ready", includeInProgramming: true }],
      playout: { cuepointWindowKey: "", cuepointFiredKeys: [], ...playout }
    } as unknown as AppState;
  }

  function plan(state: AppState, date: string, time: string, iso: string) {
    return getCuepointInsertPlan({
      state,
      currentScheduleItem: currentOccurrence([lateBlock], date, time),
      skippedAssetId: "",
      now: new Date(iso),
      timeZone: "UTC"
    });
  }

  it("does not fire the cuepoints again after 00:05 once both aired before midnight", () => {
    const evening = currentOccurrence([lateBlock], "2026-10-03", "23:16");
    expect(evening?.carriesOverFromPreviousDay).toBe(false);

    // 23:16: the 900 s cuepoint is due. The worker records it under the run key (index.ts cuepointWindowKey).
    const first = plan(stateWith({}), "2026-10-03", "23:16", "2026-10-03T23:16:00.000Z");
    expect(first?.offsetSeconds).toBe(900);
    const runKey = getScheduleOccurrenceRunKey(evening!);
    const fired = [first!.cuepointKey];

    // 23:46: the 2700 s cuepoint is due.
    const second = plan(stateWith({ cuepointWindowKey: runKey, cuepointFiredKeys: fired }), "2026-10-03", "23:46", "2026-10-03T23:46:00.000Z");
    expect(second?.offsetSeconds).toBe(2700);
    fired.push(second!.cuepointKey);

    // 00:05 Sunday: the carry-over is on air; its run key is the evening's, so both stay fired.
    const carry = currentOccurrence([lateBlock], "2026-10-04", "00:05");
    expect(carry?.carriesOverFromPreviousDay).toBe(true);
    expect(carry?.key).toBe("2026-10-04:late:1380:120:carry");
    expect(getScheduleOccurrenceRunKey(carry!)).toBe(runKey);
    expect(plan(stateWith({ cuepointWindowKey: runKey, cuepointFiredKeys: fired }), "2026-10-04", "00:05", "2026-10-04T00:05:00.000Z")).toBeNull();
  });

  it("still fires a cuepoint that falls after midnight, once", () => {
    const withLateCue = block({ ...lateBlock, cuepointOffsetsSeconds: [900, 4500] });
    const state = (playout: Partial<AppState["playout"]>) => ({ ...stateWith(playout), scheduleBlocks: [withLateCue] }) as AppState;
    const runKey = "2026-10-03:late:1380:120";
    const firedBefore = [buildCuepointKey(runKey, 900)];

    const atQuarterPast = getCuepointInsertPlan({
      state: state({ cuepointWindowKey: runKey, cuepointFiredKeys: firedBefore }),
      currentScheduleItem: currentOccurrence([withLateCue], "2026-10-04", "00:16"),
      skippedAssetId: "",
      now: new Date("2026-10-04T00:16:00.000Z"),
      timeZone: "UTC"
    });
    expect(atQuarterPast?.offsetSeconds).toBe(4500);
    expect(atQuarterPast?.cuepointKey).toBe(buildCuepointKey(runKey, 4500));

    const afterwards = getCuepointInsertPlan({
      state: state({ cuepointWindowKey: runKey, cuepointFiredKeys: [...firedBefore, atQuarterPast!.cuepointKey] }),
      currentScheduleItem: currentOccurrence([withLateCue], "2026-10-04", "00:30"),
      skippedAssetId: "",
      now: new Date("2026-10-04T00:30:00.000Z"),
      timeZone: "UTC"
    });
    expect(afterwards).toBeNull();
  });

  it("keeps the worker and the live summary on the run key", () => {
    const worker = readFileSync(new URL("../../apps/worker/src/index.ts", import.meta.url), "utf8");
    expect(worker).toContain("const cuepointWindowKey = currentScheduleItem ? getScheduleOccurrenceRunKey(currentScheduleItem) : \"\";");
    const web = readFileSync(new URL("../../apps/web/lib/server/state.ts", import.meta.url), "utf8");
    expect(web).toContain("occurrenceKey: getScheduleOccurrenceRunKey(currentScheduleItem)");
  });
});

describe("C2/B1: the Twitch schedule plan", () => {
  it("gives a Monday 23:00 block of 120 min one segment over seven days, with no carry-over key", () => {
    // Sunday 2026-10-04 12:00 Berlin: the window runs Sunday to Saturday and holds one Monday.
    const plan = planTwitchScheduleSegments({
      blocks: [block({ id: "mon-late", dayOfWeek: 1, startMinuteOfDay: 23 * 60, durationMinutes: 120 })],
      currentDate: "2026-10-04",
      timeZone: "Europe/Berlin",
      now: new Date("2026-10-04T10:00:00.000Z")
    });

    expect(plan.segments).toHaveLength(1);
    expect(plan.segments[0]).toMatchObject({
      key: "2026-10-05:mon-late:1380:120",
      startTime: "2026-10-05T21:00:00.000Z",
      durationMinutes: 120
    });
    expect(plan.segments.some((segment) => segment.key.endsWith(":carry"))).toBe(false);
    expect(plan.skippedCount).toBe(0);
  });

  it("leaves out runs starting within five minutes and counts blocks Twitch cannot take", () => {
    const plan = planTwitchScheduleSegments({
      blocks: [
        block({ id: "now", dayOfWeek: 0, startMinuteOfDay: 12 * 60 + 3, durationMinutes: 60 }),
        block({ id: "short", dayOfWeek: 2, startMinuteOfDay: 600, durationMinutes: 20 }),
        block({ id: "ok", dayOfWeek: 3, startMinuteOfDay: 600, durationMinutes: 60 })
      ],
      currentDate: "2026-10-04",
      timeZone: "UTC",
      now: new Date("2026-10-04T12:00:00.000Z")
    });

    expect(plan.segments.map((segment) => segment.blockId)).toEqual(["ok"]);
    expect(plan.skippedCount).toBe(1);
  });

  it("records each created segment before the next request", () => {
    const worker = readFileSync(new URL("../../apps/worker/src/index.ts", import.meta.url), "utf8");
    const sync = worker.slice(worker.indexOf("async function syncTwitchSchedule("), worker.indexOf("await replaceTwitchScheduleSegments(nextSegments);"));
    expect(sync).toContain("planTwitchScheduleSegments({");
    const loop = sync.slice(sync.indexOf("for (const occurrence of plan.segments)"));
    expect(loop.indexOf("await upsertTwitchScheduleSegment(syncedSegment);")).toBeGreaterThan(loop.indexOf("const response = await fetchWithTimeout("));
    // Inside the loop body: the upsert comes before the loop closes and the stale pass begins.
    expect(loop.indexOf("await upsertTwitchScheduleSegment(syncedSegment);")).toBeLessThan(loop.indexOf("for (const staleSegment of"));
  });
});

describe("C3/B2: the overlap check on a 7-day line", () => {
  const monLate = block({ id: "mon-late", dayOfWeek: 1, startMinuteOfDay: 23 * 60, durationMinutes: 120 });

  it("does not refuse a Monday 00:00 block 23 hours before a Monday 23:00-01:00 block", () => {
    expect(findScheduleConflicts([monLate, block({ id: "mon-early", dayOfWeek: 1, startMinuteOfDay: 0, durationMinutes: 30 })])).toEqual([]);
  });

  it("finds the Tuesday 00:00 block the Monday 23:00-01:00 block runs into", () => {
    expect(findScheduleConflicts([monLate, block({ id: "tue-early", dayOfWeek: 2, startMinuteOfDay: 0, durationMinutes: 30 })]).sort()).toEqual([
      "mon-late",
      "tue-early"
    ]);
  });

  it("wraps Saturday night into Sunday morning", () => {
    const satLate = block({ id: "sat-late", dayOfWeek: 6, startMinuteOfDay: 23 * 60, durationMinutes: 240 });
    expect(findScheduleConflicts([satLate, block({ id: "sun-early", dayOfWeek: 0, startMinuteOfDay: 60, durationMinutes: 120 })]).sort()).toEqual([
      "sat-late",
      "sun-early"
    ]);
    expect(findScheduleConflicts([satLate, block({ id: "sun-later", dayOfWeek: 0, startMinuteOfDay: 180, durationMinutes: 60 })])).toEqual([]);
  });

  it("keeps a schedule with a hidden overlap loadable: the week still builds and the overlap is named", () => {
    const blocks = [monLate, block({ id: "tue-early", dayOfWeek: 2, startMinuteOfDay: 0, durationMinutes: 30 })];
    expect(findScheduleConflicts(blocks).length).toBe(2);
    const week = buildMaterializedProgrammingWeek({ startDate: "2026-10-05", blocks, pools: [], assets: [] });
    expect(week[1]?.blocks.map((entry) => entry.blockId)).toEqual(["mon-late", "tue-early"]);
  });
});

describe("C3: a saved overlap does not lock the editor", () => {
  const monLate = block({ id: "mon-late", dayOfWeek: 1, startMinuteOfDay: 23 * 60, durationMinutes: 120 });
  const tueEarly = block({ id: "tue-early", dayOfWeek: 2, startMinuteOfDay: 0, durationMinutes: 30 });

  it("refuses only overlaps a changed block takes part in", () => {
    const unrelated = block({ id: "wed-noon", dayOfWeek: 3, startMinuteOfDay: 720, durationMinutes: 60 });
    expect(findScheduleConflictsInvolving([monLate, tueEarly, unrelated], ["wed-noon"])).toEqual([]);

    const clashing = block({ id: "tue-late-night", dayOfWeek: 2, startMinuteOfDay: 15, durationMinutes: 60 });
    expect(findScheduleConflictsInvolving([monLate, tueEarly, clashing], ["tue-late-night"]).sort()).toEqual([
      "mon-late",
      "tue-early",
      "tue-late-night"
    ]);
    // The saved pair alone is still reported when one of its blocks is the one being edited.
    expect(findScheduleConflictsInvolving([monLate, tueEarly], ["tue-early"]).sort()).toEqual(["mon-late", "tue-early"]);
  });

  it("is what the block and template routes refuse on", () => {
    const blocksRoute = readFileSync(new URL("../../apps/web/app/api/schedule/blocks/route.ts", import.meta.url), "utf8");
    expect(blocksRoute.match(/findScheduleConflictsInvolving\(/g)?.length).toBe(3);
    const templatesRoute = readFileSync(new URL("../../apps/web/app/api/schedule/templates/route.ts", import.meta.url), "utf8");
    expect(templatesRoute).toContain("findScheduleConflictsInvolving(");
  });
});

describe("B3: the cache keep-rule sees the block on air after midnight", () => {
  it("keeps the pool of a Monday 23:00-02:00 block at Tuesday 00:30 with a 60 min horizon", () => {
    // 2026-10-06 is a Tuesday.
    const ids = collectUpcomingPoolIds({
      blocks: [block({ id: "night", dayOfWeek: 1, startMinuteOfDay: 23 * 60, durationMinutes: 180, poolId: "night-pool" })],
      date: "2026-10-06",
      time: "00:30",
      horizonMinutes: 60
    });
    expect(ids).toEqual(new Set(["night-pool"]));
  });

  it("drops the pool once the block has ended", () => {
    const ids = collectUpcomingPoolIds({
      blocks: [block({ id: "night", dayOfWeek: 1, startMinuteOfDay: 23 * 60, durationMinutes: 180, poolId: "night-pool" })],
      date: "2026-10-06",
      time: "02:30",
      horizonMinutes: 60
    });
    expect(ids).toEqual(new Set());
  });
});

describe("C6: day totals count only the part inside the day", () => {
  const monLate = block({ id: "mon-late", dayOfWeek: 1, startMinuteOfDay: 23 * 60, durationMinutes: 120 });

  it("splits a Monday 23:00 block of 120 min into 60 + 60 scheduled minutes", () => {
    // 2026-10-05 is a Monday. Before M88: 120 + 120 = 240.
    const [monday, tuesday] = buildMaterializedProgrammingWeek({ startDate: "2026-10-05", blocks: [monLate], pools: [], assets: [] });
    expect(monday?.totalScheduledMinutes).toBe(60);
    expect(tuesday?.totalScheduledMinutes).toBe(60);
  });

  it("splits the projected minutes the same way", () => {
    // The projection starts with the block at Monday 23:00; whatever of it lies after 00:00 is Tuesday's.
    const [monday, tuesday] = buildMaterializedProgrammingWeek({
      startDate: "2026-10-05",
      blocks: [monLate],
      pools: [{ id: "pool-1", name: "Pool", sourceIds: ["source-1"], playbackMode: "round-robin", cursorAssetId: "", insertAssetId: "", insertEveryItems: 0 }],
      assets: [{ id: "a1", sourceId: "source-1", title: "Episode", status: "ready", includeInProgramming: true, durationSeconds: 90 * 60 }]
    } as unknown as Parameters<typeof buildMaterializedProgrammingWeek>[0]);
    const projected = monday!.blocks[0]!.projectedMinutes;
    expect(tuesday!.blocks[0]!.projectedMinutes).toBe(projected);
    expect(projected).toBe(180);
    // Before M88: 180 on Monday and 180 on Tuesday.
    expect(monday?.totalProjectedMinutes).toBe(60);
    expect(tuesday?.totalProjectedMinutes).toBe(120);
  });
});
