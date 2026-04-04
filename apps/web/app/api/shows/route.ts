import { NextRequest, NextResponse } from "next/server";
import { requireApiRoles } from "@/lib/server/auth";
import {
  appendAuditEvent,
  createShowProfileRecord,
  deleteShowProfileRecord,
  readAppState,
  updateShowProfileRecord
} from "@/lib/server/state";

function normalizeBody(body: {
  id?: string;
  name?: string;
  categoryName?: string;
  defaultDurationMinutes?: number;
  color?: string;
  description?: string;
}) {
  return {
    id: (body.id ?? "").trim(),
    name: (body.name ?? "").trim(),
    categoryName: (body.categoryName ?? "").trim(),
    defaultDurationMinutes: Number(body.defaultDurationMinutes ?? 60),
    color: (body.color ?? "").trim() || "#0e6d5a",
    description: (body.description ?? "").trim()
  };
}

function validateShow(payload: ReturnType<typeof normalizeBody>) {
  if (!payload.name) {
    return "Show name is required.";
  }

  if (!Number.isInteger(payload.defaultDurationMinutes) || payload.defaultDurationMinutes < 15 || payload.defaultDurationMinutes > 24 * 60) {
    return "Default duration must be between 15 and 1440 minutes.";
  }

  if (!/^#[0-9a-fA-F]{6}$/.test(payload.color)) {
    return "Color must be a hex value like #0e6d5a.";
  }

  return null;
}

export async function GET() {
  const unauthorized = await requireApiRoles(["owner", "admin", "operator", "moderator", "viewer"]);
  if (unauthorized) {
    return unauthorized;
  }

  const state = await readAppState();
  return NextResponse.json({ shows: state.showProfiles });
}

export async function POST(request: NextRequest) {
  const unauthorized = await requireApiRoles(["owner", "admin", "operator"]);
  if (unauthorized) {
    return unauthorized;
  }

  const payload = normalizeBody((await request.json()) as Record<string, unknown>);
  const error = validateShow(payload);
  if (error) {
    return NextResponse.json({ message: error }, { status: 400 });
  }

  await createShowProfileRecord({
    id: `show_${Math.random().toString(36).slice(2, 10)}`,
    name: payload.name,
    categoryName: payload.categoryName,
    defaultDurationMinutes: payload.defaultDurationMinutes,
    color: payload.color,
    description: payload.description,
    updatedAt: new Date().toISOString()
  });

  await appendAuditEvent("show.created", `Created show profile ${payload.name}.`);
  return NextResponse.json({ ok: true, message: `Show profile ${payload.name} created.` });
}

export async function PUT(request: NextRequest) {
  const unauthorized = await requireApiRoles(["owner", "admin", "operator"]);
  if (unauthorized) {
    return unauthorized;
  }

  const payload = normalizeBody((await request.json()) as Record<string, unknown>);
  if (!payload.id) {
    return NextResponse.json({ message: "Show id is required." }, { status: 400 });
  }
  const error = validateShow(payload);
  if (error) {
    return NextResponse.json({ message: error }, { status: 400 });
  }

  try {
    const state = await readAppState();
    const existing = state.showProfiles.find((show) => show.id === payload.id);
    if (!existing) {
      throw new Error("Show profile not found.");
    }

    await updateShowProfileRecord({
      ...existing,
      name: payload.name,
      categoryName: payload.categoryName,
      defaultDurationMinutes: payload.defaultDurationMinutes,
      color: payload.color,
      description: payload.description,
      updatedAt: new Date().toISOString()
    });
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Could not update show profile." },
      { status: 400 }
    );
  }

  await appendAuditEvent("show.updated", `Updated show profile ${payload.name}.`);
  return NextResponse.json({ ok: true, message: `Show profile ${payload.name} updated.` });
}

export async function DELETE(request: NextRequest) {
  const unauthorized = await requireApiRoles(["owner", "admin", "operator"]);
  if (unauthorized) {
    return unauthorized;
  }

  const body = (await request.json()) as { id?: string };
  const id = (body.id ?? "").trim();
  if (!id) {
    return NextResponse.json({ message: "Show id is required." }, { status: 400 });
  }

  try {
    const state = await readAppState();
    const show = state.showProfiles.find((entry) => entry.id === id);
    if (!show) {
      throw new Error("Show profile not found.");
    }

    await deleteShowProfileRecord(id);
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Could not delete show profile." },
      { status: 400 }
    );
  }

  await appendAuditEvent("show.deleted", `Deleted show profile ${id}.`);
  return NextResponse.json({ ok: true, message: "Show profile deleted." });
}
