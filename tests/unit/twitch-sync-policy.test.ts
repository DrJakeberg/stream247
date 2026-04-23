import { describe, expect, it } from "vitest";
import { isTwitchScheduleSyncEnabled } from "../../apps/worker/src/twitch-sync-policy";

describe("twitch sync policy", () => {
  it("enables Twitch schedule sync by default", () => {
    expect(isTwitchScheduleSyncEnabled({})).toBe(true);
  });

  it("disables Twitch schedule sync when configured off", () => {
    expect(isTwitchScheduleSyncEnabled({ TWITCH_SCHEDULE_SYNC_ENABLED: "0" })).toBe(false);
  });
});
