import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser, verifyPassword } from "@/lib/server/auth";
import { upsertUserRecord } from "@/lib/server/state";
import { verifyTotpCode } from "@/lib/server/two-factor";

export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ message: "Authentication required." }, { status: 401 });
  }

  if (user.authProvider !== "local" || !user.passwordHash || !user.twoFactorEnabled || !user.twoFactorSecret) {
    return NextResponse.json({ message: "Two-factor authentication is not enabled for this account." }, { status: 400 });
  }

  const body = (await request.json()) as { password?: string; code?: string };
  const password = body.password ?? "";
  const code = body.code ?? "";

  if (!verifyPassword(password, user.passwordHash)) {
    return NextResponse.json({ message: "Invalid password." }, { status: 401 });
  }

  if (!verifyTotpCode(user.twoFactorSecret, code)) {
    return NextResponse.json({ message: "Invalid one-time code." }, { status: 401 });
  }

  await upsertUserRecord({
    ...user,
    twoFactorEnabled: false,
    twoFactorSecret: "",
    twoFactorConfirmedAt: ""
  });

  return NextResponse.json({ ok: true, message: "Two-factor authentication has been disabled." });
}
