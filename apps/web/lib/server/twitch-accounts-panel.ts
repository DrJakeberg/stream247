import {
  createTwitchTokenScopeCache,
  isEngagementAlertsRuntimeEnabled,
  isEngagementChannelPointsRuntimeEnabled,
  isEngagementChatRuntimeEnabled,
  isEngagementDonationAlertsRuntimeEnabled,
  isEngagementGameRuntimeEnabled
} from "@stream247/core";
import { resolveAppBaseUrl, resolveTwitchAccountsForState } from "@stream247/db";
import { getTwitchAccountsTexts } from "@/lib/twitch-account-texts";
import { getManagedTwitchConfig, type AppState } from "./state";

// The channel owner token's measured grant, cached per token for this server process.
const readOwnerScopes = createTwitchTokenScopeCache();

/**
 * Everything the Twitch accounts panel needs, built the same way wherever it is shown (Admin →
 * Settings and the setup wizard): the role summary (with the channel owner's measured grant, so an
 * owner connected before 2.1 is not reported as covering the alert scopes), the runtime switches the
 * worker obeys, the newest refused attempt of each connection, and whether the OAuth start routes can
 * work -- and if not, which setting is missing.
 */
export async function buildTwitchAccountsPanelProps(state: AppState, role: string | undefined) {
  const firstPass = resolveTwitchAccountsForState(state, process.env);
  const ownerScopes =
    firstPass.mode === "split" && firstPass.owner.status === "connected"
      ? await readOwnerScopes(state.twitchBroadcaster.accessToken)
      : null;
  const accounts = ownerScopes ? resolveTwitchAccountsForState(state, process.env, "", ownerScopes) : firstPass;
  const newestAudit = (type: string) => {
    const entry = [...state.auditEvents]
      .filter((event) => event.type === type)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
    return entry ? { at: entry.createdAt, message: entry.message } : null;
  };
  const env = process.env;
  const texts = getTwitchAccountsTexts(accounts, {
    liveStatus: state.twitch.status === "connected" ? state.twitch.liveStatus : "unknown",
    viewerCount: state.twitch.status === "connected" ? state.twitch.viewerCount : 0,
    botConnectedAt: state.twitch.connectedAt,
    ownerConnectedAt: state.twitchBroadcaster.connectedAt,
    lastBotRejection: newestAudit("twitch.bot.rejected"),
    lastOwnerRejection: newestAudit("twitch.broadcaster.error"),
    runtime: {
      chat: isEngagementChatRuntimeEnabled(state.engagement, env, state.managedConfig),
      chatGames: isEngagementGameRuntimeEnabled(state.engagement, env, state.managedConfig),
      alerts: isEngagementAlertsRuntimeEnabled(state.engagement, env, state.managedConfig),
      cheerAlerts: isEngagementDonationAlertsRuntimeEnabled(state.engagement, env, state.managedConfig),
      channelPointsAlerts: isEngagementChannelPointsRuntimeEnabled(state.engagement, env, state.managedConfig)
    }
  });
  // Same test as isTwitchAuthorizeConfigured, but it says WHICH piece is missing (M69 review: the
  // panel blamed the client credentials when the public URL was what was missing).
  const connectBlocker = !getManagedTwitchConfig(state).clientId
    ? "Save the Twitch client id and secret under Managed credentials to connect accounts."
    : !resolveAppBaseUrl(state.managedConfig)
      ? "Set the public URL (APP_URL or setup step 2) to connect accounts — Twitch sends the sign-in back to it."
      : "";

  return {
    accounts,
    props: {
      texts,
      saved: {
        broadcastChannelLogin: state.managedConfig.twitchBroadcastChannelLogin,
        botLogin: state.managedConfig.twitchBotLogin
      },
      channelLogin: accounts.channel.login,
      botLogin: accounts.bot.login,
      botConnectHref: connectBlocker ? null : "/api/integrations/twitch/connect",
      ownerConnectHref: connectBlocker ? null : "/api/integrations/twitch/connect-broadcaster",
      connectBlocker,
      botConnected: accounts.bot.connected,
      canEdit: role === "owner" || role === "admin"
    }
  };
}
