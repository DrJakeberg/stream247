import {
  buildScheduleOccurrences,
  buildSchedulePreview,
  describePresenceStatus,
  getCurrentScheduleMoment,
  isCurrentScheduleTime,
  normalizeOverlayPanelAnchor,
  normalizeOverlayScenePreset,
  normalizeOverlaySurfaceStyle,
  normalizeOverlayTitleScale,
  isLikelyTwitchChannelUrl,
  isLikelyTwitchVodUrl,
  isLikelyYouTubeChannelUrl,
  isLikelyYouTubePlaylistUrl
} from "@stream247/core";
import {
  appendAuditEvent,
  appendPresenceWindowRecord,
  createPoolRecord,
  createScheduleBlocks,
  createShowProfileRecord,
  deletePoolRecord,
  deleteScheduleBlockRecord,
  deleteSourceRecordAndAssets,
  deleteShowProfileRecord,
  acknowledgeIncident,
  findTeamGrantByLogin,
  findUserByEmail,
  findUserById,
  updateDestinationRecord,
  updateManagedConfigRecord,
  updateModerationConfigRecord,
  updateOverlaySettingsRecord,
  readAppState,
  replaceAllScheduleBlocks,
  replaceTwitchScheduleSegments,
  resolveIncident,
  replaceAssetsForSourceIds,
  updatePlayoutRuntime,
  updatePoolCursor,
  updateAppState,
  updatePoolRecord,
  updateScheduleBlockRecord,
  updateShowProfileRecord,
  updateTwitchConnectionRecord,
  updateOwnerAndInitialized,
  upsertSourceRecord,
  upsertSources,
  upsertTeamAccessGrantRecord,
  upsertUserRecord,
  writeAppState,
  type AppState,
  type AssetRecord,
  type AuditEvent,
  type IncidentRecord,
  type ModeratorPresenceWindowRecord,
  type OwnerAccount,
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
  type OverlaySettingsRecord,
  type ManagedConfigRecord
} from "@stream247/db";
import type {
  BroadcastSnapshot,
  LiveAssetSummary,
  LiveDestinationSummary,
  LiveIncidentSummary,
  LiveOverlaySummary,
  LivePlayoutSummary,
  LiveQueueItemSummary,
  LiveScheduleSummary,
  PublicChannelSnapshot
} from "@/lib/live-broadcast";

export type {
  AppState,
  AssetRecord,
  AuditEvent,
  IncidentRecord,
  ModeratorPresenceWindowRecord,
  OwnerAccount,
  PlayoutRuntimeRecord,
  PoolRecord,
  ShowProfileRecord,
  OverlaySettingsRecord,
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
  appendPresenceWindowRecord,
  createPoolRecord,
  createScheduleBlocks,
  createShowProfileRecord,
  deletePoolRecord,
  deleteScheduleBlockRecord,
  deleteSourceRecordAndAssets,
  deleteShowProfileRecord,
  findTeamGrantByLogin,
  findUserByEmail,
  findUserById,
  updateDestinationRecord,
  updateManagedConfigRecord,
  updateModerationConfigRecord,
  updateOverlaySettingsRecord,
  readAppState,
  replaceAllScheduleBlocks,
  replaceTwitchScheduleSegments,
  replaceAssetsForSourceIds,
  resolveIncident,
  updateAppState,
  updateOwnerAndInitialized,
  updatePlayoutRuntime,
  updatePoolCursor,
  updatePoolRecord,
  updateScheduleBlockRecord,
  updateShowProfileRecord,
  updateTwitchConnectionRecord,
  upsertSourceRecord,
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
    blocks: state.scheduleBlocks
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

  return (
    occurrences.find((item) =>
      isCurrentScheduleTime({
        startTime: item.startTime,
        endTime: item.endTime,
        currentTime: scheduleMoment.time
      })
    ) ?? occurrences[0] ?? null
  );
}

export function getNextScheduleItem(state: AppState) {
  const current = getCurrentScheduleItem(state);
  const scheduleMoment = getCurrentScheduleMoment({
    now: new Date(),
    timeZone: getWorkspaceTimeZone()
  });
  const occurrences = buildScheduleOccurrences({
    date: scheduleMoment.date,
    blocks: state.scheduleBlocks
  });

  if (occurrences.length === 0) {
    return null;
  }

  if (!current) {
    return occurrences[0] ?? null;
  }

  const currentIndex = occurrences.findIndex((item) => item.key === current.key);
  if (currentIndex === -1) {
    return occurrences[0] ?? null;
  }

  return occurrences[(currentIndex + 1) % occurrences.length] ?? null;
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
      asset.status === "ready"
        ? "Asset should be usable for pool rotation or override if the upstream URL is still reachable."
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

function summarizeDestination(state: AppState): LiveDestinationSummary | null {
  const destination =
    state.destinations.find((entry) => entry.id === state.playout.currentDestinationId) ?? state.destinations[0] ?? null;
  if (!destination) {
    return null;
  }

  return {
    id: destination.id,
    name: destination.name,
    status: destination.status,
    notes: destination.notes,
    rtmpUrl: destination.rtmpUrl,
    streamKeyPresent: destination.streamKeyPresent
  };
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
    brandBadge: overlay.brandBadge,
    scenePreset: normalizeOverlayScenePreset(overlay.scenePreset),
    accentColor: overlay.accentColor,
    surfaceStyle: normalizeOverlaySurfaceStyle(overlay.surfaceStyle),
    panelAnchor: normalizeOverlayPanelAnchor(overlay.panelAnchor),
    titleScale: normalizeOverlayTitleScale(overlay.titleScale),
    showClock: overlay.showClock,
    showNextItem: overlay.showNextItem,
    showScheduleTeaser: overlay.showScheduleTeaser,
    showCurrentCategory: overlay.showCurrentCategory,
    showSourceLabel: overlay.showSourceLabel,
    showQueuePreview: overlay.showQueuePreview,
    queuePreviewCount: overlay.queuePreviewCount,
    emergencyBanner: overlay.emergencyBanner,
    tickerText: overlay.tickerText,
    replayLabel: overlay.replayLabel,
    updatedAt: overlay.updatedAt
  };
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
    insertAssetId: playout.insertAssetId,
    insertRequestedAt: playout.insertRequestedAt,
    insertStatus: playout.insertStatus,
    skipAssetId: playout.skipAssetId,
    skipUntil: playout.skipUntil,
    currentAssetId: playout.currentAssetId,
    currentTitle: playout.currentTitle,
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

export function getBroadcastSnapshot(state: AppState): BroadcastSnapshot {
  const currentScheduleItem = getCurrentScheduleItem(state);
  const nextScheduleItem = getNextScheduleItem(state);
  const queuedAssets = getPlayoutQueueAssets(state);

  return {
    generatedAt: new Date().toISOString(),
    timeZone: getWorkspaceTimeZone(),
    workerHealth: getWorkerHealth(state),
    playout: summarizePlayout(state.playout),
    overlay: summarizeOverlay(state.overlay),
    destination: summarizeDestination(state),
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

  if (ageMs > 120_000) {
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
  const activeDestination = state.destinations.find((entry) => entry.id === state.playout.currentDestinationId) ?? state.destinations[0] ?? null;
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
