import {
  DEFAULT_DESTINATION_FAILURE_COOLDOWN_SECONDS,
  DEFAULT_ENGAGEMENT_SETTINGS,
  buildOverlayScenePayload,
  buildMaterializedProgrammingWeek,
  buildSchedulePreviewVideoSlots,
  getCuepointProgress,
  buildScheduleOccurrences,
  buildSchedulePreview,
  describePresenceStatus,
  findCurrentScheduleOccurrence,
  findNextScheduleOccurrence,
  getDestinationFailureSecondsRemaining as getDestinationFailureHoldSecondsRemaining,
  getScheduleElapsedSeconds,
  getCurrentScheduleMoment,
  isCurrentScheduleTime,
  normalizeOverlayPanelAnchor,
  normalizeOverlayScenePreset,
  normalizeOverlaySurfaceStyle,
  normalizeOverlayTypographyPreset,
  normalizeOverlayTitleScale,
  normalizeCuepointOffsetsSeconds,
  selectActiveDestinationGroup,
  isLikelyTwitchChannelUrl,
  isLikelyTwitchVodUrl,
  isLikelyYouTubeChannelUrl,
  isLikelyYouTubePlaylistUrl,
  isEngagementAlertsRuntimeEnabled,
  isEngagementChatRuntimeEnabled,
  normalizeEngagementSettings,
  summarizeLiveBridgeInput,
  type OverlaySceneRenderTarget
} from "@stream247/core";
import {
  appendAuditEvent,
  appendEngagementEventRecord,
  appendPresenceWindowRecord,
  applyOverlayScenePresetRecordToDraft,
  createPoolRecord,
  createScheduleBlocks,
  createShowProfileRecord,
  deleteAssetCollectionRecord,
  deleteDestinationRecord,
  deleteOverlayScenePresetRecord,
  deletePoolRecord,
  deleteScheduleBlockRecord,
  deleteSourceRecordAndAssets,
  deleteShowProfileRecord,
  acknowledgeIncident,
  findTeamGrantByLogin,
  findUserByEmail,
  findUserById,
  listOverlayScenePresetRecords,
  publishOverlayDraftRecord,
  readOverlayStudioState,
  readManagedDestinationStreamKeys,
  resetOverlayDraftRecord,
  replaceOverlayScenePresetRecords,
  saveOverlayDraftRecord,
  saveOverlayScenePresetRecord,
  updateDestinationRecord,
  updateEngagementSettingsRecord,
  updateManagedConfigRecord,
  updateModerationConfigRecord,
  updateOverlaySettingsRecord,
  updateOutputSettingsRecord,
  readAppState,
  replaceAllScheduleBlocks,
  replaceTwitchScheduleSegments,
  resolveIncident,
  replaceAssetsForSourceIds,
  updateAssetCurationRecords,
  updateAssetCollectionMemberships,
  updateAssetMetadataRecords,
  updateAssetRecords,
  updatePlayoutRuntime,
  updatePoolCursor,
  updateAppState,
  updatePoolRecord,
  updateScheduleBlockRecord,
  updateScheduleRepeatGroupRecords,
  updateShowProfileRecord,
  updateSourceFieldRecords,
  updateTwitchConnectionRecord,
  updateOwnerAndInitialized,
  upsertAssetCollectionRecords,
  upsertSourceRecord,
  upsertSources,
  upsertTeamAccessGrantRecord,
  upsertUserRecord,
  writeAppState,
  type AppState,
  type AssetCollectionRecord,
  type AssetRecord,
  type AssetCollectionMembershipUpdateRecord,
  type AssetMetadataUpdateRecord,
  type AuditEvent,
  type EngagementEventRecord,
  type EngagementSettingsRecord,
  type IncidentRecord,
  type ModeratorPresenceWindowRecord,
  type OwnerAccount,
  type OverlayStudioStateRecord,
  type PlayoutRuntimeRecord,
  type PoolRecord,
  type ShowProfileRecord,
  type ScheduleBlockRecord,
  type SourceSyncRunRecord,
  type SourceRecord,
  type StreamDestinationRecord,
  type TeamAccessGrant,
  type TwitchConnection,
  type UserRecord,
  type UserRole,
  type OverlayScenePresetRecord,
  type OverlaySettingsRecord,
  type OutputSettingsRecord,
  type ManagedConfigRecord
} from "@stream247/db";
import type {
  BroadcastSnapshot,
  LiveAssetSummary,
  LiveAudioLaneSummary,
  LiveCuepointSummary,
  LiveDestinationSummary,
  LiveEngagementSummary,
  LiveIncidentSummary,
  LiveOverlaySummary,
  LivePlayoutSummary,
  LiveQueueItemSummary,
  LiveBridgeSummary,
  LiveScheduleSummary,
  PublicChannelSnapshot
} from "@/lib/live-broadcast";

export type {
  AppState,
  AssetCollectionRecord,
  AssetRecord,
  AssetCollectionMembershipUpdateRecord,
  AssetMetadataUpdateRecord,
  AuditEvent,
  EngagementEventRecord,
  EngagementSettingsRecord,
  IncidentRecord,
  ModeratorPresenceWindowRecord,
  OwnerAccount,
  PlayoutRuntimeRecord,
  PoolRecord,
  ShowProfileRecord,
  OverlayStudioStateRecord,
  OverlayScenePresetRecord,
  OverlaySettingsRecord,
  OutputSettingsRecord,
  ManagedConfigRecord,
  ScheduleBlockRecord,
  SourceSyncRunRecord,
  SourceRecord,
  StreamDestinationRecord,
  TeamAccessGrant,
  TwitchConnection,
  UserRecord,
  UserRole
};

export {
  acknowledgeIncident,
  appendAuditEvent,
  appendEngagementEventRecord,
  appendPresenceWindowRecord,
  applyOverlayScenePresetRecordToDraft,
  createPoolRecord,
  createScheduleBlocks,
  createShowProfileRecord,
  deleteAssetCollectionRecord,
  deleteDestinationRecord,
  deleteOverlayScenePresetRecord,
  deletePoolRecord,
  deleteScheduleBlockRecord,
  deleteSourceRecordAndAssets,
  deleteShowProfileRecord,
  findTeamGrantByLogin,
  findUserByEmail,
  findUserById,
  listOverlayScenePresetRecords,
  publishOverlayDraftRecord,
  readOverlayStudioState,
  readManagedDestinationStreamKeys,
  resetOverlayDraftRecord,
  replaceOverlayScenePresetRecords,
  saveOverlayDraftRecord,
  saveOverlayScenePresetRecord,
  updateDestinationRecord,
  updateEngagementSettingsRecord,
  updateManagedConfigRecord,
  updateModerationConfigRecord,
  updateOverlaySettingsRecord,
  updateOutputSettingsRecord,
  readAppState,
  replaceAllScheduleBlocks,
  replaceTwitchScheduleSegments,
  replaceAssetsForSourceIds,
  resolveIncident,
  updateAssetCurationRecords,
  updateAssetCollectionMemberships,
  updateAssetMetadataRecords,
  updateAssetRecords,
  updateAppState,
  updateOwnerAndInitialized,
  updatePlayoutRuntime,
  updatePoolCursor,
  updatePoolRecord,
  updateScheduleBlockRecord,
  updateScheduleRepeatGroupRecords,
  updateShowProfileRecord,
  updateSourceFieldRecords,
  updateTwitchConnectionRecord,
  upsertSourceRecord,
  upsertAssetCollectionRecords,
  upsertSources,
  upsertTeamAccessGrantRecord,
  upsertUserRecord,
  writeAppState
};

export function getWorkspaceTimeZone(): string {
  return process.env.CHANNEL_TIMEZONE || "UTC";
}

export function getSchedulePreview(state: AppState) {
  const scheduleMoment = getCurrentScheduleMoment({
    now: new Date(),
    timeZone: getWorkspaceTimeZone()
  });

  return buildSchedulePreview({
    date: scheduleMoment.date,
    blocks: state.scheduleBlocks,
    pools: state.pools,
    assets: state.assets
  });
}

export function getMaterializedProgrammingWeekPreview(state: AppState) {
  const scheduleMoment = getCurrentScheduleMoment({
    now: new Date(),
    timeZone: getWorkspaceTimeZone()
  });

  return buildMaterializedProgrammingWeek({
    startDate: scheduleMoment.date,
    blocks: state.scheduleBlocks,
    pools: state.pools,
    assets: state.assets
  });
}

export function getPresenceStatus(state: AppState) {
  return describePresenceStatus({
    activeWindows: state.presenceWindows.map((window) => ({
      actor: window.actor,
      minutes: window.minutes,
      createdAt: new Date(window.createdAt),
      expiresAt: new Date(window.expiresAt)
    })),
    now: new Date(),
    fallbackEmoteOnly: state.moderation.fallbackEmoteOnly
  });
}

export function getActivePresenceWindows(state: AppState): ModeratorPresenceWindowRecord[] {
  const now = new Date();
  return state.presenceWindows.filter((window) => new Date(window.expiresAt) > now);
}

export function getManagedConfigValue<K extends keyof ManagedConfigRecord>(
  state: AppState,
  key: K,
  envFallback = ""
): ManagedConfigRecord[K] {
  const value = state.managedConfig[key];
  return ((typeof value === "string" && value !== "" ? value : envFallback) as ManagedConfigRecord[K]);
}

export function getManagedTwitchConfig(state: AppState) {
  return {
    clientId: getManagedConfigValue(state, "twitchClientId", process.env.TWITCH_CLIENT_ID || ""),
    clientSecret: getManagedConfigValue(state, "twitchClientSecret", process.env.TWITCH_CLIENT_SECRET || ""),
    defaultCategoryId: getManagedConfigValue(
      state,
      "twitchDefaultCategoryId",
      process.env.TWITCH_DEFAULT_CATEGORY_ID || ""
    )
  };
}

export function getManagedAlertConfig(state: AppState) {
  return {
    discordWebhookUrl: getManagedConfigValue(state, "discordWebhookUrl", process.env.DISCORD_WEBHOOK_URL || ""),
    smtpHost: getManagedConfigValue(state, "smtpHost", process.env.SMTP_HOST || ""),
    smtpPort: getManagedConfigValue(state, "smtpPort", process.env.SMTP_PORT || ""),
    smtpUser: getManagedConfigValue(state, "smtpUser", process.env.SMTP_USER || ""),
    smtpPassword: getManagedConfigValue(state, "smtpPassword", process.env.SMTP_PASSWORD || ""),
    smtpFrom: getManagedConfigValue(state, "smtpFrom", process.env.SMTP_FROM || ""),
    alertEmailTo: getManagedConfigValue(state, "alertEmailTo", process.env.ALERT_EMAIL_TO || "")
  };
}

export function getCurrentScheduleItem(state: AppState) {
  const scheduleMoment = getCurrentScheduleMoment({
    now: new Date(),
    timeZone: getWorkspaceTimeZone()
  });
  const occurrences = buildScheduleOccurrences({
    date: scheduleMoment.date,
    blocks: state.scheduleBlocks
  });
  return findCurrentScheduleOccurrence({
    occurrences,
    currentTime: scheduleMoment.time
  });
}

export function getNextScheduleItem(state: AppState) {
  const scheduleMoment = getCurrentScheduleMoment({
    now: new Date(),
    timeZone: getWorkspaceTimeZone()
  });
  const occurrences = buildScheduleOccurrences({
    date: scheduleMoment.date,
    blocks: state.scheduleBlocks
  });
  const current = findCurrentScheduleOccurrence({
    occurrences,
    currentTime: scheduleMoment.time
  });
  return findNextScheduleOccurrence({
    occurrences,
    currentTime: scheduleMoment.time,
    currentOccurrence: current
  });
}

export function getRecentAuditEvents(state: AppState, limit = 20): AuditEvent[] {
  return [...state.auditEvents]
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
    .slice(0, limit);
}

export function getFilteredIncidents(
  state: AppState,
  filters: {
    status?: "open" | "resolved" | "all";
    severity?: IncidentRecord["severity"] | "all";
    scope?: IncidentRecord["scope"] | "all";
    query?: string;
  } = {}
): IncidentRecord[] {
  const query = (filters.query || "").trim().toLowerCase();

  return [...state.incidents]
    .filter((incident) => (filters.status && filters.status !== "all" ? incident.status === filters.status : true))
    .filter((incident) => (filters.severity && filters.severity !== "all" ? incident.severity === filters.severity : true))
    .filter((incident) => (filters.scope && filters.scope !== "all" ? incident.scope === filters.scope : true))
    .filter((incident) => {
      if (!query) {
        return true;
      }

      return [incident.title, incident.message, incident.fingerprint, incident.scope]
        .join(" ")
        .toLowerCase()
        .includes(query);
    })
    .sort((left, right) => new Date(right.updatedAt || right.createdAt).getTime() - new Date(left.updatedAt || left.createdAt).getTime());
}

export function getSourceIncidents(state: AppState, sourceId: string): IncidentRecord[] {
  const source = state.sources.find((entry) => entry.id === sourceId);
  if (!source) {
    return [];
  }

  const fingerprints = new Set<string>();
  if (source.connectorKind === "local-library" || source.id === "source-local-library") {
    fingerprints.add("source.local-library.empty");
  } else {
    fingerprints.add(`source.${source.connectorKind}.${source.id}`);
  }

  return [...state.incidents]
    .filter((incident) => {
      if (fingerprints.has(incident.fingerprint)) {
        return true;
      }

      const haystack = [incident.title, incident.message, incident.fingerprint].join(" ").toLowerCase();
      return haystack.includes(source.id.toLowerCase()) || haystack.includes(source.name.toLowerCase());
    })
    .sort((left, right) => new Date(right.updatedAt || right.createdAt).getTime() - new Date(left.updatedAt || left.createdAt).getTime());
}

export function getSourceSyncRuns(state: AppState, sourceId: string, limit = 12): SourceSyncRunRecord[] {
  return state.sourceSyncRuns
    .filter((run) => run.sourceId === sourceId)
    .sort((left, right) => new Date(right.finishedAt || right.startedAt).getTime() - new Date(left.finishedAt || left.startedAt).getTime())
    .slice(0, limit);
}

export function getSourceHealthSnapshot(state: AppState, sourceId: string) {
  const source = state.sources.find((entry) => entry.id === sourceId) ?? null;
  const assets = state.assets.filter((asset) => asset.sourceId === sourceId);
  const readyAssets = assets.filter((asset) => asset.status === "ready");
  const openIncidents = getSourceIncidents(state, sourceId).filter((incident) => incident.status === "open");
  const latestRun = getSourceSyncRuns(state, sourceId, 1)[0] ?? null;
  const references = getSourceReferences(state, sourceId);

  return {
    source,
    assetCount: assets.length,
    readyAssetCount: readyAssets.length,
    openIncidentCount: openIncidents.length,
    latestRun,
    references
  };
}

function isLikelyDirectMediaUrl(value: string): boolean {
  return /^https?:\/\/.+\.(mp4|mov|m4v|webm|mkv|mp3|m4a|aac|flac|wav)(\?.*)?$/i.test(value.trim());
}

export function getSourceConnectorDiagnostics(state: AppState, sourceId: string) {
  const source = state.sources.find((entry) => entry.id === sourceId) ?? null;
  const latestRun = getSourceSyncRuns(state, sourceId, 1)[0] ?? null;
  const hints: string[] = [];

  if (!source) {
    return {
      isValidUrl: false,
      expectedInput: "Unknown source.",
      hints: ["The selected source could not be found in workspace state."]
    };
  }

  let isValidUrl = true;
  let expectedInput = "";
  const externalUrl = source.externalUrl?.trim() ?? "";

  switch (source.connectorKind) {
    case "youtube-playlist":
      expectedInput = "Expected a YouTube playlist URL with a list parameter.";
      isValidUrl = isLikelyYouTubePlaylistUrl(externalUrl);
      hints.push("Use a playlist URL like youtube.com/playlist?list=... or a watch URL that still contains list=...");
      hints.push("Private, removed, or region-blocked playlist items will not ingest.");
      break;
    case "youtube-channel":
      expectedInput = "Expected a YouTube channel URL using @handle, /channel/, /user/, or /c/.";
      isValidUrl = isLikelyYouTubeChannelUrl(externalUrl);
      hints.push("Supported examples: /@handle, /@handle/videos, /channel/<id>, /user/<name>, /c/<name>.");
      hints.push("If ingestion returns no items, verify the channel actually has public videos.");
      break;
    case "twitch-vod":
      expectedInput = "Expected a Twitch VOD URL like twitch.tv/videos/<id>.";
      isValidUrl = isLikelyTwitchVodUrl(externalUrl);
      hints.push("Use a direct Twitch VOD URL, not the channel homepage.");
      hints.push("Deleted or subscriber-only VODs can fail during ingestion or playback.");
      break;
    case "twitch-channel":
      expectedInput = "Expected a Twitch channel URL like twitch.tv/<channel>.";
      isValidUrl = isLikelyTwitchChannelUrl(externalUrl);
      hints.push("Channel ingestion reads archive VODs, not the current live stream.");
      hints.push("If nothing is imported, verify the channel actually has public archived VODs.");
      break;
    case "direct-media":
      expectedInput = "Expected an http(s) URL ending in a supported media file extension.";
      isValidUrl = isLikelyDirectMediaUrl(externalUrl);
      hints.push("Supported direct-media inputs should point at a real media file such as .mp4, .mkv, or .mp3.");
      hints.push("Generic web pages or expiring signed URLs often fail validation or playback.");
      break;
    case "local-library":
      expectedInput = "Expected local media files to exist under the mounted media library root.";
      isValidUrl = true;
      hints.push("Place files under data/media on the host so the worker can scan and register them.");
      hints.push("Empty local-library scans are valid, but they leave the pool with no playable assets.");
      break;
    default:
      expectedInput = "Expected a valid source URL or mounted local media path.";
  }

  if (!(source.enabled ?? true)) {
    hints.unshift("This source is disabled. Enable it before expecting new sync runs or playable assets.");
  }

  if (!externalUrl && source.connectorKind !== "local-library") {
    hints.unshift("This source has no external URL configured yet.");
  }

  if (latestRun?.status === "error" && latestRun.errorMessage) {
    hints.unshift(`Last sync failed with: ${latestRun.errorMessage}`);
  }

  return {
    isValidUrl,
    expectedInput,
    hints
  };
}

export function getAssetPlaybackDiagnostics(state: AppState, assetId: string) {
  const asset = state.assets.find((entry) => entry.id === assetId) ?? null;
  if (!asset) {
    return {
      status: "missing" as const,
      summary: "Asset could not be found in the catalog.",
      details: ["The selected asset id no longer exists in workspace state."]
    };
  }

  const source = state.sources.find((entry) => entry.id === asset.sourceId) ?? null;
  const sourceSnapshot = getSourceHealthSnapshot(state, asset.sourceId);
  const details = [
    asset.status === "ready" ? "Asset is marked ready in the catalog." : `Asset catalog status is ${asset.status}.`,
    asset.includeInProgramming ? "Asset is currently eligible for automated programming." : "Asset is currently excluded from automated programming.",
    asset.path ? `Playable input: ${asset.path}` : "No playable input path is recorded.",
    source ? `Source connector: ${source.connectorKind}` : "Source record is missing."
  ];

  if (!asset.durationSeconds) {
    details.push("Natural duration is missing, so schedule fill and operator expectations may be less accurate.");
  }

  if (sourceSnapshot.latestRun?.status === "error") {
    details.push(`The latest source sync run failed: ${sourceSnapshot.latestRun.errorMessage || sourceSnapshot.latestRun.summary}`);
  }

  if (sourceSnapshot.openIncidentCount > 0) {
    details.push(`${sourceSnapshot.openIncidentCount} open source incident(s) may still affect playback quality.`);
  }

  return {
    status: asset.status === "ready" ? ("playable" as const) : ("warning" as const),
    summary:
      asset.status === "ready" && asset.includeInProgramming
        ? "Asset should be usable for pool rotation or override if the upstream URL is still reachable."
        : asset.status === "ready"
          ? "Asset is playable, but it is intentionally excluded from automated programming."
        : "Asset is not currently in a ready state and should be treated as suspect for playback.",
    details
  };
}

export function getSourceRecoveryActions(state: AppState, sourceId: string): string[] {
  const source = state.sources.find((entry) => entry.id === sourceId) ?? null;
  const latestRun = getSourceSyncRuns(state, sourceId, 1)[0] ?? null;
  const actions: string[] = [];

  if (!source) {
    return ["Re-open the source library and confirm the source still exists."];
  }

  if (!(source.enabled ?? true)) {
    actions.push("Enable the source before expecting sync or playback updates.");
  }

  if (!source.externalUrl && source.connectorKind !== "local-library") {
    actions.push("Enter a valid external URL for the source and save it before retrying sync.");
  }

  const errorText = `${latestRun?.errorMessage || ""} ${source.status} ${source.notes || ""}`.toLowerCase();
  if (errorText.includes("private") || errorText.includes("subscriber")) {
    actions.push("Check whether the upstream content is private, subscriber-only, or otherwise restricted.");
  }
  if (errorText.includes("not currently live")) {
    actions.push("Use the Twitch channel archive connector for VODs; the live channel page itself is not a playable archive source.");
  }
  if (errorText.includes("no playable") || errorText.includes("returned no playable items")) {
    actions.push("Verify that the upstream playlist or channel actually contains public videos/VODs.");
  }
  if (errorText.includes("invalid") || errorText.includes("require")) {
    actions.push("Double-check that the connector type matches the URL shape shown in the diagnostics panel.");
  }
  if (errorText.includes("geo") || errorText.includes("region")) {
    actions.push("Some upstream items may be geo-blocked; test the source from the host with yt-dlp if failures persist.");
  }

  if (source.connectorKind === "local-library") {
    actions.push("Place media files under data/media and wait for the next worker cycle or request a manual sync.");
  }

  if (actions.length === 0) {
    actions.push("Request a manual sync and review the newest source sync run for a more specific upstream error.");
  }

  return [...new Set(actions)];
}

export function getPlayoutQueueAssets(state: AppState) {
  const queueItemAssetIds = state.playout.queueItems
    .map((item) => item.assetId)
    .filter(Boolean);
  const ids = [
    ...queueItemAssetIds,
    state.playout.currentAssetId,
    state.playout.nextAssetId,
    ...state.playout.queuedAssetIds
  ].filter(Boolean);
  const seen = new Set<string>();
  return ids
    .filter((id) => {
      if (seen.has(id)) {
        return false;
      }
      seen.add(id);
      return true;
    })
    .map((id) => state.assets.find((asset) => asset.id === id))
    .filter((asset): asset is AssetRecord => Boolean(asset));
}

function summarizeAsset(state: AppState, assetId: string): LiveAssetSummary | null {
  const asset = state.assets.find((entry) => entry.id === assetId) ?? null;
  if (!asset) {
    return null;
  }

  const source = state.sources.find((entry) => entry.id === asset.sourceId) ?? null;
  return {
    id: asset.id,
    title: asset.title,
    status: asset.status,
    sourceId: asset.sourceId,
    sourceName: source?.name || asset.sourceId,
    categoryName: asset.categoryName || "",
    durationSeconds: asset.durationSeconds || 0,
    publishedAt: asset.publishedAt || "",
    externalId: asset.externalId || "",
    isGlobalFallback: asset.isGlobalFallback
  };
}

function buildAssetDisplayTitle(asset: Pick<AssetRecord, "title" | "titlePrefix"> | null | undefined): string {
  return [asset?.titlePrefix?.trim() || "", asset?.title?.trim() || ""].filter(Boolean).join(" ").trim();
}

function getScheduleOccurrenceLookaheadTitle(
  state: AppState,
  item: ReturnType<typeof getNextScheduleItem> | null
): string {
  if (!item?.poolId) {
    return "";
  }

  const pool = state.pools.find((entry) => entry.id === item.poolId) ?? null;
  const [slot] = buildSchedulePreviewVideoSlots({
    block: item,
    pool,
    assets: state.assets,
    maxSlots: 1
  });

  return slot?.title || "";
}

function getConfiguredDestinationFailureCooldownSeconds(): number {
  const parsed = Number(process.env.DESTINATION_FAILURE_COOLDOWN_SECONDS || String(DEFAULT_DESTINATION_FAILURE_COOLDOWN_SECONDS));
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : DEFAULT_DESTINATION_FAILURE_COOLDOWN_SECONDS;
}

function summarizeDestinationRecovery(
  destination: StreamDestinationRecord,
  active: boolean
): Pick<LiveDestinationSummary, "recoveryState" | "recoverySummary" | "failureHoldSecondsRemaining"> {
  const failureHoldSecondsRemaining = getDestinationFailureHoldSecondsRemaining(
    destination.lastFailureAt,
    getConfiguredDestinationFailureCooldownSeconds()
  );

  if (destination.status === "error" && failureHoldSecondsRemaining > 0) {
    return {
      recoveryState: "cooldown",
      recoverySummary: `Cooling down after the latest output failure. Retry in ${failureHoldSecondsRemaining}s unless an operator clears the hold.`,
      failureHoldSecondsRemaining
    };
  }

  if (destination.status === "recovering") {
    return {
      recoveryState: "staged",
      recoverySummary: active
        ? "Recovered output is already back in the live destination group."
        : "Recovered output is staged and will rejoin on the next natural transition or when an operator chooses Recover outputs now.",
      failureHoldSecondsRemaining: 0
    };
  }

  if (destination.status === "ready") {
    return {
      recoveryState: active ? "active" : "ready",
      recoverySummary: active
        ? "Output is currently carrying the live broadcast."
        : "Output is healthy and available for the next active destination group.",
      failureHoldSecondsRemaining: 0
    };
  }

  return {
    recoveryState: "missing-config",
    recoverySummary: "Configure a valid RTMP URL and stream key before this output can join the live destination group.",
    failureHoldSecondsRemaining: 0
  };
}

function summarizeDestination(state: AppState): LiveDestinationSummary | null {
  const routing = selectActiveDestinationGroup(
    state.destinations.map((destination) => ({
      id: destination.id,
      name: destination.name,
      role: destination.role,
      priority: destination.priority,
      enabled: destination.enabled,
      streamKeyPresent: destination.streamKeyPresent,
      status: destination.status
    }))
  );
  const destination =
    state.destinations.find((entry) => entry.id === routing.leadDestinationId) ??
    state.destinations.find((entry) => entry.id === state.playout.currentDestinationId) ??
    state.destinations[0] ??
    null;
  if (!destination) {
    return null;
  }

  const active = routing.activeDestinationIds.includes(destination.id);

  return {
    id: destination.id,
    role: destination.role,
    priority: destination.priority,
    name: destination.name,
    status: destination.status,
    notes: destination.notes,
    rtmpUrl: destination.rtmpUrl,
    streamKeyPresent: destination.streamKeyPresent,
    streamKeySource: destination.streamKeySource || "missing",
    lastFailureAt: destination.lastFailureAt,
    failureCount: destination.failureCount,
    lastError: destination.lastError,
    active,
    ...summarizeDestinationRecovery(destination, active)
  };
}

function summarizeDestinations(state: AppState): LiveDestinationSummary[] {
  const routing = selectActiveDestinationGroup(
    state.destinations.map((destination) => ({
      id: destination.id,
      name: destination.name,
      role: destination.role,
      priority: destination.priority,
      enabled: destination.enabled,
      streamKeyPresent: destination.streamKeyPresent,
      status: destination.status
    }))
  );
  return [...state.destinations]
    .sort((left, right) => left.priority - right.priority || left.name.localeCompare(right.name))
    .map((destination) => {
      const active = routing.activeDestinationIds.includes(destination.id);
      return {
        id: destination.id,
        role: destination.role,
        priority: destination.priority,
        name: destination.name,
        status: destination.status,
        notes: destination.notes,
        rtmpUrl: destination.rtmpUrl,
        streamKeyPresent: destination.streamKeyPresent,
        streamKeySource: destination.streamKeySource || "missing",
        lastFailureAt: destination.lastFailureAt,
        failureCount: destination.failureCount,
        lastError: destination.lastError,
        active,
        ...summarizeDestinationRecovery(destination, active)
      };
    });
}

function summarizeScheduleItem(
  item: ReturnType<typeof getCurrentScheduleItem> | ReturnType<typeof getNextScheduleItem>
): LiveScheduleSummary | null {
  if (!item) {
    return null;
  }

  return {
    id: item.blockId,
    key: item.key,
    title: item.title,
    startTime: item.startTime,
    endTime: item.endTime,
    categoryName: item.categoryName,
    sourceName: item.sourceName,
    reason: "Scheduled occurrence",
    dayOfWeek: item.dayOfWeek
  };
}

function summarizeOpenIncidents(state: AppState, limit = 5): LiveIncidentSummary[] {
  return [...state.incidents]
    .filter((incident) => incident.status === "open")
    .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime())
    .slice(0, limit)
    .map((incident) => ({
      id: incident.id,
      title: incident.title,
      message: incident.message,
      severity: incident.severity,
      status: incident.status,
      scope: incident.scope,
      fingerprint: incident.fingerprint,
      createdAt: incident.createdAt,
      acknowledgedAt: incident.acknowledgedAt,
      resolvedAt: incident.resolvedAt
    }));
}

function summarizeOverlay(overlay: OverlaySettingsRecord): LiveOverlaySummary {
  return {
    enabled: overlay.enabled,
    channelName: overlay.channelName,
    headline: overlay.headline,
    insertHeadline: overlay.insertHeadline,
    standbyHeadline: overlay.standbyHeadline,
    reconnectHeadline: overlay.reconnectHeadline,
    brandBadge: overlay.brandBadge,
    scenePreset: normalizeOverlayScenePreset(overlay.scenePreset),
    insertScenePreset: normalizeOverlayScenePreset(overlay.insertScenePreset),
    standbyScenePreset: normalizeOverlayScenePreset(overlay.standbyScenePreset),
    reconnectScenePreset: normalizeOverlayScenePreset(overlay.reconnectScenePreset),
    accentColor: overlay.accentColor,
    surfaceStyle: normalizeOverlaySurfaceStyle(overlay.surfaceStyle),
    panelAnchor: normalizeOverlayPanelAnchor(overlay.panelAnchor),
    titleScale: normalizeOverlayTitleScale(overlay.titleScale),
    typographyPreset: normalizeOverlayTypographyPreset(overlay.typographyPreset),
    showClock: overlay.showClock,
    showNextItem: overlay.showNextItem,
    showScheduleTeaser: overlay.showScheduleTeaser,
    showCurrentCategory: overlay.showCurrentCategory,
    showSourceLabel: overlay.showSourceLabel,
    showQueuePreview: overlay.showQueuePreview,
    queuePreviewCount: overlay.queuePreviewCount,
    layerOrder: overlay.layerOrder,
    disabledLayers: overlay.disabledLayers,
    customLayers: overlay.customLayers,
    emergencyBanner: overlay.emergencyBanner,
    tickerText: overlay.tickerText,
    replayLabel: overlay.replayLabel,
    updatedAt: overlay.updatedAt
  };
}

function summarizeEngagement(state: AppState): LiveEngagementSummary {
  const rawEngagement = (state as Partial<AppState>).engagement;
  const engagement = normalizeEngagementSettings(rawEngagement ?? DEFAULT_ENGAGEMENT_SETTINGS);
  const engagementEvents = Array.isArray((state as Partial<AppState>).engagementEvents)
    ? ((state as Partial<AppState>).engagementEvents as EngagementEventRecord[])
    : [];
  const chatRuntimeEnabled = isEngagementChatRuntimeEnabled(engagement, process.env);
  const alertsRuntimeEnabled = isEngagementAlertsRuntimeEnabled(engagement, process.env);
  const latestStatus = engagementEvents.find((event) => event.kind === "status" && event.actor === "chat") ?? null;
  const chatStatus = !chatRuntimeEnabled
    ? "disabled"
    : latestStatus?.message === "connected"
      ? "connected"
      : "disconnected";

  return {
    settings: {
      chatEnabled: engagement.chatEnabled,
      alertsEnabled: engagement.alertsEnabled,
      chatRuntimeEnabled,
      alertsRuntimeEnabled,
      chatMode: engagement.chatMode,
      chatPosition: engagement.chatPosition,
      alertPosition: engagement.alertPosition,
      style: engagement.style,
      maxMessages: engagement.maxMessages,
      rateLimitPerMinute: engagement.rateLimitPerMinute,
      updatedAt: rawEngagement?.updatedAt ?? ""
    },
    chatStatus,
    recentEvents: engagementEvents
      .filter((event) => event.kind !== "status")
      .slice(0, 25)
      .map((event) => ({
        id: event.id,
        kind: event.kind,
        actor: event.actor,
        message: event.message,
        createdAt: event.createdAt
      }))
  };
}

function buildOverlaySceneSource(overlay: OverlaySettingsRecord) {
  return {
    channelName: overlay.channelName,
    replayLabel: overlay.replayLabel,
    brandBadge: overlay.brandBadge,
    accentColor: overlay.accentColor,
    scenePreset: normalizeOverlayScenePreset(overlay.scenePreset),
    insertScenePreset: normalizeOverlayScenePreset(overlay.insertScenePreset),
    standbyScenePreset: normalizeOverlayScenePreset(overlay.standbyScenePreset),
    reconnectScenePreset: normalizeOverlayScenePreset(overlay.reconnectScenePreset),
    headline: overlay.headline,
    insertHeadline: overlay.insertHeadline,
    standbyHeadline: overlay.standbyHeadline,
    reconnectHeadline: overlay.reconnectHeadline,
    surfaceStyle: normalizeOverlaySurfaceStyle(overlay.surfaceStyle),
    panelAnchor: normalizeOverlayPanelAnchor(overlay.panelAnchor),
    titleScale: normalizeOverlayTitleScale(overlay.titleScale),
    typographyPreset: normalizeOverlayTypographyPreset(overlay.typographyPreset),
    showClock: overlay.showClock,
    showNextItem: overlay.showNextItem,
    showScheduleTeaser: overlay.showScheduleTeaser,
    showCurrentCategory: overlay.showCurrentCategory,
    showSourceLabel: overlay.showSourceLabel,
    showQueuePreview: overlay.showQueuePreview,
    queuePreviewCount: overlay.queuePreviewCount,
    emergencyBanner: overlay.emergencyBanner,
    tickerText: overlay.tickerText,
    layerOrder: overlay.layerOrder,
    disabledLayers: overlay.disabledLayers,
    customLayers: overlay.customLayers
  };
}

export function buildActiveScenePayload(
  state: AppState,
  options: {
    overlay?: OverlaySettingsRecord;
    target?: OverlaySceneRenderTarget;
    queueKind?: "asset" | "insert" | "standby" | "reconnect" | "live";
  } = {}
) {
  const overlay = options.overlay ?? state.overlay;
  const currentScheduleItem = getCurrentScheduleItem(state);
  const nextScheduleItem = getNextScheduleItem(state);
  const currentAsset = state.assets.find((asset) => asset.id === state.playout.currentAssetId) ?? null;
  const nextAsset = state.assets.find((asset) => asset.id === state.playout.nextAssetId) ?? null;
  const currentAssetTitle = buildAssetDisplayTitle(currentAsset);
  const nextAssetTitle = buildAssetDisplayTitle(nextAsset);
  const nextScheduleLookaheadTitle = getScheduleOccurrenceLookaheadTitle(state, nextScheduleItem);
  const queueKind = options.queueKind ?? state.playout.queueItems[0]?.kind ?? "asset";
  const queuePreviewStart = state.playout.queueItems[0] ? 1 : 0;
  const queueTitles = state.playout.queueItems
    .slice(queuePreviewStart, queuePreviewStart + overlay.queuePreviewCount)
    .map((item) => item.title)
    .filter(Boolean);
  const queueHead = state.playout.queueItems[0] ?? null;
  const currentSourceName =
    currentScheduleItem?.sourceName ||
    (currentAsset ? state.sources.find((source) => source.id === currentAsset.sourceId)?.name : "") ||
    "Source to be announced";

  return buildOverlayScenePayload({
    overlay: buildOverlaySceneSource(overlay),
    queueKind,
    target: options.target ?? "browser",
    currentTitle:
      queueKind === "asset"
        ? currentAssetTitle || state.playout.currentTitle || currentScheduleItem?.title || overlay.channelName || "Stream247"
        : queueKind === "live"
          ? queueHead?.title || state.playout.liveBridgeLabel || state.playout.currentTitle || "Live Bridge"
        : queueHead?.title || state.playout.currentTitle || overlay.headline || "Replay stream",
    currentCategory: queueKind === "live" ? "Live input" : currentScheduleItem?.categoryName || currentAsset?.categoryName || "Always on air",
    currentSourceName:
      queueKind === "live"
        ? `Live Bridge · ${(state.playout.liveBridgeInputType || "rtmp").toUpperCase()}`
        : currentSourceName,
    nextTitle: nextAssetTitle || nextScheduleLookaheadTitle || state.playout.nextTitle || nextScheduleItem?.title || "Schedule not available",
    nextTimeLabel: nextScheduleItem ? `${nextScheduleItem.startTime} to ${nextScheduleItem.endTime}` : "No next block configured",
    queueTitles,
    timeZone: getWorkspaceTimeZone()
  });
}

function summarizeQueueItems(state: AppState): LiveQueueItemSummary[] {
  return state.playout.queueItems.map((item) => ({
    id: item.id,
    kind: item.kind,
    title: item.title,
    subtitle: item.subtitle,
    position: item.position,
    scenePreset: item.scenePreset,
    asset: item.assetId ? summarizeAsset(state, item.assetId) : null
  }));
}

function summarizePlayout(playout: PlayoutRuntimeRecord): LivePlayoutSummary {
  return {
    status: playout.status,
    message: playout.message,
    transitionState: playout.transitionState,
    queueVersion: playout.queueVersion,
    transitionTargetKind: playout.transitionTargetKind,
    transitionTargetAssetId: playout.transitionTargetAssetId,
    transitionTargetTitle: playout.transitionTargetTitle,
    transitionReadyAt: playout.transitionReadyAt,
    heartbeatAt: playout.heartbeatAt,
    processPid: playout.processPid,
    restartCount: playout.restartCount,
    crashLoopDetected: playout.crashLoopDetected,
    crashCountWindow: playout.crashCountWindow,
    selectionReasonCode: playout.selectionReasonCode,
    fallbackTier: playout.fallbackTier,
    overrideMode: playout.overrideMode,
    overrideAssetId: playout.overrideAssetId,
    overrideUntil: playout.overrideUntil,
    manualNextAssetId: playout.manualNextAssetId,
    manualNextRequestedAt: playout.manualNextRequestedAt,
    insertAssetId: playout.insertAssetId,
    insertRequestedAt: playout.insertRequestedAt,
    insertStatus: playout.insertStatus,
    skipAssetId: playout.skipAssetId,
    skipUntil: playout.skipUntil,
    currentAssetId: playout.currentAssetId,
    currentTitle: playout.currentTitle,
    previousAssetId: playout.previousAssetId,
    previousTitle: playout.previousTitle,
    desiredAssetId: playout.desiredAssetId,
    nextAssetId: playout.nextAssetId,
    nextTitle: playout.nextTitle,
    queuedAssetIds: playout.queuedAssetIds,
    prefetchedAssetId: playout.prefetchedAssetId,
    prefetchedTitle: playout.prefetchedTitle,
    prefetchedAt: playout.prefetchedAt,
    prefetchStatus: playout.prefetchStatus,
    prefetchError: playout.prefetchError,
    pendingAction: playout.pendingAction,
    pendingActionRequestedAt: playout.pendingActionRequestedAt,
    restartRequestedAt: playout.restartRequestedAt,
    lastTransitionAt: playout.lastTransitionAt,
    lastStderrSample: playout.lastStderrSample,
    currentDestinationId: playout.currentDestinationId
  };
}

function summarizeLiveBridge(playout: PlayoutRuntimeRecord): LiveBridgeSummary {
  return {
    configured: Boolean(playout.liveBridgeInputUrl),
    status: playout.liveBridgeStatus || "idle",
    inputType: playout.liveBridgeInputType,
    label: playout.liveBridgeLabel,
    inputSummary: summarizeLiveBridgeInput(playout.liveBridgeInputUrl),
    requestedAt: playout.liveBridgeRequestedAt,
    startedAt: playout.liveBridgeStartedAt,
    releasedAt: playout.liveBridgeReleasedAt,
    lastError: playout.liveBridgeLastError
  };
}

function summarizeAudioLane(
  state: AppState,
  currentScheduleItem: ReturnType<typeof getCurrentScheduleItem> | null
): LiveAudioLaneSummary {
  const pool = currentScheduleItem?.poolId ? state.pools.find((entry) => entry.id === currentScheduleItem.poolId) ?? null : null;
  const asset = pool?.audioLaneAssetId ? state.assets.find((entry) => entry.id === pool.audioLaneAssetId) ?? null : null;
  const source = asset ? state.sources.find((entry) => entry.id === asset.sourceId) ?? null : null;
  const active =
    Boolean(asset && pool) &&
    state.playout.selectionReasonCode !== "live_bridge" &&
    state.playout.selectionReasonCode !== "operator_insert" &&
    state.playout.selectionReasonCode !== "scheduled_insert" &&
    state.playout.status !== "standby" &&
    state.playout.status !== "reconnecting";

  return {
    configured: Boolean(pool?.audioLaneAssetId),
    active,
    assetId: asset?.id || "",
    title: asset?.title || "",
    sourceName: source?.name || "",
    volumePercent: pool?.audioLaneVolumePercent ?? 100,
    poolId: pool?.id || "",
    poolName: pool?.name || "",
    mode: "replace"
  };
}

function summarizeCuepoints(
  state: AppState,
  currentScheduleItem: ReturnType<typeof getCurrentScheduleItem> | null
): LiveCuepointSummary {
  const block = currentScheduleItem ? state.scheduleBlocks.find((entry) => entry.id === currentScheduleItem.blockId) ?? null : null;
  const pool = currentScheduleItem?.poolId ? state.pools.find((entry) => entry.id === currentScheduleItem.poolId) ?? null : null;
  const offsetsSeconds = normalizeCuepointOffsetsSeconds(block?.cuepointOffsetsSeconds ?? [], block?.durationMinutes ?? 0);
  const cuepointAssetId = block?.cuepointAssetId || pool?.insertAssetId || "";
  const cuepointAsset = cuepointAssetId ? state.assets.find((entry) => entry.id === cuepointAssetId) ?? null : null;
  const scheduleMoment = getCurrentScheduleMoment({
    now: new Date(),
    timeZone: getWorkspaceTimeZone()
  });
  const active =
    Boolean(currentScheduleItem) &&
    isCurrentScheduleTime({
      startTime: currentScheduleItem?.startTime || "00:00",
      endTime: currentScheduleItem?.endTime || "00:00",
      currentTime: scheduleMoment.time
    });
  const progress =
    currentScheduleItem && offsetsSeconds.length > 0 && active
      ? getCuepointProgress({
          occurrenceKey: currentScheduleItem.key,
          cuepointOffsetsSeconds: offsetsSeconds,
          firedCuepointKeys:
            state.playout.cuepointWindowKey === currentScheduleItem.key ? state.playout.cuepointFiredKeys : [],
          elapsedSeconds: getScheduleElapsedSeconds({
            startMinuteOfDay: currentScheduleItem.startMinuteOfDay,
            currentTime: scheduleMoment.time
          })
        })
      : {
          dueOffsetSeconds: null,
          dueCuepointKey: "",
          nextOffsetSeconds: null,
          firedCount: 0,
          totalCount: offsetsSeconds.length
        };

  return {
    configured: offsetsSeconds.length > 0,
    safeBoundaryOnly: true,
    assetId: cuepointAsset?.id || "",
    assetTitle: cuepointAsset?.title || "",
    offsetsSeconds,
    nextOffsetSeconds: progress.nextOffsetSeconds,
    dueOffsetSeconds: progress.dueOffsetSeconds,
    firedCount: progress.firedCount,
    totalCount: progress.totalCount,
    windowKey: currentScheduleItem?.key || "",
    lastTriggeredAt: state.playout.cuepointLastTriggeredAt,
    lastAssetId: state.playout.cuepointLastAssetId
  };
}

export function getBroadcastSnapshot(state: AppState): BroadcastSnapshot {
  const currentScheduleItem = getCurrentScheduleItem(state);
  const nextScheduleItem = getNextScheduleItem(state);
  const queuedAssets = getPlayoutQueueAssets(state);
  const activeScenePayload = buildActiveScenePayload(state);

  return {
    generatedAt: new Date().toISOString(),
    timeZone: getWorkspaceTimeZone(),
    workerHealth: getWorkerHealth(state),
    playout: summarizePlayout(state.playout),
    liveBridge: summarizeLiveBridge(state.playout),
    audioLane: summarizeAudioLane(state, currentScheduleItem),
    cuepoints: summarizeCuepoints(state, currentScheduleItem),
    overlay: summarizeOverlay(state.overlay),
    engagement: summarizeEngagement(state),
    activeScene: activeScenePayload.scene,
    activeScenePayload,
    destination: summarizeDestination(state),
    destinations: summarizeDestinations(state),
    currentAsset: summarizeAsset(state, state.playout.currentAssetId),
    desiredAsset: summarizeAsset(state, state.playout.desiredAssetId),
    nextAsset: summarizeAsset(state, state.playout.nextAssetId),
    prefetchedAsset: summarizeAsset(state, state.playout.prefetchedAssetId),
    overrideAsset: summarizeAsset(state, state.playout.overrideAssetId),
    queuedAssets: queuedAssets.map((asset) => summarizeAsset(state, asset.id)).filter((asset): asset is LiveAssetSummary => Boolean(asset)),
    queueItems: summarizeQueueItems(state),
    currentScheduleItem: summarizeScheduleItem(currentScheduleItem),
    nextScheduleItem: summarizeScheduleItem(nextScheduleItem),
    openIncidents: summarizeOpenIncidents(state)
  };
}

export function getPublicChannelSnapshot(state: AppState): PublicChannelSnapshot {
  const snapshot = getBroadcastSnapshot(state);

  return {
    generatedAt: snapshot.generatedAt,
    timeZone: snapshot.timeZone,
    overlay: snapshot.overlay,
    engagement: snapshot.engagement,
    activeScene: snapshot.activeScene,
    activeScenePayload: snapshot.activeScenePayload,
    playout: {
      status: snapshot.playout.status,
      message: snapshot.playout.message,
      currentTitle: snapshot.playout.currentTitle,
      transitionState: snapshot.playout.transitionState,
      overrideMode: snapshot.playout.overrideMode
    },
    currentAsset: snapshot.currentAsset,
    nextAsset: snapshot.nextAsset,
    queuedAssets: snapshot.queuedAssets,
    queueItems: snapshot.queueItems,
    currentScheduleItem: snapshot.currentScheduleItem,
    nextScheduleItem: snapshot.nextScheduleItem
  };
}

export function getSourceAuditEvents(state: AppState, sourceId: string, limit = 12): AuditEvent[] {
  const source = state.sources.find((entry) => entry.id === sourceId);
  if (!source) {
    return [];
  }

  return [...state.auditEvents]
    .filter((event) => {
      const haystack = [event.type, event.message].join(" ").toLowerCase();
      return (
        haystack.includes(source.id.toLowerCase()) ||
        haystack.includes(source.name.toLowerCase()) ||
        (source.connectorKind === "local-library" && haystack.includes("local media library"))
      );
    })
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
    .slice(0, limit);
}

export function getSourceReferences(state: AppState, sourceId: string) {
  const pools = state.pools.filter((pool) => pool.sourceIds.includes(sourceId));
  const poolIds = new Set(pools.map((pool) => pool.id));
  const scheduleBlocks = state.scheduleBlocks.filter((block) => block.poolId && poolIds.has(block.poolId));

  return {
    pools,
    scheduleBlocks
  };
}

export function getWorkerHealth(state: AppState) {
  const WORKER_HEARTBEAT_STALE_MS = 180_000;
  const lastWorkerCycle = state.auditEvents.find((event) => event.type === "worker.cycle") ?? null;
  const lastRunAt = lastWorkerCycle?.createdAt || "";
  const ageMs = lastRunAt ? Date.now() - new Date(lastRunAt).getTime() : Number.POSITIVE_INFINITY;

  if (!lastRunAt) {
    return {
      status: "missing" as const,
      summary: "No worker heartbeat has been recorded yet.",
      lastRunAt
    };
  }

  if (ageMs > WORKER_HEARTBEAT_STALE_MS) {
    return {
      status: "stale" as const,
      summary: "Worker heartbeat is stale. Reconciliation may be stuck.",
      lastRunAt
    };
  }

  return {
    status: "healthy" as const,
    summary: "Worker heartbeat is current.",
    lastRunAt
  };
}

export function getRuntimeDriftReport(state: AppState) {
  const currentScheduleItem = getCurrentScheduleItem(state);
  const currentAsset = state.assets.find((asset) => asset.id === state.playout.currentAssetId) ?? null;
  const currentSource = currentAsset ? state.sources.find((source) => source.id === currentAsset.sourceId) ?? null : null;
  const activeDestination = summarizeDestination(state);
  const workerHealth = getWorkerHealth(state);
  const playoutHeartbeatAgeMs = state.playout.heartbeatAt ? Date.now() - new Date(state.playout.heartbeatAt).getTime() : Number.POSITIVE_INFINITY;

  const items = [
    {
      id: "worker-heartbeat",
      label: "Worker heartbeat",
      severity: workerHealth.status === "healthy" ? ("ok" as const) : ("warning" as const),
      summary: workerHealth.summary,
      detail: workerHealth.lastRunAt ? `Last cycle: ${workerHealth.lastRunAt}` : "No cycle timestamp recorded."
    },
    {
      id: "playout-heartbeat",
      label: "Playout heartbeat",
      severity:
        state.playout.status === "running" || state.playout.status === "recovering" || state.playout.status === "switching"
          ? playoutHeartbeatAgeMs > 45_000
            ? ("warning" as const)
            : ("ok" as const)
          : state.playout.status === "failed" || state.playout.status === "degraded"
            ? ("warning" as const)
            : ("info" as const),
      summary:
        state.playout.status === "failed" || state.playout.status === "degraded"
          ? `Playout is ${state.playout.status}.`
          : playoutHeartbeatAgeMs > 45_000 &&
              (state.playout.status === "running" || state.playout.status === "recovering" || state.playout.status === "switching")
            ? "Playout heartbeat is stale."
            : "Playout heartbeat is in sync.",
      detail: state.playout.heartbeatAt ? `Last heartbeat: ${state.playout.heartbeatAt}` : "No playout heartbeat recorded."
    },
    {
      id: "schedule-alignment",
      label: "Schedule alignment",
      severity:
        state.playout.overrideMode !== "schedule"
          ? ("info" as const)
          : currentScheduleItem && currentSource && currentSource.name !== currentScheduleItem.sourceName
            ? ("warning" as const)
            : currentScheduleItem && currentAsset
              ? ("ok" as const)
              : ("info" as const),
      summary:
        state.playout.overrideMode !== "schedule"
          ? `Operator override is active (${state.playout.overrideMode}).`
          : currentScheduleItem && currentSource && currentSource.name !== currentScheduleItem.sourceName
            ? "Current asset source does not match the active schedule block."
            : currentScheduleItem && currentAsset
              ? "Current asset follows the active schedule block."
              : "No current schedule block or asset to compare.",
      detail:
        currentScheduleItem && currentAsset
          ? `Schedule source: ${currentScheduleItem.sourceName} · Asset source: ${currentSource?.name || "unknown"}`
          : "Alignment check is waiting for both a schedule block and a current asset."
    },
    {
      id: "destination-readiness",
      label: "Destination readiness",
      severity: activeDestination && activeDestination.status === "ready" ? ("ok" as const) : ("warning" as const),
      summary: activeDestination ? `Destination is ${activeDestination.status}.` : "No active destination is configured.",
      detail: activeDestination
        ? `${activeDestination.name} · ${activeDestination.notes}`
        : "Configure a playout destination before expecting a stable broadcast."
    },
    {
      id: "twitch-metadata",
      label: "Twitch metadata sync",
      severity:
        state.twitch.status !== "connected"
          ? ("info" as const)
          : currentScheduleItem &&
              (state.twitch.lastSyncedTitle !== currentScheduleItem.title ||
                (currentScheduleItem.categoryName !== "" && state.twitch.lastSyncedCategoryName !== currentScheduleItem.categoryName))
            ? ("warning" as const)
            : ("ok" as const),
      summary:
        state.twitch.status !== "connected"
          ? "Twitch is not connected."
          : currentScheduleItem &&
              (state.twitch.lastSyncedTitle !== currentScheduleItem.title ||
                (currentScheduleItem.categoryName !== "" && state.twitch.lastSyncedCategoryName !== currentScheduleItem.categoryName))
            ? "Twitch metadata does not match the active schedule block yet."
            : "Twitch metadata matches the active schedule block.",
      detail:
        state.twitch.status !== "connected"
          ? "Connect the broadcaster account to enable metadata drift checks."
          : `Last synced title/category: ${state.twitch.lastSyncedTitle || "none"} · ${state.twitch.lastSyncedCategoryName || "none"}`
    }
  ];

  return {
    items,
    attentionCount: items.filter((item) => item.severity === "warning").length
  };
}
