import { NextRequest, NextResponse } from "next/server";
import { buildWorkspaceHref } from "@/lib/workspace-navigation";
import { consumeOAuthState, describeOAuthStateFailure } from "@/lib/server/oauth-state";
import { exchangeTwitchCode, getAbsoluteAppUrl, recordTwitchError } from "@/lib/server/twitch";
import { requireApiRoles } from "@/lib/server/auth";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const error = request.nextUrl.searchParams.get("error");
  const presentedState = request.nextUrl.searchParams.get("state");

  // Connecting a broadcaster rewrites the workspace's Twitch identity, and the SSO path derives the
  // "owner" role from it. This must never be reachable by an unauthenticated caller.
  const denied = await requireApiRoles(["owner", "admin"]);
  if (denied) {
    // The state cookie is single-use; drop it so a rejected attempt cannot be replayed.
    await consumeOAuthState("broadcaster-connect", presentedState);
    return denied;
  }

  const stateVerdict = await consumeOAuthState("broadcaster-connect", presentedState);
  if (!stateVerdict.ok) {
    await recordTwitchError(describeOAuthStateFailure(stateVerdict.reason));
    return NextResponse.redirect(getAbsoluteAppUrl(buildWorkspaceHref("live", "status")));
  }

  if (error) {
    await recordTwitchError(`Twitch authorization failed: ${error}.`);
    return NextResponse.redirect(getAbsoluteAppUrl(buildWorkspaceHref("live", "status")));
  }

  if (!code) {
    await recordTwitchError("Twitch callback did not include an authorization code.");
    return NextResponse.redirect(getAbsoluteAppUrl(buildWorkspaceHref("live", "status")));
  }

  try {
    await exchangeTwitchCode(code);
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : "Unknown Twitch callback failure.";
    await recordTwitchError(message);
  }

  return NextResponse.redirect(getAbsoluteAppUrl(buildWorkspaceHref("live", "status")));
}
