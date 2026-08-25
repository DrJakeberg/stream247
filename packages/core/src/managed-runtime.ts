// Managed operational settings (M56): encoder quality, the disk watermark, the runtime feature
// switches and the EventSub webhook secret used to be env-only. They now also live in managed
// config, written from the settings surfaces, and every reader — web and worker — goes through
// the resolvers in this module so the two sides can never drift apart.
//
// Precedence is managed first: a managed value that is set wins, otherwise the env variable,
// otherwise the built-in default. That is the Twitch-credential order ("settings page beats
// stale env"), not the M52 instance order — an operator who opens the GUI and changes a value
// expects that value to be in effect, while an untouched (empty) managed value must leave an
// existing env-driven install behaving exactly as before. The tests pin that second half down
// per family, including the historical quirk that the engagement runtime gates only accept the
// literal "1".

type EnvLike = Record<string, string | undefined>;

const text = (value: string | undefined): string => (value ?? "").trim();

/**
 * Managed switches are stored as "" (not set — follow env), "1" (on) or "0" (off). Anything
 * else reads as "not set" so a corrupted value degrades to the pre-M56 behaviour instead of
 * silently toggling a feature.
 */
function readManagedFlag(value: string | undefined): boolean | null {
  const flag = text(value);
  if (flag === "1") {
    return true;
  }
  if (flag === "0") {
    return false;
  }
  return null;
}

export function isValidManagedFlagText(value: string): boolean {
  return value === "" || value === "0" || value === "1";
}

// ---------------------------------------------------------------------------
// Encoder quality
// ---------------------------------------------------------------------------

export type ManagedEncoderQualityInput =
  | Partial<{
      ffmpegPreset: string;
      ffmpegMaxrate: string;
      ffmpegBufsize: string;
      ffmpegAudioBitrate: string;
    }>
  | null
  | undefined;

/** The x264 speed presets, ordered fastest to slowest. */
export const ENCODER_SPEED_PRESETS = [
  "ultrafast",
  "superfast",
  "veryfast",
  "faster",
  "fast",
  "medium",
  "slow",
  "slower",
  "veryslow"
] as const;

export type ResolvedEncoderQualitySettings = {
  preset: string;
  maxrate: string;
  bufsize: string;
  audioBitrate: string;
  /**
   * True when any rate-control value was configured (managed or env) rather than defaulted.
   * The uplink uses this exactly like the old "any FFMPEG_* rate env set" check: an explicit
   * trio suppresses the resolution-based rate ladder.
   */
  rateControlConfigured: boolean;
};

export function resolveEncoderQualitySettings(
  managed: ManagedEncoderQualityInput,
  env: EnvLike
): ResolvedEncoderQualitySettings {
  const maxrate = text(managed?.ffmpegMaxrate) || text(env.FFMPEG_MAXRATE);
  const bufsize = text(managed?.ffmpegBufsize) || text(env.FFMPEG_BUFSIZE);
  const audioBitrate = text(managed?.ffmpegAudioBitrate) || text(env.FFMPEG_AUDIO_BITRATE);

  return {
    preset: text(managed?.ffmpegPreset) || text(env.FFMPEG_PRESET) || "veryfast",
    maxrate: maxrate || "4500k",
    bufsize: bufsize || "9000k",
    audioBitrate: audioBitrate || "160k",
    rateControlConfigured: Boolean(maxrate || bufsize || audioBitrate)
  };
}

/** Empty means "not managed — follow env or default", so it is always acceptable. */
export function isValidEncoderSpeedPreset(value: string): boolean {
  return value === "" || (ENCODER_SPEED_PRESETS as readonly string[]).includes(value);
}

/** The bitrate shapes ffmpeg accepts: a plain number of bits, or a k/M-suffixed value. */
export function isValidEncoderBitrate(value: string): boolean {
  return value === "" || /^\d+(\.\d+)?[kKmM]?$/.test(value);
}

// ---------------------------------------------------------------------------
// Disk watermark
// ---------------------------------------------------------------------------

export type ManagedDiskWatermarkInput =
  | Partial<{
      diskWatermarkEnabled: string;
      diskWatermarkTriggerPercent: string;
      diskWatermarkRecoverPercent: string;
    }>
  | null
  | undefined;

export type ResolvedDiskWatermarkConfig = {
  enabled: boolean;
  /** Fraction of the volume that must stay free; below this an eviction episode starts. */
  triggerFreeRatio: number;
  /** Fraction of the volume at which an episode stops evicting. Above the trigger on purpose. */
  recoverFreeRatio: number;
};

const DEFAULT_TRIGGER_FREE_PERCENT = 10;
const DEFAULT_RECOVER_FREE_PERCENT = 15;

export function isValidDiskWatermarkPercent(value: number): boolean {
  return Number.isFinite(value) && value > 0 && value < 100;
}

function readPercent(managedValue: string | undefined, envValue: string | undefined, fallback: number): number {
  const managedText = text(managedValue);
  if (managedText !== "") {
    const managedPercent = Number(managedText);
    if (isValidDiskWatermarkPercent(managedPercent)) {
      return managedPercent;
    }
  }

  const envPercent = Number(envValue);
  return isValidDiskWatermarkPercent(envPercent) ? envPercent : fallback;
}

/** The effective trigger percent, before the pair ordering check. The settings form uses these
 * two to validate a partially filled pair against what the blank half would resolve to. */
export function resolveDiskWatermarkTriggerPercent(managed: ManagedDiskWatermarkInput, env: EnvLike): number {
  return readPercent(managed?.diskWatermarkTriggerPercent, env.STREAM247_DISK_WATERMARK_TRIGGER_PERCENT, DEFAULT_TRIGGER_FREE_PERCENT);
}

export function resolveDiskWatermarkRecoverPercent(managed: ManagedDiskWatermarkInput, env: EnvLike): number {
  return readPercent(managed?.diskWatermarkRecoverPercent, env.STREAM247_DISK_WATERMARK_RECOVER_PERCENT, DEFAULT_RECOVER_FREE_PERCENT);
}

export function resolveDiskWatermarkConfig(managed: ManagedDiskWatermarkInput, env: EnvLike): ResolvedDiskWatermarkConfig {
  const triggerPercent = resolveDiskWatermarkTriggerPercent(managed, env);
  const recoverPercent = resolveDiskWatermarkRecoverPercent(managed, env);

  // The recovery watermark only means something above the trigger: with the pair equal or
  // inverted, every episode would end the moment it started and the monitor would do nothing
  // while looking configured. A misordered override is ignored whole rather than half-applied,
  // because "my numbers are in effect but swapped" is far harder to diagnose than "my numbers
  // were rejected". The settings form refuses to persist such a pair in the first place.
  const ordered = recoverPercent > triggerPercent;
  return {
    enabled: readManagedFlag(managed?.diskWatermarkEnabled) ?? env.STREAM247_DISK_WATERMARK_ENABLED !== "0",
    triggerFreeRatio: (ordered ? triggerPercent : DEFAULT_TRIGGER_FREE_PERCENT) / 100,
    recoverFreeRatio: (ordered ? recoverPercent : DEFAULT_RECOVER_FREE_PERCENT) / 100
  };
}

// ---------------------------------------------------------------------------
// Runtime feature switches
// ---------------------------------------------------------------------------

export type ManagedRuntimeToggleInput =
  | Partial<{
      streamChatOverlayEnabled: string;
      streamAlertsEnabled: string;
      twitchScheduleSyncEnabled: string;
    }>
  | null
  | undefined;

/** Chat overlay runtime gate. Historical env semantics: only the literal "1" enables it. */
export function resolveChatOverlayRuntimeEnabled(managed: ManagedRuntimeToggleInput, env: EnvLike): boolean {
  return readManagedFlag(managed?.streamChatOverlayEnabled) ?? env.STREAM_CHAT_OVERLAY_ENABLED === "1";
}

/** Alerts runtime gate. Same "1"-only env semantics as the chat overlay. */
export function resolveAlertsRuntimeEnabled(managed: ManagedRuntimeToggleInput, env: EnvLike): boolean {
  return readManagedFlag(managed?.streamAlertsEnabled) ?? env.STREAM_ALERTS_ENABLED === "1";
}

/** Twitch schedule sync defaults ON; historically only the literal "0" turned it off. */
export function resolveTwitchScheduleSyncEnabled(managed: ManagedRuntimeToggleInput, env: EnvLike): boolean {
  return readManagedFlag(managed?.twitchScheduleSyncEnabled) ?? (env.TWITCH_SCHEDULE_SYNC_ENABLED || "1") !== "0";
}

// ---------------------------------------------------------------------------
// EventSub webhook secret
// ---------------------------------------------------------------------------

export type ManagedEventSubSecretInput = Partial<{ twitchEventsubSecret: string }> | null | undefined;

export function resolveTwitchEventSubSecret(managed: ManagedEventSubSecretInput, env: EnvLike): string {
  return text(managed?.twitchEventsubSecret) || text(env.TWITCH_EVENTSUB_SECRET);
}
