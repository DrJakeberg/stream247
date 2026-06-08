import { describe, expect, it } from "vitest";
import { planQueuePrefetch, type QueuePrefetchCandidate } from "../../apps/worker/src/queue-prefetch";

const remote = (cacheStatus: QueuePrefetchCandidate["cacheStatus"]): QueuePrefetchCandidate => ({
  cacheStatus,
  expensive: true
});
const local = (cacheStatus: QueuePrefetchCandidate["cacheStatus"]): QueuePrefetchCandidate => ({
  cacheStatus,
  expensive: false
});

describe("planQueuePrefetch", () => {
  // Regression for the recurring playout-mode worker.loop.stalled: a cascade of uncached remote
  // queue assets used to trigger 3-4 sequential ~60-120s resolves inside one stall-guarded cycle,
  // exceeding LOOP_STALL_TIMEOUT_MS (300s) and force-restarting the playout container.
  it("resolves at most one expensive (remote) candidate when 3+ are uncached", () => {
    const plan = planQueuePrefetch([remote("none"), remote("none"), remote("none"), remote("none")]);

    expect(plan).toEqual(["resolve", "defer", "defer", "defer"]);
    expect(plan.filter((a) => a === "resolve")).toHaveLength(1);
  });

  it("does not cap cached/local candidates — only expensive uncached ones consume the budget", () => {
    const plan = planQueuePrefetch([
      remote("ready"), // use-cache, free
      local("none"), // cheap resolve, free
      remote("none"), // expensive resolve, consumes budget
      remote("none"), // expensive, deferred
      local("none") // cheap resolve, still allowed after the cap
    ]);

    expect(plan).toEqual(["use-cache", "resolve", "resolve", "defer", "resolve"]);
  });

  it("after one slow remote candidate is resolved, the next slow remote candidate is deferred (not attempted) this cycle", () => {
    const plan = planQueuePrefetch([remote("none"), remote("none")]);

    expect(plan[0]).toBe("resolve");
    expect(plan[1]).toBe("defer");
  });

  it("still selects a ready cached candidate for scheduled playback without resolving", () => {
    const plan = planQueuePrefetch([remote("ready"), remote("none")]);

    expect(plan[0]).toBe("use-cache");
    // The single uncached remote candidate may still warm this cycle.
    expect(plan[1]).toBe("resolve");
  });

  it("skips failed cached candidates without consuming the resolve budget", () => {
    const plan = planQueuePrefetch([remote("failed"), remote("none"), remote("none")]);

    expect(plan).toEqual(["skip-failed", "resolve", "defer"]);
  });

  it("does not change behavior for an all-local (e.g. global_fallback) queue — every candidate resolves", () => {
    const plan = planQueuePrefetch([local("none"), local("none"), local("none")]);

    expect(plan).toEqual(["resolve", "resolve", "resolve"]);
  });

  it("honors a higher expensive budget when configured", () => {
    const plan = planQueuePrefetch([remote("none"), remote("none"), remote("none")], 2);

    expect(plan).toEqual(["resolve", "resolve", "defer"]);
  });

  it("defers all expensive candidates when the budget is zero, but still allows cheap resolves", () => {
    const plan = planQueuePrefetch([remote("none"), local("none"), remote("none")], 0);

    expect(plan).toEqual(["defer", "resolve", "defer"]);
  });

  it("returns an empty plan for an empty queue", () => {
    expect(planQueuePrefetch([])).toEqual([]);
  });
});
