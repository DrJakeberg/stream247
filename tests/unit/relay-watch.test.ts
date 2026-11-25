import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  RELAY_UNREACHABLE_AFTER_MS,
  RelayWatch,
  isRelayApiReachable,
  relayInUse
} from "../../apps/worker/src/relay-watch";
import { getUplinkInputMode, isRelayModeEnabled } from "../../apps/worker/src/ffmpeg-runtime";
import { isProgramFeedHeartbeatMode } from "../../packages/core/src/heartbeat";
import { findIncidentOperatorAction } from "../../packages/core/src/incident-actions";
import { classifyIncidentFingerprint } from "../../apps/worker/src/incident-classes";

const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");

describe("the relay is watched from outside (M114, owner's choice)", () => {
  it("raises after two minutes without an answer, once", () => {
    const watch = new RelayWatch();
    const actions = [];
    for (let nowMs = 0; nowMs <= 4 * 60_000; nowMs += 30_000) {
      actions.push({ nowMs, ...watch.observe(false, nowMs) });
    }
    const raised = actions.filter((entry) => entry.action === "raise");
    expect(RELAY_UNREACHABLE_AFTER_MS).toBe(120_000);
    expect(raised).toEqual([{ nowMs: 120_000, action: "raise", unreachableForMs: 120_000 }]);
  });

  it("never raises while answers come in between", () => {
    const watch = new RelayWatch();
    for (let nowMs = 0; nowMs <= 10 * 60_000; nowMs += 30_000) {
      const reachable = nowMs % 90_000 === 0;
      expect(watch.observe(reachable, nowMs).action).not.toBe("raise");
    }
  });

  it("closes on the first answer, also for an incident an earlier process left open", () => {
    const watch = new RelayWatch();
    watch.observe(false, 0);
    watch.observe(false, RELAY_UNREACHABLE_AFTER_MS);
    expect(watch.observe(true, RELAY_UNREACHABLE_AFTER_MS + 30_000)).toEqual({ action: "resolve" });
    expect(watch.observe(true, RELAY_UNREACHABLE_AFTER_MS + 60_000)).toEqual({ action: "none" });

    const rearmed = new RelayWatch(true);
    expect(rearmed.observe(true, 0)).toEqual({ action: "resolve" });
  });

  it("closes and forgets the streak when nothing uses the relay", () => {
    const watch = new RelayWatch();
    watch.observe(false, 0);
    watch.observe(false, RELAY_UNREACHABLE_AFTER_MS);
    expect(watch.idle()).toEqual({ action: "resolve" });
    expect(watch.observe(false, RELAY_UNREACHABLE_AFTER_MS + 1).action).toBe("none");
    const inUse = (relayModeEnabled: boolean, sourceLiveEnabled: boolean) =>
      relayInUse({ relayModeEnabled, uplinkInputMode: "rtmp", sourceLiveEnabled });
    expect(inUse(false, false)).toBe(false);
    expect(inUse(true, false)).toBe(true);
    expect(inUse(false, true)).toBe(true);
  });

  it("counts any HTTP answer as alive, and a refused or hung request as not", async () => {
    const answering = (async () => new Response("{}", { status: 500 })) as typeof fetch;
    const refusing = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    const hanging = ((_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      })) as typeof fetch;
    expect(await isRelayApiReachable({ fetchImpl: answering })).toBe(true);
    expect(await isRelayApiReachable({ fetchImpl: refusing })).toBe(false);
    expect(await isRelayApiReachable({ fetchImpl: hanging, timeoutMs: 50 })).toBe(false);
  });

  it("is a state incident with an operator action", () => {
    expect(classifyIncidentFingerprint("relay.unreachable")?.kind).toBe("state");
    expect(findIncidentOperatorAction("relay.unreachable")?.action).toContain("docker compose restart relay");
  });

  it("runs as a worker cycle step, and the relay keeps its pin and gets no healthcheck", () => {
    expect(read("apps/worker/src/index.ts")).toContain('{ name: "relay", run: observeRelay }');
    const compose = read("docker-compose.yml");
    const relay = compose.slice(compose.indexOf("  relay:"), compose.indexOf("  playout:"));
    expect(relay).toContain("bluenviron/mediamtx:1.15.4");
    expect(relay).not.toMatch(/^\s+healthcheck:/m);
  });
});

describe("the relay watch counts relay mode as use only when the uplink reads from the relay (M126)", () => {
  const programFeed = { STREAM247_RELAY_ENABLED: "1", STREAM247_UPLINK_INPUT_MODE: "hls" };
  const relayInput = { STREAM247_RELAY_ENABLED: "1", STREAM247_UPLINK_INPUT_MODE: "rtmp" };

  // What observeRelay hands in, read from the environment as the worker reads it at start.
  const inUseFor = (env: NodeJS.ProcessEnv, sourceLiveEnabled = false) =>
    relayInUse({
      relayModeEnabled: isRelayModeEnabled(env),
      uplinkInputMode: getUplinkInputMode(env),
      sourceLiveEnabled
    });

  // Worker cycles through the watch's own `cycle`, as observeRelay runs them, on a relay that never answers.
  async function runCycles(env: NodeJS.ProcessEnv, sourceLiveEnabled: boolean, watch: RelayWatch) {
    let probes = 0;
    const silentRelay = async () => {
      probes += 1;
      return false;
    };
    const actions = [];
    for (let nowMs = 0; nowMs <= 4 * 60_000; nowMs += 30_000) {
      const action = await watch.cycle(inUseFor(env, sourceLiveEnabled), silentRelay, () => nowMs);
      actions.push({ nowMs, ...action });
    }
    return { probes, actions };
  }

  it("treats an unset or any non-rtmp uplink input as hls, and live sources as use in every mode", () => {
    const cases: Array<[NodeJS.ProcessEnv, boolean]> = [
      [{ STREAM247_RELAY_ENABLED: "1" }, false],
      [programFeed, false],
      [{ STREAM247_RELAY_ENABLED: "1", STREAM247_UPLINK_INPUT_MODE: "" }, false],
      [{ STREAM247_RELAY_ENABLED: "1", STREAM247_UPLINK_INPUT_MODE: "RTMP" }, false],
      [{ STREAM247_RELAY_ENABLED: "1", STREAM247_UPLINK_INPUT_MODE: "srt" }, false],
      [relayInput, true],
      [{ STREAM247_UPLINK_INPUT_MODE: "rtmp" }, false],
      [{}, false]
    ];
    for (const [env, inUse] of cases) {
      const label = JSON.stringify(env);
      expect(inUseFor(env), label).toBe(inUse);
      // The same split as the heartbeat's program-feed mode in packages/core.
      expect(inUseFor(env), label).toBe(isRelayModeEnabled(env) && !isProgramFeedHeartbeatMode(env));
      expect(inUseFor(env, true), label).toBe(true);
    }
  });

  it("in program-feed mode with live sources off neither asks the relay nor raises", async () => {
    const { probes, actions } = await runCycles(programFeed, false, new RelayWatch());
    expect(probes).toBe(0);
    expect(actions.every((entry) => entry.action === "none")).toBe(true);
  });

  it("closes a relay.unreachable an earlier process left open through the idle path", async () => {
    const { probes, actions } = await runCycles(programFeed, false, new RelayWatch(true));
    expect(probes).toBe(0);
    expect(actions[0]).toEqual({ nowMs: 0, action: "resolve" });
    expect(actions.slice(1).every((entry) => entry.action === "none")).toBe(true);
  });

  it("with rtmp input, or with live sources on, raises after two minutes as before", async () => {
    for (const [env, sourceLiveEnabled] of [
      [relayInput, false],
      [programFeed, true]
    ] as const) {
      const { probes, actions } = await runCycles(env, sourceLiveEnabled, new RelayWatch());
      expect(probes).toBe(actions.length);
      expect(actions.filter((entry) => entry.action === "raise")).toEqual([
        { nowMs: 120_000, action: "raise", unreachableForMs: 120_000 }
      ]);
    }
  });

  it("observeRelay hands the normalised uplink input mode in and closes an unused relay's incident", () => {
    const source = read("apps/worker/src/index.ts");
    expect(source).toContain("const STREAM247_UPLINK_INPUT_MODE = getUplinkInputMode(process.env);");
    const start = source.indexOf("async function observeRelay(): Promise<void> {");
    const observeRelay = source.slice(start, source.indexOf("\n}\n", start));
    expect(observeRelay).toContain("uplinkInputMode: STREAM247_UPLINK_INPUT_MODE,");
    expect(observeRelay).toContain("const action = await relayWatch.cycle(inUse, isRelayApiReachable);");
    expect(observeRelay).toContain('"Nothing uses the relay any more."');
  });
});
