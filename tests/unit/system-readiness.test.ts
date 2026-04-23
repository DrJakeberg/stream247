import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppState } from "../../apps/web/lib/server/state";

const readAppState = vi.fn<() => Promise<AppState>>();
const getDatabaseHealth = vi.fn<() => Promise<"ok" | "error">>();
const getActiveSseConnectionCount = vi.fn<() => number>();

vi.mock("../../apps/web/lib/server/state", () => ({
  readAppState
}));

vi.mock("@stream247/db", () => ({
  getDatabaseHealth
}));

vi.mock("../../apps/web/lib/server/sse", () => ({
  getActiveSseConnectionCount
}));

function createState(overrides: Partial<AppState["playout"]> = {}): AppState {
  return {
    initialized: true,
    owner: {
      email: "owner@example.com",
      passwordHash: "hash",
      createdAt: "2026-04-23T00:00:00.000Z"
    },
    users: [],
    teamAccessGrants: [],
    moderation: {
      enabled: true,
      command: "here",
      defaultMinutes: 30,
      minMinutes: 5,
      maxMinutes: 240,
      requirePrefix: false,
      fallbackEmoteOnly: true
    },
    presenceWindows: [],
    overlay: {
      enabled: false,
      channelName: "Stream247",
      headline: "Always on air",
      insertHeadline: "Insert on air",
      standbyHeadline: "Please wait, restream is starting",
      reconnectHeadline: "Scheduled reconnect in progress",
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
      layerOrder: ["chip", "hero", "next", "queue", "schedule", "clock", "banner", "ticker"],
      disabledLayers: [],
      customLayers: [],
      emergencyBanner: "",
      tickerText: "",
      replayLabel: "Replay stream",
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
      status: "connected",
      broadcasterId: "123",
      broadcasterLogin: "owner",
      accessToken: "",
      refreshToken: "",
      connectedAt: "",
      tokenExpiresAt: "",
      lastRefreshAt: "",
      lastMetadataSyncAt: "2026-04-23T00:00:00.000Z",
      lastSyncedTitle: "",
      lastSyncedCategoryName: "",
      lastSyncedCategoryId: "",
      lastScheduleSyncAt: "",
      liveStatus: "live",
      viewerCount: 10,
      error: ""
    },
    twitchScheduleSegments: [],
    pools: [],
    showProfiles: [],
    scheduleBlocks: [],
    sources: [],
    assets: [
      {
        id: "asset-fallback",
        sourceId: "source-local-library",
        title: "Fallback",
        path: "/app/data/media/fallback.mp4",
        status: "ready",
        externalId: "",
        categoryName: "",
        durationSeconds: 60,
        publishedAt: "",
        includeInProgramming: true,
        fallbackPriority: 1,
        isGlobalFallback: true,
        createdAt: "",
        updatedAt: ""
      }
    ],
    sourceSyncRuns: [],
    destinations: [
      {
        id: "destination-primary",
        provider: "twitch",
        role: "primary",
        priority: 0,
        name: "Primary Twitch Output",
        enabled: true,
        rtmpUrl: "rtmp://live.twitch.tv/app/",
        streamKeyPresent: true,
        streamKeySource: "env",
        status: "ready",
        notes: "",
        lastValidatedAt: "",
        lastFailureAt: "",
        failureCount: 0,
        lastError: ""
      }
    ],
    incidents: [],
    auditEvents: [
      {
        id: "audit-worker",
        type: "worker.cycle",
        message: "cycle",
        createdAt: "2026-04-23T01:00:00.000Z"
      }
    ],
    playout: {
      status: "recovering",
      transitionState: "ready",
      queueVersion: 1,
      transitionTargetKind: "",
      transitionTargetAssetId: "",
      transitionTargetTitle: "",
      transitionReadyAt: "",
      currentAssetId: "asset-fallback",
      currentTitle: "Fallback",
      previousAssetId: "",
      previousTitle: "",
      desiredAssetId: "asset-fallback",
      nextAssetId: "",
      nextTitle: "",
      queuedAssetIds: [],
      queueItems: [],
      prefetchedAssetId: "",
      prefetchedTitle: "",
      prefetchedAt: "",
      prefetchStatus: "ready",
      prefetchError: "",
      insertAssetId: "",
      insertRequestedAt: "",
      insertStatus: "",
      skipAssetId: "",
      skipUntil: "",
      overrideAssetId: "",
      overrideUntil: "",
      manualNextAssetId: "",
      manualNextRequestedAt: "",
      pendingAction: "",
      pendingActionRequestedAt: "",
      restartRequestedAt: "",
      processPid: 1,
      processStartedAt: "2026-04-23T00:50:00.000Z",
      heartbeatAt: "2026-04-23T00:50:00.000Z",
      restartCount: 2,
      crashCountWindow: 0,
      crashLoopDetected: false,
      lastExitCode: "0",
      lastError: "",
      message: "",
      selectionReasonCode: "global_fallback",
      fallbackTier: "global-fallback",
      currentDestinationId: "destination-primary",
      transitionStateUpdatedAt: "",
      lastTransitionAt: "",
      cuepointWindowKey: "",
      cuepointFiredKeys: [],
      liveBridgeStatus: "idle",
      liveBridgeInputType: "",
      liveBridgeLabel: "",
      liveBridgeInputSummary: "",
      liveBridgeRequestedAt: "",
      liveBridgeStartedAt: "",
      liveBridgeReleasedAt: "",
      liveBridgeLastError: "",
      programFeedStatus: "fresh",
      programFeedUpdatedAt: "2026-04-23T01:00:20.000Z",
      programFeedPlaylistPath: "/app/data/media/.stream247-program-feed/program.m3u8",
      programFeedTargetSeconds: 2,
      programFeedBufferedSeconds: 60,
      uplinkStatus: "running",
      uplinkHeartbeatAt: "2026-04-23T01:00:15.000Z",
      uplinkStartedAt: "2026-04-23T00:45:00.000Z",
      uplinkInputMode: "hls",
      uplinkDestinationIds: ["destination-primary"],
      uplinkRestartCount: 1,
      uplinkUnplannedRestartCount: 0,
      uplinkLastExitCode: "",
      uplinkLastExitReason: "",
      uplinkLastExitPlanned: false,
      uplinkReconnectUntil: "",
      lastSuccessfulStartAt: "2026-04-23T00:50:00.000Z",
      lastSuccessfulAssetId: "asset-fallback",
      lastStderrSample: "",
      ...overrides
    },
    scenes: [],
    destinationsProfiles: [],
    audioPresets: [],
    output: {
      resolution: "1920x1080",
      videoBitrateKbps: 6000,
      audioBitrateKbps: 192,
      fps: 30,
      profile: "main",
      tune: "zerolatency",
      preset: "veryfast",
      gopSeconds: 2,
      hlsSegmentSeconds: 2,
      updatedAt: ""
    },
    sourceSyncJobs: [],
    assetCollections: [],
    libraryUploads: []
  };
}

describe("getSystemReadiness", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-23T01:00:30.000Z"));
    process.env.STREAM247_RELAY_ENABLED = "1";
    delete process.env.STREAM247_UPLINK_INPUT_MODE;
    getDatabaseHealth.mockResolvedValue("ok");
    getActiveSseConnectionCount.mockReturnValue(0);
  });

  it("treats a fresh program feed as active playout while recovering", async () => {
    readAppState.mockResolvedValue(createState());

    const { getSystemReadiness } = await import("../../apps/web/lib/server/readiness");
    const readiness = await getSystemReadiness();

    expect(readiness.services.playout).toBe("ok");
    expect(readiness.services.programFeed).toBe("ok");
    expect(readiness.broadcastReady).toBe(true);
  });

  it("still reports not-ready when the program feed is stale", async () => {
    readAppState.mockResolvedValue(
      createState({
        programFeedStatus: "stale",
        programFeedUpdatedAt: "2026-04-23T00:50:05.000Z"
      })
    );

    const { getSystemReadiness } = await import("../../apps/web/lib/server/readiness");
    const readiness = await getSystemReadiness();

    expect(readiness.services.programFeed).toBe("degraded");
    expect(readiness.services.playout).toBe("not-ready");
    expect(readiness.broadcastReady).toBe(false);
  });
});
