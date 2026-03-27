import { NextResponse } from "next/server";
import { requireApiRoles } from "@/lib/server/auth";
import { getTwitchAuthorizeUrl } from "@/lib/server/twitch";

export async function GET() {
  const unauthorized = await requireApiRoles(["owner", "admin"]);
  if (unauthorized) {
    return unauthorized;
  }

  const url = await getTwitchAuthorizeUrl("broadcaster-connect");

  if (!url) {
    return NextResponse.json(
      { message: "APP_URL and Twitch client credentials must be configured first, either in .env or admin settings." },
      { status: 400 }
    );
  }

  return NextResponse.redirect(url);
}
