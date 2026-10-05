import ICAL from "ical.js";
import { describe, expect, it } from "vitest";
import {
  buildMaterializedProgrammingWeek,
  getScheduleInstant,
  getScheduleStartsInMinutes,
  overlayNextTimeLabel,
  type ScheduleBlock
} from "@stream247/core";
import { buildPublicProgramme } from "../../apps/web/lib/public-programme";
import { buildProgrammeCalendar } from "../../apps/web/lib/public-programme-calendar";

// M100: the public programme. Built from the week projection (buildMaterializedProgrammingWeek, the
// worker's own rotation), with every time as an instant.

const ZONE = "Europe/Berlin";
// 2026-10-05 is a Monday; Berlin is on summer time (UTC+2) that week.
const MONDAY = "2026-10-05";

const block = (overrides: Partial<ScheduleBlock> & Pick<ScheduleBlock, "id" | "dayOfWeek" | "startMinuteOfDay" | "durationMinutes">): ScheduleBlock => ({
  title: overrides.id,
  categoryName: "Archive",
  sourceName: "Pool",
  poolId: "pool-1",
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

const assets = (poolId: string, count: number, durationSeconds: number) =>
  Array.from({ length: count }, (_, index) => ({
    id: `${poolId}-item-${index + 1}`,
    sourceId: `source-${poolId}`,
    title: `${poolId} ${index + 1}`,
    status: "ready",
    includeInProgramming: true,
    durationSeconds,
    createdAt: `2026-09-0${index + 1}T00:00:00.000Z`
  }));

/** The programme at `now` (Berlin wall clock on MONDAY's week), through the same projection the week view uses. */
function programmeAt(args: {
  date?: string;
  time: string;
  blocks: ScheduleBlock[];
  pools: ReturnType<typeof pool>[];
  assets: ReturnType<typeof assets>;
  current?: Parameters<typeof buildPublicProgramme>[0]["current"];
}) {
  const date = args.date ?? MONDAY;
  const [hours, minutes] = args.time.split(":").map(Number);
  const nowMinute = (hours ?? 0) * 60 + (minutes ?? 0);
  const days = buildMaterializedProgrammingWeek({
    startDate: date,
    blocks: args.blocks,
    pools: args.pools,
    assets: args.assets,
    nowMinuteOfDay: nowMinute,
    maxListedItemsPerBlock: 5000
  });
  const now = getScheduleInstant({ date, seconds: nowMinute * 60, timeZone: ZONE });
  return buildPublicProgramme({ days, timeZone: ZONE, now, current: args.current ?? null });
}

const berlin = (iso: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: ZONE, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));

describe("the next 24 hours, item by item", () => {
  it("groups consecutive items of one block: 3 blocks × 5 items give 3 groups, each with 4 more", () => {
    const programme = programmeAt({
      time: "10:00",
      blocks: [
        block({ id: "Morning", dayOfWeek: 1, startMinuteOfDay: 12 * 60, durationMinutes: 150, poolId: "a" }),
        block({ id: "Afternoon", dayOfWeek: 1, startMinuteOfDay: 14 * 60 + 30, durationMinutes: 150, poolId: "b" }),
        block({ id: "Evening", dayOfWeek: 1, startMinuteOfDay: 17 * 60, durationMinutes: 150, poolId: "c" })
      ],
      pools: [pool("a"), pool("b"), pool("c")],
      assets: [...assets("a", 5, 1800), ...assets("b", 5, 1800), ...assets("c", 5, 1800)]
    });
    expect(programme.next.map((group) => [group.title, group.itemCount, group.items.length, berlin(group.startsAt)])).toEqual([
      ["Morning", 5, 5, "12:00"],
      ["Afternoon", 5, 5, "14:30"],
      ["Evening", 5, 5, "17:00"]
    ]);
    // The card shows the group's next item; the other four are "4 more".
    expect(programme.next.map((group) => group.itemCount - 1)).toEqual([4, 4, 4]);
    expect(programme.next[0]?.items.map((item) => item.title)).toEqual(["a 1", "a 2", "a 3", "a 4", "a 5"]);
  });

  it("does not list or count the pool's inserts, but keeps the time they take (R24)", () => {
    const ident = {
      id: "ident",
      sourceId: "source-idents",
      title: "station_ident_v3_final",
      status: "ready",
      includeInProgramming: true,
      durationSeconds: 30,
      createdAt: "2026-09-01T00:00:00.000Z"
    };
    const programme = programmeAt({
      time: "10:00",
      blocks: [block({ id: "Morning", dayOfWeek: 1, startMinuteOfDay: 12 * 60, durationMinutes: 150, poolId: "a" })],
      pools: [{ ...pool("a"), insertAssetId: "ident", insertEveryItems: 2 }],
      assets: [...assets("a", 5, 1800), ident]
    });
    const [group] = programme.next;
    // Before M105: "a 1 | a 2 | station_ident_v3_final | a 3 | ..." with the ident counted as a video.
    expect(group?.items.map((item) => item.title)).toEqual(["a 1", "a 2", "a 3", "a 4", "a 5"]);
    expect(group?.itemCount).toBe(5);
    // The ident airs between "a 2" and "a 3", so "a 3" starts 30 s after "a 2" ends.
    const [, second, third] = group?.items ?? [];
    expect(Date.parse(third!.startsAt) - Date.parse(second!.endsAt)).toBe(30_000);
  });

  it("runs across midnight without a break", () => {
    const programme = programmeAt({
      time: "21:00",
      blocks: [
        block({ id: "Late", dayOfWeek: 1, startMinuteOfDay: 22 * 60, durationMinutes: 240, poolId: "a" }),
        block({ id: "Night", dayOfWeek: 2, startMinuteOfDay: 2 * 60, durationMinutes: 60, poolId: "b" })
      ],
      pools: [pool("a"), pool("b")],
      assets: [...assets("a", 4, 3600), ...assets("b", 1, 3600)]
    });
    // One group for the block over midnight, not one per day, and the next block right after it.
    expect(programme.next.map((group) => group.title)).toEqual(["Late", "Night"]);
    const items = programme.next.flatMap((group) => group.items);
    expect(items.map((item) => berlin(item.startsAt))).toEqual(["22:00", "23:00", "00:00", "01:00", "02:00"]);
    for (let index = 1; index < items.length; index += 1) {
      expect(items[index]?.startsAt).toBe(items[index - 1]?.endsAt);
    }
  });

  it("starts the block on air after the item the playout runs, not now", () => {
    // 11:10, the item on air started at 11:00 and runs an hour. The projection starts the block's next item at
    // 11:10; it airs when the running one ends.
    const startedAt = getScheduleInstant({ date: MONDAY, seconds: 11 * 3600, timeZone: ZONE });
    const programme = programmeAt({
      time: "11:10",
      blocks: [block({ id: "Day", dayOfWeek: 1, startMinuteOfDay: 10 * 60, durationMinutes: 240, poolId: "a" })],
      pools: [pool("a")],
      assets: assets("a", 6, 3600),
      current: {
        title: "On air",
        categoryName: "Archive",
        startsAt: startedAt.toISOString(),
        endsAt: new Date(startedAt.getTime() + 3600_000).toISOString()
      }
    });
    expect(programme.now).toMatchObject({ kind: "item", title: "On air" });
    expect(programme.next[0]?.items.map((item) => berlin(item.startsAt))).toEqual(["12:00", "13:00"]);
  });

  it("moves only the air window on now: the weekly block resumes at its own time after a dated block", () => {
    // Weekly 18-22 with a dated block 20-21; 19:30, the item on air ran 19:20-19:40.
    const startedAt = getScheduleInstant({ date: MONDAY, seconds: (19 * 60 + 20) * 60, timeZone: ZONE });
    const programme = programmeAt({
      time: "19:30",
      blocks: [
        block({ id: "Weekly", dayOfWeek: 1, startMinuteOfDay: 18 * 60, durationMinutes: 240, poolId: "a" }),
        block({ id: "Special", dayOfWeek: 1, startMinuteOfDay: 20 * 60, durationMinutes: 60, poolId: "b", validFrom: MONDAY, validUntil: MONDAY })
      ],
      pools: [pool("a"), pool("b")],
      assets: [...assets("a", 9, 1200), ...assets("b", 1, 3600)],
      current: {
        title: "On air",
        categoryName: "Archive",
        startsAt: startedAt.toISOString(),
        endsAt: new Date(startedAt.getTime() + 1200_000).toISOString()
      }
    });
    expect(programme.next.map((group) => [group.title, group.items.map((item) => `${berlin(item.startsAt)}-${berlin(item.endsAt)}`)])).toEqual([
      ["Weekly", ["19:40-20:00"]],
      ["Special", ["20:00-21:00"]],
      ["Weekly", ["21:00-21:20", "21:20-21:40", "21:40-22:00"]]
    ]);
  });

  it("cuts the dated block's last item where the weekly block takes the air back (R7)", () => {
    // Dated 20-21 on air at 20:30, the item on air runs 20:25-20:50: the next one starts 20:50 and is cut at
    // 21:00 as the worker cuts it, no longer listed to 21:15 over the weekly block's first item.
    const startedAt = getScheduleInstant({ date: MONDAY, seconds: (20 * 60 + 25) * 60, timeZone: ZONE });
    const programme = programmeAt({
      time: "20:30",
      blocks: [
        block({ id: "Weekly", dayOfWeek: 1, startMinuteOfDay: 18 * 60, durationMinutes: 240, poolId: "a" }),
        block({ id: "Special", dayOfWeek: 1, startMinuteOfDay: 20 * 60, durationMinutes: 60, poolId: "b", validFrom: MONDAY, validUntil: MONDAY })
      ],
      pools: [pool("a"), pool("b")],
      assets: [...assets("a", 9, 1200), ...assets("b", 4, 1500)],
      current: {
        title: "On air",
        categoryName: "Archive",
        startsAt: startedAt.toISOString(),
        endsAt: new Date(startedAt.getTime() + 1500_000).toISOString()
      }
    });
    expect(programme.next.map((group) => [group.title, group.items.map((item) => `${berlin(item.startsAt)}-${berlin(item.endsAt)}`)])).toEqual([
      ["Special", ["20:50-21:00"]],
      ["Weekly", ["21:00-21:20", "21:20-21:40", "21:40-22:00"]]
    ]);
  });

  it("drops the block on air from Up next when the item on air outlasts it", () => {
    // Block A 10-11, 10:50, the item on air ends 11:40: A has nothing left, B's first item waits for it.
    const startedAt = getScheduleInstant({ date: MONDAY, seconds: (10 * 60 + 40) * 60, timeZone: ZONE });
    const programme = programmeAt({
      time: "10:50",
      blocks: [
        block({ id: "A", dayOfWeek: 1, startMinuteOfDay: 10 * 60, durationMinutes: 60, poolId: "a" }),
        block({ id: "B", dayOfWeek: 1, startMinuteOfDay: 11 * 60, durationMinutes: 120, poolId: "b" })
      ],
      pools: [pool("a"), pool("b")],
      assets: [...assets("a", 3, 3600), ...assets("b", 2, 3600)],
      current: {
        title: "Long",
        categoryName: "Archive",
        startsAt: startedAt.toISOString(),
        endsAt: new Date(startedAt.getTime() + 3600_000).toISOString()
      }
    });
    expect(programme.next.map((group) => group.title)).toEqual(["B"]);
  });

  it("lists a block with nothing to play by its air time, and names the block on air without a playout", () => {
    const programme = programmeAt({
      time: "10:30",
      blocks: [
        block({ id: "Open", dayOfWeek: 1, startMinuteOfDay: 10 * 60, durationMinutes: 60, poolId: "a" }),
        block({ id: "Empty", dayOfWeek: 1, startMinuteOfDay: 11 * 60, durationMinutes: 60, poolId: "missing" })
      ],
      pools: [pool("a")],
      assets: assets("a", 1, 600)
    });
    expect(programme.now).toMatchObject({ kind: "block", title: "Open" });
    expect(berlin(programme.now?.startsAt ?? "")).toBe("10:00");
    const empty = programme.next.find((group) => group.title === "Empty");
    expect(empty).toMatchObject({ itemCount: 0, items: [] });
    expect([berlin(empty?.startsAt ?? ""), berlin(empty?.endsAt ?? "")]).toEqual(["11:00", "12:00"]);
  });
});

describe("the week, block by block", () => {
  it("lists every air window from now on, dated blocks marked, a weekly block cut by a dated one twice", () => {
    const programme = programmeAt({
      time: "09:00",
      blocks: [
        block({ id: "Weekly", dayOfWeek: 1, startMinuteOfDay: 18 * 60, durationMinutes: 240, poolId: "a" }),
        block({ id: "Special", dayOfWeek: 1, startMinuteOfDay: 20 * 60, durationMinutes: 60, poolId: "a", validFrom: MONDAY, validUntil: MONDAY })
      ],
      pools: [pool("a")],
      assets: assets("a", 3, 3600)
    });
    expect(programme.week.map((entry) => [entry.title, entry.dated, berlin(entry.startsAt), berlin(entry.endsAt)])).toEqual([
      ["Weekly", false, "18:00", "20:00"],
      ["Special", true, "20:00", "21:00"],
      ["Weekly", false, "21:00", "22:00"]
    ]);
  });
});

describe("the calendar feed /channel.ics", () => {
  it("is a calendar a parser reads back: one event per entry, in UTC, text unescaped", () => {
    const entries = [
      {
        key: "block-1:2026-10-05@1",
        title: "Retro, Night; Teil 1",
        categoryName: "Retro",
        dated: false,
        startsAt: "2026-10-05T18:00:00.000Z",
        endsAt: "2026-10-05T20:00:00.000Z"
      },
      {
        key: "block-2:2026-10-06@2",
        // Longer than a content line, with a character of two bytes on the fold.
        title: `Sondersendung ${"ä".repeat(60)}`,
        categoryName: "Talk",
        dated: true,
        startsAt: "2026-10-06T22:00:00.000Z",
        endsAt: "2026-10-07T01:00:00.000Z"
      }
    ];
    const text = buildProgrammeCalendar({
      entries,
      locale: "de",
      channelName: "jimpanse247",
      timeZone: ZONE,
      now: new Date("2026-10-05T08:00:00.000Z")
    });
    expect(text.split("\r\n").every((line) => new TextEncoder().encode(line).length <= 75)).toBe(true);
    // RFC 5545 escapes, read as written (a lenient parser would accept them bare).
    expect(text).toContain("SUMMARY:Retro\\, Night\\; Teil 1\r\n");

    const calendar = new ICAL.Component(ICAL.parse(text));
    expect(calendar.getFirstPropertyValue("x-wr-calname")).toBe("Programm von jimpanse247");
    const events = calendar.getAllSubcomponents("vevent").map((component) => new ICAL.Event(component));
    expect(
      events.map((event) => [event.summary, event.startDate.toJSDate().toISOString(), event.endDate.toJSDate().toISOString(), event.description])
    ).toEqual([
      ["Retro, Night; Teil 1", "2026-10-05T18:00:00.000Z", "2026-10-05T20:00:00.000Z", "Retro"],
      [entries[1]?.title, "2026-10-06T22:00:00.000Z", "2026-10-07T01:00:00.000Z", "Sondersendung · Talk"]
    ]);
    expect(new Set(events.map((event) => event.uid)).size).toBe(2);
  });
});

describe("V7: the on-air Next card says how soon", () => {
  it("adds in N min under an hour and in N h under a day, in both languages", () => {
    const next = { startTime: "20:00", endTime: "22:00" };
    expect(overlayNextTimeLabel(next, "en", 25)).toBe("20:00-22:00 · in 25 min");
    expect(overlayNextTimeLabel(next, "de", 25)).toBe("20:00–22:00 · in 25 Min.");
    expect(overlayNextTimeLabel(next, "en", 150)).toBe("20:00-22:00 · in 2 h");
    expect(overlayNextTimeLabel(next, "de", 150)).toBe("20:00–22:00 · in 2 Std.");
    // Whole hours: never "in 24 h" for what is under a day.
    expect(overlayNextTimeLabel(next, "en", 1430)).toBe("20:00-22:00 · in 23 h");
    // A day or more away, started, or unknown: the bare range as before.
    expect(overlayNextTimeLabel(next, "en", 24 * 60)).toBe("20:00-22:00");
    expect(overlayNextTimeLabel(next, "en", 0)).toBe("20:00-22:00");
    expect(overlayNextTimeLabel(next, "en", null)).toBe("20:00-22:00");
  });

  it("counts the minutes from a fixed clock to the block's start in the channel zone", () => {
    // 19:35 in Berlin (17:35 UTC); the next block starts at 20:00.
    const now = new Date("2026-10-05T17:35:00.000Z");
    expect(getScheduleStartsInMinutes({ date: MONDAY, airStartMinute: 20 * 60 }, now, ZONE)).toBe(25);
    // Tomorrow 01:00 after a dated block: 5 h 25 min.
    expect(getScheduleStartsInMinutes({ date: "2026-10-06", airStartMinute: 60 }, now, ZONE)).toBe(325);
    // Started already, or without a date.
    expect(getScheduleStartsInMinutes({ date: MONDAY, airStartMinute: 19 * 60 }, now, ZONE)).toBeNull();
    expect(getScheduleStartsInMinutes({ airStartMinute: 20 * 60 }, now, ZONE)).toBeNull();
  });
});

describe("M101: the week across the clock change", () => {
  it("lists a Sunday 02:00-03:00 block in October from its first 02:00 to its last 03:00", () => {
    // 2026-10-25 is the fall-back Sunday: 02:00 CEST is 00:00Z, 03:00 CET is 02:00Z; the block airs twice.
    const programme = programmeAt({
      date: "2026-10-19",
      time: "12:00",
      blocks: [block({ id: "night", dayOfWeek: 0, startMinuteOfDay: 120, durationMinutes: 60 })],
      pools: [pool("pool-1")],
      assets: assets("pool-1", 3, 600)
    });
    expect(programme.week.map((entry) => [entry.startsAt, entry.endsAt])).toEqual([["2026-10-25T00:00:00.000Z", "2026-10-25T02:00:00.000Z"]]);
  });
});
