import { NextResponse } from "next/server";
import { isBroadcastChannelSplit } from "@stream247/core";
import { requireApiRoles } from "@/lib/server/auth";
import { getManagedTwitchConfig, readAppState } from "@/lib/server/state";
import { getTwitchAuthorizeUrl } from "@/lib/server/twitch";

export async function GET() {
  const unauthorized = await requireApiRoles(["owner", "admin"]);
  if (unauthorized) {
    return unauthorized;
  }

  // Without a split there is no broadcaster slot to fill — the identity connection already owns
  // the broadcast channel. Refusing here keeps the flow unreachable in exactly the setups where
  // completing it could only store a redundant or wrong token.
  const state = await readAppState();
  const split = isBroadcastChannelSplit({
    configuredLogin: getManagedTwitchConfig(state).broadcastChannelLogin,
    identityLogin: state.twitch.broadcasterLogin
  });

  if (!split) {
    return NextResponse.json(
      {
        message:
          "No broadcast channel split is configured. Set a broadcast channel login that differs from the connected identity before connecting the broadcaster account."
      },
      { status: 400 }
    );
  }

  const url = await getTwitchAuthorizeUrl("broadcast-channel-connect");

  if (!url) {
    return NextResponse.json(
      { message: "APP_URL and Twitch client credentials must be configured first, either in .env or admin settings." },
      { status: 400 }
    );
  }

  return NextResponse.redirect(url);
}
