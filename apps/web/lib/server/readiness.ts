import { selectActiveDestinationGroup } from "@stream247/core";
import { getDatabaseHealth } from "@stream247/db";
import { getActiveSseConnectionCount } from "./sse";
import { readAppState } from "./state";

const WORKER_HEARTBEAT_STALE_MS = 180_000;
const RUNTIME_HEARTBEAT_STALE_MS = 60_000;
const MIN_PLAYOUT_TRANSIENT_GRACE_SECONDS = 20;

function readPositiveNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value ?? "");
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getPlayoutTransientGraceSeconds(): number {
  const failoverSeconds = readPositiveNumber(process.env.STREAM247_PROGRAM_FEED_FAILOVER_SECONDS, 10);
  return readPositiveNumber(
    process.env.STREAM247_PLAYOUT_TRANSIENT_GRACE_SECONDS,
    Math.max(MIN_PLAYOUT_TRANSIENT_GRACE_SECONDS, failoverSeconds)
  );
}

export async function getSystemReadiness() {
  try {
    const state = await readAppState();
    const persistence = await getDatabaseHealth();
    const recentHeartbeat = state.playout.heartbeatAt ? new Date(state.playout.heartbeatAt).getTime() : 0;
    const workerHeartbeat = state.auditEvents.find((event) => event.type === "worker.cycle")?.createdAt ?? "";
    const workerHeartbeatAt = workerHeartbeat ? new Date(workerHeartbeat).getTime() : 0;
    const relayEnabled = process.env.STREAM247_RELAY_ENABLED === "1";
    const hlsProgramFeedEnabled = relayEnabled && process.env.STREAM247_UPLINK_INPUT_MODE !== "rtmp";
    const uplinkHeartbeatAt = state.playout.uplinkHeartbeatAt ? new Date(state.playout.uplinkHeartbeatAt).getTime() : 0;
    const now = Date.now();
    const routing = selectActiveDestinationGroup(
      state.destinations.map((destination) => ({
        id: destination.id,
        name: destination.name,
        role: destination.role,
        priority: destination.priority,
        enabled: destination.enabled,
        streamKeyPresent: destination.streamKeyPresent,
        status: destination.status
      }))
    );
    const destination =
      state.destinations.find((entry) => entry.id === routing.leadDestinationId) ??
      [...state.destinations]
        .filter((entry) => entry.enabled)
        .sort((left, right) => left.priority - right.priority || left.name.localeCompare(right.name))
        .find((entry) => entry.status === "ready")
        ?? state.destinations.find((entry) => entry.enabled)
        ?? null;
    const destinationStatus = destination
      ? destination.status === "ready"
        ? "ok"
        : "degraded"
      : "not-ready";
    const workerStatus =
      workerHeartbeatAt > 0 ? (now - workerHeartbeatAt < WORKER_HEARTBEAT_STALE_MS ? "ok" : "degraded") : "not-ready";
    const uplinkStatus =
      !relayEnabled
        ? "ok"
        : state.playout.uplinkStatus === "running" && uplinkHeartbeatAt > 0 && now - uplinkHeartbeatAt < RUNTIME_HEARTBEAT_STALE_MS
        ? "ok"
        : state.playout.uplinkStatus === "scheduled-reconnect"
          ? "degraded"
          : "not-ready";
    const programFeedStatus =
      !hlsProgramFeedEnabled || state.playout.programFeedStatus === "fresh"
        ? "ok"
        : state.playout.programFeedStatus === "stale"
          ? "degraded"
          : "not-ready";
    const playoutTransientGraceSeconds = getPlayoutTransientGraceSeconds();
    const playoutTransientGraceMs = playoutTransientGraceSeconds * 1000;
    const playoutTransient =
      hlsProgramFeedEnabled &&
      state.playout.status === "failed" &&
      recentHeartbeat > 0 &&
      now - recentHeartbeat <= playoutTransientGraceMs &&
      !state.playout.crashLoopDetected &&
      uplinkStatus === "ok" &&
      programFeedStatus === "ok" &&
      destinationStatus === "ok";
    let playoutStatus: "ok" | "degraded" | "not-ready" = "not-ready";
    if (recentHeartbeat > 0 && now - recentHeartbeat < 60_000) {
      playoutStatus =
        state.playout.status === "failed"
          ? playoutTransient
            ? "degraded"
            : "not-ready"
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
      state.initialized &&
      persistence === "ok" &&
      workerStatus === "ok" &&
      playoutStatus !== "not-ready" &&
      uplinkStatus !== "not-ready" &&
      programFeedStatus !== "not-ready" &&
      destinationStatus === "ok" &&
      hasReadyAsset;
    const status =
      persistence === "ok" &&
      workerStatus === "ok" &&
      playoutStatus === "ok" &&
      uplinkStatus === "ok" &&
      programFeedStatus === "ok" &&
      destinationStatus === "ok"
        ? "ok"
        : "degraded";

    return {
      status,
      broadcastReady,
      initialized: state.initialized,
      hasOwner: Boolean(state.owner),
      hasTwitchConnection: state.twitch.status === "connected",
      sseConnections: getActiveSseConnectionCount(),
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
        uplink: uplinkStatus,
        programFeed: programFeedStatus,
        persistence,
        destination: destinationStatus
      },
      playout: {
        status: state.playout.status,
        crashLoopDetected: state.playout.crashLoopDetected,
        crashCountWindow: state.playout.crashCountWindow,
        restartCount: state.playout.restartCount,
        lastExitCode: state.playout.lastExitCode,
        selectionReasonCode: state.playout.selectionReasonCode,
        fallbackTier: state.playout.fallbackTier,
        currentAssetId: state.playout.currentAssetId,
        currentDestinationId: state.playout.currentDestinationId,
        transient: playoutTransient,
        transientGraceSeconds: playoutTransientGraceSeconds
      },
      uplink: {
        status: state.playout.uplinkStatus || "idle",
        inputMode: state.playout.uplinkInputMode || (hlsProgramFeedEnabled ? "hls" : "rtmp"),
        heartbeatAt: state.playout.uplinkHeartbeatAt,
        startedAt: state.playout.uplinkStartedAt,
        destinationIds: state.playout.uplinkDestinationIds,
        restartCount: state.playout.uplinkRestartCount,
        unplannedRestartCount: state.playout.uplinkUnplannedRestartCount,
        lastExitCode: state.playout.uplinkLastExitCode,
        lastExitReason: state.playout.uplinkLastExitReason,
        lastExitPlanned: state.playout.uplinkLastExitPlanned,
        reconnectUntil: state.playout.uplinkReconnectUntil
      },
      programFeed: {
        status: state.playout.programFeedStatus || (hlsProgramFeedEnabled ? "bootstrapping" : ""),
        updatedAt: state.playout.programFeedUpdatedAt,
        playlistPath: state.playout.programFeedPlaylistPath,
        targetSeconds: state.playout.programFeedTargetSeconds,
        bufferedSeconds: state.playout.programFeedBufferedSeconds
      },
      destination:
        destination ?? {
          name: "",
          provider: "twitch",
          role: "primary",
          priority: 0,
          status: "missing-config",
          streamKeyPresent: false,
          streamKeySource: "missing"
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
      sseConnections: getActiveSseConnectionCount(),
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
        uplink: "not-ready",
        programFeed: "not-ready",
        persistence: "error",
        destination: "not-ready"
      },
      playout: {
        status: "failed",
        crashLoopDetected: false,
        crashCountWindow: 0,
        restartCount: 0,
        lastExitCode: "",
        selectionReasonCode: "",
        fallbackTier: "none",
        currentAssetId: "",
        currentDestinationId: "",
        transient: false,
        transientGraceSeconds: getPlayoutTransientGraceSeconds()
      },
      uplink: {
        status: "failed",
        inputMode: "",
        heartbeatAt: "",
        startedAt: "",
        destinationIds: [],
        restartCount: 0,
        unplannedRestartCount: 0,
        lastExitCode: "",
        lastExitReason: "",
        lastExitPlanned: false,
        reconnectUntil: ""
      },
      programFeed: {
        status: "failed",
        updatedAt: "",
        playlistPath: "",
        targetSeconds: 0,
        bufferedSeconds: 0
      },
      error: message
    };
  }
}
