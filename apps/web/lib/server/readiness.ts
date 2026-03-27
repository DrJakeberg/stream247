import { getDatabaseHealth } from "@stream247/db";
import { readAppState } from "./state";

export async function getSystemReadiness() {
  try {
    const state = await readAppState();
    const persistence = await getDatabaseHealth();
    const recentHeartbeat = state.playout.heartbeatAt ? new Date(state.playout.heartbeatAt).getTime() : 0;
    const now = Date.now();
    const destination = state.destinations.find((entry) => entry.enabled) ?? null;
    const destinationStatus = destination
      ? destination.status === "ready"
        ? "ok"
        : "degraded"
      : "not-ready";
    const workerStatus = state.auditEvents.some((event) => event.type === "worker.cycle") ? "ok" : "not-ready";
    let playoutStatus: "ok" | "degraded" | "not-ready" = "not-ready";
    if (recentHeartbeat > 0 && now - recentHeartbeat < 60_000) {
      playoutStatus =
        state.playout.status === "failed"
          ? "not-ready"
          : state.playout.status === "degraded"
            ? "degraded"
            : "ok";
    } else if (state.playout.status === "degraded") {
      playoutStatus = "degraded";
    } else if (state.playout.status !== "idle") {
      playoutStatus = "not-ready";
    }
    const status =
      persistence === "ok" && workerStatus === "ok" && playoutStatus === "ok" && destinationStatus === "ok"
        ? "ok"
        : "degraded";

    return {
      status,
      initialized: state.initialized,
      hasOwner: Boolean(state.owner),
      hasTwitchConnection: state.twitch.status === "connected",
      services: {
        web: "ok",
        worker: workerStatus,
        playout: playoutStatus,
        persistence,
        destination: destinationStatus
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
      initialized: false,
      hasOwner: false,
      hasTwitchConnection: false,
      services: {
        web: "ok",
        worker: "not-ready",
        playout: "not-ready",
        persistence: "error",
        destination: "not-ready"
      },
      error: message
    };
  }
}
