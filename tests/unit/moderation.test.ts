import { describe, expect, it } from "vitest";
import {
  createDefaultModerationConfig,
  describePresenceStatus,
  parseModeratorCheckIn
} from "@stream247/core";

describe("moderator presence windows", () => {
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
});

