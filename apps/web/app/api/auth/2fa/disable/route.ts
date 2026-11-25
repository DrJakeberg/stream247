import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser, verifyPassword } from "@/lib/server/auth";
import { updateUserTwoFactorRecord } from "@/lib/server/state";
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

  // Only the 2FA columns, and only while the stored secret is the one the code was checked against
  // (M127). The stored secret stays, as it did when the whole-row write left an empty secret unwritten.
  const disabled = await updateUserTwoFactorRecord(
    user.id,
    { enabled: true, secret: user.twoFactorSecret },
    { enabled: false, confirmedAt: "" }
  );
  if (!disabled) {
    return NextResponse.json({ message: "Two-factor settings changed in the meantime. Reload the page and try again." }, { status: 409 });
  }

  return NextResponse.json({ ok: true, message: "Two-factor authentication has been disabled." });
}
