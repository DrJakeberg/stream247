import { getDatabaseHealth } from "@stream247/db";
import { readAppState } from "./state";

export async function getSystemReadiness() {
  try {
    const state = await readAppState();
    const persistence = await getDatabaseHealth();
    const recentHeartbeat = state.playout.heartbeatAt ? new Date(state.playout.heartbeatAt).getTime() : 0;
    const workerHeartbeat = state.auditEvents.find((event) => event.type === "worker.cycle")?.createdAt ?? "";
    const workerHeartbeatAt = workerHeartbeat ? new Date(workerHeartbeat).getTime() : 0;
    const now = Date.now();
    const destination = state.destinations.find((entry) => entry.enabled) ?? null;
    const destinationStatus = destination
      ? destination.status === "ready"
        ? "ok"
        : "degraded"
      : "not-ready";
    const workerStatus =
      workerHeartbeatAt > 0 ? (now - workerHeartbeatAt < 120_000 ? "ok" : "degraded") : "not-ready";
    let playoutStatus: "ok" | "degraded" | "not-ready" = "not-ready";
    if (recentHeartbeat > 0 && now - recentHeartbeat < 60_000) {
      playoutStatus =
        state.playout.status === "failed"
          ? "not-ready"
          : state.playout.status === "degraded" || state.playout.crashLoopDetected
            ? "degraded"
            : "ok";
    } else if (state.playout.status === "degraded") {
      playoutStatus = "degraded";
    } else if (state.playout.status !== "idle") {
      playoutStatus = "not-ready";
    }
    const hasReadyAsset = state.assets.some((asset) => asset.status === "ready");
    const broadcastReady =
      state.initialized && persistence === "ok" && workerStatus === "ok" && playoutStatus !== "not-ready" && destinationStatus === "ok" && hasReadyAsset;
    const status =
      persistence === "ok" && workerStatus === "ok" && playoutStatus === "ok" && destinationStatus === "ok"
        ? "ok"
        : "degraded";

    return {
      status,
      broadcastReady,
      initialized: state.initialized,
      hasOwner: Boolean(state.owner),
      hasTwitchConnection: state.twitch.status === "connected",
      timestamps: {
        workerHeartbeatAt: workerHeartbeat,
        playoutHeartbeatAt: state.playout.heartbeatAt,
        lastMetadataSyncAt: state.twitch.lastMetadataSyncAt,
        lastScheduleSyncAt: state.twitch.lastScheduleSyncAt
      },
      services: {
        web: "ok",
        worker: workerStatus,
        playout: playoutStatus,
        persistence,
        destination: destinationStatus
      },
      playout: {
        status: state.playout.status,
        crashLoopDetected: state.playout.crashLoopDetected,
        crashCountWindow: state.playout.crashCountWindow,
        selectionReasonCode: state.playout.selectionReasonCode,
        fallbackTier: state.playout.fallbackTier,
        currentAssetId: state.playout.currentAssetId,
        currentDestinationId: state.playout.currentDestinationId
      },
      destination:
        destination ?? {
          name: "",
          provider: "twitch",
          status: "missing-config",
          streamKeyPresent: false
        }
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown readiness error.";

    return {
      status: "degraded",
      broadcastReady: false,
      initialized: false,
      hasOwner: false,
      hasTwitchConnection: false,
      timestamps: {
        workerHeartbeatAt: "",
        playoutHeartbeatAt: "",
        lastMetadataSyncAt: "",
        lastScheduleSyncAt: ""
      },
      services: {
        web: "ok",
        worker: "not-ready",
        playout: "not-ready",
        persistence: "error",
        destination: "not-ready"
      },
      playout: {
        status: "failed",
        crashLoopDetected: false,
        crashCountWindow: 0,
        selectionReasonCode: "",
        fallbackTier: "none",
        currentAssetId: "",
        currentDestinationId: ""
      },
      error: message
    };
  }
}
