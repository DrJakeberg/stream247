import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { isChatBridgeRuntimeNeeded, normalizeOverlaySceneCustomLayers } from "@stream247/core";
import {
  hasChatGameBridgeConsumer,
  resolveChatGameLayerProvisioning,
  resolveChatGameLayerTeardown,
  type ChatGameLayerProvisioningInput
} from "../../apps/worker/src/chat-game";

/**
 * The chat game's half of finding [7], and the way it was wired wrong.
 *
 * Repair [7] made the IRC bridge follow every consumer instead of the chat rail alone, and the
 * worker handed it `chatGameEnabled: Boolean(chatGameForBridge.gameId)`. ChatGameSettings has no
 * enabled field at all: gameId defaults to "snake" and is never empty, so the flag was constant
 * true and an install with the rail, the moderation policy and viewer control all switched off
 * still held a Twitch connection open around the clock.
 *
 * The chat game's real on/off is the overlay scene: a layer of kind "game". "!snake" provisions
 * one, "!stop" disables it but keeps it — so the bridge has to follow the layer's presence, not
 * its enabled flag, or the room could stop a game and never start another.
 */
const env = { STREAM_CHAT_OVERLAY_ENABLED: "0" } as Record<string, string | undefined>;

const fresh: ChatGameLayerProvisioningInput = { enabled: false, customLayers: [] };

/** The overlay a "!snake" leaves behind, built by the production provisioning it goes through. */
function started(): ChatGameLayerProvisioningInput {
  const provisioning = resolveChatGameLayerProvisioning(fresh);
  if (!provisioning.ok) {
    throw new Error("provisioning refused an empty studio");
  }
  return provisioning.overlay;
}

/** An install with every other chat consumer switched off, as a fresh one is. */
const allOff = {
  engagement: { chatEnabled: false },
  managedConfig: { streamChatOverlayEnabled: "0" },
  moderation: { enabled: false },
  chatInteraction: { enabled: false }
};

describe("the chat game as a bridge consumer", () => {
  it("is off on a fresh install: no scene, no game layer, nothing to listen for", () => {
    expect(hasChatGameBridgeConsumer(fresh)).toBe(false);
  });

  it("keeps the whole bridge off when nothing else needs chat either", () => {
    expect(isChatBridgeRuntimeNeeded({ ...allOff, chatGame: { enabled: hasChatGameBridgeConsumer(fresh) } }, env)).toBe(
      false
    );
  });

  it("is on while a game layer is on air", () => {
    expect(hasChatGameBridgeConsumer(started())).toBe(true);
    expect(isChatBridgeRuntimeNeeded({ ...allOff, chatGame: { enabled: hasChatGameBridgeConsumer(started()) } }, env)).toBe(
      true
    );
  });

  it("stays on after the round was stopped, so the room can start the next one", () => {
    // The teardown disables the layer and keeps it, so the operator's placement survives. A bridge
    // that followed the enabled flag would drop the connection here and never hear "!snake" again.
    const stopped = { ...started(), ...resolveChatGameLayerTeardown(started()) };
    expect(stopped.customLayers.some((entry) => entry.kind === "game" && entry.enabled)).toBe(false);
    expect(hasChatGameBridgeConsumer(stopped)).toBe(true);
  });

  it("ignores whether the overlay itself is published — starting a game publishes it", () => {
    expect(hasChatGameBridgeConsumer({ ...started(), enabled: false })).toBe(true);
  });

  it("ignores layers of every other kind", () => {
    const customLayers = normalizeOverlaySceneCustomLayers([
      { id: "t1", kind: "text", enabled: true, name: "Ticker", xPercent: 5, yPercent: 5, widthPercent: 20, heightPercent: 10 }
    ]);
    expect(hasChatGameBridgeConsumer({ enabled: true, customLayers })).toBe(false);
  });
});

describe("the worker's bridge wiring", () => {
  // apps/worker/src/index.ts starts a worker on import, so the wiring is read off the source —
  // the same way tests/unit/relay-presence.test.ts checks its own.
  const workerSource = readFileSync(new URL("../../apps/worker/src/index.ts", import.meta.url), "utf8");

  it("no longer derives the chat-game consumer from the settings row's game id", () => {
    expect(workerSource).not.toContain("Boolean(chatGameForBridge.gameId)");
  });

  it("derives it from the overlay scene instead", () => {
    expect(workerSource).toContain("chatGameEnabled: hasChatGameBridgeConsumer(chatCycleState.overlay)");
  });
});
