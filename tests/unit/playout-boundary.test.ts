import { describe, expect, it } from "vitest";
import { decideBoundaryPlaybackInput } from "../../apps/worker/src/playout-boundary";

describe("playout boundary input selection", () => {
  // Regression for the v1.5.10 CLEAN4 soak failure: a natural-boundary exit selected the
  // next scheduled asset, but the boundary resolved its input inline (Twitch-VOD cache /
  // yt-dlp), leaving playout idle with an empty currentAsset and broadcastReady=false until
  // the resolve completed. When the next asset was already prefetched, the boundary must
  // reuse that resolved input and NOT trigger an inline resolve.
  it("reuses the prefetched resolved input when the probe is fresh-ready (no inline resolve)", () => {
    const decision = decideBoundaryPlaybackInput({
      status: "ready",
      resolvedInput: "https://cdn.example/vod/720p.m3u8"
    });

    expect(decision.source).toBe("cache");
    expect(decision.input).toBe("https://cdn.example/vod/720p.m3u8");
  });

  it("falls through to an inline resolve when there is no probe (stale/missing TTL)", () => {
    const decision = decideBoundaryPlaybackInput(null);

    expect(decision.source).toBe("resolve");
    expect(decision.input).toBe("");
  });

  it("falls through to an inline resolve when the probe failed", () => {
    const decision = decideBoundaryPlaybackInput({
      status: "failed",
      resolvedInput: ""
    });

    expect(decision.source).toBe("resolve");
  });

  it("falls through to an inline resolve when a ready probe carries no resolved input", () => {
    const decision = decideBoundaryPlaybackInput({
      status: "ready",
      resolvedInput: ""
    });

    expect(decision.source).toBe("resolve");
  });
});
