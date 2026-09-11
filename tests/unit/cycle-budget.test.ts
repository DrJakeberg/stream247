import { describe, expect, it } from "vitest";
import {
  DEFAULT_LOOP_STALL_TIMEOUT_MS,
  clampToCycleAwaitCeiling,
  getCycleAwaitCeilingMs,
  getLoopStallTimeoutMs
} from "../../apps/worker/src/cycle-budget.js";
import { getTwitchVodCacheConfig } from "../../apps/worker/src/twitch-vod-cache.js";

describe("getLoopStallTimeoutMs", () => {
  it("defaults to 300s when unset or empty", () => {
    expect(getLoopStallTimeoutMs({})).toBe(DEFAULT_LOOP_STALL_TIMEOUT_MS);
    expect(getLoopStallTimeoutMs({ STREAM247_LOOP_STALL_TIMEOUT_SECONDS: "" })).toBe(DEFAULT_LOOP_STALL_TIMEOUT_MS);
  });

  it("honours a configured value at or above the 60s floor", () => {
    expect(getLoopStallTimeoutMs({ STREAM247_LOOP_STALL_TIMEOUT_SECONDS: "600" })).toBe(600_000);
    expect(getLoopStallTimeoutMs({ STREAM247_LOOP_STALL_TIMEOUT_SECONDS: "60" })).toBe(60_000);
  });

  it("falls back to the default for values below the floor or unparseable input", () => {
    expect(getLoopStallTimeoutMs({ STREAM247_LOOP_STALL_TIMEOUT_SECONDS: "5" })).toBe(DEFAULT_LOOP_STALL_TIMEOUT_MS);
    expect(getLoopStallTimeoutMs({ STREAM247_LOOP_STALL_TIMEOUT_SECONDS: "abc" })).toBe(DEFAULT_LOOP_STALL_TIMEOUT_MS);
  });
});

describe("getCycleAwaitCeilingMs", () => {
  it("leaves at least half the stall budget for the rest of the cycle", () => {
    expect(getCycleAwaitCeilingMs({})).toBe(150_000);
    expect(getCycleAwaitCeilingMs({ STREAM247_LOOP_STALL_TIMEOUT_SECONDS: "600" })).toBe(300_000);
  });

  it("never returns a ceiling so tight that no remote resolve could finish", () => {
    expect(getCycleAwaitCeilingMs({ STREAM247_LOOP_STALL_TIMEOUT_SECONDS: "60" })).toBe(30_000);
  });

  it("stays strictly below the stall budget for every accepted configuration", () => {
    for (const seconds of ["60", "90", "300", "600", "3600"]) {
      const env = { STREAM247_LOOP_STALL_TIMEOUT_SECONDS: seconds };
      expect(getCycleAwaitCeilingMs(env)).toBeLessThan(getLoopStallTimeoutMs(env));
    }
  });
});

describe("clampToCycleAwaitCeiling", () => {
  it("passes through a timeout that already fits the budget", () => {
    const result = clampToCycleAwaitCeiling(60_000, {});
    expect(result).toMatchObject({ effectiveMs: 60_000, requestedMs: 60_000, clamped: false });
  });

  it("clamps a timeout that would outlive the stall guard and flags it", () => {
    const result = clampToCycleAwaitCeiling(7_200_000, {});
    expect(result).toMatchObject({ effectiveMs: 150_000, requestedMs: 7_200_000, clamped: true });
  });

  it("falls back to the ceiling for a non-positive or unparseable timeout", () => {
    expect(clampToCycleAwaitCeiling(0, {}).effectiveMs).toBe(150_000);
    expect(clampToCycleAwaitCeiling(Number.NaN, {}).effectiveMs).toBe(150_000);
  });
});

describe("twitch VOD cache download budget", () => {
  // Regression guard for the v1.5.17 production restart loop: TWITCH_VOD_CACHE_DOWNLOAD_TIMEOUT_SECONDS
  // was 7200 while the loop stall guard was 300s, so every cycle that awaited an uncached VOD
  // download tripped the guard and restarted the playout container (423 restarts observed).
  it("clamps an awaited download to the cycle budget while keeping the configured value for background jobs", () => {
    const config = getTwitchVodCacheConfig(
      { TWITCH_VOD_CACHE_DOWNLOAD_TIMEOUT_SECONDS: "7200" },
      "/app/data/media"
    );

    expect(config.downloadTimeoutMs).toBe(150_000);
    expect(config.backgroundDownloadTimeoutMs).toBe(7_200_000);
    expect(config.downloadTimeoutClamped).toBe(true);
  });

  it("keeps an awaited download strictly below the stall guard for any configured timeout", () => {
    for (const seconds of ["1", "60", "120", "600", "7200", "86400"]) {
      const env = { TWITCH_VOD_CACHE_DOWNLOAD_TIMEOUT_SECONDS: seconds };
      const config = getTwitchVodCacheConfig(env, "/app/data/media");
      expect(config.downloadTimeoutMs).toBeLessThan(getLoopStallTimeoutMs(env));
    }
  });

  it("does not flag a timeout that already fits", () => {
    const config = getTwitchVodCacheConfig({ TWITCH_VOD_CACHE_DOWNLOAD_TIMEOUT_SECONDS: "120" }, "/app/data/media");
    expect(config.downloadTimeoutMs).toBe(120_000);
    expect(config.downloadTimeoutClamped).toBe(false);
  });
});
