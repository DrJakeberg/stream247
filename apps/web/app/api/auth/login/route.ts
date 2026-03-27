import { NextRequest, NextResponse } from "next/server";
import { setSessionCookie, verifyPassword } from "@/lib/server/auth";
import { readAppState } from "@/lib/server/state";

export async function POST(request: NextRequest) {
  const body = (await request.json()) as { email?: string; password?: string };
  const email = (body.email ?? "").trim().toLowerCase();
  const password = body.password ?? "";
  const state = await readAppState();

  if (!state.owner || state.owner.email !== email || !verifyPassword(password, state.owner.passwordHash)) {
    return NextResponse.json({ message: "Invalid email or password." }, { status: 401 });
  }

  await setSessionCookie(email);
  return NextResponse.json({ ok: true });
}

