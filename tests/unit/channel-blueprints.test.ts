import { describe, expect, it } from "vitest";
import { createDefaultModerationConfig } from "@stream247/core";
import type { AppState, OverlaySettingsRecord, OverlayStudioStateRecord, StreamDestinationRecord } from "@stream247/db";
import {
  buildChannelBlueprintDocument,
  normalizeChannelBlueprintDocument,
  type ChannelBlueprintDocument
} from "../../apps/web/lib/server/channel-blueprints";

function createOverlay(overrides: Partial<OverlaySettingsRecord> = {}): OverlaySettingsRecord {
  return {
    enabled: true,
    channelName: "Replay Central",
    headline: "Always on air",
    insertHeadline: "Insert on air",
    standbyHeadline: "Please wait, restream is starting",
    reconnectHeadline: "Scheduled reconnect in progress",
    replayLabel: "Replay stream",
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
    layerOrder: ["hero", "chip", "now", "next", "clock", "banner", "ticker"],
    disabledLayers: [],
    customLayers: [],
    emergencyBanner: "",
    tickerText: "",
    updatedAt: "2026-04-05T10:00:00.000Z",
    ...overrides
  };
}

function createDestination(overrides: Partial<StreamDestinationRecord> = {}): StreamDestinationRecord {
  return {
    id: "destination-primary",
    provider: "twitch",
    role: "primary",
    priority: 0,
    name: "Primary Twitch Output",
    enabled: true,
    rtmpUrl: "rtmp://live.example.com/app",
    streamKeyPresent: true,
    status: "ready",
    notes: "Main output",
    lastValidatedAt: "",
    lastFailureAt: "",
    failureCount: 0,
    lastError: "",
    ...overrides
  };
}

function createState(): AppState {
  const overlay = createOverlay();
  return {
    initialized: true,
    owner: null,
    users: [],
    teamAccessGrants: [],
    moderation: createDefaultModerationConfig(),
    presenceWindows: [],
    overlay,
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
    pools: [
      {
        id: "pool_replay",
        name: "Replay Pool",
        sourceIds: ["source_youtube"],
        playbackMode: "round-robin",
        cursorAssetId: "asset_old",
        insertAssetId: "asset_bumper",
        insertEveryItems: 3,
        audioLaneAssetId: "asset_audio_bed",
        audioLaneVolumePercent: 42,
        itemsSinceInsert: 2,
        updatedAt: "2026-04-05T10:00:00.000Z"
      }
    ],
    showProfiles: [
      {
        id: "show_replay",
        name: "Replay Hour",
        categoryName: "Archives",
        defaultDurationMinutes: 60,
        color: "#0e6d5a",
        description: "Main replay block",
        updatedAt: "2026-04-05T10:00:00.000Z"
      }
    ],
    scheduleBlocks: [
      {
        id: "block_monday",
        title: "Morning Replays",
        categoryName: "Archives",
        startMinuteOfDay: 8 * 60,
        durationMinutes: 240,
        dayOfWeek: 1,
        showId: "show_replay",
        poolId: "pool_replay",
        sourceName: "YouTube Archives",
        repeatMode: "weekdays",
        repeatGroupId: "repeat_weekday_mornings",
        cuepointAssetId: "asset_sting",
        cuepointOffsetsSeconds: [600, 1800]
      }
    ],
    sources: [
      {
        id: "source_youtube",
        name: "YouTube Archives",
        type: "YouTube channel",
        connectorKind: "youtube-channel",
        status: "Ready",
        enabled: true,
        externalUrl: "https://www.youtube.com/@archives/videos",
        notes: "Primary longform archive source.",
        lastSyncedAt: "2026-04-05T10:00:00.000Z"
      }
    ],
    assets: [],
    sourceSyncRuns: [],
    destinations: [createDestination()],
    incidents: [],
    auditEvents: [],
    playout: {
      status: "idle",
      transitionState: "idle",
      queueVersion: 0,
      transitionTargetKind: "",
      transitionTargetAssetId: "",
      transitionTargetTitle: "",
      transitionReadyAt: "",
      currentAssetId: "",
      currentTitle: "",
      previousAssetId: "",
      previousTitle: "",
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
      currentDestinationId: "",
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
      liveBridgeInputType: "",
      liveBridgeInputUrl: "",
      liveBridgeLabel: "",
      liveBridgeStatus: "",
      liveBridgeRequestedAt: "",
      liveBridgeStartedAt: "",
      liveBridgeReleasedAt: "",
      liveBridgeLastError: "",
      cuepointWindowKey: "2026-04-05:block_monday:480:240",
      cuepointFiredKeys: ["2026-04-05:block_monday:480:240:600"],
      cuepointLastTriggeredAt: "2026-04-05T10:20:00.000Z",
      cuepointLastAssetId: "asset_sting",
      manualNextAssetId: "",
      manualNextRequestedAt: "",
      insertAssetId: "",
      insertRequestedAt: "",
      insertStatus: "",
      skipAssetId: "",
      skipUntil: "",
      pendingAction: "",
      pendingActionRequestedAt: "",
      message: ""
    }
  };
}

function createStudio(): OverlayStudioStateRecord {
  const liveOverlay = createOverlay();
  return {
    liveOverlay,
    draftOverlay: createOverlay({ brandBadge: "Draft badge", updatedAt: "2026-04-05T10:05:00.000Z" }),
    basedOnUpdatedAt: liveOverlay.updatedAt,
    hasUnpublishedChanges: true
  };
}

describe("channel blueprints", () => {
  it("exports a sanitized blueprint document without runtime-only source fields", () => {
    const state = createState();
    const studio = createStudio();
    const blueprint = buildChannelBlueprintDocument({
      state,
      studio,
      presets: [
        {
          id: "preset_replay",
          name: "Replay",
          description: "Main preset",
          overlay: studio.liveOverlay,
          createdAt: "2026-04-05T10:00:00.000Z",
          updatedAt: "2026-04-05T10:00:00.000Z"
        }
      ],
      exportedAt: "2026-04-05T12:00:00.000Z"
    });

    expect(blueprint.schemaVersion).toBe(1);
    expect(blueprint.library.sources[0]).not.toHaveProperty("status");
    expect(blueprint.library.sources[0]).not.toHaveProperty("lastSyncedAt");
    expect(blueprint.operations.destinations[0]).not.toHaveProperty("streamKeyPresent");
    expect(blueprint.sceneStudio.draftOverlay.brandBadge).toBe("Draft badge");
    expect(blueprint.programming.pools[0]?.audioLaneAssetId).toBe("asset_audio_bed");
    expect(blueprint.programming.scheduleBlocks[0]?.cuepointOffsetsSeconds).toEqual([600, 1800]);
  });

  it("normalizes imported blueprints into safe runtime records", () => {
    const state = createState();
    const studio = createStudio();
    const blueprint = buildChannelBlueprintDocument({
      state,
      studio,
      presets: [
        {
          id: "preset_replay",
          name: "Replay",
          description: "Main preset",
          overlay: studio.liveOverlay,
          createdAt: "2026-04-05T10:00:00.000Z",
          updatedAt: "2026-04-05T10:00:00.000Z"
        }
      ],
      exportedAt: "2026-04-05T12:00:00.000Z"
    });

    const normalized = normalizeChannelBlueprintDocument({
      input: blueprint as ChannelBlueprintDocument,
      currentState: state,
      studio,
      now: "2026-04-05T12:05:00.000Z"
    });

    expect(normalized.importedSources[0]?.status).toBe("Imported blueprint");
    expect(normalized.importedSources[0]?.lastSyncedAt).toBe("");
    expect(normalized.importedPools[0]?.cursorAssetId).toBe("");
    expect(normalized.importedPools[0]?.itemsSinceInsert).toBe(0);
    expect(normalized.importedPools[0]?.audioLaneAssetId).toBe("asset_audio_bed");
    expect(normalized.importedPools[0]?.audioLaneVolumePercent).toBe(42);
    expect(normalized.importedScheduleBlocks[0]?.cuepointAssetId).toBe("asset_sting");
    expect(normalized.importedScheduleBlocks[0]?.cuepointOffsetsSeconds).toEqual([600, 1800]);
    expect(normalized.importedDestinations[0]?.streamKeyPresent).toBe(true);
    expect(normalized.importedPresets).toHaveLength(1);
    expect(normalized.importedDraftOverlay.brandBadge).toBe("Draft badge");
  });

  it("does not leak one primary output key state into another imported primary destination", () => {
    const state = createState();
    const studio = createStudio();
    const blueprint = buildChannelBlueprintDocument({
      state: {
        ...state,
        destinations: [
          createDestination(),
          createDestination({
            id: "destination-youtube",
            provider: "custom-rtmp",
            role: "primary",
            priority: 1,
            name: "YouTube",
            rtmpUrl: "rtmp://a.rtmp.youtube.com/live2",
            streamKeyPresent: false,
            streamKeySource: "missing"
          })
        ]
      },
      studio,
      presets: [],
      exportedAt: "2026-04-05T12:00:00.000Z"
    });

    const normalized = normalizeChannelBlueprintDocument({
      input: blueprint as ChannelBlueprintDocument,
      currentState: state,
      studio,
      now: "2026-04-05T12:05:00.000Z"
    });

    expect(normalized.importedDestinations.find((destination) => destination.id === "destination-youtube")?.streamKeyPresent).toBe(
      false
    );
  });
});
