import { NextRequest, NextResponse } from "next/server";
import { exchangeTwitchCode, recordTwitchError } from "@/lib/server/twitch";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const error = request.nextUrl.searchParams.get("error");

  if (error) {
    await recordTwitchError(`Twitch authorization failed: ${error}.`);
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  if (!code) {
    await recordTwitchError("Twitch callback did not include an authorization code.");
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  try {
    await exchangeTwitchCode(code);
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : "Unknown Twitch callback failure.";
    await recordTwitchError(message);
  }

  return NextResponse.redirect(new URL("/dashboard", request.url));
}
