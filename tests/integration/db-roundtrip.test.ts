import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  applyOverlayScenePresetRecordToDraft,
  createPoolRecord,
  createScheduleBlocks,
  deleteOverlayScenePresetRecord,
  ensureDatabase,
  listOverlayScenePresetRecords,
  publishOverlayDraftRecord,
  readAppState,
  readManagedDestinationStreamKeys,
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
  writeAppState
} from "@stream247/db";

const execFileAsync = promisify(execFile);

type TestDatabase = {
  containerName: string;
  databaseUrl: string;
};

const persistentProgramFeedRuntimeMigrationId = "20260419_001_persistent_program_feed_runtime";
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
const outputProfilesMigrationId = "20260420_001_output_profiles";
const outputSettingsColumns = ["singleton_id", "profile_id", "width", "height", "fps", "updated_at"].sort();
const engagementLayerMigrationId = "20260420_002_engagement_layer";
const engagementSettingsColumns = [
  "singleton_id",
  "chat_enabled",
  "alerts_enabled",
  "chat_mode",
  "chat_position",
  "alert_position",
  "style",
  "max_messages",
  "rate_limit_per_minute",
  "updated_at"
].sort();
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
        channelName: "Roundtrip TV",
        replayLabel: "Replay",
        insertHeadline: "Custom insert break",
        standbyHeadline: "Stand by for the next archive block",
        reconnectHeadline: "Refreshing the live output",
        brandBadge: "Archive Channel",
        insertScenePreset: "minimal-chip",
        standbyScenePreset: "standby-board",
        reconnectScenePreset: "reconnect-board",
        surfaceStyle: "signal",
        panelAnchor: "center",
        titleScale: "cinematic",
        layerOrder: ["hero", "chip", "next", "queue", "schedule", "clock", "banner", "ticker"],
        disabledLayers: ["schedule"],
        tickerText: "Roundtrip preview ticker",
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
        chatMode: "active" as const,
        chatPosition: "bottom-right" as const,
        alertPosition: "top-left" as const,
        style: "card" as const,
        maxMessages: 8,
        rateLimitPerMinute: 45,
        updatedAt: "2026-04-04T10:00:00.000Z"
      },
      engagementEvents: [
        {
          id: "engagement_chat_1",
          kind: "chat" as const,
          actor: "viewer",
          message: "hello stream",
          createdAt: "2026-04-04T10:01:00.000Z"
        },
        {
          id: "engagement_follow_1",
          kind: "follow" as const,
          actor: "newviewer",
          message: "newviewer followed the channel.",
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
        tokenExpiresAt: "2026-04-04T12:00:00.000Z"
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
          title: "Asset One",
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
          categoryName: "Gaming",
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
    expect(reread.engagementEvents.map((event) => event.id)).toEqual(["engagement_follow_1", "engagement_chat_1"]);
    expect(reread.twitch.broadcasterLogin).toBe("roundtrip");
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

  it("upgrades existing databases with engagement settings and event storage", async () => {
    await ensureDatabaseWithRetry();
    await executeSql(`
      DROP TABLE IF EXISTS engagement_events;
      DROP TABLE IF EXISTS engagement_settings;
      DELETE FROM schema_migrations WHERE id = '${engagementLayerMigrationId}';
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
    const migrationApplied = await executeSql(`SELECT COUNT(*) FROM schema_migrations WHERE id = '${engagementLayerMigrationId}';`);
    const state = await readAppState();

    expect(settingsColumns).toEqual(engagementSettingsColumns);
    expect(eventColumns).toEqual(engagementEventsColumns);
    expect(migrationApplied).toBe("1");
    expect(state.engagement.chatEnabled).toBe(false);
    expect(state.engagement.alertsEnabled).toBe(false);
    expect(state.engagementEvents).toEqual([]);
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
});
