import { NextRequest, NextResponse } from "next/server";
import { normalizeStreamOutputSettings } from "@stream247/core";
import { requireApiRoles } from "@/lib/server/auth";
import {
  appendAuditEvent,
  readAppState,
  updateOutputSettingsRecord,
  type OutputSettingsRecord
} from "@/lib/server/state";

type OutputSettingsRequest = {
  profileId?: unknown;
  width?: unknown;
  height?: unknown;
  fps?: unknown;
};

export async function GET() {
  const state = await readAppState();
  return NextResponse.json({ output: state.output });
}

export async function PUT(request: NextRequest) {
  const unauthorized = await requireApiRoles(["owner", "admin"]);
  if (unauthorized) {
    return unauthorized;
  }

  const body = (await request.json()) as OutputSettingsRequest;
  const normalized = normalizeStreamOutputSettings(body);
  const output: OutputSettingsRecord = {
    ...normalized,
    updatedAt: new Date().toISOString()
  };

  await updateOutputSettingsRecord(output);
  await appendAuditEvent(
    "output.settings.updated",
    `Updated output settings to ${output.profileId} (${output.width}x${output.height}@${output.fps}).`
  );

  return NextResponse.json({ ok: true, output, message: "Output settings updated." });
}
