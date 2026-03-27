import { NextRequest, NextResponse } from "next/server";
import { requireApiRoles, getAuthenticatedUser } from "@/lib/server/auth";
import { appendAuditEvent, updateAppState, type UserRole } from "@/lib/server/state";

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

  await updateAppState((state) => {
    const existing = state.teamAccessGrants.find((grant) => grant.twitchLogin === twitchLogin);
    const nextGrant = {
      id: existing?.id ?? `grant_${Math.random().toString(36).slice(2, 10)}`,
      twitchLogin,
      role,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      createdBy: actor?.id ?? "unknown"
    };

    return {
      ...state,
      teamAccessGrants: existing
        ? state.teamAccessGrants.map((grant) => (grant.id === existing.id ? nextGrant : grant))
        : [nextGrant, ...state.teamAccessGrants]
    };
  });

  await appendAuditEvent("team.grant", `Granted ${role} access to Twitch user ${twitchLogin}.`);
  return NextResponse.json({ ok: true, message: `Granted ${role} access to ${twitchLogin}.` });
}
