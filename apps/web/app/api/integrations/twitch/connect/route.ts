import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/server/auth";
import { getTwitchAuthorizeUrl } from "@/lib/server/twitch";

export async function GET() {
  const unauthorized = await requireApiAuth();
  if (unauthorized) {
    return unauthorized;
  }

  const url = getTwitchAuthorizeUrl();

  if (!url) {
    return NextResponse.json(
      { message: "APP_URL, TWITCH_CLIENT_ID, and TWITCH_CLIENT_SECRET must be configured first." },
      { status: 400 }
    );
  }

  return NextResponse.redirect(url);
}
