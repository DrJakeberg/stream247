import { NextRequest, NextResponse } from "next/server";
import { parseTwoFactorChallengeValue, setSessionCookie } from "@/lib/server/auth";
import { findUserById, readAppState, upsertUserRecord } from "@/lib/server/state";
import { verifyTotpCode } from "@/lib/server/two-factor";

export async function POST(request: NextRequest) {
  const body = (await request.json()) as { challengeToken?: string; code?: string };
  const challenge = parseTwoFactorChallengeValue(body.challengeToken);
  const code = body.code ?? "";

  if (!challenge) {
    return NextResponse.json({ message: "The two-factor challenge is invalid or expired." }, { status: 401 });
  }

  const state = await readAppState();
  const user = findUserById(state, challenge.userId);
  if (!user || user.authProvider !== "local" || !user.twoFactorEnabled || !user.twoFactorSecret) {
    return NextResponse.json({ message: "Two-factor authentication is not available for this account." }, { status: 400 });
  }

  if (!verifyTotpCode(user.twoFactorSecret, code)) {
    return NextResponse.json({ message: "Invalid one-time code." }, { status: 401 });
  }

  await upsertUserRecord({
    ...user,
    lastLoginAt: new Date().toISOString()
  });

  await setSessionCookie(user.id);
  return NextResponse.json({ ok: true });
}
