import { describe, expect, it } from "vitest";
import {
  CHAT_OVERLAY_MESSAGE_TTL_MS,
  buildChatOverlayViewFromMessages,
  type ChatOverlayMessagesSource
} from "../../apps/worker/src/chat-overlay";

/**
 * The playout container's side of the chat process boundary: the persisted row in,
 * what the overlay draws out. The row has no deadline column the way the poll and skip rows do,
 * so the per-message TTL carries the entire worker-death story — these tests pin it down.
 */

const NOW = new Date("2026-08-25T20:10:00.000Z");

function source(overrides: Partial<ChatOverlayMessagesSource> = {}): ChatOverlayMessagesSource {
  return {
    enabled: true,
    position: "bottom-left",
    maxMessages: 5,
    messages: [
      { name: "viewer_one", text: "hello", at: "2026-08-25T20:09:00.000Z" },
      { name: "viewer_two", text: "world", at: "2026-08-25T20:09:30.000Z" }
    ],
    ...overrides
  };
}

describe("what the persisted chat row puts on air", () => {
  it("projects fresh messages with position and count settings attached", () => {
    const view = buildChatOverlayViewFromMessages(source({ position: "top-right", maxMessages: 3 }), NOW);

    expect(view).toEqual({
      position: "top-right",
      maxMessages: 3,
      messages: [
        { name: "viewer_one", text: "hello" },
        { name: "viewer_two", text: "world" }
      ]
    });
  });

  it("keeps the newest tail when the row holds more than maxMessages", () => {
    const messages = Array.from({ length: 6 }, (_, index) => ({
      name: `viewer_${String(index)}`,
      text: `message ${String(index)}`,
      at: `2026-08-25T20:09:0${String(index)}.000Z`
    }));
    const view = buildChatOverlayViewFromMessages(source({ maxMessages: 2, messages }), NOW);

    expect(view?.messages.map((message) => message.text)).toEqual(["message 4", "message 5"]);
  });
});

describe("when the row projects to nothing", () => {
  it("is null while chat is disabled, whatever the row still holds", () => {
    expect(buildChatOverlayViewFromMessages(source({ enabled: false }), NOW)).toBeNull();
  });

  it("is null for an empty row", () => {
    expect(buildChatOverlayViewFromMessages(source({ messages: [] }), NOW)).toBeNull();
  });

  it("ages messages off air one by one, and the panel with the last of them", () => {
    const boundary = new Date(Date.parse("2026-08-25T20:09:30.000Z") + CHAT_OVERLAY_MESSAGE_TTL_MS - 1000);
    const partial = buildChatOverlayViewFromMessages(source(), boundary);
    expect(partial?.messages.map((message) => message.text)).toEqual(["world"]);

    const after = new Date(Date.parse("2026-08-25T20:09:30.000Z") + CHAT_OVERLAY_MESSAGE_TTL_MS + 1000);
    expect(buildChatOverlayViewFromMessages(source(), after)).toBeNull();
  });

  it("treats unparseable timestamps as aged out, so a corrupt row cannot pin text on air", () => {
    const view = buildChatOverlayViewFromMessages(
      source({
        messages: [
          { name: "ghost", text: "stuck forever", at: "not-a-date" },
          { name: "ghost", text: "stuck forever", at: "" }
        ]
      }),
      NOW
    );

    expect(view).toBeNull();
  });

  it("drops messages stamped far in the future rather than trusting them indefinitely", () => {
    const view = buildChatOverlayViewFromMessages(
      source({ messages: [{ name: "time_traveller", text: "hi", at: "2026-08-25T21:00:00.000Z" }] }),
      NOW
    );

    expect(view).toBeNull();
  });
});
