import { getDatabaseHealth } from "@stream247/db";
import { readAppState } from "./state";

export async function getSystemReadiness() {
  try {
    const state = await readAppState();
    const persistence = await getDatabaseHealth();
    const recentHeartbeat = state.playout.heartbeatAt ? new Date(state.playout.heartbeatAt).getTime() : 0;
    const now = Date.now();
    const playoutStatus =
      recentHeartbeat > 0 && now - recentHeartbeat < 60_000
        ? state.playout.status === "degraded"
          ? "degraded"
          : "ok"
        : "not-ready";

    return {
      status: persistence === "ok" ? "ok" : "degraded",
      initialized: state.initialized,
      hasOwner: Boolean(state.owner),
      hasTwitchConnection: state.twitch.status === "connected",
      services: {
        web: "ok",
        worker: state.auditEvents.some((event) => event.type === "worker.cycle") ? "ok" : "not-ready",
        playout: playoutStatus,
        persistence
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
        persistence: "error"
      },
      error: message
    };
  }
}
