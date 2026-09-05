import { describe, expect, it } from "vitest";
import { isChatBridgeRuntimeNeeded } from "@stream247/core";

/**
 * Finding [7] of the codebase review: the IRC bridge disconnected whenever the on-stream chat
 * rail was switched off — and the bridge is the only intake for moderator check-ins, votes, skip
 * votes, viewer requests and the chat game. Hiding the panel silently switched all of them off.
 * The connection is needed when any consumer needs it; the panel is only one of them.
 */
const env = { STREAM_CHAT_OVERLAY_ENABLED: "0" } as Record<string, string | undefined>;
const base = {
  engagement: { chatEnabled: false },
  managedConfig: { streamChatOverlayEnabled: "0" },
  moderation: { enabled: false },
  chatInteraction: { enabled: false, votesEnabled: false, skipEnabled: false, requestsEnabled: false },
  chatGame: { enabled: false }
};

describe("isChatBridgeRuntimeNeeded", () => {
  it("is off when nothing needs chat", () => {
    expect(isChatBridgeRuntimeNeeded(base, env)).toBe(false);
  });
  it("stays on for moderator check-ins when the chat rail is off", () => {
    expect(isChatBridgeRuntimeNeeded({ ...base, moderation: { enabled: true } }, env)).toBe(true);
  });
  it("stays on for votes, skip votes and requests, and for the game", () => {
    expect(isChatBridgeRuntimeNeeded({ ...base, chatInteraction: { ...base.chatInteraction, enabled: true } }, env)).toBe(true);
    expect(isChatBridgeRuntimeNeeded({ ...base, chatGame: { enabled: true } }, env)).toBe(true);
  });
  it("is on for the chat rail alone, as before", () => {
    expect(isChatBridgeRuntimeNeeded({ ...base, engagement: { chatEnabled: true }, managedConfig: { streamChatOverlayEnabled: "1" } }, env)).toBe(true);
  });
});
