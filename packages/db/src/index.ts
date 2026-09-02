import { promises as fs } from "node:fs";
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import path from "node:path";
import { Pool, type PoolClient } from "pg";
import { resolveAppSecret } from "./app-secret.js";

export {
  DEV_FALLBACK_APP_SECRET,
  MIN_APP_SECRET_LENGTH,
  getAppSecretFilePath,
  resolveAppSecret
} from "./app-secret.js";
export { isUsableTimeZone, resolveAppBaseUrl, resolveChannelTimeZone } from "./instance-config.js";
export * from "./asset-retention.js";
import { classifyAssetRetention, selectAssetRetentionDeletions, type AssetRetentionCounters } from "./asset-retention.js";
import {
  createDefaultModerationConfig,
  normalizeAudioLaneVolumePercent,
  parseAssetChaptersJson,
  normalizeChatGameSettings,
  type ChatGameSettings,
  normalizeCuepointOffsetsSeconds,
  normalizeEngagementEvent,
  normalizeEngagementGameMode,
  normalizeEngagementOverlayPosition,
  normalizeEngagementGameRuntime,
  normalizeEngagementSettings,
  normalizeOverlayPanelAnchor,
  normalizeOverlaySceneCustomLayers,
  deriveRelaySourceReadUrl,
  normalizeOverlaySceneLayerOrder,
  normalizeOverlayScenePreset,
  normalizeOverlaySurfaceStyle,
  normalizeDestinationOutputProfileId,
  normalizeStreamOutputSettings,
  normalizeOverlayTypographyPreset,
  normalizeOverlayTitleScale,
  stripInvisibleCharacters,
  type PresenceClampReason,
  type DestinationRoutingStatus,
  type DestinationOutputProfileId,
  type EngagementChatDisplayMode,
  type EngagementGameMode,
  type EngagementGameRuntime,
  type EngagementEventKind,
  type EngagementOverlayPosition,
  type EngagementOverlayStyle,
  type ModerationConfig,
  type OverlaySceneCustomLayer,
  type OverlaySceneLayerKind,
  type StreamOutputProfileId,
  type OverlayTypographyPreset,
  redactSecrets,
} from "@stream247/core";

export type OwnerAccount = {
  email: string;
  passwordHash: string;
  createdAt: string;
};

export type UserRole = "owner" | "admin" | "operator" | "moderator" | "viewer";

export type UserRecord = {
  id: string;
  email: string;
  displayName: string;
  authProvider: "local" | "twitch";
  role: UserRole;
  twitchUserId: string;
  twitchLogin: string;
  passwordHash?: string;
  twoFactorEnabled?: boolean;
  twoFactorSecret?: string;
  twoFactorConfirmedAt?: string;
  createdAt: string;
  lastLoginAt: string;
};

export type TeamAccessGrant = {
  id: string;
  twitchLogin: string;
  role: UserRole;
  createdAt: string;
  createdBy: string;
};

export type TwitchConnection = {
  status: "not-connected" | "connected" | "error";
  broadcasterId: string;
  broadcasterLogin: string;
  accessToken: string;
  refreshToken: string;
  connectedAt: string;
  tokenExpiresAt: string;
  lastRefreshAt: string;
  lastMetadataSyncAt: string;
  lastSyncedTitle: string;
  lastSyncedCategoryName: string;
  lastSyncedCategoryId: string;
  lastScheduleSyncAt: string;
  liveStatus: "live" | "offline" | "unknown";
  viewerCount: number;
  startedAt?: string;
  error: string;
};

// The second OAuth slot of the broadcast-channel split: the broadcaster account itself, connected
// only for channel metadata (title, category, schedule). It stays "not-connected" for setups
// where the identity connection already owns the broadcast channel. Deliberately minimal — no
// sync bookkeeping fields, those stay on the identity connection which drives the sync loop.
export type TwitchBroadcasterConnection = {
  status: "not-connected" | "connected" | "error";
  broadcasterId: string;
  broadcasterLogin: string;
  accessToken: string;
  refreshToken: string;
  connectedAt: string;
  tokenExpiresAt: string;
  lastRefreshAt: string;
  error: string;
};

export type TwitchScheduleSegmentRecord = {
  key: string;
  segmentId: string;
  blockId: string;
  startTime: string;
  title: string;
  syncedAt: string;
};

export type ModeratorPresenceWindowRecord = {
  actor: string;
  minutes: number;
  requestedMinutes?: number | null;
  appliedMinutes?: number;
  clampReason?: PresenceClampReason | "";
  createdAt: string;
  expiresAt: string;
};

export type AuditEvent = {
  id: string;
  type: string;
  message: string;
  createdAt: string;
};

/**
 * How many audit entries the trail keeps.
 *
 * Three places have to agree on this: `appendAuditEvent` prunes to it, `hydrateState` reads that
 * many back, and `persistState` writes that many out. They are coupled -- a `LIMIT` lower than the
 * prune bound would silently truncate the table on the next state write -- so they share one
 * constant rather than three literals.
 *
 * Why 500. The trail now holds only operator- and security-driven entries, because the 30-second
 * `worker.cycle`/`uplink.cycle` writes moved to runtime heartbeats. What remains is 57 event types,
 * all of them request-scoped; on a single-workspace appliance that is a burst of a few dozen while
 * something is being configured and near-silence otherwise, so 500 entries spans weeks to months of
 * ordinary use. The one writer an attacker can drive is `relay.publish_rejected`, and the throttle
 * in the web tier caps that at ten per minute globally: 500 entries is a little under an hour of
 * sustained attack, against ten minutes at the old bound. The ceiling exists at all because the
 * table is carried through the full state serialisation on every read and write; at the 85 bytes a
 * row measures in practice this is about 42 KB, which is proportionate to the 250-row sync-run and
 * 100-row incident tables already travelling with it.
 *
 * Deliberately not an age bound: an audit trail's failure mode is losing evidence, and an age rule
 * only ever deletes more than a count rule. Nothing here needs data minimisation.
 */
export const AUDIT_EVENT_RETENTION_LIMIT = 500;

export type SourceRecord = {
  id: string;
  name: string;
  type: string;
  connectorKind:
    | "local-library"
    | "direct-media"
    | "youtube-playlist"
    | "youtube-channel"
    | "twitch-vod"
    | "twitch-channel";
  status: string;
  enabled?: boolean;
  externalUrl?: string;
  notes?: string;
  lastSyncedAt?: string;
};

export type AssetRecord = {
  id: string;
  sourceId: string;
  title: string;
  path: string;
  cachePath?: string;
  /**
   * "too-large" means the VOD exceeds the per-asset cache limit and is played straight from Twitch.
   * It is a settled decision rather than a failure, so nothing retries it.
   */
  cacheStatus?: "" | "missing" | "ready" | "failed" | "too-large";
  cacheUpdatedAt?: string;
  cacheError?: string;
  folderPath?: string;
  tags?: string[];
  titlePrefix?: string;
  hashtagsJson?: string;
  platformNotes?: string;
  /**
   * JSON list of AssetChapter entries ({offsetSeconds, categoryName, title}). "[]" means the
   * asset has no chapters and behaves exactly as it did before chapters existed.
   */
  chaptersJson?: string;
  /**
   * Outcome of the last chapter metadata probe (the budgeted backfill for sources whose listing
   * ingest cannot deliver chapters). "" means never probed, "ok" means the probe completed — even
   * when the source simply has no chapters, so the budget is never spent on it again — and
   * "failed" puts the asset into the failure cooldown before the next attempt.
   */
  chaptersProbeStatus?: "" | "ok" | "failed";
  chaptersProbedAt?: string;
  status: "ready" | "pending" | "error";
  includeInProgramming: boolean;
  externalId?: string;
  categoryName?: string;
  durationSeconds?: number;
  publishedAt?: string;
  fallbackPriority: number;
  isGlobalFallback: boolean;
  createdAt: string;
  updatedAt: string;
};

export type AssetCollectionRecord = {
  id: string;
  name: string;
  description: string;
  color: string;
  assetIds: string[];
  createdAt: string;
  updatedAt: string;
};

export type AssetCurationUpdateRecord = {
  id: string;
  includeInProgramming?: boolean;
  isGlobalFallback?: boolean;
  fallbackPriority?: number;
  folderPath?: string;
  tags?: string[];
  appendTags?: string[];
  updatedAt?: string;
};

export type AssetMetadataUpdateRecord = {
  id: string;
  title?: string;
  titlePrefix?: string;
  categoryName?: string;
  hashtagsJson?: string;
  platformNotes?: string;
  chaptersJson?: string;
  updatedAt?: string;
};

export type AssetChapterProbeUpdateRecord = {
  id: string;
  chaptersProbeStatus: "ok" | "failed";
  chaptersProbedAt: string;
  /** Chapters the probe discovered; applied only while the stored list is still empty. */
  chaptersJson?: string;
};

export type AssetCollectionMembershipUpdateRecord = {
  collectionId: string;
  assetIds: string[];
  mode: "append" | "remove" | "replace";
  updatedAt?: string;
};

export type SourceFieldUpdateRecord = {
  id: string;
  name?: string;
  type?: string;
  connectorKind?: SourceRecord["connectorKind"];
  enabled?: boolean;
  externalUrl?: string;
  status?: string;
  notes?: string;
  lastSyncedAt?: string;
};

export type SourceSyncRunRecord = {
  id: string;
  sourceId: string;
  startedAt: string;
  finishedAt: string;
  status: "success" | "error" | "skipped";
  summary: string;
  discoveredAssets: number;
  readyAssets: number;
  errorMessage: string;
};

export type PoolRecord = {
  id: string;
  name: string;
  sourceIds: string[];
  playbackMode: "round-robin";
  cursorAssetId: string;
  insertAssetId: string;
  insertEveryItems: number;
  itemsSinceInsert: number;
  audioLaneAssetId: string;
  audioLaneVolumePercent: number;
  updatedAt: string;
};

export type ShowProfileRecord = {
  id: string;
  name: string;
  categoryName: string;
  defaultDurationMinutes: number;
  color: string;
  description: string;
  updatedAt: string;
};

export type StreamDestinationRecord = {
  id: string;
  provider: "twitch" | "custom-rtmp";
  role: "primary" | "backup";
  priority: number;
  outputProfileId?: DestinationOutputProfileId;
  name: string;
  enabled: boolean;
  rtmpUrl: string;
  streamKeyPresent: boolean;
  streamKeySource?: "env" | "managed" | "missing";
  status: DestinationRoutingStatus;
  notes: string;
  lastValidatedAt: string;
  lastFailureAt: string;
  failureCount: number;
  lastError: string;
};

export type IncidentRecord = {
  id: string;
  scope: "worker" | "playout" | "twitch" | "source" | "system";
  severity: "info" | "warning" | "critical";
  status: "open" | "resolved";
  acknowledgedAt: string;
  acknowledgedBy: string;
  title: string;
  message: string;
  fingerprint: string;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string;
};

export type ScheduleBlockRecord = {
  id: string;
  title: string;
  categoryName: string;
  dayOfWeek: number;
  startMinuteOfDay: number;
  durationMinutes: number;
  showId?: string;
  poolId?: string;
  sourceName: string;
  repeatMode?: "single" | "daily" | "weekdays" | "weekends" | "custom";
  repeatGroupId?: string;
  cuepointAssetId?: string;
  cuepointOffsetsSeconds?: number[];
};

export type OverlaySettingsRecord = {
  enabled: boolean;
  channelName: string;
  headline: string;
  insertHeadline: string;
  standbyHeadline: string;
  reconnectHeadline: string;
  replayLabel: string;
  brandBadge: string;
  scenePreset:
    | "replay-lower-third"
    | "split-now-next"
    | "standby-board"
    | "minimal-chip"
    | "bumper-board"
    | "reconnect-board";
  insertScenePreset:
    | "replay-lower-third"
    | "split-now-next"
    | "standby-board"
    | "minimal-chip"
    | "bumper-board"
    | "reconnect-board";
  standbyScenePreset:
    | "replay-lower-third"
    | "split-now-next"
    | "standby-board"
    | "minimal-chip"
    | "bumper-board"
    | "reconnect-board";
  reconnectScenePreset:
    | "replay-lower-third"
    | "split-now-next"
    | "standby-board"
    | "minimal-chip"
    | "bumper-board"
    | "reconnect-board";
  accentColor: string;
  surfaceStyle: "glass" | "solid" | "signal";
  panelAnchor: "bottom" | "center";
  titleScale: "compact" | "balanced" | "cinematic";
  typographyPreset: OverlayTypographyPreset;
  showClock: boolean;
  showNextItem: boolean;
  showScheduleTeaser: boolean;
  showCurrentCategory: boolean;
  showSourceLabel: boolean;
  showQueuePreview: boolean;
  queuePreviewCount: number;
  layerOrder: OverlaySceneLayerKind[];
  disabledLayers: OverlaySceneLayerKind[];
  customLayers: OverlaySceneCustomLayer[];
  emergencyBanner: string;
  tickerText: string;
  updatedAt: string;
};

export type OverlayStudioStateRecord = {
  liveOverlay: OverlaySettingsRecord;
  draftOverlay: OverlaySettingsRecord;
  basedOnUpdatedAt: string;
  hasUnpublishedChanges: boolean;
};

export type OverlayScenePresetRecord = {
  id: string;
  name: string;
  description: string;
  overlay: OverlaySettingsRecord;
  createdAt: string;
  updatedAt: string;
};

export type ManagedConfigRecord = {
  // Instance basics, written by the setup wizard. Env variables override these two — see
  // instance-config.ts for the precedence rationale.
  appUrl: string;
  channelTimezone: string;
  twitchClientId: string;
  twitchClientSecret: string;
  twitchDefaultCategoryId: string;
  // The channel the stream key actually sends video to. Empty means "same as the connected
  // identity", which is the pre-split behaviour and the rollback path.
  twitchBroadcastChannelLogin: string;
  discordWebhookUrl: string;
  smtpHost: string;
  smtpPort: string;
  smtpUser: string;
  smtpPassword: string;
  smtpFrom: string;
  alertEmailTo: string;
  // M56: operational decisions, resolved through packages/core managed-runtime.ts (managed value
  // wins, env is the fallback). All stored as strings; "" always means "not managed — follow env".
  ffmpegPreset: string;
  ffmpegMaxrate: string;
  ffmpegBufsize: string;
  ffmpegAudioBitrate: string;
  diskWatermarkEnabled: string;
  diskWatermarkTriggerPercent: string;
  diskWatermarkRecoverPercent: string;
  // M57: the observation-only watermark on the worker-root/system volume, and the asset
  // retention sweep. Same string convention as every managed value above.
  systemVolumeTriggerPercent: string;
  systemVolumeRecoverPercent: string;
  assetRetentionEnabled: string;
  assetRetentionProtectionDays: string;
  streamChatOverlayEnabled: string;
  streamAlertsEnabled: string;
  twitchScheduleSyncEnabled: string;
  // M57: the video-source layer gate and its sampling cadence, resolved through the same
  // managed-first family in packages/core managed-runtime.ts.
  sourceLayerEnabled: string;
  sourceSnapshotIntervalSeconds: string;
  // M57 stage 2: whether a pushed source may become a live playout input, and how loud it
  // starts. Stage B only logs the attach decision; the keys exist now so enabling stage C is a
  // configuration the operator already owns.
  sourceLiveEnabled: string;
  sourceLiveGainPercent: string;
  // M56 part 2: the replay (Twitch VOD) cache family. Sizes are GB here because that is what the
  // form asks for; the resolver converts. The cache root path stays env-only (infrastructure).
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
  // M56 part 2: watchdog thresholds, seconds in the GUI, resolved (and clamped) in core. The
  // loop stall guard is deliberately absent — the process's self-protection stays env-only.
  feedAudioSilenceSeconds: string;
  feedAudioGraceSeconds: string;
  feedStallTimeoutSeconds: string;
  feedStallGraceSeconds: string;
  uplinkStallTimeoutSeconds: string;
  uplinkStallGraceSeconds: string;
  uplinkNoProgressRestartSeconds: string;
  durationBoundMarginSeconds: string;
  // M56 part 2: planned reconnect cadence and program-feed geometry. Relay topology stays env.
  playoutReconnectHours: string;
  playoutReconnectWindowSeconds: string;
  programFeedTargetSeconds: string;
  programFeedListSize: string;
  programFeedFailoverSeconds: string;
  twitchEventsubSecret: string;
  updatedAt: string;
};

/** How a video source's picture arrives: the worker pulls a stored URL, or a camera pushes to the relay. */
export type OverlayVideoSourceIngestKind = "pull" | "push";

/**
 * A stored external video source (M57): what the studio and the worker may know about it.
 * The feed URL itself is deliberately absent — it is written through
 * upsertOverlayVideoSourceRecord, kept encrypted at rest, and read back only by the playout
 * sampler via readOverlayVideoSourceUrls. Every listing surface sees presence, never the value,
 * because feed URLs routinely embed credentials. The publish key of a push source follows the
 * same custody: presence here, the value only in the relay auth check (and once, at issue time,
 * in the response that generated it).
 */
export type OverlayVideoSourceRecord = {
  id: string;
  name: string;
  urlPresent: boolean;
  ingestKind: OverlayVideoSourceIngestKind;
  publishKeyPresent: boolean;
  /**
   * The worker's last attach decision for this source (M57 stage 2, Etappe E), as its own decision
   * word — "" until one has ever been made. Safe in a listing precisely because it is not a
   * credential and not derived from one: describeSourceLiveState turns it into the sentence an
   * operator reads. `liveRetryAt` is set only while a failure cooldown is running.
   */
  liveState: string;
  liveStateAt: string;
  liveRetryAt: string;
  updatedAt: string;
};

export type OutputSettingsRecord = {
  profileId: StreamOutputProfileId;
  width: number;
  height: number;
  fps: number;
  updatedAt: string;
};

export type EngagementSettingsRecord = {
  chatEnabled: boolean;
  alertsEnabled: boolean;
  donationsEnabled: boolean;
  channelPointsEnabled: boolean;
  gameEnabled: boolean;
  soloModeEnabled: boolean;
  smallGroupModeEnabled: boolean;
  crowdModeEnabled: boolean;
  gameWindowMinutes: number;
  chatMode: EngagementChatDisplayMode;
  chatPosition: EngagementOverlayPosition;
  alertPosition: EngagementOverlayPosition;
  style: EngagementOverlayStyle;
  maxMessages: number;
  rateLimitPerMinute: number;
  updatedAt: string;
};

export type EngagementGameRuntimeRecord = EngagementGameRuntime;

export type EngagementEventRecord = {
  id: string;
  kind: EngagementEventKind;
  actor: string;
  message: string;
  createdAt: string;
};

export type BroadcastQueueItemRecord = {
  id: string;
  kind: "asset" | "insert" | "standby" | "reconnect" | "live";
  assetId: string;
  title: string;
  subtitle: string;
  scenePreset: OverlaySettingsRecord["scenePreset"] | "";
  position: number;
};

export type PlayoutRuntimeRecord = {
  status: "idle" | "starting" | "running" | "switching" | "degraded" | "recovering" | "failed" | "standby" | "reconnecting";
  transitionState: "idle" | "prefetching" | "ready" | "switching";
  queueVersion: number;
  transitionTargetKind: BroadcastQueueItemRecord["kind"] | "";
  transitionTargetAssetId: string;
  transitionTargetTitle: string;
  transitionReadyAt: string;
  currentAssetId: string;
  currentTitle: string;
  previousAssetId: string;
  previousTitle: string;
  desiredAssetId: string;
  nextAssetId: string;
  nextTitle: string;
  queuedAssetIds: string[];
  queueItems: BroadcastQueueItemRecord[];
  prefetchedAssetId: string;
  prefetchedTitle: string;
  prefetchedAt: string;
  prefetchStatus: "" | "ready" | "failed";
  prefetchError: string;
  currentDestinationId: string;
  restartRequestedAt: string;
  heartbeatAt: string;
  /**
   * Freshness of the worker reconciliation loop, written once per cycle.
   *
   * This used to be inferred from the newest `worker.cycle` audit event. That put a 30-second
   * routine write into the security audit trail, which is a 100-row ring: the trail held nothing
   * but heartbeats and evicted every meaningful entry within about fifteen minutes. The heartbeat
   * lives here now, beside the playout and uplink ones, so the trail can stay meaningful.
   */
  workerHeartbeatAt: string;
  processPid: number;
  processStartedAt: string;
  lastTransitionAt: string;
  lastSuccessfulStartAt: string;
  lastSuccessfulAssetId: string;
  lastExitCode: string;
  restartCount: number;
  crashCountWindow: number;
  crashLoopDetected: boolean;
  lastError: string;
  lastStderrSample: string;
  selectionReasonCode:
    | "operator_override"
    | "scheduled_match"
    | "graceful_handoff"
    | "live_bridge"
    | "global_fallback"
    | "generic_fallback"
    | "no_asset"
    | "destination_missing"
    | "resolve_failed"
    | "ffmpeg_crash_loop"
    | "operator_insert"
    | "scheduled_insert"
    | "manual_next"
    | "standby"
    | "scheduled_reconnect"
    | "";
  fallbackTier: "none" | "scheduled" | "operator" | "global-fallback" | "generic-fallback" | "standby";
  overrideMode: "schedule" | "asset" | "fallback";
  overrideAssetId: string;
  overrideUntil: string;
  liveBridgeInputType: "" | "rtmp" | "hls";
  liveBridgeInputUrl: string;
  liveBridgeLabel: string;
  liveBridgeStatus: "" | "pending" | "active" | "releasing" | "error";
  liveBridgeRequestedAt: string;
  liveBridgeStartedAt: string;
  liveBridgeReleasedAt: string;
  liveBridgeLastError: string;
  cuepointWindowKey: string;
  cuepointFiredKeys: string[];
  cuepointLastTriggeredAt: string;
  cuepointLastAssetId: string;
  manualNextAssetId: string;
  manualNextRequestedAt: string;
  insertAssetId: string;
  insertRequestedAt: string;
  insertStatus: "" | "pending" | "active";
  skipAssetId: string;
  skipUntil: string;
  pendingAction: "" | "refresh" | "rebuild_queue";
  pendingActionRequestedAt: string;
  uplinkStatus: "" | "idle" | "waiting-for-feed" | "running" | "scheduled-reconnect" | "failed";
  uplinkInputMode: "" | "hls" | "rtmp";
  uplinkStartedAt: string;
  uplinkHeartbeatAt: string;
  uplinkDestinationIds: string[];
  uplinkRestartCount: number;
  uplinkUnplannedRestartCount: number;
  uplinkLastExitCode: string;
  uplinkLastExitReason: string;
  uplinkLastExitPlanned: boolean;
  uplinkReconnectUntil: string;
  programFeedStatus: "" | "bootstrapping" | "fresh" | "stale" | "failed";
  programFeedUpdatedAt: string;
  programFeedPlaylistPath: string;
  programFeedTargetSeconds: number;
  programFeedBufferedSeconds: number;
  message: string;
};

export type AppState = {
  initialized: boolean;
  owner: OwnerAccount | null;
  users: UserRecord[];
  teamAccessGrants: TeamAccessGrant[];
  moderation: ModerationConfig;
  presenceWindows: ModeratorPresenceWindowRecord[];
  overlay: OverlaySettingsRecord;
  managedConfig: ManagedConfigRecord;
  output: OutputSettingsRecord;
  engagement: EngagementSettingsRecord;
  engagementGame: EngagementGameRuntimeRecord;
  engagementEvents: EngagementEventRecord[];
  twitch: TwitchConnection;
  twitchBroadcaster: TwitchBroadcasterConnection;
  twitchScheduleSegments: TwitchScheduleSegmentRecord[];
  pools: PoolRecord[];
  showProfiles: ShowProfileRecord[];
  scheduleBlocks: ScheduleBlockRecord[];
  sources: SourceRecord[];
  assets: AssetRecord[];
  assetCollections: AssetCollectionRecord[];
  sourceSyncRuns: SourceSyncRunRecord[];
  destinations: StreamDestinationRecord[];
  incidents: IncidentRecord[];
  auditEvents: AuditEvent[];
  playout: PlayoutRuntimeRecord;
};

type MigrationDefinition = {
  id: string;
  description: string;
  apply: (client: PoolClient) => Promise<void>;
};

type OverlaySettingsRow = {
  enabled: boolean;
  channel_name: string;
  headline: string;
  insert_headline: string;
  standby_headline: string;
  reconnect_headline: string;
  brand_badge: string;
  scene_preset: OverlaySettingsRecord["scenePreset"];
  insert_scene_preset: OverlaySettingsRecord["insertScenePreset"];
  standby_scene_preset: OverlaySettingsRecord["standbyScenePreset"];
  reconnect_scene_preset: OverlaySettingsRecord["reconnectScenePreset"];
  accent_color: string;
  surface_style: OverlaySettingsRecord["surfaceStyle"];
  panel_anchor: OverlaySettingsRecord["panelAnchor"];
  title_scale: OverlaySettingsRecord["titleScale"];
  typography_preset: OverlaySettingsRecord["typographyPreset"];
  show_clock: boolean;
  show_next_item: boolean;
  show_schedule_teaser: boolean;
  show_current_category: boolean;
  show_source_label: boolean;
  show_queue_preview: boolean;
  queue_preview_count: number;
  layer_order_json: string;
  disabled_layers_json: string;
  custom_layers_json: string;
  emergency_banner: string;
  replay_label: string;
  ticker_text: string;
  updated_at: string;
};

type OverlayDraftRow = OverlaySettingsRow & {
  based_on_updated_at: string;
};

type OutputSettingsRow = {
  profile_id: StreamOutputProfileId;
  width: number;
  height: number;
  fps: number;
  updated_at: string;
};

type EngagementSettingsRow = {
  chat_enabled: boolean;
  alerts_enabled: boolean;
  donations_enabled: boolean;
  channel_points_enabled: boolean;
  game_enabled: boolean;
  solo_mode_enabled: boolean;
  small_group_mode_enabled: boolean;
  crowd_mode_enabled: boolean;
  game_window_minutes: number;
  chat_mode: EngagementChatDisplayMode;
  chat_position: EngagementOverlayPosition;
  alert_position: EngagementOverlayPosition;
  style: EngagementOverlayStyle;
  max_messages: number;
  rate_limit_per_minute: number;
  updated_at: string;
};

type EngagementGameRuntimeRow = {
  active_chatter_count: number;
  mode: EngagementGameMode | "";
  mode_changed_at: string;
  updated_at: string;
};

type EngagementEventRow = {
  id: string;
  kind: EngagementEventKind;
  actor: string;
  message: string;
  created_at: string;
};

type OverlayScenePresetRow = {
  id: string;
  name: string;
  description: string;
  overlay_json: string;
  created_at: string;
  updated_at: string;
};

const legacyStatePath = path.join(process.cwd(), "data", "app", "state.json");

declare global {
  // eslint-disable-next-line no-var
  var __stream247Pool: Pool | undefined;
  // eslint-disable-next-line no-var
  var __stream247DbReady: Promise<void> | undefined;
}

const STATE_WRITE_LOCK_KEY = 247001;
const DB_BOOTSTRAP_LOCK_KEY = 247002;
const STATE_WRITE_MAX_RETRIES = 3;
const LATEST_SCHEMA_MIGRATION_ID = "20260404_001_schema_baseline";
const schemaMigrations: MigrationDefinition[] = [];

function getLegacyDestinationEnvConfig(destinationId: string): { url: string; key: string } {
  if (destinationId === "destination-backup") {
    return {
      url: process.env.BACKUP_STREAM_OUTPUT_URL || process.env.BACKUP_TWITCH_RTMP_URL || "",
      key: process.env.BACKUP_STREAM_OUTPUT_KEY || process.env.BACKUP_TWITCH_STREAM_KEY || ""
    };
  }

  if (destinationId === "destination-primary") {
    return {
      url: process.env.STREAM_OUTPUT_URL || process.env.TWITCH_RTMP_URL || "",
      key: process.env.STREAM_OUTPUT_KEY || process.env.TWITCH_STREAM_KEY || ""
    };
  }

  return {
    url: "",
    key: ""
  };
}

function normalizeOverlaySettingsRecord(overlay: OverlaySettingsRecord): OverlaySettingsRecord {
  const defaults = defaultState().overlay;
  return {
    ...defaults,
    ...overlay,
    channelName: sanitizeStoredText(overlay.channelName ?? defaults.channelName, 80) || defaults.channelName,
    headline: sanitizeStoredText(overlay.headline ?? defaults.headline, 120) || defaults.headline,
    insertHeadline: sanitizeStoredText(overlay.insertHeadline ?? defaults.insertHeadline, 120) || defaults.insertHeadline,
    standbyHeadline: sanitizeStoredText(overlay.standbyHeadline ?? defaults.standbyHeadline, 120) || defaults.standbyHeadline,
    reconnectHeadline: sanitizeStoredText(overlay.reconnectHeadline ?? defaults.reconnectHeadline, 120) || defaults.reconnectHeadline,
    replayLabel: sanitizeStoredText(overlay.replayLabel ?? defaults.replayLabel, 80) || defaults.replayLabel,
    brandBadge: sanitizeStoredText(overlay.brandBadge ?? defaults.brandBadge, 48),
    scenePreset: normalizeOverlayScenePreset(String(overlay.scenePreset ?? defaults.scenePreset)),
    insertScenePreset: normalizeOverlayScenePreset(String(overlay.insertScenePreset ?? defaults.insertScenePreset)),
    standbyScenePreset: normalizeOverlayScenePreset(String(overlay.standbyScenePreset ?? defaults.standbyScenePreset)),
    reconnectScenePreset: normalizeOverlayScenePreset(String(overlay.reconnectScenePreset ?? defaults.reconnectScenePreset)),
    accentColor: sanitizeStoredText(overlay.accentColor ?? defaults.accentColor, 20) || defaults.accentColor,
    surfaceStyle: normalizeOverlaySurfaceStyle(String(overlay.surfaceStyle ?? defaults.surfaceStyle)),
    panelAnchor: normalizeOverlayPanelAnchor(String(overlay.panelAnchor ?? defaults.panelAnchor)),
    titleScale: normalizeOverlayTitleScale(String(overlay.titleScale ?? defaults.titleScale)),
    typographyPreset: normalizeOverlayTypographyPreset(String(overlay.typographyPreset ?? defaults.typographyPreset)),
    queuePreviewCount: Math.max(1, Math.min(5, Number(overlay.queuePreviewCount ?? defaults.queuePreviewCount) || defaults.queuePreviewCount)),
    layerOrder: normalizeOverlaySceneLayerOrder(overlay.layerOrder ?? defaults.layerOrder),
    disabledLayers: normalizeOverlaySceneLayerOrder(overlay.disabledLayers ?? []).filter((kind) =>
      (overlay.disabledLayers ?? []).includes(kind)
    ),
    customLayers: normalizeOverlaySceneCustomLayers(overlay.customLayers ?? defaults.customLayers),
    emergencyBanner: sanitizeStoredText(overlay.emergencyBanner ?? defaults.emergencyBanner, 180),
    tickerText: sanitizeStoredText(overlay.tickerText ?? defaults.tickerText, 180),
    updatedAt: overlay.updatedAt ?? defaults.updatedAt
  };
}

function normalizeOutputSettingsRecord(output?: Partial<OutputSettingsRecord> | null): OutputSettingsRecord {
  const defaults = defaultState().output;
  const normalized = normalizeStreamOutputSettings(output ?? defaults);
  return {
    ...normalized,
    updatedAt: String(output?.updatedAt ?? defaults.updatedAt ?? "")
  };
}

function normalizeEngagementSettingsRecord(engagement?: Partial<EngagementSettingsRecord> | null): EngagementSettingsRecord {
  const defaults = defaultState().engagement;
  const normalized = normalizeEngagementSettings(engagement ?? defaults);
  return {
    ...normalized,
    updatedAt: String(engagement?.updatedAt ?? defaults.updatedAt ?? "")
  };
}

function normalizeEngagementGameRuntimeRecord(
  runtime?: Partial<EngagementGameRuntimeRecord> | null
): EngagementGameRuntimeRecord {
  const defaults = defaultState().engagementGame;
  const normalized = normalizeEngagementGameRuntime(runtime ?? defaults);
  return {
    mode: normalized.mode,
    activeChatterCount: normalized.activeChatterCount,
    modeChangedAt: normalized.modeChangedAt,
    updatedAt: normalized.updatedAt
  };
}

function normalizeEngagementEventRecord(event: Partial<EngagementEventRecord>): EngagementEventRecord {
  const normalized = normalizeEngagementEvent(event);
  return {
    id: normalized.id || createId("engagement"),
    kind: normalized.kind,
    actor: normalized.actor,
    message: normalized.message,
    createdAt: normalized.createdAt || new Date().toISOString()
  };
}

function mapOverlayRowToRecord(row: OverlaySettingsRow | undefined, fallback: OverlaySettingsRecord): OverlaySettingsRecord {
  return row
    ? normalizeOverlaySettingsRecord({
        enabled: row.enabled,
        channelName: row.channel_name,
        headline: row.headline,
        insertHeadline: row.insert_headline,
        standbyHeadline: row.standby_headline,
        reconnectHeadline: row.reconnect_headline,
        replayLabel: row.replay_label,
        brandBadge: row.brand_badge,
        scenePreset: row.scene_preset,
        insertScenePreset: row.insert_scene_preset,
        standbyScenePreset: row.standby_scene_preset,
        reconnectScenePreset: row.reconnect_scene_preset,
        accentColor: row.accent_color,
        surfaceStyle: row.surface_style,
        panelAnchor: row.panel_anchor,
        titleScale: row.title_scale,
        typographyPreset: row.typography_preset,
        showClock: row.show_clock,
        showNextItem: row.show_next_item,
        showScheduleTeaser: row.show_schedule_teaser,
        showCurrentCategory: row.show_current_category,
        showSourceLabel: row.show_source_label,
        showQueuePreview: row.show_queue_preview,
        queuePreviewCount: row.queue_preview_count,
        layerOrder: JSON.parse(row.layer_order_json || "[]") as OverlaySceneLayerKind[],
        disabledLayers: JSON.parse(row.disabled_layers_json || "[]") as OverlaySceneLayerKind[],
        customLayers: JSON.parse(row.custom_layers_json || "[]") as OverlaySceneCustomLayer[],
        emergencyBanner: row.emergency_banner,
        tickerText: row.ticker_text,
        updatedAt: row.updated_at
      })
    : fallback;
}

function mapOutputRowToRecord(row: OutputSettingsRow | undefined, fallback: OutputSettingsRecord): OutputSettingsRecord {
  return row
    ? normalizeOutputSettingsRecord({
        profileId: row.profile_id,
        width: row.width,
        height: row.height,
        fps: row.fps,
        updatedAt: row.updated_at
      })
    : fallback;
}

function mapEngagementSettingsRowToRecord(
  row: EngagementSettingsRow | undefined,
  fallback: EngagementSettingsRecord
): EngagementSettingsRecord {
  return row
    ? normalizeEngagementSettingsRecord({
        chatEnabled: row.chat_enabled,
        alertsEnabled: row.alerts_enabled,
        donationsEnabled: row.donations_enabled,
        channelPointsEnabled: row.channel_points_enabled,
        gameEnabled: row.game_enabled,
        soloModeEnabled: row.solo_mode_enabled,
        smallGroupModeEnabled: row.small_group_mode_enabled,
        crowdModeEnabled: row.crowd_mode_enabled,
        gameWindowMinutes: row.game_window_minutes,
        chatMode: row.chat_mode,
        chatPosition: row.chat_position,
        alertPosition: row.alert_position,
        style: row.style,
        maxMessages: row.max_messages,
        rateLimitPerMinute: row.rate_limit_per_minute,
        updatedAt: row.updated_at
      })
    : fallback;
}

function mapEngagementGameRuntimeRowToRecord(
  row: EngagementGameRuntimeRow | undefined,
  fallback: EngagementGameRuntimeRecord
): EngagementGameRuntimeRecord {
  return row
    ? normalizeEngagementGameRuntimeRecord({
        activeChatterCount: row.active_chatter_count,
        mode: normalizeEngagementGameMode(row.mode),
        modeChangedAt: row.mode_changed_at,
        updatedAt: row.updated_at
      })
    : fallback;
}

function mapEngagementEventRowToRecord(row: EngagementEventRow): EngagementEventRecord {
  return normalizeEngagementEventRecord({
    id: row.id,
    kind: row.kind,
    actor: row.actor,
    message: row.message,
    createdAt: row.created_at
  });
}

function overlaySettingsEqual(left: OverlaySettingsRecord, right: OverlaySettingsRecord): boolean {
  const normalizedLeft = normalizeOverlaySettingsRecord(left);
  const normalizedRight = normalizeOverlaySettingsRecord(right);
  return JSON.stringify(normalizedLeft) === JSON.stringify(normalizedRight);
}

function normalizeOverlayScenePresetRecord(record: OverlayScenePresetRecord): OverlayScenePresetRecord {
  return {
    id: record.id,
    name: sanitizeStoredText(record.name, 80) || "Untitled preset",
    description: sanitizeStoredText(record.description, 220),
    overlay: normalizeOverlaySettingsRecord(record.overlay),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt
  };
}

function mapOverlayScenePresetRowToRecord(row: OverlayScenePresetRow): OverlayScenePresetRecord {
  return normalizeOverlayScenePresetRecord({
    id: row.id,
    name: row.name,
    description: row.description,
    overlay: JSON.parse(row.overlay_json || "{}") as OverlaySettingsRecord,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  });
}

function normalizeDestinationRecords(destinations: StreamDestinationRecord[], defaults: StreamDestinationRecord[]): StreamDestinationRecord[] {
  const merged = [...destinations];
  for (const destination of defaults) {
    if (!merged.some((entry) => entry.id === destination.id)) {
      merged.push(destination);
    }
  }

  return [...new Map(merged.map((destination) => [destination.id, destination] as const)).values()]
    .map((destination) => ({
      ...destination,
      role: (destination.role === "backup" ? "backup" : "primary") as StreamDestinationRecord["role"],
      priority: typeof destination.priority === "number" ? destination.priority : destination.role === "backup" ? 10 : 0,
      outputProfileId: normalizeDestinationOutputProfileId(destination.outputProfileId),
      streamKeySource:
        destination.streamKeySource === "env" ||
        destination.streamKeySource === "managed" ||
        destination.streamKeySource === "missing"
          ? destination.streamKeySource
          : getLegacyDestinationEnvConfig(destination.id).key
            ? "env"
            : destination.streamKeyPresent
              ? "managed"
              : "missing",
      lastFailureAt: destination.lastFailureAt || "",
      failureCount: typeof destination.failureCount === "number" ? destination.failureCount : 0,
      lastError: destination.lastError || ""
    }))
    .sort((left, right) => left.priority - right.priority || left.name.localeCompare(right.name));
}

async function upsertOverlaySettingsTable(
  client: PoolClient,
  tableName: "overlay_settings" | "overlay_drafts",
  overlay: OverlaySettingsRecord,
  basedOnUpdatedAt = ""
): Promise<void> {
  const normalized = normalizeOverlaySettingsRecord(overlay);

  if (tableName === "overlay_drafts") {
    await client.query(
      `
        INSERT INTO overlay_drafts (
          singleton_id, enabled, channel_name, headline, insert_headline, standby_headline, reconnect_headline, replay_label, brand_badge, scene_preset, insert_scene_preset, standby_scene_preset, reconnect_scene_preset, accent_color, surface_style, panel_anchor, title_scale, typography_preset, show_clock, show_next_item, show_schedule_teaser, show_current_category, show_source_label, show_queue_preview, queue_preview_count, layer_order_json, disabled_layers_json, custom_layers_json, emergency_banner, ticker_text, updated_at, based_on_updated_at
        )
        VALUES (1, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31)
        ON CONFLICT (singleton_id) DO UPDATE SET
          enabled = EXCLUDED.enabled,
          channel_name = EXCLUDED.channel_name,
          headline = EXCLUDED.headline,
          insert_headline = EXCLUDED.insert_headline,
          standby_headline = EXCLUDED.standby_headline,
          reconnect_headline = EXCLUDED.reconnect_headline,
          replay_label = EXCLUDED.replay_label,
          brand_badge = EXCLUDED.brand_badge,
          scene_preset = EXCLUDED.scene_preset,
          insert_scene_preset = EXCLUDED.insert_scene_preset,
          standby_scene_preset = EXCLUDED.standby_scene_preset,
          reconnect_scene_preset = EXCLUDED.reconnect_scene_preset,
          accent_color = EXCLUDED.accent_color,
          surface_style = EXCLUDED.surface_style,
          panel_anchor = EXCLUDED.panel_anchor,
          title_scale = EXCLUDED.title_scale,
          typography_preset = EXCLUDED.typography_preset,
          show_clock = EXCLUDED.show_clock,
          show_next_item = EXCLUDED.show_next_item,
          show_schedule_teaser = EXCLUDED.show_schedule_teaser,
          show_current_category = EXCLUDED.show_current_category,
          show_source_label = EXCLUDED.show_source_label,
          show_queue_preview = EXCLUDED.show_queue_preview,
          queue_preview_count = EXCLUDED.queue_preview_count,
          layer_order_json = EXCLUDED.layer_order_json,
          disabled_layers_json = EXCLUDED.disabled_layers_json,
          custom_layers_json = EXCLUDED.custom_layers_json,
          emergency_banner = EXCLUDED.emergency_banner,
          ticker_text = EXCLUDED.ticker_text,
          updated_at = EXCLUDED.updated_at,
          based_on_updated_at = EXCLUDED.based_on_updated_at
      `,
      [
        normalized.enabled,
        normalized.channelName,
        normalized.headline,
        normalized.insertHeadline,
        normalized.standbyHeadline,
        normalized.reconnectHeadline,
        normalized.replayLabel,
        normalized.brandBadge,
        normalized.scenePreset,
        normalized.insertScenePreset,
        normalized.standbyScenePreset,
        normalized.reconnectScenePreset,
        normalized.accentColor,
        normalized.surfaceStyle,
        normalized.panelAnchor,
        normalized.titleScale,
        normalized.typographyPreset,
        normalized.showClock,
        normalized.showNextItem,
        normalized.showScheduleTeaser,
        normalized.showCurrentCategory,
        normalized.showSourceLabel,
        normalized.showQueuePreview,
        normalized.queuePreviewCount,
        JSON.stringify(normalized.layerOrder),
        JSON.stringify(normalized.disabledLayers),
        JSON.stringify(normalized.customLayers),
        normalized.emergencyBanner,
        normalized.tickerText,
        normalized.updatedAt,
        basedOnUpdatedAt
      ]
    );
    return;
  }

  await client.query(
    `
      INSERT INTO overlay_settings (
          singleton_id, enabled, channel_name, headline, insert_headline, standby_headline, reconnect_headline, replay_label, brand_badge, scene_preset, insert_scene_preset, standby_scene_preset, reconnect_scene_preset, accent_color, surface_style, panel_anchor, title_scale, typography_preset, show_clock, show_next_item, show_schedule_teaser, show_current_category, show_source_label, show_queue_preview, queue_preview_count, layer_order_json, disabled_layers_json, custom_layers_json, emergency_banner, ticker_text, updated_at
      )
      VALUES (1, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30)
      ON CONFLICT (singleton_id) DO UPDATE SET
        enabled = EXCLUDED.enabled,
        channel_name = EXCLUDED.channel_name,
        headline = EXCLUDED.headline,
        insert_headline = EXCLUDED.insert_headline,
        standby_headline = EXCLUDED.standby_headline,
        reconnect_headline = EXCLUDED.reconnect_headline,
        replay_label = EXCLUDED.replay_label,
        brand_badge = EXCLUDED.brand_badge,
        scene_preset = EXCLUDED.scene_preset,
        insert_scene_preset = EXCLUDED.insert_scene_preset,
        standby_scene_preset = EXCLUDED.standby_scene_preset,
        reconnect_scene_preset = EXCLUDED.reconnect_scene_preset,
        accent_color = EXCLUDED.accent_color,
        surface_style = EXCLUDED.surface_style,
        panel_anchor = EXCLUDED.panel_anchor,
        title_scale = EXCLUDED.title_scale,
        typography_preset = EXCLUDED.typography_preset,
        show_clock = EXCLUDED.show_clock,
        show_next_item = EXCLUDED.show_next_item,
        show_schedule_teaser = EXCLUDED.show_schedule_teaser,
        show_current_category = EXCLUDED.show_current_category,
        show_source_label = EXCLUDED.show_source_label,
        show_queue_preview = EXCLUDED.show_queue_preview,
        queue_preview_count = EXCLUDED.queue_preview_count,
        layer_order_json = EXCLUDED.layer_order_json,
        disabled_layers_json = EXCLUDED.disabled_layers_json,
        custom_layers_json = EXCLUDED.custom_layers_json,
        emergency_banner = EXCLUDED.emergency_banner,
        ticker_text = EXCLUDED.ticker_text,
        updated_at = EXCLUDED.updated_at
    `,
    [
      normalized.enabled,
      normalized.channelName,
      normalized.headline,
      normalized.insertHeadline,
      normalized.standbyHeadline,
      normalized.reconnectHeadline,
      normalized.replayLabel,
      normalized.brandBadge,
      normalized.scenePreset,
      normalized.insertScenePreset,
      normalized.standbyScenePreset,
      normalized.reconnectScenePreset,
      normalized.accentColor,
      normalized.surfaceStyle,
      normalized.panelAnchor,
      normalized.titleScale,
      normalized.typographyPreset,
      normalized.showClock,
      normalized.showNextItem,
      normalized.showScheduleTeaser,
      normalized.showCurrentCategory,
      normalized.showSourceLabel,
      normalized.showQueuePreview,
      normalized.queuePreviewCount,
      JSON.stringify(normalized.layerOrder),
      JSON.stringify(normalized.disabledLayers),
      JSON.stringify(normalized.customLayers),
      normalized.emergencyBanner,
      normalized.tickerText,
      normalized.updatedAt
    ]
  );
}

function isRetryableStateWriteError(error: unknown): error is { code: string } {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code !== undefined &&
    ["40P01", "40001"].includes((error as { code: string }).code)
  );
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function createId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeAssetTags(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const normalized = value
    .map((entry) => String(entry || "").trim())
    .filter(Boolean)
    .map((entry) =>
      entry
        .normalize("NFKD")
        .replace(/[^\w\s/-]+/g, "")
        .replace(/\s+/g, " ")
        .trim()
    )
    .filter(Boolean);

  return [...new Set(normalized)].slice(0, 24);
}

function normalizeAssetFolderPath(value: unknown): string {
  return String(value ?? "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\/+|\/+$/g, "");
}

function sanitizeStoredText(value: unknown, maxLength: number): string {
  return stripInvisibleCharacters(String(value ?? "")).trim().slice(0, maxLength);
}

function normalizeAssetTitle(value: unknown): string {
  return sanitizeStoredText(value, 200);
}

function normalizeAssetTitlePrefix(value: unknown): string {
  return sanitizeStoredText(value, 20);
}

function normalizeAssetCategoryName(value: unknown): string {
  return sanitizeStoredText(value, 120);
}

function normalizeAssetPlatformNotes(value: unknown): string {
  return sanitizeStoredText(value, 1000);
}

function normalizeAssetHashtagsJson(value: unknown): string {
  if (typeof value !== "string") {
    return "[]";
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) {
      return "[]";
    }

    const normalized = parsed
      .map((entry) =>
        stripInvisibleCharacters(String(entry ?? ""))
          .trim()
          .replace(/^#+/, "")
          .replace(/\s+/g, "")
      )
      .filter(Boolean);
    return JSON.stringify([...new Set(normalized)].slice(0, 12));
  } catch {
    return "[]";
  }
}

function normalizeAssetChaptersJson(value: unknown): string {
  return typeof value === "string" ? JSON.stringify(parseAssetChaptersJson(value)) : "[]";
}

function normalizeAssetChapterProbeStatus(value: unknown): "" | "ok" | "failed" {
  return value === "ok" || value === "failed" ? value : "";
}

/**
 * Decide which chapter list survives a re-ingest.
 *
 * Chapters are curation the moment an operator touches them, so a stored non-empty list always
 * wins over whatever ingest discovered — the same retention rule tags and the title prefix follow
 * in replaceAssetsForSourceIds. Only an empty stored list gets filled, which also means deleting
 * every chapter hands the asset back to auto-fill on the next sync; that is the documented
 * rollback shape, not data loss.
 */
export function chooseStoredAssetChaptersJson(
  existingChaptersJson: string | undefined,
  incomingChaptersJson: string | undefined
): string {
  const existing = normalizeAssetChaptersJson(existingChaptersJson ?? "[]");
  return existing !== "[]" ? existing : normalizeAssetChaptersJson(incomingChaptersJson ?? "[]");
}

function normalizeAssetCollectionColor(value: unknown): string {
  const candidate = String(value ?? "")
    .trim()
    .toLowerCase();
  return /^#[0-9a-f]{6}$/.test(candidate) ? candidate : "#0e6d5a";
}

function normalizeAssetCollectionName(value: unknown): string {
  return sanitizeStoredText(value, 80) || "Curated set";
}

function normalizeAssetCollectionDescription(value: unknown): string {
  return sanitizeStoredText(value, 240);
}

function parseAssetTagsJson(value: string): string[] {
  if (!value) {
    return [];
  }

  try {
    return normalizeAssetTags(JSON.parse(value));
  } catch {
    return [];
  }
}

function normalizePresenceClampReason(value: unknown): PresenceClampReason | "" {
  return value === "accepted" || value === "default" || value === "minimum" || value === "maximum" ? value : "";
}

function getDatabaseUrl(): string {
  return process.env.DATABASE_URL || "postgresql://stream247:stream247@postgres:5432/stream247";
}

function getPool(): Pool {
  if (!globalThis.__stream247Pool) {
    globalThis.__stream247Pool = new Pool({
      connectionString: getDatabaseUrl()
    });
  }

  return globalThis.__stream247Pool;
}

function getEncryptionKey(): Buffer {
  // Before M52 this silently fell back to the published development constant even in production,
  // which made the managed-config encryption decorative for any install that forgot APP_SECRET.
  // resolveAppSecret generates and persists a real secret instead, and only production with a
  // broken data volume still refuses to proceed.
  return scryptSync(resolveAppSecret(), "stream247-managed-config", 32);
}

function encryptManagedConfig(value: ManagedConfigRecord): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getEncryptionKey(), iv);
  const plaintext = Buffer.from(JSON.stringify(value), "utf8");
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return `v1:${iv.toString("base64url")}:${authTag.toString("base64url")}:${encrypted.toString("base64url")}`;
}

function encryptSecretString(value: string): string {
  if (!value) {
    return "";
  }

  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getEncryptionKey(), iv);
  const plaintext = Buffer.from(value, "utf8");
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return `v1:${iv.toString("base64url")}:${authTag.toString("base64url")}:${encrypted.toString("base64url")}`;
}

function decryptSecretString(value: string): string {
  if (!value) {
    return "";
  }

  const [version, ivText, authTagText, payloadText] = value.split(":");
  if (version !== "v1" || !ivText || !authTagText || !payloadText) {
    return "";
  }

  try {
    const decipher = createDecipheriv("aes-256-gcm", getEncryptionKey(), Buffer.from(ivText, "base64url"));
    decipher.setAuthTag(Buffer.from(authTagText, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(payloadText, "base64url")),
      decipher.final()
    ]).toString("utf8");
  } catch {
    return "";
  }
}

function decryptManagedConfig(value: string): ManagedConfigRecord | null {
  if (!value) {
    return null;
  }

  const [version, ivText, authTagText, payloadText] = value.split(":");
  if (version !== "v1" || !ivText || !authTagText || !payloadText) {
    return null;
  }

  try {
    const decipher = createDecipheriv("aes-256-gcm", getEncryptionKey(), Buffer.from(ivText, "base64url"));
    decipher.setAuthTag(Buffer.from(authTagText, "base64url"));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(payloadText, "base64url")),
      decipher.final()
    ]).toString("utf8");

    return JSON.parse(decrypted) as ManagedConfigRecord;
  } catch {
    return null;
  }
}

function defaultState(): AppState {
  return {
    initialized: false,
    owner: null,
    users: [],
    teamAccessGrants: [],
    moderation: createDefaultModerationConfig(),
    presenceWindows: [],
    overlay: {
      enabled: false,
      channelName: "Stream247",
      headline: "Always on air",
      insertHeadline: "Insert on air",
      standbyHeadline: "Please wait, restream is starting",
      reconnectHeadline: "Scheduled reconnect in progress",
      replayLabel: "Replay stream",
      brandBadge: "",
      scenePreset: "replay-lower-third",
      insertScenePreset: "bumper-board",
      standbyScenePreset: "standby-board",
      reconnectScenePreset: "reconnect-board",
      accentColor: "#0e6d5a",
      surfaceStyle: "glass",
      panelAnchor: "bottom",
      titleScale: "balanced",
      typographyPreset: "studio-sans",
      showClock: true,
      showNextItem: true,
      showScheduleTeaser: true,
      showCurrentCategory: true,
      showSourceLabel: true,
      showQueuePreview: false,
      queuePreviewCount: 3,
      layerOrder: normalizeOverlaySceneLayerOrder([]),
      disabledLayers: [],
      customLayers: [],
      emergencyBanner: "",
      tickerText: "",
      updatedAt: ""
    },
    managedConfig: {
      appUrl: "",
      channelTimezone: "",
      twitchClientId: "",
      twitchClientSecret: "",
      twitchDefaultCategoryId: "",
      twitchBroadcastChannelLogin: "",
      discordWebhookUrl: "",
      smtpHost: "",
      smtpPort: "",
      smtpUser: "",
      smtpPassword: "",
      smtpFrom: "",
      alertEmailTo: "",
      ffmpegPreset: "",
      ffmpegMaxrate: "",
      ffmpegBufsize: "",
      ffmpegAudioBitrate: "",
      diskWatermarkEnabled: "",
      diskWatermarkTriggerPercent: "",
      diskWatermarkRecoverPercent: "",
      systemVolumeTriggerPercent: "",
      systemVolumeRecoverPercent: "",
      assetRetentionEnabled: "",
      assetRetentionProtectionDays: "",
      streamChatOverlayEnabled: "",
      streamAlertsEnabled: "",
      twitchScheduleSyncEnabled: "",
      sourceLayerEnabled: "",
      sourceSnapshotIntervalSeconds: "",
      sourceLiveEnabled: "",
      sourceLiveGainPercent: "",
      vodCacheEnabled: "",
      vodCacheAllowRemoteFallback: "",
      vodCacheMaxGb: "",
      vodCacheMinFreeGb: "",
      vodCacheMaxAssetGb: "",
      vodCacheRetentionHours: "",
      vodCachePartialMaxAgeHours: "",
      vodCacheDownloadTimeoutSeconds: "",
      vodCacheFailureCooldownSeconds: "",
      vodCacheLimitRate: "",
      feedAudioSilenceSeconds: "",
      feedAudioGraceSeconds: "",
      feedStallTimeoutSeconds: "",
      feedStallGraceSeconds: "",
      uplinkStallTimeoutSeconds: "",
      uplinkStallGraceSeconds: "",
      uplinkNoProgressRestartSeconds: "",
      durationBoundMarginSeconds: "",
      playoutReconnectHours: "",
      playoutReconnectWindowSeconds: "",
      programFeedTargetSeconds: "",
      programFeedListSize: "",
      programFeedFailoverSeconds: "",
      twitchEventsubSecret: "",
      updatedAt: ""
    },
    output: {
      profileId: "720p30",
      width: 1280,
      height: 720,
      fps: 30,
      updatedAt: ""
    },
    engagement: {
      chatEnabled: false,
      alertsEnabled: false,
      donationsEnabled: true,
      channelPointsEnabled: true,
      gameEnabled: false,
      soloModeEnabled: true,
      smallGroupModeEnabled: true,
      crowdModeEnabled: true,
      gameWindowMinutes: 10,
      chatMode: "quiet",
      chatPosition: "bottom-left",
      alertPosition: "top-right",
      style: "compact",
      maxMessages: 5,
      rateLimitPerMinute: 30,
      updatedAt: ""
    },
    engagementGame: {
      mode: "",
      activeChatterCount: 0,
      modeChangedAt: "",
      updatedAt: ""
    },
    engagementEvents: [],
    twitch: {
      status: "not-connected",
      broadcasterId: "",
      broadcasterLogin: "",
      accessToken: "",
      refreshToken: "",
      connectedAt: "",
      tokenExpiresAt: "",
      lastRefreshAt: "",
      lastMetadataSyncAt: "",
      lastSyncedTitle: "",
      lastSyncedCategoryName: "",
      lastSyncedCategoryId: "",
      lastScheduleSyncAt: "",
      liveStatus: "unknown",
      viewerCount: 0,
      startedAt: "",
      error: ""
    },
    twitchBroadcaster: {
      status: "not-connected",
      broadcasterId: "",
      broadcasterLogin: "",
      accessToken: "",
      refreshToken: "",
      connectedAt: "",
      tokenExpiresAt: "",
      lastRefreshAt: "",
      error: ""
    },
    twitchScheduleSegments: [],
    pools: [],
    showProfiles: [],
    scheduleBlocks: [],
    sources: [],
    assets: [],
    assetCollections: [],
    sourceSyncRuns: [],
    destinations: [
      {
        id: "destination-primary",
        provider: "twitch",
        role: "primary",
        priority: 0,
        outputProfileId: "inherit",
        name: "Primary Twitch Output",
        enabled: true,
        rtmpUrl: process.env.STREAM_OUTPUT_URL || process.env.TWITCH_RTMP_URL || "rtmp://live.twitch.tv/app",
        streamKeyPresent: Boolean(process.env.STREAM_OUTPUT_KEY || process.env.TWITCH_STREAM_KEY),
        streamKeySource: process.env.STREAM_OUTPUT_KEY || process.env.TWITCH_STREAM_KEY ? "env" : "missing",
        status: process.env.STREAM_OUTPUT_KEY || process.env.TWITCH_STREAM_KEY ? "ready" : "missing-config",
        notes: "Primary RTMP destination for the broadcast runtime.",
        lastValidatedAt: "",
        lastFailureAt: "",
        failureCount: 0,
        lastError: ""
      },
      {
        id: "destination-backup",
        provider: "custom-rtmp",
        role: "backup",
        priority: 10,
        outputProfileId: "inherit",
        name: "Backup RTMP Output",
        enabled: Boolean(process.env.BACKUP_STREAM_OUTPUT_URL || process.env.BACKUP_TWITCH_RTMP_URL),
        rtmpUrl: process.env.BACKUP_STREAM_OUTPUT_URL || process.env.BACKUP_TWITCH_RTMP_URL || "",
        streamKeyPresent: Boolean(process.env.BACKUP_STREAM_OUTPUT_KEY || process.env.BACKUP_TWITCH_STREAM_KEY),
        streamKeySource:
          process.env.BACKUP_STREAM_OUTPUT_KEY || process.env.BACKUP_TWITCH_STREAM_KEY ? "env" : "missing",
        status:
          process.env.BACKUP_STREAM_OUTPUT_URL || process.env.BACKUP_TWITCH_RTMP_URL
            ? process.env.BACKUP_STREAM_OUTPUT_KEY || process.env.BACKUP_TWITCH_STREAM_KEY
              ? "ready"
              : "missing-config"
            : "missing-config",
        notes: "Backup RTMP destination used when the primary output is unavailable or disabled.",
        lastValidatedAt: "",
        lastFailureAt: "",
        failureCount: 0,
        lastError: ""
      }
    ],
    incidents: [],
    auditEvents: [],
    playout: {
      status: "idle",
      transitionState: "idle",
      queueVersion: 0,
      transitionTargetKind: "",
      transitionTargetAssetId: "",
      transitionTargetTitle: "",
      transitionReadyAt: "",
      currentAssetId: "",
      currentTitle: "",
      previousAssetId: "",
      previousTitle: "",
      desiredAssetId: "",
      nextAssetId: "",
      nextTitle: "",
      queuedAssetIds: [],
      queueItems: [],
      prefetchedAssetId: "",
      prefetchedTitle: "",
      prefetchedAt: "",
      prefetchStatus: "",
      prefetchError: "",
      currentDestinationId: "destination-primary",
      restartRequestedAt: "",
      heartbeatAt: "",
      workerHeartbeatAt: "",
      processPid: 0,
      processStartedAt: "",
      lastTransitionAt: "",
      lastSuccessfulStartAt: "",
      lastSuccessfulAssetId: "",
      lastExitCode: "",
      restartCount: 0,
      crashCountWindow: 0,
      crashLoopDetected: false,
      lastError: "",
      lastStderrSample: "",
      selectionReasonCode: "",
      fallbackTier: "none",
      overrideMode: "schedule",
      overrideAssetId: "",
      overrideUntil: "",
      liveBridgeInputType: "",
      liveBridgeInputUrl: "",
      liveBridgeLabel: "",
      liveBridgeStatus: "",
      liveBridgeRequestedAt: "",
      liveBridgeStartedAt: "",
      liveBridgeReleasedAt: "",
      liveBridgeLastError: "",
      cuepointWindowKey: "",
      cuepointFiredKeys: [],
      cuepointLastTriggeredAt: "",
      cuepointLastAssetId: "",
      manualNextAssetId: "",
      manualNextRequestedAt: "",
      insertAssetId: "",
      insertRequestedAt: "",
      insertStatus: "",
      skipAssetId: "",
      skipUntil: "",
      pendingAction: "",
      pendingActionRequestedAt: "",
      uplinkStatus: "",
      uplinkInputMode: "",
      uplinkStartedAt: "",
      uplinkHeartbeatAt: "",
      uplinkDestinationIds: [],
      uplinkRestartCount: 0,
      uplinkUnplannedRestartCount: 0,
      uplinkLastExitCode: "",
      uplinkLastExitReason: "",
      uplinkLastExitPlanned: false,
      uplinkReconnectUntil: "",
      programFeedStatus: "",
      programFeedUpdatedAt: "",
      programFeedPlaylistPath: "",
      programFeedTargetSeconds: 0,
      programFeedBufferedSeconds: 0,
      message: "Playout engine has not started yet."
    }
  };
}

function createInitialSeedState(): AppState {
  const state = defaultState();
  return {
    ...state,
    pools: [
      {
        id: "pool-archive",
        name: "Archive Pool",
        sourceIds: ["source-twitch", "source-youtube"],
        playbackMode: "round-robin",
        cursorAssetId: "",
        insertAssetId: "",
        insertEveryItems: 0,
        itemsSinceInsert: 0,
        audioLaneAssetId: "",
        audioLaneVolumePercent: 100,
        updatedAt: ""
      }
    ],
    scheduleBlocks: [
      {
        id: "morning-vods",
        title: "Morning Twitch VOD Rotation",
        categoryName: "Just Chatting",
        dayOfWeek: 1,
        startMinuteOfDay: 6 * 60,
        durationMinutes: 240,
        poolId: "pool-archive",
        sourceName: "Twitch Archive"
      },
      {
        id: "playlist-prime",
        title: "Prime Time YouTube Playlist",
        categoryName: "Music",
        dayOfWeek: 5,
        startMinuteOfDay: 18 * 60,
        durationMinutes: 360,
        poolId: "pool-archive",
        sourceName: "YouTube Playlist"
      }
    ],
    sources: [
      {
        id: "source-youtube",
        name: "YouTube Playlist",
        type: "Managed ingestion",
        connectorKind: "youtube-playlist",
        enabled: true,
        status: "Planned",
        externalUrl: "",
        notes: "Configure a playlist URL when the connector is ready."
      },
      {
        id: "source-twitch",
        name: "Twitch Archive",
        type: "Twitch VOD sync",
        connectorKind: "twitch-vod",
        enabled: true,
        status: "Planned",
        externalUrl: "",
        notes: "Configure a VOD URL when the connector is ready."
      },
      {
        id: "source-local-library",
        name: "Local Media Library",
        type: "Filesystem scan",
        connectorKind: "local-library",
        enabled: true,
        status: "Pending scan",
        externalUrl: "",
        notes: "Scans files mounted into the media library volume."
      }
    ],
    assets: []
  };
}

/**
 * Best-effort connector kind for a source record that predates the field.
 *
 * Guesses from the human-readable type rather than defaulting everything to the local library,
 * because mislabelling a Twitch or YouTube source as local would make the worker try to scan it
 * off disk. Falls back to the same value as the column default.
 */
/**
 * Fills in the source fields the database requires but older records may not carry.
 *
 * `connector_kind` is NOT NULL and an explicit null bypasses the column default, so a legacy record
 * without it aborted the first state write and left persistence in "error" permanently — the
 * workspace could not be bootstrapped at all.
 */
export function normalizeSourceRecords(sources: SourceRecord[]): SourceRecord[] {
  return sources.map((source) => ({
    ...source,
    enabled: source.enabled ?? true,
    connectorKind: source.connectorKind ?? inferConnectorKind(source)
  }));
}

function inferConnectorKind(source: Partial<SourceRecord>): SourceRecord["connectorKind"] {
  const haystack = `${source.type ?? ""} ${source.name ?? ""}`.toLowerCase();

  if (haystack.includes("twitch")) {
    return haystack.includes("channel") ? "twitch-channel" : "twitch-vod";
  }
  if (haystack.includes("youtube")) {
    return haystack.includes("channel") ? "youtube-channel" : "youtube-playlist";
  }
  if (haystack.includes("url") || haystack.includes("direct")) {
    return "direct-media";
  }

  return "local-library";
}

function normalizeState(state: AppState): AppState {
  const defaults = defaultState();
  const localOwnerUser = state.users.find((user) => user.role === "owner" && user.authProvider === "local");

  const dedupeById = <T extends { id: string }>(items: T[]): T[] => {
    const seen = new Set<string>();
    return items.filter((item) => {
      if (seen.has(item.id)) {
        return false;
      }
      seen.add(item.id);
      return true;
    });
  };

  const owner =
    state.owner ??
    (localOwnerUser?.passwordHash
      ? {
          email: localOwnerUser.email,
          passwordHash: localOwnerUser.passwordHash,
          createdAt: localOwnerUser.createdAt
        }
      : null);

  const normalizedAssets = Array.isArray(state.assets)
    ? dedupeById(state.assets).map((asset) => ({
        ...asset,
        title: normalizeAssetTitle(asset.title),
        folderPath: asset.folderPath ?? "",
        tags: normalizeAssetTags(asset.tags ?? []),
        titlePrefix: normalizeAssetTitlePrefix(asset.titlePrefix ?? ""),
        hashtagsJson: normalizeAssetHashtagsJson(asset.hashtagsJson ?? "[]"),
        platformNotes: normalizeAssetPlatformNotes(asset.platformNotes ?? ""),
        chaptersJson: normalizeAssetChaptersJson(asset.chaptersJson ?? "[]"),
        chaptersProbeStatus: normalizeAssetChapterProbeStatus(asset.chaptersProbeStatus),
        chaptersProbedAt: asset.chaptersProbedAt ?? "",
        includeInProgramming: asset.includeInProgramming ?? true,
        cachePath: asset.cachePath ?? "",
        cacheStatus: asset.cacheStatus ?? "",
        cacheUpdatedAt: asset.cacheUpdatedAt ?? "",
        cacheError: asset.cacheError ?? "",
        externalId: asset.externalId ?? "",
        categoryName: normalizeAssetCategoryName(asset.categoryName ?? ""),
        durationSeconds: asset.durationSeconds ?? 0,
        publishedAt: asset.publishedAt ?? "",
        fallbackPriority: asset.fallbackPriority ?? 100,
        isGlobalFallback: asset.isGlobalFallback ?? false
      }))
    : [];
  const assetIdSet = new Set(normalizedAssets.map((asset) => asset.id));
  const normalizedAssetCollections = Array.isArray(state.assetCollections)
    ? dedupeById(state.assetCollections).map((collection) => ({
        ...collection,
        name: normalizeAssetCollectionName(collection.name),
        description: normalizeAssetCollectionDescription(collection.description),
        color: normalizeAssetCollectionColor(collection.color),
        assetIds: Array.isArray(collection.assetIds)
          ? [...new Set(collection.assetIds.map((id) => String(id).trim()).filter((id) => assetIdSet.has(id)))]
          : [],
        createdAt: collection.createdAt ?? "",
        updatedAt: collection.updatedAt ?? ""
      }))
    : [];

  return {
    ...defaults,
    ...state,
    owner,
    moderation: {
      ...defaults.moderation,
      ...(state.moderation ?? {})
    },
    overlay: {
      ...normalizeOverlaySettingsRecord({
        ...defaults.overlay,
        ...(state.overlay ?? {})
      }),
      updatedAt: state.overlay?.updatedAt ?? defaults.overlay.updatedAt
    },
    managedConfig: {
      ...defaults.managedConfig,
      ...(state.managedConfig ?? {})
    },
    output: normalizeOutputSettingsRecord((state as AppState & { output?: Partial<OutputSettingsRecord> }).output ?? defaults.output),
    engagement: normalizeEngagementSettingsRecord(
      (state as AppState & { engagement?: Partial<EngagementSettingsRecord> }).engagement ?? defaults.engagement
    ),
    engagementGame: normalizeEngagementGameRuntimeRecord(
      (state as AppState & { engagementGame?: Partial<EngagementGameRuntimeRecord> }).engagementGame ?? defaults.engagementGame
    ),
    engagementEvents: Array.isArray((state as AppState & { engagementEvents?: Partial<EngagementEventRecord>[] }).engagementEvents)
      ? (state as AppState & { engagementEvents?: Partial<EngagementEventRecord>[] }).engagementEvents
          .map((event) => normalizeEngagementEventRecord(event))
          .slice(0, 100)
      : [],
    twitch: {
      ...defaults.twitch,
      ...(state.twitch ?? {}),
      liveStatus:
        state.twitch?.liveStatus === "live" || state.twitch?.liveStatus === "offline" || state.twitch?.liveStatus === "unknown"
          ? state.twitch.liveStatus
          : defaults.twitch.liveStatus,
      viewerCount: Math.max(0, Number(state.twitch?.viewerCount ?? defaults.twitch.viewerCount) || defaults.twitch.viewerCount),
      startedAt: String(state.twitch?.startedAt ?? defaults.twitch.startedAt ?? "")
    },
    twitchBroadcaster: {
      ...defaults.twitchBroadcaster,
      ...(state.twitchBroadcaster ?? {})
    },
    twitchScheduleSegments: Array.isArray(state.twitchScheduleSegments) ? state.twitchScheduleSegments : [],
    users: Array.isArray(state.users) ? dedupeById(state.users) : [],
    teamAccessGrants: Array.isArray(state.teamAccessGrants) ? dedupeById(state.teamAccessGrants) : [],
    presenceWindows: Array.isArray(state.presenceWindows)
      ? state.presenceWindows
          .map((window) => {
            const appliedMinutes = Math.max(1, Math.round(Number(window.appliedMinutes ?? window.minutes ?? 0) || 0));
            const requestedMinutesValue = window.requestedMinutes;
            const requestedMinutes =
              typeof requestedMinutesValue === "number" && Number.isFinite(requestedMinutesValue)
                ? Math.max(1, Math.round(requestedMinutesValue))
                : null;

            return {
              actor: sanitizeStoredText(window.actor, 80) || "unknown",
              minutes: appliedMinutes,
              requestedMinutes,
              appliedMinutes,
              clampReason: normalizePresenceClampReason(window.clampReason),
              createdAt: String(window.createdAt ?? ""),
              expiresAt: String(window.expiresAt ?? "")
            };
          })
          .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
          .slice(0, 100)
      : [],
    pools: Array.isArray(state.pools)
      ? dedupeById(state.pools).map((pool) => ({
          ...pool,
          sourceIds: Array.isArray(pool.sourceIds) ? [...new Set(pool.sourceIds)] : [],
          playbackMode: "round-robin",
          insertAssetId: pool.insertAssetId ?? "",
          insertEveryItems: typeof pool.insertEveryItems === "number" ? Math.max(0, pool.insertEveryItems) : 0,
          itemsSinceInsert: typeof pool.itemsSinceInsert === "number" ? Math.max(0, pool.itemsSinceInsert) : 0,
          audioLaneAssetId: pool.audioLaneAssetId ?? "",
          audioLaneVolumePercent: normalizeAudioLaneVolumePercent(pool.audioLaneVolumePercent ?? 100)
        }))
      : [],
    showProfiles: Array.isArray(state.showProfiles)
      ? dedupeById(state.showProfiles).map((show) => ({
          ...show,
          categoryName: show.categoryName ?? "",
          defaultDurationMinutes: show.defaultDurationMinutes ?? 60,
          color: show.color ?? "#0e6d5a",
          description: show.description ?? "",
          updatedAt: show.updatedAt ?? ""
        }))
      : [],
    scheduleBlocks: Array.isArray(state.scheduleBlocks)
      ? dedupeById(state.scheduleBlocks).map((block) => ({
          ...block,
          dayOfWeek: typeof block.dayOfWeek === "number" ? block.dayOfWeek : 0,
          showId: block.showId ?? "",
          poolId: block.poolId ?? "",
          repeatMode:
            block.repeatMode === "daily" ||
            block.repeatMode === "weekdays" ||
            block.repeatMode === "weekends" ||
            block.repeatMode === "custom"
              ? block.repeatMode
              : "single",
          repeatGroupId: block.repeatGroupId ?? "",
          cuepointAssetId: block.cuepointAssetId ?? "",
          cuepointOffsetsSeconds: normalizeCuepointOffsetsSeconds(block.cuepointOffsetsSeconds ?? [], block.durationMinutes),
          startMinuteOfDay:
            typeof (block as ScheduleBlockRecord & { startHour?: number }).startMinuteOfDay === "number"
              ? block.startMinuteOfDay
              : (((block as ScheduleBlockRecord & { startHour?: number }).startHour ?? 0) % 24) * 60
        }))
      : [],
    sources: Array.isArray(state.sources) ? normalizeSourceRecords(dedupeById(state.sources)) : [],
    assets: normalizedAssets,
    assetCollections: normalizedAssetCollections,
    sourceSyncRuns: Array.isArray((state as AppState & { sourceSyncRuns?: SourceSyncRunRecord[] }).sourceSyncRuns)
      ? dedupeById((state as AppState & { sourceSyncRuns?: SourceSyncRunRecord[] }).sourceSyncRuns ?? [])
          .sort((left, right) => new Date(right.finishedAt || right.startedAt).getTime() - new Date(left.finishedAt || left.startedAt).getTime())
          .slice(0, 250)
      : [],
    destinations: Array.isArray(state.destinations)
      ? normalizeDestinationRecords(state.destinations, defaults.destinations)
      : defaults.destinations,
    incidents: Array.isArray(state.incidents) ? dedupeById(state.incidents) : [],
    auditEvents: Array.isArray(state.auditEvents) ? state.auditEvents : [],
    playout: {
      ...defaults.playout,
      ...(state.playout ?? {}),
      liveBridgeInputType:
        state.playout?.liveBridgeInputType === "rtmp" || state.playout?.liveBridgeInputType === "hls"
          ? state.playout.liveBridgeInputType
          : "",
      liveBridgeStatus:
        state.playout?.liveBridgeStatus === "pending" ||
        state.playout?.liveBridgeStatus === "active" ||
        state.playout?.liveBridgeStatus === "releasing" ||
        state.playout?.liveBridgeStatus === "error"
          ? state.playout.liveBridgeStatus
          : "",
      cuepointFiredKeys: Array.isArray(state.playout?.cuepointFiredKeys)
        ? [...new Set(state.playout?.cuepointFiredKeys.map((entry) => String(entry).trim()).filter(Boolean))]
        : defaults.playout.cuepointFiredKeys,
      queueItems: Array.isArray(state.playout?.queueItems)
        ? state.playout.queueItems.map((item, index) => ({
            id: item.id ?? `queue-${index}`,
            kind:
              item.kind === "insert" ||
              item.kind === "reconnect" ||
              item.kind === "standby" ||
              item.kind === "live" ||
              item.kind === "asset"
                ? item.kind
                : "asset",
            assetId: item.assetId ?? "",
            title: item.title ?? "",
            subtitle: item.subtitle ?? "",
            scenePreset: item.scenePreset ?? "",
            position: typeof item.position === "number" ? item.position : index
          }))
        : defaults.playout.queueItems
    }
  };
}

async function applyCurrentSchemaDefinition(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS system_state (
      singleton_id SMALLINT PRIMARY KEY DEFAULT 1,
      initialized BOOLEAN NOT NULL DEFAULT FALSE,
      owner_email TEXT NOT NULL DEFAULT '',
      owner_password_hash TEXT NOT NULL DEFAULT '',
      owner_created_at TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      display_name TEXT NOT NULL,
      auth_provider TEXT NOT NULL,
      role TEXT NOT NULL,
      twitch_user_id TEXT NOT NULL DEFAULT '',
      twitch_login TEXT NOT NULL DEFAULT '',
      password_hash TEXT NOT NULL DEFAULT '',
      two_factor_enabled BOOLEAN NOT NULL DEFAULT FALSE,
      two_factor_secret TEXT NOT NULL DEFAULT '',
      two_factor_confirmed_at TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      last_login_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS team_access_grants (
      id TEXT PRIMARY KEY,
      twitch_login TEXT NOT NULL,
      role TEXT NOT NULL,
      created_at TEXT NOT NULL,
      created_by TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS moderation_settings (
      singleton_id SMALLINT PRIMARY KEY DEFAULT 1,
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      command TEXT NOT NULL DEFAULT 'here',
      default_minutes INTEGER NOT NULL DEFAULT 30,
      min_minutes INTEGER NOT NULL DEFAULT 5,
      max_minutes INTEGER NOT NULL DEFAULT 240,
      require_prefix BOOLEAN NOT NULL DEFAULT FALSE,
      fallback_emote_only BOOLEAN NOT NULL DEFAULT TRUE
    );

    CREATE TABLE IF NOT EXISTS presence_windows (
      id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      actor TEXT NOT NULL,
      minutes INTEGER NOT NULL,
      requested_minutes INTEGER,
      applied_minutes INTEGER NOT NULL DEFAULT 0,
      clamp_reason TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS overlay_settings (
      singleton_id SMALLINT PRIMARY KEY DEFAULT 1,
      enabled BOOLEAN NOT NULL DEFAULT FALSE,
      channel_name TEXT NOT NULL DEFAULT 'Stream247',
      headline TEXT NOT NULL DEFAULT 'Always on air',
      insert_headline TEXT NOT NULL DEFAULT 'Insert on air',
      standby_headline TEXT NOT NULL DEFAULT 'Please wait, restream is starting',
      reconnect_headline TEXT NOT NULL DEFAULT 'Scheduled reconnect in progress',
      replay_label TEXT NOT NULL DEFAULT 'Replay stream',
      brand_badge TEXT NOT NULL DEFAULT '',
      scene_preset TEXT NOT NULL DEFAULT 'replay-lower-third',
      insert_scene_preset TEXT NOT NULL DEFAULT 'bumper-board',
      standby_scene_preset TEXT NOT NULL DEFAULT 'standby-board',
      reconnect_scene_preset TEXT NOT NULL DEFAULT 'reconnect-board',
      accent_color TEXT NOT NULL DEFAULT '#0e6d5a',
      surface_style TEXT NOT NULL DEFAULT 'glass',
      panel_anchor TEXT NOT NULL DEFAULT 'bottom',
      title_scale TEXT NOT NULL DEFAULT 'balanced',
      typography_preset TEXT NOT NULL DEFAULT 'studio-sans',
      show_clock BOOLEAN NOT NULL DEFAULT TRUE,
      show_next_item BOOLEAN NOT NULL DEFAULT TRUE,
      show_schedule_teaser BOOLEAN NOT NULL DEFAULT TRUE,
      show_current_category BOOLEAN NOT NULL DEFAULT TRUE,
      show_source_label BOOLEAN NOT NULL DEFAULT TRUE,
      show_queue_preview BOOLEAN NOT NULL DEFAULT FALSE,
      queue_preview_count INTEGER NOT NULL DEFAULT 3,
      layer_order_json TEXT NOT NULL DEFAULT '[]',
      disabled_layers_json TEXT NOT NULL DEFAULT '[]',
      custom_layers_json TEXT NOT NULL DEFAULT '[]',
      emergency_banner TEXT NOT NULL DEFAULT '',
      ticker_text TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS overlay_drafts (
      singleton_id SMALLINT PRIMARY KEY DEFAULT 1,
      enabled BOOLEAN NOT NULL DEFAULT FALSE,
      channel_name TEXT NOT NULL DEFAULT 'Stream247',
      headline TEXT NOT NULL DEFAULT 'Always on air',
      insert_headline TEXT NOT NULL DEFAULT 'Insert on air',
      standby_headline TEXT NOT NULL DEFAULT 'Please wait, restream is starting',
      reconnect_headline TEXT NOT NULL DEFAULT 'Scheduled reconnect in progress',
      replay_label TEXT NOT NULL DEFAULT 'Replay stream',
      brand_badge TEXT NOT NULL DEFAULT '',
      scene_preset TEXT NOT NULL DEFAULT 'replay-lower-third',
      insert_scene_preset TEXT NOT NULL DEFAULT 'bumper-board',
      standby_scene_preset TEXT NOT NULL DEFAULT 'standby-board',
      reconnect_scene_preset TEXT NOT NULL DEFAULT 'reconnect-board',
      accent_color TEXT NOT NULL DEFAULT '#0e6d5a',
      surface_style TEXT NOT NULL DEFAULT 'glass',
      panel_anchor TEXT NOT NULL DEFAULT 'bottom',
      title_scale TEXT NOT NULL DEFAULT 'balanced',
      typography_preset TEXT NOT NULL DEFAULT 'studio-sans',
      show_clock BOOLEAN NOT NULL DEFAULT TRUE,
      show_next_item BOOLEAN NOT NULL DEFAULT TRUE,
      show_schedule_teaser BOOLEAN NOT NULL DEFAULT TRUE,
      show_current_category BOOLEAN NOT NULL DEFAULT TRUE,
      show_source_label BOOLEAN NOT NULL DEFAULT TRUE,
      show_queue_preview BOOLEAN NOT NULL DEFAULT FALSE,
      queue_preview_count INTEGER NOT NULL DEFAULT 3,
      layer_order_json TEXT NOT NULL DEFAULT '[]',
      disabled_layers_json TEXT NOT NULL DEFAULT '[]',
      custom_layers_json TEXT NOT NULL DEFAULT '[]',
      emergency_banner TEXT NOT NULL DEFAULT '',
      ticker_text TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT '',
      based_on_updated_at TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS overlay_scene_presets (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      overlay_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS managed_config (
      singleton_id SMALLINT PRIMARY KEY DEFAULT 1,
      encrypted_payload TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS output_settings (
      singleton_id SMALLINT PRIMARY KEY DEFAULT 1,
      profile_id TEXT NOT NULL DEFAULT '720p30',
      width INTEGER NOT NULL DEFAULT 1280,
      height INTEGER NOT NULL DEFAULT 720,
      fps INTEGER NOT NULL DEFAULT 30,
      updated_at TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS engagement_settings (
      singleton_id SMALLINT PRIMARY KEY DEFAULT 1,
      chat_enabled BOOLEAN NOT NULL DEFAULT FALSE,
      alerts_enabled BOOLEAN NOT NULL DEFAULT FALSE,
      donations_enabled BOOLEAN NOT NULL DEFAULT TRUE,
      channel_points_enabled BOOLEAN NOT NULL DEFAULT TRUE,
      game_enabled BOOLEAN NOT NULL DEFAULT FALSE,
      solo_mode_enabled BOOLEAN NOT NULL DEFAULT TRUE,
      small_group_mode_enabled BOOLEAN NOT NULL DEFAULT TRUE,
      crowd_mode_enabled BOOLEAN NOT NULL DEFAULT TRUE,
      game_window_minutes INTEGER NOT NULL DEFAULT 10,
      chat_mode TEXT NOT NULL DEFAULT 'quiet',
      chat_position TEXT NOT NULL DEFAULT 'bottom-left',
      alert_position TEXT NOT NULL DEFAULT 'top-right',
      style TEXT NOT NULL DEFAULT 'compact',
      max_messages INTEGER NOT NULL DEFAULT 5,
      rate_limit_per_minute INTEGER NOT NULL DEFAULT 30,
      updated_at TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS engagement_game_runtime (
      singleton_id SMALLINT PRIMARY KEY DEFAULT 1,
      active_chatter_count INTEGER NOT NULL DEFAULT 0,
      mode TEXT NOT NULL DEFAULT '',
      mode_changed_at TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS engagement_events (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      actor TEXT NOT NULL DEFAULT '',
      message TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chat_game_settings (
      singleton_id SMALLINT PRIMARY KEY DEFAULT 1,
      game_id TEXT NOT NULL DEFAULT 'snake',
      grid_width INTEGER NOT NULL DEFAULT 16,
      grid_height INTEGER NOT NULL DEFAULT 9,
      emote_up TEXT NOT NULL DEFAULT '⬆',
      emote_down TEXT NOT NULL DEFAULT '⬇',
      emote_left TEXT NOT NULL DEFAULT '⬅',
      emote_right TEXT NOT NULL DEFAULT '➡',
      updated_at TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS chat_game_runtime (
      singleton_id SMALLINT PRIMARY KEY DEFAULT 1,
      game_id TEXT NOT NULL DEFAULT '',
      settings_key TEXT NOT NULL DEFAULT '',
      settings JSONB NOT NULL DEFAULT '{}'::jsonb,
      state JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TEXT NOT NULL DEFAULT ''
    );

    -- One row: the running skip campaign. The worker tallies !skip in memory and flushes only the
    -- numbers here so the playout container can draw progress; who voted stays in the worker, both
    -- because the overlay never needs identities and because this table should not become a second
    -- place viewer handles are stored. votes_needed is written rather than derived: it depends on
    -- the active-chatter count only the worker knows.
    CREATE TABLE IF NOT EXISTS chat_skip_vote (
      singleton_id SMALLINT PRIMARY KEY DEFAULT 1,
      asset_id TEXT NOT NULL DEFAULT '',
      skip_command TEXT NOT NULL DEFAULT 'skip',
      votes INTEGER NOT NULL DEFAULT 0,
      votes_needed INTEGER NOT NULL DEFAULT 0,
      started_at TEXT NOT NULL DEFAULT '',
      expires_at TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT ''
    );

    -- One row: the chat messages the on-air overlay may draw. The worker's chat bridge keeps the
    -- live ring buffer in memory and flushes a display projection here so the playout container
    -- can render it — the same boundary chat_vote_session and chat_skip_vote cross. Only what the
    -- frame shows is stored: display name, text, timestamp. No user ids, no logins, no message
    -- ids — moderation removals happen in the worker's buffer and reach this row as the next
    -- flush of its contents.
    CREATE TABLE IF NOT EXISTS chat_overlay_messages (
      singleton_id SMALLINT PRIMARY KEY DEFAULT 1,
      enabled BOOLEAN NOT NULL DEFAULT FALSE,
      position TEXT NOT NULL DEFAULT 'bottom-left',
      max_messages INTEGER NOT NULL DEFAULT 5,
      messages JSONB NOT NULL DEFAULT '[]'::jsonb,
      updated_at TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS twitch_connection (
      singleton_id SMALLINT PRIMARY KEY DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'not-connected',
      broadcaster_id TEXT NOT NULL DEFAULT '',
      broadcaster_login TEXT NOT NULL DEFAULT '',
      access_token TEXT NOT NULL DEFAULT '',
      refresh_token TEXT NOT NULL DEFAULT '',
      connected_at TEXT NOT NULL DEFAULT '',
      token_expires_at TEXT NOT NULL DEFAULT '',
      last_refresh_at TEXT NOT NULL DEFAULT '',
      last_metadata_sync_at TEXT NOT NULL DEFAULT '',
      last_synced_title TEXT NOT NULL DEFAULT '',
      last_synced_category_name TEXT NOT NULL DEFAULT '',
      last_synced_category_id TEXT NOT NULL DEFAULT '',
      last_schedule_sync_at TEXT NOT NULL DEFAULT '',
      live_status TEXT NOT NULL DEFAULT 'unknown',
      viewer_count INTEGER NOT NULL DEFAULT 0,
      started_at TEXT NOT NULL DEFAULT '',
      error TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS twitch_broadcaster_connection (
      singleton_id SMALLINT PRIMARY KEY DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'not-connected',
      broadcaster_id TEXT NOT NULL DEFAULT '',
      broadcaster_login TEXT NOT NULL DEFAULT '',
      access_token TEXT NOT NULL DEFAULT '',
      refresh_token TEXT NOT NULL DEFAULT '',
      connected_at TEXT NOT NULL DEFAULT '',
      token_expires_at TEXT NOT NULL DEFAULT '',
      last_refresh_at TEXT NOT NULL DEFAULT '',
      error TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS twitch_schedule_segments (
      key TEXT PRIMARY KEY,
      segment_id TEXT NOT NULL,
      block_id TEXT NOT NULL,
      start_time TEXT NOT NULL,
      title TEXT NOT NULL,
      synced_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS schedule_blocks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      category_name TEXT NOT NULL,
      day_of_week INTEGER NOT NULL DEFAULT 0,
      start_hour INTEGER NOT NULL,
      start_minute_of_day INTEGER NOT NULL DEFAULT 0,
      duration_minutes INTEGER NOT NULL,
      show_id TEXT NOT NULL DEFAULT '',
      pool_id TEXT NOT NULL DEFAULT '',
      source_name TEXT NOT NULL,
      repeat_mode TEXT NOT NULL DEFAULT 'single',
      repeat_group_id TEXT NOT NULL DEFAULT '',
      cuepoint_asset_id TEXT NOT NULL DEFAULT '',
      cuepoint_offsets_seconds TEXT NOT NULL DEFAULT '[]'
    );

    CREATE TABLE IF NOT EXISTS pools (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      source_ids TEXT NOT NULL DEFAULT '[]',
      playback_mode TEXT NOT NULL DEFAULT 'round-robin',
      cursor_asset_id TEXT NOT NULL DEFAULT '',
      insert_asset_id TEXT NOT NULL DEFAULT '',
      insert_every_items INTEGER NOT NULL DEFAULT 0,
      items_since_insert INTEGER NOT NULL DEFAULT 0,
      audio_lane_asset_id TEXT NOT NULL DEFAULT '',
      audio_lane_volume_percent INTEGER NOT NULL DEFAULT 100,
      updated_at TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS show_profiles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      category_name TEXT NOT NULL DEFAULT '',
      default_duration_minutes INTEGER NOT NULL DEFAULT 60,
      color TEXT NOT NULL DEFAULT '#0e6d5a',
      description TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS sources (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      connector_kind TEXT NOT NULL DEFAULT 'local-library',
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      status TEXT NOT NULL,
      external_url TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      last_synced_at TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS assets (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL,
      title TEXT NOT NULL,
      path TEXT NOT NULL,
      cache_path TEXT NOT NULL DEFAULT '',
      cache_status TEXT NOT NULL DEFAULT '',
      cache_updated_at TEXT NOT NULL DEFAULT '',
      cache_error TEXT NOT NULL DEFAULT '',
      folder_path TEXT NOT NULL DEFAULT '',
      tags_json TEXT NOT NULL DEFAULT '[]',
      title_prefix TEXT NOT NULL DEFAULT '',
      hashtags_json TEXT NOT NULL DEFAULT '[]',
      platform_notes TEXT NOT NULL DEFAULT '',
      chapters_json TEXT NOT NULL DEFAULT '[]',
      chapters_probe_status TEXT NOT NULL DEFAULT '',
      chapters_probed_at TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL,
      include_in_programming BOOLEAN NOT NULL DEFAULT TRUE,
      external_id TEXT NOT NULL DEFAULT '',
      category_name TEXT NOT NULL DEFAULT '',
      duration_seconds INTEGER NOT NULL DEFAULT 0,
      published_at TEXT NOT NULL DEFAULT '',
      fallback_priority INTEGER NOT NULL DEFAULT 100,
      is_global_fallback BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    -- Bookkeeping for the asset-retention sweep: when each orphaned asset row was FIRST seen
    -- without its source. The protection window counts from this observation, so losing a source
    -- never makes weeks-old assets deletable the same day. Deliberately not a column on assets:
    -- full-state writes and source syncs rewrite that table wholesale and would reset it.
    CREATE TABLE IF NOT EXISTS asset_retention_marks (
      asset_id TEXT PRIMARY KEY,
      orphan_first_seen_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS source_sync_runs (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL,
      started_at TEXT NOT NULL,
      finished_at TEXT NOT NULL,
      status TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      discovered_assets INTEGER NOT NULL DEFAULT 0,
      ready_assets INTEGER NOT NULL DEFAULT 0,
      error_message TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS stream_destinations (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'primary',
      priority INTEGER NOT NULL DEFAULT 0,
      output_profile_id TEXT NOT NULL DEFAULT 'inherit',
      name TEXT NOT NULL,
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      rtmp_url TEXT NOT NULL DEFAULT '',
      stream_key_present BOOLEAN NOT NULL DEFAULT FALSE,
      encrypted_stream_key TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'missing-config',
      notes TEXT NOT NULL DEFAULT '',
      last_validated_at TEXT NOT NULL DEFAULT '',
      last_failure_at TEXT NOT NULL DEFAULT '',
      failure_count INTEGER NOT NULL DEFAULT 0,
      last_error TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS overlay_video_sources (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      url_present BOOLEAN NOT NULL DEFAULT FALSE,
      encrypted_url TEXT NOT NULL DEFAULT '',
      ingest_kind TEXT NOT NULL DEFAULT 'pull',
      encrypted_publish_key TEXT NOT NULL DEFAULT '',
      live_state TEXT NOT NULL DEFAULT '',
      live_state_at TEXT NOT NULL DEFAULT '',
      live_retry_at TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT ''
    );

    -- M57 stage 2: push ingest. Existing installs gain these through migration 20260826_002.
    ALTER TABLE overlay_video_sources ADD COLUMN IF NOT EXISTS ingest_kind TEXT NOT NULL DEFAULT 'pull';
    ALTER TABLE overlay_video_sources ADD COLUMN IF NOT EXISTS encrypted_publish_key TEXT NOT NULL DEFAULT '';

    -- M57 stage 2, Etappe E: the last attach decision the worker made about this source, so the
    -- studio can say in words what the runtime log already says in reasons. Existing installs gain
    -- these through migration 20260826_004. Nothing here is a credential: it is one decision word,
    -- when it was decided, and when a cooldown ends.
    ALTER TABLE overlay_video_sources ADD COLUMN IF NOT EXISTS live_state TEXT NOT NULL DEFAULT '';
    ALTER TABLE overlay_video_sources ADD COLUMN IF NOT EXISTS live_state_at TEXT NOT NULL DEFAULT '';
    ALTER TABLE overlay_video_sources ADD COLUMN IF NOT EXISTS live_retry_at TEXT NOT NULL DEFAULT '';

    -- Self-generated internal secrets (M57 stage 2: the relay key). The database is the one
    -- store the web and worker containers already share, so a value generated by whichever
    -- process boots first is what every other process reads — the app-secret first-boot pattern,
    -- with INSERT .. ON CONFLICT DO NOTHING as the exclusive-create flag. Values are encrypted
    -- with the app-secret-derived key like every other stored credential.
    CREATE TABLE IF NOT EXISTS managed_secrets (
      id TEXT PRIMARY KEY,
      encrypted_value TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS incidents (
      id TEXT PRIMARY KEY,
      scope TEXT NOT NULL,
      severity TEXT NOT NULL,
      status TEXT NOT NULL,
      acknowledged_at TEXT NOT NULL DEFAULT '',
      acknowledged_by TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      fingerprint TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      resolved_at TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS audit_events (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS playout_runtime (
      singleton_id SMALLINT PRIMARY KEY DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'idle',
      transition_state TEXT NOT NULL DEFAULT 'idle',
      queue_version INTEGER NOT NULL DEFAULT 0,
      transition_target_kind TEXT NOT NULL DEFAULT '',
      transition_target_asset_id TEXT NOT NULL DEFAULT '',
      transition_target_title TEXT NOT NULL DEFAULT '',
      transition_ready_at TEXT NOT NULL DEFAULT '',
      current_asset_id TEXT NOT NULL DEFAULT '',
      current_title TEXT NOT NULL DEFAULT '',
      previous_asset_id TEXT NOT NULL DEFAULT '',
      previous_title TEXT NOT NULL DEFAULT '',
      desired_asset_id TEXT NOT NULL DEFAULT '',
      next_asset_id TEXT NOT NULL DEFAULT '',
      next_title TEXT NOT NULL DEFAULT '',
      queued_asset_ids TEXT NOT NULL DEFAULT '[]',
      queue_items TEXT NOT NULL DEFAULT '[]',
      prefetched_asset_id TEXT NOT NULL DEFAULT '',
      prefetched_title TEXT NOT NULL DEFAULT '',
      prefetched_at TEXT NOT NULL DEFAULT '',
      prefetch_status TEXT NOT NULL DEFAULT '',
      prefetch_error TEXT NOT NULL DEFAULT '',
      current_destination_id TEXT NOT NULL DEFAULT '',
      restart_requested_at TEXT NOT NULL DEFAULT '',
      heartbeat_at TEXT NOT NULL DEFAULT '',
      worker_heartbeat_at TEXT NOT NULL DEFAULT '',
      process_pid INTEGER NOT NULL DEFAULT 0,
      process_started_at TEXT NOT NULL DEFAULT '',
      last_transition_at TEXT NOT NULL DEFAULT '',
      last_successful_start_at TEXT NOT NULL DEFAULT '',
      last_successful_asset_id TEXT NOT NULL DEFAULT '',
      last_exit_code TEXT NOT NULL DEFAULT '',
      restart_count INTEGER NOT NULL DEFAULT 0,
      crash_count_window INTEGER NOT NULL DEFAULT 0,
      crash_loop_detected BOOLEAN NOT NULL DEFAULT FALSE,
      last_error TEXT NOT NULL DEFAULT '',
      last_stderr_sample TEXT NOT NULL DEFAULT '',
      selection_reason_code TEXT NOT NULL DEFAULT '',
      fallback_tier TEXT NOT NULL DEFAULT 'none',
      override_mode TEXT NOT NULL DEFAULT 'schedule',
      override_asset_id TEXT NOT NULL DEFAULT '',
      override_until TEXT NOT NULL DEFAULT '',
      live_bridge_input_type TEXT NOT NULL DEFAULT '',
      live_bridge_input_url TEXT NOT NULL DEFAULT '',
      live_bridge_label TEXT NOT NULL DEFAULT '',
      live_bridge_status TEXT NOT NULL DEFAULT '',
      live_bridge_requested_at TEXT NOT NULL DEFAULT '',
      live_bridge_started_at TEXT NOT NULL DEFAULT '',
      live_bridge_released_at TEXT NOT NULL DEFAULT '',
      live_bridge_last_error TEXT NOT NULL DEFAULT '',
      cuepoint_window_key TEXT NOT NULL DEFAULT '',
      cuepoint_fired_keys TEXT NOT NULL DEFAULT '[]',
      cuepoint_last_triggered_at TEXT NOT NULL DEFAULT '',
      cuepoint_last_asset_id TEXT NOT NULL DEFAULT '',
      manual_next_asset_id TEXT NOT NULL DEFAULT '',
      manual_next_requested_at TEXT NOT NULL DEFAULT '',
      insert_asset_id TEXT NOT NULL DEFAULT '',
      insert_requested_at TEXT NOT NULL DEFAULT '',
      insert_status TEXT NOT NULL DEFAULT '',
      skip_asset_id TEXT NOT NULL DEFAULT '',
      skip_until TEXT NOT NULL DEFAULT '',
      pending_action TEXT NOT NULL DEFAULT '',
      pending_action_requested_at TEXT NOT NULL DEFAULT '',
      message TEXT NOT NULL DEFAULT 'Playout engine has not started yet.',
      uplink_status TEXT NOT NULL DEFAULT '',
      uplink_input_mode TEXT NOT NULL DEFAULT '',
      uplink_started_at TEXT NOT NULL DEFAULT '',
      uplink_heartbeat_at TEXT NOT NULL DEFAULT '',
      uplink_destination_ids TEXT NOT NULL DEFAULT '[]',
      uplink_restart_count INTEGER NOT NULL DEFAULT 0,
      uplink_unplanned_restart_count INTEGER NOT NULL DEFAULT 0,
      uplink_last_exit_code TEXT NOT NULL DEFAULT '',
      uplink_last_exit_reason TEXT NOT NULL DEFAULT '',
      uplink_last_exit_planned BOOLEAN NOT NULL DEFAULT FALSE,
      uplink_reconnect_until TEXT NOT NULL DEFAULT '',
      program_feed_status TEXT NOT NULL DEFAULT '',
      program_feed_updated_at TEXT NOT NULL DEFAULT '',
      program_feed_playlist_path TEXT NOT NULL DEFAULT '',
      program_feed_target_seconds INTEGER NOT NULL DEFAULT 0,
      program_feed_buffered_seconds INTEGER NOT NULL DEFAULT 0
    );
  `);

  await client.query(`
    ALTER TABLE twitch_connection ADD COLUMN IF NOT EXISTS token_expires_at TEXT NOT NULL DEFAULT '';
    ALTER TABLE twitch_connection ADD COLUMN IF NOT EXISTS last_refresh_at TEXT NOT NULL DEFAULT '';
    ALTER TABLE twitch_connection ADD COLUMN IF NOT EXISTS last_metadata_sync_at TEXT NOT NULL DEFAULT '';
    ALTER TABLE twitch_connection ADD COLUMN IF NOT EXISTS last_synced_title TEXT NOT NULL DEFAULT '';
    ALTER TABLE twitch_connection ADD COLUMN IF NOT EXISTS last_synced_category_name TEXT NOT NULL DEFAULT '';
    ALTER TABLE twitch_connection ADD COLUMN IF NOT EXISTS last_synced_category_id TEXT NOT NULL DEFAULT '';
    ALTER TABLE twitch_connection ADD COLUMN IF NOT EXISTS last_schedule_sync_at TEXT NOT NULL DEFAULT '';
    ALTER TABLE twitch_connection ADD COLUMN IF NOT EXISTS live_status TEXT NOT NULL DEFAULT 'unknown';
    ALTER TABLE twitch_connection ADD COLUMN IF NOT EXISTS viewer_count INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE twitch_connection ADD COLUMN IF NOT EXISTS started_at TEXT NOT NULL DEFAULT '';
    ALTER TABLE sources ADD COLUMN IF NOT EXISTS connector_kind TEXT NOT NULL DEFAULT 'local-library';
    ALTER TABLE sources ADD COLUMN IF NOT EXISTS external_url TEXT NOT NULL DEFAULT '';
    ALTER TABLE sources ADD COLUMN IF NOT EXISTS notes TEXT NOT NULL DEFAULT '';
    ALTER TABLE stream_destinations ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'primary';
    ALTER TABLE stream_destinations ADD COLUMN IF NOT EXISTS priority INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE stream_destinations ADD COLUMN IF NOT EXISTS output_profile_id TEXT NOT NULL DEFAULT 'inherit';
    ALTER TABLE stream_destinations ADD COLUMN IF NOT EXISTS encrypted_stream_key TEXT NOT NULL DEFAULT '';
    ALTER TABLE stream_destinations ADD COLUMN IF NOT EXISTS last_failure_at TEXT NOT NULL DEFAULT '';
    ALTER TABLE stream_destinations ADD COLUMN IF NOT EXISTS failure_count INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE stream_destinations ADD COLUMN IF NOT EXISTS last_error TEXT NOT NULL DEFAULT '';
    ALTER TABLE assets ADD COLUMN IF NOT EXISTS fallback_priority INTEGER NOT NULL DEFAULT 100;
    ALTER TABLE assets ADD COLUMN IF NOT EXISTS is_global_fallback BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE assets ADD COLUMN IF NOT EXISTS include_in_programming BOOLEAN NOT NULL DEFAULT TRUE;
    ALTER TABLE incidents ADD COLUMN IF NOT EXISTS acknowledged_at TEXT NOT NULL DEFAULT '';
    ALTER TABLE incidents ADD COLUMN IF NOT EXISTS acknowledged_by TEXT NOT NULL DEFAULT '';
    ALTER TABLE overlay_settings ADD COLUMN IF NOT EXISTS enabled BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE overlay_settings ADD COLUMN IF NOT EXISTS channel_name TEXT NOT NULL DEFAULT 'Stream247';
    ALTER TABLE overlay_settings ADD COLUMN IF NOT EXISTS headline TEXT NOT NULL DEFAULT 'Always on air';
    ALTER TABLE overlay_settings ADD COLUMN IF NOT EXISTS insert_headline TEXT NOT NULL DEFAULT 'Insert on air';
    ALTER TABLE overlay_settings ADD COLUMN IF NOT EXISTS standby_headline TEXT NOT NULL DEFAULT 'Please wait, restream is starting';
    ALTER TABLE overlay_settings ADD COLUMN IF NOT EXISTS reconnect_headline TEXT NOT NULL DEFAULT 'Scheduled reconnect in progress';
    ALTER TABLE overlay_settings ADD COLUMN IF NOT EXISTS accent_color TEXT NOT NULL DEFAULT '#0e6d5a';
    ALTER TABLE overlay_settings ADD COLUMN IF NOT EXISTS show_clock BOOLEAN NOT NULL DEFAULT TRUE;
    ALTER TABLE overlay_settings ADD COLUMN IF NOT EXISTS show_next_item BOOLEAN NOT NULL DEFAULT TRUE;
    ALTER TABLE overlay_settings ADD COLUMN IF NOT EXISTS show_schedule_teaser BOOLEAN NOT NULL DEFAULT TRUE;
    ALTER TABLE overlay_settings ADD COLUMN IF NOT EXISTS brand_badge TEXT NOT NULL DEFAULT '';
    ALTER TABLE overlay_settings ADD COLUMN IF NOT EXISTS scene_preset TEXT NOT NULL DEFAULT 'replay-lower-third';
    ALTER TABLE overlay_settings ADD COLUMN IF NOT EXISTS insert_scene_preset TEXT NOT NULL DEFAULT 'bumper-board';
    ALTER TABLE overlay_settings ADD COLUMN IF NOT EXISTS standby_scene_preset TEXT NOT NULL DEFAULT 'standby-board';
    ALTER TABLE overlay_settings ADD COLUMN IF NOT EXISTS reconnect_scene_preset TEXT NOT NULL DEFAULT 'reconnect-board';
    ALTER TABLE overlay_settings ADD COLUMN IF NOT EXISTS surface_style TEXT NOT NULL DEFAULT 'glass';
    ALTER TABLE overlay_settings ADD COLUMN IF NOT EXISTS panel_anchor TEXT NOT NULL DEFAULT 'bottom';
    ALTER TABLE overlay_settings ADD COLUMN IF NOT EXISTS title_scale TEXT NOT NULL DEFAULT 'balanced';
    ALTER TABLE overlay_settings ADD COLUMN IF NOT EXISTS typography_preset TEXT NOT NULL DEFAULT 'studio-sans';
    ALTER TABLE overlay_settings ADD COLUMN IF NOT EXISTS show_current_category BOOLEAN NOT NULL DEFAULT TRUE;
    ALTER TABLE overlay_settings ADD COLUMN IF NOT EXISTS show_source_label BOOLEAN NOT NULL DEFAULT TRUE;
    ALTER TABLE overlay_settings ADD COLUMN IF NOT EXISTS show_queue_preview BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE overlay_settings ADD COLUMN IF NOT EXISTS queue_preview_count INTEGER NOT NULL DEFAULT 3;
    ALTER TABLE overlay_settings ADD COLUMN IF NOT EXISTS layer_order_json TEXT NOT NULL DEFAULT '[]';
    ALTER TABLE overlay_settings ADD COLUMN IF NOT EXISTS disabled_layers_json TEXT NOT NULL DEFAULT '[]';
    ALTER TABLE overlay_settings ADD COLUMN IF NOT EXISTS custom_layers_json TEXT NOT NULL DEFAULT '[]';
    ALTER TABLE overlay_settings ADD COLUMN IF NOT EXISTS emergency_banner TEXT NOT NULL DEFAULT '';
    ALTER TABLE overlay_settings ADD COLUMN IF NOT EXISTS replay_label TEXT NOT NULL DEFAULT 'Replay stream';
    ALTER TABLE overlay_settings ADD COLUMN IF NOT EXISTS ticker_text TEXT NOT NULL DEFAULT '';
    ALTER TABLE overlay_settings ADD COLUMN IF NOT EXISTS updated_at TEXT NOT NULL DEFAULT '';
    ALTER TABLE overlay_drafts ADD COLUMN IF NOT EXISTS enabled BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE overlay_drafts ADD COLUMN IF NOT EXISTS channel_name TEXT NOT NULL DEFAULT 'Stream247';
    ALTER TABLE overlay_drafts ADD COLUMN IF NOT EXISTS headline TEXT NOT NULL DEFAULT 'Always on air';
    ALTER TABLE overlay_drafts ADD COLUMN IF NOT EXISTS insert_headline TEXT NOT NULL DEFAULT 'Insert on air';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS two_factor_enabled BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS two_factor_secret TEXT NOT NULL DEFAULT '';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS two_factor_confirmed_at TEXT NOT NULL DEFAULT '';
    ALTER TABLE overlay_drafts ADD COLUMN IF NOT EXISTS standby_headline TEXT NOT NULL DEFAULT 'Please wait, restream is starting';
    ALTER TABLE overlay_drafts ADD COLUMN IF NOT EXISTS reconnect_headline TEXT NOT NULL DEFAULT 'Scheduled reconnect in progress';
    ALTER TABLE overlay_drafts ADD COLUMN IF NOT EXISTS accent_color TEXT NOT NULL DEFAULT '#0e6d5a';
    ALTER TABLE overlay_drafts ADD COLUMN IF NOT EXISTS show_clock BOOLEAN NOT NULL DEFAULT TRUE;
    ALTER TABLE overlay_drafts ADD COLUMN IF NOT EXISTS show_next_item BOOLEAN NOT NULL DEFAULT TRUE;
    ALTER TABLE overlay_drafts ADD COLUMN IF NOT EXISTS show_schedule_teaser BOOLEAN NOT NULL DEFAULT TRUE;
    ALTER TABLE overlay_drafts ADD COLUMN IF NOT EXISTS brand_badge TEXT NOT NULL DEFAULT '';
    ALTER TABLE overlay_drafts ADD COLUMN IF NOT EXISTS scene_preset TEXT NOT NULL DEFAULT 'replay-lower-third';
    ALTER TABLE overlay_drafts ADD COLUMN IF NOT EXISTS insert_scene_preset TEXT NOT NULL DEFAULT 'bumper-board';
    ALTER TABLE overlay_drafts ADD COLUMN IF NOT EXISTS standby_scene_preset TEXT NOT NULL DEFAULT 'standby-board';
    ALTER TABLE overlay_drafts ADD COLUMN IF NOT EXISTS reconnect_scene_preset TEXT NOT NULL DEFAULT 'reconnect-board';
    ALTER TABLE overlay_drafts ADD COLUMN IF NOT EXISTS surface_style TEXT NOT NULL DEFAULT 'glass';
    ALTER TABLE overlay_drafts ADD COLUMN IF NOT EXISTS panel_anchor TEXT NOT NULL DEFAULT 'bottom';
    ALTER TABLE overlay_drafts ADD COLUMN IF NOT EXISTS title_scale TEXT NOT NULL DEFAULT 'balanced';
    ALTER TABLE overlay_drafts ADD COLUMN IF NOT EXISTS typography_preset TEXT NOT NULL DEFAULT 'studio-sans';
    ALTER TABLE overlay_drafts ADD COLUMN IF NOT EXISTS show_current_category BOOLEAN NOT NULL DEFAULT TRUE;
    ALTER TABLE overlay_drafts ADD COLUMN IF NOT EXISTS show_source_label BOOLEAN NOT NULL DEFAULT TRUE;
    ALTER TABLE overlay_drafts ADD COLUMN IF NOT EXISTS show_queue_preview BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE overlay_drafts ADD COLUMN IF NOT EXISTS queue_preview_count INTEGER NOT NULL DEFAULT 3;
    ALTER TABLE overlay_drafts ADD COLUMN IF NOT EXISTS layer_order_json TEXT NOT NULL DEFAULT '[]';
    ALTER TABLE overlay_drafts ADD COLUMN IF NOT EXISTS disabled_layers_json TEXT NOT NULL DEFAULT '[]';
    ALTER TABLE overlay_drafts ADD COLUMN IF NOT EXISTS custom_layers_json TEXT NOT NULL DEFAULT '[]';
    ALTER TABLE overlay_drafts ADD COLUMN IF NOT EXISTS emergency_banner TEXT NOT NULL DEFAULT '';
    ALTER TABLE overlay_drafts ADD COLUMN IF NOT EXISTS replay_label TEXT NOT NULL DEFAULT 'Replay stream';
    ALTER TABLE overlay_drafts ADD COLUMN IF NOT EXISTS ticker_text TEXT NOT NULL DEFAULT '';
    ALTER TABLE overlay_drafts ADD COLUMN IF NOT EXISTS updated_at TEXT NOT NULL DEFAULT '';
    ALTER TABLE overlay_drafts ADD COLUMN IF NOT EXISTS based_on_updated_at TEXT NOT NULL DEFAULT '';
    ALTER TABLE managed_config ADD COLUMN IF NOT EXISTS encrypted_payload TEXT NOT NULL DEFAULT '';
    ALTER TABLE managed_config ADD COLUMN IF NOT EXISTS updated_at TEXT NOT NULL DEFAULT '';
    ALTER TABLE schedule_blocks ADD COLUMN IF NOT EXISTS start_minute_of_day INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE schedule_blocks ADD COLUMN IF NOT EXISTS day_of_week INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE schedule_blocks ADD COLUMN IF NOT EXISTS show_id TEXT NOT NULL DEFAULT '';
    ALTER TABLE schedule_blocks ADD COLUMN IF NOT EXISTS pool_id TEXT NOT NULL DEFAULT '';
    ALTER TABLE schedule_blocks ADD COLUMN IF NOT EXISTS repeat_mode TEXT NOT NULL DEFAULT 'single';
    ALTER TABLE schedule_blocks ADD COLUMN IF NOT EXISTS repeat_group_id TEXT NOT NULL DEFAULT '';
    ALTER TABLE schedule_blocks ADD COLUMN IF NOT EXISTS cuepoint_asset_id TEXT NOT NULL DEFAULT '';
    ALTER TABLE schedule_blocks ADD COLUMN IF NOT EXISTS cuepoint_offsets_seconds TEXT NOT NULL DEFAULT '[]';
    ALTER TABLE pools ADD COLUMN IF NOT EXISTS insert_asset_id TEXT NOT NULL DEFAULT '';
    ALTER TABLE pools ADD COLUMN IF NOT EXISTS insert_every_items INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE pools ADD COLUMN IF NOT EXISTS items_since_insert INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE pools ADD COLUMN IF NOT EXISTS audio_lane_asset_id TEXT NOT NULL DEFAULT '';
    ALTER TABLE pools ADD COLUMN IF NOT EXISTS audio_lane_volume_percent INTEGER NOT NULL DEFAULT 100;
    ALTER TABLE sources ADD COLUMN IF NOT EXISTS enabled BOOLEAN NOT NULL DEFAULT TRUE;
    ALTER TABLE assets ADD COLUMN IF NOT EXISTS external_id TEXT NOT NULL DEFAULT '';
    ALTER TABLE assets ADD COLUMN IF NOT EXISTS category_name TEXT NOT NULL DEFAULT '';
    ALTER TABLE assets ADD COLUMN IF NOT EXISTS duration_seconds INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE assets ADD COLUMN IF NOT EXISTS published_at TEXT NOT NULL DEFAULT '';
    ALTER TABLE assets ADD COLUMN IF NOT EXISTS cache_path TEXT NOT NULL DEFAULT '';
    ALTER TABLE assets ADD COLUMN IF NOT EXISTS cache_status TEXT NOT NULL DEFAULT '';
    ALTER TABLE assets ADD COLUMN IF NOT EXISTS cache_updated_at TEXT NOT NULL DEFAULT '';
    ALTER TABLE assets ADD COLUMN IF NOT EXISTS cache_error TEXT NOT NULL DEFAULT '';
    ALTER TABLE assets ADD COLUMN IF NOT EXISTS folder_path TEXT NOT NULL DEFAULT '';
    ALTER TABLE assets ADD COLUMN IF NOT EXISTS tags_json TEXT NOT NULL DEFAULT '[]';
    ALTER TABLE assets ADD COLUMN IF NOT EXISTS title_prefix TEXT NOT NULL DEFAULT '';
    ALTER TABLE assets ADD COLUMN IF NOT EXISTS hashtags_json TEXT NOT NULL DEFAULT '[]';
    ALTER TABLE assets ADD COLUMN IF NOT EXISTS platform_notes TEXT NOT NULL DEFAULT '';
    ALTER TABLE assets ADD COLUMN IF NOT EXISTS chapters_json TEXT NOT NULL DEFAULT '[]';
    ALTER TABLE assets ADD COLUMN IF NOT EXISTS chapters_probe_status TEXT NOT NULL DEFAULT '';
    ALTER TABLE assets ADD COLUMN IF NOT EXISTS chapters_probed_at TEXT NOT NULL DEFAULT '';
    ALTER TABLE playout_runtime ADD COLUMN IF NOT EXISTS desired_asset_id TEXT NOT NULL DEFAULT '';
    ALTER TABLE playout_runtime ADD COLUMN IF NOT EXISTS transition_state TEXT NOT NULL DEFAULT 'idle';
    ALTER TABLE playout_runtime ADD COLUMN IF NOT EXISTS queue_version INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE playout_runtime ADD COLUMN IF NOT EXISTS transition_target_kind TEXT NOT NULL DEFAULT '';
    ALTER TABLE playout_runtime ADD COLUMN IF NOT EXISTS transition_target_asset_id TEXT NOT NULL DEFAULT '';
    ALTER TABLE playout_runtime ADD COLUMN IF NOT EXISTS transition_target_title TEXT NOT NULL DEFAULT '';
    ALTER TABLE playout_runtime ADD COLUMN IF NOT EXISTS transition_ready_at TEXT NOT NULL DEFAULT '';
    ALTER TABLE playout_runtime ADD COLUMN IF NOT EXISTS previous_asset_id TEXT NOT NULL DEFAULT '';
    ALTER TABLE playout_runtime ADD COLUMN IF NOT EXISTS previous_title TEXT NOT NULL DEFAULT '';
    ALTER TABLE playout_runtime ADD COLUMN IF NOT EXISTS next_asset_id TEXT NOT NULL DEFAULT '';
    ALTER TABLE playout_runtime ADD COLUMN IF NOT EXISTS next_title TEXT NOT NULL DEFAULT '';
    ALTER TABLE playout_runtime ADD COLUMN IF NOT EXISTS queued_asset_ids TEXT NOT NULL DEFAULT '[]';
    ALTER TABLE playout_runtime ADD COLUMN IF NOT EXISTS queue_items TEXT NOT NULL DEFAULT '[]';
    ALTER TABLE playout_runtime ADD COLUMN IF NOT EXISTS prefetched_asset_id TEXT NOT NULL DEFAULT '';
    ALTER TABLE playout_runtime ADD COLUMN IF NOT EXISTS prefetched_title TEXT NOT NULL DEFAULT '';
    ALTER TABLE playout_runtime ADD COLUMN IF NOT EXISTS prefetched_at TEXT NOT NULL DEFAULT '';
    ALTER TABLE playout_runtime ADD COLUMN IF NOT EXISTS prefetch_status TEXT NOT NULL DEFAULT '';
    ALTER TABLE playout_runtime ADD COLUMN IF NOT EXISTS prefetch_error TEXT NOT NULL DEFAULT '';
    ALTER TABLE playout_runtime ADD COLUMN IF NOT EXISTS current_destination_id TEXT NOT NULL DEFAULT '';
    ALTER TABLE playout_runtime ADD COLUMN IF NOT EXISTS restart_requested_at TEXT NOT NULL DEFAULT '';
    ALTER TABLE playout_runtime ADD COLUMN IF NOT EXISTS process_pid INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE playout_runtime ADD COLUMN IF NOT EXISTS process_started_at TEXT NOT NULL DEFAULT '';
    ALTER TABLE playout_runtime ADD COLUMN IF NOT EXISTS last_transition_at TEXT NOT NULL DEFAULT '';
    ALTER TABLE playout_runtime ADD COLUMN IF NOT EXISTS last_successful_start_at TEXT NOT NULL DEFAULT '';
    ALTER TABLE playout_runtime ADD COLUMN IF NOT EXISTS last_successful_asset_id TEXT NOT NULL DEFAULT '';
    ALTER TABLE playout_runtime ADD COLUMN IF NOT EXISTS last_exit_code TEXT NOT NULL DEFAULT '';
    ALTER TABLE playout_runtime ADD COLUMN IF NOT EXISTS restart_count INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE playout_runtime ADD COLUMN IF NOT EXISTS crash_count_window INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE playout_runtime ADD COLUMN IF NOT EXISTS crash_loop_detected BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE playout_runtime ADD COLUMN IF NOT EXISTS last_error TEXT NOT NULL DEFAULT '';
    ALTER TABLE playout_runtime ADD COLUMN IF NOT EXISTS last_stderr_sample TEXT NOT NULL DEFAULT '';
    ALTER TABLE playout_runtime ADD COLUMN IF NOT EXISTS selection_reason_code TEXT NOT NULL DEFAULT '';
    ALTER TABLE playout_runtime ADD COLUMN IF NOT EXISTS fallback_tier TEXT NOT NULL DEFAULT 'none';
    ALTER TABLE playout_runtime ADD COLUMN IF NOT EXISTS override_mode TEXT NOT NULL DEFAULT 'schedule';
    ALTER TABLE playout_runtime ADD COLUMN IF NOT EXISTS override_asset_id TEXT NOT NULL DEFAULT '';
    ALTER TABLE playout_runtime ADD COLUMN IF NOT EXISTS override_until TEXT NOT NULL DEFAULT '';
    ALTER TABLE playout_runtime ADD COLUMN IF NOT EXISTS live_bridge_input_type TEXT NOT NULL DEFAULT '';
    ALTER TABLE playout_runtime ADD COLUMN IF NOT EXISTS live_bridge_input_url TEXT NOT NULL DEFAULT '';
    ALTER TABLE playout_runtime ADD COLUMN IF NOT EXISTS live_bridge_label TEXT NOT NULL DEFAULT '';
    ALTER TABLE playout_runtime ADD COLUMN IF NOT EXISTS live_bridge_status TEXT NOT NULL DEFAULT '';
    ALTER TABLE playout_runtime ADD COLUMN IF NOT EXISTS live_bridge_requested_at TEXT NOT NULL DEFAULT '';
    ALTER TABLE playout_runtime ADD COLUMN IF NOT EXISTS live_bridge_started_at TEXT NOT NULL DEFAULT '';
    ALTER TABLE playout_runtime ADD COLUMN IF NOT EXISTS live_bridge_released_at TEXT NOT NULL DEFAULT '';
    ALTER TABLE playout_runtime ADD COLUMN IF NOT EXISTS live_bridge_last_error TEXT NOT NULL DEFAULT '';
    ALTER TABLE playout_runtime ADD COLUMN IF NOT EXISTS cuepoint_window_key TEXT NOT NULL DEFAULT '';
    ALTER TABLE playout_runtime ADD COLUMN IF NOT EXISTS cuepoint_fired_keys TEXT NOT NULL DEFAULT '[]';
    ALTER TABLE playout_runtime ADD COLUMN IF NOT EXISTS cuepoint_last_triggered_at TEXT NOT NULL DEFAULT '';
    ALTER TABLE playout_runtime ADD COLUMN IF NOT EXISTS cuepoint_last_asset_id TEXT NOT NULL DEFAULT '';
    ALTER TABLE playout_runtime ADD COLUMN IF NOT EXISTS manual_next_asset_id TEXT NOT NULL DEFAULT '';
    ALTER TABLE playout_runtime ADD COLUMN IF NOT EXISTS manual_next_requested_at TEXT NOT NULL DEFAULT '';
    ALTER TABLE playout_runtime ADD COLUMN IF NOT EXISTS insert_asset_id TEXT NOT NULL DEFAULT '';
    ALTER TABLE playout_runtime ADD COLUMN IF NOT EXISTS insert_requested_at TEXT NOT NULL DEFAULT '';
    ALTER TABLE playout_runtime ADD COLUMN IF NOT EXISTS insert_status TEXT NOT NULL DEFAULT '';
    ALTER TABLE playout_runtime ADD COLUMN IF NOT EXISTS skip_asset_id TEXT NOT NULL DEFAULT '';
    ALTER TABLE playout_runtime ADD COLUMN IF NOT EXISTS skip_until TEXT NOT NULL DEFAULT '';
    ALTER TABLE playout_runtime ADD COLUMN IF NOT EXISTS pending_action TEXT NOT NULL DEFAULT '';
    ALTER TABLE playout_runtime ADD COLUMN IF NOT EXISTS pending_action_requested_at TEXT NOT NULL DEFAULT '';
    ALTER TABLE playout_runtime ADD COLUMN IF NOT EXISTS uplink_status TEXT NOT NULL DEFAULT '';
    ALTER TABLE playout_runtime ADD COLUMN IF NOT EXISTS uplink_input_mode TEXT NOT NULL DEFAULT '';
    ALTER TABLE playout_runtime ADD COLUMN IF NOT EXISTS uplink_started_at TEXT NOT NULL DEFAULT '';
    ALTER TABLE playout_runtime ADD COLUMN IF NOT EXISTS uplink_heartbeat_at TEXT NOT NULL DEFAULT '';
    ALTER TABLE playout_runtime ADD COLUMN IF NOT EXISTS uplink_destination_ids TEXT NOT NULL DEFAULT '[]';
    ALTER TABLE playout_runtime ADD COLUMN IF NOT EXISTS uplink_restart_count INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE playout_runtime ADD COLUMN IF NOT EXISTS uplink_unplanned_restart_count INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE playout_runtime ADD COLUMN IF NOT EXISTS uplink_last_exit_code TEXT NOT NULL DEFAULT '';
    ALTER TABLE playout_runtime ADD COLUMN IF NOT EXISTS uplink_last_exit_reason TEXT NOT NULL DEFAULT '';
    ALTER TABLE playout_runtime ADD COLUMN IF NOT EXISTS uplink_last_exit_planned BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE playout_runtime ADD COLUMN IF NOT EXISTS uplink_reconnect_until TEXT NOT NULL DEFAULT '';
    ALTER TABLE playout_runtime ADD COLUMN IF NOT EXISTS program_feed_status TEXT NOT NULL DEFAULT '';
    ALTER TABLE playout_runtime ADD COLUMN IF NOT EXISTS program_feed_updated_at TEXT NOT NULL DEFAULT '';
    ALTER TABLE playout_runtime ADD COLUMN IF NOT EXISTS program_feed_playlist_path TEXT NOT NULL DEFAULT '';
    ALTER TABLE playout_runtime ADD COLUMN IF NOT EXISTS program_feed_target_seconds INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE playout_runtime ADD COLUMN IF NOT EXISTS program_feed_buffered_seconds INTEGER NOT NULL DEFAULT 0;
  `);

  await client.query(`
    UPDATE schedule_blocks
    SET start_minute_of_day = start_hour * 60
    WHERE start_minute_of_day = 0 AND start_hour <> 0
  `);
}

const schemaBaselineMigration: MigrationDefinition = {
  id: LATEST_SCHEMA_MIGRATION_ID,
  description: "Establish the Stream247 baseline PostgreSQL schema.",
  apply: applyCurrentSchemaDefinition
};

if (!schemaMigrations.some((migration) => migration.id === schemaBaselineMigration.id)) {
  schemaMigrations.push(schemaBaselineMigration);
}

const libraryBlueprintsV2Migration: MigrationDefinition = {
  id: "20260406_001_library_blueprints_v2",
  description: "Add curated asset collections for library grouping and blueprint reuse.",
  apply: async (client) => {
    await client.query(`
      CREATE TABLE IF NOT EXISTS asset_collections (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        color TEXT NOT NULL DEFAULT '#0e6d5a',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS asset_collection_items (
        collection_id TEXT NOT NULL,
        asset_id TEXT NOT NULL,
        position INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (collection_id, asset_id)
      );

      CREATE INDEX IF NOT EXISTS asset_collection_items_asset_id_idx ON asset_collection_items (asset_id);
      CREATE INDEX IF NOT EXISTS asset_collection_items_collection_id_position_idx ON asset_collection_items (collection_id, position);
    `);
  }
};

if (!schemaMigrations.some((migration) => migration.id === libraryBlueprintsV2Migration.id)) {
  schemaMigrations.push(libraryBlueprintsV2Migration);
}

const twitchBroadcasterConnectionMigration: MigrationDefinition = {
  id: "20260825_001_twitch_broadcaster_connection",
  description: "Add the broadcaster connection slot for the broadcast-channel split (M51).",
  apply: async (client) => {
    // Identical to the base-schema definition on purpose. The base block only runs for databases
    // created from nothing, so a table that exists only there reaches fresh installs and never an
    // existing one — the dev stack failed with "relation does not exist" on exactly this table
    // while every fresh-db and fresh-compose check stayed green. New tables need both: the base
    // schema for new databases, and a migration for every database that already exists.
    await client.query(`
      CREATE TABLE IF NOT EXISTS twitch_broadcaster_connection (
        singleton_id SMALLINT PRIMARY KEY DEFAULT 1,
        status TEXT NOT NULL DEFAULT 'not-connected',
        broadcaster_id TEXT NOT NULL DEFAULT '',
        broadcaster_login TEXT NOT NULL DEFAULT '',
        access_token TEXT NOT NULL DEFAULT '',
        refresh_token TEXT NOT NULL DEFAULT '',
        connected_at TEXT NOT NULL DEFAULT '',
        token_expires_at TEXT NOT NULL DEFAULT '',
        last_refresh_at TEXT NOT NULL DEFAULT '',
        error TEXT NOT NULL DEFAULT ''
      );
    `);
  }
};

if (!schemaMigrations.some((migration) => migration.id === twitchBroadcasterConnectionMigration.id)) {
  schemaMigrations.push(twitchBroadcasterConnectionMigration);
}

const persistentProgramFeedRuntimeMigration: MigrationDefinition = {
  id: "20260419_001_persistent_program_feed_runtime",
  description: "Add persistent uplink and program feed runtime columns.",
  apply: async (client) => {
    await client.query(`
      ALTER TABLE playout_runtime ADD COLUMN IF NOT EXISTS uplink_status TEXT NOT NULL DEFAULT '';
      ALTER TABLE playout_runtime ADD COLUMN IF NOT EXISTS uplink_input_mode TEXT NOT NULL DEFAULT '';
      ALTER TABLE playout_runtime ADD COLUMN IF NOT EXISTS uplink_started_at TEXT NOT NULL DEFAULT '';
      ALTER TABLE playout_runtime ADD COLUMN IF NOT EXISTS uplink_heartbeat_at TEXT NOT NULL DEFAULT '';
      ALTER TABLE playout_runtime ADD COLUMN IF NOT EXISTS uplink_destination_ids TEXT NOT NULL DEFAULT '[]';
      ALTER TABLE playout_runtime ADD COLUMN IF NOT EXISTS uplink_restart_count INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE playout_runtime ADD COLUMN IF NOT EXISTS uplink_unplanned_restart_count INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE playout_runtime ADD COLUMN IF NOT EXISTS uplink_last_exit_code TEXT NOT NULL DEFAULT '';
      ALTER TABLE playout_runtime ADD COLUMN IF NOT EXISTS uplink_last_exit_reason TEXT NOT NULL DEFAULT '';
      ALTER TABLE playout_runtime ADD COLUMN IF NOT EXISTS uplink_last_exit_planned BOOLEAN NOT NULL DEFAULT FALSE;
      ALTER TABLE playout_runtime ADD COLUMN IF NOT EXISTS uplink_reconnect_until TEXT NOT NULL DEFAULT '';
      ALTER TABLE playout_runtime ADD COLUMN IF NOT EXISTS program_feed_status TEXT NOT NULL DEFAULT '';
      ALTER TABLE playout_runtime ADD COLUMN IF NOT EXISTS program_feed_updated_at TEXT NOT NULL DEFAULT '';
      ALTER TABLE playout_runtime ADD COLUMN IF NOT EXISTS program_feed_playlist_path TEXT NOT NULL DEFAULT '';
      ALTER TABLE playout_runtime ADD COLUMN IF NOT EXISTS program_feed_target_seconds INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE playout_runtime ADD COLUMN IF NOT EXISTS program_feed_buffered_seconds INTEGER NOT NULL DEFAULT 0;
    `);
  }
};

if (!schemaMigrations.some((migration) => migration.id === persistentProgramFeedRuntimeMigration.id)) {
  schemaMigrations.push(persistentProgramFeedRuntimeMigration);
}

const assetChaptersMigration: MigrationDefinition = {
  // 20260825_001 is the broadcaster-connection migration added while integrating M51 upstream;
  // chapters sequence after it so both apply in a deterministic order on existing databases.
  id: "20260825_002_asset_chapters",
  description: "Add per-asset chapter lists so category and stream title can change inside one video.",
  apply: async (client) => {
    await client.query(`
      ALTER TABLE assets ADD COLUMN IF NOT EXISTS chapters_json TEXT NOT NULL DEFAULT '[]';
    `);
  }
};

if (!schemaMigrations.some((migration) => migration.id === assetChaptersMigration.id)) {
  schemaMigrations.push(assetChaptersMigration);
}

const assetCacheMetadataMigration: MigrationDefinition = {
  id: "20260424_001_asset_cache_metadata",
  description: "Backfill asset cache and overlay metadata columns for pre-existing baseline databases.",
  apply: async (client) => {
    await client.query(`
      ALTER TABLE assets ADD COLUMN IF NOT EXISTS cache_path TEXT NOT NULL DEFAULT '';
      ALTER TABLE assets ADD COLUMN IF NOT EXISTS cache_status TEXT NOT NULL DEFAULT '';
      ALTER TABLE assets ADD COLUMN IF NOT EXISTS cache_updated_at TEXT NOT NULL DEFAULT '';
      ALTER TABLE assets ADD COLUMN IF NOT EXISTS cache_error TEXT NOT NULL DEFAULT '';
      ALTER TABLE assets ADD COLUMN IF NOT EXISTS folder_path TEXT NOT NULL DEFAULT '';
      ALTER TABLE assets ADD COLUMN IF NOT EXISTS tags_json TEXT NOT NULL DEFAULT '[]';
      ALTER TABLE assets ADD COLUMN IF NOT EXISTS title_prefix TEXT NOT NULL DEFAULT '';
      ALTER TABLE assets ADD COLUMN IF NOT EXISTS hashtags_json TEXT NOT NULL DEFAULT '[]';
      ALTER TABLE assets ADD COLUMN IF NOT EXISTS platform_notes TEXT NOT NULL DEFAULT '';
    `);
  }
};

if (!schemaMigrations.some((migration) => migration.id === assetCacheMetadataMigration.id)) {
  schemaMigrations.push(assetCacheMetadataMigration);
}

const outputProfilesMigration: MigrationDefinition = {
  id: "20260420_001_output_profiles",
  description: "Add channel-level output profile settings.",
  apply: async (client) => {
    await client.query(`
      CREATE TABLE IF NOT EXISTS output_settings (
        singleton_id SMALLINT PRIMARY KEY DEFAULT 1,
        profile_id TEXT NOT NULL DEFAULT '720p30',
        width INTEGER NOT NULL DEFAULT 1280,
        height INTEGER NOT NULL DEFAULT 720,
        fps INTEGER NOT NULL DEFAULT 30,
        updated_at TEXT NOT NULL DEFAULT ''
      );
    `);
  }
};

if (!schemaMigrations.some((migration) => migration.id === outputProfilesMigration.id)) {
  schemaMigrations.push(outputProfilesMigration);
}

const engagementLayerMigration: MigrationDefinition = {
  id: "20260420_002_engagement_layer",
  description: "Add in-stream engagement settings and recent event storage.",
  apply: async (client) => {
    await client.query(`
      CREATE TABLE IF NOT EXISTS engagement_settings (
        singleton_id SMALLINT PRIMARY KEY DEFAULT 1,
        chat_enabled BOOLEAN NOT NULL DEFAULT FALSE,
        alerts_enabled BOOLEAN NOT NULL DEFAULT FALSE,
        donations_enabled BOOLEAN NOT NULL DEFAULT TRUE,
        channel_points_enabled BOOLEAN NOT NULL DEFAULT TRUE,
        chat_mode TEXT NOT NULL DEFAULT 'quiet',
        chat_position TEXT NOT NULL DEFAULT 'bottom-left',
        alert_position TEXT NOT NULL DEFAULT 'top-right',
        style TEXT NOT NULL DEFAULT 'compact',
        max_messages INTEGER NOT NULL DEFAULT 5,
        rate_limit_per_minute INTEGER NOT NULL DEFAULT 30,
        updated_at TEXT NOT NULL DEFAULT ''
      );

      CREATE TABLE IF NOT EXISTS engagement_events (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        actor TEXT NOT NULL DEFAULT '',
        message TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      );
    `);
  }
};

if (!schemaMigrations.some((migration) => migration.id === engagementLayerMigration.id)) {
  schemaMigrations.push(engagementLayerMigration);
}

const engagementAlertTypesMigration: MigrationDefinition = {
  id: "20260421_001_engagement_alert_types",
  description: "Add per-type cheer and channel-point engagement alert toggles.",
  apply: async (client) => {
    await client.query(`
      ALTER TABLE engagement_settings ADD COLUMN IF NOT EXISTS donations_enabled BOOLEAN NOT NULL DEFAULT TRUE;
      ALTER TABLE engagement_settings ADD COLUMN IF NOT EXISTS channel_points_enabled BOOLEAN NOT NULL DEFAULT TRUE;
    `);
  }
};

if (!schemaMigrations.some((migration) => migration.id === engagementAlertTypesMigration.id)) {
  schemaMigrations.push(engagementAlertTypesMigration);
}

const engagementGameMigration: MigrationDefinition = {
  id: "20260422_001_engagement_game",
  description: "Add chatter-participation game settings and runtime storage.",
  apply: async (client) => {
    await client.query(`
      ALTER TABLE engagement_settings ADD COLUMN IF NOT EXISTS game_enabled BOOLEAN NOT NULL DEFAULT FALSE;
      ALTER TABLE engagement_settings ADD COLUMN IF NOT EXISTS solo_mode_enabled BOOLEAN NOT NULL DEFAULT TRUE;
      ALTER TABLE engagement_settings ADD COLUMN IF NOT EXISTS small_group_mode_enabled BOOLEAN NOT NULL DEFAULT TRUE;
      ALTER TABLE engagement_settings ADD COLUMN IF NOT EXISTS crowd_mode_enabled BOOLEAN NOT NULL DEFAULT TRUE;
      ALTER TABLE engagement_settings ADD COLUMN IF NOT EXISTS game_window_minutes INTEGER NOT NULL DEFAULT 10;

      CREATE TABLE IF NOT EXISTS engagement_game_runtime (
        singleton_id SMALLINT PRIMARY KEY DEFAULT 1,
        active_chatter_count INTEGER NOT NULL DEFAULT 0,
        mode TEXT NOT NULL DEFAULT '',
        mode_changed_at TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL DEFAULT ''
      );
    `);
  }
};

if (!schemaMigrations.some((migration) => migration.id === engagementGameMigration.id)) {
  schemaMigrations.push(engagementGameMigration);
}

const destinationOutputProfilesMigration: MigrationDefinition = {
  id: "20260421_002_destination_output_profiles",
  description: "Add per-destination output profile assignment.",
  apply: async (client) => {
    await client.query(`
      ALTER TABLE stream_destinations ADD COLUMN IF NOT EXISTS output_profile_id TEXT NOT NULL DEFAULT 'inherit';
    `);
  }
};

if (!schemaMigrations.some((migration) => migration.id === destinationOutputProfilesMigration.id)) {
  schemaMigrations.push(destinationOutputProfilesMigration);
}

const twitchLiveStatusMigration: MigrationDefinition = {
  id: "20260421_003_twitch_live_status",
  description: "Persist Twitch live/offline status and viewer counts.",
  apply: async (client) => {
    await client.query(`
      ALTER TABLE twitch_connection ADD COLUMN IF NOT EXISTS live_status TEXT NOT NULL DEFAULT 'unknown';
      ALTER TABLE twitch_connection ADD COLUMN IF NOT EXISTS viewer_count INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE twitch_connection ADD COLUMN IF NOT EXISTS started_at TEXT NOT NULL DEFAULT '';
      UPDATE twitch_connection
      SET
        live_status = CASE
          WHEN live_status IN ('live', 'offline', 'unknown') THEN live_status
          ELSE 'unknown'
        END,
        viewer_count = GREATEST(COALESCE(viewer_count, 0), 0)
    `);
  }
};

if (!schemaMigrations.some((migration) => migration.id === twitchLiveStatusMigration.id)) {
  schemaMigrations.push(twitchLiveStatusMigration);
}

const presenceWindowMetadataMigration: MigrationDefinition = {
  id: "20260422_001_presence_window_metadata",
  description: "Store requested/applied presence durations and clamp reasons for moderator check-ins.",
  apply: async (client) => {
    await client.query(`
      ALTER TABLE presence_windows ADD COLUMN IF NOT EXISTS requested_minutes INTEGER;
      ALTER TABLE presence_windows ADD COLUMN IF NOT EXISTS applied_minutes INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE presence_windows ADD COLUMN IF NOT EXISTS clamp_reason TEXT NOT NULL DEFAULT '';
      UPDATE presence_windows
      SET
        applied_minutes = CASE
          WHEN COALESCE(applied_minutes, 0) > 0 THEN applied_minutes
          ELSE minutes
        END,
        clamp_reason = CASE
          WHEN clamp_reason IN ('accepted', 'default', 'minimum', 'maximum') THEN clamp_reason
          ELSE ''
        END
    `);
  }
};

if (!schemaMigrations.some((migration) => migration.id === presenceWindowMetadataMigration.id)) {
  schemaMigrations.push(presenceWindowMetadataMigration);
}

const twitchLiveStartedAtMigration: MigrationDefinition = {
  id: "20260422_002_twitch_live_started_at",
  description: "Persist the Twitch live started-at timestamp for operator uptime displays.",
  apply: async (client) => {
    await client.query(`
      ALTER TABLE twitch_connection ADD COLUMN IF NOT EXISTS started_at TEXT NOT NULL DEFAULT '';
    `);
  }
};

if (!schemaMigrations.some((migration) => migration.id === twitchLiveStartedAtMigration.id)) {
  schemaMigrations.push(twitchLiveStartedAtMigration);
}

const chatInteractionMigration: MigrationDefinition = {
  id: "20260818_001_chat_interaction",
  description: "Add viewer-driven programme control: settings, the active vote, and request history.",
  apply: async (client) => {
    await client.query(`
      CREATE TABLE IF NOT EXISTS chat_interaction_settings (
        singleton_id SMALLINT PRIMARY KEY DEFAULT 1,
        enabled BOOLEAN NOT NULL DEFAULT FALSE,
        voting_enabled BOOLEAN NOT NULL DEFAULT TRUE,
        requests_enabled BOOLEAN NOT NULL DEFAULT TRUE,
        skip_enabled BOOLEAN NOT NULL DEFAULT TRUE,
        vote_duration_seconds INTEGER NOT NULL DEFAULT 60,
        vote_option_count INTEGER NOT NULL DEFAULT 3,
        vote_minimum_voters INTEGER NOT NULL DEFAULT 3,
        request_cooldown_seconds INTEGER NOT NULL DEFAULT 600,
        request_queue_limit INTEGER NOT NULL DEFAULT 5,
        skip_threshold_ratio DOUBLE PRECISION NOT NULL DEFAULT 0.6,
        skip_minimum_votes INTEGER NOT NULL DEFAULT 5,
        skip_window_seconds INTEGER NOT NULL DEFAULT 120,
        request_command TEXT NOT NULL DEFAULT 'request',
        skip_command TEXT NOT NULL DEFAULT 'skip',
        updated_at TEXT NOT NULL DEFAULT ''
      );

      -- One row: the poll currently on air. The worker owns the tally and flushes it here on an
      -- interval so the playout process can render it, rather than writing once per vote through
      -- the global state write lock.
      CREATE TABLE IF NOT EXISTS chat_vote_session (
        singleton_id SMALLINT PRIMARY KEY DEFAULT 1,
        id TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'closed',
        opened_at TEXT NOT NULL DEFAULT '',
        closes_at TEXT NOT NULL DEFAULT '',
        options JSONB NOT NULL DEFAULT '[]'::jsonb,
        ballots JSONB NOT NULL DEFAULT '{}'::jsonb,
        winner_asset_id TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL DEFAULT ''
      );

      CREATE TABLE IF NOT EXISTS chat_viewer_requests (
        id TEXT PRIMARY KEY,
        actor TEXT NOT NULL,
        asset_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'queued',
        created_at TEXT NOT NULL
      );

      -- Cooldown lookups filter by actor and order by recency; request history grows without bound
      -- otherwise and every check would be a sequential scan.
      CREATE INDEX IF NOT EXISTS chat_viewer_requests_actor_created_idx
        ON chat_viewer_requests (actor, created_at DESC);
      CREATE INDEX IF NOT EXISTS chat_viewer_requests_status_idx
        ON chat_viewer_requests (status);
    `);
  }
};

if (!schemaMigrations.some((migration) => migration.id === chatInteractionMigration.id)) {
  schemaMigrations.push(chatInteractionMigration);
}

const presenceWindowKeyMigration: MigrationDefinition = {
  id: "20260819_001_presence_window_key",
  description: "Give presence windows a surrogate key so two check-ins can expire at the same instant.",
  apply: async (client) => {
    // expires_at was the primary key. It is derived from the check-in time plus a duration chosen
    // from a short list, so two moderators checking in during the same second for the same length
    // collide -- and the insert runs inside the Twitch chat callback, where a unique violation
    // surfaces as a failed check-in rather than as anything an operator would see.
    await client.query(`
      ALTER TABLE presence_windows DROP CONSTRAINT IF EXISTS presence_windows_pkey;
      ALTER TABLE presence_windows ADD COLUMN IF NOT EXISTS id BIGINT GENERATED BY DEFAULT AS IDENTITY;
    `);
    // Separate statement: the column must exist before it can carry the constraint.
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'presence_windows_pkey'
        ) THEN
          ALTER TABLE presence_windows ADD CONSTRAINT presence_windows_pkey PRIMARY KEY (id);
        END IF;
      END
      $$;
    `);
  }
};

if (!schemaMigrations.some((migration) => migration.id === presenceWindowKeyMigration.id)) {
  schemaMigrations.push(presenceWindowKeyMigration);
}

// The base-schema block above only ever runs for databases created from nothing: its baseline
// migration id is already recorded on every existing install. New tables therefore live in BOTH
// places — the base block for fresh installs and this idempotent migration for everyone else.
const chatGameMigration: MigrationDefinition = {
  id: "20260825_003_chat_game",
  description: "Add the chat-game framework: game settings and the running round's state.",
  apply: async (client) => {
    await client.query(`
      -- Which game runs and how chat steers it. One row: the game continues across scene changes,
      -- so its rules cannot fork per scene; scenes only decide where (and whether) it renders.
      CREATE TABLE IF NOT EXISTS chat_game_settings (
        singleton_id SMALLINT PRIMARY KEY DEFAULT 1,
        game_id TEXT NOT NULL DEFAULT 'snake',
        grid_width INTEGER NOT NULL DEFAULT 16,
        grid_height INTEGER NOT NULL DEFAULT 9,
        emote_up TEXT NOT NULL DEFAULT '⬆',
        emote_down TEXT NOT NULL DEFAULT '⬇',
        emote_left TEXT NOT NULL DEFAULT '⬅',
        emote_right TEXT NOT NULL DEFAULT '➡',
        updated_at TEXT NOT NULL DEFAULT ''
      );

      -- The running round. Inputs arrive in the worker container and the overlay renders in the
      -- playout container, so the state has to cross a process boundary — and persisting it here
      -- also means a worker restart resumes the round instead of wiping it mid-game. The settings
      -- the round was started under travel with the state, so playout renders from one read and a
      -- settings edit mid-round is detected as a different settings_key.
      CREATE TABLE IF NOT EXISTS chat_game_runtime (
        singleton_id SMALLINT PRIMARY KEY DEFAULT 1,
        game_id TEXT NOT NULL DEFAULT '',
        settings_key TEXT NOT NULL DEFAULT '',
        settings JSONB NOT NULL DEFAULT '{}'::jsonb,
        state JSONB NOT NULL DEFAULT '{}'::jsonb,
        updated_at TEXT NOT NULL DEFAULT ''
      );
    `);
  }
};

if (!schemaMigrations.some((migration) => migration.id === chatGameMigration.id)) {
  schemaMigrations.push(chatGameMigration);
}

// Declared in the base-schema block as well: that block only ever runs for databases created from
// nothing, because its baseline migration id is already recorded on every existing install. This
// migration is what carries the table to everyone else.
const chatSkipVoteMigration: MigrationDefinition = {
  id: "20260825_004_chat_skip_vote",
  description: "Persist skip-vote progress so the playout container can draw it on air.",
  apply: async (client) => {
    await client.query(`
      -- One row: the running skip campaign. The worker tallies !skip in memory and flushes only
      -- the numbers here so the playout container can draw progress; who voted stays in the
      -- worker, both because the overlay never needs identities and because this table should not
      -- become a second place viewer handles are stored. votes_needed is written rather than
      -- derived: it depends on the active-chatter count only the worker knows.
      CREATE TABLE IF NOT EXISTS chat_skip_vote (
        singleton_id SMALLINT PRIMARY KEY DEFAULT 1,
        asset_id TEXT NOT NULL DEFAULT '',
        skip_command TEXT NOT NULL DEFAULT 'skip',
        votes INTEGER NOT NULL DEFAULT 0,
        votes_needed INTEGER NOT NULL DEFAULT 0,
        started_at TEXT NOT NULL DEFAULT '',
        expires_at TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL DEFAULT ''
      );
    `);
  }
};

if (!schemaMigrations.some((migration) => migration.id === chatSkipVoteMigration.id)) {
  schemaMigrations.push(chatSkipVoteMigration);
}

// 005 because 001-004 of this date are taken above (broadcaster connection, asset chapters, chat
// game, skip vote); checked against main at the time of writing. Like the skip-vote table this is
// declared in the base-schema block as well, which only ever runs for databases created from
// nothing — this migration is what carries the table to every existing install.
const chatOverlayMessagesMigration: MigrationDefinition = {
  id: "20260825_005_chat_overlay_messages",
  description: "Persist recent chat messages so the playout container can draw them on air.",
  apply: async (client) => {
    await client.query(`
      -- One row: the chat messages the on-air overlay may draw. The worker's chat bridge keeps
      -- the live ring buffer in memory and flushes a display projection here so the playout
      -- container can render it — the same boundary chat_vote_session and chat_skip_vote cross.
      -- Only what the frame shows is stored: display name, text, timestamp. No user ids, no
      -- logins, no message ids — moderation removals happen in the worker's buffer and reach
      -- this row as the next flush of its contents.
      CREATE TABLE IF NOT EXISTS chat_overlay_messages (
        singleton_id SMALLINT PRIMARY KEY DEFAULT 1,
        enabled BOOLEAN NOT NULL DEFAULT FALSE,
        position TEXT NOT NULL DEFAULT 'bottom-left',
        max_messages INTEGER NOT NULL DEFAULT 5,
        messages JSONB NOT NULL DEFAULT '[]'::jsonb,
        updated_at TEXT NOT NULL DEFAULT ''
      );
    `);
  }
};

if (!schemaMigrations.some((migration) => migration.id === chatOverlayMessagesMigration.id)) {
  schemaMigrations.push(chatOverlayMessagesMigration);
}

// 007 even though 006 is unused here: 001-005 of this date are taken above and 006 is reserved
// for the M56 work landing in parallel, so this branch skips it rather than racing for the same
// number. Declared in the base-schema block as well; this migration carries the columns to every
// existing install.
const assetChapterProbeMigration: MigrationDefinition = {
  id: "20260825_007_asset_chapter_probe",
  description: "Track per-asset chapter probe outcomes so the budgeted backfill never re-fetches or retries hot.",
  apply: async (client) => {
    await client.query(`
      -- Bookkeeping for the chapter backfill (YouTube items, Twitch archive VODs, direct media):
      -- '' = never probed, 'ok' = probe completed (possibly finding no chapters — that answer is
      -- final, the budget is not spent on it again), 'failed' = wait out the cooldown measured
      -- from chapters_probed_at before the next attempt.
      ALTER TABLE assets ADD COLUMN IF NOT EXISTS chapters_probe_status TEXT NOT NULL DEFAULT '';
      ALTER TABLE assets ADD COLUMN IF NOT EXISTS chapters_probed_at TEXT NOT NULL DEFAULT '';
    `);
  }
};

if (!schemaMigrations.some((migration) => migration.id === assetChapterProbeMigration.id)) {
  schemaMigrations.push(assetChapterProbeMigration);
}

// 006, claimed late: the number was reserved for M56 while that work was in flight (see the 007
// comment above), but M56 landed touching only managed_config through the base-block ALTERs and
// never registered a migration — verified against the full migration list, where this date runs
// 001–005 and then 007. The gap is real, so this migration closes it. Ordering is safe either
// way: migrations apply in registration order and the ids are opaque names, so installs that
// already recorded 007 simply record 006 afterwards.
const assetRetentionMarksMigration: MigrationDefinition = {
  id: "20260825_006_asset_retention_marks",
  description: "Track when each orphaned asset was first observed, so the retention sweep's protection window is honest.",
  apply: async (client) => {
    await client.query(`
      -- Same table and rationale as the base-schema block: the sweep's orphan-first-seen clock,
      -- kept out of the assets table because full-state writes rewrite assets wholesale.
      CREATE TABLE IF NOT EXISTS asset_retention_marks (
        asset_id TEXT PRIMARY KEY,
        orphan_first_seen_at TEXT NOT NULL
      );
    `);
  }
};

if (!schemaMigrations.some((migration) => migration.id === assetRetentionMarksMigration.id)) {
  schemaMigrations.push(assetRetentionMarksMigration);
}

// Numbered under the next day rather than 20260825_006: that slot was reserved for M56 work
// landing in parallel, and the retention sweep ultimately claimed it in the same merge window —
// the next-day sequence sidestepped the race exactly as intended.
const overlayVideoSourcesMigration: MigrationDefinition = {
  id: "20260826_001_overlay_video_sources",
  description: "Store external video sources for the scene's source layer, feed URL encrypted at rest.",
  apply: async (client) => {
    await client.query(`
      -- External video sources the scene's source layer can show (M57). One row per stored
      -- camera/feed. The URL is encrypted with the same app-secret-derived key as managed
      -- destination stream keys, and url_present exists so listing surfaces can show that a
      -- feed is configured without ever selecting the encrypted value.
      CREATE TABLE IF NOT EXISTS overlay_video_sources (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        url_present BOOLEAN NOT NULL DEFAULT FALSE,
        encrypted_url TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL DEFAULT ''
      );
    `);
  }
};

if (!schemaMigrations.some((migration) => migration.id === overlayVideoSourcesMigration.id)) {
  schemaMigrations.push(overlayVideoSourcesMigration);
}

// 20260826_002/_003: verified free — the 2026-08-26 sequence holds only _001 (above), and no
// later date is registered, so stage 2 of M57 simply continues the same day's sequence.
const overlayVideoSourcePushIngestMigration: MigrationDefinition = {
  id: "20260826_002_overlay_video_source_push_ingest",
  description: "Let a video source be pushed to the relay: ingest kind plus an encrypted publish key.",
  apply: async (client) => {
    await client.query(`
      -- Additive, matching the base-schema block. 'pull' keeps every existing row meaning
      -- exactly what it meant (the worker fetches the stored URL); 'push' rows never store a
      -- playback URL at all — it is derived from the internal relay key on read.
      ALTER TABLE overlay_video_sources ADD COLUMN IF NOT EXISTS ingest_kind TEXT NOT NULL DEFAULT 'pull';
      ALTER TABLE overlay_video_sources ADD COLUMN IF NOT EXISTS encrypted_publish_key TEXT NOT NULL DEFAULT '';
    `);
  }
};

if (!schemaMigrations.some((migration) => migration.id === overlayVideoSourcePushIngestMigration.id)) {
  schemaMigrations.push(overlayVideoSourcePushIngestMigration);
}

const managedSecretsMigration: MigrationDefinition = {
  id: "20260826_003_managed_secrets",
  description: "A table for self-generated internal secrets, starting with the relay access key.",
  apply: async (client) => {
    await client.query(`
      -- Same table and rationale as the base-schema block: secrets no operator ever types,
      -- generated on first use and shared through the database all services already reach.
      CREATE TABLE IF NOT EXISTS managed_secrets (
        id TEXT PRIMARY KEY,
        encrypted_value TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT ''
      );
    `);
  }
};

if (!schemaMigrations.some((migration) => migration.id === managedSecretsMigration.id)) {
  schemaMigrations.push(managedSecretsMigration);
}

// 20260826_004: verified free — the 2026-08-26 sequence holds _001 through _003 (all above) and
// nothing later is registered, so Etappe E continues the same day's sequence.
const overlayVideoSourceLiveStateMigration: MigrationDefinition = {
  id: "20260826_004_overlay_video_source_live_state",
  description: "Remember the last live attach decision per video source, so the studio can show it.",
  apply: async (client) => {
    await client.query(`
      -- Additive, matching the base-schema block. Empty means "nothing decided yet", which is
      -- exactly what every existing row is: the decision is only made while an asset is playing
      -- and both source switches are on. No credential lives in these columns.
      ALTER TABLE overlay_video_sources ADD COLUMN IF NOT EXISTS live_state TEXT NOT NULL DEFAULT '';
      ALTER TABLE overlay_video_sources ADD COLUMN IF NOT EXISTS live_state_at TEXT NOT NULL DEFAULT '';
      ALTER TABLE overlay_video_sources ADD COLUMN IF NOT EXISTS live_retry_at TEXT NOT NULL DEFAULT '';
    `);
  }
};

if (!schemaMigrations.some((migration) => migration.id === overlayVideoSourceLiveStateMigration.id)) {
  schemaMigrations.push(overlayVideoSourceLiveStateMigration);
}

const workerHeartbeatRuntimeMigration: MigrationDefinition = {
  id: "20260901_001_worker_heartbeat_runtime",
  description: "Give the worker reconciliation loop a runtime heartbeat so it stops writing to the audit trail.",
  apply: async (client) => {
    await client.query(`
      -- Additive, matching the base-schema block. Empty means "no cycle recorded yet", which is
      -- what every existing row is until the worker next completes a pass -- at most 30 seconds
      -- after the upgrade. The readers treat empty as "missing", the same answer they gave when
      -- no worker.cycle audit event existed, so the upgrade window degrades exactly as before.
      ALTER TABLE playout_runtime ADD COLUMN IF NOT EXISTS worker_heartbeat_at TEXT NOT NULL DEFAULT '';
    `);
  }
};

if (!schemaMigrations.some((migration) => migration.id === workerHeartbeatRuntimeMigration.id)) {
  schemaMigrations.push(workerHeartbeatRuntimeMigration);
}

const redactStoredSecretsMigration: MigrationDefinition = {
  id: "20260902_001_redact_stored_secrets",
  description: "Scrub credential-shaped text out of incidents and the audit trail that was written before the sinks redacted.",
  apply: async (client) => {
    // Idempotent: rows that redactSecrets leaves unchanged are not touched, so re-running is free.
    const incidents = await client.query<{ id: string; title: string; message: string }>("SELECT id, title, message FROM incidents");
    for (const row of incidents.rows) {
      const title = redactSecrets(row.title);
      const message = redactSecrets(row.message);
      if (title !== row.title || message !== row.message) {
        await client.query("UPDATE incidents SET title = $2, message = $3 WHERE id = $1", [row.id, title, message]);
      }
    }
    const audit = await client.query<{ id: string; message: string }>("SELECT id, message FROM audit_events");
    for (const row of audit.rows) {
      const message = redactSecrets(row.message);
      if (message !== row.message) {
        await client.query("UPDATE audit_events SET message = $2 WHERE id = $1", [row.id, message]);
      }
    }
  }
};
if (!schemaMigrations.some((migration) => migration.id === redactStoredSecretsMigration.id)) {
  schemaMigrations.push(redactStoredSecretsMigration);
}

async function ensureSchemaMigrationsTable(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      description TEXT NOT NULL,
      applied_at TEXT NOT NULL
    )
  `);
}

async function applyPendingMigrations(client: PoolClient): Promise<void> {
  await ensureSchemaMigrationsTable(client);
  const result = await client.query<{ id: string }>("SELECT id FROM schema_migrations");
  const applied = new Set(result.rows.map((row) => row.id));

  for (const migration of schemaMigrations) {
    if (applied.has(migration.id)) {
      continue;
    }

    await migration.apply(client);
    await client.query("INSERT INTO schema_migrations (id, description, applied_at) VALUES ($1, $2, $3)", [
      migration.id,
      migration.description,
      new Date().toISOString()
    ]);
  }
}

async function readLegacyState(): Promise<AppState | null> {
  try {
    const raw = await fs.readFile(legacyStatePath, "utf8");
    return normalizeState(JSON.parse(raw) as AppState);
  } catch {
    return null;
  }
}

async function isDatabaseEmpty(client: PoolClient): Promise<boolean> {
  const result = await client.query<{
    has_system_state: boolean;
    has_playout_runtime: boolean;
    has_users: boolean;
    has_sources: boolean;
    has_assets: boolean;
    has_pools: boolean;
    has_schedule_blocks: boolean;
  }>(`
    SELECT
      EXISTS (SELECT 1 FROM system_state) AS has_system_state,
      EXISTS (SELECT 1 FROM playout_runtime) AS has_playout_runtime,
      EXISTS (SELECT 1 FROM users) AS has_users,
      EXISTS (SELECT 1 FROM sources) AS has_sources,
      EXISTS (SELECT 1 FROM assets) AS has_assets,
      EXISTS (SELECT 1 FROM pools) AS has_pools,
      EXISTS (SELECT 1 FROM schedule_blocks) AS has_schedule_blocks
  `);
  const row = result.rows[0];
  return !(
    row?.has_system_state ||
    row?.has_playout_runtime ||
    row?.has_users ||
    row?.has_sources ||
    row?.has_assets ||
    row?.has_pools ||
    row?.has_schedule_blocks
  );
}

async function acquireStateWriteLock(client: PoolClient): Promise<void> {
  await client.query("SELECT pg_advisory_xact_lock($1)", [STATE_WRITE_LOCK_KEY]);
}

async function rollbackQuietly(client: PoolClient): Promise<void> {
  try {
    await client.query("ROLLBACK");
  } catch {
    // Ignore rollback errors when the transaction is already aborted or closed.
  }
}

async function withSerializedStateWrite<T>(operationName: string, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  await ensureDatabase();

  let attempt = 0;
  let lastError: unknown;

  while (attempt < STATE_WRITE_MAX_RETRIES) {
    attempt += 1;
    const client = await getPool().connect();

    try {
      await client.query("BEGIN");
      await acquireStateWriteLock(client);
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      lastError = error;
      await rollbackQuietly(client);

      if (!isRetryableStateWriteError(error) || attempt >= STATE_WRITE_MAX_RETRIES) {
        throw error;
      }

      // eslint-disable-next-line no-console
      console.warn(
        `[stream247-db] ${operationName} retrying after PostgreSQL ${error.code} (attempt ${attempt}/${STATE_WRITE_MAX_RETRIES}).`
      );

      await sleep(75 * attempt);
    } finally {
      client.release();
    }
  }

  throw lastError instanceof Error ? lastError : new Error(`State write failed during ${operationName}.`);
}

async function persistState(client: PoolClient, state: AppState): Promise<void> {
  const next = normalizeState(state);
  const owner = next.owner ?? { email: "", passwordHash: "", createdAt: "" };

  await client.query(
    `
      INSERT INTO system_state (singleton_id, initialized, owner_email, owner_password_hash, owner_created_at)
      VALUES (1, $1, $2, $3, $4)
      ON CONFLICT (singleton_id) DO UPDATE SET
        initialized = EXCLUDED.initialized,
        owner_email = EXCLUDED.owner_email,
        owner_password_hash = EXCLUDED.owner_password_hash,
        owner_created_at = EXCLUDED.owner_created_at
    `,
    [next.initialized, owner.email, owner.passwordHash, owner.createdAt]
  );

  await client.query(
    `
      INSERT INTO moderation_settings (
        singleton_id, enabled, command, default_minutes, min_minutes, max_minutes, require_prefix, fallback_emote_only
      )
      VALUES (1, $1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (singleton_id) DO UPDATE SET
        enabled = EXCLUDED.enabled,
        command = EXCLUDED.command,
        default_minutes = EXCLUDED.default_minutes,
        min_minutes = EXCLUDED.min_minutes,
        max_minutes = EXCLUDED.max_minutes,
        require_prefix = EXCLUDED.require_prefix,
        fallback_emote_only = EXCLUDED.fallback_emote_only
    `,
    [
      next.moderation.enabled,
      next.moderation.command,
      next.moderation.defaultMinutes,
      next.moderation.minMinutes,
      next.moderation.maxMinutes,
      next.moderation.requirePrefix,
      next.moderation.fallbackEmoteOnly
    ]
  );

  await client.query(
    `
        INSERT INTO overlay_settings (
          singleton_id, enabled, channel_name, headline, insert_headline, standby_headline, reconnect_headline, replay_label, brand_badge, scene_preset, insert_scene_preset, standby_scene_preset, reconnect_scene_preset, accent_color, surface_style, panel_anchor, title_scale, typography_preset, show_clock, show_next_item, show_schedule_teaser, show_current_category, show_source_label, show_queue_preview, queue_preview_count, layer_order_json, disabled_layers_json, custom_layers_json, emergency_banner, ticker_text, updated_at
        )
        VALUES (1, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30)
        ON CONFLICT (singleton_id) DO UPDATE SET
          enabled = EXCLUDED.enabled,
          channel_name = EXCLUDED.channel_name,
          headline = EXCLUDED.headline,
          insert_headline = EXCLUDED.insert_headline,
          standby_headline = EXCLUDED.standby_headline,
          reconnect_headline = EXCLUDED.reconnect_headline,
          replay_label = EXCLUDED.replay_label,
          brand_badge = EXCLUDED.brand_badge,
          scene_preset = EXCLUDED.scene_preset,
          insert_scene_preset = EXCLUDED.insert_scene_preset,
          standby_scene_preset = EXCLUDED.standby_scene_preset,
          reconnect_scene_preset = EXCLUDED.reconnect_scene_preset,
          accent_color = EXCLUDED.accent_color,
          surface_style = EXCLUDED.surface_style,
          panel_anchor = EXCLUDED.panel_anchor,
          title_scale = EXCLUDED.title_scale,
          typography_preset = EXCLUDED.typography_preset,
          show_clock = EXCLUDED.show_clock,
          show_next_item = EXCLUDED.show_next_item,
          show_schedule_teaser = EXCLUDED.show_schedule_teaser,
          show_current_category = EXCLUDED.show_current_category,
          show_source_label = EXCLUDED.show_source_label,
          show_queue_preview = EXCLUDED.show_queue_preview,
          queue_preview_count = EXCLUDED.queue_preview_count,
          layer_order_json = EXCLUDED.layer_order_json,
          disabled_layers_json = EXCLUDED.disabled_layers_json,
          custom_layers_json = EXCLUDED.custom_layers_json,
          emergency_banner = EXCLUDED.emergency_banner,
          ticker_text = EXCLUDED.ticker_text,
          updated_at = EXCLUDED.updated_at
      `,
      [
        next.overlay.enabled,
        next.overlay.channelName,
        next.overlay.headline,
        next.overlay.insertHeadline,
        next.overlay.standbyHeadline,
        next.overlay.reconnectHeadline,
        next.overlay.replayLabel,
        next.overlay.brandBadge,
        next.overlay.scenePreset,
        next.overlay.insertScenePreset,
        next.overlay.standbyScenePreset,
        next.overlay.reconnectScenePreset,
        next.overlay.accentColor,
        next.overlay.surfaceStyle,
        next.overlay.panelAnchor,
        next.overlay.titleScale,
        next.overlay.typographyPreset,
        next.overlay.showClock,
        next.overlay.showNextItem,
        next.overlay.showScheduleTeaser,
        next.overlay.showCurrentCategory,
        next.overlay.showSourceLabel,
        next.overlay.showQueuePreview,
        next.overlay.queuePreviewCount,
        JSON.stringify(next.overlay.layerOrder),
        JSON.stringify(next.overlay.disabledLayers),
        JSON.stringify(next.overlay.customLayers),
        next.overlay.emergencyBanner,
        next.overlay.tickerText,
        next.overlay.updatedAt
      ]
    );

  await client.query(
    `
      INSERT INTO managed_config (singleton_id, encrypted_payload, updated_at)
      VALUES (1, $1, $2)
      ON CONFLICT (singleton_id) DO UPDATE SET
        encrypted_payload = EXCLUDED.encrypted_payload,
        updated_at = EXCLUDED.updated_at
    `,
    [encryptManagedConfig(next.managedConfig), next.managedConfig.updatedAt]
  );

  await client.query(
    `
      INSERT INTO output_settings (singleton_id, profile_id, width, height, fps, updated_at)
      VALUES (1, $1, $2, $3, $4, $5)
      ON CONFLICT (singleton_id) DO UPDATE SET
        profile_id = EXCLUDED.profile_id,
        width = EXCLUDED.width,
        height = EXCLUDED.height,
        fps = EXCLUDED.fps,
        updated_at = EXCLUDED.updated_at
    `,
    [next.output.profileId, next.output.width, next.output.height, next.output.fps, next.output.updatedAt]
  );

  await client.query(
    `
      INSERT INTO engagement_settings (
        singleton_id, chat_enabled, alerts_enabled, donations_enabled, channel_points_enabled, game_enabled, solo_mode_enabled, small_group_mode_enabled, crowd_mode_enabled, game_window_minutes, chat_mode, chat_position, alert_position, style, max_messages, rate_limit_per_minute, updated_at
      )
      VALUES (1, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      ON CONFLICT (singleton_id) DO UPDATE SET
        chat_enabled = EXCLUDED.chat_enabled,
        alerts_enabled = EXCLUDED.alerts_enabled,
        donations_enabled = EXCLUDED.donations_enabled,
        channel_points_enabled = EXCLUDED.channel_points_enabled,
        game_enabled = EXCLUDED.game_enabled,
        solo_mode_enabled = EXCLUDED.solo_mode_enabled,
        small_group_mode_enabled = EXCLUDED.small_group_mode_enabled,
        crowd_mode_enabled = EXCLUDED.crowd_mode_enabled,
        game_window_minutes = EXCLUDED.game_window_minutes,
        chat_mode = EXCLUDED.chat_mode,
        chat_position = EXCLUDED.chat_position,
        alert_position = EXCLUDED.alert_position,
        style = EXCLUDED.style,
        max_messages = EXCLUDED.max_messages,
        rate_limit_per_minute = EXCLUDED.rate_limit_per_minute,
        updated_at = EXCLUDED.updated_at
    `,
    [
      next.engagement.chatEnabled,
      next.engagement.alertsEnabled,
      next.engagement.donationsEnabled,
      next.engagement.channelPointsEnabled,
      next.engagement.gameEnabled,
      next.engagement.soloModeEnabled,
      next.engagement.smallGroupModeEnabled,
      next.engagement.crowdModeEnabled,
      next.engagement.gameWindowMinutes,
      next.engagement.chatMode,
      next.engagement.chatPosition,
      next.engagement.alertPosition,
      next.engagement.style,
      next.engagement.maxMessages,
      next.engagement.rateLimitPerMinute,
      next.engagement.updatedAt
    ]
  );

  await client.query(
    `
      INSERT INTO engagement_game_runtime (singleton_id, active_chatter_count, mode, mode_changed_at, updated_at)
      VALUES (1, $1, $2, $3, $4)
      ON CONFLICT (singleton_id) DO UPDATE SET
        active_chatter_count = EXCLUDED.active_chatter_count,
        mode = EXCLUDED.mode,
        mode_changed_at = EXCLUDED.mode_changed_at,
        updated_at = EXCLUDED.updated_at
    `,
    [
      next.engagementGame.activeChatterCount,
      next.engagementGame.mode,
      next.engagementGame.modeChangedAt,
      next.engagementGame.updatedAt
    ]
  );

  await client.query("DELETE FROM engagement_events");
  for (const event of next.engagementEvents.slice(0, 100)) {
    const normalized = normalizeEngagementEventRecord(event);
    await client.query(
      `
        INSERT INTO engagement_events (id, kind, actor, message, created_at)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (id) DO UPDATE SET
          kind = EXCLUDED.kind,
          actor = EXCLUDED.actor,
          message = EXCLUDED.message,
          created_at = EXCLUDED.created_at
      `,
      [normalized.id, normalized.kind, normalized.actor, normalized.message, normalized.createdAt]
    );
  }

  await client.query(
    `
      INSERT INTO twitch_connection (
        singleton_id, status, broadcaster_id, broadcaster_login, access_token, refresh_token, connected_at, token_expires_at,
        last_refresh_at, last_metadata_sync_at, last_synced_title, last_synced_category_name, last_synced_category_id,
        last_schedule_sync_at, live_status, viewer_count, started_at, error
      )
      VALUES (1, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
      ON CONFLICT (singleton_id) DO UPDATE SET
        status = EXCLUDED.status,
        broadcaster_id = EXCLUDED.broadcaster_id,
        broadcaster_login = EXCLUDED.broadcaster_login,
        access_token = EXCLUDED.access_token,
        refresh_token = EXCLUDED.refresh_token,
        connected_at = EXCLUDED.connected_at,
        token_expires_at = EXCLUDED.token_expires_at,
        last_refresh_at = EXCLUDED.last_refresh_at,
        last_metadata_sync_at = EXCLUDED.last_metadata_sync_at,
        last_synced_title = EXCLUDED.last_synced_title,
        last_synced_category_name = EXCLUDED.last_synced_category_name,
        last_synced_category_id = EXCLUDED.last_synced_category_id,
        last_schedule_sync_at = EXCLUDED.last_schedule_sync_at,
        live_status = EXCLUDED.live_status,
        viewer_count = EXCLUDED.viewer_count,
        started_at = EXCLUDED.started_at,
        error = EXCLUDED.error
    `,
    [
      next.twitch.status,
      next.twitch.broadcasterId,
      next.twitch.broadcasterLogin,
      next.twitch.accessToken,
      next.twitch.refreshToken,
      next.twitch.connectedAt,
      next.twitch.tokenExpiresAt,
      next.twitch.lastRefreshAt,
      next.twitch.lastMetadataSyncAt,
      next.twitch.lastSyncedTitle,
      next.twitch.lastSyncedCategoryName,
      next.twitch.lastSyncedCategoryId,
      next.twitch.lastScheduleSyncAt,
      next.twitch.liveStatus,
      next.twitch.viewerCount,
      next.twitch.startedAt || "",
      next.twitch.error
    ]
  );

  await client.query(
    `
      INSERT INTO twitch_broadcaster_connection (
        singleton_id, status, broadcaster_id, broadcaster_login, access_token, refresh_token, connected_at,
        token_expires_at, last_refresh_at, error
      )
      VALUES (1, $1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (singleton_id) DO UPDATE SET
        status = EXCLUDED.status,
        broadcaster_id = EXCLUDED.broadcaster_id,
        broadcaster_login = EXCLUDED.broadcaster_login,
        access_token = EXCLUDED.access_token,
        refresh_token = EXCLUDED.refresh_token,
        connected_at = EXCLUDED.connected_at,
        token_expires_at = EXCLUDED.token_expires_at,
        last_refresh_at = EXCLUDED.last_refresh_at,
        error = EXCLUDED.error
    `,
    [
      next.twitchBroadcaster.status,
      next.twitchBroadcaster.broadcasterId,
      next.twitchBroadcaster.broadcasterLogin,
      next.twitchBroadcaster.accessToken,
      next.twitchBroadcaster.refreshToken,
      next.twitchBroadcaster.connectedAt,
      next.twitchBroadcaster.tokenExpiresAt,
      next.twitchBroadcaster.lastRefreshAt,
      next.twitchBroadcaster.error
    ]
  );

  await client.query("DELETE FROM twitch_schedule_segments");
  for (const segment of next.twitchScheduleSegments) {
    await client.query(
      `
        INSERT INTO twitch_schedule_segments (key, segment_id, block_id, start_time, title, synced_at)
        VALUES ($1, $2, $3, $4, $5, $6)
      `,
      [segment.key, segment.segmentId, segment.blockId, segment.startTime, segment.title, segment.syncedAt]
    );
  }

  await persistPlayoutRuntime(client, next.playout);

  await client.query("DELETE FROM users");
  for (const user of next.users) {
    await client.query(
      `
        INSERT INTO users (
          id, email, display_name, auth_provider, role, twitch_user_id, twitch_login, password_hash,
          two_factor_enabled, two_factor_secret, two_factor_confirmed_at, created_at, last_login_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      `,
      [
        user.id,
        user.email,
        user.displayName,
        user.authProvider,
        user.role,
        user.twitchUserId,
        user.twitchLogin,
        user.passwordHash ?? "",
        user.twoFactorEnabled ?? false,
        encryptSecretString(user.twoFactorSecret ?? ""),
        user.twoFactorConfirmedAt ?? "",
        user.createdAt,
        user.lastLoginAt
      ]
    );
  }

  await client.query("DELETE FROM team_access_grants");
  for (const grant of next.teamAccessGrants) {
    await client.query(
      `
        INSERT INTO team_access_grants (id, twitch_login, role, created_at, created_by)
        VALUES ($1, $2, $3, $4, $5)
      `,
      [grant.id, grant.twitchLogin, grant.role, grant.createdAt, grant.createdBy]
    );
  }

  await client.query("DELETE FROM presence_windows");
  for (const window of next.presenceWindows) {
    await client.query(
      `
        INSERT INTO presence_windows (
          actor, minutes, requested_minutes, applied_minutes, clamp_reason, created_at, expires_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `,
      [
        window.actor,
        window.minutes,
        window.requestedMinutes ?? null,
        window.appliedMinutes ?? window.minutes,
        normalizePresenceClampReason(window.clampReason),
        window.createdAt,
        window.expiresAt
      ]
    );
  }

  await client.query("DELETE FROM schedule_blocks");
  for (const block of next.scheduleBlocks) {
    await client.query(
      `
        INSERT INTO schedule_blocks (
          id, title, category_name, start_hour, start_minute_of_day, duration_minutes, day_of_week, show_id, pool_id, source_name, repeat_mode, repeat_group_id, cuepoint_asset_id, cuepoint_offsets_seconds
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      `,
      [
        block.id,
        block.title,
        block.categoryName,
        Math.floor(block.startMinuteOfDay / 60),
        block.startMinuteOfDay,
        block.durationMinutes,
        block.dayOfWeek,
        block.showId ?? "",
        block.poolId ?? "",
        block.sourceName,
        block.repeatMode ?? "single",
        block.repeatGroupId ?? "",
        block.cuepointAssetId ?? "",
        JSON.stringify(block.cuepointOffsetsSeconds ?? [])
      ]
    );
  }

  await client.query("DELETE FROM pools");
  for (const pool of next.pools) {
    await client.query(
      `
        INSERT INTO pools (id, name, source_ids, playback_mode, cursor_asset_id, insert_asset_id, insert_every_items, items_since_insert, audio_lane_asset_id, audio_lane_volume_percent, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      `,
      [
        pool.id,
        pool.name,
        JSON.stringify(pool.sourceIds),
        pool.playbackMode,
        pool.cursorAssetId ?? "",
        pool.insertAssetId ?? "",
        pool.insertEveryItems ?? 0,
        pool.itemsSinceInsert ?? 0,
        pool.audioLaneAssetId ?? "",
        pool.audioLaneVolumePercent ?? 100,
        pool.updatedAt
      ]
    );
  }

  await client.query("DELETE FROM show_profiles");
  for (const show of next.showProfiles) {
    await client.query(
      `
        INSERT INTO show_profiles (id, name, category_name, default_duration_minutes, color, description, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `,
      [show.id, show.name, show.categoryName, show.defaultDurationMinutes, show.color, show.description, show.updatedAt]
    );
  }

  await client.query("DELETE FROM sources");
  for (const source of next.sources) {
    await client.query(
      `
        INSERT INTO sources (id, name, type, connector_kind, enabled, status, external_url, notes, last_synced_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `,
      [
        source.id,
        source.name,
        source.type,
        source.connectorKind,
        source.enabled ?? true,
        source.status,
        source.externalUrl ?? "",
        source.notes ?? "",
        source.lastSyncedAt ?? ""
      ]
    );
  }

  await client.query("DELETE FROM assets");
  for (const asset of next.assets) {
    await client.query(
      `
        INSERT INTO assets (
          id, source_id, title, path, cache_path, cache_status, cache_updated_at, cache_error, folder_path, tags_json, status,
          title_prefix, hashtags_json, platform_notes, chapters_json, chapters_probe_status, chapters_probed_at, include_in_programming, external_id, category_name, duration_seconds, published_at,
          fallback_priority, is_global_fallback, created_at, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26)
      `,
      [
        asset.id,
        asset.sourceId,
        asset.title,
        asset.path,
        asset.cachePath ?? "",
        asset.cacheStatus ?? "",
        asset.cacheUpdatedAt ?? "",
        asset.cacheError ?? "",
        asset.folderPath ?? "",
        JSON.stringify(normalizeAssetTags(asset.tags ?? [])),
        asset.status,
        asset.titlePrefix ?? "",
        asset.hashtagsJson ?? "[]",
        asset.platformNotes ?? "",
        normalizeAssetChaptersJson(asset.chaptersJson ?? "[]"),
        normalizeAssetChapterProbeStatus(asset.chaptersProbeStatus),
        asset.chaptersProbedAt ?? "",
        asset.includeInProgramming,
        asset.externalId ?? "",
        asset.categoryName ?? "",
        asset.durationSeconds ?? 0,
        asset.publishedAt ?? "",
        asset.fallbackPriority,
        asset.isGlobalFallback,
        asset.createdAt,
        asset.updatedAt
      ]
    );
  }

  await client.query("DELETE FROM asset_collection_items");
  await client.query("DELETE FROM asset_collections");
  for (const collection of next.assetCollections) {
    await client.query(
      `
        INSERT INTO asset_collections (id, name, description, color, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6)
      `,
      [collection.id, collection.name, collection.description, collection.color, collection.createdAt, collection.updatedAt]
    );

    for (const [index, assetId] of collection.assetIds.entries()) {
      await client.query(
        `
          INSERT INTO asset_collection_items (collection_id, asset_id, position)
          VALUES ($1, $2, $3)
        `,
        [collection.id, assetId, index]
      );
    }
  }

  await client.query("DELETE FROM source_sync_runs");
  for (const run of next.sourceSyncRuns.slice(0, 250)) {
    await client.query(
      `
        INSERT INTO source_sync_runs (
          id, source_id, started_at, finished_at, status, summary, discovered_assets, ready_assets, error_message
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `,
      [
        run.id,
        run.sourceId,
        run.startedAt,
        run.finishedAt,
        run.status,
        run.summary,
        run.discoveredAssets,
        run.readyAssets,
        run.errorMessage
      ]
    );
  }

  const existingDestinationSecretsResult = await client.query<{ id: string; encrypted_stream_key: string }>(
    "SELECT id, encrypted_stream_key FROM stream_destinations"
  );
  const existingDestinationSecrets = new Map(
    existingDestinationSecretsResult.rows.map((row) => [row.id, row.encrypted_stream_key || ""] as const)
  );

  await client.query("DELETE FROM stream_destinations");
  for (const destination of next.destinations) {
    await client.query(
      `
        INSERT INTO stream_destinations (
          id, provider, role, priority, output_profile_id, name, enabled, rtmp_url, stream_key_present, encrypted_stream_key, status, notes,
          last_validated_at, last_failure_at, failure_count, last_error
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      `,
      [
        destination.id,
        destination.provider,
        destination.role,
        destination.priority,
        normalizeDestinationOutputProfileId(destination.outputProfileId),
        destination.name,
        destination.enabled,
        destination.rtmpUrl,
        destination.streamKeyPresent,
        existingDestinationSecrets.get(destination.id) || "",
        destination.status,
        destination.notes,
        destination.lastValidatedAt,
        destination.lastFailureAt,
        destination.failureCount,
        destination.lastError
      ]
    );
  }

  await client.query("DELETE FROM incidents");
  for (const incident of next.incidents) {
    await client.query(
      `
        INSERT INTO incidents (
          id, scope, severity, status, acknowledged_at, acknowledged_by, title, message, fingerprint, created_at, updated_at, resolved_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      `,
      [
        incident.id,
        incident.scope,
        incident.severity,
        incident.status,
        incident.acknowledgedAt,
        incident.acknowledgedBy,
        incident.title,
        incident.message,
        incident.fingerprint,
        incident.createdAt,
        incident.updatedAt,
        incident.resolvedAt
      ]
    );
  }

  await client.query("DELETE FROM audit_events");
  const retainedAuditEvents = next.auditEvents.slice(0, AUDIT_EVENT_RETENTION_LIMIT);
  if (retainedAuditEvents.length > 0) {
    // One statement rather than a query per row. This rewrite runs inside the global serialized
    // write lock on every state mutation, so a row-at-a-time loop made the retention bound a
    // direct cost on every write; batching keeps raising the bound from showing up there.
    const values = retainedAuditEvents.flatMap((event) => [event.id, event.type, event.message, event.createdAt]);
    const tuples = retainedAuditEvents
      .map((_, index) => `($${index * 4 + 1}, $${index * 4 + 2}, $${index * 4 + 3}, $${index * 4 + 4})`)
      .join(", ");
    await client.query(`INSERT INTO audit_events (id, type, message, created_at) VALUES ${tuples}`, values);
  }
}

async function persistPlayoutRuntime(client: PoolClient, playout: PlayoutRuntimeRecord): Promise<void> {
  await client.query(
    `
      INSERT INTO playout_runtime (
        singleton_id, status, transition_state, queue_version, transition_target_kind, transition_target_asset_id, transition_target_title, transition_ready_at,
        current_asset_id, current_title, previous_asset_id, previous_title, desired_asset_id, next_asset_id, next_title, queued_asset_ids, queue_items, prefetched_asset_id,
        prefetched_title, prefetched_at, prefetch_status, prefetch_error, current_destination_id, restart_requested_at, heartbeat_at, process_pid,
        process_started_at, last_transition_at, last_successful_start_at, last_successful_asset_id, last_exit_code, restart_count,
        crash_count_window, crash_loop_detected, last_error, last_stderr_sample, selection_reason_code, fallback_tier, override_mode,
        override_asset_id, override_until, live_bridge_input_type, live_bridge_input_url, live_bridge_label, live_bridge_status, live_bridge_requested_at, live_bridge_started_at,
        live_bridge_released_at, live_bridge_last_error, cuepoint_window_key, cuepoint_fired_keys, cuepoint_last_triggered_at, cuepoint_last_asset_id, manual_next_asset_id, manual_next_requested_at, insert_asset_id, insert_requested_at, insert_status, skip_asset_id, skip_until,
        pending_action, pending_action_requested_at, message, uplink_status, uplink_input_mode, uplink_started_at, uplink_heartbeat_at, uplink_destination_ids,
        uplink_restart_count, uplink_unplanned_restart_count, uplink_last_exit_code, uplink_last_exit_reason, uplink_last_exit_planned, uplink_reconnect_until,
        program_feed_status, program_feed_updated_at, program_feed_playlist_path, program_feed_target_seconds, program_feed_buffered_seconds,
        worker_heartbeat_at
      )
      VALUES (1, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, $34, $35, $36, $37, $38, $39, $40, $41, $42, $43, $44, $45, $46, $47, $48, $49, $50, $51, $52, $53, $54, $55, $56, $57, $58, $59, $60, $61, $62, $63, $64, $65, $66, $67, $68, $69, $70, $71, $72, $73, $74, $75, $76, $77, $78, $79)
      ON CONFLICT (singleton_id) DO UPDATE SET
        status = EXCLUDED.status,
        transition_state = EXCLUDED.transition_state,
        queue_version = EXCLUDED.queue_version,
        transition_target_kind = EXCLUDED.transition_target_kind,
        transition_target_asset_id = EXCLUDED.transition_target_asset_id,
        transition_target_title = EXCLUDED.transition_target_title,
        transition_ready_at = EXCLUDED.transition_ready_at,
        current_asset_id = EXCLUDED.current_asset_id,
        current_title = EXCLUDED.current_title,
        previous_asset_id = EXCLUDED.previous_asset_id,
        previous_title = EXCLUDED.previous_title,
        desired_asset_id = EXCLUDED.desired_asset_id,
        next_asset_id = EXCLUDED.next_asset_id,
        next_title = EXCLUDED.next_title,
        queued_asset_ids = EXCLUDED.queued_asset_ids,
        queue_items = EXCLUDED.queue_items,
        prefetched_asset_id = EXCLUDED.prefetched_asset_id,
        prefetched_title = EXCLUDED.prefetched_title,
        prefetched_at = EXCLUDED.prefetched_at,
        prefetch_status = EXCLUDED.prefetch_status,
        prefetch_error = EXCLUDED.prefetch_error,
        current_destination_id = EXCLUDED.current_destination_id,
        restart_requested_at = EXCLUDED.restart_requested_at,
        heartbeat_at = EXCLUDED.heartbeat_at,
        process_pid = EXCLUDED.process_pid,
        process_started_at = EXCLUDED.process_started_at,
        last_transition_at = EXCLUDED.last_transition_at,
        last_successful_start_at = EXCLUDED.last_successful_start_at,
        last_successful_asset_id = EXCLUDED.last_successful_asset_id,
        last_exit_code = EXCLUDED.last_exit_code,
        restart_count = EXCLUDED.restart_count,
        crash_count_window = EXCLUDED.crash_count_window,
        crash_loop_detected = EXCLUDED.crash_loop_detected,
        last_error = EXCLUDED.last_error,
        last_stderr_sample = EXCLUDED.last_stderr_sample,
        selection_reason_code = EXCLUDED.selection_reason_code,
        fallback_tier = EXCLUDED.fallback_tier,
        override_mode = EXCLUDED.override_mode,
        override_asset_id = EXCLUDED.override_asset_id,
        override_until = EXCLUDED.override_until,
        live_bridge_input_type = EXCLUDED.live_bridge_input_type,
        live_bridge_input_url = EXCLUDED.live_bridge_input_url,
        live_bridge_label = EXCLUDED.live_bridge_label,
        live_bridge_status = EXCLUDED.live_bridge_status,
        live_bridge_requested_at = EXCLUDED.live_bridge_requested_at,
        live_bridge_started_at = EXCLUDED.live_bridge_started_at,
        live_bridge_released_at = EXCLUDED.live_bridge_released_at,
        live_bridge_last_error = EXCLUDED.live_bridge_last_error,
        cuepoint_window_key = EXCLUDED.cuepoint_window_key,
        cuepoint_fired_keys = EXCLUDED.cuepoint_fired_keys,
        cuepoint_last_triggered_at = EXCLUDED.cuepoint_last_triggered_at,
        cuepoint_last_asset_id = EXCLUDED.cuepoint_last_asset_id,
        manual_next_asset_id = EXCLUDED.manual_next_asset_id,
        manual_next_requested_at = EXCLUDED.manual_next_requested_at,
        insert_asset_id = EXCLUDED.insert_asset_id,
        insert_requested_at = EXCLUDED.insert_requested_at,
        insert_status = EXCLUDED.insert_status,
        skip_asset_id = EXCLUDED.skip_asset_id,
        skip_until = EXCLUDED.skip_until,
        pending_action = EXCLUDED.pending_action,
        pending_action_requested_at = EXCLUDED.pending_action_requested_at,
        message = EXCLUDED.message,
        uplink_status = EXCLUDED.uplink_status,
        uplink_input_mode = EXCLUDED.uplink_input_mode,
        uplink_started_at = EXCLUDED.uplink_started_at,
        uplink_heartbeat_at = EXCLUDED.uplink_heartbeat_at,
        uplink_destination_ids = EXCLUDED.uplink_destination_ids,
        uplink_restart_count = EXCLUDED.uplink_restart_count,
        uplink_unplanned_restart_count = EXCLUDED.uplink_unplanned_restart_count,
        uplink_last_exit_code = EXCLUDED.uplink_last_exit_code,
        uplink_last_exit_reason = EXCLUDED.uplink_last_exit_reason,
        uplink_last_exit_planned = EXCLUDED.uplink_last_exit_planned,
        uplink_reconnect_until = EXCLUDED.uplink_reconnect_until,
        program_feed_status = EXCLUDED.program_feed_status,
        program_feed_updated_at = EXCLUDED.program_feed_updated_at,
        program_feed_playlist_path = EXCLUDED.program_feed_playlist_path,
        program_feed_target_seconds = EXCLUDED.program_feed_target_seconds,
        program_feed_buffered_seconds = EXCLUDED.program_feed_buffered_seconds,
        worker_heartbeat_at = EXCLUDED.worker_heartbeat_at
    `,
    [
      playout.status,
      playout.transitionState,
      playout.queueVersion,
      playout.transitionTargetKind,
      playout.transitionTargetAssetId,
      playout.transitionTargetTitle,
      playout.transitionReadyAt,
      playout.currentAssetId,
      playout.currentTitle,
      playout.previousAssetId,
      playout.previousTitle,
      playout.desiredAssetId,
      playout.nextAssetId,
      playout.nextTitle,
      JSON.stringify(playout.queuedAssetIds ?? []),
      JSON.stringify(playout.queueItems ?? []),
      playout.prefetchedAssetId,
      playout.prefetchedTitle,
      playout.prefetchedAt,
      playout.prefetchStatus,
      playout.prefetchError,
      playout.currentDestinationId,
      playout.restartRequestedAt,
      playout.heartbeatAt,
      playout.processPid,
      playout.processStartedAt,
      playout.lastTransitionAt,
      playout.lastSuccessfulStartAt,
      playout.lastSuccessfulAssetId,
      playout.lastExitCode,
      playout.restartCount,
      playout.crashCountWindow,
      playout.crashLoopDetected,
      playout.lastError,
      playout.lastStderrSample,
      playout.selectionReasonCode,
      playout.fallbackTier,
      playout.overrideMode,
      playout.overrideAssetId,
      playout.overrideUntil,
      playout.liveBridgeInputType,
      playout.liveBridgeInputUrl,
      playout.liveBridgeLabel,
      playout.liveBridgeStatus,
      playout.liveBridgeRequestedAt,
      playout.liveBridgeStartedAt,
      playout.liveBridgeReleasedAt,
      playout.liveBridgeLastError,
      playout.cuepointWindowKey,
      JSON.stringify(playout.cuepointFiredKeys ?? []),
      playout.cuepointLastTriggeredAt,
      playout.cuepointLastAssetId,
      playout.manualNextAssetId,
      playout.manualNextRequestedAt,
      playout.insertAssetId,
      playout.insertRequestedAt,
      playout.insertStatus,
      playout.skipAssetId,
      playout.skipUntil,
      playout.pendingAction,
      playout.pendingActionRequestedAt,
      playout.message,
      playout.uplinkStatus,
      playout.uplinkInputMode,
      playout.uplinkStartedAt,
      playout.uplinkHeartbeatAt,
      JSON.stringify(playout.uplinkDestinationIds ?? []),
      playout.uplinkRestartCount,
      playout.uplinkUnplannedRestartCount,
      playout.uplinkLastExitCode,
      playout.uplinkLastExitReason,
      playout.uplinkLastExitPlanned,
      playout.uplinkReconnectUntil,
      playout.programFeedStatus,
      playout.programFeedUpdatedAt,
      playout.programFeedPlaylistPath,
      playout.programFeedTargetSeconds,
      playout.programFeedBufferedSeconds,
      playout.workerHeartbeatAt
    ]
  );
}

async function hydrateState(client: PoolClient): Promise<AppState> {
  const systemResult = await client.query<{
    initialized: boolean;
    owner_email: string;
    owner_password_hash: string;
    owner_created_at: string;
  }>("SELECT initialized, owner_email, owner_password_hash, owner_created_at FROM system_state WHERE singleton_id = 1");
  const usersResult = await client.query<{
    id: string;
    email: string;
    display_name: string;
    auth_provider: "local" | "twitch";
    role: UserRole;
    twitch_user_id: string;
    twitch_login: string;
    password_hash: string;
    two_factor_enabled: boolean;
    two_factor_secret: string;
    two_factor_confirmed_at: string;
    created_at: string;
    last_login_at: string;
  }>("SELECT * FROM users ORDER BY created_at ASC");
  const grantsResult = await client.query<{
    id: string;
    twitch_login: string;
    role: UserRole;
    created_at: string;
    created_by: string;
  }>("SELECT * FROM team_access_grants ORDER BY created_at DESC");
  const moderationResult = await client.query<{
    enabled: boolean;
    command: string;
    default_minutes: number;
    min_minutes: number;
    max_minutes: number;
    require_prefix: boolean;
    fallback_emote_only: boolean;
  }>(
    "SELECT enabled, command, default_minutes, min_minutes, max_minutes, require_prefix, fallback_emote_only FROM moderation_settings WHERE singleton_id = 1"
  );
  const presenceResult = await client.query<{
    actor: string;
    minutes: number;
    requested_minutes: number | null;
    applied_minutes: number;
    clamp_reason: string;
    created_at: string;
    expires_at: string;
  }>("SELECT * FROM presence_windows ORDER BY created_at DESC LIMIT 100");
  const overlayResult = await client.query<OverlaySettingsRow>("SELECT * FROM overlay_settings WHERE singleton_id = 1");
  const managedConfigResult = await client.query<{
    encrypted_payload: string;
    updated_at: string;
  }>("SELECT * FROM managed_config WHERE singleton_id = 1");
  const outputResult = await client.query<OutputSettingsRow>("SELECT * FROM output_settings WHERE singleton_id = 1");
  const engagementResult = await client.query<EngagementSettingsRow>("SELECT * FROM engagement_settings WHERE singleton_id = 1");
  const engagementGameResult = await client.query<EngagementGameRuntimeRow>(
    "SELECT * FROM engagement_game_runtime WHERE singleton_id = 1"
  );
  const engagementEventsResult = await client.query<EngagementEventRow>(
    "SELECT * FROM engagement_events ORDER BY created_at DESC LIMIT 100"
  );
  const twitchResult = await client.query<{
    status: TwitchConnection["status"];
    broadcaster_id: string;
    broadcaster_login: string;
    access_token: string;
    refresh_token: string;
    connected_at: string;
    token_expires_at: string;
    last_refresh_at: string;
    last_metadata_sync_at: string;
    last_synced_title: string;
    last_synced_category_name: string;
    last_synced_category_id: string;
    last_schedule_sync_at: string;
    live_status: TwitchConnection["liveStatus"];
    viewer_count: number;
    started_at: string;
    error: string;
  }>("SELECT * FROM twitch_connection WHERE singleton_id = 1");
  const twitchBroadcasterResult = await client.query<{
    status: TwitchBroadcasterConnection["status"];
    broadcaster_id: string;
    broadcaster_login: string;
    access_token: string;
    refresh_token: string;
    connected_at: string;
    token_expires_at: string;
    last_refresh_at: string;
    error: string;
  }>("SELECT * FROM twitch_broadcaster_connection WHERE singleton_id = 1");
  const twitchScheduleSegmentsResult = await client.query<{
    key: string;
    segment_id: string;
    block_id: string;
    start_time: string;
    title: string;
    synced_at: string;
  }>("SELECT * FROM twitch_schedule_segments ORDER BY start_time ASC");
  const poolsResult = await client.query<{
    id: string;
    name: string;
    source_ids: string;
    playback_mode: PoolRecord["playbackMode"];
    cursor_asset_id: string;
    insert_asset_id: string;
    insert_every_items: number;
    items_since_insert: number;
    audio_lane_asset_id: string;
    audio_lane_volume_percent: number;
    updated_at: string;
  }>("SELECT * FROM pools ORDER BY name ASC");
  const showProfilesResult = await client.query<{
    id: string;
    name: string;
    category_name: string;
    default_duration_minutes: number;
    color: string;
    description: string;
    updated_at: string;
  }>("SELECT * FROM show_profiles ORDER BY name ASC");
  const blocksResult = await client.query<{
    id: string;
    title: string;
    category_name: string;
    start_hour: number;
    start_minute_of_day: number;
    duration_minutes: number;
    day_of_week: number;
    show_id: string;
    pool_id: string;
    source_name: string;
    repeat_mode: ScheduleBlockRecord["repeatMode"];
    repeat_group_id: string;
    cuepoint_asset_id: string;
    cuepoint_offsets_seconds: string;
  }>("SELECT * FROM schedule_blocks ORDER BY day_of_week ASC, start_minute_of_day ASC, start_hour ASC");
  const sourcesResult = await client.query<{
    id: string;
    name: string;
    type: string;
    connector_kind: SourceRecord["connectorKind"];
    enabled: boolean;
    status: string;
    external_url: string;
    notes: string;
    last_synced_at: string;
  }>("SELECT * FROM sources ORDER BY name ASC");
  const assetsResult = await client.query<{
    id: string;
    source_id: string;
    title: string;
    path: string;
    cache_path: string;
    cache_status: AssetRecord["cacheStatus"];
    cache_updated_at: string;
    cache_error: string;
    folder_path: string;
    tags_json: string;
    title_prefix: string;
    hashtags_json: string;
    platform_notes: string;
    chapters_json: string;
    chapters_probe_status: string;
    chapters_probed_at: string;
    status: AssetRecord["status"];
    include_in_programming: boolean;
    external_id: string;
    category_name: string;
    duration_seconds: number;
    published_at: string;
    fallback_priority: number;
    is_global_fallback: boolean;
    created_at: string;
    updated_at: string;
  }>("SELECT * FROM assets ORDER BY updated_at DESC");
  const assetCollectionsResult = await client.query<{
    id: string;
    name: string;
    description: string;
    color: string;
    created_at: string;
    updated_at: string;
  }>("SELECT * FROM asset_collections ORDER BY updated_at DESC, created_at DESC, name ASC");
  const assetCollectionItemsResult = await client.query<{
    collection_id: string;
    asset_id: string;
    position: number;
  }>("SELECT * FROM asset_collection_items ORDER BY collection_id ASC, position ASC, asset_id ASC");
  const destinationsResult = await client.query<{
    id: string;
    provider: StreamDestinationRecord["provider"];
    role: StreamDestinationRecord["role"];
    priority: number;
    output_profile_id: string;
    name: string;
    enabled: boolean;
    rtmp_url: string;
    stream_key_present: boolean;
    encrypted_stream_key: string;
    status: StreamDestinationRecord["status"];
    notes: string;
    last_validated_at: string;
    last_failure_at: string;
    failure_count: number;
    last_error: string;
  }>("SELECT * FROM stream_destinations ORDER BY priority ASC, name ASC");
  const sourceSyncRunsResult = await client.query<{
    id: string;
    source_id: string;
    started_at: string;
    finished_at: string;
    status: SourceSyncRunRecord["status"];
    summary: string;
    discovered_assets: number;
    ready_assets: number;
    error_message: string;
  }>("SELECT * FROM source_sync_runs ORDER BY finished_at DESC LIMIT 250");
  const incidentsResult = await client.query<{
    id: string;
    scope: IncidentRecord["scope"];
    severity: IncidentRecord["severity"];
    status: IncidentRecord["status"];
    acknowledged_at: string;
    acknowledged_by: string;
    title: string;
    message: string;
    fingerprint: string;
    created_at: string;
    updated_at: string;
    resolved_at: string;
  }>("SELECT * FROM incidents ORDER BY updated_at DESC");
  const auditResult = await client.query<{ id: string; type: string; message: string; created_at: string }>(
    "SELECT * FROM audit_events ORDER BY created_at DESC LIMIT $1",
    [AUDIT_EVENT_RETENTION_LIMIT]
  );
  const playoutResult = await client.query<{
    status: PlayoutRuntimeRecord["status"];
    transition_state: PlayoutRuntimeRecord["transitionState"];
    queue_version: number;
    transition_target_kind: PlayoutRuntimeRecord["transitionTargetKind"];
    transition_target_asset_id: string;
    transition_target_title: string;
    transition_ready_at: string;
    current_asset_id: string;
    current_title: string;
    previous_asset_id: string;
    previous_title: string;
    desired_asset_id: string;
    next_asset_id: string;
    next_title: string;
    queued_asset_ids: string;
    queue_items: string;
    prefetched_asset_id: string;
    prefetched_title: string;
    prefetched_at: string;
    prefetch_status: PlayoutRuntimeRecord["prefetchStatus"];
    prefetch_error: string;
    current_destination_id: string;
    restart_requested_at: string;
    heartbeat_at: string;
    worker_heartbeat_at: string;
    process_pid: number;
    process_started_at: string;
    last_transition_at: string;
    last_successful_start_at: string;
    last_successful_asset_id: string;
    last_exit_code: string;
    restart_count: number;
    crash_count_window: number;
    crash_loop_detected: boolean;
    last_error: string;
    last_stderr_sample: string;
    selection_reason_code: PlayoutRuntimeRecord["selectionReasonCode"];
    fallback_tier: PlayoutRuntimeRecord["fallbackTier"];
    override_mode: PlayoutRuntimeRecord["overrideMode"];
    override_asset_id: string;
    override_until: string;
    live_bridge_input_type: PlayoutRuntimeRecord["liveBridgeInputType"];
    live_bridge_input_url: string;
    live_bridge_label: string;
    live_bridge_status: PlayoutRuntimeRecord["liveBridgeStatus"];
    live_bridge_requested_at: string;
    live_bridge_started_at: string;
    live_bridge_released_at: string;
    live_bridge_last_error: string;
    cuepoint_window_key: string;
    cuepoint_fired_keys: string;
    cuepoint_last_triggered_at: string;
    cuepoint_last_asset_id: string;
    manual_next_asset_id: string;
    manual_next_requested_at: string;
    insert_asset_id: string;
    insert_requested_at: string;
    insert_status: PlayoutRuntimeRecord["insertStatus"];
    skip_asset_id: string;
    skip_until: string;
    pending_action: PlayoutRuntimeRecord["pendingAction"];
    pending_action_requested_at: string;
    uplink_status: PlayoutRuntimeRecord["uplinkStatus"];
    uplink_input_mode: PlayoutRuntimeRecord["uplinkInputMode"];
    uplink_started_at: string;
    uplink_heartbeat_at: string;
    uplink_destination_ids: string;
    uplink_restart_count: number;
    uplink_unplanned_restart_count: number;
    uplink_last_exit_code: string;
    uplink_last_exit_reason: string;
    uplink_last_exit_planned: boolean;
    uplink_reconnect_until: string;
    program_feed_status: PlayoutRuntimeRecord["programFeedStatus"];
    program_feed_updated_at: string;
    program_feed_playlist_path: string;
    program_feed_target_seconds: number;
    program_feed_buffered_seconds: number;
    message: string;
  }>("SELECT * FROM playout_runtime WHERE singleton_id = 1");

  const defaults = defaultState();
  const systemRow = systemResult.rows[0];
  const moderationRow = moderationResult.rows[0];
  const overlayRow = overlayResult.rows[0];
  const managedConfigRow = managedConfigResult.rows[0];
  const outputRow = outputResult.rows[0];
  const engagementRow = engagementResult.rows[0];
  const engagementGameRow = engagementGameResult.rows[0];
  const twitchRow = twitchResult.rows[0];
  const twitchBroadcasterRow = twitchBroadcasterResult.rows[0];
  const playoutRow = playoutResult.rows[0];
  const decryptedManagedConfig = managedConfigRow ? decryptManagedConfig(managedConfigRow.encrypted_payload) : null;

  return normalizeState({
    initialized: systemRow?.initialized ?? false,
    owner:
      systemRow?.owner_email && systemRow.owner_password_hash
        ? {
            email: systemRow.owner_email,
            passwordHash: systemRow.owner_password_hash,
            createdAt: systemRow.owner_created_at
          }
        : null,
    users: usersResult.rows.map((row) => ({
      id: row.id,
      email: row.email,
      displayName: row.display_name,
      authProvider: row.auth_provider,
      role: row.role,
      twitchUserId: row.twitch_user_id,
      twitchLogin: row.twitch_login,
      passwordHash: row.password_hash || undefined,
      twoFactorEnabled: row.two_factor_enabled,
      twoFactorSecret: decryptSecretString(row.two_factor_secret),
      twoFactorConfirmedAt: row.two_factor_confirmed_at,
      createdAt: row.created_at,
      lastLoginAt: row.last_login_at
    })),
    teamAccessGrants: grantsResult.rows.map((row) => ({
      id: row.id,
      twitchLogin: row.twitch_login,
      role: row.role,
      createdAt: row.created_at,
      createdBy: row.created_by
    })),
    moderation: moderationRow
      ? {
          enabled: moderationRow.enabled,
          command: moderationRow.command,
          defaultMinutes: moderationRow.default_minutes,
          minMinutes: moderationRow.min_minutes,
          maxMinutes: moderationRow.max_minutes,
          requirePrefix: moderationRow.require_prefix,
          fallbackEmoteOnly: moderationRow.fallback_emote_only
        }
      : defaults.moderation,
    presenceWindows: presenceResult.rows.map((row) => ({
      actor: row.actor,
      minutes: row.applied_minutes || row.minutes,
      requestedMinutes: row.requested_minutes,
      appliedMinutes: row.applied_minutes || row.minutes,
      clampReason: normalizePresenceClampReason(row.clamp_reason),
      createdAt: row.created_at,
      expiresAt: row.expires_at
    })),
    overlay: mapOverlayRowToRecord(overlayRow, defaults.overlay),
    managedConfig: decryptedManagedConfig
      ? {
          ...decryptedManagedConfig,
          updatedAt: managedConfigRow?.updated_at || decryptedManagedConfig.updatedAt
        }
      : defaults.managedConfig,
    output: mapOutputRowToRecord(outputRow, defaults.output),
    engagement: mapEngagementSettingsRowToRecord(engagementRow, defaults.engagement),
    engagementGame: mapEngagementGameRuntimeRowToRecord(engagementGameRow, defaults.engagementGame),
    engagementEvents: engagementEventsResult.rows.map(mapEngagementEventRowToRecord),
    twitch: twitchRow
      ? {
          status: twitchRow.status,
          broadcasterId: twitchRow.broadcaster_id,
          broadcasterLogin: twitchRow.broadcaster_login,
          accessToken: twitchRow.access_token,
          refreshToken: twitchRow.refresh_token,
          connectedAt: twitchRow.connected_at,
          tokenExpiresAt: twitchRow.token_expires_at,
          lastRefreshAt: twitchRow.last_refresh_at,
          lastMetadataSyncAt: twitchRow.last_metadata_sync_at,
          lastSyncedTitle: twitchRow.last_synced_title,
          lastSyncedCategoryName: twitchRow.last_synced_category_name,
          lastSyncedCategoryId: twitchRow.last_synced_category_id,
          lastScheduleSyncAt: twitchRow.last_schedule_sync_at,
          liveStatus:
            twitchRow.live_status === "live" || twitchRow.live_status === "offline" || twitchRow.live_status === "unknown"
              ? twitchRow.live_status
              : "unknown",
          viewerCount: Math.max(0, Number(twitchRow.viewer_count) || 0),
          startedAt: twitchRow.started_at || "",
          error: twitchRow.error
        }
      : defaults.twitch,
    twitchBroadcaster: twitchBroadcasterRow
      ? {
          status: twitchBroadcasterRow.status,
          broadcasterId: twitchBroadcasterRow.broadcaster_id,
          broadcasterLogin: twitchBroadcasterRow.broadcaster_login,
          accessToken: twitchBroadcasterRow.access_token,
          refreshToken: twitchBroadcasterRow.refresh_token,
          connectedAt: twitchBroadcasterRow.connected_at,
          tokenExpiresAt: twitchBroadcasterRow.token_expires_at,
          lastRefreshAt: twitchBroadcasterRow.last_refresh_at,
          error: twitchBroadcasterRow.error
        }
      : defaults.twitchBroadcaster,
    twitchScheduleSegments: twitchScheduleSegmentsResult.rows.map((row) => ({
      key: row.key,
      segmentId: row.segment_id,
      blockId: row.block_id,
      startTime: row.start_time,
      title: row.title,
      syncedAt: row.synced_at
    })),
    pools: poolsResult.rows.map((row) => ({
      id: row.id,
      name: row.name,
      sourceIds: JSON.parse(row.source_ids || "[]") as string[],
      playbackMode: row.playback_mode,
      cursorAssetId: row.cursor_asset_id || "",
      insertAssetId: row.insert_asset_id || "",
      insertEveryItems: row.insert_every_items ?? 0,
      itemsSinceInsert: row.items_since_insert ?? 0,
      audioLaneAssetId: row.audio_lane_asset_id || "",
      audioLaneVolumePercent: row.audio_lane_volume_percent ?? 100,
      updatedAt: row.updated_at
    })),
    showProfiles: showProfilesResult.rows.map((row) => ({
      id: row.id,
      name: row.name,
      categoryName: row.category_name,
      defaultDurationMinutes: row.default_duration_minutes,
      color: row.color,
      description: row.description,
      updatedAt: row.updated_at
    })),
    scheduleBlocks: blocksResult.rows.map((row) => ({
      id: row.id,
      title: row.title,
      categoryName: row.category_name,
      startMinuteOfDay:
        typeof row.start_minute_of_day === "number" ? row.start_minute_of_day : (row.start_hour % 24) * 60,
      durationMinutes: row.duration_minutes,
      dayOfWeek: row.day_of_week ?? 0,
      showId: row.show_id || undefined,
      poolId: row.pool_id || undefined,
      sourceName: row.source_name,
      repeatMode: row.repeat_mode || "single",
      repeatGroupId: row.repeat_group_id || "",
      cuepointAssetId: row.cuepoint_asset_id || "",
      cuepointOffsetsSeconds: JSON.parse(row.cuepoint_offsets_seconds || "[]") as number[]
    })),
    sources: sourcesResult.rows.map((row) => ({
      id: row.id,
      name: row.name,
      type: row.type,
      connectorKind: row.connector_kind,
      enabled: row.enabled,
      status: row.status,
      externalUrl: row.external_url || undefined,
      notes: row.notes || undefined,
      lastSyncedAt: row.last_synced_at || undefined
    })),
    assets: assetsResult.rows.map((row) => ({
      id: row.id,
      sourceId: row.source_id,
      title: row.title,
      path: row.path,
      cachePath: row.cache_path || undefined,
      cacheStatus: row.cache_status || undefined,
      cacheUpdatedAt: row.cache_updated_at || undefined,
      cacheError: row.cache_error || undefined,
      folderPath: row.folder_path || "",
      tags: parseAssetTagsJson(row.tags_json),
      titlePrefix: row.title_prefix || "",
      hashtagsJson: row.hashtags_json || "[]",
      platformNotes: row.platform_notes || "",
      chaptersJson: row.chapters_json || "[]",
      chaptersProbeStatus: normalizeAssetChapterProbeStatus(row.chapters_probe_status),
      chaptersProbedAt: row.chapters_probed_at || "",
      status: row.status,
      includeInProgramming: row.include_in_programming,
      externalId: row.external_id || undefined,
      categoryName: row.category_name || undefined,
      durationSeconds: row.duration_seconds || undefined,
      publishedAt: row.published_at || undefined,
      fallbackPriority: row.fallback_priority,
      isGlobalFallback: row.is_global_fallback,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    })),
    assetCollections: assetCollectionsResult.rows.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      color: row.color,
      assetIds: assetCollectionItemsResult.rows
        .filter((item) => item.collection_id === row.id)
        .map((item) => item.asset_id),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    })),
    sourceSyncRuns: sourceSyncRunsResult.rows.map((row) => ({
      id: row.id,
      sourceId: row.source_id,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      status: row.status,
      summary: row.summary,
      discoveredAssets: row.discovered_assets,
      readyAssets: row.ready_assets,
      errorMessage: row.error_message
    })),
    destinations: destinationsResult.rows.map((row) => {
      const managedStreamKey = decryptSecretString(row.encrypted_stream_key || "");
      const envFallback = getLegacyDestinationEnvConfig(row.id);
      const streamKeyPresent = Boolean(managedStreamKey || envFallback.key);
      const streamKeySource = managedStreamKey ? "managed" : envFallback.key ? "env" : "missing";
      return {
        id: row.id,
        provider: row.provider,
        role: row.role,
        priority: row.priority ?? (row.role === "backup" ? 10 : 0),
        outputProfileId: normalizeDestinationOutputProfileId(row.output_profile_id),
        name: row.name,
        enabled: row.enabled,
        rtmpUrl: row.rtmp_url,
        streamKeyPresent,
        streamKeySource,
        status: row.status,
        notes: row.notes,
        lastValidatedAt: row.last_validated_at,
        lastFailureAt: row.last_failure_at,
        failureCount: row.failure_count,
        lastError: row.last_error
      };
    }),
    incidents: incidentsResult.rows.map((row) => ({
      id: row.id,
      scope: row.scope,
      severity: row.severity,
      status: row.status,
      acknowledgedAt: row.acknowledged_at,
      acknowledgedBy: row.acknowledged_by,
      title: row.title,
      message: row.message,
      fingerprint: row.fingerprint,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      resolvedAt: row.resolved_at
    })),
    auditEvents: auditResult.rows.map((row) => ({
      id: row.id,
      type: row.type,
      message: row.message,
      createdAt: row.created_at
    })),
    playout: playoutRow
      ? {
          status: playoutRow.status,
          transitionState: playoutRow.transition_state,
          queueVersion: playoutRow.queue_version,
          transitionTargetKind: playoutRow.transition_target_kind || "",
          transitionTargetAssetId: playoutRow.transition_target_asset_id,
          transitionTargetTitle: playoutRow.transition_target_title,
          transitionReadyAt: playoutRow.transition_ready_at,
          currentAssetId: playoutRow.current_asset_id,
          currentTitle: playoutRow.current_title,
          previousAssetId: playoutRow.previous_asset_id,
          previousTitle: playoutRow.previous_title,
          desiredAssetId: playoutRow.desired_asset_id,
          nextAssetId: playoutRow.next_asset_id,
          nextTitle: playoutRow.next_title,
          queuedAssetIds: JSON.parse(playoutRow.queued_asset_ids || "[]") as string[],
          queueItems: JSON.parse(playoutRow.queue_items || "[]") as BroadcastQueueItemRecord[],
          prefetchedAssetId: playoutRow.prefetched_asset_id,
          prefetchedTitle: playoutRow.prefetched_title,
          prefetchedAt: playoutRow.prefetched_at,
          prefetchStatus: playoutRow.prefetch_status,
          prefetchError: playoutRow.prefetch_error,
          currentDestinationId: playoutRow.current_destination_id,
          restartRequestedAt: playoutRow.restart_requested_at,
          heartbeatAt: playoutRow.heartbeat_at,
          workerHeartbeatAt: playoutRow.worker_heartbeat_at || "",
          processPid: playoutRow.process_pid,
          processStartedAt: playoutRow.process_started_at,
          lastTransitionAt: playoutRow.last_transition_at,
          lastSuccessfulStartAt: playoutRow.last_successful_start_at,
          lastSuccessfulAssetId: playoutRow.last_successful_asset_id,
          lastExitCode: playoutRow.last_exit_code,
          restartCount: playoutRow.restart_count,
          crashCountWindow: playoutRow.crash_count_window,
          crashLoopDetected: playoutRow.crash_loop_detected,
          lastError: playoutRow.last_error,
          lastStderrSample: playoutRow.last_stderr_sample,
          selectionReasonCode: playoutRow.selection_reason_code,
          fallbackTier: playoutRow.fallback_tier,
          overrideMode: playoutRow.override_mode,
          overrideAssetId: playoutRow.override_asset_id,
          overrideUntil: playoutRow.override_until,
          liveBridgeInputType: playoutRow.live_bridge_input_type,
          liveBridgeInputUrl: playoutRow.live_bridge_input_url,
          liveBridgeLabel: playoutRow.live_bridge_label,
          liveBridgeStatus: playoutRow.live_bridge_status,
          liveBridgeRequestedAt: playoutRow.live_bridge_requested_at,
          liveBridgeStartedAt: playoutRow.live_bridge_started_at,
          liveBridgeReleasedAt: playoutRow.live_bridge_released_at,
          liveBridgeLastError: playoutRow.live_bridge_last_error,
          cuepointWindowKey: playoutRow.cuepoint_window_key,
          cuepointFiredKeys: JSON.parse(playoutRow.cuepoint_fired_keys || "[]") as string[],
          cuepointLastTriggeredAt: playoutRow.cuepoint_last_triggered_at,
          cuepointLastAssetId: playoutRow.cuepoint_last_asset_id,
          manualNextAssetId: playoutRow.manual_next_asset_id,
          manualNextRequestedAt: playoutRow.manual_next_requested_at,
          insertAssetId: playoutRow.insert_asset_id,
          insertRequestedAt: playoutRow.insert_requested_at,
          insertStatus: playoutRow.insert_status,
          skipAssetId: playoutRow.skip_asset_id,
          skipUntil: playoutRow.skip_until,
          pendingAction: (playoutRow.pending_action as PlayoutRuntimeRecord["pendingAction"]) || "",
          pendingActionRequestedAt: playoutRow.pending_action_requested_at || "",
          uplinkStatus: playoutRow.uplink_status || "",
          uplinkInputMode:
            playoutRow.uplink_input_mode === "hls" || playoutRow.uplink_input_mode === "rtmp" ? playoutRow.uplink_input_mode : "",
          uplinkStartedAt: playoutRow.uplink_started_at || "",
          uplinkHeartbeatAt: playoutRow.uplink_heartbeat_at || "",
          uplinkDestinationIds: JSON.parse(playoutRow.uplink_destination_ids || "[]") as string[],
          uplinkRestartCount: playoutRow.uplink_restart_count ?? 0,
          uplinkUnplannedRestartCount: playoutRow.uplink_unplanned_restart_count ?? 0,
          uplinkLastExitCode: playoutRow.uplink_last_exit_code || "",
          uplinkLastExitReason: playoutRow.uplink_last_exit_reason || "",
          uplinkLastExitPlanned: playoutRow.uplink_last_exit_planned ?? false,
          uplinkReconnectUntil: playoutRow.uplink_reconnect_until || "",
          programFeedStatus: playoutRow.program_feed_status || "",
          programFeedUpdatedAt: playoutRow.program_feed_updated_at || "",
          programFeedPlaylistPath: playoutRow.program_feed_playlist_path || "",
          programFeedTargetSeconds: playoutRow.program_feed_target_seconds ?? 0,
          programFeedBufferedSeconds: playoutRow.program_feed_buffered_seconds ?? 0,
          message: playoutRow.message
        }
      : defaults.playout
  });
}

export async function ensureDatabase(): Promise<void> {
  if (!globalThis.__stream247DbReady) {
    globalThis.__stream247DbReady = (async () => {
      const pool = getPool();
      const client = await pool.connect();

      try {
        await client.query("BEGIN");
        await client.query("SELECT pg_advisory_xact_lock($1)", [DB_BOOTSTRAP_LOCK_KEY]);
        await applyPendingMigrations(client);
        const empty = await isDatabaseEmpty(client);
        if (empty) {
          const legacy = await readLegacyState();
          await persistState(client, legacy ?? createInitialSeedState());
        }
        await client.query("COMMIT");
      } catch (error) {
        await rollbackQuietly(client);
        throw error;
      } finally {
        client.release();
      }
    })();
  }

  await globalThis.__stream247DbReady;
}

export async function getDatabaseHealth(): Promise<"ok" | "error"> {
  try {
    await ensureDatabase();
    await getPool().query("SELECT 1");
    return "ok";
  } catch {
    return "error";
  }
}

export async function readAppState(): Promise<AppState> {
  await ensureDatabase();
  const client = await getPool().connect();
  try {
    return await hydrateState(client);
  } finally {
    client.release();
  }
}

export async function readOverlayStudioState(): Promise<OverlayStudioStateRecord> {
  await ensureDatabase();
  const client = await getPool().connect();

  try {
    const defaults = defaultState().overlay;
    const liveResult = await client.query<OverlaySettingsRow>("SELECT * FROM overlay_settings WHERE singleton_id = 1");
    const draftResult = await client.query<OverlayDraftRow>("SELECT * FROM overlay_drafts WHERE singleton_id = 1");
    const liveOverlay = mapOverlayRowToRecord(liveResult.rows[0], defaults);
    const draftOverlay = mapOverlayRowToRecord(draftResult.rows[0], liveOverlay);

    return {
      liveOverlay,
      draftOverlay,
      basedOnUpdatedAt: draftResult.rows[0]?.based_on_updated_at || liveOverlay.updatedAt,
      hasUnpublishedChanges: !overlaySettingsEqual(liveOverlay, draftOverlay)
    };
  } finally {
    client.release();
  }
}

export async function listOverlayScenePresetRecords(): Promise<OverlayScenePresetRecord[]> {
  await ensureDatabase();
  const client = await getPool().connect();

  try {
    const result = await client.query<OverlayScenePresetRow>(
      "SELECT * FROM overlay_scene_presets ORDER BY updated_at DESC, created_at DESC, name ASC"
    );
    return result.rows.map(mapOverlayScenePresetRowToRecord);
  } finally {
    client.release();
  }
}

export async function resetDatabaseConnectionsForTests(): Promise<void> {
  if (globalThis.__stream247Pool) {
    await globalThis.__stream247Pool.end();
  }

  globalThis.__stream247Pool = undefined;
  globalThis.__stream247DbReady = undefined;
  // The relay key cache belongs to the database it was read from.
  cachedRelayInternalKey = "";
}

/**
 * The logical size of this database, over SQL — the one measurement of the database volume the
 * worker can take from inside its own container (the volume itself is not statfs-able from
 * there). Honest limits: this excludes WAL, other databases on the same cluster and filesystem
 * overhead, and says nothing about how much room the volume underneath has left. See
 * apps/worker/src/system-volume.ts for how the worker reports it.
 */
export async function readDatabaseSizeBytes(): Promise<number> {
  const result = await getPool().query<{ bytes: string }>("SELECT pg_database_size(current_database()) AS bytes");
  return Number(result.rows[0]?.bytes ?? 0);
}

export async function writeAppState(state: AppState): Promise<void> {
  await withSerializedStateWrite("writeAppState", async (client) => {
    await persistState(client, normalizeState(state));
  });
}

export async function updateAppState(updater: (state: AppState) => AppState | Promise<AppState>): Promise<AppState> {
  return withSerializedStateWrite("updateAppState", async (client) => {
    const current = await hydrateState(client);
    const next = normalizeState(await updater(current));
    await persistState(client, next);
    return next;
  });
}

export async function appendAuditEvent(type: string, message: string): Promise<void> {
  await withSerializedStateWrite("appendAuditEvent", async (client) => {
    const createdAt = new Date().toISOString();
    await client.query("INSERT INTO audit_events (id, type, message, created_at) VALUES ($1, $2, $3, $4)", [
      createId("audit"),
      type,
      message,
      createdAt
    ]);
    await client.query(
      `
      DELETE FROM audit_events
      WHERE id IN (
        SELECT id FROM audit_events
        ORDER BY created_at DESC
        OFFSET $1
      )
    `,
      [AUDIT_EVENT_RETENTION_LIMIT]
    );
  });
}

export async function upsertSources(sources: SourceRecord[]): Promise<void> {
  if (sources.length === 0) {
    return;
  }

  await withSerializedStateWrite("upsertSources", async (client) => {
    for (const source of sources) {
      await client.query(
        `
          INSERT INTO sources (id, name, type, connector_kind, enabled, status, external_url, notes, last_synced_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          ON CONFLICT (id) DO UPDATE SET
            name = EXCLUDED.name,
            type = EXCLUDED.type,
            connector_kind = EXCLUDED.connector_kind,
            enabled = EXCLUDED.enabled,
            status = EXCLUDED.status,
            external_url = EXCLUDED.external_url,
            notes = EXCLUDED.notes,
            last_synced_at = EXCLUDED.last_synced_at
        `,
        [
          source.id,
          source.name,
          source.type,
          source.connectorKind,
          source.enabled ?? true,
          source.status,
          source.externalUrl ?? "",
          source.notes ?? "",
          source.lastSyncedAt ?? ""
        ]
      );
    }
  });
}

export async function updateSourceFieldRecords(updates: SourceFieldUpdateRecord[]): Promise<void> {
  if (updates.length === 0) {
    return;
  }

  await withSerializedStateWrite("updateSourceFieldRecords", async (client) => {
    for (const update of updates) {
      const values: unknown[] = [update.id];
      const setClauses: string[] = [];

      if (update.name !== undefined) {
        setClauses.push(`name = $${values.length + 1}`);
        values.push(update.name);
      }

      if (update.type !== undefined) {
        setClauses.push(`type = $${values.length + 1}`);
        values.push(update.type);
      }

      if (update.connectorKind !== undefined) {
        setClauses.push(`connector_kind = $${values.length + 1}`);
        values.push(update.connectorKind);
      }

      if (update.enabled !== undefined) {
        setClauses.push(`enabled = $${values.length + 1}`);
        values.push(update.enabled);
      }

      if (update.externalUrl !== undefined) {
        setClauses.push(`external_url = $${values.length + 1}`);
        values.push(update.externalUrl);
      }

      if (update.status !== undefined) {
        setClauses.push(`status = $${values.length + 1}`);
        values.push(update.status);
      }

      if (update.notes !== undefined) {
        setClauses.push(`notes = $${values.length + 1}`);
        values.push(update.notes);
      }

      if (update.lastSyncedAt !== undefined) {
        setClauses.push(`last_synced_at = $${values.length + 1}`);
        values.push(update.lastSyncedAt);
      }

      if (setClauses.length === 0) {
        continue;
      }

      const result = await client.query(`UPDATE sources SET ${setClauses.join(", ")} WHERE id = $1`, values);
      if (result.rowCount === 0) {
        throw new Error(`Source not found: ${update.id}`);
      }
    }
  });
}

export type ReplaceAssetsOptions = {
  /**
   * Permit a replacement that leaves a currently populated source with no assets.
   *
   * Off by default. A caller that genuinely emptied a source knows it did — it built the delete
   * list and the insert list from the same evidence — and says so here. A caller that merely
   * ended up with an empty list (a throw it swallowed, a listing it could not read, a `continue`
   * that skipped the collection step but not the delete list) does not, and gets refused.
   */
  allowEmptyReplacement?: boolean;
};

/**
 * Whether a wholesale replacement would empty a populated source without being told to.
 *
 * The threshold is deliberately "zero incoming", not a percentage of the stored count: a source
 * shrinking from 49 items to 1 is an ordinary playlist edit, and blocking it would pin stale rows
 * on air with no way out. Zero is the only count that is simultaneously catastrophic (the pool
 * empties, playback falls to the global fallback) and never distinguishable from a failure that
 * produced no listing — so it is the only one worth an explicit opt-in.
 */
export function shouldRefuseEmptyAssetReplacement(args: {
  incomingAssetCount: number;
  storedAssetCount: number;
  allowEmptyReplacement: boolean;
}): boolean {
  return !args.allowEmptyReplacement && args.incomingAssetCount === 0 && args.storedAssetCount > 0;
}

export async function replaceAssetsForSourceIds(
  sourceIds: string[],
  assets: AssetRecord[],
  options: ReplaceAssetsOptions = {}
): Promise<void> {
  if (sourceIds.length === 0) {
    return;
  }

  await withSerializedStateWrite("replaceAssetsForSourceIds", async (client) => {
    const existingResult = await client.query<{
      id: string;
      source_id: string;
      path: string;
      external_id: string;
      cache_path: string;
      cache_status: AssetRecord["cacheStatus"];
      cache_updated_at: string;
      cache_error: string;
      folder_path: string;
      tags_json: string;
      title_prefix: string;
      hashtags_json: string;
      platform_notes: string;
      chapters_json: string;
      chapters_probe_status: string;
      chapters_probed_at: string;
      include_in_programming: boolean;
      fallback_priority: number;
      is_global_fallback: boolean;
    }>(
      "SELECT id, source_id, path, external_id, cache_path, cache_status, cache_updated_at, cache_error, folder_path, tags_json, title_prefix, hashtags_json, platform_notes, chapters_json, chapters_probe_status, chapters_probed_at, include_in_programming, fallback_priority, is_global_fallback FROM assets WHERE source_id = ANY($1::text[])",
      [sourceIds]
    );

    const existingById = new Map(existingResult.rows.map((row) => [row.id, row] as const));
    const existingByExternal = new Map(
      existingResult.rows.filter((row) => row.external_id).map((row) => [`${row.source_id}:${row.external_id}`, row] as const)
    );
    const existingByPath = new Map(existingResult.rows.map((row) => [`${row.source_id}:${row.path}`, row] as const));

    if (
      shouldRefuseEmptyAssetReplacement({
        incomingAssetCount: assets.length,
        storedAssetCount: existingResult.rows.length,
        allowEmptyReplacement: options.allowEmptyReplacement ?? false
      })
    ) {
      // Refuse rather than throw: reaching this line means a caller's scope decision was wrong,
      // and taking the worker cycle down over it would hurt the broadcast the guard exists to
      // protect. The warning is what turns a silent wipe into something an operator can find.
      // eslint-disable-next-line no-console
      console.warn(
        `[stream247-db] replaceAssetsForSourceIds refused to empty ${existingResult.rows.length} asset(s) of ${sourceIds.join(", ")} without allowEmptyReplacement.`
      );
      return;
    }

    await client.query("DELETE FROM assets WHERE source_id = ANY($1::text[])", [sourceIds]);

    for (const asset of assets) {
      const existing =
        existingById.get(asset.id) ??
        (asset.externalId ? existingByExternal.get(`${asset.sourceId}:${asset.externalId}`) : undefined) ??
        existingByPath.get(`${asset.sourceId}:${asset.path}`);

      await client.query(
        `
          INSERT INTO assets (
            id, source_id, title, path, cache_path, cache_status, cache_updated_at, cache_error, folder_path, tags_json, status,
            title_prefix, hashtags_json, platform_notes, chapters_json, chapters_probe_status, chapters_probed_at, include_in_programming, external_id, category_name, duration_seconds, published_at,
            fallback_priority, is_global_fallback, created_at, updated_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26)
        `,
        [
          asset.id,
          asset.sourceId,
          normalizeAssetTitle(asset.title),
          asset.path,
          asset.cachePath ?? existing?.cache_path ?? "",
          asset.cacheStatus ?? existing?.cache_status ?? "",
          asset.cacheUpdatedAt ?? existing?.cache_updated_at ?? "",
          asset.cacheError ?? existing?.cache_error ?? "",
          existing?.folder_path ?? asset.folderPath ?? "",
          existing?.tags_json ?? JSON.stringify(normalizeAssetTags(asset.tags ?? [])),
          asset.status,
          normalizeAssetTitlePrefix(existing?.title_prefix ?? asset.titlePrefix ?? ""),
          normalizeAssetHashtagsJson(existing?.hashtags_json ?? asset.hashtagsJson ?? "[]"),
          normalizeAssetPlatformNotes(existing?.platform_notes ?? asset.platformNotes ?? ""),
          // Unlike the fields above, an existing-but-empty chapter list does not win: empty means
          // "never curated", so a re-ingest may fill it — but only then.
          chooseStoredAssetChaptersJson(existing?.chapters_json, asset.chaptersJson),
          // Probe bookkeeping survives the delete-and-reinsert the same way the cache fields do;
          // syncs never set these, so the stored outcome carries forward.
          asset.chaptersProbeStatus ?? normalizeAssetChapterProbeStatus(existing?.chapters_probe_status),
          asset.chaptersProbedAt ?? existing?.chapters_probed_at ?? "",
          existing?.include_in_programming ?? asset.includeInProgramming,
          asset.externalId ?? "",
          normalizeAssetCategoryName(asset.categoryName ?? ""),
          asset.durationSeconds ?? 0,
          asset.publishedAt ?? "",
          existing?.fallback_priority ?? asset.fallbackPriority,
          existing?.is_global_fallback ?? asset.isGlobalFallback,
          asset.createdAt,
          asset.updatedAt
        ]
      );
    }
  });
}

export async function updateAssetRecords(assets: AssetRecord[]): Promise<void> {
  if (assets.length === 0) {
    return;
  }

  await withSerializedStateWrite("updateAssetRecords", async (client) => {
    for (const asset of assets) {
      await client.query(
        `
          UPDATE assets
          SET
            title = $2,
            path = $3,
            cache_path = $4,
            cache_status = $5,
            cache_updated_at = $6,
            cache_error = $7,
            folder_path = $8,
            tags_json = $9,
            status = $10,
            title_prefix = $11,
            hashtags_json = $12,
            platform_notes = $13,
            chapters_json = $14,
            chapters_probe_status = $15,
            chapters_probed_at = $16,
            include_in_programming = $17,
            external_id = $18,
            category_name = $19,
            duration_seconds = $20,
            published_at = $21,
            fallback_priority = $22,
            is_global_fallback = $23,
            created_at = $24,
            updated_at = $25
          WHERE id = $1
        `,
        [
          asset.id,
          normalizeAssetTitle(asset.title),
          asset.path,
          asset.cachePath ?? "",
          asset.cacheStatus ?? "",
          asset.cacheUpdatedAt ?? "",
          asset.cacheError ?? "",
          asset.folderPath ?? "",
          JSON.stringify(normalizeAssetTags(asset.tags ?? [])),
          asset.status,
          normalizeAssetTitlePrefix(asset.titlePrefix ?? ""),
          normalizeAssetHashtagsJson(asset.hashtagsJson ?? "[]"),
          normalizeAssetPlatformNotes(asset.platformNotes ?? ""),
          normalizeAssetChaptersJson(asset.chaptersJson ?? "[]"),
          normalizeAssetChapterProbeStatus(asset.chaptersProbeStatus),
          asset.chaptersProbedAt ?? "",
          asset.includeInProgramming,
          asset.externalId ?? "",
          normalizeAssetCategoryName(asset.categoryName ?? ""),
          asset.durationSeconds ?? 0,
          asset.publishedAt ?? "",
          asset.fallbackPriority,
          asset.isGlobalFallback,
          asset.createdAt,
          asset.updatedAt
        ]
      );
    }
  });
}

export async function updateAssetCurationRecords(updates: AssetCurationUpdateRecord[]): Promise<void> {
  if (updates.length === 0) {
    return;
  }

  await withSerializedStateWrite("updateAssetCurationRecords", async (client) => {
    for (const update of updates) {
      const needsCurrentTags = update.appendTags !== undefined;
      let currentTags: string[] = [];

      if (needsCurrentTags) {
        const currentResult = await client.query<{ tags_json: string }>("SELECT tags_json FROM assets WHERE id = $1", [update.id]);
        if (currentResult.rowCount === 0) {
          throw new Error(`Asset not found: ${update.id}`);
        }
        currentTags = parseAssetTagsJson(currentResult.rows[0]?.tags_json || "[]");
      }

      const values: unknown[] = [update.id];
      const setClauses: string[] = [];

      if (update.includeInProgramming !== undefined) {
        setClauses.push(`include_in_programming = $${values.length + 1}`);
        values.push(update.includeInProgramming);
      }

      if (update.isGlobalFallback !== undefined) {
        setClauses.push(`is_global_fallback = $${values.length + 1}`);
        values.push(update.isGlobalFallback);
      }

      if (update.fallbackPriority !== undefined) {
        setClauses.push(`fallback_priority = $${values.length + 1}`);
        values.push(update.fallbackPriority);
      }

      if (update.folderPath !== undefined) {
        setClauses.push(`folder_path = $${values.length + 1}`);
        values.push(normalizeAssetFolderPath(update.folderPath));
      }

      if (update.tags !== undefined || update.appendTags !== undefined) {
        const nextTags =
          update.tags !== undefined
            ? normalizeAssetTags(update.tags)
            : normalizeAssetTags([...currentTags, ...(update.appendTags ?? [])]);
        setClauses.push(`tags_json = $${values.length + 1}`);
        values.push(JSON.stringify(nextTags));
      }

      if (setClauses.length === 0) {
        continue;
      }

      setClauses.push(`updated_at = $${values.length + 1}`);
      values.push(update.updatedAt ?? new Date().toISOString());

      const result = await client.query(`UPDATE assets SET ${setClauses.join(", ")} WHERE id = $1`, values);
      if (result.rowCount === 0) {
        throw new Error(`Asset not found: ${update.id}`);
      }
    }
  });
}

export async function updateAssetMetadataRecords(updates: AssetMetadataUpdateRecord[]): Promise<void> {
  if (updates.length === 0) {
    return;
  }

  await withSerializedStateWrite("updateAssetMetadataRecords", async (client) => {
    for (const update of updates) {
      const values: unknown[] = [update.id];
      const setClauses: string[] = [];

      if (update.title !== undefined) {
        setClauses.push(`title = $${values.length + 1}`);
        values.push(normalizeAssetTitle(update.title));
      }

      if (update.titlePrefix !== undefined) {
        setClauses.push(`title_prefix = $${values.length + 1}`);
        values.push(normalizeAssetTitlePrefix(update.titlePrefix));
      }

      if (update.categoryName !== undefined) {
        setClauses.push(`category_name = $${values.length + 1}`);
        values.push(normalizeAssetCategoryName(update.categoryName));
      }

      if (update.hashtagsJson !== undefined) {
        setClauses.push(`hashtags_json = $${values.length + 1}`);
        values.push(normalizeAssetHashtagsJson(update.hashtagsJson));
      }

      if (update.platformNotes !== undefined) {
        setClauses.push(`platform_notes = $${values.length + 1}`);
        values.push(normalizeAssetPlatformNotes(update.platformNotes));
      }

      if (update.chaptersJson !== undefined) {
        setClauses.push(`chapters_json = $${values.length + 1}`);
        values.push(normalizeAssetChaptersJson(update.chaptersJson));
        // An operator touching the chapter list resets the probe bookkeeping: deleting every
        // chapter is the documented way back to auto-fill, and for probed sources that means the
        // backfill must be allowed to fetch again instead of sitting on a stale "ok".
        setClauses.push(`chapters_probe_status = ''`, `chapters_probed_at = ''`);
      }

      if (setClauses.length === 0) {
        continue;
      }

      setClauses.push(`updated_at = $${values.length + 1}`);
      values.push(update.updatedAt ?? new Date().toISOString());

      const result = await client.query(`UPDATE assets SET ${setClauses.join(", ")} WHERE id = $1`, values);
      if (result.rowCount === 0) {
        throw new Error(`Asset not found: ${update.id}`);
      }
    }
  });
}

/**
 * Record the outcome of a chapter metadata probe.
 *
 * Discovered chapters go through chooseStoredAssetChaptersJson against the row as it is *now*, so
 * an operator edit that landed between the probe and this write wins exactly like it does on
 * re-ingest. A vanished asset is skipped rather than raised: the probe is bookkeeping about a row
 * that no longer exists, and failing the worker cycle over it would hurt the broadcast, not help.
 */
export async function updateAssetChapterProbeRecords(updates: AssetChapterProbeUpdateRecord[]): Promise<void> {
  if (updates.length === 0) {
    return;
  }

  await withSerializedStateWrite("updateAssetChapterProbeRecords", async (client) => {
    for (const update of updates) {
      const existing = await client.query<{ chapters_json: string }>("SELECT chapters_json FROM assets WHERE id = $1", [
        update.id
      ]);
      const row = existing.rows[0];
      if (!row) {
        continue;
      }

      await client.query(
        "UPDATE assets SET chapters_probe_status = $2, chapters_probed_at = $3, chapters_json = $4, updated_at = $5 WHERE id = $1",
        [
          update.id,
          normalizeAssetChapterProbeStatus(update.chaptersProbeStatus),
          update.chaptersProbedAt,
          chooseStoredAssetChaptersJson(row.chapters_json, update.chaptersJson),
          new Date().toISOString()
        ]
      );
    }
  });
}

export async function upsertAssetCollectionRecords(collections: AssetCollectionRecord[]): Promise<void> {
  if (collections.length === 0) {
    return;
  }

  await withSerializedStateWrite("upsertAssetCollectionRecords", async (client) => {
    const assetIdsResult = await client.query<{ id: string }>("SELECT id FROM assets");
    const assetIdSet = new Set(assetIdsResult.rows.map((row) => row.id));
    const now = new Date().toISOString();

    for (const collection of collections) {
      const assetIds = Array.isArray(collection.assetIds)
        ? [...new Set(collection.assetIds.map((id) => String(id).trim()).filter((id) => assetIdSet.has(id)))]
        : [];
      const createdAt = collection.createdAt || now;
      const updatedAt = collection.updatedAt || now;

      await client.query(
        `
          INSERT INTO asset_collections (id, name, description, color, created_at, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6)
          ON CONFLICT (id) DO UPDATE SET
            name = EXCLUDED.name,
            description = EXCLUDED.description,
            color = EXCLUDED.color,
            updated_at = EXCLUDED.updated_at
        `,
        [
          collection.id,
          normalizeAssetCollectionName(collection.name),
          normalizeAssetCollectionDescription(collection.description),
          normalizeAssetCollectionColor(collection.color),
          createdAt,
          updatedAt
        ]
      );

      await client.query("DELETE FROM asset_collection_items WHERE collection_id = $1", [collection.id]);
      for (const [index, assetId] of assetIds.entries()) {
        await client.query(
          `
            INSERT INTO asset_collection_items (collection_id, asset_id, position)
            VALUES ($1, $2, $3)
          `,
          [collection.id, assetId, index]
        );
      }
    }
  });
}

export async function deleteAssetCollectionRecord(id: string): Promise<void> {
  if (!id) {
    return;
  }

  await withSerializedStateWrite("deleteAssetCollectionRecord", async (client) => {
    await client.query("DELETE FROM asset_collection_items WHERE collection_id = $1", [id]);
    await client.query("DELETE FROM asset_collections WHERE id = $1", [id]);
  });
}

export async function updateAssetCollectionMemberships(
  updates: AssetCollectionMembershipUpdateRecord[]
): Promise<void> {
  if (updates.length === 0) {
    return;
  }

  await withSerializedStateWrite("updateAssetCollectionMemberships", async (client) => {
    for (const update of updates) {
      const collectionId = String(update.collectionId || "").trim();
      if (!collectionId) {
        continue;
      }

      const collectionResult = await client.query<{ id: string }>("SELECT id FROM asset_collections WHERE id = $1", [collectionId]);
      if (collectionResult.rowCount === 0) {
        throw new Error(`Curated set not found: ${collectionId}`);
      }

      const currentResult = await client.query<{ asset_id: string }>(
        "SELECT asset_id FROM asset_collection_items WHERE collection_id = $1 ORDER BY position ASC, asset_id ASC",
        [collectionId]
      );
      const currentAssetIds = currentResult.rows.map((row) => row.asset_id);
      const requestedAssetIds = [...new Set((update.assetIds ?? []).map((id) => String(id).trim()).filter(Boolean))];
      const validResult =
        requestedAssetIds.length > 0
          ? await client.query<{ id: string }>("SELECT id FROM assets WHERE id = ANY($1::text[])", [requestedAssetIds])
          : { rows: [] as Array<{ id: string }> };
      const validAssetIdSet = new Set(validResult.rows.map((row) => row.id));
      const validRequestedAssetIds = requestedAssetIds.filter((assetId) => validAssetIdSet.has(assetId));

      const nextAssetIds =
        update.mode === "replace"
          ? validRequestedAssetIds
          : update.mode === "remove"
            ? currentAssetIds.filter((assetId) => !requestedAssetIds.includes(assetId))
            : [...new Set([...currentAssetIds, ...validRequestedAssetIds])];

      await client.query("DELETE FROM asset_collection_items WHERE collection_id = $1", [collectionId]);
      for (const [index, assetId] of nextAssetIds.entries()) {
        await client.query(
          `
            INSERT INTO asset_collection_items (collection_id, asset_id, position)
            VALUES ($1, $2, $3)
          `,
          [collectionId, assetId, index]
        );
      }

      await client.query("UPDATE asset_collections SET updated_at = $2 WHERE id = $1", [
        collectionId,
        update.updatedAt || new Date().toISOString()
      ]);
    }
  });
}

export async function appendSourceSyncRuns(runs: SourceSyncRunRecord[]): Promise<void> {
  if (runs.length === 0) {
    return;
  }

  await withSerializedStateWrite("appendSourceSyncRuns", async (client) => {
    for (const run of runs) {
      await client.query(
        `
          INSERT INTO source_sync_runs (
            id, source_id, started_at, finished_at, status, summary, discovered_assets, ready_assets, error_message
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        `,
        [
          run.id,
          run.sourceId,
          run.startedAt,
          run.finishedAt,
          run.status,
          run.summary,
          run.discoveredAssets,
          run.readyAssets,
          run.errorMessage
        ]
      );
    }

    await client.query(`
      DELETE FROM source_sync_runs
      WHERE id IN (
        SELECT id FROM source_sync_runs
        ORDER BY finished_at DESC, started_at DESC
        OFFSET 250
      )
    `);
  });
}

export async function upsertSourceRecord(source: SourceRecord): Promise<void> {
  await upsertSources([source]);
}

export async function deleteSourceRecordAndAssets(sourceId: string): Promise<void> {
  await withSerializedStateWrite("deleteSourceRecordAndAssets", async (client) => {
    await client.query("DELETE FROM assets WHERE source_id = $1", [sourceId]);
    await client.query("DELETE FROM sources WHERE id = $1", [sourceId]);
  });
}

export type AssetRetentionSweepResult = {
  counters: AssetRetentionCounters;
  deletedAssets: number;
  deletedCollectionItems: number;
  danglingCollectionItems: number;
  newlyMarkedOrphans: number;
  clearedOrphanMarks: number;
};

/**
 * One retention sweep (M57). Classification is the pure function in asset-retention.ts; this
 * executor hydrates the snapshot, keeps the orphan-first-seen marks, and — only when enabled —
 * deletes. The whole sweep runs inside one serialized state write, so no source sync, no
 * full-state write and no queue mutation can interleave between the reference scan and the
 * delete: what was classified is what is acted on.
 */
export async function runAssetRetentionSweep(args: {
  protectionDays: number;
  deleteEnabled: boolean;
  now?: Date;
}): Promise<AssetRetentionSweepResult> {
  return withSerializedStateWrite("runAssetRetentionSweep", async (client) => {
    const state = await hydrateState(client);

    // The chat reference paths live outside AppState: the poll (options and winner), the viewer
    // request history, and the running skip campaign each carry asset ids of their own.
    const voteResult = await client.query<{ options: unknown; winner_asset_id: string }>(
      "SELECT options, winner_asset_id FROM chat_vote_session WHERE singleton_id = 1"
    );
    const voteRow = voteResult.rows[0];
    const voteOptionAssetIds = Array.isArray(voteRow?.options)
      ? (voteRow?.options as Array<{ assetId?: unknown }>).map((option) => String(option?.assetId ?? "")).filter(Boolean)
      : [];
    const requestsResult = await client.query<{ asset_id: string }>("SELECT asset_id FROM chat_viewer_requests");
    const skipResult = await client.query<{ asset_id: string }>(
      "SELECT asset_id FROM chat_skip_vote WHERE singleton_id = 1"
    );
    const marksResult = await client.query<{ asset_id: string; orphan_first_seen_at: string }>(
      "SELECT asset_id, orphan_first_seen_at FROM asset_retention_marks"
    );
    const orphanFirstSeenAt: Record<string, string> = {};
    for (const row of marksResult.rows) {
      orphanFirstSeenAt[row.asset_id] = row.orphan_first_seen_at;
    }

    const now = args.now ?? new Date();
    const classification = classifyAssetRetention(
      {
        sources: state.sources,
        assets: state.assets,
        pools: state.pools,
        scheduleBlocks: state.scheduleBlocks,
        assetCollections: state.assetCollections,
        playout: state.playout,
        chat: {
          voteWinnerAssetId: String(voteRow?.winner_asset_id ?? ""),
          voteOptionAssetIds,
          viewerRequestAssetIds: requestsResult.rows.map((row) => row.asset_id),
          skipVoteAssetId: String(skipResult.rows[0]?.asset_id ?? "")
        },
        orphanFirstSeenAt
      },
      { nowMs: now.getTime(), protectionDays: args.protectionDays }
    );

    // Mark bookkeeping runs even with deletion off — observing is the disabled mode's whole
    // point, and the protection clock must already be running by the time the operator enables.
    const orphanedSet = new Set(classification.orphanedAssetIds);
    const newMarks = classification.orphanedAssetIds.filter((assetId) => !(assetId in orphanFirstSeenAt));
    for (const assetId of newMarks) {
      await client.query(
        "INSERT INTO asset_retention_marks (asset_id, orphan_first_seen_at) VALUES ($1, $2) ON CONFLICT (asset_id) DO NOTHING",
        [assetId, now.toISOString()]
      );
    }
    // A mark whose asset regained its source (or is gone entirely) is cleared: the observation
    // no longer applies, and if the asset orphans again the window starts over from zero.
    const staleMarks = marksResult.rows.map((row) => row.asset_id).filter((assetId) => !orphanedSet.has(assetId));
    if (staleMarks.length > 0) {
      await client.query("DELETE FROM asset_retention_marks WHERE asset_id = ANY($1::text[])", [staleMarks]);
    }

    // Dangling curated-set items (asset row already gone) reference nothing by definition.
    // Counted always; removed only when enabled. normalizeState drops them from any full-state
    // write anyway — deleting here just makes the cleanup deterministic instead of
    // write-dependent.
    const danglingResult = await client.query<{ count: string }>(
      "SELECT COUNT(*) AS count FROM asset_collection_items items WHERE NOT EXISTS (SELECT 1 FROM assets WHERE assets.id = items.asset_id)"
    );
    const danglingCollectionItems = Number(danglingResult.rows[0]?.count ?? 0);

    const deletions = selectAssetRetentionDeletions(classification, args.deleteEnabled);
    let deletedAssets = 0;
    let deletedCollectionItems = 0;
    if (deletions.length > 0) {
      // Orphanhood is re-asserted in SQL at the moment of deletion. Nothing can have changed
      // underneath inside this serialized write; the guard is belt-and-braces against the
      // classifier and the hydrate ever drifting apart.
      const deletedResult = await client.query(
        "DELETE FROM assets WHERE id = ANY($1::text[]) AND source_id NOT IN (SELECT id FROM sources)",
        [deletions]
      );
      deletedAssets = deletedResult.rowCount ?? 0;
      await client.query("DELETE FROM asset_retention_marks WHERE asset_id = ANY($1::text[])", [deletions]);
    }
    if (args.deleteEnabled && danglingCollectionItems > 0) {
      const removedItems = await client.query(
        "DELETE FROM asset_collection_items WHERE NOT EXISTS (SELECT 1 FROM assets WHERE assets.id = asset_collection_items.asset_id)"
      );
      deletedCollectionItems = removedItems.rowCount ?? 0;
    }

    return {
      counters: classification.counters,
      deletedAssets,
      deletedCollectionItems,
      danglingCollectionItems,
      newlyMarkedOrphans: newMarks.length,
      clearedOrphanMarks: staleMarks.length
    };
  });
}

export async function updateManagedConfigRecord(config: ManagedConfigRecord): Promise<void> {
  await withSerializedStateWrite("updateManagedConfigRecord", async (client) => {
    await client.query(
      `
        INSERT INTO managed_config (singleton_id, encrypted_payload, updated_at)
        VALUES (1, $1, $2)
        ON CONFLICT (singleton_id) DO UPDATE SET
          encrypted_payload = EXCLUDED.encrypted_payload,
          updated_at = EXCLUDED.updated_at
      `,
      [encryptManagedConfig(config), config.updatedAt]
    );
  });
}

/**
 * The managed config alone, without dragging the full application state along. Exists for hot
 * paths that poll a switch or a cadence — the playout sampler asks every few seconds, and
 * readAppState reads dozens of tables it has no use for. Defaults are merged the same way the
 * full state read does, so a missing or undecryptable row degrades to "nothing managed".
 */
export async function readManagedConfigRecord(): Promise<ManagedConfigRecord> {
  await ensureDatabase();
  const client = await getPool().connect();
  try {
    const result = await client.query<{ encrypted_payload: string; updated_at: string }>(
      "SELECT encrypted_payload, updated_at FROM managed_config WHERE singleton_id = 1 LIMIT 1"
    );
    const row = result.rows[0];
    const decrypted = row ? decryptManagedConfig(row.encrypted_payload) : null;
    const defaults = defaultState().managedConfig;
    return decrypted
      ? { ...defaults, ...decrypted, updatedAt: row?.updated_at || decrypted.updatedAt }
      : defaults;
  } finally {
    client.release();
  }
}

export async function updateOutputSettingsRecord(output: OutputSettingsRecord): Promise<void> {
  await withSerializedStateWrite("updateOutputSettingsRecord", async (client) => {
    const normalized = normalizeOutputSettingsRecord(output);
    await client.query(
      `
        INSERT INTO output_settings (singleton_id, profile_id, width, height, fps, updated_at)
        VALUES (1, $1, $2, $3, $4, $5)
        ON CONFLICT (singleton_id) DO UPDATE SET
          profile_id = EXCLUDED.profile_id,
          width = EXCLUDED.width,
          height = EXCLUDED.height,
          fps = EXCLUDED.fps,
          updated_at = EXCLUDED.updated_at
      `,
      [normalized.profileId, normalized.width, normalized.height, normalized.fps, normalized.updatedAt]
    );
  });
}

export async function updateEngagementSettingsRecord(engagement: EngagementSettingsRecord): Promise<void> {
  await withSerializedStateWrite("updateEngagementSettingsRecord", async (client) => {
    const normalized = normalizeEngagementSettingsRecord(engagement);
    await client.query(
      `
        INSERT INTO engagement_settings (
          singleton_id, chat_enabled, alerts_enabled, donations_enabled, channel_points_enabled, game_enabled, solo_mode_enabled, small_group_mode_enabled, crowd_mode_enabled, game_window_minutes, chat_mode, chat_position, alert_position, style, max_messages, rate_limit_per_minute, updated_at
        )
        VALUES (1, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
        ON CONFLICT (singleton_id) DO UPDATE SET
          chat_enabled = EXCLUDED.chat_enabled,
          alerts_enabled = EXCLUDED.alerts_enabled,
          donations_enabled = EXCLUDED.donations_enabled,
          channel_points_enabled = EXCLUDED.channel_points_enabled,
          game_enabled = EXCLUDED.game_enabled,
          solo_mode_enabled = EXCLUDED.solo_mode_enabled,
          small_group_mode_enabled = EXCLUDED.small_group_mode_enabled,
          crowd_mode_enabled = EXCLUDED.crowd_mode_enabled,
          game_window_minutes = EXCLUDED.game_window_minutes,
          chat_mode = EXCLUDED.chat_mode,
          chat_position = EXCLUDED.chat_position,
          alert_position = EXCLUDED.alert_position,
          style = EXCLUDED.style,
          max_messages = EXCLUDED.max_messages,
          rate_limit_per_minute = EXCLUDED.rate_limit_per_minute,
          updated_at = EXCLUDED.updated_at
      `,
      [
        normalized.chatEnabled,
        normalized.alertsEnabled,
        normalized.donationsEnabled,
        normalized.channelPointsEnabled,
        normalized.gameEnabled,
        normalized.soloModeEnabled,
        normalized.smallGroupModeEnabled,
        normalized.crowdModeEnabled,
        normalized.gameWindowMinutes,
        normalized.chatMode,
        normalized.chatPosition,
        normalized.alertPosition,
        normalized.style,
        normalized.maxMessages,
        normalized.rateLimitPerMinute,
        normalized.updatedAt
      ]
    );
  });
}

export async function updateEngagementGameRuntimeRecord(runtime: Partial<EngagementGameRuntimeRecord>): Promise<void> {
  await withSerializedStateWrite("updateEngagementGameRuntimeRecord", async (client) => {
    const normalized = normalizeEngagementGameRuntimeRecord(runtime);
    await client.query(
      `
        INSERT INTO engagement_game_runtime (singleton_id, active_chatter_count, mode, mode_changed_at, updated_at)
        VALUES (1, $1, $2, $3, $4)
        ON CONFLICT (singleton_id) DO UPDATE SET
          active_chatter_count = EXCLUDED.active_chatter_count,
          mode = EXCLUDED.mode,
          mode_changed_at = EXCLUDED.mode_changed_at,
          updated_at = EXCLUDED.updated_at
      `,
      [normalized.activeChatterCount, normalized.mode, normalized.modeChangedAt, normalized.updatedAt]
    );
  });
}

export type ChatInteractionSettingsRecord = {
  enabled: boolean;
  votingEnabled: boolean;
  requestsEnabled: boolean;
  skipEnabled: boolean;
  voteDurationSeconds: number;
  voteOptionCount: number;
  voteMinimumVoters: number;
  requestCooldownSeconds: number;
  requestQueueLimit: number;
  skipThresholdRatio: number;
  skipMinimumVotes: number;
  skipWindowSeconds: number;
  requestCommand: string;
  skipCommand: string;
  updatedAt: string;
};

/**
 * Viewer-control settings. Defaults are deliberately off: this hands programme control to
 * anonymous chat, so it must be switched on knowingly rather than arriving enabled after an
 * upgrade.
 */
export async function readChatInteractionSettingsRecord(): Promise<ChatInteractionSettingsRecord> {
  const result = await getPool().query<Record<string, unknown>>(
    "SELECT * FROM chat_interaction_settings WHERE singleton_id = 1"
  );
  const row = result.rows[0];

  const num = (value: unknown, fallback: number) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  };

  return {
    enabled: row ? Boolean(row.enabled) : false,
    votingEnabled: row ? Boolean(row.voting_enabled) : true,
    requestsEnabled: row ? Boolean(row.requests_enabled) : true,
    skipEnabled: row ? Boolean(row.skip_enabled) : true,
    voteDurationSeconds: num(row?.vote_duration_seconds, 60),
    voteOptionCount: num(row?.vote_option_count, 3),
    voteMinimumVoters: num(row?.vote_minimum_voters, 3),
    requestCooldownSeconds: num(row?.request_cooldown_seconds, 600),
    requestQueueLimit: num(row?.request_queue_limit, 5),
    skipThresholdRatio: num(row?.skip_threshold_ratio, 0.6),
    skipMinimumVotes: num(row?.skip_minimum_votes, 5),
    skipWindowSeconds: num(row?.skip_window_seconds, 120),
    requestCommand: String(row?.request_command ?? "request"),
    skipCommand: String(row?.skip_command ?? "skip"),
    updatedAt: String(row?.updated_at ?? "")
  };
}

export async function writeChatInteractionSettingsRecord(
  settings: ChatInteractionSettingsRecord
): Promise<void> {
  await withSerializedStateWrite("writeChatInteractionSettingsRecord", async (client) => {
    await client.query(
      `
        INSERT INTO chat_interaction_settings (
          singleton_id, enabled, voting_enabled, requests_enabled, skip_enabled,
          vote_duration_seconds, vote_option_count, vote_minimum_voters,
          request_cooldown_seconds, request_queue_limit,
          skip_threshold_ratio, skip_minimum_votes, skip_window_seconds,
          request_command, skip_command, updated_at
        )
        VALUES (1, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
        ON CONFLICT (singleton_id) DO UPDATE SET
          enabled = EXCLUDED.enabled,
          voting_enabled = EXCLUDED.voting_enabled,
          requests_enabled = EXCLUDED.requests_enabled,
          skip_enabled = EXCLUDED.skip_enabled,
          vote_duration_seconds = EXCLUDED.vote_duration_seconds,
          vote_option_count = EXCLUDED.vote_option_count,
          vote_minimum_voters = EXCLUDED.vote_minimum_voters,
          request_cooldown_seconds = EXCLUDED.request_cooldown_seconds,
          request_queue_limit = EXCLUDED.request_queue_limit,
          skip_threshold_ratio = EXCLUDED.skip_threshold_ratio,
          skip_minimum_votes = EXCLUDED.skip_minimum_votes,
          skip_window_seconds = EXCLUDED.skip_window_seconds,
          request_command = EXCLUDED.request_command,
          skip_command = EXCLUDED.skip_command,
          updated_at = EXCLUDED.updated_at
      `,
      [
        settings.enabled,
        settings.votingEnabled,
        settings.requestsEnabled,
        settings.skipEnabled,
        settings.voteDurationSeconds,
        settings.voteOptionCount,
        settings.voteMinimumVoters,
        settings.requestCooldownSeconds,
        settings.requestQueueLimit,
        settings.skipThresholdRatio,
        settings.skipMinimumVotes,
        settings.skipWindowSeconds,
        settings.requestCommand,
        settings.skipCommand,
        settings.updatedAt || new Date().toISOString()
      ]
    );
  });
}

export type ChatVoteOptionRecord = {
  token: string;
  assetId: string;
  title: string;
  votes: number;
};

export type ChatVoteSessionRecord = {
  id: string;
  status: "open" | "closed";
  openedAt: string;
  closesAt: string;
  options: ChatVoteOptionRecord[];
  ballots: Record<string, number>;
  winnerAssetId: string;
  updatedAt: string;
};

export function createEmptyChatVoteSessionRecord(): ChatVoteSessionRecord {
  return {
    id: "",
    status: "closed",
    openedAt: "",
    closesAt: "",
    options: [],
    ballots: {},
    winnerAssetId: "",
    updatedAt: ""
  };
}

/**
 * The poll currently on air.
 *
 * Chat is handled in the worker container and the overlay renders in the playout container, so the
 * tally has to cross a process boundary. The worker owns it in memory and flushes here; playout
 * only ever reads.
 */
export async function readChatVoteSessionRecord(): Promise<ChatVoteSessionRecord> {
  const result = await getPool().query<{
    id: string;
    status: string;
    opened_at: string;
    closes_at: string;
    options: unknown;
    ballots: unknown;
    winner_asset_id: string;
    updated_at: string;
  }>("SELECT * FROM chat_vote_session WHERE singleton_id = 1");

  const row = result.rows[0];
  if (!row) {
    return createEmptyChatVoteSessionRecord();
  }

  return {
    id: String(row.id ?? ""),
    status: row.status === "open" ? "open" : "closed",
    openedAt: String(row.opened_at ?? ""),
    closesAt: String(row.closes_at ?? ""),
    options: Array.isArray(row.options) ? (row.options as ChatVoteOptionRecord[]) : [],
    ballots:
      row.ballots && typeof row.ballots === "object" && !Array.isArray(row.ballots)
        ? (row.ballots as Record<string, number>)
        : {},
    winnerAssetId: String(row.winner_asset_id ?? ""),
    updatedAt: String(row.updated_at ?? "")
  };
}

export async function writeChatVoteSessionRecord(session: Partial<ChatVoteSessionRecord>): Promise<void> {
  const normalized = { ...createEmptyChatVoteSessionRecord(), ...session };
  await withSerializedStateWrite("writeChatVoteSessionRecord", async (client) => {
    await client.query(
      `
        INSERT INTO chat_vote_session (singleton_id, id, status, opened_at, closes_at, options, ballots, winner_asset_id, updated_at)
        VALUES (1, $1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8)
        ON CONFLICT (singleton_id) DO UPDATE SET
          id = EXCLUDED.id,
          status = EXCLUDED.status,
          opened_at = EXCLUDED.opened_at,
          closes_at = EXCLUDED.closes_at,
          options = EXCLUDED.options,
          ballots = EXCLUDED.ballots,
          winner_asset_id = EXCLUDED.winner_asset_id,
          updated_at = EXCLUDED.updated_at
      `,
      [
        normalized.id,
        normalized.status,
        normalized.openedAt,
        normalized.closesAt,
        JSON.stringify(normalized.options),
        JSON.stringify(normalized.ballots),
        normalized.winnerAssetId,
        normalized.updatedAt || new Date().toISOString()
      ]
    );
  });
}

export type ChatSkipVoteRecord = {
  /** Asset the campaign wants skipped; a boundary invalidates it. */
  assetId: string;
  /** The operator-configured command, persisted so the overlay can tell viewers what to type. */
  skipCommand: string;
  votes: number;
  votesNeeded: number;
  startedAt: string;
  /** End of the collection window. The projection refuses rows past this, so a stale row — a
   * worker that died mid-campaign — can never fabricate progress on air. */
  expiresAt: string;
  updatedAt: string;
};

export function createEmptyChatSkipVoteRecord(): ChatSkipVoteRecord {
  return {
    assetId: "",
    skipCommand: "",
    votes: 0,
    votesNeeded: 0,
    startedAt: "",
    expiresAt: "",
    updatedAt: ""
  };
}

/**
 * The running skip campaign, mirrored for the process boundary the same way the poll is: the
 * worker owns the tally in memory and flushes the numbers here, playout only ever reads. Only the
 * numbers cross — voter identities stay in the worker (see the table comment).
 */
export async function readChatSkipVoteRecord(): Promise<ChatSkipVoteRecord> {
  const result = await getPool().query<{
    asset_id: string;
    skip_command: string;
    votes: number;
    votes_needed: number;
    started_at: string;
    expires_at: string;
    updated_at: string;
  }>("SELECT * FROM chat_skip_vote WHERE singleton_id = 1");

  const row = result.rows[0];
  if (!row) {
    return createEmptyChatSkipVoteRecord();
  }

  return {
    assetId: String(row.asset_id ?? ""),
    skipCommand: String(row.skip_command ?? ""),
    votes: Number(row.votes ?? 0),
    votesNeeded: Number(row.votes_needed ?? 0),
    startedAt: String(row.started_at ?? ""),
    expiresAt: String(row.expires_at ?? ""),
    updatedAt: String(row.updated_at ?? "")
  };
}

export async function writeChatSkipVoteRecord(record: Partial<ChatSkipVoteRecord>): Promise<void> {
  const normalized = { ...createEmptyChatSkipVoteRecord(), ...record };
  await withSerializedStateWrite("writeChatSkipVoteRecord", async (client) => {
    await client.query(
      `
        INSERT INTO chat_skip_vote (singleton_id, asset_id, skip_command, votes, votes_needed, started_at, expires_at, updated_at)
        VALUES (1, $1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (singleton_id) DO UPDATE SET
          asset_id = EXCLUDED.asset_id,
          skip_command = EXCLUDED.skip_command,
          votes = EXCLUDED.votes,
          votes_needed = EXCLUDED.votes_needed,
          started_at = EXCLUDED.started_at,
          expires_at = EXCLUDED.expires_at,
          updated_at = EXCLUDED.updated_at
      `,
      [
        normalized.assetId,
        normalized.skipCommand,
        normalized.votes,
        normalized.votesNeeded,
        normalized.startedAt,
        normalized.expiresAt,
        normalized.updatedAt || new Date().toISOString()
      ]
    );
  });
}

export type ChatOverlayMessageRecord = {
  /** Display name as chat shows it — the only identity the overlay ever needs. */
  name: string;
  text: string;
  /** ISO timestamp of arrival; the projection uses it to age messages off air. */
  at: string;
  /**
   * The message split into text runs and emote pictures, from the PRIVMSG tag the worker read.
   * Optional, and empty for a message without emotes: rows written before emotes existed simply
   * have no key here and draw as plain text, so no migration is involved — this lives inside the
   * existing `messages` jsonb column.
   */
  segments?: { kind: string; text?: string; id?: string; url?: string }[];
};

export type ChatOverlayMessagesRecord = {
  /** Snapshot of the runtime gate at flush time, so playout renders from this one read. */
  enabled: boolean;
  position: string;
  maxMessages: number;
  /** Oldest first. */
  messages: ChatOverlayMessageRecord[];
  updatedAt: string;
};

/** More rows than any panel can show, fewer than the worker's 50-message ring. */
const CHAT_OVERLAY_MESSAGES_STORED_MAX = 12;

/**
 * Normalised on the way out as well as in, like the game settings: whatever ends up in the row —
 * an old shape, a hand edit — comes back as bounded plain strings. Zero-width and control
 * characters are stripped here because this text's only consumer is a broadcast frame.
 */
// The one host that may end up as an <img src> on the broadcast. The segments are derived from a
// message a stranger typed, and the renderer will fetch whatever URL reaches it — so the address
// is pinned here rather than trusted, and a hand-edited row cannot make the overlay call out to
// somewhere else. Twitch serves every emote, global and channel, from this host.
const CHAT_EMOTE_URL_PREFIX = "https://static-cdn.jtvnw.net/emoticons/";

/** At most this many pieces per message; the panel draws far fewer, this only bounds the row. */
const CHAT_OVERLAY_SEGMENTS_MAX = 24;

function normalizeChatOverlaySegments(value: unknown): ChatOverlayMessageRecord["segments"] {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const segments = value
    .map((entry) => {
      const record = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : {};
      if (record.kind === "emote") {
        const url = String(record.url ?? "");
        return url.startsWith(CHAT_EMOTE_URL_PREFIX)
          ? { kind: "emote", id: String(record.id ?? "").slice(0, 64), url: url.slice(0, 200) }
          : null;
      }
      const text = stripInvisibleCharacters(String(record.text ?? "")).slice(0, 200);
      return text ? { kind: "text", text } : null;
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
    .slice(0, CHAT_OVERLAY_SEGMENTS_MAX);

  // A message with no emote left after filtering is a plain line; storing an empty or text-only
  // segment list would only add bytes the renderer would ignore.
  return segments.some((entry) => entry.kind === "emote") ? segments : undefined;
}

function normalizeChatOverlayMessages(value: unknown): ChatOverlayMessageRecord[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => {
      const record = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : {};
      const segments = normalizeChatOverlaySegments(record.segments);
      return {
        name: stripInvisibleCharacters(String(record.name ?? "")).trim().slice(0, 80),
        text: stripInvisibleCharacters(String(record.text ?? "")).trim().slice(0, 200),
        at: stripInvisibleCharacters(String(record.at ?? "")).trim().slice(0, 40),
        ...(segments ? { segments } : {})
      };
    })
    .filter((entry) => entry.name && entry.text && entry.at)
    .slice(-CHAT_OVERLAY_MESSAGES_STORED_MAX);
}

export function createEmptyChatOverlayMessagesRecord(): ChatOverlayMessagesRecord {
  return {
    enabled: false,
    position: "bottom-left",
    maxMessages: 5,
    messages: [],
    updatedAt: ""
  };
}

/**
 * The chat the on-air overlay may draw, mirrored for the process boundary the same way the poll
 * and the skip campaign are: the worker's bridge owns the ring buffer in memory and flushes this
 * display projection, playout only ever reads. Moderation hygiene rides the same flush — a
 * deleted or banned message disappears from the worker's buffer and the next flush overwrites
 * the row without it.
 */
export async function readChatOverlayMessagesRecord(): Promise<ChatOverlayMessagesRecord> {
  const result = await getPool().query<{
    enabled: boolean;
    position: string;
    max_messages: number;
    messages: unknown;
    updated_at: string;
  }>("SELECT * FROM chat_overlay_messages WHERE singleton_id = 1");

  const row = result.rows[0];
  if (!row) {
    return createEmptyChatOverlayMessagesRecord();
  }

  return {
    enabled: Boolean(row.enabled),
    position: normalizeEngagementOverlayPosition(row.position),
    maxMessages: Math.min(12, Math.max(1, Math.round(Number(row.max_messages)) || 5)),
    messages: normalizeChatOverlayMessages(row.messages),
    updatedAt: String(row.updated_at ?? "")
  };
}

export async function writeChatOverlayMessagesRecord(record: Partial<ChatOverlayMessagesRecord>): Promise<void> {
  const normalized = { ...createEmptyChatOverlayMessagesRecord(), ...record };
  await withSerializedStateWrite("writeChatOverlayMessagesRecord", async (client) => {
    await client.query(
      `
        INSERT INTO chat_overlay_messages (singleton_id, enabled, position, max_messages, messages, updated_at)
        VALUES (1, $1, $2, $3, $4::jsonb, $5)
        ON CONFLICT (singleton_id) DO UPDATE SET
          enabled = EXCLUDED.enabled,
          position = EXCLUDED.position,
          max_messages = EXCLUDED.max_messages,
          messages = EXCLUDED.messages,
          updated_at = EXCLUDED.updated_at
      `,
      [
        normalized.enabled,
        normalizeEngagementOverlayPosition(normalized.position),
        Math.min(12, Math.max(1, Math.round(Number(normalized.maxMessages)) || 5)),
        JSON.stringify(normalizeChatOverlayMessages(normalized.messages)),
        normalized.updatedAt || new Date().toISOString()
      ]
    );
  });
}

export type ChatGameSettingsRecord = ChatGameSettings & {
  updatedAt: string;
};

/**
 * The chat game's rules: which game, its grid, and the emote→direction mapping. Normalisation is
 * applied on the way out as well as in, so an old or hand-edited row can never hand the worker an
 * unplayable configuration.
 */
export async function readChatGameSettingsRecord(): Promise<ChatGameSettingsRecord> {
  const result = await getPool().query<Record<string, unknown>>(
    "SELECT * FROM chat_game_settings WHERE singleton_id = 1"
  );
  const row = result.rows[0];

  const settings = normalizeChatGameSettings({
    gameId: row?.game_id as ChatGameSettings["gameId"],
    gridWidth: Number(row?.grid_width),
    gridHeight: Number(row?.grid_height),
    emoteMap: row
      ? {
          up: String(row.emote_up ?? ""),
          down: String(row.emote_down ?? ""),
          left: String(row.emote_left ?? ""),
          right: String(row.emote_right ?? "")
        }
      : undefined
  });

  return { ...settings, updatedAt: String(row?.updated_at ?? "") };
}

export async function writeChatGameSettingsRecord(record: ChatGameSettingsRecord): Promise<void> {
  const settings = normalizeChatGameSettings(record);
  await withSerializedStateWrite("writeChatGameSettingsRecord", async (client) => {
    await client.query(
      `
        INSERT INTO chat_game_settings (
          singleton_id, game_id, grid_width, grid_height,
          emote_up, emote_down, emote_left, emote_right, updated_at
        )
        VALUES (1, $1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (singleton_id) DO UPDATE SET
          game_id = EXCLUDED.game_id,
          grid_width = EXCLUDED.grid_width,
          grid_height = EXCLUDED.grid_height,
          emote_up = EXCLUDED.emote_up,
          emote_down = EXCLUDED.emote_down,
          emote_left = EXCLUDED.emote_left,
          emote_right = EXCLUDED.emote_right,
          updated_at = EXCLUDED.updated_at
      `,
      [
        settings.gameId,
        settings.gridWidth,
        settings.gridHeight,
        settings.emoteMap.up,
        settings.emoteMap.down,
        settings.emoteMap.left,
        settings.emoteMap.right,
        record.updatedAt || new Date().toISOString()
      ]
    );
  });
}

export type ChatGameRuntimeRecord = {
  gameId: string;
  settingsKey: string;
  /** The settings the round was started under, so playout renders from a single read. */
  settings: unknown;
  state: unknown;
  updatedAt: string;
};

export function createEmptyChatGameRuntimeRecord(): ChatGameRuntimeRecord {
  return { gameId: "", settingsKey: "", settings: {}, state: {}, updatedAt: "" };
}

/**
 * The running round. The worker owns it in memory and flushes here; playout only ever reads, and
 * a restarted worker adopts it instead of wiping the round the room is playing.
 */
export async function readChatGameRuntimeRecord(): Promise<ChatGameRuntimeRecord> {
  const result = await getPool().query<Record<string, unknown>>(
    "SELECT * FROM chat_game_runtime WHERE singleton_id = 1"
  );
  const row = result.rows[0];
  if (!row) {
    return createEmptyChatGameRuntimeRecord();
  }

  return {
    gameId: String(row.game_id ?? ""),
    settingsKey: String(row.settings_key ?? ""),
    settings: row.settings ?? {},
    state: row.state ?? {},
    updatedAt: String(row.updated_at ?? "")
  };
}

export async function writeChatGameRuntimeRecord(record: Partial<ChatGameRuntimeRecord>): Promise<void> {
  const normalized = { ...createEmptyChatGameRuntimeRecord(), ...record };
  await withSerializedStateWrite("writeChatGameRuntimeRecord", async (client) => {
    await client.query(
      `
        INSERT INTO chat_game_runtime (singleton_id, game_id, settings_key, settings, state, updated_at)
        VALUES (1, $1, $2, $3::jsonb, $4::jsonb, $5)
        ON CONFLICT (singleton_id) DO UPDATE SET
          game_id = EXCLUDED.game_id,
          settings_key = EXCLUDED.settings_key,
          settings = EXCLUDED.settings,
          state = EXCLUDED.state,
          updated_at = EXCLUDED.updated_at
      `,
      [
        normalized.gameId,
        normalized.settingsKey,
        JSON.stringify(normalized.settings ?? {}),
        JSON.stringify(normalized.state ?? {}),
        normalized.updatedAt || new Date().toISOString()
      ]
    );
  });
}

/** Disabling the game layer must remove all game state cleanly; this is that removal. */
export async function clearChatGameRuntimeRecord(): Promise<void> {
  await withSerializedStateWrite("clearChatGameRuntimeRecord", async (client) => {
    await client.query("DELETE FROM chat_game_runtime WHERE singleton_id = 1");
  });
}

export async function appendEngagementEventRecord(event: Partial<EngagementEventRecord>): Promise<EngagementEventRecord> {
  return withSerializedStateWrite("appendEngagementEventRecord", async (client) => {
    const normalized = normalizeEngagementEventRecord(event);
    await client.query(
      `
        INSERT INTO engagement_events (id, kind, actor, message, created_at)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (id) DO UPDATE SET
          kind = EXCLUDED.kind,
          actor = EXCLUDED.actor,
          message = EXCLUDED.message,
          created_at = EXCLUDED.created_at
      `,
      [normalized.id, normalized.kind, normalized.actor, normalized.message, normalized.createdAt]
    );
    await client.query(`
      DELETE FROM engagement_events
      WHERE id NOT IN (
        SELECT id FROM engagement_events ORDER BY created_at DESC LIMIT 100
      )
    `);
    return normalized;
  });
}

export async function readEngagementEventRecords(limit = 50): Promise<EngagementEventRecord[]> {
  await ensureDatabase();
  const client = await getPool().connect();
  try {
    const result = await client.query<EngagementEventRow>(
      "SELECT * FROM engagement_events ORDER BY created_at DESC LIMIT $1",
      [Math.max(1, Math.min(100, Math.round(limit)))]
    );
    return result.rows.map(mapEngagementEventRowToRecord);
  } finally {
    client.release();
  }
}

export async function updateOverlaySettingsRecord(overlay: OverlaySettingsRecord): Promise<void> {
  await withSerializedStateWrite("updateOverlaySettingsRecord", async (client) => {
    await upsertOverlaySettingsTable(client, "overlay_settings", overlay);
  });
}

export async function saveOverlayDraftRecord(overlay: OverlaySettingsRecord, basedOnUpdatedAt: string): Promise<OverlayStudioStateRecord> {
  return withSerializedStateWrite("saveOverlayDraftRecord", async (client) => {
    const liveResult = await client.query<OverlaySettingsRow>("SELECT * FROM overlay_settings WHERE singleton_id = 1");
    const liveOverlay = mapOverlayRowToRecord(liveResult.rows[0], defaultState().overlay);
    const normalizedDraft = normalizeOverlaySettingsRecord(overlay);
    await upsertOverlaySettingsTable(client, "overlay_drafts", normalizedDraft, basedOnUpdatedAt || liveOverlay.updatedAt);

    return {
      liveOverlay,
      draftOverlay: normalizedDraft,
      basedOnUpdatedAt: basedOnUpdatedAt || liveOverlay.updatedAt,
      hasUnpublishedChanges: !overlaySettingsEqual(liveOverlay, normalizedDraft)
    };
  });
}

export async function publishOverlayDraftRecord(overlay: OverlaySettingsRecord): Promise<OverlayStudioStateRecord> {
  return withSerializedStateWrite("publishOverlayDraftRecord", async (client) => {
    const normalizedOverlay = normalizeOverlaySettingsRecord(overlay);
    await upsertOverlaySettingsTable(client, "overlay_settings", normalizedOverlay);
    await upsertOverlaySettingsTable(client, "overlay_drafts", normalizedOverlay, normalizedOverlay.updatedAt);

    return {
      liveOverlay: normalizedOverlay,
      draftOverlay: normalizedOverlay,
      basedOnUpdatedAt: normalizedOverlay.updatedAt,
      hasUnpublishedChanges: false
    };
  });
}

export async function resetOverlayDraftRecord(): Promise<OverlayStudioStateRecord> {
  return withSerializedStateWrite("resetOverlayDraftRecord", async (client) => {
    const liveResult = await client.query<OverlaySettingsRow>("SELECT * FROM overlay_settings WHERE singleton_id = 1");
    const liveOverlay = mapOverlayRowToRecord(liveResult.rows[0], defaultState().overlay);
    await upsertOverlaySettingsTable(client, "overlay_drafts", liveOverlay, liveOverlay.updatedAt);

    return {
      liveOverlay,
      draftOverlay: liveOverlay,
      basedOnUpdatedAt: liveOverlay.updatedAt,
      hasUnpublishedChanges: false
    };
  });
}

export async function saveOverlayScenePresetRecord(args: {
  name: string;
  description: string;
  overlay: OverlaySettingsRecord;
}): Promise<OverlayScenePresetRecord> {
  return withSerializedStateWrite("saveOverlayScenePresetRecord", async (client) => {
    const timestamp = new Date().toISOString();
    const preset = normalizeOverlayScenePresetRecord({
      id: createId("scene_preset"),
      name: args.name,
      description: args.description,
      overlay: {
        ...args.overlay,
        updatedAt: args.overlay.updatedAt || timestamp
      },
      createdAt: timestamp,
      updatedAt: timestamp
    });

    await client.query(
      `
        INSERT INTO overlay_scene_presets (id, name, description, overlay_json, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6)
      `,
      [
        preset.id,
        preset.name,
        preset.description,
        JSON.stringify(preset.overlay),
        preset.createdAt,
        preset.updatedAt
      ]
    );

    return preset;
  });
}

export async function deleteOverlayScenePresetRecord(id: string): Promise<void> {
  await withSerializedStateWrite("deleteOverlayScenePresetRecord", async (client) => {
    await client.query("DELETE FROM overlay_scene_presets WHERE id = $1", [id]);
  });
}

export async function replaceOverlayScenePresetRecords(presets: OverlayScenePresetRecord[]): Promise<void> {
  await withSerializedStateWrite("replaceOverlayScenePresetRecords", async (client) => {
    await client.query("DELETE FROM overlay_scene_presets");

    for (const preset of presets) {
      const normalized = normalizeOverlayScenePresetRecord(preset);
      await client.query(
        `
          INSERT INTO overlay_scene_presets (id, name, description, overlay_json, created_at, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6)
        `,
        [
          normalized.id,
          normalized.name,
          normalized.description,
          JSON.stringify(normalized.overlay),
          normalized.createdAt,
          normalized.updatedAt
        ]
      );
    }
  });
}

export async function applyOverlayScenePresetRecordToDraft(id: string): Promise<OverlayStudioStateRecord | null> {
  return withSerializedStateWrite("applyOverlayScenePresetRecordToDraft", async (client) => {
    const presetResult = await client.query<OverlayScenePresetRow>("SELECT * FROM overlay_scene_presets WHERE id = $1", [id]);
    const presetRow = presetResult.rows[0];
    if (!presetRow) {
      return null;
    }

    const liveResult = await client.query<OverlaySettingsRow>("SELECT * FROM overlay_settings WHERE singleton_id = 1");
    const liveOverlay = mapOverlayRowToRecord(liveResult.rows[0], defaultState().overlay);
    const timestamp = new Date().toISOString();
    const nextDraft = normalizeOverlaySettingsRecord({
      ...mapOverlayScenePresetRowToRecord(presetRow).overlay,
      updatedAt: timestamp
    });

    await upsertOverlaySettingsTable(client, "overlay_drafts", nextDraft, liveOverlay.updatedAt);

    return {
      liveOverlay,
      draftOverlay: nextDraft,
      basedOnUpdatedAt: liveOverlay.updatedAt,
      hasUnpublishedChanges: !overlaySettingsEqual(liveOverlay, nextDraft)
    };
  });
}

export async function updateDestinationRecord(
  destination: StreamDestinationRecord,
  options?: {
    managedStreamKey?: string;
    clearManagedStreamKey?: boolean;
  }
): Promise<void> {
  await withSerializedStateWrite("updateDestinationRecord", async (client) => {
    const existingResult = await client.query<{ encrypted_stream_key: string }>(
      "SELECT encrypted_stream_key FROM stream_destinations WHERE id = $1 LIMIT 1",
      [destination.id]
    );
    const existingEncryptedStreamKey = existingResult.rows[0]?.encrypted_stream_key || "";
    const nextManagedStreamKey =
      typeof options?.managedStreamKey === "string"
        ? options.managedStreamKey.trim()
        : options?.clearManagedStreamKey
          ? ""
          : null;
    const encryptedStreamKey =
      nextManagedStreamKey === null
        ? existingEncryptedStreamKey
        : nextManagedStreamKey
          ? encryptSecretString(nextManagedStreamKey)
          : "";

    await client.query(
      `
        INSERT INTO stream_destinations (
          id, provider, role, priority, output_profile_id, name, enabled, rtmp_url, stream_key_present, encrypted_stream_key, status, notes,
          last_validated_at, last_failure_at, failure_count, last_error
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
        ON CONFLICT (id) DO UPDATE
        SET provider = EXCLUDED.provider,
            role = EXCLUDED.role,
            priority = EXCLUDED.priority,
            output_profile_id = EXCLUDED.output_profile_id,
            name = EXCLUDED.name,
            enabled = EXCLUDED.enabled,
            rtmp_url = EXCLUDED.rtmp_url,
            stream_key_present = EXCLUDED.stream_key_present,
            encrypted_stream_key = EXCLUDED.encrypted_stream_key,
            status = EXCLUDED.status,
            notes = EXCLUDED.notes,
            last_validated_at = EXCLUDED.last_validated_at,
            last_failure_at = EXCLUDED.last_failure_at,
            failure_count = EXCLUDED.failure_count,
            last_error = EXCLUDED.last_error
      `,
      [
        destination.id,
        destination.provider,
        destination.role,
        destination.priority,
        normalizeDestinationOutputProfileId(destination.outputProfileId),
        destination.name,
        destination.enabled,
        destination.rtmpUrl,
        destination.streamKeyPresent,
        encryptedStreamKey,
        destination.status,
        destination.notes,
        destination.lastValidatedAt,
        destination.lastFailureAt,
        destination.failureCount,
        destination.lastError
      ]
    );
  });
}

export async function deleteDestinationRecord(destinationId: string): Promise<void> {
  await withSerializedStateWrite("deleteDestinationRecord", async (client) => {
    await client.query("DELETE FROM stream_destinations WHERE id = $1", [destinationId]);
  });
}

export async function readManagedDestinationStreamKeys(destinationIds?: string[]): Promise<Record<string, string>> {
  await ensureDatabase();
  const client = await getPool().connect();
  try {
    const result =
      destinationIds && destinationIds.length > 0
        ? await client.query<{ id: string; encrypted_stream_key: string }>(
            "SELECT id, encrypted_stream_key FROM stream_destinations WHERE id = ANY($1::text[])",
            [destinationIds]
          )
        : await client.query<{ id: string; encrypted_stream_key: string }>(
            "SELECT id, encrypted_stream_key FROM stream_destinations WHERE encrypted_stream_key <> ''"
          );

    return Object.fromEntries(
      result.rows
        .map((row) => [row.id, decryptSecretString(row.encrypted_stream_key || "")] as const)
        .filter((entry): entry is [string, string] => Boolean(entry[1]))
    );
  } finally {
    client.release();
  }
}

// --- Overlay video sources (M57) -------------------------------------------------------------
//
// The same custody rules as managed destination stream keys: the URL enters through one writer,
// is encrypted with the app-secret-derived key, and leaves the database in exactly one place —
// the playout sampler's read below. Listings only ever see url_present.

/** Any stored value that is not exactly "push" reads as "pull" — the pre-stage-2 behaviour. */
function normalizeIngestKind(value: string | null | undefined): OverlayVideoSourceIngestKind {
  return value === "push" ? "push" : "pull";
}

export async function listOverlayVideoSourceRecords(): Promise<OverlayVideoSourceRecord[]> {
  await ensureDatabase();
  const client = await getPool().connect();
  try {
    const result = await client.query<{
      id: string;
      name: string;
      url_present: boolean;
      ingest_kind: string;
      publish_key_present: boolean;
      live_state: string;
      live_state_at: string;
      live_retry_at: string;
      updated_at: string;
    }>(
      // Presence is computed in SQL so the encrypted key never travels with a listing. The live
      // state columns are selected whole because they hold no secret — one decision word and two
      // timestamps.
      "SELECT id, name, url_present, ingest_kind, encrypted_publish_key <> '' AS publish_key_present, live_state, live_state_at, live_retry_at, updated_at FROM overlay_video_sources ORDER BY name, id"
    );
    return result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      urlPresent: row.url_present,
      ingestKind: normalizeIngestKind(row.ingest_kind),
      publishKeyPresent: row.publish_key_present,
      liveState: row.live_state || "",
      liveStateAt: row.live_state_at || "",
      liveRetryAt: row.live_retry_at || "",
      updatedAt: row.updated_at
    }));
  } finally {
    client.release();
  }
}

export async function upsertOverlayVideoSourceRecord(
  source: { id: string; name: string },
  options?: {
    /** New feed URL to store (encrypted). Omit to keep whatever is stored. */
    managedUrl?: string;
    /** Explicitly forget the stored URL. */
    clearManagedUrl?: boolean;
    /** How the picture arrives. Omit to keep the stored kind (new rows default to pull). */
    ingestKind?: OverlayVideoSourceIngestKind;
    /** New publish key to store (encrypted) — issue and rotation both land here. */
    managedPublishKey?: string;
    /** Explicitly forget the stored publish key. */
    clearPublishKey?: boolean;
  }
): Promise<void> {
  await withSerializedStateWrite("upsertOverlayVideoSourceRecord", async (client) => {
    const existingResult = await client.query<{ encrypted_url: string; ingest_kind: string; encrypted_publish_key: string }>(
      "SELECT encrypted_url, ingest_kind, encrypted_publish_key FROM overlay_video_sources WHERE id = $1 LIMIT 1",
      [source.id]
    );
    const existingEncryptedUrl = existingResult.rows[0]?.encrypted_url || "";
    const existingEncryptedPublishKey = existingResult.rows[0]?.encrypted_publish_key || "";
    const ingestKind = options?.ingestKind ?? normalizeIngestKind(existingResult.rows[0]?.ingest_kind);
    // Keep-on-empty, like every other stored secret: only an explicit new value or an explicit
    // clear touches the stored URL, so renaming a source can never silently drop its feed.
    const nextUrl =
      typeof options?.managedUrl === "string"
        ? options.managedUrl.trim()
        : options?.clearManagedUrl
          ? ""
          : null;
    const encryptedUrl = nextUrl === null ? existingEncryptedUrl : nextUrl ? encryptSecretString(nextUrl) : "";
    // The publish key follows the same custody. The caller decides when a key is issued or
    // rotated; this writer only ever sees the value once, on its way into the ciphertext.
    const nextPublishKey =
      typeof options?.managedPublishKey === "string"
        ? options.managedPublishKey.trim()
        : options?.clearPublishKey
          ? ""
          : null;
    const encryptedPublishKey =
      nextPublishKey === null ? existingEncryptedPublishKey : nextPublishKey ? encryptSecretString(nextPublishKey) : "";

    await client.query(
      `
        INSERT INTO overlay_video_sources (id, name, url_present, encrypted_url, ingest_kind, encrypted_publish_key, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (id) DO UPDATE
        SET name = EXCLUDED.name,
            url_present = EXCLUDED.url_present,
            encrypted_url = EXCLUDED.encrypted_url,
            ingest_kind = EXCLUDED.ingest_kind,
            encrypted_publish_key = EXCLUDED.encrypted_publish_key,
            updated_at = EXCLUDED.updated_at
      `,
      [source.id, source.name, Boolean(encryptedUrl), encryptedUrl, ingestKind, encryptedPublishKey, new Date().toISOString()]
    );
  });
}

export async function deleteOverlayVideoSourceRecord(sourceId: string): Promise<void> {
  await withSerializedStateWrite("deleteOverlayVideoSourceRecord", async (client) => {
    await client.query("DELETE FROM overlay_video_sources WHERE id = $1", [sourceId]);
  });
}

/**
 * The worker's last attach decision about a source (M57 stage 2, Etappe E).
 *
 * An UPDATE, never an upsert: this writes runtime observation onto a source an operator created,
 * so a decision naming an id that no longer exists must vanish rather than resurrect a deleted
 * source as a nameless row. `updated_at` is deliberately left alone — it means "when an operator
 * last changed this source", and a background observation must not masquerade as an edit.
 *
 * Called only when the decision actually changes (the same edge the runtime log fires on), so this
 * is a rare write rather than a per-cycle one.
 */
export async function recordOverlayVideoSourceLiveState(args: {
  sourceId: string;
  state: string;
  retryAt: string;
}): Promise<void> {
  await withSerializedStateWrite("recordOverlayVideoSourceLiveState", async (client) => {
    await client.query(
      "UPDATE overlay_video_sources SET live_state = $2, live_state_at = $3, live_retry_at = $4 WHERE id = $1",
      [args.sourceId, args.state, new Date().toISOString(), args.retryAt]
    );
  });
}

/**
 * Decrypted feed URLs for the playout sampler — the one read that sees the value. Callers must
 * treat the result as a credential: never log it whole (summarise to origin+path like playback
 * inputs) and never place it in any record that leaves the process.
 *
 * A push source has no stored URL: its internal playback URL is DERIVED here from the internal
 * relay key, so the stage-1 snapshot sampler handles a pushed camera exactly like a stored feed
 * (the free fallback while the live attach path is being built).
 */
export async function readOverlayVideoSourceUrls(sourceIds?: string[]): Promise<Record<string, string>> {
  await ensureDatabase();
  const client = await getPool().connect();
  try {
    const result =
      sourceIds && sourceIds.length > 0
        ? await client.query<{ id: string; encrypted_url: string; ingest_kind: string }>(
            "SELECT id, encrypted_url, ingest_kind FROM overlay_video_sources WHERE id = ANY($1::text[])",
            [sourceIds]
          )
        : await client.query<{ id: string; encrypted_url: string; ingest_kind: string }>(
            "SELECT id, encrypted_url, ingest_kind FROM overlay_video_sources WHERE encrypted_url <> '' OR ingest_kind = 'push'"
          );

    const relayKey = result.rows.some((row) => normalizeIngestKind(row.ingest_kind) === "push")
      ? await readRelayInternalKey()
      : "";

    return Object.fromEntries(
      result.rows
        .map((row) => {
          const url =
            normalizeIngestKind(row.ingest_kind) === "push"
              ? relayKey
                ? deriveRelaySourceReadUrl(row.id, relayKey)
                : ""
              : decryptSecretString(row.encrypted_url || "");
          return [row.id, url] as const;
        })
        .filter((entry): entry is [string, string] => Boolean(entry[1]))
    );
  } finally {
    client.release();
  }
}

// --- Internal relay key (M57 stage 2) --------------------------------------------------------

const RELAY_INTERNAL_KEY_SECRET_ID = "relay-internal-key";

// One database read per process, mirroring the app-secret cache: the key has no rotation surface
// yet, so a change means a restart anyway, and the relay auth endpoint must not pay a query per
// mediamtx callback.
let cachedRelayInternalKey = "";

/**
 * The internal relay key as it is STORED — never created, never replaced (M57 stage 2, Etappe E).
 *
 * `readRelayInternalKey` below is self-generating, which is right for the two parties that need a
 * key to exist (the worker deriving read URLs, the relay auth check) and badly wrong for anything
 * that only wants to look. A reveal surface calling the generating variant would be a WRITE: on a
 * first-boot install it would mint the key, and on an install whose APP_SECRET has rotated it would
 * blindly overwrite the stored row — while every already-running worker keeps the old value in its
 * process cache and every relay read and publish starts failing as "wrong password" until each
 * container restarts. That is the exact incident the reveal button exists to help with.
 *
 * So this variant does one SELECT and nothing else: no INSERT, no UPDATE, and deliberately no
 * interaction with the process cache either, so "does not write" is true of the whole call. A
 * missing row and a row this APP_SECRET can no longer decrypt both come back as "" — the caller
 * must not distinguish them to a user, and neither is a key it may hand out.
 */
export async function readRelayInternalKeyIfPresent(): Promise<string> {
  await ensureDatabase();
  const client = await getPool().connect();
  try {
    const result = await client.query<{ encrypted_value: string }>(
      "SELECT encrypted_value FROM managed_secrets WHERE id = $1 LIMIT 1",
      [RELAY_INTERNAL_KEY_SECRET_ID]
    );
    return decryptSecretString(result.rows[0]?.encrypted_value || "");
  } finally {
    client.release();
  }
}

/**
 * The internal relay key: what the worker embeds in derived read URLs and what the web relay
 * auth endpoint accepts for reads and for the programme rollback publish. Self-generating on
 * first use (app-secret pattern, with the database as the shared store): several containers may
 * race here, ON CONFLICT DO NOTHING elects exactly one writer, and everyone adopts the winner
 * by re-reading. Treat the value as a credential — never log it, never list it.
 *
 * Only for callers that need the key to EXIST. Anything that merely wants to show or check it must
 * use readRelayInternalKeyIfPresent above, or it silently becomes a key-rotation surface.
 */
export async function readRelayInternalKey(): Promise<string> {
  if (cachedRelayInternalKey) {
    return cachedRelayInternalKey;
  }

  await ensureDatabase();
  const client = await getPool().connect();
  try {
    const read = async (): Promise<string> => {
      const result = await client.query<{ encrypted_value: string }>(
        "SELECT encrypted_value FROM managed_secrets WHERE id = $1 LIMIT 1",
        [RELAY_INTERNAL_KEY_SECRET_ID]
      );
      return decryptSecretString(result.rows[0]?.encrypted_value || "");
    };

    const existing = await read();
    if (existing) {
      cachedRelayInternalKey = existing;
      return existing;
    }

    // First boot — or a value this APP_SECRET can no longer decrypt, which is the same rotation
    // consequence every encrypted credential carries: generate a fresh key. 33 random bytes come
    // out as 44 base64url characters, the same alphabet the generated app secret uses.
    const candidate = randomBytes(33).toString("base64url");
    await client.query(
      `
        INSERT INTO managed_secrets (id, encrypted_value, created_at)
        VALUES ($1, $2, $3)
        ON CONFLICT (id) DO NOTHING
      `,
      [RELAY_INTERNAL_KEY_SECRET_ID, encryptSecretString(candidate), new Date().toISOString()]
    );

    const winner = await read();
    if (winner) {
      cachedRelayInternalKey = winner;
      return winner;
    }

    // The stored row exists but does not decrypt (the undecryptable-after-rotation case, so the
    // insert above was a no-op). Overwrite it; a lost race between two simultaneous overwriters
    // resolves at the next process start, and requires two processes to hit rotation recovery in
    // the same instant to occur at all.
    await client.query("UPDATE managed_secrets SET encrypted_value = $2, created_at = $3 WHERE id = $1", [
      RELAY_INTERNAL_KEY_SECRET_ID,
      encryptSecretString(candidate),
      new Date().toISOString()
    ]);
    const adopted = await read();
    cachedRelayInternalKey = adopted || candidate;
    return cachedRelayInternalKey;
  } finally {
    client.release();
  }
}

/**
 * Decrypted publish keys for the relay auth endpoint — the only reader that sees them. The
 * result exists to be compared against a presented credential and must never reach a log, a
 * listing or a response body.
 */
export async function readOverlayVideoSourceIngestCredentials(): Promise<
  Array<{ id: string; ingestKind: OverlayVideoSourceIngestKind; publishKey: string }>
> {
  await ensureDatabase();
  const client = await getPool().connect();
  try {
    const result = await client.query<{ id: string; ingest_kind: string; encrypted_publish_key: string }>(
      "SELECT id, ingest_kind, encrypted_publish_key FROM overlay_video_sources"
    );
    return result.rows.map((row) => ({
      id: row.id,
      ingestKind: normalizeIngestKind(row.ingest_kind),
      publishKey: decryptSecretString(row.encrypted_publish_key || "")
    }));
  } finally {
    client.release();
  }
}

export async function updateTwitchConnectionRecord(twitch: TwitchConnection): Promise<void> {
  await withSerializedStateWrite("updateTwitchConnectionRecord", async (client) => {
    await client.query(
      `
        INSERT INTO twitch_connection (
          singleton_id, status, broadcaster_id, broadcaster_login, access_token, refresh_token, connected_at, token_expires_at,
          last_refresh_at, last_metadata_sync_at, last_synced_title, last_synced_category_name, last_synced_category_id,
          last_schedule_sync_at, live_status, viewer_count, started_at, error
        )
        VALUES (1, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
        ON CONFLICT (singleton_id) DO UPDATE SET
          status = EXCLUDED.status,
          broadcaster_id = EXCLUDED.broadcaster_id,
          broadcaster_login = EXCLUDED.broadcaster_login,
          access_token = EXCLUDED.access_token,
          refresh_token = EXCLUDED.refresh_token,
          connected_at = EXCLUDED.connected_at,
          token_expires_at = EXCLUDED.token_expires_at,
          last_refresh_at = EXCLUDED.last_refresh_at,
          last_metadata_sync_at = EXCLUDED.last_metadata_sync_at,
          last_synced_title = EXCLUDED.last_synced_title,
          last_synced_category_name = EXCLUDED.last_synced_category_name,
          last_synced_category_id = EXCLUDED.last_synced_category_id,
          last_schedule_sync_at = EXCLUDED.last_schedule_sync_at,
          live_status = EXCLUDED.live_status,
          viewer_count = EXCLUDED.viewer_count,
          started_at = EXCLUDED.started_at,
          error = EXCLUDED.error
      `,
      [
        twitch.status,
        twitch.broadcasterId,
        twitch.broadcasterLogin,
        twitch.accessToken,
        twitch.refreshToken,
        twitch.connectedAt,
        twitch.tokenExpiresAt,
        twitch.lastRefreshAt,
        twitch.lastMetadataSyncAt,
        twitch.lastSyncedTitle,
        twitch.lastSyncedCategoryName,
        twitch.lastSyncedCategoryId,
        twitch.lastScheduleSyncAt,
        twitch.liveStatus,
        twitch.viewerCount,
        twitch.startedAt || "",
        twitch.error
      ]
    );
  });
}

export async function updateTwitchBroadcasterConnectionRecord(broadcaster: TwitchBroadcasterConnection): Promise<void> {
  await withSerializedStateWrite("updateTwitchBroadcasterConnectionRecord", async (client) => {
    await client.query(
      `
        INSERT INTO twitch_broadcaster_connection (
          singleton_id, status, broadcaster_id, broadcaster_login, access_token, refresh_token, connected_at,
          token_expires_at, last_refresh_at, error
        )
        VALUES (1, $1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (singleton_id) DO UPDATE SET
          status = EXCLUDED.status,
          broadcaster_id = EXCLUDED.broadcaster_id,
          broadcaster_login = EXCLUDED.broadcaster_login,
          access_token = EXCLUDED.access_token,
          refresh_token = EXCLUDED.refresh_token,
          connected_at = EXCLUDED.connected_at,
          token_expires_at = EXCLUDED.token_expires_at,
          last_refresh_at = EXCLUDED.last_refresh_at,
          error = EXCLUDED.error
      `,
      [
        broadcaster.status,
        broadcaster.broadcasterId,
        broadcaster.broadcasterLogin,
        broadcaster.accessToken,
        broadcaster.refreshToken,
        broadcaster.connectedAt,
        broadcaster.tokenExpiresAt,
        broadcaster.lastRefreshAt,
        broadcaster.error
      ]
    );
  });
}

export async function replaceTwitchScheduleSegments(segments: TwitchScheduleSegmentRecord[]): Promise<void> {
  await withSerializedStateWrite("replaceTwitchScheduleSegments", async (client) => {
    await client.query("DELETE FROM twitch_schedule_segments");

    for (const segment of segments) {
      await client.query(
        `
          INSERT INTO twitch_schedule_segments (key, segment_id, block_id, start_time, title, synced_at)
          VALUES ($1, $2, $3, $4, $5, $6)
        `,
        [segment.key, segment.segmentId, segment.blockId, segment.startTime, segment.title, segment.syncedAt]
      );
    }
  });
}

export async function upsertUserRecord(user: UserRecord): Promise<void> {
  await withSerializedStateWrite("upsertUserRecord", async (client) => {
    await client.query(
      `
        INSERT INTO users (
          id, email, display_name, auth_provider, role, twitch_user_id, twitch_login, password_hash,
          two_factor_enabled, two_factor_secret, two_factor_confirmed_at, created_at, last_login_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        ON CONFLICT (id) DO UPDATE SET
          email = EXCLUDED.email,
          display_name = EXCLUDED.display_name,
          auth_provider = EXCLUDED.auth_provider,
          role = EXCLUDED.role,
          twitch_user_id = EXCLUDED.twitch_user_id,
          twitch_login = EXCLUDED.twitch_login,
          password_hash = EXCLUDED.password_hash,
          two_factor_enabled = EXCLUDED.two_factor_enabled,
          two_factor_secret = EXCLUDED.two_factor_secret,
          two_factor_confirmed_at = EXCLUDED.two_factor_confirmed_at,
          created_at = EXCLUDED.created_at,
          last_login_at = EXCLUDED.last_login_at
      `,
      [
        user.id,
        user.email,
        user.displayName,
        user.authProvider,
        user.role,
        user.twitchUserId,
        user.twitchLogin,
        user.passwordHash ?? "",
        user.twoFactorEnabled ?? false,
        encryptSecretString(user.twoFactorSecret ?? ""),
        user.twoFactorConfirmedAt ?? "",
        user.createdAt,
        user.lastLoginAt
      ]
    );
  });
}

export async function updateOwnerAndInitialized(args: {
  initialized: boolean;
  owner: OwnerAccount;
}): Promise<void> {
  await withSerializedStateWrite("updateOwnerAndInitialized", async (client) => {
    await client.query(
      `
        INSERT INTO system_state (singleton_id, initialized, owner_email, owner_password_hash, owner_created_at)
        VALUES (1, $1, $2, $3, $4)
        ON CONFLICT (singleton_id) DO UPDATE SET
          initialized = EXCLUDED.initialized,
          owner_email = EXCLUDED.owner_email,
          owner_password_hash = EXCLUDED.owner_password_hash,
          owner_created_at = EXCLUDED.owner_created_at
      `,
      [args.initialized, args.owner.email, args.owner.passwordHash, args.owner.createdAt]
    );
  });
}

export async function upsertTeamAccessGrantRecord(grant: TeamAccessGrant): Promise<void> {
  await withSerializedStateWrite("upsertTeamAccessGrantRecord", async (client) => {
    await client.query(
      `
        INSERT INTO team_access_grants (id, twitch_login, role, created_at, created_by)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (id) DO UPDATE SET
          twitch_login = EXCLUDED.twitch_login,
          role = EXCLUDED.role,
          created_at = EXCLUDED.created_at,
          created_by = EXCLUDED.created_by
      `,
      [grant.id, grant.twitchLogin, grant.role, grant.createdAt, grant.createdBy]
    );
  });
}

export async function updateModerationConfigRecord(config: ModerationConfig): Promise<void> {
  await withSerializedStateWrite("updateModerationConfigRecord", async (client) => {
    await client.query(
      `
        INSERT INTO moderation_settings (
          singleton_id, enabled, command, default_minutes, min_minutes, max_minutes, require_prefix, fallback_emote_only
        )
        VALUES (1, $1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (singleton_id) DO UPDATE SET
          enabled = EXCLUDED.enabled,
          command = EXCLUDED.command,
          default_minutes = EXCLUDED.default_minutes,
          min_minutes = EXCLUDED.min_minutes,
          max_minutes = EXCLUDED.max_minutes,
          require_prefix = EXCLUDED.require_prefix,
          fallback_emote_only = EXCLUDED.fallback_emote_only
      `,
      [
        config.enabled,
        config.command,
        config.defaultMinutes,
        config.minMinutes,
        config.maxMinutes,
        config.requirePrefix,
        config.fallbackEmoteOnly
      ]
    );
  });
}

export async function appendPresenceWindowRecord(window: ModeratorPresenceWindowRecord): Promise<void> {
  await withSerializedStateWrite("appendPresenceWindowRecord", async (client) => {
    await client.query(
      `
        INSERT INTO presence_windows (
          actor, minutes, requested_minutes, applied_minutes, clamp_reason, created_at, expires_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `,
      [
        window.actor,
        window.minutes,
        window.requestedMinutes ?? null,
        window.appliedMinutes ?? window.minutes,
        normalizePresenceClampReason(window.clampReason),
        window.createdAt,
        window.expiresAt
      ]
    );
    await client.query(`
      DELETE FROM presence_windows
      WHERE expires_at IN (
        SELECT expires_at
        FROM presence_windows
        ORDER BY created_at DESC
        OFFSET 100
      )
    `);
  });
}

/**
 * Reads the blocks that currently exist, inside whatever transaction the caller holds.
 *
 * Exists so a validation and the write it guards can share one lock. Checking overlaps against a
 * separately-read snapshot leaves a window in which another editor commits a block that the check
 * never saw, and both writes then succeed — producing exactly the overlapping schedule the check
 * was there to prevent, and an editor that refuses to save until someone deletes a block by hand.
 */
async function readScheduleBlockRecords(client: PoolClient): Promise<ScheduleBlockRecord[]> {
  const result = await client.query<{
    id: string;
    title: string;
    category_name: string;
    start_hour: number;
    start_minute_of_day: number | null;
    duration_minutes: number;
    day_of_week: number | null;
    show_id: string;
    pool_id: string;
    source_name: string;
    repeat_mode: ScheduleBlockRecord["repeatMode"];
    repeat_group_id: string;
    cuepoint_asset_id: string;
    cuepoint_offsets_seconds: string;
  }>("SELECT * FROM schedule_blocks ORDER BY day_of_week ASC, start_minute_of_day ASC, start_hour ASC");

  return result.rows.map((row) => ({
    id: row.id,
    title: row.title,
    categoryName: row.category_name,
    startMinuteOfDay:
      typeof row.start_minute_of_day === "number" ? row.start_minute_of_day : (row.start_hour % 24) * 60,
    durationMinutes: row.duration_minutes,
    dayOfWeek: row.day_of_week ?? 0,
    showId: row.show_id || undefined,
    poolId: row.pool_id || undefined,
    sourceName: row.source_name,
    repeatMode: row.repeat_mode || "single",
    repeatGroupId: row.repeat_group_id || "",
    cuepointAssetId: row.cuepoint_asset_id || "",
    cuepointOffsetsSeconds: JSON.parse(row.cuepoint_offsets_seconds || "[]") as number[]
  }));
}

/**
 * Creates blocks only if `validate` accepts them alongside the blocks already stored.
 *
 * The validator runs against state read under the same lock that performs the insert, so two
 * editors saving at once cannot both pass a check that neither of their results satisfies.
 * Throwing from `validate` aborts the transaction and writes nothing.
 */
export async function createScheduleBlocksChecked(
  blocks: ScheduleBlockRecord[],
  validate: (existing: ScheduleBlockRecord[], incoming: ScheduleBlockRecord[]) => void
): Promise<void> {
  if (blocks.length === 0) {
    return;
  }

  await withSerializedStateWrite("createScheduleBlocksChecked", async (client) => {
    validate(await readScheduleBlockRecords(client), blocks);
    await insertScheduleBlockRows(client, blocks);
  });
}

export async function createScheduleBlocks(blocks: ScheduleBlockRecord[]): Promise<void> {
  if (blocks.length === 0) {
    return;
  }

  await withSerializedStateWrite("createScheduleBlocks", async (client) => {
    await insertScheduleBlockRows(client, blocks);
  });
}

async function insertScheduleBlockRows(client: PoolClient, blocks: ScheduleBlockRecord[]): Promise<void> {
  for (const block of blocks) {
    await client.query(
      `
        INSERT INTO schedule_blocks (
          id, title, category_name, start_hour, start_minute_of_day, duration_minutes, day_of_week, show_id, pool_id, source_name, repeat_mode, repeat_group_id, cuepoint_asset_id, cuepoint_offsets_seconds
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      `,
      [
        block.id,
        block.title,
        block.categoryName,
        Math.floor(block.startMinuteOfDay / 60),
        block.startMinuteOfDay,
        block.durationMinutes,
        block.dayOfWeek,
        block.showId ?? "",
        block.poolId ?? "",
        block.sourceName,
        block.repeatMode ?? "single",
        block.repeatGroupId ?? "",
        block.cuepointAssetId ?? "",
        JSON.stringify(block.cuepointOffsetsSeconds ?? [])
      ]
    );
  }
}

export async function replaceAllScheduleBlocks(blocks: ScheduleBlockRecord[]): Promise<void> {
  await withSerializedStateWrite("replaceAllScheduleBlocks", async (client) => {
    await client.query("DELETE FROM schedule_blocks");

    for (const block of blocks) {
      await client.query(
        `
          INSERT INTO schedule_blocks (
            id, title, category_name, start_hour, start_minute_of_day, duration_minutes, day_of_week, show_id, pool_id, source_name, repeat_mode, repeat_group_id, cuepoint_asset_id, cuepoint_offsets_seconds
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
        `,
        [
          block.id,
          block.title,
          block.categoryName,
          Math.floor(block.startMinuteOfDay / 60),
          block.startMinuteOfDay,
          block.durationMinutes,
          block.dayOfWeek,
          block.showId ?? "",
          block.poolId ?? "",
          block.sourceName,
          block.repeatMode ?? "single",
          block.repeatGroupId ?? "",
          block.cuepointAssetId ?? "",
          JSON.stringify(block.cuepointOffsetsSeconds ?? [])
        ]
      );
    }
  });
}

export async function updateScheduleBlockRecord(block: ScheduleBlockRecord): Promise<void> {
  await withSerializedStateWrite("updateScheduleBlockRecord", async (client) => {
    await client.query(
      `
        UPDATE schedule_blocks
        SET title = $2,
            category_name = $3,
            start_hour = $4,
            start_minute_of_day = $5,
            duration_minutes = $6,
            day_of_week = $7,
            show_id = $8,
            pool_id = $9,
            source_name = $10,
            repeat_mode = $11,
            repeat_group_id = $12,
            cuepoint_asset_id = $13,
            cuepoint_offsets_seconds = $14
        WHERE id = $1
      `,
      [
        block.id,
        block.title,
        block.categoryName,
        Math.floor(block.startMinuteOfDay / 60),
        block.startMinuteOfDay,
        block.durationMinutes,
        block.dayOfWeek,
        block.showId ?? "",
        block.poolId ?? "",
        block.sourceName,
        block.repeatMode ?? "single",
        block.repeatGroupId ?? "",
        block.cuepointAssetId ?? "",
        JSON.stringify(block.cuepointOffsetsSeconds ?? [])
      ]
    );
  });
}

export async function updateScheduleRepeatGroupRecords(args: {
  repeatGroupId: string;
  title: string;
  categoryName: string;
  startMinuteOfDay: number;
  durationMinutes: number;
  showId?: string;
  poolId?: string;
  sourceName: string;
  cuepointAssetId?: string;
  cuepointOffsetsSeconds?: number[];
}): Promise<void> {
  await withSerializedStateWrite("updateScheduleRepeatGroupRecords", async (client) => {
    await client.query(
      `
        UPDATE schedule_blocks
        SET title = $2,
            category_name = $3,
            start_hour = $4,
            start_minute_of_day = $5,
            duration_minutes = $6,
            show_id = $7,
            pool_id = $8,
            source_name = $9,
            cuepoint_asset_id = $10,
            cuepoint_offsets_seconds = $11
        WHERE repeat_group_id = $1
      `,
      [
        args.repeatGroupId,
        args.title,
        args.categoryName,
        Math.floor(args.startMinuteOfDay / 60),
        args.startMinuteOfDay,
        args.durationMinutes,
        args.showId ?? "",
        args.poolId ?? "",
        args.sourceName,
        args.cuepointAssetId ?? "",
        JSON.stringify(args.cuepointOffsetsSeconds ?? [])
      ]
    );
  });
}

export async function deleteScheduleBlockRecord(id: string): Promise<void> {
  await withSerializedStateWrite("deleteScheduleBlockRecord", async (client) => {
    await client.query("DELETE FROM schedule_blocks WHERE id = $1", [id]);
  });
}

export async function createPoolRecord(pool: PoolRecord): Promise<void> {
  await withSerializedStateWrite("createPoolRecord", async (client) => {
    await client.query(
      `
        INSERT INTO pools (
          id, name, source_ids, playback_mode, cursor_asset_id, insert_asset_id, insert_every_items, items_since_insert, audio_lane_asset_id, audio_lane_volume_percent, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      `,
      [
        pool.id,
        pool.name,
        JSON.stringify(pool.sourceIds),
        pool.playbackMode,
        pool.cursorAssetId ?? "",
        pool.insertAssetId ?? "",
        pool.insertEveryItems ?? 0,
        pool.itemsSinceInsert ?? 0,
        pool.audioLaneAssetId ?? "",
        pool.audioLaneVolumePercent ?? 100,
        pool.updatedAt
      ]
    );
  });
}

export async function updatePoolRecord(pool: PoolRecord): Promise<void> {
  await withSerializedStateWrite("updatePoolRecord", async (client) => {
    await client.query(
      `
        UPDATE pools
        SET name = $2,
            source_ids = $3,
            playback_mode = $4,
            cursor_asset_id = $5,
            insert_asset_id = $6,
            insert_every_items = $7,
            items_since_insert = $8,
            audio_lane_asset_id = $9,
            audio_lane_volume_percent = $10,
            updated_at = $11
        WHERE id = $1
      `,
      [
        pool.id,
        pool.name,
        JSON.stringify(pool.sourceIds),
        pool.playbackMode,
        pool.cursorAssetId ?? "",
        pool.insertAssetId ?? "",
        pool.insertEveryItems ?? 0,
        pool.itemsSinceInsert ?? 0,
        pool.audioLaneAssetId ?? "",
        pool.audioLaneVolumePercent ?? 100,
        pool.updatedAt
      ]
    );
  });
}

export async function deletePoolRecord(poolId: string): Promise<void> {
  await withSerializedStateWrite("deletePoolRecord", async (client) => {
    await client.query("DELETE FROM schedule_blocks WHERE pool_id = $1", [poolId]);
    await client.query("DELETE FROM pools WHERE id = $1", [poolId]);
  });
}

export async function createShowProfileRecord(show: ShowProfileRecord): Promise<void> {
  await withSerializedStateWrite("createShowProfileRecord", async (client) => {
    await client.query(
      `
        INSERT INTO show_profiles (id, name, category_name, default_duration_minutes, color, description, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `,
      [show.id, show.name, show.categoryName, show.defaultDurationMinutes, show.color, show.description, show.updatedAt]
    );
  });
}

export async function updateShowProfileRecord(show: ShowProfileRecord): Promise<void> {
  await withSerializedStateWrite("updateShowProfileRecord", async (client) => {
    await client.query(
      `
        UPDATE show_profiles
        SET name = $2,
            category_name = $3,
            default_duration_minutes = $4,
            color = $5,
            description = $6,
            updated_at = $7
        WHERE id = $1
      `,
      [show.id, show.name, show.categoryName, show.defaultDurationMinutes, show.color, show.description, show.updatedAt]
    );
  });
}

export async function deleteShowProfileRecord(showId: string): Promise<void> {
  await withSerializedStateWrite("deleteShowProfileRecord", async (client) => {
    await client.query("UPDATE schedule_blocks SET show_id = '' WHERE show_id = $1", [showId]);
    await client.query("DELETE FROM show_profiles WHERE id = $1", [showId]);
  });
}

export async function upsertIncident(args: {
  scope: IncidentRecord["scope"];
  severity: IncidentRecord["severity"];
  title: string;
  message: string;
  fingerprint: string;
}): Promise<void> {
  // The sink redacts, so no caller has to remember to: an ffmpeg line quoting the publish URL
  // reached this table with the stream key intact on 2026-09-01.
  const title = redactSecrets(args.title);
  const message = redactSecrets(args.message);
  await withSerializedStateWrite("upsertIncident", async (client) => {
    const existingResult = await client.query<{
      id: string;
      created_at: string;
    }>("SELECT id, created_at FROM incidents WHERE fingerprint = $1 LIMIT 1", [args.fingerprint]);
    const existing = existingResult.rows[0] ?? null;
    const now = new Date().toISOString();

    if (existing) {
      await client.query(
        `
          UPDATE incidents
          SET scope = $2,
              severity = $3,
              status = 'open',
              acknowledged_at = '',
              acknowledged_by = '',
              title = $4,
              message = $5,
              updated_at = $6,
              resolved_at = ''
          WHERE fingerprint = $1
        `,
        [args.fingerprint, args.scope, args.severity, title, message, now]
      );
      return;
    }

    await client.query(
      `
        INSERT INTO incidents (
          id, scope, severity, status, acknowledged_at, acknowledged_by, title, message, fingerprint, created_at, updated_at, resolved_at
        )
        VALUES ($1, $2, $3, 'open', '', '', $4, $5, $6, $7, $7, '')
      `,
      [createId("incident"), args.scope, args.severity, title, message, args.fingerprint, now]
    );

    await client.query(`
      DELETE FROM incidents
      WHERE id IN (
        SELECT id FROM incidents
        ORDER BY updated_at DESC, created_at DESC
        OFFSET 100
      )
    `);
  });
}

export async function resolveIncident(fingerprint: string, resolutionMessage?: string): Promise<void> {
  await withSerializedStateWrite("resolveIncident", async (client) => {
    const now = new Date().toISOString();
    await client.query(
      `
        UPDATE incidents
        SET status = 'resolved',
            message = COALESCE(NULLIF($2, ''), message),
            updated_at = $3,
            resolved_at = $3
        WHERE fingerprint = $1 AND status = 'open'
      `,
      [fingerprint, resolutionMessage || "", now]
    );
  });
}

export async function acknowledgeIncident(fingerprint: string, acknowledgedBy: string): Promise<void> {
  await withSerializedStateWrite("acknowledgeIncident", async (client) => {
    const now = new Date().toISOString();
    await client.query(
      `
        UPDATE incidents
        SET acknowledged_at = $2,
            acknowledged_by = $3,
            updated_at = $2
        WHERE fingerprint = $1 AND status = 'open'
      `,
      [fingerprint, now, acknowledgedBy]
    );
  });
}

export async function updatePlayoutRuntime(
  updater: (playout: PlayoutRuntimeRecord, state: AppState) => PlayoutRuntimeRecord | Promise<PlayoutRuntimeRecord>
): Promise<PlayoutRuntimeRecord> {
  return withSerializedStateWrite("updatePlayoutRuntime", async (client) => {
    const state = await hydrateState(client);
    const nextState = normalizeState({
      ...state,
      playout: await updater(state.playout, state)
    });
    await persistPlayoutRuntime(client, nextState.playout);
    return nextState.playout;
  });
}

export async function updatePoolCursor(
  poolId: string,
  cursorAssetId: string,
  options?: { incrementItemsSinceInsert?: boolean; resetItemsSinceInsert?: boolean }
): Promise<void> {
  await withSerializedStateWrite("updatePoolCursor", async (client) => {
    const row = await client.query<{ items_since_insert: number }>("SELECT items_since_insert FROM pools WHERE id = $1", [poolId]);
    const currentItemsSinceInsert = row.rows[0]?.items_since_insert ?? 0;
    const nextItemsSinceInsert = options?.resetItemsSinceInsert
      ? 0
      : options?.incrementItemsSinceInsert
        ? currentItemsSinceInsert + 1
        : currentItemsSinceInsert;

    await client.query(
      "UPDATE pools SET cursor_asset_id = $2, items_since_insert = $3, updated_at = $4 WHERE id = $1",
      [poolId, cursorAssetId, nextItemsSinceInsert, new Date().toISOString()]
    );
  });
}

export function findUserById(state: AppState, id: string | null): UserRecord | null {
  if (!id) {
    return null;
  }
  return state.users.find((user) => user.id === id) ?? null;
}

export function findUserByEmail(state: AppState, email: string): UserRecord | null {
  return state.users.find((user) => user.email === email) ?? null;
}

export function findTeamGrantByLogin(state: AppState, twitchLogin: string): TeamAccessGrant | null {
  return state.teamAccessGrants.find((grant) => grant.twitchLogin.toLowerCase() === twitchLogin.toLowerCase()) ?? null;
}
