import { selectActiveDestinationGroup } from "@stream247/core";
import type { AppState } from "./state";
import { getManagedTwitchConfig } from "./state";

export type GoLiveChecklistItem = {
  id: string;
  title: string;
  detail: string;
  status: "ready" | "action" | "optional";
  href: string;
};

export function getGoLiveChecklist(state: AppState): GoLiveChecklistItem[] {
  const twitchConfig = getManagedTwitchConfig(state);
  const hasAppUrl = Boolean((process.env.APP_URL || "").trim());
  const hasAppSecret = Boolean((process.env.APP_SECRET || "").trim());
  const hasDatabaseUrl = Boolean((process.env.DATABASE_URL || "").trim());
  const hasTwitchCredentials = Boolean(twitchConfig.clientId && twitchConfig.clientSecret);
  const readyAssets = state.assets.filter((asset) => asset.status === "ready").length;
  const hasSources = state.sources.length > 0;
  const hasPools = state.pools.length > 0;
  const hasScheduleBlocks = state.scheduleBlocks.length > 0;
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
  const hasDestination = Boolean(destination?.streamKeyPresent && destination.status === "ready");

  return [
    {
      id: "owner",
      title: "Owner account",
      detail: state.owner ? `Owner ${state.owner.email} is configured.` : "Create the owner account to initialize the workspace.",
      status: state.owner ? "ready" : "action",
      href: "/setup"
    },
    {
      id: "base-url",
      title: "Public app URL",
      detail: hasAppUrl ? `APP_URL is set to ${process.env.APP_URL}.` : "Set APP_URL so OAuth callbacks and overlay links use the public hostname.",
      status: hasAppUrl ? "ready" : "action",
      href: "/setup"
    },
    {
      id: "app-secret",
      title: "App secret and persistence",
      detail:
        hasAppSecret && hasDatabaseUrl
          ? "APP_SECRET and DATABASE_URL are configured."
          : "Set APP_SECRET and DATABASE_URL before treating the install as production-ready.",
      status: hasAppSecret && hasDatabaseUrl ? "ready" : "action",
      href: "/setup"
    },
    {
      id: "twitch-credentials",
      title: "Twitch app credentials",
      detail: hasTwitchCredentials
        ? "Twitch client id and client secret are available for OAuth and sync."
        : "Save Twitch client credentials in setup or settings to enable broadcaster connect and team SSO.",
      status: hasTwitchCredentials ? "ready" : "action",
      href: state.initialized ? "/settings" : "/setup"
    },
    {
      id: "twitch-connect",
      title: "Twitch broadcaster connection",
      detail:
        state.twitch.status === "connected"
          ? `Connected as ${state.twitch.broadcasterLogin || state.twitch.broadcasterId}.`
          : "Connect the broadcaster account so metadata, schedule sync, and team access can work.",
      status: state.twitch.status === "connected" ? "ready" : "action",
      href: "/dashboard"
    },
    {
      id: "destination",
      title: "Broadcast destination",
      detail: hasDestination
        ? `${routing.activeDestinationIds.length || 1} active output(s) are ready. Lead destination: ${destination?.name || "Destination"}.`
        : "Configure at least one primary or backup RTMP output with a stream key so the playout runtime has somewhere to stream.",
      status: hasDestination ? "ready" : "action",
      href: "/dashboard"
    },
    {
      id: "sources",
      title: "Content sources",
      detail: hasSources ? `${state.sources.length} source(s) configured.` : "Add at least one YouTube, Twitch, direct-media, or local source.",
      status: hasSources ? "ready" : "action",
      href: "/sources"
    },
    {
      id: "assets",
      title: "Playable assets",
      detail: readyAssets > 0 ? `${readyAssets} ready asset(s) are available.` : "Wait for ingestion or add local media until at least one asset is ready.",
      status: readyAssets > 0 ? "ready" : "action",
      href: "/sources"
    },
    {
      id: "pools",
      title: "Programming pools",
      detail: hasPools ? `${state.pools.length} pool(s) available for scheduling.` : "Create at least one pool so schedule blocks can target a programming unit.",
      status: hasPools ? "ready" : "action",
      href: "/sources"
    },
    {
      id: "schedule",
      title: "Weekly schedule",
      detail: hasScheduleBlocks
        ? `${state.scheduleBlocks.length} schedule block(s) are configured.`
        : "Add blocks or apply a schedule template so the worker can build a full week of programming.",
      status: hasScheduleBlocks ? "ready" : "action",
      href: "/schedule"
    },
    {
      id: "overlay",
      title: "Replay overlay branding",
      detail: state.overlay.enabled
        ? `${state.overlay.channelName} overlay is enabled.`
        : "Optional, but recommended: enable the overlay so viewers can see current/next replay context.",
      status: state.overlay.enabled ? "ready" : "optional",
      href: "/overlay-studio"
    }
  ];
}
