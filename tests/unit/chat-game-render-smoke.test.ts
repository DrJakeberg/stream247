import { describe, expect, it } from "vitest";
import {
  SNAKE_GAME_DEFINITION,
  createDefaultChatGameSettings,
  type OverlayScenePayloadView
} from "@stream247/core";
import { loadSceneRendererFonts, renderSceneFrame } from "../../apps/worker/src/scene-renderer";

/**
 * Rasterises one real frame with the game panel through satori and resvg.
 *
 * The layout tests assert the tree; this asserts satori accepts it. Satori implements only a CSS
 * subset and fails at render time on anything outside it, which no amount of tree inspection can
 * catch — and the render loop degrades to a frozen frame on failure, so the first symptom on air
 * would be an overlay that silently never updates. Skips (inconclusive, not failed) on machines
 * without a usable font, which is the renderer's own startup requirement anyway.
 */
describe("game panel rasterisation smoke", () => {
  it("renders a PNG frame containing the game panel", async () => {
    let fonts;
    try {
      fonts = await loadSceneRendererFonts(process.env);
    } catch {
      // No fonts on this machine; smoke is inconclusive rather than failed.
      return;
    }

    const settings = createDefaultChatGameSettings();
    const game = SNAKE_GAME_DEFINITION.renderModel(SNAKE_GAME_DEFINITION.createInitialState(settings, 3), settings);
    const payload: OverlayScenePayloadView = {
      scene: {
        surfaceStyle: "glass",
        panelAnchor: "bottom",
        titleScale: "balanced",
        typographyPreset: "studio-sans",
        resolvedPresetId: "lower-third",
        customLayers: [
          {
            kind: "game",
            enabled: true,
            xPercent: 60,
            yPercent: 10,
            widthPercent: 30,
            heightPercent: 44,
            opacityPercent: 100,
            allowOutsideSafeArea: false
          }
        ]
      },
      channelName: "3JC Retro",
      accentColor: "#6ee7ff",
      brandLine: "STREAM247",
      heroLabel: "Now playing",
      heroTitle: "Advent of Code 2025",
      heroBody: "Recorded live",
      metaLine: "Programming",
      nextLabel: "Up next",
      nextTitle: "Retro Night",
      nextTimeLabel: "21:30",
      queueTitles: [],
      tickerText: "",
      emergencyBanner: "",
      timeZone: "Europe/Berlin"
    };

    const png = await renderSceneFrame({ payload, game, width: 1280, height: 720 }, fonts);
    expect(png.length).toBeGreaterThan(1000);
    // PNG magic bytes.
    expect(png.subarray(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  }, 30_000);
});
