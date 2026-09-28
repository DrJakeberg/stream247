import { NextRequest, NextResponse } from "next/server";
import { isValidTwitchLogin } from "@stream247/core";
import { requireApiRoles } from "@/lib/server/auth";
import { resolveTwitchAccountsForState } from "@stream247/db";
import { appendAuditEvent, readAppState, updateManagedConfigRecord } from "@/lib/server/state";

// The two Twitch accounts of the Twitch accounts panel (2.1, M69): the broadcast channel (where the
// stream key sends video and viewers watch) and the login the bot/moderator account must be. Only the
// fields a request carries are written, so the panel can save one card without touching the other.
export async function PUT(request: NextRequest) {
  const unauthorized = await requireApiRoles(["owner", "admin"]);
  if (unauthorized) {
    return unauthorized;
  }

  const body = (await request.json()) as Partial<{ broadcastChannelLogin: string; botLogin: string }>;
  const fields: Array<{ key: "broadcastChannelLogin" | "botLogin"; label: string }> = [
    { key: "broadcastChannelLogin", label: "broadcast channel" },
    { key: "botLogin", label: "bot account" }
  ];
  for (const field of fields) {
    const value = typeof body[field.key] === "string" ? body[field.key]!.trim() : "";
    if (value !== "" && !isValidTwitchLogin(value)) {
      return NextResponse.json(
        { ok: false, message: `The ${field.label} must be a Twitch login: 4-25 letters, digits or underscores.` },
        { status: 400 }
      );
    }
  }

  const has = (key: "broadcastChannelLogin" | "botLogin") => typeof body[key] === "string";
  const state = await readAppState();
  const channel = has("broadcastChannelLogin") ? body.broadcastChannelLogin!.trim() : state.managedConfig.twitchBroadcastChannelLogin;
  const bot = has("botLogin") ? body.botLogin!.trim() : state.managedConfig.twitchBotLogin;
  const managedConfig = { ...state.managedConfig, twitchBroadcastChannelLogin: channel, twitchBotLogin: bot, updatedAt: new Date().toISOString() };
  await updateManagedConfigRecord(managedConfig);

  // What is now in effect, not what was typed: an empty field falls back to TWITCH_BROADCAST_CHANNEL_LOGIN
  // / TWITCH_BOT_LOGIN when the server sets them (M69 review).
  const effective = resolveTwitchAccountsForState({ ...state, managedConfig }, process.env);
  const channelText =
    effective.channel.source === "settings" || effective.channel.source === "env"
      ? `${effective.channel.login}${effective.channel.source === "env" ? " (from TWITCH_BROADCAST_CHANNEL_LOGIN)" : ""}`
      : "(not set: the bot account's own channel)";
  const botText = effective.bot.expectedLogin
    ? `${effective.bot.expectedLogin}${effective.bot.expectedSource === "env" ? " (from TWITCH_BOT_LOGIN)" : ""}`
    : "(any)";
  await appendAuditEvent("settings.twitch-accounts.updated", `Twitch accounts: broadcast channel ${channelText}, bot account ${botText}.`);
  return NextResponse.json({
    ok: true,
    message: "Twitch accounts updated.",
    broadcastChannelLogin: effective.channel.source === "settings" || effective.channel.source === "env" ? effective.channel.login : "",
    botLogin: effective.bot.expectedLogin
  });
}
