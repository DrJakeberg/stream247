import { poolHasPlayableAsset, selectActiveDestinationGroup, type MaterializedProgrammingDay } from "@stream247/core";
import { DEV_FALLBACK_APP_SECRET, resolveAppBaseUrl, resolveAppSecret, resolveTwitchAccountsForState } from "@stream247/db";
import { buildWorkspaceHref } from "../workspace-navigation";
import type { AppState } from "./state";
import { getManagedTwitchConfig, getMaterializedProgrammingWeekPreview } from "./state";

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

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * The blocks of the coming week that resolve to no playable video: nothing materialized and nothing the
 * pool's rotation could pick. Without the source breaker, as on the schedule page: a pool whose sources
 * the breaker holds has nothing to fix in the pools, and the week lens says why it plays the fallback.
 * Labelled "Fri 18:00 Prime Time" for the schedule page's "Needs attention" panel and readiness.
 */
export function findUnplayableWeekBlocks(state: AppState, week: MaterializedProgrammingDay[]): string[] {
  return week.flatMap((day) =>
    day.blocks
      .filter((block) => {
        if (block.items.length > 0) {
          return false;
        }
        const pool = block.poolId ? state.pools.find((entry) => entry.id === block.poolId) ?? null : null;
        return !poolHasPlayableAsset({ pool, assets: state.assets });
      })
      .map((block) => `${WEEKDAY_LABELS[block.dayOfWeek]} ${block.startTime} ${block.title}`)
  );
}

/** A source that can deliver something: the local library, or an enabled source with a URL to sync. */
function isDeliveringSource(source: AppState["sources"][number]): boolean {
  if (source.enabled === false) {
    return false;
  }
  return source.connectorKind === "local-library" || Boolean((source.externalUrl || "").trim());
}

export function getGoLiveChecklist(state: AppState, now: Date = new Date()): GoLiveChecklistItem[] {
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
  // Readiness counts what can air (M91), not rows: a placeholder source without a URL, a pool no block
  // uses or one with nothing ready in it, and a week with a block that resolves to nothing are not done.
  const deliveringSources = state.sources.filter(isDeliveringSource);
  const scheduledPoolIds = new Set(state.scheduleBlocks.map((block) => block.poolId).filter(Boolean));
  const readyPools = state.pools.filter(
    (pool) => scheduledPoolIds.has(pool.id) && poolHasPlayableAsset({ pool, assets: state.assets })
  );
  const unplayableBlocks =
    state.scheduleBlocks.length > 0 ? findUnplayableWeekBlocks(state, getMaterializedProgrammingWeekPreview(state, now)) : [];
  const scheduleReady = state.scheduleBlocks.length > 0 && unplayableBlocks.length === 0;
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
        : "Save Twitch client credentials in setup or settings to enable the account connections and team sign-in.",
      status: hasTwitchCredentials ? "ready" : "action",
      href: state.initialized ? buildWorkspaceHref("admin", "settings") : "/setup?step=twitch-app"
    },
    {
      id: "twitch-connect",
      title: "Twitch bot account",
      detail:
        state.twitch.status === "connected"
          ? `Connected as ${state.twitch.broadcasterLogin || state.twitch.broadcasterId} — the account Stream247 chats and moderates as.`
          : "Connect the bot account Stream247 signs in as for chat, moderation and team sign-in.",
      status: state.twitch.status === "connected" ? "ready" : "action",
      href: `${buildWorkspaceHref("admin", "settings")}#twitch-accounts`
    },
    (() => {
      // The channel the stream key sends to and viewers watch; an unset value means the bot's own
      // channel, which is right for a single-account setup and wrong for a split one -- hence optional.
      const accounts = resolveTwitchAccountsForState(state, process.env);
      return {
        id: "broadcast-channel",
        title: "Twitch broadcast channel",
        detail:
          accounts.mode === "unconfirmed"
            ? accounts.channel.login
              ? `Not set — Stream247 assumes the bot account's own channel (${accounts.channel.login}). Set it if viewers watch another channel.`
              : "Not set. Name the channel your stream key sends to."
            : `Set to ${accounts.channel.login}: the stream key sends here and viewers watch here.`,
        status: accounts.mode === "unconfirmed" ? ("optional" as const) : ("ready" as const),
        href: `${buildWorkspaceHref("admin", "settings")}#twitch-accounts`
      };
    })(),
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
      detail:
        deliveringSources.length > 0
          ? `${deliveringSources.length} source(s) can deliver media.${
              state.sources.length > deliveringSources.length
                ? ` ${state.sources.length - deliveringSources.length} more are disabled or have no URL yet.`
                : ""
            }`
          : "Add at least one YouTube, Twitch, direct-media, or local source with a URL.",
      status: deliveringSources.length > 0 ? "ready" : "action",
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
      detail:
        readyPools.length > 0
          ? `${readyPools.length} pool(s) are scheduled and have a ready video.`
          : state.pools.length > 0
            ? "No pool is both used by a schedule block and holding a ready video yet."
            : "Create a pool from your sources and use it in a schedule block.",
      status: readyPools.length > 0 ? "ready" : "action",
      href: buildWorkspaceHref("program", "pools")
    },
    {
      id: "schedule",
      title: "Weekly schedule",
      detail: scheduleReady
        ? `${state.scheduleBlocks.length} schedule block(s) are configured, and every block of the coming week has something to play.`
        : unplayableBlocks.length > 0
          ? `${unplayableBlocks.length} block(s) of the coming week have nothing to play: ${unplayableBlocks.slice(0, 3).join(" · ")}.`
          : "Add blocks or apply a schedule template so the worker can build a full week of programming.",
      status: scheduleReady ? "ready" : "action",
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
