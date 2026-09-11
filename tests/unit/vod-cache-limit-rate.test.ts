import { describe, expect, it } from "vitest";
import { normalizeLimitRate } from "../../apps/worker/src/twitch-vod-cache.js";

// The cache runs on a host whose primary job is pushing a live stream out. Left unbounded it was
// measured pulling 145 Mbit/s of the available line while the channel was on air. --limit-rate
// keeps caching a background activity, but only if the value actually reaches yt-dlp: a malformed
// argument makes yt-dlp exit, which would silently convert throttling into a cache that never
// downloads at all. So anything not in yt-dlp's own notation is dropped rather than passed through.

describe("cache bandwidth ceiling", () => {
  it("passes through yt-dlp's rate notation", () => {
    expect(normalizeLimitRate("8M")).toBe("8M");
    expect(normalizeLimitRate("500K")).toBe("500K");
    expect(normalizeLimitRate("1.5M")).toBe("1.5M");
    expect(normalizeLimitRate("2G")).toBe("2G");
    expect(normalizeLimitRate("1048576")).toBe("1048576");
  });

  it("treats unset and zero as unlimited", () => {
    expect(normalizeLimitRate(undefined)).toBe("");
    expect(normalizeLimitRate("")).toBe("");
    expect(normalizeLimitRate("   ")).toBe("");
    expect(normalizeLimitRate("0")).toBe("");
  });

  it("drops values yt-dlp would reject instead of forwarding them", () => {
    // Each of these would abort the download rather than slow it down.
    expect(normalizeLimitRate("8 Mbit/s")).toBe("");
    expect(normalizeLimitRate("8Mbps")).toBe("");
    expect(normalizeLimitRate("fast")).toBe("");
    expect(normalizeLimitRate("-1M")).toBe("");
    expect(normalizeLimitRate("8M; rm -rf /")).toBe("");
  });

  it("tolerates surrounding whitespace and lowercase suffixes", () => {
    expect(normalizeLimitRate("  8M  ")).toBe("8M");
    expect(normalizeLimitRate("8m")).toBe("8m");
  });
});
