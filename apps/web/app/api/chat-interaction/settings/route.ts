import { NextResponse } from "next/server";
import { normalizeChatInteractionConfig } from "@stream247/core";
import {
  readChatInteractionSettingsRecord,
  readChatVoteSessionRecord,
  writeChatInteractionSettingsRecord
} from "@stream247/db";
import { requireApiRoles } from "@/lib/server/auth";
import { appendAuditEvent } from "@/lib/server/state";

export async function GET() {
  const unauthorized = await requireApiRoles(["owner", "admin", "operator", "moderator", "viewer"]);
  if (unauthorized) {
    return unauthorized;
  }

  const [settings, vote] = await Promise.all([readChatInteractionSettingsRecord(), readChatVoteSessionRecord()]);
  return NextResponse.json({ settings, vote });
}

export async function PUT(request: Request) {
  // Owner/admin only: this hands programme control to anonymous chat.
  const unauthorized = await requireApiRoles(["owner", "admin"]);
  if (unauthorized) {
    return unauthorized;
  }

  const current = await readChatInteractionSettingsRecord();
  const body = (await request.json()) as Record<string, unknown>;

  // Normalisation is the domain's job, not the form's: the bounds are safety properties (a single
  // viewer must never be able to skip the programme, requests must always be throttled), so they
  // are enforced on the way in regardless of what the client sent.
  const normalized = normalizeChatInteractionConfig({ ...current, ...body });
  const settings = { ...normalized, updatedAt: new Date().toISOString() };

  await writeChatInteractionSettingsRecord(settings);
  await appendAuditEvent(
    "chat.interaction.updated",
    `Viewer control ${settings.enabled ? "enabled" : "disabled"}: voting ${
      settings.votingEnabled ? "on" : "off"
    }, requests ${settings.requestsEnabled ? "on" : "off"} (cooldown ${String(
      settings.requestCooldownSeconds
    )}s), skip ${settings.skipEnabled ? "on" : "off"} (min ${String(settings.skipMinimumVotes)} votes).`
  );

  return NextResponse.json({ ok: true, settings, message: "Viewer control settings updated." });
}
