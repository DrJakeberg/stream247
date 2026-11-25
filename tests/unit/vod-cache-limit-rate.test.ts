import { describe, expect, it } from "vitest";
import {
  getTwitchVodCacheConfig,
  normalizeLimitRate,
  planRejectedLimitRateReport
} from "../../apps/worker/src/twitch-vod-cache.js";

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

// Dropping a bad value is the safe behaviour, but on its own it is indistinguishable from having
// configured no ceiling at all: the operator writes "8Mbps", sees no error, and the cache goes back
// to saturating the line while the channel is live -- the exact thing the option was added to stop.
// So the config carries the refused text through for the worker to report once.

describe("reporting a refused ceiling", () => {
  it("surfaces the refused env value on the config the worker actually runs on", () => {
    for (const refused of ["8Mbps", "8 Mbit/s", "fast"]) {
      const config = getTwitchVodCacheConfig({ TWITCH_VOD_CACHE_LIMIT_RATE: refused }, "/app/data/media");
      // Unthrottled, and able to say why.
      expect(config.limitRate).toBe("");
      expect(config.limitRateRejected).toBe(refused);
    }
    expect(
      getTwitchVodCacheConfig({ TWITCH_VOD_CACHE_LIMIT_RATE: "  fast  " }, "/app/data/media").limitRateRejected
    ).toBe("fast");
  });

  it("reports nothing when the value was accepted or deliberately unlimited", () => {
    // A false alarm here would train the operator to ignore the real one.
    for (const env of [{ TWITCH_VOD_CACHE_LIMIT_RATE: "8M" }, { TWITCH_VOD_CACHE_LIMIT_RATE: "0" }, { TWITCH_VOD_CACHE_LIMIT_RATE: "   " }, {}]) {
      expect(getTwitchVodCacheConfig(env, "/app/data/media").limitRateRejected).toBe("");
    }
    expect(getTwitchVodCacheConfig({ TWITCH_VOD_CACHE_LIMIT_RATE: "8M" }, "/app/data/media").limitRate).toBe("8M");
  });

  it("reports nothing when a managed ceiling decides, since the env value is then not in effect", () => {
    const env = { TWITCH_VOD_CACHE_LIMIT_RATE: "8Mbps" };
    const managedCap = getTwitchVodCacheConfig(env, "/app/data/media", { vodCacheLimitRate: "4M" });
    expect(managedCap.limitRate).toBe("4M");
    expect(managedCap.limitRateRejected).toBe("");

    const managedUnlimited = getTwitchVodCacheConfig(env, "/app/data/media", { vodCacheLimitRate: "0" });
    expect(managedUnlimited.limitRate).toBe("");
    expect(managedUnlimited.limitRateRejected).toBe("");
  });

  it("still reports the env value when the managed value is empty or corrupted and the env path runs", () => {
    const env = { TWITCH_VOD_CACHE_LIMIT_RATE: "8Mbps" };
    expect(getTwitchVodCacheConfig(env, "/app/data/media", { vodCacheLimitRate: "" }).limitRateRejected).toBe("8Mbps");
    expect(getTwitchVodCacheConfig(env, "/app/data/media", { vodCacheLimitRate: "8 Mbit" }).limitRateRejected).toBe(
      "8Mbps"
    );
  });

  it("says it once per refused value, not once per cycle", () => {
    const on = (limitRateRejected: string) => ({ enabled: true, limitRateRejected });
    expect(planRejectedLimitRateReport("", on("8Mbps"), true)).toEqual({ report: true, remembered: "8Mbps" });
    expect(planRejectedLimitRateReport("8Mbps", on("8Mbps"), true)).toEqual({ report: false, remembered: "8Mbps" });
    // A different wrong value is news again.
    expect(planRejectedLimitRateReport("8Mbps", on("8 Mbit/s"), true)).toEqual({ report: true, remembered: "8 Mbit/s" });
    // A fixed value resets, so the same mistake made again later is reported again.
    expect(planRejectedLimitRateReport("8Mbps", on(""), true)).toEqual({ report: false, remembered: "" });
    expect(planRejectedLimitRateReport("", on(""), true)).toEqual({ report: false, remembered: "" });
  });

  it("waits for the managed config before it reports, without forgetting what it said", () => {
    // Before the first managed load the resolver ran env-only; a saved GUI value may still win.
    expect(planRejectedLimitRateReport("", { enabled: true, limitRateRejected: "8Mbps" }, false)).toEqual({
      report: false,
      remembered: ""
    });
    expect(planRejectedLimitRateReport("8Mbps", { enabled: true, limitRateRejected: "8Mbps" }, false)).toEqual({
      report: false,
      remembered: "8Mbps"
    });
  });

  it("stays quiet while the cache is off and reports again once it is switched on", () => {
    // With the cache off no download runs, so "unthrottled" would be a false alarm.
    const off = planRejectedLimitRateReport("8Mbps", { enabled: false, limitRateRejected: "8Mbps" }, true);
    expect(off).toEqual({ report: false, remembered: "" });
    expect(planRejectedLimitRateReport(off.remembered, { enabled: true, limitRateRejected: "8Mbps" }, true).report).toBe(
      true
    );
  });
});
