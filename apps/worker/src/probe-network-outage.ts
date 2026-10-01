// Which failed probes are the channel's own network outage, and the one connection attempt that says so
// (M82). The rules are in packages/core/src/probe-network-outage.ts; this file applies them to the
// playout's probe outcomes and does the I/O.
//
// Why a connection attempt and not the uplink's state in playout_runtime, which is already there:
//  - It has no time. uplinkLastExitReason is cleared by the next start, uplinkHeartbeatAt is written by
//    every cycle, uplinkUnplannedRestartCount is a bare counter: 70 seconds after the blip the row reads
//    "running" again and nothing says there was an outage a moment ago.
//  - It is late. The uplink learns of a dead path when ffmpeg's write fails: seconds after a reset, but
//    only at the encoder-stall restart when packets just vanish (on the DUT, 2026-09-06, that restart came
//    47 s after the first error). A name resolution fails a probe within a second, and three cycles of
//    15 s are three different items.
//  - It fails for other reasons: a rejected stream key, an ingest restart, a stale program feed, the
//    scheduled reconnect. None of them is the network.
//  - Without relay mode there is no uplink at all.
// "Network-looking failures on two hosts in one scan" does not work either: a single-source pool probes one
// host, and the scan resolves one remote item per cycle. So the playout asks, at the moment it is about to
// count a network-looking failure, the one host the channel depends on anyway: the output it publishes to.
// It is asked only then, at most once per ten seconds, so a healthy channel never opens the connection.

import { isIP, connect } from "node:net";
import { Resolver } from "node:dns/promises";
import {
  carryRecentNetworkOutage,
  decideNetworkOutage,
  networkFailureReasonOf,
  publishHostCheckOf,
  type NetworkFailureReason,
  type NetworkOutageSighting,
  type NetworkOutageVerdict,
  type PublishHostAttempt,
  type PublishHostTarget
} from "@stream247/core";

type ProbedOutcome = { outcome: "ok" | "failed"; error: string };

export type UncountedProbeOutcome<T> = { probed: T; reason: NetworkFailureReason };

/** The failed outcomes whose error names a network failure. Empty means there is nothing to ask about. */
export function networkLookingFailuresOf<T extends ProbedOutcome>(outcomes: readonly T[]): UncountedProbeOutcome<T>[] {
  const suspects: UncountedProbeOutcome<T>[] = [];
  for (const probed of outcomes) {
    const reason = probed.outcome === "failed" ? networkFailureReasonOf(probed.error) : null;
    if (reason) {
      suspects.push({ probed, reason });
    }
  }
  return suspects;
}

/**
 * The outcomes per-item quarantine and the source breaker may hear. During a corroborated outage the
 * network-looking failures are taken out, not turned into successes: an item that could not be reached is
 * not known to play, so its counter keeps its value and a half-open breaker keeps its trial. Without an
 * outage nothing is taken out: a host that is down while the channel's network is up is a source fault.
 */
export function withoutNetworkOutageOutcomes<T extends ProbedOutcome>(
  outcomes: readonly T[],
  outage: boolean
): { counted: T[]; uncounted: UncountedProbeOutcome<T>[] } {
  const uncounted = outage ? networkLookingFailuresOf(outcomes) : [];
  const dropped = new Set(uncounted.map((entry) => entry.probed));
  return { counted: outcomes.filter((probed) => !dropped.has(probed)), uncounted };
}

/** One log line per item per interval. An outage re-probes each queued item once a minute. */
export const PROBE_OUTAGE_LOG_INTERVAL_MS = 5 * 60_000;

export class ProbeOutageLogLimiter {
  private readonly entries = new Map<string, { loggedAt: number; unlogged: number }>();
  constructor(private readonly intervalMs: number = PROBE_OUTAGE_LOG_INTERVAL_MS) {}

  /** null: stay quiet. Otherwise write the line, with this many outcomes of the key left unwritten before it. */
  take(key: string, nowMs: number): number | null {
    for (const [other, entry] of this.entries) {
      // An item not seen for two intervals is out of the queue; its tally would only be kept forever.
      if (other !== key && nowMs - entry.loggedAt > this.intervalMs * 2) {
        this.entries.delete(other);
      }
    }
    const entry = this.entries.get(key);
    if (entry && nowMs - entry.loggedAt <= this.intervalMs) {
      entry.unlogged += 1;
      return null;
    }
    this.entries.set(key, { loggedAt: nowMs, unlogged: 0 });
    return entry?.unlogged ?? 0;
  }
}

/** The whole attempt on one host. A reachable ingest connects in well under a second. */
export const NETWORK_OUTAGE_CHECK_TIMEOUT_MS = 2_500;
const NETWORK_OUTAGE_DNS_TIMEOUT_MS = 1_000;
/** One verdict serves a cycle's inline resolve and its queue scan; the next cycle (15 s) asks again. */
export const NETWORK_OUTAGE_CHECK_TTL_MS = 10_000;

function errorCodeOf(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" && code ? code : "UNKNOWN";
}

// node's own resolver (c-ares), not dns.lookup: lookup runs getaddrinfo on the libuv thread pool, where a
// query to an unreachable name server blocks one of four threads for its full system timeout, long after
// this check gave up, and file reads of the playout wait behind it. This one is cancelled at the deadline.
function resolvePublishHost(host: string, timeoutMs: number): Promise<{ address: string } | { code: string }> {
  const resolver = new Resolver({ timeout: timeoutMs, tries: 1 });
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      resolver.cancel();
      resolve({ code: "ETIMEOUT" });
    }, timeoutMs);
    resolver.resolve4(host).then(
      (addresses) => {
        clearTimeout(timer);
        resolve(addresses[0] ? { address: addresses[0] } : { code: "ENODATA" });
      },
      (error: unknown) => {
        clearTimeout(timer);
        resolve({ code: errorCodeOf(error) });
      }
    );
  });
}

function connectPublishHost(address: string, port: number, timeoutMs: number): Promise<{ connected: true } | { code: string }> {
  return new Promise((resolve) => {
    const socket = connect({ host: address, port });
    const finish = (result: { connected: true } | { code: string }) => {
      clearTimeout(timer);
      socket.destroy();
      resolve(result);
    };
    const timer = setTimeout(() => finish({ code: "ETIMEDOUT" }), timeoutMs);
    socket.on("connect", () => finish({ connected: true }));
    // `on`, not `once`: a second error after the first would be an uncaught exception in the playout.
    socket.on("error", (error) => finish({ code: errorCodeOf(error) }));
  });
}

export type PublishHostAttemptDeps = {
  resolve?: typeof resolvePublishHost;
  connect?: typeof connectPublishHost;
};

/** Resolve the host and open one TCP connection to it, closed at once. Nothing is sent. */
export async function attemptPublishHost(
  target: PublishHostTarget,
  timeoutMs: number = NETWORK_OUTAGE_CHECK_TIMEOUT_MS,
  deps: PublishHostAttemptDeps = {}
): Promise<PublishHostAttempt> {
  const startedAt = Date.now();
  let address = target.host;
  if (isIP(target.host) === 0) {
    const resolved = await (deps.resolve ?? resolvePublishHost)(target.host, Math.min(NETWORK_OUTAGE_DNS_TIMEOUT_MS, timeoutMs));
    if ("code" in resolved) {
      return { connected: false, stage: "dns", code: resolved.code };
    }
    address = resolved.address;
  }
  const remainingMs = Math.max(250, timeoutMs - (Date.now() - startedAt));
  const connected = await (deps.connect ?? connectPublishHost)(address, target.port, remainingMs);
  return "code" in connected ? { connected: false, stage: "connect", code: connected.code } : { connected: true };
}

/**
 * `checkFailed`: the attempt itself threw, so there is no evidence either way. The verdict is "no outage",
 * which reads like a reachable output; the flag is what lets the caller write
 * `playout.probe.network_outage.check_failed` instead of counting in silence.
 */
export type NetworkOutageCheckVerdict = NetworkOutageVerdict & { checkFailed?: true };

/**
 * The outage check the playout calls before it counts a network-looking failure. Asks every target at
 * once and keeps the verdict for `ttlMs`. An outage it saw stands for `graceMs` more (the length of a
 * resolve, see carryRecentNetworkOutage): a failure is counted when it is reported, up to a resolve
 * timeout after the network it met. A check that itself breaks is no evidence: no outage, flagged.
 */
export function createNetworkOutageCheck(
  options: {
    attempt?: (target: PublishHostTarget, timeoutMs: number) => Promise<PublishHostAttempt>;
    ttlMs?: number;
    timeoutMs?: number;
    graceMs?: number;
    now?: () => number;
  } = {}
): (targets: readonly PublishHostTarget[]) => Promise<NetworkOutageCheckVerdict> {
  const attempt = options.attempt ?? attemptPublishHost;
  const ttlMs = options.ttlMs ?? NETWORK_OUTAGE_CHECK_TTL_MS;
  const timeoutMs = options.timeoutMs ?? NETWORK_OUTAGE_CHECK_TIMEOUT_MS;
  const graceMs = options.graceMs ?? 0;
  const now = options.now ?? Date.now;
  let cached: { key: string; askedAt: number; verdict: Promise<NetworkOutageCheckVerdict> } | null = null;
  let lastOutage: NetworkOutageSighting | null = null;

  return (targets) => {
    const key = targets.map((target) => `${target.host}:${target.port}`).join(",");
    if (cached && cached.key === key && now() - cached.askedAt <= ttlMs) {
      return cached.verdict;
    }
    if (cached && cached.key !== key) {
      // A sighting belongs to the outputs it was made on; other outputs start without one.
      lastOutage = null;
    }
    const verdict = Promise.all(targets.map(async (target) => publishHostCheckOf(target, await attempt(target, timeoutMs))))
      .then(decideNetworkOutage)
      .then((asked): NetworkOutageCheckVerdict => {
        if (asked.outage) {
          lastOutage = { atMs: now(), evidence: asked.evidence };
          return asked;
        }
        return carryRecentNetworkOutage(asked, lastOutage, now(), graceMs);
      })
      .catch((error: unknown): NetworkOutageCheckVerdict => ({
        outage: false,
        evidence: `outage check failed: ${error instanceof Error ? error.message : String(error)}`,
        checkFailed: true
      }));
    cached = { key, askedAt: now(), verdict };
    return verdict;
  };
}
