// Shape guard for the studio preview request.
//
// The scene payload the studio previews is assembled in the browser, from a draft the operator is
// still typing into, and posted back here to be drawn by the same renderer that draws the
// broadcast. The layout already coerces every text field and clamps every placement, so this does
// not re-validate meaning — it bounds *size*. Without that, one request could ask the renderer to
// lay out a megabyte of text or ten thousand layers, on the machine that is encoding the channel.

import type { OverlayCustomLayerView, OverlayScenePayloadView } from "@stream247/core";

/** Broadcast geometry by default: the preview is only honest at the size that goes out. */
export const SCENE_PREVIEW_DEFAULT_WIDTH = 1920;
export const SCENE_PREVIEW_DEFAULT_HEIGHT = 1080;

const MIN_WIDTH = 640;
const MIN_HEIGHT = 360;
/** Generous next to the ~180 characters the layout itself keeps, and far short of a denial. */
const MAX_TEXT_CHARS = 2_000;
const MAX_QUEUE_TITLES = 24;
/** The scene editor's own palette tops out well below this. */
const MAX_CUSTOM_LAYERS = 64;

function str(value: unknown): string {
  return typeof value === "string" ? value.slice(0, MAX_TEXT_CHARS) : "";
}

function num(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function bool(value: unknown): boolean {
  return value === true;
}

function dimension(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Math.round(num(value, fallback));
  return Math.min(max, Math.max(min, parsed));
}

function normalizeCustomLayer(value: unknown): OverlayCustomLayerView {
  const raw = (value ?? {}) as Record<string, unknown>;

  return {
    kind: str(raw.kind),
    enabled: bool(raw.enabled),
    xPercent: num(raw.xPercent, 0),
    yPercent: num(raw.yPercent, 0),
    widthPercent: num(raw.widthPercent, 0),
    heightPercent: num(raw.heightPercent, 0),
    opacityPercent: num(raw.opacityPercent, 100),
    allowOutsideSafeArea: bool(raw.allowOutsideSafeArea),
    sourceId: str(raw.sourceId),
    url: str(raw.url),
    fit: str(raw.fit),
    text: str(raw.text),
    secondaryText: str(raw.secondaryText),
    textTone: str(raw.textTone),
    textAlign: str(raw.textAlign),
    useAccent: bool(raw.useAccent),
    fontMode: str(raw.fontMode)
  };
}

export type ScenePreviewRequest = {
  payload: OverlayScenePayloadView;
  width: number;
  height: number;
};

/**
 * Returns the render request, or null when the body carries no scene at all — which is a client
 * mistake worth reporting rather than an empty overlay worth drawing.
 */
export function normalizeScenePreviewRequest(body: unknown): ScenePreviewRequest | null {
  const raw = (body ?? {}) as Record<string, unknown>;
  const payload = raw.payload;
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const source = payload as Record<string, unknown>;
  const scene = (source.scene ?? {}) as Record<string, unknown>;
  const customLayers = Array.isArray(scene.customLayers) ? scene.customLayers.slice(0, MAX_CUSTOM_LAYERS) : [];
  const queueTitles = Array.isArray(source.queueTitles) ? source.queueTitles.slice(0, MAX_QUEUE_TITLES) : [];

  return {
    width: dimension(raw.width, SCENE_PREVIEW_DEFAULT_WIDTH, MIN_WIDTH, SCENE_PREVIEW_DEFAULT_WIDTH),
    height: dimension(raw.height, SCENE_PREVIEW_DEFAULT_HEIGHT, MIN_HEIGHT, SCENE_PREVIEW_DEFAULT_HEIGHT),
    payload: {
      scene: {
        surfaceStyle: str(scene.surfaceStyle),
        panelAnchor: str(scene.panelAnchor),
        titleScale: str(scene.titleScale),
        typographyPreset: str(scene.typographyPreset),
        resolvedPresetId: str(scene.resolvedPresetId),
        customLayers: customLayers.map(normalizeCustomLayer)
      },
      channelName: str(source.channelName),
      accentColor: str(source.accentColor),
      brandLine: str(source.brandLine),
      heroLabel: str(source.heroLabel),
      heroTitle: str(source.heroTitle),
      heroBody: str(source.heroBody),
      metaLine: str(source.metaLine),
      nextLabel: str(source.nextLabel),
      nextTitle: str(source.nextTitle),
      nextTimeLabel: str(source.nextTimeLabel),
      queueTitles: queueTitles.map(str),
      tickerText: str(source.tickerText),
      emergencyBanner: str(source.emergencyBanner),
      timeZone: str(source.timeZone)
    }
  };
}
