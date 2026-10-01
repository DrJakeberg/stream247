import { NextRequest, NextResponse } from "next/server";
import { buildTwoFactorChallengeValue, setSessionCookie, verifyPassword } from "@/lib/server/auth";
import { findUserByEmail, readAppState, upsertUserRecord } from "@/lib/server/state";
import { LOGIN_RATE_LIMIT, consumeRateLimit, getClientIdentifier, resetRateLimit } from "@/lib/server/rate-limit";

export async function POST(request: NextRequest) {
  const body = (await request.json()) as { email?: string; password?: string };
  const email = (body.email ?? "").trim().toLowerCase();
  const password = body.password ?? "";

  // Keyed on the targeted account as well as the client, so rotating source addresses does not
  // buy an attacker more attempts against one account.
  const limitKey = `login:${email}:${getClientIdentifier(request.headers)}`;
  const limit = consumeRateLimit(limitKey, LOGIN_RATE_LIMIT);
  if (!limit.allowed) {
    return NextResponse.json(
      { message: "Too many sign-in attempts. Try again later." },
      { status: 429, headers: { "retry-after": String(limit.retryAfterSeconds) } }
    );
  }

  const state = await readAppState();
  const user = findUserByEmail(state, email);
  const passwordHash = user?.passwordHash || state.owner?.passwordHash || "";

  if (!state.owner || state.owner.email !== email || !user || !verifyPassword(password, passwordHash)) {
    return NextResponse.json({ message: "Invalid email or password." }, { status: 401 });
  }

  // A correct password clears the counter, so a user who fumbled a few times is not locked out.
  resetRateLimit(limitKey);

  // Fail closed: a 2FA secret that exists but cannot be decrypted with the current APP_SECRET is
  // not "no 2FA". Before this, a lost or rotated secret silently skipped the second factor.
  if (user.authProvider === "local" && user.twoFactorEnabled && user.twoFactorSecretUnreadable) {
    return NextResponse.json(
      {
        ok: false,
        message:
          "Two-factor authentication is enabled for this account, but its secret cannot be decrypted with the current APP_SECRET. Restore the APP_SECRET that encrypted it (env APP_SECRET or the persisted secret file on the data volume). An administrator with database access can otherwise clear two_factor_enabled for this user."
      },
      { status: 423 }
    );
  }

  if (user.authProvider === "local" && user.twoFactorEnabled && user.twoFactorSecret) {
    return NextResponse.json(
      {
        ok: false,
        requiresTwoFactor: true,
        challengeToken: buildTwoFactorChallengeValue(user.id)
      },
      { status: 202 }
    );
  }

  await upsertUserRecord({
    ...user,
    lastLoginAt: new Date().toISOString()
  });

  await setSessionCookie(user.id);
  return NextResponse.json({ ok: true });
}
