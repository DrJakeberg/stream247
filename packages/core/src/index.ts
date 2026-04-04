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

export type OverlayQueueKind = "asset" | "insert" | "standby" | "reconnect" | "";

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

export type OverlaySceneSource = {
  scenePreset: OverlayScenePreset;
  surfaceStyle: OverlaySurfaceStyle;
  panelAnchor: OverlayPanelAnchor;
  titleScale: OverlayTitleScale;
  showClock: boolean;
  showNextItem: boolean;
  showScheduleTeaser: boolean;
  showQueuePreview: boolean;
  emergencyBanner: string;
  tickerText: string;
  layerOrder: OverlaySceneLayerKind[];
};

export type OverlayOptionDefinition<T extends string> = {
  id: T;
  label: string;
  description: string;
};

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
};

export type ScheduleDaySummary = {
  dayOfWeek: number;
  blockCount: number;
  scheduledMinutes: number;
  firstStartMinute: number | null;
  lastEndMinute: number | null;
};

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
  queueKind: OverlayQueueKind
): OverlayScenePreset {
  if (queueKind === "insert") {
    return "bumper-board";
  }

  if (queueKind === "reconnect") {
    return "reconnect-board";
  }

  if (queueKind === "standby") {
    return "standby-board";
  }

  return scenePreset;
}

export function buildOverlayBrandLine(replayLabel: string, brandBadge = ""): string {
  const parts = [replayLabel || "Replay stream", brandBadge].map((part) => part.trim()).filter(Boolean);
  return parts.join(" · ");
}

export function buildOverlaySceneDefinition(args: {
  overlay: OverlaySceneSource;
  queueKind: OverlayQueueKind;
}): OverlaySceneDefinition {
  const resolvedPresetId = resolveOverlayScenePresetForQueueKind(args.overlay.scenePreset, args.queueKind);
  const normalizedLayerOrder = normalizeOverlaySceneLayerOrder(args.overlay.layerOrder);
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
      enabled: enabledMap[kind]
    }))
  };
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
  const nowTitle = args.nowTitle || "Stand by";
  const nextTitle = args.nextTitle || "Scheduling next item";
  const queuePreview = (args.queueTitles || []).filter(Boolean).slice(0, 3).join(" · ");
  const metaBits = [args.showCurrentCategory ? args.currentCategory || "" : "", args.showSourceLabel ? args.sourceName || "" : ""].filter(Boolean);
  const brandLine = buildOverlayBrandLine(args.replayLabel, args.brandBadge);
  const tickerLine = args.tickerText?.trim() || "";

  if (args.scenePreset === "minimal-chip") {
    return [brandLine, `Now: ${nowTitle}`, metaBits.join(" · "), tickerLine].filter(Boolean);
  }

  if (args.scenePreset === "bumper-board") {
    return [
      brandLine,
      args.headline || "Insert on air",
      `Insert: ${nowTitle}`,
      `Next: ${nextTitle}`,
      args.showQueuePreview && queuePreview ? `After this: ${queuePreview}` : "",
      tickerLine
    ].filter(Boolean);
  }

  if (args.scenePreset === "reconnect-board") {
    return [
      brandLine,
      args.headline || "Scheduled reconnect in progress",
      `Resuming with: ${nextTitle}`,
      args.showQueuePreview && queuePreview ? `Queue: ${queuePreview}` : "",
      tickerLine
    ].filter(Boolean);
  }

  if (args.scenePreset === "split-now-next") {
    return [
      brandLine,
      `Now: ${nowTitle}`,
      `Next: ${nextTitle}`,
      metaBits.join(" · "),
      tickerLine
    ].filter(Boolean);
  }

  if (args.scenePreset === "standby-board") {
    return [
      brandLine,
      args.headline || "Please wait, restream is starting",
      `Current: ${nowTitle}`,
      `Next: ${nextTitle}`,
      args.showQueuePreview && queuePreview ? `Later: ${queuePreview}` : "",
      tickerLine
    ].filter(Boolean);
  }

  return [
    brandLine,
    `Now: ${nowTitle}`,
    metaBits.join(" · "),
    `Next: ${nextTitle}`,
    args.showQueuePreview && queuePreview ? `Queue: ${queuePreview}` : "",
    args.standby ? args.headline || "Please wait, restream is starting" : "",
    tickerLine
  ].filter(Boolean);
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
    reason: `Selected from ${occurrence.sourceName} for ${occurrence.durationMinutes} minutes.`
  }));

  return { date: args.date, items };
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
  dayOfWeek: number;
  startMinuteOfDay: number;
  durationMinutes: number;
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
        durationMinutes: block.durationMinutes
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
