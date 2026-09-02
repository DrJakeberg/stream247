// The satori half of the overlay renderer.
//
// Everything up to the SVG lives here and is shared. Only the SVG-to-PNG step stays in the worker,
// because only the worker needs pixels: ffmpeg composites a PNG, a browser draws the SVG directly.
// That split is the whole point — the studio preview and the broadcast frame are now the same
// layout run through the same layout engine with the same fonts, differing only in what the last
// step turns the vectors into.

import satori from "satori";
import {
  buildOverlaySceneLayout,
  overlayFontFamily,
  OVERLAY_TICKER_TEXT,
  type OverlayChatView,
  type OverlayEngagementView,
  type OverlayGameView,
  type OverlayScenePayloadView,
  type OverlaySourceFrameView
} from "@stream247/core";
import type { SceneRenderFont } from "./fonts.js";

export type SceneRenderRequest = {
  payload: OverlayScenePayloadView;
  engagement?: OverlayEngagementView | null;
  game?: OverlayGameView | null;
  chat?: OverlayChatView | null;
  sourceFrame?: OverlaySourceFrameView | null;
  width: number;
  height: number;
  /** Wall clock for the on-air clock. Injected so a render can be made byte-for-byte repeatable. */
  now?: Date;
  /**
   * How the ticker band is drawn. "crawl" when ffmpeg is running the line across it — the band is
   * drawn empty and belongs to the process. Anything else draws the line at rest, which is what a
   * still picture has to show.
   */
  tickerMode?: "static" | "crawl";
};

export type SceneRenderSvgOptions = {
  /**
   * Whether to embed the glyph outlines in the SVG.
   *
   * true for anything that will be rasterised or shown in an <img>: those are isolated documents
   * with no access to the page's fonts, so without outlines the text is simply absent.
   *
   * false for an SVG inlined into a page that declares the same faces in @font-face — the glyphs
   * are already on the client, and sending them again costs several times the size of everything
   * else in the frame put together.
   */
  embedFont?: boolean;
};

/**
 * Renders one overlay frame to SVG.
 */
export async function renderSceneSvg(
  request: SceneRenderRequest,
  fonts: SceneRenderFont[],
  options: SceneRenderSvgOptions = {}
): Promise<string> {
  return satori(
    buildOverlaySceneLayout(
      {
        payload: request.payload,
        engagement: request.engagement ?? null,
        game: request.game ?? null,
        chat: request.chat ?? null,
        sourceFrame: request.sourceFrame ?? null
      },
      { width: request.width, height: request.height, now: request.now, tickerMode: request.tickerMode }
    ) as Parameters<typeof satori>[0],
    {
      width: request.width,
      height: request.height,
      fonts,
      embedFont: options.embedFont ?? true
    }
  );
}

/** What the strip needs to know: the line, how tall its run is, and the frame it belongs to. */
export type TickerStripRequest = {
  line: string;
  /** Height of the clear run inside the band — the strip is exactly this tall. */
  height: number;
  /** overlayScale of the frame, so the strip's ink matches the band's at any output size. */
  scale: number;
  typographyPreset: string;
};

export type TickerStripSvg = {
  svg: string;
  /** The canvas, deliberately wider than the line. Where the ink ENDS is measured on the pixels. */
  width: number;
  height: number;
};

/**
 * Renders the ticker line as a transparent strip for ffmpeg to crawl.
 *
 * The canvas is deliberately wider than the line and the tail stays transparent. That is not
 * waste: two copies of this strip are overlaid a period apart, and a transparent tail is what lets
 * the second copy show through the first's empty run instead of punching a hole in it.
 *
 * The width estimate is the 180-character stored cap against the worst glyph anybody can type — a
 * full-width CJK advance is one em, so line length times font size plus letter spacing, with a
 * third again on top and a margin past that. A line that outgrew its canvas would be cut, and a
 * cut line crawls a period that does not match its ink.
 */
export async function renderTickerStripSvg(
  request: TickerStripRequest,
  fonts: SceneRenderFont[]
): Promise<TickerStripSvg | null> {
  const line = request.line.trim();
  if (!line) {
    return null;
  }

  const px = (value: number) => Math.round(value * request.scale);
  const fontSize = px(OVERLAY_TICKER_TEXT.fontSize);
  const letterSpacing = px(OVERLAY_TICKER_TEXT.letterSpacing);
  const width = Math.ceil([...line].length * (fontSize + letterSpacing) * 1.3) + px(64);

  const svg = await satori(
    {
      type: "div",
      props: {
        style: {
          display: "flex",
          alignItems: "center",
          width,
          height: request.height,
          backgroundColor: "rgba(0,0,0,0)"
        },
        children: [
          {
            type: "div",
            props: {
              style: {
                display: "flex",
                color: "#ffffff",
                fontSize,
                fontFamily: overlayFontFamily(request.typographyPreset),
                fontWeight: OVERLAY_TICKER_TEXT.fontWeight,
                lineHeight: OVERLAY_TICKER_TEXT.lineHeight,
                letterSpacing,
                whiteSpace: "nowrap",
                flexShrink: 0
              },
              children: line
            }
          }
        ]
      }
    } as Parameters<typeof satori>[0],
    {
      width,
      height: request.height,
      fonts,
      embedFont: true
    }
  );

  return { svg, width, height: request.height };
}
