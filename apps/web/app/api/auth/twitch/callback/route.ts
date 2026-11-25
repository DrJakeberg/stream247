import { NextRequest, NextResponse } from "next/server";
import { stripInvisibleCharacters } from "@stream247/core";
import { buildWorkspaceHref } from "@/lib/workspace-navigation";
import { consumeOAuthState, describeOAuthStateFailure } from "@/lib/server/oauth-state";
import { sessionPasswordHash, setSessionCookie } from "@/lib/server/auth";
import { appendAuditEvent, readAppState } from "@/lib/server/state";
import { claimTeamLoginFailureAudit } from "@/lib/server/team-login-audit-throttle";
import {
  exchangeTwitchLoginCode,
  getAbsoluteAppUrl,
  TwitchLoginNotAuthorizedError
} from "@/lib/server/twitch";

// A team member signing in is a connect attempt of its own, and a failed one is no evidence about the
// workspace's stored Twitch connection — it is about somebody else's session entirely. So a failure
// here leaves the identity connection row alone.
//
// Every failure below is one an anonymous client can repeat at will (M127): /api/auth/twitch/login
// hands out a fresh state cookie, and a made-up code fails the exchange. So the audit row is throttled
// per kind of failure, and it has its own type, "twitch.login_rejected", which the protected retention
// window does not keep: a flood of these cannot push sign-ins, grants or deletions out of the trail.

function summary(text: string, maxLength: number): string {
  return stripInvisibleCharacters(text).replace(/[\r\n]+/g, " ").trim().slice(0, maxLength);
}

async function recordTeamLoginFailure(reason: string, detail: string): Promise<void> {
  const suppressed = claimTeamLoginFailureAudit(reason, Date.now());
  if (suppressed === null) {
    return;
  }
  const more = suppressed > 0 ? ` (${suppressed} more of this kind since the last such row)` : "";
  await appendAuditEvent("twitch.login_rejected", `Team sign-in with Twitch was refused: ${detail}${more}`);
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const error = request.nextUrl.searchParams.get("error");

  // Read once for URL building: the redirect targets do not depend on anything the exchange below
  // changes, and the app base URL cannot change mid-request.
  const state = await readAppState();

  // This callback mints a session cookie, so it must only honour a flow this workspace started.
  const stateVerdict = await consumeOAuthState("team-login", request.nextUrl.searchParams.get("state"));
  if (!stateVerdict.ok) {
    await recordTeamLoginFailure(stateVerdict.reason, describeOAuthStateFailure(stateVerdict.reason));
    return NextResponse.redirect(getAbsoluteAppUrl(state, "/login?error=state"));
  }

  if (error) {
    // The caller chose this text, so it is sanitised and bounded before it enters the audit log.
    await recordTeamLoginFailure("twitch-error", `Twitch answered ${summary(error, 80)}.`);
    return NextResponse.redirect(getAbsoluteAppUrl(state, "/login?error=twitch"));
  }

  if (!code) {
    await recordTeamLoginFailure("missing-code", "the callback did not include an authorization code.");
    return NextResponse.redirect(getAbsoluteAppUrl(state, "/login?error=missing-code"));
  }

  try {
    const user = await exchangeTwitchLoginCode(code);
    await setSessionCookie(user.id, sessionPasswordHash(user, state), user.sessionEpoch ?? 0);
    return NextResponse.redirect(getAbsoluteAppUrl(state, buildWorkspaceHref("live")));
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : "Unknown Twitch login callback failure.";
    // A Twitch account without a grant has its own kind: only a completed Twitch sign-in produces it,
    // so made-up codes, which anybody can send, never take its row.
    await recordTeamLoginFailure(
      caught instanceof TwitchLoginNotAuthorizedError ? "not-authorized" : "exchange-failed",
      summary(message, 200)
    );
    return NextResponse.redirect(getAbsoluteAppUrl(state, "/login?error=unauthorized"));
  }
}
