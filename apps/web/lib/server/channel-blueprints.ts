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
  type AssetCollectionRecord,
  type AssetRecord,
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

type BlueprintAssetReference = Pick<AssetRecord, "id" | "sourceId" | "title" | "path" | "externalId">;

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
> & {
  insertAssetRef?: BlueprintAssetReference | null;
  audioLaneAssetRef?: BlueprintAssetReference | null;
};

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
> & {
  cuepointAssetRef?: BlueprintAssetReference | null;
};

type BlueprintAssetCollectionRecord = Pick<AssetCollectionRecord, "id" | "name" | "description" | "color"> & {
  items: BlueprintAssetReference[];
};

type BlueprintDestinationRecord = Pick<
  StreamDestinationRecord,
  "id" | "provider" | "role" | "priority" | "name" | "enabled" | "rtmpUrl" | "notes"
>;

export type BlueprintImportSectionState = {
  library: boolean;
  programming: boolean;
  sceneStudio: boolean;
  operations: boolean;
};

export type BlueprintImportOptions = {
  sections?: Partial<BlueprintImportSectionState>;
};

export type ChannelBlueprintDocument = {
  schemaVersion: 1;
  exportedAt: string;
  blueprintName: string;
  library: {
    sources: BlueprintSourceRecord[];
    curatedSets: BlueprintAssetCollectionRecord[];
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
  importedAssetCollections: AssetCollectionRecord[];
  importedDestinations: StreamDestinationRecord[];
  importedModeration: ModerationConfig;
  importedLiveOverlay: OverlaySettingsRecord;
  importedDraftOverlay: OverlaySettingsRecord;
  importedPresets: OverlayScenePresetRecord[];
  warnings: string[];
  sections: BlueprintImportSectionState;
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

function normalizeCollectionColor(value: unknown): string {
  const candidate = asString(value).toLowerCase();
  return /^#[0-9a-f]{6}$/.test(candidate) ? candidate : "#0e6d5a";
}

function resolveImportSections(options?: BlueprintImportOptions): BlueprintImportSectionState {
  return {
    library: options?.sections?.library ?? true,
    programming: options?.sections?.programming ?? true,
    sceneStudio: options?.sections?.sceneStudio ?? true,
    operations: options?.sections?.operations ?? true
  };
}

function buildBlueprintAssetReference(asset: AssetRecord | undefined): BlueprintAssetReference | null {
  if (!asset) {
    return null;
  }

  return {
    id: asset.id,
    sourceId: asset.sourceId,
    title: asset.title,
    path: asset.path,
    externalId: asset.externalId
  };
}

function resolveBlueprintAssetReference(
  assetId: string,
  assetRef: BlueprintAssetReference | null | undefined,
  targetAssets: AssetRecord[]
): string {
  const directMatch = targetAssets.find((asset) => asset.id === assetId);
  if (directMatch) {
    return directMatch.id;
  }

  if (assetRef?.sourceId && assetRef.externalId) {
    const externalMatch = targetAssets.find(
      (asset) => asset.sourceId === assetRef.sourceId && asset.externalId && asset.externalId === assetRef.externalId
    );
    if (externalMatch) {
      return externalMatch.id;
    }
  }

  if (assetRef?.sourceId && assetRef.path) {
    const pathMatch = targetAssets.find((asset) => asset.sourceId === assetRef.sourceId && asset.path === assetRef.path);
    if (pathMatch) {
      return pathMatch.id;
    }
  }

  return "";
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

function normalizeBlueprintAssetCollectionRecord(value: unknown): BlueprintAssetCollectionRecord | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Partial<BlueprintAssetCollectionRecord>;
  const id = asString(candidate.id);
  const name = asString(candidate.name);
  if (!id || !name) {
    return null;
  }

  const items: BlueprintAssetReference[] = Array.isArray(candidate.items)
    ? candidate.items.flatMap((item) => {
        if (!item || typeof item !== "object") {
          return [];
        }
        const assetCandidate = item as Partial<BlueprintAssetReference>;
        const itemId = asString(assetCandidate.id);
        if (!itemId) {
          return [];
        }
        return [
          {
            id: itemId,
            sourceId: asString(assetCandidate.sourceId),
            title: asString(assetCandidate.title),
            path: asString(assetCandidate.path),
            externalId: asString(assetCandidate.externalId)
          }
        ];
      })
    : [];

  return {
    id,
    name,
    description: asString(candidate.description),
    color: normalizeCollectionColor(candidate.color),
    items
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
  const assetsById = new Map(args.state.assets.map((asset) => [asset.id, asset] as const));

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
      })),
      curatedSets: args.state.assetCollections.map((collection) => ({
        id: collection.id,
        name: collection.name,
        description: collection.description,
        color: collection.color,
        items: collection.assetIds
          .map((assetId) => buildBlueprintAssetReference(assetsById.get(assetId)))
          .filter((entry): entry is BlueprintAssetReference => Boolean(entry))
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
        audioLaneVolumePercent: pool.audioLaneVolumePercent ?? 100,
        insertAssetRef: buildBlueprintAssetReference(assetsById.get(pool.insertAssetId)),
        audioLaneAssetRef: buildBlueprintAssetReference(assetsById.get(pool.audioLaneAssetId))
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
        cuepointOffsetsSeconds: [...(block.cuepointOffsetsSeconds ?? [])],
        cuepointAssetRef: buildBlueprintAssetReference(block.cuepointAssetId ? assetsById.get(block.cuepointAssetId) : undefined)
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
  options?: BlueprintImportOptions;
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

  const sections = resolveImportSections(args.options);
  const warnings: string[] = [];

  const parsedSources = Array.isArray(candidate.library?.sources)
    ? candidate.library.sources
        .map(normalizeBlueprintSourceRecord)
        .filter((entry): entry is BlueprintSourceRecord => Boolean(entry))
    : [];
  const parsedCollections = Array.isArray(candidate.library?.curatedSets)
    ? candidate.library.curatedSets
        .map(normalizeBlueprintAssetCollectionRecord)
        .filter((entry): entry is BlueprintAssetCollectionRecord => Boolean(entry))
    : [];
  const parsedPools = Array.isArray(candidate.programming?.pools)
    ? candidate.programming.pools
        .map((pool) => ({
          raw: pool,
          normalized: normalizeBlueprintPoolRecord(pool, now)
        }))
        .filter((entry): entry is { raw: BlueprintPoolRecord; normalized: PoolRecord } => Boolean(entry.normalized))
    : [];
  const parsedShowProfiles = Array.isArray(candidate.programming?.showProfiles)
    ? candidate.programming.showProfiles
        .map((show) => normalizeBlueprintShowProfileRecord(show, now))
        .filter((entry): entry is ShowProfileRecord => Boolean(entry))
    : [];
  const parsedScheduleBlocks = Array.isArray(candidate.programming?.scheduleBlocks)
    ? candidate.programming.scheduleBlocks
        .map((block) => ({
          raw: block,
          normalized: normalizeBlueprintScheduleBlockRecord(block)
        }))
        .filter((entry): entry is { raw: BlueprintScheduleBlockRecord; normalized: ScheduleBlockRecord } => Boolean(entry.normalized))
    : [];

  const importedSources: SourceRecord[] = sections.library
    ? parsedSources.map((source) => ({
        ...source,
        status: source.enabled === false ? "Disabled in blueprint" : "Imported blueprint",
        lastSyncedAt: ""
      }))
    : args.currentState.sources;
  const targetSourceIds = new Set(importedSources.map((source) => source.id));
  const targetAssets = sections.library
    ? args.currentState.assets.filter((asset) => targetSourceIds.has(asset.sourceId))
    : args.currentState.assets;

  const importedPools: PoolRecord[] = sections.programming
    ? parsedPools.map(({ raw, normalized }) => {
        const sourceIds = normalized.sourceIds.filter((sourceId) => targetSourceIds.has(sourceId));
        const droppedSourceIds = normalized.sourceIds.filter((sourceId) => !targetSourceIds.has(sourceId));
        if (droppedSourceIds.length > 0) {
          warnings.push(
            `Pool ${normalized.name} skipped ${droppedSourceIds.length} source reference(s) because they are not available in this workspace import.`
          );
        }

        const insertAssetId = resolveBlueprintAssetReference(
          normalized.insertAssetId,
          raw.insertAssetRef ?? null,
          targetAssets
        );
        if (normalized.insertAssetId && !insertAssetId) {
          warnings.push(
            `Pool ${normalized.name} cleared its insert asset because the referenced media is not present locally.`
          );
        }

        const audioLaneAssetId = resolveBlueprintAssetReference(
          normalized.audioLaneAssetId,
          raw.audioLaneAssetRef ?? null,
          targetAssets
        );
        if (normalized.audioLaneAssetId && !audioLaneAssetId) {
          warnings.push(
            `Pool ${normalized.name} cleared its audio lane asset because the referenced media is not present locally.`
          );
        }

        return {
          ...normalized,
          sourceIds,
          insertAssetId,
          audioLaneAssetId
        };
      })
    : args.currentState.pools;
  const importedShowProfiles = sections.programming ? parsedShowProfiles : args.currentState.showProfiles;
  const importedShowProfileIds = new Set(importedShowProfiles.map((show) => show.id));
  const importedPoolIds = new Set(importedPools.map((pool) => pool.id));
  const importedScheduleBlocks: ScheduleBlockRecord[] = sections.programming
    ? parsedScheduleBlocks.map(({ raw, normalized }) => {
        const cuepointAssetId = resolveBlueprintAssetReference(
          normalized.cuepointAssetId ?? "",
          raw.cuepointAssetRef ?? null,
          targetAssets
        );
        if (normalized.cuepointAssetId && !cuepointAssetId) {
          warnings.push(
            `Schedule block ${normalized.title} cleared its cuepoint asset because the referenced media is not present locally.`
          );
        }

        const showId = normalized.showId && importedShowProfileIds.has(normalized.showId) ? normalized.showId : "";
        if (normalized.showId && !showId) {
          warnings.push(`Schedule block ${normalized.title} skipped a missing show profile reference.`);
        }
        const poolId = normalized.poolId && importedPoolIds.has(normalized.poolId) ? normalized.poolId : "";
        if (normalized.poolId && !poolId) {
          warnings.push(`Schedule block ${normalized.title} skipped a missing pool reference.`);
        }

        return {
          ...normalized,
          showId,
          poolId,
          cuepointAssetId
        };
      })
    : args.currentState.scheduleBlocks;

  const importedAssetCollections: AssetCollectionRecord[] = sections.library
    ? parsedCollections.map((collection) => {
        const resolvedAssetIds = collection.items
          .map((item) => resolveBlueprintAssetReference(item.id, item, targetAssets))
          .filter(Boolean);
        if (collection.items.length > resolvedAssetIds.length) {
          warnings.push(
            `Curated set ${collection.name} matched ${resolvedAssetIds.length} of ${collection.items.length} item(s); media files are not transferred by blueprints.`
          );
        }
        return {
          id: collection.id,
          name: collection.name,
          description: collection.description,
          color: collection.color,
          assetIds: resolvedAssetIds,
          createdAt: now,
          updatedAt: now
        };
      })
    : args.currentState.assetCollections;

  const importedDestinations = sections.operations
    ? Array.isArray(candidate.operations?.destinations)
      ? candidate.operations.destinations
          .map((destination) => normalizeBlueprintDestinationRecord(destination, args.currentState.destinations))
          .filter((entry): entry is StreamDestinationRecord => Boolean(entry))
      : []
    : args.currentState.destinations;
  const importedModeration = sections.operations
    ? normalizeModerationConfig(candidate.operations?.moderation, args.currentState.moderation)
    : args.currentState.moderation;
  const importedLiveOverlay = sections.sceneStudio
    ? normalizeOverlaySettings(candidate.sceneStudio?.liveOverlay, args.studio.liveOverlay, now)
    : args.studio.liveOverlay;
  const importedDraftOverlay = sections.sceneStudio
    ? normalizeOverlaySettings(candidate.sceneStudio?.draftOverlay, importedLiveOverlay, now)
    : args.studio.draftOverlay;
  const importedPresets = sections.sceneStudio
    ? Array.isArray(candidate.sceneStudio?.presets)
      ? candidate.sceneStudio.presets
          .map((preset) => normalizeBlueprintPresetRecord(preset, importedLiveOverlay, now))
          .filter((entry): entry is OverlayScenePresetRecord => Boolean(entry))
      : []
    : [];

  if (sections.library && targetAssets.length === 0 && parsedCollections.some((collection) => collection.items.length > 0)) {
    warnings.push("No local assets matched the imported curated sets yet. Re-run the relevant source syncs after importing.");
  }
  if (sections.programming && !sections.library) {
    warnings.push("Programming was imported without library sources. Pool and cuepoint asset references were kept only where this workspace already had matching media.");
  }

  const blueprint = buildChannelBlueprintDocument({
    state: {
      ...args.currentState,
      sources: importedSources,
      assets: targetAssets,
      assetCollections: importedAssetCollections,
      pools: importedPools,
      showProfiles: importedShowProfiles,
      scheduleBlocks: importedScheduleBlocks,
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
    importedPools,
    importedShowProfiles,
    importedScheduleBlocks,
    importedAssetCollections,
    importedDestinations,
    importedModeration,
    importedLiveOverlay,
    importedDraftOverlay,
    importedPresets,
    warnings: [...new Set(warnings)],
    sections
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

export async function importChannelBlueprint(input: unknown, options?: BlueprintImportOptions): Promise<NormalizedBlueprint> {
  const [currentState, studio] = await Promise.all([readAppState(), readOverlayStudioState()]);
  const normalized = normalizeChannelBlueprintDocument({
    input,
    currentState,
    studio,
    options
  });
  const importedSourceIds = new Set(normalized.importedSources.map((source) => source.id));
  const importedAssets = normalized.sections.library
    ? currentState.assets.filter((asset) => importedSourceIds.has(asset.sourceId))
    : currentState.assets;

  await writeAppState({
    ...currentState,
    moderation: normalized.importedModeration,
    sources: normalized.importedSources,
    assets: importedAssets,
    assetCollections: normalized.importedAssetCollections,
    overlay: normalized.importedLiveOverlay,
    pools: normalized.importedPools,
    showProfiles: normalized.importedShowProfiles,
    scheduleBlocks: normalized.importedScheduleBlocks,
    destinations: normalized.importedDestinations
  });
  if (normalized.sections.sceneStudio) {
    await saveOverlayDraftRecord(normalized.importedDraftOverlay, normalized.importedLiveOverlay.updatedAt);
    await replaceOverlayScenePresetRecords(normalized.importedPresets);
  }
  await appendAuditEvent(
    "blueprint.imported",
    `Imported channel blueprint ${normalized.blueprint.blueprintName} with sections ${Object.entries(normalized.sections)
      .filter(([, enabled]) => enabled)
      .map(([key]) => key)
      .join(", ")}${normalized.warnings.length > 0 ? ` and ${normalized.warnings.length} warning(s)` : ""}.`
  );

  return normalized;
}
