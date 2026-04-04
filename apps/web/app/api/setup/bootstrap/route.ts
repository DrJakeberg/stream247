import { NextRequest, NextResponse } from "next/server";
import { hashPassword, setSessionCookie } from "@/lib/server/auth";
import {
  appendAuditEvent,
  readAppState,
  updateManagedConfigRecord,
  updateOwnerAndInitialized,
  upsertUserRecord
} from "@/lib/server/state";

export async function POST(request: NextRequest) {
  const body = (await request.json()) as {
    email?: string;
    password?: string;
    twitchClientId?: string;
    twitchClientSecret?: string;
  };
  const email = (body.email ?? "").trim().toLowerCase();
  const password = body.password ?? "";
  const twitchClientId = (body.twitchClientId ?? "").trim();
  const twitchClientSecret = body.twitchClientSecret ?? "";

  if (!email || password.length < 10) {
    return NextResponse.json(
      { message: "Provide a valid email and a password with at least 10 characters." },
      { status: 400 }
    );
  }

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

  await updateOwnerAndInitialized({
    initialized: true,
    owner: {
      email,
      passwordHash,
      createdAt
    }
  });
  await upsertUserRecord(ownerUser);

  if (twitchClientId || twitchClientSecret) {
    await updateManagedConfigRecord({
      ...existing.managedConfig,
      twitchClientId: twitchClientId || existing.managedConfig.twitchClientId,
      twitchClientSecret: twitchClientSecret || existing.managedConfig.twitchClientSecret,
      updatedAt: new Date().toISOString()
    });
  }

  const state = await readAppState();
  const persistedOwnerUser = state.users.find((user) => user.email === email);
  await appendAuditEvent("setup.completed", `Workspace initialized by ${email}.`);
  if (persistedOwnerUser) {
    await setSessionCookie(persistedOwnerUser.id);
  }

  return NextResponse.json({ ok: true });
}
