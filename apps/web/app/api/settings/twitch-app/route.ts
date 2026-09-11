import { NextRequest, NextResponse } from "next/server";
import { requireApiRoles } from "@/lib/server/auth";
import { appendAuditEvent, readAppState, updateManagedConfigRecord } from "@/lib/server/state";

/**
 * The wizard's Twitch-credentials step.
 *
 * The broader secrets route rewrites every managed field from its form, which is right for the
 * settings page that displays them all and wrong for a wizard step that shows exactly two inputs.
 * This one touches only the Twitch application credentials; a blank secret keeps the stored one,
 * matching the settings page's convention for write-only fields.
 */
export async function PUT(request: NextRequest) {
  const unauthorized = await requireApiRoles(["owner", "admin"]);
  if (unauthorized) {
    return unauthorized;
  }

  const body = (await request.json()) as Partial<{ twitchClientId: string; twitchClientSecret: string }>;
  const twitchClientId = (body.twitchClientId ?? "").trim();
  const twitchClientSecret = (body.twitchClientSecret ?? "").trim();

  if (!twitchClientId) {
    return NextResponse.json({ message: "Provide the Twitch application's client id." }, { status: 400 });
  }

  const state = await readAppState();
  if (!twitchClientSecret && !state.managedConfig.twitchClientSecret) {
    return NextResponse.json({ message: "Provide the Twitch application's client secret." }, { status: 400 });
  }

  await updateManagedConfigRecord({
    ...state.managedConfig,
    twitchClientId,
    twitchClientSecret: twitchClientSecret || state.managedConfig.twitchClientSecret,
    updatedAt: new Date().toISOString()
  });

  await appendAuditEvent("settings.twitch-app.updated", "Twitch application credentials were updated from setup.");
  return NextResponse.json({ ok: true, message: "Twitch app credentials saved." });
}
