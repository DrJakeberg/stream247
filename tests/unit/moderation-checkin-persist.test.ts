import { describe, expect, it, vi } from "vitest";
import { TwitchChatBridge } from "../../apps/worker/src/twitch-engagement";

/**
 * Finding [11] of the codebase review: the bridge told the moderator "checked in" before the
 * window was persisted, and a failed write vanished. The reply now follows the write: a rejected
 * write says so in the room, and a successful one is confirmed only once it has happened.
 */
const HERE = "@display-name=3JakeC;id=chat-9;mod=1 :3jakec!3jakec@3jakec.tmi.twitch.tv PRIVMSG #jimpanse247 :!here 30\r\n";

function bridgeWith(hook: (window: unknown) => Promise<void>) {
  const write = vi.fn();
  const bridge = new TwitchChatBridge({ onModeratorPresenceCheckIn: hook as never });
  bridge["socket"] = { write, destroyed: false } as never;
  bridge["channel"] = "jimpanse247";
  return { bridge, write };
}

describe("moderator check-in persistence", () => {
  it("does not confirm a check-in whose window could not be saved, and says so instead", async () => {
    const { bridge, write } = bridgeWith(async () => { throw new Error("advisory lock timeout"); });
    bridge["handleChunk"](HERE);
    await new Promise((resolve) => setImmediate(resolve));
    const said = write.mock.calls.map((call) => String(call[0]));
    expect(said.some((line) => /could not be saved/i.test(line))).toBe(true);
    expect(said.some((line) => /presence window/i.test(line))).toBe(false);
  });

  it("confirms only after the window has been written", async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const { bridge, write } = bridgeWith(() => pending);
    bridge["handleChunk"](HERE);
    await new Promise((resolve) => setImmediate(resolve));
    expect(write).not.toHaveBeenCalled();
    release();
    await new Promise((resolve) => setImmediate(resolve));
    expect(write).toHaveBeenCalledTimes(1);
    expect(String(write.mock.calls[0]?.[0])).toMatch(/presence window/i);
  });
});
