export * from "./as-run.js";
export * from "./asset-chapters.js";
export * from "./asset-probe-quarantine.js";
import { isAssetProbeQuarantined } from "./asset-probe-quarantine.js";
import { getAssetChapterAt, parseAssetChaptersJson } from "./asset-chapters.js";
import { createPoolRotation, poolRotationStateOf, walkPoolRotation, type PoolRotationSourceGate, type PoolRotationState } from "./pool-rotation.js";
export * from "./broadcast-channel.js";
export * from "./twitch-accounts.js";
export * from "./chat-emotes.js";
export * from "./chat-game.js";
export * from "./chat-game-2048.js";
export * from "./chat-game-minesweeper.js";
export * from "./chat-interaction.js";
export * from "./heartbeat.js";
export * from "./incident-actions.js";
export * from "./managed-runtime.js";
export * from "./operator-precedence.js";
export * from "./overlay-layout.js";
export * from "./pool-rotation.js";
export * from "./probe-network-outage.js";
export * from "./programming-asset-order.js";
export * from "./relay-ingest.js";
export * from "./source-circuit-breaker.js";
export * from "./source-health.js";
export * from "./twitch-vod-playback.js";
export * from "./viewer-messages/index.js";

import {
  resolveAlertsRuntimeEnabled,
  resolveChatOverlayRuntimeEnabled,
  type ManagedRuntimeToggleInput
} from "./managed-runtime.js";
import { OVERLAY_PANEL_IDS, OVERLAY_TICKER_DEFAULT_SECONDS, type OverlayPanelId } from "./overlay-layout.js";
import {
  localizeViewerBuiltInText,
  normalizeViewerLocale,
  viewerText,
  type ViewerLocale,
  type ViewerMessageKey
} from "./viewer-messages/index.js";

export type ModerationConfig = {
  enabled: boolean;
  command: string;
  defaultMinutes: number;
  minMinutes: number;
  maxMinutes: number;
  requirePrefix: boolean;
  fallbackEmoteOnly: boolean;
};

export type PresenceWindow = {
  actor: string;
  minutes: number;
  expiresAt: Date;
  createdAt: Date;
};

export type PresenceClampReason = "accepted" | "default" | "minimum" | "maximum";

export type ModeratorCheckInResult = PresenceWindow & {
  requestedMinutes: number | null;
  appliedMinutes: number;
  clampReason: PresenceClampReason;
  commandInput: string;
};

export type PresenceStatus = {
  active: boolean;
  chatMode: "normal" | "emote-only";
  summary: string;
};

export type OverlayScenePreset =
  | "replay-lower-third"
  | "split-now-next"
  | "standby-board"
  | "minimal-chip"
  | "bumper-board"
  | "reconnect-board";

export type LiveBridgeInputType = "rtmp" | "hls";

export type OverlayQueueKind = "asset" | "insert" | "standby" | "reconnect" | "live" | "";
export type OverlaySceneRenderTarget = "browser" | "on-air-text" | "on-air-scene";

export type OverlaySurfaceStyle = "glass" | "solid" | "signal";
export type OverlayPanelAnchor = "bottom" | "center";
export type OverlayTitleScale = "compact" | "balanced" | "cinematic";
export type OverlayTypographyPreset = "studio-sans" | "editorial-serif" | "signal-mono";
export type OverlaySceneLayerKind = "chip" | "hero" | "next" | "queue" | "schedule" | "clock" | "banner" | "ticker";
export type OverlaySceneCustomLayerKind = "text" | "logo" | "image" | "embed" | "widget" | "game" | "source";
export type OverlaySceneCustomTextTone = "headline" | "body" | "caption";
export type OverlaySceneCustomTextAlign = "left" | "center" | "right";
export type OverlaySceneCustomMediaFit = "contain" | "cover";
export type OverlaySceneCustomTextFontMode = "preset" | "safe-sans" | "safe-serif" | "safe-mono" | "custom-local";
export type OverlaySceneCustomWidgetMode = "embed" | "metadata";
export type OverlaySceneCustomWidgetDataKey = "current" | "next" | "queue";
export type OverlaySceneFrameSupportStatus = "supported" | "limited" | "unsupported";

export type StreamOutputProfileId = "720p30" | "1080p30" | "480p30" | "360p30" | "custom";
export type DestinationOutputProfileId = "inherit" | Exclude<StreamOutputProfileId, "custom">;

export type StreamOutputProfile = {
  id: StreamOutputProfileId;
  label: string;
  width: number;
  height: number;
  fps: number;
};

export type StreamOutputSettings = {
  profileId: StreamOutputProfileId;
  width: number;
  height: number;
  fps: number;
};

export type EngagementChatDisplayMode = "quiet" | "active" | "flood";
export type EngagementOverlayPosition = "bottom-left" | "bottom-right" | "top-left" | "top-right";
export type EngagementOverlayStyle = "compact" | "card";
export type EngagementEventKind = "chat" | "follow" | "subscribe" | "cheer" | "channel-point" | "status";
export type EngagementGameMode = "solo" | "small-group" | "crowd";

export type EngagementSettings = {
  chatEnabled: boolean;
  alertsEnabled: boolean;
  donationsEnabled: boolean;
  channelPointsEnabled: boolean;
  gameEnabled: boolean;
  soloModeEnabled: boolean;
  smallGroupModeEnabled: boolean;
  crowdModeEnabled: boolean;
  gameWindowMinutes: number;
  chatMode: EngagementChatDisplayMode;
  chatPosition: EngagementOverlayPosition;
  alertPosition: EngagementOverlayPosition;
  style: EngagementOverlayStyle;
  maxMessages: number;
  rateLimitPerMinute: number;
};

export type EngagementEvent = {
  id: string;
  kind: EngagementEventKind;
  actor: string;
  message: string;
  createdAt: string;
};

export type EngagementGameRuntime = {
  mode: EngagementGameMode | "";
  activeChatterCount: number;
  modeChangedAt: string;
  updatedAt: string;
};

export type EngagementGameOptionSummary = {
  id: string;
  label: string;
  votes: number;
  isLeading: boolean;
};

export type EngagementGameOverlayState = {
  mode: EngagementGameMode | "";
  title: string;
  prompt: string;
  detail: string;
  options: EngagementGameOptionSummary[];
};

type StreamOutputSettingsInput = {
  profileId?: unknown;
  width?: unknown;
  height?: unknown;
  fps?: unknown;
};

type DestinationOutputSettingsInput = {
  destinationProfileId?: unknown;
  streamSettings?: StreamOutputSettingsInput | null;
  env?: Record<string, string | undefined>;
};

type EngagementSettingsInput = {
  chatEnabled?: unknown;
  alertsEnabled?: unknown;
  donationsEnabled?: unknown;
  channelPointsEnabled?: unknown;
  gameEnabled?: unknown;
  soloModeEnabled?: unknown;
  smallGroupModeEnabled?: unknown;
  crowdModeEnabled?: unknown;
  gameWindowMinutes?: unknown;
  chatMode?: unknown;
  chatPosition?: unknown;
  alertPosition?: unknown;
  style?: unknown;
  maxMessages?: unknown;
  rateLimitPerMinute?: unknown;
};

type EngagementEventInput = {
  id?: unknown;
  kind?: unknown;
  actor?: unknown;
  message?: unknown;
  createdAt?: unknown;
};

export const STREAM_OUTPUT_PROFILES: StreamOutputProfile[] = [
  { id: "720p30", label: "720p30", width: 1280, height: 720, fps: 30 },
  { id: "1080p30", label: "1080p30", width: 1920, height: 1080, fps: 30 },
  { id: "480p30", label: "480p30", width: 854, height: 480, fps: 30 },
  { id: "360p30", label: "360p30", width: 640, height: 360, fps: 30 },
  { id: "custom", label: "Custom", width: 1280, height: 720, fps: 30 }
];

export const DESTINATION_OUTPUT_PROFILES: Array<{ id: DestinationOutputProfileId; label: string }> = [
  { id: "inherit", label: "Use stream profile" },
  ...STREAM_OUTPUT_PROFILES.filter((profile) => profile.id !== "custom").map((profile) => ({
    id: profile.id as DestinationOutputProfileId,
    label: profile.label
  }))
];

export const DEFAULT_STREAM_OUTPUT_SETTINGS: StreamOutputSettings = {
  profileId: "720p30",
  width: 1280,
  height: 720,
  fps: 30
};

export const DEFAULT_ENGAGEMENT_SETTINGS: EngagementSettings = {
  chatEnabled: false,
  alertsEnabled: false,
  donationsEnabled: true,
  channelPointsEnabled: true,
  gameEnabled: false,
  soloModeEnabled: true,
  smallGroupModeEnabled: true,
  crowdModeEnabled: true,
  gameWindowMinutes: 10,
  chatMode: "quiet",
  chatPosition: "bottom-left",
  alertPosition: "top-right",
  style: "compact",
  maxMessages: 5,
  rateLimitPerMinute: 30
};

function clampInteger(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.min(max, Math.max(min, Math.round(parsed)));
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on") {
      return true;
    }
    if (normalized === "" || normalized === "0" || normalized === "false" || normalized === "no" || normalized === "off") {
      return false;
    }
  }
  return fallback;
}

const invisibleUnicodePattern =
  /[\u0000-\u0008\u000B-\u001F\u007F-\u009F\u00AD\u200B-\u200D\u202A-\u202E\u2066-\u2069\uFEFF]/g;

/**
 * Escape a string for literal use inside a RegExp.
 *
 * Chat commands and vote tokens are operator-configured and end up interpolated into patterns that
 * run against every incoming IRC message. An unescaped "(" or "[" throws at RegExp construction
 * time, inside a socket data handler where nothing catches it.
 */
export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function stripInvisibleCharacters(value: string): string {
  return String(value ?? "").normalize("NFC").replace(invisibleUnicodePattern, "");
}

function sanitizeTextValue(value: unknown, maxLength: number): string {
  return stripInvisibleCharacters(String(value ?? "")).trim().slice(0, maxLength);
}

export function normalizeStreamOutputProfileId(value: unknown): StreamOutputProfileId {
  const candidate = String(value ?? "");
  return STREAM_OUTPUT_PROFILES.some((profile) => profile.id === candidate)
    ? (candidate as StreamOutputProfileId)
    : DEFAULT_STREAM_OUTPUT_SETTINGS.profileId;
}

export function normalizeDestinationOutputProfileId(value: unknown): DestinationOutputProfileId {
  const candidate = String(value ?? "");
  return DESTINATION_OUTPUT_PROFILES.some((profile) => profile.id === candidate)
    ? (candidate as DestinationOutputProfileId)
    : "inherit";
}

export function normalizeStreamOutputSettings(value?: StreamOutputSettingsInput | null): StreamOutputSettings {
  const profileId = normalizeStreamOutputProfileId(value?.profileId);
  const profile = STREAM_OUTPUT_PROFILES.find((entry) => entry.id === profileId) ?? STREAM_OUTPUT_PROFILES[0]!;

  if (profileId !== "custom") {
    return {
      profileId,
      width: profile.width,
      height: profile.height,
      fps: profile.fps
    };
  }

  return {
    profileId,
    width: clampInteger(value?.width, profile.width, 640, 3840),
    height: clampInteger(value?.height, profile.height, 360, 2160),
    fps: clampInteger(value?.fps, profile.fps, 1, 60)
  };
}

export function resolveStreamOutputSettings(args?: {
  settings?: StreamOutputSettingsInput | null;
  env?: Record<string, string | undefined>;
}): StreamOutputSettings {
  const base = normalizeStreamOutputSettings(args?.settings);
  const env = args?.env ?? {};
  const hasEnvOverride =
    env.STREAM_OUTPUT_WIDTH !== undefined ||
    env.STREAM_OUTPUT_HEIGHT !== undefined ||
    env.STREAM_OUTPUT_FPS !== undefined;

  if (!hasEnvOverride) {
    return base;
  }

  return normalizeStreamOutputSettings({
    profileId: "custom",
    width: env.STREAM_OUTPUT_WIDTH === undefined ? base.width : env.STREAM_OUTPUT_WIDTH,
    height: env.STREAM_OUTPUT_HEIGHT === undefined ? base.height : env.STREAM_OUTPUT_HEIGHT,
    fps: env.STREAM_OUTPUT_FPS === undefined ? base.fps : env.STREAM_OUTPUT_FPS
  });
}

export function resolveDestinationOutputSettings(args?: DestinationOutputSettingsInput): StreamOutputSettings {
  const destinationProfileId = normalizeDestinationOutputProfileId(args?.destinationProfileId);
  if (destinationProfileId === "inherit") {
    return resolveStreamOutputSettings({
      settings: args?.streamSettings,
      env: args?.env
    });
  }

  return normalizeStreamOutputSettings({
    profileId: destinationProfileId
  });
}

export function normalizeEngagementChatDisplayMode(value: unknown): EngagementChatDisplayMode {
  return value === "active" || value === "flood" || value === "quiet" ? value : DEFAULT_ENGAGEMENT_SETTINGS.chatMode;
}

export function normalizeEngagementOverlayPosition(value: unknown): EngagementOverlayPosition {
  return value === "bottom-right" || value === "top-left" || value === "top-right" || value === "bottom-left"
    ? value
    : DEFAULT_ENGAGEMENT_SETTINGS.chatPosition;
}

export function normalizeEngagementOverlayStyle(value: unknown): EngagementOverlayStyle {
  return value === "card" || value === "compact" ? value : DEFAULT_ENGAGEMENT_SETTINGS.style;
}

export function normalizeEngagementEventKind(value: unknown): EngagementEventKind {
  return value === "follow" ||
    value === "subscribe" ||
    value === "cheer" ||
    value === "channel-point" ||
    value === "status" ||
    value === "chat"
    ? value
    : "status";
}

export function normalizeEngagementGameMode(value: unknown): EngagementGameMode | "" {
  return value === "solo" || value === "small-group" || value === "crowd" ? value : "";
}

export function normalizeEngagementSettings(value?: EngagementSettingsInput | null): EngagementSettings {
  const defaults = DEFAULT_ENGAGEMENT_SETTINGS;
  return {
    chatEnabled: normalizeBoolean(value?.chatEnabled, defaults.chatEnabled),
    alertsEnabled: normalizeBoolean(value?.alertsEnabled, defaults.alertsEnabled),
    donationsEnabled: normalizeBoolean(value?.donationsEnabled, defaults.donationsEnabled),
    channelPointsEnabled: normalizeBoolean(value?.channelPointsEnabled, defaults.channelPointsEnabled),
    gameEnabled: normalizeBoolean(value?.gameEnabled, defaults.gameEnabled),
    soloModeEnabled: normalizeBoolean(value?.soloModeEnabled, defaults.soloModeEnabled),
    smallGroupModeEnabled: normalizeBoolean(value?.smallGroupModeEnabled, defaults.smallGroupModeEnabled),
    crowdModeEnabled: normalizeBoolean(value?.crowdModeEnabled, defaults.crowdModeEnabled),
    gameWindowMinutes: clampInteger(value?.gameWindowMinutes, defaults.gameWindowMinutes, 1, 30),
    chatMode: normalizeEngagementChatDisplayMode(value?.chatMode),
    chatPosition: normalizeEngagementOverlayPosition(value?.chatPosition),
    alertPosition: normalizeEngagementOverlayPosition(value?.alertPosition),
    style: normalizeEngagementOverlayStyle(value?.style),
    maxMessages: clampInteger(value?.maxMessages, defaults.maxMessages, 1, 12),
    rateLimitPerMinute: clampInteger(value?.rateLimitPerMinute, defaults.rateLimitPerMinute, 1, 120)
  };
}

export function normalizeEngagementEvent(value: EngagementEventInput): EngagementEvent {
  return {
    id: sanitizeTextValue(value.id, 80),
    kind: normalizeEngagementEventKind(value.kind),
    actor: sanitizeTextValue(value.actor, 80),
    message: sanitizeTextValue(value.message, 280),
    createdAt: stripInvisibleCharacters(String(value.createdAt ?? "")).trim()
  };
}

// The runtime gates now resolve through managed config first (M56) and keep the env variable
// as fallback. Callers that have application state pass state.managedConfig; omitting it keeps
// the historical env-only behaviour, which is also what every pre-M56 call site did.
export function isEngagementChatRuntimeEnabled(
  settings: EngagementSettingsInput | null | undefined,
  env: Record<string, string | undefined>,
  managedConfig?: ManagedRuntimeToggleInput
): boolean {
  return normalizeEngagementSettings(settings).chatEnabled && resolveChatOverlayRuntimeEnabled(managedConfig, env);
}

/**
 * Whether the Twitch chat connection is needed at all.
 *
 * Finding [7] of the codebase review: the bridge used to follow the chat rail's switch alone, and
 * it is the only intake for moderator check-ins, votes, skip votes, viewer requests and the chat
 * game — hiding the panel silently switched all of them off. The connection is needed when any
 * consumer needs it; the rail is one consumer, gated separately where the panel is drawn.
 */
export function isChatBridgeRuntimeNeeded(
  state: {
    engagement: EngagementSettingsInput | null | undefined;
    managedConfig?: ManagedRuntimeToggleInput;
    moderation?: { enabled: boolean } | null;
    chatInteraction?: { enabled: boolean } | null;
    chatGame?: { enabled: boolean } | null;
  },
  env: Record<string, string | undefined>
): boolean {
  return (
    isEngagementChatRuntimeEnabled(state.engagement, env, state.managedConfig) ||
    Boolean(state.moderation?.enabled) ||
    Boolean(state.chatInteraction?.enabled) ||
    Boolean(state.chatGame?.enabled)
  );
}

export function isEngagementAlertsRuntimeEnabled(
  settings: EngagementSettingsInput | null | undefined,
  env: Record<string, string | undefined>,
  managedConfig?: ManagedRuntimeToggleInput
): boolean {
  return normalizeEngagementSettings(settings).alertsEnabled && resolveAlertsRuntimeEnabled(managedConfig, env);
}

export function isEngagementDonationAlertsRuntimeEnabled(
  settings: EngagementSettingsInput | null | undefined,
  env: Record<string, string | undefined>,
  managedConfig?: ManagedRuntimeToggleInput
): boolean {
  const normalized = normalizeEngagementSettings(settings);
  return normalized.donationsEnabled && isEngagementAlertsRuntimeEnabled(normalized, env, managedConfig);
}

export function isEngagementChannelPointsRuntimeEnabled(
  settings: EngagementSettingsInput | null | undefined,
  env: Record<string, string | undefined>,
  managedConfig?: ManagedRuntimeToggleInput
): boolean {
  const normalized = normalizeEngagementSettings(settings);
  return normalized.channelPointsEnabled && isEngagementAlertsRuntimeEnabled(normalized, env, managedConfig);
}

export function hasEnabledEngagementGameModes(settings: EngagementSettingsInput | null | undefined): boolean {
  const normalized = normalizeEngagementSettings(settings);
  return normalized.soloModeEnabled || normalized.smallGroupModeEnabled || normalized.crowdModeEnabled;
}

export function isEngagementGameRuntimeEnabled(
  settings: EngagementSettingsInput | null | undefined,
  env: Record<string, string | undefined>,
  managedConfig?: ManagedRuntimeToggleInput
): boolean {
  const normalized = normalizeEngagementSettings(settings);
  return (
    normalized.gameEnabled &&
    hasEnabledEngagementGameModes(normalized) &&
    isEngagementChatRuntimeEnabled(normalized, env, managedConfig)
  );
}

export function getEngagementGameWindowMs(settings: EngagementSettingsInput | null | undefined): number {
  return normalizeEngagementSettings(settings).gameWindowMinutes * 60_000;
}

export function resolveEngagementGameModeForActiveChatters(
  settings: EngagementSettingsInput | null | undefined,
  activeChatterCount: number
): EngagementGameMode | "" {
  const normalized = normalizeEngagementSettings(settings);
  if (!normalized.gameEnabled || activeChatterCount <= 0) {
    return "";
  }

  if (activeChatterCount >= 10 && normalized.crowdModeEnabled) {
    return "crowd";
  }

  if (activeChatterCount >= 2 && normalized.smallGroupModeEnabled) {
    return "small-group";
  }

  if (normalized.soloModeEnabled) {
    return "solo";
  }

  if (normalized.smallGroupModeEnabled) {
    return "small-group";
  }

  if (normalized.crowdModeEnabled) {
    return "crowd";
  }

  return "";
}

export function normalizeEngagementGameRuntime(value?: Partial<EngagementGameRuntime> | null): EngagementGameRuntime {
  return {
    mode: normalizeEngagementGameMode(value?.mode),
    activeChatterCount: Math.max(0, Math.round(Number(value?.activeChatterCount ?? 0) || 0)),
    modeChangedAt: stripInvisibleCharacters(String(value?.modeChangedAt ?? "")).trim(),
    updatedAt: stripInvisibleCharacters(String(value?.updatedAt ?? "")).trim()
  };
}

function buildLeadingVoteOptions(options: Array<{ id: string; label: string; votes: number }>): EngagementGameOptionSummary[] {
  const leadingVotes = Math.max(0, ...options.map((option) => option.votes));
  return options.map((option) => ({
    ...option,
    isLeading: leadingVotes > 0 && option.votes === leadingVotes
  }));
}

export function buildEngagementGameOverlayState(args: {
  settings: EngagementSettingsInput | null | undefined;
  runtime: Partial<EngagementGameRuntime> | null | undefined;
  recentEvents: Array<Partial<EngagementEvent>> | null | undefined;
}): EngagementGameOverlayState {
  const settings = normalizeEngagementSettings(args.settings);
  const runtime = normalizeEngagementGameRuntime(args.runtime);
  const recentChatEvents = Array.isArray(args.recentEvents)
    ? args.recentEvents.map((event) => normalizeEngagementEvent(event)).filter((event) => event.kind === "chat")
    : [];

  if (!settings.gameEnabled || !hasEnabledEngagementGameModes(settings) || runtime.mode === "" || runtime.activeChatterCount <= 0) {
    return {
      mode: "",
      title: "",
      prompt: "",
      detail: "",
      options: []
    };
  }

  const latestChatEvent = recentChatEvents[0] ?? null;
  if (runtime.mode === "solo") {
    const latestActor = latestChatEvent?.actor || "Your first chatter";
    const prompt = recentChatEvents.length % 2 === 0 ? "Echo the hype in chat" : "Drop one emote that matches the scene";
    return {
      mode: "solo",
      title: "Solo mode",
      prompt,
      detail: `${latestActor} is carrying the room. Keep the stream moving with one quick reply.`,
      options: []
    };
  }

  if (runtime.mode === "small-group") {
    const voteOptions = buildLeadingVoteOptions(
      [
        { id: "fire", label: "🔥 Hype", votes: 0 },
        { id: "blue", label: "💙 Chill", votes: 0 },
        { id: "party", label: "🎉 Party", votes: 0 }
      ].map((option) => ({
        ...option,
        votes: recentChatEvents.reduce((count, event) => count + (event.message.includes(option.label.split(" ")[0] || "") ? 1 : 0), 0)
      }))
    );
    return {
      mode: "small-group",
      title: "Small-group mode",
      prompt: "Quick emoji vote",
      detail: `Watching ${runtime.activeChatterCount} active chatters over the last ${settings.gameWindowMinutes} minutes.`,
      options: voteOptions
    };
  }

  const predictionOptions = buildLeadingVoteOptions(
    [
      { id: "vote-a", token: "!a", label: "!A Hold", votes: 0 },
      { id: "vote-b", token: "!b", label: "!B Push", votes: 0 },
      { id: "vote-c", token: "!c", label: "!C Chaos", votes: 0 }
    ].map((option) => ({
      ...option,
      votes: recentChatEvents.reduce(
        (count, event) => count + (new RegExp(`(^|\\s)${escapeRegExp(option.token)}($|\\s)`, "i").test(event.message) ? 1 : 0),
        0
      )
    }))
  );

  return {
    mode: "crowd",
    title: "Crowd mode",
    prompt: "Prediction board",
    detail: `${runtime.activeChatterCount} chatters are active. Let the room pick the next beat with !A, !B, or !C.`,
    options: predictionOptions
  };
}

type OverlaySceneCustomLayerBase = {
  id: string;
  kind: OverlaySceneCustomLayerKind;
  name: string;
  enabled: boolean;
  xPercent: number;
  yPercent: number;
  widthPercent: number;
  heightPercent: number;
  opacityPercent: number;
  allowOutsideSafeArea: boolean;
};

export type OverlaySceneCustomTextLayer = OverlaySceneCustomLayerBase & {
  kind: "text";
  text: string;
  secondaryText: string;
  textTone: OverlaySceneCustomTextTone;
  textAlign: OverlaySceneCustomTextAlign;
  useAccent: boolean;
  fontMode: OverlaySceneCustomTextFontMode;
  customFontFamily: string;
};

export type OverlaySceneCustomMediaLayer = OverlaySceneCustomLayerBase & {
  kind: "logo" | "image";
  url: string;
  altText: string;
  fit: OverlaySceneCustomMediaFit;
};

export type OverlaySceneCustomEmbedLayer = OverlaySceneCustomLayerBase & {
  kind: "embed";
  url: string;
  title: string;
};

export type OverlaySceneCustomWidgetLayer = OverlaySceneCustomLayerBase & {
  kind: "widget";
  url: string;
  title: string;
  widgetMode: OverlaySceneCustomWidgetMode;
  widgetDataKey: OverlaySceneCustomWidgetDataKey;
};

/**
 * Placement slot for the chat game. The layer only says where the game panel sits in this scene;
 * which game runs, its grid, and its emote mapping live in the chat-game settings, because the
 * same game continues across scene changes and must not fork per scene.
 */
export type OverlaySceneCustomGameLayer = OverlaySceneCustomLayerBase & {
  kind: "game";
  /**
   * How much of the panel's backdrop is drawn, 0-100, independent of opacityPercent.
   *
   * The games are the one surface an operator asks to be "as transparent as possible", and
   * opacityPercent could not give them that: it fades the board along with the fill, so a game
   * at 5% is not a transparent game but an invisible one. This fades only what is behind the
   * board. The board itself is outlined so it survives the fill going away.
   */
  backgroundOpacityPercent: number;
};

/**
 * Placement slot for a sampled external video source (a camera or feed). The layer carries only
 * where the picture sits and which stored source it shows: the source's URL frequently embeds
 * credentials, so it lives encrypted in its own store and is referenced by id — it must never
 * travel through the scene payload, which is cached, diffed and logged in the clear.
 */
export type OverlaySceneCustomSourceLayer = OverlaySceneCustomLayerBase & {
  kind: "source";
  /** Id of the stored video source; empty until the operator links one. */
  sourceId: string;
};

/**
 * Where one of the renderer's own panels sits, in the same percentages a custom layer uses.
 *
 * Stored per panel and only for the panels somebody has actually moved. An absent entry is not a
 * default written down — it is "this panel is still in the flow", which is what keeps a scene
 * nobody has rearranged drawing exactly the picture it drew before any of this existed. The studio
 * seeds a new entry from deriveDefaultPlacements, so the first thing an operator sees when they
 * take hold of a panel is where that panel already is.
 */
export type OverlayScenePanelPlacement = {
  xPercent: number;
  yPercent: number;
  widthPercent: number;
  heightPercent: number;
  opacityPercent: number;
  allowOutsideSafeArea: boolean;
};

export type OverlayScenePanelPlacementMap = Partial<Record<OverlayPanelId, OverlayScenePanelPlacement>>;

export type OverlaySceneCustomLayer =
  | OverlaySceneCustomTextLayer
  | OverlaySceneCustomMediaLayer
  | OverlaySceneCustomEmbedLayer
  | OverlaySceneCustomWidgetLayer
  | OverlaySceneCustomGameLayer
  | OverlaySceneCustomSourceLayer;

export type OverlayScenePresetDefinition = {
  id: OverlayScenePreset;
  label: string;
  description: string;
};

export type OverlaySceneLayerDefinition = {
  kind: OverlaySceneLayerKind;
  label: string;
  enabled: boolean;
};

export type OverlaySceneDefinition = {
  presetId: OverlayScenePreset;
  resolvedPresetId: OverlayScenePreset;
  surfaceStyle: OverlaySurfaceStyle;
  panelAnchor: OverlayPanelAnchor;
  titleScale: OverlayTitleScale;
  typographyPreset: OverlayTypographyPreset;
  layers: OverlaySceneLayerDefinition[];
  customLayers: OverlaySceneCustomLayer[];
  /** Only the renderer's own panels an operator has moved; the rest stay in the flow. */
  panelPlacements: OverlayScenePanelPlacementMap;
};

export type OverlayScenePayload = {
  target: OverlaySceneRenderTarget;
  queueKind: OverlayQueueKind;
  scene: OverlaySceneDefinition;
  channelName: string;
  accentColor: string;
  brandLine: string;
  heroLabel: string;
  heroTitle: string;
  heroBody: string;
  metaLine: string;
  nextLabel: string;
  nextTitle: string;
  nextTimeLabel: string;
  queueTitleLine: string;
  queueTitles: string[];
  scheduleLabel: string;
  scheduleTitle: string;
  scheduleBody: string;
  scheduleAux: string;
  tickerText: string;
  /** Seconds the running ticker line takes to cross its band. See overlayTickerCrawlPlan. */
  tickerRotateSeconds: number;
  emergencyBanner: string;
  timeZone: string;
  /**
   * The channel language (M80). Carried like timeZone so the studio preview and the playout
   * renderer write the picture in the same language, and so the playout container can build the
   * poll, skip and game panels it re-derives from database rows in that language too.
   */
  locale: ViewerLocale;
};

export type OverlaySceneFrameSupport = {
  providerLabel: string;
  status: OverlaySceneFrameSupportStatus;
  badgeLabel: string;
  guidance: string;
};

export type OverlaySceneMetadataWidgetContent = {
  label: string;
  title: string;
  body: string;
  secondary: string;
};

export type OverlaySceneSource = {
  scenePreset: OverlayScenePreset;
  insertScenePreset: OverlayScenePreset;
  standbyScenePreset: OverlayScenePreset;
  reconnectScenePreset: OverlayScenePreset;
  headline: string;
  insertHeadline: string;
  standbyHeadline: string;
  reconnectHeadline: string;
  surfaceStyle: OverlaySurfaceStyle;
  panelAnchor: OverlayPanelAnchor;
  titleScale: OverlayTitleScale;
  typographyPreset: OverlayTypographyPreset;
  showClock: boolean;
  showNextItem: boolean;
  showScheduleTeaser: boolean;
  showCurrentCategory: boolean;
  showSourceLabel: boolean;
  showQueuePreview: boolean;
  queuePreviewCount: number;
  emergencyBanner: string;
  tickerText: string;
  /** Seconds the running ticker line takes to cross its band. See overlayTickerCrawlPlan. */
  tickerRotateSeconds: number;
  layerOrder: OverlaySceneLayerKind[];
  disabledLayers: OverlaySceneLayerKind[];
  customLayers: OverlaySceneCustomLayer[];
  panelPlacements: OverlayScenePanelPlacementMap;
};

export type OverlayOptionDefinition<T extends string> = {
  id: T;
  label: string;
  description: string;
};

export type ScheduleRepeatMode = "single" | "daily" | "weekdays" | "weekends" | "custom";
export type DestinationRoutingStatus = "ready" | "recovering" | "missing-config" | "error";

export type ScheduleBlock = {
  id: string;
  title: string;
  categoryName: string;
  dayOfWeek: number;
  startMinuteOfDay: number;
  durationMinutes: number;
  showId?: string;
  poolId?: string;
  sourceName: string;
  repeatMode?: ScheduleRepeatMode;
  repeatGroupId?: string;
  cuepointAssetId?: string;
  cuepointOffsetsSeconds?: number[];
  /**
   * Dated runs (M93): local calendar dates `YYYY-MM-DD` in the channel zone, inclusive, that bound the
   * *start* of an occurrence. Empty or missing means unbounded, which is every block before M93. A block
   * with either date is "dated" and sits on a layer above the weekly grid (owner decision 5.1 Q1).
   */
  validFrom?: string;
  validUntil?: string;
};

export type ShowProfile = {
  id: string;
  name: string;
  categoryName: string;
  defaultDurationMinutes: number;
  color: string;
  description: string;
};

export type SchedulePreview = {
  date: string;
  items: Array<{
    id: string;
    title: string;
    startTime: string;
    endTime: string;
    durationMinutes: number;
    categoryName: string;
    dayOfWeek: number;
    showId?: string;
    poolId?: string;
    sourceName: string;
    repeatMode?: ScheduleRepeatMode;
    reason: string;
    videoSlots: SchedulePreviewVideoSlot[];
  }>;
};

export type SchedulePreviewVideoSlot = {
  assetId: string;
  title: string;
  estimatedDurationSeconds: number;
  startOffsetSeconds: number;
  estimatedDuration: boolean;
};

export type SchedulePreviewPoolRecord = {
  id: string;
  sourceIds: string[];
  cursorAssetId?: string;
  sourceCursors?: Record<string, string>;
  insertAssetId?: string;
  insertEveryItems?: number;
  audioLaneAssetId?: string;
};

export type SchedulePreviewAssetRecord = {
  playbackProbeFailures?: number;
  id: string;
  sourceId: string;
  title: string;
  titlePrefix?: string;
  status: string;
  includeInProgramming: boolean;
  // Orders a source's Twitch archives, which have no date; see programming-asset-order.ts.
  externalId?: string;
  durationSeconds?: number;
  publishedAt?: string;
  createdAt: string;
};

export type ScheduleOccurrence = {
  key: string;
  blockId: string;
  title: string;
  categoryName: string;
  dayOfWeek: number;
  showId?: string;
  poolId?: string;
  sourceName: string;
  date: string;
  startTime: string;
  endTime: string;
  startMinuteOfDay: number;
  durationMinutes: number;
  /**
   * True when this occurrence started on the previous day and runs past midnight into `date`.
   * A block scheduled Monday 23:00 for two hours produces a Monday occurrence and a Tuesday
   * carry-over; without the latter the channel fell out of its programmed pool at 00:00.
   */
  carriesOverFromPreviousDay?: boolean;
  /**
   * Start expressed relative to `date`, so a carry-over is negative (Monday 23:00 seen from
   * Tuesday is -60). Ordering and "is it on now" comparisons use this rather than wall-clock
   * strings, which cannot tell a wrapping block's evening from its own morning.
   */
  effectiveStartMinuteOfDay: number;
  repeatMode?: ScheduleRepeatMode;
  repeatGroupId?: string;
  cuepointAssetId?: string;
  cuepointOffsetsSeconds?: number[];
  /** The block has a date window (M93); it takes over the undated blocks it overlaps. */
  dated?: boolean;
  validFrom?: string;
  validUntil?: string;
  /**
   * The minute ranges (relative to `date`, like `effectiveStartMinuteOfDay`) in which this occurrence is
   * really on air. One window covering the whole occurrence, unless a dated occurrence takes part of it
   * over: weekly 18-22 under a dated 20-21 has 18-20 and 21-22, keeping its own key and start, so cuepoints
   * still count from 18:00. Missing means the whole occurrence (callers that build occurrences by hand).
   */
  airWindows?: ScheduleAirWindow[];
};

export type ScheduleAirWindow = { start: number; end: number };

export type ScheduleDaySummary = {
  dayOfWeek: number;
  blockCount: number;
  scheduledMinutes: number;
  firstStartMinute: number | null;
  lastEndMinute: number | null;
};

export type ScheduleRepeatModeDefinition = OverlayOptionDefinition<ScheduleRepeatMode>;

export type MaterializedProgrammingItem = {
  kind: "asset" | "insert";
  assetId: string;
  title: string;
  durationMinutes: number;
  startTime: string;
  endTime: string;
  overflow: boolean;
  repeated: boolean;
  estimatedDuration: boolean;
  insertTrigger?: "pool-interval" | "cuepoint";
  /**
   * M100: when it starts and ends on air, in seconds from 00:00 of the block's date (past 86 400 for an item
   * after midnight). The end is where the item stops airing: cut at a dated block, past the block's end when
   * it overruns.
   */
  startSecond?: number;
  endSecond?: number;
};

export type MaterializedProgrammingBlock = {
  blockId: string;
  title: string;
  categoryName: string;
  dayOfWeek: number;
  startMinuteOfDay: number;
  durationMinutes: number;
  startTime: string;
  endTime: string;
  showId?: string;
  poolId?: string;
  sourceName: string;
  repeatMode: ScheduleRepeatMode;
  repeatLabel: string;
  fillStatus: "balanced" | "underfilled" | "overflow" | "empty";
  fillLabel: string;
  poolName: string;
  projectedMinutes: number;
  overflowMinutes: number;
  uniqueMinutes: number;
  insertCount: number;
  cuepointCount: number;
  queuePreview: string[];
  notes: string[];
  items: MaterializedProgrammingItem[];
  /** M93: the block's date window, and the minutes (relative to the day) it is really on air. */
  dated?: boolean;
  validFrom?: string;
  validUntil?: string;
  airWindows?: ScheduleAirWindow[];
  /** M97: the date the block starts on (a block past midnight is listed on that day only). */
  date?: string;
  /** Its air time in hours: "24 h". */
  durationLabel?: string;
  /** Its air times from its own day: "20:00 → 22:00", "23:00 → 01:00 Sun". */
  timeLabel?: string;
  /** Why it repeats, with numbers ("6 min of video for a 24 h block: plays ≈ 240 times. …"); empty when it does not. */
  repeatReason?: string;
  /** It ended before now on the first day of the week: it took nothing from its pool's rotation. */
  aired?: boolean;
};

export type MaterializedProgrammingDay = {
  date: string;
  dayOfWeek: number;
  totalScheduledMinutes: number;
  totalProjectedMinutes: number;
  blockCount: number;
  underfilledCount: number;
  overflowCount: number;
  emptyCount: number;
  blocks: MaterializedProgrammingBlock[];
};

export const SCHEDULE_REPEAT_MODE_OPTIONS: ScheduleRepeatModeDefinition[] = [
  {
    id: "single",
    label: "One weekday, every week",
    description: "Repeat on one weekday, every week."
  },
  {
    id: "daily",
    label: "Daily",
    description: "Create or treat this block as a seven-day repeat."
  },
  {
    id: "weekdays",
    label: "Weekdays",
    description: "Repeat Monday through Friday."
  },
  {
    id: "weekends",
    label: "Weekends",
    description: "Repeat on Saturday and Sunday."
  },
  {
    id: "custom",
    label: "Custom days",
    description: "Choose your own weekday combination."
  }
];

export const OVERLAY_SCENE_PRESETS: OverlayScenePresetDefinition[] = [
  {
    id: "replay-lower-third",
    label: "Replay Lower Third",
    description: "Wide now-playing panel with a compact next item card for a broadcast lower-third feel."
  },
  {
    id: "split-now-next",
    label: "Split Now / Next",
    description: "Balanced dual-card layout that keeps current and next programming equally visible."
  },
  {
    id: "standby-board",
    label: "Standby Board",
    description: "Full-frame replay board for standby, reconnects, or channels that always want a strong branded slate."
  },
  {
    id: "minimal-chip",
    label: "Minimal Chip",
    description: "Compact replay badge with current metadata for channels that want very light on-air graphics."
  },
  {
    id: "bumper-board",
    label: "Bumper Board",
    description: "Bold insert scene for channel IDs, bumpers, and manual inserts between regular programming."
  },
  {
    id: "reconnect-board",
    label: "Reconnect Board",
    description: "Centered reconnect scene for controlled output resets without losing channel branding."
  }
];

export const OVERLAY_SURFACE_STYLES: OverlayOptionDefinition<OverlaySurfaceStyle>[] = [
  {
    id: "glass",
    label: "Glass",
    description: "Soft translucent panels with the most broadcast-style depth."
  },
  {
    id: "solid",
    label: "Solid",
    description: "Heavier, more grounded panels for replay channels that want stronger contrast."
  },
  {
    id: "signal",
    label: "Signal",
    description: "High-energy accent treatment for inserts, IDs, and promo-heavy channels."
  }
];

export const OVERLAY_PANEL_ANCHORS: OverlayOptionDefinition<OverlayPanelAnchor>[] = [
  {
    id: "bottom",
    label: "Bottom Dock",
    description: "Classic lower-third placement anchored near the bottom edge."
  },
  {
    id: "center",
    label: "Center Stage",
    description: "Centered presentation for standby, reconnect, and branded replay boards."
  }
];

export const OVERLAY_TITLE_SCALES: OverlayOptionDefinition<OverlayTitleScale>[] = [
  {
    id: "compact",
    label: "Compact",
    description: "Tighter titles for metadata-heavy overlays."
  },
  {
    id: "balanced",
    label: "Balanced",
    description: "Default heading scale for most replay channels."
  },
  {
    id: "cinematic",
    label: "Cinematic",
    description: "Larger hero titles for brand-forward scenes and reconnect boards."
  }
];

export const OVERLAY_TYPOGRAPHY_PRESETS: OverlayOptionDefinition<OverlayTypographyPreset>[] = [
  {
    id: "studio-sans",
    label: "Studio Sans",
    description: "Neutral broadcast sans stack for everyday replay channels."
  },
  {
    id: "editorial-serif",
    label: "Editorial Serif",
    description: "More expressive serif headlines without loading remote fonts."
  },
  {
    id: "signal-mono",
    label: "Signal Mono",
    description: "Monospace-forward typography for technical, retro, or alert-heavy scenes."
  }
];

export const OVERLAY_SCENE_CUSTOM_TEXT_FONT_MODES: OverlayOptionDefinition<OverlaySceneCustomTextFontMode>[] = [
  {
    id: "preset",
    label: "Scene preset",
    description: "Follow the overlay-wide typography preset."
  },
  {
    id: "safe-sans",
    label: "Broadcast Sans",
    description: "Use a conservative local sans stack without loading remote fonts."
  },
  {
    id: "safe-serif",
    label: "Broadcast Serif",
    description: "Use a conservative local serif stack without loading remote fonts."
  },
  {
    id: "safe-mono",
    label: "Broadcast Mono",
    description: "Use a conservative local monospace stack without loading remote fonts."
  },
  {
    id: "custom-local",
    label: "Custom local stack",
    description: "Use only font family names already installed in the browser or worker environment."
  }
];

export const OVERLAY_SCENE_CUSTOM_WIDGET_DATA_KEYS: OverlayOptionDefinition<OverlaySceneCustomWidgetDataKey>[] = [
  {
    id: "current",
    label: "Current block",
    description: "Show the current title, category, and live scene metadata."
  },
  {
    id: "next",
    label: "Next block",
    description: "Show the upcoming title and schedule window."
  },
  {
    id: "queue",
    label: "Queue preview",
    description: "Show the later queue line from the current broadcast snapshot."
  }
];

/**
 * The file types the worker's library scan turns into playable assets. One list, used by the scan
 * (apps/worker local-library) and by the upload route and form (apps/web): the upload used to accept
 * .avi and four audio types the scan never picked up, so those files were copied to disk and then
 * silently ignored. Audio beds are ordinary library assets — a video container carrying the sound.
 */
export const LIBRARY_MEDIA_FILE_EXTENSIONS = [".mp4", ".mkv", ".mov", ".m4v", ".webm"] as const;

export const OVERLAY_SCENE_CUSTOM_LAYER_KINDS: OverlayOptionDefinition<OverlaySceneCustomLayerKind>[] = [
  {
    id: "text",
    label: "Text Layer",
    description: "Free-positioned text panel for labels, promos, and manual notes."
  },
  {
    id: "logo",
    label: "Logo Layer",
    description: "Contained brand mark or channel badge with safe remote/local URLs."
  },
  {
    id: "image",
    label: "Image Layer",
    description: "Positioned artwork or still image block."
  },
  {
    id: "embed",
    label: "Website Embed",
    description: "Sandboxed iframe for safe website embeds when the source permits framing."
  },
  {
    id: "widget",
    label: "Widget Embed",
    description: "Sandboxed iframe slot for third-party widgets that support embeds."
  },
  {
    id: "game",
    label: "Chat Game",
    description: "On-air panel for the chat-driven game. Which game runs and how chat steers it is configured in the game settings."
  },
  {
    id: "source",
    label: "Video Source",
    description: "Slowly refreshing picture from a stored camera or feed. The layer only places the picture; the feed itself is stored separately."
  }
];

export const OVERLAY_SCENE_LAYERS: OverlayOptionDefinition<OverlaySceneLayerKind>[] = [
  {
    id: "chip",
    label: "Brand Chip",
    description: "Replay badge, channel name, and mode label."
  },
  {
    id: "hero",
    label: "Hero Card",
    description: "Primary now-playing or standby headline card."
  },
  {
    id: "next",
    label: "Next Card",
    description: "Next item preview block."
  },
  {
    id: "queue",
    label: "Queue Preview",
    description: "Later queue strip for a few confirmed upcoming items."
  },
  {
    id: "schedule",
    label: "Schedule Teaser",
    description: "Extra supporting scene card for current category or fallback copy."
  },
  {
    id: "clock",
    label: "Clock",
    description: "Live local time in the configured channel timezone."
  },
  {
    id: "banner",
    label: "Emergency Banner",
    description: "High-priority operator banner."
  },
  {
    id: "ticker",
    label: "Ticker",
    description: "Persistent lower ticker line."
  }
];

export const DEFAULT_OVERLAY_SCENE_LAYER_ORDER: OverlaySceneLayerKind[] = [
  "chip",
  "hero",
  "next",
  "queue",
  "schedule",
  "clock",
  "banner",
  "ticker"
];

const dayLabels = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const estimatedProgrammingDurationSeconds = 30 * 60;
const maxMaterializedItemsPerBlock = 48;
const maxOverlaySceneCustomLayers = 8;

export function isOverlayScenePreset(value: string): value is OverlayScenePreset {
  return OVERLAY_SCENE_PRESETS.some((preset) => preset.id === value);
}

export function normalizeOverlayScenePreset(value: string): OverlayScenePreset {
  return isOverlayScenePreset(value) ? value : "replay-lower-third";
}

export function normalizeOverlaySurfaceStyle(value: string): OverlaySurfaceStyle {
  return OVERLAY_SURFACE_STYLES.some((entry) => entry.id === value) ? (value as OverlaySurfaceStyle) : "glass";
}

export function normalizeOverlayPanelAnchor(value: string): OverlayPanelAnchor {
  return OVERLAY_PANEL_ANCHORS.some((entry) => entry.id === value) ? (value as OverlayPanelAnchor) : "bottom";
}

export function normalizeOverlayTitleScale(value: string): OverlayTitleScale {
  return OVERLAY_TITLE_SCALES.some((entry) => entry.id === value) ? (value as OverlayTitleScale) : "balanced";
}

export function normalizeOverlayTypographyPreset(value: string): OverlayTypographyPreset {
  return OVERLAY_TYPOGRAPHY_PRESETS.some((entry) => entry.id === value) ? (value as OverlayTypographyPreset) : "studio-sans";
}

function normalizeOverlaySceneCustomTextFontMode(value: unknown): OverlaySceneCustomTextFontMode {
  return OVERLAY_SCENE_CUSTOM_TEXT_FONT_MODES.some((entry) => entry.id === value) ? (value as OverlaySceneCustomTextFontMode) : "preset";
}

function normalizeOverlaySceneCustomWidgetMode(value: unknown): OverlaySceneCustomWidgetMode {
  return value === "metadata" ? "metadata" : "embed";
}

function normalizeOverlaySceneCustomWidgetDataKey(value: unknown): OverlaySceneCustomWidgetDataKey {
  return value === "next" || value === "queue" ? value : "current";
}

export function normalizeScheduleRepeatMode(value: string): ScheduleRepeatMode {
  return SCHEDULE_REPEAT_MODE_OPTIONS.some((entry) => entry.id === value) ? (value as ScheduleRepeatMode) : "single";
}

export function normalizeLiveBridgeInputType(value: string): LiveBridgeInputType {
  return value === "hls" ? "hls" : "rtmp";
}

export function isValidLiveBridgeInputUrl(value: string, type: LiveBridgeInputType): boolean {
  try {
    const url = new URL(value);
    if (type === "rtmp") {
      return url.protocol === "rtmp:" || url.protocol === "rtmps:";
    }

    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function summarizeLiveBridgeInput(value: string): string {
  try {
    const url = new URL(value);
    const protocol = url.protocol.replace(":", "").toUpperCase();
    return `${protocol} · ${url.host}`;
  } catch {
    return "Configured live input";
  }
}

/**
 * What the picture says while a live bridge is on air, in the channel language.
 *
 * The worker wrote this at three sites as four English literals each; they were one concept with
 * three copies, so the language now lives here once. The operator's own bridge label is the title
 * and stays verbatim; only the words the product supplies are the catalogue's. The input type is
 * a protocol name (RTMP, HLS) in every language.
 */
export function buildLiveBridgeOverlayText(args: {
  locale?: string;
  /** The bridge's label, or whatever the caller already fell back to; empty means the product's name. */
  title: string;
  inputType: string;
  nextTitle: string;
}): { currentTitle: string; currentCategory: string; currentSourceName: string; nextTitle: string } {
  return {
    currentTitle: args.title || viewerText(args.locale, "liveBridge.label"),
    currentCategory: viewerText(args.locale, "liveBridge.category"),
    currentSourceName: viewerText(args.locale, "liveBridge.sourceLabel", {
      inputType: (args.inputType || "rtmp").toUpperCase()
    }),
    nextTitle: args.nextTitle || viewerText(args.locale, "liveBridge.resumes")
  };
}

export function normalizeOverlaySceneLayerOrder(value: unknown): OverlaySceneLayerKind[] {
  const provided = Array.isArray(value) ? value.filter((entry): entry is OverlaySceneLayerKind => OVERLAY_SCENE_LAYERS.some((layer) => layer.id === entry)) : [];
  const ordered = [...new Set(provided)];

  for (const layer of DEFAULT_OVERLAY_SCENE_LAYER_ORDER) {
    if (!ordered.includes(layer)) {
      ordered.push(layer);
    }
  }

  return ordered;
}

function clampOverlaySceneNumber(value: unknown, min: number, max: number, fallback: number): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, numeric));
}

/**
 * Reads back the placements an operator has set for the renderer's own panels.
 *
 * Same clamps as a custom layer's, because it is the same box: width stops at 10 and height at 8 so
 * nothing is saved at a size that draws as a smudge, opacity at 5 so nothing is saved invisible. A
 * key that is not a panel is dropped, and a panel with no entry stays out of the map — that absence
 * is what says "still in the flow", so writing a default here would move the picture.
 *
 * x and y run to 100, not to 90. The cap was 90, on the reasoning that a panel should not be
 * pushable off its own frame — but the panel that cannot be pushed off is the one that is already
 * anchored to the far edge. The clock is 149 design pixels wide against a 1776-pixel safe area, so
 * its left edge is at 91.6% by arithmetic; the next card's top is at 90.7% for the same reason.
 * Both seeds came straight from deriveDefaultPlacements, which exists so that placing a panel moves
 * nothing — and both were clamped on save, so placing the clock moved it 28 design pixels and the
 * next card 8. What stops a box leaving the frame is resolvePlacementBox clamping its width against
 * the room x leaves, which it has always done and still does.
 */
export function normalizeOverlayScenePanelPlacements(value: unknown): OverlayScenePanelPlacementMap {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const source = value as Record<string, unknown>;
  const placements: OverlayScenePanelPlacementMap = {};
  for (const id of OVERLAY_PANEL_IDS) {
    const entry = source[id];
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      continue;
    }
    const raw = entry as Record<string, unknown>;
    placements[id] = {
      xPercent: clampOverlaySceneNumber(raw.xPercent, 0, 100, 0),
      yPercent: clampOverlaySceneNumber(raw.yPercent, 0, 100, 0),
      widthPercent: clampOverlaySceneNumber(raw.widthPercent, 10, 100, 40),
      heightPercent: clampOverlaySceneNumber(raw.heightPercent, 8, 100, 20),
      opacityPercent: clampOverlaySceneNumber(raw.opacityPercent, 5, 100, 100),
      allowOutsideSafeArea: raw.allowOutsideSafeArea === true
    };
  }

  return placements;
}

function sanitizeOverlaySceneUrl(value: unknown): string {
  const trimmed = String(value || "").trim();
  if (!trimmed) {
    return "";
  }

  if (trimmed.startsWith("/")) {
    return trimmed;
  }

  try {
    const url = new URL(trimmed);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}

function sanitizeOverlaySceneCustomFontFamily(value: unknown): string {
  const trimmed = String(value || "").trim();
  if (!trimmed) {
    return "";
  }

  if (/[;{}<>\\\n\r]/.test(trimmed) || /url\s*\(|@import/i.test(trimmed)) {
    return "";
  }

  const families = trimmed
    .split(",")
    .map((entry) => entry.trim().replace(/^['"]+|['"]+$/g, "").replace(/\s+/g, " "))
    .filter((entry) => entry.length > 0 && entry.length <= 48 && /^[a-z0-9 ._'-]+$/i.test(entry))
    .slice(0, 6);

  return families.join(", ").slice(0, 240);
}

function sanitizeOverlaySceneCustomLayerId(value: unknown, index: number): string {
  const cleaned = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return cleaned || `layer-${index + 1}`;
}

/**
 * The stored-video-source reference on a source layer. Same shape rule as layer ids, but empty
 * stays empty: an unlinked layer is a valid draft state, not something to invent an id for.
 */
function sanitizeOverlayVideoSourceId(value: unknown): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function isOverlaySceneCustomLayerKind(value: unknown): value is OverlaySceneCustomLayerKind {
  return OVERLAY_SCENE_CUSTOM_LAYER_KINDS.some((entry) => entry.id === value);
}

function normalizeOverlaySceneCustomTextTone(value: unknown): OverlaySceneCustomTextTone {
  return value === "body" || value === "caption" ? value : "headline";
}

function normalizeOverlaySceneCustomTextAlign(value: unknown): OverlaySceneCustomTextAlign {
  return value === "center" || value === "right" ? value : "left";
}

function normalizeOverlaySceneCustomMediaFit(value: unknown): OverlaySceneCustomMediaFit {
  return value === "cover" ? "cover" : "contain";
}

function getOverlayTypographyPresetFontStack(value: OverlayTypographyPreset): string {
  if (value === "editorial-serif") {
    return `"Iowan Old Style", "Palatino Linotype", "Book Antiqua", Georgia, serif`;
  }

  if (value === "signal-mono") {
    return `"IBM Plex Mono", ui-monospace, monospace`;
  }

  return `Inter, "Segoe UI", ui-sans-serif, system-ui, sans-serif`;
}

export function resolveOverlaySceneCustomTextFontStack(args: {
  fontMode: OverlaySceneCustomTextFontMode;
  customFontFamily?: string;
  typographyPreset: OverlayTypographyPreset;
}): string | null {
  if (args.fontMode === "preset") {
    return null;
  }

  if (args.fontMode === "safe-serif") {
    return getOverlayTypographyPresetFontStack("editorial-serif");
  }

  if (args.fontMode === "safe-mono") {
    return getOverlayTypographyPresetFontStack("signal-mono");
  }

  if (args.fontMode === "custom-local") {
    const sanitized = sanitizeOverlaySceneCustomFontFamily(args.customFontFamily);
    return sanitized ? `${sanitized}, ${getOverlayTypographyPresetFontStack(args.typographyPreset)}` : getOverlayTypographyPresetFontStack(args.typographyPreset);
  }

  return getOverlayTypographyPresetFontStack("studio-sans");
}

export function describeOverlaySceneFrameSupport(value: string): OverlaySceneFrameSupport {
  const normalized = sanitizeOverlaySceneUrl(value);
  if (!normalized) {
    return {
      providerLabel: "No source",
      status: "limited",
      badgeLabel: "Needs URL",
      guidance: "Enter a local path or https URL before Scene Studio can evaluate browser-frame support."
    };
  }

  const resolvedValue = normalized.startsWith("//") ? `https:${normalized}` : normalized;

  if (resolvedValue.startsWith("/") && !resolvedValue.startsWith("//")) {
    return {
      providerLabel: "Local overlay source",
      status: "supported",
      badgeLabel: "Self-hosted",
      guidance: "Local and same-origin browser frames are the most reliable Scene Studio embeds."
    };
  }

  try {
    const url = new URL(resolvedValue);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    const path = url.pathname.toLowerCase();

    if (["youtube.com", "m.youtube.com", "youtube-nocookie.com"].includes(host)) {
      if (path.startsWith("/embed/")) {
        return {
          providerLabel: "YouTube",
          status: "limited",
          badgeLabel: "Limited",
          guidance: "Dedicated YouTube embed endpoints may work, but provider iframe policies can still change. Validate the published overlay before relying on it."
        };
      }

      return {
        providerLabel: "YouTube",
        status: "unsupported",
        badgeLabel: "Unsupported",
        guidance: "YouTube pages are not a supported Scene Studio frame source. Use regular channel programming or a captured browser source instead."
      };
    }

    if (host === "player.twitch.tv") {
      return {
        providerLabel: "Twitch",
        status: "limited",
        badgeLabel: "Limited",
        guidance: "Dedicated Twitch player endpoints may work when their required parent-domain rules are satisfied. Validate the published overlay before relying on it."
      };
    }

    if (host.endsWith("twitch.tv")) {
      return {
        providerLabel: "Twitch",
        status: "unsupported",
        badgeLabel: "Unsupported",
        guidance: "Twitch pages and players are not a supported Scene Studio frame source here. Use Live Bridge or scheduled sources instead."
      };
    }

    if (host.endsWith("streamelements.com")) {
      return {
        providerLabel: "StreamElements",
        status: "limited",
        badgeLabel: "Limited",
        guidance: "Use the provider's dedicated embed endpoint when available. Third-party iframe or CSP rules can still block rendering."
      };
    }

    if (host.endsWith("streamlabs.com")) {
      return {
        providerLabel: "Streamlabs",
        status: "limited",
        badgeLabel: "Limited",
        guidance: "Only dedicated widget embed endpoints are expected to work, and third-party iframe policies can still block rendering."
      };
    }

    return {
      providerLabel: url.host,
      status: "limited",
      badgeLabel: "Limited",
      guidance: "Remote websites render only when their own iframe and CSP policies allow it. Validate each provider in the published overlay."
    };
  } catch {
    return {
      providerLabel: "Unknown source",
      status: "unsupported",
      badgeLabel: "Unsupported",
      guidance: "The frame URL is invalid or unsupported."
    };
  }
}

export function buildOverlaySceneMetadataWidgetContent(args: {
  payload: OverlayScenePayload;
  widgetDataKey: OverlaySceneCustomWidgetDataKey;
  labelOverride?: string;
}): OverlaySceneMetadataWidgetContent {
  const labelOverride = String(args.labelOverride || "").trim();

  if (args.widgetDataKey === "next") {
    return {
      label: labelOverride || args.payload.nextLabel || "Next",
      title: args.payload.nextTitle || "Nothing scheduled next",
      body: args.payload.nextTimeLabel || "Times to follow",
      secondary: args.payload.scheduleAux || ""
    };
  }

  if (args.widgetDataKey === "queue") {
    const queueTitle = args.payload.queueTitles[0] || args.payload.queueTitleLine || "Coming up shortly";
    return {
      label: labelOverride || "Later",
      title: queueTitle,
      body: args.payload.queueTitles.slice(1).join(" · ") || args.payload.scheduleAux || "More to follow",
      secondary: args.payload.queueTitleLine || ""
    };
  }

  return {
    label: labelOverride || args.payload.heroLabel || "Now Playing",
    title: args.payload.heroTitle || "On air",
    body: args.payload.metaLine || args.payload.heroBody || "Details to follow",
    secondary: args.payload.heroBody && args.payload.heroBody !== args.payload.metaLine ? args.payload.heroBody : ""
  };
}

export function normalizeOverlaySceneCustomLayers(value: unknown): OverlaySceneCustomLayer[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const seenIds = new Set<string>();
  const normalized: OverlaySceneCustomLayer[] = [];

  for (const [index, entry] of value.entries()) {
    if (!entry || typeof entry !== "object") {
      continue;
    }

    const raw = entry as Record<string, unknown>;
    if (!isOverlaySceneCustomLayerKind(raw.kind)) {
      continue;
    }

    const id = sanitizeOverlaySceneCustomLayerId(raw.id, index);
    if (seenIds.has(id)) {
      continue;
    }
    seenIds.add(id);

    const base = {
      id,
      kind: raw.kind,
      name: sanitizeTextValue(raw.name, 80) || `${raw.kind[0].toUpperCase()}${raw.kind.slice(1)} Layer`,
      enabled: raw.enabled !== false,
      // 0 to 100, the same range the built-in panels take. A small layer anchored to the far edge
      // needs a position past 90 to be there at all; what keeps a box on the frame is
      // resolvePlacementBox clamping its width against the room x leaves.
      xPercent: clampOverlaySceneNumber(raw.xPercent, 0, 100, raw.kind === "text" ? 4 : 62),
      yPercent: clampOverlaySceneNumber(raw.yPercent, 0, 100, raw.kind === "text" ? 10 : 8),
      widthPercent: clampOverlaySceneNumber(raw.widthPercent, 10, 100, raw.kind === "text" ? 34 : 26),
      heightPercent: clampOverlaySceneNumber(raw.heightPercent, 8, 100, raw.kind === "text" ? 18 : 20),
      opacityPercent: clampOverlaySceneNumber(raw.opacityPercent, 5, 100, 100),
      allowOutsideSafeArea: raw.allowOutsideSafeArea === true
    } satisfies OverlaySceneCustomLayerBase;

    if (raw.kind === "text") {
      normalized.push({
        ...base,
        kind: "text",
        text: sanitizeTextValue(raw.text, 180),
        secondaryText: sanitizeTextValue(raw.secondaryText, 220),
        textTone: normalizeOverlaySceneCustomTextTone(raw.textTone),
        textAlign: normalizeOverlaySceneCustomTextAlign(raw.textAlign),
        useAccent: raw.useAccent === true,
        fontMode: normalizeOverlaySceneCustomTextFontMode(raw.fontMode),
        customFontFamily: sanitizeOverlaySceneCustomFontFamily(raw.customFontFamily)
      });
    } else if (raw.kind === "logo" || raw.kind === "image") {
      normalized.push({
        ...base,
        kind: raw.kind,
        url: sanitizeOverlaySceneUrl(raw.url),
        altText: sanitizeTextValue(raw.altText, 120),
        fit: normalizeOverlaySceneCustomMediaFit(raw.fit)
      });
    } else if (raw.kind === "widget") {
      normalized.push({
        ...base,
        kind: "widget",
        url: sanitizeOverlaySceneUrl(raw.url),
        title: sanitizeTextValue(raw.title, 80),
        widgetMode: normalizeOverlaySceneCustomWidgetMode(raw.widgetMode),
        widgetDataKey: normalizeOverlaySceneCustomWidgetDataKey(raw.widgetDataKey)
      });
    } else if (raw.kind === "game") {
      // Placement only: everything about the game itself lives in the chat-game settings.
      // The backdrop floor is 0, not the 5 every other opacity uses — the point of the control is
      // that the fill can go away completely, and the outlined board is what stays legible.
      normalized.push({
        ...base,
        kind: "game",
        backgroundOpacityPercent: clampOverlaySceneNumber(raw.backgroundOpacityPercent, 0, 100, 100)
      });
    } else if (raw.kind === "source") {
      // Placement plus a reference into the encrypted video-source store. Deliberately no URL
      // field: whatever a caller sends beyond the id is dropped here, so a feed address (which
      // may embed credentials) can never ride into the scene payload.
      normalized.push({
        ...base,
        kind: "source",
        sourceId: sanitizeOverlayVideoSourceId((raw as { sourceId?: unknown }).sourceId)
      });
    } else {
      normalized.push({
        ...base,
        kind: "embed",
        url: sanitizeOverlaySceneUrl(raw.url),
        title: sanitizeTextValue(raw.title, 80) || "Embed Layer"
      });
    }

    if (normalized.length >= maxOverlaySceneCustomLayers) {
      break;
    }
  }

  return normalized;
}

// ---------------------------------------------------------------------------
// Named overlay scenes (M58)
// ---------------------------------------------------------------------------

/**
 * One named scene: a name, its own set of custom layers, and — optionally — the video source the
 * scene is about.
 *
 * The layer shape is deliberately the existing `customLayers` one, unchanged. A scene is not a new
 * kind of drawing; it is a name put on a layer set the renderer already knows how to draw, so
 * everything downstream of `resolveOverlayNamedSceneCustomLayers` stays exactly as it was.
 */
export type OverlayNamedScene = {
  id: string;
  name: string;
  customLayers: OverlaySceneCustomLayer[];
  /**
   * The stored video source (M57) this scene is about, or "" when the scene is not bound to one.
   *
   * It is a DEFAULT for the scene's source layers, not a second place a source can be switched on:
   * a `source` layer that names no source of its own inherits this id. That is what makes
   * duplicating a scene and pointing the copy at another camera one edit instead of one per layer.
   * A binding naming a source that no longer exists needs no special handling — it resolves into
   * the layer exactly like a hand-typed id would, and the worker already answers an unresolvable
   * source with the still picture (attach-unavailable).
   */
  sourceId: string;
};

/** Enough scenes for a show; few enough that the picker stays a list an operator can read. */
export const MAX_NAMED_OVERLAY_SCENES = 12;

/**
 * The id and name given to the scene an upgrade creates out of an existing layer set.
 *
 * Fixed rather than generated on purpose: the live row and the draft row are seeded independently
 * (by the migration, and by the normaliser on read), and a random id would make the two differ and
 * the studio report unpublished changes that nobody made.
 */
export const DEFAULT_NAMED_OVERLAY_SCENE_ID = "scene-main";
export const DEFAULT_NAMED_OVERLAY_SCENE_NAME = "Main scene";

function sanitizeOverlayNamedSceneId(value: unknown): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

/**
 * The stored scene list, made safe to render.
 *
 * Never returns an empty list: something has to be on air. When nothing usable was stored, the
 * caller's existing single layer set becomes the one scene, which is the entire upgrade path for an
 * installation that predates this feature — no migration data is needed for the picture to stay the
 * same, the migration only makes the same answer durable.
 */
export function normalizeOverlayNamedScenes(value: unknown, fallbackLayers: unknown): OverlayNamedScene[] {
  const scenes: OverlayNamedScene[] = [];
  const seenIds = new Set<string>();

  if (Array.isArray(value)) {
    for (const entry of value) {
      if (!entry || typeof entry !== "object") {
        continue;
      }

      const raw = entry as Partial<OverlayNamedScene>;
      const id = sanitizeOverlayNamedSceneId(raw.id);
      if (!id || seenIds.has(id)) {
        continue;
      }
      seenIds.add(id);

      scenes.push({
        id,
        name: sanitizeTextValue(raw.name, 60) || `Scene ${String(scenes.length + 1)}`,
        customLayers: normalizeOverlaySceneCustomLayers(raw.customLayers),
        sourceId: sanitizeOverlayVideoSourceId(raw.sourceId)
      });

      if (scenes.length >= MAX_NAMED_OVERLAY_SCENES) {
        break;
      }
    }
  }

  if (scenes.length > 0) {
    return scenes;
  }

  return [
    {
      id: DEFAULT_NAMED_OVERLAY_SCENE_ID,
      name: DEFAULT_NAMED_OVERLAY_SCENE_NAME,
      customLayers: normalizeOverlaySceneCustomLayers(fallbackLayers),
      sourceId: ""
    }
  ];
}

/**
 * Which scene is on air.
 *
 * An id that names no scene — deleted while it was active, or written by a newer studio — resolves
 * to the first scene rather than to nothing: a channel with the overlay switched on must always
 * have a picture, and "the first scene" is the only answer that needs no operator present to pick.
 */
export function resolveActiveOverlayNamedSceneId(scenes: OverlayNamedScene[], activeSceneId: unknown): string {
  const wanted = sanitizeOverlayNamedSceneId(activeSceneId);
  const match = scenes.find((scene) => scene.id === wanted);
  return match ? match.id : scenes[0]?.id || "";
}

/**
 * The layer set the renderer actually draws: the active scene's layers, with the scene's bound
 * source filled into any source layer that names none.
 *
 * This is the single point where scenes touch the broadcast picture. Everything below it —
 * buildOverlaySceneDefinition, the on-air rasteriser, the studio preview — keeps reading one flat
 * `customLayers` array and cannot tell that scenes exist.
 */
/**
 * Puts a caller's layer array into the active scene instead of throwing it away.
 *
 * `customLayers` is a projection of the active scene, and every writer that predates named scenes
 * edits that array without knowing scenes exist — the chat game's own layer provisioning does it
 * through updateAppState. Re-projecting on write discarded those edits inside the same
 * transaction: a moderator's `!snake` wrote a layer that vanished before it reached the picture.
 * Reading projects; writing folds. Scenes other than the active one are never touched, and a
 * caller that hands over nothing changes nothing.
 */
export function foldCustomLayersIntoActiveScene(
  scenes: OverlayNamedScene[],
  activeSceneId: unknown,
  customLayers: unknown
): OverlayNamedScene[] {
  if (customLayers === undefined || customLayers === null) {
    return scenes;
  }

  const activeId = resolveActiveOverlayNamedSceneId(scenes, activeSceneId);
  const active = scenes.find((scene) => scene.id === activeId);
  if (!active) {
    return scenes;
  }

  const stored = new Map(active.customLayers.map((layer) => [layer.id, layer]));
  const next = normalizeOverlaySceneCustomLayers(customLayers).map((layer) => {
    // A layer that inherits the scene's source arrives from the projection carrying that source.
    // Folding it back verbatim would freeze the inheritance, so a scene pointed at another camera
    // would stop moving its layers. Restore the empty id the scene actually stores.
    const before = stored.get(layer.id);
    if (
      active.sourceId &&
      before &&
      "sourceId" in before &&
      "sourceId" in layer &&
      before.sourceId === "" &&
      layer.sourceId === active.sourceId
    ) {
      return { ...layer, sourceId: "" };
    }
    return layer;
  });

  return scenes.map((scene) => (scene.id === activeId ? { ...scene, customLayers: next } : scene));
}

export function resolveOverlayNamedSceneCustomLayers(
  scenes: OverlayNamedScene[],
  activeSceneId: unknown
): OverlaySceneCustomLayer[] {
  const activeId = resolveActiveOverlayNamedSceneId(scenes, activeSceneId);
  const scene = scenes.find((entry) => entry.id === activeId);
  if (!scene) {
    return [];
  }

  if (!scene.sourceId) {
    return scene.customLayers;
  }

  return scene.customLayers.map((layer) =>
    layer.kind === "source" && !layer.sourceId ? { ...layer, sourceId: scene.sourceId } : layer
  );
}

export function resolveOverlayScenePresetForQueueKind(
  scenePreset: OverlayScenePreset,
  queueKind: OverlayQueueKind,
  overrides?: Partial<Pick<OverlaySceneSource, "insertScenePreset" | "standbyScenePreset" | "reconnectScenePreset">>
): OverlayScenePreset {
  if (queueKind === "insert") {
    return normalizeOverlayScenePreset(overrides?.insertScenePreset || "bumper-board");
  }

  if (queueKind === "reconnect") {
    return normalizeOverlayScenePreset(overrides?.reconnectScenePreset || "reconnect-board");
  }

  if (queueKind === "standby") {
    return normalizeOverlayScenePreset(overrides?.standbyScenePreset || "standby-board");
  }

  return scenePreset;
}

export function buildOverlayBrandLine(replayLabel: string, brandBadge = "", locale?: string): string {
  const parts = [
    localizeViewerBuiltInText(locale, normalizeOverlayVisibleText(replayLabel)) || viewerText(locale, "overlay.brand.replayLabel"),
    normalizeOverlayVisibleText(brandBadge)
  ].filter(Boolean);
  return parts.join(" · ");
}

/**
 * The sentence under the title, by what is on air. An operator's own headline is drawn verbatim;
 * an empty one, or one still equal to its built-in English default, is the catalogue's in the
 * channel language (M80: stored defaults are "not customised", see localizeViewerBuiltInText).
 */
export function resolveOverlayHeadlineForQueueKind(
  headline: string,
  queueKind: OverlayQueueKind,
  overrides?: Partial<Pick<OverlaySceneSource, "insertHeadline" | "standbyHeadline" | "reconnectHeadline">>,
  locale?: string
): string {
  const resolve = (value: string | undefined, fallbackKey: ViewerMessageKey) => {
    const written = sanitizeTextValue(value || "", 120);
    return written ? localizeViewerBuiltInText(locale, written) : viewerText(locale, fallbackKey);
  };

  if (queueKind === "insert") {
    return resolve(overrides?.insertHeadline, "overlay.headline.insert");
  }

  if (queueKind === "reconnect") {
    return resolve(overrides?.reconnectHeadline, "overlay.headline.reconnect");
  }

  if (queueKind === "standby") {
    return resolve(overrides?.standbyHeadline || headline, "overlay.headline.standby");
  }

  return resolve(headline, "overlay.headline.asset");
}

function normalizeOverlayVisibleText(value: unknown): string {
  const trimmed = stripInvisibleCharacters(String(value ?? "")).trim();
  return trimmed && trimmed !== "[]" ? trimmed : "";
}

export function buildOverlaySceneDefinition(args: {
  overlay: OverlaySceneSource;
  queueKind: OverlayQueueKind;
}): OverlaySceneDefinition {
  const resolvedPresetId = resolveOverlayScenePresetForQueueKind(args.overlay.scenePreset, args.queueKind, {
    insertScenePreset: args.overlay.insertScenePreset,
    standbyScenePreset: args.overlay.standbyScenePreset,
    reconnectScenePreset: args.overlay.reconnectScenePreset
  });
  const normalizedLayerOrder = normalizeOverlaySceneLayerOrder(args.overlay.layerOrder);
  const disabledLayersSource = Array.isArray(args.overlay.disabledLayers) ? args.overlay.disabledLayers : [];
  const disabledLayers = new Set(
    normalizeOverlaySceneLayerOrder(disabledLayersSource).filter((kind) => disabledLayersSource.includes(kind))
  );
  const enabledMap: Record<OverlaySceneLayerKind, boolean> = {
    chip: true,
    hero: true,
    next: args.overlay.showNextItem,
    queue: args.overlay.showQueuePreview,
    schedule: args.overlay.showScheduleTeaser,
    clock: args.overlay.showClock,
    banner: Boolean(normalizeOverlayVisibleText(args.overlay.emergencyBanner)),
    ticker: Boolean(normalizeOverlayVisibleText(args.overlay.tickerText))
  };

  return {
    presetId: args.overlay.scenePreset,
    resolvedPresetId,
    surfaceStyle: args.overlay.surfaceStyle,
    panelAnchor: args.overlay.panelAnchor,
    titleScale: args.overlay.titleScale,
    typographyPreset: normalizeOverlayTypographyPreset(args.overlay.typographyPreset),
    layers: normalizedLayerOrder.map((kind) => ({
      kind,
      label: OVERLAY_SCENE_LAYERS.find((layer) => layer.id === kind)?.label || kind,
      enabled: enabledMap[kind] && !disabledLayers.has(kind)
    })),
    customLayers: normalizeOverlaySceneCustomLayers(args.overlay.customLayers),
    panelPlacements: normalizeOverlayScenePanelPlacements(args.overlay.panelPlacements)
  };
}

export function buildOverlayScenePayload(args: {
  overlay: OverlaySceneSource & {
    channelName: string;
    replayLabel: string;
    brandBadge: string;
    accentColor: string;
  };
  queueKind: OverlayQueueKind;
  target: OverlaySceneRenderTarget;
  currentTitle: string;
  currentCategory?: string;
  currentSourceName?: string;
  nextTitle: string;
  nextTimeLabel?: string;
  queueTitles?: string[];
  modeSubtitle?: string;
  timeZone?: string;
  /** The channel language; anything but a language this build speaks is English. */
  locale?: string;
}): OverlayScenePayload {
  const locale = normalizeViewerLocale(args.locale);
  const scene = buildOverlaySceneDefinition({
    overlay: args.overlay,
    queueKind: args.queueKind
  });
  const heroLabel = viewerText(
    locale,
    args.queueKind === "insert"
      ? "overlay.heroLabel.insert"
      : args.queueKind === "live"
        ? "overlay.heroLabel.live"
      : args.queueKind === "reconnect"
        ? "overlay.heroLabel.reconnect"
        : args.queueKind === "standby"
          ? "overlay.heroLabel.standby"
          : "overlay.heroLabel.asset"
  );
  const heroBody =
    localizeViewerBuiltInText(locale, args.modeSubtitle || "") ||
    resolveOverlayHeadlineForQueueKind(
      args.overlay.headline,
      args.queueKind,
      {
        insertHeadline: args.overlay.insertHeadline,
        standbyHeadline: args.overlay.standbyHeadline,
        reconnectHeadline: args.overlay.reconnectHeadline
      },
      locale
    );
  const nextLabel = viewerText(
    locale,
    args.queueKind === "insert"
      ? "overlay.nextLabel.insert"
      : args.queueKind === "reconnect"
        ? "overlay.nextLabel.reconnect"
        : args.queueKind === "live"
          ? "overlay.nextLabel.live"
          : "overlay.nextLabel.asset"
  );
  // Titles pass through the built-in rule as well: the worker and the studio name a standby, a
  // reconnect or an unnamed live bridge in English in state ("Replay standby"), because the admin and
  // the as-run log read them there, and the viewer edge is where they become the channel language.
  // The source name too: the local library is "Local Media Library" in the sources table whatever
  // the channel speaks, and the meta line shows it.
  const viewerTitle = (value: unknown) => localizeViewerBuiltInText(locale, normalizeOverlayVisibleText(value));
  const currentTitle = viewerTitle(args.currentTitle);
  const currentCategory = viewerTitle(args.currentCategory);
  const currentSourceName = viewerTitle(args.currentSourceName);
  const nextTitle = viewerTitle(args.nextTitle);
  const channelName = viewerTitle(args.overlay.channelName) || viewerText(locale, "overlay.brand.channelName");
  const queueTitles = (args.queueTitles || [])
    .map((title) => viewerTitle(title))
    .filter(Boolean)
    .slice(0, args.overlay.queuePreviewCount);
  const metaLine = [
    (args.queueKind === "asset" || args.queueKind === "live") && args.overlay.showCurrentCategory ? currentCategory : "",
    (args.queueKind === "asset" || args.queueKind === "live") && args.overlay.showSourceLabel ? currentSourceName : ""
  ]
    .filter(Boolean)
    .join(" · ");
  const scheduleBody =
    args.queueKind === "asset"
      ? currentCategory || "Always on air"
      : args.queueKind === "live"
        ? heroBody || "Live bridge is on air."
        : heroBody || "Programming will resume shortly";
  const scheduleAux =
    args.queueKind === "asset"
      ? currentSourceName || "Source to be announced"
      : args.queueKind === "live"
        ? nextTitle || "Schedule resumes after live mode"
      : nextTitle || "Programming will resume shortly";

  return {
    target: args.target,
    queueKind: args.queueKind,
    scene,
    channelName,
    accentColor: args.overlay.accentColor,
    brandLine: buildOverlayBrandLine(args.overlay.replayLabel, args.overlay.brandBadge, locale),
    heroLabel,
    heroTitle: currentTitle || viewerText(locale, "overlay.brand.channelName"),
    heroBody,
    metaLine,
    nextLabel,
    nextTitle: nextTitle || viewerText(locale, "overlay.next.noTitle"),
    nextTimeLabel: normalizeOverlayVisibleText(args.nextTimeLabel) || viewerText(locale, "overlay.next.noBlock"),
    queueTitleLine: queueTitles.join(" · "),
    queueTitles,
    scheduleLabel: "Scene",
    scheduleTitle: currentTitle || "Stand by",
    scheduleBody,
    scheduleAux,
    tickerText: normalizeOverlayVisibleText(args.overlay.tickerText),
    tickerRotateSeconds: args.overlay.tickerRotateSeconds,
    emergencyBanner: normalizeOverlayVisibleText(args.overlay.emergencyBanner),
    timeZone: args.timeZone || "UTC",
    locale
  };
}

/**
 * The scene as lines of text, for ffmpeg's drawtext: the on-air text mode, the standby slate, and
 * the fallback when the scene picture fails. Written in the payload's language like the picture.
 */
export function buildOverlayTextLinesFromScenePayload(payload: OverlayScenePayload): string[] {
  const locale = payload.locale;
  const brandLine = normalizeOverlayVisibleText(payload.brandLine);
  const heroTitle = normalizeOverlayVisibleText(payload.heroTitle);
  const heroBody = normalizeOverlayVisibleText(payload.heroBody);
  const metaLine = normalizeOverlayVisibleText(payload.metaLine);
  const nextTitle = normalizeOverlayVisibleText(payload.nextTitle);
  const queueTitleLine = normalizeOverlayVisibleText(payload.queueTitleLine);
  const tickerLine = normalizeOverlayVisibleText(payload.tickerText);
  const line = (key: ViewerMessageKey, value: string, placeholder: "title" | "titles" = "title") =>
    value ? viewerText(locale, key, { [placeholder]: value }) : "";

  if (payload.scene.resolvedPresetId === "minimal-chip") {
    return [brandLine, line("textMode.now", heroTitle), metaLine, tickerLine].filter(Boolean);
  }

  if (payload.scene.resolvedPresetId === "bumper-board") {
    return [
      brandLine,
      heroBody || viewerText(locale, "overlay.headline.insert"),
      line("textMode.insert", heroTitle),
      line("textMode.next", nextTitle),
      line("textMode.afterThis", queueTitleLine, "titles"),
      tickerLine
    ].filter(Boolean);
  }

  if (payload.scene.resolvedPresetId === "reconnect-board") {
    return [
      brandLine,
      heroBody || viewerText(locale, "overlay.headline.reconnect"),
      line("textMode.resumingWith", nextTitle),
      line("textMode.queue", queueTitleLine, "titles"),
      tickerLine
    ].filter(Boolean);
  }

  if (payload.scene.resolvedPresetId === "split-now-next") {
    return [brandLine, line("textMode.now", heroTitle), line("textMode.next", nextTitle), metaLine, tickerLine].filter(Boolean);
  }

  if (payload.scene.resolvedPresetId === "standby-board") {
    return [
      brandLine,
      heroBody || viewerText(locale, "overlay.headline.standby"),
      line("textMode.current", heroTitle),
      line("textMode.next", nextTitle),
      line("textMode.later", queueTitleLine, "titles"),
      tickerLine
    ].filter(Boolean);
  }

  return [
    brandLine,
    line("textMode.now", heroTitle),
    metaLine,
    line("textMode.next", nextTitle),
    line("textMode.queue", queueTitleLine, "titles"),
    payload.queueKind === "standby" ? heroBody || viewerText(locale, "overlay.headline.standby") : "",
    tickerLine
  ].filter(Boolean);
}

export function buildOverlayTextLines(args: {
  scenePreset: OverlayScenePreset;
  replayLabel: string;
  brandBadge?: string;
  headline: string;
  nowTitle: string;
  nextTitle: string;
  currentCategory?: string;
  sourceName?: string;
  queueTitles?: string[];
  tickerText?: string;
  standby?: boolean;
  showCurrentCategory?: boolean;
  showSourceLabel?: boolean;
  showQueuePreview?: boolean;
  locale?: string;
}): string[] {
  return buildOverlayTextLinesFromScenePayload(
    buildOverlayScenePayload({
      overlay: {
        channelName: "Stream247",
        replayLabel: args.replayLabel,
        brandBadge: args.brandBadge || "",
        accentColor: "#0e6d5a",
        scenePreset: args.scenePreset,
        insertScenePreset: "bumper-board",
        standbyScenePreset: "standby-board",
        reconnectScenePreset: "reconnect-board",
        headline: args.headline,
        insertHeadline: args.headline,
        standbyHeadline: args.headline,
        reconnectHeadline: args.headline,
        surfaceStyle: "glass",
        panelAnchor: "bottom",
        titleScale: "balanced",
        typographyPreset: "studio-sans",
        showClock: true,
        showNextItem: true,
        showScheduleTeaser: true,
        showQueuePreview: args.showQueuePreview ?? false,
        queuePreviewCount: Math.max((args.queueTitles || []).length, 1),
        emergencyBanner: "",
        tickerText: args.tickerText || "",
        tickerRotateSeconds: OVERLAY_TICKER_DEFAULT_SECONDS,
        layerOrder: DEFAULT_OVERLAY_SCENE_LAYER_ORDER,
        disabledLayers: [],
        customLayers: [],
        panelPlacements: {},
        showCurrentCategory: args.showCurrentCategory ?? false,
        showSourceLabel: args.showSourceLabel ?? false
      },
      queueKind:
        args.scenePreset === "bumper-board"
          ? "insert"
          : args.scenePreset === "reconnect-board"
            ? "reconnect"
            : args.standby
              ? "standby"
              : "asset",
      target: "on-air-text",
      currentTitle: args.nowTitle,
      currentCategory: args.currentCategory,
      currentSourceName: args.sourceName,
      nextTitle: args.nextTitle,
      queueTitles: args.queueTitles,
      modeSubtitle: args.headline,
      locale: args.locale
    })
  );
}

export function isLikelyYouTubePlaylistUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return (
      ["youtube.com", "www.youtube.com", "music.youtube.com", "m.youtube.com"].includes(host) &&
      url.searchParams.has("list")
    );
  } catch {
    return false;
  }
}

export function isLikelyYouTubeChannelUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (!["youtube.com", "www.youtube.com", "m.youtube.com"].includes(host)) {
      return false;
    }

    const pathname = url.pathname.replace(/\/+$/, "");
    return (
      /^\/@[^/]+(?:\/(featured|videos|streams|shorts|playlists|community|about))?$/.test(pathname) ||
      /^\/(?:channel|c|user)\/[^/]+(?:\/(featured|videos|streams|shorts|playlists|community|about))?$/.test(pathname)
    );
  } catch {
    return false;
  }
}

export function isLikelyTwitchVodUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return (host === "twitch.tv" || host === "www.twitch.tv") && /\/videos\/\d+/.test(url.pathname);
  } catch {
    return false;
  }
}

export function isLikelyTwitchChannelUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (!(host === "twitch.tv" || host === "www.twitch.tv")) {
      return false;
    }

    return /^\/[a-zA-Z0-9_]+$/.test(url.pathname);
  } catch {
    return false;
  }
}

function padTwo(value: number): string {
  return String(value).padStart(2, "0");
}

export function formatMinuteOfDay(value: number): string {
  const normalized = ((Math.trunc(value) % (24 * 60)) + 24 * 60) % (24 * 60);
  return `${padTwo(Math.floor(normalized / 60))}:${padTwo(normalized % 60)}`;
}

export function addDaysToDateString(value: string, days: number): string {
  const base = new Date(`${value}T00:00:00.000Z`);
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

export function getRepeatDaysForMode(mode: ScheduleRepeatMode, anchorDayOfWeek = 1, customDays: number[] = []): number[] {
  switch (normalizeScheduleRepeatMode(mode)) {
    case "daily":
      return [0, 1, 2, 3, 4, 5, 6];
    case "weekdays":
      return [1, 2, 3, 4, 5];
    case "weekends":
      return [0, 6];
    case "custom":
      return [...new Set(customDays.filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))].sort(
        (left, right) => left - right
      );
    case "single":
    default:
      return [Math.max(0, Math.min(6, Math.trunc(anchorDayOfWeek)))];
  }
}

export function describeScheduleRepeatMode(mode: ScheduleRepeatMode, anchorDayOfWeek = 1): string {
  switch (normalizeScheduleRepeatMode(mode)) {
    case "daily":
      return "Daily";
    case "weekdays":
      return "Weekdays";
    case "weekends":
      return "Weekends";
    case "custom":
      return "Custom days";
    case "single":
    default:
      return dayLabels[Math.max(0, Math.min(6, Math.trunc(anchorDayOfWeek)))] || "One weekday, every week";
  }
}

export function parseTimeOfDay(value: string): number | null {
  const match = value.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) {
    return null;
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return null;
  }

  return hours * 60 + minutes;
}

function extractZonedParts(args: { now: Date; timeZone: string }) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: args.timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  });

  const parts = formatter.formatToParts(args.now);
  const year = parts.find((part) => part.type === "year")?.value ?? "1970";
  const month = parts.find((part) => part.type === "month")?.value ?? "01";
  const day = parts.find((part) => part.type === "day")?.value ?? "01";
  const hour = parts.find((part) => part.type === "hour")?.value ?? "00";
  const minute = parts.find((part) => part.type === "minute")?.value ?? "00";

  return {
    date: `${year}-${month}-${day}`,
    time: `${hour}:${minute}`
  };
}

export function createDefaultModerationConfig(): ModerationConfig {
  return {
    enabled: true,
    command: "here",
    defaultMinutes: 30,
    minMinutes: 5,
    maxMinutes: 240,
    requirePrefix: false,
    fallbackEmoteOnly: true
  };
}

export function parseModeratorCheckIn(args: {
  actor: string;
  input: string;
  now: Date;
  config: ModerationConfig;
}): PresenceWindow | null {
  const result = resolveModeratorCheckIn(args);

  if (!result) {
    return null;
  }

  return {
    actor: result.actor,
    minutes: result.minutes,
    createdAt: result.createdAt,
    expiresAt: result.expiresAt
  };
}

export function resolveModeratorCheckIn(args: {
  actor: string;
  input: string;
  now: Date;
  config: ModerationConfig;
}): ModeratorCheckInResult | null {
  const { actor, input, now, config } = args;

  if (!config.enabled) {
    return null;
  }

  // requirePrefix false means the "!" is optional, not forbidden: the spec and the check-in form
  // both say "!here 5", and a default install that silently ignored exactly that command looked
  // like the feature not existing.
  const prefix = config.requirePrefix ? "!" : "!?";
  // config.command is operator-supplied. Interpolated raw, a value containing "(" or "[" made
  // `new RegExp` throw inside the IRC message handler and take the worker process down with it.
  const match = input.trim().match(new RegExp(`^${prefix}${escapeRegExp(config.command)}(?:\\s+(\\d+))?$`, "i"));

  if (!match) {
    return null;
  }

  const requestedMinutes = match[1] ? Number(match[1]) : null;
  const rawMinutes = requestedMinutes ?? config.defaultMinutes;

  if (!Number.isFinite(rawMinutes)) {
    return null;
  }

  const minutes = Math.min(config.maxMinutes, Math.max(config.minMinutes, rawMinutes));
  const clampReason: PresenceClampReason =
    requestedMinutes === null
      ? "default"
      : requestedMinutes < config.minMinutes
        ? "minimum"
        : requestedMinutes > config.maxMinutes
          ? "maximum"
          : "accepted";

  return {
    actor,
    minutes,
    appliedMinutes: minutes,
    requestedMinutes,
    clampReason,
    commandInput: input.trim(),
    createdAt: now,
    expiresAt: new Date(now.getTime() + minutes * 60_000)
  };
}

/**
 * What the bot answers a moderator's check-in, in the channel language. The admin's check-in API
 * answers with the same sentence and leaves the locale out, so the admin reads English (M81).
 */
export function formatPresenceClampReply(args: {
  commandInput: string;
  appliedMinutes: number;
  requestedMinutes: number | null;
  clampReason: PresenceClampReason;
  config: Pick<ModerationConfig, "defaultMinutes" | "minMinutes" | "maxMinutes">;
  locale?: string;
}): string {
  const input = stripInvisibleCharacters(args.commandInput).trim();
  const minutes = args.appliedMinutes;

  if (args.clampReason === "minimum") {
    return viewerText(args.locale, "chat.presence.minimum", { input, limit: args.config.minMinutes, minutes });
  }

  if (args.clampReason === "maximum") {
    return viewerText(args.locale, "chat.presence.maximum", { input, limit: args.config.maxMinutes, minutes });
  }

  if (args.clampReason === "default") {
    return viewerText(args.locale, "chat.presence.default", { input, limit: args.config.defaultMinutes, minutes });
  }

  return viewerText(args.locale, "chat.presence.accepted", { minutes });
}

export function describePresenceStatus(args: {
  activeWindows: PresenceWindow[];
  now: Date;
  fallbackEmoteOnly: boolean;
  /** The moderation policy's own switch. Off means Stream247 does not manage the chat mode. */
  enabled?: boolean;
}): PresenceStatus {
  if (args.enabled === false) {
    return {
      active: false,
      chatMode: "normal",
      summary: "Moderator presence policy is off; Stream247 leaves the chat mode alone."
    };
  }

  const activeWindows = args.activeWindows.filter((window) => window.expiresAt > args.now);

  if (activeWindows.length > 0) {
    const latestExpiry = activeWindows
      .map((window) => window.expiresAt.toISOString())
      .sort()
      .at(-1);

    return {
      active: true,
      chatMode: "normal",
      summary: `Moderator coverage active until ${latestExpiry}.`
    };
  }

  return {
    active: false,
    chatMode: args.fallbackEmoteOnly ? "emote-only" : "normal",
    summary: args.fallbackEmoteOnly
      ? "No moderator presence window is active. Emote-only fallback should be enabled."
      : "No moderator presence window is active."
  };
}

/**
 * Whether this cycle should PATCH Twitch's chat settings at all.
 *
 * The write used to happen on every reconcile — every 30 s — with no memory of what it last
 * wrote and no regard for the policy switch. Now: a switched-off policy never writes, so a
 * moderator's hand change on Twitch stands; an unchanged mode is not rewritten inside the
 * re-assert interval; and after that interval it is written once more, so a hand change does
 * not silently become permanent while the policy is on.
 */
export function resolveChatSettingsWrite(args: {
  moderationEnabled: boolean;
  desiredEmoteOnly: boolean;
  lastWrittenEmoteOnly: boolean | null;
  lastWriteAtMs: number;
  nowMs: number;
  reassertIntervalMs: number;
}): { write: boolean; reason: "policy-off" | "first" | "changed" | "unchanged" | "reassert" } {
  if (!args.moderationEnabled) {
    return { write: false, reason: "policy-off" };
  }
  if (args.lastWrittenEmoteOnly === null) {
    return { write: true, reason: "first" };
  }
  if (args.lastWrittenEmoteOnly !== args.desiredEmoteOnly) {
    return { write: true, reason: "changed" };
  }
  if (args.nowMs - args.lastWriteAtMs > args.reassertIntervalMs) {
    return { write: true, reason: "reassert" };
  }
  return { write: false, reason: "unchanged" };
}

export function buildSchedulePreview(args: {
  date: string;
  blocks: ScheduleBlock[];
  pools?: SchedulePreviewPoolRecord[];
  assets?: SchedulePreviewAssetRecord[];
  maxVideoSlotsPerBlock?: number;
  sourceGate?: PoolRotationSourceGate | null;
}): SchedulePreview {
  const items = buildScheduleOccurrences(args).map((occurrence) => {
    const pool = args.pools?.find((entry) => entry.id === occurrence.poolId) ?? null;

    return {
      id: occurrence.blockId,
      title: occurrence.title,
      startTime: occurrence.startTime,
      endTime: occurrence.endTime,
      durationMinutes: occurrence.durationMinutes,
      categoryName: occurrence.categoryName,
      dayOfWeek: occurrence.dayOfWeek,
      poolId: occurrence.poolId,
      showId: occurrence.showId,
      sourceName: occurrence.sourceName,
      repeatMode: occurrence.repeatMode,
      reason: `Selected from ${occurrence.sourceName} for ${occurrence.durationMinutes} minutes · ${describeScheduleRepeatMode(occurrence.repeatMode ?? "single", occurrence.dayOfWeek)}.`,
      videoSlots: buildSchedulePreviewVideoSlots({
        block: occurrence,
        pool,
        assets: args.assets ?? [],
        maxSlots: args.maxVideoSlotsPerBlock ?? 20,
        sourceGate: args.sourceGate
      })
    };
  });

  return { date: args.date, items };
}

function buildSchedulePreviewAssetTitle(asset: Pick<SchedulePreviewAssetRecord, "title" | "titlePrefix">): string {
  return [stripInvisibleCharacters(asset.titlePrefix || "").trim(), stripInvisibleCharacters(asset.title).trim()]
    .filter(Boolean)
    .join(" ");
}

function getSchedulePreviewAssetDurationSeconds(asset: SchedulePreviewAssetRecord): {
  durationSeconds: number;
  estimated: boolean;
} {
  if (typeof asset.durationSeconds === "number" && asset.durationSeconds > 0) {
    return {
      durationSeconds: asset.durationSeconds,
      estimated: false
    };
  }

  return {
    durationSeconds: estimatedProgrammingDurationSeconds,
    estimated: true
  };
}

// What the preview may pick, the worker's own rules minus what only the worker knows (the skip hold and
// the VOD-cache cooldown). The insert asset leaves the rotation only while it is actually inserted
// (`insertEveryItems > 0`), as in the worker and the pool form's own help text; until M73 the preview
// dropped it whenever it was set, so a pool with the cadence at 0 showed one item fewer than it played.
function isSchedulePreviewAssetEligible(pool: SchedulePreviewPoolRecord, asset: SchedulePreviewAssetRecord): boolean {
  if (pool.insertAssetId && Math.max(pool.insertEveryItems ?? 0, 0) > 0 && asset.id === pool.insertAssetId) {
    return false;
  }
  if (pool.audioLaneAssetId && asset.id === pool.audioLaneAssetId) {
    return false;
  }
  return (
    asset.status === "ready" &&
    asset.includeInProgramming !== false &&
    // An item whose source will not serve it is passed over rather than chosen and bridged again.
    !isAssetProbeQuarantined(asset)
  );
}

/**
 * Whether the pool's rotation has anything to pick right now, with the same eligibility the schedule
 * preview uses. Readiness (M91) asks this instead of counting pools: a pool whose sources hold no ready
 * item is a name, not something that can air.
 */
export function poolHasPlayableAsset(args: {
  pool: SchedulePreviewPoolRecord | null;
  assets: SchedulePreviewAssetRecord[];
  sourceGate?: PoolRotationSourceGate | null;
}): boolean {
  const pool = args.pool;
  if (!pool) {
    return false;
  }
  return (
    walkPoolRotation({
      pool,
      assets: args.assets,
      isEligible: (asset) => isSchedulePreviewAssetEligible(pool, asset),
      sourceGate: args.sourceGate,
      steps: 1
    }).length > 0
  );
}

export function lookaheadVideoTitleFromPool(args: {
  pool: SchedulePreviewPoolRecord | null;
  assets: SchedulePreviewAssetRecord[];
  offset?: number;
  /** The source circuit breaker as it stands (`sourceBreakerGate`), so the title is what the worker picks. */
  sourceGate?: PoolRotationSourceGate | null;
}): string {
  const pool = args.pool;
  if (!pool) {
    return "";
  }

  const offset = Math.max(1, Math.floor(args.offset ?? 1));
  const picks = walkPoolRotation({
    pool,
    assets: args.assets,
    isEligible: (asset) => isSchedulePreviewAssetEligible(pool, asset),
    sourceGate: args.sourceGate,
    steps: offset
  });
  const asset = picks.at(-1)?.asset;
  return asset ? buildSchedulePreviewAssetTitle(asset) : "";
}

export function buildSchedulePreviewVideoSlots(args: {
  block: ScheduleOccurrence;
  pool: SchedulePreviewPoolRecord | null;
  assets: SchedulePreviewAssetRecord[];
  maxSlots?: number;
  sourceGate?: PoolRotationSourceGate | null;
}): SchedulePreviewVideoSlot[] {
  const pool = args.pool;
  if (!pool) {
    return [];
  }

  const blockSeconds = Math.max(args.block.durationMinutes, 1) * 60;
  const maxSlots = Math.max(1, Math.min(20, Math.floor(args.maxSlots ?? 20)));
  // Every block starts from the pool's stored position, not from where the previous block's preview
  // ended: the same simplification as before M73, and the reason two blocks of one pool on one day
  // preview the same first item.
  const rotation = createPoolRotation({
    sourceIds: pool.sourceIds,
    assets: args.assets,
    isEligible: (asset) => isSchedulePreviewAssetEligible(pool, asset),
    sourceGate: args.sourceGate
  });
  let state = poolRotationStateOf(pool);
  let projectedSeconds = 0;
  const slots: SchedulePreviewVideoSlot[] = [];

  for (let safety = 0; safety < maxSlots && projectedSeconds < blockSeconds; safety += 1) {
    const pick = rotation.next(state);
    if (!pick) {
      break;
    }

    state = pick.state;
    const asset = pick.asset;
    const { durationSeconds, estimated } = getSchedulePreviewAssetDurationSeconds(asset);
    const visibleDurationSeconds = Math.max(1, Math.min(durationSeconds, blockSeconds - projectedSeconds));

    slots.push({
      assetId: asset.id,
      title: buildSchedulePreviewAssetTitle(asset),
      estimatedDurationSeconds: visibleDurationSeconds,
      startOffsetSeconds: projectedSeconds,
      estimatedDuration: estimated
    });

    projectedSeconds += durationSeconds;
  }

  return slots;
}

type MaterializedPoolRecord = {
  id: string;
  name: string;
  sourceIds: string[];
  cursorAssetId: string;
  sourceCursors?: Record<string, string>;
  insertAssetId: string;
  insertEveryItems: number;
  itemsSinceInsert: number;
  audioLaneAssetId?: string;
  audioLaneVolumePercent?: number;
};

type MaterializedAssetRecord = {
  playbackProbeFailures?: number;
  id: string;
  sourceId: string;
  title: string;
  status: string;
  includeInProgramming: boolean;
  externalId?: string;
  durationSeconds?: number;
  publishedAt?: string;
  createdAt: string;
};

export function normalizeAudioLaneVolumePercent(value: number): number {
  if (!Number.isFinite(value)) {
    return 100;
  }

  return Math.min(100, Math.max(0, Math.round(value)));
}

export function normalizeCuepointOffsetsSeconds(offsets: number[], maxDurationMinutes = 0): number[] {
  const maxOffset = maxDurationMinutes > 0 ? Math.max(0, maxDurationMinutes * 60 - 1) : Number.POSITIVE_INFINITY;

  return [...new Set(offsets.map((value) => Math.floor(Number(value) || 0)).filter((value) => value >= 15 && value <= maxOffset))]
    .sort((left, right) => left - right)
    .slice(0, 24);
}

/**
 * The item a block's cuepoints play: the block's own cuepoint asset, else the pool's insert asset, whatever
 * the pool's insert cadence is (M94, R3 W5). The worker always fell back to the pool's insert asset; the
 * week view did so only while `insertEveryItems > 0`, so a pool with the cadence at 0 showed no cuepoint
 * inserts for a block that aired them. Worker, live view and preview all take it from here.
 */
export function resolveBlockCuepointAssetId(
  block: { cuepointAssetId?: string } | null | undefined,
  pool: { insertAssetId?: string } | null | undefined
): string {
  return block?.cuepointAssetId || pool?.insertAssetId || "";
}

export function parseCuepointOffsetsString(value: string, maxDurationMinutes = 0): number[] {
  const offsets = value
    .split(/[\s,;]+/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => Number(entry));

  return normalizeCuepointOffsetsSeconds(offsets, maxDurationMinutes);
}

export function formatCuepointOffsetLabel(offsetSeconds: number): string {
  const clamped = Math.max(0, Math.floor(offsetSeconds));
  const hours = Math.floor(clamped / 3600);
  const minutes = Math.floor((clamped % 3600) / 60);
  const seconds = clamped % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function summarizeCuepointOffsets(offsets: number[]): string {
  const normalized = normalizeCuepointOffsetsSeconds(offsets);
  return normalized.map((offset) => formatCuepointOffsetLabel(offset)).join(", ");
}

export function buildCuepointKey(occurrenceKey: string, offsetSeconds: number): string {
  return `${occurrenceKey}@${Math.max(0, Math.floor(offsetSeconds))}`;
}

export function getScheduleElapsedSeconds(args: {
  startMinuteOfDay: number;
  currentTime: string;
}): number {
  const [hours, minutes] = args.currentTime.split(":").map((value) => Number(value) || 0);
  const currentMinuteOfDay = Math.max(0, Math.min(24 * 60 - 1, hours * 60 + minutes));
  let minuteDelta = currentMinuteOfDay - args.startMinuteOfDay;

  if (minuteDelta < 0) {
    minuteDelta += 24 * 60;
  }

  return minuteDelta * 60;
}

/**
 * Real seconds since the run of an occurrence started (M101, R3 C5): `now` minus the instant of its start in
 * the channel zone. Blocks keep their wall-clock times across the switch nights, but a cuepoint "after
 * 2 h" means two real hours: a block from 01:00 is 5 400 s in at 03:30 on the spring-forward day, where the
 * wall clock counts 9 000 s and fired cuepoints an hour early. A start that exists twice counts from its
 * first occurrence. Without the occurrence's `date` it falls back to the wall-clock count.
 */
export function getScheduleRunElapsedSeconds(args: {
  occurrence: { date?: string; startMinuteOfDay: number; effectiveStartMinuteOfDay?: number };
  now: Date;
  timeZone: string;
}): number {
  const { occurrence } = args;
  if (!occurrence.date) {
    return getScheduleElapsedSeconds({
      startMinuteOfDay: occurrence.startMinuteOfDay,
      currentTime: getCurrentScheduleMoment({ now: args.now, timeZone: args.timeZone }).time
    });
  }
  const startsAt = getScheduleInstant({
    date: occurrence.date,
    seconds: (occurrence.effectiveStartMinuteOfDay ?? occurrence.startMinuteOfDay) * 60,
    timeZone: args.timeZone
  });
  return Math.max(0, Math.floor((args.now.getTime() - startsAt.getTime()) / 1000));
}

export function getCuepointProgress(args: {
  occurrenceKey: string;
  cuepointOffsetsSeconds: number[];
  firedCuepointKeys: string[];
  elapsedSeconds: number;
  /**
   * The block's air windows in seconds from its start (`getScheduleOccurrenceAirWindowSeconds`). A dated
   * block that takes over part of a weekly one (M93) leaves it two windows; a cuepoint is due only inside
   * the window on air now. One that fell into the taken-over part is skipped, and one from an earlier window
   * is not fired again when the weekly block comes back (its fired keys went with the dated block's run).
   * Missing means one window over the whole block.
   */
  airWindowsSeconds?: ScheduleAirWindow[];
}) {
  const windows = args.airWindowsSeconds;
  const insideAnyWindow = (offset: number) => !windows || windows.some((window) => offset >= window.start && offset < window.end);
  const currentWindow = windows?.find((window) => args.elapsedSeconds >= window.start && args.elapsedSeconds < window.end) ?? null;
  const normalizedOffsets = normalizeCuepointOffsetsSeconds(args.cuepointOffsetsSeconds).filter(insideAnyWindow);
  const fired = new Set(args.firedCuepointKeys);
  const dueOffsetSeconds =
    normalizedOffsets.find(
      (offset) =>
        offset <= args.elapsedSeconds &&
        (!windows || (currentWindow !== null && offset >= currentWindow.start)) &&
        !fired.has(buildCuepointKey(args.occurrenceKey, offset))
    ) ?? null;
  const nextOffsetSeconds =
    normalizedOffsets.find((offset) => offset > args.elapsedSeconds && !fired.has(buildCuepointKey(args.occurrenceKey, offset))) ?? null;

  return {
    dueOffsetSeconds,
    dueCuepointKey: dueOffsetSeconds === null ? "" : buildCuepointKey(args.occurrenceKey, dueOffsetSeconds),
    nextOffsetSeconds,
    firedCount: normalizedOffsets.filter((offset) => fired.has(buildCuepointKey(args.occurrenceKey, offset))).length,
    totalCount: normalizedOffsets.length
  };
}

function getMaterializedAssetDurationSeconds(asset: MaterializedAssetRecord): { durationSeconds: number; estimated: boolean } {
  if (typeof asset.durationSeconds === "number" && asset.durationSeconds > 0) {
    return {
      durationSeconds: asset.durationSeconds,
      estimated: false
    };
  }

  return {
    durationSeconds: estimatedProgrammingDurationSeconds,
    estimated: true
  };
}

// The projection walks the whole block so the rotation hands the next block the right item (M97); only
// the first `maxMaterializedItemsPerBlock` items are listed. A cap still bounds a pathological pool of
// one-second clips.
const maxProjectedItemsPerBlock = 5000;

const scheduleWeekdayShortLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const scheduleMonthShortLabels = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** A planning length in hours, as the week view reads it: "24 h", "1 h 30 min", "45 min". */
export function formatScheduleHours(minutes: number): string {
  const total = Math.max(0, Math.round(Number(minutes) || 0));
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  if (hours === 0) {
    return `${rest} min`;
  }
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

/** A day header of the week view: "Sat 3 Oct". */
export function formatScheduleDayHeading(date: string): string {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    return date;
  }
  return `${scheduleWeekdayShortLabels[parsed.getUTCDay()]} ${parsed.getUTCDate()} ${scheduleMonthShortLabels[parsed.getUTCMonth()]}`;
}

/**
 * A range of minutes relative to a day, named from that day: "20:00 → 22:00", "00:00 → 24:00", and for a
 * block past midnight the day it ends on, "23:00 → 01:00 Sun" (a start before the day names the day before).
 */
export function formatScheduleTimeRange(args: { start: number; end: number; dayOfWeek: number }): string {
  const dayOfWeek = ((Math.trunc(args.dayOfWeek) % 7) + 7) % 7;
  const start =
    args.start < 0
      ? `${formatMinuteOfDay(args.start)} ${scheduleWeekdayShortLabels[(dayOfWeek + 6) % 7]}`
      : formatMinuteOfDay(args.start);
  const end =
    args.end > MINUTES_PER_DAY
      ? `${formatMinuteOfDay(args.end)} ${scheduleWeekdayShortLabels[(dayOfWeek + 1) % 7]}`
      : args.end === MINUTES_PER_DAY
        ? "24:00"
        : formatMinuteOfDay(args.end);
  return `${start} → ${end}`;
}

/** Where a pool stands while the week is projected: its rotation and the items since its last insert. */
type PoolProjectionState = {
  rotation: PoolRotationState;
  itemsSinceInsert: number;
};

function materializePoolWindow(args: {
  block: ScheduleOccurrence;
  pool: MaterializedPoolRecord | null;
  assets: MaterializedAssetRecord[];
  maxQueuePreviewItems: number;
  sourceGate?: PoolRotationSourceGate | null;
  /**
   * Where the pool's rotation stands when this block starts: where the pool's previous block of the
   * week ended (M97). Missing means the pool's stored position, which is where the first block starts.
   */
  startState?: PoolProjectionState;
  /** A minute (relative to the block's date) up to which the block has already aired; the projection fills the rest. */
  fromMinute?: number;
  /** How many items are listed; the rest is projected but not listed. */
  maxListedItems?: number;
}): {
  block: MaterializedProgrammingBlock;
  endState: PoolProjectionState;
  /** The minutes (relative to the block's date) the projection covers, overflow included. */
  spans: ScheduleAirWindow[];
} {
  const excludedAssetIds = new Set<string>();
  if (args.pool?.insertAssetId && Math.max(args.pool?.insertEveryItems ?? 0, 0) > 0) {
    excludedAssetIds.add(args.pool.insertAssetId);
  }
  if (args.pool?.audioLaneAssetId) {
    excludedAssetIds.add(args.pool.audioLaneAssetId);
  }
  const poolName = args.pool?.name || args.block.sourceName || "Unassigned pool";
  const isEligible = (asset: MaterializedAssetRecord) =>
    asset.status === "ready" &&
    asset.includeInProgramming !== false &&
    !isAssetProbeQuarantined(asset) &&
    !excludedAssetIds.has(asset.id);
  const rotation = args.pool
    ? createPoolRotation({ sourceIds: args.pool.sourceIds, assets: args.assets, isEligible, sourceGate: args.sourceGate })
    : null;
  const heldSourceIds = (args.pool?.sourceIds ?? []).filter((sourceId) => args.sourceGate?.heldSourceIds.includes(sourceId));
  // Ready assets with the breaker ignored, so a pool whose ready assets are all held is not reported as a
  // pool without any (M75 review): its assets are fine, the hold is the reason, and it ends by itself.
  const hasReadyAssets = args.pool
    ? args.assets.some((asset) => args.pool?.sourceIds.includes(asset.sourceId) && isEligible(asset))
    : false;
  const playableRegularAssets = args.pool
    ? args.assets.filter(
        (asset) => args.pool?.sourceIds.includes(asset.sourceId) && !heldSourceIds.includes(asset.sourceId) && isEligible(asset)
      )
    : [];
  const hasEligibleAssets = hasReadyAssets && playableRegularAssets.length > 0;
  // Like the worker's two insert checks since M94: not an item that is quarantined or whose source the
  // breaker holds.
  const isInsertPlayable = (asset: MaterializedAssetRecord) =>
    asset.status === "ready" &&
    asset.includeInProgramming !== false &&
    !isAssetProbeQuarantined(asset) &&
    !(args.sourceGate?.heldSourceIds ?? []).includes(asset.sourceId);
  const insertAsset =
    args.pool?.insertAssetId && args.pool.insertEveryItems > 0
      ? args.assets.find((asset) => asset.id === args.pool?.insertAssetId && isInsertPlayable(asset)) ?? null
      : null;
  const blockStart = args.block.effectiveStartMinuteOfDay;
  const airWindows = getScheduleOccurrenceAirWindows(args.block);
  // The windows in seconds from the block's start; a block on air now is filled from now.
  const toSeconds = (window: ScheduleAirWindow): ScheduleAirWindow => ({
    start: (window.start - blockStart) * 60,
    end: (window.end - blockStart) * 60
  });
  const fullWindowsSeconds = airWindows.map(toSeconds);
  const fromMinute = args.fromMinute;
  const clippedWindows =
    fromMinute === undefined
      ? airWindows
      : airWindows
          .map((window) => ({ start: Math.max(window.start, fromMinute), end: window.end }))
          .filter((window) => window.end > window.start);
  const windowsSeconds = (clippedWindows.length > 0 ? clippedWindows : airWindows).map(toSeconds);
  const fullAirSeconds = fullWindowsSeconds.reduce((sum, window) => sum + (window.end - window.start), 0);
  const airSeconds = windowsSeconds.reduce((sum, window) => sum + (window.end - window.start), 0);
  const firstWindowStart = windowsSeconds[0]?.start ?? 0;
  // The worker's rule: only cuepoints inside an air window fire (getCuepointProgress). One before the
  // point the projection starts from has fired already or never will.
  const cuepointOffsetsSeconds = normalizeCuepointOffsetsSeconds(args.block.cuepointOffsetsSeconds ?? [], args.block.durationMinutes).filter(
    (offset) => fullWindowsSeconds.some((window) => offset >= window.start && offset < window.end)
  );
  // The worker's rule (resolveBlockCuepointAssetId).
  const cuepointAssetId = cuepointOffsetsSeconds.length > 0 ? resolveBlockCuepointAssetId(args.block, args.pool) : "";
  const cuepointAsset = cuepointAssetId
    ? args.assets.find((asset) => asset.id === cuepointAssetId && isInsertPlayable(asset)) ?? null
    : null;
  const notes: string[] = [];

  if (!args.pool) {
    notes.push("No pool is linked to this block.");
  }

  if (!hasReadyAssets) {
    notes.push("The selected pool has no ready programming assets.");
  }

  // Said, because the week otherwise shows a pool that skips one of its sources with no reason given.
  if (heldSourceIds.length > 0 && hasReadyAssets) {
    notes.push(
      hasEligibleAssets
        ? `${heldSourceIds.length} source(s) of this pool are held out after failed probes; the preview shows the pool without them until the next trial probe succeeds.`
        : "Every source of this pool with ready assets is held out after failed probes, so the fallback plays until a trial probe succeeds."
    );
  }

  const startState: PoolProjectionState = args.startState ?? {
    rotation: poolRotationStateOf(args.pool ?? {}),
    itemsSinceInsert: Math.max(args.pool?.itemsSinceInsert ?? 0, 0)
  };
  let itemsSinceInsert = startState.itemsSinceInsert;
  // The block continues the pool's rotation from where the previous block of the pool left it, like the
  // worker, which keeps one position per pool; an insert does not move it.
  let rotationState = startState.rotation;
  const items: MaterializedProgrammingItem[] = [];
  const queuePreview: string[] = [];
  const assetUseCounts = new Map<string, number>();
  let filledSeconds = 0;
  let uniqueSeconds = 0;
  let insertCount = 0;
  let cuepointCount = 0;
  let estimatedDurationCount = 0;
  let repeatedRegularAsset = false;
  let projectedItemCount = 0;
  const firedCuepointOffsets = new Set<number>(cuepointOffsetsSeconds.filter((offset) => offset < firstWindowStart));
  // The air windows are filled one after the other. An item still running when a dated block takes over
  // is cut there, and the next item starts when the weekly block comes back; the last window may overflow.
  let windowIndex = 0;
  let cursor = firstWindowStart;
  const windowFillEnds = windowsSeconds.map((window) => window.start);

  for (let safety = 0; safety < maxProjectedItemsPerBlock && windowIndex < windowsSeconds.length; safety += 1) {
    if (!rotation || !hasEligibleAssets) {
      break;
    }

    const dueCuepointOffset =
      cuepointAsset && cuepointOffsetsSeconds.length > 0
        ? cuepointOffsetsSeconds.find((offset) => offset <= cursor && !firedCuepointOffsets.has(offset)) ?? null
        : null;
    const shouldInsert =
      dueCuepointOffset !== null ||
      (Boolean(insertAsset) &&
        Math.max(args.pool?.insertEveryItems ?? 0, 0) > 0 &&
        itemsSinceInsert >= Math.max(args.pool?.insertEveryItems ?? 0, 0));
    const pick = shouldInsert ? null : rotation.next(rotationState);
    const nextAsset = dueCuepointOffset !== null ? cuepointAsset : shouldInsert ? insertAsset : pick?.asset ?? null;

    if (!nextAsset) {
      break;
    }

    if (pick) {
      rotationState = pick.state;
    }

    const { durationSeconds, estimated } = getMaterializedAssetDurationSeconds(nextAsset);
    const window = windowsSeconds[windowIndex] as ScheduleAirWindow;
    const lastWindow = windowIndex === windowsSeconds.length - 1;
    const itemStartSeconds = cursor;
    const itemEndSeconds = cursor + durationSeconds;
    const shownEndSeconds = lastWindow ? itemEndSeconds : Math.min(itemEndSeconds, window.end);
    filledSeconds += shownEndSeconds - itemStartSeconds;
    windowFillEnds[windowIndex] = shownEndSeconds;
    if (itemEndSeconds >= window.end) {
      windowIndex += 1;
      cursor = lastWindow ? itemEndSeconds : (windowsSeconds[windowIndex]?.start ?? itemEndSeconds);
    } else {
      cursor = itemEndSeconds;
    }
    const seenCount = assetUseCounts.get(nextAsset.id) ?? 0;
    const repeated = !shouldInsert && seenCount > 0;
    if (!shouldInsert && seenCount === 0) {
      uniqueSeconds += durationSeconds;
    }
    if (!shouldInsert) {
      assetUseCounts.set(nextAsset.id, seenCount + 1);
      repeatedRegularAsset = repeatedRegularAsset || repeated;
      itemsSinceInsert += 1;
    } else {
      insertCount += 1;
      if (dueCuepointOffset !== null) {
        cuepointCount += 1;
        firedCuepointOffsets.add(dueCuepointOffset);
      }
      itemsSinceInsert = 0;
    }
    if (estimated) {
      estimatedDurationCount += 1;
    }
    projectedItemCount += 1;

    if (items.length < (args.maxListedItems ?? maxMaterializedItemsPerBlock)) {
      items.push({
        kind: shouldInsert ? "insert" : "asset",
        assetId: nextAsset.id,
        title: nextAsset.title,
        durationMinutes: Math.max(1, Math.ceil(durationSeconds / 60)),
        startTime: formatMinuteOfDay(args.block.startMinuteOfDay + Math.floor(itemStartSeconds / 60)),
        endTime: formatMinuteOfDay(args.block.startMinuteOfDay + Math.ceil(shownEndSeconds / 60)),
        overflow: lastWindow && itemEndSeconds > window.end,
        repeated,
        estimatedDuration: estimated,
        insertTrigger: shouldInsert ? (dueCuepointOffset !== null ? "cuepoint" : "pool-interval") : undefined,
        startSecond: blockStart * 60 + itemStartSeconds,
        endSecond: blockStart * 60 + shownEndSeconds
      });
    }

    if (queuePreview.length < args.maxQueuePreviewItems) {
      queuePreview.push(
        `${shouldInsert ? (dueCuepointOffset !== null ? "Cuepoint insert" : "Insert") : "Queue"} · ${nextAsset.title}`
      );
    }
  }

  if (insertAsset && Math.max(args.pool?.insertEveryItems ?? 0, 0) > 0) {
    notes.push(`Automatic insert every ${args.pool?.insertEveryItems} scheduled item${args.pool?.insertEveryItems === 1 ? "" : "s"}.`);
  }

  if (args.pool?.audioLaneAssetId) {
    const audioLaneAsset = args.assets.find((asset) => asset.id === args.pool?.audioLaneAssetId) ?? null;
    if (audioLaneAsset) {
      notes.push(
        `Audio lane replaces program audio with ${audioLaneAsset.title} at ${normalizeAudioLaneVolumePercent(
          args.pool?.audioLaneVolumePercent ?? 100
        )}% while regular pool items are on air.`
      );
    } else {
      notes.push("Configured audio lane asset is not available, so regular program audio will stay unchanged.");
    }
  }

  if (cuepointOffsetsSeconds.length > 0) {
    notes.push(
      `Cuepoints at ${summarizeCuepointOffsets(cuepointOffsetsSeconds)} fire safe-boundary inserts${
        cuepointAsset ? ` using ${cuepointAsset.title}` : ""
      }.`
    );
  }

  if (estimatedDurationCount > 0) {
    notes.push(`${estimatedDurationCount} item${estimatedDurationCount === 1 ? "" : "s"} use a 30-minute estimate because natural length is missing.`);
  }

  const lastWindowEnd = windowsSeconds.at(-1)?.end ?? 0;
  const overflowSeconds = windowIndex >= windowsSeconds.length ? Math.max(0, cursor - lastWindowEnd) : 0;
  const fillStatus =
    projectedItemCount === 0
      ? "empty"
      : repeatedRegularAsset || filledSeconds < airSeconds
        ? "underfilled"
        : overflowSeconds > 0
          ? "overflow"
          : "balanced";
  const overflowMinutes = Math.max(0, Math.ceil(overflowSeconds / 60));
  const fillLabel =
    fillStatus === "empty"
      ? "No playable material"
      : fillStatus === "underfilled"
        ? "Repeats inside block"
        : fillStatus === "overflow"
          ? `Ends ${overflowMinutes}m late`
          : "Balanced window";
  // Why a block repeats, with the numbers an operator can act on (U5).
  let repeatReason = "";
  if (fillStatus === "underfilled") {
    const poolVideoSeconds = playableRegularAssets.reduce((sum, asset) => sum + getMaterializedAssetDurationSeconds(asset).durationSeconds, 0);
    const plays = poolVideoSeconds > 0 ? fullAirSeconds / poolVideoSeconds : 0;
    const blockLabel = formatScheduleHours(fullAirSeconds / 60);
    if (!repeatedRegularAsset) {
      repeatReason = `${poolName} runs out of videos before this ${blockLabel} block ends. Add videos to ${poolName}.`;
    } else if (plays >= 1.5) {
      repeatReason = `${formatScheduleHours(Math.max(1, Math.round(poolVideoSeconds / 60)))} of video for a ${blockLabel} block: plays ≈ ${Math.round(
        plays
      )} times. Add videos to ${poolName}.`;
    } else if ((args.pool?.sourceIds.length ?? 0) > 1) {
      repeatReason = `${poolName} alternates between its sources, and one of them runs out of videos first and repeats. Add videos to that source.`;
    } else {
      repeatReason = `${formatScheduleHours(Math.max(1, Math.round(poolVideoSeconds / 60)))} of video for a ${blockLabel} block: its first videos play again before it ends. Add videos to ${poolName}.`;
    }
  }
  const timeLabel = airWindows
    .map((window) => formatScheduleTimeRange({ start: window.start, end: window.end, dayOfWeek: getDayOfWeekForDate(args.block.date) }))
    .join(" · ");
  const spans = windowsSeconds
    .map((window, index) => ({
      start: blockStart + window.start / 60,
      end: blockStart + (windowFillEnds[index] ?? window.start) / 60
    }))
    .filter((span) => span.end > span.start);

  return {
    block: {
      blockId: args.block.blockId,
      title: args.block.title,
      categoryName: args.block.categoryName,
      dayOfWeek: args.block.dayOfWeek,
      startMinuteOfDay: args.block.startMinuteOfDay,
      durationMinutes: args.block.durationMinutes,
      startTime: args.block.startTime,
      endTime: args.block.endTime,
      showId: args.block.showId,
      poolId: args.block.poolId,
      sourceName: args.block.sourceName,
      repeatMode: normalizeScheduleRepeatMode(args.block.repeatMode ?? "single"),
      repeatLabel: describeScheduleRepeatMode(args.block.repeatMode ?? "single", args.block.dayOfWeek),
      fillStatus,
      fillLabel,
      poolName,
      projectedMinutes: Math.ceil(filledSeconds / 60),
      overflowMinutes,
      uniqueMinutes: Math.ceil(uniqueSeconds / 60),
      insertCount,
      cuepointCount,
      queuePreview,
      notes,
      items,
      dated: Boolean(args.block.dated),
      validFrom: args.block.validFrom ?? "",
      validUntil: args.block.validUntil ?? "",
      airWindows,
      date: args.block.date,
      durationLabel: formatScheduleHours(fullAirSeconds / 60),
      timeLabel,
      repeatReason,
      aired: false
    },
    endState: { rotation: rotationState, itemsSinceInsert },
    spans
  };
}

export function buildMaterializedProgrammingWeek(args: {
  startDate: string;
  blocks: ScheduleBlock[];
  pools: MaterializedPoolRecord[];
  assets: MaterializedAssetRecord[];
  maxQueuePreviewItems?: number;
  /**
   * The source circuit breaker as it stands when the week is drawn (`sourceBreakerGate` at now). Applied
   * to every block of the week: whether a trial probe will succeed is not knowable ahead of time, and the
   * worker holds the source exactly like this until one does.
   */
  sourceGate?: PoolRotationSourceGate | null;
  /**
   * The minute of `startDate` it is now (channel zone). A block of that day that has ended is marked
   * `aired` and takes nothing from its pool's rotation; the block on air is projected from now on.
   * Missing means the whole first day is still ahead.
   */
  nowMinuteOfDay?: number;
  /**
   * How many items each block lists (default 48). The public programme (M100) lists every item of the next
   * 24 hours, so it raises this; every block is projected to its end either way.
   */
  maxListedItemsPerBlock?: number;
}): MaterializedProgrammingDay[] {
  const dates = Array.from({ length: 7 }, (_, offset) => addDaysToDateString(args.startDate, offset));
  const occurrencesByDay = dates.map((date) => buildScheduleOccurrences({ date, blocks: args.blocks }));
  type Entry = { dayIndex: number; occurrence: ScheduleOccurrence; absoluteStart: number; absoluteEnd: number };
  const entries: Entry[] = [];
  occurrencesByDay.forEach((occurrences, dayIndex) => {
    for (const occurrence of occurrences) {
      // A block past midnight is listed once, on the day it starts (U5). Only the first day keeps a
      // carry-over: the day it started on is not in the week.
      if (occurrence.carriesOverFromPreviousDay && dayIndex > 0) {
        continue;
      }
      const windows = getScheduleOccurrenceAirWindows(occurrence);
      entries.push({
        dayIndex,
        occurrence,
        absoluteStart: dayIndex * MINUTES_PER_DAY + Math.min(...windows.map((window) => window.start)),
        absoluteEnd: dayIndex * MINUTES_PER_DAY + Math.max(...windows.map((window) => window.end))
      });
    }
  });

  // Each pool's rotation is carried across its blocks in time order with the worker's rotation
  // (createPoolRotation, shared, not copied): the second block of a pool starts with the item after the
  // first block's last one, not with the pool's stored position again (U5).
  const now = args.nowMinuteOfDay;
  const poolStates = new Map<string, PoolProjectionState>();
  const results = new Map<Entry, { block: MaterializedProgrammingBlock; spans: ScheduleAirWindow[] }>();
  for (const entry of [...entries].sort((left, right) => left.absoluteStart - right.absoluteStart)) {
    const pool = args.pools.find((candidate) => candidate.id === entry.occurrence.poolId) ?? null;
    const aired = now !== undefined && entry.absoluteEnd <= now;
    const onAir = now !== undefined && !aired && entry.absoluteStart < now;
    const result = materializePoolWindow({
      block: entry.occurrence,
      pool,
      assets: args.assets,
      maxQueuePreviewItems: args.maxQueuePreviewItems ?? 4,
      sourceGate: args.sourceGate,
      startState: pool ? poolStates.get(pool.id) : undefined,
      fromMinute: onAir ? (now as number) - entry.dayIndex * MINUTES_PER_DAY : undefined,
      maxListedItems: args.maxListedItemsPerBlock
    });
    if (pool && !aired) {
      poolStates.set(pool.id, result.endState);
    }
    const dayOffset = entry.dayIndex * MINUTES_PER_DAY;
    // The part of a block on air now that already ran counts as filled, unless the block has nothing to play.
    const airedSpans =
      onAir && result.block.fillStatus !== "empty"
        ? getScheduleOccurrenceAirWindows(entry.occurrence)
            .map((window) => ({ start: window.start, end: Math.min(window.end, (now as number) - dayOffset) }))
            .filter((span) => span.end > span.start)
        : [];
    results.set(entry, {
      block: { ...result.block, aired },
      spans: [...airedSpans, ...result.spans].map((span) => ({ start: span.start + dayOffset, end: span.end + dayOffset }))
    });
  }

  return dates.map((date, dayIndex) => {
    const occurrences = occurrencesByDay[dayIndex] ?? [];
    const blocks = entries
      .filter((entry) => entry.dayIndex === dayIndex)
      .map((entry) => results.get(entry)?.block)
      .filter((block): block is MaterializedProgrammingBlock => Boolean(block));
    const dayStart = dayIndex * MINUTES_PER_DAY;
    const dayEnd = dayStart + MINUTES_PER_DAY;

    return {
      date,
      dayOfWeek: getDayOfWeekForDate(date),
      // Only the minutes that fall on this date. A block crossing midnight adds its evening here and its
      // morning to the next day; adding its whole length on both days counted 23:00-01:00 twice, so a
      // 24/7 grid read "1500m scheduled" on the two days around such a block.
      // Counted over the air windows (M93), so a dated block over a 24/7 grid adds no minutes to the day.
      totalScheduledMinutes: occurrences.reduce(
        (total, occurrence) =>
          total +
          getScheduleOccurrenceAirWindows(occurrence).reduce(
            (sum, window) => sum + Math.max(0, Math.min(window.end, MINUTES_PER_DAY) - Math.max(window.start, 0)),
            0
          ),
        0
      ),
      // The projection is cut at the day's edges the same way, so the morning of a block that started the
      // day before counts here although the block is listed on its own day.
      totalProjectedMinutes: Math.round(
        [...results.values()].reduce(
          (total, result) =>
            total +
            result.spans.reduce((sum, span) => sum + Math.max(0, Math.min(span.end, dayEnd) - Math.max(span.start, dayStart)), 0),
          0
        )
      ),
      blockCount: blocks.length,
      underfilledCount: blocks.filter((block) => block.fillStatus === "underfilled").length,
      overflowCount: blocks.filter((block) => block.fillStatus === "overflow").length,
      emptyCount: blocks.filter((block) => block.fillStatus === "empty").length,
      blocks
    };
  });
}

export function getCurrentScheduleMoment(args: { now: Date; timeZone: string }) {
  return extractZonedParts(args);
}

export function isCurrentScheduleTime(args: {
  startTime: string;
  endTime: string;
  currentTime: string;
}) {
  if (args.endTime > args.startTime) {
    return args.currentTime >= args.startTime && args.currentTime < args.endTime;
  }

  return args.currentTime >= args.startTime || args.currentTime < args.endTime;
}

export function validateScheduleBlock(block: {
  title: string;
  categoryName: string;
  sourceName: string;
  showId?: string;
  poolId?: string;
  repeatMode?: ScheduleRepeatMode;
  dayOfWeek: number;
  startMinuteOfDay: number;
  durationMinutes: number;
  cuepointOffsetsSeconds?: number[];
  validFrom?: string;
  validUntil?: string;
}, options: {
  /** Today in the channel zone; with it, a date window lying entirely in the past is refused. */
  today?: string;
} = {}) {
  if (!block.sourceName.trim() && !(block.poolId ?? "").trim()) {
    return "Pool or source label is required.";
  }

  if (!block.title.trim() && !block.categoryName.trim()) {
    return "At least a title or category is required.";
  }

  if (!Number.isInteger(block.dayOfWeek) || block.dayOfWeek < 0 || block.dayOfWeek > 6) {
    return "Day of week must be between 0 and 6.";
  }

  if (
    !Number.isInteger(block.startMinuteOfDay) ||
    block.startMinuteOfDay < 0 ||
    block.startMinuteOfDay >= 24 * 60
  ) {
    return "Start time must be within the current day.";
  }

  if (!Number.isInteger(block.durationMinutes) || block.durationMinutes < 15 || block.durationMinutes > 24 * 60) {
    return "Duration must be between 15 and 1440 minutes.";
  }

  if (block.repeatMode && !SCHEDULE_REPEAT_MODE_OPTIONS.some((entry) => entry.id === block.repeatMode)) {
    return "Repeat behavior is invalid.";
  }

  const normalizedCuepoints = normalizeCuepointOffsetsSeconds(block.cuepointOffsetsSeconds ?? [], block.durationMinutes);
  if ((block.cuepointOffsetsSeconds ?? []).length > 0 && normalizedCuepoints.length === 0) {
    return "Cuepoints must be positive second offsets within the block duration.";
  }

  const validFrom = block.validFrom ?? "";
  const validUntil = block.validUntil ?? "";
  if ((validFrom && !isScheduleDateString(validFrom)) || (validUntil && !isScheduleDateString(validUntil))) {
    return "Dates must be calendar dates (YYYY-MM-DD).";
  }

  if (validFrom && validUntil && validUntil < validFrom) {
    return "The last date must be on or after the first date.";
  }

  if (validUntil && options.today && validUntil < options.today) {
    return "These dates lie entirely in the past.";
  }

  if (validFrom && validUntil && !scheduleDateWindowHasWeekday(validFrom, validUntil, block.dayOfWeek)) {
    return "This weekday does not fall between these dates.";
  }

  return null;
}

/** A local calendar date `YYYY-MM-DD` that exists (2026-02-30 does not). */
export function isScheduleDateString(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** Whether a block has a date window (M93), which puts it on the layer above the weekly grid. */
export function isScheduleBlockDated(block: { validFrom?: string; validUntil?: string }): boolean {
  return Boolean(block.validFrom || block.validUntil);
}

/** Whether a block may start an occurrence on `date`; an undated block may on every date. */
export function isScheduleBlockActiveOnDate(block: { validFrom?: string; validUntil?: string }, date: string): boolean {
  return (!block.validFrom || date >= block.validFrom) && (!block.validUntil || date <= block.validUntil);
}

/** Whether a dated block's last date is before `today`: it airs no more and is listed as ended (owner Q2). */
export function hasScheduleBlockEnded(block: { validUntil?: string }, today: string): boolean {
  return Boolean(block.validUntil) && (block.validUntil ?? "") < today;
}

const scheduleMonthLabels = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "10 Oct" for 2026-10-10, without the runtime's locale data, so server and browser print the same. */
export function formatScheduleDateShort(date: string): string {
  if (!isScheduleDateString(date)) {
    return date;
  }
  const [, month, day] = date.split("-").map((part) => Number(part));
  return `${day} ${scheduleMonthLabels[(month ?? 1) - 1]}`;
}

/** How a block runs (M93), as the editor lists it: "" for every week, else "Once on 10 Oct", "1 Oct to 10 Oct", "Ended 10 Oct". */
export function describeScheduleBlockRun(
  block: { validFrom?: string; validUntil?: string },
  today = ""
): { label: string; ended: boolean } {
  const validFrom = block.validFrom ?? "";
  const validUntil = block.validUntil ?? "";
  if (!validFrom && !validUntil) {
    return { label: "", ended: false };
  }
  if (today && hasScheduleBlockEnded(block, today)) {
    return { label: `Ended ${formatScheduleDateShort(validUntil)}`, ended: true };
  }
  if (validFrom && validFrom === validUntil) {
    return { label: `Once on ${formatScheduleDateShort(validFrom)}`, ended: false };
  }
  if (validFrom && validUntil) {
    return { label: `${formatScheduleDateShort(validFrom)} to ${formatScheduleDateShort(validUntil)}`, ended: false };
  }
  return validFrom
    ? { label: `From ${formatScheduleDateShort(validFrom)}`, ended: false }
    : { label: `Until ${formatScheduleDateShort(validUntil)}`, ended: false };
}

/** The weekday (0 = Sunday) of a calendar date `YYYY-MM-DD`. */
export function getScheduleDateDayOfWeek(date: string): number {
  return getDayOfWeekForDate(date);
}

/** The weekdays among `days` that occur between two dates, inclusive; all of them for a week or more. */
export function filterWeekdaysInDateWindow(days: number[], validFrom: string, validUntil: string): number[] {
  return days.filter((day) => scheduleDateWindowHasWeekday(validFrom, validUntil, day));
}

function scheduleDateWindowHasWeekday(validFrom: string, validUntil: string, dayOfWeek: number): boolean {
  for (let offset = 0; offset < 7; offset += 1) {
    const date = addDaysToDateString(validFrom, offset);
    if (date > validUntil) {
      return false;
    }
    if (getDayOfWeekForDate(date) === dayOfWeek) {
      return true;
    }
  }
  return true;
}

const MINUTES_PER_WEEK = 7 * 24 * 60;

function scheduleBlockWeekRange(block: ScheduleBlock): { start: number; end: number } {
  const start = (((block.dayOfWeek % 7) + 7) % 7) * MINUTES_PER_DAY + block.startMinuteOfDay;
  return { start, end: start + block.durationMinutes };
}

/**
 * Whether two blocks overlap on air. Each block is placed on a 7-day minute line (`dayOfWeek * 1440 + start`),
 * so the part of a block after midnight meets the next weekday's blocks, and Saturday night wraps into Sunday
 * morning. Folding that part onto the block's own weekday (before M88) refused a Monday 00:00 block 23 hours
 * away from a Monday 23:00-01:00 block, and accepted the Tuesday 00:00 block it really runs into.
 */
function scheduleBlocksOverlap(left: ScheduleBlock, right: ScheduleBlock): boolean {
  if (!scheduleBlocksShareLayer(left, right)) {
    return false;
  }
  const concrete = datedScheduleBlocksOverlapOnAir(left, right);
  if (concrete !== null) {
    return concrete;
  }
  const leftRange = scheduleBlockWeekRange(left);
  const rightRange = scheduleBlockWeekRange(right);
  // The line is circular: shift one block a week either way.
  return [-MINUTES_PER_WEEK, 0, MINUTES_PER_WEEK].some(
    (shift) => leftRange.start < rightRange.end + shift && rightRange.start + shift < leftRange.end
  );
}

/**
 * Conflicts are per layer (M93, owner decision 5.1 Q1). A dated block over the weekly grid is not a conflict:
 * it takes that part over and the weekly block continues around it. Two undated blocks share the weekly
 * layer; two dated blocks share it only when the dates they air on meet (a block crossing midnight also airs
 * on the day after its last date).
 */
function scheduleBlocksShareLayer(left: ScheduleBlock, right: ScheduleBlock): boolean {
  const leftDated = isScheduleBlockDated(left);
  if (leftDated !== isScheduleBlockDated(right)) {
    return false;
  }
  if (!leftDated) {
    return true;
  }
  const span = (block: ScheduleBlock) => ({
    from: block.validFrom || "0000-01-01",
    until: block.validUntil
      ? block.startMinuteOfDay + block.durationMinutes > MINUTES_PER_DAY
        ? addDaysToDateString(block.validUntil, 1)
        : block.validUntil
      : "9999-12-31"
  });
  const leftSpan = span(left);
  const rightSpan = span(right);
  return leftSpan.from <= rightSpan.until && rightSpan.from <= leftSpan.until;
}

function scheduleDateDayNumber(date: string): number {
  return Math.round(new Date(`${date}T00:00:00.000Z`).getTime() / 86_400_000);
}

/**
 * For two dated blocks with both dates set whose shared span is shorter than eight days: whether any of their
 * real runs meet. Spans that meet do not mean runs that meet (Mon 20:00 from 1-7 Oct airs on 5 Oct, from
 * 7-20 Oct on 12 and 19 Oct). Null when the weekday line decides: a shared span of eight days or more holds
 * every weekday of both blocks, or a block has an open date.
 */
function datedScheduleBlocksOverlapOnAir(left: ScheduleBlock, right: ScheduleBlock): boolean | null {
  if (!left.validFrom || !left.validUntil || !right.validFrom || !right.validUntil) {
    return null;
  }
  const from = Math.max(scheduleDateDayNumber(left.validFrom), scheduleDateDayNumber(right.validFrom)) - 1;
  const until = Math.min(scheduleDateDayNumber(left.validUntil), scheduleDateDayNumber(right.validUntil)) + 1;
  if (until - from >= 9) {
    return null;
  }
  const runs = (block: ScheduleBlock) => {
    const first = scheduleDateDayNumber(block.validFrom ?? "");
    const last = scheduleDateDayNumber(block.validUntil ?? "");
    const ranges: ScheduleAirWindow[] = [];
    for (let day = Math.max(from, first); day <= Math.min(until, last); day += 1) {
      // Day 0 of the epoch (1970-01-01) was a Thursday.
      if ((((day + 4) % 7) + 7) % 7 === block.dayOfWeek) {
        const start = day * MINUTES_PER_DAY + block.startMinuteOfDay;
        ranges.push({ start, end: start + block.durationMinutes });
      }
    }
    return ranges;
  };
  const rightRuns = runs(right);
  return runs(left).some((a) => rightRuns.some((b) => a.start < b.end && b.start < a.end));
}

export function findScheduleConflicts(blocks: Array<ScheduleBlock>): string[] {
  const conflicts = new Set<string>();

  for (let index = 0; index < blocks.length; index += 1) {
    const current = blocks[index];
    if (!current) {
      continue;
    }
    for (let compareIndex = index + 1; compareIndex < blocks.length; compareIndex += 1) {
      const candidate = blocks[compareIndex];
      if (candidate && scheduleBlocksOverlap(current, candidate)) {
        conflicts.add(current.id);
        conflicts.add(candidate.id);
      }
    }
  }

  return [...conflicts];
}

/**
 * The overlaps a change brings in: pairs where at least one block is in `changedIds`. A save is refused for
 * these only, so an overlap that was already saved (one the 7-day line of M88 newly reveals, for instance) is
 * marked in the editor but does not block every other edit until it is resolved.
 */
export function findScheduleConflictsInvolving(blocks: Array<ScheduleBlock>, changedIds: Iterable<string>): string[] {
  const changed = new Set(changedIds);
  const conflicts = new Set<string>();

  for (let index = 0; index < blocks.length; index += 1) {
    const current = blocks[index];
    if (!current) {
      continue;
    }
    for (let compareIndex = index + 1; compareIndex < blocks.length; compareIndex += 1) {
      const candidate = blocks[compareIndex];
      if (!candidate || (!changed.has(current.id) && !changed.has(candidate.id))) {
        continue;
      }
      if (scheduleBlocksOverlap(current, candidate)) {
        conflicts.add(current.id);
        conflicts.add(candidate.id);
      }
    }
  }

  return [...conflicts];
}

/**
 * The shape of the weekly grid per weekday. Dated blocks (M93) are not part of it: they take over a part of
 * some dates only, and counting them here put more than 24 hours on a 24/7 day.
 */
export function summarizeScheduleWeek(blocks: ScheduleBlock[]): ScheduleDaySummary[] {
  return Array.from({ length: 7 }, (_, dayOfWeek) => {
    const dayBlocks = blocks
      .filter((block) => block.dayOfWeek === dayOfWeek && !isScheduleBlockDated(block))
      .slice()
      .sort((left, right) => left.startMinuteOfDay - right.startMinuteOfDay);

    if (dayBlocks.length === 0) {
      return {
        dayOfWeek,
        blockCount: 0,
        scheduledMinutes: 0,
        firstStartMinute: null,
        lastEndMinute: null
      };
    }

    const first = dayBlocks[0];
    const last = dayBlocks[dayBlocks.length - 1];

    return {
      dayOfWeek,
      blockCount: dayBlocks.length,
      scheduledMinutes: dayBlocks.reduce((total, block) => total + block.durationMinutes, 0),
      firstStartMinute: first?.startMinuteOfDay ?? null,
      lastEndMinute: last ? (last.startMinuteOfDay + last.durationMinutes) % (24 * 60) : null
    };
  });
}

function getDayOfWeekForDate(value: string): number {
  return new Date(`${value}T00:00:00.000Z`).getUTCDay();
}

const MINUTES_PER_DAY = 24 * 60;

function toScheduleOccurrence(args: {
  block: ScheduleBlock;
  date: string;
  carriesOverFromPreviousDay: boolean;
}): ScheduleOccurrence {
  const startMinutes = args.block.startMinuteOfDay;
  const endMinutes = (startMinutes + args.block.durationMinutes) % MINUTES_PER_DAY;

  return {
    // The carry-over flag is part of the key: the same block legitimately appears on two dates,
    // and callers de-duplicate occurrences by key.
    key: `${args.date}:${args.block.id}:${startMinutes}:${args.block.durationMinutes}${args.carriesOverFromPreviousDay ? ":carry" : ""}`,
    blockId: args.block.id,
    title: args.block.title,
    categoryName: args.block.categoryName,
    dayOfWeek: args.block.dayOfWeek,
    showId: args.block.showId,
    poolId: args.block.poolId,
    sourceName: args.block.sourceName,
    date: args.date,
    startTime: formatMinuteOfDay(startMinutes),
    endTime: formatMinuteOfDay(endMinutes),
    startMinuteOfDay: startMinutes,
    durationMinutes: args.block.durationMinutes,
    carriesOverFromPreviousDay: args.carriesOverFromPreviousDay,
    effectiveStartMinuteOfDay: args.carriesOverFromPreviousDay ? startMinutes - MINUTES_PER_DAY : startMinutes,
    repeatMode: normalizeScheduleRepeatMode(args.block.repeatMode ?? "single"),
    repeatGroupId: args.block.repeatGroupId ?? "",
    cuepointAssetId: args.block.cuepointAssetId ?? "",
    cuepointOffsetsSeconds: normalizeCuepointOffsetsSeconds(
      args.block.cuepointOffsetsSeconds ?? [],
      args.block.durationMinutes
    ),
    dated: isScheduleBlockDated(args.block),
    validFrom: args.block.validFrom ?? "",
    validUntil: args.block.validUntil ?? ""
  };
}

/**
 * Every occurrence covering any part of `date`.
 *
 * This includes blocks that started the previous day and run past midnight. Filtering purely on
 * the weekday of `date` dropped them, so a block scheduled Monday 23:00 for two hours vanished
 * from the schedule at 00:00 and the channel fell out of its programmed pool for the rest of the
 * night with nothing marked as current.
 */
/**
 * The next date on or after `date` that falls on `dayOfWeek` (0 = Sunday).
 *
 * Forward rather than nearest, so a preview always describes programming still ahead: opening
 * Monday on a Wednesday shows next Monday, not the one that already aired. Needed because a
 * schedule preview is built for a date, not for a weekday — resolving a pool into the individual
 * videos that would play requires knowing which day it is.
 */
export function shiftDateToDayOfWeek(date: string, dayOfWeek: number): string {
  const base = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(base.getTime())) {
    return date;
  }
  const target = ((Math.trunc(dayOfWeek) % 7) + 7) % 7;
  base.setUTCDate(base.getUTCDate() + ((target - base.getUTCDay() + 7) % 7));
  return base.toISOString().slice(0, 10);
}

/**
 * Every occurrence covering any part of `date`, with its air windows (M93).
 *
 * A dated block occurs only when the date it starts on lies in its window, so a carry-over is kept when the
 * day before does: a 23:00-01:00 block dated until 10 Oct still runs into 11 Oct, and starts no more. The
 * occurrences then go through `applyScheduleLayers`, so every consumer (air, previews, Twitch, `/channel`,
 * the cache keep-rule) sees a weekly block cut around the dated ones and none fully taken over.
 */
export function buildScheduleOccurrences(args: {
  date: string;
  blocks: ScheduleBlock[];
}): ScheduleOccurrence[] {
  const dayOfWeek = getDayOfWeekForDate(args.date);
  const previousDayOfWeek = (dayOfWeek + 6) % 7;
  const previousDate = addDaysToDateString(args.date, -1);

  const sameDay = args.blocks
    .filter((block) => block.dayOfWeek === dayOfWeek && isScheduleBlockActiveOnDate(block, args.date))
    .map((block) => toScheduleOccurrence({ block, date: args.date, carriesOverFromPreviousDay: false }));

  const carriedOver = args.blocks
    .filter(
      (block) =>
        block.dayOfWeek === previousDayOfWeek &&
        block.startMinuteOfDay + block.durationMinutes > MINUTES_PER_DAY &&
        isScheduleBlockActiveOnDate(block, previousDate)
    )
    .map((block) => toScheduleOccurrence({ block, date: args.date, carriesOverFromPreviousDay: true }));

  const occurrences = [...carriedOver, ...sameDay].sort((a, b) => a.effectiveStartMinuteOfDay - b.effectiveStartMinuteOfDay);
  return applyScheduleLayers(occurrences, listDatedScheduleRanges(args.date, args.blocks));
}

/**
 * The minute ranges, relative to `date`, of the dated occurrences starting the day before, on the day and the
 * day after. The neighbours count because an undated block crossing midnight meets a dated block of the next
 * day in this day's list (weekly Mon 22:00-02:00 and a dated Tue 00:30 one).
 */
function listDatedScheduleRanges(date: string, blocks: ScheduleBlock[]): ScheduleAirWindow[] {
  const ranges: ScheduleAirWindow[] = [];
  for (const dayOffset of [-1, 0, 1]) {
    const day = dayOffset === 0 ? date : addDaysToDateString(date, dayOffset);
    const dayOfWeek = getDayOfWeekForDate(day);
    for (const block of blocks) {
      if (isScheduleBlockDated(block) && block.dayOfWeek === dayOfWeek && isScheduleBlockActiveOnDate(block, day)) {
        const start = dayOffset * MINUTES_PER_DAY + block.startMinuteOfDay;
        ranges.push({ start, end: start + block.durationMinutes });
      }
    }
  }
  return ranges;
}

function subtractScheduleRanges(range: ScheduleAirWindow, cuts: ScheduleAirWindow[]): ScheduleAirWindow[] {
  let windows: ScheduleAirWindow[] = [range];
  for (const cut of cuts) {
    windows = windows.flatMap((window) => {
      if (cut.end <= window.start || cut.start >= window.end) {
        return [window];
      }
      return [
        ...(cut.start > window.start ? [{ start: window.start, end: cut.start }] : []),
        ...(cut.end < window.end ? [{ start: cut.end, end: window.end }] : [])
      ];
    });
  }
  return windows;
}

/**
 * The dated layer over the weekly grid (M93, owner decision 5.1 Q1). Each occurrence gets its `airWindows`:
 * a dated one its whole range, an undated one its range minus the dated ranges, so weekly 18-22 under a
 * dated 20-21 airs 18-20 and 21-22. The weekly occurrence keeps its key and start minute (cuepoints count
 * from its start and are remembered by its run key); an undated occurrence that is taken over completely is
 * left out. `datedRanges` defaults to the dated occurrences in the list; `buildScheduleOccurrences` passes
 * the neighbouring days' too. Two dated occurrences do not cut each other (a save refuses that overlap).
 */
export function applyScheduleLayers(
  occurrences: ScheduleOccurrence[],
  datedRanges: ScheduleAirWindow[] = occurrences
    .filter((occurrence) => occurrence.dated)
    .map((occurrence) => getScheduleOccurrenceMinuteRange(occurrence))
): ScheduleOccurrence[] {
  const layered: ScheduleOccurrence[] = [];
  for (const occurrence of occurrences) {
    const range = getScheduleOccurrenceMinuteRange(occurrence);
    if (occurrence.dated) {
      layered.push({ ...occurrence, airWindows: [range] });
      continue;
    }
    const airWindows = subtractScheduleRanges(range, datedRanges);
    if (airWindows.length > 0) {
      layered.push({ ...occurrence, airWindows });
    }
  }
  return layered;
}

/** The air windows of an occurrence, relative to its `date`; the whole occurrence when it has none set. */
export function getScheduleOccurrenceAirWindows(occurrence: ScheduleOccurrence): ScheduleAirWindow[] {
  return occurrence.airWindows && occurrence.airWindows.length > 0
    ? occurrence.airWindows
    : [getScheduleOccurrenceMinuteRange(occurrence)];
}

/**
 * The air windows in seconds from the block's start, as `getCuepointProgress` reads them. With the
 * occurrence's `date` and the channel zone they are real seconds, like `getScheduleRunElapsedSeconds`
 * (M101): on a switch night a window's wall-clock length is an hour off.
 */
export function getScheduleOccurrenceAirWindowSeconds(
  occurrence: {
    effectiveStartMinuteOfDay: number;
    airWindows?: ScheduleAirWindow[];
    date?: string;
  },
  timeZone?: string
): ScheduleAirWindow[] | undefined {
  if (!occurrence.airWindows || occurrence.airWindows.length === 0) {
    return undefined;
  }
  const date = occurrence.date;
  if (date && timeZone) {
    const at = (minute: number, ambiguous: "earlier" | "later") =>
      getScheduleInstant({ date, seconds: minute * 60, timeZone, ambiguous }).getTime();
    const runStart = at(occurrence.effectiveStartMinuteOfDay, "earlier");
    return occurrence.airWindows.map((window) => ({
      start: Math.round((at(window.start, "earlier") - runStart) / 1000),
      end: Math.round((at(window.end, "later") - runStart) / 1000)
    }));
  }
  return occurrence.airWindows.map((window) => ({
    start: (window.start - occurrence.effectiveStartMinuteOfDay) * 60,
    end: (window.end - occurrence.effectiveStartMinuteOfDay) * 60
  }));
}

/**
 * One entry per air window, for everything that lists times (the next items, the viewer page, the Twitch plan). The
 * first window keeps the occurrence's key; a later one (the weekly block coming back after a dated one) gets
 * `<key>@<window start>`, so lists can tell the two apart. `startTime`/`endTime` are the window's;
 * `startMinuteOfDay`, `effectiveStartMinuteOfDay` and `durationMinutes` stay the block's.
 */
export type ScheduleAirSegment = ScheduleOccurrence & { airStartMinute: number; airEndMinute: number };

export function listScheduleAirSegments(occurrences: ScheduleOccurrence[]): ScheduleAirSegment[] {
  return occurrences
    .flatMap((occurrence) =>
      getScheduleOccurrenceAirWindows(occurrence).map((window, index) => ({
        ...occurrence,
        key: index === 0 ? occurrence.key : `${occurrence.key}@${window.start}`,
        startTime: formatMinuteOfDay(((window.start % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY),
        endTime: formatMinuteOfDay(((window.end % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY),
        airStartMinute: window.start,
        airEndMinute: window.end
      }))
    )
    .sort((left, right) => left.airStartMinute - right.airStartMinute);
}

/**
 * One key for the whole run of an occurrence: the key it has on the date it starts. A block crossing midnight
 * is two occurrences (the evening and the next day's carry-over) with two keys; state that belongs to the run
 * (the cuepoints already fired) is kept under this key, so it survives 00:00. Equal to `key` for an
 * occurrence that is not a carry-over.
 */
export function getScheduleOccurrenceRunKey(occurrence: {
  key: string;
  date?: string;
  blockId: string;
  startMinuteOfDay: number;
  durationMinutes: number;
  carriesOverFromPreviousDay?: boolean;
}): string {
  if (!occurrence.carriesOverFromPreviousDay || !occurrence.date) {
    return occurrence.key;
  }
  return `${addDaysToDateString(occurrence.date, -1)}:${occurrence.blockId}:${occurrence.startMinuteOfDay}:${occurrence.durationMinutes}`;
}

/**
 * Minute range an occurrence covers, relative to its `date`. The end may exceed 1440 for a block
 * that runs into the following day, and the start may be negative for a carry-over.
 */
export function getScheduleOccurrenceMinuteRange(occurrence: ScheduleOccurrence): { start: number; end: number } {
  const start = occurrence.effectiveStartMinuteOfDay;
  return { start, end: start + occurrence.durationMinutes };
}

export function isScheduleOccurrenceOnAir(occurrence: ScheduleOccurrence, minuteOfDay: number): boolean {
  return getScheduleOccurrenceAirWindows(occurrence).some((window) => minuteOfDay >= window.start && minuteOfDay < window.end);
}

function parseScheduleTimeToMinuteOfDay(value: string): number {
  const [hours, minutes] = value.split(":").map((entry) => Number(entry) || 0);
  return Math.max(0, Math.min(24 * 60 - 1, hours * 60 + minutes));
}

/**
 * The occurrence on air at `currentTime`.
 *
 * Matching is done on minute ranges rather than wall-clock strings. A string comparison cannot
 * distinguish a wrapping block's evening from its own morning: a Monday 23:00-01:00 block compared
 * as "current >= 23:00 || current < 01:00" also claimed Monday 00:30, which belongs to the block
 * that started the *previous* night.
 *
 * When several occurrences overlap, the one that started most recently wins, so a later block
 * takes over from an overrunning earlier one instead of the array order deciding.
 */
export function findCurrentScheduleOccurrence(args: {
  occurrences: ScheduleOccurrence[];
  currentTime: string;
}): ScheduleOccurrence | null {
  const currentMinuteOfDay = parseScheduleTimeToMinuteOfDay(args.currentTime);
  const active = args.occurrences.filter((item) => isScheduleOccurrenceOnAir(item, currentMinuteOfDay));

  if (active.length === 0) {
    return null;
  }

  // A dated occurrence first (M93): a weekly block that starts inside a dated window (dated 20-22, weekly
  // 21-24) must not take over at 21:00 just because it started later.
  return active.reduce((latest, item) => {
    if (Boolean(item.dated) !== Boolean(latest.dated)) {
      return item.dated ? item : latest;
    }
    return item.effectiveStartMinuteOfDay > latest.effectiveStartMinuteOfDay ? item : latest;
  });
}

export function findNextScheduleOccurrence(args: {
  occurrences: ScheduleOccurrence[];
  currentTime: string;
  currentOccurrence?: ScheduleOccurrence | null;
}): ScheduleOccurrence | null {
  return listUpcomingScheduleOccurrences(args)[0] ?? null;
}

/**
 * "What comes next" for a channel that never signs off. The single-day search answers "later
 * today"; after the last block of the evening it answered nothing, and the viewer page told a
 * 24/7 audience that nothing further was scheduled while tomorrow's programme sat in the grid.
 * Later days skip carry-overs: an occurrence spilling past midnight was already offered on the
 * day it starts.
 */
export function findNextScheduleOccurrenceAcrossDays(args: {
  blocks: ScheduleBlock[];
  date: string;
  currentTime: string;
  lookaheadDays?: number;
}): ScheduleOccurrence | null {
  const today = buildScheduleOccurrences({ date: args.date, blocks: args.blocks });
  const next = findNextScheduleOccurrence({ occurrences: today, currentTime: args.currentTime });
  if (next) {
    return next;
  }

  const lookaheadDays = args.lookaheadDays ?? 7;
  for (let offset = 1; offset <= lookaheadDays; offset += 1) {
    const date = addDaysToDateString(args.date, offset);
    const candidate = listScheduleAirSegmentsStartingOn(date, args.blocks)[0];
    if (candidate) {
      return candidate;
    }
  }

  return null;
}

/**
 * The next `limit` occurrences after `currentTime`, across days, in airing order. The first is what
 * `findNextScheduleOccurrenceAcrossDays` answers; the rest are what follows it. Later days skip
 * carry-overs for the same reason: an occurrence spilling past midnight was already listed on the day
 * it starts.
 */
export function listUpcomingScheduleOccurrencesAcrossDays(args: {
  blocks: ScheduleBlock[];
  date: string;
  currentTime: string;
  limit: number;
  lookaheadDays?: number;
}): ScheduleOccurrence[] {
  const limit = Math.max(0, Math.trunc(args.limit));
  if (limit === 0) {
    return [];
  }

  // Ordered by the minute each entry starts counted from today's 00:00: a window of today's list may start
  // after midnight (a weekly block resuming at 01:00 after a dated one) and so after tomorrow's first entry.
  const upcoming = listUpcomingScheduleOccurrences({
    occurrences: buildScheduleOccurrences({ date: args.date, blocks: args.blocks }),
    currentTime: args.currentTime
  }).map((segment) => ({ segment, at: segment.airStartMinute }));
  const lookaheadDays = args.lookaheadDays ?? 7;
  for (let offset = 1; offset <= lookaheadDays && upcoming.length < limit; offset += 1) {
    const date = addDaysToDateString(args.date, offset);
    upcoming.push(
      ...listScheduleAirSegmentsStartingOn(date, args.blocks).map((segment) => ({
        segment,
        at: offset * MINUTES_PER_DAY + segment.airStartMinute
      }))
    );
  }

  return upcoming
    .sort((left, right) => left.at - right.at)
    .slice(0, limit)
    .map((entry) => entry.segment);
}

export function listUpcomingScheduleOccurrences(args: {
  occurrences: ScheduleOccurrence[];
  currentTime: string;
  currentOccurrence?: ScheduleOccurrence | null;
}): ScheduleAirSegment[] {
  if (args.occurrences.length === 0) {
    return [];
  }

  const currentMinuteOfDay = parseScheduleTimeToMinuteOfDay(args.currentTime);
  const currentOccurrence = args.currentOccurrence ?? findCurrentScheduleOccurrence(args);
  // By air window (M93): a weekly block coming back after a dated one is upcoming at the minute it comes
  // back. The window start is relative to the date like effectiveStartMinuteOfDay, so a carry-over from
  // last night is never offered as "upcoming".
  // A window that starts after midnight (a weekly block resuming at 01:00 after a dated one) is listed on
  // the next date, where it is a carry-over window starting at 60, so a today-only list never offers it
  // ahead of a dated block that starts on the next date before it.
  return listScheduleAirSegments(args.occurrences).filter(
    (item) =>
      item.airStartMinute > currentMinuteOfDay &&
      item.airStartMinute < MINUTES_PER_DAY &&
      item.key !== currentOccurrence?.key
  );
}

/** The windows that start on `date`, from 00:00 on: what a later day adds to a list of what comes next. */
function listScheduleAirSegmentsStartingOn(date: string, blocks: ScheduleBlock[]): ScheduleAirSegment[] {
  return listScheduleAirSegments(buildScheduleOccurrences({ date, blocks })).filter(
    (segment) => segment.airStartMinute >= 0 && segment.airStartMinute < MINUTES_PER_DAY
  );
}

function extractFormatterParts(args: { instant: Date; timeZone: string }) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: args.timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  });

  const parts = formatter.formatToParts(args.instant);
  const read = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value ?? "0");

  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    hour: read("hour"),
    minute: read("minute"),
    second: read("second")
  };
}

/**
 * The instant a moment of the schedule falls on: `seconds` from 00:00 of `date` in the channel zone. Past
 * 86 400 is a later day, below 0 the day before, so an item after midnight or a block carried over from the
 * evening before reads right (M100).
 */
export function getScheduleInstant(args: {
  date: string;
  seconds: number;
  timeZone: string;
  ambiguous?: "earlier" | "later";
}): Date {
  const dayOffset = Math.floor(args.seconds / 86_400);
  const secondOfDay = args.seconds - dayOffset * 86_400;
  const minuteOfDay = Math.floor(secondOfDay / 60);
  const start = toUtcIsoForLocalDateTime({
    date: addDaysToDateString(args.date, dayOffset),
    minuteOfDay,
    timeZone: args.timeZone,
    ambiguous: args.ambiguous
  });
  return new Date(Date.parse(start) + (secondOfDay - minuteOfDay * 60) * 1000);
}

/**
 * Whole minutes from `now` until a scheduled block starts (M100, V7: "in 25 min" on the on-air Next card),
 * or null when it has no date or has started. Reads the air window's start (`airStartMinute`) where the
 * block comes back after a dated one.
 */
export function getScheduleStartsInMinutes(
  item: { date?: string; airStartMinute?: number; effectiveStartMinuteOfDay?: number; startMinuteOfDay?: number } | null | undefined,
  now: Date,
  timeZone: string
): number | null {
  const minute = item?.airStartMinute ?? item?.effectiveStartMinuteOfDay ?? item?.startMinuteOfDay;
  if (!item?.date || typeof minute !== "number" || !Number.isFinite(minute)) {
    return null;
  }
  const startsAt = getScheduleInstant({ date: item.date, seconds: minute * 60, timeZone });
  const minutes = Math.ceil((startsAt.getTime() - now.getTime()) / 60_000);
  return minutes > 0 ? minutes : null;
}

/**
 * Which instant a wall-clock time of the channel zone names (M101, R3 C5). Blocks follow the wall clock
 * (owner decision R3 Q4), so the switch nights need two rules:
 * - a time that does not exist (02:30 on the spring-forward night in Europe/Berlin) maps forward by the
 *   length of the gap: 02:30 on 2026-03-29 is 03:30 CEST (`01:30Z`). Before M101 it mapped one hour early,
 *   to 01:30 CET (`00:30Z`), while the block before was still on air
 * - a time that exists twice (02:30 on the fall-back night) is its first occurrence by default (`00:30Z` on
 *   2026-10-25), because a block in the repeated hour starts airing then; `ambiguous: "later"` gives the
 *   second (`01:30Z`), which is where a block ending in that hour stops airing
 */
export function toUtcIsoForLocalDateTime(args: {
  date: string;
  minuteOfDay: number;
  timeZone: string;
  ambiguous?: "earlier" | "later";
}): string {
  const [yearText, monthText, dayText] = args.date.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Math.floor(args.minuteOfDay / 60);
  const minute = args.minuteOfDay % 60;
  const desiredAsUtc = Date.UTC(year, month - 1, day, hour, minute, 0);
  const offsetAt = (instantMs: number) => {
    const zoned = extractFormatterParts({ instant: new Date(instantMs), timeZone: args.timeZone });
    const zonedAsUtc = Date.UTC(zoned.year, zoned.month - 1, zoned.day, zoned.hour, zoned.minute, zoned.second);
    return zonedAsUtc - (instantMs - (((instantMs % 1000) + 1000) % 1000));
  };

  // A zone changes its offset at most once within a day, so the offsets a day before and a day after are
  // the only candidates.
  const offsetBefore = offsetAt(desiredAsUtc - 86_400_000);
  const offsetAfter = offsetAt(desiredAsUtc + 86_400_000);
  const matches = [...new Set([offsetBefore, offsetAfter])]
    .map((offset) => desiredAsUtc - offset)
    .filter((candidate) => candidate + offsetAt(candidate) === desiredAsUtc)
    .sort((left, right) => left - right);

  if (matches.length > 0) {
    return new Date(args.ambiguous === "later" ? matches[matches.length - 1] : matches[0]).toISOString();
  }

  // In the gap: read the time with the offset that held before it, which lands as far past the switch as
  // the time lies past its start.
  return new Date(desiredAsUtc - offsetBefore).toISOString();
}

export type DestinationRoutingRecord = {
  id: string;
  name: string;
  role: "primary" | "backup";
  priority: number;
  enabled: boolean;
  streamKeyPresent: boolean;
  status: DestinationRoutingStatus;
};

export type DestinationRoutingSelection = {
  mode: "primary" | "backup" | "none";
  activeDestinationIds: string[];
  leadDestinationId: string;
};

// Shorter window keeps single-destination outages bounded (the May 28 dest=error stuck shape).
// With one Twitch destination there is no other output to "flap" to, so a longer cooldown only
// extends the user-visible broadcastReady=false window without preventing connection thrashing.
export const DEFAULT_DESTINATION_FAILURE_COOLDOWN_SECONDS = 60;

export function getDestinationFailureSecondsRemaining(
  lastFailureAt: string,
  cooldownSeconds = DEFAULT_DESTINATION_FAILURE_COOLDOWN_SECONDS,
  nowMs = Date.now()
): number {
  const normalizedCooldownSeconds = Number.isFinite(cooldownSeconds) && cooldownSeconds > 0
    ? cooldownSeconds
    : DEFAULT_DESTINATION_FAILURE_COOLDOWN_SECONDS;
  if (!lastFailureAt) {
    return 0;
  }

  const failureMs = new Date(lastFailureAt).getTime();
  if (!Number.isFinite(failureMs)) {
    return 0;
  }

  const remainingMs = normalizedCooldownSeconds * 1000 - (nowMs - failureMs);
  if (remainingMs <= 0) {
    return 0;
  }

  return Math.ceil(remainingMs / 1000);
}

export function isDestinationFailureCoolingDown(
  status: DestinationRoutingStatus,
  lastFailureAt: string,
  cooldownSeconds = DEFAULT_DESTINATION_FAILURE_COOLDOWN_SECONDS,
  nowMs = Date.now()
): boolean {
  return status === "error" && getDestinationFailureSecondsRemaining(lastFailureAt, cooldownSeconds, nowMs) > 0;
}

export function selectActiveDestinationGroup(destinations: DestinationRoutingRecord[]): DestinationRoutingSelection {
  const ordered = [...destinations]
    .filter((destination) => destination.enabled && destination.streamKeyPresent)
    .sort((left, right) => left.priority - right.priority || left.name.localeCompare(right.name));

  const primaryHealthy = ordered.filter((destination) => destination.role === "primary" && destination.status === "ready");
  if (primaryHealthy.length > 0) {
    return {
      mode: "primary",
      activeDestinationIds: primaryHealthy.map((destination) => destination.id),
      leadDestinationId: primaryHealthy[0]?.id || ""
    };
  }

  const backupHealthy = ordered.filter((destination) => destination.role === "backup" && destination.status === "ready");
  if (backupHealthy.length > 0) {
    return {
      mode: "backup",
      activeDestinationIds: backupHealthy.map((destination) => destination.id),
      leadDestinationId: backupHealthy[0]?.id || ""
    };
  }

  const primaryConfigured = ordered.filter((destination) => destination.role === "primary");
  if (primaryConfigured.length > 0) {
    return {
      mode: "primary",
      activeDestinationIds: primaryConfigured.map((destination) => destination.id),
      leadDestinationId: primaryConfigured[0]?.id || ""
    };
  }

  const backupConfigured = ordered.filter((destination) => destination.role === "backup");
  if (backupConfigured.length > 0) {
    return {
      mode: "backup",
      activeDestinationIds: backupConfigured.map((destination) => destination.id),
      leadDestinationId: backupConfigured[0]?.id || ""
    };
  }

  return {
    mode: "none",
    activeDestinationIds: [],
    leadDestinationId: ""
  };
}

export { redactSecrets, redactSecretsDeep } from "./redact.js";

/**
 * An asset's display title: the replay prefix and the title, with nothing invisible in between.
 *
 * Written three times before this — apps/worker/src/asset-display-title.ts,
 * apps/web/lib/asset-metadata.ts and a private copy inside apps/web/lib/server/state.ts. They
 * agreed, which was luck rather than design, and the chapter-aware title below has to build the
 * same string or the studio and the channel disagree about a name for a second reason.
 */
export function overlayAssetDisplayTitle(
  asset: { title?: string; titlePrefix?: string } | null | undefined,
  fallbackTitle = ""
): string {
  const base = stripInvisibleCharacters(String(asset?.title || fallbackTitle || "")).trim();
  return [stripInvisibleCharacters(asset?.titlePrefix || "").trim(), base].filter(Boolean).join(" ").trim();
}

/**
 * The chapter-aware display title for the asset that is on air right now.
 *
 * Derived from elapsed playback rather than from the boundary fired set, so every overlay rewrite —
 * the 15s cycle, an operator refresh, a scene re-render — shows the chapter that is actually
 * playing instead of the one that was current at the last boundary event.
 *
 * Empty when the asset is not the one on air, has no chapters, or the active chapter carries no
 * title; callers then fall back to the asset title exactly as before chapters existed. Empty is
 * also the answer before the first chapter's offset: the asset's own metadata stays authoritative
 * there rather than a synthetic chapter being invented.
 *
 * It lives here because the worker had it and the web app did not, so the channel named the chapter
 * that was playing while the studio preview named the file. The preview exists to show what airs.
 */
export function overlayOnAirChapterTitle(args: {
  /** state.playout.currentAssetId — which asset the channel is actually on. */
  currentAssetId: string;
  /** state.playout.processStartedAt, ISO; empty means nothing has started. */
  processStartedAt: string;
  asset: { id: string; chaptersJson?: string; titlePrefix?: string } | null | undefined;
  /** Injected so a render can be made repeatable. */
  now?: Date;
}): string {
  const { asset } = args;
  if (!asset || args.currentAssetId !== asset.id || args.processStartedAt === "") {
    return "";
  }

  const chapters = parseAssetChaptersJson(asset.chaptersJson);
  if (chapters.length === 0) {
    return "";
  }

  const startedAt = new Date(args.processStartedAt).getTime();
  if (!Number.isFinite(startedAt)) {
    return "";
  }

  const elapsedSeconds = Math.max(0, Math.floor(((args.now ?? new Date()).getTime() - startedAt) / 1000));
  const chapter = getAssetChapterAt(chapters, elapsedSeconds);
  if (!chapter || chapter.title === "") {
    return "";
  }

  // The replay prefix stays: a chapter changes what plays, not the fact that it is a replay.
  return overlayAssetDisplayTitle({ title: chapter.title, titlePrefix: asset.titlePrefix });
}

/**
 * The audit entries a trail exists for, as one pattern.
 *
 * Every entry used to compete for a single window of the newest 500, so the trail was only as long
 * as the noisiest thing writing to it. Measured on the live channel: 142 entries over 31 hours, of
 * which 100 were `uplink.cycle` and `worker.cycle` — 70% reconciliation chatter. At that rate the
 * window fills in about four days and a sign-in is then pushed out by an uplink reconnecting.
 *
 * What is protected: authentication, authorisation, credentials, where the stream is sent, who
 * silenced an alarm, and destructive deletions. What is NOT: skipping an item, publishing an
 * overlay, updating an asset. That line is deliberate — protecting every operator action protects
 * nothing, because the protected window would fill with the same traffic the general one does.
 *
 * Written as one POSIX-compatible pattern so `type ~ $pattern` in the pruning SQL and the predicate
 * below cannot drift into disagreeing. No lookaround, no non-greedy quantifiers: anchors,
 * alternation and literal dots only.
 *
 * The deletion clause takes a dot OR an underscore: the vocabulary writes both, `source.deleted`
 * and `overlay.video_source_deleted`, and a rule that only knew the dot left the second kind
 * unprotected — found by the test, not by reading.
 */
export const AUDIT_EVENT_PROTECTED_PATTERN =
  "^(auth|team|destination|incident)\\.|^setup\\.completed$|^settings\\.(managed-config|twitch-app)\\.updated$|^overlay\\.video_source_key_issued$|^twitch\\.(connected|error|broadcaster\\.error)$|[._]deleted$";

/**
 * Compiled once. selectRetainedAuditEvents asks this per entry over as many as a thousand of them,
 * inside the serialized state write, so building the expression per call would put a thousand
 * regular-expression compilations on every mutation the channel makes.
 */
const AUDIT_EVENT_PROTECTED = new RegExp(AUDIT_EVENT_PROTECTED_PATTERN);

/** Whether an audit entry of this type survives pruning on its own account. */
export function isProtectedAuditEventType(type: string): boolean {
  return AUDIT_EVENT_PROTECTED.test(type);
}

/**
 * The audit entries that survive pruning: the newest of everything, plus the newest of what an
 * audit trail exists for.
 *
 * Two windows rather than one, because a single window is only as long as the noisiest writer.
 * Both are bounded, so neither can grow without end — a channel that somehow produced nothing but
 * sign-ins still keeps a fixed number of them.
 *
 * Input order is preserved, so a store that holds its trail newest first gets it back newest first.
 * Expressed here as well as in SQL because the two writers work differently: one appends a row and
 * prunes around it, the other rewrites the whole table from memory.
 */
export function selectRetainedAuditEvents<T extends { type: string }>(
  events: T[],
  limits: { general: number; protected: number }
): T[] {
  const keep = new Set<number>();
  for (let index = 0; index < events.length && index < limits.general; index++) {
    keep.add(index);
  }

  let protectedKept = 0;
  for (let index = 0; index < events.length && protectedKept < limits.protected; index++) {
    if (isProtectedAuditEventType(events[index]!.type)) {
      keep.add(index);
      protectedKept++;
    }
  }

  return events.filter((_event, index) => keep.has(index));
}

/** Whether the line the encoder is moving is still the line the operator has configured. */
export type TickerCrawlStaleness =
  | { stale: false }
  | { stale: true; onAir: string; configured: string };

/**
 * Whether a ticker edit has reached the screen, or is waiting for the next programme.
 *
 * The crawling line is one image, made when a programme starts, and the period the encoder moves it
 * by comes from that line's own ink — so a new text needs a new graph, and the graph is fixed for
 * the life of the process. A few minutes on a channel playing assets. On the standby slate or a
 * live bridge, which run until the selection changes, there may be no next programme at all.
 *
 * This does not fix that. It makes it visible, which is the difference between a documented
 * limitation and a silent one: without it the operator types a correction, watches the studio
 * preview update, and has no way to learn that the channel is still running the old line.
 *
 * An empty crawl line means nothing is crawling, so whatever the payload says is drawn at rest and
 * is by definition current. An empty payload line against a running crawl is NOT quiet: clearing
 * the field does not take the line away, because the band belongs to the process while a crawl
 * runs, so the old text keeps going over the video.
 */
export function describeTickerCrawlStaleness(args: { crawlLine: string; payloadLine: string }): TickerCrawlStaleness {
  const onAir = args.crawlLine.trim();
  if (!onAir) {
    return { stale: false };
  }
  const configured = args.payloadLine.trim();
  return onAir === configured ? { stale: false } : { stale: true, onAir, configured };
}
