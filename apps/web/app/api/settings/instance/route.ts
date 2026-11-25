import { NextRequest, NextResponse } from "next/server";
import { VIEWER_LOCALES } from "@stream247/core";
import { isUsableTimeZone } from "@stream247/db";
import { requireApiRoles } from "@/lib/server/auth";
import { managedConfigSaveRefusal } from "@/lib/server/managed-config-save";
import { appendAuditEvent, updateManagedConfigRecord } from "@/lib/server/state";

/**
 * Instance basics from the setup wizard: the public app URL, the channel timezone, and the channel
 * language (M80; also saved alone from the settings page).
 *
 * Unlike the secrets route, absent fields keep their stored value — the wizard submits only what
 * its form shows, and it must not clear settings it never displayed.
 */
export async function PUT(request: NextRequest) {
  const unauthorized = await requireApiRoles(["owner", "admin"]);
  if (unauthorized) {
    return unauthorized;
  }

  const body = (await request.json()) as Partial<{ appUrl: string; channelTimezone: string; channelLanguage: string }>;
  // Only the fields the request carries; the rest stay as stored when the save runs.
  const updates: { appUrl?: string; channelTimezone?: string; channelLanguage?: string } = {};

  if (typeof body.appUrl === "string") {
    const appUrl = body.appUrl.trim().replace(/\/+$/, "");
    if (appUrl) {
      // Validated here because everything downstream — OAuth redirect URIs, EventSub callbacks,
      // overlay links — quietly builds broken URLs out of a bad base instead of failing.
      let parsed: URL;
      try {
        parsed = new URL(appUrl);
      } catch {
        return NextResponse.json({ message: "The public URL must be a full http(s) URL." }, { status: 400 });
      }
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return NextResponse.json({ message: "The public URL must use http or https." }, { status: 400 });
      }
    }
    updates.appUrl = appUrl;
  }

  if (typeof body.channelTimezone === "string") {
    const channelTimezone = body.channelTimezone.trim();
    if (channelTimezone && !isUsableTimeZone(channelTimezone)) {
      return NextResponse.json(
        { message: `"${channelTimezone}" is not a usable IANA timezone name (like Europe/Berlin).` },
        { status: 400 }
      );
    }
    updates.channelTimezone = channelTimezone;
  }

  if (typeof body.channelLanguage === "string") {
    const channelLanguage = body.channelLanguage.trim().toLowerCase();
    // Refused rather than coerced: the readers would quietly speak English for an unknown value,
    // and an operator who asked for something else should hear why it did not happen.
    if (channelLanguage && !(VIEWER_LOCALES as readonly string[]).includes(channelLanguage)) {
      return NextResponse.json(
        { message: `"${channelLanguage}" is not a channel language. Choose one of: ${VIEWER_LOCALES.join(", ")}.` },
        { status: 400 }
      );
    }
    updates.channelLanguage = channelLanguage;
  }

  try {
    await updateManagedConfigRecord((current) => ({ ...current, ...updates, updatedAt: new Date().toISOString() }));
  } catch (error) {
    return managedConfigSaveRefusal(error);
  }

  await appendAuditEvent(
    "settings.instance.updated",
    "Instance basics (public URL, timezone, channel language) were updated."
  );
  return NextResponse.json({ ok: true, message: "Instance basics saved." });
}
