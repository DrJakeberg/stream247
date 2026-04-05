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
  readOverlayStudioState,
  resetDatabaseConnectionsForTests,
  resetOverlayDraftRecord,
  saveOverlayDraftRecord,
  saveOverlayScenePresetRecord,
  writeAppState
} from "@stream247/db";

const execFileAsync = promisify(execFile);

type TestDatabase = {
  containerName: string;
  databaseUrl: string;
};

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
          repeatGroupId: "repeat_weekend"
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
        manualNextAssetId: "asset_2",
        manualNextRequestedAt: "2026-04-04T10:00:09.000Z",
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
    expect(reread.twitch.broadcasterLogin).toBe("roundtrip");
    expect(reread.twitchScheduleSegments[0]?.segmentId).toBe("abc");
    expect(reread.pools[0]?.name).toBe("Pool One");
    expect(reread.pools[0]?.insertAssetId).toBe("asset_3");
    expect(reread.showProfiles[0]?.name).toBe("Morning Replay");
    expect(reread.scheduleBlocks[0]?.showId).toBe("show_1");
    expect(reread.scheduleBlocks[0]?.repeatMode).toBe("weekends");
    expect(reread.scheduleBlocks[0]?.repeatGroupId).toBe("repeat_weekend");
    expect(reread.sources[0]?.connectorKind).toBe("youtube-channel");
    expect(reread.assets[0]?.durationSeconds).toBe(3600);
    expect(reread.assets[0]?.folderPath).toBe("youtube-channel/source-1");
    expect(reread.assets[0]?.tags).toEqual(["featured", "evergreen"]);
    expect(reread.sourceSyncRuns[0]?.status).toBe("success");
    expect(reread.destinations[0]?.streamKeyPresent).toBe(true);
    expect(reread.incidents[0]?.fingerprint).toBe("example");
    expect(reread.auditEvents[0]?.type).toBe("test.roundtrip");
    expect(reread.playout.transitionState).toBe("ready");
    expect(reread.playout.queueVersion).toBe(4);
    expect(reread.playout.transitionTargetKind).toBe("insert");
    expect(reread.playout.transitionTargetAssetId).toBe("asset_3");
    expect(reread.playout.previousAssetId).toBe("asset_0");
    expect(reread.playout.previousTitle).toBe("Asset Zero");
    expect(reread.playout.prefetchedAssetId).toBe("asset_2");
    expect(reread.playout.manualNextAssetId).toBe("asset_2");
    expect(reread.playout.queuedAssetIds).toEqual(["asset_2", "asset_3"]);
    expect(reread.playout.queueItems[1]?.kind).toBe("insert");
    expect(reread.playout.queueItems[1]?.assetId).toBe("asset_3");
    expect(reread.users[0]?.twoFactorEnabled).toBe(true);
    expect(reread.users[0]?.twoFactorSecret).toBe("JBSWY3DPEHPK3PXP");
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
});
