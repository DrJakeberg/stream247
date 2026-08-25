import { readFileSync } from "node:fs";
import path from "node:path";
import { normalizeOverlaySceneCustomLayers } from "@stream247/core";
import { describe, expect, it } from "vitest";
import { createDefaultCustomLayer } from "../../apps/web/lib/overlay-studio-defaults";

/**
 * The studio side of the chat game: the layer an operator adds to a scene, and the settings form
 * that maps four emotes to four directions. The form checks are source-reads in the house style —
 * they pin that the mapping is validated where the operator types it, not only at the API.
 */

const chatGameSettingsFormSource = readFileSync(
  path.join(process.cwd(), "apps/web/components/chat-game-settings-form.tsx"),
  "utf8"
);

describe("the game layer in the studio", () => {
  it("creates a positioned default layer inside the safe area", () => {
    const layer = createDefaultCustomLayer("game");

    expect(layer).toEqual(
      expect.objectContaining({
        kind: "game",
        enabled: true,
        allowOutsideSafeArea: false
      })
    );
  });

  it("survives the publish path's normalisation like every other layer kind", () => {
    const [normalized] = normalizeOverlaySceneCustomLayers([createDefaultCustomLayer("game")]);

    expect(normalized).toEqual(expect.objectContaining({ kind: "game", enabled: true }));
  });

  it("can be disabled per scene without being removed", () => {
    const [normalized] = normalizeOverlaySceneCustomLayers([{ ...createDefaultCustomLayer("game"), enabled: false }]);

    expect(normalized).toEqual(expect.objectContaining({ kind: "game", enabled: false }));
  });
});

describe("the chat game settings form", () => {
  it("validates the emote mapping as the operator types, with the shared rule set", () => {
    expect(chatGameSettingsFormSource).toContain("listChatGameEmoteMapIssues(emoteMap)");
  });

  it("keeps the save button disabled while the mapping is invalid", () => {
    expect(chatGameSettingsFormSource).toContain("disabled={isPending || emoteIssues.length > 0}");
  });

  it("offers one input per direction", () => {
    for (const direction of ["Up emote", "Down emote", "Left emote", "Right emote"]) {
      expect(chatGameSettingsFormSource).toContain(direction);
    }
  });
});
