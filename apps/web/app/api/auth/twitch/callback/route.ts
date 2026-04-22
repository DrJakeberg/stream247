import { NextRequest, NextResponse } from "next/server";
import { buildWorkspaceHref } from "@/lib/workspace-navigation";
import { setSessionCookie } from "@/lib/server/auth";
import { exchangeTwitchLoginCode, getAbsoluteAppUrl, recordTwitchError } from "@/lib/server/twitch";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const error = request.nextUrl.searchParams.get("error");

  if (error) {
    await recordTwitchError(`Twitch team login failed: ${error}.`);
    return NextResponse.redirect(getAbsoluteAppUrl("/login?error=twitch"));
  }

  if (!code) {
    await recordTwitchError("Twitch team login callback did not include an authorization code.");
    return NextResponse.redirect(getAbsoluteAppUrl("/login?error=missing-code"));
  }

  try {
    const user = await exchangeTwitchLoginCode(code);
    await setSessionCookie(user.id);
    return NextResponse.redirect(getAbsoluteAppUrl(buildWorkspaceHref("live")));
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : "Unknown Twitch login callback failure.";
    await recordTwitchError(message);
    return NextResponse.redirect(getAbsoluteAppUrl("/login?error=unauthorized"));
  }
}
