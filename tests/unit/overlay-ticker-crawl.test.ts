import { describe, expect, it } from "vitest";
import {
  buildOverlaySceneLayout,
  deriveDefaultPlacements,
  overlayTickerCrawlPlan,
  overlayTickerLine,
  resolvePlacementPixelBox,
  OVERLAY_TICKER_CRAWL_MAX_PX_PER_SECOND,
  OVERLAY_TICKER_CRAWL_MIN_PX_PER_SECOND,
  type OverlayScenePayloadView
} from "@stream247/core";

/**
 * The ticker crawls, and ffmpeg is what moves it.
 *
 * The panel shipped as a dwell — one message held still, the next taking its place on a timer —
 * and the reason was sound for the renderer: it redraws on SCENE_RENDER_INTERVAL_MS, 2000ms by
 * default and floored at 1000ms, so a crawl drawn INTO the frame would teleport 118px a step.
 * That argument only ever applied to text drawn by the rasteriser.
 *
 * Measured on this machine's ffmpeg before any of this was written: a transparent strip overlaid
 * onto a band-sized canvas with x = -mod(t*speed, period) moves exactly 4px per frame at 120px/s
 * and 30fps, is clipped to the band by the canvas it is overlaid onto, and crosses its period
 * boundary with no discontinuity at all — frame 60 of the wrap probe carried the same picture as
 * frames 57 and 63. So the crawl happens at the OUTPUT frame rate, at no per-frame render cost,
 * and the rasteriser draws the band and never the moving line.
 *
 * Which is why the dwell goes: the operator asked for a running line and said the automatic part
 * was not wanted. All the messages become one continuous line, and the seconds setting stops
 * meaning "how long one message stands" and starts meaning "how long the line takes to cross".
 */
const FRAME = { width: 1920, height: 1080 };

function payload(ticker: string, rotateSeconds?: number): OverlayScenePayloadView {
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
    tickerText: ticker,
    tickerRotateSeconds: rotateSeconds,
    emergencyBanner: "",
    timeZone: "Europe/Berlin"
  };
}

describe("ticker crawl", () => {
  it("joins every message into one running line instead of taking turns", () => {
    const line = overlayTickerLine(payload("First notice · Second notice\nThird notice"));
    expect(line).toBe("First notice · Second notice · Third notice");
  });

  it("says the same thing at every instant, because nothing rotates any more", () => {
    const text = "First notice · Second notice · Third notice";
    const once = overlayTickerLine(payload(text, 8));
    expect(overlayTickerLine(payload(text, 4))).toBe(once);
    expect(overlayTickerLine(payload(text, 60))).toBe(once);
  });

  it("has no crawl to run while the ticker text is empty", () => {
    expect(overlayTickerCrawlPlan({ payload: payload("") }, FRAME)).toBeNull();
    expect(overlayTickerCrawlPlan({ payload: payload("   ") }, FRAME)).toBeNull();
  });

  it("crawls inside the very box the renderer draws the band in", () => {
    const plan = overlayTickerCrawlPlan({ payload: payload("A running line") }, FRAME);
    expect(plan).not.toBeNull();
    const band = resolvePlacementPixelBox(deriveDefaultPlacements("bottom", "bottom-left").ticker, FRAME);
    expect(plan!.box).toEqual(band);
  });

  it("follows the operator's box when they have moved the band", () => {
    const moved = payload("A running line");
    const placement = { ...deriveDefaultPlacements("bottom", "bottom-left").ticker, yPercent: 10, xPercent: 5 };
    moved.scene.panelPlacements = { ticker: placement };
    const plan = overlayTickerCrawlPlan({ payload: moved }, FRAME);
    expect(plan!.box).toEqual(resolvePlacementPixelBox(placement, FRAME));
  });

  it("reads the seconds setting as one crossing of the band, not as a dwell", () => {
    const slow = overlayTickerCrawlPlan({ payload: payload("A running line", 20) }, FRAME)!;
    const fast = overlayTickerCrawlPlan({ payload: payload("A running line", 10) }, FRAME)!;
    expect(slow.pxPerSecond).toBe(Math.round(slow.box.width / 20));
    expect(fast.pxPerSecond).toBe(2 * slow.pxPerSecond);
  });

  it("holds the speed inside what a viewer can actually read", () => {
    const tooFast = overlayTickerCrawlPlan({ payload: payload("A running line", 1) }, FRAME)!;
    const tooSlow = overlayTickerCrawlPlan({ payload: payload("A running line", 3600) }, FRAME)!;
    expect(tooFast.pxPerSecond).toBe(OVERLAY_TICKER_CRAWL_MAX_PX_PER_SECOND);
    expect(tooSlow.pxPerSecond).toBe(OVERLAY_TICKER_CRAWL_MIN_PX_PER_SECOND);
  });

  it("scales the speed with the frame, so 720p crawls at the same visual pace", () => {
    const hd = overlayTickerCrawlPlan({ payload: payload("A running line", 20) }, FRAME)!;
    const sd = overlayTickerCrawlPlan({ payload: payload("A running line", 20) }, { width: 1280, height: 720 })!;
    expect(sd.pxPerSecond / sd.box.width).toBeCloseTo(hd.pxPerSecond / hd.box.width, 3);
  });

  it("leaves the band empty on air, because ffmpeg puts the line there", () => {
    const text = "The line that crawls";
    const onAir = JSON.stringify(buildOverlaySceneLayout({ payload: payload(text) }, { ...FRAME, tickerMode: "crawl" }));
    const still = JSON.stringify(buildOverlaySceneLayout({ payload: payload(text) }, { ...FRAME, tickerMode: "static" }));
    expect(still).toContain(text);
    expect(onAir).not.toContain(text);
  });

  it("still draws the band itself on air — only its text moved out", () => {
    const withText = buildOverlaySceneLayout({ payload: payload("The line that crawls") }, { ...FRAME, tickerMode: "crawl" });
    const without = buildOverlaySceneLayout({ payload: payload("") }, { ...FRAME, tickerMode: "crawl" });
    expect(JSON.stringify(withText)).not.toBe(JSON.stringify(without));
  });

  it("draws the line at rest for anyone who did not ask for the crawl", () => {
    const tree = JSON.stringify(buildOverlaySceneLayout({ payload: payload("At rest") }, FRAME));
    expect(tree).toContain("At rest");
  });
});
