import { NextResponse } from "next/server";
import { requireApiRoles } from "@/lib/server/auth";
import { appendAuditEvent, readAppState, updateAppState } from "@/lib/server/state";

export async function POST() {
  const unauthorized = await requireApiRoles(["owner", "admin", "operator"]);
  if (unauthorized) {
    return unauthorized;
  }

  const state = await readAppState();
  const fallback = [...state.assets]
    .filter((asset) => asset.status === "ready" && asset.isGlobalFallback)
    .sort((left, right) => left.fallbackPriority - right.fallbackPriority)[0];

  if (!fallback) {
    return NextResponse.json({ message: "No global fallback asset is configured." }, { status: 400 });
  }

  await updateAppState((current) => ({
    ...current,
    playout: {
      ...current.playout,
      desiredAssetId: fallback.id,
      restartRequestedAt: new Date().toISOString(),
      heartbeatAt: new Date().toISOString(),
      message: `Manual fallback requested for asset ${fallback.title}.`
    }
  }));

  await appendAuditEvent("playout.fallback.requested", `Manual fallback requested for ${fallback.title}.`);
  return NextResponse.json({ ok: true });
}
