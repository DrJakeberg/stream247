import { describe, expect, it } from "vitest";
import {
  getBroadcastLiveStatusLabel,
  getBroadcastLiveStatusTone,
  getBroadcastLiveUptimeLabel,
  getBroadcastLiveViewerCountLabel
} from "../../apps/web/components/broadcast-live-status";

describe("broadcast live status helpers", () => {
  it("formats a live badge with viewer count", () => {
    const twitch = {
      status: "live" as const,
      viewerCount: 128,
      broadcasterLogin: "stream247",
      startedAt: "2026-04-22T09:05:00.000Z"
    };

    expect(getBroadcastLiveStatusLabel(twitch)).toBe("LIVE 128");
    expect(getBroadcastLiveStatusTone(twitch)).toBe("live");
    expect(getBroadcastLiveViewerCountLabel(twitch)).toBe("128");
    expect(getBroadcastLiveUptimeLabel(twitch, new Date("2026-04-22T10:15:00.000Z").getTime())).toBe("1h 10m");
  });

  it("formats offline and unknown states without viewer counts", () => {
    expect(
      getBroadcastLiveStatusLabel({
        status: "offline",
        viewerCount: 0,
        broadcasterLogin: "stream247",
        startedAt: ""
      })
    ).toBe("OFFLINE");
    expect(
      getBroadcastLiveStatusTone({
        status: "unknown",
        viewerCount: 0,
        broadcasterLogin: "",
        startedAt: ""
      })
    ).toBe("unknown");
    expect(
      getBroadcastLiveUptimeLabel(
        {
          status: "offline",
          viewerCount: 0,
          broadcasterLogin: "stream247",
          startedAt: ""
        },
        new Date("2026-04-22T10:15:00.000Z").getTime()
      )
    ).toBe("Not live");
  });
});
