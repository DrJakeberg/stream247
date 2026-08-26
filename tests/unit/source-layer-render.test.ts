import { describe, expect, it } from "vitest";
import {
  buildOverlaySceneLayout,
  type OverlayCustomLayerView,
  type OverlayLayoutNode,
  type OverlayScenePayloadView,
  type OverlaySourceFrameView
} from "@stream247/core";
import { sceneFrameCacheKey } from "../../apps/worker/src/scene-renderer";

/**
 * M57 stage 1b: the source layer draws the sampled picture, media and text layers render on air,
 * and the frame cache key reacts to a new capture without ever swallowing the image bytes.
 */

// 1x1 PNG, red. Small on purpose: these tests assert wiring, not image quality.
const TINY_PNG_DATA_URI =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

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

function sourceLayer(overrides: Partial<OverlayCustomLayerView> = {}): OverlayCustomLayerView {
  return {
    kind: "source",
    enabled: true,
    xPercent: 60,
    yPercent: 10,
    widthPercent: 30,
    heightPercent: 30,
    opacityPercent: 100,
    allowOutsideSafeArea: false,
    sourceId: "front-desk",
    ...overrides
  };
}

function liveFrame(overrides: Partial<OverlaySourceFrameView> = {}): OverlaySourceFrameView {
  return {
    dataUri: TINY_PNG_DATA_URI,
    status: "live",
    capturedAt: "2026-08-26T10:00:00.000Z",
    ...overrides
  };
}

function collectNodes(node: OverlayLayoutNode, out: OverlayLayoutNode[] = []): OverlayLayoutNode[] {
  out.push(node);
  const children = node.props.children;
  if (Array.isArray(children)) {
    for (const child of children) {
      if (child && typeof child === "object") {
        collectNodes(child, out);
      }
    }
  } else if (children && typeof children === "object") {
    collectNodes(children, out);
  }
  return out;
}

function findImages(node: OverlayLayoutNode): OverlayLayoutNode[] {
  return collectNodes(node).filter((entry) => entry.type === "img");
}

const RENDER = { width: 1280, height: 720, now: new Date(0) };

describe("source panel in the on-air layout", () => {
  it("draws the sampled picture when the layer is enabled and the frame is live", () => {
    const tree = buildOverlaySceneLayout(
      { payload: buildPayload([sourceLayer()]), sourceFrame: liveFrame() },
      RENDER
    );
    const images = findImages(tree);
    expect(images).toHaveLength(1);
    expect((images[0]!.props as { src?: string }).src).toBe(TINY_PNG_DATA_URI);
  });

  it("hides the layer entirely while the feed is away — no frozen picture, no empty panel", () => {
    const withoutLayer = buildOverlaySceneLayout({ payload: buildPayload([]) }, RENDER);
    const noFrame = buildOverlaySceneLayout({ payload: buildPayload([sourceLayer()]) }, RENDER);
    const staleFrame = buildOverlaySceneLayout(
      { payload: buildPayload([sourceLayer()]), sourceFrame: liveFrame({ status: "stale" }) },
      RENDER
    );

    expect(JSON.stringify(noFrame)).toBe(JSON.stringify(withoutLayer));
    expect(JSON.stringify(staleFrame)).toBe(JSON.stringify(withoutLayer));
  });

  it("clamps the placement box into the frame like the game panel does", () => {
    const tree = buildOverlaySceneLayout(
      {
        payload: buildPayload([sourceLayer({ xPercent: 90, yPercent: 90, widthPercent: 100, heightPercent: 100 })]),
        sourceFrame: liveFrame()
      },
      RENDER
    );
    const panel = collectNodes(tree).find((node) => node.props.style?.position === "absolute");
    expect(panel).toBeDefined();
    const style = panel!.props.style!;
    expect(Number(style.left) + Number(style.width)).toBeLessThanOrEqual(RENDER.width);
    expect(Number(style.top)).toBeLessThanOrEqual(RENDER.height);
  });
});

describe("media and text layers on air", () => {
  it("renders logo and image layers through the same picture path", () => {
    const tree = buildOverlaySceneLayout(
      {
        payload: buildPayload([
          { kind: "logo", enabled: true, xPercent: 4, yPercent: 4, widthPercent: 16, heightPercent: 12, opacityPercent: 100, allowOutsideSafeArea: false, url: TINY_PNG_DATA_URI, fit: "contain" },
          { kind: "image", enabled: true, xPercent: 40, yPercent: 4, widthPercent: 20, heightPercent: 16, opacityPercent: 100, allowOutsideSafeArea: false, url: TINY_PNG_DATA_URI, fit: "cover" }
        ])
      },
      RENDER
    );
    expect(findImages(tree)).toHaveLength(2);
  });

  it("skips media layers whose URL the rasteriser could not resolve", () => {
    const withoutLayer = buildOverlaySceneLayout({ payload: buildPayload([]) }, RENDER);
    const relative = buildOverlaySceneLayout(
      {
        payload: buildPayload([
          { kind: "image", enabled: true, xPercent: 40, yPercent: 4, widthPercent: 20, heightPercent: 16, opacityPercent: 100, allowOutsideSafeArea: false, url: "/uploads/still.png", fit: "cover" }
        ])
      },
      RENDER
    );
    expect(JSON.stringify(relative)).toBe(JSON.stringify(withoutLayer));
  });

  it("renders text layers with their copy on air", () => {
    const tree = buildOverlaySceneLayout(
      {
        payload: buildPayload([
          { kind: "text", enabled: true, xPercent: 4, yPercent: 10, widthPercent: 34, heightPercent: 16, opacityPercent: 100, allowOutsideSafeArea: false, text: "Studio reopens tonight", secondaryText: "Doors at nine", textTone: "headline", textAlign: "left", useAccent: false }
        ])
      },
      RENDER
    );
    const serialized = JSON.stringify(tree);
    expect(serialized).toContain("Studio reopens tonight");
    expect(serialized).toContain("Doors at nine");
  });
});

describe("frame cache key with a source frame", () => {
  const request = {
    payload: buildPayload([sourceLayer()]),
    sourceFrame: liveFrame(),
    width: 1280,
    height: 720
  };

  it("is stable for identical input", () => {
    expect(sceneFrameCacheKey({ ...request })).toBe(sceneFrameCacheKey({ ...request }));
  });

  it("never contains the image bytes and ignores them for identity", () => {
    const key = sceneFrameCacheKey({ ...request });
    expect(key).not.toContain("base64");
    const differentBytes = sceneFrameCacheKey({
      ...request,
      sourceFrame: liveFrame({ dataUri: "data:image/png;base64,AAAA" })
    });
    expect(differentBytes).toBe(key);
  });

  it("changes when a new capture lands or the feed status flips", () => {
    const key = sceneFrameCacheKey({ ...request });
    expect(sceneFrameCacheKey({ ...request, sourceFrame: liveFrame({ capturedAt: "2026-08-26T10:00:05.000Z" }) })).not.toBe(key);
    expect(sceneFrameCacheKey({ ...request, sourceFrame: liveFrame({ status: "stale" }) })).not.toBe(key);
  });
});
