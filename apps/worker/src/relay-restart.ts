// The relay restarts when it stops answering (M114 follow-up, owner's choice 2026-10-22: "A und kleiner
// Relay-Wächter").
//
// The worker reports a relay that does not answer (relay-watch.ts), but nothing could restart it: the
// pinned relay image holds only the mediamtx binary, and a hung relay does not answer its API either.
// A small service of its own, `relay-watchdog`, with the Docker socket, asks the same API and restarts
// only the relay container of its own Compose project. It has no database: it must work while
// everything else is broken, and the worker's incident already tells the operator.
//
// - a relay that is stopped or paused is left alone: that is someone's decision, not a hang;
// - three minutes without an answer, so the worker's two-minute incident comes first;
// - restarts back off (5, 10, 20, 40, then 60 min between them), and the sequence starts again after
//   30 min of answers;
// - only a relay that has answered since the watchdog started or since its last restart: one that never
//   answers (another network, `api: no`, an override) is a configuration matter, and restarting it
//   every hour would only cut the air.

import { request } from "node:http";
import { RELAY_API_BASE_URL, isRelayApiReachable } from "./relay-watch.js";

export const RELAY_RESTART_AFTER_MS = 3 * 60_000;
export const RELAY_RESTART_BACKOFF_MS = [5, 10, 20, 40, 60].map((minutes) => minutes * 60_000);
export const RELAY_RESTART_QUIET_RESET_MS = 30 * 60_000;
export const RELAY_WATCHDOG_INTERVAL_MS = 30_000;

export type RelayContainerState = "running" | "paused" | "stopped" | "missing";

export type RelayRestartDecision =
  | { action: "none" }
  | { action: "restart"; unreachableForMs: number; attempt: number }
  | { action: "hold"; unreachableForMs: number; retryAtMs: number }
  | { action: "never-answered"; unreachableForMs: number };

export class RelayRestartPolicy {
  private unreachableSinceMs: number | null = null;
  private reachableSinceMs: number | null = null;
  private attempts = 0;
  private nextAllowedAtMs = 0;
  private answeredSinceRestart = false;
  private holdLogged = false;

  /** True when the current hold was already logged; marks it logged. */
  markLogged(): boolean {
    const was = this.holdLogged;
    this.holdLogged = true;
    return was;
  }

  observe(input: { reachable: boolean; container: RelayContainerState }, nowMs: number): RelayRestartDecision {
    const decision = this.decide(input, nowMs);
    if (decision.action !== "hold" && decision.action !== "never-answered") {
      this.holdLogged = false;
    }
    return decision;
  }

  private decide(input: { reachable: boolean; container: RelayContainerState }, nowMs: number): RelayRestartDecision {
    if (input.container !== "running") {
      this.unreachableSinceMs = null;
      this.reachableSinceMs = null;
      return { action: "none" };
    }
    if (input.reachable) {
      this.unreachableSinceMs = null;
      this.answeredSinceRestart = true;
      if (this.reachableSinceMs === null) {
        this.reachableSinceMs = nowMs;
      }
      if (nowMs - this.reachableSinceMs >= RELAY_RESTART_QUIET_RESET_MS) {
        this.attempts = 0;
        this.nextAllowedAtMs = 0;
      }
      return { action: "none" };
    }
    this.reachableSinceMs = null;
    if (this.unreachableSinceMs === null || nowMs < this.unreachableSinceMs) {
      this.unreachableSinceMs = nowMs;
    }
    const unreachableForMs = nowMs - this.unreachableSinceMs;
    if (unreachableForMs < RELAY_RESTART_AFTER_MS) {
      return { action: "none" };
    }
    if (!this.answeredSinceRestart) {
      return { action: "never-answered", unreachableForMs };
    }
    if (nowMs < this.nextAllowedAtMs) {
      return { action: "hold", unreachableForMs, retryAtMs: this.nextAllowedAtMs };
    }
    const backoff = RELAY_RESTART_BACKOFF_MS[Math.min(this.attempts, RELAY_RESTART_BACKOFF_MS.length - 1)] as number;
    this.attempts += 1;
    this.nextAllowedAtMs = nowMs + backoff;
    this.answeredSinceRestart = false;
    // A fresh streak: the restarted relay gets the full three minutes to answer.
    this.unreachableSinceMs = null;
    return { action: "restart", unreachableForMs, attempt: this.attempts };
  }
}

export type DockerResponse = { status: number; body: string };
export type DockerRequest = (method: "GET" | "POST", path: string) => Promise<DockerResponse>;

/** A restart waits up to `t=10` s for the relay to stop, then starts it: give the daemon a minute. */
export const DOCKER_RESTART_TIMEOUT_MS = 60_000;

export function dockerSocketRequest(socketPath = "/var/run/docker.sock", timeoutMs = 15_000): DockerRequest {
  return (method, path) =>
    new Promise((resolve, reject) => {
      const req = request({ socketPath, path, method, timeout: method === "POST" ? DOCKER_RESTART_TIMEOUT_MS : timeoutMs }, (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("error", reject);
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
      });
      req.on("timeout", () => req.destroy(new Error("docker request timed out")));
      req.on("error", reject);
      req.end();
    });
}

/** The relay container of this watchdog's own Compose project; null when it cannot be found. */
export async function findRelayContainer(
  docker: DockerRequest,
  selfId: string
): Promise<{ id: string; state: RelayContainerState } | null> {
  const self = await docker("GET", `/containers/${encodeURIComponent(selfId)}/json`);
  if (self.status !== 200) {
    return null;
  }
  const project = (JSON.parse(self.body) as { Config?: { Labels?: Record<string, string> } }).Config?.Labels?.[
    "com.docker.compose.project"
  ];
  if (!project) {
    return null;
  }
  const filters = JSON.stringify({
    label: [`com.docker.compose.project=${project}`, "com.docker.compose.service=relay", "com.docker.compose.oneoff=False"]
  });
  const list = await docker("GET", `/containers/json?all=1&filters=${encodeURIComponent(filters)}`);
  if (list.status !== 200) {
    return null;
  }
  const containers = JSON.parse(list.body) as Array<{ Id?: string; State?: string }>;
  const relay = containers.find((container) => container.State === "running") ?? containers[0];
  if (!relay?.Id) {
    return { id: "", state: "missing" };
  }
  const state: RelayContainerState =
    relay.State === "running" ? "running" : relay.State === "paused" ? "paused" : "stopped";
  return { id: relay.Id, state };
}

export async function restartRelayContainer(docker: DockerRequest, id: string): Promise<boolean> {
  const response = await docker("POST", `/containers/${encodeURIComponent(id)}/restart?t=10`);
  return response.status === 204;
}

function log(event: string, fields: Record<string, unknown> = {}): void {
  // eslint-disable-next-line no-console
  console.info(JSON.stringify({ ts: new Date().toISOString(), component: "relay-watchdog", event, ...fields }));
}

/** One round: look, decide, act. Exported for the tests; the loop below calls it every 30 s. */
export async function runRelayWatchdogRound(args: {
  policy: RelayRestartPolicy;
  docker: DockerRequest;
  selfId: string;
  isReachable?: () => Promise<boolean>;
  nowMs?: number;
}): Promise<RelayRestartDecision | null> {
  let relay: Awaited<ReturnType<typeof findRelayContainer>>;
  try {
    relay = await findRelayContainer(args.docker, args.selfId);
  } catch (error) {
    log("relay.watchdog.docker_failed", { error: error instanceof Error ? error.message : String(error) });
    return null;
  }
  if (relay === null) {
    log("relay.watchdog.relay_not_found", { selfId: args.selfId });
    return null;
  }
  const reachable = relay.state === "running" ? await (args.isReachable ?? (() => isRelayApiReachable()))() : false;
  const decision = args.policy.observe({ reachable, container: relay.state }, args.nowMs ?? Date.now());
  if (decision.action === "restart") {
    log("relay.watchdog.restart", { unreachableForMs: decision.unreachableForMs, attempt: decision.attempt, api: RELAY_API_BASE_URL });
    try {
      const ok = await restartRelayContainer(args.docker, relay.id);
      if (!ok) {
        log("relay.watchdog.restart_failed", { attempt: decision.attempt });
      }
    } catch (error) {
      log("relay.watchdog.restart_failed", { attempt: decision.attempt, error: error instanceof Error ? error.message : String(error) });
    }
  } else if (decision.action === "hold" || decision.action === "never-answered") {
    // Once per streak, not every 30 s.
    if (!args.policy.markLogged()) {
      log(decision.action === "hold" ? "relay.watchdog.hold" : "relay.watchdog.never_answered", {
        unreachableForMs: decision.unreachableForMs,
        ...(decision.action === "hold" ? { retryAt: new Date(decision.retryAtMs).toISOString() } : {})
      });
    }
  }
  return decision;
}

export function runRelayWatchdog(env: NodeJS.ProcessEnv = process.env): void {
  const policy = new RelayRestartPolicy();
  const docker = dockerSocketRequest(env.STREAM247_DOCKER_SOCKET || "/var/run/docker.sock");
  // Docker sets the hostname to the container's short id unless the service overrides it.
  const selfId = env.HOSTNAME || "";
  log("relay.watchdog.started", { selfId, intervalMs: RELAY_WATCHDOG_INTERVAL_MS });
  const tick = async () => {
    try {
      await runRelayWatchdogRound({ policy, docker, selfId });
    } catch (error) {
      // A crash would lose the backoff; the next round tries again.
      log("relay.watchdog.round_failed", { error: error instanceof Error ? error.message : String(error) });
    }
    setTimeout(() => void tick(), RELAY_WATCHDOG_INTERVAL_MS);
  };
  void tick();
}
