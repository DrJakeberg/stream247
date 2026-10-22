import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  RELAY_RESTART_AFTER_MS,
  RELAY_RESTART_BACKOFF_MS,
  RELAY_RESTART_QUIET_RESET_MS,
  RelayRestartPolicy,
  findRelayContainer,
  runRelayWatchdogRound,
  type DockerRequest
} from "../../apps/worker/src/relay-restart";
import { RELAY_UNREACHABLE_AFTER_MS } from "../../apps/worker/src/relay-watch";

const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");
const MIN = 60_000;

function fakeDocker(state = "running", project = "stream247") {
  const calls: string[] = [];
  const docker: DockerRequest = async (method, url) => {
    calls.push(`${method} ${url}`);
    if (url.startsWith("/containers/self/json")) {
      return { status: 200, body: JSON.stringify({ Config: { Labels: { "com.docker.compose.project": project } } }) };
    }
    if (url.startsWith("/containers/json")) {
      return { status: 200, body: JSON.stringify(state === "missing" ? [] : [{ Id: "relay-id", State: state }]) };
    }
    if (method === "POST" && url === "/containers/relay-id/restart?t=10") {
      return { status: 204, body: "" };
    }
    return { status: 404, body: "" };
  };
  return { docker, calls };
}

describe("the relay restarts when it stops answering (M114 follow-up)", () => {
  it("waits three minutes, after the worker's two-minute incident", () => {
    expect(RELAY_RESTART_AFTER_MS).toBe(180_000);
    expect(RELAY_RESTART_AFTER_MS).toBeGreaterThan(RELAY_UNREACHABLE_AFTER_MS);
    const policy = new RelayRestartPolicy();
    policy.observe({ reachable: true, container: "running" }, -30_000);
    const decisions = [];
    for (let nowMs = 0; nowMs <= 4 * MIN; nowMs += 30_000) {
      decisions.push({ nowMs, ...policy.observe({ reachable: false, container: "running" }, nowMs) });
    }
    expect(decisions.filter((d) => d.action === "restart")).toEqual([
      { nowMs: 3 * MIN, action: "restart", unreachableForMs: 3 * MIN, attempt: 1 }
    ]);
  });

  it("never restarts while answers come in between", () => {
    const policy = new RelayRestartPolicy();
    for (let nowMs = 0; nowMs <= 60 * MIN; nowMs += 30_000) {
      expect(policy.observe({ reachable: nowMs % (2 * MIN) === 0, container: "running" }, nowMs).action).toBe("none");
    }
  });

  it("backs off 5, 10, 20, 40, then 60 min between restarts of a relay that answers briefly and hangs again", () => {
    const policy = new RelayRestartPolicy();
    const restarts: number[] = [];
    let answerAt = 0;
    for (let nowMs = 0; nowMs <= 6 * 60 * MIN; nowMs += 30_000) {
      // One answer after each restart (and at the start), then silence.
      const reachable = nowMs === answerAt;
      if (policy.observe({ reachable, container: "running" }, nowMs).action === "restart") {
        restarts.push(nowMs);
        answerAt = nowMs + 30_000;
      }
    }
    const gaps = restarts.slice(1).map((at, i) => at - (restarts[i] as number));
    expect(RELAY_RESTART_BACKOFF_MS).toEqual([5 * MIN, 10 * MIN, 20 * MIN, 40 * MIN, 60 * MIN]);
    expect(gaps.slice(0, 5)).toEqual([5 * MIN, 10 * MIN, 20 * MIN, 40 * MIN, 60 * MIN]);
    expect(new Set(gaps.slice(4))).toEqual(new Set([60 * MIN]));
  });

  it("starts the backoff again after 30 min of answers", () => {
    const policy = new RelayRestartPolicy();
    let nowMs = 0;
    policy.observe({ reachable: true, container: "running" }, -30_000);
    const dead = () => {
      for (let i = 0; i <= 6; i += 1, nowMs += 30_000) {
        const decision = policy.observe({ reachable: false, container: "running" }, nowMs);
        if (decision.action === "restart") {
          return decision.attempt;
        }
      }
      return 0;
    };
    expect(dead()).toBe(1);
    policy.observe({ reachable: true, container: "running" }, nowMs);
    nowMs += 10 * MIN;
    policy.observe({ reachable: true, container: "running" }, nowMs);
    nowMs += 10 * MIN;
    policy.observe({ reachable: true, container: "running" }, nowMs);
    expect(dead()).toBe(2);
    policy.observe({ reachable: true, container: "running" }, nowMs);
    nowMs += RELAY_RESTART_QUIET_RESET_MS;
    policy.observe({ reachable: true, container: "running" }, nowMs);
    expect(dead()).toBe(1);
  });

  it("never restarts a relay that has not answered since the start or since its last restart", () => {
    const policy = new RelayRestartPolicy();
    const actions = new Set<string>();
    for (let nowMs = 0; nowMs <= 3 * 60 * MIN; nowMs += 30_000) {
      actions.add(policy.observe({ reachable: false, container: "running" }, nowMs).action);
    }
    expect(actions).toEqual(new Set(["none", "never-answered"]));

    const restarted = new RelayRestartPolicy();
    restarted.observe({ reachable: true, container: "running" }, 0);
    let restarts = 0;
    for (let nowMs = 30_000; nowMs <= 3 * 60 * MIN; nowMs += 30_000) {
      if (restarted.observe({ reachable: false, container: "running" }, nowMs).action === "restart") {
        restarts += 1;
      }
    }
    expect(restarts).toBe(1);
  });

  it("does not count answers from before a stop towards the quiet reset", () => {
    const policy = new RelayRestartPolicy();
    let nowMs = 0;
    const hangUntilRestart = () => {
      for (let i = 0; i <= 8; i += 1, nowMs += 30_000) {
        const decision = policy.observe({ reachable: false, container: "running" }, nowMs);
        if (decision.action === "restart") {
          return decision.attempt;
        }
      }
      return 0;
    };
    policy.observe({ reachable: true, container: "running" }, nowMs);
    expect(hangUntilRestart()).toBe(1);
    policy.observe({ reachable: true, container: "running" }, (nowMs += 30_000));
    policy.observe({ reachable: false, container: "stopped" }, (nowMs += 30_000));
    nowMs += RELAY_RESTART_QUIET_RESET_MS + MIN;
    policy.observe({ reachable: true, container: "running" }, nowMs);
    nowMs += 30_000;
    expect(hangUntilRestart()).toBe(2);
  });

  it("leaves a stopped, paused or missing relay alone", () => {
    for (const container of ["stopped", "paused", "missing"] as const) {
      const policy = new RelayRestartPolicy();
      for (let nowMs = 0; nowMs <= 30 * MIN; nowMs += 30_000) {
        expect(policy.observe({ reachable: false, container }, nowMs).action).toBe("none");
      }
    }
  });

  it("finds the relay of its own Compose project and restarts only that container", async () => {
    const { docker, calls } = fakeDocker();
    expect(await findRelayContainer(docker, "self")).toEqual({ id: "relay-id", state: "running" });
    const listCall = calls.find((call) => call.startsWith("GET /containers/json")) ?? "";
    expect(decodeURIComponent(listCall)).toContain(
      '"com.docker.compose.project=stream247","com.docker.compose.service=relay","com.docker.compose.oneoff=False"'
    );

    const policy = new RelayRestartPolicy();
    await runRelayWatchdogRound({ policy, docker, selfId: "self", isReachable: async () => true, nowMs: -30_000 });
    const round = (nowMs: number) =>
      runRelayWatchdogRound({ policy, docker, selfId: "self", isReachable: async () => false, nowMs });
    await round(0);
    expect((await round(RELAY_RESTART_AFTER_MS))?.action).toBe("restart");
    expect(calls.filter((call) => call.startsWith("POST"))).toEqual(["POST /containers/relay-id/restart?t=10"]);
  });

  it("prefers the running relay container over an exited one listed first", async () => {
    const docker: DockerRequest = async (_method, url) =>
      url.startsWith("/containers/self/json")
        ? { status: 200, body: JSON.stringify({ Config: { Labels: { "com.docker.compose.project": "p" } } }) }
        : { status: 200, body: JSON.stringify([{ Id: "old", State: "exited" }, { Id: "live", State: "running" }]) };
    expect(await findRelayContainer(docker, "self")).toEqual({ id: "live", state: "running" });
  });

  it("does not ask the API of a paused relay and never restarts it", async () => {
    const { docker, calls } = fakeDocker("paused");
    const policy = new RelayRestartPolicy();
    let asked = 0;
    for (let nowMs = 0; nowMs <= 10 * MIN; nowMs += MIN) {
      await runRelayWatchdogRound({ policy, docker, selfId: "self", isReachable: async () => (asked++, false), nowMs });
    }
    expect(asked).toBe(0);
    expect(calls.filter((call) => call.startsWith("POST"))).toEqual([]);
  });

  it("does nothing when its own container or the relay cannot be found", async () => {
    const { docker, calls } = fakeDocker();
    expect(await runRelayWatchdogRound({ policy: new RelayRestartPolicy(), docker, selfId: "other", isReachable: async () => false })).toBeNull();
    const broken: DockerRequest = async () => {
      throw new Error("connect ENOENT /var/run/docker.sock");
    };
    expect(await runRelayWatchdogRound({ policy: new RelayRestartPolicy(), docker: broken, selfId: "self" })).toBeNull();
    expect(calls.filter((call) => call.startsWith("POST"))).toEqual([]);
  });

  it("is a service of its own with the socket; the relay keeps its pin and the others stay socket-free", () => {
    const compose = read("docker-compose.yml");
    const block = (name: string) => {
      const start = compose.indexOf(`\n  ${name}:\n`);
      const rest = compose.slice(start + 1);
      const next = rest.slice(3).search(/\n  [a-z-]+:\n/);
      return next === -1 ? rest : rest.slice(0, next + 3);
    };
    const watchdog = block("relay-watchdog");
    expect(watchdog).toContain('command: ["node", "apps/worker/dist/relay-watchdog.js"]');
    expect(watchdog).toContain("- /var/run/docker.sock:/var/run/docker.sock");
    expect(watchdog).not.toContain("env_file");
    expect(block("relay")).toContain("bluenviron/mediamtx:1.15.4");
    for (const service of ["web", "worker", "playout", "uplink", "relay", "postgres"]) {
      expect(block(service), service).not.toContain("docker.sock");
    }
    expect(read("apps/worker/src/relay-watchdog.ts")).toContain("runRelayWatchdog()");
  });
});
