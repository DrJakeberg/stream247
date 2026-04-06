import type {
  DestinationRoutingStatus,
  OverlaySceneCustomLayer,
  OverlaySceneLayerKind,
  OverlayScenePayload,
  OverlayTypographyPreset
} from "@stream247/core";

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
  role: "primary" | "backup";
  priority: number;
  name: string;
  status: DestinationRoutingStatus;
  notes: string;
  rtmpUrl: string;
  streamKeyPresent: boolean;
  streamKeySource: "env" | "managed" | "missing";
  lastFailureAt: string;
  failureCount: number;
  lastError: string;
  active: boolean;
  recoveryState: "active" | "staged" | "cooldown" | "ready" | "missing-config";
  recoverySummary: string;
  failureHoldSecondsRemaining: number;
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

export type LiveBridgeSummary = {
  configured: boolean;
  status: "idle" | "pending" | "active" | "releasing" | "error";
  inputType: "" | "rtmp" | "hls";
  label: string;
  inputSummary: string;
  requestedAt: string;
  startedAt: string;
  releasedAt: string;
  lastError: string;
};

export type LiveAudioLaneSummary = {
  configured: boolean;
  active: boolean;
  assetId: string;
  title: string;
  sourceName: string;
  volumePercent: number;
  poolId: string;
  poolName: string;
  mode: "replace";
};

export type LiveCuepointSummary = {
  configured: boolean;
  safeBoundaryOnly: boolean;
  assetId: string;
  assetTitle: string;
  offsetsSeconds: number[];
  nextOffsetSeconds: number | null;
  dueOffsetSeconds: number | null;
  firedCount: number;
  totalCount: number;
  windowKey: string;
  lastTriggeredAt: string;
  lastAssetId: string;
};

export type LiveQueueItemSummary = {
  id: string;
  kind: "asset" | "insert" | "standby" | "reconnect" | "live";
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
  queueVersion: number;
  transitionTargetKind: "" | "asset" | "insert" | "standby" | "reconnect" | "live";
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
  manualNextAssetId: string;
  manualNextRequestedAt: string;
  insertAssetId: string;
  insertRequestedAt: string;
  insertStatus: string;
  skipAssetId: string;
  skipUntil: string;
  currentAssetId: string;
  currentTitle: string;
  previousAssetId: string;
  previousTitle: string;
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
  typographyPreset: OverlayTypographyPreset;
  showClock: boolean;
  showNextItem: boolean;
  showScheduleTeaser: boolean;
  showCurrentCategory: boolean;
  showSourceLabel: boolean;
  showQueuePreview: boolean;
  queuePreviewCount: number;
  layerOrder: OverlaySceneLayerKind[];
  disabledLayers: OverlaySceneLayerKind[];
  customLayers: OverlaySceneCustomLayer[];
  emergencyBanner: string;
  tickerText: string;
  replayLabel: string;
  updatedAt: string;
};

export type LiveSceneLayerSummary = {
  kind: OverlaySceneLayerKind;
  label: string;
  enabled: boolean;
};

export type LiveSceneSummary = {
  presetId: LiveOverlaySummary["scenePreset"];
  resolvedPresetId: LiveOverlaySummary["scenePreset"];
  surfaceStyle: LiveOverlaySummary["surfaceStyle"];
  panelAnchor: LiveOverlaySummary["panelAnchor"];
  titleScale: LiveOverlaySummary["titleScale"];
  typographyPreset: LiveOverlaySummary["typographyPreset"];
  layers: LiveSceneLayerSummary[];
  customLayers: OverlaySceneCustomLayer[];
};

export type BroadcastSnapshot = {
  generatedAt: string;
  timeZone: string;
  workerHealth: LiveWorkerHealth;
  playout: LivePlayoutSummary;
  liveBridge: LiveBridgeSummary;
  audioLane: LiveAudioLaneSummary;
  cuepoints: LiveCuepointSummary;
  overlay: LiveOverlaySummary;
  activeScene: LiveSceneSummary;
  activeScenePayload: OverlayScenePayload;
  destination: LiveDestinationSummary | null;
  destinations: LiveDestinationSummary[];
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
  activeScenePayload: OverlayScenePayload;
  playout: Pick<LivePlayoutSummary, "status" | "message" | "currentTitle" | "transitionState" | "overrideMode">;
  currentAsset: LiveAssetSummary | null;
  nextAsset: LiveAssetSummary | null;
  queuedAssets: LiveAssetSummary[];
  queueItems: LiveQueueItemSummary[];
  currentScheduleItem: LiveScheduleSummary | null;
  nextScheduleItem: LiveScheduleSummary | null;
};
