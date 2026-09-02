import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  applyOverlayScenePresetRecordToDraft,
  createPoolRecord,
  createScheduleBlocks,
  createScheduleBlocksChecked,
  deleteOverlayScenePresetRecord,
  ensureDatabase,
  listOverlayScenePresetRecords,
  publishOverlayDraftRecord,
  appendAuditEvent,
  appendPresenceWindowRecord,
  readAppState,
  updateAppState,
  updatePlayoutRuntime,
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
  resetDatabaseConnectionsForTests,
  resetOverlayDraftRecord,
  saveOverlayDraftRecord,
  saveOverlayScenePresetRecord,
  updateAssetCurationRecords,
  updateDestinationRecord,
  updateEngagementSettingsRecord,
  updateOutputSettingsRecord,
  updateSourceFieldRecords,
  upsertIncident,
  appendChatViewerRequestRecord,
  listRecentChatViewerRequests,
  countQueuedChatViewerRequests,
  markChatViewerRequestsPlayed,
  writeAppState,
  writeChatOverlayMessagesRecord,
  writeChatSkipVoteRecord
} from "@stream247/db";

const execFileAsync = promisify(execFile);

type TestDatabase = {
  containerName: string;
  databaseUrl: string;
};

const persistentProgramFeedRuntimeMigrationId = "20260419_001_persistent_program_feed_runtime";
const workerHeartbeatRuntimeMigrationId = "20260901_001_worker_heartbeat_runtime";
const redactStoredSecretsMigrationId = "20260902_001_redact_stored_secrets";
const namedOverlayScenesMigrationId = "20260902_003_named_overlay_scenes";
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
  });
});
