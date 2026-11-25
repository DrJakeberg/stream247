import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/server/auth";
import { updateUserTwoFactorRecord } from "@/lib/server/state";
import { verifyTotpCode } from "@/lib/server/two-factor";

export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ message: "Authentication required." }, { status: 401 });
  }

  if (user.authProvider !== "local" || !user.twoFactorSecret) {
    return NextResponse.json({ message: "Start two-factor setup before confirming it." }, { status: 400 });
  }

  const body = (await request.json()) as { code?: string };
  const code = body.code ?? "";
  if (!verifyTotpCode(user.twoFactorSecret, code)) {
    return NextResponse.json({ message: "Invalid one-time code." }, { status: 401 });
  }

  // Only the 2FA columns, and only while the stored secret is the one the code was checked against
  // (M127): a whole-row write of the session's snapshot undid a password change made in between.
  const confirmed = await updateUserTwoFactorRecord(
    user.id,
    { enabled: false, secret: user.twoFactorSecret },
    { enabled: true, confirmedAt: new Date().toISOString() }
  );
  if (!confirmed) {
    return NextResponse.json({ message: "Two-factor settings changed in the meantime. Reload the page and try again." }, { status: 409 });
  }

  return NextResponse.json({ ok: true, message: "Two-factor authentication is now enabled." });
}
