import {
  normalizeAudioLaneVolumePercent,
  normalizeCuepointOffsetsSeconds,
  normalizeOverlayPanelAnchor,
  normalizeOverlaySceneCustomLayers,
  normalizeOverlaySceneLayerOrder,
  normalizeOverlayScenePreset,
  normalizeOverlaySurfaceStyle,
  normalizeOverlayTypographyPreset,
  normalizeOverlayTitleScale,
  type ModerationConfig
} from "@stream247/core";
import {
  appendAuditEvent,
  listOverlayScenePresetRecords,
  readAppState,
  readOverlayStudioState,
  replaceOverlayScenePresetRecords,
  saveOverlayDraftRecord,
  writeAppState,
  type AppState,
  type OverlayScenePresetRecord,
  type OverlaySettingsRecord,
  type OverlayStudioStateRecord,
  type PoolRecord,
  type ScheduleBlockRecord,
  type ShowProfileRecord,
  type SourceRecord,
  type StreamDestinationRecord
} from "./state";

type BlueprintSourceRecord = Pick<
  SourceRecord,
  "id" | "name" | "type" | "connectorKind" | "enabled" | "externalUrl" | "notes"
>;

type BlueprintPoolRecord = Pick<
  PoolRecord,
  | "id"
  | "name"
  | "sourceIds"
  | "playbackMode"
  | "insertAssetId"
  | "insertEveryItems"
  | "audioLaneAssetId"
  | "audioLaneVolumePercent"
>;

type BlueprintShowProfileRecord = Pick<
  ShowProfileRecord,
  "id" | "name" | "categoryName" | "defaultDurationMinutes" | "color" | "description"
>;

type BlueprintScheduleBlockRecord = Pick<
  ScheduleBlockRecord,
  | "id"
  | "title"
  | "categoryName"
  | "startMinuteOfDay"
  | "durationMinutes"
  | "dayOfWeek"
  | "showId"
  | "poolId"
  | "sourceName"
  | "repeatMode"
  | "repeatGroupId"
  | "cuepointAssetId"
  | "cuepointOffsetsSeconds"
>;

type BlueprintDestinationRecord = Pick<
  StreamDestinationRecord,
  "id" | "provider" | "role" | "priority" | "name" | "enabled" | "rtmpUrl" | "notes"
>;

export type ChannelBlueprintDocument = {
  schemaVersion: 1;
  exportedAt: string;
  blueprintName: string;
  library: {
    sources: BlueprintSourceRecord[];
  };
  programming: {
    pools: BlueprintPoolRecord[];
    showProfiles: BlueprintShowProfileRecord[];
    scheduleBlocks: BlueprintScheduleBlockRecord[];
  };
  sceneStudio: {
    liveOverlay: OverlaySettingsRecord;
    draftOverlay: OverlaySettingsRecord;
    presets: OverlayScenePresetRecord[];
  };
  operations: {
    moderation: ModerationConfig;
    destinations: BlueprintDestinationRecord[];
  };
};

type NormalizedBlueprint = {
  blueprint: ChannelBlueprintDocument;
  importedSources: SourceRecord[];
  importedPools: PoolRecord[];
  importedShowProfiles: ShowProfileRecord[];
  importedScheduleBlocks: ScheduleBlockRecord[];
  importedDestinations: StreamDestinationRecord[];
  importedModeration: ModerationConfig;
  importedLiveOverlay: OverlaySettingsRecord;
  importedDraftOverlay: OverlaySettingsRecord;
  importedPresets: OverlayScenePresetRecord[];
};

function asString(value: unknown): string {
  return String(value ?? "").trim();
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return [...new Set(value.map((entry) => asString(entry)).filter(Boolean))];
}

function normalizeModerationConfig(value: unknown, fallback: ModerationConfig): ModerationConfig {
  if (!value || typeof value !== "object") {
    return fallback;
  }

  const candidate = value as Partial<ModerationConfig>;
  return {
    enabled: typeof candidate.enabled === "boolean" ? candidate.enabled : fallback.enabled,
    command: asString(candidate.command) || fallback.command,
    defaultMinutes:
      typeof candidate.defaultMinutes === "number" && Number.isFinite(candidate.defaultMinutes)
        ? Math.max(1, Math.round(candidate.defaultMinutes))
        : fallback.defaultMinutes,
    minMinutes:
      typeof candidate.minMinutes === "number" && Number.isFinite(candidate.minMinutes)
        ? Math.max(1, Math.round(candidate.minMinutes))
        : fallback.minMinutes,
    maxMinutes:
      typeof candidate.maxMinutes === "number" && Number.isFinite(candidate.maxMinutes)
        ? Math.max(1, Math.round(candidate.maxMinutes))
        : fallback.maxMinutes,
    requirePrefix: typeof candidate.requirePrefix === "boolean" ? candidate.requirePrefix : fallback.requirePrefix,
    fallbackEmoteOnly:
      typeof candidate.fallbackEmoteOnly === "boolean" ? candidate.fallbackEmoteOnly : fallback.fallbackEmoteOnly
  };
}

function normalizeOverlaySettings(value: unknown, fallback: OverlaySettingsRecord, now: string): OverlaySettingsRecord {
  if (!value || typeof value !== "object") {
    return {
      ...fallback,
      updatedAt: fallback.updatedAt || now
    };
  }

  const candidate = value as Partial<OverlaySettingsRecord>;
  return {
    enabled: typeof candidate.enabled === "boolean" ? candidate.enabled : fallback.enabled,
    channelName: asString(candidate.channelName) || fallback.channelName,
    headline: asString(candidate.headline) || fallback.headline,
    insertHeadline: asString(candidate.insertHeadline) || fallback.insertHeadline,
    standbyHeadline: asString(candidate.standbyHeadline) || fallback.standbyHeadline,
    reconnectHeadline: asString(candidate.reconnectHeadline) || fallback.reconnectHeadline,
    replayLabel: asString(candidate.replayLabel) || fallback.replayLabel,
    brandBadge: asString(candidate.brandBadge),
    scenePreset: normalizeOverlayScenePreset(candidate.scenePreset ?? fallback.scenePreset),
    insertScenePreset: normalizeOverlayScenePreset(candidate.insertScenePreset ?? fallback.insertScenePreset),
    standbyScenePreset: normalizeOverlayScenePreset(candidate.standbyScenePreset ?? fallback.standbyScenePreset),
    reconnectScenePreset: normalizeOverlayScenePreset(candidate.reconnectScenePreset ?? fallback.reconnectScenePreset),
    accentColor: asString(candidate.accentColor) || fallback.accentColor,
    surfaceStyle: normalizeOverlaySurfaceStyle(candidate.surfaceStyle ?? fallback.surfaceStyle),
    panelAnchor: normalizeOverlayPanelAnchor(candidate.panelAnchor ?? fallback.panelAnchor),
    titleScale: normalizeOverlayTitleScale(candidate.titleScale ?? fallback.titleScale),
    typographyPreset: normalizeOverlayTypographyPreset(candidate.typographyPreset ?? fallback.typographyPreset),
    showClock: typeof candidate.showClock === "boolean" ? candidate.showClock : fallback.showClock,
    showNextItem: typeof candidate.showNextItem === "boolean" ? candidate.showNextItem : fallback.showNextItem,
    showScheduleTeaser:
      typeof candidate.showScheduleTeaser === "boolean" ? candidate.showScheduleTeaser : fallback.showScheduleTeaser,
    showCurrentCategory:
      typeof candidate.showCurrentCategory === "boolean" ? candidate.showCurrentCategory : fallback.showCurrentCategory,
    showSourceLabel: typeof candidate.showSourceLabel === "boolean" ? candidate.showSourceLabel : fallback.showSourceLabel,
    showQueuePreview:
      typeof candidate.showQueuePreview === "boolean" ? candidate.showQueuePreview : fallback.showQueuePreview,
    queuePreviewCount:
      typeof candidate.queuePreviewCount === "number" && Number.isFinite(candidate.queuePreviewCount)
        ? Math.max(1, Math.min(8, Math.round(candidate.queuePreviewCount)))
        : fallback.queuePreviewCount,
    layerOrder: normalizeOverlaySceneLayerOrder(Array.isArray(candidate.layerOrder) ? candidate.layerOrder : fallback.layerOrder),
    disabledLayers: normalizeOverlaySceneLayerOrder(
      Array.isArray(candidate.disabledLayers) ? candidate.disabledLayers : fallback.disabledLayers
    ),
    customLayers: normalizeOverlaySceneCustomLayers(Array.isArray(candidate.customLayers) ? candidate.customLayers : fallback.customLayers),
    emergencyBanner: asString(candidate.emergencyBanner),
    tickerText: asString(candidate.tickerText),
    updatedAt: asString(candidate.updatedAt) || now
  };
}

function normalizeBlueprintSourceRecord(value: unknown): BlueprintSourceRecord | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Partial<BlueprintSourceRecord>;
  const id = asString(candidate.id);
  const name = asString(candidate.name);
  const type = asString(candidate.type);
  const connectorKind = candidate.connectorKind;

  if (!id || !name || !type) {
    return null;
  }

  if (
    connectorKind !== "local-library" &&
    connectorKind !== "direct-media" &&
    connectorKind !== "youtube-playlist" &&
    connectorKind !== "youtube-channel" &&
    connectorKind !== "twitch-vod" &&
    connectorKind !== "twitch-channel"
  ) {
    return null;
  }

  return {
    id,
    name,
    type,
    connectorKind,
    enabled: candidate.enabled ?? true,
    externalUrl: asString(candidate.externalUrl),
    notes: asString(candidate.notes)
  };
}

function normalizeBlueprintPoolRecord(value: unknown, now: string): PoolRecord | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Partial<BlueprintPoolRecord>;
  const id = asString(candidate.id);
  const name = asString(candidate.name);
  if (!id || !name) {
    return null;
  }

  return {
    id,
    name,
    sourceIds: normalizeStringArray(candidate.sourceIds),
    playbackMode: "round-robin",
    cursorAssetId: "",
    insertAssetId: asString(candidate.insertAssetId),
    insertEveryItems:
      typeof candidate.insertEveryItems === "number" && Number.isFinite(candidate.insertEveryItems)
        ? Math.max(0, Math.round(candidate.insertEveryItems))
        : 0,
    audioLaneAssetId: asString(candidate.audioLaneAssetId),
    audioLaneVolumePercent: normalizeAudioLaneVolumePercent(candidate.audioLaneVolumePercent ?? 100),
    itemsSinceInsert: 0,
    updatedAt: now
  };
}

function normalizeBlueprintShowProfileRecord(value: unknown, now: string): ShowProfileRecord | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Partial<BlueprintShowProfileRecord>;
  const id = asString(candidate.id);
  const name = asString(candidate.name);
  if (!id || !name) {
    return null;
  }

  return {
    id,
    name,
    categoryName: asString(candidate.categoryName),
    defaultDurationMinutes:
      typeof candidate.defaultDurationMinutes === "number" && Number.isFinite(candidate.defaultDurationMinutes)
        ? Math.max(1, Math.round(candidate.defaultDurationMinutes))
        : 60,
    color: asString(candidate.color) || "#0e6d5a",
    description: asString(candidate.description),
    updatedAt: now
  };
}

function normalizeBlueprintScheduleBlockRecord(value: unknown): ScheduleBlockRecord | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Partial<BlueprintScheduleBlockRecord>;
  const id = asString(candidate.id);
  const title = asString(candidate.title);
  if (!id || !title) {
    return null;
  }

  const repeatMode =
    candidate.repeatMode === "daily" ||
    candidate.repeatMode === "weekdays" ||
    candidate.repeatMode === "weekends" ||
    candidate.repeatMode === "custom"
      ? candidate.repeatMode
      : "single";

  return {
    id,
    title,
    categoryName: asString(candidate.categoryName),
    startMinuteOfDay:
      typeof candidate.startMinuteOfDay === "number" && Number.isFinite(candidate.startMinuteOfDay)
        ? Math.max(0, Math.min(1439, Math.round(candidate.startMinuteOfDay)))
        : 0,
    durationMinutes:
      typeof candidate.durationMinutes === "number" && Number.isFinite(candidate.durationMinutes)
        ? Math.max(1, Math.round(candidate.durationMinutes))
        : 60,
    dayOfWeek:
      typeof candidate.dayOfWeek === "number" && Number.isFinite(candidate.dayOfWeek)
        ? Math.max(0, Math.min(6, Math.round(candidate.dayOfWeek)))
        : 0,
    showId: asString(candidate.showId),
    poolId: asString(candidate.poolId),
    sourceName: asString(candidate.sourceName),
    repeatMode,
    repeatGroupId: asString(candidate.repeatGroupId),
    cuepointAssetId: asString(candidate.cuepointAssetId),
    cuepointOffsetsSeconds: normalizeCuepointOffsetsSeconds(
      Array.isArray(candidate.cuepointOffsetsSeconds)
        ? candidate.cuepointOffsetsSeconds.map((value) => Number(value))
        : [],
      typeof candidate.durationMinutes === "number" && Number.isFinite(candidate.durationMinutes)
        ? Math.max(1, Math.round(candidate.durationMinutes))
        : 60
    )
  };
}

function normalizeBlueprintDestinationRecord(
  value: unknown,
  existing: StreamDestinationRecord[]
): StreamDestinationRecord | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Partial<BlueprintDestinationRecord>;
  const id = asString(candidate.id);
  const name = asString(candidate.name);
  const rtmpUrl = asString(candidate.rtmpUrl);
  if (!id || !name) {
    return null;
  }

  const provider = candidate.provider === "custom-rtmp" ? "custom-rtmp" : "twitch";
  const role = candidate.role === "backup" ? "backup" : "primary";
  const existingRecord =
    existing.find((destination) => destination.id === id) ??
    (id === "destination-primary"
      ? existing.find((destination) => destination.id === "destination-primary") ?? null
      : id === "destination-backup"
        ? existing.find((destination) => destination.id === "destination-backup") ?? null
        : null);
  const streamKeyPresent = existingRecord?.streamKeyPresent ?? false;

  return {
    id,
    provider,
    role,
    priority:
      typeof candidate.priority === "number" && Number.isFinite(candidate.priority)
        ? Math.max(0, Math.round(candidate.priority))
        : role === "backup"
          ? 10
          : 0,
    name,
    enabled: typeof candidate.enabled === "boolean" ? candidate.enabled : true,
    rtmpUrl,
    streamKeyPresent,
    streamKeySource:
      existingRecord?.streamKeySource ||
      (streamKeyPresent
        ? id === "destination-primary" || id === "destination-backup"
          ? "env"
          : "managed"
        : "missing"),
    status: rtmpUrl && streamKeyPresent ? "ready" : "missing-config",
    notes: asString(candidate.notes),
    lastValidatedAt: "",
    lastFailureAt: "",
    failureCount: 0,
    lastError: ""
  };
}

function normalizeBlueprintPresetRecord(value: unknown, fallback: OverlaySettingsRecord, now: string): OverlayScenePresetRecord | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Partial<OverlayScenePresetRecord>;
  const id = asString(candidate.id);
  const name = asString(candidate.name);
  if (!id || !name) {
    return null;
  }

  return {
    id,
    name,
    description: asString(candidate.description),
    overlay: normalizeOverlaySettings(candidate.overlay, fallback, now),
    createdAt: asString(candidate.createdAt) || now,
    updatedAt: asString(candidate.updatedAt) || now
  };
}

export function buildChannelBlueprintDocument(args: {
  state: AppState;
  studio: OverlayStudioStateRecord;
  presets: OverlayScenePresetRecord[];
  exportedAt?: string;
}): ChannelBlueprintDocument {
  const exportedAt = args.exportedAt || new Date().toISOString();

  return {
    schemaVersion: 1,
    exportedAt,
    blueprintName: args.studio.liveOverlay.channelName || "Stream247 channel",
    library: {
      sources: args.state.sources.map((source) => ({
        id: source.id,
        name: source.name,
        type: source.type,
        connectorKind: source.connectorKind,
        enabled: source.enabled ?? true,
        externalUrl: source.externalUrl ?? "",
        notes: source.notes ?? ""
      }))
    },
    programming: {
      pools: args.state.pools.map((pool) => ({
        id: pool.id,
        name: pool.name,
        sourceIds: [...pool.sourceIds],
        playbackMode: "round-robin",
        insertAssetId: pool.insertAssetId,
        insertEveryItems: pool.insertEveryItems,
        audioLaneAssetId: pool.audioLaneAssetId ?? "",
        audioLaneVolumePercent: pool.audioLaneVolumePercent ?? 100
      })),
      showProfiles: args.state.showProfiles.map((show) => ({
        id: show.id,
        name: show.name,
        categoryName: show.categoryName,
        defaultDurationMinutes: show.defaultDurationMinutes,
        color: show.color,
        description: show.description
      })),
      scheduleBlocks: args.state.scheduleBlocks.map((block) => ({
        id: block.id,
        title: block.title,
        categoryName: block.categoryName,
        startMinuteOfDay: block.startMinuteOfDay,
        durationMinutes: block.durationMinutes,
        dayOfWeek: block.dayOfWeek,
        showId: block.showId ?? "",
        poolId: block.poolId ?? "",
        sourceName: block.sourceName,
        repeatMode: block.repeatMode,
        repeatGroupId: block.repeatGroupId ?? "",
        cuepointAssetId: block.cuepointAssetId ?? "",
        cuepointOffsetsSeconds: [...(block.cuepointOffsetsSeconds ?? [])]
      }))
    },
    sceneStudio: {
      liveOverlay: args.studio.liveOverlay,
      draftOverlay: args.studio.draftOverlay,
      presets: args.presets
    },
    operations: {
      moderation: args.state.moderation,
      destinations: args.state.destinations.map((destination) => ({
        id: destination.id,
        provider: destination.provider,
        role: destination.role,
        priority: destination.priority,
        name: destination.name,
        enabled: destination.enabled,
        rtmpUrl: destination.rtmpUrl,
        notes: destination.notes
      }))
    }
  };
}

export function normalizeChannelBlueprintDocument(args: {
  input: unknown;
  currentState: AppState;
  studio: OverlayStudioStateRecord;
  now?: string;
}): NormalizedBlueprint {
  const now = args.now || new Date().toISOString();
  if (!args.input || typeof args.input !== "object") {
    throw new Error("Blueprint payload must be an object.");
  }

  const candidate = args.input as Partial<ChannelBlueprintDocument>;
  if (candidate.schemaVersion !== 1) {
    throw new Error("Unsupported blueprint schema version.");
  }

  const sources = Array.isArray(candidate.library?.sources)
    ? candidate.library.sources.map(normalizeBlueprintSourceRecord).filter((entry): entry is BlueprintSourceRecord => Boolean(entry))
    : [];
  const pools = Array.isArray(candidate.programming?.pools)
    ? candidate.programming.pools.map((pool) => normalizeBlueprintPoolRecord(pool, now)).filter((entry): entry is PoolRecord => Boolean(entry))
    : [];
  const showProfiles = Array.isArray(candidate.programming?.showProfiles)
    ? candidate.programming.showProfiles
        .map((show) => normalizeBlueprintShowProfileRecord(show, now))
        .filter((entry): entry is ShowProfileRecord => Boolean(entry))
    : [];
  const scheduleBlocks = Array.isArray(candidate.programming?.scheduleBlocks)
    ? candidate.programming.scheduleBlocks
        .map(normalizeBlueprintScheduleBlockRecord)
        .filter((entry): entry is ScheduleBlockRecord => Boolean(entry))
    : [];
  const importedDestinations = Array.isArray(candidate.operations?.destinations)
    ? candidate.operations.destinations
        .map((destination) => normalizeBlueprintDestinationRecord(destination, args.currentState.destinations))
        .filter((entry): entry is StreamDestinationRecord => Boolean(entry))
    : [];
  const importedLiveOverlay = normalizeOverlaySettings(
    candidate.sceneStudio?.liveOverlay,
    args.studio.liveOverlay,
    now
  );
  const importedDraftOverlay = normalizeOverlaySettings(
    candidate.sceneStudio?.draftOverlay,
    importedLiveOverlay,
    now
  );
  const importedPresets = Array.isArray(candidate.sceneStudio?.presets)
    ? candidate.sceneStudio.presets
        .map((preset) => normalizeBlueprintPresetRecord(preset, importedLiveOverlay, now))
        .filter((entry): entry is OverlayScenePresetRecord => Boolean(entry))
    : [];
  const importedModeration = normalizeModerationConfig(candidate.operations?.moderation, args.currentState.moderation);
  const importedSources: SourceRecord[] = sources.map((source) => ({
    ...source,
    status: source.enabled === false ? "Disabled in blueprint" : "Imported blueprint",
    lastSyncedAt: ""
  }));

  const blueprint = buildChannelBlueprintDocument({
    state: {
      ...args.currentState,
      sources: importedSources,
      pools,
      showProfiles,
      scheduleBlocks,
      destinations: importedDestinations,
      moderation: importedModeration
    },
    studio: {
      liveOverlay: importedLiveOverlay,
      draftOverlay: importedDraftOverlay,
      basedOnUpdatedAt: importedLiveOverlay.updatedAt,
      hasUnpublishedChanges: importedLiveOverlay.updatedAt !== importedDraftOverlay.updatedAt
    },
    presets: importedPresets,
    exportedAt: asString(candidate.exportedAt) || now
  });

  blueprint.blueprintName = asString(candidate.blueprintName) || blueprint.blueprintName;

  return {
    blueprint,
    importedSources,
    importedPools: pools,
    importedShowProfiles: showProfiles,
    importedScheduleBlocks: scheduleBlocks,
    importedDestinations,
    importedModeration,
    importedLiveOverlay,
    importedDraftOverlay,
    importedPresets
  };
}

export async function exportChannelBlueprint(): Promise<ChannelBlueprintDocument> {
  const [state, studio, presets] = await Promise.all([
    readAppState(),
    readOverlayStudioState(),
    listOverlayScenePresetRecords()
  ]);

  return buildChannelBlueprintDocument({ state, studio, presets });
}

export async function importChannelBlueprint(input: unknown): Promise<NormalizedBlueprint> {
  const [currentState, studio] = await Promise.all([readAppState(), readOverlayStudioState()]);
  const normalized = normalizeChannelBlueprintDocument({
    input,
    currentState,
    studio
  });
  const importedSourceIds = new Set(normalized.importedSources.map((source) => source.id));
  const retainedAssets = currentState.assets.filter((asset) => importedSourceIds.has(asset.sourceId));

  await writeAppState({
    ...currentState,
    moderation: normalized.importedModeration,
    overlay: normalized.importedLiveOverlay,
    sources: normalized.importedSources,
    assets: retainedAssets,
    pools: normalized.importedPools,
    showProfiles: normalized.importedShowProfiles,
    scheduleBlocks: normalized.importedScheduleBlocks,
    destinations: normalized.importedDestinations
  });
  await saveOverlayDraftRecord(normalized.importedDraftOverlay, normalized.importedLiveOverlay.updatedAt);
  await replaceOverlayScenePresetRecords(normalized.importedPresets);
  await appendAuditEvent(
    "blueprint.imported",
    `Imported channel blueprint ${normalized.blueprint.blueprintName} with ${normalized.importedSources.length} source(s), ${normalized.importedPools.length} pool(s), and ${normalized.importedScheduleBlocks.length} schedule block(s).`
  );

  return normalized;
}
