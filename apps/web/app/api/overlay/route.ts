import { NextResponse } from "next/server";
import {
  normalizeOverlayPanelAnchor,
  normalizeOverlayScenePreset,
  normalizeOverlaySurfaceStyle,
  normalizeOverlayTitleScale
} from "@stream247/core";
import { requireApiRoles } from "@/lib/server/auth";
import { appendAuditEvent, readAppState, updateOverlaySettingsRecord } from "@/lib/server/state";

export async function GET() {
  const unauthorized = await requireApiRoles(["owner", "admin", "operator", "moderator", "viewer"]);
  if (unauthorized) {
    return unauthorized;
  }

  const state = await readAppState();
  return NextResponse.json({ overlay: state.overlay });
}

export async function PUT(request: Request) {
  const unauthorized = await requireApiRoles(["owner", "admin", "operator"]);
  if (unauthorized) {
    return unauthorized;
  }

  const payload = (await request.json()) as Partial<{
    enabled: boolean;
    channelName: string;
    headline: string;
    brandBadge: string;
    accentColor: string;
    scenePreset: string;
    surfaceStyle: string;
    panelAnchor: string;
    titleScale: string;
    showClock: boolean;
    showNextItem: boolean;
    showScheduleTeaser: boolean;
    showCurrentCategory: boolean;
    showSourceLabel: boolean;
    showQueuePreview: boolean;
    queuePreviewCount: number;
    emergencyBanner: string;
    tickerText: string;
    replayLabel: string;
  }>;

  const now = new Date().toISOString();

  const state = await readAppState();
  await updateOverlaySettingsRecord({
    ...state.overlay,
    enabled: payload.enabled ?? state.overlay.enabled,
    channelName: (payload.channelName ?? state.overlay.channelName).trim().slice(0, 80) || "Stream247",
    headline: (payload.headline ?? state.overlay.headline).trim().slice(0, 120) || "Always on air",
    brandBadge: (payload.brandBadge ?? state.overlay.brandBadge).trim().slice(0, 48),
    scenePreset: normalizeOverlayScenePreset(String(payload.scenePreset ?? state.overlay.scenePreset)),
    accentColor: (payload.accentColor ?? state.overlay.accentColor).trim().slice(0, 20) || "#0e6d5a",
    surfaceStyle: normalizeOverlaySurfaceStyle(String(payload.surfaceStyle ?? state.overlay.surfaceStyle)),
    panelAnchor: normalizeOverlayPanelAnchor(String(payload.panelAnchor ?? state.overlay.panelAnchor)),
    titleScale: normalizeOverlayTitleScale(String(payload.titleScale ?? state.overlay.titleScale)),
    showClock: payload.showClock ?? state.overlay.showClock,
    showNextItem: payload.showNextItem ?? state.overlay.showNextItem,
    showScheduleTeaser: payload.showScheduleTeaser ?? state.overlay.showScheduleTeaser,
    showCurrentCategory: payload.showCurrentCategory ?? state.overlay.showCurrentCategory,
    showSourceLabel: payload.showSourceLabel ?? state.overlay.showSourceLabel,
    showQueuePreview: payload.showQueuePreview ?? state.overlay.showQueuePreview,
    queuePreviewCount: Math.max(1, Math.min(5, Number(payload.queuePreviewCount ?? state.overlay.queuePreviewCount) || 3)),
    emergencyBanner: (payload.emergencyBanner ?? state.overlay.emergencyBanner).trim().slice(0, 180),
    tickerText: (payload.tickerText ?? state.overlay.tickerText).trim().slice(0, 180),
    replayLabel: (payload.replayLabel ?? state.overlay.replayLabel).trim().slice(0, 80) || "Replay stream",
    updatedAt: now
  });

  await appendAuditEvent("overlay.updated", "Overlay settings were updated.");
  return NextResponse.json({ ok: true, message: "Overlay settings updated." });
}
