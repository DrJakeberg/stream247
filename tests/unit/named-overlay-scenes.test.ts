// Named overlay scenes (M58): several layer sets under their own names, one of them on air.
//
// The invariant the whole feature rests on: an installation that has never heard of scenes keeps
// exactly the picture it had. Its single stored `customLayers` array becomes the first named scene,
// and the effective layer set resolved from that scene is byte-for-byte the array it started with.
// Every test below that talks about "the picture" is testing that, not the naming.

import {
  DEFAULT_NAMED_OVERLAY_SCENE_ID,
  DEFAULT_NAMED_OVERLAY_SCENE_NAME,
  MAX_NAMED_OVERLAY_SCENES,
  normalizeOverlayNamedScenes,
  normalizeOverlaySceneCustomLayers,
  resolveActiveOverlayNamedSceneId,
  resolveOverlayNamedSceneCustomLayers,
  type OverlaySceneCustomLayer
} from "@stream247/core";
import { describe, expect, it } from "vitest";

function textLayer(id: string, text: string): OverlaySceneCustomLayer {
  return normalizeOverlaySceneCustomLayers([{ id, kind: "text", name: text, text }])[0] as OverlaySceneCustomLayer;
}

function sourceLayer(id: string, sourceId: string): OverlaySceneCustomLayer {
  return normalizeOverlaySceneCustomLayers([{ id, kind: "source", name: "Camera", sourceId }])[0] as OverlaySceneCustomLayer;
}

describe("named overlay scenes", () => {
  it("turns an installation with no scene list into one named scene that keeps its layers", () => {
    const stored = [textLayer("layer-a", "Sponsor")];
    const scenes = normalizeOverlayNamedScenes([], stored);

    expect(scenes).toHaveLength(1);
    expect(scenes[0]?.id).toBe(DEFAULT_NAMED_OVERLAY_SCENE_ID);
    expect(scenes[0]?.name).toBe(DEFAULT_NAMED_OVERLAY_SCENE_NAME);
    expect(scenes[0]?.sourceId).toBe("");
    // The picture, unchanged: what the renderer reads back is what was stored.
    expect(resolveOverlayNamedSceneCustomLayers(scenes, "")).toEqual(stored);
  });

  it("never returns an empty list, so there is always a scene to be on air", () => {
    expect(normalizeOverlayNamedScenes(null, [])).toHaveLength(1);
    expect(normalizeOverlayNamedScenes("nonsense", [])).toHaveLength(1);
    expect(normalizeOverlayNamedScenes([{ id: "", name: "" }], [])).toHaveLength(1);
  });

  it("falls back to the first scene when the active id names a scene that is gone", () => {
    const scenes = normalizeOverlayNamedScenes(
      [
        { id: "scene-a", name: "Studio", customLayers: [textLayer("l1", "A")], sourceId: "" },
        { id: "scene-b", name: "Break", customLayers: [textLayer("l2", "B")], sourceId: "" }
      ],
      []
    );

    expect(resolveActiveOverlayNamedSceneId(scenes, "scene-b")).toBe("scene-b");
    expect(resolveActiveOverlayNamedSceneId(scenes, "scene-deleted")).toBe("scene-a");
    expect(resolveActiveOverlayNamedSceneId(scenes, "")).toBe("scene-a");
    expect(resolveOverlayNamedSceneCustomLayers(scenes, "scene-b")[0]?.id).toBe("l2");
    expect(resolveOverlayNamedSceneCustomLayers(scenes, "scene-deleted")[0]?.id).toBe("l1");
  });

  it("drops duplicate ids and empty names rather than letting two scenes answer to one id", () => {
    const scenes = normalizeOverlayNamedScenes(
      [
        { id: "scene-a", name: "Studio", customLayers: [], sourceId: "" },
        { id: "scene-a", name: "Copy", customLayers: [], sourceId: "" },
        { id: "scene-c", name: "   ", customLayers: [], sourceId: "" }
      ],
      []
    );

    expect(scenes.map((scene) => scene.id)).toEqual(["scene-a", "scene-c"]);
    expect(scenes[1]?.name).toBe("Scene 2");
  });

  it("caps the list so a runaway import cannot make the studio unusable", () => {
    const many = Array.from({ length: MAX_NAMED_OVERLAY_SCENES + 5 }, (_, index) => ({
      id: `scene-${String(index)}`,
      name: `Scene ${String(index)}`,
      customLayers: [],
      sourceId: ""
    }));

    expect(normalizeOverlayNamedScenes(many, [])).toHaveLength(MAX_NAMED_OVERLAY_SCENES);
  });

  it("lets a scene's bound source stand in for a source layer that names none", () => {
    // The binding is a default, not an override: a layer that already names a source keeps it, so
    // a scene can still show a second camera next to the one it is about.
    const scenes = normalizeOverlayNamedScenes(
      [
        {
          id: "scene-cam",
          name: "Camera",
          customLayers: [sourceLayer("l1", ""), sourceLayer("l2", "source-other")],
          sourceId: "source-main"
        }
      ],
      []
    );

    const layers = resolveOverlayNamedSceneCustomLayers(scenes, "scene-cam");
    expect(layers.map((layer) => (layer as { sourceId?: string }).sourceId)).toEqual(["source-main", "source-other"]);
  });

  it("leaves an unbound scene's source layers exactly as they were", () => {
    const scenes = normalizeOverlayNamedScenes(
      [{ id: "scene-cam", name: "Camera", customLayers: [sourceLayer("l1", "")], sourceId: "" }],
      []
    );

    // No binding means no substitution: an empty sourceId still reads as "no source chosen", which
    // is the state the worker already answers with the still picture.
    expect((resolveOverlayNamedSceneCustomLayers(scenes, "scene-cam")[0] as { sourceId?: string }).sourceId).toBe("");
  });
});
