import { NextResponse } from "next/server";
import { requireApiRoles } from "@/lib/server/auth";
import {
  appendAuditEvent,
  applyOverlayScenePresetRecordToDraft,
  deleteOverlayScenePresetRecord,
  listOverlayScenePresetRecords,
  saveOverlayScenePresetRecord,
  type OverlaySettingsRecord
} from "@/lib/server/state";

type PresetActionPayload = {
  action?: "save" | "apply" | "delete";
  name?: string;
  description?: string;
  draft?: OverlaySettingsRecord;
  presetId?: string;
};

export async function GET() {
  const unauthorized = await requireApiRoles(["owner", "admin", "operator", "moderator", "viewer"]);
  if (unauthorized) {
    return unauthorized;
  }

  const presets = await listOverlayScenePresetRecords();
  return NextResponse.json({ presets });
}

export async function POST(request: Request) {
  const unauthorized = await requireApiRoles(["owner", "admin", "operator"]);
  if (unauthorized) {
    return unauthorized;
  }

  const payload = (await request.json()) as PresetActionPayload;
  if (!payload.action) {
    return NextResponse.json({ message: "Action is required." }, { status: 400 });
  }

  if (payload.action === "save") {
    if (!payload.name?.trim()) {
      return NextResponse.json({ message: "Preset name is required." }, { status: 400 });
    }
    if (!payload.draft) {
      return NextResponse.json({ message: "Draft overlay payload is required." }, { status: 400 });
    }

    const preset = await saveOverlayScenePresetRecord({
      name: payload.name,
      description: payload.description || "",
      overlay: payload.draft
    });
    await appendAuditEvent("overlay.preset_saved", `Saved overlay scene preset ${preset.name}.`);
    return NextResponse.json({
      ok: true,
      preset,
      presets: await listOverlayScenePresetRecords(),
      message: "Scene preset saved."
    });
  }

  if (!payload.presetId) {
    return NextResponse.json({ message: "Preset id is required." }, { status: 400 });
  }

  if (payload.action === "apply") {
    const studioState = await applyOverlayScenePresetRecordToDraft(payload.presetId);
    if (!studioState) {
      return NextResponse.json({ message: "Scene preset not found." }, { status: 404 });
    }

    await appendAuditEvent("overlay.preset_applied", `Applied overlay scene preset ${payload.presetId} to the draft scene.`);
    return NextResponse.json({
      ok: true,
      studioState,
      presets: await listOverlayScenePresetRecords(),
      message: "Scene preset applied to draft."
    });
  }

  if (payload.action === "delete") {
    await deleteOverlayScenePresetRecord(payload.presetId);
    await appendAuditEvent("overlay.preset_deleted", `Deleted overlay scene preset ${payload.presetId}.`);
    return NextResponse.json({
      ok: true,
      presets: await listOverlayScenePresetRecords(),
      message: "Scene preset deleted."
    });
  }

  return NextResponse.json({ message: "Unsupported preset action." }, { status: 400 });
}
