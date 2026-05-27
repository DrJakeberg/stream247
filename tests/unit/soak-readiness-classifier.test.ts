import { describe, expect, it } from "vitest";
import {
  classifyReadinessSample,
  DEFAULT_RUNAWAY_THRESHOLD
} from "../../scripts/lib/soak-readiness-classifier.cjs";

const BASELINE = 261;

function healthy(overrides: Record<string, any> = {}) {
  const base = {
    status: "ok",
    broadcastReady: true,
    services: {
      web: "ok",
      worker: "ok",
      playout: "ok",
      uplink: "ok",
      programFeed: "ok",
      destination: "ok"
    },
    playout: {
      status: "running",
      selectionReasonCode: "scheduled_match",
      fallbackTier: "scheduled",
      currentAssetId: "asset_x",
      restartCount: 1,
      crashCountWindow: 0,
      crashLoopDetected: false,
      lastExitCode: 0
    },
    uplink: { status: "running", unplannedRestartCount: BASELINE },
    programFeed: { status: "fresh" },
    sseConnections: 0
  };
  return { ...base, ...overrides };
}

describe("classifyReadinessSample — soak monitor classifier", () => {
  it("healthy sample with uplink delta +1 — pass (warning only, not fatal)", () => {
    const data = healthy({
      uplink: { status: "running", unplannedRestartCount: BASELINE + 1 }
    });
    const r = classifyReadinessSample(data, { baselineUplinkRestarts: BASELINE });
    expect(r.kind).toBe("ok");
    expect(r.line).toContain("uplinkUnplannedRestartsDelta=1");
    expect(r.line).toContain("broadcastReady=true");
  });

  it("broadcastReady=false with uplink delta 0 — immediate fail", () => {
    const data = healthy({ broadcastReady: false });
    const r = classifyReadinessSample(data, { baselineUplinkRestarts: BASELINE });
    expect(r.kind).toBe("fail");
    expect(r.reasons).toContain("broadcastReady=false");
  });

  it("programFeed=stale — immediate fail", () => {
    const data = healthy({
      programFeed: { status: "stale" },
      services: { web: "ok", worker: "ok", playout: "ok", uplink: "ok", programFeed: "degraded", destination: "ok" }
    });
    const r = classifyReadinessSample(data, { baselineUplinkRestarts: BASELINE });
    expect(r.kind).toBe("fail");
    expect(r.reasons.some((s: string) => s.includes("programFeed=stale"))).toBe(true);
  });

  it("uplink delta > runaway threshold — immediate fail even with bReady=true and feed=fresh", () => {
    const data = healthy({
      uplink: { status: "running", unplannedRestartCount: BASELINE + DEFAULT_RUNAWAY_THRESHOLD + 1 }
    });
    const r = classifyReadinessSample(data, { baselineUplinkRestarts: BASELINE });
    expect(r.kind).toBe("fail");
    expect(r.reasons.some((s: string) => s.startsWith("uplinkUnplannedRestarts="))).toBe(true);
  });

  it("uplink delta +1 + broadcastReady=false — immediate fail (user impact)", () => {
    const data = healthy({
      broadcastReady: false,
      uplink: { status: "running", unplannedRestartCount: BASELINE + 1 }
    });
    const r = classifyReadinessSample(data, { baselineUplinkRestarts: BASELINE });
    expect(r.kind).toBe("fail");
    expect(r.reasons).toContain("broadcastReady=false");
    expect(r.reasons.some((s: string) => s.startsWith("uplinkUnplannedRestarts="))).toBe(true);
  });

  it("single destination=error sample — transient (caller tracks consecutive count)", () => {
    const data = healthy({
      services: { web: "ok", worker: "ok", playout: "ok", uplink: "ok", programFeed: "ok", destination: "error" }
    });
    const r = classifyReadinessSample(data, { baselineUplinkRestarts: BASELINE });
    expect(r.kind).toBe("transient");
    expect(r.transientKinds).toContain("destination");
  });

  it("single uplink=not-ready sample — transient", () => {
    const data = healthy({
      services: { web: "ok", worker: "ok", playout: "ok", uplink: "not-ready", programFeed: "ok", destination: "ok" }
    });
    const r = classifyReadinessSample(data, { baselineUplinkRestarts: BASELINE });
    expect(r.kind).toBe("transient");
    expect(r.transientKinds).toContain("uplink");
  });

  it("uplink=not-ready + uplink delta +1 still transient when bReady=true and feed=fresh", () => {
    const data = healthy({
      services: { web: "ok", worker: "ok", playout: "ok", uplink: "not-ready", programFeed: "ok", destination: "ok" },
      uplink: { status: "running", unplannedRestartCount: BASELINE + 1 }
    });
    const r = classifyReadinessSample(data, { baselineUplinkRestarts: BASELINE });
    expect(r.kind).toBe("transient");
    expect(r.transientKinds).toContain("uplink");
  });

  it("playout=not-ready (not transient by heuristic) — immediate fail", () => {
    const data = healthy({
      services: { web: "ok", worker: "ok", playout: "not-ready", uplink: "ok", programFeed: "ok", destination: "ok" },
      playout: {
        status: "running",
        selectionReasonCode: "scheduled_match",
        fallbackTier: "scheduled",
        currentAssetId: "asset_x",
        restartCount: 1,
        crashCountWindow: 0,
        crashLoopDetected: false,
        lastExitCode: 0
      }
    });
    const r = classifyReadinessSample(data, { baselineUplinkRestarts: BASELINE });
    expect(r.kind).toBe("fail");
    expect(r.reasons).toContain("playout=not-ready");
  });

  it("playout transient heuristic — when playout=not-ready+failed and rest is healthy, NOT a fail", () => {
    const data = healthy({
      broadcastReady: false,
      services: { web: "ok", worker: "ok", playout: "not-ready", uplink: "ok", programFeed: "ok", destination: "ok" },
      playout: {
        status: "failed",
        crashLoopDetected: false,
        selectionReasonCode: "scheduled_match",
        fallbackTier: "scheduled",
        currentAssetId: "asset_x",
        restartCount: 1,
        crashCountWindow: 0,
        lastExitCode: 0
      }
    });
    const r = classifyReadinessSample(data, { baselineUplinkRestarts: BASELINE });
    // playoutTransient is true (failed + rest healthy), so neither broadcastReady=false nor playout=not-ready becomes fatal.
    // No transient kinds either.
    expect(r.kind).toBe("ok");
  });

  it("worker=not-ready — immediate fail", () => {
    const data = healthy({
      services: { web: "ok", worker: "not-ready", playout: "ok", uplink: "ok", programFeed: "ok", destination: "ok" }
    });
    const r = classifyReadinessSample(data, { baselineUplinkRestarts: BASELINE });
    expect(r.kind).toBe("fail");
    expect(r.reasons).toContain("worker=not-ready");
  });

  it("playout.crashLoopDetected — immediate fail", () => {
    const data = healthy({
      playout: {
        status: "running",
        crashLoopDetected: true,
        selectionReasonCode: "scheduled_match",
        fallbackTier: "scheduled",
        currentAssetId: "asset_x",
        restartCount: 1,
        crashCountWindow: 0,
        lastExitCode: 0
      }
    });
    const r = classifyReadinessSample(data, { baselineUplinkRestarts: BASELINE });
    expect(r.kind).toBe("fail");
    expect(r.reasons).toContain("playout.crashLoopDetected=true");
  });

  it("runaway threshold configurable", () => {
    const data = healthy({
      uplink: { status: "running", unplannedRestartCount: BASELINE + 5 }
    });
    const lenient = classifyReadinessSample(data, { baselineUplinkRestarts: BASELINE, runawayThreshold: 100 });
    expect(lenient.kind).toBe("ok");
    const strict = classifyReadinessSample(data, { baselineUplinkRestarts: BASELINE, runawayThreshold: 3 });
    expect(strict.kind).toBe("fail");
  });

  it("reproduces the CLEAN2 false-positive shape and now passes", () => {
    // Exact CLEAN2 trip sample: uplink ticked 261 -> 262 with everything else healthy.
    const data = healthy({
      uplink: { status: "running", unplannedRestartCount: 262 }
    });
    const r = classifyReadinessSample(data, { baselineUplinkRestarts: 261 });
    expect(r.kind).toBe("ok");
    expect(r.line).toContain("uplinkUnplannedRestartsDelta=1");
  });

  // --- CLEAN3 grace: tolerate one consecutive programFeed=stale during an
  // active playoutTransient recovery (i.e. playout in-process ffmpeg child crashed
  // and is being restarted by the supervisor).

  function playoutFailedSample(opts: { feedStatus: "fresh" | "stale"; uplinkUnplanned?: number; broadcastReady?: boolean } = { feedStatus: "fresh" }) {
    return healthy({
      status: "degraded",
      broadcastReady: opts.broadcastReady ?? false,
      services: {
        web: "ok",
        worker: "ok",
        playout: "not-ready",
        uplink: "ok",
        programFeed: opts.feedStatus === "fresh" ? "ok" : "degraded",
        destination: "ok"
      },
      playout: {
        status: "failed",
        selectionReasonCode: "scheduled_match",
        fallbackTier: "scheduled",
        currentAssetId: "asset_source_e2au8vv3_v2779611194",
        restartCount: 5672,
        crashCountWindow: 0,
        crashLoopDetected: false,
        lastExitCode: "SIGBUS"
      },
      uplink: { status: "running", unplannedRestartCount: opts.uplinkUnplanned ?? BASELINE },
      programFeed: { status: opts.feedStatus }
    });
  }

  it("CLEAN3 03:36 shape: playout failed + feed=fresh → tolerated as playoutTransient (kind=ok, no fail)", () => {
    const data = playoutFailedSample({ feedStatus: "fresh" });
    const r = classifyReadinessSample(data, { baselineUplinkRestarts: BASELINE });
    expect(r.kind).toBe("ok");
    expect(r.line).toContain("playoutTransient=true");
  });

  it("CLEAN3 03:37 shape: playout failed + feed=stale + uplink +1 → transient (playoutTransientStaleFeed), not fail", () => {
    const data = playoutFailedSample({ feedStatus: "stale", uplinkUnplanned: BASELINE + 1 });
    const r = classifyReadinessSample(data, { baselineUplinkRestarts: BASELINE });
    expect(r.kind).toBe("transient");
    if (r.kind === "transient") {
      expect(r.transientKinds).toContain("playoutTransientStaleFeed");
      expect(r.reasons).toContain("playoutTransientStaleFeed=true");
    }
    // line goes to stderr in real run; the test infra inspects this for the consecutive counter
    expect(r.line).toContain("playoutTransientStaleFeed=true");
    expect(r.line).toContain("uplinkUnplannedRestartsDelta=1");
  });

  it("playoutTransientStaleFeed: the classifier always emits transient — consecutive escalation is the caller's job (shell-level)", () => {
    // Classifier-level invariant: every sample matching the candidate pattern with stale
    // feed returns kind=transient. The shell consecutive counter is exercised in
    // tests/unit/release-readiness.test.ts and against the real soak-monitor.sh.
    const r1 = classifyReadinessSample(playoutFailedSample({ feedStatus: "stale" }), { baselineUplinkRestarts: BASELINE });
    const r2 = classifyReadinessSample(playoutFailedSample({ feedStatus: "stale" }), { baselineUplinkRestarts: BASELINE });
    expect(r1.kind).toBe("transient");
    expect(r2.kind).toBe("transient");
  });

  it("regression: programFeed=stale WITHOUT an active playout transient is still immediate fail", () => {
    const data = healthy({
      broadcastReady: false,
      services: {
        web: "ok",
        worker: "ok",
        playout: "ok",
        uplink: "ok",
        programFeed: "degraded",
        destination: "ok"
      },
      playout: {
        status: "running",
        crashLoopDetected: false,
        selectionReasonCode: "scheduled_match",
        fallbackTier: "scheduled",
        currentAssetId: "asset_x",
        restartCount: 1,
        crashCountWindow: 0,
        lastExitCode: 0
      },
      programFeed: { status: "stale" }
    });
    const r = classifyReadinessSample(data, { baselineUplinkRestarts: BASELINE });
    expect(r.kind).toBe("fail");
    expect(r.reasons.some((s: string) => s.startsWith("programFeed="))).toBe(true);
  });

  it("regression: broadcastReady=false WITHOUT any playout transient is still immediate fail", () => {
    const data = healthy({ broadcastReady: false });
    const r = classifyReadinessSample(data, { baselineUplinkRestarts: BASELINE });
    expect(r.kind).toBe("fail");
    expect(r.reasons).toContain("broadcastReady=false");
  });

  it("playout=failed during recovery with feed=stale BUT uplink also unhealthy → not a candidate → fails immediately", () => {
    // If the surrounding services are NOT healthy (uplink failed), the candidate pattern is
    // broken and we must not tolerate the stale feed.
    const data = playoutFailedSample({ feedStatus: "stale" });
    (data as any).services.uplink = "not-ready";
    (data as any).uplink.status = "failed";
    const r = classifyReadinessSample(data, { baselineUplinkRestarts: BASELINE });
    expect(r.kind).toBe("fail");
  });

  it("playout=failed during recovery with feed=stale AND playout.crashLoopDetected=true → fail (not a candidate)", () => {
    const data = playoutFailedSample({ feedStatus: "stale" });
    (data as any).playout.crashLoopDetected = true;
    const r = classifyReadinessSample(data, { baselineUplinkRestarts: BASELINE });
    expect(r.kind).toBe("fail");
    expect(r.reasons).toContain("playout.crashLoopDetected=true");
  });
});
