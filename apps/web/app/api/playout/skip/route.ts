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

  const payload = (await request.json()) as Partial<{ minutes: number }>;
  const minutes = Math.max(5, Math.min(240, Number(payload.minutes ?? 60) || 60));
  const state = await readAppState();
  const currentAsset = state.assets.find((entry) => entry.id === state.playout.currentAssetId);

  if (!currentAsset) {
    return NextResponse.json({ message: "No current asset is running, so there is nothing to skip." }, { status: 400 });
  }

  const now = new Date().toISOString();
  await updateAppState((current) => ({
    ...current,
    playout: {
      ...current.playout,
      status: "recovering",
      restartRequestedAt: now,
      heartbeatAt: now,
      skipAssetId: currentAsset.id,
      skipUntil: addMinutes(minutes),
      message: `Skipped ${currentAsset.title} for ${minutes} minutes.`
    }
  }));

  await appendAuditEvent("playout.skip.current", `Skipped ${currentAsset.title} for ${minutes} minutes.`);
  return NextResponse.json({ ok: true, message: "Current asset skipped." });
}
