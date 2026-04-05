import { describe, expect, it } from "vitest";
import type { AppState } from "../../apps/web/lib/server/state";
import { getGoLiveChecklist } from "../../apps/web/lib/server/onboarding";
import {
  getAssetPlaybackDiagnostics,
  getBroadcastSnapshot,
  getFilteredIncidents,
  getPlayoutQueueAssets,
  getRuntimeDriftReport,
  getSourceConnectorDiagnostics,
  getSourceHealthSnapshot,
  getSourceIncidents,
  getSourceRecoveryActions,
  getSourceSyncRuns,
  getSourceReferences,
  getWorkerHealth
} from "../../apps/web/lib/server/state";

function createState(overrides: Partial<AppState> = {}): AppState {
  const currentDayOfWeek = new Date().getUTCDay();
  return {
    initialized: true,
    owner: {
      email: "owner@example.com",
      passwordHash: "hash",
      createdAt: "2026-03-27T10:00:00.000Z"
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
      showClock: true,
      showNextItem: true,
      showScheduleTeaser: true,
      showCurrentCategory: true,
      showSourceLabel: true,
      showQueuePreview: false,
      queuePreviewCount: 3,
      layerOrder: ["chip", "hero", "next", "queue", "schedule", "clock", "banner", "ticker"],
      disabledLayers: [],
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
      lastMetadataSyncAt: "2026-03-27T10:10:00.000Z",
      lastSyncedTitle: "Morning Show",
      lastSyncedCategoryName: "Just Chatting",
      lastSyncedCategoryId: "509658",
      lastScheduleSyncAt: "",
      error: ""
    },
    twitchScheduleSegments: [],
    pools: [
      {
        id: "pool-1",
        name: "YouTube Playlist",
        sourceIds: ["source-1"],
        playbackMode: "round-robin",
        cursorAssetId: "",
        insertAssetId: "",
        insertEveryItems: 0,
        itemsSinceInsert: 0,
        updatedAt: ""
      }
    ],
    showProfiles: [
      {
        id: "show-1",
        name: "Morning Replay",
        categoryName: "Just Chatting",
        defaultDurationMinutes: 120,
        color: "#0e6d5a",
        description: "Standard morning archive block.",
        updatedAt: ""
      }
    ],
    scheduleBlocks: [
      {
        id: "block-1",
        title: "Morning Show",
        categoryName: "Just Chatting",
        dayOfWeek: currentDayOfWeek,
        startMinuteOfDay: 0,
        durationMinutes: 1440,
        showId: "show-1",
        poolId: "pool-1",
        sourceName: "YouTube Playlist"
      }
    ],
    sources: [
      {
        id: "source-1",
        name: "YouTube Playlist",
        type: "Managed ingestion",
        connectorKind: "youtube-playlist",
        enabled: true,
        status: "Ready",
        externalUrl: "",
        notes: "",
        lastSyncedAt: ""
      }
    ],
    assets: [
      {
        id: "asset-1",
        sourceId: "source-1",
        title: "Asset 1",
        path: "/tmp/asset.mp4",
        status: "ready",
        externalId: "abc123",
        categoryName: "Just Chatting",
        durationSeconds: 3600,
        publishedAt: "2026-03-27T09:00:00.000Z",
        includeInProgramming: true,
        fallbackPriority: 100,
        isGlobalFallback: false,
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
        rtmpUrl: "rtmp://live.twitch.tv/app",
        streamKeyPresent: true,
        status: "ready",
        notes: "Ready",
        lastValidatedAt: "",
        lastFailureAt: "",
        failureCount: 0,
        lastError: ""
      }
    ],
    incidents: [
      {
        id: "incident-1",
        scope: "playout",
        severity: "critical",
        status: "open",
        acknowledgedAt: "",
        acknowledgedBy: "",
        title: "FFmpeg crashed",
        message: "Exited unexpectedly",
        fingerprint: "playout.ffmpeg.exit",
        createdAt: "2026-03-27T10:00:00.000Z",
        updatedAt: "2026-03-27T10:05:00.000Z",
        resolvedAt: ""
      },
      {
        id: "incident-2",
        scope: "twitch",
        severity: "warning",
        status: "resolved",
        acknowledgedAt: "",
        acknowledgedBy: "",
        title: "Twitch sync failed",
        message: "401",
        fingerprint: "twitch.reconcile.failed",
        createdAt: "2026-03-27T09:00:00.000Z",
        updatedAt: "2026-03-27T09:10:00.000Z",
        resolvedAt: "2026-03-27T09:10:00.000Z"
      }
    ],
    auditEvents: [
      {
        id: "audit-1",
        type: "worker.cycle",
        message: "done",
        createdAt: new Date().toISOString()
      }
    ],
    playout: {
      status: "running",
      transitionState: "ready",
      transitionTargetKind: "",
      transitionTargetAssetId: "",
      transitionTargetTitle: "",
      transitionReadyAt: "",
      currentAssetId: "asset-1",
      currentTitle: "Asset 1",
      desiredAssetId: "asset-1",
      nextAssetId: "",
      nextTitle: "",
      queuedAssetIds: [],
      queueItems: [
        {
          id: "queue-asset-1-0",
          kind: "asset",
          assetId: "asset-1",
          title: "Asset 1",
          subtitle: "YouTube Playlist · Just Chatting",
          scenePreset: "replay-lower-third",
          position: 0
        }
      ],
      prefetchedAssetId: "",
      prefetchedTitle: "",
      prefetchedAt: "",
      prefetchStatus: "",
      prefetchError: "",
      currentDestinationId: "destination-primary",
      restartRequestedAt: "",
      heartbeatAt: new Date().toISOString(),
      processPid: 123,
      processStartedAt: new Date().toISOString(),
      lastTransitionAt: new Date().toISOString(),
      lastSuccessfulStartAt: new Date().toISOString(),
      lastSuccessfulAssetId: "asset-1",
      lastExitCode: "",
      restartCount: 0,
      crashCountWindow: 0,
      crashLoopDetected: false,
      lastError: "",
      lastStderrSample: "",
      selectionReasonCode: "scheduled_match",
      fallbackTier: "scheduled",
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
      message: "Running"
    },
    ...overrides
  };
}

describe("ops state helpers", () => {
  it("filters incidents by status, scope, severity, and text", () => {
    const state = createState();
    const filtered = getFilteredIncidents(state, {
      status: "open",
      severity: "critical",
      scope: "playout",
      query: "ffmpeg"
    });

    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.fingerprint).toBe("playout.ffmpeg.exit");
  });

  it("reports healthy worker heartbeat when current", () => {
    const result = getWorkerHealth(createState());
    expect(result.status).toBe("healthy");
  });

  it("reports schedule drift when current asset source differs from schedule source", () => {
    const state = createState({
      sources: [
        {
          id: "source-1",
          name: "Different Source",
          type: "Managed ingestion",
          connectorKind: "youtube-playlist",
          enabled: true,
          status: "Ready",
          externalUrl: "",
          notes: "",
          lastSyncedAt: ""
        }
      ]
    });

    const report = getRuntimeDriftReport(state);
    const scheduleAlignment = report.items.find((item) => item.id === "schedule-alignment");

    expect(scheduleAlignment?.severity).toBe("warning");
  });

  it("builds a go-live checklist that reflects missing programming steps", () => {
    const state = createState({
      sources: [],
      assets: [],
      pools: [],
      scheduleBlocks: [],
      destinations: [
        {
          id: "destination-primary",
          provider: "twitch",
          role: "primary",
          priority: 0,
          name: "Primary Twitch Output",
          enabled: true,
          rtmpUrl: "rtmp://live.twitch.tv/app",
          streamKeyPresent: false,
          status: "missing-config",
          notes: "Missing stream key",
          lastValidatedAt: "",
          lastFailureAt: "",
          failureCount: 0,
          lastError: ""
        }
      ],
      twitch: {
        ...createState().twitch,
        status: "not-connected"
      }
    });

    const checklist = getGoLiveChecklist(state);

    expect(checklist.find((item) => item.id === "sources")?.status).toBe("action");
    expect(checklist.find((item) => item.id === "destination")?.status).toBe("action");
    expect(checklist.find((item) => item.id === "overlay")?.status).toBe("optional");
  });

  it("collects source incidents and programming references", () => {
    const state = createState({
      sourceSyncRuns: [
        {
          id: "sync-1",
          sourceId: "source-1",
          startedAt: "2026-03-27T10:30:00.000Z",
          finishedAt: "2026-03-27T10:31:00.000Z",
          status: "success",
          summary: "Imported 4 YouTube item(s) from youtube-playlist.",
          discoveredAssets: 4,
          readyAssets: 4,
          errorMessage: ""
        }
      ],
      incidents: [
        {
          id: "incident-source",
          scope: "source",
          severity: "warning",
          status: "open",
          acknowledgedAt: "",
          acknowledgedBy: "",
          title: "YouTube playlist ingestion failed",
          message: "YouTube Playlist: upstream fetch failed",
          fingerprint: "source.youtube-playlist.source-1",
          createdAt: "2026-03-27T11:00:00.000Z",
          updatedAt: "2026-03-27T11:05:00.000Z",
          resolvedAt: ""
        }
      ]
    });

    expect(getSourceIncidents(state, "source-1")).toHaveLength(1);
    expect(getSourceSyncRuns(state, "source-1")).toHaveLength(1);
    const references = getSourceReferences(state, "source-1");
    expect(references.pools).toHaveLength(1);
    expect(references.scheduleBlocks).toHaveLength(1);
    const snapshot = getSourceHealthSnapshot(state, "source-1");
    expect(snapshot.openIncidentCount).toBe(1);
    expect(snapshot.latestRun?.status).toBe("success");
  });

  it("builds connector diagnostics and asset playback diagnostics", () => {
    const state = createState({
      sources: [
        {
          id: "source-1",
          name: "YouTube Playlist",
          type: "Managed ingestion",
          connectorKind: "youtube-playlist",
          enabled: true,
          status: "Ready",
          externalUrl: "https://www.youtube.com/playlist?list=PL123",
          notes: "",
          lastSyncedAt: ""
        }
      ]
    });

    const sourceDiagnostics = getSourceConnectorDiagnostics(state, "source-1");
    expect(sourceDiagnostics.isValidUrl).toBe(true);
    expect(sourceDiagnostics.expectedInput).toContain("playlist");

    const assetDiagnostics = getAssetPlaybackDiagnostics(state, "asset-1");
    expect(assetDiagnostics.status).toBe("playable");
    expect(assetDiagnostics.summary).toContain("usable");
  });

  it("builds recovery actions and playout queue assets", () => {
    const state = createState({
      sourceSyncRuns: [
        {
          id: "sync-err",
          sourceId: "source-1",
          startedAt: "2026-03-27T10:30:00.000Z",
          finishedAt: "2026-03-27T10:31:00.000Z",
          status: "error",
          summary: "yt-dlp ingestion failed.",
          discoveredAssets: 0,
          readyAssets: 0,
          errorMessage: "Private video"
        }
      ],
      assets: [
        {
          id: "asset-1",
          sourceId: "source-1",
          title: "Asset 1",
          path: "/tmp/asset.mp4",
          status: "ready",
          includeInProgramming: true,
          externalId: "abc123",
          categoryName: "Just Chatting",
          durationSeconds: 3600,
          publishedAt: "2026-03-27T09:00:00.000Z",
          fallbackPriority: 100,
          isGlobalFallback: false,
          createdAt: "",
          updatedAt: ""
        },
        {
          id: "asset-2",
          sourceId: "source-1",
          title: "Asset 2",
          path: "/tmp/asset-2.mp4",
          status: "ready",
          includeInProgramming: true,
          externalId: "def456",
          categoryName: "Just Chatting",
          durationSeconds: 3600,
          publishedAt: "2026-03-27T10:00:00.000Z",
          fallbackPriority: 100,
          isGlobalFallback: false,
          createdAt: "",
          updatedAt: ""
        }
      ],
      playout: {
        ...createState().playout,
        currentAssetId: "asset-1",
        nextAssetId: "asset-2",
        nextTitle: "Asset 2",
        queuedAssetIds: ["asset-2"]
      }
    });

    expect(getSourceRecoveryActions(state, "source-1").join(" ")).toContain("private");
    expect(getPlayoutQueueAssets(state)).toHaveLength(2);
  });

  it("summarizes typed broadcast queue items in the live snapshot", () => {
    const snapshot = getBroadcastSnapshot(createState({
      playout: {
        ...createState().playout,
        queueItems: [
          {
            id: "queue-standby-0",
            kind: "standby",
            assetId: "",
            title: "Replay standby",
            subtitle: "No playable asset is available.",
            scenePreset: "standby-board",
            position: 0
          },
          {
            id: "queue-asset-1-1",
            kind: "asset",
            assetId: "asset-1",
            title: "Asset 1",
            subtitle: "YouTube Playlist · Just Chatting",
            scenePreset: "replay-lower-third",
            position: 1
          }
        ]
      }
    }));

    expect(snapshot.queueItems[0]?.kind).toBe("standby");
    expect(snapshot.queueItems[0]?.asset).toBeNull();
    expect(snapshot.queueItems[1]?.asset?.id).toBe("asset-1");
    expect(snapshot.activeScene.resolvedPresetId).toBe("standby-board");
    expect(snapshot.activeScene.layers[0]?.kind).toBe("chip");
  });
});
