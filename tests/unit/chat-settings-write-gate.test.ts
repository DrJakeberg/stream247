import { describe, expect, it } from "vitest";
import { describePresenceStatus, resolveChatSettingsWrite } from "@stream247/core";

/**
 * Finding [6] of the codebase review: the worker PATCHed Twitch's chat settings on every
 * reconcile — every 30 s — with no memory of what it last wrote and no regard for the
 * moderation policy's own on/off switch. A moderator who flipped emote-only by hand on Twitch was
 * overridden within half a minute, and an operator who switched the policy off still had
 * Stream247 forcing emote-only on the channel. One pure decision, asked before every write.
 */
describe("resolveChatSettingsWrite", () => {
  const base = { moderationEnabled: true, desiredEmoteOnly: true, lastWrittenEmoteOnly: null as boolean | null, lastWriteAtMs: 0, nowMs: 1_000_000, reassertIntervalMs: 600_000 };

  it("leaves Twitch alone when the moderation policy is switched off", () => {
    expect(resolveChatSettingsWrite({ ...base, moderationEnabled: false })).toEqual({ write: false, reason: "policy-off" });
  });
  it("writes the first time, and whenever the desired mode differs from what it last wrote", () => {
    expect(resolveChatSettingsWrite(base)).toEqual({ write: true, reason: "first" });
    expect(resolveChatSettingsWrite({ ...base, lastWrittenEmoteOnly: false, lastWriteAtMs: 990_000 })).toEqual({ write: true, reason: "changed" });
  });
  it("does not rewrite an unchanged mode inside the re-assert interval", () => {
    expect(resolveChatSettingsWrite({ ...base, lastWrittenEmoteOnly: true, lastWriteAtMs: 990_000 })).toEqual({ write: false, reason: "unchanged" });
  });
  it("re-asserts an unchanged mode once the interval has passed, so a hand change on Twitch is not permanent", () => {
    expect(resolveChatSettingsWrite({ ...base, lastWrittenEmoteOnly: true, lastWriteAtMs: 1_000_000 - 600_001 })).toEqual({ write: true, reason: "reassert" });
  });
});

describe("describePresenceStatus with the policy off", () => {
  it("does not ask for emote-only when the operator switched the policy off", () => {
    const status = describePresenceStatus({ activeWindows: [], now: new Date("2026-09-02T10:00:00Z"), fallbackEmoteOnly: true, enabled: false });
    expect(status.chatMode).toBe("normal");
    expect(status.active).toBe(false);
    expect(status.summary).toMatch(/policy is off/i);
  });
  it("keeps today's answer when the policy is on or the flag is not given", () => {
    const off = describePresenceStatus({ activeWindows: [], now: new Date("2026-09-02T10:00:00Z"), fallbackEmoteOnly: true });
    expect(off.chatMode).toBe("emote-only");
  });
});
