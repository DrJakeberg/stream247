import { NextRequest, NextResponse } from "next/server";
import { setSessionCookie, verifyPassword } from "@/lib/server/auth";
import { findUserByEmail, readAppState, upsertUserRecord } from "@/lib/server/state";

export async function POST(request: NextRequest) {
  const body = (await request.json()) as { email?: string; password?: string };
  const email = (body.email ?? "").trim().toLowerCase();
  const password = body.password ?? "";
  const state = await readAppState();
  const user = findUserByEmail(state, email);
  const passwordHash = user?.passwordHash || state.owner?.passwordHash || "";

  if (!state.owner || state.owner.email !== email || !user || !verifyPassword(password, passwordHash)) {
    return NextResponse.json({ message: "Invalid email or password." }, { status: 401 });
  }

  await upsertUserRecord({
    ...user,
    lastLoginAt: new Date().toISOString()
  });

  await setSessionCookie(user.id);
  return NextResponse.json({ ok: true });
}
