import { describe, expect, it } from "vitest";
import { createRingBuffer, parseTwitchChatModerationLine } from "../../apps/worker/src/twitch-engagement";

/**
 * Moderation must reach the broadcast. A message a moderator deletes disappears from every chat
 * client, but the on-air overlay draws from the bridge's own buffer — so the bridge has to mirror
 * CLEARMSG and CLEARCHAT into that buffer, or the deleted message keeps playing on the one
 * surface nobody can refresh.
 */

describe("parsing Twitch moderation lines", () => {
  it("reads a single-message deletion with its target id", () => {
    const action = parseTwitchChatModerationLine(
      "@login=troll;room-id=;target-msg-id=abc-123;tmi-sent-ts=1642720582342 :tmi.twitch.tv CLEARMSG #stream247 :the deleted text"
    );

    expect(action).toEqual({ kind: "clear-message", targetMessageId: "abc-123" });
  });

  it("reads a ban or timeout as clearing that login's messages", () => {
    const action = parseTwitchChatModerationLine(
      "@ban-duration=600;room-id=1;target-user-id=2;tmi-sent-ts=3 :tmi.twitch.tv CLEARCHAT #stream247 :TrollUser"
    );

    expect(action).toEqual({ kind: "clear-user", login: "trolluser" });
  });

  it("reads a full room clear when no target login is present", () => {
    expect(parseTwitchChatModerationLine(":tmi.twitch.tv CLEARCHAT #stream247")).toEqual({ kind: "clear-all" });
  });

  it("does not mistake ordinary chat or a CLEARMSG without a target for moderation", () => {
    expect(
      parseTwitchChatModerationLine(
        "@display-name=Viewer;id=chat-1 :viewer!viewer@viewer.tmi.twitch.tv PRIVMSG #stream247 :CLEARCHAT is a fun word"
      )
    ).toBeNull();
    expect(parseTwitchChatModerationLine("@login=troll :tmi.twitch.tv CLEARMSG #stream247 :text")).toBeNull();
  });
});

describe("removing from the ring buffer", () => {
  function seeded() {
    const buffer = createRingBuffer<{ id: string; login: string }>(10);
    buffer.push({ id: "m1", login: "alice" });
    buffer.push({ id: "m2", login: "troll" });
    buffer.push({ id: "m3", login: "troll" });
    buffer.push({ id: "m4", login: "bob" });
    return buffer;
  }

  it("removes one message by id and reports the count", () => {
    const buffer = seeded();
    expect(buffer.remove((entry) => entry.id === "m2")).toBe(1);
    expect(buffer.values().map((entry) => entry.id)).toEqual(["m1", "m3", "m4"]);
  });

  it("removes every message of a banned login", () => {
    const buffer = seeded();
    expect(buffer.remove((entry) => entry.login === "troll")).toBe(2);
    expect(buffer.values().map((entry) => entry.id)).toEqual(["m1", "m4"]);
  });

  it("reports zero for a target that is no longer buffered, so no needless flush fires", () => {
    const buffer = seeded();
    expect(buffer.remove((entry) => entry.id === "gone")).toBe(0);
  });
});
