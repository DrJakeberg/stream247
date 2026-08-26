import { describe, expect, it } from "vitest";
import {
  isValidVodCacheGb,
  isValidVodCacheLimitRate,
  FEED_TUNING_LIMITS,
  resolveDurationBoundMarginSeconds,
  resolveFeedAudioWatchdogMs,
  resolvePlayoutFeedWatchdogMs,
  resolvePlayoutReconnectTuning,
  resolveProgramFeedTuning,
  resolveUplinkWatchdogMs,
  resolveVodCacheTuning,
  VOD_CACHE_LIMITS,
  WATCHDOG_LIMITS
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

// The watchdog thresholds decide when a live channel restarts its own processes. The clamps are
// not taste: each lower bound is the smallest value that cannot mistake healthy cadence for a
// fault, each upper bound is the point past which the watchdog is "off in disguise". GUI fields
// are seconds; the modules keep operating in milliseconds.

describe("watchdog threshold resolution", () => {
  it("resolves the built-in defaults when nothing is set anywhere", () => {
    expect(resolveFeedAudioWatchdogMs(null, {})).toEqual({ silenceMs: 90_000, graceMs: 60_000 });
    expect(resolvePlayoutFeedWatchdogMs(null, {})).toEqual({ staleMs: 45_000, graceMs: 90_000 });
    expect(resolveUplinkWatchdogMs(null, {})).toEqual({
      stallMs: 45_000,
      graceMs: 60_000,
      noProgressRestartMs: 300_000
    });
    expect(resolveDurationBoundMarginSeconds(null, {})).toBe(15);
  });

  it("keeps the historical env-ms semantics untouched when managed values are empty", () => {
    expect(
      resolveFeedAudioWatchdogMs(
        { feedAudioSilenceSeconds: "" },
        { PLAYOUT_FEED_SILENCE_MS: "120000", PLAYOUT_FEED_GRACE_MS: "30000" }
      )
    ).toEqual({ silenceMs: 120_000, graceMs: 30_000 });
    expect(
      resolvePlayoutFeedWatchdogMs(null, {
        PLAYOUT_FEED_STALE_TIMEOUT_MS: "60000",
        PLAYOUT_FEED_STALE_GRACE_MS: "120000"
      })
    ).toEqual({ staleMs: 60_000, graceMs: 120_000 });
    expect(
      resolveUplinkWatchdogMs(null, {
        UPLINK_STALL_TIMEOUT_MS: "30000",
        UPLINK_STALL_GRACE_MS: "90000",
        UPLINK_NO_PROGRESS_RESTART_MS: "600000"
      })
    ).toEqual({ stallMs: 30_000, graceMs: 90_000, noProgressRestartMs: 600_000 });
    expect(
      resolveDurationBoundMarginSeconds(null, { PLAYOUT_DURATION_BOUND_MARGIN_SECONDS: "30" })
    ).toBe(30);
    // Env keeps its old "positive or default" rule, including values the managed path would clamp.
    expect(resolveFeedAudioWatchdogMs(null, { PLAYOUT_FEED_SILENCE_MS: "0" }).silenceMs).toBe(90_000);
    expect(resolveFeedAudioWatchdogMs(null, { PLAYOUT_FEED_SILENCE_MS: "1000" }).silenceMs).toBe(1_000);
  });

  it("lets managed seconds win over env milliseconds", () => {
    expect(
      resolveFeedAudioWatchdogMs(
        { feedAudioSilenceSeconds: "120", feedAudioGraceSeconds: "0" },
        { PLAYOUT_FEED_SILENCE_MS: "30000", PLAYOUT_FEED_GRACE_MS: "30000" }
      )
    ).toEqual({ silenceMs: 120_000, graceMs: 0 });
    expect(
      resolvePlayoutFeedWatchdogMs(
        { feedStallTimeoutSeconds: "60", feedStallGraceSeconds: "45" },
        { PLAYOUT_FEED_STALE_TIMEOUT_MS: "30000" }
      )
    ).toEqual({ staleMs: 60_000, graceMs: 45_000 });
    expect(
      resolveUplinkWatchdogMs(
        {
          uplinkStallTimeoutSeconds: "90",
          uplinkStallGraceSeconds: "30",
          uplinkNoProgressRestartSeconds: "120"
        },
        {}
      )
    ).toEqual({ stallMs: 90_000, graceMs: 30_000, noProgressRestartMs: 120_000 });
    expect(resolveDurationBoundMarginSeconds({ durationBoundMarginSeconds: "45" }, {})).toBe(45);
  });

  it("clamps every managed threshold into its documented bounds", () => {
    // A stall/silence timeout below the longest feed segment reads ordinary cadence as a fault
    // and restarts a healthy channel forever — the lower clamps make that unconfigurable.
    expect(resolveFeedAudioWatchdogMs({ feedAudioSilenceSeconds: "1" }, {}).silenceMs).toBe(
      WATCHDOG_LIMITS.feedAudioSilenceSeconds.min * 1000
    );
    expect(resolvePlayoutFeedWatchdogMs({ feedStallTimeoutSeconds: "1" }, {}).staleMs).toBe(
      WATCHDOG_LIMITS.feedStallTimeoutSeconds.min * 1000
    );
    // A fresh playout needs startup plus its first segment before the old playlist timestamp can
    // be held against it; grace below that restarts a healthy fresh process in a loop.
    expect(resolvePlayoutFeedWatchdogMs({ feedStallGraceSeconds: "1" }, {}).graceMs).toBe(
      WATCHDOG_LIMITS.feedStallGraceSeconds.min * 1000
    );
    expect(resolveUplinkWatchdogMs({ uplinkStallTimeoutSeconds: "1" }, {}).stallMs).toBe(
      WATCHDOG_LIMITS.uplinkStallTimeoutSeconds.min * 1000
    );
    // Below a minute "never encoded a frame" is indistinguishable from a slow RTMP connect.
    expect(resolveUplinkWatchdogMs({ uplinkNoProgressRestartSeconds: "5" }, {}).noProgressRestartMs).toBe(
      WATCHDOG_LIMITS.uplinkNoProgressRestartSeconds.min * 1000
    );
    // Margin 5..120: below risks cutting real content on rebuffer skew, above it the watchdog
    // cascade fires first and the deliberate stop never happens.
    expect(resolveDurationBoundMarginSeconds({ durationBoundMarginSeconds: "1" }, {})).toBe(5);
    expect(resolveDurationBoundMarginSeconds({ durationBoundMarginSeconds: "999" }, {})).toBe(120);
    // Upper bounds: an hour-plus threshold is the watchdog switched off while looking configured.
    expect(resolveFeedAudioWatchdogMs({ feedAudioSilenceSeconds: "99999" }, {}).silenceMs).toBe(
      WATCHDOG_LIMITS.feedAudioSilenceSeconds.max * 1000
    );
    expect(resolveUplinkWatchdogMs({ uplinkNoProgressRestartSeconds: "99999" }, {}).noProgressRestartMs).toBe(
      WATCHDOG_LIMITS.uplinkNoProgressRestartSeconds.max * 1000
    );
  });

  it("allows zero grace only where a first-observation gate already protects startup", () => {
    // Feed-audio and uplink stall verdicts require having seen audio/progress once, so zero grace
    // cannot restart a fresh process; the playout feed-stall check has no such gate and keeps a
    // hard lower bound instead.
    expect(WATCHDOG_LIMITS.feedAudioGraceSeconds.min).toBe(0);
    expect(WATCHDOG_LIMITS.uplinkStallGraceSeconds.min).toBe(0);
    expect(WATCHDOG_LIMITS.feedStallGraceSeconds.min).toBeGreaterThanOrEqual(30);
    expect(resolveFeedAudioWatchdogMs({ feedAudioGraceSeconds: "0" }, {}).graceMs).toBe(0);
    expect(resolveUplinkWatchdogMs({ uplinkStallGraceSeconds: "0" }, {}).graceMs).toBe(0);
  });
});

// Feed tuning: the planned encoder reconnect cadence and the program feed's segment geometry.
// The relay topology itself (STREAM247_RELAY_ENABLED, relay URLs, the uplink input mode) is
// deliberately NOT managed — it describes how the containers are wired at deploy time, and a GUI
// field for it could describe a topology the running compose file does not have.

describe("feed tuning resolution", () => {
  it("resolves the built-in defaults when nothing is set anywhere", () => {
    expect(resolvePlayoutReconnectTuning(null, {})).toEqual({ intervalHours: 48, windowSeconds: 20 });
    expect(resolveProgramFeedTuning(null, {})).toEqual({ targetSeconds: 2, listSize: 30, failoverSeconds: 10 });
  });

  it("keeps the env fallback exactly as before when managed values are empty", () => {
    expect(
      resolvePlayoutReconnectTuning({ playoutReconnectHours: "" }, { PLAYOUT_RECONNECT_HOURS: "12", PLAYOUT_RECONNECT_SECONDS: "45" })
    ).toEqual({ intervalHours: 12, windowSeconds: 45 });
    expect(
      resolveProgramFeedTuning(null, {
        STREAM247_PROGRAM_FEED_TARGET_SECONDS: "4",
        STREAM247_PROGRAM_FEED_LIST_SIZE: "60",
        STREAM247_PROGRAM_FEED_FAILOVER_SECONDS: "20"
      })
    ).toEqual({ targetSeconds: 4, listSize: 60, failoverSeconds: 20 });
    // The historical env floors survive: fractional values floor, sub-minimum values are raised.
    expect(resolveProgramFeedTuning(null, { STREAM247_PROGRAM_FEED_LIST_SIZE: "2" }).listSize).toBe(3);
    expect(resolveProgramFeedTuning(null, { STREAM247_PROGRAM_FEED_TARGET_SECONDS: "2.9" }).targetSeconds).toBe(2);
  });

  it("lets managed values win and clamps them into their bounds", () => {
    expect(
      resolvePlayoutReconnectTuning(
        { playoutReconnectHours: "24", playoutReconnectWindowSeconds: "30" },
        { PLAYOUT_RECONNECT_HOURS: "12" }
      )
    ).toEqual({ intervalHours: 24, windowSeconds: 30 });
    expect(
      resolveProgramFeedTuning(
        { programFeedTargetSeconds: "4", programFeedListSize: "15", programFeedFailoverSeconds: "5" },
        { STREAM247_PROGRAM_FEED_TARGET_SECONDS: "2" }
      )
    ).toEqual({ targetSeconds: 4, listSize: 15, failoverSeconds: 5 });

    // Sub-hourly planned reconnects are viewer-visible interruptions on a timer.
    expect(resolvePlayoutReconnectTuning({ playoutReconnectHours: "0.1" }, {}).intervalHours).toBe(
      FEED_TUNING_LIMITS.playoutReconnectHours.min
    );
    // Segments above ten seconds would collide with the feed-stall watchdog's lower bound.
    expect(resolveProgramFeedTuning({ programFeedTargetSeconds: "60" }, {}).targetSeconds).toBe(
      FEED_TUNING_LIMITS.programFeedTargetSeconds.max
    );
    // The muxer needs a minimum sliding window to hand the uplink a readable playlist.
    expect(resolveProgramFeedTuning({ programFeedListSize: "1" }, {}).listSize).toBe(
      FEED_TUNING_LIMITS.programFeedListSize.min
    );
  });

  it("guarantees the feed-stall watchdog can never sit below the longest segment", () => {
    // The invariant that ties the two families together: even with both knobs at their worst
    // managed extremes, a healthy feed that advances once per segment cannot be read as stalled.
    expect(WATCHDOG_LIMITS.feedStallTimeoutSeconds.min).toBeGreaterThan(
      FEED_TUNING_LIMITS.programFeedTargetSeconds.max
    );
    expect(WATCHDOG_LIMITS.feedAudioSilenceSeconds.min).toBeGreaterThan(
      FEED_TUNING_LIMITS.programFeedTargetSeconds.max
    );

    const worstFeed = resolveProgramFeedTuning({ programFeedTargetSeconds: "999" }, {});
    const worstWatchdog = resolvePlayoutFeedWatchdogMs({ feedStallTimeoutSeconds: "1" }, {});
    expect(worstWatchdog.staleMs).toBeGreaterThan(worstFeed.targetSeconds * 1000);
  });
});
