import { NextRequest, NextResponse } from "next/server";
import { MIN_OWNER_PASSWORD_LENGTH } from "@stream247/db";
import { getAuthenticatedUser, hashPassword, verifyPassword } from "@/lib/server/auth";
import { appendAuditEvent, readAppState, setOwnerPasswordHash } from "@/lib/server/state";
import { LOGIN_RATE_LIMIT, consumeRateLimit, getClientIdentifier, resetRateLimit } from "@/lib/server/rate-limit";

/**
 * Changes the owner password (M91, owner decision 2026-10-01): signed in as the local owner and with the
 * current password. A lost password is reset on the host instead (docs/operations.md); there is no
 * e-mail reset.
 */
export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ message: "Authentication required." }, { status: 401 });
  }

  if (user.authProvider !== "local" || user.role !== "owner") {
    return NextResponse.json({ message: "Only the local owner account has a password to change." }, { status: 403 });
  }

  // The current password is a guess like a sign-in, so it counts against the same limit.
  const limitKey = `password:${user.id}:${getClientIdentifier(request.headers)}`;
  const limit = consumeRateLimit(limitKey, LOGIN_RATE_LIMIT);
  if (!limit.allowed) {
    return NextResponse.json(
      { message: "Too many attempts. Try again later." },
      { status: 429, headers: { "retry-after": String(limit.retryAfterSeconds) } }
    );
  }

  const body = (await request.json()) as { currentPassword?: string; newPassword?: string };
  const currentPassword = body.currentPassword ?? "";
  const newPassword = body.newPassword ?? "";

  const state = await readAppState();
  const storedHash = user.passwordHash || state.owner?.passwordHash || "";
  if (!verifyPassword(currentPassword, storedHash)) {
    return NextResponse.json({ message: "The current password is not correct." }, { status: 401 });
  }
  resetRateLimit(limitKey);

  if (newPassword.length < MIN_OWNER_PASSWORD_LENGTH) {
    return NextResponse.json(
      { message: `The new password needs at least ${MIN_OWNER_PASSWORD_LENGTH} characters.` },
      { status: 400 }
    );
  }

  const email = await setOwnerPasswordHash(hashPassword(newPassword));
  if (!email) {
    return NextResponse.json({ message: "No owner account exists." }, { status: 409 });
  }
  await appendAuditEvent("auth.password.changed", `Owner password changed by ${email}.`);

  return NextResponse.json({ ok: true, message: "Password changed. Use the new one from the next sign-in on." });
}
