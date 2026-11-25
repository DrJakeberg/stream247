import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * M127: Twitch moderation reaches the stored chat lines, not only the overlay's ring buffer. A
 * message a moderator deleted, or every line of a banned or timed-out user, used to stay in
 * engagement_events and so in every reader of the stored list.
 */

const { mockAppendEngagementEventRecord, mockDeleteChatEngagementEvents } = vi.hoisted(() => ({
  mockAppendEngagementEventRecord: vi.fn(),
  mockDeleteChatEngagementEvents: vi.fn()
}));

vi.mock("@stream247/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@stream247/db")>()),
  appendEngagementEventRecord: mockAppendEngagementEventRecord,
  deleteChatEngagementEvents: mockDeleteChatEngagementEvents
}));

import { TwitchChatBridge } from "../../apps/worker/src/twitch-engagement";

function privmsg(id: string, login: string, displayName: string, text: string) {
  return `@display-name=${displayName};id=${id};mod=0 :${login}!${login}@${login}.tmi.twitch.tv PRIVMSG #jimpanse247 :${text}\r\n`;
}

function feed(bridge: TwitchChatBridge, chunk: string) {
  (bridge as unknown as { handleChunk(chunk: string): void }).handleChunk(chunk);
}

// The stored writes run one after another off the socket handler; let the queue drain.
async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("moderation mirrored into the stored chat lines", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAppendEngagementEventRecord.mockResolvedValue(undefined);
    mockDeleteChatEngagementEvents.mockResolvedValue(0);
  });

  it("deletes a message Twitch deleted (CLEARMSG) by its id", async () => {
    const bridge = new TwitchChatBridge();
    feed(bridge, privmsg("m1", "ada", "Ada", "to be deleted") + privmsg("m2", "bob", "Bob", "stays"));
    await settle();
    expect(mockAppendEngagementEventRecord).toHaveBeenCalledTimes(2);

    feed(bridge, "@login=ada;room-id=;target-msg-id=m1;tmi-sent-ts=1 :tmi.twitch.tv CLEARMSG #jimpanse247 :to be deleted\r\n");
    await settle();

    expect(mockDeleteChatEngagementEvents).toHaveBeenCalledTimes(1);
    expect(mockDeleteChatEngagementEvents).toHaveBeenCalledWith({ ids: ["m1"] });
    expect(bridge.getRecentMessages().map((entry) => entry.id)).toEqual(["m2"]);
  });

  it("deletes the stored lines of a banned or timed-out user (CLEARCHAT with a login)", async () => {
    const bridge = new TwitchChatBridge();
    // A localized display name shares nothing with the login: the buffered id is what finds that row.
    feed(bridge, privmsg("m1", "ada", "エイダ", "one") + privmsg("m2", "bob", "Bob", "two") + privmsg("m3", "ada", "エイダ", "three"));

    feed(bridge, "@ban-duration=600;room-id=1;target-user-id=2;tmi-sent-ts=3 :tmi.twitch.tv CLEARCHAT #jimpanse247 :ada\r\n");
    await settle();

    expect(mockDeleteChatEngagementEvents).toHaveBeenCalledTimes(1);
    const [target] = mockDeleteChatEngagementEvents.mock.calls[0]!;
    expect(target.login).toBe("ada");
    expect([...target.ids].sort()).toEqual(["m1", "m3"]);
    expect(target.all).toBeUndefined();
  });

  it("deletes the stored lines of a user even when none of them is still buffered", async () => {
    const bridge = new TwitchChatBridge();

    feed(bridge, ":tmi.twitch.tv CLEARCHAT #jimpanse247 :ada\r\n");
    await settle();

    expect(mockDeleteChatEngagementEvents).toHaveBeenCalledWith({ ids: [], login: "ada" });
  });

  it("deletes every stored chat line on a room clear", async () => {
    const bridge = new TwitchChatBridge();
    feed(bridge, privmsg("m1", "ada", "Ada", "one"));

    feed(bridge, ":tmi.twitch.tv CLEARCHAT #jimpanse247\r\n");
    await settle();

    expect(mockDeleteChatEngagementEvents).toHaveBeenCalledWith({ all: true });
    expect(bridge.getRecentMessages()).toEqual([]);
  });

  it("keeps the socket handler alive when the delete fails", async () => {
    mockDeleteChatEngagementEvents.mockRejectedValue(new Error("database gone"));
    const bridge = new TwitchChatBridge();

    expect(() =>
      feed(bridge, "@target-msg-id=m9 :tmi.twitch.tv CLEARMSG #jimpanse247 :x\r\n" + privmsg("m2", "bob", "Bob", "after"))
    ).not.toThrow();
    await settle();
    expect(mockAppendEngagementEventRecord).toHaveBeenCalledTimes(1);
  });

  it("sends a moderator delete only after the append of the line it deletes has settled", async () => {
    // AutoMod or a blocked-terms bot deletes a line milliseconds after it arrives. Each write takes
    // its own connection, so a delete sent alongside the append could commit first and miss the row.
    const order: string[] = [];
    let finishAppend: () => void = () => undefined;
    mockAppendEngagementEventRecord.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishAppend = () => {
            order.push("append m1 committed");
            resolve();
          };
        })
    );
    mockDeleteChatEngagementEvents.mockImplementation(async () => {
      order.push("delete m1 sent");
      return 1;
    });
    const bridge = new TwitchChatBridge();

    feed(bridge, privmsg("m1", "ada", "Ada", "spam") + "@target-msg-id=m1 :tmi.twitch.tv CLEARMSG #jimpanse247 :spam\r\n");
    await settle();
    expect(mockDeleteChatEngagementEvents).not.toHaveBeenCalled();

    finishAppend();
    await settle();
    expect(order).toEqual(["append m1 committed", "delete m1 sent"]);
  });
});
