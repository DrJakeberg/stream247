import { describe, expect, it } from "vitest";
import { getBroadcastLiveStatusLabel, getBroadcastLiveStatusTone } from "../../apps/web/components/broadcast-live-status";

describe("broadcast live status helpers", () => {
  it("formats a live badge with viewer count", () => {
    const twitch = {
      status: "live" as const,
      viewerCount: 128,
      broadcasterLogin: "stream247"
    };

    expect(getBroadcastLiveStatusLabel(twitch)).toBe("LIVE 128");
    expect(getBroadcastLiveStatusTone(twitch)).toBe("live");
  });

  it("formats offline and unknown states without viewer counts", () => {
    expect(
      getBroadcastLiveStatusLabel({
        status: "offline",
        viewerCount: 0,
        broadcasterLogin: "stream247"
      })
    ).toBe("OFFLINE");
    expect(
      getBroadcastLiveStatusTone({
        status: "unknown",
        viewerCount: 0,
        broadcasterLogin: ""
      })
    ).toBe("unknown");
  });
});
