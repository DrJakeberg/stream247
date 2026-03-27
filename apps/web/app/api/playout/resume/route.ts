import { NextResponse } from "next/server";
import { requireApiRoles } from "@/lib/server/auth";
import { appendAuditEvent, updateAppState } from "@/lib/server/state";

export async function POST() {
  const unauthorized = await requireApiRoles(["owner", "admin", "operator"]);
  if (unauthorized) {
    return unauthorized;
  }

  const now = new Date().toISOString();

  await updateAppState((state) => ({
    ...state,
    playout: {
      ...state.playout,
      status: "recovering",
      desiredAssetId: "",
      restartRequestedAt: now,
      heartbeatAt: now,
      overrideMode: "schedule",
      overrideAssetId: "",
      overrideUntil: "",
      skipAssetId: "",
      skipUntil: "",
      message: "Operator override cleared. Schedule control resumed."
    }
  }));

  await appendAuditEvent("playout.resume.schedule", "Operator override cleared and schedule control resumed.");
  return NextResponse.json({ ok: true, message: "Schedule control resumed." });
}
