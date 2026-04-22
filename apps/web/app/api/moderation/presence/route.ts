import { NextRequest, NextResponse } from "next/server";
import { formatPresenceClampReply, resolveModeratorCheckIn, stripInvisibleCharacters } from "@stream247/core";
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
  const actor = stripInvisibleCharacters(String(body.actor ?? "unknown")).trim().slice(0, 80) || "unknown";
  const input = stripInvisibleCharacters(String(body.input ?? "")).trim().slice(0, 80);
  const window = resolveModeratorCheckIn({
    actor,
    input,
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
    requestedMinutes: window.requestedMinutes,
    appliedMinutes: window.appliedMinutes,
    clampReason: window.clampReason,
    createdAt: window.createdAt.toISOString(),
    expiresAt: window.expiresAt.toISOString()
  });
  await appendAuditEvent(
    "moderation.checkin",
    `${window.actor} checked in for ${window.appliedMinutes} minutes (${window.clampReason}).`
  );

  const message = formatPresenceClampReply({
    commandInput: window.commandInput,
    requestedMinutes: window.requestedMinutes,
    appliedMinutes: window.appliedMinutes,
    clampReason: window.clampReason,
    config
  });

  return NextResponse.json({
    ok: true,
    message,
    window: {
      actor: window.actor,
      requestedMinutes: window.requestedMinutes,
      minutes: window.appliedMinutes,
      clampReason: window.clampReason,
      expiresAt: window.expiresAt.toISOString()
    }
  });
}
