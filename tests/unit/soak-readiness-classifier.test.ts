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
});
