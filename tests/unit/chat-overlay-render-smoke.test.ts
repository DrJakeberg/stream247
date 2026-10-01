import { describe, expect, it } from "vitest";
import type { OverlayChatView, OverlayScenePayloadView } from "@stream247/core";
import { loadSceneRendererFonts, renderSceneFrame } from "../../apps/worker/src/scene-renderer";

/**
 * Rasterises one real frame with the chat panel through satori and resvg.
 *
 * The layout tests assert the tree; this asserts satori accepts it — including lineClamp, which
 * only exists at render time and which the one-line height claim depends on. The messages are
 * deliberately the hostile kind chat actually sends: CJK walls that defeat per-character width
 * estimates, and emote codes that stay words because satori draws text, not images. Skips
 * (inconclusive, not failed) on machines without a usable font, the renderer's own startup
 * requirement anyway.
 */
function createSmokePayload(): OverlayScenePayloadView {
  return {
    scene: {
      surfaceStyle: "glass",
      panelAnchor: "bottom",
      titleScale: "balanced",
      typographyPreset: "studio-sans",
      resolvedPresetId: "lower-third",
      customLayers: []
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

describe("chat panel rasterisation smoke", () => {
  it("renders a deterministic PNG frame containing the chat panel", async () => {
    let fonts;
    try {
      fonts = await loadSceneRendererFonts(process.env);
    } catch {
      // No fonts on this machine; smoke is inconclusive rather than failed.
      return;
    }

    const chat: OverlayChatView = {
      position: "bottom-left",
      maxMessages: 5,
      messages: [
        { name: "viewer_one", text: "Kappa this stream rules Kappa" },
        { name: "配信好き", text: "これは非常に長い全角メッセージでレイアウトの幅見積もりを壊しに来ています" },
        { name: "wall_builder", text: "word ".repeat(50).trim() }
      ]
    };
    const payload = createSmokePayload();

    const minuteBefore = new Date().getMinutes();
    const png = await renderSceneFrame({ payload, chat, width: 1280, height: 720 }, fonts);
    expect(png.length).toBeGreaterThan(1000);
    // PNG magic bytes.
    expect(png.subarray(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    // The render loop's frame cache keys on content, so identical content must rasterise to
    // identical bytes. The on-air clock is the layout's only wall-clock input; it ticks per
    // minute, so the comparison only counts when both renders fell inside the same minute.
    const again = await renderSceneFrame({ payload, chat, width: 1280, height: 720 }, fonts);
    if (new Date().getMinutes() === minuteBefore) {
      expect(again.equals(png)).toBe(true);
    }
  }, 30_000);

  /**
   * The emote path's one dangerous property, asserted against the real rasteriser.
   *
   * satori derives an image's intrinsic size by fetching it, and on a failed fetch it throws
   * "Image size cannot be determined. Please provide the width and height of the image." — which
   * loses the entire frame. The overlay would then go dark for one unreachable emote, on the
   * surface nobody can refresh. Declaring width and height makes it skip the picture instead.
   *
   * The URL is on an unresolvable host on purpose: this needs no network to be meaningful, and on
   * a machine that has one it exercises exactly the failure a CDN outage produces.
   */
  it("keeps rendering the frame when an emote picture cannot be fetched", async () => {
    let fonts;
    try {
      fonts = await loadSceneRendererFonts(process.env);
    } catch {
      return;
    }

    const chat: OverlayChatView = {
      position: "bottom-left",
      maxMessages: 5,
      messages: [
        {
          name: "viewer_one",
          text: "Kappa hello",
          segments: [
            { kind: "emote", id: "25", url: "https://static-cdn.jtvnw.net.invalid/emoticons/v2/25/default/dark/1.0" },
            { kind: "text", text: " hello" }
          ]
        }
      ]
    };

    const png = await renderSceneFrame({ payload: createSmokePayload(), chat, width: 1280, height: 720 }, fonts);
    expect(png.subarray(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    // The rest of the line still drew, so the frame carries the message rather than nothing.
    expect(png.length).toBeGreaterThan(1000);
  }, 30_000);
});
