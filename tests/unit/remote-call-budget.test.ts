import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_LOOP_STALL_TIMEOUT_MS } from "../../apps/worker/src/cycle-budget.js";
import {
  CYCLE_REMOTE_RESERVE_FRACTION,
  RemoteCallBudget,
  SOURCE_SYNC_TIMEOUT_BACKOFF_MS,
  SourceSyncPauses,
  orderDeferredFirst,
  sourceSyncPauseKey
} from "../../apps/worker/src/remote-call-budget.js";

const workerSource = readFileSync(path.join(process.cwd(), "apps/worker/src/index.ts"), "utf8");
const flatWorker = workerSource.replace(/\s+/g, " ");

/** How long a source takes to answer at `nowMs`; a dead host never answers. */
type Source = { id: string; externalUrl: string; answerMs: (nowMs: number) => number };
const DEAD = Number.POSITIVE_INFINITY;
// The steps after the calls in a healthy cycle (the Twitch requests, chat), and the loop's delay.
const LATER_STEPS_MS = 2_000;
const LOOP_DELAY_MS = 30_000;

type Cycle = {
  startMs: number;
  /** When the last remote call ended, from the cycle's start. */
  callsEndedMs: number;
  elapsedMs: number;
  synced: string[];
  failed: string[];
  deferred: string[];
  chapterProbes: number;
};

/**
 * Worker cycles on a simulated clock, as the worker runs them: `beforeMs` of earlier steps, the YouTube
 * sync, the Twitch sync, the chapter backfill (three probes of 30 s that answer in 1 s), then the later
 * steps. The listing timeout is SOURCE_SYNC_YTDLP_TIMEOUT_MS: two minutes, clamped to half the stall
 * guard. The rules are the worker's own classes; `withBudget: false` is the code before M112.
 */
function runCycles(
  youtube: Source[],
  twitch: Source[],
  cycles: number,
  options: { withBudget: boolean; stallMs?: number; beforeMs?: number }
): Cycle[] {
  const stallMs = options.stallMs ?? DEFAULT_LOOP_STALL_TIMEOUT_MS;
  const listingTimeoutMs = Math.min(120_000, Math.floor(stallMs / 2));
  let nowMs = 0;
  const pauses = new SourceSyncPauses(() => nowMs);
  const deferredIds = new Set<string>();
  const results: Cycle[] = [];
  for (let cycle = 0; cycle < cycles; cycle += 1) {
    const startMs = nowMs;
    const budget = RemoteCallBudget.forCycle(stallMs, () => nowMs);
    nowMs += options.beforeMs ?? 0;
    const synced: string[] = [];
    const failed: string[] = [];
    const deferredThisCycle: string[] = [];
    const twitchWaiting = twitch.some((source) => deferredIds.has(source.id));
    for (const [sources, reserveMs] of [
      [youtube, twitchWaiting ? listingTimeoutMs : 0],
      [twitch, 0]
    ] as const) {
      const deferred: string[] = [];
      for (const source of options.withBudget ? orderDeferredFirst(sources, deferredIds) : sources) {
        if (options.withBudget && pauses.isPaused(sourceSyncPauseKey(source))) {
          continue;
        }
        const timeoutMs = options.withBudget ? budget.fitsWhole(listingTimeoutMs, reserveMs) : listingTimeoutMs;
        if (timeoutMs === null) {
          deferred.push(source.id);
          continue;
        }
        const answerMs = source.answerMs(nowMs);
        nowMs += Math.min(answerMs, timeoutMs);
        if (answerMs <= timeoutMs) {
          synced.push(source.id);
          continue;
        }
        failed.push(source.id);
        if (options.withBudget) {
          pauses.start(sourceSyncPauseKey(source));
        }
      }
      for (const source of sources) {
        deferredIds.delete(source.id);
      }
      for (const id of deferred) {
        deferredIds.add(id);
      }
      deferredThisCycle.push(...deferred);
    }
    let chapterProbes = 0;
    for (let probe = 0; probe < 3; probe += 1) {
      if (options.withBudget && budget.fitsWhole(30_000) === null) {
        break;
      }
      nowMs += 1_000;
      chapterProbes += 1;
    }
    const callsEndedMs = nowMs - startMs;
    nowMs += LATER_STEPS_MS;
    results.push({ startMs, callsEndedMs, elapsedMs: nowMs - startMs, synced, failed, deferred: deferredThisCycle, chapterProbes });
    nowMs += LOOP_DELAY_MS;
  }
  return results;
}

const source = (id: string, answerMs: (nowMs: number) => number): Source => ({ id, externalUrl: `https://example.invalid/${id}`, answerMs });
const dead = (id: string) => source(id, () => DEAD);
const healthy = (id: string, answerMs = 3_000) => source(id, () => answerMs);

/** Each source's longest run of cycles in a row without a sync (a paused source is not counted). */
function longestWait(cycles: Cycle[], id: string): number {
  let longest = 0;
  let current = 0;
  for (const cycle of cycles) {
    current = cycle.synced.includes(id) ? 0 : current + 1;
    longest = Math.max(longest, current);
  }
  return longest;
}

describe("the worker cycle's budget for source hosts (M112)", () => {
  it("before M112: three sources on a dead host hold the cycle past the stall guard", () => {
    const [cycle] = runCycles([dead("yt1"), dead("yt2")], [dead("tw1")], 1, { withBudget: false });
    expect(cycle!.elapsedMs).toBeGreaterThan(DEFAULT_LOOP_STALL_TIMEOUT_MS);
  });

  for (const stallMs of [60_000, 120_000, 300_000]) {
    // Earlier steps of a healthy cycle take about a second; 10 s is a slow database.
    for (const beforeMs of [0, 10_000]) {
      it(`ends every call before the deadline, never fails a healthy source and reports each dead host once per pause (stall ${stallMs / 1000} s, earlier steps ${beforeMs / 1000} s)`, () => {
        const listingTimeoutMs = Math.min(120_000, stallMs / 2);
        const cycles = runCycles(
          [dead("yt-dead"), healthy("yt1"), dead("yt-dead2"), healthy("yt2")],
          [dead("tw-dead"), healthy("tw1")],
          60,
          { withBudget: true, stallMs, beforeMs }
        );
        for (const cycle of cycles) {
          expect(cycle.callsEndedMs).toBeLessThanOrEqual(stallMs * (1 - CYCLE_REMOTE_RESERVE_FRACTION));
          expect(cycle.elapsedMs).toBeLessThan(stallMs);
          expect(cycle.failed.every((id) => id.includes("dead"))).toBe(true);
        }
        for (const id of ["yt-dead", "yt-dead2", "tw-dead"]) {
          const reports = cycles.filter((cycle) => cycle.failed.includes(id)).map((cycle) => cycle.startMs);
          expect(reports.length, id).toBeGreaterThan(0);
          for (let index = 1; index < reports.length; index += 1) {
            expect(reports[index]! - reports[index - 1]!, id).toBeGreaterThanOrEqual(SOURCE_SYNC_TIMEOUT_BACKOFF_MS);
          }
        }
        // Everything healthy keeps syncing: a dead host's call delays it a few cycles, never for good.
        const room = Math.max(1, Math.floor((stallMs * (1 - CYCLE_REMOTE_RESERVE_FRACTION) - beforeMs) / listingTimeoutMs));
        for (const id of ["yt1", "yt2", "tw1"]) {
          expect(longestWait(cycles, id), id).toBeLessThanOrEqual(Math.ceil(6 / room) + 1);
        }
      });
    }
  }

  it("never reports a slow but healthy listing as failed: no timeout is cut short", () => {
    const cycles = runCycles([healthy("yt-slow", 115_000), healthy("yt1")], [healthy("tw-slow", 110_000)], 30, {
      withBudget: true
    });
    for (const cycle of cycles) {
      expect(cycle.failed).toEqual([]);
      expect(cycle.callsEndedMs).toBeLessThanOrEqual(DEFAULT_LOOP_STALL_TIMEOUT_MS * (1 - CYCLE_REMOTE_RESERVE_FRACTION));
    }
    for (const id of ["yt-slow", "yt1", "tw-slow"]) {
      expect(cycles.filter((cycle) => cycle.synced.includes(id)).length, id).toBeGreaterThan(5);
    }
  });

  it("takes turns under a heavy, healthy YouTube load: Twitch waits one cycle at most, every source syncs", () => {
    const youtube = ["yt1", "yt2", "yt3", "yt4", "yt5"].map((id) => healthy(id, 100_000));
    const cycles = runCycles(youtube, [healthy("tw1", 100_000)], 30, { withBudget: true });
    for (const cycle of cycles) {
      expect(cycle.failed).toEqual([]);
    }
    expect(longestWait(cycles, "tw1")).toBeLessThanOrEqual(1);
    // One listing of 120 s fits a cycle with the Twitch reserve, two without: six sources need at most
    // six cycles for a full turn.
    for (const id of youtube.map((entry) => entry.id)) {
      expect(longestWait(cycles, id), id).toBeLessThanOrEqual(5);
    }
  });

  it("syncs a host again once it answers, within a pause and a cycle", () => {
    const backAtMs = 5 * 60_000;
    const cycles = runCycles([source("yt-back", (nowMs) => (nowMs < backAtMs ? DEAD : 3_000)), healthy("yt1")], [], 40, {
      withBudget: true
    });
    const firstFailed = cycles.find((cycle) => cycle.failed.includes("yt-back"))!;
    const firstSynced = cycles.find((cycle) => cycle.synced.includes("yt-back"))!;
    expect(firstSynced.startMs).toBeGreaterThanOrEqual(firstFailed.startMs + SOURCE_SYNC_TIMEOUT_BACKOFF_MS);
    expect(firstSynced.startMs).toBeLessThanOrEqual(firstFailed.startMs + SOURCE_SYNC_TIMEOUT_BACKOFF_MS + 5 * 60_000);
    expect(cycles.filter((cycle) => cycle.failed.includes("yt-back"))).toHaveLength(1);
    // From then on it syncs every cycle.
    expect(cycles.slice(cycles.indexOf(firstSynced)).every((cycle) => cycle.synced.includes("yt-back"))).toBe(true);
  });

  it("starts a call only when its whole timeout and the reserve fit before the deadline", () => {
    let nowMs = 0;
    const budget = RemoteCallBudget.forCycle(300_000, () => nowMs);
    expect(budget.deadlineMs).toBe(240_000);
    expect(budget.fitsWhole(120_000)).toBe(120_000);
    expect(budget.fitsWhole(120_000, 120_000)).toBe(120_000);
    nowMs = 1;
    expect(budget.fitsWhole(120_000, 120_000)).toBeNull();
    expect(budget.fitsWhole(120_000)).toBe(120_000);
    nowMs = 120_001;
    expect(budget.fitsWhole(120_000)).toBeNull();
    expect(budget.fitsWhole(30_000)).toBe(30_000);
    nowMs = 300_000;
    expect(budget.remainingMs()).toBe(0);
  });

  it("pauses a source under its URL, so a fixed URL is asked at once, and ends the pause after ten minutes", () => {
    let nowMs = 0;
    const pauses = new SourceSyncPauses(() => nowMs);
    const broken = { id: "src", externalUrl: " https://example.invalid/old " };
    pauses.start(sourceSyncPauseKey(broken));
    expect(pauses.isPaused(sourceSyncPauseKey({ id: "src", externalUrl: "https://example.invalid/old" }))).toBe(true);
    expect(pauses.isPaused(sourceSyncPauseKey({ id: "src", externalUrl: "https://example.invalid/new" }))).toBe(false);
    expect(pauses.isPaused(sourceSyncPauseKey({ id: "other", externalUrl: "https://example.invalid/old" }))).toBe(false);
    nowMs = SOURCE_SYNC_TIMEOUT_BACKOFF_MS - 1;
    expect(pauses.isPaused(sourceSyncPauseKey(broken))).toBe(true);
    nowMs = SOURCE_SYNC_TIMEOUT_BACKOFF_MS;
    expect(pauses.isPaused(sourceSyncPauseKey(broken))).toBe(false);
  });

  it("walks the longest-waiting deferred sources first, then the rest in their own order", () => {
    const sources = ["a", "b", "c", "d", "e"].map((id) => ({ id }));
    expect(orderDeferredFirst(sources, new Set()).map((entry) => entry.id)).toEqual(["a", "b", "c", "d", "e"]);
    expect(orderDeferredFirst(sources, new Set(["e", "c", "gone"])).map((entry) => entry.id)).toEqual(["e", "c", "a", "b", "d"]);
  });

  it("is wired into both syncs and the chapter backfill with one cycle budget", () => {
    expect(flatWorker).toContain(
      "async function runWorkerCycle(): Promise<void> { workerRemoteCallBudget = RemoteCallBudget.forCycle(LOOP_STALL_TIMEOUT_MS);"
    );
    expect(flatWorker).toContain(
      'const twitchSyncWaiting = state.sources.some( (source) => (source.connectorKind === "twitch-vod" || source.connectorKind === "twitch-channel") && sourceSyncDeferredIds.has(source.id) );'
    );
    expect(flatWorker).toContain(
      "const timeoutMs = workerRemoteCallBudget.fitsWhole( SOURCE_SYNC_YTDLP_TIMEOUT_MS, twitchSyncWaiting ? SOURCE_SYNC_YTDLP_TIMEOUT_MS : 0 ); if (timeoutMs === null) { deferredSourceIds.push(source.id); continue; } youtubeSources.push(source);"
    );
    expect(flatWorker).toContain(
      "const timeoutMs = workerRemoteCallBudget.fitsWhole(SOURCE_SYNC_YTDLP_TIMEOUT_MS); if (timeoutMs === null) { deferredSourceIds.push(source.id); continue; } twitchSources.push(source);"
    );
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
    // A paused source is skipped before the budget is asked; a timeout is reported and pauses the source.
    expect(flatWorker.match(/if \(sourceSyncPauses\.isPaused\(sourceSyncPauseKey\(source\)\)\) \{ continue; \}/g)).toHaveLength(2);
    expect(flatWorker.match(/\} catch \(error\) \{ pauseSourceSyncOnTimeout\(source, error\); (const message = [^;]+; )?failedSourceIds\.add\(source\.id\);/g)).toHaveLength(2);
    expect(flatWorker).toContain(
      'if (error instanceof ExecFileTextError && error.kind === "timeout") { sourceSyncPauses.start(sourceSyncPauseKey(source));'
    );
  });
});
