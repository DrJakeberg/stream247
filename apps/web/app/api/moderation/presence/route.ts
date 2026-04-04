import { NextRequest, NextResponse } from "next/server";
import { parseModeratorCheckIn } from "@stream247/core";
import { requireApiRoles } from "@/lib/server/auth";
import { appendAuditEvent, appendPresenceWindowRecord, readAppState } from "@/lib/server/state";

export async function POST(request: NextRequest) {
  const unauthorized = await requireApiRoles(["owner", "admin", "operator", "moderator"]);
  if (unauthorized) {
    return unauthorized;
  }

  const body = (await request.json()) as { actor?: string; input?: string };
  const now = new Date();
  const state = await readAppState();
  const config = state.moderation;
  const window = parseModeratorCheckIn({
    actor: body.actor ?? "unknown",
    input: body.input ?? "",
    now,
    config
  });

  if (!window) {
    return NextResponse.json(
      { ok: false, message: "Input did not match the configured moderator command." },
      { status: 400 }
    );
  }

  await appendPresenceWindowRecord({
    actor: window.actor,
    minutes: window.minutes,
    createdAt: window.createdAt.toISOString(),
    expiresAt: window.expiresAt.toISOString()
  });
  await appendAuditEvent("moderation.checkin", `${window.actor} checked in for ${window.minutes} minutes.`);

  return NextResponse.json({
    ok: true,
    window: {
      actor: window.actor,
      minutes: window.minutes,
      expiresAt: window.expiresAt.toISOString()
    }
  });
}
