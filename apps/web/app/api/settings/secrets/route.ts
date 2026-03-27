import { NextRequest, NextResponse } from "next/server";
import { requireApiRoles } from "@/lib/server/auth";
import { appendAuditEvent, updateAppState } from "@/lib/server/state";

export async function PUT(request: NextRequest) {
  const unauthorized = await requireApiRoles(["owner", "admin"]);
  if (unauthorized) {
    return unauthorized;
  }

  const body = (await request.json()) as Partial<{
    twitchClientId: string;
    twitchClientSecret: string;
    twitchDefaultCategoryId: string;
    discordWebhookUrl: string;
    smtpHost: string;
    smtpPort: string;
    smtpUser: string;
    smtpPassword: string;
    smtpFrom: string;
    alertEmailTo: string;
  }>;

  const trim = (value: string | undefined) => (value ?? "").trim();

  await updateAppState((state) => ({
    ...state,
    managedConfig: {
      ...state.managedConfig,
      twitchClientId: trim(body.twitchClientId),
      twitchClientSecret: trim(body.twitchClientSecret) || state.managedConfig.twitchClientSecret,
      twitchDefaultCategoryId: trim(body.twitchDefaultCategoryId),
      discordWebhookUrl: trim(body.discordWebhookUrl) || state.managedConfig.discordWebhookUrl,
      smtpHost: trim(body.smtpHost),
      smtpPort: trim(body.smtpPort),
      smtpUser: trim(body.smtpUser),
      smtpPassword: trim(body.smtpPassword) || state.managedConfig.smtpPassword,
      smtpFrom: trim(body.smtpFrom),
      alertEmailTo: trim(body.alertEmailTo),
      updatedAt: new Date().toISOString()
    }
  }));

  await appendAuditEvent("settings.managed-config.updated", "Managed encrypted integration settings were updated.");
  return NextResponse.json({ ok: true, message: "Managed settings updated." });
}
