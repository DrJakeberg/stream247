import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_LOOP_STALL_TIMEOUT_MS, getCycleAwaitCeilingMs } from "../../apps/worker/src/cycle-budget.js";
import {
  MIN_REMOTE_CALL_MS,
  RemoteCallBudget,
  SOURCE_SYNC_TIMEOUT_BACKOFF_MS,
  SourceSyncBackoff,
  classifySourceSyncTimeout,
  orderDeferredFirst
} from "../../apps/worker/src/remote-call-budget.js";

const workerSource = readFileSync(path.join(process.cwd(), "apps/worker/src/index.ts"), "utf8");
const flatWorker = workerSource.replace(/\s+/g, " ");
// SOURCE_SYNC_YTDLP_TIMEOUT_MS with the default stall budget (M87).
const LISTING_TIMEOUT_MS = 120_000;

type Source = { id: string; deadHost: boolean };

/**
 * Worker cycles of the source syncs on a simulated clock, the way the steps walk their sources (the
 * YouTube sync, then the Twitch sync): a dead host never answers (the call runs to its timeout), a
 * healthy one answers in `healthyMs`. The rules are the worker's (`deferOrBackOffSourceSync`).
 */
function runCycles(steps: Source[][], cycles: number, options: { withBudget: boolean; healthyMs?: number }) {
  let nowMs = 0;
  const backoff = new SourceSyncBackoff(() => nowMs);
  const deferredIds = new Set<string>();
  const results: Array<{ elapsedMs: number; synced: string[]; failed: string[] }> = [];
  for (let cycle = 0; cycle < cycles; cycle += 1) {
    const cycleStartMs = nowMs;
    const budget = new RemoteCallBudget(getCycleAwaitCeilingMs({}), () => nowMs);
    const synced: string[] = [];
    const failed: string[] = [];
    for (const sources of steps) {
      const deferred: string[] = [];
      for (const source of options.withBudget ? orderDeferredFirst(sources, deferredIds) : sources) {
        if (options.withBudget && backoff.isActive(source.id)) {
          continue;
        }
        const timeoutMs = options.withBudget ? budget.timeoutFor(LISTING_TIMEOUT_MS) : LISTING_TIMEOUT_MS;
        if (timeoutMs === null) {
          deferred.push(source.id);
          continue;
        }
        const answerMs = source.deadHost ? Number.POSITIVE_INFINITY : (options.healthyMs ?? 3_000);
        nowMs += Math.min(answerMs, timeoutMs);
        if (answerMs <= timeoutMs) {
          synced.push(source.id);
          continue;
        }
        const verdict = classifySourceSyncTimeout({ timedOut: true, givenMs: timeoutMs, requestedMs: LISTING_TIMEOUT_MS });
        if (verdict === "deferred") {
          deferred.push(source.id);
          continue;
        }
        failed.push(source.id);
        if (verdict === "backoff") {
          backoff.start(source.id);
        }
      }
      for (const source of sources) {
        deferredIds.delete(source.id);
      }
      for (const id of deferred) {
        deferredIds.add(id);
      }
    }
    results.push({ elapsedMs: nowMs - cycleStartMs, synced, failed });
    // The worker loop's delay.
    nowMs += 30_000;
  }
  return results;
}

describe("the worker cycle's budget for source hosts (M112)", () => {
  const youtube: Source[] = [
    { id: "dead_1", deadHost: true },
    { id: "dead_2", deadHost: true },
    { id: "dead_3", deadHost: true },
    { id: "healthy_yt", deadHost: false }
  ];
  const twitch: Source[] = [{ id: "healthy_tw", deadHost: false }];

  it("before M112: three sources on a dead host hold the cycle past the stall guard", () => {
    expect(runCycles([youtube, twitch], 1, { withBudget: false })[0]!.elapsedMs).toBeGreaterThan(DEFAULT_LOOP_STALL_TIMEOUT_MS);
  });

  it("bounds every cycle's waiting at half the stall budget, and every healthy source is synced within four cycles", () => {
    const cycles = runCycles([youtube, twitch], 12, { withBudget: true });
    for (const cycle of cycles) {
      expect(cycle.elapsedMs).toBeLessThanOrEqual(getCycleAwaitCeilingMs({}));
    }
    const firstSynced = (id: string) => cycles.findIndex((cycle) => cycle.synced.includes(id));
    expect(firstSynced("healthy_yt")).toBeGreaterThan(-1);
    expect(firstSynced("healthy_yt")).toBeLessThan(4);
    expect(firstSynced("healthy_tw")).toBeGreaterThan(-1);
    expect(firstSynced("healthy_tw")).toBeLessThan(4);
    // Each dead host is reported once, after a whole timeout, and then left alone for ten minutes (9 cycles).
    const failures = cycles.slice(0, 9).flatMap((cycle) => cycle.failed);
    expect([...failures].sort()).toEqual(["dead_1", "dead_2", "dead_3"]);
    // After the pause it is asked again, alone in its cycle's waiting; the healthy ones still get through.
    expect(cycles.slice(9).flatMap((cycle) => cycle.failed).length).toBeGreaterThan(0);
    // Once the dead hosts are backed off, the healthy sources are synced on every cycle.
    expect(cycles.slice(4).every((cycle) => cycle.synced.includes("healthy_yt") && cycle.synced.includes("healthy_tw"))).toBe(true);
  });

  it("never reports a healthy source as failed because the budget cut its timeout short", () => {
    // A slow, healthy listing (40 s) behind a dead host: it gets the last 30 s, runs out, and is deferred.
    const cycles = runCycles([[{ id: "dead", deadHost: true }, { id: "slow", deadHost: false }], twitch], 4, {
      withBudget: true,
      healthyMs: 40_000
    });
    expect(cycles.flatMap((cycle) => cycle.failed)).toEqual(["dead"]);
    expect(cycles[1]!.synced).toContain("slow");
  });

  it("starves no later step behind a dead host at the head of the first (review of M112)", () => {
    const cycles = runCycles(
      [
        [
          { id: "dead_y1", deadHost: true },
          { id: "dead_y2", deadHost: true }
        ],
        twitch
      ],
      6,
      { withBudget: true }
    );
    expect(cycles.filter((cycle) => cycle.synced.includes("healthy_tw")).length).toBeGreaterThanOrEqual(4);
  });

  it("tells a cut-short timeout from a whole one, and a failure from both", () => {
    expect(classifySourceSyncTimeout({ timedOut: false, givenMs: 30_000, requestedMs: 120_000 })).toBe("failed");
    expect(classifySourceSyncTimeout({ timedOut: true, givenMs: 30_000, requestedMs: 120_000 })).toBe("deferred");
    expect(classifySourceSyncTimeout({ timedOut: true, givenMs: 120_000, requestedMs: 120_000 })).toBe("backoff");
  });

  it("ends a backoff after its pause", () => {
    let nowMs = 0;
    const backoff = new SourceSyncBackoff(() => nowMs);
    backoff.start("dead");
    expect(backoff.isActive("dead")).toBe(true);
    expect(backoff.isActive("other")).toBe(false);
    nowMs = SOURCE_SYNC_TIMEOUT_BACKOFF_MS - 1;
    expect(backoff.isActive("dead")).toBe(true);
    nowMs = SOURCE_SYNC_TIMEOUT_BACKOFF_MS;
    expect(backoff.isActive("dead")).toBe(false);
  });

  it("cuts a call's timeout to what is left and starts none below the minimum", () => {
    let nowMs = 0;
    const budget = new RemoteCallBudget(150_000, () => nowMs);
    expect(budget.timeoutFor(120_000)).toBe(120_000);
    nowMs = 130_000;
    expect(budget.timeoutFor(120_000)).toBe(20_000);
    expect(budget.timeoutFor(5_000)).toBe(5_000);
    nowMs = 150_000 - MIN_REMOTE_CALL_MS + 1;
    expect(budget.timeoutFor(120_000)).toBeNull();
    // A short call (a chapter probe with a small timeout) still fits what it asks for.
    expect(budget.timeoutFor(10_000)).toBe(10_000);
    nowMs = 200_000;
    expect(budget.remainingMs()).toBe(0);
    expect(budget.timeoutFor(1_000)).toBeNull();
    nowMs = 125_000;
    expect(budget.fitsWhole(30_000)).toBeNull();
    expect(budget.fitsWhole(25_000)).toBe(25_000);
  });

  it("keeps the order of both groups", () => {
    const list = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];
    expect(orderDeferredFirst(list, new Set(["d", "b"])).map((entry) => entry.id)).toEqual(["b", "d", "a", "c"]);
    expect(orderDeferredFirst(list, new Set()).map((entry) => entry.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("is one budget per worker cycle for both syncs and the chapter backfill", () => {
    expect(flatWorker).toContain(
      "async function runWorkerCycle(): Promise<void> { workerRemoteCallBudget = new RemoteCallBudget(getCycleAwaitCeilingMs(process.env));"
    );
    expect(flatWorker.match(/workerRemoteCallBudget\.timeoutFor\(SOURCE_SYNC_YTDLP_TIMEOUT_MS\)/g)).toHaveLength(2);
    expect(flatWorker).toContain("const probeTimeoutMs = workerRemoteCallBudget.fitsWhole(config.probeTimeoutMs);");
    expect(flatWorker).toContain("const result = await probeAssetChapters(candidate, { ...config, probeTimeoutMs });");
    // Every source sync call takes the budget's timeout, none the bare constant.
    expect(flatWorker).not.toMatch(/timeoutMs: SOURCE_SYNC_YTDLP_TIMEOUT_MS/);
    for (const [step, enabled] of [
      ["youtube-sources", "enabledYoutubeSources"],
      ["twitch-sources", "enabledTwitchSources"]
    ] as const) {
      expect(flatWorker).toContain(`for (const source of orderDeferredFirst(${enabled}, sourceSyncDeferredIds)) {`);
      expect(flatWorker).toContain(`noteSourceSyncDeferrals("${step}", ${enabled}, deferredSourceIds);`);
    }
    // A deferred source is left out of everything after the walk: only walked sources are pushed.
    expect(flatWorker).toContain(
      "if (timeoutMs === null) { deferredSourceIds.push(source.id); continue; } youtubeSources.push(source);"
    );
    expect(flatWorker).toContain(
      "if (timeoutMs === null) { deferredSourceIds.push(source.id); continue; } twitchSources.push(source);"
    );
    // A backed-off source is skipped before the budget is asked; a cut-short timeout leaves the walk.
    expect(flatWorker.match(/if \(sourceSyncBackoff\.isActive\(source\.id\)\) \{ continue; \}/g)).toHaveLength(2);
    for (const list of ["youtubeSources", "twitchSources"]) {
      expect(flatWorker).toContain(
        `} catch (error) { if (deferOrBackOffSourceSync(source.id, error, timeoutMs, deferredSourceIds)) { ${list}.splice(${list}.indexOf(source), 1); continue; }`
      );
    }
    expect(flatWorker).toContain('timedOut: error instanceof ExecFileTextError && error.kind === "timeout",');
  });
});
