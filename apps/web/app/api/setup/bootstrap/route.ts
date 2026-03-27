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

  await updateAppState((state) => ({
    ...state,
    initialized: true,
    owner: {
      email,
      passwordHash: hashPassword(password),
      createdAt: new Date().toISOString()
    }
  }));

  await appendAuditEvent("setup.completed", `Workspace initialized by ${email}.`);
  await setSessionCookie(email);

  return NextResponse.json({ ok: true });
}

