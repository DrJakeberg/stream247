import { NextRequest, NextResponse } from "next/server";
import { requireApiRoles } from "@/lib/server/auth";
import { appendAuditEvent, readAppState, updateAppState } from "@/lib/server/state";

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
  };

  const destinationId = (body.id ?? "").trim();
  if (!destinationId) {
    return NextResponse.json({ message: "Destination id is required." }, { status: 400 });
  }

  const nextName = typeof body.name === "string" ? body.name.trim() : undefined;
  const nextRtmpUrl = typeof body.rtmpUrl === "string" ? body.rtmpUrl.trim() : undefined;
  const nextNotes = typeof body.notes === "string" ? body.notes.trim() : undefined;

  let found = false;
  await updateAppState((state) => ({
    ...state,
    destinations: state.destinations.map((destination) => {
      if (destination.id !== destinationId) {
        return destination;
      }

      found = true;
      return {
        ...destination,
        enabled: typeof body.enabled === "boolean" ? body.enabled : destination.enabled,
        name: nextName && nextName.length > 0 ? nextName : destination.name,
        rtmpUrl: nextRtmpUrl !== undefined ? nextRtmpUrl : destination.rtmpUrl,
        notes: nextNotes !== undefined ? nextNotes : destination.notes
      };
    })
  }));

  if (!found) {
    return NextResponse.json({ message: "Destination not found." }, { status: 404 });
  }

  await appendAuditEvent("destination.updated", `Updated destination ${destinationId}.`);
  return NextResponse.json({ ok: true });
}
