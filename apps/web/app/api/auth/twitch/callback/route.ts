import { NextRequest, NextResponse } from "next/server";
import { setSessionCookie } from "@/lib/server/auth";
import { exchangeTwitchLoginCode, recordTwitchError } from "@/lib/server/twitch";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const error = request.nextUrl.searchParams.get("error");

  if (error) {
    await recordTwitchError(`Twitch team login failed: ${error}.`);
    return NextResponse.redirect(new URL("/login?error=twitch", request.url));
  }

  if (!code) {
    await recordTwitchError("Twitch team login callback did not include an authorization code.");
    return NextResponse.redirect(new URL("/login?error=missing-code", request.url));
  }

  try {
    const user = await exchangeTwitchLoginCode(code);
    await setSessionCookie(user.id);
    return NextResponse.redirect(new URL("/dashboard", request.url));
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : "Unknown Twitch login callback failure.";
    await recordTwitchError(message);
    return NextResponse.redirect(new URL("/login?error=unauthorized", request.url));
  }
}
