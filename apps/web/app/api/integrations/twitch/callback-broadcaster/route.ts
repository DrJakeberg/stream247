import { NextResponse, type NextRequest } from "next/server";
import { buildWorkspaceHref } from "@/lib/workspace-navigation";
import { consumeOAuthState, describeOAuthStateFailure } from "@/lib/server/oauth-state";
import { readAppState } from "@/lib/server/state";
import { exchangeTwitchBroadcasterCode, getAbsoluteAppUrl, recordTwitchBroadcasterError } from "@/lib/server/twitch";
import { requireApiRoles } from "@/lib/server/auth";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const error = request.nextUrl.searchParams.get("error");
  const presentedState = request.nextUrl.searchParams.get("state");

  // Read once for URL building; the exchange below rewrites the broadcaster slot but not the app
  // base URL the redirects are built from.
  const appState = await readAppState();

  // Filling the broadcaster slot flips the metadata sync gate, so the same bar as the identity
  // callback applies: never reachable by an unauthenticated caller.
  const denied = await requireApiRoles(["owner", "admin"]);
  if (denied) {
    // The state cookie is single-use; drop it so a rejected attempt cannot be replayed.
    await consumeOAuthState("broadcast-channel-connect", presentedState);
    return denied;
  }

  const stateVerdict = await consumeOAuthState("broadcast-channel-connect", presentedState);
  if (!stateVerdict.ok) {
    await recordTwitchBroadcasterError(describeOAuthStateFailure(stateVerdict.reason));
    return NextResponse.redirect(getAbsoluteAppUrl(appState, buildWorkspaceHref("live", "status")));
  }

  if (error) {
    await recordTwitchBroadcasterError(`Twitch broadcaster authorization failed: ${error}.`);
    return NextResponse.redirect(getAbsoluteAppUrl(appState, buildWorkspaceHref("live", "status")));
  }

  if (!code) {
    await recordTwitchBroadcasterError("Twitch broadcaster callback did not include an authorization code.");
    return NextResponse.redirect(getAbsoluteAppUrl(appState, buildWorkspaceHref("live", "status")));
  }

  try {
    // Exchanges the code and stores into the broadcaster slot only when the authorised login
    // matches the configured broadcast channel; a mismatch throws and stores nothing.
    await exchangeTwitchBroadcasterCode(code);
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : "Unknown Twitch broadcaster callback failure.";
    await recordTwitchBroadcasterError(message);
  }

  return NextResponse.redirect(getAbsoluteAppUrl(appState, buildWorkspaceHref("live", "status")));
}
