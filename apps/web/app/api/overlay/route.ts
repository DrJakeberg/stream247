import { NextResponse } from "next/server";
import {
  normalizeOverlayPanelAnchor,
  normalizeOverlaySceneLayerOrder,
  normalizeOverlayScenePreset,
  normalizeOverlaySurfaceStyle,
  normalizeOverlayTitleScale
} from "@stream247/core";
import { requireApiRoles } from "@/lib/server/auth";
import {
  appendAuditEvent,
  publishOverlayDraftRecord,
  readOverlayStudioState,
  resetOverlayDraftRecord,
  saveOverlayDraftRecord
} from "@/lib/server/state";

type OverlayPayload = Partial<{
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
  layerOrder: string[];
  emergencyBanner: string;
  tickerText: string;
  replayLabel: string;
}>;

function sanitizeOverlayPayload(payload: OverlayPayload, base: Awaited<ReturnType<typeof readOverlayStudioState>>["draftOverlay"], updatedAt: string) {
  return {
    ...base,
    enabled: payload.enabled ?? base.enabled,
    channelName: (payload.channelName ?? base.channelName).trim().slice(0, 80) || "Stream247",
    headline: (payload.headline ?? base.headline).trim().slice(0, 120) || "Always on air",
    brandBadge: (payload.brandBadge ?? base.brandBadge).trim().slice(0, 48),
    scenePreset: normalizeOverlayScenePreset(String(payload.scenePreset ?? base.scenePreset)),
    accentColor: (payload.accentColor ?? base.accentColor).trim().slice(0, 20) || "#0e6d5a",
    surfaceStyle: normalizeOverlaySurfaceStyle(String(payload.surfaceStyle ?? base.surfaceStyle)),
    panelAnchor: normalizeOverlayPanelAnchor(String(payload.panelAnchor ?? base.panelAnchor)),
    titleScale: normalizeOverlayTitleScale(String(payload.titleScale ?? base.titleScale)),
    showClock: payload.showClock ?? base.showClock,
    showNextItem: payload.showNextItem ?? base.showNextItem,
    showScheduleTeaser: payload.showScheduleTeaser ?? base.showScheduleTeaser,
    showCurrentCategory: payload.showCurrentCategory ?? base.showCurrentCategory,
    showSourceLabel: payload.showSourceLabel ?? base.showSourceLabel,
    showQueuePreview: payload.showQueuePreview ?? base.showQueuePreview,
    queuePreviewCount: Math.max(1, Math.min(5, Number(payload.queuePreviewCount ?? base.queuePreviewCount) || 3)),
    layerOrder: normalizeOverlaySceneLayerOrder(payload.layerOrder ?? base.layerOrder),
    emergencyBanner: (payload.emergencyBanner ?? base.emergencyBanner).trim().slice(0, 180),
    tickerText: (payload.tickerText ?? base.tickerText).trim().slice(0, 180),
    replayLabel: (payload.replayLabel ?? base.replayLabel).trim().slice(0, 80) || "Replay stream",
    updatedAt
  };
}

export async function GET() {
  const unauthorized = await requireApiRoles(["owner", "admin", "operator", "moderator", "viewer"]);
  if (unauthorized) {
    return unauthorized;
  }

  const studioState = await readOverlayStudioState();
  return NextResponse.json(studioState);
}

export async function PUT(request: Request) {
  const unauthorized = await requireApiRoles(["owner", "admin", "operator"]);
  if (unauthorized) {
    return unauthorized;
  }

  const payload = (await request.json()) as OverlayPayload;
  const studioState = await readOverlayStudioState();
  const savedState = await saveOverlayDraftRecord(
    sanitizeOverlayPayload(payload, studioState.draftOverlay, new Date().toISOString()),
    studioState.basedOnUpdatedAt || studioState.liveOverlay.updatedAt
  );

  await appendAuditEvent("overlay.draft_saved", "Overlay scene draft was saved.");
  return NextResponse.json({ ok: true, ...savedState, message: "Scene draft saved." });
}

export async function POST(request: Request) {
  const unauthorized = await requireApiRoles(["owner", "admin", "operator"]);
  if (unauthorized) {
    return unauthorized;
  }

  const payload = (await request.json()) as { action?: "publish" | "reset"; draft?: OverlayPayload };
  if (!payload.action) {
    return NextResponse.json({ message: "Action is required." }, { status: 400 });
  }

  if (payload.action === "reset") {
    const resetState = await resetOverlayDraftRecord();
    await appendAuditEvent("overlay.draft_reset", "Overlay draft was reset to the live scene.");
    return NextResponse.json({ ok: true, ...resetState, message: "Draft reset to the live scene." });
  }

  if (payload.action === "publish") {
    const studioState = await readOverlayStudioState();
    const nextLiveOverlay = sanitizeOverlayPayload(payload.draft ?? {}, studioState.draftOverlay, new Date().toISOString());
    const publishedState = await publishOverlayDraftRecord(nextLiveOverlay);
    await appendAuditEvent("overlay.published", "Overlay scene changes were published live.");
    return NextResponse.json({ ok: true, ...publishedState, message: "Scene changes published live." });
  }

  return NextResponse.json({ message: "Unsupported overlay action." }, { status: 400 });
}
