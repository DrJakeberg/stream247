import { describe, expect, it } from "vitest";
import {
  isValidVodCacheGb,
  isValidVodCacheLimitRate,
  resolveVodCacheTuning,
  VOD_CACHE_LIMITS
} from "../../packages/core/src/index.js";

// M56 part 2: the remaining operational families move from .env into managed config, on the same
// contract part 1 established — a managed value that is set wins, otherwise the env variable,
// otherwise the built-in default, and an EMPTY managed value never changes what an existing
// env-driven install does. These families configure watchdogs and caches whose wrong values can
// destabilise the channel, so every managed number is clamped to the bounds the modules' own
// invariants dictate, and the clamps are pinned here as tests.

const GIB = 1024 * 1024 * 1024;

describe("replay cache tuning resolution", () => {
  it("uses the built-in defaults when neither managed config nor env is set", () => {
    const resolved = resolveVodCacheTuning(null, {});

    expect(resolved.enabled).toBe(true);
    expect(resolved.allowRemoteFallback).toBe(false);
    expect(resolved.maxCacheBytes).toBe(20 * GIB);
    expect(resolved.minFreeBytes).toBe(15 * GIB);
    expect(resolved.maxAssetBytes).toBe(20 * GIB);
    expect(resolved.retentionHours).toBe(72);
    expect(resolved.partialMaxAgeHours).toBe(6);
    expect(resolved.downloadTimeoutSeconds).toBe(120);
    expect(resolved.failureCooldownSeconds).toBe(30 * 60);
    expect(resolved.limitRate).toBe("");
  });

  it("keeps the env fallback exactly as before when managed values are empty", () => {
    const resolved = resolveVodCacheTuning(
      { vodCacheEnabled: "", vodCacheMaxGb: "", vodCacheLimitRate: "" },
      {
        TWITCH_VOD_CACHE_ENABLED: "0",
        TWITCH_VOD_CACHE_ALLOW_REMOTE_FALLBACK: "1",
        TWITCH_VOD_CACHE_MAX_BYTES: String(7 * GIB),
        TWITCH_VOD_CACHE_MIN_FREE_BYTES: String(3 * GIB),
        TWITCH_VOD_CACHE_MAX_ASSET_BYTES: String(5 * GIB),
        TWITCH_VOD_CACHE_RETENTION_HOURS: "24",
        TWITCH_VOD_CACHE_PARTIAL_MAX_AGE_HOURS: "2",
        TWITCH_VOD_CACHE_DOWNLOAD_TIMEOUT_SECONDS: "90",
        TWITCH_VOD_CACHE_FAILURE_COOLDOWN_SECONDS: "600",
        TWITCH_VOD_CACHE_LIMIT_RATE: "8M"
      }
    );

    expect(resolved.enabled).toBe(false);
    expect(resolved.allowRemoteFallback).toBe(true);
    expect(resolved.maxCacheBytes).toBe(7 * GIB);
    expect(resolved.minFreeBytes).toBe(3 * GIB);
    expect(resolved.maxAssetBytes).toBe(5 * GIB);
    expect(resolved.retentionHours).toBe(24);
    expect(resolved.partialMaxAgeHours).toBe(2);
    expect(resolved.downloadTimeoutSeconds).toBe(90);
    expect(resolved.failureCooldownSeconds).toBe(600);
    expect(resolved.limitRate).toBe("8M");
  });

  it("lets a set managed value win over the env variable, GB converted to bytes", () => {
    const resolved = resolveVodCacheTuning(
      {
        vodCacheEnabled: "0",
        vodCacheAllowRemoteFallback: "1",
        vodCacheMaxGb: "40",
        vodCacheMinFreeGb: "10",
        vodCacheMaxAssetGb: "8",
        vodCacheRetentionHours: "48",
        vodCachePartialMaxAgeHours: "12",
        vodCacheDownloadTimeoutSeconds: "300",
        vodCacheFailureCooldownSeconds: "120",
        vodCacheLimitRate: "4M"
      },
      {
        TWITCH_VOD_CACHE_ENABLED: "1",
        TWITCH_VOD_CACHE_MAX_BYTES: String(7 * GIB),
        TWITCH_VOD_CACHE_LIMIT_RATE: "8M"
      }
    );

    expect(resolved.enabled).toBe(false);
    expect(resolved.allowRemoteFallback).toBe(true);
    expect(resolved.maxCacheBytes).toBe(40 * GIB);
    expect(resolved.minFreeBytes).toBe(10 * GIB);
    expect(resolved.maxAssetBytes).toBe(8 * GIB);
    expect(resolved.retentionHours).toBe(48);
    expect(resolved.partialMaxAgeHours).toBe(12);
    expect(resolved.downloadTimeoutSeconds).toBe(300);
    expect(resolved.failureCooldownSeconds).toBe(120);
    expect(resolved.limitRate).toBe("4M");
  });

  it("clamps managed numbers into the documented bounds instead of trusting a corrupted store", () => {
    const resolved = resolveVodCacheTuning(
      {
        vodCacheMaxGb: "999999",
        vodCacheMinFreeGb: "0.1",
        vodCacheRetentionHours: "999999",
        vodCachePartialMaxAgeHours: "0.2",
        vodCacheDownloadTimeoutSeconds: "1",
        vodCacheFailureCooldownSeconds: "1"
      },
      {}
    );

    expect(resolved.maxCacheBytes).toBe(VOD_CACHE_LIMITS.gb.max * GIB);
    expect(resolved.minFreeBytes).toBe(VOD_CACHE_LIMITS.gb.min * GIB);
    expect(resolved.retentionHours).toBe(VOD_CACHE_LIMITS.retentionHours.max);
    expect(resolved.partialMaxAgeHours).toBe(VOD_CACHE_LIMITS.partialMaxAgeHours.min);
    expect(resolved.downloadTimeoutSeconds).toBe(VOD_CACHE_LIMITS.downloadTimeoutSeconds.min);
    expect(resolved.failureCooldownSeconds).toBe(VOD_CACHE_LIMITS.failureCooldownSeconds.min);
  });

  it("treats a non-numeric managed value as not set, so the env keeps working", () => {
    const resolved = resolveVodCacheTuning(
      { vodCacheMaxGb: "twenty", vodCacheRetentionHours: "soon" },
      { TWITCH_VOD_CACHE_MAX_BYTES: String(7 * GIB), TWITCH_VOD_CACHE_RETENTION_HOURS: "24" }
    );

    expect(resolved.maxCacheBytes).toBe(7 * GIB);
    expect(resolved.retentionHours).toBe(24);
  });

  it("lets a managed '0' limit rate override an env cap back to unlimited", () => {
    const resolved = resolveVodCacheTuning({ vodCacheLimitRate: "0" }, { TWITCH_VOD_CACHE_LIMIT_RATE: "8M" });

    expect(resolved.limitRate).toBe("");
  });

  it("drops a malformed managed limit rate rather than handing it to the downloader", () => {
    const resolved = resolveVodCacheTuning({ vodCacheLimitRate: "8 Mbit" }, { TWITCH_VOD_CACHE_LIMIT_RATE: "8M" });

    expect(resolved.limitRate).toBe("8M");
  });

  it("validates GB fields and the limit-rate notation for the settings surfaces", () => {
    expect(isValidVodCacheGb(1)).toBe(true);
    expect(isValidVodCacheGb(4096)).toBe(true);
    expect(isValidVodCacheGb(0.5)).toBe(false);
    expect(isValidVodCacheGb(4097)).toBe(false);
    expect(isValidVodCacheGb(Number.NaN)).toBe(false);

    expect(isValidVodCacheLimitRate("")).toBe(true);
    expect(isValidVodCacheLimitRate("0")).toBe(true);
    expect(isValidVodCacheLimitRate("8M")).toBe(true);
    expect(isValidVodCacheLimitRate("1.5G")).toBe(true);
    expect(isValidVodCacheLimitRate("500K")).toBe(true);
    expect(isValidVodCacheLimitRate("8 Mbit")).toBe(false);
    expect(isValidVodCacheLimitRate("-1M")).toBe(false);
  });
});
