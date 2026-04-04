import { NextResponse } from "next/server";
import { buildOverlaySceneDefinition, type OverlayQueueKind } from "@stream247/core";
import { requireApiRoles } from "@/lib/server/auth";
import { readOverlayStudioState } from "@/lib/server/state";

export const dynamic = "force-dynamic";

function normalizeQueueKind(value: string | null): OverlayQueueKind {
  return value === "asset" || value === "insert" || value === "standby" || value === "reconnect" ? value : "asset";
}

export async function GET(request: Request) {
  const unauthorized = await requireApiRoles(["owner", "admin", "operator", "moderator", "viewer"]);
  if (unauthorized) {
    return unauthorized;
  }

  const studioState = await readOverlayStudioState();
  const url = new URL(request.url);
  const queueKind = normalizeQueueKind(url.searchParams.get("mode"));

  const liveScene = buildOverlaySceneDefinition({
    overlay: {
      scenePreset: studioState.liveOverlay.scenePreset,
      surfaceStyle: studioState.liveOverlay.surfaceStyle,
      panelAnchor: studioState.liveOverlay.panelAnchor,
      titleScale: studioState.liveOverlay.titleScale,
      showClock: studioState.liveOverlay.showClock,
      showNextItem: studioState.liveOverlay.showNextItem,
      showScheduleTeaser: studioState.liveOverlay.showScheduleTeaser,
      showQueuePreview: studioState.liveOverlay.showQueuePreview,
      emergencyBanner: studioState.liveOverlay.emergencyBanner,
      tickerText: studioState.liveOverlay.tickerText,
      layerOrder: studioState.liveOverlay.layerOrder
    },
    queueKind
  });

  const draftScene = buildOverlaySceneDefinition({
    overlay: {
      scenePreset: studioState.draftOverlay.scenePreset,
      surfaceStyle: studioState.draftOverlay.surfaceStyle,
      panelAnchor: studioState.draftOverlay.panelAnchor,
      titleScale: studioState.draftOverlay.titleScale,
      showClock: studioState.draftOverlay.showClock,
      showNextItem: studioState.draftOverlay.showNextItem,
      showScheduleTeaser: studioState.draftOverlay.showScheduleTeaser,
      showQueuePreview: studioState.draftOverlay.showQueuePreview,
      emergencyBanner: studioState.draftOverlay.emergencyBanner,
      tickerText: studioState.draftOverlay.tickerText,
      layerOrder: studioState.draftOverlay.layerOrder
    },
    queueKind
  });

  return NextResponse.json({
    queueKind,
    hasUnpublishedChanges: studioState.hasUnpublishedChanges,
    liveScene,
    draftScene
  });
}
