import { selectActiveDestinationGroup } from "@stream247/core";
import { DEV_FALLBACK_APP_SECRET, resolveAppBaseUrl, resolveAppSecret } from "@stream247/db";
import { buildWorkspaceHref } from "../workspace-navigation";
import type { AppState } from "./state";
import { getManagedTwitchConfig } from "./state";

export type GoLiveChecklistItem = {
  id: string;
  title: string;
  detail: string;
  status: "ready" | "action" | "optional";
  /**
   * Where to go to fix it, when that is a page in this product.
   *
   * Since M52 that includes APP_URL and APP_SECRET: the setup wizard is their screen, and /setup
   * stays reachable for a signed-in operator after the workspace is initialised. Before that they
   * were env-only and the links here were dead ends offering themselves as answers.
   */
  href?: string;
};

export function getGoLiveChecklist(state: AppState): GoLiveChecklistItem[] {
  const twitchConfig = getManagedTwitchConfig(state);
  const appBaseUrl = resolveAppBaseUrl(state.managedConfig);
  const hasAppUrl = appBaseUrl !== "";
  const hasEnvAppUrl = Boolean((process.env.APP_URL || "").trim());
  const hasEnvAppSecret = Boolean((process.env.APP_SECRET || "").trim());
  // A real secret is either the env value or the one generated and persisted on first boot; only
  // the development fallback (or production refusing to resolve at all) leaves this step open.
  let hasAppSecret = hasEnvAppSecret;
  if (!hasAppSecret) {
    try {
      hasAppSecret = resolveAppSecret() !== DEV_FALLBACK_APP_SECRET;
    } catch {
      hasAppSecret = false;
    }
  }
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
      // Only before there is one: afterwards /setup redirects away and the step is done anyway.
      href: state.owner ? undefined : "/setup"
    },
    {
      id: "base-url",
      title: "Public app URL",
      detail: hasEnvAppUrl
        ? `APP_URL is set to ${appBaseUrl}.`
        : hasAppUrl
          ? `The public URL is set to ${appBaseUrl} in the setup wizard.`
          : "Set the public URL in the setup wizard so OAuth callbacks and overlay links use the public hostname.",
      status: hasAppUrl ? "ready" : "action",
      href: "/setup?step=instance"
    },
    {
      id: "app-secret",
      title: "App secret and persistence",
      // DATABASE_URL stopped gating this step with M52: the compose-internal default points at the
      // bundled Postgres, and if that database were unreachable this checklist could not render.
      detail:
        hasEnvAppSecret && hasDatabaseUrl
          ? "APP_SECRET and DATABASE_URL are configured."
          : hasAppSecret
            ? "The app secret was generated on first boot and persists on the data volume; the bundled Postgres needs no configuration."
            : "Running on the development fallback secret — fine locally, refused in production.",
      status: hasAppSecret ? "ready" : "action",
      href: "/setup?step=done"
    },
    {
      id: "twitch-credentials",
      title: "Twitch app credentials",
      detail: hasTwitchCredentials
        ? "Twitch client id and client secret are available for OAuth and sync."
        : "Save Twitch client credentials in setup or settings to enable broadcaster connect and team SSO.",
      status: hasTwitchCredentials ? "ready" : "action",
      href: state.initialized ? buildWorkspaceHref("admin", "settings") : "/setup?step=twitch-app"
    },
    {
      id: "twitch-connect",
      title: "Twitch broadcaster connection",
      detail:
        state.twitch.status === "connected"
          ? `Connected as ${state.twitch.broadcasterLogin || state.twitch.broadcasterId}.`
          : "Connect the broadcaster account so metadata, schedule sync, and team access can work.",
      status: state.twitch.status === "connected" ? "ready" : "action",
      href: buildWorkspaceHref("live", "status")
    },
    {
      id: "destination",
      title: "Live destination",
      detail: hasDestination
        ? `${routing.activeDestinationIds.length || 1} active output(s) are ready. Lead destination: ${destination?.name || "Destination"}.`
        : "Configure at least one primary or backup RTMP output with a stream key so the playout runtime has somewhere to stream.",
      status: hasDestination ? "ready" : "action",
      href: buildWorkspaceHref("live", "status")
    },
    {
      id: "sources",
      title: "Content sources",
      detail: hasSources ? `${state.sources.length} source(s) configured.` : "Add at least one YouTube, Twitch, direct-media, or local source.",
      status: hasSources ? "ready" : "action",
      href: buildWorkspaceHref("program", "sources")
    },
    {
      id: "assets",
      title: "Playable assets",
      detail: readyAssets > 0 ? `${readyAssets} ready asset(s) are available.` : "Wait for ingestion or add local media until at least one asset is ready.",
      status: readyAssets > 0 ? "ready" : "action",
      href: buildWorkspaceHref("program", "library")
    },
    {
      id: "pools",
      title: "Program pools",
      detail: hasPools ? `${state.pools.length} pool(s) available for scheduling.` : "Create at least one pool so schedule blocks can target a programming unit.",
      status: hasPools ? "ready" : "action",
      href: buildWorkspaceHref("program", "pools")
    },
    {
      id: "schedule",
      title: "Weekly schedule",
      detail: hasScheduleBlocks
        ? `${state.scheduleBlocks.length} schedule block(s) are configured.`
        : "Add blocks or apply a schedule template so the worker can build a full week of programming.",
      status: hasScheduleBlocks ? "ready" : "action",
      href: buildWorkspaceHref("program", "schedule")
    },
    {
      id: "overlay",
      title: "Replay overlay branding",
      detail: state.overlay.enabled
        ? `${state.overlay.channelName} overlay is enabled.`
        : "Optional, but recommended: enable the overlay so viewers can see current/next replay context.",
      status: state.overlay.enabled ? "ready" : "optional",
      href: buildWorkspaceHref("studio", "scene")
    }
  ];
}
