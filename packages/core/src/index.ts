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
export type OverlaySceneLayerKind = "chip" | "hero" | "next" | "queue" | "schedule" | "clock" | "banner" | "ticker";

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
  layers: OverlaySceneLayerDefinition[];
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
  emergencyBanner: string;
  timeZone: string;
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
  showClock: boolean;
  showNextItem: boolean;
  showScheduleTeaser: boolean;
  showCurrentCategory: boolean;
  showSourceLabel: boolean;
  showQueuePreview: boolean;
  queuePreviewCount: number;
  emergencyBanner: string;
  tickerText: string;
  layerOrder: OverlaySceneLayerKind[];
  disabledLayers: OverlaySceneLayerKind[];
};

export type OverlayOptionDefinition<T extends string> = {
  id: T;
  label: string;
  description: string;
};

export type ScheduleRepeatMode = "single" | "daily" | "weekdays" | "weekends" | "custom";

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
    categoryName: string;
    dayOfWeek: number;
    showId?: string;
    poolId?: string;
    sourceName: string;
    repeatMode?: ScheduleRepeatMode;
    reason: string;
  }>;
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
  repeatMode?: ScheduleRepeatMode;
  repeatGroupId?: string;
  cuepointAssetId?: string;
  cuepointOffsetsSeconds?: number[];
};

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
    label: "Single day",
    description: "Keep this block on one weekday only."
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

export function buildOverlayBrandLine(replayLabel: string, brandBadge = ""): string {
  const parts = [replayLabel || "Replay stream", brandBadge].map((part) => part.trim()).filter(Boolean);
  return parts.join(" · ");
}

export function resolveOverlayHeadlineForQueueKind(
  headline: string,
  queueKind: OverlayQueueKind,
  overrides?: Partial<Pick<OverlaySceneSource, "insertHeadline" | "standbyHeadline" | "reconnectHeadline">>
): string {
  if (queueKind === "insert") {
    return String(overrides?.insertHeadline || "Insert on air").trim() || "Insert on air";
  }

  if (queueKind === "reconnect") {
    return String(overrides?.reconnectHeadline || "Scheduled reconnect in progress").trim() || "Scheduled reconnect in progress";
  }

  if (queueKind === "standby") {
    return String(overrides?.standbyHeadline || headline || "Please wait, restream is starting").trim() || "Please wait, restream is starting";
  }

  return String(headline || "Always on air").trim() || "Always on air";
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
    banner: Boolean(args.overlay.emergencyBanner.trim()),
    ticker: Boolean(args.overlay.tickerText.trim())
  };

  return {
    presetId: args.overlay.scenePreset,
    resolvedPresetId,
    surfaceStyle: args.overlay.surfaceStyle,
    panelAnchor: args.overlay.panelAnchor,
    titleScale: args.overlay.titleScale,
    layers: normalizedLayerOrder.map((kind) => ({
      kind,
      label: OVERLAY_SCENE_LAYERS.find((layer) => layer.id === kind)?.label || kind,
      enabled: enabledMap[kind] && !disabledLayers.has(kind)
    }))
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
}): OverlayScenePayload {
  const scene = buildOverlaySceneDefinition({
    overlay: args.overlay,
    queueKind: args.queueKind
  });
  const heroLabel =
    args.queueKind === "insert"
      ? "Insert On Air"
      : args.queueKind === "live"
        ? "Live Now"
      : args.queueKind === "reconnect"
        ? "Reconnect Window"
        : args.queueKind === "standby"
          ? "Standby"
          : "Now Playing";
  const heroBody =
    args.modeSubtitle ||
    resolveOverlayHeadlineForQueueKind(args.overlay.headline, args.queueKind, {
      insertHeadline: args.overlay.insertHeadline,
      standbyHeadline: args.overlay.standbyHeadline,
      reconnectHeadline: args.overlay.reconnectHeadline
    });
  const nextLabel =
    args.queueKind === "insert"
      ? "After Insert"
      : args.queueKind === "reconnect"
        ? "Returning With"
        : args.queueKind === "live"
          ? "After Live"
          : "Next";
  const queueTitles = (args.queueTitles || []).filter(Boolean).slice(0, args.overlay.queuePreviewCount);
  const metaLine = [
    (args.queueKind === "asset" || args.queueKind === "live") && args.overlay.showCurrentCategory ? args.currentCategory || "" : "",
    (args.queueKind === "asset" || args.queueKind === "live") && args.overlay.showSourceLabel ? args.currentSourceName || "" : ""
  ]
    .filter(Boolean)
    .join(" · ");
  const scheduleBody =
    args.queueKind === "asset"
      ? args.currentCategory || "Always on air"
      : args.queueKind === "live"
        ? heroBody || "Live bridge is on air."
        : heroBody || "Programming will resume shortly";
  const scheduleAux =
    args.queueKind === "asset"
      ? args.currentSourceName || "Source to be announced"
      : args.queueKind === "live"
        ? args.nextTitle || "Schedule resumes after live mode"
      : args.nextTitle || "Programming will resume shortly";

  return {
    target: args.target,
    queueKind: args.queueKind,
    scene,
    channelName: args.overlay.channelName,
    accentColor: args.overlay.accentColor,
    brandLine: buildOverlayBrandLine(args.overlay.replayLabel, args.overlay.brandBadge),
    heroLabel,
    heroTitle: args.currentTitle || "Stream247",
    heroBody,
    metaLine,
    nextLabel,
    nextTitle: args.nextTitle || "Schedule not available",
    nextTimeLabel: args.nextTimeLabel || "No next block configured",
    queueTitleLine: queueTitles.join(" · "),
    queueTitles,
    scheduleLabel: "Scene",
    scheduleTitle: args.currentTitle || "Stand by",
    scheduleBody,
    scheduleAux,
    tickerText: args.overlay.tickerText.trim(),
    emergencyBanner: args.overlay.emergencyBanner.trim(),
    timeZone: args.timeZone || "UTC"
  };
}

export function buildOverlayTextLinesFromScenePayload(payload: OverlayScenePayload): string[] {
  const tickerLine = payload.tickerText;

  if (payload.scene.resolvedPresetId === "minimal-chip") {
    return [payload.brandLine, `Now: ${payload.heroTitle}`, payload.metaLine, tickerLine].filter(Boolean);
  }

  if (payload.scene.resolvedPresetId === "bumper-board") {
    return [
      payload.brandLine,
      payload.heroBody || "Insert on air",
      `Insert: ${payload.heroTitle}`,
      `Next: ${payload.nextTitle}`,
      payload.queueTitleLine ? `After this: ${payload.queueTitleLine}` : "",
      tickerLine
    ].filter(Boolean);
  }

  if (payload.scene.resolvedPresetId === "reconnect-board") {
    return [
      payload.brandLine,
      payload.heroBody || "Scheduled reconnect in progress",
      `Resuming with: ${payload.nextTitle}`,
      payload.queueTitleLine ? `Queue: ${payload.queueTitleLine}` : "",
      tickerLine
    ].filter(Boolean);
  }

  if (payload.scene.resolvedPresetId === "split-now-next") {
    return [payload.brandLine, `Now: ${payload.heroTitle}`, `Next: ${payload.nextTitle}`, payload.metaLine, tickerLine].filter(Boolean);
  }

  if (payload.scene.resolvedPresetId === "standby-board") {
    return [
      payload.brandLine,
      payload.heroBody || "Please wait, restream is starting",
      `Current: ${payload.heroTitle}`,
      `Next: ${payload.nextTitle}`,
      payload.queueTitleLine ? `Later: ${payload.queueTitleLine}` : "",
      tickerLine
    ].filter(Boolean);
  }

  return [
    payload.brandLine,
    `Now: ${payload.heroTitle}`,
    payload.metaLine,
    `Next: ${payload.nextTitle}`,
    payload.queueTitleLine ? `Queue: ${payload.queueTitleLine}` : "",
    payload.queueKind === "standby" ? payload.heroBody || "Please wait, restream is starting" : "",
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
        showClock: true,
        showNextItem: true,
        showScheduleTeaser: true,
        showQueuePreview: args.showQueuePreview ?? false,
        queuePreviewCount: Math.max((args.queueTitles || []).length, 1),
        emergencyBanner: "",
        tickerText: args.tickerText || "",
        layerOrder: DEFAULT_OVERLAY_SCENE_LAYER_ORDER,
        disabledLayers: [],
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
      modeSubtitle: args.headline
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
      return dayLabels[Math.max(0, Math.min(6, Math.trunc(anchorDayOfWeek)))] || "Single day";
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
  const { actor, input, now, config } = args;

  if (!config.enabled) {
    return null;
  }

  const prefix = config.requirePrefix ? "!" : "";
  const match = input.trim().match(new RegExp(`^${prefix}${config.command}(?:\\s+(\\d+))?$`, "i"));

  if (!match) {
    return null;
  }

  const rawMinutes = match[1] ? Number(match[1]) : config.defaultMinutes;

  if (!Number.isFinite(rawMinutes)) {
    return null;
  }

  const minutes = Math.min(config.maxMinutes, Math.max(config.minMinutes, rawMinutes));

  return {
    actor,
    minutes,
    createdAt: now,
    expiresAt: new Date(now.getTime() + minutes * 60_000)
  };
}

export function describePresenceStatus(args: {
  activeWindows: PresenceWindow[];
  now: Date;
  fallbackEmoteOnly: boolean;
}): PresenceStatus {
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

export function buildSchedulePreview(args: {
  date: string;
  blocks: ScheduleBlock[];
}): SchedulePreview {
  const items = buildScheduleOccurrences(args).map((occurrence) => ({
    id: occurrence.blockId,
    title: occurrence.title,
    startTime: occurrence.startTime,
    endTime: occurrence.endTime,
    categoryName: occurrence.categoryName,
    dayOfWeek: occurrence.dayOfWeek,
    poolId: occurrence.poolId,
    showId: occurrence.showId,
    sourceName: occurrence.sourceName,
    reason: `Selected from ${occurrence.sourceName} for ${occurrence.durationMinutes} minutes · ${describeScheduleRepeatMode(occurrence.repeatMode ?? "single", occurrence.dayOfWeek)}.`
  }));

  return { date: args.date, items };
}

type MaterializedPoolRecord = {
  id: string;
  name: string;
  sourceIds: string[];
  cursorAssetId: string;
  insertAssetId: string;
  insertEveryItems: number;
  itemsSinceInsert: number;
  audioLaneAssetId?: string;
  audioLaneVolumePercent?: number;
};

type MaterializedAssetRecord = {
  id: string;
  sourceId: string;
  title: string;
  status: string;
  includeInProgramming: boolean;
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

export function getCuepointProgress(args: {
  occurrenceKey: string;
  cuepointOffsetsSeconds: number[];
  firedCuepointKeys: string[];
  elapsedSeconds: number;
}) {
  const normalizedOffsets = normalizeCuepointOffsetsSeconds(args.cuepointOffsetsSeconds);
  const fired = new Set(args.firedCuepointKeys);
  const dueOffsetSeconds =
    normalizedOffsets.find((offset) => offset <= args.elapsedSeconds && !fired.has(buildCuepointKey(args.occurrenceKey, offset))) ?? null;
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

function sortPoolAssets<T extends Pick<MaterializedAssetRecord, "publishedAt" | "createdAt" | "title">>(assets: T[]): T[] {
  return assets.slice().sort((left, right) => {
    const publishedDelta =
      new Date(left.publishedAt || left.createdAt).getTime() - new Date(right.publishedAt || right.createdAt).getTime();
    if (publishedDelta !== 0) {
      return publishedDelta;
    }

    return left.title.localeCompare(right.title);
  });
}

function materializePoolWindow(args: {
  block: ScheduleOccurrence;
  pool: MaterializedPoolRecord | null;
  assets: MaterializedAssetRecord[];
  maxQueuePreviewItems: number;
}): MaterializedProgrammingBlock {
  const excludedAssetIds = new Set<string>();
  if (args.pool?.insertAssetId && Math.max(args.pool?.insertEveryItems ?? 0, 0) > 0) {
    excludedAssetIds.add(args.pool.insertAssetId);
  }
  if (args.pool?.audioLaneAssetId) {
    excludedAssetIds.add(args.pool.audioLaneAssetId);
  }
  const poolName = args.pool?.name || args.block.sourceName || "Unassigned pool";
  const eligibleAssets = args.pool
    ? sortPoolAssets(
        args.assets.filter(
          (asset) =>
            asset.status === "ready" &&
            asset.includeInProgramming !== false &&
            args.pool?.sourceIds.includes(asset.sourceId) &&
            !excludedAssetIds.has(asset.id)
        )
      )
    : [];
  const insertAsset =
    args.pool?.insertAssetId && args.pool.insertEveryItems > 0
      ? eligibleAssets.find((asset) => asset.id === args.pool?.insertAssetId) ??
        args.assets.find(
          (asset) => asset.id === args.pool?.insertAssetId && asset.status === "ready" && asset.includeInProgramming !== false
        ) ??
        null
      : null;
  const cuepointOffsetsSeconds = normalizeCuepointOffsetsSeconds(args.block.cuepointOffsetsSeconds ?? [], args.block.durationMinutes);
  const cuepointAsset =
    args.block.cuepointAssetId && cuepointOffsetsSeconds.length > 0
      ? args.assets.find(
          (asset) => asset.id === args.block.cuepointAssetId && asset.status === "ready" && asset.includeInProgramming !== false
        ) ?? null
      : cuepointOffsetsSeconds.length > 0
        ? insertAsset
        : null;
  const notes: string[] = [];

  if (!args.pool) {
    notes.push("No pool is linked to this block.");
  }

  if (eligibleAssets.length === 0) {
    notes.push("The selected pool has no ready programming assets.");
  }

  let itemsSinceInsert = Math.max(args.pool?.itemsSinceInsert ?? 0, 0);
  let currentIndex = args.pool?.cursorAssetId ? eligibleAssets.findIndex((asset) => asset.id === args.pool?.cursorAssetId) : -1;
  const blockSeconds = Math.max(args.block.durationMinutes, 15) * 60;
  const items: MaterializedProgrammingItem[] = [];
  const queuePreview: string[] = [];
  const assetUseCounts = new Map<string, number>();
  let projectedSeconds = 0;
  let uniqueSeconds = 0;
  let insertCount = 0;
  let cuepointCount = 0;
  let estimatedDurationCount = 0;
  let repeatedRegularAsset = false;
  const firedCuepointOffsets = new Set<number>();

  for (let safety = 0; safety < maxMaterializedItemsPerBlock && projectedSeconds < blockSeconds; safety += 1) {
    if (eligibleAssets.length === 0) {
      break;
    }

    const dueCuepointOffset =
      cuepointAsset && cuepointOffsetsSeconds.length > 0
        ? cuepointOffsetsSeconds.find((offset) => offset <= projectedSeconds && !firedCuepointOffsets.has(offset)) ?? null
        : null;
    const shouldInsert =
      dueCuepointOffset !== null ||
      (Boolean(insertAsset) &&
        Math.max(args.pool?.insertEveryItems ?? 0, 0) > 0 &&
        itemsSinceInsert >= Math.max(args.pool?.insertEveryItems ?? 0, 0));
    const nextAsset =
      dueCuepointOffset !== null
        ? cuepointAsset
        : shouldInsert
          ? insertAsset
        : eligibleAssets[(currentIndex + 1 + eligibleAssets.length) % eligibleAssets.length] ?? eligibleAssets[0];

    if (!nextAsset) {
      break;
    }

    if (!shouldInsert) {
      currentIndex = eligibleAssets.findIndex((asset) => asset.id === nextAsset.id);
    }

    const { durationSeconds, estimated } = getMaterializedAssetDurationSeconds(nextAsset);
    const itemStartSeconds = projectedSeconds;
    projectedSeconds += durationSeconds;
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

    items.push({
      kind: shouldInsert ? "insert" : "asset",
      assetId: nextAsset.id,
      title: nextAsset.title,
      durationMinutes: Math.max(1, Math.ceil(durationSeconds / 60)),
      startTime: formatMinuteOfDay(args.block.startMinuteOfDay + Math.floor(itemStartSeconds / 60)),
      endTime: formatMinuteOfDay(args.block.startMinuteOfDay + Math.ceil(projectedSeconds / 60)),
      overflow: projectedSeconds > blockSeconds,
      repeated,
      estimatedDuration: estimated,
      insertTrigger: shouldInsert ? (dueCuepointOffset !== null ? "cuepoint" : "pool-interval") : undefined
    });

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

  const fillStatus =
    items.length === 0
      ? "empty"
      : repeatedRegularAsset || projectedSeconds < blockSeconds
        ? "underfilled"
        : projectedSeconds > blockSeconds
          ? "overflow"
          : "balanced";
  const overflowMinutes = Math.max(0, Math.ceil((projectedSeconds - blockSeconds) / 60));
  const fillLabel =
    fillStatus === "empty"
      ? "No playable material"
      : fillStatus === "underfilled"
        ? "Repeats inside block"
        : fillStatus === "overflow"
          ? `Ends ${overflowMinutes}m late`
          : "Balanced window";

  return {
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
    projectedMinutes: Math.ceil(projectedSeconds / 60),
    overflowMinutes,
    uniqueMinutes: Math.ceil(uniqueSeconds / 60),
    insertCount,
    cuepointCount,
    queuePreview,
    notes,
    items
  };
}

export function buildMaterializedProgrammingWeek(args: {
  startDate: string;
  blocks: ScheduleBlock[];
  pools: MaterializedPoolRecord[];
  assets: MaterializedAssetRecord[];
  maxQueuePreviewItems?: number;
}): MaterializedProgrammingDay[] {
  return Array.from({ length: 7 }, (_, offset) => {
    const date = addDaysToDateString(args.startDate, offset);
    const occurrences = buildScheduleOccurrences({
      date,
      blocks: args.blocks
    });
    const blocks = occurrences.map((occurrence) =>
      materializePoolWindow({
        block: occurrence,
        pool: args.pools.find((pool) => pool.id === occurrence.poolId) ?? null,
        assets: args.assets,
        maxQueuePreviewItems: args.maxQueuePreviewItems ?? 4
      })
    );

    return {
      date,
      dayOfWeek: getDayOfWeekForDate(date),
      totalScheduledMinutes: blocks.reduce((total, block) => total + block.durationMinutes, 0),
      totalProjectedMinutes: blocks.reduce((total, block) => total + block.projectedMinutes, 0),
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
}) {
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

  return null;
}

export function findScheduleConflicts(blocks: Array<ScheduleBlock>): string[] {
  const conflicts = new Set<string>();

  for (let index = 0; index < blocks.length; index += 1) {
    const current = blocks[index];
    if (!current) {
      continue;
    }

    const currentRanges =
      current.startMinuteOfDay + current.durationMinutes <= 24 * 60
        ? [[current.startMinuteOfDay, current.startMinuteOfDay + current.durationMinutes]]
        : [
            [current.startMinuteOfDay, 24 * 60],
            [0, (current.startMinuteOfDay + current.durationMinutes) % (24 * 60)]
          ];

    for (let compareIndex = index + 1; compareIndex < blocks.length; compareIndex += 1) {
      const candidate = blocks[compareIndex];
      if (!candidate) {
        continue;
      }

      if (candidate.dayOfWeek !== current.dayOfWeek) {
        continue;
      }

      const candidateRanges =
        candidate.startMinuteOfDay + candidate.durationMinutes <= 24 * 60
          ? [[candidate.startMinuteOfDay, candidate.startMinuteOfDay + candidate.durationMinutes]]
          : [
              [candidate.startMinuteOfDay, 24 * 60],
              [0, (candidate.startMinuteOfDay + candidate.durationMinutes) % (24 * 60)]
            ];

      const overlaps = currentRanges.some(([currentStart, currentEnd]) =>
        candidateRanges.some(
          ([candidateStart, candidateEnd]) => currentStart < candidateEnd && candidateStart < currentEnd
        )
      );

      if (overlaps) {
        conflicts.add(current.id);
        conflicts.add(candidate.id);
      }
    }
  }

  return [...conflicts];
}

export function summarizeScheduleWeek(blocks: ScheduleBlock[]): ScheduleDaySummary[] {
  return Array.from({ length: 7 }, (_, dayOfWeek) => {
    const dayBlocks = blocks
      .filter((block) => block.dayOfWeek === dayOfWeek)
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

export function buildScheduleOccurrences(args: {
  date: string;
  blocks: ScheduleBlock[];
}): ScheduleOccurrence[] {
  const dayOfWeek = getDayOfWeekForDate(args.date);
  return [...args.blocks]
    .filter((block) => block.dayOfWeek === dayOfWeek)
    .sort((a, b) => a.startMinuteOfDay - b.startMinuteOfDay)
    .map((block) => {
      const startMinutes = block.startMinuteOfDay;
      const endMinutes = (startMinutes + block.durationMinutes) % (24 * 60);

      return {
        key: `${args.date}:${block.id}:${startMinutes}:${block.durationMinutes}`,
        blockId: block.id,
        title: block.title,
        categoryName: block.categoryName,
        dayOfWeek: block.dayOfWeek,
        showId: block.showId,
        poolId: block.poolId,
        sourceName: block.sourceName,
        date: args.date,
        startTime: formatMinuteOfDay(startMinutes),
        endTime: formatMinuteOfDay(endMinutes),
        startMinuteOfDay: startMinutes,
        durationMinutes: block.durationMinutes,
        repeatMode: normalizeScheduleRepeatMode(block.repeatMode ?? "single"),
        repeatGroupId: block.repeatGroupId ?? "",
        cuepointAssetId: block.cuepointAssetId ?? "",
        cuepointOffsetsSeconds: normalizeCuepointOffsetsSeconds(block.cuepointOffsetsSeconds ?? [], block.durationMinutes)
      };
    });
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

export function toUtcIsoForLocalDateTime(args: {
  date: string;
  minuteOfDay: number;
  timeZone: string;
}): string {
  const [yearText, monthText, dayText] = args.date.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Math.floor(args.minuteOfDay / 60);
  const minute = args.minuteOfDay % 60;
  let instant = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const zoned = extractFormatterParts({ instant, timeZone: args.timeZone });
    const desiredAsUtc = Date.UTC(year, month - 1, day, hour, minute, 0);
    const zonedAsUtc = Date.UTC(zoned.year, zoned.month - 1, zoned.day, zoned.hour, zoned.minute, zoned.second);
    const delta = desiredAsUtc - zonedAsUtc;

    if (delta === 0) {
      break;
    }

    instant = new Date(instant.getTime() + delta);
  }

  return instant.toISOString();
}

export type DestinationRoutingRecord = {
  id: string;
  name: string;
  role: "primary" | "backup";
  priority: number;
  enabled: boolean;
  streamKeyPresent: boolean;
  status: "ready" | "missing-config" | "error";
};

export type DestinationRoutingSelection = {
  mode: "primary" | "backup" | "none";
  activeDestinationIds: string[];
  leadDestinationId: string;
};

export function selectActiveDestinationGroup(destinations: DestinationRoutingRecord[]): DestinationRoutingSelection {
  const ordered = [...destinations]
    .filter((destination) => destination.enabled && destination.streamKeyPresent)
    .sort((left, right) => left.priority - right.priority || left.name.localeCompare(right.name));

  const primaryHealthy = ordered.filter((destination) => destination.role === "primary" && destination.status !== "error");
  if (primaryHealthy.length > 0) {
    return {
      mode: "primary",
      activeDestinationIds: primaryHealthy.map((destination) => destination.id),
      leadDestinationId: primaryHealthy[0]?.id || ""
    };
  }

  const backupHealthy = ordered.filter((destination) => destination.role === "backup" && destination.status !== "error");
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
