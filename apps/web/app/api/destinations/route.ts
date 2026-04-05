import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireApiRoles } from "@/lib/server/auth";
import {
  appendAuditEvent,
  deleteDestinationRecord,
  readAppState,
  updateDestinationRecord
} from "@/lib/server/state";

function normalizeProvider(value: unknown): "twitch" | "custom-rtmp" {
  return value === "custom-rtmp" ? "custom-rtmp" : "twitch";
}

function normalizeRole(value: unknown): "primary" | "backup" {
  return value === "backup" ? "backup" : "primary";
}

function normalizePriority(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.round(value)) : fallback;
}

function isProtectedDestinationId(destinationId: string): boolean {
  return destinationId === "destination-primary" || destinationId === "destination-backup";
}

function hasLegacyEnvKey(destinationId: string): boolean {
  if (destinationId === "destination-backup") {
    return Boolean(process.env.BACKUP_STREAM_OUTPUT_KEY || process.env.BACKUP_TWITCH_STREAM_KEY);
  }

  if (destinationId === "destination-primary") {
    return Boolean(process.env.STREAM_OUTPUT_KEY || process.env.TWITCH_STREAM_KEY);
  }

  return false;
}

export async function GET() {
  const unauthorized = await requireApiRoles(["owner", "admin", "operator", "moderator", "viewer"]);
  if (unauthorized) {
    return unauthorized;
  }

  const state = await readAppState();
  return NextResponse.json({ destinations: state.destinations });
}

export async function POST(request: NextRequest) {
  const unauthorized = await requireApiRoles(["owner", "admin"]);
  if (unauthorized) {
    return unauthorized;
  }

  const body = (await request.json()) as {
    provider?: unknown;
    role?: unknown;
    priority?: unknown;
    name?: string;
    enabled?: boolean;
    rtmpUrl?: string;
    notes?: string;
    streamKey?: string;
  };

  const name = String(body.name ?? "").trim();
  if (!name) {
    return NextResponse.json({ message: "Destination name is required." }, { status: 400 });
  }

  const rtmpUrl = String(body.rtmpUrl ?? "").trim();
  const streamKey = String(body.streamKey ?? "").trim();
  const role = normalizeRole(body.role);
  const priority = normalizePriority(body.priority, role === "backup" ? 10 : 0);

  const destinationId = `destination-${randomUUID().slice(0, 8)}`;
  const destination = {
    id: destinationId,
    provider: normalizeProvider(body.provider),
    role,
    priority,
    name,
    enabled: typeof body.enabled === "boolean" ? body.enabled : true,
    rtmpUrl,
    streamKeyPresent: Boolean(streamKey),
    streamKeySource: streamKey ? ("managed" as const) : ("missing" as const),
    status: rtmpUrl && streamKey ? ("ready" as const) : ("missing-config" as const),
    notes: String(body.notes ?? "").trim(),
    lastValidatedAt: "",
    lastFailureAt: "",
    failureCount: 0,
    lastError: ""
  };

  await updateDestinationRecord(destination, streamKey ? { managedStreamKey: streamKey } : undefined);
  await appendAuditEvent("destination.created", `Created destination ${destinationId}.`);
  return NextResponse.json({ ok: true, id: destinationId });
}

export async function PUT(request: NextRequest) {
  const unauthorized = await requireApiRoles(["owner", "admin"]);
  if (unauthorized) {
    return unauthorized;
  }

  const body = (await request.json()) as {
    id?: string;
    enabled?: boolean;
    provider?: unknown;
    role?: unknown;
    priority?: unknown;
    name?: string;
    rtmpUrl?: string;
    notes?: string;
    streamKey?: string;
    clearManagedStreamKey?: boolean;
    clearFailure?: boolean;
  };

  const destinationId = (body.id ?? "").trim();
  if (!destinationId) {
    return NextResponse.json({ message: "Destination id is required." }, { status: 400 });
  }

  const nextName = typeof body.name === "string" ? body.name.trim() : undefined;
  const nextRtmpUrl = typeof body.rtmpUrl === "string" ? body.rtmpUrl.trim() : undefined;
  const nextNotes = typeof body.notes === "string" ? body.notes.trim() : undefined;
  const nextStreamKey = typeof body.streamKey === "string" ? body.streamKey.trim() : "";

  const state = await readAppState();
  const existing = state.destinations.find((destination) => destination.id === destinationId);
  if (!existing) {
    return NextResponse.json({ message: "Destination not found." }, { status: 404 });
  }

  const effectiveStreamKeyPresent = nextStreamKey
    ? true
    : body.clearManagedStreamKey
      ? hasLegacyEnvKey(existing.id)
      : existing.streamKeyPresent;
  const effectiveStreamKeySource = nextStreamKey
    ? ("managed" as const)
    : body.clearManagedStreamKey
      ? hasLegacyEnvKey(existing.id)
        ? ("env" as const)
        : ("missing" as const)
      : existing.streamKeySource || (existing.streamKeyPresent ? "managed" : "missing");
  const effectiveEnabled = typeof body.enabled === "boolean" ? body.enabled : existing.enabled;
  const effectiveRtmpUrl = nextRtmpUrl !== undefined ? nextRtmpUrl : existing.rtmpUrl;

  await updateDestinationRecord({
    ...existing,
    provider: body.provider !== undefined ? normalizeProvider(body.provider) : existing.provider,
    role: body.role !== undefined ? normalizeRole(body.role) : existing.role,
    priority: normalizePriority(body.priority, existing.priority),
    enabled: effectiveEnabled,
    name: nextName && nextName.length > 0 ? nextName : existing.name,
    rtmpUrl: effectiveRtmpUrl,
    notes: nextNotes !== undefined ? nextNotes : existing.notes,
    streamKeyPresent: effectiveStreamKeyPresent,
    streamKeySource: effectiveStreamKeySource,
    status:
      body.clearFailure || typeof body.streamKey === "string" || body.clearManagedStreamKey || nextRtmpUrl !== undefined
        ? effectiveEnabled && Boolean(effectiveRtmpUrl && effectiveStreamKeyPresent)
          ? "ready"
          : "missing-config"
        : existing.status,
    lastFailureAt: body.clearFailure ? "" : existing.lastFailureAt,
    lastError: body.clearFailure ? "" : existing.lastError
  }, {
    managedStreamKey: nextStreamKey || undefined,
    clearManagedStreamKey: Boolean(body.clearManagedStreamKey)
  });

  await appendAuditEvent(
    body.clearFailure ? "destination.failure.cleared" : "destination.updated",
    body.clearFailure ? `Cleared failure state for destination ${destinationId}.` : `Updated destination ${destinationId}.`
  );
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest) {
  const unauthorized = await requireApiRoles(["owner", "admin"]);
  if (unauthorized) {
    return unauthorized;
  }

  const body = (await request.json()) as { id?: string };
  const destinationId = String(body.id ?? "").trim();
  if (!destinationId) {
    return NextResponse.json({ message: "Destination id is required." }, { status: 400 });
  }

  if (isProtectedDestinationId(destinationId)) {
    return NextResponse.json(
      { message: "The default primary and backup destinations can be disabled, but not deleted." },
      { status: 400 }
    );
  }

  await deleteDestinationRecord(destinationId);
  await appendAuditEvent("destination.deleted", `Deleted destination ${destinationId}.`);
  return NextResponse.json({ ok: true });
}
