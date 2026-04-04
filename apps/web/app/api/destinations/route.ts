import { NextRequest, NextResponse } from "next/server";
import { requireApiRoles } from "@/lib/server/auth";
import { appendAuditEvent, readAppState, updateDestinationRecord } from "@/lib/server/state";

export async function GET() {
  const unauthorized = await requireApiRoles(["owner", "admin", "operator", "moderator", "viewer"]);
  if (unauthorized) {
    return unauthorized;
  }

  const state = await readAppState();
  return NextResponse.json({ destinations: state.destinations });
}

export async function PUT(request: NextRequest) {
  const unauthorized = await requireApiRoles(["owner", "admin"]);
  if (unauthorized) {
    return unauthorized;
  }

  const body = (await request.json()) as {
    id?: string;
    enabled?: boolean;
    name?: string;
    rtmpUrl?: string;
    notes?: string;
    clearFailure?: boolean;
  };

  const destinationId = (body.id ?? "").trim();
  if (!destinationId) {
    return NextResponse.json({ message: "Destination id is required." }, { status: 400 });
  }

  const nextName = typeof body.name === "string" ? body.name.trim() : undefined;
  const nextRtmpUrl = typeof body.rtmpUrl === "string" ? body.rtmpUrl.trim() : undefined;
  const nextNotes = typeof body.notes === "string" ? body.notes.trim() : undefined;

  const state = await readAppState();
  const existing = state.destinations.find((destination) => destination.id === destinationId);
  if (!existing) {
    return NextResponse.json({ message: "Destination not found." }, { status: 404 });
  }

  await updateDestinationRecord({
    ...existing,
    enabled: typeof body.enabled === "boolean" ? body.enabled : existing.enabled,
    name: nextName && nextName.length > 0 ? nextName : existing.name,
    rtmpUrl: nextRtmpUrl !== undefined ? nextRtmpUrl : existing.rtmpUrl,
    notes: nextNotes !== undefined ? nextNotes : existing.notes,
    status: body.clearFailure ? (existing.enabled && existing.streamKeyPresent ? "ready" : "missing-config") : existing.status,
    lastFailureAt: body.clearFailure ? "" : existing.lastFailureAt,
    lastError: body.clearFailure ? "" : existing.lastError
  });

  await appendAuditEvent(
    body.clearFailure ? "destination.failure.cleared" : "destination.updated",
    body.clearFailure ? `Cleared failure state for destination ${destinationId}.` : `Updated destination ${destinationId}.`
  );
  return NextResponse.json({ ok: true });
}
