import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildMaterializedProgrammingWeek,
  buildScheduleOccurrences,
  createPoolRotation,
  findCurrentScheduleOccurrence,
  getCurrentScheduleMoment,
  getScheduleInstant,
  getScheduleOccurrenceRunKey,
  poolRotationStateOf,
  type PoolRotationState,
  type ScheduleBlock
} from "@stream247/core";
import { asRunEndReasonOf } from "../../apps/worker/src/as-run";
import {
  decideScheduleTakeover,
  decideTakeoverPrepareFailure,
  findScheduleRun,
  isRepeatedWallClockMinute,
  scheduleRunBlockId
} from "../../apps/worker/src/schedule-takeover";

// M105, review finding R7: a dated or one-off block takes the air at its start and gives it back at its end
// (owner decision 5.1 Q1), cutting the item on air; between weekly blocks the item still finishes first.

const ZONE = "Europe/Berlin";
// 2026-10-12 is a Monday (CEST, UTC+2).
const MONDAY = "2026-10-12";

const block = (overrides: Partial<ScheduleBlock> & Pick<ScheduleBlock, "id" | "startMinuteOfDay" | "durationMinutes">): ScheduleBlock => ({
  title: overrides.id,
  categoryName: "Archive",
  sourceName: "",
  dayOfWeek: 1,
  ...overrides
});

const weekly = block({ id: "weekly", startMinuteOfDay: 18 * 60, durationMinutes: 240, poolId: "pool-a" });
const oneOff = block({ id: "one-off", startMinuteOfDay: 20 * 60, durationMinutes: 60, poolId: "pool-b", validFrom: MONDAY, validUntil: MONDAY });

const at = (hhmm: string, date = MONDAY) => {
  const [hours, minutes] = hhmm.split(":").map(Number);
  return getScheduleInstant({ date, seconds: (hours * 60 + minutes) * 60, timeZone: ZONE }).getTime();
};

// The instant and zone decideScheduleTakeover reads (only the repeated autumn hour depends on them).
const clockAt = (hhmm: string, date = MONDAY) => ({ now: new Date(at(hhmm, date)), timeZone: ZONE });

const currentRun = (blocks: ScheduleBlock[], nowMs: number) => {
  const moment = getCurrentScheduleMoment({ now: new Date(nowMs), timeZone: ZONE });
  const current = findCurrentScheduleOccurrence({
    occurrences: buildScheduleOccurrences({ date: moment.date, blocks }),
    currentTime: moment.time
  });
  return { moment, current };
};

describe("decideScheduleTakeover: which run change is a dated block's start or end", () => {
  const blocks = [weekly, oneOff];
  const weeklyKey = `${MONDAY}:weekly:1080:240`;
  const oneOffKey = `${MONDAY}:one-off:1200:60`;

  it("the one-off's start and its end are takeovers; the same run, or no block now, is none", () => {
    const { current: atStart } = currentRun(blocks, at("20:00"));
    expect(decideScheduleTakeover({ previousRunKey: weeklyKey, current: atStart, date: MONDAY, blocks, ...clockAt("20:00") })).toEqual({
      fromRunKey: weeklyKey,
      toRunKey: oneOffKey,
      edge: "start"
    });
    const { current: atEnd } = currentRun(blocks, at("21:00"));
    // The weekly block comes back with its own key and start (M93).
    expect(getScheduleOccurrenceRunKey(atEnd!)).toBe(weeklyKey);
    expect(decideScheduleTakeover({ previousRunKey: oneOffKey, current: atEnd, date: MONDAY, blocks, ...clockAt("21:00") })?.edge).toBe("end");
    expect(decideScheduleTakeover({ previousRunKey: oneOffKey, current: atStart, date: MONDAY, blocks, ...clockAt("20:00") })).toBeNull();
    expect(decideScheduleTakeover({ previousRunKey: oneOffKey, current: null, date: MONDAY, blocks, ...clockAt("20:00") })).toBeNull();
    // Nothing was on air at the last cycle (a gap, a fallback): the one-off still takes the air.
    expect(decideScheduleTakeover({ previousRunKey: "", current: atStart, date: MONDAY, blocks, ...clockAt("20:00") })?.edge).toBe("start");
  });

  it("two weekly blocks keep the graceful handoff, and a run the schedule no longer has forces nothing", () => {
    const evening = block({ id: "evening", startMinuteOfDay: 20 * 60, durationMinutes: 120, poolId: "pool-b" });
    const early = block({ id: "early", startMinuteOfDay: 18 * 60, durationMinutes: 120, poolId: "pool-a" });
    const { current } = currentRun([early, evening], at("20:00"));
    expect(decideScheduleTakeover({ previousRunKey: `${MONDAY}:early:1080:120`, current, date: MONDAY, blocks: [early, evening], ...clockAt("20:00") })).toBeNull();
    expect(decideScheduleTakeover({ previousRunKey: `${MONDAY}:deleted:1080:120`, current, date: MONDAY, blocks: [early, evening], ...clockAt("20:00") })).toBeNull();
  });

  it("finds yesterday's dated run after midnight, so its end at 00:00 is a takeover too", () => {
    const lateOneOff = block({ id: "late", startMinuteOfDay: 22 * 60, durationMinutes: 120, poolId: "pool-b", validFrom: MONDAY, validUntil: MONDAY });
    const night = block({ id: "night", dayOfWeek: 2, startMinuteOfDay: 0, durationMinutes: 360, poolId: "pool-a" });
    const blocks2 = [lateOneOff, night];
    const { moment, current } = currentRun(blocks2, at("00:00", "2026-10-13"));
    expect(moment.date).toBe("2026-10-13");
    expect(findScheduleRun({ runKey: `${MONDAY}:late:1320:120`, date: moment.date, blocks: blocks2 })?.dated).toBe(true);
    expect(decideScheduleTakeover({ previousRunKey: `${MONDAY}:late:1320:120`, current, date: moment.date, blocks: blocks2, ...clockAt("00:00", "2026-10-13") })?.edge).toBe("end");
  });
});

// The worker's selection across playout cycles (every 15 s, and at once when an item ends): the run recorded
// at each cycle's end (`cuepointWindowKey`), the takeover decision, and the two arms of
// choosePlaybackCandidate that keep the item on air (`runningScheduledAsset` hands it on as graceful_handoff,
// `currentPoolAsset` keeps a pool item), both gated by the takeover in index.ts (pinned below). A Pin selects
// through its own arm ahead of them. Pools pick with the worker's rotation.
type SimAsset = { id: string; sourceId: string; title: string; createdAt: string; durationSeconds: number; status: string };
type SimPool = { id: string; name: string; sourceIds: string[]; cursorAssetId: string; insertAssetId: string; insertEveryItems: number; itemsSinceInsert: number };
type Row = { assetId: string; blockId: string; startedAt: number; endedAt: number; endReason: string };

const asset = (id: string, sourceId: string, durationSeconds: number, day: number): SimAsset => ({
  id,
  sourceId,
  title: id,
  createdAt: `2026-09-${String(day).padStart(2, "0")}T00:00:00.000Z`,
  durationSeconds,
  status: "ready"
});
const pool = (id: string, sourceId: string): SimPool => ({
  id,
  name: id,
  sourceIds: [sourceId],
  cursorAssetId: "",
  insertAssetId: "",
  insertEveryItems: 0,
  itemsSinceInsert: 0
});

function simulate(args: {
  blocks: ScheduleBlock[];
  pools: SimPool[];
  assets: SimAsset[];
  fromMs: number;
  toMs: number;
  // false: the worker before M105, which never cut at a dated block.
  takeover?: boolean;
  pin?: { assetId: string; fromMs: number; untilMs: number };
  // The schedule as an operator's edit leaves it from `atMs` on.
  edit?: { atMs: number; blocks: ScheduleBlock[] };
  // Items that cannot be prepared before this instant (a Twitch archive still downloading).
  preparedFromMs?: Record<string, number>;
  // Items no pool may pick before this instant (their source held by the breaker, say).
  heldUntilMs?: Record<string, number>;
}): Row[] {
  const rotations = new Map<string, { next: (state: PoolRotationState) => { asset: SimAsset; state: PoolRotationState } | null; state: PoolRotationState }>();
  let simNow = args.fromMs;
  for (const entry of args.pools) {
    // A rotation per pick, as the worker's selectPoolAsset builds one: eligibility is read when it is built.
    const rotationNow = () =>
      createPoolRotation({ sourceIds: entry.sourceIds, assets: args.assets, isEligible: (item) => (args.heldUntilMs?.[item.id] ?? 0) <= simNow });
    rotations.set(entry.id, { next: (state) => rotationNow().next(state), state: poolRotationStateOf(entry) });
  }
  const rows: Row[] = [];
  let windowKey = "";
  let running: { row: Row; endsAt: number; sourceId: string; reasonCode: string } | null = null;
  const stop = (atMs: number, plannedReason: string) => {
    if (running) {
      running.row.endedAt = atMs;
      running.row.endReason = asRunEndReasonOf({ plannedReason, stopIntent: "", naturalBoundary: plannedReason === "", exitedCleanly: true });
      running = null;
    }
  };
  const start = (item: SimAsset, atMs: number, reasonCode: string, blockId: string, plannedStop: string) => {
    stop(atMs, plannedStop);
    const row: Row = { assetId: item.id, blockId, startedAt: atMs, endedAt: 0, endReason: "" };
    rows.push(row);
    running = { row, endsAt: atMs + item.durationSeconds * 1000, sourceId: item.sourceId, reasonCode };
  };
  const cycle = (t: number) => {
    simNow = t;
    const blocksNow = args.edit && t >= args.edit.atMs ? args.edit.blocks : args.blocks;
    const { moment, current } = currentRun(blocksNow, t);
    const pinned = args.pin && args.pin.fromMs <= t && t < args.pin.untilMs ? args.assets.find((entry) => entry.id === args.pin?.assetId) : null;
    if (pinned) {
      if (running?.row.assetId !== pinned.id) {
        start(pinned, t, "operator_override", current?.blockId ?? "", "restart-requested");
      }
      windowKey = current ? getScheduleOccurrenceRunKey(current) : "";
      return;
    }
    const takeover =
      args.takeover !== false && running
        ? decideScheduleTakeover({ previousRunKey: windowKey, current, date: moment.date, blocks: blocksNow, now: new Date(t), timeZone: ZONE })
        : null;
    const currentPool = current?.poolId ? args.pools.find((entry) => entry.id === current.poolId) ?? null : null;
    const rotation = currentPool ? rotations.get(currentPool.id) : undefined;
    // The two keep-arms: the reason code that holds the running item, null when neither does.
    const onAir = running;
    const holdingArm = (): string | null => {
      if (!onAir) {
        return null;
      }
      const inPool = Boolean(currentPool?.sourceIds.includes(onAir.sourceId));
      if (["scheduled_match", "graceful_handoff", "manual_next"].includes(onAir.reasonCode) && !inPool) {
        return "graceful_handoff";
      }
      return current?.poolId && onAir.reasonCode !== "operator_insert" && inPool ? "scheduled_match" : null;
    };
    // A takeover applies only with a pick of the new block's own.
    const takeoverPick = takeover && rotation ? rotation.next(rotation.state) : null;
    if (takeoverPick && onAir && (args.preparedFromMs?.[takeoverPick.asset.id] ?? 0) > t) {
      const held = holdingArm();
      const decision = decideTakeoverPrepareFailure({
        takeover: true,
        processRunning: true,
        restartRequested: false,
        heldAssetId: held ? onAir.row.assetId : "",
        runningAssetId: onAir.row.assetId
      });
      if (decision === "hold" && held) {
        // The item on air plays on and the run before the boundary stays recorded: the next cycle tries again.
        onAir.reasonCode = held;
        return;
      }
    }
    let kept = false;
    if (!takeoverPick && onAir) {
      const held = holdingArm();
      if (held) {
        onAir.reasonCode = held;
        kept = true;
        if (takeover) {
          // The new block has no item yet: the takeover waits, and the run before the boundary stays recorded.
          return;
        }
      }
    }
    const pick = takeoverPick ?? (!kept && rotation ? rotation.next(rotation.state) : null);
    if (pick && rotation && current) {
      rotation.state = pick.state;
      start(pick.asset, t, "scheduled_match", current.blockId, "switch");
    }
    windowKey = current ? getScheduleOccurrenceRunKey(current) : "";
  };
  let tick = args.fromMs;
  while (tick <= args.toMs) {
    const exitAt: number | null = running && running.endsAt <= tick ? running.endsAt : null;
    if (exitAt !== null) {
      stop(exitAt, "");
      cycle(exitAt);
      continue;
    }
    cycle(tick);
    tick += 15_000;
  }
  return rows;
}

const clock = (ms: number) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: ZONE, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(ms));
const summary = (rows: Row[]) => rows.map((row) => [row.assetId, clock(row.startedAt), row.endedAt ? clock(row.endedAt) : "on air", row.endReason]);

describe("R7 across playout cycles: a one-off 20:00-21:00 under a weekly 18:00-22:00 of 3 h archives", () => {
  const pools = [pool("pool-a", "src-a"), pool("pool-b", "src-b")];
  const assets = [
    asset("a1", "src-a", 3 * 3600, 1),
    asset("a2", "src-a", 3 * 3600, 2),
    asset("a3", "src-a", 3 * 3600, 3),
    asset("b1", "src-b", 40 * 60, 1),
    asset("b2", "src-b", 40 * 60, 2),
    asset("b3", "src-b", 40 * 60, 3)
  ];
  const blocks = [weekly, oneOff];

  it("before M105 the archive on air at 20:00 swallowed the one-off", () => {
    const rows = simulate({ blocks, pools, assets, fromMs: at("18:00"), toMs: at("22:00"), takeover: false });
    expect(summary(rows)).toEqual([
      ["a1", "18:00", "21:00", "natural-end"],
      ["a2", "21:00", "on air", ""]
    ]);
  });

  it("the item on air is cut at the one-off's start, the one-off's own item at its end, and the weekly block resumes at 21:00", () => {
    const rows = simulate({ blocks, pools, assets, fromMs: at("18:00"), toMs: at("22:00") });
    expect(summary(rows)).toEqual([
      ["a1", "18:00", "20:00", "switch"],
      ["b1", "20:00", "20:40", "natural-end"],
      ["b2", "20:40", "21:00", "switch"],
      ["a2", "21:00", "on air", ""]
    ]);
    expect(rows.map((row) => row.blockId)).toEqual(["weekly", "one-off", "one-off", "weekly"]);
  });

  it("the as-run log and the week projection agree on every start and every cut", () => {
    const rows = simulate({ blocks, pools, assets, fromMs: at("18:00"), toMs: at("22:00") });
    const [monday] = buildMaterializedProgrammingWeek({ startDate: MONDAY, blocks, pools, assets });
    const projected = (monday?.blocks ?? []).flatMap((entry) =>
      entry.items.map((item) => ({
        assetId: item.assetId,
        blockId: entry.blockId,
        startedAt: getScheduleInstant({ date: MONDAY, seconds: item.startSecond ?? 0, timeZone: ZONE }).getTime(),
        endedAt: getScheduleInstant({ date: MONDAY, seconds: item.endSecond ?? 0, timeZone: ZONE }).getTime()
      }))
    );
    const oneOffBlock = monday?.blocks.find((entry) => entry.blockId === "one-off");
    // Cut at 21:00 like the worker, not "Ends 20m late" any more.
    expect(oneOffBlock?.cutAtEnd).toBe(true);
    expect(oneOffBlock?.fillLabel).toBe("Balanced window");
    expect(oneOffBlock?.items.some((item) => item.overflow)).toBe(false);
    for (const row of rows) {
      const match = projected.find((item) => item.assetId === row.assetId && item.blockId === row.blockId);
      expect(match, row.assetId).toBeDefined();
      expect(match?.startedAt).toBe(row.startedAt);
      if (row.endedAt) {
        expect(match?.endedAt).toBe(row.endedAt);
      }
    }
  });

  it("a Pin on air at 20:00 keeps the air past the start, and once it ends nothing is cut until 21:00", () => {
    const rows = simulate({
      blocks,
      pools,
      assets,
      fromMs: at("18:00"),
      toMs: at("22:00"),
      pin: { assetId: "b1", fromMs: at("19:55"), untilMs: at("20:30") }
    });
    // The pinned item is from the one-off's pool, so it plays on as the pool's item, as after any pin; a pin
    // does not move the pool's position, so the pool starts with b1 again.
    expect(summary(rows)).toEqual([
      ["a1", "18:00", "19:55", "operator-restart"],
      ["b1", "19:55", "20:35", "natural-end"],
      ["b1", "20:35", "21:00", "switch"],
      ["a2", "21:00", "on air", ""]
    ]);
  });
});

describe("R7: between two weekly blocks the item still finishes first", () => {
  it("weekly 18-20 then weekly 20-22: the 3 h archive runs to 21:00, and the projection says so", () => {
    const early = block({ id: "early", startMinuteOfDay: 18 * 60, durationMinutes: 120, poolId: "pool-a" });
    const evening = block({ id: "evening", startMinuteOfDay: 20 * 60, durationMinutes: 120, poolId: "pool-b" });
    const pools = [pool("pool-a", "src-a"), pool("pool-b", "src-b")];
    const assets = [asset("a1", "src-a", 3 * 3600, 1), asset("b1", "src-b", 3600, 1), asset("b2", "src-b", 3600, 2)];
    const rows = simulate({ blocks: [early, evening], pools, assets, fromMs: at("18:00"), toMs: at("22:00") });
    expect(summary(rows)).toEqual([
      ["a1", "18:00", "21:00", "natural-end"],
      ["b1", "21:00", "22:00", "natural-end"]
    ]);
    const [monday] = buildMaterializedProgrammingWeek({ startDate: MONDAY, blocks: [early, evening], pools, assets });
    const earlyBlock = monday?.blocks.find((entry) => entry.blockId === "early");
    expect(earlyBlock?.cutAtEnd).toBe(false);
    expect(earlyBlock?.fillLabel).toBe("Ends 60m late");
  });

  it("a weekly block ending where a dated block starts is cut there in the projection, as on air", () => {
    const early = block({ id: "early", startMinuteOfDay: 18 * 60, durationMinutes: 120, poolId: "pool-a" });
    const special = block({ id: "special", startMinuteOfDay: 20 * 60, durationMinutes: 60, poolId: "pool-b", validFrom: MONDAY, validUntil: MONDAY });
    const pools = [pool("pool-a", "src-a"), pool("pool-b", "src-b")];
    const assets = [asset("a1", "src-a", 3 * 3600, 1), asset("b1", "src-b", 3600, 1)];
    const rows = simulate({ blocks: [early, special], pools, assets, fromMs: at("18:00"), toMs: at("21:30") });
    expect(summary(rows)).toEqual([
      ["a1", "18:00", "20:00", "switch"],
      ["b1", "20:00", "21:00", "natural-end"]
    ]);
    const [monday] = buildMaterializedProgrammingWeek({ startDate: MONDAY, blocks: [early, special], pools, assets });
    const earlyBlock = monday?.blocks.find((entry) => entry.blockId === "early");
    expect(earlyBlock?.cutAtEnd).toBe(true);
    expect(earlyBlock?.items.map((item) => [item.assetId, item.startTime, item.endTime, item.overflow])).toEqual([["a1", "18:00", "20:00", false]]);
    // Nothing follows the dated block, so its item may overrun like any block's last item.
    expect(monday?.blocks.find((entry) => entry.blockId === "special")?.cutAtEnd).toBe(false);
  });
});

describe("review of M105: a run change that is no boundary", () => {
  it("reads the block from a run key, a block id with colons included", () => {
    expect(scheduleRunBlockId(`${MONDAY}:one-off:1200:60`)).toBe("one-off");
    expect(scheduleRunBlockId(`${MONDAY}:a:b:1200:60`)).toBe("a:b");
    expect(scheduleRunBlockId("")).toBe("");
  });

  it("an on-air dated block extended or moved by the operator is the same block, not a new start", () => {
    const extended = { ...oneOff, durationMinutes: 90 };
    const { current } = currentRun([weekly, extended], at("20:20"));
    expect(getScheduleOccurrenceRunKey(current!)).toBe(`${MONDAY}:one-off:1200:90`);
    expect(
      decideScheduleTakeover({ previousRunKey: `${MONDAY}:one-off:1200:60`, current, date: MONDAY, blocks: [weekly, extended], ...clockAt("20:20") })
    ).toBeNull();
  });

  it("a dated block extended at 20:20 keeps its item on air, and gives the air back at its new end", () => {
    const pools = [pool("pool-a", "src-a"), pool("pool-b", "src-b")];
    const assets = [asset("a1", "src-a", 3 * 3600, 1), asset("a2", "src-a", 3 * 3600, 2), asset("b1", "src-b", 40 * 60, 1), asset("b2", "src-b", 40 * 60, 2), asset("b3", "src-b", 40 * 60, 3)];
    const rows = simulate({
      blocks: [weekly, oneOff],
      pools,
      assets,
      fromMs: at("18:00"),
      toMs: at("22:00"),
      edit: { atMs: at("20:20"), blocks: [weekly, { ...oneOff, durationMinutes: 90 }] }
    });
    // Read as a new start, the edit cut b1 at 20:20 for b2.
    expect(summary(rows)).toEqual([
      ["a1", "18:00", "20:00", "switch"],
      ["b1", "20:00", "20:40", "natural-end"],
      ["b2", "20:40", "21:20", "natural-end"],
      ["b3", "21:20", "21:30", "switch"],
      ["a2", "21:30", "on air", ""]
    ]);
  });

  it("knows the repeated autumn hour: Berlin's 02:30 is first CEST, then the repeat in CET; UTC repeats nothing", () => {
    expect(isRepeatedWallClockMinute(new Date("2026-10-25T00:30:00.000Z"), ZONE)).toBe(false);
    expect(isRepeatedWallClockMinute(new Date("2026-10-25T00:59:59.000Z"), ZONE)).toBe(false);
    expect(isRepeatedWallClockMinute(new Date("2026-10-25T01:00:00.000Z"), ZONE)).toBe(true);
    expect(isRepeatedWallClockMinute(new Date("2026-10-25T01:59:59.000Z"), ZONE)).toBe(true);
    expect(isRepeatedWallClockMinute(new Date("2026-10-25T02:00:00.000Z"), ZONE)).toBe(false);
    // Spring forward skips an hour and repeats none.
    expect(isRepeatedWallClockMinute(new Date("2027-03-28T01:00:00.000Z"), ZONE)).toBe(false);
    expect(isRepeatedWallClockMinute(new Date("2026-10-25T01:30:00.000Z"), "UTC")).toBe(false);
  });

  it("the fall-back night cuts once, at the dated block's start, not at every wall-clock change after it", () => {
    // Sunday 2026-10-25: A 00:00-02:30 weekly, B 02:30-06:00 dated. On the wall clock A, B from 02:30 CEST,
    // A again from 02:00 CET, B again from 02:30 CET (M101, review finding R8).
    const sunday = "2026-10-25";
    const a = block({ id: "a", dayOfWeek: 0, startMinuteOfDay: 0, durationMinutes: 150, poolId: "pool-a" });
    const b = block({ id: "b", dayOfWeek: 0, startMinuteOfDay: 150, durationMinutes: 210, poolId: "pool-b", validFrom: sunday, validUntil: sunday });
    const pools = [pool("pool-a", "src-a"), pool("pool-b", "src-b")];
    const assets = [asset("a1", "src-a", 3 * 3600, 1), asset("a2", "src-a", 3 * 3600, 2), asset("b1", "src-b", 90 * 60, 1), asset("b2", "src-b", 90 * 60, 2), asset("b3", "src-b", 90 * 60, 3)];
    const rows = simulate({ blocks: [a, b], pools, assets, fromMs: Date.parse("2026-10-24T22:00:00.000Z"), toMs: Date.parse("2026-10-25T04:30:00.000Z") });
    const utc = (ms: number) => new Date(ms).toISOString().slice(11, 16);
    expect(rows.map((row) => [row.assetId, utc(row.startedAt), row.endedAt ? utc(row.endedAt) : "on air", row.endReason])).toEqual([
      ["a1", "22:00", "00:30", "switch"],
      // Through A's return at 02:00 CET (01:00Z) and B's at 02:30 CET (01:30Z): no cut.
      ["b1", "00:30", "02:00", "natural-end"],
      ["b2", "02:00", "03:30", "natural-end"],
      ["b3", "03:30", "on air", ""]
    ]);
  });
});

describe("review of M105: a takeover whose block cannot take the air yet", () => {
  const pools = [pool("pool-a", "src-a"), pool("pool-b", "src-b")];
  const assets = [
    asset("a1", "src-a", 3 * 3600, 1),
    asset("a2", "src-a", 3 * 3600, 2),
    asset("b1", "src-b", 40 * 60, 1),
    asset("b2", "src-b", 40 * 60, 2)
  ];
  const blocks = [weekly, oneOff];

  it("holds the item on air while the pick cannot be prepared: no fallback, the cut once it is ready", () => {
    expect(decideTakeoverPrepareFailure({ takeover: true, processRunning: true, restartRequested: false, heldAssetId: "a1", runningAssetId: "a1" })).toBe("hold");
    // Not a takeover, nothing healthy on air, a Restart due, or nothing that keeps the item: the recovery plan.
    for (const change of [{ takeover: false }, { processRunning: false }, { restartRequested: true }, { heldAssetId: "" }, { heldAssetId: "x" }]) {
      expect(
        decideTakeoverPrepareFailure({ takeover: true, processRunning: true, restartRequested: false, heldAssetId: "a1", runningAssetId: "a1", ...change }),
        JSON.stringify(change)
      ).toBe("recover");
    }
    // b1 is a Twitch archive whose download ends at 20:25 (remote fallback off, as in .env.production.example).
    const rows = simulate({ blocks, pools, assets, fromMs: at("18:00"), toMs: at("22:00"), preparedFromMs: { b1: at("20:25") } });
    expect(summary(rows)).toEqual([
      ["a1", "18:00", "20:25", "switch"],
      ["b1", "20:25", "21:00", "switch"],
      ["a2", "21:00", "on air", ""]
    ]);
  });

  it("an archive still downloading when the item on air ends: that item ran to its end, never cut for a fallback", () => {
    const rows = simulate({ blocks, pools, assets, fromMs: at("18:00"), toMs: at("21:30"), preparedFromMs: { b1: at("23:00") } });
    // At 21:00 a1 ends with the one-off over; the weekly block picks as at any boundary.
    expect(summary(rows)).toEqual([
      ["a1", "18:00", "21:00", "natural-end"],
      ["a2", "21:00", "on air", ""]
    ]);
  });

  it("a block with no item to take the air with keeps the item on air, and takes the air once it has one", () => {
    // pool-b's items are held (their source's breaker, say) until 20:10.
    const rows = simulate({ blocks, pools, assets, fromMs: at("18:00"), toMs: at("22:00"), heldUntilMs: { b1: at("20:10"), b2: at("20:10") } });
    expect(summary(rows)).toEqual([
      ["a1", "18:00", "20:10", "switch"],
      ["b1", "20:10", "20:50", "natural-end"],
      ["b2", "20:50", "21:00", "switch"],
      ["a2", "21:00", "on air", ""]
    ]);
  });
});

// apps/worker/src/index.ts cannot be imported in a unit test (it starts the worker); this pins the wiring the
// simulation above stands for, the way operator-play-now-wiring.test.ts pins the rest of the selection.
describe("R7 wiring in the worker", () => {
  const workerSource = readFileSync(path.join(process.cwd(), "apps/worker/src/index.ts"), "utf8");
  const flat = (text: string) => text.replace(/\s+/g, " ");
  const functionBody = (name: string) => {
    const start = workerSource.indexOf(`function ${name}(`);
    expect(start, `function ${name} not found`).toBeGreaterThan(-1);
    const ends = [workerSource.indexOf("\nfunction ", start + 1), workerSource.indexOf("\nasync function ", start + 1)].filter((index) => index > -1);
    return flat(workerSource.slice(start, Math.min(...ends)));
  };

  it("reads the boundary from the run the last cycle recorded, and every cycle records the run on air", () => {
    expect(functionBody("getScheduleTakeover")).toContain("previousRunKey: state.playout.cuepointWindowKey,");
    expect(functionBody("runPlayoutCycle")).toContain(
      'const cuepointWindowKey = waitingTakeover ? state.playout.cuepointWindowKey : currentScheduleItem ? getScheduleOccurrenceRunKey(currentScheduleItem) : "";'
    );
  });

  it("reads the schedule once per cycle: every selection and the recorded run judge the same instant", () => {
    const cycle = functionBody("runPlayoutCycle");
    const instant = cycle.indexOf("const scheduleNow = new Date();");
    expect(instant).toBeGreaterThan(-1);
    expect(instant).toBeLessThan(cycle.indexOf("const previewSelection = choosePlaybackCandidate(state, scheduleNow);"));
    // Every selection of the cycle, and the block whose run the end write records.
    expect(cycle.match(/choosePlaybackCandidate\(state\)/g)).toBeNull();
    expect(cycle.match(/choosePlaybackCandidate\(state, scheduleNow/g)?.length).toBe(5);
    expect(cycle).toContain("const currentScheduleItem = getCurrentScheduleItem(state, scheduleNow);");
    expect(cycle).not.toContain("getCurrentScheduleItem(state)");
    expect(cycle).toContain("getScheduleTakeover(state, currentScheduleItem, scheduleNow)");
    const choose = functionBody("choosePlaybackCandidate");
    expect(choose).toContain("const currentScheduleItem = getCurrentScheduleItem(state, scheduleNow);");
    expect(choose).toContain("getScheduleTakeover(state, currentScheduleItem, scheduleNow)");
  });

  it("gates both arms that keep the item on air, after the operator arms, and only for a block with a pick", () => {
    const choose = functionBody("choosePlaybackCandidate");
    const gate = choose.indexOf(
      "const scheduleTakeoverEdge = processRunning && !options.setTakeoverAside ? getScheduleTakeover(state, currentScheduleItem, scheduleNow) : null;"
    );
    expect(gate).toBeGreaterThan(-1);
    // No pick of the new block's own, no takeover: the fallback ladder never cuts the item on air.
    expect(choose).toContain("const scheduleTakeover = takeoverPick ? scheduleTakeoverEdge : null;");
    expect(choose).toContain('const runningScheduledAsset = !scheduleTakeover && processRunning && state.playout.currentAssetId !== ""');
    expect(choose).toContain(
      "const currentPoolAsset = !scheduleTakeover && processRunning && !runningOperatorItem && currentScheduleItem?.poolId && state.playout.currentAssetId"
    );
    // The third keep-arm, a scheduled insert on air (R11, scheduled-insert-plays-out.test.ts), takes the gate too.
    expect(choose).toContain("keepsRunningScheduledInsert({ processRunning, scheduleTakeover: Boolean(scheduleTakeover),");
    // The takeover's pick is the selection, and it says so.
    expect(choose).toContain("const preferredAsset = takeoverPick ?? (currentScheduleItem?.poolId");
    expect(choose).toContain("...(scheduleTakeover ? { scheduleTakeover } : {})");
    for (const operatorArm of ["if (liveBridgeActive)", "if (desiredAsset)", 'if (activeInsertAsset && state.playout.insertStatus !== "")']) {
      expect(choose.indexOf(operatorArm), operatorArm).toBeGreaterThan(-1);
      expect(choose.indexOf(operatorArm), operatorArm).toBeLessThan(gate);
    }
  });

  it("holds the item on air while the takeover's pick cannot be prepared, and tries again next cycle", () => {
    const cycle = functionBody("runPlayoutCycle");
    const inline = cycle.indexOf("prepared = await resolveAssetPlaybackInput(failedAsset);");
    const hold = cycle.slice(inline, cycle.indexOf('if (prepared) { await recordSelectionResolveOutcome(failedAsset, "ok");', inline));
    expect(hold).toContain("const held = takeover ? choosePlaybackCandidate(state, scheduleNow, { setTakeoverAside: true }) : null;");
    expect(hold).toContain(
      'decideTakeoverPrepareFailure({ takeover: true, processRunning: isPlayoutProcessRunning(), restartRequested: state.playout.restartRequestedAt !== "", heldAssetId: held.asset?.id ?? "", runningAssetId: playoutAssetId }) !== "hold" ) { throw error; }'
    );
    expect(hold).toContain("selection = held;");
    // Nothing on air any more by the time the switch would run: the next cycle selects afresh, at once.
    expect(cycle).toContain("if ((keepRunningInput || scheduleTakeoverDeferral) && !isPlayoutProcessRunning()) {");
    // Waiting for a pick to be prepared, or for the block to have one: the run before the boundary stays.
    expect(cycle).toContain("const waitingTakeover = scheduleTakeoverDeferral?.takeover ?? selection.scheduleTakeoverWaiting ?? null;");
    expect(cycle).toContain(
      'const cuepointWindowKey = waitingTakeover ? state.playout.cuepointWindowKey : currentScheduleItem ? getScheduleOccurrenceRunKey(currentScheduleItem) : "";'
    );
    // The takeover line is written once, when it is no longer waiting.
    expect(cycle).toContain(
      "const scheduleTakeover = !waitingTakeover && isPlayoutProcessRunning() ? getScheduleTakeover(state, currentScheduleItem, scheduleNow) : null;"
    );
  });

  it("marks every keep-arm's selection while a takeover waits for the block to have an item", () => {
    const choose = functionBody("choosePlaybackCandidate");
    expect(choose).toContain("const waitingTakeover = scheduleTakeoverEdge && !takeoverPick ? scheduleTakeoverEdge : null;");
    expect(choose.match(/return holdingForTakeover\( createSelection\(/g)?.length).toBe(3);
    for (const arm of ["asset: runningScheduledInsert,", "asset: runningScheduledAsset,", "asset: preferredAsset,"]) {
      const at = choose.indexOf(arm);
      expect(choose.slice(at - 60, at), arm).toContain("return holdingForTakeover( createSelection({");
    }
  });
});
