import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  applyOverlayScenePresetRecordToDraft,
  DECLARED_SCHEMA,
  readChatInteractionSettingsRecord,
  writeChatInteractionSettingsRecord,
  createPoolRecord,
  createScheduleBlocks,
  createScheduleBlocksChecked,
  replaceAllScheduleBlocks,
  updateScheduleBlockRecord,
  updateScheduleRepeatGroupRecords,
  deleteOverlayScenePresetRecord,
  ensureDatabase,
  listOverlayScenePresetRecords,
  publishOverlayDraftRecord,
  appendAuditEvent,
  appendPresenceWindowRecord,
  readAppState,
  updateAppState,
  upsertUserRecord,
  updatePlayoutRuntime,
  readPlayoutProgrammeTitles,
  playoutProgrammeRowOf,
  deleteOverlayVideoSourceRecord,
  listOverlayVideoSourceRecords,
  readChatOverlayMessagesRecord,
  readChatSkipVoteRecord,
  readManagedDestinationStreamKeys,
  readOverlayVideoSourceIngestCredentials,
  readOverlayVideoSourceUrls,
  readRelayInternalKey,
  readRelayInternalKeyIfPresent,
  upsertOverlayVideoSourceRecord,
  readOverlayStudioState,
  replaceAssetsForSourceIds,
  resetDatabaseConnectionsForTests,
  resetOverlayDraftRecord,
  saveOverlayDraftRecord,
  saveOverlayScenePresetRecord,
  updateAssetCacheRecords,
  updateAssetCurationRecords,
  updateAssetPlaybackProbeRecords,
  updateDestinationRecord,
  updateEngagementSettingsRecord,
  updateOutputSettingsRecord,
  updatePoolCursor,
  updatePoolRecord,
  updateSourceFieldRecords,
  upsertIncident,
  resolveIncident,
  appendChatViewerRequestRecord,
  closeSourceBreakerRecord,
  closeOpenAsRunRecords,
  deleteSourceRecordAndAssets,
  listAsRunRecords,
  recordAsRunEnd,
  recordAsRunStart,
  recordSourceBreakerOutcomes,
  listRecentChatViewerRequests,
  countQueuedChatViewerRequests,
  markChatViewerRequestsPlayed,
  writeAppState,
  writeChatOverlayMessagesRecord,
  writeChatSkipVoteRecord
} from "@stream247/db";
import type { AsRunRecord } from "@stream247/core";
import { decideCycleEndPendingAction, decideCycleEndRestartFlag } from "../../apps/worker/src/playout-boundary";

const execFileAsync = promisify(execFile);

type TestDatabase = {
  containerName: string;
  databaseUrl: string;
};

const persistentProgramFeedRuntimeMigrationId = "20260419_001_persistent_program_feed_runtime";
const workerHeartbeatRuntimeMigrationId = "20260901_001_worker_heartbeat_runtime";
const redactStoredSecretsMigrationId = "20260902_001_redact_stored_secrets";
const namedOverlayScenesMigrationId = "20260902_003_named_overlay_scenes";
const redactStoredSecretsAgainMigrationId = "20261002_001_redact_stored_secrets_again";
const persistentProgramFeedRuntimeColumns = [
  "uplink_status",
  "uplink_input_mode",
  "uplink_started_at",
  "uplink_heartbeat_at",
  "uplink_destination_ids",
  "uplink_restart_count",
  "uplink_unplanned_restart_count",
  "uplink_last_exit_code",
  "uplink_last_exit_reason",
  "uplink_last_exit_planned",
  "uplink_reconnect_until",
  "program_feed_status",
  "program_feed_updated_at",
  "program_feed_playlist_path",
  "program_feed_target_seconds",
  "program_feed_buffered_seconds"
].sort();
const assetCacheMetadataMigrationId = "20260424_001_asset_cache_metadata";
const assetCacheMetadataColumns = [
  "cache_path",
  "cache_status",
  "cache_updated_at",
  "cache_error",
  "folder_path",
  "tags_json",
  "title_prefix",
  "hashtags_json",
  "platform_notes"
].sort();
const outputProfilesMigrationId = "20260420_001_output_profiles";
const destinationOutputProfilesMigrationId = "20260421_002_destination_output_profiles";
const engagementGameMigrationId = "20260422_001_engagement_game";
const twitchLiveStartedAtMigrationId = "20260422_002_twitch_live_started_at";
const outputSettingsColumns = ["singleton_id", "profile_id", "width", "height", "fps", "updated_at"].sort();
const engagementLayerMigrationId = "20260420_002_engagement_layer";
const chatInteractionMigrationId = "20260818_001_chat_interaction";
const chatSkipVoteMigrationId = "20260825_004_chat_skip_vote";
const chatOverlayMessagesMigrationId = "20260825_005_chat_overlay_messages";
const overlayVideoSourcePushIngestMigrationId = "20260826_002_overlay_video_source_push_ingest";
const managedSecretsMigrationId = "20260826_003_managed_secrets";
const poolSourceCursorsMigrationId = "20261001_001_pool_source_cursors";
const sourceBreakersMigrationId = "20261001_002_source_breakers";
const asRunLogMigrationId = "20261001_003_as_run_log";
// The row id the internal relay key lives under, mirrored from packages/db so the non-write proofs
// below can look at the stored ciphertext directly rather than through any reader.
const RELAY_INTERNAL_KEY_SECRET_ID = "relay-internal-key";
const engagementAlertTypesMigrationId = "20260421_001_engagement_alert_types";
const engagementSettingsColumns = [
  "singleton_id",
  "chat_enabled",
  "alerts_enabled",
  "donations_enabled",
  "channel_points_enabled",
  "game_enabled",
  "solo_mode_enabled",
  "small_group_mode_enabled",
  "crowd_mode_enabled",
  "game_window_minutes",
  "chat_mode",
  "chat_position",
  "alert_position",
  "style",
  "max_messages",
  "rate_limit_per_minute",
  "updated_at"
].sort();
const engagementGameRuntimeColumns = ["singleton_id", "active_chatter_count", "mode", "mode_changed_at", "updated_at"].sort();
const engagementEventsColumns = ["id", "kind", "actor", "message", "created_at"].sort();

async function runDocker(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("docker", args);
  return stdout.trim();
}

async function startFreshPostgres(): Promise<TestDatabase> {
  const containerName = `stream247-db-test-${randomUUID().slice(0, 8)}`;
  await runDocker([
    "run",
    "-d",
    "--rm",
    "--name",
    containerName,
    "-e",
    "POSTGRES_DB=stream247",
    "-e",
    "POSTGRES_USER=stream247",
    "-e",
    "POSTGRES_PASSWORD=stream247",
    "-p",
    "127.0.0.1::5432",
    "postgres:16-alpine"
  ]);

  let mappedPort = "";
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const portOutput = await runDocker(["port", containerName, "5432/tcp"]);
    mappedPort = portOutput.split(":").at(-1) ?? "";
    if (mappedPort) {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      await runDocker(["exec", containerName, "pg_isready", "-U", "stream247", "-d", "stream247"]);
      break;
    } catch (error) {
      if (attempt === 29) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  return {
    containerName,
    databaseUrl: `postgresql://stream247:stream247@127.0.0.1:${mappedPort}/stream247`
  };
}

async function ensureDatabaseWithRetry(): Promise<void> {
  let lastError: unknown;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await ensureDatabase();
      return;
    } catch (error) {
      lastError = error;
      await resetDatabaseConnectionsForTests();
      await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Failed to initialize fresh PostgreSQL test database.");
}

describe.sequential("database roundtrip", () => {
  let testDatabase: TestDatabase;
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const originalAppSecret = process.env.APP_SECRET;

  beforeAll(async () => {
    testDatabase = await startFreshPostgres();
    process.env.DATABASE_URL = testDatabase.databaseUrl;
    process.env.APP_SECRET = "stream247-test-secret";
    await resetDatabaseConnectionsForTests();
  }, 60_000);

  afterAll(async () => {
    await resetDatabaseConnectionsForTests();
    process.env.DATABASE_URL = originalDatabaseUrl;
    process.env.APP_SECRET = originalAppSecret;

    if (testDatabase?.containerName) {
      await runDocker(["rm", "-f", testDatabase.containerName]).catch(() => {});
    }
  });

  async function executeSql(sql: string): Promise<string> {
    return runDocker([
      "exec",
      testDatabase.containerName,
      "psql",
      "-U",
      "stream247",
      "-d",
      "stream247",
      "-v",
      "ON_ERROR_STOP=1",
      "-Atc",
      sql
    ]);
  }

  it("boots a fresh schema migration and roundtrips the full app state", async () => {
    await ensureDatabaseWithRetry();
    const initial = await readAppState();

    expect(initial.playout.transitionState).toBe("idle");
    expect(initial.sources.length).toBeGreaterThan(0);

    const nextState = {
      ...initial,
      initialized: true,
      owner: {
        email: "owner@example.com",
        passwordHash: "hash",
        createdAt: "2026-04-04T10:00:00.000Z"
      },
      users: [
        {
          id: "user_owner",
          email: "owner@example.com",
          displayName: "Owner",
          authProvider: "local" as const,
          role: "owner" as const,
          twitchUserId: "",
          twitchLogin: "",
          passwordHash: "hash",
          twoFactorEnabled: true,
          twoFactorSecret: "JBSWY3DPEHPK3PXP",
          twoFactorConfirmedAt: "2026-04-04T10:06:00.000Z",
          createdAt: "2026-04-04T10:00:00.000Z",
          lastLoginAt: "2026-04-04T10:05:00.000Z"
        }
      ],
      teamAccessGrants: [
        {
          id: "grant_1",
          twitchLogin: "operator",
          role: "operator" as const,
          createdAt: "2026-04-04T10:10:00.000Z",
          createdBy: "owner@example.com"
        }
      ],
      presenceWindows: [
        {
          actor: "mod1",
          minutes: 15,
          createdAt: "2026-04-04T10:00:00.000Z",
          expiresAt: "2026-04-04T10:15:00.000Z"
        }
      ],
      overlay: {
        ...initial.overlay,
        enabled: true,
        channelName: "Roundtrip\u200B TV",
        replayLabel: "Re\uFEFFplay",
        insertHeadline: "Custom\u200B insert break",
        standbyHeadline: "Stand by\u2066 for the next archive block",
        reconnectHeadline: "Refreshing the\u200D live output",
        brandBadge: "Archive\u200B Channel",
        insertScenePreset: "minimal-chip",
        standbyScenePreset: "standby-board",
        reconnectScenePreset: "reconnect-board",
        surfaceStyle: "signal",
        panelAnchor: "center",
        titleScale: "cinematic",
        layerOrder: ["hero", "chip", "next", "queue", "schedule", "clock", "banner", "ticker"],
        disabledLayers: ["schedule"],
        tickerText: "Roundtrip\u2069 preview ticker",
        updatedAt: "2026-04-04T10:00:00.000Z"
      },
      managedConfig: {
        ...initial.managedConfig,
        twitchClientId: "client-id",
        twitchClientSecret: "client-secret",
        updatedAt: "2026-04-04T10:00:00.000Z"
      },
      output: {
        profileId: "1080p30" as const,
        width: 1920,
        height: 1080,
        fps: 30,
        updatedAt: "2026-04-04T10:00:00.000Z"
      },
      engagement: {
        chatEnabled: true,
        alertsEnabled: true,
        donationsEnabled: true,
        channelPointsEnabled: true,
        gameEnabled: true,
        soloModeEnabled: true,
        smallGroupModeEnabled: true,
        crowdModeEnabled: false,
        gameWindowMinutes: 12,
        chatMode: "active" as const,
        chatPosition: "bottom-right" as const,
        alertPosition: "top-left" as const,
        style: "card" as const,
        maxMessages: 8,
        rateLimitPerMinute: 45,
        updatedAt: "2026-04-04T10:00:00.000Z"
      },
      engagementGame: {
        mode: "small-group" as const,
        activeChatterCount: 6,
        modeChangedAt: "2026-04-04T10:03:00.000Z",
        updatedAt: "2026-04-04T10:04:00.000Z"
      },
      engagementEvents: [
        {
          id: "engagement_chat_1",
          kind: "chat" as const,
          actor: "view\u200Ber",
          message: "hello\u2066 stream\u2069",
          createdAt: "2026-04-04T10:01:00.000Z"
        },
        {
          id: "engagement_follow_1",
          kind: "follow" as const,
          actor: "new\u200Bviewer",
          message: "newviewer followed the\uFEFF channel.",
          createdAt: "2026-04-04T10:02:00.000Z"
        }
      ],
      twitch: {
        ...initial.twitch,
        status: "connected" as const,
        broadcasterId: "123",
        broadcasterLogin: "roundtrip",
        accessToken: "token",
        refreshToken: "refresh",
        connectedAt: "2026-04-04T10:00:00.000Z",
        tokenExpiresAt: "2026-04-04T12:00:00.000Z",
        liveStatus: "offline" as const,
        viewerCount: 0,
        startedAt: "2026-04-04T09:30:00.000Z"
      },
      twitchScheduleSegments: [
        {
          key: "segment_1",
          segmentId: "abc",
          blockId: "block_1",
          startTime: "2026-04-04T12:00:00.000Z",
          title: "Lunch Replay",
          syncedAt: "2026-04-04T10:00:00.000Z"
        }
      ],
      pools: [
        {
          id: "pool_1",
          name: "Pool One",
          sourceIds: ["source_1"],
          playbackMode: "round-robin" as const,
          cursorAssetId: "asset_1",
          insertAssetId: "asset_3",
          insertEveryItems: 3,
          audioLaneAssetId: "asset_audio_bed",
          audioLaneVolumePercent: 55,
          itemsSinceInsert: 2,
          updatedAt: "2026-04-04T10:00:00.000Z"
        }
      ],
      showProfiles: [
        {
          id: "show_1",
          name: "Morning Replay",
          categoryName: "Gaming",
          defaultDurationMinutes: 120,
          color: "#123456",
          description: "Morning archive block",
          updatedAt: "2026-04-04T10:00:00.000Z"
        }
      ],
      scheduleBlocks: [
        {
          id: "block_1",
          title: "Morning Replay",
          categoryName: "Gaming",
          dayOfWeek: 6,
          startMinuteOfDay: 8 * 60,
          durationMinutes: 120,
          showId: "show_1",
          poolId: "pool_1",
          sourceName: "Source 1",
          repeatMode: "weekends" as const,
          repeatGroupId: "repeat_weekend",
          cuepointAssetId: "asset_3",
          cuepointOffsetsSeconds: [600, 1800]
        }
      ],
      sources: [
        {
          id: "source_1",
          name: "Source 1",
          type: "Managed ingestion",
          connectorKind: "youtube-channel" as const,
          enabled: true,
          status: "Ready",
          externalUrl: "https://www.youtube.com/@stream247",
          notes: "Roundtrip source",
          lastSyncedAt: "2026-04-04T10:00:00.000Z"
        }
      ],
      assets: [
        {
          id: "asset_1",
          sourceId: "source_1",
          title: "Asset\u200B One",
          titlePrefix: "Re\uFEFFplay:",
          hashtagsJson: JSON.stringify(["stream\u200B247", "#vod\u2066 replay"]),
          platformNotes: "Use\u2069 the safe thumbnail.",
          path: "https://example.com/video.mp4",
          cachePath: "/app/data/media/.stream247-cache/twitch/source_1/video-1.mp4",
          cacheStatus: "ready" as const,
          cacheUpdatedAt: "2026-04-04T10:00:30.000Z",
          cacheError: "",
          folderPath: "youtube-channel/source-1",
          tags: ["featured", "evergreen"],
          status: "ready" as const,
          includeInProgramming: true,
          externalId: "video-1",
          categoryName: "Gam\u200Ding",
          durationSeconds: 3600,
          publishedAt: "2026-04-01T10:00:00.000Z",
          fallbackPriority: 1,
          isGlobalFallback: true,
          createdAt: "2026-04-04T10:00:00.000Z",
          updatedAt: "2026-04-04T10:00:00.000Z"
        }
      ],
      assetCollections: [
        {
          id: "collection_1",
          name: "Roundtrip starters",
          description: "Reusable kickoff bundle",
          color: "#0e6d5a",
          assetIds: ["asset_1"],
          createdAt: "2026-04-04T10:00:00.000Z",
          updatedAt: "2026-04-04T10:00:00.000Z"
        }
      ],
      sourceSyncRuns: [
        {
          id: "sync_1",
          sourceId: "source_1",
          startedAt: "2026-04-04T10:00:00.000Z",
          finishedAt: "2026-04-04T10:01:00.000Z",
          status: "success" as const,
          summary: "Imported 1 asset",
          discoveredAssets: 1,
          readyAssets: 1,
          errorMessage: ""
        }
      ],
      destinations: [
        {
          id: "destination-primary",
          provider: "twitch" as const,
          role: "primary" as const,
          priority: 0,
          outputProfileId: "inherit" as const,
          name: "Primary",
          enabled: true,
          rtmpUrl: "rtmp://live.twitch.tv/app",
          streamKeyPresent: true,
          status: "ready" as const,
          notes: "Primary output",
          lastValidatedAt: "2026-04-04T10:00:00.000Z",
          lastFailureAt: "",
          failureCount: 0,
          lastError: ""
        }
      ],
      incidents: [
        {
          id: "incident_1",
          scope: "system" as const,
          severity: "warning" as const,
          status: "open" as const,
          acknowledgedAt: "",
          acknowledgedBy: "",
          title: "Example incident",
          message: "Example",
          fingerprint: "example",
          createdAt: "2026-04-04T10:00:00.000Z",
          updatedAt: "2026-04-04T10:00:00.000Z",
          resolvedAt: ""
        }
      ],
      auditEvents: [
        {
          id: "audit_1",
          type: "test.roundtrip",
          message: "roundtrip",
          createdAt: "2026-04-04T10:00:00.000Z"
        }
      ],
      playout: {
        ...initial.playout,
        status: "running" as const,
        transitionState: "ready" as const,
        queueVersion: 4,
        transitionTargetKind: "insert" as const,
        transitionTargetAssetId: "asset_3",
        transitionTargetTitle: "Channel ID",
        transitionReadyAt: "2026-04-04T10:00:11.000Z",
        currentAssetId: "asset_1",
        currentTitle: "Asset One",
        previousAssetId: "asset_0",
        previousTitle: "Asset Zero",
        desiredAssetId: "asset_1",
        nextAssetId: "asset_2",
        nextTitle: "Asset Two",
        queuedAssetIds: ["asset_2", "asset_3"],
        queueItems: [
          {
            id: "queue-asset_1-0",
            kind: "asset" as const,
            assetId: "asset_1",
            title: "Asset One",
            subtitle: "Pool One · Just Chatting",
            scenePreset: "replay-lower-third" as const,
            position: 0
          },
          {
            id: "queue-asset_2-1",
            kind: "insert" as const,
            assetId: "asset_3",
            title: "Channel ID",
            subtitle: "Insert · Channel ID",
            scenePreset: "bumper-board" as const,
            position: 1
          }
        ],
        prefetchedAssetId: "asset_2",
        prefetchedTitle: "Asset Two",
        prefetchedAt: "2026-04-04T10:00:10.000Z",
        prefetchStatus: "ready" as const,
        prefetchError: "",
        heartbeatAt: "2026-04-04T10:00:20.000Z",
        processPid: 42,
        processStartedAt: "2026-04-04T10:00:00.000Z",
        lastTransitionAt: "2026-04-04T10:00:00.000Z",
        lastSuccessfulStartAt: "2026-04-04T10:00:00.000Z",
        lastSuccessfulAssetId: "asset_1",
        selectionReasonCode: "scheduled_match" as const,
        fallbackTier: "scheduled" as const,
        liveBridgeInputType: "hls" as const,
        liveBridgeInputUrl: "https://live.example.com/master.m3u8",
        liveBridgeLabel: "Guest takeover",
        liveBridgeStatus: "active" as const,
        liveBridgeRequestedAt: "2026-04-04T10:00:05.000Z",
        liveBridgeStartedAt: "2026-04-04T10:00:06.000Z",
        liveBridgeReleasedAt: "",
        liveBridgeLastError: "",
        cuepointWindowKey: "2026-04-04:block_1:480:120",
        cuepointFiredKeys: ["2026-04-04:block_1:480:120:600"],
        cuepointLastTriggeredAt: "2026-04-04T10:20:00.000Z",
        cuepointLastAssetId: "asset_3",
        manualNextAssetId: "asset_2",
        manualNextRequestedAt: "2026-04-04T10:00:09.000Z",
        uplinkStatus: "running" as const,
        uplinkInputMode: "hls" as const,
        uplinkStartedAt: "2026-04-04T10:00:01.000Z",
        uplinkHeartbeatAt: "2026-04-04T10:00:21.000Z",
        uplinkDestinationIds: ["destination-primary", "destination-youtube"],
        uplinkRestartCount: 2,
        uplinkUnplannedRestartCount: 0,
        uplinkLastExitCode: "",
        uplinkLastExitReason: "",
        uplinkLastExitPlanned: false,
        uplinkReconnectUntil: "",
        programFeedStatus: "fresh" as const,
        programFeedUpdatedAt: "2026-04-04T10:00:19.000Z",
        programFeedPlaylistPath: "/app/data/media/.stream247-program-feed/program.m3u8",
        programFeedTargetSeconds: 2,
        programFeedBufferedSeconds: 60,
        message: "Running"
      }
    };

    await writeAppState(nextState);

    const reread = await readAppState();
    expect(reread.initialized).toBe(true);
    expect(reread.owner?.email).toBe("owner@example.com");
    expect(reread.overlay.channelName).toBe("Roundtrip TV");
    expect(reread.overlay.replayLabel).toBe("Replay");
    expect(reread.overlay.insertHeadline).toBe("Custom insert break");
    expect(reread.overlay.standbyHeadline).toBe("Stand by for the next archive block");
    expect(reread.overlay.reconnectHeadline).toBe("Refreshing the live output");
    expect(reread.overlay.brandBadge).toBe("Archive Channel");
    expect(reread.overlay.insertScenePreset).toBe("minimal-chip");
    expect(reread.overlay.standbyScenePreset).toBe("standby-board");
    expect(reread.overlay.reconnectScenePreset).toBe("reconnect-board");
    expect(reread.overlay.surfaceStyle).toBe("signal");
    expect(reread.overlay.panelAnchor).toBe("center");
    expect(reread.overlay.titleScale).toBe("cinematic");
    expect(reread.overlay.layerOrder[0]).toBe("hero");
    expect(reread.overlay.disabledLayers).toEqual(["schedule"]);
    expect(reread.overlay.tickerText).toBe("Roundtrip preview ticker");
    expect(reread.managedConfig.twitchClientId).toBe("client-id");
    expect(reread.output).toEqual(nextState.output);
    expect(reread.engagement).toEqual(nextState.engagement);
    expect(reread.engagementGame).toEqual(nextState.engagementGame);
    expect(reread.engagementEvents.map((event) => event.id)).toEqual(["engagement_follow_1", "engagement_chat_1"]);
    expect(reread.engagementEvents[0]?.actor).toBe("newviewer");
    expect(reread.engagementEvents[0]?.message).toBe("newviewer followed the channel.");
    expect(reread.engagementEvents[1]?.actor).toBe("viewer");
    expect(reread.engagementEvents[1]?.message).toBe("hello stream");
    expect(reread.twitch.broadcasterLogin).toBe("roundtrip");
    expect(reread.twitch.liveStatus).toBe("offline");
    expect(reread.twitch.viewerCount).toBe(0);
    expect(reread.twitch.startedAt).toBe("2026-04-04T09:30:00.000Z");
    expect(reread.twitchScheduleSegments[0]?.segmentId).toBe("abc");
    expect(reread.pools[0]?.name).toBe("Pool One");
    expect(reread.pools[0]?.insertAssetId).toBe("asset_3");
    expect(reread.pools[0]?.audioLaneAssetId).toBe("asset_audio_bed");
    expect(reread.pools[0]?.audioLaneVolumePercent).toBe(55);
    expect(reread.showProfiles[0]?.name).toBe("Morning Replay");
    expect(reread.scheduleBlocks[0]?.showId).toBe("show_1");
    expect(reread.scheduleBlocks[0]?.repeatMode).toBe("weekends");
    expect(reread.scheduleBlocks[0]?.repeatGroupId).toBe("repeat_weekend");
    expect(reread.scheduleBlocks[0]?.cuepointAssetId).toBe("asset_3");
    expect(reread.scheduleBlocks[0]?.cuepointOffsetsSeconds).toEqual([600, 1800]);
    expect(reread.sources[0]?.connectorKind).toBe("youtube-channel");
    expect(reread.assets[0]?.durationSeconds).toBe(3600);
    expect(reread.assets[0]?.title).toBe("Asset One");
    expect(reread.assets[0]?.titlePrefix).toBe("Replay:");
    expect(reread.assets[0]?.hashtagsJson).toBe(JSON.stringify(["stream247", "vodreplay"]));
    expect(reread.assets[0]?.platformNotes).toBe("Use the safe thumbnail.");
    expect(reread.assets[0]?.categoryName).toBe("Gaming");
    expect(reread.assets[0]?.cachePath).toBe("/app/data/media/.stream247-cache/twitch/source_1/video-1.mp4");
    expect(reread.assets[0]?.cacheStatus).toBe("ready");
    expect(reread.assets[0]?.cacheUpdatedAt).toBe("2026-04-04T10:00:30.000Z");
    expect(reread.assets[0]?.cacheError).toBe("");
    expect(reread.assets[0]?.folderPath).toBe("youtube-channel/source-1");
    expect(reread.assets[0]?.tags).toEqual(["featured", "evergreen"]);
    expect(reread.assetCollections[0]?.name).toBe("Roundtrip starters");
    expect(reread.assetCollections[0]?.assetIds).toEqual(["asset_1"]);
    expect(reread.sourceSyncRuns[0]?.status).toBe("success");
    expect(reread.destinations[0]?.streamKeyPresent).toBe(false);
    expect(reread.destinations[0]?.streamKeySource).toBe("missing");
    expect(reread.destinations[0]?.outputProfileId).toBe("inherit");
    expect(reread.incidents[0]?.fingerprint).toBe("example");
    expect(reread.auditEvents[0]?.type).toBe("test.roundtrip");
    expect(reread.playout.transitionState).toBe("ready");
    expect(reread.playout.queueVersion).toBe(4);
    expect(reread.playout.transitionTargetKind).toBe("insert");
    expect(reread.playout.transitionTargetAssetId).toBe("asset_3");
    expect(reread.playout.previousAssetId).toBe("asset_0");
    expect(reread.playout.previousTitle).toBe("Asset Zero");
    expect(reread.playout.prefetchedAssetId).toBe("asset_2");
    expect(reread.playout.liveBridgeInputType).toBe("hls");
    expect(reread.playout.liveBridgeLabel).toBe("Guest takeover");
    expect(reread.playout.liveBridgeStatus).toBe("active");
    expect(reread.playout.cuepointWindowKey).toBe("2026-04-04:block_1:480:120");
    expect(reread.playout.cuepointFiredKeys).toEqual(["2026-04-04:block_1:480:120:600"]);
    expect(reread.playout.cuepointLastAssetId).toBe("asset_3");
    expect(reread.playout.manualNextAssetId).toBe("asset_2");
    expect(reread.playout.uplinkStatus).toBe("running");
    expect(reread.playout.uplinkInputMode).toBe("hls");
    expect(reread.playout.uplinkDestinationIds).toEqual(["destination-primary", "destination-youtube"]);
    expect(reread.playout.uplinkRestartCount).toBe(2);
    expect(reread.playout.programFeedStatus).toBe("fresh");
    expect(reread.playout.programFeedBufferedSeconds).toBe(60);
    expect(reread.playout.queuedAssetIds).toEqual(["asset_2", "asset_3"]);
    expect(reread.playout.queueItems[1]?.kind).toBe("insert");
    expect(reread.playout.queueItems[1]?.assetId).toBe("asset_3");
    expect(reread.users[0]?.twoFactorEnabled).toBe(true);
    expect(reread.users[0]?.twoFactorSecret).toBe("JBSWY3DPEHPK3PXP");

    await updateDestinationRecord(
      {
        ...reread.destinations[0]!,
        id: "destination-youtube",
        provider: "custom-rtmp",
        role: "primary",
        priority: 1,
        outputProfileId: "360p30",
        name: "YouTube Output",
        enabled: true,
        rtmpUrl: "rtmp://a.rtmp.youtube.com/live2",
        streamKeyPresent: true,
        streamKeySource: "managed",
        status: "ready",
        notes: "Managed output",
        lastValidatedAt: "2026-04-04T10:02:00.000Z",
        lastFailureAt: "",
        failureCount: 0,
        lastError: ""
      },
      {
        managedStreamKey: "managed-youtube-key"
      }
    );

    const managedKeys = await readManagedDestinationStreamKeys(["destination-youtube"]);
    const postUpdate = await readAppState();
    expect(managedKeys["destination-youtube"]).toBe("managed-youtube-key");
    expect(postUpdate.destinations.find((destination) => destination.id === "destination-youtube")?.streamKeySource).toBe("managed");
    expect(postUpdate.destinations.find((destination) => destination.id === "destination-youtube")?.outputProfileId).toBe("360p30");

    await updateOutputSettingsRecord({
      profileId: "360p30",
      width: 640,
      height: 360,
      fps: 30,
      updatedAt: "2026-04-04T10:03:00.000Z"
    });
    expect((await readAppState()).output).toEqual({
      profileId: "360p30",
      width: 640,
      height: 360,
      fps: 30,
      updatedAt: "2026-04-04T10:03:00.000Z"
    });

    await updateEngagementSettingsRecord({
      chatEnabled: true,
      alertsEnabled: false,
      donationsEnabled: true,
      channelPointsEnabled: true,
      gameEnabled: true,
      soloModeEnabled: true,
      smallGroupModeEnabled: false,
      crowdModeEnabled: true,
      gameWindowMinutes: 15,
      chatMode: "flood",
      chatPosition: "top-right",
      alertPosition: "bottom-left",
      style: "compact",
      maxMessages: 12,
      rateLimitPerMinute: 90,
      updatedAt: "2026-04-04T10:04:00.000Z"
    });
    expect((await readAppState()).engagement).toEqual({
      chatEnabled: true,
      alertsEnabled: false,
      donationsEnabled: true,
      channelPointsEnabled: true,
      gameEnabled: true,
      soloModeEnabled: true,
      smallGroupModeEnabled: false,
      crowdModeEnabled: true,
      gameWindowMinutes: 15,
      chatMode: "flood",
      chatPosition: "top-right",
      alertPosition: "bottom-left",
      style: "compact",
      maxMessages: 12,
      rateLimitPerMinute: 90,
      updatedAt: "2026-04-04T10:04:00.000Z"
    });
  }, 60_000);

  /**
   * An incident that comes and goes leaving nothing behind.
   *
   * Observed on the live channel 2026-09-03: `playout.prefetch.failed` opened somewhere between
   * 12:45 and 13:06 and resolved at 13:06:08. Neither container logged a line for it — 30 of the 48
   * upsertIncident call sites have no logRuntimeEvent beside them — and resolveIncident then wrote
   * "Next queued asset probe succeeded." over the message column, which had held the actual probe
   * error. Log, message, both gone. The only reason anyone knew was a round that happened to poll
   * the table inside the twenty-minute window.
   *
   * So the announcement is made here, once, where every caller passes through, rather than by
   * remembering it at 30 call sites. Once per ONSET, not per cycle: an incident that stays open is
   * re-upserted on every reconciliation, and a line each time would bury the one that matters.
   */
  it("announces an incident when it opens, once per onset, so the reason outlives the resolution", async () => {
    const fingerprint = `test.incident.announce.${randomUUID()}`;
    const seen: string[] = [];
    const original = console.warn;
    console.warn = (...args: unknown[]) => {
      seen.push(args.map(String).join(" "));
    };

    try {
      await upsertIncident({
        scope: "playout",
        severity: "warning",
        title: "Next queued asset probe failed",
        message: "probe exited 1: Server returned 403 Forbidden",
        fingerprint
      });
      const afterOpen = seen.filter((line) => line.includes(fingerprint));
      expect(afterOpen).toHaveLength(1);
      expect(afterOpen[0]).toContain("Server returned 403 Forbidden");

      // Still open: the reconciliation loop upserts it again every cycle and must stay quiet.
      await upsertIncident({
        scope: "playout",
        severity: "warning",
        title: "Next queued asset probe failed",
        message: "probe exited 1: Server returned 403 Forbidden",
        fingerprint
      });
      expect(seen.filter((line) => line.includes(fingerprint))).toHaveLength(1);

      // Resolved and raised again is a new onset, and says so.
      await resolveIncident(fingerprint, "Next queued asset probe succeeded.");
      await upsertIncident({
        scope: "playout",
        severity: "warning",
        title: "Next queued asset probe failed",
        message: "probe exited 1: connection reset",
        fingerprint
      });
      const afterReopen = seen.filter((line) => line.includes(fingerprint));
      expect(afterReopen).toHaveLength(2);
      expect(afterReopen[1]).toContain("connection reset");
    } finally {
      console.warn = original;
      await resolveIncident(fingerprint, "test cleanup");
    }
  });

  it("upgrades existing playout runtime rows with persistent uplink and program feed columns", async () => {
    await ensureDatabaseWithRetry();
    await executeSql(`
      ALTER TABLE playout_runtime
        DROP COLUMN IF EXISTS uplink_status,
        DROP COLUMN IF EXISTS uplink_input_mode,
        DROP COLUMN IF EXISTS uplink_started_at,
        DROP COLUMN IF EXISTS uplink_heartbeat_at,
        DROP COLUMN IF EXISTS uplink_destination_ids,
        DROP COLUMN IF EXISTS uplink_restart_count,
        DROP COLUMN IF EXISTS uplink_unplanned_restart_count,
        DROP COLUMN IF EXISTS uplink_last_exit_code,
        DROP COLUMN IF EXISTS uplink_last_exit_reason,
        DROP COLUMN IF EXISTS uplink_last_exit_planned,
        DROP COLUMN IF EXISTS uplink_reconnect_until,
        DROP COLUMN IF EXISTS program_feed_status,
        DROP COLUMN IF EXISTS program_feed_updated_at,
        DROP COLUMN IF EXISTS program_feed_playlist_path,
        DROP COLUMN IF EXISTS program_feed_target_seconds,
        DROP COLUMN IF EXISTS program_feed_buffered_seconds;
      DELETE FROM schema_migrations WHERE id = '${persistentProgramFeedRuntimeMigrationId}';
    `);

    await resetDatabaseConnectionsForTests();
    await ensureDatabaseWithRetry();

    const columns = (
      await executeSql(`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_name = 'playout_runtime'
          AND column_name IN (${persistentProgramFeedRuntimeColumns.map((column) => `'${column}'`).join(", ")})
        ORDER BY column_name;
      `)
    )
      .split("\n")
      .filter(Boolean);
    const migrationApplied = await executeSql(
      `SELECT COUNT(*) FROM schema_migrations WHERE id = '${persistentProgramFeedRuntimeMigrationId}';`
    );
    const state = await readAppState();

    expect(columns).toEqual(persistentProgramFeedRuntimeColumns);
    expect(migrationApplied).toBe("1");
    expect(state.playout.uplinkStatus).toBe("");
    expect(state.playout.programFeedBufferedSeconds).toBe(0);
  }, 60_000);

  it("upgrades existing databases with output profile settings", async () => {
    await ensureDatabaseWithRetry();
    await executeSql(`
      DROP TABLE IF EXISTS output_settings;
      DELETE FROM schema_migrations WHERE id = '${outputProfilesMigrationId}';
    `);

    await resetDatabaseConnectionsForTests();
    await ensureDatabaseWithRetry();

    const columns = (
      await executeSql(`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_name = 'output_settings'
        ORDER BY column_name;
      `)
    )
      .split("\n")
      .filter(Boolean);
    const migrationApplied = await executeSql(`SELECT COUNT(*) FROM schema_migrations WHERE id = '${outputProfilesMigrationId}';`);
    const state = await readAppState();

    expect(columns).toEqual(outputSettingsColumns);
    expect(migrationApplied).toBe("1");
    expect(state.output).toEqual({
      profileId: "720p30",
      width: 1280,
      height: 720,
      fps: 30,
      updatedAt: ""
    });
  }, 60_000);

  it("upgrades existing databases with asset cache and overlay metadata columns", async () => {
    await ensureDatabaseWithRetry();
    await executeSql(`
      ALTER TABLE assets
        DROP COLUMN IF EXISTS cache_path,
        DROP COLUMN IF EXISTS cache_status,
        DROP COLUMN IF EXISTS cache_updated_at,
        DROP COLUMN IF EXISTS cache_error,
        DROP COLUMN IF EXISTS folder_path,
        DROP COLUMN IF EXISTS tags_json,
        DROP COLUMN IF EXISTS title_prefix,
        DROP COLUMN IF EXISTS hashtags_json,
        DROP COLUMN IF EXISTS platform_notes;
      DELETE FROM schema_migrations WHERE id = '${assetCacheMetadataMigrationId}';
    `);

    await resetDatabaseConnectionsForTests();
    await ensureDatabaseWithRetry();

    const columns = (
      await executeSql(`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_name = 'assets'
          AND column_name IN (${assetCacheMetadataColumns.map((column) => `'${column}'`).join(", ")})
        ORDER BY column_name;
      `)
    )
      .split("\n")
      .filter(Boolean);
    const migrationApplied = await executeSql(
      `SELECT COUNT(*) FROM schema_migrations WHERE id = '${assetCacheMetadataMigrationId}';`
    );
    const state = await readAppState();

    expect(columns).toEqual(assetCacheMetadataColumns);
    expect(migrationApplied).toBe("1");
    expect(state.assets).toHaveLength(1);
    expect(state.assets[0]).toMatchObject({
      id: "asset_1",
      cachePath: "",
      cacheStatus: "",
      cacheUpdatedAt: "",
      cacheError: "",
      folderPath: "",
      tags: [],
      titlePrefix: "",
      hashtagsJson: "[]",
      platformNotes: ""
    });
  }, 60_000);

  it("upgrades existing databases with per-destination output profile settings", async () => {
    await ensureDatabaseWithRetry();
    await executeSql(`
      ALTER TABLE stream_destinations DROP COLUMN IF EXISTS output_profile_id;
      DELETE FROM schema_migrations WHERE id = '${destinationOutputProfilesMigrationId}';
    `);

    await resetDatabaseConnectionsForTests();
    await ensureDatabaseWithRetry();

    const columns = (
      await executeSql(`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_name = 'stream_destinations'
          AND column_name = 'output_profile_id'
        ORDER BY column_name;
      `)
    )
      .split("\n")
      .filter(Boolean);
    const migrationApplied = await executeSql(
      `SELECT COUNT(*) FROM schema_migrations WHERE id = '${destinationOutputProfilesMigrationId}';`
    );
    const state = await readAppState();

    expect(columns).toEqual(["output_profile_id"]);
    expect(migrationApplied).toBe("1");
    expect(state.destinations.every((destination) => destination.outputProfileId === "inherit")).toBe(true);
  }, 60_000);

  it("upgrades existing databases with engagement settings and event storage", async () => {
    await ensureDatabaseWithRetry();
    await executeSql(`
      DROP TABLE IF EXISTS engagement_game_runtime;
      DROP TABLE IF EXISTS engagement_events;
      DROP TABLE IF EXISTS engagement_settings;
      DELETE FROM schema_migrations WHERE id = '${engagementLayerMigrationId}';
      DELETE FROM schema_migrations WHERE id = '${engagementAlertTypesMigrationId}';
      DELETE FROM schema_migrations WHERE id = '${engagementGameMigrationId}';
    `);

    await resetDatabaseConnectionsForTests();
    await ensureDatabaseWithRetry();

    const settingsColumns = (
      await executeSql(`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_name = 'engagement_settings'
        ORDER BY column_name;
      `)
    )
      .split("\n")
      .filter(Boolean);
    const eventColumns = (
      await executeSql(`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_name = 'engagement_events'
        ORDER BY column_name;
      `)
    )
      .split("\n")
      .filter(Boolean);
    const runtimeColumns = (
      await executeSql(`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_name = 'engagement_game_runtime'
        ORDER BY column_name;
      `)
    )
      .split("\n")
      .filter(Boolean);
    const migrationApplied = await executeSql(`SELECT COUNT(*) FROM schema_migrations WHERE id = '${engagementLayerMigrationId}';`);
    const alertTypesMigrationApplied = await executeSql(
      `SELECT COUNT(*) FROM schema_migrations WHERE id = '${engagementAlertTypesMigrationId}';`
    );
    const gameMigrationApplied = await executeSql(`SELECT COUNT(*) FROM schema_migrations WHERE id = '${engagementGameMigrationId}';`);
    const state = await readAppState();

    expect(settingsColumns).toEqual(engagementSettingsColumns);
    expect(runtimeColumns).toEqual(engagementGameRuntimeColumns);
    expect(eventColumns).toEqual(engagementEventsColumns);
    expect(migrationApplied).toBe("1");
    expect(alertTypesMigrationApplied).toBe("1");
    expect(gameMigrationApplied).toBe("1");
    expect(state.engagement.chatEnabled).toBe(false);
    expect(state.engagement.alertsEnabled).toBe(false);
    expect(state.engagement.donationsEnabled).toBe(true);
    expect(state.engagement.channelPointsEnabled).toBe(true);
    expect(state.engagement.gameEnabled).toBe(false);
    expect(state.engagement.smallGroupModeEnabled).toBe(true);
    expect(state.engagement.gameWindowMinutes).toBe(10);
    expect(state.engagementGame).toEqual({
      mode: "",
      activeChatterCount: 0,
      modeChangedAt: "",
      updatedAt: ""
    });
    expect(state.engagementEvents).toEqual([]);
  }, 60_000);

  it("adds Twitch live started-at storage for workspace uptime displays", async () => {
    await ensureDatabaseWithRetry();
    await executeSql(`
      ALTER TABLE twitch_connection DROP COLUMN IF EXISTS started_at;
      DELETE FROM schema_migrations WHERE id = '${twitchLiveStartedAtMigrationId}';
    `);

    await resetDatabaseConnectionsForTests();
    await ensureDatabaseWithRetry();

    const columns = (
      await executeSql(`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_name = 'twitch_connection' AND column_name = 'started_at'
        ORDER BY column_name;
      `)
    )
      .split("\n")
      .filter(Boolean);
    const migrationApplied = await executeSql(
      `SELECT COUNT(*) FROM schema_migrations WHERE id = '${twitchLiveStartedAtMigrationId}';`
    );
    const state = await readAppState();

    expect(columns).toEqual(["started_at"]);
    expect(migrationApplied).toBe("1");
    expect(state.twitch.startedAt).toBe("");
  }, 60_000);

  it("does not reseed an initialized database just because no users exist", async () => {
    await ensureDatabaseWithRetry();
    const seeded = await readAppState();
    await writeAppState({
      ...seeded,
      initialized: false,
      owner: null,
      users: [],
      teamAccessGrants: []
    });
    const initial = await readAppState();

    expect(initial.users).toEqual([]);
    expect(initial.owner).toBeNull();

    await createPoolRecord({
      id: "pool_queue_smoke",
      name: "Queue Smoke Pool",
      sourceIds: ["source-local-library"],
      playbackMode: "round-robin",
      cursorAssetId: "",
      insertAssetId: "",
      insertEveryItems: 0,
      itemsSinceInsert: 0,
      updatedAt: "2026-04-05T12:00:00.000Z"
    });

    await createScheduleBlocks([
      {
        id: "block_queue_smoke",
        title: "Queue Smoke",
        categoryName: "Smoke",
        dayOfWeek: 0,
        startMinuteOfDay: 0,
        durationMinutes: 1440,
        showId: "",
        poolId: "pool_queue_smoke",
        sourceName: "Local Media Library"
      }
    ]);

    await resetDatabaseConnectionsForTests();
    await ensureDatabaseWithRetry();

    const rehydrated = await readAppState();
    expect(rehydrated.pools.some((pool) => pool.id === "pool_queue_smoke")).toBe(true);
    expect(rehydrated.scheduleBlocks.some((block) => block.id === "block_queue_smoke")).toBe(true);
  });

  it("persists overlay drafts separately from the live scene and can publish/reset them", async () => {
    await ensureDatabaseWithRetry();

    const initialStudioState = await readOverlayStudioState();
    expect(initialStudioState.hasUnpublishedChanges).toBe(false);

    const savedDraftState = await saveOverlayDraftRecord(
      {
        ...initialStudioState.draftOverlay,
        headline: "Draft Scene Headline",
        tickerText: "Draft ticker",
        updatedAt: "2026-04-04T11:00:00.000Z"
      },
      initialStudioState.liveOverlay.updatedAt
    );

    expect(savedDraftState.hasUnpublishedChanges).toBe(true);
    expect(savedDraftState.liveOverlay.headline).not.toBe("Draft Scene Headline");
    expect(savedDraftState.draftOverlay.headline).toBe("Draft Scene Headline");

    const rereadDraftState = await readOverlayStudioState();
    expect(rereadDraftState.hasUnpublishedChanges).toBe(true);
    expect(rereadDraftState.draftOverlay.tickerText).toBe("Draft ticker");
    expect(rereadDraftState.liveOverlay.tickerText).not.toBe("Draft ticker");

    const publishedState = await publishOverlayDraftRecord({
      ...rereadDraftState.draftOverlay,
      updatedAt: "2026-04-04T11:05:00.000Z"
    });
    expect(publishedState.hasUnpublishedChanges).toBe(false);
    expect(publishedState.liveOverlay.headline).toBe("Draft Scene Headline");

    const rereadPublishedState = await readOverlayStudioState();
    expect(rereadPublishedState.liveOverlay.headline).toBe("Draft Scene Headline");
    expect(rereadPublishedState.hasUnpublishedChanges).toBe(false);

    await saveOverlayDraftRecord(
      {
        ...rereadPublishedState.draftOverlay,
        headline: "Second Draft",
        updatedAt: "2026-04-04T11:10:00.000Z"
      },
      rereadPublishedState.liveOverlay.updatedAt
    );
    const resetState = await resetOverlayDraftRecord();
    expect(resetState.hasUnpublishedChanges).toBe(false);
    expect(resetState.draftOverlay.headline).toBe(resetState.liveOverlay.headline);
    expect(resetState.draftOverlay.headline).toBe("Draft Scene Headline");
  }, 60_000);

  it("stores scene presets and can apply them back onto the draft scene", async () => {
    await ensureDatabaseWithRetry();

    const studioState = await readOverlayStudioState();
    const savedPreset = await saveOverlayScenePresetRecord({
      name: "Prime Time Replay",
      description: "Louder replay board for the evening block.",
      overlay: {
        ...studioState.draftOverlay,
        headline: "Prime time archive",
        insertHeadline: "Prime time bumper",
        scenePreset: "split-now-next",
        insertScenePreset: "bumper-board",
        disabledLayers: ["schedule"],
        updatedAt: "2026-04-04T12:00:00.000Z"
      }
    });

    const presets = await listOverlayScenePresetRecords();
    expect(presets[0]?.id).toBe(savedPreset.id);
    expect(presets[0]?.name).toBe("Prime Time Replay");
    expect(presets[0]?.overlay.headline).toBe("Prime time archive");

    const appliedState = await applyOverlayScenePresetRecordToDraft(savedPreset.id);
    expect(appliedState).not.toBeNull();
    expect(appliedState?.draftOverlay.headline).toBe("Prime time archive");
    expect(appliedState?.draftOverlay.insertHeadline).toBe("Prime time bumper");
    expect(appliedState?.draftOverlay.scenePreset).toBe("split-now-next");
    expect(appliedState?.draftOverlay.disabledLayers).toEqual(["schedule"]);

    await deleteOverlayScenePresetRecord(savedPreset.id);
    const remainingPresets = await listOverlayScenePresetRecords();
    expect(remainingPresets.some((preset) => preset.id === savedPreset.id)).toBe(false);
  }, 60_000);

  it("updates asset curation fields without overwriting fresh ingest metadata", async () => {
    await ensureDatabaseWithRetry();
    const initial = await readAppState();

    await writeAppState({
      ...initial,
      sources: [
        {
          id: "source_1",
          name: "Source One",
          type: "YouTube channel",
          connectorKind: "youtube-channel",
          enabled: true,
          status: "Ready",
          externalUrl: "https://youtube.com/@sourceone",
          notes: "Worker healthy",
          lastSyncedAt: "2026-04-05T10:00:00.000Z"
        }
      ],
      assets: [
        {
          id: "asset_1",
          sourceId: "source_1",
          title: "Fresh ingest title",
          path: "https://cdn.example.com/fresh.mp4",
          folderPath: "worker/folder",
          tags: ["worker-tag"],
          status: "ready",
          includeInProgramming: true,
          externalId: "video-1",
          categoryName: "Archive",
          durationSeconds: 1234,
          publishedAt: "2026-04-05T09:00:00.000Z",
          fallbackPriority: 5,
          isGlobalFallback: false,
          createdAt: "2026-04-05T09:30:00.000Z",
          updatedAt: "2026-04-05T10:00:00.000Z"
        }
      ]
    });

    await updateAssetCurationRecords([
      {
        id: "asset_1",
        includeInProgramming: false,
        folderPath: "manual/folder",
        appendTags: ["curated"],
        updatedAt: "2026-04-05T10:05:00.000Z"
      }
    ]);

    const reread = await readAppState();
    expect(reread.assets[0]).toMatchObject({
      id: "asset_1",
      title: "Fresh ingest title",
      path: "https://cdn.example.com/fresh.mp4",
      status: "ready",
      durationSeconds: 1234,
      externalId: "video-1",
      categoryName: "Archive",
      includeInProgramming: false,
      folderPath: "manual/folder"
    });
    expect(reread.assets[0]?.tags).toEqual(["worker-tag", "curated"]);
  }, 60_000);

  it("updates selected source fields without overwriting unrelated source state", async () => {
    await ensureDatabaseWithRetry();
    const initial = await readAppState();

    await writeAppState({
      ...initial,
      sources: [
        {
          id: "source_1",
          name: "Source One",
          type: "YouTube channel",
          connectorKind: "youtube-channel",
          enabled: true,
          status: "Ready",
          externalUrl: "https://youtube.com/@sourceone",
          notes: "Worker healthy",
          lastSyncedAt: "2026-04-05T10:00:00.000Z"
        },
        {
          id: "source_2",
          name: "Source Two",
          type: "Twitch channel",
          connectorKind: "twitch-channel",
          enabled: true,
          status: "Importing",
          externalUrl: "https://twitch.tv/source-two",
          notes: "Worker importing",
          lastSyncedAt: "2026-04-05T10:10:00.000Z"
        }
      ]
    });

    await updateSourceFieldRecords([
      {
        id: "source_1",
        enabled: false
      }
    ]);

    let reread = await readAppState();
    expect(reread.sources.find((source) => source.id === "source_1")).toMatchObject({
      id: "source_1",
      enabled: false,
      status: "Ready",
      notes: "Worker healthy",
      lastSyncedAt: "2026-04-05T10:00:00.000Z"
    });
    expect(reread.sources.find((source) => source.id === "source_2")).toMatchObject({
      id: "source_2",
      enabled: true,
      status: "Importing",
      notes: "Worker importing",
      lastSyncedAt: "2026-04-05T10:10:00.000Z"
    });

    await updateSourceFieldRecords([
      {
        id: "source_1",
        status: "Sync queued",
        notes: "Manual re-sync requested. The worker will refresh this source on the next cycle."
      }
    ]);

    reread = await readAppState();
    expect(reread.sources.find((source) => source.id === "source_1")).toMatchObject({
      id: "source_1",
      enabled: false,
      status: "Sync queued",
      notes: "Manual re-sync requested. The worker will refresh this source on the next cycle.",
      lastSyncedAt: "2026-04-05T10:00:00.000Z"
    });
  }, 60_000);

  it("creates the chat-interaction schema on an existing database", async () => {
    // The tables are new in 1.5.19, so an already-migrated deployment must pick them up on upgrade
    // rather than only appearing on a fresh install.
    await ensureDatabaseWithRetry();
    await executeSql(`
      DROP TABLE IF EXISTS chat_viewer_requests;
      DROP TABLE IF EXISTS chat_vote_session;
      DROP TABLE IF EXISTS chat_interaction_settings;
      DELETE FROM schema_migrations WHERE id = '${chatInteractionMigrationId}';
    `);

    await resetDatabaseConnectionsForTests();
    await ensureDatabaseWithRetry();

    const tables = (
      await executeSql(`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_name IN ('chat_interaction_settings', 'chat_vote_session', 'chat_viewer_requests')
        ORDER BY table_name;
      `)
    )
      .split("\n")
      .filter(Boolean);

    const indexes = (
      await executeSql(`
        SELECT indexname
        FROM pg_indexes
        WHERE tablename = 'chat_viewer_requests'
        ORDER BY indexname;
      `)
    )
      .split("\n")
      .filter(Boolean);

    const migrationApplied = await executeSql(
      `SELECT COUNT(*) FROM schema_migrations WHERE id = '${chatInteractionMigrationId}';`
    );

    // Sorted locally rather than trusting the database collation for the ordering.
    expect([...tables].sort()).toEqual(
      ["chat_interaction_settings", "chat_viewer_requests", "chat_vote_session"].sort()
    );
    // Cooldown checks filter by actor and order by recency; without the index every check would be
    // a sequential scan over unbounded request history.
    expect(indexes).toContain("chat_viewer_requests_actor_created_idx");
    expect(migrationApplied).toBe("1");
  }, 60_000);

  it("adds the chat answer switches to an existing settings row, on by default, and roundtrips them (M104)", async () => {
    await ensureDatabaseWithRetry();
    // The table as an install before M104 has it, with a saved row; written in SQL because the writer
    // already names the new columns.
    await executeSql(`
      ALTER TABLE chat_interaction_settings DROP COLUMN IF EXISTS commands_reply_enabled;
      ALTER TABLE chat_interaction_settings DROP COLUMN IF EXISTS now_reply_enabled;
      ALTER TABLE chat_interaction_settings DROP COLUMN IF EXISTS next_reply_enabled;
      ALTER TABLE chat_interaction_settings DROP COLUMN IF EXISTS request_replies_enabled;
      INSERT INTO chat_interaction_settings (singleton_id, enabled, request_command) VALUES (1, TRUE, 'wunsch')
        ON CONFLICT (singleton_id) DO UPDATE SET enabled = TRUE, request_command = 'wunsch';
      DELETE FROM schema_migrations WHERE id = '20261004_001_chat_reply_switches';
    `);

    await resetDatabaseConnectionsForTests();
    await ensureDatabaseWithRetry();

    const upgraded = await readChatInteractionSettingsRecord();
    expect(upgraded).toMatchObject({
      enabled: true,
      requestCommand: "wunsch",
      commandsReplyEnabled: true,
      nowReplyEnabled: true,
      nextReplyEnabled: true,
      requestRepliesEnabled: true
    });
    expect(await executeSql(`SELECT COUNT(*) FROM schema_migrations WHERE id = '20261004_001_chat_reply_switches';`)).toBe("1");

    await writeChatInteractionSettingsRecord({ ...upgraded, nowReplyEnabled: false, requestRepliesEnabled: false });
    expect(await readChatInteractionSettingsRecord()).toMatchObject({
      commandsReplyEnabled: true,
      nowReplyEnabled: false,
      nextReplyEnabled: true,
      requestRepliesEnabled: false
    });
  }, 60_000);

  it("creates the chat-skip-vote schema on an existing database and roundtrips a campaign", async () => {
    // The table is new, so an already-migrated deployment must pick it up on upgrade rather than
    // only appearing on a fresh install — the base-schema block alone never reaches them.
    await ensureDatabaseWithRetry();
    await executeSql(`
      DROP TABLE IF EXISTS chat_skip_vote;
      DELETE FROM schema_migrations WHERE id = '${chatSkipVoteMigrationId}';
    `);

    await resetDatabaseConnectionsForTests();
    await ensureDatabaseWithRetry();

    const migrationApplied = await executeSql(
      `SELECT COUNT(*) FROM schema_migrations WHERE id = '${chatSkipVoteMigrationId}';`
    );
    expect(migrationApplied).toBe("1");

    // The helpers are exercised against the real table: the singleton upsert and the column
    // mapping are exactly the parts a unit test with a mocked pool would wave through.
    const campaign = {
      assetId: "asset-skip-1",
      skipCommand: "skip",
      votes: 3,
      votesNeeded: 5,
      startedAt: "2026-08-25T20:00:00.000Z",
      expiresAt: "2026-08-25T20:02:00.000Z",
      updatedAt: "2026-08-25T20:00:30.000Z"
    };
    await writeChatSkipVoteRecord(campaign);
    expect(await readChatSkipVoteRecord()).toEqual(campaign);

    // Clearing writes the empty record over the same row rather than deleting it.
    await writeChatSkipVoteRecord({ updatedAt: "2026-08-25T20:03:00.000Z" });
    const cleared = await readChatSkipVoteRecord();
    expect(cleared.votes).toBe(0);
    expect(cleared.assetId).toBe("");
  }, 60_000);

  it("creates the chat-overlay-messages schema on an existing database and roundtrips the row", async () => {
    // Same upgrade story as the skip vote: the base-schema block only ever runs for databases
    // created from nothing, so an already-migrated deployment gets the table from the migration.
    await ensureDatabaseWithRetry();
    await executeSql(`
      DROP TABLE IF EXISTS chat_overlay_messages;
      DELETE FROM schema_migrations WHERE id = '${chatOverlayMessagesMigrationId}';
    `);

    await resetDatabaseConnectionsForTests();
    await ensureDatabaseWithRetry();

    const migrationApplied = await executeSql(
      `SELECT COUNT(*) FROM schema_migrations WHERE id = '${chatOverlayMessagesMigrationId}';`
    );
    expect(migrationApplied).toBe("1");

    // Exercised against the real table: singleton upsert, jsonb column mapping, and the
    // sanitising normalisation a mocked pool would wave through.
    await writeChatOverlayMessagesRecord({
      enabled: true,
      position: "top-right",
      maxMessages: 6,
      messages: [
        { name: "viewer_one", text: "hello​ stream", at: "2026-08-25T20:00:00.000Z" },
        { name: "", text: "no name, never stored", at: "2026-08-25T20:00:01.000Z" },
        { name: "viewer_two", text: "second", at: "2026-08-25T20:00:02.000Z" }
      ],
      updatedAt: "2026-08-25T20:00:03.000Z"
    });

    const reread = await readChatOverlayMessagesRecord();
    expect(reread.enabled).toBe(true);
    expect(reread.position).toBe("top-right");
    expect(reread.maxMessages).toBe(6);
    expect(reread.updatedAt).toBe("2026-08-25T20:00:03.000Z");
    expect(reread.messages).toEqual([
      { name: "viewer_one", text: "hello stream", at: "2026-08-25T20:00:00.000Z" },
      { name: "viewer_two", text: "second", at: "2026-08-25T20:00:02.000Z" }
    ]);

    // Clearing writes the empty record over the same row rather than deleting it — the shape a
    // disabled chat overlay leaves behind.
    await writeChatOverlayMessagesRecord({ updatedAt: "2026-08-25T20:05:00.000Z" });
    const cleared = await readChatOverlayMessagesRecord();
    expect(cleared.enabled).toBe(false);
    expect(cleared.messages).toEqual([]);
  }, 60_000);

  it("adds push ingest to an existing database and derives the internal read URL", async () => {
    // M57 stage 2, Etappe A. The same upgrade story as every additive migration: strip the new
    // columns and the managed-secrets table plus their migration rows, boot again, and both must
    // come back through migrations 20260826_002/_003 (the base-schema block only ever builds
    // databases from nothing).
    await ensureDatabaseWithRetry();
    await executeSql(`
      ALTER TABLE overlay_video_sources DROP COLUMN IF EXISTS ingest_kind;
      ALTER TABLE overlay_video_sources DROP COLUMN IF EXISTS encrypted_publish_key;
      DROP TABLE IF EXISTS managed_secrets;
      DELETE FROM schema_migrations WHERE id = '${overlayVideoSourcePushIngestMigrationId}';
      DELETE FROM schema_migrations WHERE id = '${managedSecretsMigrationId}';
    `);

    await resetDatabaseConnectionsForTests();
    await ensureDatabaseWithRetry();

    const migrationsApplied = await executeSql(
      `SELECT COUNT(*) FROM schema_migrations WHERE id IN ('${overlayVideoSourcePushIngestMigrationId}', '${managedSecretsMigrationId}');`
    );
    expect(migrationsApplied).toBe("2");

    // A push source stores a publish key but never a playback URL; a pull source stays exactly
    // what it was before stage 2.
    await upsertOverlayVideoSourceRecord(
      { id: "push-cam", name: "Push camera" },
      { ingestKind: "push", managedPublishKey: "publish-key-roundtrip" }
    );
    await upsertOverlayVideoSourceRecord(
      { id: "pull-cam", name: "Pull camera" },
      { managedUrl: "rtsp://user:secret@camera.example/stream" }
    );

    const listed = await listOverlayVideoSourceRecords();
    const pushCam = listed.find((entry) => entry.id === "push-cam");
    const pullCam = listed.find((entry) => entry.id === "pull-cam");
    expect(pushCam).toMatchObject({ ingestKind: "push", publishKeyPresent: true, urlPresent: false });
    expect(pullCam).toMatchObject({ ingestKind: "pull", publishKeyPresent: false, urlPresent: true });

    // The reveal surface's reader must never CREATE the key (M57 stage 2, Etappe E). On an install
    // that has none yet it answers "" and leaves the table exactly as empty as it found it — a
    // reveal that minted a key would hand out a value no running worker holds.
    expect(await executeSql(`SELECT COUNT(*) FROM managed_secrets WHERE id = '${RELAY_INTERNAL_KEY_SECRET_ID}';`)).toBe("0");
    expect(await readRelayInternalKeyIfPresent()).toBe("");
    expect(await executeSql(`SELECT COUNT(*) FROM managed_secrets WHERE id = '${RELAY_INTERNAL_KEY_SECRET_ID}';`)).toBe("0");

    // The internal relay key self-generates on first use and every later read adopts the stored
    // value — including a fresh process, simulated by resetting the in-process caches.
    const relayKey = await readRelayInternalKey();
    expect(relayKey.length).toBeGreaterThanOrEqual(32);
    await resetDatabaseConnectionsForTests();
    await ensureDatabaseWithRetry();
    expect(await readRelayInternalKey()).toBe(relayKey);

    // The push source's playback URL is derived from that key, never stored; the pull source
    // still decrypts to what was written.
    const urls = await readOverlayVideoSourceUrls();
    expect(urls["push-cam"]).toBe(`rtsp://reader:${relayKey}@relay:8554/src-push-cam`);
    expect(urls["pull-cam"]).toBe("rtsp://user:secret@camera.example/stream");
    const storedUrl = await executeSql("SELECT encrypted_url FROM overlay_video_sources WHERE id = 'push-cam';");
    expect(storedUrl).toBe("");

    // The auth endpoint's reader sees the decrypted publish key; a pull source carries none.
    const credentials = await readOverlayVideoSourceIngestCredentials();
    expect(credentials.find((entry) => entry.id === "push-cam")?.publishKey).toBe("publish-key-roundtrip");
    expect(credentials.find((entry) => entry.id === "pull-cam")?.publishKey).toBe("");

    // Keep-on-empty custody: a rename without key options must not drop the stored key.
    await upsertOverlayVideoSourceRecord({ id: "push-cam", name: "Push camera renamed" });
    const renamed = (await listOverlayVideoSourceRecords()).find((entry) => entry.id === "push-cam");
    expect(renamed).toMatchObject({ name: "Push camera renamed", ingestKind: "push", publishKeyPresent: true });

    await deleteOverlayVideoSourceRecord("push-cam");
    await deleteOverlayVideoSourceRecord("pull-cam");

    // And it must never REPLACE the key either. A row this APP_SECRET can no longer decrypt is the
    // rotation case the generating reader recovers from by overwriting; the reveal surface's reader
    // answers "" and leaves the ciphertext byte-for-byte where it was, so a click during an
    // incident cannot invalidate the key every running container still holds.
    const storedCiphertext = await executeSql(
      `SELECT encrypted_value FROM managed_secrets WHERE id = '${RELAY_INTERNAL_KEY_SECRET_ID}';`
    );
    await executeSql(
      `UPDATE managed_secrets SET encrypted_value = 'not-decryptable-by-this-app-secret' WHERE id = '${RELAY_INTERNAL_KEY_SECRET_ID}';`
    );
    await resetDatabaseConnectionsForTests();
    await ensureDatabaseWithRetry();

    expect(await readRelayInternalKeyIfPresent()).toBe("");
    expect(
      await executeSql(`SELECT encrypted_value FROM managed_secrets WHERE id = '${RELAY_INTERNAL_KEY_SECRET_ID}';`)
    ).toBe("not-decryptable-by-this-app-secret");

    // Restore, so nothing after this block inherits a poisoned key.
    await executeSql(
      `UPDATE managed_secrets SET encrypted_value = '${storedCiphertext}' WHERE id = '${RELAY_INTERNAL_KEY_SECRET_ID}';`
    );
    await resetDatabaseConnectionsForTests();
    await ensureDatabaseWithRetry();
    expect(await readRelayInternalKeyIfPresent()).toBe(relayKey);
  }, 60_000);

  describe("schedule writes validated under the lock", () => {
    // The overlap check used to run against a state read before the write, leaving a window in
    // which another editor committed a block the check never saw: both writes succeeded and the
    // schedule ended up overlapping anyway, which the editor then refuses to save past.

    it("sees blocks already stored when it validates", async () => {
      const existingId = `block-existing-${randomUUID()}`;
      await createScheduleBlocks([
        {
          id: existingId,
          title: "Existing",
          categoryName: "Replay",
          startMinuteOfDay: 10 * 60,
          durationMinutes: 120,
          dayOfWeek: 4,
          poolId: "",
          sourceName: "Pool",
          repeatMode: "single",
          repeatGroupId: "",
          cuepointAssetId: "",
          cuepointOffsetsSeconds: []
        }
      ]);

      let seenExisting = false;
      await createScheduleBlocksChecked(
        [
          {
            id: `block-new-${randomUUID()}`,
            title: "New",
            categoryName: "Replay",
            startMinuteOfDay: 20 * 60,
            durationMinutes: 60,
            dayOfWeek: 4,
            poolId: "",
            sourceName: "Pool",
            repeatMode: "single",
            repeatGroupId: "",
            cuepointAssetId: "",
            cuepointOffsetsSeconds: []
          }
        ],
        (existing) => {
          seenExisting = existing.some((block) => block.id === existingId);
        }
      );

      expect(seenExisting).toBe(true);
    });

    it("writes nothing when the validator rejects", async () => {
      const rejectedId = `block-rejected-${randomUUID()}`;

      await expect(
        createScheduleBlocksChecked(
          [
            {
              id: rejectedId,
              title: "Rejected",
              categoryName: "Replay",
              startMinuteOfDay: 60,
              durationMinutes: 60,
              dayOfWeek: 5,
              poolId: "",
              sourceName: "Pool",
              repeatMode: "single",
              repeatGroupId: "",
              cuepointAssetId: "",
              cuepointOffsetsSeconds: []
            }
          ],
          () => {
            throw new Error("overlaps");
          }
        )
      ).rejects.toThrow("overlaps");

      const state = await readAppState();
      expect(state.scheduleBlocks.some((block) => block.id === rejectedId)).toBe(false);
    });
  });

  describe("moderator presence check-ins", () => {
    // expires_at used to be the primary key. It is the check-in time plus a duration picked from a
    // short list, so two moderators checking in during the same second for the same length produced
    // the identical value — and the insert runs inside the Twitch chat callback, where the unique
    // violation surfaced as a check-in that simply did not happen.

    it("accepts two check-ins that expire at the same instant", async () => {
      const expiresAt = "2026-08-19T21:00:00.000Z";
      const createdAt = "2026-08-19T20:30:00.000Z";

      await appendPresenceWindowRecord({
        actor: "first_moderator",
        minutes: 30,
        requestedMinutes: 30,
        appliedMinutes: 30,
        clampReason: "",
        createdAt,
        expiresAt
      });

      await expect(
        appendPresenceWindowRecord({
          actor: "second_moderator",
          minutes: 30,
          requestedMinutes: 30,
          appliedMinutes: 30,
          clampReason: "",
          createdAt,
          expiresAt
        })
      ).resolves.toBeUndefined();

      const state = await readAppState();
      const both = state.presenceWindows.filter((window) => window.expiresAt === expiresAt);
      expect(both.map((window) => window.actor).sort()).toEqual(["first_moderator", "second_moderator"]);
    });

    it("keeps the same actor's repeated check-in rather than replacing it", async () => {
      const expiresAt = "2026-08-19T22:00:00.000Z";
      for (let index = 0; index < 3; index += 1) {
        await appendPresenceWindowRecord({
          actor: "same_moderator",
          minutes: 30,
          requestedMinutes: 30,
          appliedMinutes: 30,
          clampReason: "",
          createdAt: "2026-08-19T21:30:00.000Z",
          expiresAt
        });
      }

      const state = await readAppState();
      expect(state.presenceWindows.filter((window) => window.expiresAt === expiresAt)).toHaveLength(3);
    });
  });

  describe("state writes and the live playout runtime", () => {
    // Why the blueprint import uses updateAppState instead of readAppState + writeAppState.
    //
    // The whole AppState is written as one row set, playout runtime included. A caller that reads the
    // state, spends time building a new one and then writes it back carries a snapshot of `playout`
    // from before the write -- so importing a blueprint while the channel was on air rewound the
    // worker's heartbeats, restart counters and uplink status to whatever they were when the request
    // began. updateAppState reads inside the same locked transaction it writes in, which is what
    // makes that impossible rather than merely unlikely.

    it("hands the updater state that already includes writes made after an earlier read", async () => {
      const staleSnapshot = await readAppState();

      await updatePlayoutRuntime((playout) => ({
        ...playout,
        restartCount: playout.restartCount + 7,
        uplinkStatus: "running"
      }));

      let observedRestartCount = -1;
      await updateAppState((current) => {
        observedRestartCount = current.playout.restartCount;
        return current;
      });

      expect(observedRestartCount).toBe(staleSnapshot.playout.restartCount + 7);
      // The read-then-write pattern would have written the left-hand value back over the right-hand
      // one, which is exactly the runtime loss this guards against.
      expect(staleSnapshot.playout.restartCount).not.toBe(observedRestartCount);
    });

    it("preserves a concurrent runtime advance across an unrelated state edit", async () => {
      const before = await readAppState();

      await updatePlayoutRuntime((playout) => ({ ...playout, restartCount: playout.restartCount + 3 }));

      await updateAppState((current) => ({ ...current, moderation: { ...current.moderation } }));

      const after = await readAppState();
      expect(after.playout.restartCount).toBe(before.playout.restartCount + 3);
    });
  });

  describe("quarantine counters and whole-state writes", () => {
    // M68 (2.1). persistState rewrites the assets table from the hydrated state and used to leave the
    // playback_probe_* columns out, so any app-state write zeroed every quarantine counter. On the DUT
    // that released eleven unplayable YouTube uploads back onto the air (skipped 11 of 11 on
    // 2026-09-13, counters 0-3 and nine of them playing on 2026-09-28).
    it("keeps a quarantined asset's counter through an unrelated updateAppState", async () => {
      await ensureDatabaseWithRetry();
      const initial = await readAppState();
      await writeAppState({
        ...initial,
        sources: [
          {
            id: "source_quarantine",
            name: "YouTube Channel",
            type: "YouTube channel",
            connectorKind: "youtube-channel",
            enabled: true,
            status: "Ready",
            externalUrl: "https://www.youtube.com/@example/videos",
            notes: "",
            lastSyncedAt: "2026-09-28T07:00:00.000Z"
          }
        ],
        assets: [
          {
            id: "asset_source_quarantine_j4YdbIbEc9E",
            sourceId: "source_quarantine",
            title: "Rotten upload",
            path: "https://www.youtube.com/watch?v=j4YdbIbEc9E",
            status: "ready",
            includeInProgramming: true,
            externalId: "j4YdbIbEc9E",
            durationSeconds: 255,
            fallbackPriority: 0,
            isGlobalFallback: false,
            createdAt: "2026-09-01T00:00:00.000Z",
            updatedAt: "2026-09-01T00:00:00.000Z"
          }
        ]
      });

      const error = "ERROR: [youtube] j4YdbIbEc9E: Requested format is not available.";
      await updateAssetPlaybackProbeRecords([
        {
          id: "asset_source_quarantine_j4YdbIbEc9E",
          playbackProbeFailures: 3,
          playbackProbeError: error,
          playbackProbedAt: "2026-09-28T08:11:42.642Z"
        }
      ]);

      // An edit that has nothing to do with assets -- the shape of a chat game start/stop.
      await updateAppState((current) => ({ ...current, moderation: { ...current.moderation } }));

      const after = await readAppState();
      const asset = after.assets.find((entry) => entry.id === "asset_source_quarantine_j4YdbIbEc9E");
      expect(asset?.playbackProbeFailures).toBe(3);
      expect(asset?.playbackProbeError).toBe(error);
      expect(asset?.playbackProbedAt).toBe("2026-09-28T08:11:42.642Z");
    });
  });

  describe("source sync and cache writes keep the asset order key", () => {
    // M72 (2.1). On the DUT (2026-10-01) every remote asset had published_at = '' and each source sync
    // rewrote created_at to "now", so the pool order key was one value per source and pools played
    // alphabetically. A VOD cache write also wrote back a snapshot taken before an hours-long download.
    const sourceId = "source_m72";
    const assetId = "asset_source_m72_2887855611";
    const baseAsset = {
      id: assetId,
      sourceId,
      title: "Archive stream",
      path: "https://www.twitch.tv/videos/2887855611",
      folderPath: "twitch-channel/m72",
      tags: [],
      status: "ready" as const,
      includeInProgramming: true,
      externalId: "2887855611",
      categoryName: "Just Chatting",
      durationSeconds: 3600,
      publishedAt: "2026-07-01T00:00:00.000Z",
      fallbackPriority: 100,
      isGlobalFallback: false,
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z"
    };

    async function seed() {
      await ensureDatabaseWithRetry();
      const initial = await readAppState();
      await writeAppState({
        ...initial,
        sources: [
          {
            id: sourceId,
            name: "M72 Twitch",
            type: "Twitch channel",
            connectorKind: "twitch-channel",
            enabled: true,
            status: "Ready",
            externalUrl: "https://www.twitch.tv/example",
            notes: "",
            lastSyncedAt: "2026-09-01T00:00:00.000Z"
          }
        ],
        assets: [baseAsset]
      });
    }

    it("keeps first-seen created_at, a known published_at and a known duration through a re-sync", async () => {
      await seed();
      const syncNow = "2026-10-01T12:00:00.000Z";
      await replaceAssetsForSourceIds(
        [sourceId],
        [
          { ...baseAsset, title: "Archive stream (renamed)", publishedAt: "", durationSeconds: 0, createdAt: syncNow, updatedAt: syncNow },
          {
            ...baseAsset,
            id: "asset_source_m72_2890000000",
            externalId: "2890000000",
            path: "https://www.twitch.tv/videos/2890000000",
            publishedAt: undefined,
            durationSeconds: 1800,
            createdAt: syncNow,
            updatedAt: syncNow
          }
        ]
      );

      const after = await readAppState();
      const kept = after.assets.find((entry) => entry.id === assetId);
      expect(kept).toMatchObject({
        createdAt: "2026-09-01T00:00:00.000Z",
        publishedAt: "2026-07-01T00:00:00.000Z",
        durationSeconds: 3600,
        updatedAt: syncNow,
        // Title behaviour is unchanged by M72: the listing's title still wins.
        title: "Archive stream (renamed)"
      });
      const added = after.assets.find((entry) => entry.id === "asset_source_m72_2890000000");
      expect(added).toMatchObject({ createdAt: syncNow, publishedAt: "", durationSeconds: 1800 });
    });

    it("writes only cache columns from a VOD cache result", async () => {
      await seed();
      const before = (await readAppState()).assets.find((entry) => entry.id === assetId);
      expect(before).toBeDefined();

      await updateAssetCacheRecords([
        {
          id: assetId,
          cachePath: "/media/.stream247-cache/twitch/2887855611.mp4",
          cacheStatus: "ready",
          cacheUpdatedAt: "2026-10-01T13:00:00.000Z",
          cacheError: "",
          updatedAt: "2026-10-01T13:00:00.000Z"
        },
        // A row a sync removed while the download ran: nothing to update, nothing raised.
        { id: "asset_gone", cachePath: "", cacheStatus: "failed", cacheUpdatedAt: "2026-10-01T13:00:00.000Z", cacheError: "gone" }
      ]);

      const after = (await readAppState()).assets.find((entry) => entry.id === assetId);
      expect(after).toMatchObject({
        cachePath: "/media/.stream247-cache/twitch/2887855611.mp4",
        cacheStatus: "ready",
        cacheUpdatedAt: "2026-10-01T13:00:00.000Z",
        cacheError: "",
        updatedAt: "2026-10-01T13:00:00.000Z"
      });
      // Every other column, title, category, dates, include flag and chapters included, is as it was.
      const withoutCacheColumns = (record: typeof after) => ({
        ...record,
        cachePath: undefined,
        cacheStatus: undefined,
        cacheUpdatedAt: undefined,
        cacheError: undefined,
        updatedAt: undefined
      });
      expect(withoutCacheColumns(after)).toEqual(withoutCacheColumns(before));
    });
  });

  describe("pool source positions", () => {
    // M73 (2.1). A pool with several sources alternates between them; each source's position lives in
    // pools.source_cursors. On the DUT (2026-10-01) pool "TwitchYoutube" had only cursor_asset_id, on a
    // Twitch archive, and the pools route wrote that cursor back from a snapshot on every edit.
    const twitchSourceId = "source_m73_twitch";
    const youtubeSourceId = "source_m73_youtube";
    const poolId = "pool_m73";
    const asset = (id: string, sourceId: string, day: number) => ({
      id,
      sourceId,
      title: `M73 ${id}`,
      path: `https://example.invalid/${id}`,
      folderPath: "",
      tags: [],
      status: "ready" as const,
      includeInProgramming: true,
      externalId: "",
      categoryName: "",
      durationSeconds: 600,
      publishedAt: "",
      fallbackPriority: 100,
      isGlobalFallback: false,
      createdAt: `2026-09-0${String(day)}T00:00:00.000Z`,
      updatedAt: `2026-09-0${String(day)}T00:00:00.000Z`
    });
    const source = (id: string, connectorKind: "twitch-channel" | "youtube-channel") => ({
      id,
      name: id,
      type: connectorKind,
      connectorKind,
      enabled: true,
      status: "Ready",
      externalUrl: `https://example.invalid/${id}`,
      notes: "",
      lastSyncedAt: "2026-09-01T00:00:00.000Z"
    });

    async function seed(pool: { cursorAssetId: string; sourceCursors: Record<string, string> }) {
      await ensureDatabaseWithRetry();
      const initial = await readAppState();
      await writeAppState({
        ...initial,
        sources: [source(twitchSourceId, "twitch-channel"), source(youtubeSourceId, "youtube-channel")],
        assets: [asset("t1", twitchSourceId, 1), asset("t2", twitchSourceId, 2), asset("y1", youtubeSourceId, 1)],
        pools: [
          {
            id: poolId,
            name: "TwitchYoutube",
            sourceIds: [twitchSourceId, youtubeSourceId],
            playbackMode: "round-robin",
            insertAssetId: "",
            insertEveryItems: 0,
            itemsSinceInsert: 0,
            audioLaneAssetId: "",
            audioLaneVolumePercent: 100,
            updatedAt: "2026-09-01T00:00:00.000Z",
            ...pool
          }
        ],
        scheduleBlocks: []
      });
    }

    async function readPool() {
      const pool = (await readAppState()).pools.find((entry) => entry.id === poolId);
      expect(pool).toBeDefined();
      return pool!;
    }

    it("adds source_cursors to a database whose pools table predates it", async () => {
      await ensureDatabaseWithRetry();
      await executeSql(`
        ALTER TABLE pools DROP COLUMN IF EXISTS source_cursors;
        DELETE FROM schema_migrations WHERE id = '${poolSourceCursorsMigrationId}';
        INSERT INTO pools (id, name, source_ids, cursor_asset_id) VALUES ('pool_m73_old', 'Old', '["source_x"]', 'asset_x');
      `);

      await resetDatabaseConnectionsForTests();
      await ensureDatabaseWithRetry();

      const columnDefault = await executeSql(
        "SELECT column_default FROM information_schema.columns WHERE table_name = 'pools' AND column_name = 'source_cursors';"
      );
      const migrationApplied = await executeSql(`SELECT COUNT(*) FROM schema_migrations WHERE id = '${poolSourceCursorsMigrationId}';`);
      const oldPool = (await readAppState()).pools.find((entry) => entry.id === "pool_m73_old");

      expect(columnDefault).toBe("'{}'::text");
      expect(migrationApplied).toBe("1");
      expect(oldPool?.cursorAssetId).toBe("asset_x");
      expect(oldPool?.sourceCursors).toEqual({});
      expect(DECLARED_SCHEMA.pools).toContain("source_cursors");
    }, 60_000);

    it("lets the stored cursor overwrite a stale position of its own source", async () => {
      // What an image older than 2.1 leaves after a rollback: it moved the cursor to t2 and never
      // touched the map, which still says t1.
      await seed({ cursorAssetId: "t2", sourceCursors: { [twitchSourceId]: "t1", [youtubeSourceId]: "y1" } });

      await updatePoolCursor(poolId, "y1", { sourceId: youtubeSourceId });
      expect(await readPool()).toMatchObject({
        cursorAssetId: "y1",
        sourceCursors: { [twitchSourceId]: "t2", [youtubeSourceId]: "y1" }
      });
    }, 60_000);

    it("merges cursor writes per source, keeps the old cursor as its source's position and survives whole-state writes", async () => {
      await seed({ cursorAssetId: "t1", sourceCursors: {} });

      await updatePoolCursor(poolId, "y1", { sourceId: youtubeSourceId, incrementItemsSinceInsert: true });
      expect(await readPool()).toMatchObject({
        cursorAssetId: "y1",
        sourceCursors: { [twitchSourceId]: "t1", [youtubeSourceId]: "y1" },
        itemsSinceInsert: 1
      });

      await updatePoolCursor(poolId, "t2", { sourceId: twitchSourceId, incrementItemsSinceInsert: true });
      await updatePoolCursor(poolId, null, { resetItemsSinceInsert: true });
      await updateAppState((state) => ({ ...state, overlay: { ...state.overlay, channelName: "M73" } }));

      expect(await readPool()).toMatchObject({
        cursorAssetId: "t2",
        sourceCursors: { [twitchSourceId]: "t2", [youtubeSourceId]: "y1" },
        itemsSinceInsert: 0
      });
      expect(JSON.parse(await executeSql(`SELECT source_cursors FROM pools WHERE id = '${poolId}';`))).toEqual({
        [twitchSourceId]: "t2",
        [youtubeSourceId]: "y1"
      });
    }, 60_000);

    it("keeps the stored position through a pool edit made from an older snapshot", async () => {
      await seed({ cursorAssetId: "t1", sourceCursors: { [twitchSourceId]: "t1", [youtubeSourceId]: "y1" } });
      const snapshot = await readPool();

      // The worker starts the next item while the edit form is open.
      await updatePoolCursor(poolId, "t2", { sourceId: twitchSourceId, incrementItemsSinceInsert: true });
      await updatePoolRecord({ ...snapshot, name: "Renamed", updatedAt: "2026-10-01T12:00:00.000Z" });

      expect(await readPool()).toMatchObject({
        name: "Renamed",
        cursorAssetId: "t2",
        sourceCursors: { [twitchSourceId]: "t2", [youtubeSourceId]: "y1" },
        itemsSinceInsert: 1
      });

      await updatePoolRecord({ ...snapshot, sourceIds: [twitchSourceId], updatedAt: "2026-10-01T12:05:00.000Z" });
      expect(await readPool()).toMatchObject({
        sourceIds: [twitchSourceId],
        cursorAssetId: "t2",
        sourceCursors: { [twitchSourceId]: "t2" },
        itemsSinceInsert: 1
      });
    }, 60_000);
  });

  // M75. The breaker of the DUT's YouTube source (2026-09-28: 0 of 11 items resolvable).
  describe("source circuit breakers", () => {
    const youtubeSourceId = "source_m75_youtube";
    const twitchSourceId = "source_m75_twitch";
    const failed = (assetId: string, sourceId = youtubeSourceId) => ({
      sourceId,
      assetId,
      outcome: "failed" as const,
      error: "Requested format is not available"
    });
    const breakerOf = async (sourceId = youtubeSourceId) =>
      (await readAppState()).sourceBreakers.find((record) => record.sourceId === sourceId);

    async function seedSources() {
      await ensureDatabaseWithRetry();
      await executeSql("DELETE FROM source_breakers;");
      const initial = await readAppState();
      await writeAppState({
        ...initial,
        sources: [youtubeSourceId, twitchSourceId].map((id) => ({
          id,
          name: id,
          type: "youtube-channel",
          connectorKind: "youtube-channel" as const,
          enabled: true,
          status: "Ready",
          externalUrl: `https://example.invalid/${id}`,
          notes: "",
          lastSyncedAt: "2026-09-28T00:00:00.000Z"
        }))
      });
    }

    it("creates source_breakers on a database that predates it", async () => {
      await ensureDatabaseWithRetry();
      await executeSql(`
        DROP TABLE IF EXISTS source_breakers;
        DELETE FROM schema_migrations WHERE id = '${sourceBreakersMigrationId}';
      `);

      await resetDatabaseConnectionsForTests();
      await ensureDatabaseWithRetry();

      const columns = await executeSql(
        "SELECT string_agg(column_name, ',' ORDER BY column_name) FROM information_schema.columns WHERE table_name = 'source_breakers';"
      );
      const migrationApplied = await executeSql(`SELECT COUNT(*) FROM schema_migrations WHERE id = '${sourceBreakersMigrationId}';`);
      expect(columns.split(",")).toEqual(DECLARED_SCHEMA.source_breakers);
      expect(migrationApplied).toBe("1");
      expect((await readAppState()).sourceBreakers).toEqual([]);
    }, 60_000);

    it("opens on three distinct items, survives a restart and a whole-state write from an older snapshot", async () => {
      await seedSources();
      const before = await readAppState();

      const first = await recordSourceBreakerOutcomes([failed("y1"), failed("y2")], "2026-09-28T10:00:00.000Z");
      expect(first.transitions).toEqual([]);
      const opened = await recordSourceBreakerOutcomes([failed("y3")], "2026-09-28T10:01:00.000Z");
      expect(opened.transitions.map((transition) => transition.kind)).toEqual(["opened"]);
      expect(opened.records.find((record) => record.sourceId === youtubeSourceId)?.state).toBe("open");

      await resetDatabaseConnectionsForTests();
      await ensureDatabaseWithRetry();
      // A whole-state write from a snapshot read before the breaker opened must not close it again.
      await writeAppState(before);

      expect(await breakerOf()).toEqual({
        sourceId: youtubeSourceId,
        state: "open",
        failedAssetIds: ["y1", "y2", "y3"],
        openedAt: "2026-09-28T10:01:00.000Z",
        cooldownSeconds: 1800,
        lastError: "Requested format is not available",
        updatedAt: "2026-09-28T10:01:00.000Z"
      });
      expect(await breakerOf(twitchSourceId)).toBeUndefined();
    }, 60_000);

    it("re-opens a failed trial with the doubled cooldown and closes on a clean one", async () => {
      await seedSources();
      await recordSourceBreakerOutcomes([failed("y1"), failed("y2"), failed("y3")], "2026-09-28T10:00:00.000Z");

      // Outcomes while the cooldown runs change nothing and write nothing.
      const during = await recordSourceBreakerOutcomes([failed("y4")], "2026-09-28T10:10:00.000Z");
      expect(during.updates).toEqual([]);

      const reopened = await recordSourceBreakerOutcomes([failed("y4")], "2026-09-28T10:30:00.000Z");
      expect(reopened.transitions.map((transition) => transition.kind)).toEqual(["reopened"]);
      expect(await breakerOf()).toMatchObject({ state: "open", openedAt: "2026-09-28T10:30:00.000Z", cooldownSeconds: 3600 });

      const closed = await recordSourceBreakerOutcomes(
        [{ sourceId: youtubeSourceId, assetId: "y5", outcome: "ok", error: "" }],
        "2026-09-28T11:30:00.000Z"
      );
      expect(closed.transitions.map((transition) => transition.kind)).toEqual(["closed"]);
      expect(await breakerOf()).toMatchObject({ state: "closed", failedAssetIds: [], openedAt: "", cooldownSeconds: 0 });
    }, 60_000);

    // Combination review. The playout records an outcome before every switch that resolved inline and
    // about four per five minutes from the queue; nearly all of them change no row. Each used to queue
    // behind the state-write lock, which a whole-state write of the web or the worker holds while it
    // hydrates and persists the state.
    it("takes the state-write lock only for an outcome that changes a row", async () => {
      await seedSources();
      const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
      const locks = (granted: boolean) =>
        executeSql(
          `SELECT COUNT(*) FROM pg_locks WHERE locktype = 'advisory' AND objid = 247001 AND ${granted ? "granted" : "NOT granted"};`
        );
      const until = async (condition: () => Promise<boolean>) => {
        for (let attempt = 0; attempt < 50 && !(await condition()); attempt += 1) {
          await pause(100);
        }
      };

      // Another writer holds the lock (STATE_WRITE_LOCK_KEY) for six seconds.
      const holder = executeSql("BEGIN; SELECT pg_advisory_xact_lock(247001); SELECT pg_sleep(6); COMMIT;");
      await until(async () => (await locks(true)) === "1");
      expect(await locks(true)).toBe("1");

      // A clean probe of a source without failures is answered while the lock is held, with the rows.
      const clean = await recordSourceBreakerOutcomes(
        [{ sourceId: youtubeSourceId, assetId: "y1", outcome: "ok", error: "" }],
        "2026-09-28T10:00:00.000Z"
      );
      expect(clean).toEqual({ updates: [], transitions: [], records: [] });
      expect(await locks(true)).toBe("1");
      expect(await locks(false)).toBe("0");

      // A failure changes the row: it waits for the lock and is planned from the rows as they are then.
      let settled = false;
      const counted = recordSourceBreakerOutcomes([failed("y1")], "2026-09-28T10:00:30.000Z").then((result) => {
        settled = true;
        return result;
      });
      await until(async () => (await locks(false)) === "1");
      expect(await locks(false)).toBe("1");
      expect(settled).toBe(false);

      await holder;
      const result = await counted;
      expect(result.updates.map((record) => record.failedAssetIds)).toEqual([["y1"]]);
      expect(await breakerOf()).toMatchObject({ state: "closed", failedAssetIds: ["y1"] });
    }, 60_000);

    it("lets an operator close an open breaker, and forgets the breaker of a deleted source", async () => {
      await seedSources();
      await recordSourceBreakerOutcomes([failed("y1"), failed("y2"), failed("y3")], "2026-09-28T10:00:00.000Z");

      const closed = await closeSourceBreakerRecord(youtubeSourceId, "2026-09-28T10:05:00.000Z");
      expect(closed).toMatchObject({ state: "open", openedAt: "2026-09-28T10:00:00.000Z" });
      expect(await breakerOf()).toMatchObject({ state: "closed", updatedAt: "2026-09-28T10:05:00.000Z" });
      expect(await closeSourceBreakerRecord(youtubeSourceId, "2026-09-28T10:06:00.000Z")).toBeNull();

      await recordSourceBreakerOutcomes([failed("y1")], "2026-09-28T10:07:00.000Z");
      await deleteSourceRecordAndAssets(youtubeSourceId);
      expect(await breakerOf()).toBeUndefined();
      // A probe that finishes after its source was deleted leaves no row behind.
      await recordSourceBreakerOutcomes([failed("y2"), failed("y3"), failed("y4")], "2026-09-28T10:08:00.000Z");
      expect(await breakerOf()).toBeUndefined();
    }, 60_000);
  });

  // M76. One row per playout run; the question is "what was on air at 19:38" (17:38 UTC, 2026-10-01).
  describe("as-run log", () => {
    const run = (id: string, startedAt: string, overrides: Partial<AsRunRecord> = {}): AsRunRecord => ({
      id,
      startedAt,
      endedAt: "",
      targetKind: "asset",
      assetId: `asset_${id}`,
      title: `Title ${id}`,
      sourceId: "source_m76",
      poolId: "pool_m76",
      blockId: "block_m76",
      reasonCode: "scheduled_match",
      queueKind: "asset",
      inputKind: "local",
      formatId: "",
      formatCandidate: "",
      plannedSeconds: 2700,
      airedSeconds: 0,
      endReason: "",
      exitCode: "",
      ...overrides
    });
    const all = () => listAsRunRecords({ fromIso: "2000-01-01T00:00:00.000Z", toIso: "2100-01-01T00:00:00.000Z", limit: 1000 });

    it("creates as_run_log and its index on a database that predates it", async () => {
      await ensureDatabaseWithRetry();
      await executeSql(`
        DROP TABLE IF EXISTS as_run_log;
        DELETE FROM schema_migrations WHERE id = '${asRunLogMigrationId}';
      `);

      await resetDatabaseConnectionsForTests();
      await ensureDatabaseWithRetry();

      const columns = await executeSql(
        "SELECT string_agg(column_name, ',' ORDER BY column_name) FROM information_schema.columns WHERE table_name = 'as_run_log';"
      );
      expect(columns.split(",")).toEqual(DECLARED_SCHEMA.as_run_log);
      expect(await executeSql(`SELECT COUNT(*) FROM schema_migrations WHERE id = '${asRunLogMigrationId}';`)).toBe("1");
      expect(await executeSql("SELECT COUNT(*) FROM pg_indexes WHERE indexname = 'as_run_log_started_at_idx';")).toBe("1");
      expect(await executeSql("SELECT COUNT(*) FROM pg_indexes WHERE indexname = 'as_run_log_open_idx';")).toBe("1");
      expect(await all()).toEqual([]);
    }, 60_000);

    it("records a start, completes it, survives a whole-state write and answers what was on air at a moment", async () => {
      await ensureDatabaseWithRetry();
      await executeSql("DELETE FROM as_run_log;");
      const before = await readAppState();

      await recordAsRunStart(run("a", "2026-10-01T17:00:00.000Z", { inputKind: "pair", formatId: "299+140", formatCandidate: "pair-1080" }));
      expect(
        await recordAsRunEnd("a", { endedAt: "2026-10-01T17:44:58.600Z", airedSeconds: 2699, endReason: "natural-end", exitCode: "0" })
      ).toBe(true);
      await recordAsRunStart(run("b", "2026-10-01T17:45:01.000Z", { targetKind: "fallback", reasonCode: "global_fallback", poolId: "" }));
      await writeAppState(before);

      const atMoment = await listAsRunRecords({ fromIso: "2026-10-01T17:38:00.000Z", toIso: "2026-10-01T17:38:00.000Z", limit: 200 });
      expect(atMoment).toEqual([
        run("a", "2026-10-01T17:00:00.000Z", {
          endedAt: "2026-10-01T17:44:58.600Z",
          inputKind: "pair",
          formatId: "299+140",
          formatCandidate: "pair-1080",
          airedSeconds: 2699,
          endReason: "natural-end",
          exitCode: "0"
        })
      ]);
      // The run still on air overlaps every window from its start on; newest first.
      const day = await listAsRunRecords({ fromIso: "2026-09-30T18:00:00.000Z", toIso: "2026-10-01T18:00:00.000Z", limit: 200 });
      expect(day.map((record) => [record.id, record.endedAt])).toEqual([
        ["b", ""],
        ["a", "2026-10-01T17:44:58.600Z"]
      ]);
      expect((await listAsRunRecords({ fromIso: "2026-09-30T18:00:00.000Z", toIso: "2026-10-01T18:00:00.000Z", limit: 1 })).map((r) => r.id)).toEqual(["b"]);
      expect(await listAsRunRecords({ fromIso: "2026-10-01T16:00:00.000Z", toIso: "2026-10-01T16:59:59.000Z", limit: 200 })).toEqual([]);
    }, 60_000);

    it("closes a run nobody saw end as process gone, at the boot or the next start, never two on air", async () => {
      await ensureDatabaseWithRetry();
      await executeSql("DELETE FROM as_run_log;");

      // A redeploy kills the playout with ffmpeg running: the next boot closes the row.
      await recordAsRunStart(run("c", "2026-10-01T17:00:00.000Z"));
      expect(await closeOpenAsRunRecords("2026-10-01T17:10:00.400Z")).toBe(1);
      // The exit that arrives after that changes nothing.
      expect(
        await recordAsRunEnd("c", { endedAt: "2026-10-01T17:12:00.000Z", airedSeconds: 720, endReason: "switch", exitCode: "SIGTERM" })
      ).toBe(false);

      // A process that outlived its stop deadline: the next start closes it, at that start.
      await recordAsRunStart(run("d", "2026-10-01T17:20:00.000Z"));
      await recordAsRunStart(run("e", "2026-10-01T17:30:00.000Z", { targetKind: "standby", inputKind: "slate", assetId: "" }));
      // A boot time before a row's start (clock skew between containers) never ends a run before it began.
      await recordAsRunStart(run("f", "2026-10-01T17:40:00.000Z"));
      await closeOpenAsRunRecords("2026-10-01T17:39:00.000Z");

      const rows = new Map((await all()).map((record) => [record.id, record] as const));
      expect(rows.get("c")).toMatchObject({ endedAt: "2026-10-01T17:10:00.400Z", airedSeconds: 600, endReason: "process-gone", exitCode: "" });
      expect(rows.get("d")).toMatchObject({ endedAt: "2026-10-01T17:30:00.000Z", airedSeconds: 600, endReason: "process-gone" });
      expect(rows.get("e")).toMatchObject({ endedAt: "2026-10-01T17:40:00.000Z", endReason: "process-gone" });
      expect(rows.get("f")).toMatchObject({ endedAt: "2026-10-01T17:40:00.000Z", airedSeconds: 0, endReason: "process-gone" });
      expect(await executeSql("SELECT COUNT(*) FROM as_run_log WHERE ended_at = '';")).toBe("0");
    }, 60_000);

    it("deletes runs older than the retention window in the write that adds a start", async () => {
      await ensureDatabaseWithRetry();
      await executeSql("DELETE FROM as_run_log;");

      await recordAsRunStart(run("old", "2026-07-02T17:00:00.000Z"));
      await recordAsRunEnd("old", { endedAt: "2026-07-02T17:45:00.000Z", airedSeconds: 2700, endReason: "natural-end", exitCode: "0" });
      await recordAsRunStart(run("kept", "2026-07-04T17:00:00.000Z"));
      await recordAsRunEnd("kept", { endedAt: "2026-07-04T17:45:00.000Z", airedSeconds: 2700, endReason: "natural-end", exitCode: "0" });
      // 90 days after 2026-07-03T17:00Z: "old" started before that, "kept" after.
      await recordAsRunStart(run("now", "2026-10-01T17:00:00.000Z"));

      expect((await all()).map((record) => record.id)).toEqual(["now", "kept"]);
    }, 60_000);
  });

  describe("operator actions are never lost (M89)", () => {
    const removeNextHoldMigrationId = "20261002_002_remove_next_hold";

    it("adds the Remove next hold to a database whose playout_runtime predates it", async () => {
      await ensureDatabaseWithRetry();
      await executeSql(`
        ALTER TABLE playout_runtime DROP COLUMN IF EXISTS remove_next_asset_id;
        ALTER TABLE playout_runtime DROP COLUMN IF EXISTS remove_next_until;
        DELETE FROM schema_migrations WHERE id = '${removeNextHoldMigrationId}';
        UPDATE playout_runtime SET skip_asset_id = 'asset_old_hold', skip_until = '2099-01-01T00:00:00.000Z';
      `);

      await resetDatabaseConnectionsForTests();
      await ensureDatabaseWithRetry();

      const columns = await executeSql(
        "SELECT column_name || '=' || column_default FROM information_schema.columns WHERE table_name = 'playout_runtime' AND column_name LIKE 'remove_next_%' ORDER BY column_name;"
      );
      expect(columns.split("\n")).toEqual(["remove_next_asset_id=''::text", "remove_next_until=''::text"]);
      expect(await executeSql(`SELECT COUNT(*) FROM schema_migrations WHERE id = '${removeNextHoldMigrationId}';`)).toBe("1");
      const migrated = (await readAppState()).playout;
      // A Remove next pressed before the upgrade stays what it was, a skip hold, until it runs out.
      expect({ skip: migrated.skipAssetId, removeNext: migrated.removeNextAssetId }).toEqual({ skip: "asset_old_hold", removeNext: "" });
      expect(DECLARED_SCHEMA.playout_runtime).toEqual(expect.arrayContaining(["remove_next_asset_id", "remove_next_until"]));

      await updatePlayoutRuntime((playout) => ({ ...playout, removeNextAssetId: "asset_c", removeNextUntil: "2099-01-01T00:00:00.000Z" }));
      await updatePlayoutRuntime((playout) => ({ ...playout, skipAssetId: "asset_b", skipUntil: "2099-01-01T00:00:00.000Z" }));
      const after = (await readAppState()).playout;
      expect(after).toMatchObject({ skipAssetId: "asset_b", removeNextAssetId: "asset_c", removeNextUntil: "2099-01-01T00:00:00.000Z" });
    }, 60_000);

    // R3's W4 run (planning/research/robustness.md, restart-flag-swallowed): the real updatePlayoutRuntime
    // on real Postgres, with the updaters the code uses. Before M89 the cycle-end write set the flag from a
    // constant and the next cycle read "".
    it("keeps a Restart and a Refresh pressed while a playout cycle runs for the next cycle", async () => {
      await ensureDatabaseWithRetry();
      await updatePlayoutRuntime((playout) => ({ ...playout, restartRequestedAt: "", pendingAction: "", pendingActionRequestedAt: "" }));

      // Cycle N starts and reads the row.
      const cycleRead = (await readAppState()).playout;

      // The admin presses Restart, then Refresh, while cycle N resolves its input (broadcast.ts).
      const pressedAt = new Date().toISOString();
      await updatePlayoutRuntime((playout) => ({
        ...playout,
        status: "recovering",
        restartRequestedAt: pressedAt,
        heartbeatAt: pressedAt,
        pendingAction: "",
        pendingActionRequestedAt: "",
        message: "Manual playout restart requested from the admin API."
      }));
      const refreshAt = new Date(Date.parse(pressedAt) + 1).toISOString();
      await updatePlayoutRuntime((playout) => ({ ...playout, pendingAction: "refresh", pendingActionRequestedAt: refreshAt }));

      // Cycle N's end write (index.ts), from what it read.
      await updatePlayoutRuntime((playout) => ({
        ...playout,
        restartRequestedAt: decideCycleEndRestartFlag({
          consumed: cycleRead.restartRequestedAt,
          row: playout.restartRequestedAt,
          keepReconnectWindow: false
        }),
        ...decideCycleEndPendingAction({ consumed: cycleRead, row: playout })
      }));

      const nextCycle = (await readAppState()).playout;
      expect(nextCycle.restartRequestedAt).toBe(pressedAt);
      expect({ action: nextCycle.pendingAction, at: nextCycle.pendingActionRequestedAt }).toEqual({ action: "refresh", at: refreshAt });

      // Cycle N+1 acts on both and clears exactly them.
      await updatePlayoutRuntime((playout) => ({
        ...playout,
        restartRequestedAt: decideCycleEndRestartFlag({
          consumed: nextCycle.restartRequestedAt,
          row: playout.restartRequestedAt,
          keepReconnectWindow: false
        }),
        ...decideCycleEndPendingAction({ consumed: nextCycle, row: playout })
      }));
      const cleared = (await readAppState()).playout;
      expect({ restart: cleared.restartRequestedAt, action: cleared.pendingAction }).toEqual({ restart: "", action: "" });
    }, 60_000);
  });

  describe("local file durations (M96)", () => {
    const durationProbeKeyMigrationId = "20261003_002_asset_duration_probe_key";
    const localSourceId = "source-local-library";
    const localAsset = (id: string, durationSeconds: number, durationProbeKey: string) => ({
      id,
      sourceId: localSourceId,
      title: id,
      path: `/app/data/media/${id}.mp4`,
      folderPath: "",
      tags: [],
      status: "ready" as const,
      includeInProgramming: true,
      durationSeconds,
      durationProbeKey,
      fallbackPriority: 100,
      isGlobalFallback: false,
      createdAt: "2026-10-03T12:00:00.000Z",
      updatedAt: "2026-10-03T12:00:00.000Z"
    });

    async function seedLocalSource() {
      await ensureDatabaseWithRetry();
      const initial = await readAppState();
      await writeAppState({
        ...initial,
        sources: [
          {
            id: localSourceId,
            name: "Local Media Library",
            type: "Filesystem scan",
            connectorKind: "local-library",
            enabled: true,
            status: "Ready",
            externalUrl: "",
            notes: "",
            lastSyncedAt: "2026-10-03T12:00:00.000Z"
          }
        ],
        assets: []
      });
    }

    it("adds the probe-key column to a database whose assets predate it, and old rows read never probed", async () => {
      await seedLocalSource();
      await executeSql(`
        ALTER TABLE assets DROP COLUMN IF EXISTS duration_probe_key;
        DELETE FROM schema_migrations WHERE id = '${durationProbeKeyMigrationId}';
        INSERT INTO assets (id, source_id, title, path, status, created_at, updated_at)
        VALUES ('asset_before_m96', '${localSourceId}', 'Folge 1', '/app/data/media/folge-1.mp4', 'ready', '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z');
      `);

      await resetDatabaseConnectionsForTests();
      await ensureDatabaseWithRetry();

      expect(
        await executeSql(
          "SELECT column_name || '=' || column_default FROM information_schema.columns WHERE table_name = 'assets' AND column_name = 'duration_probe_key';"
        )
      ).toBe("duration_probe_key=''::text");
      expect(await executeSql(`SELECT COUNT(*) FROM schema_migrations WHERE id = '${durationProbeKeyMigrationId}';`)).toBe("1");
      expect(DECLARED_SCHEMA.assets).toContain("duration_probe_key");
      const old = (await readAppState()).assets.find((asset) => asset.id === "asset_before_m96");
      expect({ durationSeconds: old?.durationSeconds, durationProbeKey: old?.durationProbeKey }).toEqual({ durationSeconds: 0, durationProbeKey: "" });
    }, 60_000);

    it("keeps the probed duration and its file version through a scan write and an unrelated app-state write", async () => {
      await seedLocalSource();
      await replaceAssetsForSourceIds([localSourceId], [localAsset("folge_1", 120, "1048576:1759500000000")]);
      const probed = async () => (await readAppState()).assets.find((asset) => asset.id === "folge_1");
      expect(await probed()).toMatchObject({ durationSeconds: 120, durationProbeKey: "1048576:1759500000000" });

      // The shape of a chat game start/stop: the whole assets table is written again.
      await updateAppState((current) => ({ ...current, moderation: { ...current.moderation } }));
      expect(await probed()).toMatchObject({ durationSeconds: 120, durationProbeKey: "1048576:1759500000000" });

      // A remote-style write without a key keeps the stored key and the known duration.
      await replaceAssetsForSourceIds([localSourceId], [{ ...localAsset("folge_1", 0, ""), durationProbeKey: undefined }]);
      expect(await probed()).toMatchObject({ durationSeconds: 120, durationProbeKey: "1048576:1759500000000" });

      // A replaced file whose probe failed: unknown for the new version, not the old file's 120 s.
      await replaceAssetsForSourceIds([localSourceId], [localAsset("folge_1", 0, "2048:1759600000000")]);
      expect(await probed()).toMatchObject({ durationSeconds: 0, durationProbeKey: "2048:1759600000000" });
    }, 60_000);
  });

  describe("dated schedule blocks (M93)", () => {
    const scheduleBlockDatesMigrationId = "20261003_001_schedule_block_dates";
    const datedBlock = (id: string, dayOfWeek: number, validFrom: string, validUntil: string, repeatGroupId = "") => ({
      id,
      title: `Dated ${id}`,
      categoryName: "Special",
      dayOfWeek,
      startMinuteOfDay: 20 * 60,
      durationMinutes: 120,
      poolId: "pool_dated",
      sourceName: "Pool",
      repeatMode: (repeatGroupId ? "daily" : "single") as "daily" | "single",
      repeatGroupId,
      cuepointAssetId: "",
      cuepointOffsetsSeconds: [],
      validFrom,
      validUntil
    });

    it("adds the two date columns to a database whose schedule_blocks predates them, and old rows stay undated", async () => {
      await ensureDatabaseWithRetry();
      await replaceAllScheduleBlocks([]);
      await executeSql(`
        ALTER TABLE schedule_blocks DROP COLUMN IF EXISTS valid_from;
        ALTER TABLE schedule_blocks DROP COLUMN IF EXISTS valid_until;
        DELETE FROM schema_migrations WHERE id = '${scheduleBlockDatesMigrationId}';
        INSERT INTO schedule_blocks (id, title, category_name, start_hour, start_minute_of_day, duration_minutes, day_of_week, source_name)
        VALUES ('block_before_m93', 'Weekly', 'Replay', 18, 1080, 240, 4, 'Pool');
      `);

      await resetDatabaseConnectionsForTests();
      await ensureDatabaseWithRetry();

      const columns = await executeSql(
        "SELECT column_name || '=' || column_default FROM information_schema.columns WHERE table_name = 'schedule_blocks' AND column_name LIKE 'valid_%' ORDER BY column_name;"
      );
      expect(columns.split("\n")).toEqual(["valid_from=''::text", "valid_until=''::text"]);
      expect(await executeSql(`SELECT COUNT(*) FROM schema_migrations WHERE id = '${scheduleBlockDatesMigrationId}';`)).toBe("1");
      expect(DECLARED_SCHEMA.schedule_blocks).toEqual(expect.arrayContaining(["valid_from", "valid_until"]));
      const old = (await readAppState()).scheduleBlocks.find((block) => block.id === "block_before_m93");
      expect({ validFrom: old?.validFrom, validUntil: old?.validUntil }).toEqual({ validFrom: "", validUntil: "" });
    }, 60_000);

    it("round-trips the dates through every schedule writer", async () => {
      await ensureDatabaseWithRetry();
      await replaceAllScheduleBlocks([datedBlock("block_once", 6, "2026-10-10", "2026-10-10")]);
      const dates = async () =>
        Object.fromEntries(
          (await readAppState()).scheduleBlocks.map((block) => [block.id, `${block.validFrom}..${block.validUntil}`] as const)
        );
      expect(await dates()).toEqual({ block_once: "2026-10-10..2026-10-10" });

      await createScheduleBlocks([
        datedBlock("block_run_thu", 4, "2026-10-01", "2026-10-10", "repeat_run"),
        datedBlock("block_run_fri", 5, "2026-10-01", "2026-10-10", "repeat_run")
      ]);
      await createScheduleBlocksChecked([datedBlock("block_checked", 0, "2026-10-04", "")], () => undefined);
      expect(await dates()).toMatchObject({
        block_run_thu: "2026-10-01..2026-10-10",
        block_run_fri: "2026-10-01..2026-10-10",
        block_checked: "2026-10-04.."
      });

      await updateScheduleRepeatGroupRecords({
        repeatGroupId: "repeat_run",
        title: "Run",
        categoryName: "Special",
        startMinuteOfDay: 20 * 60,
        durationMinutes: 60,
        poolId: "pool_dated",
        sourceName: "Pool",
        validFrom: "2026-10-02",
        validUntil: "2026-10-12"
      });
      const once = (await readAppState()).scheduleBlocks.find((block) => block.id === "block_once")!;
      await updateScheduleBlockRecord({ ...once, validFrom: "", validUntil: "" });
      expect(await dates()).toMatchObject({
        block_once: "..",
        block_run_thu: "2026-10-02..2026-10-12",
        block_run_fri: "2026-10-02..2026-10-12"
      });

      // The whole-state writer keeps them too.
      await updateAppState((state) => ({
        ...state,
        scheduleBlocks: state.scheduleBlocks.map((block) => (block.id === "block_once" ? { ...block, validFrom: "2026-11-01", validUntil: "2026-11-01" } : block))
      }));
      expect(await dates()).toMatchObject({ block_once: "2026-11-01..2026-11-01", block_run_thu: "2026-10-02..2026-10-12" });
      await replaceAllScheduleBlocks([]);
    }, 60_000);
  });

  describe("audit trail durability", () => {
    it("keeps a security-relevant entry through a flood of routine worker heartbeats", async () => {
      await ensureDatabaseWithRetry();
      await executeSql("DELETE FROM audit_events;");
      await appendAuditEvent("relay.internal_key.revealed", "The relay internal key was revealed.");

      // The routine loop runs every 30 seconds. Far more cycles than the audit trail could ever
      // have held under the old 100-row ring, where this entry was gone inside fifteen minutes.
      for (let index = 0; index < 40; index += 1) {
        await updatePlayoutRuntime((playout) => ({
          ...playout,
          workerHeartbeatAt: new Date().toISOString()
        }));
      }

      const state = await readAppState();
      // The point of the change: routine traffic no longer occupies the trail at all, so it has
      // no way to displace anything, whatever the cap happens to be.
      expect(state.auditEvents.some((event) => event.type === "worker.cycle")).toBe(false);
      expect(state.auditEvents.some((event) => event.type === "uplink.cycle")).toBe(false);
      expect(state.auditEvents.some((event) => event.type === "relay.internal_key.revealed")).toBe(true);
      // And the heartbeat those cycles used to prove is still readable.
      expect(state.playout.workerHeartbeatAt).not.toBe("");
    }, 120_000);

    it("carries more than the old hundred-row cap through a state round trip", async () => {
      await ensureDatabaseWithRetry();
      await executeSql("DELETE FROM audit_events;");

      const seeded = Array.from({ length: 200 }, (_, index) => ({
        id: `audit_seed_${String(index).padStart(3, "0")}`,
        type: "settings.managed-config.updated",
        message: `Seeded entry ${index}`,
        createdAt: new Date(Date.UTC(2026, 8, 1, 0, 0, index)).toISOString()
      }));

      await updateAppState((current) => ({ ...current, auditEvents: seeded }));

      const reread = await readAppState();
      expect(reread.auditEvents).toHaveLength(200);
    }, 60_000);

    it("declares exactly the schema a real migrated database ends up with", async () => {
      /**
       * The only thing that has ever caught a fault in the manifest parser.
       *
       * schema-manifest.test.ts compares the manifest against the parser that produced it, so
       * anything the parser cannot see is invisible to it by construction. Adversarial review
       * demonstrated five such edits — a wrapped column definition contributing "default" as a
       * column, a commented-out ALTER, a multi-line CHECK swallowing five real columns, a closing
       * paren on the last column's line making a whole table disappear, and DROP/RENAME which the
       * manifest has no way to express — each of which passed the unit tests with a wrong manifest
       * and would then raise a critical incident on every boot of a healthy channel, forever.
       *
       * This asserts BOTH directions against a database that has actually run every migration.
       */
      await ensureDatabaseWithRetry();
      const dump = await executeSql(`
        SELECT c.relname || '|' || a.attname
        FROM pg_catalog.pg_attribute a
        JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND a.attnum > 0 AND NOT a.attisdropped
          AND c.relkind IN ('r', 'v', 'm', 'p');
      `);

      const live = new Map<string, Set<string>>();
      for (const line of dump.split("\n")) {
        const [table, column] = line.trim().split("|");
        if (!table || !column) {
          continue;
        }
        const columns = live.get(table) ?? new Set<string>();
        columns.add(column);
        live.set(table, columns);
      }
      expect(live.size).toBeGreaterThan(30);

      const declaredMissing: string[] = [];
      const declaredExtra: string[] = [];
      for (const [table, columns] of Object.entries(DECLARED_SCHEMA)) {
        const present = live.get(table);
        for (const column of columns) {
          if (!present?.has(column)) {
            declaredMissing.push(`${table}.${column}`);
          }
        }
      }
      for (const [table, columns] of live) {
        for (const column of columns) {
          if (!DECLARED_SCHEMA[table]?.includes(column)) {
            declaredExtra.push(`${table}.${column}`);
          }
        }
      }

      // Declared but absent is the fault the drift check exists for. Present but undeclared is the
      // parser having missed something, which is how a real column stops being watched at all.
      expect({ declaredMissing, declaredExtra }).toEqual({ declaredMissing: [], declaredExtra: [] });
    }, 120_000);

    it("keeps a protected entry that has fallen out of the general window", async () => {
      // The failure this exists for. persistState rewrites audit_events from memory, and memory is
      // whatever hydrateState read — so if the read is capped at the general window, a protected
      // entry below it is deleted by the next state mutation and the second window is theatre.
      // Measured before the fix: 500 protected entries destroyed by one no-op edit.
      await ensureDatabaseWithRetry();
      await executeSql("DELETE FROM audit_events;");

      // One sign-in, then enough reconciliation chatter to bury it past the newest 500.
      const signIn = {
        id: "audit_protected_signin",
        type: "auth.twitch",
        message: "operator signed in",
        createdAt: new Date(Date.UTC(2026, 8, 1, 0, 0, 0)).toISOString()
      };
      const noise = Array.from({ length: 600 }, (_, index) => ({
        id: `audit_noise_${String(index).padStart(4, "0")}`,
        type: "uplink.cycle",
        message: `cycle ${String(index)}`,
        createdAt: new Date(Date.UTC(2026, 8, 1, 1, 0, index)).toISOString()
      }));
      await updateAppState((current) => ({
        ...current,
        auditEvents: [...noise].reverse().concat(signIn)
      }));

      // It survived the write that put it there.
      const afterSeed = await readAppState();
      expect(afterSeed.auditEvents.some((event) => event.id === signIn.id)).toBe(true);

      // And it survives an ordinary mutation that touches nothing about the trail.
      await updateAppState((current) => ({ ...current, moderation: { ...current.moderation } }));
      const afterEdit = await readAppState();
      expect(afterEdit.auditEvents.some((event) => event.id === signIn.id)).toBe(true);

      // While the noise is still bounded: both windows together, not one per entry.
      const rows = await executeSql("SELECT count(*) FROM audit_events;");
      expect(Number(rows.trim().split("\n").map((line) => line.trim()).find((line) => /^\d+$/.test(line)))).toBeLessThanOrEqual(1000);
    }, 120_000);

    it("adds the worker heartbeat column to an existing playout runtime row", async () => {
      await ensureDatabaseWithRetry();
      await updatePlayoutRuntime((playout) => ({ ...playout, restartCount: 7 }));
      await executeSql(`
        ALTER TABLE playout_runtime DROP COLUMN IF EXISTS worker_heartbeat_at;
        DELETE FROM schema_migrations WHERE id = '${workerHeartbeatRuntimeMigrationId}';
      `);

      await ensureDatabaseWithRetry();

      const reread = await readAppState();
      expect(reread.playout.workerHeartbeatAt).toBe("");
      // The pre-existing row survived the upgrade rather than being replaced.
      expect(reread.playout.restartCount).toBe(7);
    }, 60_000);

    it("stores a redacted incident, and the migration scrubs a row written before the sink redacted", async () => {
      // The sink itself, on a real table.
      await upsertIncident({
        scope: "worker",
        severity: "warning",
        title: "FFmpeg reported an error",
        message: "[fifo @ 0x1] Error opening rtmp://live.twitch.tv/app/live_123456_AbCdEfGhIjKlMnOpQrStUv",
        fingerprint: "test.redaction"
      });
      const stored = await executeSql("SELECT message FROM incidents WHERE fingerprint = 'test.redaction';");
      expect(stored).toBe("[fifo @ 0x1] Error opening rtmp://live.twitch.tv/app/<redacted>");

      // A row from before the sink redacted, then the upgrade that scrubs it.
      await executeSql(`
        UPDATE incidents SET message = 'Error opening rtmp://live.twitch.tv/app/live_123456_AbCdEfGhIjKlMnOpQrStUv' WHERE fingerprint = 'test.redaction';
        DELETE FROM schema_migrations WHERE id = '${redactStoredSecretsMigrationId}';
      `);
      const before = await executeSql("SELECT id FROM schema_migrations WHERE id LIKE '20260902%';");
      // ensureDatabase applies migrations once per process; the reset is what lets it look again.
      await resetDatabaseConnectionsForTests();
      await ensureDatabaseWithRetry();
      const after = await executeSql("SELECT id FROM schema_migrations WHERE id LIKE '20260902%';");
      const scrubbed = await executeSql("SELECT message FROM incidents WHERE fingerprint = 'test.redaction';");
      expect(scrubbed, `migrations before=[${before}] after=[${after}] stored=<${scrubbed}>`).toBe("Error opening rtmp://live.twitch.tv/app/<redacted>");
      const migrationApplied = await executeSql(`SELECT COUNT(*) FROM schema_migrations WHERE id = '${redactStoredSecretsMigrationId}';`);
      expect(migrationApplied).toBe("1");
    }, 60_000);

    it("redacts a stream key in the audit trail at the sink, and the M85 migration scrubs one stored before", async () => {
      // Synthetic key, never a real one.
      const syntheticKey = "live_987654321_zyxwvutsrqponmlkjihg";
      await appendAuditEvent("test.m85.sink", `Publish to rtmp://live.twitch.tv/app/${syntheticKey} failed`);
      expect(await executeSql("SELECT message FROM audit_events WHERE type = 'test.m85.sink';")).toBe(
        "Publish to rtmp://live.twitch.tv/app/<redacted> failed"
      );

      // A row the old sink stored verbatim, on an install where the first scrub is already recorded.
      await executeSql(`
        INSERT INTO audit_events (id, type, message, created_at)
        VALUES ('audit_m85_seeded', 'test.m85.seeded', 'Publish to rtmp://live.twitch.tv/app/${syntheticKey} failed', '${new Date().toISOString()}');
        DELETE FROM schema_migrations WHERE id = '${redactStoredSecretsAgainMigrationId}';
      `);
      expect(await executeSql(`SELECT COUNT(*) FROM schema_migrations WHERE id = '${redactStoredSecretsMigrationId}';`)).toBe("1");

      // ensureDatabase applies migrations once per process; the reset is what lets it look again.
      await resetDatabaseConnectionsForTests();
      await ensureDatabaseWithRetry();

      expect(await executeSql("SELECT message FROM audit_events WHERE id = 'audit_m85_seeded';")).toBe(
        "Publish to rtmp://live.twitch.tv/app/<redacted> failed"
      );
      expect(await executeSql(`SELECT COUNT(*) FROM schema_migrations WHERE id = '${redactStoredSecretsAgainMigrationId}';`)).toBe("1");
      expect(await executeSql(`SELECT COUNT(*) FROM audit_events WHERE message LIKE '%${syntheticKey}%';`)).toBe("0");
      const state = await readAppState();
      expect(JSON.stringify(state.auditEvents)).not.toContain(syntheticKey);
    }, 60_000);

    it("boots an older database whose overlay row holds malformed custom_layers_json", async () => {
      // M85 / M5: the named-scenes cast used to throw on text that is not JSON, and the whole boot
      // rolled back on every start. Back to the pre-scenes shape, with one corrupted row.
      await executeSql(`
        ALTER TABLE overlay_settings DROP COLUMN IF EXISTS scenes_json;
        ALTER TABLE overlay_settings DROP COLUMN IF EXISTS active_scene_id;
        ALTER TABLE overlay_drafts DROP COLUMN IF EXISTS scenes_json;
        ALTER TABLE overlay_drafts DROP COLUMN IF EXISTS active_scene_id;
        UPDATE overlay_settings SET custom_layers_json = '[{"id": "broken' WHERE singleton_id = 1;
        DELETE FROM schema_migrations WHERE id = '${namedOverlayScenesMigrationId}';
      `);

      await resetDatabaseConnectionsForTests();
      await ensureDatabaseWithRetry();

      expect(await executeSql(`SELECT COUNT(*) FROM schema_migrations WHERE id = '${namedOverlayScenesMigrationId}';`)).toBe("1");
      expect(
        await executeSql("SELECT scenes_json::json -> 0 -> 'customLayers' FROM overlay_settings WHERE singleton_id = 1;")
      ).toBe("[]");
      expect(await executeSql("SELECT active_scene_id FROM overlay_settings WHERE singleton_id = 1;")).toBe("scene-main");

      // And the state still reads: the reader tolerates the row the migration left as it was.
      const studio = await readOverlayStudioState();
      expect(studio.liveOverlay.activeSceneId).toBe("scene-main");
      expect(studio.liveOverlay.customLayers).toEqual([]);
      await expect(readAppState()).resolves.toBeTruthy();
    }, 60_000);

    it("turns the one overlay of an existing installation into the first named scene, picture unchanged", async () => {
      // The upgrade this test exists for: a channel that was on air before named scenes existed.
      // Its single stored layer set must come back as one named scene and draw exactly the same
      // frame — the studio must not report unpublished changes nobody made either.
      const layer = {
        id: "layer-sponsor",
        kind: "text" as const,
        name: "Sponsor",
        enabled: true,
        xPercent: 4,
        yPercent: 10,
        widthPercent: 34,
        heightPercent: 12,
        opacityPercent: 100,
        allowOutsideSafeArea: false,
        text: "Sponsored by",
        secondaryText: "",
        textTone: "headline" as const,
        textAlign: "left" as const,
        useAccent: false,
        fontMode: "scene" as const,
        customFontFamily: ""
      };
      const studio = await readOverlayStudioState();
      const published = await publishOverlayDraftRecord({
        ...studio.liveOverlay,
        enabled: true,
        customLayers: [layer],
        scenes: [],
        activeSceneId: "",
        updatedAt: new Date().toISOString()
      });
      const pictureBefore = published.liveOverlay.customLayers;

      // Back to the shape an older installation actually has on disk.
      await executeSql(`
        ALTER TABLE overlay_settings DROP COLUMN IF EXISTS scenes_json;
        ALTER TABLE overlay_settings DROP COLUMN IF EXISTS active_scene_id;
        ALTER TABLE overlay_drafts DROP COLUMN IF EXISTS scenes_json;
        ALTER TABLE overlay_drafts DROP COLUMN IF EXISTS active_scene_id;
        DELETE FROM schema_migrations WHERE id = '${namedOverlayScenesMigrationId}';
      `);

      // ensureDatabase applies migrations once per process; the reset is what lets it look again.
      await resetDatabaseConnectionsForTests();
      await ensureDatabaseWithRetry();

      const migrationApplied = await executeSql(
        `SELECT COUNT(*) FROM schema_migrations WHERE id = '${namedOverlayScenesMigrationId}';`
      );
      expect(migrationApplied).toBe("1");

      // The backfill wrote a scene, not an empty list: the answer survives a reader that trusts
      // the column rather than re-deriving it.
      const storedActive = await executeSql("SELECT active_scene_id FROM overlay_settings WHERE singleton_id = 1;");
      expect(storedActive).toBe("scene-main");
      const storedSceneName = await executeSql(
        "SELECT scenes_json::json -> 0 ->> 'name' FROM overlay_settings WHERE singleton_id = 1;"
      );
      expect(storedSceneName).toBe("Main scene");
      const storedSceneLayer = await executeSql(
        "SELECT scenes_json::json -> 0 -> 'customLayers' -> 0 ->> 'id' FROM overlay_settings WHERE singleton_id = 1;"
      );
      expect(storedSceneLayer).toBe("layer-sponsor");

      const after = await readOverlayStudioState();
      expect(after.liveOverlay.scenes).toHaveLength(1);
      expect(after.liveOverlay.activeSceneId).toBe("scene-main");
      // The picture: byte-for-byte the layer set that was on air before the upgrade.
      expect(after.liveOverlay.customLayers).toEqual(pictureBefore);
      expect(after.liveOverlay.customLayers.map((entry) => entry.id)).toEqual(["layer-sponsor"]);
      expect(after.hasUnpublishedChanges).toBe(false);
    }, 60_000);

    it("roundtrips several named scenes and switches which one is on air", async () => {
      const studio = await readOverlayStudioState();
      const scenes = [
        { id: "scene-main", name: "Main scene", customLayers: [], sourceId: "" },
        { id: "scene-break", name: "Break", customLayers: [], sourceId: "source-cam" }
      ];
      await publishOverlayDraftRecord({
        ...studio.liveOverlay,
        scenes,
        activeSceneId: "scene-break",
        updatedAt: new Date().toISOString()
      });

      const reread = await readOverlayStudioState();
      expect(reread.liveOverlay.scenes.map((scene) => scene.name)).toEqual(["Main scene", "Break"]);
      expect(reread.liveOverlay.scenes[1]?.sourceId).toBe("source-cam");
      expect(reread.liveOverlay.activeSceneId).toBe("scene-break");
      // Deleting the active scene must not leave the channel without a picture.
      await publishOverlayDraftRecord({
        ...reread.liveOverlay,
        scenes: [scenes[0]],
        updatedAt: new Date().toISOString()
      });
      expect((await readOverlayStudioState()).liveOverlay.activeSceneId).toBe("scene-main");
    }, 60_000);

    it("keeps the viewer request history the cooldown and the queue cap are decided on", async () => {
      // Finding [5]: the table existed, nothing wrote to it, so the worker evaluated every request
      // against an empty history and a queue count of zero — cooldown and cap could never fire.
      await appendChatViewerRequestRecord({ actor: "Viewer_One", assetId: "asset_req_a" });
      await appendChatViewerRequestRecord({ actor: "viewer_one", assetId: "asset_req_b" });
      await appendChatViewerRequestRecord({ actor: "other", assetId: "asset_req_c" });
      const recent = await listRecentChatViewerRequests(new Date(Date.now() - 60_000).toISOString());
      expect(recent.map((entry) => entry.assetId).sort()).toEqual(["asset_req_a", "asset_req_b", "asset_req_c"]);
      expect(recent.every((entry) => typeof entry.createdAt === "string" && entry.actor)).toBe(true);
      // Two of the three are still in the queue; the third has been played and leaves the count.
      await markChatViewerRequestsPlayed(["asset_req_a", "asset_req_b"]);
      expect(await countQueuedChatViewerRequests(["asset_req_a", "asset_req_b"])).toBe(2);
      await markChatViewerRequestsPlayed(["asset_req_b"]);
      expect(await countQueuedChatViewerRequests(["asset_req_b"])).toBe(1);
      const played = await executeSql("SELECT status FROM chat_viewer_requests WHERE asset_id = 'asset_req_a';");
      expect(played).toBe("played");
    }, 60_000);

    // M107: !next predicts what airs next from the playout row it reads when asked (R22), so that read carries
    // what the prediction needs, and says what the state the worker cycle reads says.
    it("reads the playout row !next predicts from, as the state reads it", async () => {
      await ensureDatabaseWithRetry();
      await updatePlayoutRuntime((playout) => ({
        ...playout,
        status: "running",
        currentAssetId: "asset_on_air",
        currentTitle: "On Air",
        processStartedAt: "2026-10-06T11:30:00.000Z",
        queueItems: [
          { id: "insert-asset_on_air-0", position: 0, kind: "insert", assetId: "asset_on_air", title: "On Air", subtitle: "", scenePreset: "" },
          { id: "asset-asset_next-1", position: 1, kind: "asset", assetId: "asset_next", title: "Next Up", subtitle: "", scenePreset: "" }
        ],
        nextAssetId: "asset_next",
        nextTitle: "Next Up",
        manualNextAssetId: "asset_next",
        overrideMode: "asset",
        overrideAssetId: "asset_on_air",
        overrideUntil: "2026-10-06T12:30:00.000Z",
        cuepointWindowKey: "2026-10-06:block_day:600:360"
      }));

      const row = await readPlayoutProgrammeTitles();
      expect(row).toMatchObject({
        status: "running",
        currentTitle: "On Air",
        currentAssetId: "asset_on_air",
        processStartedAt: "2026-10-06T11:30:00.000Z",
        queueKind: "insert",
        nextAssetId: "asset_next",
        nextTitle: "Next Up",
        manualNextAssetId: "asset_next",
        overrideAssetId: "asset_on_air",
        overrideUntil: "2026-10-06T12:30:00.000Z",
        cuepointWindowKey: "2026-10-06:block_day:600:360"
      });
      expect(row).toEqual(playoutProgrammeRowOf((await readAppState()).playout));
    }, 60_000);

    it("never encrypts over a secret it could not read, so a rotated APP_SECRET is survivable", async () => {
      // The adversarial review of v1.5.39 found this: detection alone was not enough. With a key
      // it cannot open, the first full-state write -- a moderator's !game is enough to trigger one
      // -- deleted and re-inserted every user with an empty secret and wrote encrypted defaults
      // over the managed config. That destroyed the only copy AND cleared the flag that makes the
      // login refuse, so the two-factor bypass came back permanently.
      const ownerId = "user_secret_guard";
      await upsertUserRecord({
        id: ownerId,
        email: "guard@example.com",
        displayName: "Guard",
        authProvider: "local",
        role: "owner",
        twitchUserId: "",
        twitchLogin: "",
        passwordHash: "hash",
        twoFactorEnabled: true,
        twoFactorSecret: "JBSWY3DPEHPK3PXP",
        twoFactorConfirmedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        lastLoginAt: ""
      });
      const sealedSecret = await executeSql(`SELECT two_factor_secret FROM users WHERE id = '${ownerId}';`);
      const sealedManaged = await executeSql("SELECT left(encrypted_payload, 24) FROM managed_config WHERE singleton_id = 1;");
      expect(sealedSecret).not.toBe("");

      // Rotate the key underneath the store, exactly as losing the secret file would.
      process.env.APP_SECRET = `${process.env.APP_SECRET ?? ""}-rotated`;
      await resetDatabaseConnectionsForTests();
      await ensureDatabaseWithRetry();

      const unreadable = await readAppState();
      expect(unreadable.users.find((user) => user.id === ownerId)?.twoFactorSecretUnreadable).toBe(true);

      // The write that used to destroy everything.
      await updateAppState((state) => ({ ...state, overlay: { ...state.overlay, channelName: "Guarded" } }));

      expect(await executeSql(`SELECT two_factor_secret FROM users WHERE id = '${ownerId}';`)).toBe(sealedSecret);
      expect(await executeSql("SELECT left(encrypted_payload, 24) FROM managed_config WHERE singleton_id = 1;")).toBe(sealedManaged);
    }, 60_000);
  });
});
