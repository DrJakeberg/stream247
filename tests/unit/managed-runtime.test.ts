import { describe, expect, it } from "vitest";
import {
  isValidAssetRetentionDays,
  isValidDiskWatermarkPercent,
  isValidEncoderBitrate,
  isValidEncoderSpeedPreset,
  isValidManagedFlagText,
  resolveAlertsRuntimeEnabled,
  resolveAssetRetentionConfig,
  resolveAssetRetentionProtectionDays,
  resolveChatOverlayRuntimeEnabled,
  resolveDiskWatermarkConfig,
  resolveDiskWatermarkRecoverPercent,
  resolveDiskWatermarkTriggerPercent,
  resolveEncoderQualitySettings,
  resolveSystemVolumeRecoverPercent,
  resolveSystemVolumeTriggerPercent,
  resolveSystemVolumeWatermarkConfig,
  resolveSourceLiveEnabled,
  isValidSourceLiveGainPercent,
  resolveSourceLiveGainPercent,
  resolveTwitchEventSubSecret,
  resolveTwitchScheduleSyncEnabled
} from "../../packages/core/src/index.js";

// M56: operational decisions move from .env into managed config. One resolver per family,
// shared by web and worker, with one precedence everywhere: a managed value that is set wins,
// otherwise the env variable, otherwise the built-in default. The tests here are the contract
// that an EMPTY managed value never changes what an existing install does — every family pins
// the exact pre-M56 env semantics for the "nothing managed" case.

describe("encoder quality resolution", () => {
  it("uses the built-in defaults when neither managed config nor env is set", () => {
    const resolved = resolveEncoderQualitySettings(null, {});

    expect(resolved.preset).toBe("veryfast");
    expect(resolved.maxrate).toBe("4500k");
    expect(resolved.bufsize).toBe("9000k");
    expect(resolved.audioBitrate).toBe("160k");
    expect(resolved.rateControlConfigured).toBe(false);
  });

  it("keeps the env fallback exactly as before when managed values are empty", () => {
    const resolved = resolveEncoderQualitySettings(
      { ffmpegPreset: "", ffmpegMaxrate: "", ffmpegBufsize: "", ffmpegAudioBitrate: "" },
      { FFMPEG_PRESET: "slow", FFMPEG_MAXRATE: "6000k" }
    );

    expect(resolved.preset).toBe("slow");
    expect(resolved.maxrate).toBe("6000k");
    expect(resolved.bufsize).toBe("9000k");
    expect(resolved.audioBitrate).toBe("160k");
    // Any env rate value marks the trio as operator-configured — that is what suppresses the
    // resolution ladder on the uplink, same as the pre-M56 env check.
    expect(resolved.rateControlConfigured).toBe(true);
  });

  it("lets a managed value win over the env variable", () => {
    const resolved = resolveEncoderQualitySettings(
      { ffmpegPreset: "medium", ffmpegAudioBitrate: "128k" },
      { FFMPEG_PRESET: "ultrafast", FFMPEG_AUDIO_BITRATE: "192k" }
    );

    expect(resolved.preset).toBe("medium");
    expect(resolved.audioBitrate).toBe("128k");
    expect(resolved.rateControlConfigured).toBe(true);
  });

  it("validates presets against the encoder's own list and bitrates by shape", () => {
    expect(isValidEncoderSpeedPreset("")).toBe(true);
    expect(isValidEncoderSpeedPreset("veryfast")).toBe(true);
    expect(isValidEncoderSpeedPreset("warpspeed")).toBe(false);
    expect(isValidEncoderBitrate("")).toBe(true);
    expect(isValidEncoderBitrate("4500k")).toBe(true);
    expect(isValidEncoderBitrate("4.5M")).toBe(true);
    expect(isValidEncoderBitrate("800000")).toBe(true);
    expect(isValidEncoderBitrate("fast")).toBe(false);
    expect(isValidEncoderBitrate("-500k")).toBe(false);
  });
});

describe("disk watermark resolution", () => {
  it("resolves the documented defaults with nothing configured", () => {
    const config = resolveDiskWatermarkConfig(null, {});

    expect(config.enabled).toBe(true);
    expect(config.triggerFreeRatio).toBeCloseTo(0.1);
    expect(config.recoverFreeRatio).toBeCloseTo(0.15);
  });

  it("keeps the env kill switch and env percents when managed values are empty", () => {
    const config = resolveDiskWatermarkConfig(
      { diskWatermarkEnabled: "", diskWatermarkTriggerPercent: "", diskWatermarkRecoverPercent: "" },
      {
        STREAM247_DISK_WATERMARK_ENABLED: "0",
        STREAM247_DISK_WATERMARK_TRIGGER_PERCENT: "5",
        STREAM247_DISK_WATERMARK_RECOVER_PERCENT: "8"
      }
    );

    expect(config.enabled).toBe(false);
    expect(config.triggerFreeRatio).toBeCloseTo(0.05);
    expect(config.recoverFreeRatio).toBeCloseTo(0.08);
  });

  it("lets managed values win over env and rejects a misordered pair whole", () => {
    const managed = { diskWatermarkTriggerPercent: "20", diskWatermarkRecoverPercent: "25" };
    const config = resolveDiskWatermarkConfig(managed, {
      STREAM247_DISK_WATERMARK_TRIGGER_PERCENT: "5",
      STREAM247_DISK_WATERMARK_RECOVER_PERCENT: "8"
    });
    expect(config.triggerFreeRatio).toBeCloseTo(0.2);
    expect(config.recoverFreeRatio).toBeCloseTo(0.25);

    // Same rule as the worker always had: a swapped pair is ignored whole, never half-applied.
    const swapped = resolveDiskWatermarkConfig(
      { diskWatermarkTriggerPercent: "30", diskWatermarkRecoverPercent: "20" },
      {}
    );
    expect(swapped.triggerFreeRatio).toBeCloseTo(0.1);
    expect(swapped.recoverFreeRatio).toBeCloseTo(0.15);
  });

  it("exposes the effective percents so the settings form can validate before saving", () => {
    const env = { STREAM247_DISK_WATERMARK_RECOVER_PERCENT: "40" };
    expect(resolveDiskWatermarkTriggerPercent({ diskWatermarkTriggerPercent: "35" }, env)).toBe(35);
    expect(resolveDiskWatermarkRecoverPercent({ diskWatermarkTriggerPercent: "35" }, env)).toBe(40);
    expect(isValidDiskWatermarkPercent(0)).toBe(false);
    expect(isValidDiskWatermarkPercent(99)).toBe(true);
    expect(isValidDiskWatermarkPercent(100)).toBe(false);
  });
});

describe("managed feature switches", () => {
  it("keeps the exact env semantics when no managed value is set", () => {
    // Chat overlay and alerts only run on env === "1" — "true", "yes" and absence all stay off.
    expect(resolveChatOverlayRuntimeEnabled(null, {})).toBe(false);
    expect(resolveChatOverlayRuntimeEnabled({}, { STREAM_CHAT_OVERLAY_ENABLED: "true" })).toBe(false);
    expect(resolveChatOverlayRuntimeEnabled({ streamChatOverlayEnabled: "" }, { STREAM_CHAT_OVERLAY_ENABLED: "1" })).toBe(true);
    expect(resolveAlertsRuntimeEnabled({ streamAlertsEnabled: "" }, {})).toBe(false);
    expect(resolveAlertsRuntimeEnabled(null, { STREAM_ALERTS_ENABLED: "1" })).toBe(true);
    // Schedule sync defaults ON and only "0" turns it off — including via env fallback.
    expect(resolveTwitchScheduleSyncEnabled(null, {})).toBe(true);
    expect(resolveTwitchScheduleSyncEnabled({ twitchScheduleSyncEnabled: "" }, { TWITCH_SCHEDULE_SYNC_ENABLED: "0" })).toBe(false);
  });

  it("lets a managed value override the env in both directions", () => {
    expect(resolveChatOverlayRuntimeEnabled({ streamChatOverlayEnabled: "1" }, {})).toBe(true);
    expect(resolveChatOverlayRuntimeEnabled({ streamChatOverlayEnabled: "0" }, { STREAM_CHAT_OVERLAY_ENABLED: "1" })).toBe(false);
    expect(resolveAlertsRuntimeEnabled({ streamAlertsEnabled: "1" }, {})).toBe(true);
    expect(resolveTwitchScheduleSyncEnabled({ twitchScheduleSyncEnabled: "0" }, {})).toBe(false);
    expect(resolveTwitchScheduleSyncEnabled({ twitchScheduleSyncEnabled: "1" }, { TWITCH_SCHEDULE_SYNC_ENABLED: "0" })).toBe(true);
  });

  it("only accepts the three states a switch can be stored as", () => {
    expect(isValidManagedFlagText("")).toBe(true);
    expect(isValidManagedFlagText("0")).toBe(true);
    expect(isValidManagedFlagText("1")).toBe(true);
    expect(isValidManagedFlagText("yes")).toBe(false);
  });
});

describe("EventSub secret resolution", () => {
  it("prefers the managed secret and falls back to env, trimmed", () => {
    expect(resolveTwitchEventSubSecret({ twitchEventsubSecret: " managed " }, { TWITCH_EVENTSUB_SECRET: "env" })).toBe("managed");
    expect(resolveTwitchEventSubSecret({ twitchEventsubSecret: "" }, { TWITCH_EVENTSUB_SECRET: " env " })).toBe("env");
    expect(resolveTwitchEventSubSecret(null, {})).toBe("");
  });
});

// The system-volume observation watermark (worker-root free space as the OS-volume proxy) follows
// the exact resolution shape of the eviction watermark: managed wins, env falls back, and a pair
// whose recovery does not sit above its trigger is rejected whole rather than half-applied.
describe("system volume watermark resolution", () => {
  it("uses the built-in defaults when neither managed config nor env is set", () => {
    const resolved = resolveSystemVolumeWatermarkConfig(null, {});

    expect(resolved.triggerFreeRatio).toBeCloseTo(0.1);
    expect(resolved.recoverFreeRatio).toBeCloseTo(0.15);
  });

  it("follows the env variables when the managed values are empty", () => {
    expect(
      resolveSystemVolumeTriggerPercent({ systemVolumeTriggerPercent: "" }, { STREAM247_SYSTEM_VOLUME_TRIGGER_PERCENT: "5" })
    ).toBe(5);
    expect(
      resolveSystemVolumeRecoverPercent({ systemVolumeRecoverPercent: "" }, { STREAM247_SYSTEM_VOLUME_RECOVER_PERCENT: "8" })
    ).toBe(8);
  });

  it("lets a managed value win over the env variable", () => {
    const resolved = resolveSystemVolumeWatermarkConfig(
      { systemVolumeTriggerPercent: "20", systemVolumeRecoverPercent: "30" },
      { STREAM247_SYSTEM_VOLUME_TRIGGER_PERCENT: "5", STREAM247_SYSTEM_VOLUME_RECOVER_PERCENT: "8" }
    );

    expect(resolved.triggerFreeRatio).toBeCloseTo(0.2);
    expect(resolved.recoverFreeRatio).toBeCloseTo(0.3);
  });

  it("rejects a misordered pair whole and falls back to the defaults", () => {
    const resolved = resolveSystemVolumeWatermarkConfig(
      { systemVolumeTriggerPercent: "30", systemVolumeRecoverPercent: "20" },
      {}
    );

    expect(resolved.triggerFreeRatio).toBeCloseTo(0.1);
    expect(resolved.recoverFreeRatio).toBeCloseTo(0.15);
  });
});

// The asset-retention sweep ships default OFF: an untouched install must never start deleting
// library rows because it upgraded. Only the literal "1" enables it from env — the same
// deliberately narrow semantics the engagement runtime gates use — and the managed switch wins
// over env in both directions once it is set.
describe("asset retention resolution", () => {
  it("is disabled by default with a 7-day protection window", () => {
    const resolved = resolveAssetRetentionConfig(null, {});

    expect(resolved.enabled).toBe(false);
    expect(resolved.protectionDays).toBe(7);
  });

  it("only the literal env value 1 enables the sweep", () => {
    expect(resolveAssetRetentionConfig(null, { STREAM247_ASSET_RETENTION_ENABLED: "1" }).enabled).toBe(true);
    expect(resolveAssetRetentionConfig(null, { STREAM247_ASSET_RETENTION_ENABLED: "true" }).enabled).toBe(false);
    expect(resolveAssetRetentionConfig(null, { STREAM247_ASSET_RETENTION_ENABLED: "0" }).enabled).toBe(false);
  });

  it("lets the managed switch win over env in both directions", () => {
    expect(
      resolveAssetRetentionConfig({ assetRetentionEnabled: "0" }, { STREAM247_ASSET_RETENTION_ENABLED: "1" }).enabled
    ).toBe(false);
    expect(resolveAssetRetentionConfig({ assetRetentionEnabled: "1" }, {}).enabled).toBe(true);
    // A corrupted managed value degrades to the env behaviour instead of silently toggling.
    expect(
      resolveAssetRetentionConfig({ assetRetentionEnabled: "yes" }, { STREAM247_ASSET_RETENTION_ENABLED: "1" }).enabled
    ).toBe(true);
  });

  it("resolves the protection window managed-first with env fallback", () => {
    expect(
      resolveAssetRetentionProtectionDays({ assetRetentionProtectionDays: "14" }, { STREAM247_ASSET_RETENTION_PROTECT_DAYS: "3" })
    ).toBe(14);
    expect(
      resolveAssetRetentionProtectionDays({ assetRetentionProtectionDays: "" }, { STREAM247_ASSET_RETENTION_PROTECT_DAYS: "3" })
    ).toBe(3);
    // Invalid values never shorten the window: they fall through to the next layer.
    expect(
      resolveAssetRetentionProtectionDays({ assetRetentionProtectionDays: "0" }, { STREAM247_ASSET_RETENTION_PROTECT_DAYS: "junk" })
    ).toBe(7);
  });

  it("validates the day window as a whole number of days with a sane ceiling", () => {
    expect(isValidAssetRetentionDays(1)).toBe(true);
    expect(isValidAssetRetentionDays(365)).toBe(true);
    expect(isValidAssetRetentionDays(0)).toBe(false);
    expect(isValidAssetRetentionDays(2.5)).toBe(false);
    expect(isValidAssetRetentionDays(366)).toBe(false);
    expect(isValidAssetRetentionDays(Number.NaN)).toBe(false);
  });
});

// M57 stage 2: whether the playout may treat a pushed source as a live input at all, and how
// loud that input starts. Stage B only computes and logs the decision, but the gates are built
// (and pinned) now so stage C changes behaviour without changing configuration.
describe("source live resolution", () => {
  it('defaults off and keeps the only-"1"-enables env semantics', () => {
    expect(resolveSourceLiveEnabled(null, {})).toBe(false);
    expect(resolveSourceLiveEnabled({}, { STREAM247_SOURCE_LIVE_ENABLED: "true" })).toBe(false);
    expect(resolveSourceLiveEnabled({ sourceLiveEnabled: "" }, { STREAM247_SOURCE_LIVE_ENABLED: "1" })).toBe(true);
  });

  it("lets the managed switch override the env in both directions", () => {
    expect(resolveSourceLiveEnabled({ sourceLiveEnabled: "1" }, {})).toBe(true);
    expect(resolveSourceLiveEnabled({ sourceLiveEnabled: "0" }, { STREAM247_SOURCE_LIVE_ENABLED: "1" })).toBe(false);
  });

  it("clamps the gain into 0..200 with the managed value first and 40 as the default", () => {
    expect(resolveSourceLiveGainPercent(null, {})).toBe(40);
    expect(resolveSourceLiveGainPercent({ sourceLiveGainPercent: "80" }, { STREAM247_SOURCE_LIVE_GAIN_PERCENT: "10" })).toBe(80);
    expect(resolveSourceLiveGainPercent({ sourceLiveGainPercent: "" }, { STREAM247_SOURCE_LIVE_GAIN_PERCENT: "10" })).toBe(10);
    // Zero is a real setting (attach muted), not an unset value.
    expect(resolveSourceLiveGainPercent({ sourceLiveGainPercent: "0" }, { STREAM247_SOURCE_LIVE_GAIN_PERCENT: "90" })).toBe(0);
    expect(resolveSourceLiveGainPercent({ sourceLiveGainPercent: "1000" }, {})).toBe(200);
    expect(resolveSourceLiveGainPercent({ sourceLiveGainPercent: "-5" }, {})).toBe(0);
    expect(resolveSourceLiveGainPercent({ sourceLiveGainPercent: "97.6" }, {})).toBe(98);
    // Garbage degrades to the next fallback, never to NaN.
    expect(resolveSourceLiveGainPercent({ sourceLiveGainPercent: "loud" }, { STREAM247_SOURCE_LIVE_GAIN_PERCENT: "30" })).toBe(30);
    expect(resolveSourceLiveGainPercent({ sourceLiveGainPercent: "loud" }, { STREAM247_SOURCE_LIVE_GAIN_PERCENT: "quiet" })).toBe(40);
  });

  it("tells a form which gains are worth accepting at all", () => {
    // The resolver clamps, because a stored opinion about loudness should never break playout. A
    // form is the opposite case: a typed 500 is a mistake the operator should see, not a silent 200.
    expect(isValidSourceLiveGainPercent(0)).toBe(true);
    expect(isValidSourceLiveGainPercent(40)).toBe(true);
    expect(isValidSourceLiveGainPercent(200)).toBe(true);
    expect(isValidSourceLiveGainPercent(201)).toBe(false);
    expect(isValidSourceLiveGainPercent(-1)).toBe(false);
    expect(isValidSourceLiveGainPercent(40.5)).toBe(false);
    expect(isValidSourceLiveGainPercent(Number.NaN)).toBe(false);
  });
});
