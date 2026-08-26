import { NextResponse } from "next/server";
import {
  deleteOverlayVideoSourceRecord,
  listOverlayVideoSourceRecords,
  upsertOverlayVideoSourceRecord
} from "@stream247/db";
import { requireApiRoles } from "@/lib/server/auth";
import { appendAuditEvent } from "@/lib/server/state";

// Stored external video sources for the scene's source layer (M57). The feed URL is write-only
// through this route: it goes in encrypted, and every response — list, save, delete — carries
// only name and presence. Admin-gated like the other credential surfaces, because a feed URL
// routinely embeds credentials.

function sanitizeSourceId(value: unknown): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function sanitizeSourceName(value: unknown): string {
  return String(value || "").trim().slice(0, 80);
}

function isStorableFeedUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return ["rtsp:", "rtmp:", "rtmps:", "http:", "https:", "srt:", "udp:"].includes(url.protocol);
  } catch {
    return false;
  }
}

export async function GET() {
  const unauthorized = await requireApiRoles(["owner", "admin"]);
  if (unauthorized) {
    return unauthorized;
  }

  return NextResponse.json({ ok: true, videoSources: await listOverlayVideoSourceRecords() });
}

export async function PUT(request: Request) {
  const unauthorized = await requireApiRoles(["owner", "admin"]);
  if (unauthorized) {
    return unauthorized;
  }

  const body = (await request.json()) as Partial<{ id: string; name: string; url: string; clearUrl: boolean }>;
  const name = sanitizeSourceName(body.name);
  if (!name) {
    return NextResponse.json({ ok: false, message: "A video source needs a name." }, { status: 400 });
  }

  const id = sanitizeSourceId(body.id) || sanitizeSourceId(name);
  if (!id) {
    return NextResponse.json({ ok: false, message: "The video source name must contain letters or digits." }, { status: 400 });
  }

  const url = typeof body.url === "string" ? body.url.trim() : "";
  if (url && !isStorableFeedUrl(url)) {
    return NextResponse.json(
      { ok: false, message: "The feed address must be a complete stream or web URL." },
      { status: 400 }
    );
  }

  await upsertOverlayVideoSourceRecord(
    { id, name },
    url ? { managedUrl: url } : body.clearUrl ? { clearManagedUrl: true } : undefined
  );

  // The audit line deliberately names the source, never the URL.
  await appendAuditEvent("overlay.video_source_saved", `Video source "${name}" was saved.`);
  return NextResponse.json({
    ok: true,
    videoSources: await listOverlayVideoSourceRecords(),
    message: "Video source saved."
  });
}

export async function DELETE(request: Request) {
  const unauthorized = await requireApiRoles(["owner", "admin"]);
  if (unauthorized) {
    return unauthorized;
  }

  const body = (await request.json()) as Partial<{ id: string }>;
  const id = sanitizeSourceId(body.id);
  if (!id) {
    return NextResponse.json({ ok: false, message: "Which video source should be removed?" }, { status: 400 });
  }

  await deleteOverlayVideoSourceRecord(id);
  await appendAuditEvent("overlay.video_source_deleted", "A video source was removed.");
  return NextResponse.json({
    ok: true,
    videoSources: await listOverlayVideoSourceRecords(),
    message: "Video source removed."
  });
}
