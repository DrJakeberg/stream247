/**
 * When a heartbeat counts as current: one answer for the Live page, readiness and the worker's own
 * healthcheck (M90, audit U3/U30).
 *
 * The thresholds used to be declared in four places with two values: the Live page called a 50 s old
 * playout heartbeat stale (45 s) while readiness called it fine (60 s), and in HLS mode readiness
 * also counted the program feed's write time while the Live page did not. An operator saw a warning
 * on one page and "ok" on the next for the same second. Everything that judges a heartbeat now asks
 * the functions below.
 *
 * The incident engine's 120 s "measurably healthy" windows (apps/worker/src/incident-classes.ts) are
 * a different question on purpose: how long a part must have been healthy before a past event is
 * closed. They are not heartbeat verdicts and stay where they are.
 */

/**
 * The worker loop. A cycle that runs source sync and Twitch reconciliation together can take a
 * little over two minutes, so the window sits above the steady-state cadence.
 */
export const WORKER_HEARTBEAT_STALE_MS = 240_000;

/** The playout and uplink loops, which cycle every few seconds. */
export const PLAYOUT_HEARTBEAT_STALE_MS = 60_000;

export type HeartbeatVerdict = "fresh" | "stale" | "missing";

export type HeartbeatJudgement = {
  verdict: HeartbeatVerdict;
  /** The timestamp that was judged, "" when none. */
  at: string;
  /** Milliseconds since `at`; positive infinity when there is none. */
  ageMs: number;
};

function parseTimestamp(value: string): number {
  const parsed = value ? new Date(value).getTime() : Number.NaN;
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

/** Fresh up to and including `staleMs`, stale beyond it, missing without a usable timestamp. */
export function judgeHeartbeat(at: string, nowMs: number, staleMs: number): HeartbeatJudgement {
  const parsed = parseTimestamp(at);
  if (!Number.isFinite(parsed)) {
    return { verdict: "missing", at: "", ageMs: Number.POSITIVE_INFINITY };
  }

  const ageMs = nowMs - parsed;
  return { verdict: ageMs > staleMs ? "stale" : "fresh", at, ageMs };
}

export function judgeWorkerHeartbeat(workerHeartbeatAt: string, nowMs: number): HeartbeatJudgement {
  return judgeHeartbeat(workerHeartbeatAt, nowMs, WORKER_HEARTBEAT_STALE_MS);
}

/** True when the programme travels as an HLS feed the uplink reads back (relay on, input not RTMP). */
export function isProgramFeedHeartbeatMode(env: Record<string, string | undefined>): boolean {
  return env.STREAM247_RELAY_ENABLED === "1" && env.STREAM247_UPLINK_INPUT_MODE !== "rtmp";
}

export type EffectivePlayoutHeartbeatInput = {
  /** `isProgramFeedHeartbeatMode` for the running deployment. */
  programFeedMode: boolean;
  playout: {
    status: string;
    heartbeatAt: string;
    programFeedStatus: string;
    programFeedUpdatedAt: string;
    uplinkStatus: string;
  };
};

/**
 * The timestamp that says the programme is alive.
 *
 * In HLS mode a fresh feed that a running uplink reads is better evidence than the playout loop's
 * own write, because the feed is the picture; so while playout is meant to be on air and the feed is
 * fresh, the newer of the two counts. Everywhere else it is the playout heartbeat itself.
 */
export function resolveEffectivePlayoutHeartbeatAt(input: EffectivePlayoutHeartbeatInput): string {
  const { playout } = input;
  const heartbeatMs = parseTimestamp(playout.heartbeatAt);
  const feedMs = parseTimestamp(playout.programFeedUpdatedAt);
  const feedCounts =
    input.programFeedMode &&
    playout.programFeedStatus === "fresh" &&
    playout.uplinkStatus === "running" &&
    Number.isFinite(feedMs) &&
    (playout.status === "running" || playout.status === "recovering" || playout.status === "switching");

  if (feedCounts && (!Number.isFinite(heartbeatMs) || feedMs > heartbeatMs)) {
    return playout.programFeedUpdatedAt;
  }

  return Number.isFinite(heartbeatMs) ? playout.heartbeatAt : "";
}

export function judgePlayoutHeartbeat(input: EffectivePlayoutHeartbeatInput, nowMs: number): HeartbeatJudgement {
  return judgeHeartbeat(resolveEffectivePlayoutHeartbeatAt(input), nowMs, PLAYOUT_HEARTBEAT_STALE_MS);
}
