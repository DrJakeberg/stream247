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
// System volume observation watermark
// ---------------------------------------------------------------------------

// A second, observation-only watermark next to the eviction one. The eviction watermark measures
// the media volume, where the worker can act; this pair measures the worker container's root
// filesystem ("/") as the nearest observable proxy for the OS volume the worker cannot statfs
// directly. Crossing it raises a critical incident and an alert — never an eviction, because
// nothing the worker could delete lives there.

export type ManagedSystemVolumeInput =
  | Partial<{
      systemVolumeTriggerPercent: string;
      systemVolumeRecoverPercent: string;
    }>
  | null
  | undefined;

export type ResolvedSystemVolumeWatermark = {
  /** Fraction of the root volume that must stay free; below this the incident opens. */
  triggerFreeRatio: number;
  /** Fraction at which the incident resolves. Above the trigger on purpose, for hysteresis. */
  recoverFreeRatio: number;
};

const DEFAULT_SYSTEM_TRIGGER_FREE_PERCENT = 10;
const DEFAULT_SYSTEM_RECOVER_FREE_PERCENT = 15;

export function resolveSystemVolumeTriggerPercent(managed: ManagedSystemVolumeInput, env: EnvLike): number {
  return readPercent(
    managed?.systemVolumeTriggerPercent,
    env.STREAM247_SYSTEM_VOLUME_TRIGGER_PERCENT,
    DEFAULT_SYSTEM_TRIGGER_FREE_PERCENT
  );
}

export function resolveSystemVolumeRecoverPercent(managed: ManagedSystemVolumeInput, env: EnvLike): number {
  return readPercent(
    managed?.systemVolumeRecoverPercent,
    env.STREAM247_SYSTEM_VOLUME_RECOVER_PERCENT,
    DEFAULT_SYSTEM_RECOVER_FREE_PERCENT
  );
}

export function resolveSystemVolumeWatermarkConfig(
  managed: ManagedSystemVolumeInput,
  env: EnvLike
): ResolvedSystemVolumeWatermark {
  const triggerPercent = resolveSystemVolumeTriggerPercent(managed, env);
  const recoverPercent = resolveSystemVolumeRecoverPercent(managed, env);

  // Same whole-pair rule as the eviction watermark: recovery at or below the trigger would open
  // and resolve the incident on alternating cycles. A misordered override is rejected whole.
  const ordered = recoverPercent > triggerPercent;
  return {
    triggerFreeRatio: (ordered ? triggerPercent : DEFAULT_SYSTEM_TRIGGER_FREE_PERCENT) / 100,
    recoverFreeRatio: (ordered ? recoverPercent : DEFAULT_SYSTEM_RECOVER_FREE_PERCENT) / 100
  };
}

// ---------------------------------------------------------------------------
// Asset retention sweep
// ---------------------------------------------------------------------------

export type ManagedAssetRetentionInput =
  | Partial<{
      assetRetentionEnabled: string;
      assetRetentionProtectionDays: string;
    }>
  | null
  | undefined;

export type ResolvedAssetRetentionConfig = {
  /** Whether the sweep may delete. Candidates are counted and logged either way. */
  enabled: boolean;
  /** Days an asset must have been observed orphaned before it may be removed. */
  protectionDays: number;
};

const DEFAULT_ASSET_RETENTION_PROTECT_DAYS = 7;

/** Whole days, at least one, at most a year — a window beyond that is a "never" in disguise. */
export function isValidAssetRetentionDays(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= 365;
}

export function resolveAssetRetentionProtectionDays(managed: ManagedAssetRetentionInput, env: EnvLike): number {
  const managedText = text(managed?.assetRetentionProtectionDays);
  if (managedText !== "") {
    const managedDays = Number(managedText);
    if (isValidAssetRetentionDays(managedDays)) {
      return managedDays;
    }
  }

  const envDays = Number(env.STREAM247_ASSET_RETENTION_PROTECT_DAYS);
  return isValidAssetRetentionDays(envDays) ? envDays : DEFAULT_ASSET_RETENTION_PROTECT_DAYS;
}

/**
 * Default OFF, and from env only the literal "1" enables it — deleting library rows must never be
 * something an install starts doing because it upgraded. The managed switch wins once set, in both
 * directions, so the GUI is the observe-first-then-enable path.
 */
export function resolveAssetRetentionConfig(
  managed: ManagedAssetRetentionInput,
  env: EnvLike
): ResolvedAssetRetentionConfig {
  return {
    enabled: readManagedFlag(managed?.assetRetentionEnabled) ?? env.STREAM247_ASSET_RETENTION_ENABLED === "1",
    protectionDays: resolveAssetRetentionProtectionDays(managed, env)
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
      sourceLayerEnabled: string;
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

/**
 * Video-source layer runtime gate (M57). Defaults OFF: the sampler spawns short-lived capture
 * processes inside the playout container, and that must be an explicit operator decision. Same
 * only-"1"-enables env semantics as the chat overlay and alerts gates.
 */
export function resolveSourceLayerRuntimeEnabled(managed: ManagedRuntimeToggleInput, env: EnvLike): boolean {
  return readManagedFlag(managed?.sourceLayerEnabled) ?? env.STREAM247_SOURCE_LAYER_ENABLED === "1";
}

// ---------------------------------------------------------------------------
// Source snapshot cadence
// ---------------------------------------------------------------------------

export type ManagedSourceSnapshotInput = Partial<{ sourceSnapshotIntervalSeconds: string }> | null | undefined;

export const DEFAULT_SOURCE_SNAPSHOT_INTERVAL_SECONDS = 5;
const MIN_SOURCE_SNAPSHOT_INTERVAL_SECONDS = 2;
const MAX_SOURCE_SNAPSHOT_INTERVAL_SECONDS = 300;

/**
 * How often the playout sampler captures a frame from the scene's video source. Managed value
 * first, env fallback, five-second default. Values are clamped rather than rejected: the overlay
 * pipe runs at one frame per second, so sub-two-second sampling only multiplies short-lived
 * capture processes without the picture updating any faster, and a beyond-minutes value is
 * almost certainly a typo that would read as "the feature is broken".
 */
export function resolveSourceSnapshotIntervalSeconds(managed: ManagedSourceSnapshotInput, env: EnvLike): number {
  const clamp = (value: number) =>
    Math.min(MAX_SOURCE_SNAPSHOT_INTERVAL_SECONDS, Math.max(MIN_SOURCE_SNAPSHOT_INTERVAL_SECONDS, Math.round(value)));

  const managedText = text(managed?.sourceSnapshotIntervalSeconds);
  if (managedText !== "") {
    const managedValue = Number(managedText);
    if (Number.isFinite(managedValue) && managedValue > 0) {
      return clamp(managedValue);
    }
  }

  const envValue = Number(text(env.STREAM247_SOURCE_SNAPSHOT_INTERVAL_SECONDS));
  if (Number.isFinite(envValue) && envValue > 0) {
    return clamp(envValue);
  }

  return DEFAULT_SOURCE_SNAPSHOT_INTERVAL_SECONDS;
}

// ---------------------------------------------------------------------------
// Replay (Twitch VOD) cache tuning
// ---------------------------------------------------------------------------

// M56 part 2. The cache path (TWITCH_VOD_CACHE_ROOT) stays env-only on purpose: where a volume is
// mounted is infrastructure, decided at deploy time, and a GUI field for it could point the worker
// at a directory that does not exist on the next host. Everything else about the cache is an
// operating decision and lives here. Byte sizes are managed in whole-or-fractional GB (GiB,
// 1024^3) because nobody reasons about a replay cache in bytes; the resolver converts.

export type ManagedVodCacheInput =
  | Partial<{
      vodCacheEnabled: string;
      vodCacheAllowRemoteFallback: string;
      vodCacheMaxGb: string;
      vodCacheMinFreeGb: string;
      vodCacheMaxAssetGb: string;
      vodCacheRetentionHours: string;
      vodCachePartialMaxAgeHours: string;
      vodCacheDownloadTimeoutSeconds: string;
      vodCacheFailureCooldownSeconds: string;
      vodCacheLimitRate: string;
    }>
  | null
  | undefined;

/**
 * Bounds for the managed values, shared by the settings form, the API route and the resolver.
 * Derivations: a cache below 1 GB cannot hold a single VOD and above 4 TB the setting stops being
 * a cache; retention beyond a year and a partial older than a week are "never" in disguise; a
 * download timeout under 30 s cannot fetch anything real (the awaited path is additionally clamped
 * to the cycle stall budget by the worker — see cycle-budget.ts); a failure cooldown under a
 * minute turns a broken VOD into a hammering retry loop.
 */
export const VOD_CACHE_LIMITS = {
  gb: { min: 1, max: 4096 },
  retentionHours: { min: 1, max: 8760 },
  partialMaxAgeHours: { min: 1, max: 168 },
  downloadTimeoutSeconds: { min: 30, max: 14_400 },
  failureCooldownSeconds: { min: 60, max: 86_400 }
} as const;

export type ResolvedVodCacheTuning = {
  enabled: boolean;
  /** Whether an uncached VOD may be played straight from Twitch instead of waiting for the cache. */
  allowRemoteFallback: boolean;
  maxCacheBytes: number;
  minFreeBytes: number;
  maxAssetBytes: number;
  retentionHours: number;
  partialMaxAgeHours: number;
  downloadTimeoutSeconds: number;
  failureCooldownSeconds: number;
  /** yt-dlp rate notation ("8M"), or "" for unlimited. */
  limitRate: string;
};

const GIB = 1024 * 1024 * 1024;

export function isValidVodCacheGb(value: number): boolean {
  return Number.isFinite(value) && value >= VOD_CACHE_LIMITS.gb.min && value <= VOD_CACHE_LIMITS.gb.max;
}

/** The shapes yt-dlp accepts, plus "" and "0" for unlimited — same rule the worker normaliser uses. */
export function isValidVodCacheLimitRate(value: string): boolean {
  const trimmed = value.trim();
  return trimmed === "" || trimmed === "0" || /^\d+(\.\d+)?[KMG]?$/i.test(trimmed);
}

type Bounds = { min: number; max: number };

/**
 * A managed number wins when parseable, clamped into its bounds — the API refuses to persist an
 * out-of-range value, so the clamp only ever corrects a corrupted store, never surprises an
 * operator. Unparseable managed text reads as "not set". The env path keeps its historical
 * semantics untouched (any positive number, however extreme): an untouched managed value must
 * leave an env-driven install byte-for-byte where it was.
 */
function readManagedBoundedNumber(
  managedValue: string | undefined,
  bounds: Bounds,
  envFallback: () => number
): number {
  const managedText = text(managedValue);
  if (managedText !== "") {
    const parsed = Number(managedText);
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.min(bounds.max, Math.max(bounds.min, parsed));
    }
  }
  return envFallback();
}

function readPositiveEnvNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function resolveVodCacheTuning(managed: ManagedVodCacheInput, env: EnvLike): ResolvedVodCacheTuning {
  const managedLimitRate = text(managed?.vodCacheLimitRate);
  const gbToBytes = (gb: number) => Math.round(gb * GIB);

  return {
    enabled: readManagedFlag(managed?.vodCacheEnabled) ?? env.TWITCH_VOD_CACHE_ENABLED !== "0",
    allowRemoteFallback:
      readManagedFlag(managed?.vodCacheAllowRemoteFallback) ?? env.TWITCH_VOD_CACHE_ALLOW_REMOTE_FALLBACK === "1",
    maxCacheBytes: gbToBytes(
      readManagedBoundedNumber(managed?.vodCacheMaxGb, VOD_CACHE_LIMITS.gb, () =>
        readPositiveEnvNumber(env.TWITCH_VOD_CACHE_MAX_BYTES, 20 * GIB) / GIB
      )
    ),
    minFreeBytes: gbToBytes(
      readManagedBoundedNumber(managed?.vodCacheMinFreeGb, VOD_CACHE_LIMITS.gb, () =>
        readPositiveEnvNumber(env.TWITCH_VOD_CACHE_MIN_FREE_BYTES, 15 * GIB) / GIB
      )
    ),
    maxAssetBytes: gbToBytes(
      readManagedBoundedNumber(managed?.vodCacheMaxAssetGb, VOD_CACHE_LIMITS.gb, () =>
        readPositiveEnvNumber(env.TWITCH_VOD_CACHE_MAX_ASSET_BYTES, 20 * GIB) / GIB
      )
    ),
    retentionHours: readManagedBoundedNumber(managed?.vodCacheRetentionHours, VOD_CACHE_LIMITS.retentionHours, () =>
      readPositiveEnvNumber(env.TWITCH_VOD_CACHE_RETENTION_HOURS, 72)
    ),
    partialMaxAgeHours: readManagedBoundedNumber(
      managed?.vodCachePartialMaxAgeHours,
      VOD_CACHE_LIMITS.partialMaxAgeHours,
      () => readPositiveEnvNumber(env.TWITCH_VOD_CACHE_PARTIAL_MAX_AGE_HOURS, 6)
    ),
    downloadTimeoutSeconds: readManagedBoundedNumber(
      managed?.vodCacheDownloadTimeoutSeconds,
      VOD_CACHE_LIMITS.downloadTimeoutSeconds,
      () => readPositiveEnvNumber(env.TWITCH_VOD_CACHE_DOWNLOAD_TIMEOUT_SECONDS, 120)
    ),
    failureCooldownSeconds: readManagedBoundedNumber(
      managed?.vodCacheFailureCooldownSeconds,
      VOD_CACHE_LIMITS.failureCooldownSeconds,
      () => readPositiveEnvNumber(env.TWITCH_VOD_CACHE_FAILURE_COOLDOWN_SECONDS, 30 * 60)
    ),
    // A managed "0" is an explicit "unlimited", overriding an env cap; malformed notation reads
    // as "not set" so a corrupted value can never make the downloader exit on its arguments. The
    // env fallback goes through the same normalisation the worker has always applied.
    limitRate:
      managedLimitRate !== "" && isValidVodCacheLimitRate(managedLimitRate)
        ? normalizeVodCacheLimitRate(managedLimitRate)
        : normalizeVodCacheLimitRate(env.TWITCH_VOD_CACHE_LIMIT_RATE)
  };
}

/** "" and "0" both mean unlimited; anything not in yt-dlp's notation is dropped, not passed on. */
export function normalizeVodCacheLimitRate(value: string | undefined): string {
  const trimmed = text(value);
  if (!trimmed || trimmed === "0" || !isValidVodCacheLimitRate(trimmed)) {
    return "";
  }
  return trimmed;
}

// ---------------------------------------------------------------------------
// EventSub webhook secret
// ---------------------------------------------------------------------------

export type ManagedEventSubSecretInput = Partial<{ twitchEventsubSecret: string }> | null | undefined;

export function resolveTwitchEventSubSecret(managed: ManagedEventSubSecretInput, env: EnvLike): string {
  return text(managed?.twitchEventsubSecret) || text(env.TWITCH_EVENTSUB_SECRET);
}
