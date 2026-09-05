import { NextRequest, NextResponse } from "next/server";
import { isUsableTimeZone } from "@stream247/db";
import { requireApiRoles } from "@/lib/server/auth";
import { appendAuditEvent, readAppState, updateManagedConfigRecord } from "@/lib/server/state";

/**
 * Instance basics from the setup wizard: the public app URL and the channel timezone.
 *
 * Unlike the secrets route, absent fields keep their stored value — the wizard submits only what
 * its form shows, and it must not clear settings it never displayed.
 */
export async function PUT(request: NextRequest) {
  const unauthorized = await requireApiRoles(["owner", "admin"]);
  if (unauthorized) {
    return unauthorized;
  }

  const body = (await request.json()) as Partial<{ appUrl: string; channelTimezone: string }>;
  const state = await readAppState();

  let appUrl = state.managedConfig.appUrl;
  if (typeof body.appUrl === "string") {
    appUrl = body.appUrl.trim().replace(/\/+$/, "");
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
  }

  let channelTimezone = state.managedConfig.channelTimezone;
  if (typeof body.channelTimezone === "string") {
    channelTimezone = body.channelTimezone.trim();
    if (channelTimezone && !isUsableTimeZone(channelTimezone)) {
      return NextResponse.json(
        { message: `"${channelTimezone}" is not a usable IANA timezone name (like Europe/Berlin).` },
        { status: 400 }
      );
    }
  }

  await updateManagedConfigRecord({
    ...state.managedConfig,
    appUrl,
    channelTimezone,
    updatedAt: new Date().toISOString()
  });

  await appendAuditEvent("settings.instance.updated", "Instance basics (public URL, timezone) were updated.");
  return NextResponse.json({ ok: true, message: "Instance basics saved." });
}
