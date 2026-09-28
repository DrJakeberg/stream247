import { NextRequest, NextResponse } from "next/server";
import { isValidTwitchLogin } from "@stream247/core";
import { requireApiRoles } from "@/lib/server/auth";
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
  await updateManagedConfigRecord({
    ...state.managedConfig,
    twitchBroadcastChannelLogin: channel,
    twitchBotLogin: bot,
    updatedAt: new Date().toISOString()
  });

  await appendAuditEvent(
    "settings.twitch-accounts.updated",
    `Twitch accounts: broadcast channel ${channel || "(not set: the bot's own channel)"}, bot account ${bot || "(any)"}.`
  );
  return NextResponse.json({ ok: true, message: "Twitch accounts updated.", broadcastChannelLogin: channel, botLogin: bot });
}
