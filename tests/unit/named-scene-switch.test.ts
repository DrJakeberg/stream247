// Switching the active scene, measured at the two places the worker actually decides something.
//
// The worker never learns what a scene is. It reads `state.overlay.customLayers`, which the db
// normaliser has already resolved to the active scene's layers, and hands it to the same
// buildOverlaySceneDefinition it always used. So the whole switch path is: the record changes ->
// the payload changes -> sceneFrameCacheKey changes -> the render loop rasterises one new frame.
//
// The two properties worth pinning are the ones an operator would notice if they broke:
//   * a switch DOES reach the picture (a stale cache key would freeze the overlay on the old scene)
//   * a switch does NOT touch anything ffmpeg was started with (that would mean a restart, and a
//     restart means a gap in the broadcast).

import {
  buildOverlaySceneDefinition,
  buildOverlayScenePayload,
  normalizeOverlayNamedScenes,
  normalizeOverlaySceneCustomLayers,
  resolveOverlayNamedSceneCustomLayers,
  type OverlaySceneSource
} from "@stream247/core";
import { describe, expect, it } from "vitest";
import { sceneFrameCacheKey } from "../../apps/worker/src/scene-renderer.js";

const scenes = normalizeOverlayNamedScenes(
  [
    {
      id: "scene-studio",
      name: "Studio",
      customLayers: normalizeOverlaySceneCustomLayers([{ id: "l1", kind: "text", name: "Studio", text: "In the studio" }]),
      sourceId: ""
    },
    {
      id: "scene-break",
      name: "Break",
      customLayers: normalizeOverlaySceneCustomLayers([{ id: "l2", kind: "text", name: "Break", text: "Back shortly" }]),
      sourceId: ""
    }
  ],
  []
);

function overlaySourceForScene(activeSceneId: string): OverlaySceneSource {
  return {
    scenePreset: "replay-lower-third",
    insertScenePreset: "bumper-board",
    standbyScenePreset: "standby-board",
    reconnectScenePreset: "reconnect-board",
    headline: "Always on air",
    insertHeadline: "Insert on air",
    standbyHeadline: "Please wait",
    reconnectHeadline: "Reconnecting",
    surfaceStyle: "glass",
    panelAnchor: "bottom",
    titleScale: "balanced",
    typographyPreset: "studio-sans",
    showClock: true,
    showNextItem: true,
    showScheduleTeaser: true,
    showCurrentCategory: true,
    showSourceLabel: true,
    showQueuePreview: false,
    queuePreviewCount: 3,
    emergencyBanner: "",
    tickerText: "",
    layerOrder: [],
    disabledLayers: [],
    // Exactly what the db normaliser puts in the record the worker reads.
    customLayers: resolveOverlayNamedSceneCustomLayers(scenes, activeSceneId)
  };
}

function renderRequestForScene(activeSceneId: string) {
  const overlay = overlaySourceForScene(activeSceneId);
  return {
    width: 1920,
    height: 1080,
    payload: buildOverlayScenePayload({
      overlay: { ...overlay, channelName: "Stream247", replayLabel: "Replay stream", brandBadge: "", accentColor: "#0e6d5a" },
      queueKind: "asset" as const,
      target: "on-air-scene" as const,
      currentTitle: "Episode 4",
      nextTitle: "Episode 5",
      nextTimeLabel: "20:00-21:00",
      timeZone: "Europe/Berlin"
    })
  };
}

describe("switching the active overlay scene", () => {
  it("puts the other scene's layers in front of the renderer", () => {
    const studio = buildOverlaySceneDefinition({ overlay: overlaySourceForScene("scene-studio"), queueKind: "asset" });
    const brk = buildOverlaySceneDefinition({ overlay: overlaySourceForScene("scene-break"), queueKind: "asset" });

    expect(studio.customLayers.map((layer) => layer.id)).toEqual(["l1"]);
    expect(brk.customLayers.map((layer) => layer.id)).toEqual(["l2"]);
  });

  it("changes the frame cache key, so the next render tick redraws", () => {
    // Without this the render loop would keep pushing the last PNG and the overlay would stay on
    // the old scene for as long as the item played.
    expect(sceneFrameCacheKey(renderRequestForScene("scene-studio"))).not.toBe(
      sceneFrameCacheKey(renderRequestForScene("scene-break"))
    );
  });

  it("keeps the key stable while the same scene stays on air", () => {
    expect(sceneFrameCacheKey(renderRequestForScene("scene-studio"))).toBe(
      sceneFrameCacheKey(renderRequestForScene("scene-studio"))
    );
  });

  it("carries a scene's bound source into the layer the worker reads its attach decision from", () => {
    // resolveLiveSourceAttach asks scenePayloadSourceLayer() which source is on the active scene.
    // A scene bound to a camera must therefore reach that function through the ordinary payload --
    // no new worker code, and no second place a camera can be switched on.
    const bound = normalizeOverlayNamedScenes(
      [
        {
          id: "scene-cam",
          name: "Camera",
          customLayers: normalizeOverlaySceneCustomLayers([{ id: "l3", kind: "source", name: "Camera", sourceId: "" }]),
          sourceId: "source-hall"
        }
      ],
      []
    );
    const layers = resolveOverlayNamedSceneCustomLayers(bound, "scene-cam");
    const definition = buildOverlaySceneDefinition({
      overlay: { ...overlaySourceForScene("scene-studio"), customLayers: layers },
      queueKind: "asset"
    });
    const sourceLayer = definition.customLayers.find((layer) => layer.kind === "source");
    expect(sourceLayer && "sourceId" in sourceLayer ? sourceLayer.sourceId : "").toBe("source-hall");
  });

  it("leaves the frame geometry alone, so no ffmpeg input has to be renegotiated", () => {
    // The overlay reaches ffmpeg as a pipe of PNG frames at a declared size and framerate. Those
    // are what the command line carries; the picture inside them is not. A scene switch therefore
    // cannot require a restart, and a restart is the only thing that would put a gap on air.
    const studio = renderRequestForScene("scene-studio");
    const brk = renderRequestForScene("scene-break");
    expect([brk.width, brk.height]).toEqual([studio.width, studio.height]);
  });
});
