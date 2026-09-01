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
      { width: request.width, height: request.height, now: request.now }
    ) as Parameters<typeof satori>[0],
    {
      width: request.width,
      height: request.height,
      fonts,
      embedFont: options.embedFont ?? true
    }
  );
}
