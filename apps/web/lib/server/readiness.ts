import { readAppState } from "./state";

export async function getSystemReadiness() {
  const state = await readAppState();

  return {
    initialized: state.initialized,
    hasOwner: Boolean(state.owner),
    hasTwitchConnection: state.twitch.status === "connected",
    services: {
      web: "ok",
      worker: "not-configured",
      playout: "not-configured",
      persistence: "ok"
    }
  };
}

