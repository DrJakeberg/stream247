import { promises as fs } from "node:fs";
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import path from "node:path";
import { Pool, type PoolClient } from "pg";
import {
  createDefaultModerationConfig,
  normalizeOverlayPanelAnchor,
  normalizeOverlaySceneLayerOrder,
  normalizeOverlayScenePreset,
  normalizeOverlaySurfaceStyle,
  normalizeOverlayTitleScale,
  type ModerationConfig,
  type OverlaySceneLayerKind
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
  createdAt: string;
  expiresAt: string;
};

export type AuditEvent = {
  id: string;
  type: string;
  message: string;
  createdAt: string;
};

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
  status: "ready" | "pending" | "error";
  externalId?: string;
  categoryName?: string;
  durationSeconds?: number;
  publishedAt?: string;
  fallbackPriority: number;
  isGlobalFallback: boolean;
  createdAt: string;
  updatedAt: string;
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
  name: string;
  enabled: boolean;
  rtmpUrl: string;
  streamKeyPresent: boolean;
  status: "ready" | "missing-config" | "error";
  notes: string;
  lastValidatedAt: string;
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
};

export type OverlaySettingsRecord = {
  enabled: boolean;
  channelName: string;
  headline: string;
  replayLabel: string;
  brandBadge: string;
  scenePreset:
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
  showClock: boolean;
  showNextItem: boolean;
  showScheduleTeaser: boolean;
  showCurrentCategory: boolean;
  showSourceLabel: boolean;
  showQueuePreview: boolean;
  queuePreviewCount: number;
  layerOrder: OverlaySceneLayerKind[];
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

export type ManagedConfigRecord = {
  twitchClientId: string;
  twitchClientSecret: string;
  twitchDefaultCategoryId: string;
  discordWebhookUrl: string;
  smtpHost: string;
  smtpPort: string;
  smtpUser: string;
  smtpPassword: string;
  smtpFrom: string;
  alertEmailTo: string;
  updatedAt: string;
};

export type BroadcastQueueItemRecord = {
  id: string;
  kind: "asset" | "insert" | "standby" | "reconnect";
  assetId: string;
  title: string;
  subtitle: string;
  scenePreset: OverlaySettingsRecord["scenePreset"] | "";
  position: number;
};

export type PlayoutRuntimeRecord = {
  status: "idle" | "starting" | "running" | "switching" | "degraded" | "recovering" | "failed" | "standby" | "reconnecting";
  transitionState: "idle" | "prefetching" | "ready" | "switching";
  transitionTargetKind: BroadcastQueueItemRecord["kind"] | "";
  transitionTargetAssetId: string;
  transitionTargetTitle: string;
  transitionReadyAt: string;
  currentAssetId: string;
  currentTitle: string;
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
    | "global_fallback"
    | "generic_fallback"
    | "no_asset"
    | "destination_missing"
    | "resolve_failed"
    | "ffmpeg_crash_loop"
    | "operator_insert"
    | "scheduled_insert"
    | "standby"
    | "scheduled_reconnect"
    | "";
  fallbackTier: "none" | "scheduled" | "operator" | "global-fallback" | "generic-fallback" | "standby";
  overrideMode: "schedule" | "asset" | "fallback";
  overrideAssetId: string;
  overrideUntil: string;
  insertAssetId: string;
  insertRequestedAt: string;
  insertStatus: "" | "pending" | "active";
  skipAssetId: string;
  skipUntil: string;
  pendingAction: "" | "refresh" | "rebuild_queue";
  pendingActionRequestedAt: string;
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
  twitch: TwitchConnection;
  twitchScheduleSegments: TwitchScheduleSegmentRecord[];
  pools: PoolRecord[];
  showProfiles: ShowProfileRecord[];
  scheduleBlocks: ScheduleBlockRecord[];
  sources: SourceRecord[];
  assets: AssetRecord[];
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
  brand_badge: string;
  scene_preset: OverlaySettingsRecord["scenePreset"];
  accent_color: string;
  surface_style: OverlaySettingsRecord["surfaceStyle"];
  panel_anchor: OverlaySettingsRecord["panelAnchor"];
  title_scale: OverlaySettingsRecord["titleScale"];
  show_clock: boolean;
  show_next_item: boolean;
  show_schedule_teaser: boolean;
  show_current_category: boolean;
  show_source_label: boolean;
  show_queue_preview: boolean;
  queue_preview_count: number;
  layer_order_json: string;
  emergency_banner: string;
  replay_label: string;
  ticker_text: string;
  updated_at: string;
};

type OverlayDraftRow = OverlaySettingsRow & {
  based_on_updated_at: string;
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

function normalizeOverlaySettingsRecord(overlay: OverlaySettingsRecord): OverlaySettingsRecord {
  const defaults = defaultState().overlay;
  return {
    ...defaults,
    ...overlay,
    channelName: String(overlay.channelName ?? defaults.channelName).trim().slice(0, 80) || defaults.channelName,
    headline: String(overlay.headline ?? defaults.headline).trim().slice(0, 120) || defaults.headline,
    replayLabel: String(overlay.replayLabel ?? defaults.replayLabel).trim().slice(0, 80) || defaults.replayLabel,
    brandBadge: String(overlay.brandBadge ?? defaults.brandBadge).trim().slice(0, 48),
    scenePreset: normalizeOverlayScenePreset(String(overlay.scenePreset ?? defaults.scenePreset)),
    accentColor: String(overlay.accentColor ?? defaults.accentColor).trim().slice(0, 20) || defaults.accentColor,
    surfaceStyle: normalizeOverlaySurfaceStyle(String(overlay.surfaceStyle ?? defaults.surfaceStyle)),
    panelAnchor: normalizeOverlayPanelAnchor(String(overlay.panelAnchor ?? defaults.panelAnchor)),
    titleScale: normalizeOverlayTitleScale(String(overlay.titleScale ?? defaults.titleScale)),
    queuePreviewCount: Math.max(1, Math.min(5, Number(overlay.queuePreviewCount ?? defaults.queuePreviewCount) || defaults.queuePreviewCount)),
    layerOrder: normalizeOverlaySceneLayerOrder(overlay.layerOrder ?? defaults.layerOrder),
    emergencyBanner: String(overlay.emergencyBanner ?? defaults.emergencyBanner).trim().slice(0, 180),
    tickerText: String(overlay.tickerText ?? defaults.tickerText).trim().slice(0, 180),
    updatedAt: overlay.updatedAt ?? defaults.updatedAt
  };
}

function mapOverlayRowToRecord(row: OverlaySettingsRow | undefined, fallback: OverlaySettingsRecord): OverlaySettingsRecord {
  return row
    ? normalizeOverlaySettingsRecord({
        enabled: row.enabled,
        channelName: row.channel_name,
        headline: row.headline,
        replayLabel: row.replay_label,
        brandBadge: row.brand_badge,
        scenePreset: row.scene_preset,
        accentColor: row.accent_color,
        surfaceStyle: row.surface_style,
        panelAnchor: row.panel_anchor,
        titleScale: row.title_scale,
        showClock: row.show_clock,
        showNextItem: row.show_next_item,
        showScheduleTeaser: row.show_schedule_teaser,
        showCurrentCategory: row.show_current_category,
        showSourceLabel: row.show_source_label,
        showQueuePreview: row.show_queue_preview,
        queuePreviewCount: row.queue_preview_count,
        layerOrder: JSON.parse(row.layer_order_json || "[]") as OverlaySceneLayerKind[],
        emergencyBanner: row.emergency_banner,
        tickerText: row.ticker_text,
        updatedAt: row.updated_at
      })
    : fallback;
}

function overlaySettingsEqual(left: OverlaySettingsRecord, right: OverlaySettingsRecord): boolean {
  const normalizedLeft = normalizeOverlaySettingsRecord(left);
  const normalizedRight = normalizeOverlaySettingsRecord(right);
  return JSON.stringify(normalizedLeft) === JSON.stringify(normalizedRight);
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
          singleton_id, enabled, channel_name, headline, replay_label, brand_badge, scene_preset, accent_color, surface_style, panel_anchor, title_scale, show_clock, show_next_item, show_schedule_teaser, show_current_category, show_source_label, show_queue_preview, queue_preview_count, layer_order_json, emergency_banner, ticker_text, updated_at, based_on_updated_at
        )
        VALUES (1, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)
        ON CONFLICT (singleton_id) DO UPDATE SET
          enabled = EXCLUDED.enabled,
          channel_name = EXCLUDED.channel_name,
          headline = EXCLUDED.headline,
          replay_label = EXCLUDED.replay_label,
          brand_badge = EXCLUDED.brand_badge,
          scene_preset = EXCLUDED.scene_preset,
          accent_color = EXCLUDED.accent_color,
          surface_style = EXCLUDED.surface_style,
          panel_anchor = EXCLUDED.panel_anchor,
          title_scale = EXCLUDED.title_scale,
          show_clock = EXCLUDED.show_clock,
          show_next_item = EXCLUDED.show_next_item,
          show_schedule_teaser = EXCLUDED.show_schedule_teaser,
          show_current_category = EXCLUDED.show_current_category,
          show_source_label = EXCLUDED.show_source_label,
          show_queue_preview = EXCLUDED.show_queue_preview,
          queue_preview_count = EXCLUDED.queue_preview_count,
          layer_order_json = EXCLUDED.layer_order_json,
          emergency_banner = EXCLUDED.emergency_banner,
          ticker_text = EXCLUDED.ticker_text,
          updated_at = EXCLUDED.updated_at,
          based_on_updated_at = EXCLUDED.based_on_updated_at
      `,
      [
        normalized.enabled,
        normalized.channelName,
        normalized.headline,
        normalized.replayLabel,
        normalized.brandBadge,
        normalized.scenePreset,
        normalized.accentColor,
        normalized.surfaceStyle,
        normalized.panelAnchor,
        normalized.titleScale,
        normalized.showClock,
        normalized.showNextItem,
        normalized.showScheduleTeaser,
        normalized.showCurrentCategory,
        normalized.showSourceLabel,
        normalized.showQueuePreview,
        normalized.queuePreviewCount,
        JSON.stringify(normalized.layerOrder),
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
        singleton_id, enabled, channel_name, headline, replay_label, brand_badge, scene_preset, accent_color, surface_style, panel_anchor, title_scale, show_clock, show_next_item, show_schedule_teaser, show_current_category, show_source_label, show_queue_preview, queue_preview_count, layer_order_json, emergency_banner, ticker_text, updated_at
      )
      VALUES (1, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
      ON CONFLICT (singleton_id) DO UPDATE SET
        enabled = EXCLUDED.enabled,
        channel_name = EXCLUDED.channel_name,
        headline = EXCLUDED.headline,
        replay_label = EXCLUDED.replay_label,
        brand_badge = EXCLUDED.brand_badge,
        scene_preset = EXCLUDED.scene_preset,
        accent_color = EXCLUDED.accent_color,
        surface_style = EXCLUDED.surface_style,
        panel_anchor = EXCLUDED.panel_anchor,
        title_scale = EXCLUDED.title_scale,
        show_clock = EXCLUDED.show_clock,
        show_next_item = EXCLUDED.show_next_item,
        show_schedule_teaser = EXCLUDED.show_schedule_teaser,
        show_current_category = EXCLUDED.show_current_category,
        show_source_label = EXCLUDED.show_source_label,
        show_queue_preview = EXCLUDED.show_queue_preview,
        queue_preview_count = EXCLUDED.queue_preview_count,
        layer_order_json = EXCLUDED.layer_order_json,
        emergency_banner = EXCLUDED.emergency_banner,
        ticker_text = EXCLUDED.ticker_text,
        updated_at = EXCLUDED.updated_at
    `,
    [
      normalized.enabled,
      normalized.channelName,
      normalized.headline,
      normalized.replayLabel,
      normalized.brandBadge,
      normalized.scenePreset,
      normalized.accentColor,
      normalized.surfaceStyle,
      normalized.panelAnchor,
      normalized.titleScale,
      normalized.showClock,
      normalized.showNextItem,
      normalized.showScheduleTeaser,
      normalized.showCurrentCategory,
      normalized.showSourceLabel,
      normalized.showQueuePreview,
      normalized.queuePreviewCount,
      JSON.stringify(normalized.layerOrder),
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
  return scryptSync(process.env.APP_SECRET || "stream247-dev-secret", "stream247-managed-config", 32);
}

function encryptManagedConfig(value: ManagedConfigRecord): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getEncryptionKey(), iv);
  const plaintext = Buffer.from(JSON.stringify(value), "utf8");
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return `v1:${iv.toString("base64url")}:${authTag.toString("base64url")}:${encrypted.toString("base64url")}`;
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
      replayLabel: "Replay stream",
      brandBadge: "",
      scenePreset: "replay-lower-third",
      accentColor: "#0e6d5a",
      surfaceStyle: "glass",
      panelAnchor: "bottom",
      titleScale: "balanced",
      showClock: true,
      showNextItem: true,
      showScheduleTeaser: true,
      showCurrentCategory: true,
      showSourceLabel: true,
      showQueuePreview: false,
      queuePreviewCount: 3,
      layerOrder: normalizeOverlaySceneLayerOrder([]),
      emergencyBanner: "",
      tickerText: "",
      updatedAt: ""
    },
    managedConfig: {
      twitchClientId: "",
      twitchClientSecret: "",
      twitchDefaultCategoryId: "",
      discordWebhookUrl: "",
      smtpHost: "",
      smtpPort: "",
      smtpUser: "",
      smtpPassword: "",
      smtpFrom: "",
      alertEmailTo: "",
      updatedAt: ""
    },
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
      error: ""
    },
    twitchScheduleSegments: [],
    pools: [],
    showProfiles: [],
    scheduleBlocks: [],
    sources: [],
    assets: [],
    sourceSyncRuns: [],
    destinations: [
      {
        id: "destination-primary",
        provider: "twitch",
        name: "Primary Twitch Output",
        enabled: true,
        rtmpUrl: process.env.STREAM_OUTPUT_URL || process.env.TWITCH_RTMP_URL || "rtmp://live.twitch.tv/app",
        streamKeyPresent: Boolean(process.env.STREAM_OUTPUT_KEY || process.env.TWITCH_STREAM_KEY),
        status: process.env.STREAM_OUTPUT_KEY || process.env.TWITCH_STREAM_KEY ? "ready" : "missing-config",
        notes: "Primary RTMP destination for the broadcast runtime.",
        lastValidatedAt: ""
      }
    ],
    incidents: [],
    auditEvents: [],
    playout: {
      status: "idle",
      transitionState: "idle",
      transitionTargetKind: "",
      transitionTargetAssetId: "",
      transitionTargetTitle: "",
      transitionReadyAt: "",
      currentAssetId: "",
      currentTitle: "",
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
      insertAssetId: "",
      insertRequestedAt: "",
      insertStatus: "",
      skipAssetId: "",
      skipUntil: "",
      pendingAction: "",
      pendingActionRequestedAt: "",
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

  return {
    ...defaults,
    ...state,
    owner,
    moderation: {
      ...defaults.moderation,
      ...(state.moderation ?? {})
    },
    overlay: {
      ...defaults.overlay,
      ...(state.overlay ?? {}),
      scenePreset: normalizeOverlayScenePreset(String(state.overlay?.scenePreset ?? defaults.overlay.scenePreset)),
      surfaceStyle: normalizeOverlaySurfaceStyle(String(state.overlay?.surfaceStyle ?? defaults.overlay.surfaceStyle)),
      panelAnchor: normalizeOverlayPanelAnchor(String(state.overlay?.panelAnchor ?? defaults.overlay.panelAnchor)),
      titleScale: normalizeOverlayTitleScale(String(state.overlay?.titleScale ?? defaults.overlay.titleScale)),
      layerOrder: normalizeOverlaySceneLayerOrder(state.overlay?.layerOrder ?? defaults.overlay.layerOrder)
    },
    managedConfig: {
      ...defaults.managedConfig,
      ...(state.managedConfig ?? {})
    },
    twitch: {
      ...defaults.twitch,
      ...(state.twitch ?? {})
    },
    twitchScheduleSegments: Array.isArray(state.twitchScheduleSegments) ? state.twitchScheduleSegments : [],
    users: Array.isArray(state.users) ? dedupeById(state.users) : [],
    teamAccessGrants: Array.isArray(state.teamAccessGrants) ? dedupeById(state.teamAccessGrants) : [],
    presenceWindows: Array.isArray(state.presenceWindows) ? state.presenceWindows : [],
    pools: Array.isArray(state.pools)
      ? dedupeById(state.pools).map((pool) => ({
          ...pool,
          sourceIds: Array.isArray(pool.sourceIds) ? [...new Set(pool.sourceIds)] : [],
          playbackMode: "round-robin",
          insertAssetId: pool.insertAssetId ?? "",
          insertEveryItems: typeof pool.insertEveryItems === "number" ? Math.max(0, pool.insertEveryItems) : 0,
          itemsSinceInsert: typeof pool.itemsSinceInsert === "number" ? Math.max(0, pool.itemsSinceInsert) : 0
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
          startMinuteOfDay:
            typeof (block as ScheduleBlockRecord & { startHour?: number }).startMinuteOfDay === "number"
              ? block.startMinuteOfDay
              : (((block as ScheduleBlockRecord & { startHour?: number }).startHour ?? 0) % 24) * 60
        }))
      : [],
    sources: Array.isArray(state.sources)
      ? dedupeById(state.sources).map((source) => ({
          ...source,
          enabled: source.enabled ?? true
        }))
      : [],
    assets: Array.isArray(state.assets)
      ? dedupeById(state.assets).map((asset) => ({
          ...asset,
          externalId: asset.externalId ?? "",
          categoryName: asset.categoryName ?? "",
          durationSeconds: asset.durationSeconds ?? 0,
          publishedAt: asset.publishedAt ?? "",
          fallbackPriority: asset.fallbackPriority ?? 100,
          isGlobalFallback: asset.isGlobalFallback ?? false
        }))
      : [],
    sourceSyncRuns: Array.isArray((state as AppState & { sourceSyncRuns?: SourceSyncRunRecord[] }).sourceSyncRuns)
      ? dedupeById((state as AppState & { sourceSyncRuns?: SourceSyncRunRecord[] }).sourceSyncRuns ?? [])
          .sort((left, right) => new Date(right.finishedAt || right.startedAt).getTime() - new Date(left.finishedAt || left.startedAt).getTime())
          .slice(0, 250)
      : [],
    destinations: Array.isArray(state.destinations) ? dedupeById(state.destinations) : defaults.destinations,
    incidents: Array.isArray(state.incidents) ? dedupeById(state.incidents) : [],
    auditEvents: Array.isArray(state.auditEvents) ? state.auditEvents : [],
    playout: {
      ...defaults.playout,
      ...(state.playout ?? {}),
      queueItems: Array.isArray(state.playout?.queueItems)
        ? state.playout.queueItems.map((item, index) => ({
            id: item.id ?? `queue-${index}`,
            kind:
              item.kind === "insert" || item.kind === "reconnect" || item.kind === "standby" || item.kind === "asset"
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
      actor TEXT NOT NULL,
      minutes INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT PRIMARY KEY
    );

    CREATE TABLE IF NOT EXISTS overlay_settings (
      singleton_id SMALLINT PRIMARY KEY DEFAULT 1,
      enabled BOOLEAN NOT NULL DEFAULT FALSE,
      channel_name TEXT NOT NULL DEFAULT 'Stream247',
      headline TEXT NOT NULL DEFAULT 'Always on air',
      replay_label TEXT NOT NULL DEFAULT 'Replay stream',
      brand_badge TEXT NOT NULL DEFAULT '',
      scene_preset TEXT NOT NULL DEFAULT 'replay-lower-third',
      accent_color TEXT NOT NULL DEFAULT '#0e6d5a',
      surface_style TEXT NOT NULL DEFAULT 'glass',
      panel_anchor TEXT NOT NULL DEFAULT 'bottom',
      title_scale TEXT NOT NULL DEFAULT 'balanced',
      show_clock BOOLEAN NOT NULL DEFAULT TRUE,
      show_next_item BOOLEAN NOT NULL DEFAULT TRUE,
      show_schedule_teaser BOOLEAN NOT NULL DEFAULT TRUE,
      show_current_category BOOLEAN NOT NULL DEFAULT TRUE,
      show_source_label BOOLEAN NOT NULL DEFAULT TRUE,
      show_queue_preview BOOLEAN NOT NULL DEFAULT FALSE,
      queue_preview_count INTEGER NOT NULL DEFAULT 3,
      layer_order_json TEXT NOT NULL DEFAULT '[]',
      emergency_banner TEXT NOT NULL DEFAULT '',
      ticker_text TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS overlay_drafts (
      singleton_id SMALLINT PRIMARY KEY DEFAULT 1,
      enabled BOOLEAN NOT NULL DEFAULT FALSE,
      channel_name TEXT NOT NULL DEFAULT 'Stream247',
      headline TEXT NOT NULL DEFAULT 'Always on air',
      replay_label TEXT NOT NULL DEFAULT 'Replay stream',
      brand_badge TEXT NOT NULL DEFAULT '',
      scene_preset TEXT NOT NULL DEFAULT 'replay-lower-third',
      accent_color TEXT NOT NULL DEFAULT '#0e6d5a',
      surface_style TEXT NOT NULL DEFAULT 'glass',
      panel_anchor TEXT NOT NULL DEFAULT 'bottom',
      title_scale TEXT NOT NULL DEFAULT 'balanced',
      show_clock BOOLEAN NOT NULL DEFAULT TRUE,
      show_next_item BOOLEAN NOT NULL DEFAULT TRUE,
      show_schedule_teaser BOOLEAN NOT NULL DEFAULT TRUE,
      show_current_category BOOLEAN NOT NULL DEFAULT TRUE,
      show_source_label BOOLEAN NOT NULL DEFAULT TRUE,
      show_queue_preview BOOLEAN NOT NULL DEFAULT FALSE,
      queue_preview_count INTEGER NOT NULL DEFAULT 3,
      layer_order_json TEXT NOT NULL DEFAULT '[]',
      emergency_banner TEXT NOT NULL DEFAULT '',
      ticker_text TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT '',
      based_on_updated_at TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS managed_config (
      singleton_id SMALLINT PRIMARY KEY DEFAULT 1,
      encrypted_payload TEXT NOT NULL DEFAULT '',
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
      source_name TEXT NOT NULL
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
      status TEXT NOT NULL,
      external_id TEXT NOT NULL DEFAULT '',
      category_name TEXT NOT NULL DEFAULT '',
      duration_seconds INTEGER NOT NULL DEFAULT 0,
      published_at TEXT NOT NULL DEFAULT '',
      fallback_priority INTEGER NOT NULL DEFAULT 100,
      is_global_fallback BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
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
      name TEXT NOT NULL,
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      rtmp_url TEXT NOT NULL DEFAULT '',
      stream_key_present BOOLEAN NOT NULL DEFAULT FALSE,
      status TEXT NOT NULL DEFAULT 'missing-config',
      notes TEXT NOT NULL DEFAULT '',
      last_validated_at TEXT NOT NULL DEFAULT ''
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
      transition_target_kind TEXT NOT NULL DEFAULT '',
      transition_target_asset_id TEXT NOT NULL DEFAULT '',
      transition_target_title TEXT NOT NULL DEFAULT '',
      transition_ready_at TEXT NOT NULL DEFAULT '',
      current_asset_id TEXT NOT NULL DEFAULT '',
      current_title TEXT NOT NULL DEFAULT '',
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
      insert_asset_id TEXT NOT NULL DEFAULT '',
      insert_requested_at TEXT NOT NULL DEFAULT '',
      insert_status TEXT NOT NULL DEFAULT '',
      skip_asset_id TEXT NOT NULL DEFAULT '',
      skip_until TEXT NOT NULL DEFAULT '',
      pending_action TEXT NOT NULL DEFAULT '',
      pending_action_requested_at TEXT NOT NULL DEFAULT '',
      message TEXT NOT NULL DEFAULT 'Playout engine has not started yet.'
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
    ALTER TABLE sources ADD COLUMN IF NOT EXISTS connector_kind TEXT NOT NULL DEFAULT 'local-library';
    ALTER TABLE sources ADD COLUMN IF NOT EXISTS external_url TEXT NOT NULL DEFAULT '';
    ALTER TABLE sources ADD COLUMN IF NOT EXISTS notes TEXT NOT NULL DEFAULT '';
    ALTER TABLE assets ADD COLUMN IF NOT EXISTS fallback_priority INTEGER NOT NULL DEFAULT 100;
    ALTER TABLE assets ADD COLUMN IF NOT EXISTS is_global_fallback BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE incidents ADD COLUMN IF NOT EXISTS acknowledged_at TEXT NOT NULL DEFAULT '';
    ALTER TABLE incidents ADD COLUMN IF NOT EXISTS acknowledged_by TEXT NOT NULL DEFAULT '';
    ALTER TABLE overlay_settings ADD COLUMN IF NOT EXISTS enabled BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE overlay_settings ADD COLUMN IF NOT EXISTS channel_name TEXT NOT NULL DEFAULT 'Stream247';
    ALTER TABLE overlay_settings ADD COLUMN IF NOT EXISTS headline TEXT NOT NULL DEFAULT 'Always on air';
    ALTER TABLE overlay_settings ADD COLUMN IF NOT EXISTS accent_color TEXT NOT NULL DEFAULT '#0e6d5a';
    ALTER TABLE overlay_settings ADD COLUMN IF NOT EXISTS show_clock BOOLEAN NOT NULL DEFAULT TRUE;
    ALTER TABLE overlay_settings ADD COLUMN IF NOT EXISTS show_next_item BOOLEAN NOT NULL DEFAULT TRUE;
    ALTER TABLE overlay_settings ADD COLUMN IF NOT EXISTS show_schedule_teaser BOOLEAN NOT NULL DEFAULT TRUE;
    ALTER TABLE overlay_settings ADD COLUMN IF NOT EXISTS brand_badge TEXT NOT NULL DEFAULT '';
    ALTER TABLE overlay_settings ADD COLUMN IF NOT EXISTS scene_preset TEXT NOT NULL DEFAULT 'replay-lower-third';
    ALTER TABLE overlay_settings ADD COLUMN IF NOT EXISTS surface_style TEXT NOT NULL DEFAULT 'glass';
    ALTER TABLE overlay_settings ADD COLUMN IF NOT EXISTS panel_anchor TEXT NOT NULL DEFAULT 'bottom';
    ALTER TABLE overlay_settings ADD COLUMN IF NOT EXISTS title_scale TEXT NOT NULL DEFAULT 'balanced';
    ALTER TABLE overlay_settings ADD COLUMN IF NOT EXISTS show_current_category BOOLEAN NOT NULL DEFAULT TRUE;
    ALTER TABLE overlay_settings ADD COLUMN IF NOT EXISTS show_source_label BOOLEAN NOT NULL DEFAULT TRUE;
    ALTER TABLE overlay_settings ADD COLUMN IF NOT EXISTS show_queue_preview BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE overlay_settings ADD COLUMN IF NOT EXISTS queue_preview_count INTEGER NOT NULL DEFAULT 3;
    ALTER TABLE overlay_settings ADD COLUMN IF NOT EXISTS layer_order_json TEXT NOT NULL DEFAULT '[]';
    ALTER TABLE overlay_settings ADD COLUMN IF NOT EXISTS emergency_banner TEXT NOT NULL DEFAULT '';
    ALTER TABLE overlay_settings ADD COLUMN IF NOT EXISTS replay_label TEXT NOT NULL DEFAULT 'Replay stream';
    ALTER TABLE overlay_settings ADD COLUMN IF NOT EXISTS ticker_text TEXT NOT NULL DEFAULT '';
    ALTER TABLE overlay_settings ADD COLUMN IF NOT EXISTS updated_at TEXT NOT NULL DEFAULT '';
    ALTER TABLE overlay_drafts ADD COLUMN IF NOT EXISTS enabled BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE overlay_drafts ADD COLUMN IF NOT EXISTS channel_name TEXT NOT NULL DEFAULT 'Stream247';
    ALTER TABLE overlay_drafts ADD COLUMN IF NOT EXISTS headline TEXT NOT NULL DEFAULT 'Always on air';
    ALTER TABLE overlay_drafts ADD COLUMN IF NOT EXISTS accent_color TEXT NOT NULL DEFAULT '#0e6d5a';
    ALTER TABLE overlay_drafts ADD COLUMN IF NOT EXISTS show_clock BOOLEAN NOT NULL DEFAULT TRUE;
    ALTER TABLE overlay_drafts ADD COLUMN IF NOT EXISTS show_next_item BOOLEAN NOT NULL DEFAULT TRUE;
    ALTER TABLE overlay_drafts ADD COLUMN IF NOT EXISTS show_schedule_teaser BOOLEAN NOT NULL DEFAULT TRUE;
    ALTER TABLE overlay_drafts ADD COLUMN IF NOT EXISTS brand_badge TEXT NOT NULL DEFAULT '';
    ALTER TABLE overlay_drafts ADD COLUMN IF NOT EXISTS scene_preset TEXT NOT NULL DEFAULT 'replay-lower-third';
    ALTER TABLE overlay_drafts ADD COLUMN IF NOT EXISTS surface_style TEXT NOT NULL DEFAULT 'glass';
    ALTER TABLE overlay_drafts ADD COLUMN IF NOT EXISTS panel_anchor TEXT NOT NULL DEFAULT 'bottom';
    ALTER TABLE overlay_drafts ADD COLUMN IF NOT EXISTS title_scale TEXT NOT NULL DEFAULT 'balanced';
    ALTER TABLE overlay_drafts ADD COLUMN IF NOT EXISTS show_current_category BOOLEAN NOT NULL DEFAULT TRUE;
    ALTER TABLE overlay_drafts ADD COLUMN IF NOT EXISTS show_source_label BOOLEAN NOT NULL DEFAULT TRUE;
    ALTER TABLE overlay_drafts ADD COLUMN IF NOT EXISTS show_queue_preview BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE overlay_drafts ADD COLUMN IF NOT EXISTS queue_preview_count INTEGER NOT NULL DEFAULT 3;
    ALTER TABLE overlay_drafts ADD COLUMN IF NOT EXISTS layer_order_json TEXT NOT NULL DEFAULT '[]';
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
    ALTER TABLE pools ADD COLUMN IF NOT EXISTS insert_asset_id TEXT NOT NULL DEFAULT '';
    ALTER TABLE pools ADD COLUMN IF NOT EXISTS insert_every_items INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE pools ADD COLUMN IF NOT EXISTS items_since_insert INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE sources ADD COLUMN IF NOT EXISTS enabled BOOLEAN NOT NULL DEFAULT TRUE;
    ALTER TABLE assets ADD COLUMN IF NOT EXISTS external_id TEXT NOT NULL DEFAULT '';
    ALTER TABLE assets ADD COLUMN IF NOT EXISTS category_name TEXT NOT NULL DEFAULT '';
    ALTER TABLE assets ADD COLUMN IF NOT EXISTS duration_seconds INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE assets ADD COLUMN IF NOT EXISTS published_at TEXT NOT NULL DEFAULT '';
    ALTER TABLE playout_runtime ADD COLUMN IF NOT EXISTS desired_asset_id TEXT NOT NULL DEFAULT '';
    ALTER TABLE playout_runtime ADD COLUMN IF NOT EXISTS transition_state TEXT NOT NULL DEFAULT 'idle';
    ALTER TABLE playout_runtime ADD COLUMN IF NOT EXISTS transition_target_kind TEXT NOT NULL DEFAULT '';
    ALTER TABLE playout_runtime ADD COLUMN IF NOT EXISTS transition_target_asset_id TEXT NOT NULL DEFAULT '';
    ALTER TABLE playout_runtime ADD COLUMN IF NOT EXISTS transition_target_title TEXT NOT NULL DEFAULT '';
    ALTER TABLE playout_runtime ADD COLUMN IF NOT EXISTS transition_ready_at TEXT NOT NULL DEFAULT '';
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
    ALTER TABLE playout_runtime ADD COLUMN IF NOT EXISTS insert_asset_id TEXT NOT NULL DEFAULT '';
    ALTER TABLE playout_runtime ADD COLUMN IF NOT EXISTS insert_requested_at TEXT NOT NULL DEFAULT '';
    ALTER TABLE playout_runtime ADD COLUMN IF NOT EXISTS insert_status TEXT NOT NULL DEFAULT '';
    ALTER TABLE playout_runtime ADD COLUMN IF NOT EXISTS skip_asset_id TEXT NOT NULL DEFAULT '';
    ALTER TABLE playout_runtime ADD COLUMN IF NOT EXISTS skip_until TEXT NOT NULL DEFAULT '';
    ALTER TABLE playout_runtime ADD COLUMN IF NOT EXISTS pending_action TEXT NOT NULL DEFAULT '';
    ALTER TABLE playout_runtime ADD COLUMN IF NOT EXISTS pending_action_requested_at TEXT NOT NULL DEFAULT '';
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
  const result = await client.query<{ count: string }>("SELECT COUNT(*) AS count FROM users");
  return Number(result.rows[0]?.count ?? "0") === 0;
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
          singleton_id, enabled, channel_name, headline, replay_label, brand_badge, scene_preset, accent_color, surface_style, panel_anchor, title_scale, show_clock, show_next_item, show_schedule_teaser, show_current_category, show_source_label, show_queue_preview, queue_preview_count, layer_order_json, emergency_banner, ticker_text, updated_at
        )
        VALUES (1, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
        ON CONFLICT (singleton_id) DO UPDATE SET
          enabled = EXCLUDED.enabled,
          channel_name = EXCLUDED.channel_name,
          headline = EXCLUDED.headline,
          replay_label = EXCLUDED.replay_label,
          brand_badge = EXCLUDED.brand_badge,
          scene_preset = EXCLUDED.scene_preset,
          accent_color = EXCLUDED.accent_color,
          surface_style = EXCLUDED.surface_style,
          panel_anchor = EXCLUDED.panel_anchor,
          title_scale = EXCLUDED.title_scale,
          show_clock = EXCLUDED.show_clock,
          show_next_item = EXCLUDED.show_next_item,
          show_schedule_teaser = EXCLUDED.show_schedule_teaser,
          show_current_category = EXCLUDED.show_current_category,
          show_source_label = EXCLUDED.show_source_label,
          show_queue_preview = EXCLUDED.show_queue_preview,
          queue_preview_count = EXCLUDED.queue_preview_count,
          layer_order_json = EXCLUDED.layer_order_json,
          emergency_banner = EXCLUDED.emergency_banner,
          ticker_text = EXCLUDED.ticker_text,
          updated_at = EXCLUDED.updated_at
      `,
      [
        next.overlay.enabled,
        next.overlay.channelName,
        next.overlay.headline,
        next.overlay.replayLabel,
        next.overlay.brandBadge,
        next.overlay.scenePreset,
        next.overlay.accentColor,
        next.overlay.surfaceStyle,
        next.overlay.panelAnchor,
        next.overlay.titleScale,
        next.overlay.showClock,
        next.overlay.showNextItem,
        next.overlay.showScheduleTeaser,
        next.overlay.showCurrentCategory,
        next.overlay.showSourceLabel,
        next.overlay.showQueuePreview,
        next.overlay.queuePreviewCount,
        JSON.stringify(next.overlay.layerOrder),
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
      INSERT INTO twitch_connection (
        singleton_id, status, broadcaster_id, broadcaster_login, access_token, refresh_token, connected_at, token_expires_at,
        last_refresh_at, last_metadata_sync_at, last_synced_title, last_synced_category_name, last_synced_category_id, last_schedule_sync_at, error
      )
      VALUES (1, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
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
      next.twitch.error
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
          id, email, display_name, auth_provider, role, twitch_user_id, twitch_login, password_hash, created_at, last_login_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
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
        INSERT INTO presence_windows (actor, minutes, created_at, expires_at)
        VALUES ($1, $2, $3, $4)
      `,
      [window.actor, window.minutes, window.createdAt, window.expiresAt]
    );
  }

  await client.query("DELETE FROM schedule_blocks");
  for (const block of next.scheduleBlocks) {
    await client.query(
      `
        INSERT INTO schedule_blocks (
          id, title, category_name, start_hour, start_minute_of_day, duration_minutes, day_of_week, show_id, pool_id, source_name
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
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
        block.sourceName
      ]
    );
  }

  await client.query("DELETE FROM pools");
  for (const pool of next.pools) {
    await client.query(
      `
        INSERT INTO pools (id, name, source_ids, playback_mode, cursor_asset_id, insert_asset_id, insert_every_items, items_since_insert, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
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
          id, source_id, title, path, status, external_id, category_name, duration_seconds, published_at,
          fallback_priority, is_global_fallback, created_at, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      `,
      [
        asset.id,
        asset.sourceId,
        asset.title,
        asset.path,
        asset.status,
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

  await client.query("DELETE FROM stream_destinations");
  for (const destination of next.destinations) {
    await client.query(
      `
        INSERT INTO stream_destinations (
          id, provider, name, enabled, rtmp_url, stream_key_present, status, notes, last_validated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `,
      [
        destination.id,
        destination.provider,
        destination.name,
        destination.enabled,
        destination.rtmpUrl,
        destination.streamKeyPresent,
        destination.status,
        destination.notes,
        destination.lastValidatedAt
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
  for (const event of next.auditEvents.slice(0, 100)) {
    await client.query(
      `
        INSERT INTO audit_events (id, type, message, created_at)
        VALUES ($1, $2, $3, $4)
      `,
      [event.id, event.type, event.message, event.createdAt]
    );
  }
}

async function persistPlayoutRuntime(client: PoolClient, playout: PlayoutRuntimeRecord): Promise<void> {
  await client.query(
    `
      INSERT INTO playout_runtime (
        singleton_id, status, transition_state, transition_target_kind, transition_target_asset_id, transition_target_title, transition_ready_at,
        current_asset_id, current_title, desired_asset_id, next_asset_id, next_title, queued_asset_ids, queue_items, prefetched_asset_id,
        prefetched_title, prefetched_at, prefetch_status, prefetch_error, current_destination_id, restart_requested_at, heartbeat_at, process_pid,
        process_started_at, last_transition_at, last_successful_start_at, last_successful_asset_id, last_exit_code, restart_count,
        crash_count_window, crash_loop_detected, last_error, last_stderr_sample, selection_reason_code, fallback_tier, override_mode,
        override_asset_id, override_until, insert_asset_id, insert_requested_at, insert_status, skip_asset_id, skip_until, pending_action,
        pending_action_requested_at, message
      )
      VALUES (1, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, $34, $35, $36, $37, $38, $39, $40, $41, $42, $43, $44, $45)
      ON CONFLICT (singleton_id) DO UPDATE SET
        status = EXCLUDED.status,
        transition_state = EXCLUDED.transition_state,
        transition_target_kind = EXCLUDED.transition_target_kind,
        transition_target_asset_id = EXCLUDED.transition_target_asset_id,
        transition_target_title = EXCLUDED.transition_target_title,
        transition_ready_at = EXCLUDED.transition_ready_at,
        current_asset_id = EXCLUDED.current_asset_id,
        current_title = EXCLUDED.current_title,
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
        insert_asset_id = EXCLUDED.insert_asset_id,
        insert_requested_at = EXCLUDED.insert_requested_at,
        insert_status = EXCLUDED.insert_status,
        skip_asset_id = EXCLUDED.skip_asset_id,
        skip_until = EXCLUDED.skip_until,
        pending_action = EXCLUDED.pending_action,
        pending_action_requested_at = EXCLUDED.pending_action_requested_at,
        message = EXCLUDED.message
    `,
    [
      playout.status,
      playout.transitionState,
      playout.transitionTargetKind,
      playout.transitionTargetAssetId,
      playout.transitionTargetTitle,
      playout.transitionReadyAt,
      playout.currentAssetId,
      playout.currentTitle,
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
      playout.insertAssetId,
      playout.insertRequestedAt,
      playout.insertStatus,
      playout.skipAssetId,
      playout.skipUntil,
      playout.pendingAction,
      playout.pendingActionRequestedAt,
      playout.message
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
  const presenceResult = await client.query<{ actor: string; minutes: number; created_at: string; expires_at: string }>(
    "SELECT * FROM presence_windows ORDER BY created_at DESC"
  );
  const overlayResult = await client.query<OverlaySettingsRow>("SELECT * FROM overlay_settings WHERE singleton_id = 1");
  const managedConfigResult = await client.query<{
    encrypted_payload: string;
    updated_at: string;
  }>("SELECT * FROM managed_config WHERE singleton_id = 1");
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
    error: string;
  }>("SELECT * FROM twitch_connection WHERE singleton_id = 1");
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
  }>("SELECT * FROM schedule_blocks ORDER BY start_minute_of_day ASC, start_hour ASC");
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
    status: AssetRecord["status"];
    external_id: string;
    category_name: string;
    duration_seconds: number;
    published_at: string;
    fallback_priority: number;
    is_global_fallback: boolean;
    created_at: string;
    updated_at: string;
  }>("SELECT * FROM assets ORDER BY updated_at DESC");
  const destinationsResult = await client.query<{
    id: string;
    provider: StreamDestinationRecord["provider"];
    name: string;
    enabled: boolean;
    rtmp_url: string;
    stream_key_present: boolean;
    status: StreamDestinationRecord["status"];
    notes: string;
    last_validated_at: string;
  }>("SELECT * FROM stream_destinations ORDER BY name ASC");
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
    "SELECT * FROM audit_events ORDER BY created_at DESC LIMIT 100"
  );
  const playoutResult = await client.query<{
    status: PlayoutRuntimeRecord["status"];
    transition_state: PlayoutRuntimeRecord["transitionState"];
    transition_target_kind: PlayoutRuntimeRecord["transitionTargetKind"];
    transition_target_asset_id: string;
    transition_target_title: string;
    transition_ready_at: string;
    current_asset_id: string;
    current_title: string;
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
    insert_asset_id: string;
    insert_requested_at: string;
    insert_status: PlayoutRuntimeRecord["insertStatus"];
    skip_asset_id: string;
    skip_until: string;
    pending_action: PlayoutRuntimeRecord["pendingAction"];
    pending_action_requested_at: string;
    message: string;
  }>("SELECT * FROM playout_runtime WHERE singleton_id = 1");

  const defaults = defaultState();
  const systemRow = systemResult.rows[0];
  const moderationRow = moderationResult.rows[0];
  const overlayRow = overlayResult.rows[0];
  const managedConfigRow = managedConfigResult.rows[0];
  const twitchRow = twitchResult.rows[0];
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
      minutes: row.minutes,
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
          error: twitchRow.error
        }
      : defaults.twitch,
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
      sourceName: row.source_name
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
      status: row.status,
      externalId: row.external_id || undefined,
      categoryName: row.category_name || undefined,
      durationSeconds: row.duration_seconds || undefined,
      publishedAt: row.published_at || undefined,
      fallbackPriority: row.fallback_priority,
      isGlobalFallback: row.is_global_fallback,
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
    destinations: destinationsResult.rows.map((row) => ({
      id: row.id,
      provider: row.provider,
      name: row.name,
      enabled: row.enabled,
      rtmpUrl: row.rtmp_url,
      streamKeyPresent: row.stream_key_present,
      status: row.status,
      notes: row.notes,
      lastValidatedAt: row.last_validated_at
    })),
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
          transitionTargetKind: playoutRow.transition_target_kind || "",
          transitionTargetAssetId: playoutRow.transition_target_asset_id,
          transitionTargetTitle: playoutRow.transition_target_title,
          transitionReadyAt: playoutRow.transition_ready_at,
          currentAssetId: playoutRow.current_asset_id,
          currentTitle: playoutRow.current_title,
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
          insertAssetId: playoutRow.insert_asset_id,
          insertRequestedAt: playoutRow.insert_requested_at,
          insertStatus: playoutRow.insert_status,
          skipAssetId: playoutRow.skip_asset_id,
          skipUntil: playoutRow.skip_until,
          pendingAction: (playoutRow.pending_action as PlayoutRuntimeRecord["pendingAction"]) || "",
          pendingActionRequestedAt: playoutRow.pending_action_requested_at || "",
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

export async function resetDatabaseConnectionsForTests(): Promise<void> {
  if (globalThis.__stream247Pool) {
    await globalThis.__stream247Pool.end();
  }

  globalThis.__stream247Pool = undefined;
  globalThis.__stream247DbReady = undefined;
}

export async function writeAppState(state: AppState): Promise<void> {
  await withSerializedStateWrite("writeAppState", async (client) => {
    await persistState(client, state);
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
    await client.query(`
      DELETE FROM audit_events
      WHERE id IN (
        SELECT id FROM audit_events
        ORDER BY created_at DESC
        OFFSET 100
      )
    `);
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

export async function replaceAssetsForSourceIds(sourceIds: string[], assets: AssetRecord[]): Promise<void> {
  if (sourceIds.length === 0) {
    return;
  }

  await withSerializedStateWrite("replaceAssetsForSourceIds", async (client) => {
    await client.query("DELETE FROM assets WHERE source_id = ANY($1::text[])", [sourceIds]);

    for (const asset of assets) {
      await client.query(
        `
          INSERT INTO assets (
            id, source_id, title, path, status, external_id, category_name, duration_seconds, published_at,
            fallback_priority, is_global_fallback, created_at, updated_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        `,
        [
          asset.id,
          asset.sourceId,
          asset.title,
          asset.path,
          asset.status,
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

export async function updateDestinationRecord(destination: StreamDestinationRecord): Promise<void> {
  await withSerializedStateWrite("updateDestinationRecord", async (client) => {
    await client.query(
      `
        UPDATE stream_destinations
        SET provider = $2,
            name = $3,
            enabled = $4,
            rtmp_url = $5,
            stream_key_present = $6,
            status = $7,
            notes = $8,
            last_validated_at = $9
        WHERE id = $1
      `,
      [
        destination.id,
        destination.provider,
        destination.name,
        destination.enabled,
        destination.rtmpUrl,
        destination.streamKeyPresent,
        destination.status,
        destination.notes,
        destination.lastValidatedAt
      ]
    );
  });
}

export async function updateTwitchConnectionRecord(twitch: TwitchConnection): Promise<void> {
  await withSerializedStateWrite("updateTwitchConnectionRecord", async (client) => {
    await client.query(
      `
        INSERT INTO twitch_connection (
          singleton_id, status, broadcaster_id, broadcaster_login, access_token, refresh_token, connected_at, token_expires_at,
          last_refresh_at, last_metadata_sync_at, last_synced_title, last_synced_category_name, last_synced_category_id, last_schedule_sync_at, error
        )
        VALUES (1, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
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
        twitch.error
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
          id, email, display_name, auth_provider, role, twitch_user_id, twitch_login, password_hash, created_at, last_login_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (id) DO UPDATE SET
          email = EXCLUDED.email,
          display_name = EXCLUDED.display_name,
          auth_provider = EXCLUDED.auth_provider,
          role = EXCLUDED.role,
          twitch_user_id = EXCLUDED.twitch_user_id,
          twitch_login = EXCLUDED.twitch_login,
          password_hash = EXCLUDED.password_hash,
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
    await client.query("DELETE FROM presence_windows WHERE expires_at <= $1", [new Date().toISOString()]);
    await client.query(
      `
        INSERT INTO presence_windows (actor, minutes, created_at, expires_at)
        VALUES ($1, $2, $3, $4)
      `,
      [window.actor, window.minutes, window.createdAt, window.expiresAt]
    );
  });
}

export async function createScheduleBlocks(blocks: ScheduleBlockRecord[]): Promise<void> {
  if (blocks.length === 0) {
    return;
  }

  await withSerializedStateWrite("createScheduleBlocks", async (client) => {
    for (const block of blocks) {
      await client.query(
        `
          INSERT INTO schedule_blocks (
            id, title, category_name, start_hour, start_minute_of_day, duration_minutes, day_of_week, show_id, pool_id, source_name
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
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
          block.sourceName
        ]
      );
    }
  });
}

export async function replaceAllScheduleBlocks(blocks: ScheduleBlockRecord[]): Promise<void> {
  await withSerializedStateWrite("replaceAllScheduleBlocks", async (client) => {
    await client.query("DELETE FROM schedule_blocks");

    for (const block of blocks) {
      await client.query(
        `
          INSERT INTO schedule_blocks (
            id, title, category_name, start_hour, start_minute_of_day, duration_minutes, day_of_week, show_id, pool_id, source_name
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
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
          block.sourceName
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
            source_name = $10
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
        block.sourceName
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
          id, name, source_ids, playback_mode, cursor_asset_id, insert_asset_id, insert_every_items, items_since_insert, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `,
      [
        pool.id,
        pool.name,
        JSON.stringify(pool.sourceIds),
        pool.playbackMode,
        pool.cursorAssetId,
        pool.insertAssetId,
        pool.insertEveryItems,
        pool.itemsSinceInsert,
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
            updated_at = $9
        WHERE id = $1
      `,
      [
        pool.id,
        pool.name,
        JSON.stringify(pool.sourceIds),
        pool.playbackMode,
        pool.cursorAssetId,
        pool.insertAssetId,
        pool.insertEveryItems,
        pool.itemsSinceInsert,
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
        [args.fingerprint, args.scope, args.severity, args.title, args.message, now]
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
      [createId("incident"), args.scope, args.severity, args.title, args.message, args.fingerprint, now]
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
