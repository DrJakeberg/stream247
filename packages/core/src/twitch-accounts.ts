// Two Twitch accounts, one place that says which is which (2.1, M69).
//
// A Stream247 channel can involve two different Twitch accounts:
//
//   - the BROADCAST CHANNEL: where the video goes and where viewers watch. The stream key belongs to
//     it. On the reference install that is jimpanse247.
//   - the BOT ACCOUNT: the account Stream247 connects as for chat and moderation, a moderator in the
//     broadcast channel's chat. On the reference install that is 3JakeC.
//
// Optionally the broadcast channel's own account connects too (the "channel owner connection"), for
// the writes Twitch only accepts from the channel itself: title, category, schedule, and the alert
// types a moderator cannot subscribe to.
//
// Until 2.1 the product called the bot "broadcaster" in its tables, its audit trail and its status
// card, and an empty channel setting silently meant "the bot's own channel". On 2026-09-28 that
// ambiguity sent an operator to check twitch.tv/3jakec for the live status of jimpanse247. Every
// label, card and log that names a Twitch account reads its role from resolveTwitchAccounts.

import { isValidTwitchLogin } from "./broadcast-channel.js";

export type TwitchAccountsMode =
  // Broadcast channel and bot are different accounts.
  | "split"
  // The configured broadcast channel is the bot account itself.
  | "single-account"
  // No valid broadcast channel is configured: Stream247 assumes the bot's own channel. Works, but it
  // is an assumption, so the GUI says so instead of showing it as a setting.
  | "unconfirmed";

export type TwitchChannelSource = "settings" | "env" | "bot-fallback" | "none";

export type TwitchCapabilityKey =
  | "chat"
  | "moderation"
  | "checkins"
  | "chatGames"
  | "followAlerts"
  | "liveStatus"
  | "titleCategory"
  | "schedule"
  | "subAlerts"
  | "cheerAlerts"
  | "redemptionAlerts"
  | "ownerSignIn";

export type TwitchCapability = {
  key: TwitchCapabilityKey;
  label: string;
  available: boolean;
  // Which connection does the work; null when nothing can.
  via: "bot" | "channel-owner" | null;
  // Why it is not available, phrased as what to do. "" when available.
  reason: string;
};

export type TwitchOwnerStatus = "connected" | "not-connected" | "wrong-account" | "error" | "not-needed";

export type TwitchAccountsInput = {
  // The configured broadcast channel login and where it came from (managed settings win over env).
  channelSetting: { managed: string; env: string };
  // The login the bot account is expected to be (managed settings win over env). "" = no check.
  expectedBotSetting: { managed: string; env: string };
  // twitch_connection: the bot account.
  bot: { status: string; login: string; id: string };
  // twitch_broadcaster_connection: the channel owner connection.
  owner: { status: string; login: string; hasToken: boolean; error: string };
  // The broadcast channel's resolved Twitch user id, when the worker has resolved it.
  channelUserId?: string;
  // What the channel owner connection's token actually grants (oauth2/validate); null or absent when
  // not measured. An owner connected before 2.1 lacks the alert scopes 2.1 asks for, and claiming
  // those alerts as active would be false (M69 review).
  ownerGrantedScopes?: readonly string[] | null;
};

// The scope each channel-owner capability needs from the broadcast channel's own grant. Shared with
// the worker's EventSub sync, so the panel and the subscriptions decide from the same list.
export const TWITCH_CHANNEL_OWNER_CAPABILITY_SCOPES = {
  titleCategory: "channel:manage:broadcast",
  schedule: "channel:manage:schedule",
  subAlerts: "channel:read:subscriptions",
  cheerAlerts: "bits:read",
  redemptionAlerts: "channel:read:redemptions"
} as const;

export type TwitchAccountsSummary = {
  mode: TwitchAccountsMode;
  channel: {
    login: string;
    source: TwitchChannelSource;
    userId: string;
    // A configured value that is not a valid Twitch login and was therefore ignored; "" otherwise.
    ignoredSetting: string;
  };
  bot: {
    connected: boolean;
    login: string;
    id: string;
    expectedLogin: string;
    expectedSource: "settings" | "env" | "none";
    // null when no expected login is set.
    matchesExpected: boolean | null;
  };
  owner: { status: TwitchOwnerStatus; login: string; error: string };
  capabilities: TwitchCapability[];
};

function sameLogin(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

// The same rule the worker and web used since M51 (managed value, else env), so the metadata gate
// decides exactly as before: a non-empty managed value wins even when it is not a valid login.
function pickSetting(setting: { managed: string; env: string }): { value: string; source: "settings" | "env" | "none" } {
  const managed = setting.managed.trim();
  if (managed) {
    return { value: managed, source: "settings" };
  }
  const env = setting.env.trim();
  return env ? { value: env, source: "env" } : { value: "", source: "none" };
}

function capability(
  key: TwitchCapabilityKey,
  label: string,
  via: "bot" | "channel-owner",
  available: boolean,
  reason: string
): TwitchCapability {
  return { key, label, available, via: available ? via : null, reason: available ? "" : reason };
}

export function resolveTwitchAccounts(input: TwitchAccountsInput): TwitchAccountsSummary {
  const botConnected = input.bot.status === "connected" && input.bot.login.trim() !== "";
  const botLogin = input.bot.login.trim();
  const channelSetting = pickSetting(input.channelSetting);
  const channelValid = isValidTwitchLogin(channelSetting.value);
  const expected = pickSetting(input.expectedBotSetting);
  const expectedLogin = isValidTwitchLogin(expected.value) ? expected.value : "";

  let mode: TwitchAccountsMode;
  let channel: TwitchAccountsSummary["channel"];
  if (channelValid) {
    mode = botLogin && sameLogin(channelSetting.value, botLogin) ? "single-account" : "split";
    channel = { login: channelSetting.value, source: channelSetting.source === "env" ? "env" : "settings", userId: "", ignoredSetting: "" };
  } else {
    mode = "unconfirmed";
    channel = {
      login: botLogin,
      source: botLogin ? "bot-fallback" : "none",
      userId: "",
      ignoredSetting: channelSetting.value
    };
  }
  channel.userId = (input.channelUserId ?? "").trim() || (mode !== "split" && botConnected ? input.bot.id.trim() : "");

  const ownerConnected = input.owner.status === "connected" && input.owner.hasToken;
  let ownerStatus: TwitchOwnerStatus;
  if (mode !== "split") {
    ownerStatus = "not-needed";
  } else if (ownerConnected) {
    ownerStatus = sameLogin(input.owner.login, channel.login) ? "connected" : "wrong-account";
  } else {
    ownerStatus = input.owner.status === "error" ? "error" : "not-connected";
  }

  const botReason = "Connect the bot account.";
  const ownerReason =
    ownerStatus === "wrong-account"
      ? `The channel owner connection is ${input.owner.login.trim()}, not ${channel.login} — reconnect it as ${channel.login}.`
      : `Waiting for the channel owner connection (${channel.login || "broadcast channel"}).`;
  const ownerScopes = input.ownerGrantedScopes ? new Set(input.ownerGrantedScopes.map((scope) => scope.trim())) : null;
  // In a split, the writes Twitch only accepts from the channel itself go through the owner
  // connection -- but the worker runs every Twitch job behind a connected bot (reconcileTwitch and
  // the EventSub sync return early without it), so both have to be there. With one account the bot IS
  // the channel and does them.
  const channelWrites = (key: keyof typeof TWITCH_CHANNEL_OWNER_CAPABILITY_SCOPES, label: string): TwitchCapability => {
    if (mode !== "split") {
      return capability(key, label, "bot", botConnected, botReason);
    }
    if (!botConnected) {
      return capability(key, label, "channel-owner", false, botReason);
    }
    if (ownerStatus !== "connected") {
      return capability(key, label, "channel-owner", false, ownerReason);
    }
    const scope = TWITCH_CHANNEL_OWNER_CAPABILITY_SCOPES[key];
    const granted = ownerScopes === null || ownerScopes.has(scope);
    return capability(
      key,
      label,
      "channel-owner",
      granted,
      `Reconnect the channel owner (${channel.login}) to grant ${scope} — a connection made before 2.1 lacks it.`
    );
  };

  const capabilities: TwitchCapability[] = [
    capability("chat", "Chat rail", "bot", botConnected, botReason),
    capability("moderation", "Emote-only and chat moderation", "bot", botConnected, botReason),
    capability("checkins", "!here check-ins", "bot", botConnected, botReason),
    capability("chatGames", "Chat games", "bot", botConnected, botReason),
    capability("followAlerts", "Follow alerts", "bot", botConnected, botReason),
    capability("liveStatus", "Live status and viewer count", "bot", botConnected, botReason),
    channelWrites("titleCategory", "Title and category"),
    channelWrites("schedule", "Twitch schedule"),
    channelWrites("subAlerts", "Sub alerts"),
    channelWrites("cheerAlerts", "Cheer alerts"),
    channelWrites("redemptionAlerts", "Channel-points alerts"),
    capability("ownerSignIn", "Sign in to Stream247 with Twitch as owner", "bot", botConnected, botReason)
  ];

  return {
    mode,
    channel,
    bot: {
      connected: botConnected,
      login: botLogin,
      id: input.bot.id.trim(),
      expectedLogin,
      expectedSource: expectedLogin ? expected.source : "none",
      matchesExpected: expectedLogin && botLogin ? sameLogin(expectedLogin, botLogin) : null
    },
    owner: { status: ownerStatus, login: input.owner.login.trim(), error: input.owner.error.trim() },
    capabilities
  };
}

export type BotConnectVerdict =
  | { ok: true }
  | { ok: false; reason: "wrong-account" | "is-broadcast-channel"; message: string };

/**
 * Whether a completed bot-account OAuth may be stored.
 *
 * Twitch authorises whichever account the browser is signed in as. Two mistakes are worth refusing
 * before anything is persisted: an account other than the configured bot login, and the broadcast
 * channel itself while a split is active -- storing that would silently collapse the split into a
 * single account. The messages name both accounts and the way out.
 */
export function evaluateBotConnectLogin(args: {
  expectedBotLogin: string;
  broadcastChannelLogin: string;
  currentBotLogin: string;
  authenticatedLogin: string;
}): BotConnectVerdict {
  const authenticated = args.authenticatedLogin.trim();
  const expected = args.expectedBotLogin.trim();
  if (isValidTwitchLogin(expected) && !sameLogin(expected, authenticated)) {
    return {
      ok: false,
      reason: "wrong-account",
      message: `Twitch authorised ${authenticated || "an unknown account"}, but the bot account is set to ${expected}. Nothing was stored — sign in to Twitch as ${expected} and connect again.`
    };
  }
  const channel = args.broadcastChannelLogin.trim();
  const splitActive =
    isValidTwitchLogin(channel) && args.currentBotLogin.trim() !== "" && !sameLogin(channel, args.currentBotLogin);
  if (splitActive && sameLogin(channel, authenticated)) {
    return {
      ok: false,
      reason: "is-broadcast-channel",
      message: `Twitch authorised ${authenticated}, which is the broadcast channel itself. Nothing was stored — connect it under "Channel owner connection", or clear the broadcast channel to run with one account.`
    };
  }
  return { ok: true };
}

/**
 * The scopes a Twitch user token grants, from id.twitch.tv/oauth2/validate; null when Twitch did not
 * answer usefully (unreachable, rejected token). Callers cache per token -- a grant does not change
 * while the token lives.
 */
export async function readTwitchTokenScopes(
  accessToken: string,
  fetchImpl: (url: string, init?: { headers?: Record<string, string> }) => Promise<Response> = fetch
): Promise<string[] | null> {
  if (!accessToken) {
    return null;
  }
  try {
    // The validate endpoint wants the OAuth scheme; with Bearer it answers 401 for a good token.
    const response = await fetchImpl("https://id.twitch.tv/oauth2/validate", { headers: { Authorization: `OAuth ${accessToken}` } });
    if (!response.ok) {
      return null;
    }
    const payload = (await response.json()) as { scopes?: unknown };
    return Array.isArray(payload.scopes) ? payload.scopes.filter((scope): scope is string => typeof scope === "string") : null;
  } catch {
    return null;
  }
}

/** A per-token cache for readTwitchTokenScopes, so a page render or a worker cycle asks Twitch once per token. */
export function createTwitchTokenScopeCache(ttlMs = 10 * 60_000) {
  const entries = new Map<string, { scopes: string[] | null; at: number }>();
  return async (
    accessToken: string,
    fetchImpl?: (url: string, init?: { headers?: Record<string, string> }) => Promise<Response>
  ): Promise<string[] | null> => {
    if (!accessToken) {
      return null;
    }
    const cached = entries.get(accessToken);
    if (cached && Date.now() - cached.at < ttlMs) {
      return cached.scopes;
    }
    const scopes = await readTwitchTokenScopes(accessToken, fetchImpl);
    entries.clear();
    entries.set(accessToken, { scopes, at: Date.now() });
    return scopes;
  };
}

