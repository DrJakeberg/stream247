// Every sentence the Twitch accounts panel shows, from the one role summary (2.1, M69). Pure, so the
// wording is tested: on 2026-09-28 a status card reading "Broadcaster 3jakec" sent an operator to
// check the bot account's channel for the live status of the broadcast channel.

import type { TwitchAccountsSummary } from "@stream247/core";

export type TwitchAccountsTextExtras = {
  // The broadcast channel's live state as the worker last measured it.
  liveStatus: "live" | "offline" | "unknown";
  viewerCount: number;
  // When the bot connection was made; a refused attempt older than that is history, not news.
  botConnectedAt: string;
  // Newest audit entries of twitch.bot.rejected / twitch.broadcaster.error, if any.
  lastBotRejection: { at: string; message: string } | null;
  lastOwnerRejection: { at: string; message: string } | null;
};

export type TwitchAccountsTexts = {
  modeLine: { tone: "ok" | "warn"; text: string };
  channel: {
    title: string;
    subtitle: string;
    sourceText: string;
    liveText: string;
    liveHint: string;
    // Null when one account does everything: there is no separate owner connection to show.
    owner: null | {
      statusText: string;
      action: "connect" | "disconnect" | null;
      hint: string;
      lastRejection: string;
      needs: Array<{ label: string; available: boolean; statusText: string }>;
    };
  };
  bot: {
    title: string;
    subtitle: string;
    statusText: string;
    warning: string;
    lastRejection: string;
    runs: Array<{ label: string; available: boolean; statusText: string }>;
  };
  sourcesNote: string;
};

function isNewer(at: string, than: string): boolean {
  const atMs = Date.parse(at);
  const thanMs = Date.parse(than);
  return Number.isFinite(atMs) && (!Number.isFinite(thanMs) || atMs > thanMs);
}

export function getTwitchAccountsTexts(summary: TwitchAccountsSummary, extras: TwitchAccountsTextExtras): TwitchAccountsTexts {
  const channel = summary.channel.login;
  const bot = summary.bot.login;

  let modeLine: TwitchAccountsTexts["modeLine"];
  if (summary.mode === "split") {
    modeLine = {
      tone: "ok",
      text: `Split setup: broadcast channel ${channel} · bot account ${bot || "not connected yet"}.`
    };
  } else if (summary.mode === "single-account") {
    modeLine = { tone: "ok", text: `Single account: ${channel} is the broadcast channel and the bot account.` };
  } else if (summary.channel.ignoredSetting) {
    modeLine = {
      tone: "warn",
      text: `The configured broadcast channel “${summary.channel.ignoredSetting}” is not a valid Twitch login and is ignored${bot ? ` — Stream247 assumes the bot account's own channel (${bot})` : ""}.`
    };
  } else if (bot) {
    modeLine = {
      tone: "warn",
      text: `Broadcast channel not set — Stream247 assumes the bot account's own channel (${bot}). Set it below if viewers watch another channel.`
    };
  } else {
    modeLine = { tone: "warn", text: "Nothing is set up yet: name the broadcast channel, then connect the bot account." };
  }

  const sourceText =
    summary.channel.source === "settings"
      ? "Saved here."
      : summary.channel.source === "env"
        ? "From TWITCH_BROADCAST_CHANNEL_LOGIN — saving a value here overrides it."
        : summary.channel.source === "bot-fallback"
          ? "Not set — assumed to be the bot account's own channel."
          : "Not set.";

  const liveText =
    extras.liveStatus === "live"
      ? `Live · ${extras.viewerCount} viewer${extras.viewerCount === 1 ? "" : "s"}`
      : extras.liveStatus === "offline"
        ? "Offline"
        : "Live status unknown — it is read through the bot account and the Twitch app credentials.";
  const liveHint = channel
    ? `Check whether the stream is live on twitch.tv/${channel} — never on the bot account's channel.`
    : "";

  let owner: TwitchAccountsTexts["channel"]["owner"] = null;
  if (summary.mode === "split") {
    const status = summary.owner.status;
    const statusText =
      status === "connected"
        ? `Connected as ${channel}.`
        : status === "wrong-account"
          ? `Connected as ${summary.owner.login}, not ${channel} — reconnect as ${channel}.`
          : status === "error"
            ? `The last channel owner connection failed${summary.owner.error ? `: ${summary.owner.error}` : "."}`
            : "Not connected.";
    owner = {
      statusText,
      action: status === "connected" ? "disconnect" : "connect",
      hint: `Sign in to Twitch as ${channel} in this browser first — Twitch then shows which account is signing in.`,
      lastRejection: extras.lastOwnerRejection ? `Last attempt refused: ${extras.lastOwnerRejection.message}` : "",
      needs: summary.capabilities
        .filter((entry) => ["titleCategory", "schedule", "subAlerts", "cheerAlerts", "redemptionAlerts"].includes(entry.key))
        .map((entry) => ({
          label: entry.label,
          available: entry.available,
          statusText: entry.available ? "Active" : "Waiting for the channel owner connection"
        }))
    };
  }

  const expected = summary.bot.expectedLogin;
  const warning =
    summary.bot.matchesExpected === false
      ? `Connected as ${bot}, but the bot account is set to ${expected}. Connect again as ${expected}.`
      : "";
  const lastBotRejection =
    extras.lastBotRejection && (!summary.bot.connected || isNewer(extras.lastBotRejection.at, extras.botConnectedAt))
      ? `Last connect attempt refused: ${extras.lastBotRejection.message}`
      : "";

  const runs = summary.capabilities
    .filter((entry) => ["chat", "moderation", "checkins", "chatGames", "followAlerts", "liveStatus", "ownerSignIn"].includes(entry.key))
    .map((entry) => ({ label: entry.label, available: entry.available, statusText: entry.available ? "Active" : entry.reason }));

  return {
    modeLine,
    channel: {
      title: "Broadcast channel",
      subtitle: "Where the video goes and where viewers watch. The stream key must belong to this channel.",
      sourceText,
      liveText,
      liveHint,
      owner
    },
    bot: {
      title: "Bot account",
      subtitle: `The account Stream247 signs in as for chat and moderation. It must be a moderator in ${channel ? `${channel}'s` : "the broadcast channel's"} chat.`,
      statusText: summary.bot.connected ? `Connected as ${bot}.` : "Not connected.",
      warning,
      lastRejection: lastBotRejection,
      runs
    },
    sourcesNote:
      "Content sources — Twitch archives and YouTube channels under Program → Sources — are only pulled from, never broadcast to."
  };
}
