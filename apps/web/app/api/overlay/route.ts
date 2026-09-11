import { NextResponse } from "next/server";
import {
  normalizeOverlayNamedScenes,
  normalizeOverlayPanelAnchor,
  normalizeOverlaySceneCustomLayers,
  normalizeOverlayScenePanelPlacements,
  normalizeOverlaySceneLayerOrder,
  normalizeOverlayScenePreset,
  resolveActiveOverlayNamedSceneId,
  resolveOverlayNamedSceneCustomLayers,
  stripInvisibleCharacters,
  normalizeOverlaySurfaceStyle,
  normalizeOverlayTypographyPreset,
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
  insertHeadline: string;
  standbyHeadline: string;
  reconnectHeadline: string;
  brandBadge: string;
  accentColor: string;
  scenePreset: string;
  insertScenePreset: string;
  standbyScenePreset: string;
  reconnectScenePreset: string;
  surfaceStyle: string;
  panelAnchor: string;
  titleScale: string;
  typographyPreset: string;
  showClock: boolean;
  showNextItem: boolean;
  showScheduleTeaser: boolean;
  showCurrentCategory: boolean;
  showSourceLabel: boolean;
  showQueuePreview: boolean;
  queuePreviewCount: number;
  layerOrder: string[];
  disabledLayers: string[];
  customLayers: unknown[];
  scenes: unknown[];
  activeSceneId: string;
  panelPlacements: unknown;
  emergencyBanner: string;
  tickerText: string;
  tickerRotateSeconds: number;
  replayLabel: string;
}>;

function sanitizeOverlayPayload(payload: OverlayPayload, base: Awaited<ReturnType<typeof readOverlayStudioState>>["draftOverlay"], updatedAt: string) {
  const disabledLayersSource = payload.disabledLayers ?? base.disabledLayers;
  const normalizeText = (value: unknown, maxLength: number) => stripInvisibleCharacters(String(value ?? "")).trim().slice(0, maxLength);
  // The scene list decides the picture, so a request that sends one wins over the layer array it
  // also sends. A request that sends neither keeps the stored scenes; one that sends only
  // `customLayers` (an older client, or the preset-apply path) has them folded into the active
  // scene rather than into a field nothing reads any more.
  const scenes = payload.scenes
    ? normalizeOverlayNamedScenes(payload.scenes, base.customLayers)
    : payload.customLayers
      ? normalizeOverlayNamedScenes(
          base.scenes.map((scene) =>
            scene.id === base.activeSceneId
              ? { ...scene, customLayers: normalizeOverlaySceneCustomLayers(payload.customLayers) }
              : scene
          ),
          payload.customLayers
        )
      : normalizeOverlayNamedScenes(base.scenes, base.customLayers);
  const activeSceneId = resolveActiveOverlayNamedSceneId(scenes, payload.activeSceneId ?? base.activeSceneId);
  return {
    ...base,
    enabled: payload.enabled ?? base.enabled,
    channelName: normalizeText(payload.channelName ?? base.channelName, 80) || "Stream247",
    headline: normalizeText(payload.headline ?? base.headline, 120) || "Always on air",
    insertHeadline: normalizeText(payload.insertHeadline ?? base.insertHeadline, 120) || "Insert on air",
    standbyHeadline: normalizeText(payload.standbyHeadline ?? base.standbyHeadline, 120) || "Please wait, restream is starting",
    reconnectHeadline:
      normalizeText(payload.reconnectHeadline ?? base.reconnectHeadline, 120) || "Scheduled reconnect in progress",
    brandBadge: normalizeText(payload.brandBadge ?? base.brandBadge, 48),
    scenePreset: normalizeOverlayScenePreset(String(payload.scenePreset ?? base.scenePreset)),
    insertScenePreset: normalizeOverlayScenePreset(String(payload.insertScenePreset ?? base.insertScenePreset)),
    standbyScenePreset: normalizeOverlayScenePreset(String(payload.standbyScenePreset ?? base.standbyScenePreset)),
    reconnectScenePreset: normalizeOverlayScenePreset(String(payload.reconnectScenePreset ?? base.reconnectScenePreset)),
    accentColor: normalizeText(payload.accentColor ?? base.accentColor, 20) || "#0e6d5a",
    surfaceStyle: normalizeOverlaySurfaceStyle(String(payload.surfaceStyle ?? base.surfaceStyle)),
    panelAnchor: normalizeOverlayPanelAnchor(String(payload.panelAnchor ?? base.panelAnchor)),
    titleScale: normalizeOverlayTitleScale(String(payload.titleScale ?? base.titleScale)),
    typographyPreset: normalizeOverlayTypographyPreset(String(payload.typographyPreset ?? base.typographyPreset)),
    showClock: payload.showClock ?? base.showClock,
    showNextItem: payload.showNextItem ?? base.showNextItem,
    showScheduleTeaser: payload.showScheduleTeaser ?? base.showScheduleTeaser,
    showCurrentCategory: payload.showCurrentCategory ?? base.showCurrentCategory,
    showSourceLabel: payload.showSourceLabel ?? base.showSourceLabel,
    showQueuePreview: payload.showQueuePreview ?? base.showQueuePreview,
    queuePreviewCount: Math.max(1, Math.min(5, Number(payload.queuePreviewCount ?? base.queuePreviewCount) || 3)),
    layerOrder: normalizeOverlaySceneLayerOrder(payload.layerOrder ?? base.layerOrder),
    disabledLayers: normalizeOverlaySceneLayerOrder(disabledLayersSource).filter((kind) => disabledLayersSource.includes(kind)),
    scenes,
    activeSceneId,
    customLayers: resolveOverlayNamedSceneCustomLayers(scenes, activeSceneId),
    panelPlacements: normalizeOverlayScenePanelPlacements(payload.panelPlacements ?? base.panelPlacements),
    emergencyBanner: normalizeText(payload.emergencyBanner ?? base.emergencyBanner, 180),
    tickerText: normalizeText(payload.tickerText ?? base.tickerText, 180),
    // Left unclamped here on purpose: the store clamps it to the renderer's own bounds, and a
    // second set of bounds in the route is the second place they would have to be kept in step.
    tickerRotateSeconds: Number(payload.tickerRotateSeconds ?? base.tickerRotateSeconds),
    replayLabel: normalizeText(payload.replayLabel ?? base.replayLabel, 80) || "Replay stream",
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
