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
    assets: [
      {
        id: "asset_old",
        sourceId: "source_youtube",
        title: "Continuity Archive",
        path: "/library/continuity-archive.mp4",
        folderPath: "archives/mornings",
        tags: ["replay", "featured"],
        status: "ready",
        includeInProgramming: true,
        externalId: "continuity-archive",
        categoryName: "Archives",
        durationSeconds: 1800,
        publishedAt: "2026-04-05T09:00:00.000Z",
        fallbackPriority: 50,
        isGlobalFallback: false,
        createdAt: "2026-04-05T09:00:00.000Z",
        updatedAt: "2026-04-05T10:00:00.000Z"
      },
      {
        id: "asset_bumper",
        sourceId: "source_youtube",
        title: "Channel ID",
        path: "/library/channel-id.mp4",
        folderPath: "archives/utility",
        tags: ["insert"],
        status: "ready",
        includeInProgramming: true,
        externalId: "channel-id",
        categoryName: "Utility",
        durationSeconds: 15,
        publishedAt: "2026-04-05T09:00:00.000Z",
        fallbackPriority: 60,
        isGlobalFallback: false,
        createdAt: "2026-04-05T09:00:00.000Z",
        updatedAt: "2026-04-05T10:00:00.000Z"
      },
      {
        id: "asset_audio_bed",
        sourceId: "source_youtube",
        title: "Replay Bed",
        path: "/library/replay-bed.mp3",
        folderPath: "archives/audio",
        tags: ["audio-bed"],
        status: "ready",
        includeInProgramming: true,
        externalId: "replay-bed",
        categoryName: "Utility",
        durationSeconds: 900,
        publishedAt: "2026-04-05T09:00:00.000Z",
        fallbackPriority: 70,
        isGlobalFallback: false,
        createdAt: "2026-04-05T09:00:00.000Z",
        updatedAt: "2026-04-05T10:00:00.000Z"
      },
      {
        id: "asset_sting",
        sourceId: "source_youtube",
        title: "Replay Sting",
        path: "/library/replay-sting.mp4",
        folderPath: "archives/utility",
        tags: ["cuepoint"],
        status: "ready",
        includeInProgramming: true,
        externalId: "replay-sting",
        categoryName: "Utility",
        durationSeconds: 8,
        publishedAt: "2026-04-05T09:00:00.000Z",
        fallbackPriority: 80,
        isGlobalFallback: false,
        createdAt: "2026-04-05T09:00:00.000Z",
        updatedAt: "2026-04-05T10:00:00.000Z"
      }
    ],
    assetCollections: [
      {
        id: "collection_replay_starters",
        name: "Replay Starters",
        description: "Reusable replay utility kit",
        color: "#0e6d5a",
        assetIds: ["asset_old", "asset_bumper"],
        createdAt: "2026-04-05T10:00:00.000Z",
        updatedAt: "2026-04-05T10:00:00.000Z"
      }
    ],
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
    expect(blueprint.library.curatedSets).toHaveLength(1);
    expect(blueprint.library.curatedSets[0]?.items.map((item) => item.id)).toEqual(["asset_old", "asset_bumper"]);
    expect(blueprint.operations.destinations[0]).not.toHaveProperty("streamKeyPresent");
    expect(blueprint.sceneStudio.draftOverlay.brandBadge).toBe("Draft badge");
    expect(blueprint.programming.pools[0]?.audioLaneAssetId).toBe("asset_audio_bed");
    expect(blueprint.programming.pools[0]?.insertAssetRef?.externalId).toBe("channel-id");
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
    expect(normalized.importedAssetCollections[0]?.assetIds).toEqual(["asset_old", "asset_bumper"]);
    expect(normalized.importedDestinations[0]?.streamKeyPresent).toBe(true);
    expect(normalized.importedPresets).toHaveLength(1);
    expect(normalized.importedDraftOverlay.brandBadge).toBe("Draft badge");
    expect(normalized.warnings).toEqual([]);
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

  it("clears missing media references and warns when curated-set items do not remap locally", () => {
    const state = createState();
    const studio = createStudio();
    const blueprint = buildChannelBlueprintDocument({
      state,
      studio,
      presets: [],
      exportedAt: "2026-04-05T12:00:00.000Z"
    });

    blueprint.programming.pools[0]!.audioLaneAssetRef = {
      id: "asset_missing_audio",
      sourceId: "source_youtube",
      title: "Missing Audio Bed",
      path: "/library/missing-audio-bed.mp3",
      externalId: "missing-audio-bed"
    };
    blueprint.programming.pools[0]!.audioLaneAssetId = "asset_missing_audio";
    blueprint.programming.scheduleBlocks[0]!.cuepointAssetRef = {
      id: "asset_missing_sting",
      sourceId: "source_youtube",
      title: "Missing Sting",
      path: "/library/missing-sting.mp4",
      externalId: "missing-sting"
    };
    blueprint.programming.scheduleBlocks[0]!.cuepointAssetId = "asset_missing_sting";
    blueprint.library.curatedSets[0]!.items.push({
      id: "asset_missing_collection_item",
      sourceId: "source_youtube",
      title: "Missing Curated Item",
      path: "/library/missing-item.mp4",
      externalId: "missing-item"
    });

    const normalized = normalizeChannelBlueprintDocument({
      input: blueprint as ChannelBlueprintDocument,
      currentState: state,
      studio,
      now: "2026-04-05T12:05:00.000Z"
    });

    expect(normalized.importedPools[0]?.audioLaneAssetId).toBe("");
    expect(normalized.importedScheduleBlocks[0]?.cuepointAssetId).toBe("");
    expect(normalized.importedAssetCollections[0]?.assetIds).toEqual(["asset_old", "asset_bumper"]);
    expect(normalized.warnings).toEqual(
      expect.arrayContaining([
        "Pool Replay Pool cleared its audio lane asset because the referenced media is not present locally.",
        "Schedule block Morning Replays cleared its cuepoint asset because the referenced media is not present locally.",
        "Curated set Replay Starters matched 2 of 3 item(s); media files are not transferred by blueprints."
      ])
    );
  });

  it("keeps disabled sections untouched while still flagging programming-only imports", () => {
    const state = createState();
    const studio = createStudio();
    const blueprint = buildChannelBlueprintDocument({
      state: {
        ...state,
        sources: [
          {
            ...state.sources[0]!,
            name: "Imported Library Source"
          }
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
      options: {
        sections: {
          library: false,
          programming: true,
          sceneStudio: false,
          operations: false
        }
      },
      now: "2026-04-05T12:05:00.000Z"
    });

    expect(normalized.sections).toEqual({
      library: false,
      programming: true,
      sceneStudio: false,
      operations: false
    });
    expect(normalized.importedSources[0]?.name).toBe("YouTube Archives");
    expect(normalized.importedDestinations[0]?.name).toBe(state.destinations[0]?.name);
    expect(normalized.importedModeration).toEqual(state.moderation);
    expect(normalized.warnings).toContain(
      "Programming was imported without library sources. Pool and cuepoint asset references were kept only where this workspace already had matching media."
    );
  });
});
