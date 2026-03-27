import { NextResponse } from "next/server";
import { getTwitchAuthorizeUrl } from "@/lib/server/twitch";

export async function GET() {
  const url = getTwitchAuthorizeUrl("team-login");

  if (!url) {
    return NextResponse.json(
      { message: "APP_URL, TWITCH_CLIENT_ID, and TWITCH_CLIENT_SECRET must be configured first." },
      { status: 400 }
    );
  }

  return NextResponse.redirect(url);
}

