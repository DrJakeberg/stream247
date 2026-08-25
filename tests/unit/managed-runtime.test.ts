import { describe, expect, it } from "vitest";
import {
  isValidDiskWatermarkPercent,
  isValidEncoderBitrate,
  isValidEncoderSpeedPreset,
  isValidManagedFlagText,
  resolveAlertsRuntimeEnabled,
  resolveChatOverlayRuntimeEnabled,
  resolveDiskWatermarkConfig,
  resolveDiskWatermarkRecoverPercent,
  resolveDiskWatermarkTriggerPercent,
  resolveEncoderQualitySettings,
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
