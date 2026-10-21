import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_LOOP_STALL_TIMEOUT_MS, getCycleAwaitCeilingMs } from "../../apps/worker/src/cycle-budget.js";
import { MIN_REMOTE_CALL_MS, RemoteCallBudget, orderDeferredFirst } from "../../apps/worker/src/remote-call-budget.js";

const workerSource = readFileSync(path.join(process.cwd(), "apps/worker/src/index.ts"), "utf8");
const flatWorker = workerSource.replace(/\s+/g, " ");
// SOURCE_SYNC_YTDLP_TIMEOUT_MS with the default stall budget (M87).
const LISTING_TIMEOUT_MS = 120_000;

type Source = { id: string; deadHost: boolean };

/**
 * One worker cycle of the source syncs on a simulated clock, the way the syncs walk their sources: a
 * dead host answers never (the call runs to its timeout), a healthy one in 3 s.
 */
function syncCycle(sources: Source[], deferredIds: Set<string>, withBudget: boolean) {
  let nowMs = 0;
  const budget = new RemoteCallBudget(getCycleAwaitCeilingMs({}), () => nowMs);
  const synced: string[] = [];
  const deferred: string[] = [];
  for (const source of withBudget ? orderDeferredFirst(sources, deferredIds) : sources) {
    const timeoutMs = withBudget ? budget.timeoutFor(LISTING_TIMEOUT_MS) : LISTING_TIMEOUT_MS;
    if (timeoutMs === null) {
      deferred.push(source.id);
      continue;
    }
    nowMs += source.deadHost ? timeoutMs : 3_000;
    synced.push(source.id);
  }
  return { elapsedMs: nowMs, synced, deferred };
}

describe("the worker cycle's budget for source hosts (M112)", () => {
  const sources: Source[] = [
    { id: "dead_1", deadHost: true },
    { id: "dead_2", deadHost: true },
    { id: "dead_3", deadHost: true },
    { id: "healthy", deadHost: false }
  ];

  it("before M112: three sources on a dead host hold the cycle past the stall guard", () => {
    expect(syncCycle(sources, new Set(), false).elapsedMs).toBeGreaterThan(DEFAULT_LOOP_STALL_TIMEOUT_MS);
  });

  it("bounds the waiting at half the stall budget and defers the rest", () => {
    const first = syncCycle(sources, new Set(), true);
    expect(first.elapsedMs).toBeLessThanOrEqual(getCycleAwaitCeilingMs({}));
    expect(first.elapsedMs).toBeLessThan(DEFAULT_LOOP_STALL_TIMEOUT_MS);
    // 120 s for the first dead host, the last 30 s for the second, nothing left for the others.
    expect(first.synced).toEqual(["dead_1", "dead_2"]);
    expect(first.deferred).toEqual(["dead_3", "healthy"]);
    // The deferred go first next cycle, so the healthy source behind the dead host is synced.
    const second = syncCycle(sources, new Set(first.deferred), true);
    expect(second.synced.slice(0, 2)).toEqual(["dead_3", "healthy"]);
    expect(second.elapsedMs).toBeLessThanOrEqual(getCycleAwaitCeilingMs({}));
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
    expect(flatWorker).toContain("const probeTimeoutMs = workerRemoteCallBudget.timeoutFor(config.probeTimeoutMs);");
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
  });
});
