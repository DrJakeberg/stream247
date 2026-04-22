import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildEngagementGameOverlayState,
  resolveEngagementGameModeForActiveChatters
} from "@stream247/core";
import { EngagementGameTracker } from "../../apps/worker/src/engagement-game";

const engagementSettingsFormSource = readFileSync(
  path.join(process.cwd(), "apps/web/components/engagement-settings-form.tsx"),
  "utf8"
);

describe("engagement game helpers", () => {
  it("resolves the documented adaptive modes from active chatter counts", () => {
    const settings = {
      gameEnabled: true,
      soloModeEnabled: true,
      smallGroupModeEnabled: true,
      crowdModeEnabled: true
    };

    expect(resolveEngagementGameModeForActiveChatters(settings, 0)).toBe("");
    expect(resolveEngagementGameModeForActiveChatters(settings, 1)).toBe("solo");
    expect(resolveEngagementGameModeForActiveChatters(settings, 5)).toBe("small-group");
    expect(resolveEngagementGameModeForActiveChatters(settings, 10)).toBe("crowd");
  });

  it("falls back to an enabled mode when a range-specific mode is disabled", () => {
    expect(
      resolveEngagementGameModeForActiveChatters(
        {
          gameEnabled: true,
          soloModeEnabled: true,
          smallGroupModeEnabled: false,
          crowdModeEnabled: true
        },
        4
      )
    ).toBe("solo");
  });

  it("builds a solo widget from the latest chatter activity", () => {
    const widget = buildEngagementGameOverlayState({
      settings: {
        gameEnabled: true,
        soloModeEnabled: true,
        smallGroupModeEnabled: true,
        crowdModeEnabled: true,
        gameWindowMinutes: 10
      },
      runtime: {
        mode: "solo",
        activeChatterCount: 1,
        modeChangedAt: "2026-04-22T10:00:00.000Z",
        updatedAt: "2026-04-22T10:00:00.000Z"
      },
      recentEvents: [
        {
          id: "chat-1",
          kind: "chat",
          actor: "Viewer One",
          message: "Pog",
          createdAt: "2026-04-22T10:00:00.000Z"
        }
      ]
    });

    expect(widget.mode).toBe("solo");
    expect(widget.title).toBe("Solo mode");
    expect(widget.detail).toContain("Viewer One");
    expect(widget.options).toEqual([]);
  });

  it("builds vote tallies for small-group and crowd widgets", () => {
    const smallGroup = buildEngagementGameOverlayState({
      settings: {
        gameEnabled: true,
        soloModeEnabled: true,
        smallGroupModeEnabled: true,
        crowdModeEnabled: true,
        gameWindowMinutes: 10
      },
      runtime: {
        mode: "small-group",
        activeChatterCount: 4,
        modeChangedAt: "",
        updatedAt: ""
      },
      recentEvents: [
        { id: "chat-1", kind: "chat", actor: "one", message: "🔥", createdAt: "2026-04-22T10:00:00.000Z" },
        { id: "chat-2", kind: "chat", actor: "two", message: "🔥", createdAt: "2026-04-22T10:00:01.000Z" },
        { id: "chat-3", kind: "chat", actor: "three", message: "🎉", createdAt: "2026-04-22T10:00:02.000Z" }
      ]
    });
    const crowd = buildEngagementGameOverlayState({
      settings: {
        gameEnabled: true,
        soloModeEnabled: true,
        smallGroupModeEnabled: true,
        crowdModeEnabled: true,
        gameWindowMinutes: 10
      },
      runtime: {
        mode: "crowd",
        activeChatterCount: 14,
        modeChangedAt: "",
        updatedAt: ""
      },
      recentEvents: [
        { id: "chat-4", kind: "chat", actor: "one", message: "!a", createdAt: "2026-04-22T10:00:10.000Z" },
        { id: "chat-5", kind: "chat", actor: "two", message: "!b", createdAt: "2026-04-22T10:00:11.000Z" },
        { id: "chat-6", kind: "chat", actor: "three", message: "!b", createdAt: "2026-04-22T10:00:12.000Z" }
      ]
    });

    expect(smallGroup.options[0]).toMatchObject({ label: "🔥 Hype", votes: 2, isLeading: true });
    expect(crowd.options[1]).toMatchObject({ label: "!B Push", votes: 2, isLeading: true });
  });

  it("keeps the current mode stable until the hysteresis window elapses", () => {
    const tracker = new EngagementGameTracker();
    const settings = {
      gameEnabled: true,
      soloModeEnabled: true,
      smallGroupModeEnabled: true,
      crowdModeEnabled: true,
      gameWindowMinutes: 10
    };

    tracker.recordChatMessage({ actor: "solo-viewer", createdAt: "2026-04-22T10:00:00.000Z" });
    expect(tracker.getSnapshot(settings, new Date("2026-04-22T10:00:00.000Z")).mode).toBe("solo");

    tracker.recordChatMessage({ actor: "viewer-two", createdAt: "2026-04-22T10:00:05.000Z" });
    expect(tracker.getSnapshot(settings, new Date("2026-04-22T10:00:20.000Z")).mode).toBe("solo");
    expect(tracker.getSnapshot(settings, new Date("2026-04-22T10:00:52.000Z")).mode).toBe("small-group");

    expect(tracker.getSnapshot(settings, new Date("2026-04-22T10:10:10.000Z")).mode).toBe("small-group");
    expect(tracker.getSnapshot(settings, new Date("2026-04-22T10:10:45.000Z")).mode).toBe("");
  });
});

describe("engagement settings form", () => {
  it("exposes live game controls instead of the M46 scaffolding copy", () => {
    expect(engagementSettingsFormSource).toContain("Enable chatter-participation game");
    expect(engagementSettingsFormSource).toContain("Solo mode");
    expect(engagementSettingsFormSource).toContain("Small-group mode");
    expect(engagementSettingsFormSource).toContain("Crowd mode");
    expect(engagementSettingsFormSource).toContain("gameWindowMinutes");
    expect(engagementSettingsFormSource).not.toContain("Mode automation ships in M47");
  });
});
