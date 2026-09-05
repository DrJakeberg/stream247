import { describe, expect, it } from "vitest";
import {
  foldCustomLayersIntoActiveScene,
  normalizeOverlayNamedScenes,
  resolveActiveOverlayNamedSceneId,
  resolveOverlayNamedSceneCustomLayers,
  type OverlaySceneCustomLayer
} from "@stream247/core";

/**
 * Named scenes made `customLayers` a projection of the active scene. Every writer that predates
 * scenes edits that array and knows nothing about scenes — the chat game's own layer provisioning
 * does exactly that through updateAppState. Re-projecting on write threw those edits away: a
 * moderator's `!snake` would have written a layer that vanished in the same transaction.
 *
 * So the write path folds instead of projecting: layers the caller hands over become the active
 * scene's layers, and the other scenes are untouched.
 */
const layer = (id: string): OverlaySceneCustomLayer =>
  ({ id, kind: "text", enabled: true, xPercent: 10, yPercent: 10, widthPercent: 30, heightPercent: 10, opacityPercent: 100, text: id, secondaryText: "" }) as OverlaySceneCustomLayer;

describe("foldCustomLayersIntoActiveScene", () => {
  it("keeps a layer a scene-unaware writer appended", () => {
    const scenes = normalizeOverlayNamedScenes(undefined, [layer("a")]);
    const active = resolveActiveOverlayNamedSceneId(scenes, "");
    const folded = foldCustomLayersIntoActiveScene(scenes, active, [layer("a"), layer("game-1")]);
    expect(resolveOverlayNamedSceneCustomLayers(folded, active).map((entry) => entry.id)).toEqual(["a", "game-1"]);
  });

  it("leaves the other scenes alone", () => {
    const scenes = normalizeOverlayNamedScenes(
      [
        { id: "one", name: "One", customLayers: [layer("a")], sourceId: "" },
        { id: "two", name: "Two", customLayers: [layer("b")], sourceId: "" }
      ],
      []
    );
    const folded = foldCustomLayersIntoActiveScene(scenes, "one", [layer("a"), layer("c")]);
    expect(resolveOverlayNamedSceneCustomLayers(folded, "one").map((e) => e.id)).toEqual(["a", "c"]);
    expect(resolveOverlayNamedSceneCustomLayers(folded, "two").map((e) => e.id)).toEqual(["b"]);
  });

  it("does nothing when the caller hands over what the scene already holds", () => {
    const scenes = normalizeOverlayNamedScenes([{ id: "one", name: "One", customLayers: [layer("a")], sourceId: "" }], []);
    expect(foldCustomLayersIntoActiveScene(scenes, "one", [layer("a")])).toEqual(scenes);
  });

  it("ignores an undefined layer list — a writer that never mentions layers changes nothing", () => {
    const scenes = normalizeOverlayNamedScenes([{ id: "one", name: "One", customLayers: [layer("a")], sourceId: "" }], []);
    expect(foldCustomLayersIntoActiveScene(scenes, "one", undefined)).toEqual(scenes);
  });
});

describe("the chat game's own provisioning survives the scene projection", () => {
  it("keeps the game layer a moderator's !snake appends through updateAppState", () => {
    // The exact shape resolveChatGameLayerProvisioning produces: the projected layer array with a
    // game layer appended, handed back with the scene list untouched.
    const scenes = normalizeOverlayNamedScenes(undefined, []);
    const active = resolveActiveOverlayNamedSceneId(scenes, "");
    const provisioned = [
      ...resolveOverlayNamedSceneCustomLayers(scenes, active),
      { id: "game-snake", kind: "game", enabled: true, xPercent: 0, yPercent: 0, widthPercent: 100, heightPercent: 100, opacityPercent: 100 } as OverlaySceneCustomLayer
    ];
    const written = foldCustomLayersIntoActiveScene(scenes, active, provisioned);
    const onAir = resolveOverlayNamedSceneCustomLayers(written, active);
    expect(onAir.some((entry) => entry.kind === "game" && entry.enabled)).toBe(true);
  });
});
