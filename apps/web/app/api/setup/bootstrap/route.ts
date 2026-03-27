import { NextRequest, NextResponse } from "next/server";
import { hashPassword, setSessionCookie } from "@/lib/server/auth";
import { appendAuditEvent, readAppState, updateAppState } from "@/lib/server/state";

export async function POST(request: NextRequest) {
  const body = (await request.json()) as { email?: string; password?: string };
  const email = (body.email ?? "").trim().toLowerCase();
  const password = body.password ?? "";

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

  await updateAppState((state) => ({
    ...state,
    initialized: true,
    owner: {
      email,
      passwordHash,
      createdAt: new Date().toISOString()
    },
    users: [
      {
        id: `user_${Math.random().toString(36).slice(2, 10)}`,
        email,
        displayName: "Owner",
        authProvider: "local",
        role: "owner",
        twitchUserId: "",
        twitchLogin: "",
        passwordHash,
        createdAt: new Date().toISOString(),
        lastLoginAt: new Date().toISOString()
      }
    ]
  }));

  const state = await readAppState();
  const ownerUser = state.users.find((user) => user.email === email);
  await appendAuditEvent("setup.completed", `Workspace initialized by ${email}.`);
  if (ownerUser) {
    await setSessionCookie(ownerUser.id);
  }

  return NextResponse.json({ ok: true });
}
