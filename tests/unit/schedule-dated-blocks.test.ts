import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  addDaysToDateString,
  applyScheduleLayers,
  buildMaterializedProgrammingWeek,
  buildScheduleOccurrences,
  describeScheduleBlockRun,
  filterWeekdaysInDateWindow,
  findCurrentScheduleOccurrence,
  findNextScheduleOccurrenceAcrossDays,
  findScheduleConflicts,
  getScheduleOccurrenceRunKey,
  listScheduleAirSegments,
  listUpcomingScheduleOccurrences,
  summarizeScheduleWeek,
  validateScheduleBlock,
  type ScheduleBlock
} from "@stream247/core";
import type { AppState } from "@stream247/db";

const {
  mockRequireApiRoles,
  mockGetAuthenticatedUser,
  mockAppendAuditEvent,
  mockReadAppState,
  mockCreateScheduleBlocksChecked,
  mockUpdateScheduleBlockRecord
} = vi.hoisted(() => ({
  mockRequireApiRoles: vi.fn(),
  mockGetAuthenticatedUser: vi.fn(),
  mockAppendAuditEvent: vi.fn(),
  mockReadAppState: vi.fn(),
  mockCreateScheduleBlocksChecked: vi.fn(),
  mockUpdateScheduleBlockRecord: vi.fn()
}));

vi.mock("@/lib/server/auth", () => ({
  requireApiRoles: mockRequireApiRoles,
  getAuthenticatedUser: mockGetAuthenticatedUser
}));

vi.mock("next/server", () => ({
  NextResponse: {
    json(payload: unknown, init?: ResponseInit) {
      return new Response(JSON.stringify(payload), { status: init?.status ?? 200, headers: { "content-type": "application/json" } });
    }
  }
}));

vi.mock("@/lib/server/state", () => ({
  appendAuditEvent: mockAppendAuditEvent,
  createScheduleBlocks: vi.fn(),
  createScheduleBlocksChecked: mockCreateScheduleBlocksChecked,
  deleteScheduleBlockRecord: vi.fn(),
  getWorkspaceTimeZone: () => "UTC",
  readAppState: mockReadAppState,
  updateScheduleBlockRecord: mockUpdateScheduleBlockRecord,
  updateScheduleRepeatGroupRecords: vi.fn()
}));

import { getCuepointInsertPlan } from "../../apps/worker/src/cuepoints";
import { planTwitchScheduleSegments } from "../../apps/worker/src/twitch-schedule-plan";
import { POST, PUT } from "../../apps/web/app/api/schedule/blocks/route";

// M93: dated and one-off blocks. A block may carry a first and a last date (channel-local, inclusive) that
// bound when it starts; a dated block sits on a layer above the weekly grid and takes over the part it
// overlaps, the weekly block continuing around it (owner decision 5.1 Q1). Dates used: 2026-10-01 is a
// Thursday, 2026-10-10 a Saturday, 2026-10-11 a Sunday.

const block = (overrides: Partial<ScheduleBlock> & Pick<ScheduleBlock, "id" | "dayOfWeek" | "startMinuteOfDay" | "durationMinutes">): ScheduleBlock => ({
  title: overrides.id,
  categoryName: "Replay",
  sourceName: "Pool",
  poolId: "pool-1",
  ...overrides
});

const everyDay = [0, 1, 2, 3, 4, 5, 6];

// "For the next 10 days, every evening at 20:00, this playlist": the daily repeat set, all seven rows dated.
const tenEvenings = everyDay.map((dayOfWeek) =>
  block({
    id: `evening-${dayOfWeek}`,
    dayOfWeek,
    startMinuteOfDay: 20 * 60,
    durationMinutes: 120,
    repeatMode: "daily",
    repeatGroupId: "repeat-evening",
    validFrom: "2026-10-01",
    validUntil: "2026-10-10"
  })
);

// A channel programmed around the clock: one 24 h block per weekday.
const grid = everyDay.map((dayOfWeek) => block({ id: `grid-${dayOfWeek}`, dayOfWeek, startMinuteOfDay: 0, durationMinutes: 1440, poolId: "grid-pool" }));

function current(blocks: ScheduleBlock[], date: string, time: string) {
  return findCurrentScheduleOccurrence({ occurrences: buildScheduleOccurrences({ date, blocks }), currentTime: time });
}

function sameDayDated(blocks: ScheduleBlock[], date: string) {
  return buildScheduleOccurrences({ date, blocks }).filter((occurrence) => occurrence.dated && !occurrence.carriesOverFromPreviousDay);
}

describe("the date window bounds when a block starts", () => {
  it("airs a 10-day run on day 10 and not on day 11 (nor the day before day 1)", () => {
    const days = Array.from({ length: 12 }, (_, offset) => addDaysToDateString("2026-09-30", offset));
    const airing = days.filter((date) => sameDayDated(tenEvenings, date).length > 0);
    expect(airing).toEqual(Array.from({ length: 10 }, (_, offset) => addDaysToDateString("2026-10-01", offset)));
    expect(current(tenEvenings, "2026-10-10", "20:30")?.blockId).toBe("evening-6");
    expect(current(tenEvenings, "2026-10-11", "20:30")).toBeNull();
  });

  it("airs a once-block once", () => {
    const once = block({ id: "once", dayOfWeek: 6, startMinuteOfDay: 20 * 60, durationMinutes: 60, validFrom: "2026-10-10", validUntil: "2026-10-10" });
    const days = Array.from({ length: 28 }, (_, offset) => addDaysToDateString("2026-09-26", offset));
    expect(days.filter((date) => sameDayDated([once], date).length > 0)).toEqual(["2026-10-10"]);
    // The same block without dates is "One weekday, every week": every Saturday.
    const weekly = { ...once, validFrom: "", validUntil: "" };
    expect(days.filter((date) => buildScheduleOccurrences({ date, blocks: [weekly] }).some((o) => !o.carriesOverFromPreviousDay))).toEqual([
      "2026-09-26",
      "2026-10-03",
      "2026-10-10",
      "2026-10-17"
    ]);
  });

  it("lets a run that crosses midnight on its last date end, and starts it no more", () => {
    const late = everyDay.map((dayOfWeek) =>
      block({ id: `late-${dayOfWeek}`, dayOfWeek, startMinuteOfDay: 23 * 60, durationMinutes: 120, validFrom: "2026-10-01", validUntil: "2026-10-10" })
    );
    const blocks = [...late, ...grid];
    // 10 Oct 23:00 starts the last run; at 00:30 on 11 Oct it is still on air (the carry-over).
    expect(current(blocks, "2026-10-10", "23:30")?.blockId).toBe("late-6");
    const carry = current(blocks, "2026-10-11", "00:30");
    expect(carry).toMatchObject({ blockId: "late-6", carriesOverFromPreviousDay: true, dated: true });
    // At 01:00 it ends and the weekly grid is back; at 23:30 on 11 Oct no run starts.
    expect(current(blocks, "2026-10-11", "01:00")?.blockId).toBe("grid-0");
    expect(current(blocks, "2026-10-11", "23:30")?.blockId).toBe("grid-0");
  });
});

describe("the dated layer over the weekly grid", () => {
  const weekly = block({ id: "weekly", dayOfWeek: 4, startMinuteOfDay: 18 * 60, durationMinutes: 240, cuepointOffsetsSeconds: [900, 9000, 11700] });
  const dated = block({ id: "dated", dayOfWeek: 4, startMinuteOfDay: 20 * 60, durationMinutes: 60, validFrom: "2026-10-01", validUntil: "2026-10-01", poolId: "special-pool" });

  it("gives weekly 18-22 + dated 20-21 three windows, the weekly ones under one key", () => {
    const occurrences = buildScheduleOccurrences({ date: "2026-10-01", blocks: [weekly, dated] });
    const weeklyOccurrence = occurrences.find((occurrence) => occurrence.blockId === "weekly")!;
    const datedOccurrence = occurrences.find((occurrence) => occurrence.blockId === "dated")!;
    expect(weeklyOccurrence.airWindows).toEqual([
      { start: 1080, end: 1200 },
      { start: 1260, end: 1320 }
    ]);
    expect(datedOccurrence.airWindows).toEqual([{ start: 1200, end: 1260 }]);
    // The weekly occurrence keeps its start (cuepoints count from 18:00) and its one key.
    expect(weeklyOccurrence).toMatchObject({ startMinuteOfDay: 1080, durationMinutes: 240, key: "2026-10-01:weekly:1080:240" });

    const segments = listScheduleAirSegments(occurrences);
    expect(segments.map((segment) => `${segment.startTime}-${segment.endTime} ${segment.blockId}`)).toEqual([
      "18:00-20:00 weekly",
      "20:00-21:00 dated",
      "21:00-22:00 weekly"
    ]);

    // On air: the weekly block, the dated one, then the weekly block again with the same run key.
    expect(current([weekly, dated], "2026-10-01", "19:30")?.blockId).toBe("weekly");
    expect(current([weekly, dated], "2026-10-01", "20:30")?.blockId).toBe("dated");
    const resumed = current([weekly, dated], "2026-10-01", "21:30")!;
    expect(resumed.blockId).toBe("weekly");
    expect(getScheduleOccurrenceRunKey(resumed)).toBe(weeklyOccurrence.key);
    // A week later the dated block is gone and the weekly block airs whole.
    expect(buildScheduleOccurrences({ date: "2026-10-08", blocks: [weekly, dated] }).map((o) => o.airWindows)).toEqual([
      [{ start: 1080, end: 1320 }]
    ]);
  });

  it("ranks the dated occurrence first when a weekly block starts inside its window", () => {
    const datedLong = { ...dated, durationMinutes: 120 };
    const weeklyLate = block({ id: "weekly-late", dayOfWeek: 4, startMinuteOfDay: 21 * 60, durationMinutes: 180 });
    // Without the rank the later start (21:00) would take over.
    expect(current([datedLong, weeklyLate], "2026-10-01", "21:30")?.blockId).toBe("dated");
    expect(current([datedLong, weeklyLate], "2026-10-01", "22:30")?.blockId).toBe("weekly-late");
  });

  it("leaves out a weekly occurrence the dated block takes over completely", () => {
    const short = block({ id: "short", dayOfWeek: 4, startMinuteOfDay: 20 * 60 + 15, durationMinutes: 30 });
    expect(buildScheduleOccurrences({ date: "2026-10-01", blocks: [short, dated] }).map((o) => o.blockId)).toEqual(["dated"]);
    // applyScheduleLayers on its own reads the dated ranges from the list it gets.
    const raw = [
      ...buildScheduleOccurrences({ date: "2026-10-08", blocks: [short] }),
      ...buildScheduleOccurrences({ date: "2026-10-01", blocks: [dated] }).map((o) => ({ ...o, date: "2026-10-08" }))
    ];
    expect(applyScheduleLayers(raw).map((o) => o.blockId)).toEqual(["dated"]);
  });

  it("cuts a weekly block crossing midnight around a dated block early the next day", () => {
    const night = block({ id: "night", dayOfWeek: 3, startMinuteOfDay: 22 * 60, durationMinutes: 240 });
    const early = block({ id: "early", dayOfWeek: 4, startMinuteOfDay: 30, durationMinutes: 30, validFrom: "2026-10-01", validUntil: "2026-10-01" });
    // Wednesday 30 Sep's list already knows the Thursday 00:30 block.
    const wednesday = buildScheduleOccurrences({ date: "2026-09-30", blocks: [night, early] });
    expect(wednesday.find((o) => o.blockId === "night")?.airWindows).toEqual([
      { start: 1320, end: 1470 },
      { start: 1500, end: 1560 }
    ]);
    expect(current([night, early], "2026-10-01", "00:45")?.blockId).toBe("early");
    expect(current([night, early], "2026-10-01", "01:15")?.blockId).toBe("night");
  });

  it("lists the weekly block coming back as next while the dated block is on air", () => {
    const occurrences = buildScheduleOccurrences({ date: "2026-10-01", blocks: [weekly, dated] });
    const upcoming = listUpcomingScheduleOccurrences({ occurrences, currentTime: "20:30" });
    expect(upcoming.map((segment) => `${segment.startTime} ${segment.blockId}`)).toEqual(["21:00 weekly"]);
    expect(upcoming[0]?.key).toBe("2026-10-01:weekly:1080:240@1260");
    expect(findNextScheduleOccurrenceAcrossDays({ blocks: [weekly, dated], date: "2026-10-01", currentTime: "19:00" })).toMatchObject({
      blockId: "dated",
      startTime: "20:00"
    });
  });

  it("does not fire a cuepoint again when the weekly block comes back, and skips one inside the dated window", () => {
    const state = (playout: Partial<AppState["playout"]>): AppState =>
      ({
        scheduleBlocks: [weekly, dated],
        pools: [
          { id: "pool-1", name: "Pool", sourceIds: ["source-1"], insertAssetId: "sting", insertEveryItems: 0 },
          { id: "special-pool", name: "Special", sourceIds: ["source-1"], insertAssetId: "", insertEveryItems: 0 }
        ],
        assets: [{ id: "sting", sourceId: "source-1", title: "Sting", status: "ready", includeInProgramming: true }],
        playout: { cuepointWindowKey: "", cuepointFiredKeys: [], ...playout }
      }) as unknown as AppState;
    const plan = (playout: Partial<AppState["playout"]>, time: string) =>
      getCuepointInsertPlan({
        state: state(playout),
        currentScheduleItem: current([weekly, dated], "2026-10-01", time),
        skippedAssetId: "",
        now: new Date(`2026-10-01T${time}:00.000Z`),
        timeZone: "UTC"
      });

    // 18:16: the 900 s cuepoint fires under the weekly run key.
    const first = plan({}, "18:16");
    expect(first?.offsetSeconds).toBe(900);
    const weeklyRunKey = "2026-10-01:weekly:1080:240";

    // 20:00-21:00 the dated block is on air, so the worker's window key became the dated run's and the weekly
    // block's fired keys went with it (apps/worker/src/index.ts cuepointWindowKey).
    const datedRunKey = getScheduleOccurrenceRunKey(current([weekly, dated], "2026-10-01", "20:30")!);
    expect(datedRunKey).not.toBe(weeklyRunKey);

    // 21:05: the weekly block is back with no fired keys. 900 s (18:15) belongs to its first window and
    // 9000 s (20:30) to the part the dated block took over: neither fires.
    expect(plan({ cuepointWindowKey: datedRunKey, cuepointFiredKeys: [] }, "21:05")).toBeNull();
    // 21:16: 11700 s (21:15) lies in the window on air and fires once.
    const third = plan({ cuepointWindowKey: datedRunKey, cuepointFiredKeys: [] }, "21:16");
    expect(third?.offsetSeconds).toBe(11700);
    expect(plan({ cuepointWindowKey: weeklyRunKey, cuepointFiredKeys: [third!.cuepointKey] }, "21:30")).toBeNull();
  });

  it("counts a dated block over a 24/7 grid once in the day's scheduled minutes", () => {
    const [thursday] = buildMaterializedProgrammingWeek({ startDate: "2026-10-01", blocks: [...grid, dated], pools: [], assets: [] });
    expect(thursday?.totalScheduledMinutes).toBe(1440);
    expect(thursday?.blocks.map((entry) => entry.blockId)).toEqual(["grid-4", "dated"]);
    expect(thursday?.blocks[0]?.airWindows).toEqual([
      { start: 0, end: 1200 },
      { start: 1260, end: 1440 }
    ]);
    // The weekly coverage summary is the weekly grid alone.
    expect(summarizeScheduleWeek([...grid, dated])[4]?.scheduledMinutes).toBe(1440);
  });
});

describe("conflicts are per layer", () => {
  const special = block({ id: "special", dayOfWeek: 4, startMinuteOfDay: 20 * 60, durationMinutes: 120, validFrom: "2026-10-01", validUntil: "2026-10-10" });

  it("saves a dated 20:00 block on a 24/7 grid (before M93: [\"grid\",\"special\"])", () => {
    expect(findScheduleConflicts([...grid, special])).toEqual([]);
    // Two undated blocks still conflict, as before.
    expect(findScheduleConflicts([...grid, { ...special, validFrom: "", validUntil: "" }]).sort()).toEqual(["grid-4", "special"]);
  });

  it("refuses two dated blocks whose dates and times meet, and allows them on different dates", () => {
    const other = { ...special, id: "other", validFrom: "2026-10-08", validUntil: "2026-10-08" };
    expect(findScheduleConflicts([special, other]).sort()).toEqual(["other", "special"]);
    expect(findScheduleConflicts([special, { ...other, validFrom: "2026-10-15", validUntil: "2026-10-15" }])).toEqual([]);
  });

  it("counts the day after the last date for a dated block crossing midnight", () => {
    const late = block({ id: "late", dayOfWeek: 6, startMinuteOfDay: 23 * 60, durationMinutes: 120, validFrom: "2026-10-10", validUntil: "2026-10-10" });
    const sundayEarly = block({ id: "sunday-early", dayOfWeek: 0, startMinuteOfDay: 30, durationMinutes: 30, validFrom: "2026-10-11", validUntil: "2026-10-11" });
    expect(findScheduleConflicts([late, sundayEarly]).sort()).toEqual(["late", "sunday-early"]);
  });
});

describe("validation and labels", () => {
  const base = { title: "Special", categoryName: "Replay", sourceName: "Pool", poolId: "pool-1", dayOfWeek: 6, startMinuteOfDay: 1200, durationMinutes: 60 };

  it("refuses a last date before the first, a window in the past, a non-date and a weekday outside the dates", () => {
    expect(validateScheduleBlock({ ...base, validFrom: "2026-10-10", validUntil: "2026-10-09" })).toBe("The last date must be on or after the first date.");
    expect(validateScheduleBlock({ ...base, validFrom: "2026-10-01", validUntil: "2026-10-03" }, { today: "2026-10-04" })).toBe(
      "These dates lie entirely in the past."
    );
    expect(validateScheduleBlock({ ...base, validFrom: "2026-02-30", validUntil: "" })).toBe("Dates must be calendar dates (YYYY-MM-DD).");
    expect(validateScheduleBlock({ ...base, dayOfWeek: 1, validFrom: "2026-10-10", validUntil: "2026-10-10" })).toBe(
      "This weekday does not fall between these dates."
    );
    expect(validateScheduleBlock({ ...base, validFrom: "2026-10-10", validUntil: "2026-10-10" }, { today: "2026-10-10" })).toBeNull();
  });

  it("keeps only the weekdays a short window contains", () => {
    // Thursday 1 Oct to Saturday 3 Oct.
    expect(filterWeekdaysInDateWindow(everyDay, "2026-10-01", "2026-10-03")).toEqual([4, 5, 6]);
    expect(filterWeekdaysInDateWindow(everyDay, "2026-10-01", "2026-10-10")).toEqual(everyDay);
  });

  it("describes how a block runs, and when it has ended", () => {
    expect(describeScheduleBlockRun({})).toEqual({ label: "", ended: false });
    expect(describeScheduleBlockRun({ validFrom: "2026-10-10", validUntil: "2026-10-10" }, "2026-10-04")).toEqual({ label: "Once on 10 Oct", ended: false });
    expect(describeScheduleBlockRun({ validFrom: "2026-10-01", validUntil: "2026-10-10" }, "2026-10-04")).toEqual({ label: "1 Oct to 10 Oct", ended: false });
    expect(describeScheduleBlockRun({ validFrom: "2026-10-01", validUntil: "2026-10-10" }, "2026-10-11")).toEqual({ label: "Ended 10 Oct", ended: true });
  });
});

describe("Twitch gets the dated runs and the weekly windows around them", () => {
  it("sends a 10-day run on the dates it airs: days 1-7 at once, days 8-10 as the window rolls, nothing after", () => {
    const keysFrom = (currentDate: string) =>
      planTwitchScheduleSegments({ blocks: tenEvenings, currentDate, timeZone: "UTC", now: new Date(`${currentDate}T00:00:00.000Z`) }).segments.map(
        (segment) => segment.startTime.slice(0, 10)
      );
    expect(keysFrom("2026-10-01")).toEqual(Array.from({ length: 7 }, (_, offset) => addDaysToDateString("2026-10-01", offset)));
    expect(keysFrom("2026-10-06")).toEqual(["2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10"]);
    expect(keysFrom("2026-10-11")).toEqual([]);
  });

  it("sends weekly 18-22 under a dated 20-21 as three segments", () => {
    const weekly = block({ id: "weekly", dayOfWeek: 4, startMinuteOfDay: 18 * 60, durationMinutes: 240 });
    const dated = block({ id: "dated", dayOfWeek: 4, startMinuteOfDay: 20 * 60, durationMinutes: 60, validFrom: "2026-10-01", validUntil: "2026-10-01" });
    const { segments } = planTwitchScheduleSegments({
      blocks: [weekly, dated],
      currentDate: "2026-10-01",
      timeZone: "UTC",
      now: new Date("2026-10-01T00:00:00.000Z")
    });
    expect(segments.filter((segment) => segment.startTime.startsWith("2026-10-01")).map((s) => `${s.startTime.slice(11, 16)} ${s.durationMinutes} ${s.key}`)).toEqual([
      "18:00 120 2026-10-01:weekly:1080:240",
      "20:00 60 2026-10-01:dated:1200:60",
      "21:00 60 2026-10-01:weekly:1080:240@1260"
    ]);
    // A week later the weekly block is one segment again.
    const weekLater = planTwitchScheduleSegments({
      blocks: [weekly, dated],
      currentDate: "2026-10-08",
      timeZone: "UTC",
      now: new Date("2026-10-08T00:00:00.000Z")
    }).segments;
    expect(weekLater.filter((segment) => segment.startTime.startsWith("2026-10-08")).map((s) => s.durationMinutes)).toEqual([240]);
  });
});

describe("the block route saves dated and one-off blocks", () => {
  const pool = { id: "pool-1", name: "Evening pool", insertAssetId: "" };
  const now = new Date("2026-10-01T09:00:00.000Z");

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(now);
    mockRequireApiRoles.mockResolvedValue(null);
    mockGetAuthenticatedUser.mockResolvedValue({ displayName: "Owner" });
    mockAppendAuditEvent.mockResolvedValue(undefined);
    mockReadAppState.mockResolvedValue({ pools: [pool], showProfiles: [], assets: [], scheduleBlocks: grid, managedConfig: {} });
    // Runs the route's own check against the stored 24/7 grid, as the transaction does.
    mockCreateScheduleBlocksChecked.mockImplementation(async (incoming: ScheduleBlock[], validate: (existing: ScheduleBlock[], incoming: ScheduleBlock[]) => void) => {
      validate(grid, incoming);
    });
    mockUpdateScheduleBlockRecord.mockResolvedValue(undefined);
  });

  const request = (body: Record<string, unknown>) =>
    ({ json: async () => ({ title: "Abendspecial", categoryName: "Replay", poolId: "pool-1", startMinuteOfDay: 1200, durationMinutes: 120, ...body }) }) as never;

  it("saves 'the next 10 days at 20:00' on a 24/7 grid, as a daily set with the dates", async () => {
    const response = await POST(request({ repeatMode: "daily", runs: "between", validFrom: "2026-10-01", validUntil: "2026-10-10" }));
    expect(response.status).toBe(200);
    const created = mockCreateScheduleBlocksChecked.mock.calls[0]?.[0] as ScheduleBlock[];
    expect(created.map((entry) => entry.dayOfWeek)).toEqual(everyDay);
    expect(new Set(created.map((entry) => `${entry.validFrom}..${entry.validUntil}`))).toEqual(new Set(["2026-10-01..2026-10-10"]));
    expect(new Set(created.map((entry) => entry.repeatGroupId)).size).toBe(1);
  });

  it("creates only the weekdays a short run contains", async () => {
    const response = await POST(request({ repeatMode: "daily", runs: "between", validFrom: "2026-10-01", validUntil: "2026-10-03" }));
    expect(response.status).toBe(200);
    expect((mockCreateScheduleBlocksChecked.mock.calls[0]?.[0] as ScheduleBlock[]).map((entry) => entry.dayOfWeek)).toEqual([4, 5, 6]);
  });

  it("saves 'once on 10 Oct' on that date's weekday, whatever weekday was sent", async () => {
    const response = await POST(request({ repeatMode: "weekdays", dayOfWeek: 1, dayOfWeeks: [1, 2, 3], runs: "once", validFrom: "2026-10-10" }));
    expect(response.status).toBe(200);
    expect(mockCreateScheduleBlocksChecked.mock.calls[0]?.[0]).toEqual([
      expect.objectContaining({ dayOfWeek: 6, repeatMode: "single", repeatGroupId: "", validFrom: "2026-10-10", validUntil: "2026-10-10" })
    ]);
  });

  it("still refuses an undated 20:00 block on the 24/7 grid", async () => {
    const response = await POST(request({ repeatMode: "single", dayOfWeek: 4, runs: "weekly", validFrom: "2026-10-01" }));
    expect(response.status).toBe(400);
    expect(((await response.json()) as { message: string }).message).toBe("Schedule blocks overlap. Adjust the new start time or duration.");
  });

  it("refuses dates in the past and a run with a missing date", async () => {
    const past = await POST(request({ repeatMode: "single", dayOfWeek: 2, runs: "between", validFrom: "2026-09-01", validUntil: "2026-09-29" }));
    expect(((await past.json()) as { message: string }).message).toBe("These dates lie entirely in the past.");
    const missing = await POST(request({ repeatMode: "single", dayOfWeek: 2, runs: "between", validFrom: "2026-10-01" }));
    expect(((await missing.json()) as { message: string }).message).toBe("Choose a first and a last date.");
    expect(mockCreateScheduleBlocksChecked).not.toHaveBeenCalled();
  });

  it("keeps a block's dates when the timeline moves it without saying how it runs", async () => {
    const stored = block({ id: "special", dayOfWeek: 4, startMinuteOfDay: 1200, durationMinutes: 120, poolId: "pool-1", validFrom: "2026-10-01", validUntil: "2026-10-10" });
    mockReadAppState.mockResolvedValue({ pools: [pool], showProfiles: [], assets: [], scheduleBlocks: [...grid, stored], managedConfig: {} });
    const response = await PUT(request({ ...stored, startMinuteOfDay: 1260 }));
    expect(response.status).toBe(200);
    expect(mockUpdateScheduleBlockRecord).toHaveBeenCalledWith(
      expect.objectContaining({ id: "special", startMinuteOfDay: 1260, validFrom: "2026-10-01", validUntil: "2026-10-10" })
    );
  });
});
