import { promises as fs } from "node:fs";
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
  error: string;
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
  status: string;
  lastSyncedAt?: string;
};

export type AssetRecord = {
  id: string;
  sourceId: string;
  title: string;
  path: string;
  status: "ready" | "pending" | "error";
  createdAt: string;
  updatedAt: string;
};

export type IncidentRecord = {
  id: string;
  scope: "worker" | "playout" | "twitch" | "source" | "system";
  severity: "info" | "warning" | "critical";
  status: "open" | "resolved";
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
  startHour: number;
  durationMinutes: number;
  sourceName: string;
};

export type PlayoutRuntimeRecord = {
  status: "idle" | "running" | "degraded";
  currentAssetId: string;
  currentTitle: string;
  heartbeatAt: string;
  message: string;
};

export type AppState = {
  initialized: boolean;
  owner: OwnerAccount | null;
  users: UserRecord[];
  teamAccessGrants: TeamAccessGrant[];
  moderation: ModerationConfig;
  presenceWindows: ModeratorPresenceWindowRecord[];
  twitch: TwitchConnection;
  scheduleBlocks: ScheduleBlockRecord[];
  sources: SourceRecord[];
  assets: AssetRecord[];
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

function defaultState(): AppState {
  return {
    initialized: false,
    owner: null,
    users: [],
    teamAccessGrants: [],
    moderation: createDefaultModerationConfig(),
    presenceWindows: [],
    twitch: {
      status: "not-connected",
      broadcasterId: "",
      broadcasterLogin: "",
      accessToken: "",
      refreshToken: "",
      connectedAt: "",
      error: ""
    },
    scheduleBlocks: [
      {
        id: "morning-vods",
        title: "Morning Twitch VOD Rotation",
        categoryName: "Just Chatting",
        startHour: 6,
        durationMinutes: 240,
        sourceName: "Twitch Archive"
      },
      {
        id: "playlist-prime",
        title: "Prime Time YouTube Playlist",
        categoryName: "Music",
        startHour: 18,
        durationMinutes: 360,
        sourceName: "YouTube Playlist"
      }
    ],
    sources: [
      { id: "source-youtube", name: "YouTube Playlist", type: "Managed ingestion", status: "Planned" },
      { id: "source-twitch", name: "Twitch Archive", type: "Twitch VOD sync", status: "Planned" },
      { id: "source-local-library", name: "Local Media Library", type: "Filesystem scan", status: "Pending scan" }
    ],
    assets: [],
    incidents: [],
    auditEvents: [],
    playout: {
      status: "idle",
      currentAssetId: "",
      currentTitle: "",
      heartbeatAt: "",
      message: "Playout engine has not started yet."
    }
  };
}

function normalizeState(state: AppState): AppState {
  const defaults = defaultState();
  const localOwnerUser = state.users.find((user) => user.role === "owner" && user.authProvider === "local");

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
    twitch: {
      ...defaults.twitch,
      ...(state.twitch ?? {})
    },
    users: Array.isArray(state.users) ? state.users : [],
    teamAccessGrants: Array.isArray(state.teamAccessGrants) ? state.teamAccessGrants : [],
    presenceWindows: Array.isArray(state.presenceWindows) ? state.presenceWindows : [],
    scheduleBlocks: Array.isArray(state.scheduleBlocks) ? state.scheduleBlocks : defaults.scheduleBlocks,
    sources: Array.isArray(state.sources) ? state.sources : defaults.sources,
    assets: Array.isArray(state.assets) ? state.assets : [],
    incidents: Array.isArray(state.incidents) ? state.incidents : [],
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

    CREATE TABLE IF NOT EXISTS twitch_connection (
      singleton_id SMALLINT PRIMARY KEY DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'not-connected',
      broadcaster_id TEXT NOT NULL DEFAULT '',
      broadcaster_login TEXT NOT NULL DEFAULT '',
      access_token TEXT NOT NULL DEFAULT '',
      refresh_token TEXT NOT NULL DEFAULT '',
      connected_at TEXT NOT NULL DEFAULT '',
      error TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS schedule_blocks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      category_name TEXT NOT NULL,
      start_hour INTEGER NOT NULL,
      duration_minutes INTEGER NOT NULL,
      source_name TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sources (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      status TEXT NOT NULL,
      last_synced_at TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS assets (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL,
      title TEXT NOT NULL,
      path TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS incidents (
      id TEXT PRIMARY KEY,
      scope TEXT NOT NULL,
      severity TEXT NOT NULL,
      status TEXT NOT NULL,
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
      heartbeat_at TEXT NOT NULL DEFAULT '',
      message TEXT NOT NULL DEFAULT 'Playout engine has not started yet.'
    );
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
      INSERT INTO twitch_connection (
        singleton_id, status, broadcaster_id, broadcaster_login, access_token, refresh_token, connected_at, error
      )
      VALUES (1, $1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (singleton_id) DO UPDATE SET
        status = EXCLUDED.status,
        broadcaster_id = EXCLUDED.broadcaster_id,
        broadcaster_login = EXCLUDED.broadcaster_login,
        access_token = EXCLUDED.access_token,
        refresh_token = EXCLUDED.refresh_token,
        connected_at = EXCLUDED.connected_at,
        error = EXCLUDED.error
    `,
    [
      next.twitch.status,
      next.twitch.broadcasterId,
      next.twitch.broadcasterLogin,
      next.twitch.accessToken,
      next.twitch.refreshToken,
      next.twitch.connectedAt,
      next.twitch.error
    ]
  );

  await client.query(
    `
      INSERT INTO playout_runtime (singleton_id, status, current_asset_id, current_title, heartbeat_at, message)
      VALUES (1, $1, $2, $3, $4, $5)
      ON CONFLICT (singleton_id) DO UPDATE SET
        status = EXCLUDED.status,
        current_asset_id = EXCLUDED.current_asset_id,
        current_title = EXCLUDED.current_title,
        heartbeat_at = EXCLUDED.heartbeat_at,
        message = EXCLUDED.message
    `,
    [
      next.playout.status,
      next.playout.currentAssetId,
      next.playout.currentTitle,
      next.playout.heartbeatAt,
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
        INSERT INTO schedule_blocks (id, title, category_name, start_hour, duration_minutes, source_name)
        VALUES ($1, $2, $3, $4, $5, $6)
      `,
      [block.id, block.title, block.categoryName, block.startHour, block.durationMinutes, block.sourceName]
    );
  }

  await client.query("DELETE FROM sources");
  for (const source of next.sources) {
    await client.query(
      `
        INSERT INTO sources (id, name, type, status, last_synced_at)
        VALUES ($1, $2, $3, $4, $5)
      `,
      [source.id, source.name, source.type, source.status, source.lastSyncedAt ?? ""]
    );
  }

  await client.query("DELETE FROM assets");
  for (const asset of next.assets) {
    await client.query(
      `
        INSERT INTO assets (id, source_id, title, path, status, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `,
      [asset.id, asset.sourceId, asset.title, asset.path, asset.status, asset.createdAt, asset.updatedAt]
    );
  }

  await client.query("DELETE FROM incidents");
  for (const incident of next.incidents) {
    await client.query(
      `
        INSERT INTO incidents (
          id, scope, severity, status, title, message, fingerprint, created_at, updated_at, resolved_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      `,
      [
        incident.id,
        incident.scope,
        incident.severity,
        incident.status,
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
  const twitchResult = await client.query<{
    status: TwitchConnection["status"];
    broadcaster_id: string;
    broadcaster_login: string;
    access_token: string;
    refresh_token: string;
    connected_at: string;
    error: string;
  }>("SELECT * FROM twitch_connection WHERE singleton_id = 1");
  const blocksResult = await client.query<{
    id: string;
    title: string;
    category_name: string;
    start_hour: number;
    duration_minutes: number;
    source_name: string;
  }>("SELECT * FROM schedule_blocks ORDER BY start_hour ASC");
  const sourcesResult = await client.query<{
    id: string;
    name: string;
    type: string;
    status: string;
    last_synced_at: string;
  }>("SELECT * FROM sources ORDER BY name ASC");
  const assetsResult = await client.query<{
    id: string;
    source_id: string;
    title: string;
    path: string;
    status: AssetRecord["status"];
    created_at: string;
    updated_at: string;
  }>("SELECT * FROM assets ORDER BY updated_at DESC");
  const incidentsResult = await client.query<{
    id: string;
    scope: IncidentRecord["scope"];
    severity: IncidentRecord["severity"];
    status: IncidentRecord["status"];
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
    heartbeat_at: string;
    message: string;
  }>("SELECT * FROM playout_runtime WHERE singleton_id = 1");

  const defaults = defaultState();
  const systemRow = systemResult.rows[0];
  const moderationRow = moderationResult.rows[0];
  const twitchRow = twitchResult.rows[0];
  const playoutRow = playoutResult.rows[0];

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
    twitch: twitchRow
      ? {
          status: twitchRow.status,
          broadcasterId: twitchRow.broadcaster_id,
          broadcasterLogin: twitchRow.broadcaster_login,
          accessToken: twitchRow.access_token,
          refreshToken: twitchRow.refresh_token,
          connectedAt: twitchRow.connected_at,
          error: twitchRow.error
        }
      : defaults.twitch,
    scheduleBlocks: blocksResult.rows.map((row) => ({
      id: row.id,
      title: row.title,
      categoryName: row.category_name,
      startHour: row.start_hour,
      durationMinutes: row.duration_minutes,
      sourceName: row.source_name
    })),
    sources: sourcesResult.rows.map((row) => ({
      id: row.id,
      name: row.name,
      type: row.type,
      status: row.status,
      lastSyncedAt: row.last_synced_at || undefined
    })),
    assets: assetsResult.rows.map((row) => ({
      id: row.id,
      sourceId: row.source_id,
      title: row.title,
      path: row.path,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    })),
    incidents: incidentsResult.rows.map((row) => ({
      id: row.id,
      scope: row.scope,
      severity: row.severity,
      status: row.status,
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
          heartbeatAt: playoutRow.heartbeat_at,
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
          await persistState(client, legacy ?? defaultState());
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
