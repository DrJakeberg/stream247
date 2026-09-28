import { resolveTwitchAccountsForState } from "@stream247/db";
import { getTwitchAccountsTexts } from "@/lib/twitch-account-texts";
import { isTwitchAuthorizeConfigured } from "./twitch";
import type { AppState } from "./state";

/**
 * Everything the Twitch accounts panel needs, built the same way wherever it is shown (Admin →
 * Settings and the setup wizard): the role summary, the newest refused attempt of each connection
 * from the audit trail, and the OAuth start routes once the Twitch app is configured.
 */
export async function buildTwitchAccountsPanelProps(state: AppState, role: string | undefined) {
  const accounts = resolveTwitchAccountsForState(state, process.env);
  const newestAudit = (type: string) => {
    const entry = [...state.auditEvents]
      .filter((event) => event.type === type)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
    return entry ? { at: entry.createdAt, message: entry.message } : null;
  };
  const texts = getTwitchAccountsTexts(accounts, {
    liveStatus: state.twitch.status === "connected" ? state.twitch.liveStatus : "unknown",
    viewerCount: state.twitch.status === "connected" ? state.twitch.viewerCount : 0,
    botConnectedAt: state.twitch.connectedAt,
    lastBotRejection: newestAudit("twitch.bot.rejected"),
    lastOwnerRejection: newestAudit("twitch.broadcaster.error")
  });
  const authorizeReady = await isTwitchAuthorizeConfigured();

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
      botConnectHref: authorizeReady ? "/api/integrations/twitch/connect" : null,
      ownerConnectHref: authorizeReady ? "/api/integrations/twitch/connect-broadcaster" : null,
      botConnected: accounts.bot.connected,
      canEdit: role === "owner" || role === "admin"
    }
  };
}
