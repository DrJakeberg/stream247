import { NextRequest, NextResponse } from "next/server";
import { isValidTwitchLogin } from "@stream247/core";
import { requireApiRoles } from "@/lib/server/auth";
import { managedConfigSaveRefusal } from "@/lib/server/managed-config-save";
import { appendAuditEvent, updateManagedConfigRecord } from "@/lib/server/state";

export async function PUT(request: NextRequest) {
  const unauthorized = await requireApiRoles(["owner", "admin"]);
  if (unauthorized) {
    return unauthorized;
  }

  const body = (await request.json()) as Partial<{
    twitchClientId: string;
    twitchClientSecret: string;
    twitchDefaultCategoryId: string;
    twitchBroadcastChannelLogin: string;
    twitchEventsubSecret: string;
    discordWebhookUrl: string;
    smtpHost: string;
    smtpPort: string;
    smtpUser: string;
    smtpPassword: string;
    smtpFrom: string;
    alertEmailTo: string;
  }>;

  const trim = (value: string | undefined) => (value ?? "").trim();

  // Rejected rather than silently dropped: this login decides which channel chat joins and where
  // the public watch link points, so a typo that quietly fell back to the old behaviour would look
  // like the feature not working. Empty stays valid — it means "same as the connected identity".
  const broadcastChannelLogin = trim(body.twitchBroadcastChannelLogin);
  if (broadcastChannelLogin !== "" && !isValidTwitchLogin(broadcastChannelLogin)) {
    return NextResponse.json(
      {
        ok: false,
        message: "The broadcast channel must be a Twitch login: 4-25 letters, digits or underscores."
      },
      { status: 400 }
    );
  }

  try {
    await updateManagedConfigRecord((current) => ({
      ...current,
      twitchClientId: trim(body.twitchClientId),
      twitchClientSecret: trim(body.twitchClientSecret) || current.twitchClientSecret,
      twitchDefaultCategoryId: trim(body.twitchDefaultCategoryId),
      // Only when the request carries the field. Since 2.1 the broadcast channel is edited in the
      // Twitch accounts panel, and a credentials save that does not send it must not blank the
      // channel -- that would silently turn a split setup into "the bot's own channel".
      twitchBroadcastChannelLogin:
        "twitchBroadcastChannelLogin" in body ? broadcastChannelLogin : current.twitchBroadcastChannelLogin,
      // A secret like the client secret and the SMTP password: an empty field keeps the stored
      // value. The webhook signature check and the worker's subscription sync both resolve it
      // managed-first with TWITCH_EVENTSUB_SECRET as fallback.
      twitchEventsubSecret: trim(body.twitchEventsubSecret) || current.twitchEventsubSecret,
      discordWebhookUrl: trim(body.discordWebhookUrl) || current.discordWebhookUrl,
      smtpHost: trim(body.smtpHost),
      smtpPort: trim(body.smtpPort),
      smtpUser: trim(body.smtpUser),
      smtpPassword: trim(body.smtpPassword) || current.smtpPassword,
      smtpFrom: trim(body.smtpFrom),
      alertEmailTo: trim(body.alertEmailTo),
      updatedAt: new Date().toISOString()
    }));
  } catch (error) {
    return managedConfigSaveRefusal(error);
  }

  await appendAuditEvent("settings.managed-config.updated", "Managed encrypted integration settings were updated.");
  return NextResponse.json({ ok: true, message: "Managed settings updated." });
}
