import { NextResponse } from "next/server";
import { isChatGameEmoteMapValid, listChatGameEmoteMapIssues, type ChatGameEmoteMap } from "@stream247/core";
import { readChatGameSettingsRecord, writeChatGameSettingsRecord } from "@stream247/db";
import { requireApiRoles } from "@/lib/server/auth";
import { appendAuditEvent } from "@/lib/server/state";

export async function GET() {
  const unauthorized = await requireApiRoles(["owner", "admin", "operator", "moderator", "viewer"]);
  if (unauthorized) {
    return unauthorized;
  }

  const settings = await readChatGameSettingsRecord();
  return NextResponse.json({ settings });
}

export async function PUT(request: Request) {
  const unauthorized = await requireApiRoles(["owner", "admin", "operator"]);
  if (unauthorized) {
    return unauthorized;
  }

  const current = await readChatGameSettingsRecord();
  const body = (await request.json()) as Record<string, unknown>;
  const merged = { ...current, ...body } as typeof current & { emoteMap?: Partial<ChatGameEmoteMap> };

  // The emote map is rejected rather than silently repaired: normalisation would fall back to the
  // default arrows as a whole, and an operator who typed a duplicate should hear that, not
  // discover mid-round that chat is steering with emotes they never entered.
  const trimmedMap: ChatGameEmoteMap = {
    up: String(merged.emoteMap?.up ?? "").trim(),
    down: String(merged.emoteMap?.down ?? "").trim(),
    left: String(merged.emoteMap?.left ?? "").trim(),
    right: String(merged.emoteMap?.right ?? "").trim()
  };
  if (!isChatGameEmoteMapValid(trimmedMap)) {
    return NextResponse.json({ message: listChatGameEmoteMapIssues(trimmedMap).join(" ") }, { status: 400 });
  }

  // Grid bounds are safety-of-legibility properties, so they stay normalised on the way in
  // regardless of what the client sent; writeChatGameSettingsRecord applies the clamps.
  const settings = { ...merged, emoteMap: trimmedMap, updatedAt: new Date().toISOString() };
  await writeChatGameSettingsRecord(settings);
  await appendAuditEvent(
    "chat.game.settings_updated",
    `Chat game settings updated: ${settings.gameId}, ${String(settings.gridWidth)}x${String(settings.gridHeight)} grid.`
  );

  const saved = await readChatGameSettingsRecord();
  return NextResponse.json({ ok: true, settings: saved, message: "Chat game settings updated." });
}
