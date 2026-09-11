import { describe, expect, it } from "vitest";
import type { AppState } from "../../apps/web/lib/server/state";
import { summarizeTwitchLiveStatus } from "../../apps/web/lib/server/state";
import { buildTwitchWatchUrl } from "../../apps/web/lib/watch-url";

// The summary's broadcasterLogin becomes the public watch link and the live widget's label. Both
// must point where the video actually goes, which with a broadcast-channel split is not the
// connected account's channel.

function twitchState(broadcastChannelLogin: string): AppState {
  return {
    managedConfig: {
      twitchBroadcastChannelLogin: broadcastChannelLogin
    },
    twitch: {
      status: "connected",
      broadcasterId: "123",
      broadcasterLogin: "3jakec",
      liveStatus: "live",
      viewerCount: 12,
      startedAt: "2026-08-25T10:00:00.000Z"
    }
  } as AppState;
}

describe("whose live status the workspace shows", () => {
  it("keeps the connected account's channel without a split", () => {
    expect(summarizeTwitchLiveStatus(twitchState("")).broadcasterLogin).toBe("3jakec");
  });

  it("uses the broadcast channel when one is configured", () => {
    const summary = summarizeTwitchLiveStatus(twitchState("jimpanse247"));

    expect(summary.broadcasterLogin).toBe("jimpanse247");
    // The same login feeds the watch link, so the audience lands on the watched channel.
    expect(buildTwitchWatchUrl(summary.broadcasterLogin)).toBe("https://twitch.tv/jimpanse247");
  });

  it("falls back to the connected account when the setting is malformed", () => {
    expect(summarizeTwitchLiveStatus(twitchState("evil.com/x")).broadcasterLogin).toBe("3jakec");
  });
});
