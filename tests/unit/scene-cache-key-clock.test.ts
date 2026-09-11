import { describe, expect, it } from "vitest";
import { sceneFrameCacheKey } from "../../apps/worker/src/scene-renderer";
import type { OverlayScenePayloadView } from "@stream247/core";

/**
 * Found while measuring the ticker: the overlay clock is drawn from the wall clock, and the frame
 * cache key did not track it. On a channel where nothing else moves — a long VOD, no chat, no game
 * — the renderer kept pushing the PNG it had, so the on-air time stood still at a stale minute
 * until something unrelated changed. The key carries the drawn clock string, exactly the way it
 * carries the drawn ticker line: it changes once a minute, not once a render.
 */
function payload(overrides: Partial<OverlayScenePayloadView> = {}): OverlayScenePayloadView {
  return {
    scene: { surfaceStyle: "glass", panelAnchor: "bottom", titleScale: "balanced", typographyPreset: "studio-sans", resolvedPresetId: "lower-third", customLayers: [] },
    channelName: "3JC", accentColor: "#6ee7ff", brandLine: "STREAM247", heroLabel: "Now playing", heroTitle: "Retro Night",
    heroBody: "", metaLine: "", nextLabel: "Up next", nextTitle: "", nextTimeLabel: "", queueTitles: [],
    tickerText: "", emergencyBanner: "", timeZone: "Europe/Berlin", ...overrides
  } as OverlayScenePayloadView;
}
const request = (now: Date) => ({ payload: payload(), engagement: null, game: null, chat: null, sourceFrame: null, width: 1920, height: 1080, now });

describe("the frame cache key and the drawn clock", () => {
  it("changes when the drawn minute changes, so a quiet channel does not freeze its clock", () => {
    const a = sceneFrameCacheKey(request(new Date("2026-09-02T20:14:05.000Z")));
    const b = sceneFrameCacheKey(request(new Date("2026-09-02T20:16:41.000Z")));
    expect(a).not.toBe(b);
  });

  it("does not change within one minute, so the cache still spares the rasteriser", () => {
    const a = sceneFrameCacheKey(request(new Date("2026-09-02T20:14:05.000Z")));
    const b = sceneFrameCacheKey(request(new Date("2026-09-02T20:14:59.000Z")));
    expect(a).toBe(b);
  });
});
