import { NextResponse } from "next/server";
import { getTwitchAuthorizeUrl } from "@/lib/server/twitch";

export async function GET() {
  const url = await getTwitchAuthorizeUrl("team-login");

  if (!url) {
    return NextResponse.json(
      { message: "APP_URL and Twitch client credentials must be configured first, either in .env or admin settings." },
      { status: 400 }
    );
  }

  return NextResponse.redirect(url);
}
