import { describe, expect, it } from "vitest";
import type { AppState } from "../../apps/web/lib/server/state";
import { getFilteredIncidents, getRuntimeDriftReport, getWorkerHealth } from "../../apps/web/lib/server/state";

function createState(overrides: Partial<AppState> = {}): AppState {
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
      accentColor: "#0e6d5a",
      showClock: true,
      showNextItem: true,
      showScheduleTeaser: true,
      emergencyBanner: "",
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
        updatedAt: ""
      }
    ],
    scheduleBlocks: [
      {
        id: "block-1",
        title: "Morning Show",
        categoryName: "Just Chatting",
        dayOfWeek: 5,
        startMinuteOfDay: 0,
        durationMinutes: 1440,
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
        fallbackPriority: 100,
        isGlobalFallback: false,
        createdAt: "",
        updatedAt: ""
      }
    ],
    destinations: [
      {
        id: "destination-primary",
        provider: "twitch",
        name: "Primary Twitch Output",
        enabled: true,
        rtmpUrl: "rtmp://live.twitch.tv/app",
        streamKeyPresent: true,
        status: "ready",
        notes: "Ready",
        lastValidatedAt: ""
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
      currentAssetId: "asset-1",
      currentTitle: "Asset 1",
      desiredAssetId: "asset-1",
      currentDestinationId: "destination-primary",
      restartRequestedAt: "",
      heartbeatAt: new Date().toISOString(),
      processPid: 123,
      processStartedAt: new Date().toISOString(),
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
      skipAssetId: "",
      skipUntil: "",
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
});
