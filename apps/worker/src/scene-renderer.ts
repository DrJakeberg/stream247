// Native on-air overlay renderer.
//
// Rasterises the shared overlay layout (packages/core/overlay-layout.ts) to a transparent PNG that
// ffmpeg composites over the programme video. This replaces on-air-scene.ts, which launched a full
// Chromium process per frame to screenshot the /overlay page: on the production box every attempt
// exceeded its 10s timeout, so the overlay never actually rendered and each playout start paid
// 10 seconds for the failure.
//
// Measured on the same class of machine: ~70ms per 1920x1080 frame, warm.

import { promises as fs } from "node:fs";
import { Resvg } from "@resvg/resvg-js";
import satori from "satori";
import {
  buildOverlaySceneLayout,
  type OverlayEngagementView,
  type OverlayGameView,
  type OverlayScenePayloadView
} from "@stream247/core";

export type SceneRenderFont = {
  name: string;
  data: Buffer;
  weight: 400 | 700;
  style: "normal";
};

// Families referenced by the layout's typography presets. Every preset resolves to a real loaded
// family; satori drops text silently if a referenced family is missing, so all three are aliased
// onto whatever font files are available rather than left dangling.
const LAYOUT_FONT_FAMILIES = ["Stream247 Sans", "Stream247 Serif", "Stream247 Mono"] as const;

const DEFAULT_FONT_CANDIDATES = {
  regular: [
    "/usr/share/fonts/TTF/DejaVuSans.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/dejavu/DejaVuSans.ttf"
  ],
  bold: [
    "/usr/share/fonts/TTF/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf"
  ]
} as const;

async function readFirstAvailable(candidates: readonly string[], override: string): Promise<Buffer | null> {
  for (const candidate of [override, ...candidates].filter(Boolean)) {
    try {
      return await fs.readFile(candidate);
    } catch {
      continue;
    }
  }

  return null;
}

/**
 * Loads the font files once. Fonts are the only external input the renderer needs; without at
 * least a regular face satori cannot lay out any text.
 */
export async function loadSceneRendererFonts(env: NodeJS.ProcessEnv): Promise<SceneRenderFont[]> {
  const regular = await readFirstAvailable(DEFAULT_FONT_CANDIDATES.regular, env.OVERLAY_FONT_REGULAR_PATH || "");
  if (!regular) {
    throw new Error(
      `No overlay font found. Set OVERLAY_FONT_REGULAR_PATH or install a font at one of: ${DEFAULT_FONT_CANDIDATES.regular.join(", ")}`
    );
  }

  const bold = (await readFirstAvailable(DEFAULT_FONT_CANDIDATES.bold, env.OVERLAY_FONT_BOLD_PATH || "")) ?? regular;

  return LAYOUT_FONT_FAMILIES.flatMap<SceneRenderFont>((name) => [
    { name, data: regular, weight: 400, style: "normal" },
    { name, data: bold, weight: 700, style: "normal" }
  ]);
}

export type SceneRenderRequest = {
  payload: OverlayScenePayloadView;
  engagement?: OverlayEngagementView | null;
  game?: OverlayGameView | null;
  width: number;
  height: number;
};

/**
 * Renders one overlay frame to a transparent PNG.
 */
export async function renderSceneFrame(request: SceneRenderRequest, fonts: SceneRenderFont[]): Promise<Buffer> {
  const svg = await satori(
    buildOverlaySceneLayout(
      { payload: request.payload, engagement: request.engagement ?? null, game: request.game ?? null },
      { width: request.width, height: request.height }
    ) as Parameters<typeof satori>[0],
    {
      width: request.width,
      height: request.height,
      fonts
    }
  );

  const png = new Resvg(svg, {
    fitTo: { mode: "width", value: request.width },
    // Every pixel the layout does not paint must stay transparent: ffmpeg overlays this at 0:0.
    background: "rgba(0,0,0,0)"
  })
    .render()
    .asPng();

  return Buffer.from(png);
}

/**
 * Stable identity for a rendered frame.
 *
 * The overlay only changes when its content changes, so the render loop can keep pushing the last
 * PNG and skip rasterising entirely while nothing moves. Without this the renderer would burn CPU
 * redrawing an identical lower third for the entire length of a video.
 */
export function sceneFrameCacheKey(request: SceneRenderRequest): string {
  return JSON.stringify([
    request.width,
    request.height,
    request.payload,
    request.engagement ?? null,
    // Included so a game input re-rasterises the frame, and an idle game does not.
    request.game ?? null
  ]);
}
