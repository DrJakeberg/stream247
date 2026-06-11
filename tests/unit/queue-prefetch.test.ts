import { describe, expect, it } from "vitest";
import {
  decideQueuePrefetchBudget,
  planQueuePrefetch,
  raceResolveAgainstDeath,
  type QueuePrefetchCandidate
} from "../../apps/worker/src/queue-prefetch";

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

describe("coverage-gated prefetch budget (v1.5.16 soak failure: post-boundary start delay)", () => {
  // Regression: after a clean naturalBoundary exit (scheduled_match had run for hours), no playout
  // process was running and the cycle's awaited expensive queue resolve sat between the boundary
  // and startOrSwitchPlayout for ~94s while the ~60s feed buffer drained. While coverage is down
  // the budget must be 0: the already-resolved selected asset (or the bridge fallback) starts
  // before any expensive prefetch is awaited.
  it("returns budget 0 while broadcast coverage is down", () => {
    expect(decideQueuePrefetchBudget({ coverageDown: true, defaultBudget: 1 })).toBe(0);
  });

  it("restores the normal v1.5.13 cap once coverage is live again", () => {
    expect(decideQueuePrefetchBudget({ coverageDown: false, defaultBudget: 1 })).toBe(1);
  });

  it("coverage-down cycle: ready selected asset is used from cache and every cold expensive candidate defers (start before prefetch)", () => {
    // The exact failure-shape queue: the selected next asset has a fresh probe hit; the rest of
    // the queue contains cold expensive remote candidates that previously blocked the start.
    const budget = decideQueuePrefetchBudget({ coverageDown: true, defaultBudget: 1 });
    const plan = planQueuePrefetch(
      [
        { cacheStatus: "ready", expensive: true }, // selected next asset — probe-cache hit
        { cacheStatus: "none", expensive: true }, // cold Twitch VOD
        { cacheStatus: "none", expensive: true } // cold Twitch VOD
      ],
      budget
    );

    expect(plan).toEqual(["use-cache", "defer", "defer"]);
  });

  it("coverage-down cycle: cheap local fallback still resolves instantly (fallback start is never blocked)", () => {
    const budget = decideQueuePrefetchBudget({ coverageDown: true, defaultBudget: 1 });
    const plan = planQueuePrefetch(
      [
        { cacheStatus: "none", expensive: false }, // local fallback — instant resolve allowed
        { cacheStatus: "none", expensive: true } // cold remote — deferred
      ],
      budget
    );

    expect(plan).toEqual(["resolve", "defer"]);
  });
});

describe("raceResolveAgainstDeath (in-flight resolve unblocks on playout process death)", () => {
  // Regression for the confirmed v1.5.16 failure mechanism: the boundary landed while an expensive
  // prefetch resolve was already in flight (no playout.loop.wake was logged — the loop was busy),
  // and the cycle could not start the next asset until the resolve finished ~94s later. The cycle
  // must stop waiting the moment the covering process dies; the resolve continues in the
  // background and writes the probe cache itself.
  it("abandons the wait when the process dies before the resolve completes", async () => {
    let finishResolve: (value: string) => void = () => {};
    const resolve = new Promise<string>((res) => {
      finishResolve = res;
    });
    let die: () => void = () => {};
    const death = new Promise<void>((res) => {
      die = res;
    });

    const outcomePromise = raceResolveAgainstDeath(resolve, death);
    die();
    const outcome = await outcomePromise;

    expect(outcome).toEqual({ kind: "abandoned" });
    finishResolve("late"); // background completion — must not throw or affect the outcome
  });

  it("returns the resolved value when the resolve finishes while the process is alive", async () => {
    const death = new Promise<void>(() => {}); // never dies
    const outcome = await raceResolveAgainstDeath(Promise.resolve("input-url"), death);

    expect(outcome).toEqual({ kind: "resolved", value: "input-url" });
  });

  it("returns the failure when the resolve rejects while the process is alive", async () => {
    const death = new Promise<void>(() => {});
    const error = new Error("yt-dlp failed");
    const outcome = await raceResolveAgainstDeath(Promise.reject(error), death);

    expect(outcome).toEqual({ kind: "failed", error });
  });

  it("awaits normally when there is no death signal to race against", async () => {
    const outcome = await raceResolveAgainstDeath(Promise.resolve(42), null);

    expect(outcome).toEqual({ kind: "resolved", value: 42 });
  });
});
