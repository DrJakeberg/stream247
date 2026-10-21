import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_LOOP_STALL_TIMEOUT_MS } from "../../apps/worker/src/cycle-budget.js";
import {
  CYCLE_REMOTE_RESERVE_MS,
  MIN_REMOTE_CALL_MS,
  RemoteCallBudget,
  SOURCE_SYNC_TIMEOUT_BACKOFF_MS,
  SourceSyncTimeouts,
  orderDeferredFirst,
  orderSourcesForSync,
  sourceSyncTimeoutKey
} from "../../apps/worker/src/remote-call-budget.js";

const workerSource = readFileSync(path.join(process.cwd(), "apps/worker/src/index.ts"), "utf8");
const flatWorker = workerSource.replace(/\s+/g, " ");
// SOURCE_SYNC_YTDLP_TIMEOUT_MS with the default stall budget (M87).
const LISTING_TIMEOUT_MS = 120_000;

type Source = { id: string; externalUrl: string; answerMs: number };
const DEAD = Number.POSITIVE_INFINITY;
const STALL_MS = DEFAULT_LOOP_STALL_TIMEOUT_MS;

/**
 * Worker cycles on a simulated clock, the way the worker runs them: `beforeMs` of earlier steps, then
 * the YouTube sync and the Twitch sync (each source answers after `answerMs`, a dead host never), then
 * the chapter backfill (three probes of 30 s that answer in 1 s). The rules are the worker's own
 * classes; `withBudget: false` is the code before M112.
 */
function runCycles(steps: Source[][], cycles: number, options: { withBudget: boolean; beforeMs?: number }) {
  let nowMs = 0;
  const timeouts = new SourceSyncTimeouts(() => nowMs);
  const deferredIds = new Set<string>();
  const results: Array<{ startMs: number; elapsedMs: number; synced: string[]; failed: string[]; chapterProbes: number }> = [];
  for (let cycle = 0; cycle < cycles; cycle += 1) {
    const cycleStartMs = nowMs;
    const cycleBudget = RemoteCallBudget.forCycle(STALL_MS, () => nowMs);
    nowMs += options.beforeMs ?? 0;
    const synced: string[] = [];
    const failed: string[] = [];
    for (const sources of steps) {
      const stepBudget = cycleBudget.forStep(LISTING_TIMEOUT_MS);
      const deferred: string[] = [];
      for (const source of options.withBudget ? orderSourcesForSync(sources, deferredIds, timeouts) : sources) {
        if (options.withBudget && timeouts.isPaused(sourceSyncTimeoutKey(source))) {
          continue;
        }
        const timeoutMs = options.withBudget ? stepBudget.timeoutFor(LISTING_TIMEOUT_MS) : LISTING_TIMEOUT_MS;
        if (timeoutMs === null) {
          deferred.push(source.id);
          continue;
        }
        nowMs += Math.min(source.answerMs, timeoutMs);
        if (source.answerMs <= timeoutMs) {
          timeouts.answered(sourceSyncTimeoutKey(source));
          synced.push(source.id);
          continue;
        }
        const verdict = timeouts.settle(sourceSyncTimeoutKey(source), { timedOut: true, givenMs: timeoutMs, requestedMs: LISTING_TIMEOUT_MS });
        if (verdict === "deferred") {
          deferred.push(source.id);
          continue;
        }
        failed.push(source.id);
      }
      for (const source of sources) {
        deferredIds.delete(source.id);
      }
      for (const id of deferred) {
        deferredIds.add(id);
      }
    }
    let chapterProbes = 0;
    for (let probe = 0; probe < 3; probe += 1) {
      if (options.withBudget && cycleBudget.fitsWhole(30_000) === null) {
        break;
      }
      nowMs += 1_000;
      chapterProbes += 1;
    }
    results.push({ startMs: cycleStartMs, elapsedMs: nowMs - cycleStartMs, synced, failed, chapterProbes });
    // The worker loop's delay.
    nowMs += 30_000;
  }
  return results;
}

const dead = (id: string): Source => ({ id, externalUrl: `https://example.invalid/${id}`, answerMs: DEAD });
const healthy = (id: string, answerMs = 3_000): Source => ({ id, externalUrl: `https://example.invalid/${id}`, answerMs });
const firstCycleWith = (cycles: ReturnType<typeof runCycles>, id: string) => cycles.findIndex((cycle) => cycle.synced.includes(id));

describe("the worker cycle's budget for source hosts (M112)", () => {
  const youtube = [dead("dead_1"), dead("dead_2"), dead("dead_3"), healthy("healthy_yt")];
  const twitch = [healthy("healthy_tw")];

  it("before M112: three sources on a dead host hold the cycle past the stall guard", () => {
    expect(runCycles([youtube, twitch], 1, { withBudget: false })[0]!.elapsedMs).toBeGreaterThan(STALL_MS);
  });

  for (const beforeMs of [0, 45_000]) {
    it(`keeps every cycle below the stall guard, syncs both healthy sources and reports each dead host (earlier steps ${beforeMs / 1000} s)`, () => {
      const cycles = runCycles([youtube, twitch], 12, { withBudget: true, beforeMs });
      for (const cycle of cycles) {
        expect(cycle.elapsedMs).toBeLessThanOrEqual(STALL_MS - CYCLE_REMOTE_RESERVE_MS + 3_000);
      }
      expect(firstCycleWith(cycles, "healthy_yt")).toBeGreaterThan(-1);
      expect(firstCycleWith(cycles, "healthy_yt")).toBeLessThan(4);
      // The Twitch sync has its own step time: a dead YouTube host never takes it.
      expect(cycles.every((cycle) => cycle.synced.includes("healthy_tw"))).toBe(true);
      // Every dead host is reported as before M112, then paused: never twice within ten minutes.
      const failures = cycles.flatMap((cycle) => cycle.failed);
      for (const id of ["dead_1", "dead_2", "dead_3"]) {
        const times = cycles.filter((cycle) => cycle.failed.includes(id)).map((cycle) => cycle.startMs);
        expect(times.length, id).toBeGreaterThanOrEqual(1);
        for (let index = 1; index < times.length; index += 1) {
          expect(times[index]! - times[index - 1]!, id).toBeGreaterThanOrEqual(SOURCE_SYNC_TIMEOUT_BACKOFF_MS - STALL_MS);
        }
      }
      expect(new Set(failures)).toEqual(new Set(["dead_1", "dead_2", "dead_3"]));
      // Each unknown dead host holds the YouTube step once; after that a host back from its pause is
      // walked last and never holds the healthy source up again.
      expect(cycles.slice(3).every((cycle) => cycle.synced.includes("healthy_yt"))).toBe(true);
      expect(cycles.every((cycle) => cycle.chapterProbes === 3)).toBe(true);
    });
  }

  it("reports a dead Twitch host behind a slow YouTube sync (review of M112)", () => {
    const cycles = runCycles([[healthy("slow_yt", 31_000)], [dead("dead_tw")]], 4, { withBudget: true, beforeMs: 20_000 });
    expect(cycles[0]!.failed).toEqual(["dead_tw"]);
    expect(cycles.every((cycle) => cycle.synced.includes("slow_yt"))).toBe(true);
  });

  it("starves neither the Twitch sync nor the chapters under a heavy, healthy YouTube load (review of M112)", () => {
    const cycles = runCycles([[healthy("yt_1", 60_000), healthy("yt_2", 60_000), healthy("yt_3", 60_000)], twitch], 6, {
      withBudget: true
    });
    expect(cycles.every((cycle) => cycle.synced.includes("healthy_tw"))).toBe(true);
    expect(cycles.flatMap((cycle) => cycle.failed)).toEqual([]);
    for (const id of ["yt_1", "yt_2", "yt_3"]) {
      expect(firstCycleWith(cycles, id), id).toBeLessThan(2);
    }
    expect(cycles.every((cycle) => cycle.chapterProbes === 3)).toBe(true);
  });

  it("defers a healthy slow listing that a deadline cut short, and reports it only when cut short twice in a row", () => {
    const slow = runCycles([[healthy("first", 100_000), healthy("slow", 40_000)], twitch], 4, { withBudget: true });
    // Cut short behind "first", it goes first in the next run and gets the step's whole time.
    expect(slow[0]!.synced).toEqual(["first", "healthy_tw"]);
    expect(slow[1]!.synced).toContain("slow");
    expect(slow.flatMap((cycle) => cycle.failed)).toEqual([]);
    const timeouts = new SourceSyncTimeouts(() => 0);
    expect(timeouts.settle("k", { timedOut: true, givenMs: 30_000, requestedMs: 120_000 })).toBe("deferred");
    expect(timeouts.settle("k", { timedOut: true, givenMs: 30_000, requestedMs: 120_000 })).toBe("failed-backoff");
    expect(timeouts.isPaused("k")).toBe(true);
  });

  it("tells a cut-short timeout from a whole one, and a failure from both", () => {
    let nowMs = 0;
    const timeouts = new SourceSyncTimeouts(() => nowMs);
    expect(timeouts.settle("a", { timedOut: false, givenMs: 30_000, requestedMs: 120_000 })).toBe("failed");
    expect(timeouts.isPaused("a")).toBe(false);
    expect(timeouts.settle("b", { timedOut: true, givenMs: 30_000, requestedMs: 120_000 })).toBe("deferred");
    timeouts.answered("b");
    expect(timeouts.settle("b", { timedOut: true, givenMs: 30_000, requestedMs: 120_000 })).toBe("deferred");
    expect(timeouts.settle("c", { timedOut: true, givenMs: 120_000, requestedMs: 120_000 })).toBe("failed-backoff");
    expect(timeouts.isPaused("c")).toBe(true);
    nowMs = SOURCE_SYNC_TIMEOUT_BACKOFF_MS - 1;
    expect(timeouts.isPaused("c")).toBe(true);
    nowMs = SOURCE_SYNC_TIMEOUT_BACKOFF_MS;
    expect(timeouts.isPaused("c")).toBe(false);
  });

  it("pauses a source under its URL, so a fixed URL is asked at once", () => {
    const timeouts = new SourceSyncTimeouts(() => 0);
    const before = sourceSyncTimeoutKey({ id: "src", externalUrl: "https://dead.example/list" });
    timeouts.settle(before, { timedOut: true, givenMs: 120_000, requestedMs: 120_000 });
    expect(timeouts.isPaused(before)).toBe(true);
    expect(timeouts.isPaused(sourceSyncTimeoutKey({ id: "src", externalUrl: "https://fixed.example/list" }))).toBe(false);
  });

  it("gives each step its own time and never passes the cycle's deadline", () => {
    let nowMs = 0;
    const cycle = RemoteCallBudget.forCycle(300_000, () => nowMs);
    expect(cycle.remainingMs()).toBe(300_000 - CYCLE_REMOTE_RESERVE_MS);
    nowMs = 200_000;
    // 70 s left of the cycle: the step gets those, not its 120 s.
    expect(cycle.forStep(120_000).remainingMs()).toBe(70_000);
    nowMs = 10_000;
    expect(cycle.forStep(120_000).remainingMs()).toBe(120_000);
  });

  it("cuts a call's timeout to what is left and starts none below the minimum", () => {
    let nowMs = 0;
    const budget = RemoteCallBudget.forCycle(150_000 + CYCLE_REMOTE_RESERVE_MS, () => nowMs);
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

  it("is wired into both syncs and the chapter backfill, with a step budget each and one cycle budget", () => {
    expect(flatWorker).toContain(
      "async function runWorkerCycle(): Promise<void> { workerRemoteCallBudget = RemoteCallBudget.forCycle(LOOP_STALL_TIMEOUT_MS);"
    );
    expect(flatWorker.match(/const stepBudget = workerRemoteCallBudget\.forStep\(SOURCE_SYNC_YTDLP_TIMEOUT_MS\);/g)).toHaveLength(2);
    expect(flatWorker.match(/const timeoutMs = stepBudget\.timeoutFor\(SOURCE_SYNC_YTDLP_TIMEOUT_MS\);/g)).toHaveLength(2);
    expect(flatWorker).toContain("const probeTimeoutMs = workerRemoteCallBudget.fitsWhole(config.probeTimeoutMs);");
    expect(flatWorker).toContain("const result = await probeAssetChapters(candidate, { ...config, probeTimeoutMs });");
    // Every source sync call takes the budget's timeout, none the bare constant.
    expect(flatWorker).not.toMatch(/timeoutMs: SOURCE_SYNC_YTDLP_TIMEOUT_MS/);
    for (const [step, enabled] of [
      ["youtube-sources", "enabledYoutubeSources"],
      ["twitch-sources", "enabledTwitchSources"]
    ] as const) {
      expect(flatWorker).toContain(`for (const source of orderSourcesForSync(${enabled}, sourceSyncDeferredIds, sourceSyncTimeouts)) {`);
      expect(flatWorker).toContain(`noteSourceSyncDeferrals("${step}", ${enabled}, deferredSourceIds);`);
    }
    // A deferred source is left out of everything after the walk: only walked sources are pushed.
    expect(flatWorker).toContain(
      "if (timeoutMs === null) { deferredSourceIds.push(source.id); continue; } youtubeSources.push(source);"
    );
    expect(flatWorker).toContain(
      "if (timeoutMs === null) { deferredSourceIds.push(source.id); continue; } twitchSources.push(source);"
    );
    // A paused source is skipped before the budget is asked; a cut-short timeout leaves the walk.
    expect(flatWorker.match(/if \(sourceSyncTimeouts\.isPaused\(sourceSyncTimeoutKey\(source\)\)\) \{ continue; \}/g)).toHaveLength(2);
    for (const list of ["youtubeSources", "twitchSources"]) {
      expect(flatWorker).toContain(
        `} catch (error) { if (deferOrPauseSourceSync(source, error, timeoutMs, deferredSourceIds)) { ${list}.splice(${list}.indexOf(source), 1); continue; }`
      );
    }
    // Each of the three calls clears the cut-short mark when it answers.
    expect(flatWorker.match(/sourceSyncTimeouts\.answered\(sourceSyncTimeoutKey\(source\)\);/g)).toHaveLength(3);
    const settle = flatWorker.slice(flatWorker.indexOf("function deferOrPauseSourceSync("), flatWorker.indexOf("function noteSourceSyncDeferrals("));
    expect(settle).toContain(
      'const verdict = sourceSyncTimeouts.settle(sourceSyncTimeoutKey(source), { timedOut: error instanceof ExecFileTextError && error.kind === "timeout", givenMs: timeoutMs, requestedMs: SOURCE_SYNC_YTDLP_TIMEOUT_MS });'
    );
  });
});
