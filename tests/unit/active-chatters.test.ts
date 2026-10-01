import { describe, expect, it } from "vitest";
import { createDefaultChatInteractionConfig, type ChatInteractionConfig } from "@stream247/core";
import { ActiveChatterRoster } from "../../apps/worker/src/active-chatters.js";
import { ChatControlRuntime } from "../../apps/worker/src/chat-control.js";
import { EngagementGameTracker } from "../../apps/worker/src/engagement-game.js";

/**
 * "Active chatters" is one number with one window. The operator sets the window once, in the
 * engagement settings; the overlays page prints the count over it ("live with N active chatters
 * in the last W minutes"), and the skip threshold is a share of the active chatters. If the two
 * counts disagree, the page tells the operator one room size and the skip vote is decided by
 * another — so the same chat history goes through both and must come out the same.
 */

const WINDOW_MINUTES = 15;
const SETTINGS = {
  gameEnabled: true,
  soloModeEnabled: true,
  smallGroupModeEnabled: true,
  crowdModeEnabled: true,
  gameWindowMinutes: WINDOW_MINUTES
};
const T0 = Date.parse("2026-09-02T20:00:00.000Z");
const SKIP_AT = T0 + 12 * 60_000;

/** Twelve viewers talk at 20:00; one of them asks for a skip at 20:12. */
const HISTORY = [
  ...Array.from({ length: 12 }, (_, index) => ({
    actor: `viewer-${index + 1}`,
    message: index % 2 === 0 ? "great pick" : "🔥",
    atMs: T0 + index * 1000
  })),
  { actor: "viewer-1", message: "!skip", atMs: SKIP_AT }
];

function skipConfig(): ChatInteractionConfig {
  return {
    ...createDefaultChatInteractionConfig(),
    enabled: true,
    skipEnabled: true,
    skipThresholdRatio: 0.6,
    skipMinimumVotes: 5
  };
}

describe("active chatters", () => {
  it("counts the same room for the overlays page and for the skip threshold", () => {
    // Wired the way the worker wires them: one roster, filled and windowed by the tracker.
    const activeChatters = new ActiveChatterRoster();
    const tracker = new EngagementGameTracker(activeChatters);
    let nowMs = T0;
    const control = new ChatControlRuntime({ activeChatters, now: () => new Date(nowMs) });

    // What the overlays page prints: the tracker's snapshot over the engagement window.
    for (const entry of HISTORY) {
      tracker.recordChatMessage({ actor: entry.actor, createdAt: new Date(entry.atMs).toISOString() });
    }
    const guiCount = tracker.getSnapshot(SETTINGS, new Date(SKIP_AT)).activeChatterCount;

    // What the skip vote divides by: the control runtime's count after the same history.
    let skipEffect: ReturnType<ChatControlRuntime["handleMessage"]> = { kind: "none" };
    for (const entry of HISTORY) {
      nowMs = entry.atMs;
      skipEffect = control.handleMessage({
        actor: entry.actor,
        message: entry.message,
        currentAssetId: "asset-1",
        config: skipConfig()
      });
    }
    const skipCount = control.getActiveChatterCount();

    expect(
      skipCount,
      `active chatters over the same history, window ${WINDOW_MINUTES} min: overlays page says ${guiCount}, skip threshold counts ${skipCount}`
    ).toBe(guiCount);
    expect(guiCount).toBe(12);
    expect(skipEffect).toEqual({ kind: "skip-recorded", votes: 1, votesNeeded: Math.ceil(12 * 0.6) });
  });
});
