import { NextRequest, NextResponse } from "next/server";
import { exchangeTwitchCode, getAbsoluteAppUrl, recordTwitchError } from "@/lib/server/twitch";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const error = request.nextUrl.searchParams.get("error");

  if (error) {
    await recordTwitchError(`Twitch authorization failed: ${error}.`);
    return NextResponse.redirect(getAbsoluteAppUrl("/dashboard"));
  }

  if (!code) {
    await recordTwitchError("Twitch callback did not include an authorization code.");
    return NextResponse.redirect(getAbsoluteAppUrl("/dashboard"));
  }

  try {
    await exchangeTwitchCode(code);
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : "Unknown Twitch callback failure.";
    await recordTwitchError(message);
  }

  return NextResponse.redirect(getAbsoluteAppUrl("/dashboard"));
}
