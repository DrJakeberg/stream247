import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PLAYOUT_HEARTBEAT_STALE_MS,
  WORKER_HEARTBEAT_STALE_MS,
  judgeHeartbeat,
  judgePlayoutHeartbeat,
  judgeWorkerHeartbeat,
  resolveEffectivePlayoutHeartbeatAt
} from "@stream247/core";
import type { AppState } from "../../apps/web/lib/server/state";

const { readAppState, getDatabaseHealth } = vi.hoisted(() => ({
  readAppState: vi.fn(),
  getDatabaseHealth: vi.fn()
}));

vi.mock("../../apps/web/lib/server/state", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../apps/web/lib/server/state")>()),
  readAppState
}));

vi.mock("@stream247/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@stream247/db")>()),
  getDatabaseHealth
}));

vi.mock("../../apps/web/lib/server/sse", () => ({
  getActiveSseConnectionCount: () => 0
}));

import { getPlayoutHeartbeatHealth, getRuntimeDriftReport, getWorkerHealth } from "../../apps/web/lib/server/state";
import { getSystemReadiness } from "../../apps/web/lib/server/readiness";
import { decideHealthcheck } from "../../apps/worker/src/healthcheck";

// M90, audit U3/U30 (planning/research/robustness.md): the Live page judged a playout heartbeat
// stale after 45 s while readiness and the worker allowed 60 s, and the worker window of 240 s was
// declared three times. R3's probe: a 50 s old playout heartbeat read "Playout heartbeat is stale."
// on the Live page and `playout: ok` in readiness, for the same second.

const NOW = new Date("2026-10-02T03:00:00.000Z").getTime();
const ago = (ms: number) => new Date(NOW - ms).toISOString();

function playoutRow(overrides: Partial<AppState["playout"]> = {}) {
  return {
    status: "running",
    heartbeatAt: ago(50_000),
    workerHeartbeatAt: ago(50_000),
    uplinkHeartbeatAt: ago(5_000),
    uplinkStatus: "running",
    uplinkLastExitReason: "",
    programFeedStatus: "fresh",
    programFeedUpdatedAt: ago(5_000),
    crashLoopDetected: false,
    ...overrides
  } as AppState["playout"];
}

function stateWith(playout: AppState["playout"]): AppState {
  return {
    initialized: true,
    owner: { email: "owner@example.com", passwordHash: "x", createdAt: ago(86_400_000) },
    playout,
    twitch: { status: "disconnected", lastMetadataSyncAt: "", lastScheduleSyncAt: "" },
    destinations: [
      {
        id: "destination-primary",
        name: "Primary",
        role: "primary",
        priority: 0,
        enabled: true,
        streamKeyPresent: true,
        status: "ready"
      }
    ],
    assets: [{ id: "asset-1", status: "ready" }],
    scheduleBlocks: [],
    pools: [],
    sources: [],
    incidents: []
  } as unknown as AppState;
}

describe("one heartbeat verdict (core)", () => {
  it("has one window per loop", () => {
    expect(WORKER_HEARTBEAT_STALE_MS).toBe(240_000);
    expect(PLAYOUT_HEARTBEAT_STALE_MS).toBe(60_000);
  });

  it("is fresh up to the window, stale beyond it, missing without a timestamp", () => {
    expect(judgeHeartbeat(ago(60_000), NOW, 60_000).verdict).toBe("fresh");
    expect(judgeHeartbeat(ago(60_001), NOW, 60_000).verdict).toBe("stale");
    expect(judgeHeartbeat("", NOW, 60_000)).toEqual({ verdict: "missing", at: "", ageMs: Number.POSITIVE_INFINITY });
    expect(judgeHeartbeat("not a date", NOW, 60_000).verdict).toBe("missing");
    expect(judgeWorkerHeartbeat(ago(239_000), NOW).verdict).toBe("fresh");
    expect(judgeWorkerHeartbeat(ago(241_000), NOW).verdict).toBe("stale");
  });

  it("counts the program feed only in HLS mode, while playout is meant to be on air", () => {
    const playout = playoutRow({ heartbeatAt: ago(90_000), programFeedUpdatedAt: ago(4_000) });
    expect(resolveEffectivePlayoutHeartbeatAt({ programFeedMode: true, playout })).toBe(playout.programFeedUpdatedAt);
    expect(resolveEffectivePlayoutHeartbeatAt({ programFeedMode: false, playout })).toBe(playout.heartbeatAt);
    expect(
      resolveEffectivePlayoutHeartbeatAt({ programFeedMode: true, playout: { ...playout, programFeedStatus: "stale" } })
    ).toBe(playout.heartbeatAt);
    expect(resolveEffectivePlayoutHeartbeatAt({ programFeedMode: true, playout: { ...playout, status: "idle" } })).toBe(
      playout.heartbeatAt
    );
    expect(judgePlayoutHeartbeat({ programFeedMode: true, playout }, NOW).verdict).toBe("fresh");
    expect(judgePlayoutHeartbeat({ programFeedMode: false, playout }, NOW).verdict).toBe("stale");
  });
});

describe("a 50 s old heartbeat gets the same verdict on the Live page, in readiness and in the worker", () => {
  const savedEnv = { relay: process.env.STREAM247_RELAY_ENABLED, input: process.env.STREAM247_UPLINK_INPUT_MODE };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    getDatabaseHealth.mockResolvedValue("ok");
  });

  afterEach(() => {
    vi.useRealTimers();
    process.env.STREAM247_RELAY_ENABLED = savedEnv.relay;
    process.env.STREAM247_UPLINK_INPUT_MODE = savedEnv.input;
    if (savedEnv.relay === undefined) delete process.env.STREAM247_RELAY_ENABLED;
    if (savedEnv.input === undefined) delete process.env.STREAM247_UPLINK_INPUT_MODE;
  });

  for (const mode of ["direct", "relay-hls"] as const) {
    it(`fresh everywhere at 50 s (${mode})`, async () => {
      if (mode === "direct") {
        delete process.env.STREAM247_RELAY_ENABLED;
      } else {
        process.env.STREAM247_RELAY_ENABLED = "1";
        process.env.STREAM247_UPLINK_INPUT_MODE = "hls";
      }
      const state = stateWith(playoutRow());
      readAppState.mockResolvedValue(state);

      expect(getPlayoutHeartbeatHealth(state, NOW).verdict).toBe("fresh");
      expect(getWorkerHealth(state, NOW).status).toBe("healthy");
      const readiness = await getSystemReadiness();
      expect(readiness.services.playout).toBe("ok");
      expect(readiness.services.worker).toBe("ok");
      expect(decideHealthcheck("playout", state.playout, NOW, process.env)).toBeNull();
      expect(decideHealthcheck("worker", state.playout, NOW, process.env)).toBeNull();
    });
  }

  it("stale everywhere at 70 s (direct)", async () => {
    delete process.env.STREAM247_RELAY_ENABLED;
    const state = stateWith(playoutRow({ heartbeatAt: ago(70_000), workerHeartbeatAt: ago(250_000) }));
    readAppState.mockResolvedValue(state);

    expect(getPlayoutHeartbeatHealth(state, NOW).verdict).toBe("stale");
    expect(getWorkerHealth(state, NOW).status).toBe("stale");
    const readiness = await getSystemReadiness();
    expect(readiness.services.playout).toBe("not-ready");
    expect(readiness.services.worker).toBe("degraded");
    expect(decideHealthcheck("playout", state.playout, NOW, process.env)).toBe("Playout heartbeat is stale.");
    expect(decideHealthcheck("worker", state.playout, NOW, process.env)).toBe("Worker heartbeat is stale.");
  });
});

describe("no page declares its own heartbeat window any more", () => {
  const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");

  it("state, readiness and the worker carry no threshold of their own", () => {
    for (const file of ["apps/web/lib/server/state.ts", "apps/web/lib/server/readiness.ts", "apps/worker/src/index.ts", "apps/worker/src/healthcheck.ts"]) {
      const source = read(file);
      expect(source, file).not.toMatch(/const \w*HEARTBEAT\w*_MS = /);
      expect(source, file).not.toMatch(/HeartbeatAgeMs > \d/);
    }
  });

  it("the Live page's drift report judges playout through the shared function", () => {
    const state = read("apps/web/lib/server/state.ts");
    const drift = state.slice(state.indexOf("export function getRuntimeDriftReport("));
    expect(drift.slice(0, 600)).toContain("getPlayoutHeartbeatHealth(state)");
    expect(read("apps/worker/src/index.ts")).toContain("decideHealthcheck(mode, state.playout, Date.now(), process.env)");
  });

  it("the drift report agrees at 50 s", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    try {
      delete process.env.STREAM247_RELAY_ENABLED;
      const report = getRuntimeDriftReport(stateWith(playoutRow()));
      const playout = report.items.find((item) => item.id === "playout-heartbeat");
      expect(playout?.summary).toBe("Playout heartbeat is in sync.");
      expect(playout?.severity).toBe("ok");
    } finally {
      vi.useRealTimers();
    }
  });
});
