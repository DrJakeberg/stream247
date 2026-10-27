import { NextRequest, NextResponse } from "next/server";
import { requireApiRoles, getAuthenticatedUser } from "@/lib/server/auth";
import { appendAuditEvent, deleteTeamAccessGrantRecord, readAppState, upsertTeamAccessGrantRecord, type UserRole } from "@/lib/server/state";

export async function POST(request: NextRequest) {
  const unauthorized = await requireApiRoles(["owner", "admin"]);
  if (unauthorized) {
    return unauthorized;
  }

  const actor = await getAuthenticatedUser();
  const body = (await request.json()) as { twitchLogin?: string; role?: UserRole };
  const twitchLogin = (body.twitchLogin ?? "").trim().toLowerCase();
  const role = body.role ?? "viewer";

  if (!twitchLogin) {
    return NextResponse.json({ message: "Twitch login is required." }, { status: 400 });
  }

  if (!["admin", "operator", "moderator", "viewer"].includes(role)) {
    return NextResponse.json({ message: "Role is invalid." }, { status: 400 });
  }

  const state = await readAppState();
  const existing = state.teamAccessGrants.find((grant) => grant.twitchLogin === twitchLogin);
  await upsertTeamAccessGrantRecord({
    id: existing?.id ?? `grant_${Math.random().toString(36).slice(2, 10)}`,
    twitchLogin,
    twitchUserId: existing?.twitchUserId ?? "",
    role,
    createdAt: existing?.createdAt ?? new Date().toISOString(),
    createdBy: actor?.id ?? "unknown"
  });

  await appendAuditEvent("team.grant", `Granted ${role} access to Twitch user ${twitchLogin}.`);
  return NextResponse.json({ ok: true, message: `Granted ${role} access to ${twitchLogin}.` });
}

// Removing a grant ends the member's access at once (M125): every request derives a Twitch sign-in's role from the current grants.
export async function DELETE(request: NextRequest) {
  const unauthorized = await requireApiRoles(["owner", "admin"]);
  if (unauthorized) {
    return unauthorized;
  }

  const body = (await request.json().catch(() => ({}))) as { id?: string };
  const id = typeof body.id === "string" ? body.id.trim() : "";
  const state = await readAppState();
  const existing = state.teamAccessGrants.find((grant) => grant.id === id);
  if (!existing) {
    return NextResponse.json({ message: "Grant not found." }, { status: 404 });
  }

  await deleteTeamAccessGrantRecord(existing.id);
  await appendAuditEvent("team.revoke", `Removed ${existing.role} access from Twitch user ${existing.twitchLogin}.`);
  return NextResponse.json({ ok: true, message: `Removed access for ${existing.twitchLogin}.` });
}
