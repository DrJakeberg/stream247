// Native on-air overlay renderer.
//
// Rasterises the shared overlay layout (packages/core/overlay-layout.ts) to a transparent PNG that
// ffmpeg composites over the programme video. This replaces on-air-scene.ts, which launched a full
// Chromium process per frame to screenshot the /overlay page: on the production box every attempt
// exceeded its 10s timeout, so the overlay never actually rendered and each playout start paid
// 10 seconds for the failure.
//
// Measured on the same class of machine: ~70ms per 1920x1080 frame, warm.
//
// The satori half and the font resolution now live in @stream247/overlay-render, because the studio
// preview draws the same frame in the browser. What stays here is the part only a video pipeline
// needs: turning the SVG into pixels, and knowing when a frame is worth redrawing at all.

import { Resvg } from "@resvg/resvg-js";
import { overlayTickerLine, formatOverlayClock} from "@stream247/core";
import { renderSceneSvg, type SceneRenderFont, type SceneRenderRequest } from "@stream247/overlay-render";

export {
  loadSceneRendererFonts,
  renderSceneSvg,
  type SceneRenderFont,
  type SceneRenderRequest
} from "@stream247/overlay-render";

/**
 * Renders one overlay frame to a transparent PNG.
 */
export async function renderSceneFrame(request: SceneRenderRequest, fonts: SceneRenderFont[]): Promise<Buffer> {
  // Outlines are embedded: resvg rasterises the SVG as an isolated document with no font of its
  // own to fall back on.
  const svg = await renderSceneSvg(request, fonts, { embedFont: true });

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
    request.game ?? null,
    // Included so a new chat message re-rasterises the frame, and a quiet room does not.
    request.chat ?? null,
    // Capture identity only, NEVER the data URI: keys are compared every render tick and held in
    // memory, and a few hundred kilobytes of base64 in every key would make both of those costs
    // scale with image size for zero extra information — capturedAt already changes exactly when
    // the picture does.
    request.sourceFrame ? [request.sourceFrame.status, request.sourceFrame.capturedAt] : null,
    // The ticker is the only thing on the frame that changes without its data changing, so it is
    // the only reason this key carries a clock — and it carries the drawn line rather than the
    // clock itself, which would make every key unique and turn the cache off. With no ticker text
    // this is "" forever and the key is byte-for-byte the key it was before the panel existed;
    // with one message it is that message forever. Only a rotation moves it, and then exactly once
    // per dwell, which is what makes the renderer redraw at all: without this term the ticker
    // would advance in the layout and never reach a viewer.
    overlayTickerLine(request.payload, request.now ?? new Date()),
    // The clock is the other thing on the frame that moves without its data moving, and it moved
    // unseen: on a channel where nothing else changes -- a long VOD, no chat, no game -- the
    // renderer kept pushing the PNG it had and the on-air time stood at a stale minute. Same
    // remedy as the ticker: carry the string that is drawn, not the instant it came from, so this
    // term changes once a minute instead of once a render.
    formatOverlayClock(request.now ?? new Date(), request.payload.timeZone)
  ]);
}
