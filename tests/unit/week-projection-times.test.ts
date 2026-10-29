import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildMaterializedProgrammingWeek,
  buildScheduleOccurrences,
  findCurrentScheduleOccurrence,
  getScheduleInstant,
  getTwitchVodCacheCooldownEndMs,
  walkPoolRotation,
  type ScheduleBlock
} from "@stream247/core";
import type { AppState } from "@stream247/db";
import { buildPublicProgramme } from "../../apps/web/lib/public-programme";
import { buildPublicChannelView } from "../../apps/web/lib/public-channel-view";
import { getProjectionClock, getPublicProgramme, summarizeCuepoints } from "../../apps/web/lib/server/state";
import { getCuepointInsertPlan } from "../../apps/worker/src/cuepoints";
import { isTwitchVodCacheCoolingDown } from "../../apps/worker/src/twitch-vod-cache";

// M118: suggestions 14-17 of planning/archive/suggestions-2026-10-04.md. The week view and /channel project from
// when the item on air ends, carry an item that runs over its block into the next one, fill a dated block
// between the two parts of the weekly block it cuts in time order, project a 24 h block of short clips to
// its end, leave out a Twitch archive in its cache cooldown, and the live summary counts cuepoints like
// the worker.

// 2026-10-05 is a Monday. UTC keeps wall clock and instants one.
const MONDAY = "2026-10-05";
const UTC = "UTC";

const block = (overrides: Partial<ScheduleBlock> & Pick<ScheduleBlock, "id" | "dayOfWeek" | "startMinuteOfDay" | "durationMinutes">): ScheduleBlock => ({
  title: overrides.id,
  categoryName: "Archive",
  sourceName: "Pool",
  poolId: "a",
  ...overrides
});

const pool = (id: string) => ({
  id,
  name: id,
  sourceIds: [`source-${id}`],
  cursorAssetId: "",
  insertAssetId: "",
  insertEveryItems: 0,
  itemsSinceInsert: 0
});

type TestAsset = {
  id: string;
  sourceId: string;
  title: string;
  status: string;
  includeInProgramming: boolean;
  durationSeconds: number;
  createdAt: string;
  path: string;
  cacheStatus?: "" | "failed" | "ready";
  cacheUpdatedAt?: string;
};

const assets = (poolId: string, count: number, durationSeconds: number): TestAsset[] =>
  Array.from({ length: count }, (_, index) => ({
    id: `${poolId}${index + 1}`,
    sourceId: `source-${poolId}`,
    title: `${poolId}${index + 1}`,
    status: "ready",
    includeInProgramming: true,
    durationSeconds,
    createdAt: new Date(Date.UTC(2026, 8, 1, 0, index)).toISOString(),
    path: `/media/${poolId}${index + 1}.mp4`
  }));

const hm = (minute: number) => `${String(Math.floor(minute / 60) % 24).padStart(2, "0")}:${String(Math.floor(minute % 60)).padStart(2, "0")}`;
const startsOf = (block: { items: Array<{ startSecond?: number; title: string }> }) =>
  block.items.map((item) => `${item.title}@${hm((item.startSecond as number) / 60)}`);
const at = (minute: number) => getScheduleInstant({ date: MONDAY, seconds: minute * 60, timeZone: UTC });
const clock = (iso: string) => iso.slice(11, 16);

describe("15: the block on air goes on after the item on air, not now", () => {
  it("starts the next item of a 10-14 block at 11:00 when the item on air at 10:10 ends then", () => {
    const week = (onAirItemEndMinute?: number) =>
      buildMaterializedProgrammingWeek({
        startDate: MONDAY,
        blocks: [block({ id: "Day", dayOfWeek: 1, startMinuteOfDay: 600, durationMinutes: 240 })],
        pools: [pool("a")],
        assets: assets("a", 6, 3600),
        nowMinuteOfDay: 610,
        onAirItemEndMinute
      });
    // Before M118 the block's next item started "now".
    expect(startsOf(week()[0]!.blocks[0]!)[0]).toBe("a1@10:10");
    const day = week(660)[0]!;
    expect(startsOf(day.blocks[0]!).slice(0, 3)).toEqual(["a1@11:00", "a2@12:00", "a3@13:00"]);
    // The item on air fills 10:10-11:00, so the day is still fully projected.
    expect(day.totalProjectedMinutes).toBe(240);
    expect(day.blocks[0]!.fillStatus).toBe("balanced");
  });

  it("without an item on air, a part of the block on air that has ended takes nothing from the rotation", () => {
    // Weekly 10-14 with a dated 11-12 of another pool, 12:30, nothing on air (standby or a live input): the
    // weekly block goes on from now with a1, as before M118 (review finding).
    const days = buildMaterializedProgrammingWeek({
      startDate: MONDAY,
      blocks: [
        block({ id: "Weekly", dayOfWeek: 1, startMinuteOfDay: 600, durationMinutes: 240 }),
        block({ id: "Special", dayOfWeek: 1, startMinuteOfDay: 660, durationMinutes: 60, poolId: "b", validFrom: MONDAY, validUntil: MONDAY })
      ],
      pools: [pool("a"), pool("b")],
      assets: [...assets("a", 9, 1200), ...assets("b", 3, 1200)],
      nowMinuteOfDay: 750
    });
    const weekly = days[0]!.blocks.find((entry) => entry.blockId === "Weekly")!;
    expect(startsOf(weekly).slice(0, 2)).toEqual(["a1@12:30", "a2@12:50"]);
  });
});

describe("16: an item that runs over its block delays the next block", () => {
  const blocks = (datedB: boolean) => [
    block({ id: "A", dayOfWeek: 1, startMinuteOfDay: 600, durationMinutes: 60 }),
    block({
      id: "B",
      dayOfWeek: 1,
      startMinuteOfDay: 660,
      durationMinutes: 120,
      poolId: "b",
      ...(datedB ? { validFrom: MONDAY, validUntil: MONDAY } : {})
    })
  ];

  it("the item on air 10:40-11:40 holds weekly B back to 11:40 in the week view and on /channel", () => {
    const days = buildMaterializedProgrammingWeek({
      startDate: MONDAY,
      blocks: blocks(false),
      pools: [pool("a"), pool("b")],
      assets: [...assets("a", 3, 3600), ...assets("b", 3, 3600)],
      nowMinuteOfDay: 650,
      onAirItemEndMinute: 700,
      maxListedItemsPerBlock: 5000
    });
    const b = days[0]!.blocks.find((entry) => entry.blockId === "B")!;
    expect(startsOf(b).slice(0, 2)).toEqual(["b1@11:40", "b2@12:40"]);
    const programme = buildPublicProgramme({
      days,
      timeZone: UTC,
      now: at(650),
      current: { title: "Long", categoryName: "Archive", startsAt: at(640).toISOString(), endsAt: at(700).toISOString() }
    });
    expect(programme.next.map((group) => [group.title, group.items.map((item) => clock(item.startsAt))])).toEqual([["B", ["11:40", "12:40"]]]);
  });

  it("a projected item that runs over weekly A starts weekly B when it ends; a dated B starts on time and cuts it", () => {
    const week = (datedB: boolean) =>
      buildMaterializedProgrammingWeek({
        startDate: MONDAY,
        blocks: blocks(datedB),
        pools: [pool("a"), pool("b")],
        assets: [...assets("a", 3, 50 * 60), ...assets("b", 3, 3600)]
      })[0]!.blocks;
    const weekly = week(false);
    expect(startsOf(weekly[0]!)).toEqual(["a1@10:00", "a2@10:50"]);
    expect(weekly[0]!.fillLabel).toBe("Ends 40 min late");
    expect(startsOf(weekly[1]!).slice(0, 2)).toEqual(["b1@11:40", "b2@12:40"]);
    const dated = week(true);
    expect(dated[0]!.cutAtEnd).toBe(true);
    expect(startsOf(dated[1]!).slice(0, 2)).toEqual(["b1@11:00", "b2@12:00"]);
  });

  it("a block the item before covers completely airs nothing and is not reported as empty", () => {
    const days = buildMaterializedProgrammingWeek({
      startDate: MONDAY,
      blocks: [
        block({ id: "A", dayOfWeek: 1, startMinuteOfDay: 600, durationMinutes: 60 }),
        block({ id: "Short", dayOfWeek: 1, startMinuteOfDay: 660, durationMinutes: 30, poolId: "b" }),
        block({ id: "C", dayOfWeek: 1, startMinuteOfDay: 690, durationMinutes: 60, poolId: "c" })
      ],
      pools: [pool("a"), pool("b"), pool("c")],
      assets: [...assets("a", 1, 100 * 60), ...assets("b", 2, 600), ...assets("c", 2, 600)]
    });
    const [a, short, c] = days[0]!.blocks;
    expect(startsOf(a!)).toEqual(["a1@10:00"]);
    expect(short!.items).toEqual([]);
    expect(short!.fillLabel).toBe("Covered by the item before");
    expect(short!.fillStatus).not.toBe("empty");
    expect(startsOf(c!)[0]).toBe("c1@11:40");
  });
});

describe("15: a dated block of the same pool takes its items between the two parts of the weekly block", () => {
  it("weekly 18-22 with a dated 20-21, one pool: 18-20, then the dated block, then 21-22, in rotation order", () => {
    const pools = [pool("a")];
    const items = assets("a", 9, 1200);
    const days = buildMaterializedProgrammingWeek({
      startDate: MONDAY,
      blocks: [
        block({ id: "Weekly", dayOfWeek: 1, startMinuteOfDay: 18 * 60, durationMinutes: 240 }),
        block({ id: "Special", dayOfWeek: 1, startMinuteOfDay: 20 * 60, durationMinutes: 60, validFrom: MONDAY, validUntil: MONDAY })
      ],
      pools,
      assets: items
    });
    const weekly = days[0]!.blocks.find((entry) => entry.blockId === "Weekly")!;
    const special = days[0]!.blocks.find((entry) => entry.blockId === "Special")!;
    const aired = [...weekly.items, ...special.items]
      .sort((left, right) => (left.startSecond as number) - (right.startSecond as number))
      .map((item) => `${item.title}@${hm((item.startSecond as number) / 60)}`);
    // The worker's own picks, one after the other.
    const picks = walkPoolRotation({ pool: pools[0]!, assets: items, isEligible: () => true, steps: 12 }).map((pick) => pick.asset.title);
    expect(aired.map((entry) => entry.split("@")[0])).toEqual(picks);
    expect(aired).toEqual([
      "a1@18:00", "a2@18:20", "a3@18:40", "a4@19:00", "a5@19:20", "a6@19:40",
      "a7@20:00", "a8@20:20", "a9@20:40",
      "a1@21:00", "a2@21:20", "a3@21:40"
    ]);
    // Before M118 the weekly block took a7-a9 at 21:00 and the dated block started again at a1.
    expect(startsOf(special)).toEqual(["a7@20:00", "a8@20:20", "a9@20:40"]);
  });
});

describe("15: a 24 h block of very short clips is projected to its end", () => {
  it("3-second clips fill 24 h (5 000 items stopped at 4 h 10 min) and hand the next day the right clip", () => {
    const items = assets("a", 7, 3);
    const days = buildMaterializedProgrammingWeek({
      startDate: MONDAY,
      blocks: [
        block({ id: "Monday", dayOfWeek: 1, startMinuteOfDay: 0, durationMinutes: 1440 }),
        block({ id: "Tuesday", dayOfWeek: 2, startMinuteOfDay: 0, durationMinutes: 60 })
      ],
      pools: [pool("a")],
      assets: items
    });
    expect(days[0]!.blocks[0]!.projectedMinutes).toBe(1440);
    expect(days[0]!.totalProjectedMinutes).toBe(1440);
    // 28 800 clips on Monday: Tuesday starts with clip 28 800 mod 7 + 1.
    expect(days[1]!.blocks[0]!.items[0]!.title).toBe(`a${(28_800 % 7) + 1}`);
  });
});

describe("14: a Twitch archive in its cache cooldown is not in the week until the cooldown ends", () => {
  const twitchAsset = (id: string, failedAt: string): TestAsset => ({
    ...assets("a", 1, 1800)[0]!,
    id,
    title: id,
    path: "https://www.twitch.tv/videos/123456",
    cacheStatus: "failed",
    cacheUpdatedAt: failedAt,
    createdAt: "2026-09-01T00:01:00.000Z"
  });

  it("skips a2 before its cooldown ends at 11:15 and picks it again after, with a note", () => {
    const items = [assets("a", 1, 1800)[0]!, twitchAsset("a2", "2026-10-05T10:45:00.000Z"), { ...assets("a", 3, 1800)[2]! }];
    const week = (itemHolds?: Array<{ assetId: string; untilMinute: number }>) =>
      buildMaterializedProgrammingWeek({
        startDate: MONDAY,
        blocks: [block({ id: "Day", dayOfWeek: 1, startMinuteOfDay: 600, durationMinutes: 240 })],
        pools: [pool("a")],
        assets: items,
        nowMinuteOfDay: 600,
        itemHolds
      })[0]!.blocks[0]!;
    expect(startsOf(week()).slice(0, 4)).toEqual(["a1@10:00", "a2@10:30", "a3@11:00", "a1@11:30"]);
    const held = week([{ assetId: "a2", untilMinute: 675 }]);
    expect(startsOf(held).slice(0, 5)).toEqual(["a1@10:00", "a3@10:30", "a1@11:00", "a2@11:30", "a3@12:00"]);
    expect(held.notes.join(" ")).toContain("1 Twitch video of this pool is skipped for now");
  });

  it("holds the same items the worker skips, until the end the core rule gives", () => {
    const nowMs = Date.parse("2026-10-05T11:00:00.000Z");
    const cases = [
      twitchAsset("fresh", "2026-10-05T10:45:00.000Z"),
      twitchAsset("old", "2026-10-05T10:00:00.000Z"),
      { ...twitchAsset("ready", "2026-10-05T10:45:00.000Z"), cacheStatus: "ready" as const },
      { ...twitchAsset("local", "2026-10-05T10:45:00.000Z"), path: "/media/local.mp4" }
    ];
    for (const asset of cases) {
      expect(getTwitchVodCacheCooldownEndMs(asset, 1_800_000, nowMs) !== null).toBe(isTwitchVodCacheCoolingDown(asset, 1_800_000, nowMs));
    }
    expect(getTwitchVodCacheCooldownEndMs(cases[0]!, 1_800_000, nowMs)).toBe(Date.parse("2026-10-05T11:15:00.000Z"));
  });

  it("the week view and /channel get the hold from the state: the default cooldown of 30 min after the failure", () => {
    vi.stubEnv("CHANNEL_TIMEZONE", UTC);
    vi.stubEnv("TWITCH_VOD_CACHE_FAILURE_COOLDOWN_SECONDS", "");
    const state = {
      managedConfig: {},
      assets: [twitchAsset("a2", "2026-10-05T10:45:00.000Z"), assets("a", 1, 1800)[0]!],
      playout: { status: "idle", currentAssetId: "", processStartedAt: "" }
    } as unknown as AppState;
    const projection = getProjectionClock(state, new Date("2026-10-05T11:00:30.000Z"));
    expect(projection.nowMinute).toBe(660.5);
    expect(projection.itemHolds).toEqual([{ assetId: "a2", untilMinute: 675 }]);
    vi.unstubAllEnvs();
  });
});

describe("16: an item on air whose length is not known yet", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-05T10:10:00.000Z"));
    vi.stubEnv("CHANNEL_TIMEZONE", UTC);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  const state = (durationSeconds: number) =>
    ({
      managedConfig: {},
      scheduleBlocks: [block({ id: "Day", dayOfWeek: 1, startMinuteOfDay: 600, durationMinutes: 240 })],
      pools: [pool("a")],
      assets: [// updatedAt as a change of its length bumps it, so /channel's five-second cache does not answer.
        { ...assets("x", 1, durationSeconds)[0]!, id: "on-air", title: "On air", sourceId: "elsewhere", updatedAt: `2026-10-05T10:0${durationSeconds > 0 ? 1 : 0}:00.000Z` }, ...assets("a", 6, 3600)],
      sourceBreakers: [],
      playout: { status: "running", currentAssetId: "on-air", processStartedAt: "2026-10-05T10:00:00.000Z" }
    }) as unknown as AppState;

  it("is still Now, with no end, and the next item waits for the 30-minute estimate instead of starting now", () => {
    const programme = getPublicProgramme(state(0), new Date());
    expect(programme.now).toMatchObject({ kind: "item", title: "On air", startsAt: "2026-10-05T10:00:00.000Z", endsAt: "" });
    expect(programme.next[0]?.items.map((item) => clock(item.startsAt)).slice(0, 2)).toEqual(["10:30", "11:30"]);
    const view = buildPublicChannelView(
      {
        locale: "en",
        timeZone: UTC,
        generatedAt: new Date().toISOString(),
        playout: { status: "running" },
        programme
      } as unknown as Parameters<typeof buildPublicChannelView>[0],
      true
    );
    expect(view.now.title).toBe("On air");
    expect(view.now.detail).toContain("since 10:00");
    expect(view.now.progressPercent).toBeNull();
  });

  it("with a known length the next item starts when it ends", () => {
    const programme = getPublicProgramme(state(1500), new Date());
    expect(programme.now).toMatchObject({ kind: "item", endsAt: "2026-10-05T10:25:00.000Z" });
    expect(programme.next[0]?.items.map((item) => clock(item.startsAt)).slice(0, 2)).toEqual(["10:25", "11:25"]);
  });
});

describe("17: the live summary counts the cuepoints of a cut weekly block like the worker", () => {
  // Weekly 18-22 with cuepoints at 18:30, 20:00 and 21:10; a dated block takes 20-21.
  const blocks: ScheduleBlock[] = [
    block({ id: "Weekly", dayOfWeek: 1, startMinuteOfDay: 18 * 60, durationMinutes: 240, cuepointOffsetsSeconds: [1800, 7200, 11_400] }),
    block({ id: "Special", dayOfWeek: 1, startMinuteOfDay: 20 * 60, durationMinutes: 60, poolId: "b", validFrom: MONDAY, validUntil: MONDAY })
  ];
  const state = {
    managedConfig: {},
    scheduleBlocks: blocks,
    pools: [{ ...pool("a"), insertAssetId: "sting", playbackMode: "round-robin", audioLaneAssetId: "", audioLaneVolumePercent: 100, updatedAt: "" }, pool("b")],
    assets: [{ ...assets("s", 1, 30)[0]!, id: "sting", sourceId: "source-a", title: "Sting" }],
    playout: { cuepointWindowKey: "", cuepointFiredKeys: [], cuepointLastTriggeredAt: "", cuepointLastAssetId: "" }
  } as unknown as AppState;

  it("at 21:15 the 21:10 cuepoint is due, the one in the dated part is not counted: 2 in all, as the worker has it", () => {
    vi.stubEnv("CHANNEL_TIMEZONE", UTC);
    const now = new Date("2026-10-05T21:15:00.000Z");
    const occurrence = findCurrentScheduleOccurrence({
      occurrences: buildScheduleOccurrences({ date: MONDAY, blocks }),
      currentTime: "21:15"
    });
    expect(occurrence?.blockId).toBe("Weekly");
    const plan = getCuepointInsertPlan({ state, currentScheduleItem: occurrence, skippedAssetId: "", now, timeZone: UTC });
    const summary = summarizeCuepoints(state, occurrence, now);
    expect(plan).toMatchObject({ offsetSeconds: 11_400, totalCount: 2 });
    // Before M118 the summary counted 3 and named 18:30 as due.
    expect(summary).toMatchObject({ dueOffsetSeconds: 11_400, totalCount: 2, nextOffsetSeconds: null });
    vi.unstubAllEnvs();
  });
});
