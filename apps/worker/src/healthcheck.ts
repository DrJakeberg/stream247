import {
  PLAYOUT_HEARTBEAT_STALE_MS,
  isProgramFeedHeartbeatMode,
  judgeHeartbeat,
  judgePlayoutHeartbeat,
  judgeWorkerHeartbeat
} from "@stream247/core";

export type HealthcheckMode = "worker" | "playout" | "uplink";

export type HealthcheckPlayoutInput = {
  status: string;
  heartbeatAt: string;
  workerHeartbeatAt: string;
  uplinkHeartbeatAt: string;
  uplinkStatus: string;
  uplinkLastExitReason: string;
  programFeedStatus: string;
  programFeedUpdatedAt: string;
  crashLoopDetected: boolean;
};

/**
 * The container healthcheck's verdict, as an error message or null when healthy.
 *
 * Pure so the heartbeat windows can be tested against the web's readiness and Live page: all three
 * judge a heartbeat through `@stream247/core`'s heartbeat functions and nothing else (M90, audit
 * U3/U30). The messages are the ones the healthcheck has always thrown.
 */
export function decideHealthcheck(
  mode: HealthcheckMode,
  playout: HealthcheckPlayoutInput,
  nowMs: number,
  env: Record<string, string | undefined>
): string | null {
  if (mode === "worker") {
    const worker = judgeWorkerHeartbeat(playout.workerHeartbeatAt, nowMs);
    if (worker.verdict === "missing") {
      return "No worker heartbeat has been recorded yet.";
    }
    return worker.verdict === "stale" ? "Worker heartbeat is stale." : null;
  }

  if (mode === "uplink") {
    if (env.STREAM247_RELAY_ENABLED !== "1") {
      return null;
    }

    // The uplink cycle already wrote this on every path it can exit through, so the `uplink.cycle`
    // audit entry it used to append alongside was never the only evidence -- just the noisier copy.
    const uplink = judgeHeartbeat(playout.uplinkHeartbeatAt, nowMs, PLAYOUT_HEARTBEAT_STALE_MS);
    if (uplink.verdict === "missing") {
      return "No uplink heartbeat has been recorded yet.";
    }
    if (uplink.verdict === "stale") {
      return "Uplink heartbeat is stale.";
    }
    if (playout.uplinkStatus === "failed") {
      return `Uplink failed: ${playout.uplinkLastExitReason || "unknown error"}`;
    }
    if (playout.programFeedStatus === "failed") {
      return "Program feed is failed.";
    }
    return null;
  }

  if (playout.status === "failed") {
    return "Playout runtime is failed.";
  }

  if (playout.crashLoopDetected) {
    return "Playout crash-loop protection is active.";
  }

  if (playout.status !== "idle" && playout.heartbeatAt) {
    const verdict = judgePlayoutHeartbeat({ programFeedMode: isProgramFeedHeartbeatMode(env), playout }, nowMs).verdict;
    if (verdict === "stale") {
      return "Playout heartbeat is stale.";
    }
  }

  return null;
}
