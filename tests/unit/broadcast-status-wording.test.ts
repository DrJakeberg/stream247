import { describe, expect, it } from "vitest";
import { getBroadcastLiveStatusLabel } from "../../apps/web/components/broadcast-live-status";

// These labels sit in the navigation rail and the workspace header — the first thing an operator
// reads when something feels wrong. They used to be status codes in capitals: LIVE, OFFLINE,
// UNKNOWN. "UNKNOWN" in particular named a temporary condition ("we have not managed to ask Twitch
// yet") in a way that read like a fault, and told the reader nothing about what to do.

function twitch(status: "live" | "offline" | "unknown", viewerCount = 0) {
  return { status, viewerCount } as Parameters<typeof getBroadcastLiveStatusLabel>[0];
}

describe("what the channel status says", () => {
  it("says the channel is live, and how many are watching", () => {
    expect(getBroadcastLiveStatusLabel(twitch("live", 1234))).toBe("Live · 1234");
  });

  it("omits a viewer count nobody has yet", () => {
    // Zero viewers on a live channel is normal for the first minutes; "Live · 0" reads as a fault.
    expect(getBroadcastLiveStatusLabel(twitch("live", 0))).toBe("Live");
  });

  it("says off air rather than OFFLINE", () => {
    expect(getBroadcastLiveStatusLabel(twitch("offline"))).toBe("Off air");
  });

  it("says it is still checking rather than UNKNOWN", () => {
    // Not knowing yet is a stage of starting up, not a failure.
    expect(getBroadcastLiveStatusLabel(twitch("unknown"))).toBe("Checking");
  });

  it("keeps every label short enough for the chip it lives in", () => {
    // The navigation rail is narrow; a label that wraps pushes the layout around.
    for (const label of [
      getBroadcastLiveStatusLabel(twitch("live", 1234)),
      getBroadcastLiveStatusLabel(twitch("offline")),
      getBroadcastLiveStatusLabel(twitch("unknown"))
    ]) {
      expect(label.length).toBeLessThanOrEqual(12);
    }
  });

  it("shouts at nobody", () => {
    for (const label of [
      getBroadcastLiveStatusLabel(twitch("live")),
      getBroadcastLiveStatusLabel(twitch("offline")),
      getBroadcastLiveStatusLabel(twitch("unknown"))
    ]) {
      expect(label).not.toBe(label.toUpperCase());
    }
  });
});
