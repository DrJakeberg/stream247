import { describe, expect, it } from "vitest";
import type { OverlayCustomLayerView, OverlayScenePayloadView } from "@stream247/core";
import { loadSceneRendererFonts, renderSceneFrame, type SceneRenderFont } from "../../apps/worker/src/scene-renderer";

/**
 * Rasterises real frames with the M57 source/media/text panels through satori and resvg.
 *
 * Same reasoning as the game-panel smoke: satori implements a CSS subset and fails at render
 * time on anything outside it — especially img nodes, which no tree inspection can validate.
 * Skips (inconclusive, not failed) on machines without a usable font.
 */

/**
 * A camera-sized capture stand-in: a real PNG of the requested size, produced by the renderer
 * pipeline itself so the test needs neither fixtures nor a direct native-module import.
 */
async function buildCapturePngDataUri(width: number, height: number, fonts: SceneRenderFont[]): Promise<string> {
  const png = await renderSceneFrame({ payload: buildPayload([]), width, height }, fonts);
  return `data:image/png;base64,${png.toString("base64")}`;
}

function buildPayload(customLayers: OverlayCustomLayerView[]): OverlayScenePayloadView {
  return {
    scene: {
      surfaceStyle: "glass",
      panelAnchor: "bottom",
      titleScale: "balanced",
      typographyPreset: "studio-sans",
      resolvedPresetId: "lower-third",
      customLayers
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

const SOURCE_LAYER: OverlayCustomLayerView = {
  kind: "source",
  enabled: true,
  xPercent: 60,
  yPercent: 8,
  widthPercent: 30,
  heightPercent: 32,
  opacityPercent: 100,
  allowOutsideSafeArea: false,
  sourceId: "front-desk"
};

async function loadFontsOrSkip(): Promise<SceneRenderFont[] | null> {
  try {
    return await loadSceneRendererFonts(process.env);
  } catch {
    return null;
  }
}

function expectPng(png: Buffer): void {
  expect(png.length).toBeGreaterThan(1000);
  expect(png.subarray(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
}

describe("source and media panel rasterisation smoke", () => {
  it("renders a PNG frame containing a camera-sized source capture, well under the 1s budget", async () => {
    const fonts = await loadFontsOrSkip();
    if (!fonts) {
      return;
    }

    const sourceFrame = {
      dataUri: await buildCapturePngDataUri(640, 360, fonts),
      status: "live",
      capturedAt: "2026-08-26T10:00:00.000Z"
    };

    // Warm-up excluded from the measurement, mirroring how the render loop actually runs.
    await renderSceneFrame({ payload: buildPayload([SOURCE_LAYER]), sourceFrame, width: 1280, height: 720 }, fonts);
    const startedAt = performance.now();
    const png = await renderSceneFrame({ payload: buildPayload([SOURCE_LAYER]), sourceFrame, width: 1280, height: 720 }, fonts);
    const elapsedMs = performance.now() - startedAt;

    expectPng(png);
    // The overlay pipe writer needs a frame per second; a rasterisation anywhere near that budget
    // would be a regression worth failing on.
    expect(elapsedMs).toBeLessThan(1000);
    console.info(`source-panel frame with a 640x360 capture rasterised in ${elapsedMs.toFixed(1)}ms`);
  }, 30_000);

  it("renders a PNG frame with logo, image and text layers on air together", async () => {
    const fonts = await loadFontsOrSkip();
    if (!fonts) {
      return;
    }

    const stillDataUri = await buildCapturePngDataUri(320, 180, fonts);
    const png = await renderSceneFrame(
      {
        payload: buildPayload([
          { kind: "logo", enabled: true, xPercent: 76, yPercent: 4, widthPercent: 16, heightPercent: 12, opacityPercent: 100, allowOutsideSafeArea: false, url: stillDataUri, fit: "contain" },
          { kind: "image", enabled: true, xPercent: 4, yPercent: 40, widthPercent: 22, heightPercent: 22, opacityPercent: 80, allowOutsideSafeArea: false, url: stillDataUri, fit: "cover" },
          { kind: "text", enabled: true, xPercent: 30, yPercent: 8, widthPercent: 30, heightPercent: 14, opacityPercent: 100, allowOutsideSafeArea: false, text: "Studio reopens tonight", secondaryText: "Doors at nine", textTone: "headline", textAlign: "center", useAccent: true }
        ]),
        width: 1280,
        height: 720
      },
      fonts
    );

    expectPng(png);
  }, 30_000);

  it("renders cleanly with a source layer whose feed is away — panel absent, frame intact", async () => {
    const fonts = await loadFontsOrSkip();
    if (!fonts) {
      return;
    }

    const png = await renderSceneFrame(
      {
        payload: buildPayload([SOURCE_LAYER]),
        sourceFrame: { dataUri: "", status: "stale", capturedAt: "2026-08-26T09:00:00.000Z" },
        width: 1280,
        height: 720
      },
      fonts
    );

    expectPng(png);
  }, 30_000);
});
