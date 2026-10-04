import type {
  DestinationRoutingStatus,
  EngagementChatDisplayMode,
  EngagementEventKind,
  EngagementGameMode,
  EngagementOverlayPosition,
  EngagementOverlayStyle,
  OverlaySceneCustomLayer,
  OverlayScenePanelPlacementMap,
  OverlaySceneLayerKind,
  OverlayScenePayload,
  PresenceClampReason,
  ViewerLocale,
  OverlayTypographyPreset
} from "@stream247/core";
import type { PublicProgramme } from "@/lib/public-programme";

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
  /** What to press or run, from the catalogue in @stream247/core (M90); "" when it has none. */
  action: string;
  createdAt: string;
  /** Refreshed by every repeat of the same fingerprint, so this is "when it last happened". */
  updatedAt: string;
  acknowledgedAt: string;
  resolvedAt: string;
};

export type LiveWorkerHealth = {
  status: "healthy" | "stale" | "missing";
  summary: string;
  lastRunAt: string;
};

/** A runtime process that stopped reporting or never did (M90, U7). Computed, never stored. */
export type LiveHeartbeatProblem = {
  id: "heartbeat-worker" | "heartbeat-playout";
  service: "worker" | "playout";
  verdict: "stale" | "missing";
  /** The last heartbeat, "" when there never was one. The age is worded where it is drawn. */
  lastAt: string;
  title: string;
  message: string;
  action: string;
};

export type LiveTwitchStatusSummary = {
  // False when no Twitch account is connected (never connected, or the token was refused), so the
  // live status cannot be asked at all (M90, U12).
  connected: boolean;
  // Live state and viewers of the BROADCAST CHANNEL.
  status: "live" | "offline" | "unknown";
  viewerCount: number;
  // The broadcast channel's login (watch link, live label). Called broadcasterLogin until 2.1,
  // the same name the database uses for the bot account -- which is how the two got mixed up.
  channelLogin: string;
  // The bot account's login, shown next to it so nobody takes one for the other.
  botLogin: string;
  startedAt: string;
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
  /** Only the renderer's own panels somebody has moved; the studio seeds the rest from the flow. */
  panelPlacements: OverlayScenePanelPlacementMap;
  emergencyBanner: string;
  tickerText: string;
  replayLabel: string;
  updatedAt: string;
};

export type LiveEngagementSettingsSummary = {
  chatEnabled: boolean;
  alertsEnabled: boolean;
  donationsEnabled: boolean;
  channelPointsEnabled: boolean;
  gameEnabled: boolean;
  soloModeEnabled: boolean;
  smallGroupModeEnabled: boolean;
  crowdModeEnabled: boolean;
  gameWindowMinutes: number;
  chatRuntimeEnabled: boolean;
  alertsRuntimeEnabled: boolean;
  donationsRuntimeEnabled: boolean;
  channelPointsRuntimeEnabled: boolean;
  chatMode: EngagementChatDisplayMode;
  chatPosition: EngagementOverlayPosition;
  alertPosition: EngagementOverlayPosition;
  style: EngagementOverlayStyle;
  maxMessages: number;
  rateLimitPerMinute: number;
  updatedAt: string;
};

export type LiveEngagementGameOptionSummary = {
  id: string;
  label: string;
  votes: number;
  isLeading: boolean;
};

export type LiveEngagementGameSummary = {
  enabled: boolean;
  runtimeEnabled: boolean;
  mode: EngagementGameMode | "";
  activeChatterCount: number;
  windowMinutes: number;
  title: string;
  prompt: string;
  detail: string;
  options: LiveEngagementGameOptionSummary[];
  modeChangedAt: string;
  updatedAt: string;
};

export type LiveEngagementEventSummary = {
  id: string;
  kind: EngagementEventKind;
  actor: string;
  message: string;
  createdAt: string;
};

export type LiveEngagementSummary = {
  settings: LiveEngagementSettingsSummary;
  game: LiveEngagementGameSummary;
  chatStatus: "disabled" | "connected" | "disconnected";
  recentEvents: LiveEngagementEventSummary[];
};

export type LivePresenceSummary = {
  active: boolean;
  actor: string;
  requestedMinutes: number | null;
  appliedMinutes: number;
  clampReason: PresenceClampReason | "";
  expiresAt: string;
  remainingMinutes: number;
  summary: string;
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
  /** First in "Open problems": a stale or missing worker or playout heartbeat (M90). */
  heartbeatProblems: LiveHeartbeatProblem[];
  /** STREAM247_RELAY_ENABLED: with the relay the uplink holds the Twitch connection. */
  relayEnabled: boolean;
  twitch: LiveTwitchStatusSummary;
  playout: LivePlayoutSummary;
  liveBridge: LiveBridgeSummary;
  audioLane: LiveAudioLaneSummary;
  cuepoints: LiveCuepointSummary;
  overlay: LiveOverlaySummary;
  engagement: LiveEngagementSummary;
  presence: LivePresenceSummary;
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
  /** Every open incident, not only the few `openIncidents` carries, so a capped panel can say so. */
  openIncidentCount: number;
};

export type PublicChannelSnapshot = {
  generatedAt: string;
  timeZone: string;
  /** The channel language (M80). In the snapshot so a change reaches open pages with the next update. */
  locale: ViewerLocale;
  /** `timeZone` as a viewer names it, in the channel language ("Central European Time"). */
  timeZoneLabel: string;
  /** Where viewers watch, or empty when no usable broadcaster login is configured. */
  watchUrl: string;
  overlay: LiveOverlaySummary;
  engagement: LiveEngagementSummary;
  activeScene: LiveSceneSummary;
  playout: Pick<LivePlayoutSummary, "status" | "message" | "currentTitle" | "transitionState" | "overrideMode">;
  currentAsset: LiveAssetSummary | null;
  nextAsset: LiveAssetSummary | null;
  queuedAssets: LiveAssetSummary[];
  queueItems: LiveQueueItemSummary[];
  currentScheduleItem: LiveScheduleSummary | null;
  nextScheduleItem: LiveScheduleSummary | null;
  /** Up to three scheduled occurrences after `nextScheduleItem` (block level; the page reads `programme` since M100). */
  laterScheduleItems: LiveScheduleSummary[];
  /** M100: now, the next 24 hours item by item and the coming week, as instants. */
  programme: PublicProgramme;
};
