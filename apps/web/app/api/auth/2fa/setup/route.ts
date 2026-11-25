import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser, verifyPassword } from "@/lib/server/auth";
import { updateUserTwoFactorRecord } from "@/lib/server/state";
import { buildTwoFactorOtpAuthUri, generateTwoFactorSecret } from "@/lib/server/two-factor";

export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ message: "Authentication required." }, { status: 401 });
  }

  if (user.authProvider !== "local" || !user.passwordHash) {
    return NextResponse.json({ message: "Two-factor setup is only available for local accounts." }, { status: 400 });
  }

  // Setup starts over with a new secret and 2FA off, so with 2FA on it would replace the second factor
  // with only the password (M127). Turning it off needs a code from the authenticator; setup does not.
  if (user.twoFactorEnabled) {
    return alreadyEnabled();
  }

  const body = (await request.json()) as { password?: string };
  const password = body.password ?? "";
  if (!verifyPassword(password, user.passwordHash)) {
    return NextResponse.json({ message: "Invalid password." }, { status: 401 });
  }

  const secret = generateTwoFactorSecret();
  // Written only while the stored row still has 2FA off: the check above read the session's snapshot.
  if (!(await updateUserTwoFactorRecord(user.id, { enabled: false }, { enabled: false, secret, confirmedAt: "" }))) {
    return alreadyEnabled();
  }

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

function alreadyEnabled(): NextResponse {
  return NextResponse.json(
    { message: "Two-factor authentication is already enabled. Turn it off first (that needs a code from your authenticator)." },
    { status: 409 }
  );
}
