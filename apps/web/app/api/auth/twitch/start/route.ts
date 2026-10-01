import { NextResponse } from "next/server";
import { getTwitchAuthorizeUrl } from "@/lib/server/twitch";

/**
 * Starts the Twitch sign-in flow for team members.
 *
 * Deliberately unauthenticated: this is the pre-auth path, and it is what /login links to. It
 * exists as a route rather than a URL built on the page because issuing the single-use state writes
 * a cookie, which Next.js only permits in a Route Handler or Server Action — doing it during render
 * made /login return 500 on every workspace that had Twitch configured.
 */
export async function GET() {
  const url = await getTwitchAuthorizeUrl("team-login");

  if (!url) {
    return NextResponse.json({ message: "Twitch sign-in is not configured for this workspace." }, { status: 400 });
  }

  return NextResponse.redirect(url);
}
