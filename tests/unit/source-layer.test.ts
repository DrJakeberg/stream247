import { describe, expect, it } from "vitest";
import {
  buildOverlaySceneLayout,
  normalizeOverlaySceneCustomLayers,
  resolveSourceLayerRuntimeEnabled,
  type OverlayScenePayloadView
} from "@stream247/core";

/**
 * M57 stage 1a: the "source" custom layer exists as placement plus a source reference — and
 * nothing else. The URL of the sampled feed never travels through the layer, and in this stage
 * the on-air renderer must not react to the new kind at all.
 */

function buildPayload(customLayers: OverlayScenePayloadView["scene"]["customLayers"]): OverlayScenePayloadView {
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

describe("source layer normalisation", () => {
  it("keeps a source layer as placement plus source reference", () => {
    const layers = normalizeOverlaySceneCustomLayers([
      {
        id: "cam-1",
        kind: "source",
        name: "Studio Cam",
        enabled: true,
        xPercent: 60,
        yPercent: 10,
        widthPercent: 30,
        heightPercent: 30,
        opacityPercent: 90,
        allowOutsideSafeArea: false,
        sourceId: "front-desk"
      }
    ]);

    expect(layers).toHaveLength(1);
    const layer = layers[0]!;
    expect(layer.kind).toBe("source");
    expect(layer).toMatchObject({ xPercent: 60, widthPercent: 30, opacityPercent: 90 });
    expect((layer as { sourceId: string }).sourceId).toBe("front-desk");
  });

  it("never carries a URL through the layer, whatever the caller sends", () => {
    const layers = normalizeOverlaySceneCustomLayers([
      { id: "cam-2", kind: "source", sourceId: "cam", url: "rtsp://user:pass@cam.local/stream" }
    ]);

    expect(layers).toHaveLength(1);
    expect(JSON.stringify(layers)).not.toContain("rtsp");
    expect(JSON.stringify(layers)).not.toContain("pass");
  });

  it("sanitises the source reference down to a safe id and tolerates its absence", () => {
    const layers = normalizeOverlaySceneCustomLayers([
      { id: "cam-3", kind: "source", sourceId: "  Front Desk!! " },
      { id: "cam-4", kind: "source" }
    ]);

    expect(layers).toHaveLength(2);
    expect((layers[0] as { sourceId: string }).sourceId).toBe("front-desk");
    expect((layers[1] as { sourceId: string }).sourceId).toBe("");
  });
});

describe("source layer stays off air in stage 1a", () => {
  it("renders the identical tree with and without an enabled source layer", () => {
    const without = buildOverlaySceneLayout({ payload: buildPayload([]) }, { width: 1280, height: 720, now: new Date(0) });
    const withSource = buildOverlaySceneLayout(
      {
        payload: buildPayload([
          {
            kind: "source",
            enabled: true,
            xPercent: 60,
            yPercent: 10,
            widthPercent: 30,
            heightPercent: 30,
            opacityPercent: 100,
            allowOutsideSafeArea: false
          }
        ])
      },
      { width: 1280, height: 720, now: new Date(0) }
    );

    expect(JSON.stringify(withSource)).toBe(JSON.stringify(without));
  });
});

describe("source layer runtime switch", () => {
  it("defaults off with nothing managed and nothing in the environment", () => {
    expect(resolveSourceLayerRuntimeEnabled(null, {})).toBe(false);
  });

  it("only the literal env value 1 enables it, like the other runtime gates", () => {
    expect(resolveSourceLayerRuntimeEnabled(null, { STREAM247_SOURCE_LAYER_ENABLED: "1" })).toBe(true);
    expect(resolveSourceLayerRuntimeEnabled(null, { STREAM247_SOURCE_LAYER_ENABLED: "true" })).toBe(false);
    expect(resolveSourceLayerRuntimeEnabled(null, { STREAM247_SOURCE_LAYER_ENABLED: "0" })).toBe(false);
  });

  it("a managed value wins over the environment in both directions", () => {
    expect(resolveSourceLayerRuntimeEnabled({ sourceLayerEnabled: "1" }, {})).toBe(true);
    expect(resolveSourceLayerRuntimeEnabled({ sourceLayerEnabled: "0" }, { STREAM247_SOURCE_LAYER_ENABLED: "1" })).toBe(false);
    expect(resolveSourceLayerRuntimeEnabled({ sourceLayerEnabled: "" }, { STREAM247_SOURCE_LAYER_ENABLED: "1" })).toBe(true);
  });
});
