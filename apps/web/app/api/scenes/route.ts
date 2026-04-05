import { NextResponse } from "next/server";
import type { OverlaySceneRenderTarget } from "@stream247/core";
import { requireApiRoles } from "@/lib/server/auth";
import { buildActiveScenePayload, readAppState, readOverlayStudioState } from "@/lib/server/state";

export const dynamic = "force-dynamic";

function normalizeQueueKind(value: string | null): "asset" | "insert" | "standby" | "reconnect" {
  return value === "asset" || value === "insert" || value === "standby" || value === "reconnect" ? value : "asset";
}

function normalizeRenderTarget(value: string | null): OverlaySceneRenderTarget {
  return value === "browser" || value === "on-air-text" || value === "on-air-scene" ? value : "browser";
}

export async function GET(request: Request) {
  const unauthorized = await requireApiRoles(["owner", "admin", "operator", "moderator", "viewer"]);
  if (unauthorized) {
    return unauthorized;
  }

  const studioState = await readOverlayStudioState();
  const appState = await readAppState();
  const url = new URL(request.url);
  const queueKind = normalizeQueueKind(url.searchParams.get("mode"));
  const target = normalizeRenderTarget(url.searchParams.get("target"));
  const livePayload = buildActiveScenePayload(appState, {
    overlay: studioState.liveOverlay,
    queueKind,
    target
  });
  const draftPayload = buildActiveScenePayload(appState, {
    overlay: studioState.draftOverlay,
    queueKind,
    target
  });

  return NextResponse.json({
    queueKind,
    target,
    hasUnpublishedChanges: studioState.hasUnpublishedChanges,
    liveScene: livePayload.scene,
    draftScene: draftPayload.scene,
    livePayload,
    draftPayload
  });
}
