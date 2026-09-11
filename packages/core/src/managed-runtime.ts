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
// Source live attach (M57 stage 2)
// ---------------------------------------------------------------------------

export type ManagedSourceLiveInput =
  | Partial<{ sourceLiveEnabled: string; sourceLiveGainPercent: string }>
  | null
  | undefined;

/**
 * Whether a pushed video source may become a LIVE input of the playout (sound and full motion),
 * rather than the stage-1 snapshot panel. Defaults OFF, separately from the source layer gate:
 * drawing a slow-refresh picture and attaching a third live input to the encode are different
 * risks, and each needs its own explicit decision. Same only-"1"-enables env semantics as the
 * other runtime gates.
 */
export function resolveSourceLiveEnabled(managed: ManagedSourceLiveInput, env: EnvLike): boolean {
  return readManagedFlag(managed?.sourceLiveEnabled) ?? env.STREAM247_SOURCE_LIVE_ENABLED === "1";
}

export const DEFAULT_SOURCE_LIVE_GAIN_PERCENT = 40;
export const SOURCE_LIVE_GAIN_LIMITS = { min: 0, max: 200 } as const;

/**
 * How loud a live-attached source starts, as percent of the programme's level. 0 is a real
 * setting (attach muted) and 200 doubles a quiet feed; the default of 40 keeps an untamed
 * camera under the programme instead of over it. Managed first, env fallback, clamped rather
 * than rejected — an out-of-range number is an opinion about loudness, not a broken config.
 */
/**
 * What a settings form may accept. The resolver clamps, deliberately — a stored opinion about
 * loudness must never break playout — but a typed 500 is a mistake worth showing the operator
 * rather than silently turning into 200.
 */
export function isValidSourceLiveGainPercent(value: number): boolean {
  return (
    Number.isInteger(value) && value >= SOURCE_LIVE_GAIN_LIMITS.min && value <= SOURCE_LIVE_GAIN_LIMITS.max
  );
}

export function resolveSourceLiveGainPercent(managed: ManagedSourceLiveInput, env: EnvLike): number {
  const clamp = (value: number) =>
    Math.min(SOURCE_LIVE_GAIN_LIMITS.max, Math.max(SOURCE_LIVE_GAIN_LIMITS.min, Math.round(value)));

  const managedValue = Number(text(managed?.sourceLiveGainPercent) || "x");
  if (text(managed?.sourceLiveGainPercent) !== "" && Number.isFinite(managedValue)) {
    return clamp(managedValue);
  }

  const envValue = Number(text(env.STREAM247_SOURCE_LIVE_GAIN_PERCENT) || "x");
  if (Number.isFinite(envValue)) {
    return clamp(envValue);
  }

  return DEFAULT_SOURCE_LIVE_GAIN_PERCENT;
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
// Watchdog thresholds
// ---------------------------------------------------------------------------

// M56 part 2. These numbers decide when a live channel restarts its own processes, so a wrong
// value does not merely misconfigure a feature — it can destabilise the channel (a stall timeout
// below the segment length restarts a healthy playout forever). Managed values are therefore
// clamped into the bounds each module's own invariants dictate; the settings API refuses to
// persist anything outside them, so the clamp is a corruption net, not a silent correction of
// operator input. The env path keeps its historical any-positive-ms semantics untouched.
//
// STREAM247_LOOP_STALL_TIMEOUT_SECONDS is deliberately NOT part of this family: it is the
// process's own self-protection (cycle-budget.ts), and a GUI that can lower the guard that
// catches a wedged worker would let one bad click take down the mechanism that reports bad
// clicks. It stays env-only.

export type ManagedWatchdogInput =
  | Partial<{
      feedAudioSilenceSeconds: string;
      feedAudioGraceSeconds: string;
      feedStallTimeoutSeconds: string;
      feedStallGraceSeconds: string;
      uplinkStallTimeoutSeconds: string;
      uplinkStallGraceSeconds: string;
      uplinkNoProgressRestartSeconds: string;
      durationBoundMarginSeconds: string;
    }>
  | null
  | undefined;

/**
 * Bounds and defaults, shared by the resolver, the settings form and the API route. Seconds
 * everywhere here; the modules run on milliseconds and the resolvers convert.
 *
 * Lower-bound derivations, one per guard:
 * - silence/stale/stall 15 s: the program feed advances once per segment and segments are capped
 *   at 10 s (FEED_TUNING_LIMITS), so 15 s is the smallest threshold that cannot read ordinary
 *   segment cadence as a fault. That relationship is pinned by a test.
 * - feed-stall grace 30 s: after a restart the playlist timestamp still belongs to the previous
 *   run, and a fresh ffmpeg needs startup plus its first segment (observed 10–20 s on remote
 *   sources) before that timestamp says anything about it.
 * - audio/uplink grace 0: both verdicts require having observed audio/progress at least once, so
 *   even zero grace cannot restart a process that never got started properly.
 * - no-progress restart 60 s: below a minute, "never encoded a frame" is indistinguishable from a
 *   slow RTMP connect, a DNS retry, or a reconnecting destination (uplink-progress.ts).
 * - duration margin 5–120 s: metadata durations are second-accurate; under 5 s a rebuffer skew
 *   could cut real content, and past ~120 s the watchdog cascade fires first anyway.
 * Upper bounds are uniformly "past this the watchdog is off while looking configured".
 */
export const WATCHDOG_LIMITS = {
  feedAudioSilenceSeconds: { min: 15, max: 3600, default: 90 },
  feedAudioGraceSeconds: { min: 0, max: 3600, default: 60 },
  feedStallTimeoutSeconds: { min: 15, max: 3600, default: 45 },
  feedStallGraceSeconds: { min: 30, max: 3600, default: 90 },
  uplinkStallTimeoutSeconds: { min: 15, max: 3600, default: 45 },
  uplinkStallGraceSeconds: { min: 0, max: 3600, default: 60 },
  uplinkNoProgressRestartSeconds: { min: 60, max: 7200, default: 300 },
  durationBoundMarginSeconds: { min: 5, max: 120, default: 15 }
} as const;

type WatchdogLimitKey = keyof typeof WATCHDOG_LIMITS;

export function isWithinWatchdogLimits(key: WatchdogLimitKey, value: number): boolean {
  const bounds = WATCHDOG_LIMITS[key];
  return Number.isFinite(value) && value >= bounds.min && value <= bounds.max;
}

/**
 * Managed seconds win (clamped); otherwise the env millisecond value with its historical
 * "any positive number" rule; otherwise the default. Zero is a valid managed value wherever the
 * lower bound is zero, which is why the managed branch tests parseability, not positivity.
 */
function readWatchdogSeconds(managedValue: string | undefined, key: WatchdogLimitKey, envMsValue: string | undefined): number {
  const bounds = WATCHDOG_LIMITS[key];
  const managedText = text(managedValue);
  if (managedText !== "") {
    const parsed = Number(managedText);
    if (Number.isFinite(parsed) && parsed >= 0) {
      return Math.min(bounds.max, Math.max(bounds.min, Math.round(parsed)));
    }
  }

  const envMs = Number(envMsValue);
  if (Number.isFinite(envMs) && envMs > 0) {
    return envMs / 1000;
  }
  return bounds.default;
}

export function resolveFeedAudioWatchdogMs(
  managed: ManagedWatchdogInput,
  env: EnvLike
): { silenceMs: number; graceMs: number } {
  return {
    silenceMs: readWatchdogSeconds(managed?.feedAudioSilenceSeconds, "feedAudioSilenceSeconds", env.PLAYOUT_FEED_SILENCE_MS) * 1000,
    graceMs: readWatchdogSeconds(managed?.feedAudioGraceSeconds, "feedAudioGraceSeconds", env.PLAYOUT_FEED_GRACE_MS) * 1000
  };
}

export function resolvePlayoutFeedWatchdogMs(
  managed: ManagedWatchdogInput,
  env: EnvLike
): { staleMs: number; graceMs: number } {
  return {
    staleMs:
      readWatchdogSeconds(managed?.feedStallTimeoutSeconds, "feedStallTimeoutSeconds", env.PLAYOUT_FEED_STALE_TIMEOUT_MS) * 1000,
    graceMs:
      readWatchdogSeconds(managed?.feedStallGraceSeconds, "feedStallGraceSeconds", env.PLAYOUT_FEED_STALE_GRACE_MS) * 1000
  };
}

export function resolveUplinkWatchdogMs(
  managed: ManagedWatchdogInput,
  env: EnvLike
): { stallMs: number; graceMs: number; noProgressRestartMs: number } {
  return {
    stallMs:
      readWatchdogSeconds(managed?.uplinkStallTimeoutSeconds, "uplinkStallTimeoutSeconds", env.UPLINK_STALL_TIMEOUT_MS) * 1000,
    graceMs:
      readWatchdogSeconds(managed?.uplinkStallGraceSeconds, "uplinkStallGraceSeconds", env.UPLINK_STALL_GRACE_MS) * 1000,
    noProgressRestartMs:
      readWatchdogSeconds(
        managed?.uplinkNoProgressRestartSeconds,
        "uplinkNoProgressRestartSeconds",
        env.UPLINK_NO_PROGRESS_RESTART_MS
      ) * 1000
  };
}

/** The duration-bound margin was seconds in env already; only the clamp is new on the managed path. */
export function resolveDurationBoundMarginSeconds(managed: ManagedWatchdogInput, env: EnvLike): number {
  const bounds = WATCHDOG_LIMITS.durationBoundMarginSeconds;
  const managedText = text(managed?.durationBoundMarginSeconds);
  if (managedText !== "") {
    const parsed = Number(managedText);
    if (Number.isFinite(parsed) && parsed >= 0) {
      return Math.min(bounds.max, Math.max(bounds.min, Math.round(parsed)));
    }
  }

  const envSeconds = Number(env.PLAYOUT_DURATION_BOUND_MARGIN_SECONDS);
  return Number.isFinite(envSeconds) && envSeconds > 0 ? envSeconds : bounds.default;
}

// ---------------------------------------------------------------------------
// Feed tuning: planned reconnect cadence and program-feed geometry
// ---------------------------------------------------------------------------

// M56 part 2. The relay topology (STREAM247_RELAY_ENABLED, the relay input/output URLs,
// STREAM247_UPLINK_INPUT_MODE) is deliberately NOT managed: those describe how the containers are
// wired at deploy time, and a GUI value that contradicts the running compose file would be a lie
// with a save button. What IS runtime operation is the cadence of the planned encoder reconnect
// and the geometry of the program feed, so those move here.

export type ManagedFeedTuningInput =
  | Partial<{
      playoutReconnectHours: string;
      playoutReconnectWindowSeconds: string;
      programFeedTargetSeconds: string;
      programFeedListSize: string;
      programFeedFailoverSeconds: string;
    }>
  | null
  | undefined;

/**
 * Bounds and defaults, shared by resolver, form and API route.
 * - reconnect hours 1..720: sub-hourly planned reconnects are viewer-visible interruptions on a
 *   timer; past 30 days the cadence is "never" in disguise.
 * - reconnect window 5..300 s: the window must outlast a process restart, and past five minutes
 *   it is an outage, not a window.
 * - segment target 1..10 s: the historical floor is 1; the ceiling of 10 keeps every segment
 *   safely below the feed watchdogs' 15 s lower bound (pinned by a test), so a healthy feed that
 *   advances once per segment can never be read as stalled.
 * - list size 3..120: the muxer needs at least a 3-segment sliding window to hand the uplink a
 *   readable playlist; 120 ten-second segments already buffer 20 minutes of disk.
 * - failover 1..60 s: how far past the buffered window the playlist may age before the feed
 *   counts as stale; beyond a minute the uplink would sit on a dead feed without failing over.
 */
export const FEED_TUNING_LIMITS = {
  playoutReconnectHours: { min: 1, max: 720, default: 48 },
  playoutReconnectWindowSeconds: { min: 5, max: 300, default: 20 },
  programFeedTargetSeconds: { min: 1, max: 10, default: 2 },
  programFeedListSize: { min: 3, max: 120, default: 30 },
  programFeedFailoverSeconds: { min: 1, max: 60, default: 10 }
} as const;

type FeedTuningLimitKey = keyof typeof FEED_TUNING_LIMITS;

export function isWithinFeedTuningLimits(key: FeedTuningLimitKey, value: number): boolean {
  const bounds = FEED_TUNING_LIMITS[key];
  return Number.isFinite(value) && value >= bounds.min && value <= bounds.max;
}

/** Managed wins (rounded and clamped); env keeps its historical positive-number reading. */
function readFeedTuningNumber(
  managedValue: string | undefined,
  key: FeedTuningLimitKey,
  envFallback: () => number
): number {
  const bounds = FEED_TUNING_LIMITS[key];
  const managedText = text(managedValue);
  if (managedText !== "") {
    const parsed = Number(managedText);
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.min(bounds.max, Math.max(bounds.min, Math.round(parsed)));
    }
  }
  return envFallback();
}

export function resolvePlayoutReconnectTuning(
  managed: ManagedFeedTuningInput,
  env: EnvLike
): { intervalHours: number; windowSeconds: number } {
  return {
    intervalHours: readFeedTuningNumber(managed?.playoutReconnectHours, "playoutReconnectHours", () =>
      readPositiveEnvNumber(env.PLAYOUT_RECONNECT_HOURS, FEED_TUNING_LIMITS.playoutReconnectHours.default)
    ),
    windowSeconds: readFeedTuningNumber(managed?.playoutReconnectWindowSeconds, "playoutReconnectWindowSeconds", () =>
      readPositiveEnvNumber(env.PLAYOUT_RECONNECT_SECONDS, FEED_TUNING_LIMITS.playoutReconnectWindowSeconds.default)
    )
  };
}

export function resolveProgramFeedTuning(
  managed: ManagedFeedTuningInput,
  env: EnvLike
): { targetSeconds: number; listSize: number; failoverSeconds: number } {
  // The env path reproduces ffmpeg-runtime's historical floors bit for bit: floor to an integer,
  // then raise below-minimum values to the floor the muxer needs.
  return {
    targetSeconds: readFeedTuningNumber(managed?.programFeedTargetSeconds, "programFeedTargetSeconds", () =>
      Math.max(1, Math.floor(readPositiveEnvNumber(env.STREAM247_PROGRAM_FEED_TARGET_SECONDS, 2)))
    ),
    listSize: readFeedTuningNumber(managed?.programFeedListSize, "programFeedListSize", () =>
      Math.max(3, Math.floor(readPositiveEnvNumber(env.STREAM247_PROGRAM_FEED_LIST_SIZE, 30)))
    ),
    failoverSeconds: readFeedTuningNumber(managed?.programFeedFailoverSeconds, "programFeedFailoverSeconds", () =>
      Math.max(1, Math.floor(readPositiveEnvNumber(env.STREAM247_PROGRAM_FEED_FAILOVER_SECONDS, 10)))
    )
  };
}

// ---------------------------------------------------------------------------
// EventSub webhook secret
// ---------------------------------------------------------------------------

export type ManagedEventSubSecretInput = Partial<{ twitchEventsubSecret: string }> | null | undefined;

export function resolveTwitchEventSubSecret(managed: ManagedEventSubSecretInput, env: EnvLike): string {
  return text(managed?.twitchEventsubSecret) || text(env.TWITCH_EVENTSUB_SECRET);
}
