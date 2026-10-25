import { describe, expect, it } from "vitest";
import {
  buildMaterializedProgrammingWeek,
  formatChatNowReply,
  getScheduleEndInstant,
  getScheduleInstant,
  getScheduleRunElapsedSeconds,
  type ScheduleBlock
} from "@stream247/core";
import { buildPublicProgramme } from "../../apps/web/lib/public-programme";
import { buildScheduleVideoTimelineSegments } from "../../apps/web/lib/schedule-video-timeline";
import { buildChatProgrammeInfo, type ChatPlayoutRow } from "../../apps/worker/src/chat-programme-info";
import { planTwitchScheduleSegments } from "../../apps/worker/src/twitch-schedule-plan";

// M123: suggestions 20, 21 and 23 of planning/suggestions-2026-10-04.md. A block in the skipped March hour posts
// and counts from the switch, where it starts airing, and one ending in it stops there; the week view and the
// Day lens project the nights the clocks change in real time; a daily 24 h block is one Up next card on
// /channel; !now names the item on air, or what replaces it, while the playout reads "recovering".

// Europe/Berlin goes forward on 2027-03-28 (02:00 CET → 03:00 CEST, 01:00Z) and back on 2026-10-25.
const BERLIN = "Europe/Berlin";
const SPRING = "2027-03-28";
const AUTUMN = "2026-10-25";

const block = (overrides: Partial<ScheduleBlock> & Pick<ScheduleBlock, "id" | "dayOfWeek" | "startMinuteOfDay" | "durationMinutes">): ScheduleBlock => ({
  title: overrides.id,
  categoryName: "Replay",
  sourceName: "Pool",
  poolId: "a",
  ...overrides
});

// A daily series as the schedule editor saves it: one block per weekday, one repeat group.
const daily = (overrides: Partial<ScheduleBlock> & Pick<ScheduleBlock, "id" | "startMinuteOfDay" | "durationMinutes">): ScheduleBlock[] =>
  Array.from({ length: 7 }, (_, dayOfWeek) =>
    block({ ...overrides, id: `${overrides.id}-${dayOfWeek}`, dayOfWeek, repeatMode: "daily", repeatGroupId: overrides.id })
  );

const pool = { id: "a", name: "a", sourceIds: ["source-a"], cursorAssetId: "", insertAssetId: "", insertEveryItems: 0, itemsSinceInsert: 0 };
const assets = (count: number, durationSeconds: number) =>
  Array.from({ length: count }, (_, index) => ({
    id: `a${index + 1}`,
    sourceId: "source-a",
    title: `a${index + 1}`,
    status: "ready",
    includeInProgramming: true,
    durationSeconds,
    createdAt: new Date(Date.UTC(2026, 8, 1, 0, index)).toISOString(),
    path: `/media/a${index + 1}.mp4`
  }));

describe("20: a block in the skipped hour counts from the switch", () => {
  it("posts 02:30-04:30 from 03:00 CEST for 90 minutes, and 01:00-02:30 up to the switch for 60", () => {
    const plan = planTwitchScheduleSegments({
      blocks: [
        block({ id: "early", dayOfWeek: 0, startMinuteOfDay: 60, durationMinutes: 90 }),
        block({ id: "gap", dayOfWeek: 0, startMinuteOfDay: 150, durationMinutes: 120 })
      ],
      currentDate: "2027-03-22",
      timeZone: BERLIN,
      now: new Date("2027-03-22T10:00:00.000Z")
    });
    // Until M123: "gap" from 03:30 CEST (01:30Z) for 60 minutes, "early" 90 minutes although it airs 60.
    expect(plan.segments.map((segment) => [segment.blockId, segment.startTime, segment.durationMinutes])).toEqual([
      ["early", "2027-03-28T00:00:00.000Z", 60],
      ["gap", "2027-03-28T01:00:00.000Z", 90]
    ]);
    expect(getScheduleEndInstant({ date: SPRING, seconds: 150 * 60, timeZone: BERLIN }).toISOString()).toBe("2027-03-28T01:00:00.000Z");
  });

  it("counts the cuepoints of a block from 02:30 from 03:00 CEST: 600 s at 03:10, not 0", () => {
    const elapsed = getScheduleRunElapsedSeconds({
      occurrence: { date: SPRING, startMinuteOfDay: 150 },
      now: new Date("2027-03-28T01:10:00.000Z"),
      timeZone: BERLIN
    });
    expect(elapsed).toBe(600);
    expect(getScheduleInstant({ date: SPRING, seconds: 150 * 60, timeZone: BERLIN }).toISOString()).toBe("2027-03-28T01:00:00.000Z");
  });
});

describe("20: the week view and the Day lens use real lengths on the nights the clocks change", () => {
  const project = (startDate: string, blocks: ScheduleBlock[], timeZone?: string) =>
    buildMaterializedProgrammingWeek({ startDate, blocks, pools: [pool], assets: assets(12, 1800), timeZone });
  const night = block({ id: "night", dayOfWeek: 0, startMinuteOfDay: 60, durationMinutes: 180 });
  const times = (entry: { items: Array<{ startTime: string }> }) => entry.items.map((item) => item.startTime);

  it("fills 01:00-04:00 with two hours of videos in March, at the times the clock shows", () => {
    const spring = project(SPRING, [night], BERLIN)[0]!.blocks[0]!;
    expect(times(spring)).toEqual(["01:00", "01:30", "03:00", "03:30"]);
    expect(spring).toMatchObject({ lengthMinutes: 120, durationLabel: "2 h", projectedMinutes: 120, fillStatus: "balanced" });
    // Without the zone, as before M123: three hours of videos, at times that never come that night.
    expect(times(project(SPRING, [night])[0]!.blocks[0]!)).toEqual(["01:00", "01:30", "02:00", "02:30", "03:00", "03:30"]);
  });

  it("fills it with four hours in October, the repeated hour twice", () => {
    const autumn = project(AUTUMN, [night], BERLIN)[0]!.blocks[0]!;
    expect(times(autumn)).toEqual(["01:00", "01:30", "02:00", "02:30", "02:00", "02:30", "03:00", "03:30"]);
    expect(autumn).toMatchObject({ lengthMinutes: 240, durationLabel: "4 h", projectedMinutes: 240 });
  });

  it("counts 23 and 25 scheduled hours on those days, 24 on every other", () => {
    const allDay = daily({ id: "all", startMinuteOfDay: 0, durationMinutes: 1440 });
    const springWeek = project(SPRING, allDay, BERLIN);
    expect(springWeek.map((day) => day.totalScheduledMinutes)).toEqual([1380, 1440, 1440, 1440, 1440, 1440, 1440]);
    expect(springWeek[0]!.totalProjectedMinutes).toBe(1380);
    expect(project(AUTUMN, allDay, BERLIN)[0]!.totalScheduledMinutes).toBe(1500);
    expect(project("2026-07-05", allDay, BERLIN)[0]!.totalScheduledMinutes).toBe(1440);
  });

  it("draws the Day lens bar over the real length: two hours of videos fill the March block", () => {
    const segments = buildScheduleVideoTimelineSegments(project(SPRING, [night], BERLIN)[0]!.blocks[0]!);
    expect(segments.map((segment) => Math.round(segment.widthPercent))).toEqual([25, 25, 25, 25]);
    expect(segments.at(-1)!.startOffsetSeconds).toBe(5400);
  });

  it("places the March items on /channel back to back in real time and ends the block at 04:00 CEST", () => {
    const days = project(SPRING, [night], BERLIN);
    const programme = buildPublicProgramme({ days, timeZone: BERLIN, now: new Date("2027-03-27T12:00:00.000Z") });
    const group = programme.next[0]!;
    expect(group.items.map((item) => [item.startsAt, item.endsAt])).toEqual([
      ["2027-03-28T00:00:00.000Z", "2027-03-28T00:30:00.000Z"],
      ["2027-03-28T00:30:00.000Z", "2027-03-28T01:00:00.000Z"],
      ["2027-03-28T01:00:00.000Z", "2027-03-28T01:30:00.000Z"],
      ["2027-03-28T01:30:00.000Z", "2027-03-28T02:00:00.000Z"]
    ]);
    expect(group.itemCount).toBe(4);
  });

  it("projects the block on air from the instant, in the second pass of the repeated hour too", () => {
    // 02:15 CET on 2026-10-25 (01:15Z) is the second 02:15 of the night: the block has run 3 h 15 min.
    const day = (now?: Date) =>
      buildMaterializedProgrammingWeek({
        startDate: AUTUMN,
        blocks: [night],
        pools: [pool],
        assets: assets(12, 1800),
        timeZone: BERLIN,
        now,
        nowMinuteOfDay: 135
      })[0]!;
    // 105 real minutes are left until 04:00 CET: four half hours from now, the last running over.
    expect(times(day(new Date("2026-10-25T01:15:00.000Z")).blocks[0]!)).toEqual(["02:15", "02:45", "03:15", "03:45"]);
    // The wall-clock minute alone names the first 02:15 (00:15Z), an hour earlier: 165 minutes left.
    expect(times(day().blocks[0]!)).toEqual(["02:15", "02:45", "02:15", "02:45", "03:15", "03:45"]);
  });
});

describe("20: review of M123", () => {
  it("keeps item times on a day whose midnight the clock skips (America/Santiago, 2026-09-06)", () => {
    const evening = (startDate: string) =>
      buildMaterializedProgrammingWeek({
        startDate,
        blocks: daily({ id: "eve", startMinuteOfDay: 20 * 60, durationMinutes: 60 }),
        pools: [pool],
        assets: assets(12, 1800),
        timeZone: "America/Santiago"
      }).map((day) => day.blocks[0]!.items.map((item) => item.startTime).join(" "));
    // Before the fix every day of a week starting on the switch day read "19:00 19:30".
    expect(evening("2026-09-06")).toEqual(Array(7).fill("20:00 20:30"));
    expect(evening("2026-09-05")).toEqual(Array(7).fill("20:00 20:30"));
  });

  it("reads every second of the skipped hour as the switch", () => {
    expect(getScheduleInstant({ date: SPRING, seconds: 2 * 3600 + 59 * 60 + 30, timeZone: BERLIN }).toISOString()).toBe(
      "2027-03-28T01:00:00.000Z"
    );
    expect(getScheduleInstant({ date: SPRING, seconds: 3 * 3600 + 30, timeZone: BERLIN }).toISOString()).toBe("2027-03-28T01:00:30.000Z");
  });

  it("goes on in one card over three blocks of one programme back to back", () => {
    const music = (id: string, startMinuteOfDay: number) =>
      block({ id, title: "Music", dayOfWeek: 1, startMinuteOfDay, durationMinutes: 480 });
    const days = buildMaterializedProgrammingWeek({
      startDate: "2026-10-05",
      blocks: [music("m1", 0), music("m2", 480), music("m3", 960)],
      pools: [pool],
      assets: assets(30, 3600),
      nowMinuteOfDay: 60,
      maxListedItemsPerBlock: 5000
    });
    const programme = buildPublicProgramme({ days, timeZone: "UTC", now: new Date("2026-10-05T01:00:00.000Z") });
    expect(programme.next.map((group) => [group.title, group.startsAt])).toEqual([["Music", "2026-10-05T01:00:00.000Z"]]);
  });
});

describe("21: small things on /channel", () => {
  it("lists a daily 24 h block as one Up next card across midnight", () => {
    const days = buildMaterializedProgrammingWeek({
      startDate: "2026-10-05",
      blocks: daily({ id: "all", title: "Around the clock", startMinuteOfDay: 0, durationMinutes: 1440 }),
      pools: [pool],
      assets: assets(12, 3600),
      nowMinuteOfDay: 20 * 60,
      maxListedItemsPerBlock: 5000
    });
    const programme = buildPublicProgramme({ days, timeZone: "UTC", now: new Date("2026-10-05T20:00:00.000Z") });
    // Before M123: one card until midnight and a second one from 00:00, its next video as a new headline.
    expect(programme.next).toHaveLength(1);
    expect(programme.next[0]).toMatchObject({ title: "Around the clock", itemCount: 24, startsAt: "2026-10-05T20:00:00.000Z" });
  });

  it("keeps two cards for a daily evening block, which does not run on into the next day", () => {
    const days = buildMaterializedProgrammingWeek({
      startDate: "2026-10-05",
      blocks: daily({ id: "eve", title: "Evening", startMinuteOfDay: 20 * 60, durationMinutes: 240 }),
      pools: [pool],
      assets: assets(12, 3600),
      nowMinuteOfDay: 10 * 60,
      maxListedItemsPerBlock: 5000
    });
    const programme = buildPublicProgramme({ days, timeZone: "UTC", now: new Date("2026-10-05T10:00:00.000Z"), nextHours: 48 });
    expect(programme.next.map((group) => group.startsAt)).toEqual(["2026-10-05T20:00:00.000Z", "2026-10-06T20:00:00.000Z"]);
  });
});

describe("23: !now during a short recovery", () => {
  const row = (overrides: Partial<ChatPlayoutRow> = {}): ChatPlayoutRow => ({
    status: "recovering",
    currentTitle: "Long Archive",
    currentAssetId: "a1",
    processStartedAt: "2026-10-06T14:00:00.000Z",
    queueKind: "asset",
    nextAssetId: "a2",
    nextTitle: "Evening Opener",
    manualNextAssetId: "",
    insertAssetId: "",
    insertStatus: "",
    overrideAssetId: "",
    overrideUntil: "",
    cuepointWindowKey: "",
    skipAssetId: "",
    skipUntil: "",
    ...overrides
  });
  const NOW = new Date("2026-10-06T14:30:00.000Z");
  const info = (playout: ChatPlayoutRow, locale = "en") =>
    buildChatProgrammeInfo({
      playout,
      predictNext: () => ({ kind: "item", assetId: "a2", title: "Evening Opener", startsAt: null }),
      timeZone: "UTC",
      appUrl: "",
      locale,
      now: NOW
    });

  it("names the item on air under a Restart, a running Pin or the automatic fallback", () => {
    expect(formatChatNowReply("ada", info(row()), "en")).toBe("@ada now on air: Long Archive.");
    expect(info(row({ overrideAssetId: "a1", overrideUntil: "2026-10-06T15:00:00.000Z" })).nowTitle).toBe("Long Archive");
    expect(info(row({ insertAssetId: "a1", insertStatus: "active" })).nowTitle).toBe("Long Archive");
    // A Skip of another item or one that has run out does not take this one off.
    expect(info(row({ skipAssetId: "a9", skipUntil: "2026-10-06T15:00:00.000Z" })).nowTitle).toBe("Long Archive");
    expect(info(row({ skipAssetId: "a1", skipUntil: "2026-10-06T14:00:00.000Z" })).nowTitle).toBe("Long Archive");
  });

  it("names what comes next after a Skip, a waiting Pin or a pending Play now, in both languages", () => {
    const skipped = info(row({ skipAssetId: "a1", skipUntil: "2026-10-06T15:00:00.000Z" }));
    expect(skipped).toMatchObject({ nowTitle: "", nowSwitching: true, nextTitle: "Evening Opener" });
    // Before M123: "@ada nothing is playing right now — stand by, we’ll be right back."
    expect(formatChatNowReply("ada", skipped, "en")).toBe("@ada switching to the next video: Evening Opener.");
    expect(formatChatNowReply("ada", info(row({ skipAssetId: "a1", skipUntil: "2026-10-06T15:00:00.000Z" }), "de"), "de")).toBe(
      "@ada gleich geht’s weiter mit: Evening Opener."
    );
    expect(info(row({ overrideAssetId: "a5", overrideUntil: "2026-10-06T15:00:00.000Z" })).nowSwitching).toBe(true);
    expect(info(row({ insertAssetId: "a5", insertStatus: "pending" })).nowSwitching).toBe(true);
    // An override of another item without a running end does not hold (review of M123).
    expect(info(row({ overrideAssetId: "a5", overrideUntil: "" })).nowTitle).toBe("Long Archive");
    expect(formatChatNowReply("ada", { ...skipped, nextTitle: "" }, "en")).toBe("@ada switching to the next video right now.");
  });

  it("still says nothing plays under the standby and reconnect slates and off air", () => {
    expect(formatChatNowReply("ada", info(row({ currentTitle: "Stand by" })), "en")).toBe(
      "@ada nothing is playing right now — stand by, we’ll be right back."
    );
    expect(info(row({ status: "standby" })).nowTitle).toBe("");
    expect(info(row({ status: "idle", currentTitle: "" })).nowSwitching).toBeUndefined();
  });
});
