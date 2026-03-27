import { describe, expect, it } from "vitest";
import {
  createDefaultModerationConfig,
  describePresenceStatus,
  isLikelyTwitchVodUrl,
  isLikelyYouTubePlaylistUrl,
  parseModeratorCheckIn
} from "@stream247/core";

describe("moderator presence windows", () => {
  it("includes emote-only fallback in the default policy", () => {
    expect(createDefaultModerationConfig().fallbackEmoteOnly).toBe(true);
  });

  it("parses 'here 30' into an active presence window", () => {
    const now = new Date("2026-03-27T10:00:00.000Z");
    const window = parseModeratorCheckIn({
      actor: "mod_a",
      input: "here 30",
      now,
      config: createDefaultModerationConfig()
    });

    expect(window?.minutes).toBe(30);
    expect(window?.expiresAt.toISOString()).toBe("2026-03-27T10:30:00.000Z");
  });

  it("falls back to emote-only when no windows remain", () => {
    const status = describePresenceStatus({
      activeWindows: [],
      now: new Date("2026-03-27T11:00:00.000Z"),
      fallbackEmoteOnly: true
    });

    expect(status.chatMode).toBe("emote-only");
  });

  it("supports prefixed moderator commands when configured", () => {
    const now = new Date("2026-03-27T10:00:00.000Z");
    const config = {
      ...createDefaultModerationConfig(),
      requirePrefix: true
    };

    const window = parseModeratorCheckIn({
      actor: "mod_b",
      input: "!here 45",
      now,
      config
    });

    expect(window?.minutes).toBe(45);
  });

  it("detects valid YouTube playlist URLs", () => {
    expect(isLikelyYouTubePlaylistUrl("https://www.youtube.com/playlist?list=PL123")).toBe(true);
    expect(isLikelyYouTubePlaylistUrl("https://www.youtube.com/watch?v=abc123&list=PL123")).toBe(true);
    expect(isLikelyYouTubePlaylistUrl("https://www.youtube.com/watch?v=abc123")).toBe(false);
  });

  it("detects valid Twitch VOD URLs", () => {
    expect(isLikelyTwitchVodUrl("https://www.twitch.tv/videos/123456789")).toBe(true);
    expect(isLikelyTwitchVodUrl("https://www.twitch.tv/somechannel")).toBe(false);
  });
});
