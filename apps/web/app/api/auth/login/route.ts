import { NextRequest, NextResponse } from "next/server";
import { setSessionCookie, verifyPassword } from "@/lib/server/auth";
import { findUserByEmail, readAppState, updateAppState } from "@/lib/server/state";

export async function POST(request: NextRequest) {
  const body = (await request.json()) as { email?: string; password?: string };
  const email = (body.email ?? "").trim().toLowerCase();
  const password = body.password ?? "";
  const state = await readAppState();

  if (!state.owner || state.owner.email !== email || !verifyPassword(password, state.owner.passwordHash)) {
    return NextResponse.json({ message: "Invalid email or password." }, { status: 401 });
  }

  const user = findUserByEmail(state, email);
  if (!user) {
    return NextResponse.json({ message: "Owner user is missing from state." }, { status: 500 });
  }

  await updateAppState((current) => ({
    ...current,
    users: current.users.map((currentUser) =>
      currentUser.id === user.id ? { ...currentUser, lastLoginAt: new Date().toISOString() } : currentUser
    )
  }));

  await setSessionCookie(user.id);
  return NextResponse.json({ ok: true });
}

