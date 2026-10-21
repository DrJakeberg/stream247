import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  RELAY_UNREACHABLE_AFTER_MS,
  RelayWatch,
  isRelayApiReachable,
  relayInUse
} from "../../apps/worker/src/relay-watch";
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
    expect(relayInUse({ relayModeEnabled: false, sourceLiveEnabled: false })).toBe(false);
    expect(relayInUse({ relayModeEnabled: true, sourceLiveEnabled: false })).toBe(true);
    expect(relayInUse({ relayModeEnabled: false, sourceLiveEnabled: true })).toBe(true);
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
