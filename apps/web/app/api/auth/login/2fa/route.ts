import { NextRequest, NextResponse } from "next/server";
import { parseTwoFactorChallengeValue, sessionPasswordHash, setSessionCookie } from "@/lib/server/auth";
import { findUserById, readAppState, recordUserSignIn } from "@/lib/server/state";
import { verifyTotpCode } from "@/lib/server/two-factor";
import { TWO_FACTOR_RATE_LIMIT, consumeRateLimit, resetRateLimit } from "@/lib/server/rate-limit";
import { PREAUTH_BODY_LIMIT_BYTES, bodyTooLargeResponse, readBoundedText } from "@/lib/server/bounded-body";

export async function POST(request: NextRequest) {
  // Anonymous callers reach this, so the body is bounded before anything else reads or counts it.
  const rawBody = await readBoundedText(request, PREAUTH_BODY_LIMIT_BYTES);
  if (rawBody === null) {
    return bodyTooLargeResponse();
  }
  const body = JSON.parse(rawBody) as { challengeToken?: string; code?: string };
  const challenge = parseTwoFactorChallengeValue(body.challengeToken);
  const code = body.code ?? "";

  if (!challenge) {
    return NextResponse.json({ message: "The two-factor challenge is invalid or expired." }, { status: 401 });
  }

  // A six-digit TOTP is only 10^6 codes, and the verifier accepts a +/-1 step window. Unthrottled,
  // that is guessable. Keyed on the account under attack, which the attacker cannot rotate.
  const limitKey = `2fa:${challenge.userId}`;
  const limit = consumeRateLimit(limitKey, TWO_FACTOR_RATE_LIMIT);
  if (!limit.allowed) {
    return NextResponse.json(
      { message: "Too many one-time code attempts. Try again later." },
      { status: 429, headers: { "retry-after": String(limit.retryAfterSeconds) } }
    );
  }

  const state = await readAppState();
  const user = findUserById(state, challenge.userId);
  if (!user || user.authProvider !== "local" || !user.twoFactorEnabled || !user.twoFactorSecret) {
    return NextResponse.json({ message: "Two-factor authentication is not available for this account." }, { status: 400 });
  }

  if (!verifyTotpCode(user.twoFactorSecret, code)) {
    return NextResponse.json({ message: "Invalid one-time code." }, { status: 401 });
  }

  resetRateLimit(limitKey);

  // Only the sign-in time (M127): the row read above may be older than a password or 2FA change
  // committed since, and writing it back undid that change.
  if (!(await recordUserSignIn(user.id, new Date().toISOString()))) {
    return NextResponse.json({ message: "Two-factor authentication is not available for this account." }, { status: 400 });
  }

  await setSessionCookie(user.id, sessionPasswordHash(user, state), user.sessionEpoch ?? 0);
  return NextResponse.json({ ok: true });
}
