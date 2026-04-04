import { promises as fs } from "node:fs";
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import path from "node:path";
import { Pool, type PoolClient } from "pg";
import { createDefaultModerationConfig, type ModerationConfig } from "@stream247/core";

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
  accentColor: string;
  showClock: boolean;
  showNextItem: boolean;
  showScheduleTeaser: boolean;
  emergencyBanner: string;
  updatedAt: string;
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

export type PlayoutRuntimeRecord = {
  status: "idle" | "starting" | "running" | "switching" | "degraded" | "recovering" | "failed" | "standby" | "reconnecting";
  currentAssetId: string;
  currentTitle: string;
  desiredAssetId: string;
  nextAssetId: string;
  nextTitle: string;
  queuedAssetIds: string[];
  currentDestinationId: string;
  restartRequestedAt: string;
  heartbeatAt: string;
  processPid: number;
  processStartedAt: string;
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
    | "global_fallback"
    | "generic_fallback"
    | "no_asset"
    | "destination_missing"
    | "resolve_failed"
    | "ffmpeg_crash_loop"
    | "standby"
    | "scheduled_reconnect"
    | "";
  fallbackTier: "none" | "scheduled" | "operator" | "global-fallback" | "generic-fallback" | "standby";
  overrideMode: "schedule" | "asset" | "fallback";
  overrideAssetId: string;
  overrideUntil: string;
  skipAssetId: string;
  skipUntil: string;
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

const legacyStatePath = path.join(process.cwd(), "data", "app", "state.json");

declare global {
  // eslint-disable-next-line no-var
  var __stream247Pool: Pool | undefined;
  // eslint-disable-next-line no-var
  var __stream247DbReady: Promise<void> | undefined;
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
      accentColor: "#0e6d5a",
      showClock: true,
      showNextItem: true,
      showScheduleTeaser: true,
      emergencyBanner: "",
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
      currentAssetId: "",
      currentTitle: "",
      desiredAssetId: "",
      nextAssetId: "",
      nextTitle: "",
      queuedAssetIds: [],
      currentDestinationId: "destination-primary",
      restartRequestedAt: "",
      heartbeatAt: "",
      processPid: 0,
      processStartedAt: "",
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
      skipAssetId: "",
      skipUntil: "",
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
      ...(state.overlay ?? {})
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
          playbackMode: "round-robin"
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
      ...(state.playout ?? {})
    }
  };
}

async function ensureSchema(client: PoolClient): Promise<void> {
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
      accent_color TEXT NOT NULL DEFAULT '#0e6d5a',
      show_clock BOOLEAN NOT NULL DEFAULT TRUE,
      show_next_item BOOLEAN NOT NULL DEFAULT TRUE,
      show_schedule_teaser BOOLEAN NOT NULL DEFAULT TRUE,
      emergency_banner TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT ''
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
      current_asset_id TEXT NOT NULL DEFAULT '',
      current_title TEXT NOT NULL DEFAULT '',
      desired_asset_id TEXT NOT NULL DEFAULT '',
      next_asset_id TEXT NOT NULL DEFAULT '',
      next_title TEXT NOT NULL DEFAULT '',
      queued_asset_ids TEXT NOT NULL DEFAULT '[]',
      current_destination_id TEXT NOT NULL DEFAULT '',
      restart_requested_at TEXT NOT NULL DEFAULT '',
      heartbeat_at TEXT NOT NULL DEFAULT '',
      process_pid INTEGER NOT NULL DEFAULT 0,
      process_started_at TEXT NOT NULL DEFAULT '',
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
      skip_asset_id TEXT NOT NULL DEFAULT '',
      skip_until TEXT NOT NULL DEFAULT '',
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
    ALTER TABLE overlay_settings ADD COLUMN IF NOT EXISTS emergency_banner TEXT NOT NULL DEFAULT '';
    ALTER TABLE overlay_settings ADD COLUMN IF NOT EXISTS replay_label TEXT NOT NULL DEFAULT 'Replay stream';
    ALTER TABLE overlay_settings ADD COLUMN IF NOT EXISTS updated_at TEXT NOT NULL DEFAULT '';
    ALTER TABLE managed_config ADD COLUMN IF NOT EXISTS encrypted_payload TEXT NOT NULL DEFAULT '';
    ALTER TABLE managed_config ADD COLUMN IF NOT EXISTS updated_at TEXT NOT NULL DEFAULT '';
    ALTER TABLE schedule_blocks ADD COLUMN IF NOT EXISTS start_minute_of_day INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE schedule_blocks ADD COLUMN IF NOT EXISTS day_of_week INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE schedule_blocks ADD COLUMN IF NOT EXISTS show_id TEXT NOT NULL DEFAULT '';
    ALTER TABLE schedule_blocks ADD COLUMN IF NOT EXISTS pool_id TEXT NOT NULL DEFAULT '';
    ALTER TABLE sources ADD COLUMN IF NOT EXISTS enabled BOOLEAN NOT NULL DEFAULT TRUE;
    ALTER TABLE assets ADD COLUMN IF NOT EXISTS external_id TEXT NOT NULL DEFAULT '';
    ALTER TABLE assets ADD COLUMN IF NOT EXISTS category_name TEXT NOT NULL DEFAULT '';
    ALTER TABLE assets ADD COLUMN IF NOT EXISTS duration_seconds INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE assets ADD COLUMN IF NOT EXISTS published_at TEXT NOT NULL DEFAULT '';
    ALTER TABLE playout_runtime ADD COLUMN IF NOT EXISTS desired_asset_id TEXT NOT NULL DEFAULT '';
    ALTER TABLE playout_runtime ADD COLUMN IF NOT EXISTS next_asset_id TEXT NOT NULL DEFAULT '';
    ALTER TABLE playout_runtime ADD COLUMN IF NOT EXISTS next_title TEXT NOT NULL DEFAULT '';
    ALTER TABLE playout_runtime ADD COLUMN IF NOT EXISTS queued_asset_ids TEXT NOT NULL DEFAULT '[]';
    ALTER TABLE playout_runtime ADD COLUMN IF NOT EXISTS current_destination_id TEXT NOT NULL DEFAULT '';
    ALTER TABLE playout_runtime ADD COLUMN IF NOT EXISTS restart_requested_at TEXT NOT NULL DEFAULT '';
    ALTER TABLE playout_runtime ADD COLUMN IF NOT EXISTS process_pid INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE playout_runtime ADD COLUMN IF NOT EXISTS process_started_at TEXT NOT NULL DEFAULT '';
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
    ALTER TABLE playout_runtime ADD COLUMN IF NOT EXISTS skip_asset_id TEXT NOT NULL DEFAULT '';
    ALTER TABLE playout_runtime ADD COLUMN IF NOT EXISTS skip_until TEXT NOT NULL DEFAULT '';
  `);

  await client.query(`
    UPDATE schedule_blocks
    SET start_minute_of_day = start_hour * 60
    WHERE start_minute_of_day = 0 AND start_hour <> 0
  `);
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
        singleton_id, enabled, channel_name, headline, accent_color, show_clock, show_next_item, show_schedule_teaser, emergency_banner, replay_label, updated_at
      )
      VALUES (1, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT (singleton_id) DO UPDATE SET
        enabled = EXCLUDED.enabled,
        channel_name = EXCLUDED.channel_name,
        headline = EXCLUDED.headline,
        accent_color = EXCLUDED.accent_color,
        show_clock = EXCLUDED.show_clock,
        show_next_item = EXCLUDED.show_next_item,
        show_schedule_teaser = EXCLUDED.show_schedule_teaser,
        emergency_banner = EXCLUDED.emergency_banner,
        replay_label = EXCLUDED.replay_label,
        updated_at = EXCLUDED.updated_at
    `,
    [
      next.overlay.enabled,
      next.overlay.channelName,
      next.overlay.headline,
      next.overlay.accentColor,
      next.overlay.showClock,
      next.overlay.showNextItem,
      next.overlay.showScheduleTeaser,
      next.overlay.emergencyBanner,
      next.overlay.replayLabel,
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

  await client.query(
    `
      INSERT INTO playout_runtime (
        singleton_id, status, current_asset_id, current_title, desired_asset_id, next_asset_id, next_title, queued_asset_ids, current_destination_id, restart_requested_at,
        heartbeat_at, process_pid, process_started_at, last_successful_start_at, last_successful_asset_id, last_exit_code, restart_count,
        crash_count_window, crash_loop_detected, last_error, last_stderr_sample, selection_reason_code, fallback_tier, override_mode,
        override_asset_id, override_until, skip_asset_id, skip_until, message
      )
      VALUES (1, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28)
      ON CONFLICT (singleton_id) DO UPDATE SET
        status = EXCLUDED.status,
        current_asset_id = EXCLUDED.current_asset_id,
        current_title = EXCLUDED.current_title,
        desired_asset_id = EXCLUDED.desired_asset_id,
        next_asset_id = EXCLUDED.next_asset_id,
        next_title = EXCLUDED.next_title,
        queued_asset_ids = EXCLUDED.queued_asset_ids,
        current_destination_id = EXCLUDED.current_destination_id,
        restart_requested_at = EXCLUDED.restart_requested_at,
        heartbeat_at = EXCLUDED.heartbeat_at,
        process_pid = EXCLUDED.process_pid,
        process_started_at = EXCLUDED.process_started_at,
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
        skip_asset_id = EXCLUDED.skip_asset_id,
        skip_until = EXCLUDED.skip_until,
        message = EXCLUDED.message
    `,
    [
      next.playout.status,
      next.playout.currentAssetId,
      next.playout.currentTitle,
      next.playout.desiredAssetId,
      next.playout.nextAssetId,
      next.playout.nextTitle,
      JSON.stringify(next.playout.queuedAssetIds ?? []),
      next.playout.currentDestinationId,
      next.playout.restartRequestedAt,
      next.playout.heartbeatAt,
      next.playout.processPid,
      next.playout.processStartedAt,
      next.playout.lastSuccessfulStartAt,
      next.playout.lastSuccessfulAssetId,
      next.playout.lastExitCode,
      next.playout.restartCount,
      next.playout.crashCountWindow,
      next.playout.crashLoopDetected,
      next.playout.lastError,
      next.playout.lastStderrSample,
      next.playout.selectionReasonCode,
      next.playout.fallbackTier,
      next.playout.overrideMode,
      next.playout.overrideAssetId,
      next.playout.overrideUntil,
      next.playout.skipAssetId,
      next.playout.skipUntil,
      next.playout.message
    ]
  );

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
        INSERT INTO pools (id, name, source_ids, playback_mode, cursor_asset_id, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6)
      `,
      [pool.id, pool.name, JSON.stringify(pool.sourceIds), pool.playbackMode, pool.cursorAssetId ?? "", pool.updatedAt]
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
  const overlayResult = await client.query<{
    enabled: boolean;
    channel_name: string;
    headline: string;
    accent_color: string;
    show_clock: boolean;
    show_next_item: boolean;
    show_schedule_teaser: boolean;
    emergency_banner: string;
    replay_label: string;
    updated_at: string;
  }>("SELECT * FROM overlay_settings WHERE singleton_id = 1");
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
    current_asset_id: string;
    current_title: string;
    desired_asset_id: string;
    next_asset_id: string;
    next_title: string;
    queued_asset_ids: string;
    current_destination_id: string;
    restart_requested_at: string;
    heartbeat_at: string;
    process_pid: number;
    process_started_at: string;
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
    skip_asset_id: string;
    skip_until: string;
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
    overlay: overlayRow
      ? {
          enabled: overlayRow.enabled,
          channelName: overlayRow.channel_name,
          headline: overlayRow.headline,
          accentColor: overlayRow.accent_color,
          showClock: overlayRow.show_clock,
          showNextItem: overlayRow.show_next_item,
          showScheduleTeaser: overlayRow.show_schedule_teaser,
          emergencyBanner: overlayRow.emergency_banner,
          replayLabel: overlayRow.replay_label,
          updatedAt: overlayRow.updated_at
        }
      : defaults.overlay,
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
          currentAssetId: playoutRow.current_asset_id,
          currentTitle: playoutRow.current_title,
          desiredAssetId: playoutRow.desired_asset_id,
          nextAssetId: playoutRow.next_asset_id,
          nextTitle: playoutRow.next_title,
          queuedAssetIds: JSON.parse(playoutRow.queued_asset_ids || "[]") as string[],
          currentDestinationId: playoutRow.current_destination_id,
          restartRequestedAt: playoutRow.restart_requested_at,
          heartbeatAt: playoutRow.heartbeat_at,
          processPid: playoutRow.process_pid,
          processStartedAt: playoutRow.process_started_at,
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
          skipAssetId: playoutRow.skip_asset_id,
          skipUntil: playoutRow.skip_until,
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
        await ensureSchema(client);
        const empty = await isDatabaseEmpty(client);
        if (empty) {
          const legacy = await readLegacyState();
          await persistState(client, legacy ?? createInitialSeedState());
        }
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

export async function writeAppState(state: AppState): Promise<void> {
  await ensureDatabase();
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await persistState(client, state);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function updateAppState(updater: (state: AppState) => AppState | Promise<AppState>): Promise<AppState> {
  await ensureDatabase();
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const current = await hydrateState(client);
    const next = normalizeState(await updater(current));
    await persistState(client, next);
    await client.query("COMMIT");
    return next;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function appendAuditEvent(type: string, message: string): Promise<void> {
  await updateAppState((state) => ({
    ...state,
    auditEvents: [
      {
        id: createId("audit"),
        type,
        message,
        createdAt: new Date().toISOString()
      },
      ...state.auditEvents
    ].slice(0, 100)
  }));
}

export async function upsertIncident(args: {
  scope: IncidentRecord["scope"];
  severity: IncidentRecord["severity"];
  title: string;
  message: string;
  fingerprint: string;
}): Promise<void> {
  await updateAppState((state) => {
    const existing = state.incidents.find((incident) => incident.fingerprint === args.fingerprint);
    const now = new Date().toISOString();
    const nextIncident: IncidentRecord = existing
      ? {
          ...existing,
          severity: args.severity,
          status: "open",
          acknowledgedAt: "",
          acknowledgedBy: "",
          title: args.title,
          message: args.message,
          updatedAt: now,
          resolvedAt: ""
        }
      : {
          id: createId("incident"),
          scope: args.scope,
          severity: args.severity,
          status: "open",
          acknowledgedAt: "",
          acknowledgedBy: "",
          title: args.title,
          message: args.message,
          fingerprint: args.fingerprint,
          createdAt: now,
          updatedAt: now,
          resolvedAt: ""
        };

    return {
      ...state,
      incidents: existing
        ? state.incidents.map((incident) => (incident.id === existing.id ? nextIncident : incident))
        : [nextIncident, ...state.incidents].slice(0, 100)
    };
  });
}

export async function resolveIncident(fingerprint: string, resolutionMessage?: string): Promise<void> {
  await updateAppState((state) => ({
    ...state,
    incidents: state.incidents.map((incident) =>
      incident.fingerprint === fingerprint && incident.status === "open"
        ? {
            ...incident,
            status: "resolved",
            message: resolutionMessage || incident.message,
            updatedAt: new Date().toISOString(),
            resolvedAt: new Date().toISOString()
          }
        : incident
    )
  }));
}

export async function acknowledgeIncident(fingerprint: string, acknowledgedBy: string): Promise<void> {
  await updateAppState((state) => ({
    ...state,
    incidents: state.incidents.map((incident) =>
      incident.fingerprint === fingerprint && incident.status === "open"
        ? {
            ...incident,
            acknowledgedAt: new Date().toISOString(),
            acknowledgedBy,
            updatedAt: new Date().toISOString()
          }
        : incident
    )
  }));
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
