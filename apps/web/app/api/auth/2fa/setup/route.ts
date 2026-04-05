import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser, verifyPassword } from "@/lib/server/auth";
import { upsertUserRecord } from "@/lib/server/state";
import { buildTwoFactorOtpAuthUri, generateTwoFactorSecret } from "@/lib/server/two-factor";

export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ message: "Authentication required." }, { status: 401 });
  }

  if (user.authProvider !== "local" || !user.passwordHash) {
    return NextResponse.json({ message: "Two-factor setup is only available for local accounts." }, { status: 400 });
  }

  const body = (await request.json()) as { password?: string };
  const password = body.password ?? "";
  if (!verifyPassword(password, user.passwordHash)) {
    return NextResponse.json({ message: "Invalid password." }, { status: 401 });
  }

  const secret = generateTwoFactorSecret();
  const updatedUser = {
    ...user,
    twoFactorEnabled: false,
    twoFactorSecret: secret,
    twoFactorConfirmedAt: ""
  };

  await upsertUserRecord(updatedUser);

  return NextResponse.json({
    ok: true,
    secret,
    otpAuthUri: buildTwoFactorOtpAuthUri({
      issuer: "Stream247",
      accountName: user.email,
      secret
    })
  });
}
