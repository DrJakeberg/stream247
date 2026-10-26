import { describe, expect, it } from "vitest";
import {
  buildAsRunRowView,
  decideResumeStart,
  isResumePointValid,
  onAirItemZeroAt,
  parseResumePoints,
  pruneResumePoints,
  removeResumePointsOfAsset,
  RESUME_MAX_POINTS,
  upsertResumePoint,
  type AsRunRecord,
  type ResumePoint
} from "@stream247/core";
import {
  classifyResumeExit,
  decideResumeCheckpoint,
  decideResumePointsAfterExit,
  decideResumePointsAtStart,
  isSeekableInput,
  pickResumeItem,
  resumeRunOf,
  resumeRunPositionAt,
  type ResumeExitKind,
  type ResumeRun
} from "../../apps/worker/src/resume-interrupted";

/**
 * M124 (PLANS.md M77): an item cut before its end continues where it was cut when its pool comes back.
 * The owner's rules (2026-10-26, "Ja, wie empfohlen"): every unwanted cut keeps the position, a Skip, a
 * Restart and the end do not; at most 24 hours; 10 s before the cut, from the beginning when it aired
 * less than 2 minutes, not at all with less than 2 minutes left; only from a file on disk.
 */
const T = Date.parse("2026-10-26T20:00:00.000Z");
const iso = (ms: number) => new Date(ms).toISOString();
const point = (overrides: Partial<ResumePoint> = {}): ResumePoint => ({
  assetId: "asset_a",
  poolId: "pool_p",
  positionSeconds: 4 * 3600,
  savedAt: iso(T),
  ...overrides
});

describe("where a continued item starts", () => {
  it.each([
    // [position, duration, expected]
    [4 * 3600, 6 * 3600, { kind: "resume", startSeconds: 4 * 3600 - 10 }],
    [120, 3600, { kind: "resume", startSeconds: 110 }],
    // Aired less than 2 minutes: again from the beginning.
    [119, 3600, { kind: "resume", startSeconds: 0 }],
    [0, 3600, { kind: "resume", startSeconds: 0 }],
    // Less than 2 minutes left: not continued.
    [3600 - 119, 3600, { kind: "drop" }],
    [3600, 3600, { kind: "drop" }],
    [3600 + 30, 3600, { kind: "drop" }],
    // Exactly 2 minutes left is still continued.
    [3600 - 120, 3600, { kind: "resume", startSeconds: 3600 - 130 }],
    // Length unknown: nothing counts as too little left.
    [5000, 0, { kind: "resume", startSeconds: 4990 }]
  ])("position %s of %s s -> %j", (positionSeconds, durationSeconds, expected) => {
    expect(decideResumeStart({ positionSeconds, durationSeconds })).toEqual(expected);
  });

  it("a short item that aired too little and has too little left is not continued", () => {
    expect(decideResumeStart({ positionSeconds: 60, durationSeconds: 150 })).toEqual({ kind: "drop" });
  });
});

describe("the stored points", () => {
  it("reads leniently: a broken column or entry is no point, never an error", () => {
    expect(parseResumePoints("not json")).toEqual([]);
    expect(parseResumePoints("{}")).toEqual([]);
    expect(parseResumePoints("")).toEqual([]);
    expect(
      parseResumePoints(
        JSON.stringify([point(), { assetId: "", poolId: "p", positionSeconds: 1, savedAt: iso(T) }, { assetId: "b" }, point({ positionSeconds: 12.7, poolId: "q" })])
      )
    ).toEqual([point(), point({ positionSeconds: 12, poolId: "q" })]);
    expect(parseResumePoints([point({ savedAt: "yesterday" })])).toEqual([]);
  });

  it("reads the count of short starts, and leaves it out when there is none", () => {
    expect(parseResumePoints(JSON.stringify([point({ shortStarts: 2, shortStartAt: iso(T) }), point({ poolId: "q", shortStarts: 0 })]))).toEqual([
      point({ shortStarts: 2, shortStartAt: iso(T) }),
      point({ poolId: "q" })
    ]);
  });

  it("keeps one point per pool, the newest first, and a bounded list", () => {
    const first = upsertResumePoint([], point());
    const replaced = upsertResumePoint(first, point({ assetId: "asset_b", positionSeconds: 30 }));
    expect(replaced).toEqual([point({ assetId: "asset_b", positionSeconds: 30 })]);
    const two = upsertResumePoint(replaced, point({ poolId: "pool_q" }));
    expect(two.map((entry) => entry.poolId)).toEqual(["pool_q", "pool_p"]);
    let many: ResumePoint[] = [];
    for (let index = 0; index < RESUME_MAX_POINTS + 5; index += 1) {
      many = upsertResumePoint(many, point({ poolId: `pool_${String(index)}` }));
    }
    expect(many).toHaveLength(RESUME_MAX_POINTS);
    expect(many[0]?.poolId).toBe(`pool_${String(RESUME_MAX_POINTS + 4)}`);
    expect(removeResumePointsOfAsset(two, "asset_a")).toEqual([point({ assetId: "asset_b", positionSeconds: 30 })]);
  });

  it("holds 24 hours from the cut", () => {
    expect(isResumePointValid(point(), T + 24 * 3600_000 - 1)).toBe(true);
    expect(isResumePointValid(point(), T + 24 * 3600_000)).toBe(false);
  });

  it("drops a point that is too old, whose pool has moved on or is gone", () => {
    const pools = [
      { id: "pool_p", cursorAssetId: "asset_a" },
      { id: "pool_q", cursorAssetId: "asset_next" }
    ];
    const points = [point(), point({ poolId: "pool_q" }), point({ poolId: "pool_gone" }), point({ poolId: "pool_p", assetId: "asset_a" })];
    expect(pruneResumePoints({ points, pools, nowMs: T + 60_000 })).toEqual([point(), point()]);
    expect(pruneResumePoints({ points: [point()], pools, nowMs: T + 25 * 3600_000 })).toEqual([]);
  });

  it("places position 0 of the item on air before the process start by its start offset", () => {
    expect(onAirItemZeroAt({ processStartedAt: iso(T), currentStartOffsetSeconds: 4 * 3600 - 10 })).toBe(iso(T - (4 * 3600 - 10) * 1000));
    expect(onAirItemZeroAt({ processStartedAt: iso(T), currentStartOffsetSeconds: 0 })).toBe(iso(T));
    expect(onAirItemZeroAt({ processStartedAt: iso(T) })).toBe(iso(T));
    expect(onAirItemZeroAt({ processStartedAt: "", currentStartOffsetSeconds: 300 })).toBe("");
  });
});

describe("which run keeps a point", () => {
  const base = {
    targetKind: "asset",
    reasonCode: "scheduled_match",
    poolId: "pool_p",
    assetId: "asset_a",
    input: "/app/data/media/.stream247-twitch-cache/v2883427989.mp4",
    audioInput: "",
    startOffsetSeconds: 0,
    resumed: false,
    startedAtMs: T
  };

  it("only a file on disk can start part-way", () => {
    expect(isSeekableInput({ input: "/app/data/media/show.mp4", audioInput: "" })).toBe(true);
    expect(isSeekableInput({ input: "file:///app/data/media/show.mp4", audioInput: "" })).toBe(true);
    expect(isSeekableInput({ input: "https://d1m7jfoe9zdc1j.cloudfront.net/x/chunked/index-dvr.m3u8", audioInput: "" })).toBe(false);
    expect(isSeekableInput({ input: "https://rr1.googlevideo.com/v", audioInput: "https://rr1.googlevideo.com/a" })).toBe(false);
    expect(isSeekableInput({ input: "", audioInput: "" })).toBe(false);
  });

  it("a pool's own pick from a file, and nothing else", () => {
    expect(resumeRunOf(base)).toEqual({ assetId: "asset_a", poolId: "pool_p", startOffsetSeconds: 0, resumed: false, startedAtMs: T });
    expect(resumeRunOf({ ...base, startOffsetSeconds: 600.9, resumed: true })).toMatchObject({ startOffsetSeconds: 600, resumed: true });
    for (const reasonCode of ["operator_insert", "scheduled_insert", "operator_override", "manual_next", "graceful_handoff", "global_fallback", "generic_fallback"]) {
      expect(resumeRunOf({ ...base, reasonCode })).toBeNull();
    }
    expect(resumeRunOf({ ...base, targetKind: "insert" })).toBeNull();
    expect(resumeRunOf({ ...base, targetKind: "live" })).toBeNull();
    expect(resumeRunOf({ ...base, poolId: "" })).toBeNull();
    expect(resumeRunOf({ ...base, assetId: "" })).toBeNull();
    expect(resumeRunOf({ ...base, input: "https://example.com/vod.m3u8" })).toBeNull();
  });

  it("counts the position from where the run started", () => {
    const run = resumeRunOf({ ...base, startOffsetSeconds: 1000, resumed: true }) as ResumeRun;
    expect(resumeRunPositionAt(run, T + 61_900)).toBe(1061);
  });
});

describe("what an exit does to the point", () => {
  const exit = (plannedReason: string, extra: Partial<Parameters<typeof classifyResumeExit>[0]> = {}) =>
    classifyResumeExit({ plannedReason, stopIntent: "", naturalBoundary: false, exitedCleanly: false, immediateOpenFailure: false, ...extra });

  it.each<[string, Partial<Parameters<typeof classifyResumeExit>[0]>, ResumeExitKind]>([
    // The end of the item.
    ["", { naturalBoundary: true, exitedCleanly: true }, "ended"],
    ["", { exitedCleanly: true }, "ended"],
    ["duration-bound", {}, "ended"],
    // A feed watchdog ends a stalled feed, which nobody wanted: kept like a crash (review of M124).
    ["feed-stalled", {}, "failed"],
    ["feed-audio-stalled", {}, "failed"],
    // Skip and Restart.
    ["switch", { stopIntent: "skip" }, "ended"],
    ["restart-requested", { stopIntent: "skip" }, "ended"],
    ["restart-requested", { stopIntent: "operator-restart" }, "ended"],
    ["restart-requested", { stopIntent: "" }, "ended"],
    // Something else took the air.
    ["switch", {}, "cut"],
    ["switch", { stopIntent: "switch" }, "cut"],
    ["restart-requested", { stopIntent: "switch" }, "cut"],
    ["scheduled-reconnect", {}, "cut"],
    ["crash-loop-reset", {}, "cut"],
    ["destination-missing", {}, "cut"],
    ["a-reason-added-later", {}, "cut"],
    // ffmpeg died, or never opened the input.
    ["", {}, "failed"],
    ["", { immediateOpenFailure: true }, "open-failure"]
  ])("%s %j -> %s", (plannedReason, extra, expected) => {
    expect(exit(plannedReason, extra)).toBe(expected);
  });

  const run: ResumeRun = { assetId: "asset_a", poolId: "pool_p", startOffsetSeconds: 0, resumed: false, startedAtMs: T };
  const other = point({ poolId: "pool_q", assetId: "asset_q" });

  it("keeps the exact position at a cut or a crash", () => {
    for (const kind of ["cut", "failed"] as const) {
      expect(decideResumePointsAfterExit({ points: [other], run, kind, exitedAtMs: T + 3 * 3600_000 + 4_500 })).toEqual([
        point({ positionSeconds: 3 * 3600 + 4, savedAt: iso(T + 3 * 3600_000 + 4_500) }),
        other
      ]);
    }
  });

  it("drops it at the end, a Skip or a Restart, and leaves it for the retry of an input that never opened", () => {
    const points = [point(), other];
    expect(decideResumePointsAfterExit({ points, run, kind: "ended", exitedAtMs: T + 10_000 })).toEqual([other]);
    expect(decideResumePointsAfterExit({ points, run, kind: "open-failure", exitedAtMs: T + 10_000 })).toEqual(points);
    // A run that keeps no point (an insert, a remote archive) changes nothing.
    expect(decideResumePointsAfterExit({ points, run: null, kind: "cut", exitedAtMs: T + 10_000 })).toEqual(points);
  });

  it("gives up a continued item that fails again before it aired 2 minutes", () => {
    const resumed: ResumeRun = { ...run, startOffsetSeconds: 7200, resumed: true };
    expect(decideResumePointsAfterExit({ points: [point(), other], run: resumed, kind: "failed", exitedAtMs: T + 119_000 })).toEqual([other]);
    // Cut by something else, or failing after it aired long enough, it keeps its new position; cut within
    // 2 minutes it counts as a short start of the point.
    expect(decideResumePointsAfterExit({ points: [], run: resumed, kind: "cut", exitedAtMs: T + 30_000 })).toEqual([
      point({ positionSeconds: 7230, savedAt: iso(T + 30_000), shortStarts: 1, shortStartAt: iso(T) })
    ]);
    expect(decideResumePointsAfterExit({ points: [], run: resumed, kind: "failed", exitedAtMs: T + 120_000 })).toEqual([
      point({ positionSeconds: 7320, savedAt: iso(T + 120_000) })
    ]);
    // A replay from the beginning (it aired too little before) that fails again is given up too.
    const replay: ResumeRun = { ...run, resumed: true };
    expect(decideResumePointsAfterExit({ points: [point({ positionSeconds: 40 })], run: replay, kind: "failed", exitedAtMs: T + 40_000 })).toEqual([]);
  });

  it("counts a continued start that never opened, once per run, so the pick gives it up after the retry", () => {
    const resumed: ResumeRun = { ...run, startOffsetSeconds: 4 * 3600 - 10, resumed: true };
    const first = decideResumePointsAfterExit({ points: [point(), other], run: resumed, kind: "open-failure", exitedAtMs: T + 2_000 });
    expect(first).toEqual([point({ shortStarts: 1, shortStartAt: iso(T) }), other]);
    // The start write already counted this run: not twice.
    expect(decideResumePointsAtStart([point(), other], resumed)).toEqual(first);
    expect(decideResumePointsAfterExit({ points: first, run: resumed, kind: "open-failure", exitedAtMs: T + 2_000 })).toEqual(first);
    // The M94 retry is a run of its own.
    const retry: ResumeRun = { ...resumed, startedAtMs: T + 20_000 };
    const second = decideResumePointsAfterExit({ points: first, run: retry, kind: "open-failure", exitedAtMs: T + 22_000 });
    expect(second[0]).toEqual(point({ shortStarts: 2, shortStartAt: iso(T + 20_000) }));
    expect(
      pickResumeItem({ points: second, pool: { id: "pool_p", cursorAssetId: "asset_a" }, assets: [{ id: "asset_a", durationSeconds: 6 * 3600 }], isEligible: () => true, runningAssetId: "", nowMs: T + 60_000 })
    ).toBeNull();
    // A start that is not a continuation counts nothing.
    expect(decideResumePointsAtStart([point()], run)).toEqual([point()]);
    expect(decideResumePointsAtStart([point()], null)).toEqual([point()]);
  });

  it("gives up a point whose continuations die with the container: the checkpoints count, airing 2 minutes clears it", () => {
    const resumed: ResumeRun = { ...run, startOffsetSeconds: 3 * 3600 - 25, resumed: true };
    const pools = [{ id: "pool_p", cursorAssetId: "asset_a" }];
    const started = decideResumePointsAtStart([point({ positionSeconds: 3 * 3600 - 15 })], resumed);
    const checkpoint = decideResumeCheckpoint({ points: started, run: resumed, processRunning: true, pools, nowMs: T + 15_000 });
    expect(checkpoint).toEqual([point({ positionSeconds: 3 * 3600 - 10, savedAt: iso(T + 15_000), shortStarts: 1, shortStartAt: iso(T) })]);
    // Killed with the container; the next continuation is counted again, and then no more.
    const again: ResumeRun = { ...resumed, startedAtMs: T + 60_000 };
    const twice = decideResumeCheckpoint({ points: decideResumePointsAtStart(checkpoint, again), run: again, processRunning: true, pools, nowMs: T + 75_000 });
    expect(twice[0]?.shortStarts).toBe(2);
    expect(
      pickResumeItem({ points: twice, pool: pools[0] ?? null, assets: [{ id: "asset_a", durationSeconds: 6 * 3600 }], isEligible: () => true, runningAssetId: "", nowMs: T + 120_000 })
    ).toBeNull();
    // One that airs 2 minutes is past the spot: the count is cleared.
    expect(decideResumeCheckpoint({ points: twice, run: again, processRunning: true, pools, nowMs: T + 60_000 + 120_000 })).toEqual([
      point({ positionSeconds: 3 * 3600 - 25 + 120, savedAt: iso(T + 180_000) })
    ]);
  });

  it("clears the point of an item that aired to its end under a Play now or a Pin", () => {
    const points = [point(), other];
    expect(decideResumePointsAfterExit({ points, run: null, kind: "ended", exitedAtMs: T, completedAssetId: "asset_a" })).toEqual([other]);
    expect(decideResumePointsAfterExit({ points, run: null, kind: "ended", exitedAtMs: T, completedAssetId: "" })).toEqual(points);
  });
});

describe("the checkpoint of every cycle", () => {
  const pools = [
    { id: "pool_p", cursorAssetId: "asset_b" },
    { id: "pool_q", cursorAssetId: "asset_q" }
  ];
  const run: ResumeRun = { assetId: "asset_b", poolId: "pool_p", startOffsetSeconds: 0, resumed: false, startedAtMs: T };

  it("writes the position of the pool's item on air, also in the cycle before the pool stores it", () => {
    // pool_p still names asset_a: this cycle started asset_b and stores it after the write.
    const before = [{ id: "pool_p", cursorAssetId: "asset_a" }, pools[1] as { id: string; cursorAssetId: string }];
    expect(
      decideResumeCheckpoint({ points: [point(), point({ poolId: "pool_q", assetId: "asset_q" })], run, processRunning: true, pools: before, nowMs: T + 15_000 })
    ).toEqual([point({ assetId: "asset_b", positionSeconds: 15, savedAt: iso(T + 15_000) }), point({ poolId: "pool_q", assetId: "asset_q" })]);
  });

  it("only prunes while nothing of a pool plays, and drops what is owed no more", () => {
    const points = [point({ poolId: "pool_q", assetId: "asset_q" }), point()];
    expect(decideResumeCheckpoint({ points, run: null, processRunning: true, pools, nowMs: T + 15_000 })).toEqual([
      point({ poolId: "pool_q", assetId: "asset_q" })
    ]);
    expect(decideResumeCheckpoint({ points, run, processRunning: false, pools, nowMs: T + 15_000 })).toEqual([
      point({ poolId: "pool_q", assetId: "asset_q" })
    ]);
    expect(decideResumeCheckpoint({ points, run: null, processRunning: false, pools, nowMs: T + 25 * 3600_000 })).toEqual([]);
  });
});

describe("the pick that continues the item", () => {
  const assets = [
    { id: "asset_a", durationSeconds: 6 * 3600 },
    { id: "asset_short", durationSeconds: 4 * 3600 + 60 }
  ];
  const pool = { id: "pool_p", cursorAssetId: "asset_a" };
  const pick = (overrides: Partial<Parameters<typeof pickResumeItem<(typeof assets)[number]>>[0]> = {}) =>
    pickResumeItem({ points: [point()], pool, assets, isEligible: () => true, runningAssetId: "", nowMs: T + 60_000, ...overrides });

  it("continues the cut item 10 s before the cut", () => {
    expect(pick()).toEqual({ asset: assets[0], startSeconds: 4 * 3600 - 10, positionSeconds: 4 * 3600 });
  });

  it("does not when the pool picks as before", () => {
    expect(pick({ points: [] })).toBeNull();
    expect(pick({ pool: null })).toBeNull();
    expect(pick({ pool: { id: "pool_p", cursorAssetId: "asset_b" } })).toBeNull();
    expect(pick({ points: [point({ poolId: "pool_q" })] })).toBeNull();
    expect(pick({ nowMs: T + 24 * 3600_000 })).toBeNull();
    expect(pick({ runningAssetId: "asset_a" })).toBeNull();
    expect(pick({ isEligible: () => false })).toBeNull();
    expect(pick({ assets: [] })).toBeNull();
    // Less than 2 minutes left.
    expect(pick({ points: [point({ assetId: "asset_short" })], pool: { id: "pool_p", cursorAssetId: "asset_short" } })).toBeNull();
  });
});

describe("the as-run row of a continued item", () => {
  it("says where it picked up", () => {
    const record: AsRunRecord = {
      id: "asrun_r",
      startedAt: "2026-10-26T20:00:00.000Z",
      endedAt: "2026-10-26T22:00:00.000Z",
      targetKind: "asset",
      assetId: "asset_a",
      title: "Archive",
      sourceId: "",
      poolId: "",
      blockId: "",
      reasonCode: "scheduled_match",
      queueKind: "asset",
      inputKind: "local",
      formatId: "",
      formatCandidate: "",
      plannedSeconds: 6 * 3600,
      airedSeconds: 2 * 3600,
      endReason: "natural-end",
      exitCode: "0",
      startOffsetSeconds: 4 * 3600 - 10
    };
    const context = { nowMs: T, timeZone: "Europe/Berlin", sourceName: () => "", poolName: () => "", blockTitle: () => "" };
    expect(buildAsRunRowView(record, context).timing).toBe("resumed at 3:59:50 · planned 6:00:00 · aired 2:00:00");
    expect(buildAsRunRowView({ ...record, startOffsetSeconds: 0 }, context).timing).toBe("planned 6:00:00 · aired 2:00:00");
  });
});
