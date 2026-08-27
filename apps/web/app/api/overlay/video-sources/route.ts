import { randomBytes } from "node:crypto";
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
//
// Stage 2 adds pushed sources: the camera sends to the relay instead of the worker fetching an
// address. Their publish key is generated here, stored encrypted, and returned exactly once — in
// the response that issued it. Every listing afterwards only says that a key exists.

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

  const body = (await request.json()) as Partial<{
    id: string;
    name: string;
    url: string;
    clearUrl: boolean;
    ingestKind: string;
    rotatePublishKey: boolean;
  }>;
  const name = sanitizeSourceName(body.name);
  if (!name) {
    return NextResponse.json({ ok: false, message: "A video source needs a name." }, { status: 400 });
  }

  const id = sanitizeSourceId(body.id) || sanitizeSourceId(name);
  if (!id) {
    return NextResponse.json({ ok: false, message: "The video source name must contain letters or digits." }, { status: 400 });
  }

  // Absent means "keep the stored kind" — an older caller that never says a kind keeps behaving
  // exactly as before stage 2.
  const ingestKind = body.ingestKind === "push" ? "push" : body.ingestKind === "pull" ? "pull" : undefined;

  const url = typeof body.url === "string" ? body.url.trim() : "";
  if (ingestKind === "push" && url) {
    return NextResponse.json(
      { ok: false, message: "A pushed source receives its feed from the camera; there is no address to store." },
      { status: 400 }
    );
  }
  if (url && !isStorableFeedUrl(url)) {
    return NextResponse.json(
      { ok: false, message: "The feed address must be a complete stream or web URL." },
      { status: 400 }
    );
  }

  let issuedPublishKey = "";
  if (ingestKind === "push") {
    // A key is issued when the source has none yet (fresh push source, or one switched over
    // from a fetched address) and on an explicit rotation. 24 random bytes, base64url — the
    // same alphabet as every generated secret in this codebase.
    const existing = (await listOverlayVideoSourceRecords()).find((entry) => entry.id === id);
    const hasUsableKey = Boolean(existing && existing.ingestKind === "push" && existing.publishKeyPresent);
    if (body.rotatePublishKey || !hasUsableKey) {
      issuedPublishKey = randomBytes(24).toString("base64url");
    }

    await upsertOverlayVideoSourceRecord(
      { id, name },
      {
        ingestKind: "push",
        // A pushed source never stores a playback address — its internal URL is derived.
        clearManagedUrl: true,
        ...(issuedPublishKey ? { managedPublishKey: issuedPublishKey } : {})
      }
    );
  } else if (ingestKind === "pull") {
    await upsertOverlayVideoSourceRecord(
      { id, name },
      {
        ingestKind: "pull",
        // A fetched source never keeps a publish key — switching back retires it.
        clearPublishKey: true,
        ...(url ? { managedUrl: url } : body.clearUrl ? { clearManagedUrl: true } : {})
      }
    );
  } else {
    await upsertOverlayVideoSourceRecord(
      { id, name },
      url ? { managedUrl: url } : body.clearUrl ? { clearManagedUrl: true } : undefined
    );
  }

  // The audit line deliberately names the source, never the URL or the key.
  await appendAuditEvent("overlay.video_source_saved", `Video source "${name}" was saved.`);
  if (issuedPublishKey) {
    await appendAuditEvent("overlay.video_source_key_issued", `A publish key was issued for video source "${name}".`);
  }

  return NextResponse.json({
    ok: true,
    videoSources: await listOverlayVideoSourceRecords(),
    // The one time the key ever leaves the server. It is not stored anywhere readable again.
    ...(issuedPublishKey ? { publishKey: issuedPublishKey } : {}),
    message: issuedPublishKey
      ? "Video source saved. Copy the publish key now — it will not be shown again."
      : "Video source saved."
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
