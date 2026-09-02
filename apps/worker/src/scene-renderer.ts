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
import {
  renderSceneSvg,
  renderTickerStripSvg,
  type SceneRenderFont,
  type SceneRenderRequest,
  type TickerStripRequest,
  type TickerStripSvg
} from "@stream247/overlay-render";

export {
  loadSceneRendererFonts,
  renderSceneSvg,
  renderTickerStripSvg,
  type TickerStripRequest,
  type TickerStripSvg,
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
    overlayTickerLine(request.payload),
    // The band is drawn from this, not from the text, whenever a crawl is running: a key that
    // ignored it would let a frame rendered in one mode be pushed in the other.
    request.tickerCrawl ?? null,
    // The clock is the other thing on the frame that moves without its data moving, and it moved
    // unseen: on a channel where nothing else changes -- a long VOD, no chat, no game -- the
    // renderer kept pushing the PNG it had and the on-air time stood at a stale minute. Same
    // remedy as the ticker: carry the string that is drawn, not the instant it came from, so this
    // term changes once a minute instead of once a render.
    formatOverlayClock(request.now ?? new Date(), request.payload.timeZone)
  ]);
}

/** A rendered ticker strip, with the pixels ffmpeg reads and the ink width its period is built from. */
export type TickerStripFrame = TickerStripSvg & { png: Buffer; inkWidth: number };

/**
 * The last column the strip actually painted.
 *
 * Measured on the pixels rather than taken from satori's layout, because the two disagree: on this
 * rasteriser the laid-out text node ended 3px before the ink did, and the crawl period is built
 * from this number. Three pixels of overlap in a 240px gap would never be seen, but a period built
 * from a guess is a period that has to be re-guessed the next time the face or the size changes.
 *
 * Scans from the right and stops at the first painted column, and reads the framebuffer ONCE into
 * a local: resvg's pixels is a getter that copies the whole buffer per access, and a scan that
 * touched it per pixel allocated 21GB and had the kernel kill the test runner.
 */
function measureInkWidth(image: { width: number; height: number; pixels: Buffer }): number {
  const pixels = image.pixels;
  const { width, height } = image;
  for (let x = width - 1; x >= 0; x--) {
    for (let y = 0; y < height; y++) {
      if (pixels[(y * width + x) * 4 + 3]! > 16) {
        return x + 1;
      }
    }
  }
  return 0;
}

/**
 * The widest strip worth rasterising, on the design grid.
 *
 * 180 stored characters at the widest glyph the loaded face carries — U+1671 advances 2.02 em at
 * font size 26 — is about 9500px, so this is roughly two and a half times the worst line anybody
 * can type. It exists so a runaway estimate cannot ask for a framebuffer the box has to find.
 */
const TICKER_STRIP_MAX_WIDTH = 24_000;

/**
 * Renders the ticker line to the transparent strip ffmpeg crawls across the band.
 *
 * Rasterised once per ticker text, not once per frame: the motion is ffmpeg moving this image, so
 * nothing here runs on the render tick. Null when there is no line, which is also how the caller
 * learns to build a graph without a crawl in it.
 *
 * The canvas is estimated from the line length and the estimate can be wrong — a wall of glyphs
 * wider than 1.3 em outgrows it and the line is silently CUT, which puts a period on the crawl that
 * does not match its ink and a tail on the picture that never reaches air. So the ink is measured
 * and, if it has reached the edge, the canvas is doubled and the strip drawn again. Twice at most:
 * four times the estimate covers every glyph in the face, and a strip is one band-tall picture.
 */
export async function renderTickerStrip(
  request: TickerStripRequest,
  fonts: SceneRenderFont[]
): Promise<TickerStripFrame | null> {
  let canvasWidth = request.canvasWidth;

  for (let attempt = 0; attempt < 3; attempt++) {
    const strip = await renderTickerStripSvg({ ...request, canvasWidth }, fonts);
    if (!strip) {
      return null;
    }
    const image = new Resvg(strip.svg, {
      fitTo: { mode: "width", value: strip.width },
      background: "rgba(0,0,0,0)"
    }).render();
    const inkWidth = measureInkWidth(image);
    const cut = inkWidth >= strip.width - 1;
    if (!cut || strip.width >= TICKER_STRIP_MAX_WIDTH) {
      return { ...strip, png: Buffer.from(image.asPng()), inkWidth };
    }
    canvasWidth = Math.min(TICKER_STRIP_MAX_WIDTH, strip.width * 2);
  }

  // Distinct from the null above, which means "there is no line". Reaching here means the line
  // could not be drawn whole at four times the estimate, and the caller must hear about that
  // rather than quietly fall back to a ticker standing still.
  throw new Error("Ticker strip could not be drawn without cutting the line.");
}
