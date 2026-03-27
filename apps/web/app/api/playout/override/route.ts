import { NextResponse } from "next/server";
import { requireApiRoles } from "@/lib/server/auth";
import { appendAuditEvent, readAppState, updateAppState } from "@/lib/server/state";

function addMinutes(minutes: number): string {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

export async function POST(request: Request) {
  const unauthorized = await requireApiRoles(["owner", "admin", "operator"]);
  if (unauthorized) {
    return unauthorized;
  }

  const payload = (await request.json()) as Partial<{ assetId: string; minutes: number }>;
  const assetId = String(payload.assetId ?? "");
  const minutes = Math.max(5, Math.min(240, Number(payload.minutes ?? 60) || 60));
  const state = await readAppState();
  const asset = state.assets.find((entry) => entry.id === assetId && entry.status === "ready");

  if (!asset) {
    return NextResponse.json({ message: "The requested asset is not available for override." }, { status: 400 });
  }

  const restartRequestedAt = new Date().toISOString();
  await updateAppState((current) => ({
    ...current,
    playout: {
      ...current.playout,
      status: "recovering",
      desiredAssetId: asset.id,
      restartRequestedAt,
      heartbeatAt: restartRequestedAt,
      overrideMode: "asset",
      overrideAssetId: asset.id,
      overrideUntil: addMinutes(minutes),
      message: `Operator override selected ${asset.title} for ${minutes} minutes.`
    }
  }));

  await appendAuditEvent("playout.override.asset", `Operator pinned ${asset.title} for ${minutes} minutes.`);
  return NextResponse.json({ ok: true, message: "Operator override applied." });
}
