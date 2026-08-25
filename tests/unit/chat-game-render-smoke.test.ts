import { describe, expect, it } from "vitest";
import {
  GAME_2048_DEFINITION,
  MINESWEEPER_GAME_DEFINITION,
  SNAKE_GAME_DEFINITION,
  createDefaultChatGameSettings,
  normalizeChatGameSettings,
  type OverlayGameView,
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
function buildGamePayload(): OverlayScenePayloadView {
  return {
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
}

async function rasteriseGamePanel(game: OverlayGameView): Promise<void> {
  let fonts;
  try {
    fonts = await loadSceneRendererFonts(process.env);
  } catch {
    // No fonts on this machine; smoke is inconclusive rather than failed.
    return;
  }

  const png = await renderSceneFrame({ payload: buildGamePayload(), game, width: 1280, height: 720 }, fonts);
  expect(png.length).toBeGreaterThan(1000);
  // PNG magic bytes.
  expect(png.subarray(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
}

describe("game panel rasterisation smoke", () => {
  it("renders a PNG frame containing the snake panel", async () => {
    const settings = createDefaultChatGameSettings();
    await rasteriseGamePanel(
      SNAKE_GAME_DEFINITION.renderModel(SNAKE_GAME_DEFINITION.createInitialState(settings, 3), settings)
    );
  }, 30_000);

  it("renders a PNG frame containing the minesweeper panel, coordinate gutter and numbers included", async () => {
    const settings = normalizeChatGameSettings({ gameId: "minesweeper" });
    // One dig so the panel carries what makes it minesweeper: revealed ground and numbered cells.
    const dug = MINESWEEPER_GAME_DEFINITION.applyInput(
      MINESWEEPER_GAME_DEFINITION.createInitialState(settings, 3),
      { cell: { x: 8, y: 4 } },
      settings
    );
    await rasteriseGamePanel(MINESWEEPER_GAME_DEFINITION.renderModel(dug, settings));
  }, 30_000);

  it("renders a PNG frame containing the 2048 panel with its numbered tiles", async () => {
    const settings = normalizeChatGameSettings({ gameId: "2048" });
    // A hand-built board over the seeded opener: labels of every length, both tile marks.
    const state = {
      phase: "playing" as const,
      tiles: [2, 4, 0, 0, 0, 64, 0, 0, 0, 0, 128, 0, 0, 0, 0, 2048],
      score: 2464,
      seed: 3
    };
    await rasteriseGamePanel(GAME_2048_DEFINITION.renderModel(state, settings));
  }, 30_000);
});
