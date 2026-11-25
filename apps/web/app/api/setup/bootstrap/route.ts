import { NextRequest, NextResponse } from "next/server";
import { MIN_OWNER_PASSWORD_LENGTH } from "@stream247/db";
import { hashPassword, sessionPasswordHash, setSessionCookie } from "@/lib/server/auth";
import { appendAuditEvent, claimOwnerAndInitialize, readAppState, updateManagedConfigRecord } from "@/lib/server/state";
import { managedConfigSaveRefusal } from "@/lib/server/managed-config-save";
import { PREAUTH_BODY_LIMIT_BYTES, bodyTooLargeResponse, readBoundedText } from "@/lib/server/bounded-body";

export async function POST(request: NextRequest) {
  // Anonymous callers reach this until the workspace is claimed, so the body is bounded first.
  const rawBody = await readBoundedText(request, PREAUTH_BODY_LIMIT_BYTES);
  if (rawBody === null) {
    return bodyTooLargeResponse();
  }
  const body = JSON.parse(rawBody) as {
    email?: string;
    password?: string;
    twitchClientId?: string;
    twitchClientSecret?: string;
  };
  const email = (body.email ?? "").trim().toLowerCase();
  const password = body.password ?? "";
  const twitchClientId = (body.twitchClientId ?? "").trim();
  const twitchClientSecret = body.twitchClientSecret ?? "";

  if (!email || password.length < MIN_OWNER_PASSWORD_LENGTH) {
    return NextResponse.json(
      { message: `Provide a valid email and a password with at least ${MIN_OWNER_PASSWORD_LENGTH} characters.` },
      { status: 400 }
    );
  }

  // A fast path only: two requests that overlap both get past this read. The claim below decides.
  const existing = await readAppState();
  if (existing.initialized || existing.owner) {
    return NextResponse.json({ message: "Workspace has already been initialized." }, { status: 409 });
  }

  const passwordHash = hashPassword(password);
  const createdAt = new Date().toISOString();
  const ownerUser = {
    id: `user_${Math.random().toString(36).slice(2, 10)}`,
    email,
    displayName: "Owner",
    authProvider: "local" as const,
    role: "owner" as const,
    twitchUserId: "",
    twitchLogin: "",
    passwordHash,
    createdAt,
    lastLoginAt: createdAt
  };

  // The owner row and the owner's user are written together, and only while nobody has claimed the
  // workspace. The request that loses the race writes nothing: no user, no settings, no audit line,
  // no session.
  const claimed = await claimOwnerAndInitialize({ email, passwordHash, createdAt }, ownerUser);
  if (!claimed) {
    return NextResponse.json({ message: "Workspace has already been initialized." }, { status: 409 });
  }

  if (twitchClientId || twitchClientSecret) {
    try {
      await updateManagedConfigRecord((current) => ({
        ...current,
        twitchClientId: twitchClientId || current.twitchClientId,
        twitchClientSecret: twitchClientSecret || current.twitchClientSecret,
        updatedAt: new Date().toISOString()
      }));
    } catch (error) {
      return managedConfigSaveRefusal(error);
    }
  }

  const state = await readAppState();
  const persistedOwnerUser = state.users.find((user) => user.email === email);
  await appendAuditEvent("setup.completed", `Workspace initialized by ${email}.`);
  if (persistedOwnerUser) {
    await setSessionCookie(persistedOwnerUser.id, sessionPasswordHash(persistedOwnerUser, state));
  }

  return NextResponse.json({ ok: true });
}
