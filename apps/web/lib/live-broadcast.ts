export type LiveAssetSummary = {
  id: string;
  title: string;
  status: string;
  sourceId: string;
  sourceName: string;
  categoryName: string;
  durationSeconds: number;
  publishedAt: string;
  externalId: string;
  isGlobalFallback: boolean;
};

export type LiveDestinationSummary = {
  id: string;
  name: string;
  status: string;
  notes: string;
  rtmpUrl: string;
  streamKeyPresent: boolean;
};

export type LiveScheduleSummary = {
  id: string;
  key: string;
  title: string;
  startTime: string;
  endTime: string;
  categoryName: string;
  sourceName: string;
  reason: string;
  dayOfWeek: number;
};

export type LiveIncidentSummary = {
  id: string;
  title: string;
  message: string;
  severity: "info" | "warning" | "critical";
  status: "open" | "resolved";
  scope: "worker" | "playout" | "twitch" | "source" | "system";
  fingerprint: string;
  createdAt: string;
  acknowledgedAt: string;
  resolvedAt: string;
};

export type LiveWorkerHealth = {
  status: "healthy" | "stale" | "missing";
  summary: string;
  lastRunAt: string;
};

export type LiveQueueItemSummary = {
  id: string;
  kind: "asset" | "insert" | "standby" | "reconnect";
  title: string;
  subtitle: string;
  position: number;
  scenePreset:
    | "replay-lower-third"
    | "split-now-next"
    | "standby-board"
    | "minimal-chip"
    | "bumper-board"
    | "reconnect-board"
    | "";
  asset: LiveAssetSummary | null;
};

export type LivePlayoutSummary = {
  status: string;
  message: string;
  transitionState: string;
  transitionTargetKind: "" | "asset" | "insert" | "standby" | "reconnect";
  transitionTargetAssetId: string;
  transitionTargetTitle: string;
  transitionReadyAt: string;
  heartbeatAt: string;
  processPid: number;
  restartCount: number;
  crashLoopDetected: boolean;
  crashCountWindow: number;
  selectionReasonCode: string;
  fallbackTier: string;
  overrideMode: string;
  overrideAssetId: string;
  overrideUntil: string;
  insertAssetId: string;
  insertRequestedAt: string;
  insertStatus: string;
  skipAssetId: string;
  skipUntil: string;
  currentAssetId: string;
  currentTitle: string;
  desiredAssetId: string;
  nextAssetId: string;
  nextTitle: string;
  queuedAssetIds: string[];
  prefetchedAssetId: string;
  prefetchedTitle: string;
  prefetchedAt: string;
  prefetchStatus: string;
  prefetchError: string;
  pendingAction: string;
  pendingActionRequestedAt: string;
  restartRequestedAt: string;
  lastTransitionAt: string;
  lastStderrSample: string;
  currentDestinationId: string;
};

export type LiveOverlaySummary = {
  enabled: boolean;
  channelName: string;
  headline: string;
  insertHeadline: string;
  standbyHeadline: string;
  reconnectHeadline: string;
  brandBadge: string;
  scenePreset:
    | "replay-lower-third"
    | "split-now-next"
    | "standby-board"
    | "minimal-chip"
    | "bumper-board"
    | "reconnect-board";
  insertScenePreset:
    | "replay-lower-third"
    | "split-now-next"
    | "standby-board"
    | "minimal-chip"
    | "bumper-board"
    | "reconnect-board";
  standbyScenePreset:
    | "replay-lower-third"
    | "split-now-next"
    | "standby-board"
    | "minimal-chip"
    | "bumper-board"
    | "reconnect-board";
  reconnectScenePreset:
    | "replay-lower-third"
    | "split-now-next"
    | "standby-board"
    | "minimal-chip"
    | "bumper-board"
    | "reconnect-board";
  accentColor: string;
  surfaceStyle: "glass" | "solid" | "signal";
  panelAnchor: "bottom" | "center";
  titleScale: "compact" | "balanced" | "cinematic";
  showClock: boolean;
  showNextItem: boolean;
  showScheduleTeaser: boolean;
  showCurrentCategory: boolean;
  showSourceLabel: boolean;
  showQueuePreview: boolean;
  queuePreviewCount: number;
  layerOrder: Array<"chip" | "hero" | "next" | "queue" | "schedule" | "clock" | "banner" | "ticker">;
  disabledLayers: Array<"chip" | "hero" | "next" | "queue" | "schedule" | "clock" | "banner" | "ticker">;
  emergencyBanner: string;
  tickerText: string;
  replayLabel: string;
  updatedAt: string;
};

export type LiveSceneLayerSummary = {
  kind: "chip" | "hero" | "next" | "queue" | "schedule" | "clock" | "banner" | "ticker";
  label: string;
  enabled: boolean;
};

export type LiveSceneSummary = {
  presetId: LiveOverlaySummary["scenePreset"];
  resolvedPresetId: LiveOverlaySummary["scenePreset"];
  surfaceStyle: LiveOverlaySummary["surfaceStyle"];
  panelAnchor: LiveOverlaySummary["panelAnchor"];
  titleScale: LiveOverlaySummary["titleScale"];
  layers: LiveSceneLayerSummary[];
};

export type BroadcastSnapshot = {
  generatedAt: string;
  timeZone: string;
  workerHealth: LiveWorkerHealth;
  playout: LivePlayoutSummary;
  overlay: LiveOverlaySummary;
  activeScene: LiveSceneSummary;
  destination: LiveDestinationSummary | null;
  currentAsset: LiveAssetSummary | null;
  desiredAsset: LiveAssetSummary | null;
  nextAsset: LiveAssetSummary | null;
  prefetchedAsset: LiveAssetSummary | null;
  overrideAsset: LiveAssetSummary | null;
  queuedAssets: LiveAssetSummary[];
  queueItems: LiveQueueItemSummary[];
  currentScheduleItem: LiveScheduleSummary | null;
  nextScheduleItem: LiveScheduleSummary | null;
  openIncidents: LiveIncidentSummary[];
};

export type PublicChannelSnapshot = {
  generatedAt: string;
  timeZone: string;
  overlay: LiveOverlaySummary;
  activeScene: LiveSceneSummary;
  playout: Pick<LivePlayoutSummary, "status" | "message" | "currentTitle" | "transitionState" | "overrideMode">;
  currentAsset: LiveAssetSummary | null;
  nextAsset: LiveAssetSummary | null;
  queuedAssets: LiveAssetSummary[];
  queueItems: LiveQueueItemSummary[];
  currentScheduleItem: LiveScheduleSummary | null;
  nextScheduleItem: LiveScheduleSummary | null;
};
