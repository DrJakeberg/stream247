import { promises as fs } from "node:fs";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import nodemailer from "nodemailer";
import path from "node:path";
import type { Writable } from "node:stream";
import {
  addDaysToDateString,
  buildOverlayScenePayload,
  buildOverlayTextLinesFromScenePayload,
  buildScheduleOccurrences,
  buildSchedulePreview,
  describePresenceStatus,
  getCurrentScheduleMoment,
  isCurrentScheduleTime,
  isLikelyTwitchChannelUrl,
  isLikelyTwitchVodUrl,
  isLikelyYouTubeChannelUrl,
  isLikelyYouTubePlaylistUrl,
  resolveOverlayScenePresetForQueueKind,
  toUtcIsoForLocalDateTime
} from "@stream247/core";
import {
  appendSourceSyncRuns,
  appendAuditEvent,
  readManagedDestinationStreamKeys,
  replaceAssetsForSourceIds,
  readAppState,
  replaceTwitchScheduleSegments,
  resolveIncident,
  updateDestinationRecord,
  updatePlayoutRuntime,
  updatePoolCursor,
  updateTwitchConnectionRecord,
  upsertSources,
  upsertIncident,
  type AppState,
  type AssetRecord,
  type StreamDestinationRecord
} from "@stream247/db";
import {
  ON_AIR_SCENE_PIPE_FD,
  buildChromiumSceneCaptureArgs,
  getChromiumBinaryCandidates,
  getSceneRendererIntervalMs,
  getSceneRendererOverlayUrl,
  getSceneRendererViewport,
  type OnAirOverlayMode
} from "./on-air-scene.js";
import { incrementQueueVersion, prioritizeManualNextAsset } from "./broadcast-queue.js";
import { buildLocalLibraryAssetId, buildLocalLibraryFolderPath } from "./local-library.js";
import {
  buildFfmpegOutputTarget,
  getLegacyDestinationEnvConfig,
  matchDestinationFailuresInLog,
  resolveDestinationStreamTarget,
  selectDestinationRuntimeTargets,
  type DestinationRuntimeTarget
} from "./multi-output.js";
import { logRuntimeEvent } from "./runtime-log.js";

const mediaExtensions = new Set([".mp4", ".mkv", ".mov", ".m4v", ".webm"]);
let playoutProcess: ChildProcess | null = null;
let playoutAssetId = "";
let playoutDestinationId = "";
let playoutDestinationIds: string[] = [];
let playoutRuntimeTargets: DestinationRuntimeTarget[] = [];
let playoutTargetKind: "asset" | "insert" | "standby" | "reconnect" | "" = "";
let plannedStopReason = "";
const WORKER_HEARTBEAT_STALE_MS = 120_000;
const PLAYOUT_HEARTBEAT_STALE_MS = 60_000;
const PLAYOUT_CRASH_LOOP_THRESHOLD = 3;
const PLAYOUT_CRASH_LOOP_WINDOW_MS = 10 * 60_000;
const PLAYOUT_RECONNECT_INTERVAL_MS = Number(process.env.PLAYOUT_RECONNECT_HOURS || "24") * 60 * 60 * 1000;
const PLAYOUT_RECONNECT_WINDOW_MS = Number(process.env.PLAYOUT_RECONNECT_SECONDS || "20") * 1000;
const DESTINATION_FAILURE_COOLDOWN_MS = Number(process.env.DESTINATION_FAILURE_COOLDOWN_SECONDS || "300") * 1000;
const NEXT_ASSET_PROBE_READY_TTL_MS = 5 * 60_000;
const NEXT_ASSET_PROBE_FAILED_TTL_MS = 60_000;
const standbySlatePath = "/tmp/stream247-standby.txt";
const onAirOverlayPath = "/tmp/stream247-on-air.txt";

type QueueProbeCacheEntry = {
  status: "ready" | "failed";
  checkedAt: number;
  resolvedInput: string;
  error: string;
};

const queueProbeCache = new Map<string, QueueProbeCacheEntry>();
let sceneRendererAbortController: AbortController | null = null;
const renderedSceneFramePath = "/tmp/stream247-scene.png";

function isTimestampActive(value: string): boolean {
  return value !== "" && new Date(value).getTime() > Date.now();
}

function execFileText(file: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { maxBuffer: 1024 * 1024 * 20 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr.trim() || error.message));
        return;
      }

      resolve(stdout.trim());
    });
  });
}

function getManagedString(state: AppState, key: keyof AppState["managedConfig"], envFallback = ""): string {
  return state.managedConfig[key] || envFallback;
}

function getTwitchClientId(state: AppState): string {
  return getManagedString(state, "twitchClientId", process.env.TWITCH_CLIENT_ID || "");
}

function getTwitchClientSecret(state: AppState): string {
  return getManagedString(state, "twitchClientSecret", process.env.TWITCH_CLIENT_SECRET || "");
}

function getTwitchDefaultCategoryId(state: AppState): string {
  return getManagedString(state, "twitchDefaultCategoryId", process.env.TWITCH_DEFAULT_CATEGORY_ID || "");
}

function getDiscordWebhookUrl(state: AppState): string {
  return getManagedString(state, "discordWebhookUrl", process.env.DISCORD_WEBHOOK_URL || "");
}

function getSmtpConfig(state: AppState) {
  return {
    host: getManagedString(state, "smtpHost", process.env.SMTP_HOST || ""),
    port: Number(getManagedString(state, "smtpPort", process.env.SMTP_PORT || "0") || "0"),
    user: getManagedString(state, "smtpUser", process.env.SMTP_USER || ""),
    password: getManagedString(state, "smtpPassword", process.env.SMTP_PASSWORD || ""),
    from: getManagedString(state, "smtpFrom", process.env.SMTP_FROM || process.env.SMTP_USER || ""),
    to: getManagedString(state, "alertEmailTo", process.env.ALERT_EMAIL_TO || "")
  };
}

function getMediaRoot(): string {
  return process.env.MEDIA_LIBRARY_ROOT || path.join(process.cwd(), "data", "media");
}

function isDirectMediaUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && mediaExtensions.has(path.extname(url.pathname).toLowerCase());
  } catch {
    return false;
  }
}

function isResolvableRemoteVideoUrl(value: string): boolean {
  return isLikelyYouTubePlaylistUrl(value) || isLikelyTwitchVodUrl(value) || value.includes("youtube.com/watch");
}

async function resolvePlayableInput(input: string): Promise<string> {
  if (!input.startsWith("http://") && !input.startsWith("https://")) {
    return input;
  }

  if (isDirectMediaUrl(input)) {
    return input;
  }

  if (!isResolvableRemoteVideoUrl(input)) {
    return input;
  }

  const ytDlpBinary = process.env.YT_DLP_BIN || "yt-dlp";
  const resolved = await execFileText(ytDlpBinary, [
    "--no-warnings",
    "--no-playlist",
    "--format",
    "best",
    "--get-url",
    input
  ]);

  const directUrl = resolved.split("\n").find(Boolean)?.trim();
  if (!directUrl) {
    throw new Error(`Could not resolve a playable media URL for ${input}.`);
  }

  return directUrl;
}

function isDestinationCoolingDown(destination: StreamDestinationRecord): boolean {
  return (
    destination.status === "error" &&
    destination.lastFailureAt !== "" &&
    Date.now() - new Date(destination.lastFailureAt).getTime() < DESTINATION_FAILURE_COOLDOWN_MS
  );
}

function getDestinationFailureSecondsRemaining(destination: StreamDestinationRecord): number {
  if (!isDestinationCoolingDown(destination)) {
    return 0;
  }

  const elapsed = Date.now() - new Date(destination.lastFailureAt).getTime();
  return Math.max(0, Math.ceil((DESTINATION_FAILURE_COOLDOWN_MS - elapsed) / 1000));
}

function isLikelyDestinationOutputError(line: string): boolean {
  const sample = line.toLowerCase();
  return [
    "broken pipe",
    "connection refused",
    "connection reset",
    "error writing trailer",
    "input/output error",
    "i/o error",
    "av_interleaved_write_frame",
    "failed to update header",
    "server returned 4",
    "server returned 5",
    "end of file"
  ].some((token) => sample.includes(token));
}

async function markDestinationFailure(destinationId: string, errorMessage: string): Promise<void> {
  if (!destinationId) {
    return;
  }

  const state = await readAppState();
  const destination = state.destinations.find((entry) => entry.id === destinationId);
  if (!destination) {
    return;
  }

  const now = new Date().toISOString();
  const nextError = errorMessage.slice(0, 400);
  if (
    destination.status === "error" &&
    destination.lastError === nextError &&
    destination.lastFailureAt !== "" &&
    Date.now() - new Date(destination.lastFailureAt).getTime() < 15_000
  ) {
    return;
  }

  await updateDestinationRecord({
    ...destination,
    status: "error",
    lastValidatedAt: now,
    lastFailureAt: now,
    failureCount: destination.failureCount + 1,
    lastError: nextError,
    notes: `${
      destination.role === "backup" ? "Backup" : "Primary"
    } destination failed recently. Worker will prefer the next healthy output until the hold expires.`
  });
  logRuntimeEvent("destination.failure", {
    destinationId,
    role: destination.role,
    failureCount: destination.failureCount + 1,
    error: nextError
  });

  await upsertIncident({
    scope: "playout",
    severity: "warning",
    title: `${destination.name} output failed`,
    message: nextError,
    fingerprint: `playout.destination.${destination.id}.failed`
  });
}

function getMediaOverlayFilter(textPath: string): string {
  return `drawtext=fontfile=/usr/share/fonts/TTF/DejaVuSans.ttf:textfile=${textPath}:reload=1:fontcolor=white:fontsize=20:box=1:boxcolor=0x00000099:boxborderw=10:x=32:y=h-th-32:line_spacing=8`;
}

function getFfmpegCommand(
  input: string,
  outputTarget: ReturnType<typeof buildFfmpegOutputTarget>,
  overlayMode: OnAirOverlayMode
): string[] {
  const command = [
    "-hide_banner",
    "-loglevel",
    "warning",
    "-y",
    "-re",
    "-i",
    input
  ];

  if (overlayMode === "scene") {
    command.push("-f", "image2pipe", "-framerate", "1", "-vcodec", "png", "-i", `pipe:${ON_AIR_SCENE_PIPE_FD}`);
    command.push("-filter_complex", "[0:v][1:v]overlay=0:0:format=auto[vout]", "-map", "[vout]", "-map", "0:a?");
  } else if (overlayMode === "text") {
    command.push("-vf", getMediaOverlayFilter(onAirOverlayPath));
    command.push("-map", "0:v:0", "-map", "0:a?");
  } else {
    command.push("-map", "0:v:0", "-map", "0:a?");
  }

  command.push(
    "-c:v",
    "libx264",
    "-preset",
    process.env.FFMPEG_PRESET || "veryfast",
    "-maxrate",
    process.env.FFMPEG_MAXRATE || "4500k",
    "-bufsize",
    process.env.FFMPEG_BUFSIZE || "9000k",
    "-pix_fmt",
    "yuv420p",
    "-g",
    "60",
    "-c:a",
    "aac",
    "-ar",
    "44100",
    "-b:a",
    process.env.FFMPEG_AUDIO_BITRATE || "160k",
    "-f",
    outputTarget.muxer,
    outputTarget.output
  );

  return command;
}

function getStandbyFfmpegCommand(
  outputTarget: ReturnType<typeof buildFfmpegOutputTarget>,
  overlayMode: OnAirOverlayMode
): string[] {
  const command = [
    "-hide_banner",
    "-loglevel",
    "warning",
    "-y",
    "-re",
    "-f",
    "lavfi",
    "-i",
    "color=c=0x0b1f18:s=1280x720:r=30",
    "-f",
    "lavfi",
    "-i",
    "anullsrc=channel_layout=stereo:sample_rate=44100",
  ];

  if (overlayMode === "scene") {
    command.push("-f", "image2pipe", "-framerate", "1", "-vcodec", "png", "-i", `pipe:${ON_AIR_SCENE_PIPE_FD}`);
    command.push("-filter_complex", "[0:v][2:v]overlay=0:0:format=auto[vout]", "-map", "[vout]", "-map", "1:a");
  } else {
    command.push(
      "-vf",
      `drawtext=fontfile=/usr/share/fonts/TTF/DejaVuSans.ttf:textfile=${standbySlatePath}:reload=1:fontcolor=white:fontsize=34:x=(w-text_w)/2:y=(h-text_h)/2:line_spacing=12`,
      "-map",
      "0:v:0",
      "-map",
      "1:a"
    );
  }

  command.push(
    "-c:v",
    "libx264",
    "-preset",
    process.env.FFMPEG_PRESET || "veryfast",
    "-maxrate",
    process.env.FFMPEG_MAXRATE || "4500k",
    "-bufsize",
    process.env.FFMPEG_BUFSIZE || "9000k",
    "-pix_fmt",
    "yuv420p",
    "-g",
    "60",
    "-c:a",
    "aac",
    "-ar",
    "44100",
    "-b:a",
    process.env.FFMPEG_AUDIO_BITRATE || "160k",
    "-shortest",
    "-f",
    outputTarget.muxer,
    outputTarget.output
  );

  return command;
}

async function resolveChromiumBinary(): Promise<string> {
  for (const candidate of getChromiumBinaryCandidates(process.env)) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      continue;
    }
  }

  throw new Error("No Chromium binary is available for on-air scene rendering.");
}

function shouldUseSceneRenderer(): boolean {
  return (process.env.SCENE_RENDERER_ENABLED || "1") !== "0";
}

function isWritablePipe(value: unknown): value is Writable {
  return Boolean(value) && typeof (value as Writable).write === "function";
}

async function captureRenderedSceneFrame(): Promise<Buffer> {
  const chromiumBinary = await resolveChromiumBinary();
  const viewport = getSceneRendererViewport(process.env);
  await execFileText(
    chromiumBinary,
    buildChromiumSceneCaptureArgs({
      url: getSceneRendererOverlayUrl(process.env),
      outputPath: renderedSceneFramePath,
      viewport
    })
  );
  return fs.readFile(renderedSceneFramePath);
}

async function prepareSceneRendererFrame(): Promise<Buffer | null> {
  if (!shouldUseSceneRenderer()) {
    return null;
  }

  try {
    const frame = await captureRenderedSceneFrame();
    await resolveIncident("playout.scene-render.failed", "On-air scene renderer is healthy.");
    return frame;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown on-air scene renderer error.";
    logRuntimeEvent("scene.render.fallback", { error: message });
    await upsertIncident({
      scope: "playout",
      severity: "warning",
      title: "On-air scene renderer fell back to text mode",
      message,
      fingerprint: "playout.scene-render.failed"
    });
    return null;
  }
}

function stopSceneRendererLoop(): void {
  sceneRendererAbortController?.abort();
  sceneRendererAbortController = null;
}

function startSceneRendererLoop(targetPipe: Writable, initialFrame: Buffer): void {
  stopSceneRendererLoop();
  const controller = new AbortController();
  const intervalMs = getSceneRendererIntervalMs(process.env);
  sceneRendererAbortController = controller;

  void (async () => {
    let currentFrame = initialFrame;

    while (!controller.signal.aborted && !targetPipe.destroyed) {
      try {
        if (!targetPipe.write(currentFrame)) {
          await once(targetPipe, "drain");
        }
      } catch {
        break;
      }

      try {
        currentFrame = await captureRenderedSceneFrame();
        await resolveIncident("playout.scene-render.failed", "On-air scene renderer is healthy.");
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown on-air scene renderer error.";
        await upsertIncident({
          scope: "playout",
          severity: "warning",
          title: "On-air scene renderer update failed",
          message,
          fingerprint: "playout.scene-render.failed"
        });
      }

      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }

    if (!targetPipe.destroyed) {
      targetPipe.end();
    }

    if (sceneRendererAbortController === controller) {
      sceneRendererAbortController = null;
    }
  })();
}

function buildWorkerScenePayload(args: {
  state: AppState;
  queueKind: AppState["playout"]["queueItems"][number]["kind"] | "";
  currentTitle: string;
  nextTitle: string;
  nextTimeLabel?: string;
  currentCategory?: string;
  currentSourceName?: string;
  queueTitles?: string[];
}){
  return buildOverlayScenePayload({
    overlay: {
      channelName: args.state.overlay.channelName,
      replayLabel: args.state.overlay.replayLabel,
      brandBadge: args.state.overlay.brandBadge,
      accentColor: args.state.overlay.accentColor,
      scenePreset: args.state.overlay.scenePreset,
      insertScenePreset: args.state.overlay.insertScenePreset,
      standbyScenePreset: args.state.overlay.standbyScenePreset,
      reconnectScenePreset: args.state.overlay.reconnectScenePreset,
      headline: args.state.overlay.headline,
      insertHeadline: args.state.overlay.insertHeadline,
      standbyHeadline: args.state.overlay.standbyHeadline,
      reconnectHeadline: args.state.overlay.reconnectHeadline,
      surfaceStyle: args.state.overlay.surfaceStyle,
      panelAnchor: args.state.overlay.panelAnchor,
      titleScale: args.state.overlay.titleScale,
      showClock: args.state.overlay.showClock,
      showNextItem: args.state.overlay.showNextItem,
      showScheduleTeaser: args.state.overlay.showScheduleTeaser,
      showCurrentCategory: args.state.overlay.showCurrentCategory,
      showSourceLabel: args.state.overlay.showSourceLabel,
      showQueuePreview: args.state.overlay.showQueuePreview,
      queuePreviewCount: args.state.overlay.queuePreviewCount,
      emergencyBanner: args.state.overlay.emergencyBanner,
      tickerText: args.state.overlay.tickerText,
      layerOrder: args.state.overlay.layerOrder,
      disabledLayers: args.state.overlay.disabledLayers
    },
    queueKind: args.queueKind || "asset",
    target: "on-air-text",
    currentTitle: args.currentTitle,
    currentCategory: args.currentCategory,
    currentSourceName: args.currentSourceName,
    nextTitle: args.nextTitle,
    nextTimeLabel: args.nextTimeLabel,
    queueTitles: args.queueTitles,
    timeZone: process.env.CHANNEL_TIMEZONE || "UTC"
  });
}

async function writeStandbySlate(
  state: AppState,
  queueKind: AppState["playout"]["queueItems"][number]["kind"] | "" = state.playout.queueItems[0]?.kind || "standby"
): Promise<void> {
  const currentItem = getCurrentScheduleItem(state);
  const nextPreview = buildSchedulePreview({
    date: getCurrentScheduleMoment({
      now: new Date(),
      timeZone: process.env.CHANNEL_TIMEZONE || "UTC"
    }).date,
    blocks: state.scheduleBlocks
  }).items;
  const nextItem = nextPreview.find((item) => item.id !== currentItem?.blockId) ?? null;
  const payload = buildWorkerScenePayload({
    state,
    queueKind,
    currentTitle: currentItem?.title || "Stand by",
    nextTitle: nextItem ? nextItem.title : "Programming will resume shortly",
    nextTimeLabel: nextItem ? `${nextItem.startTime}-${nextItem.endTime}` : "No next block configured",
    currentCategory: currentItem?.categoryName,
    currentSourceName: currentItem?.sourceName,
    queueTitles: nextPreview.slice(0, state.overlay.queuePreviewCount).map((item) => item.title)
  });
  const lines = buildOverlayTextLinesFromScenePayload(payload);
  await fs.writeFile(standbySlatePath, `${lines.join("\n")}\n`, "utf8");
}

async function writeOnAirOverlay(
  state: AppState,
  asset: AssetRecord | null,
  queueKind: AppState["playout"]["queueItems"][number]["kind"] | "" = state.playout.queueItems[0]?.kind || "asset"
): Promise<void> {
  const currentItem = getCurrentScheduleItem(state);
  const nextItem = getNextScheduleItem(state);
  const queueTitles = state.playout.queuedAssetIds
    .map((id) => state.assets.find((entry) => entry.id === id)?.title || "")
    .filter(Boolean)
    .slice(0, state.overlay.queuePreviewCount);
  const lines = buildOverlayTextLinesFromScenePayload(
    buildWorkerScenePayload({
      state,
      queueKind,
      currentTitle: asset?.title || state.playout.currentTitle || currentItem?.title || "Stand by",
      nextTitle: nextItem?.title || "Scheduling next item",
      nextTimeLabel: nextItem ? `${nextItem.startTime}-${nextItem.endTime}` : "No next block configured",
      currentCategory: currentItem?.categoryName || asset?.categoryName,
      currentSourceName:
        currentItem?.sourceName || (asset ? state.sources.find((source) => source.id === asset.sourceId)?.name : ""),
      queueTitles
    })
  );
  await fs.writeFile(onAirOverlayPath, `${lines.join("\n")}\n`, "utf8");
}

async function refreshBroadcasterAccessToken(): Promise<string> {
  const state = await readAppState();
  const clientId = getTwitchClientId(state);
  const clientSecret = getTwitchClientSecret(state);

  if (!clientId || !clientSecret || !state.twitch.refreshToken) {
    throw new Error("Missing Twitch client credentials or refresh token.");
  }

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: state.twitch.refreshToken,
    client_id: clientId,
    client_secret: clientSecret
  });

  const response = await fetch("https://id.twitch.tv/oauth2/token", {
    method: "POST",
    body
  });

  if (!response.ok) {
    throw new Error(`Twitch token refresh failed with status ${response.status}.`);
  }

  const payload = (await response.json()) as { access_token: string; refresh_token?: string; expires_in?: number };
  const refreshedAt = new Date().toISOString();
  const tokenExpiresAt = payload.expires_in
    ? new Date(Date.now() + payload.expires_in * 1000).toISOString()
    : state.twitch.tokenExpiresAt;

  await updateTwitchConnectionRecord({
    ...state.twitch,
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token ?? state.twitch.refreshToken,
    status: "connected",
    tokenExpiresAt,
    lastRefreshAt: refreshedAt,
    error: ""
  });

  await resolveIncident("twitch.refresh.failed", "Twitch token refresh succeeded.");
  return payload.access_token;
}

async function resolveTwitchCategory(args: {
  accessToken: string;
  categoryName: string;
  clientId: string;
}): Promise<{ id: string; name: string } | null> {
  const normalizedName = args.categoryName.trim();
  if (!normalizedName) {
    return null;
  }

  const response = await fetch(
    `https://api.twitch.tv/helix/search/categories?query=${encodeURIComponent(normalizedName)}&first=10`,
    {
      headers: {
        Authorization: `Bearer ${args.accessToken}`,
        "Client-Id": args.clientId
      }
    }
  );

  if (!response.ok) {
    throw new Error(`Category lookup failed with status ${response.status}.`);
  }

  const payload = (await response.json()) as {
    data?: Array<{ id?: string; name?: string }>;
  };

  const exactMatch =
    payload.data?.find((entry) => entry.name?.toLowerCase() === normalizedName.toLowerCase() && entry.id && entry.name) ??
    payload.data?.find((entry) => entry.id && entry.name);

  return exactMatch?.id && exactMatch.name
    ? {
        id: exactMatch.id,
        name: exactMatch.name
      }
    : null;
}

async function walkMediaFiles(root: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(root, { withFileTypes: true });
    const files = await Promise.all(
      entries.map(async (entry) => {
        const absolutePath = path.join(root, entry.name);
        if (entry.isDirectory()) {
          return walkMediaFiles(absolutePath);
        }
        return mediaExtensions.has(path.extname(entry.name).toLowerCase()) ? [absolutePath] : [];
      })
    );
    return files.flat();
  } catch {
    return [];
  }
}

function buildAssetFromPath(filePath: string, now: string): AssetRecord {
  const mediaRoot = getMediaRoot();
  const isFallback = filePath.toLowerCase().includes("fallback") || filePath.toLowerCase().includes("standby");
  const id = buildLocalLibraryAssetId(filePath);
  return {
    id,
    sourceId: "source-local-library",
    title: path.basename(filePath, path.extname(filePath)).replace(/[_-]+/g, " "),
    path: filePath,
    folderPath: buildLocalLibraryFolderPath(filePath, mediaRoot),
    tags: [],
    status: "ready",
    includeInProgramming: true,
    fallbackPriority: isFallback ? 1 : 100,
    isGlobalFallback: isFallback,
    createdAt: now,
    updatedAt: now
  };
}

async function syncLocalMediaLibrary(): Promise<void> {
  const mediaRoot = getMediaRoot();
  const startedAt = new Date().toISOString();
  const discoveredFiles = await walkMediaFiles(mediaRoot);
  const now = new Date().toISOString();
  const discoveredAssets = discoveredFiles.map((filePath) => buildAssetFromPath(filePath, now));
  const state = await readAppState();
  const existingByPath = new Map(state.assets.map((asset) => [asset.path, asset]));
  const nextAssets: AssetRecord[] = discoveredAssets.map((asset) => {
    const existing = existingByPath.get(asset.path);
    return existing
        ? {
          ...existing,
          title: asset.title,
          folderPath: asset.folderPath,
          status: "ready",
          includeInProgramming: existing.includeInProgramming,
          fallbackPriority: asset.fallbackPriority,
          isGlobalFallback: asset.isGlobalFallback,
          updatedAt: now
        }
      : asset;
  });

  await upsertSources([
    {
      id: "source-local-library",
      name: "Local Media Library",
      type: "Filesystem scan",
      connectorKind: "local-library",
      enabled: true,
      status: nextAssets.length > 0 ? "Ready" : "Empty",
      externalUrl: "",
      notes: "Scans files mounted into the media library volume.",
      lastSyncedAt: now
    }
  ]);
  await replaceAssetsForSourceIds(["source-local-library"], nextAssets);

  if (discoveredAssets.length > 0) {
    await resolveIncident("source.local-library.empty", "Local media library now contains playable assets.");
  } else {
    await upsertIncident({
      scope: "source",
      severity: "warning",
      title: "Local media library is empty",
      message: `No media files were found under ${mediaRoot}.`,
      fingerprint: "source.local-library.empty"
    });
  }

  await appendSourceSyncRuns([
    buildSourceSyncRun({
      sourceId: "source-local-library",
      startedAt,
      finishedAt: now,
      status: discoveredAssets.length > 0 ? "success" : "skipped",
      summary:
        discoveredAssets.length > 0
          ? `Discovered ${discoveredAssets.length} file(s) in the local media library.`
          : "Local media library scan completed with no playable files.",
      discoveredAssets: discoveredAssets.length,
      readyAssets: discoveredAssets.length
    })
  ]);
}

async function syncDirectMediaSources(): Promise<void> {
  const state = await readAppState();
  const now = new Date().toISOString();
  const directSources = state.sources.filter(
    (source) => source.connectorKind === "direct-media" && (source.enabled ?? true)
  );
  const directAssets: AssetRecord[] = [];
  let hasInvalidSource = false;
  const syncRuns: AppState["sourceSyncRuns"] = [];

  for (const source of directSources) {
    const startedAt = new Date().toISOString();
    const url = source.externalUrl?.trim() ?? "";
    if (!isDirectMediaUrl(url)) {
      hasInvalidSource = true;
      syncRuns.push(buildSourceSyncRun({
        sourceId: source.id,
        startedAt,
        finishedAt: now,
        status: "error",
        summary: "Direct media URL validation failed.",
        discoveredAssets: 0,
        readyAssets: 0,
        errorMessage: "Direct media URLs must be http(s) links ending in a supported media file extension."
      }));
      continue;
    }

    directAssets.push({
      id: `asset_${source.id}`,
      sourceId: source.id,
      title: source.name,
      path: url,
      folderPath: buildSourceFolderPath(source.connectorKind, source.name),
      tags: [],
      status: "ready",
      includeInProgramming: true,
      externalId: source.id,
      fallbackPriority: 100,
      isGlobalFallback: false,
      createdAt: now,
      updatedAt: now
    });
    syncRuns.push(buildSourceSyncRun({
      sourceId: source.id,
      startedAt,
      finishedAt: now,
      status: "success",
      summary: "Direct media URL normalized into a playable asset.",
      discoveredAssets: 1,
      readyAssets: 1,
      errorMessage: ""
    }));
  }

  await upsertSources(
    directSources.map((source) => {
      const valid = isDirectMediaUrl(source.externalUrl?.trim() ?? "");
      return {
        ...source,
        status: valid ? "Ready" : "Invalid URL",
        notes: valid
          ? "Direct media URL normalized into the playout asset catalog."
          : "Direct media sources currently require an http(s) URL ending in a supported media file extension.",
        lastSyncedAt: now
      };
    })
  );
  await replaceAssetsForSourceIds(
    directSources.map((source) => source.id),
    directAssets
  );
  await appendSourceSyncRuns(syncRuns);

  if (hasInvalidSource) {
    await upsertIncident({
      scope: "source",
      severity: "warning",
      title: "One or more direct media sources are invalid",
      message: "Direct media URLs must be http(s) links ending in a supported media file extension.",
      fingerprint: "source.direct-media.invalid"
    });
  } else {
    await resolveIncident("source.direct-media.invalid", "All direct media sources are valid.");
  }
}

type YtDlpPlaylistEntry = {
  id?: string;
  title?: string;
  duration?: number;
  timestamp?: number;
  url?: string;
  webpage_url?: string;
  original_url?: string;
};

type YtDlpPlaylistResponse = {
  title?: string;
  entries?: YtDlpPlaylistEntry[];
};

type YtDlpVideoResponse = {
  id?: string;
  title?: string;
  duration?: number;
  timestamp?: number;
  category?: string;
  categories?: string[];
  webpage_url?: string;
  original_url?: string;
};

function buildRemoteAsset(args: {
  sourceId: string;
  assetIdSeed: string;
  title: string;
  path: string;
  folderPath?: string;
  externalId?: string;
  categoryName?: string;
  durationSeconds?: number;
  publishedAt?: string;
  now: string;
}): AssetRecord {
  return {
    id: `asset_${args.sourceId}_${args.assetIdSeed}`.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 120),
    sourceId: args.sourceId,
    title: args.title,
    path: args.path,
    folderPath: args.folderPath ?? "",
    tags: [],
    status: "ready",
    includeInProgramming: true,
    externalId: args.externalId,
    categoryName: args.categoryName,
    durationSeconds: args.durationSeconds,
    publishedAt: args.publishedAt,
    fallbackPriority: 100,
    isGlobalFallback: false,
    createdAt: args.now,
    updatedAt: args.now
  };
}

function buildSourceSyncRun(args: {
  sourceId: string;
  startedAt: string;
  finishedAt: string;
  status: AppState["sourceSyncRuns"][number]["status"];
  summary: string;
  discoveredAssets: number;
  readyAssets: number;
  errorMessage?: string;
}) {
  return {
    id: `sync_${Math.random().toString(36).slice(2, 10)}`,
    sourceId: args.sourceId,
    startedAt: args.startedAt,
    finishedAt: args.finishedAt,
    status: args.status,
    summary: args.summary,
    discoveredAssets: args.discoveredAssets,
    readyAssets: args.readyAssets,
    errorMessage: args.errorMessage ?? ""
  };
}

function fromUnixTimestamp(value?: number): string | undefined {
  return typeof value === "number" && Number.isFinite(value) ? new Date(value * 1000).toISOString() : undefined;
}

function getTwitchArchiveUrl(channelUrl: string): string {
  try {
    const url = new URL(channelUrl);
    url.pathname = `${url.pathname.replace(/\/+$/, "")}/videos`;
    url.searchParams.set("filter", "archives");
    url.searchParams.set("sort", "time");
    return url.toString();
  } catch {
    return channelUrl;
  }
}

function normalizeTwitchVideoId(value: string): string {
  return value.replace(/^v(?=\d+$)/i, "");
}

function buildSourceFolderPath(connectorKind: AppState["sources"][number]["connectorKind"], sourceName: string): string {
  const safeName = sourceName
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^\w/-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return [connectorKind, safeName || "source"].filter(Boolean).join("/");
}

async function loadFlatCollection(url: string): Promise<YtDlpPlaylistResponse> {
  const ytDlpBinary = process.env.YT_DLP_BIN || "yt-dlp";
  const output = await execFileText(ytDlpBinary, [
    "--flat-playlist",
    "--dump-single-json",
    "--playlist-end",
    process.env.SOURCE_SYNC_LIMIT || "200",
    url
  ]);
  return JSON.parse(output) as YtDlpPlaylistResponse;
}

async function syncYoutubePlaylistSources(): Promise<void> {
  const state = await readAppState();
  const now = new Date().toISOString();
  const youtubeSources = state.sources.filter(
    (source) =>
      (source.connectorKind === "youtube-playlist" || source.connectorKind === "youtube-channel") && (source.enabled ?? true)
  );
  const youtubeAssets: AssetRecord[] = [];
  let hadFailure = false;
  const syncRuns: AppState["sourceSyncRuns"] = [];

  for (const source of youtubeSources) {
    const startedAt = new Date().toISOString();
    const externalUrl = source.externalUrl?.trim() ?? "";
    const isValid =
      source.connectorKind === "youtube-playlist"
        ? isLikelyYouTubePlaylistUrl(externalUrl)
        : isLikelyYouTubeChannelUrl(externalUrl);
    if (!isValid) {
      hadFailure = true;
      syncRuns.push(buildSourceSyncRun({
        sourceId: source.id,
        startedAt,
        finishedAt: now,
        status: "error",
        summary: "Source URL validation failed before yt-dlp ingestion.",
        discoveredAssets: 0,
        readyAssets: 0,
        errorMessage:
          source.connectorKind === "youtube-playlist"
            ? "YouTube playlist sources require a playlist URL with a list parameter."
            : "YouTube channel sources require a channel, handle, or user URL."
      }));
      continue;
    }

    try {
      const payload = await loadFlatCollection(externalUrl);
      const entries = payload.entries ?? [];
      let sourceAssetCount = 0;

      for (const entry of entries) {
        const id = entry.id ?? entry.url ?? entry.webpage_url ?? "";
        const videoUrl = entry.webpage_url || (entry.id ? `https://www.youtube.com/watch?v=${entry.id}` : entry.url ?? "");
        if (!id || !videoUrl) {
          continue;
        }

        youtubeAssets.push(
          buildRemoteAsset({
            sourceId: source.id,
            assetIdSeed: id,
            title: entry.title || `${source.name} item`,
            path: videoUrl,
            folderPath: buildSourceFolderPath(source.connectorKind, source.name),
            externalId: entry.id,
            durationSeconds: entry.duration,
            publishedAt: fromUnixTimestamp(entry.timestamp),
            now
          })
        );
        sourceAssetCount += 1;
      }

      syncRuns.push(buildSourceSyncRun({
        sourceId: source.id,
        startedAt,
        finishedAt: now,
        status: sourceAssetCount > 0 ? "success" : "skipped",
        summary:
          sourceAssetCount > 0
            ? `Imported ${sourceAssetCount} YouTube item(s) from ${source.connectorKind}.`
            : "YouTube ingestion completed but returned no playable items.",
        discoveredAssets: sourceAssetCount,
        readyAssets: sourceAssetCount,
        errorMessage: ""
      }));
    } catch (error) {
      hadFailure = true;
      const message = error instanceof Error ? error.message : "Unknown YouTube playlist ingestion error.";
      syncRuns.push(buildSourceSyncRun({
        sourceId: source.id,
        startedAt,
        finishedAt: now,
        status: "error",
        summary: "yt-dlp ingestion failed.",
        discoveredAssets: 0,
        readyAssets: 0,
        errorMessage: message
      }));
      await upsertIncident({
        scope: "source",
        severity: "warning",
        title: source.connectorKind === "youtube-channel" ? "YouTube channel ingestion failed" : "YouTube playlist ingestion failed",
        message: `${source.name}: ${message}`,
        fingerprint: `source.${source.connectorKind}.${source.id}`
      });
    }
  }

  await upsertSources(
    youtubeSources.map((source) => {
      const sourceAssetCount = youtubeAssets.filter((asset) => asset.sourceId === source.id).length;
      return {
        ...source,
        status: sourceAssetCount > 0 ? "Ready" : "Ingestion failed",
        notes:
          sourceAssetCount > 0
            ? `Ingested ${sourceAssetCount} YouTube item(s) via yt-dlp.`
            : "Could not ingest this YouTube source. Check the URL and worker incident log.",
        lastSyncedAt: now
      };
    })
  );
  await replaceAssetsForSourceIds(
    youtubeSources.map((source) => source.id),
    youtubeAssets
  );
  await appendSourceSyncRuns(syncRuns);

  if (!hadFailure) {
    for (const source of youtubeSources) {
      await resolveIncident(`source.${source.connectorKind}.${source.id}`, `YouTube source ${source.name} ingested successfully.`);
    }
  }
}

async function syncTwitchVodSources(): Promise<void> {
  const ytDlpBinary = process.env.YT_DLP_BIN || "yt-dlp";
  const state = await readAppState();
  const now = new Date().toISOString();
  const twitchSources = state.sources.filter(
    (source) => (source.connectorKind === "twitch-vod" || source.connectorKind === "twitch-channel") && (source.enabled ?? true)
  );
  const twitchAssets: AssetRecord[] = [];
  const syncRuns: AppState["sourceSyncRuns"] = [];

  for (const source of twitchSources) {
    const startedAt = new Date().toISOString();
    const externalUrl = source.externalUrl?.trim() ?? "";
    const isValid =
      source.connectorKind === "twitch-vod" ? isLikelyTwitchVodUrl(externalUrl) : isLikelyTwitchChannelUrl(externalUrl);
    if (!isValid) {
      syncRuns.push(buildSourceSyncRun({
        sourceId: source.id,
        startedAt,
        finishedAt: now,
        status: "error",
        summary: "Source URL validation failed before Twitch ingestion.",
        discoveredAssets: 0,
        readyAssets: 0,
        errorMessage:
          source.connectorKind === "twitch-vod"
            ? "Twitch VOD sources require a twitch.tv/videos/<id> URL."
            : "Twitch channel sources require a twitch.tv/<channel> URL."
      }));
      await upsertIncident({
        scope: "source",
        severity: "warning",
        title: "Twitch source URL is invalid",
        message:
          source.connectorKind === "twitch-vod"
            ? `${source.name} requires a twitch.tv/videos/<id> URL.`
            : `${source.name} requires a twitch.tv/<channel> URL.`,
        fingerprint: `source.${source.connectorKind}.${source.id}`
      });
      continue;
    }

    try {
      if (source.connectorKind === "twitch-vod") {
        const output = await execFileText(ytDlpBinary, ["--dump-single-json", "--no-playlist", externalUrl]);
        const payload = JSON.parse(output) as YtDlpVideoResponse;
        const assetPath = payload.webpage_url || payload.original_url || externalUrl;
        const assetIdSeed = payload.id || externalUrl;

        twitchAssets.push(
          buildRemoteAsset({
            sourceId: source.id,
            assetIdSeed,
            title: payload.title || source.name,
            path: assetPath,
            folderPath: buildSourceFolderPath(source.connectorKind, source.name),
            externalId: payload.id,
            categoryName: payload.category || payload.categories?.[0] || "",
            durationSeconds: payload.duration,
            publishedAt: fromUnixTimestamp(payload.timestamp),
            now
          })
        );
        syncRuns.push(buildSourceSyncRun({
          sourceId: source.id,
          startedAt,
          finishedAt: now,
          status: "success",
          summary: "Imported the Twitch VOD into the asset catalog.",
          discoveredAssets: 1,
          readyAssets: 1,
          errorMessage: ""
        }));
      } else {
        const payload = await loadFlatCollection(getTwitchArchiveUrl(externalUrl));
        let sourceAssetCount = 0;
        for (const entry of payload.entries ?? []) {
          const id = entry.id ?? "";
          if (!id) {
            continue;
          }
          const normalizedId = normalizeTwitchVideoId(id);

          twitchAssets.push(
            buildRemoteAsset({
              sourceId: source.id,
              assetIdSeed: id,
              title: entry.title || source.name,
              path: entry.webpage_url || `https://www.twitch.tv/videos/${normalizedId}`,
              folderPath: buildSourceFolderPath(source.connectorKind, source.name),
              externalId: normalizedId,
              durationSeconds: entry.duration,
              publishedAt: fromUnixTimestamp(entry.timestamp),
              now
            })
          );
          sourceAssetCount += 1;
        }
        syncRuns.push(buildSourceSyncRun({
          sourceId: source.id,
          startedAt,
          finishedAt: now,
          status: sourceAssetCount > 0 ? "success" : "skipped",
          summary:
            sourceAssetCount > 0
              ? `Imported ${sourceAssetCount} Twitch archive item(s).`
              : "Twitch archive ingestion completed but returned no playable items.",
          discoveredAssets: sourceAssetCount,
          readyAssets: sourceAssetCount,
          errorMessage: ""
        }));
      }

      await resolveIncident(`source.${source.connectorKind}.${source.id}`, `Twitch source ${source.name} ingested successfully.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown Twitch VOD ingestion error.";
      syncRuns.push(buildSourceSyncRun({
        sourceId: source.id,
        startedAt,
        finishedAt: now,
        status: "error",
        summary: "Twitch ingestion failed.",
        discoveredAssets: 0,
        readyAssets: 0,
        errorMessage: message
      }));
      await upsertIncident({
        scope: "source",
        severity: "warning",
        title: source.connectorKind === "twitch-channel" ? "Twitch channel ingestion failed" : "Twitch VOD ingestion failed",
        message: `${source.name}: ${message}`,
        fingerprint: `source.${source.connectorKind}.${source.id}`
      });
    }
  }

  await upsertSources(
    twitchSources.map((source) => {
      const sourceAssetCount = twitchAssets.filter((asset) => asset.sourceId === source.id).length;
      return {
        ...source,
        status: sourceAssetCount > 0 ? "Ready" : "Ingestion failed",
        notes:
          sourceAssetCount > 0
            ? source.connectorKind === "twitch-channel"
              ? `Ingested ${sourceAssetCount} Twitch archive item(s) via yt-dlp.`
              : "Ingested the Twitch VOD into a playable asset via yt-dlp."
            : source.connectorKind === "twitch-channel"
              ? "Could not ingest Twitch channel archives. Check the URL and worker incident log."
              : "Could not ingest this VOD. Check the URL and worker incident log.",
        lastSyncedAt: now
      };
    })
  );
  await replaceAssetsForSourceIds(
    twitchSources.map((source) => source.id),
    twitchAssets
  );
  await appendSourceSyncRuns(syncRuns);
}

function getCurrentScheduleItem(state: AppState): ReturnType<typeof buildScheduleOccurrences>[number] | null {
  const timeZone = process.env.CHANNEL_TIMEZONE || "UTC";
  const scheduleMoment = getCurrentScheduleMoment({
    now: new Date(),
    timeZone
  });

  const occurrences = buildScheduleOccurrences({
    date: scheduleMoment.date,
    blocks: state.scheduleBlocks
  });
  const currentTime = scheduleMoment.time;
  return (
    occurrences.find((item) =>
      isCurrentScheduleTime({
        startTime: item.startTime,
        endTime: item.endTime,
        currentTime
      })
    ) ??
    occurrences[0] ??
    null
  );
}

function getNextScheduleItem(state: AppState): ReturnType<typeof buildScheduleOccurrences>[number] | null {
  const current = getCurrentScheduleItem(state);
  const timeZone = process.env.CHANNEL_TIMEZONE || "UTC";
  const scheduleMoment = getCurrentScheduleMoment({
    now: new Date(),
    timeZone
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

function selectPoolAsset(state: AppState, poolId: string, skippedAssetId: string): AssetRecord | null {
  const pool = state.pools.find((entry) => entry.id === poolId);
  if (!pool) {
    return null;
  }
  const excludeInsertFromRotation = Boolean(pool.insertAssetId) && pool.insertEveryItems > 0;

  const eligibleAssets = state.assets.filter((asset) => {
    if (
      asset.status !== "ready" ||
      asset.id === skippedAssetId ||
      asset.includeInProgramming === false ||
      (excludeInsertFromRotation && asset.id === pool.insertAssetId)
    ) {
      return false;
    }

    return pool.sourceIds.includes(asset.sourceId);
  });

  if (eligibleAssets.length === 0) {
    return null;
  }

  eligibleAssets.sort((left, right) => {
    const publishedDelta = new Date(left.publishedAt || left.createdAt).getTime() - new Date(right.publishedAt || right.createdAt).getTime();
    if (publishedDelta !== 0) {
      return publishedDelta;
    }

    return left.title.localeCompare(right.title);
  });

  if (!pool.cursorAssetId) {
    return eligibleAssets[0] ?? null;
  }

  const currentIndex = eligibleAssets.findIndex((asset) => asset.id === pool.cursorAssetId);
  if (currentIndex === -1) {
    return eligibleAssets[0] ?? null;
  }

  return eligibleAssets[(currentIndex + 1) % eligibleAssets.length] ?? eligibleAssets[0] ?? null;
}

function getPoolPlaybackQueue(state: AppState, poolId: string, skippedAssetId: string, currentAssetId = "", limit = 4): AssetRecord[] {
  const pool = state.pools.find((entry) => entry.id === poolId);
  if (!pool) {
    return [];
  }
  const excludeInsertFromRotation = Boolean(pool.insertAssetId) && pool.insertEveryItems > 0;

  const eligibleAssets = state.assets.filter((asset) => {
    if (
      asset.status !== "ready" ||
      asset.id === skippedAssetId ||
      asset.includeInProgramming === false ||
      (excludeInsertFromRotation && asset.id === pool.insertAssetId)
    ) {
      return false;
    }

    return pool.sourceIds.includes(asset.sourceId);
  });

  if (eligibleAssets.length === 0) {
    return [];
  }

  eligibleAssets.sort((left, right) => {
    const publishedDelta =
      new Date(left.publishedAt || left.createdAt).getTime() - new Date(right.publishedAt || right.createdAt).getTime();
    if (publishedDelta !== 0) {
      return publishedDelta;
    }

    return left.title.localeCompare(right.title);
  });

  const primaryReferenceId = currentAssetId || pool.cursorAssetId;
  let startIndex = primaryReferenceId ? eligibleAssets.findIndex((asset) => asset.id === primaryReferenceId) : -1;
  if (startIndex === -1 && currentAssetId && pool.cursorAssetId) {
    startIndex = eligibleAssets.findIndex((asset) => asset.id === pool.cursorAssetId);
  }
  const queue: AssetRecord[] = [];

  for (let offset = 1; offset <= Math.min(limit, eligibleAssets.length); offset += 1) {
    const index = startIndex === -1 ? offset - 1 : (startIndex + offset) % eligibleAssets.length;
    const candidate = eligibleAssets[index];
    if (!candidate || candidate.id === currentAssetId || queue.some((asset) => asset.id === candidate.id)) {
      continue;
    }
    queue.push(candidate);
  }

  return queue;
}

function getFreshProbeCache(assetId: string): QueueProbeCacheEntry | null {
  const entry = queueProbeCache.get(assetId);
  if (!entry) {
    return null;
  }

  const ttl = entry.status === "ready" ? NEXT_ASSET_PROBE_READY_TTL_MS : NEXT_ASSET_PROBE_FAILED_TTL_MS;
  if (Date.now() - entry.checkedAt > ttl) {
    queueProbeCache.delete(assetId);
    return null;
  }

  return entry;
}

async function getPlayableQueuedAssets(queueAssets: AssetRecord[]): Promise<{
  playableQueue: AssetRecord[];
  prefetchedAsset: AssetRecord | null;
  prefetchStatus: "" | "ready" | "failed";
  prefetchError: string;
}> {
  const playableQueue: AssetRecord[] = [];
  let prefetchedAsset: AssetRecord | null = null;
  let prefetchStatus: "" | "ready" | "failed" = "";
  let prefetchError = "";

  for (const asset of queueAssets) {
    const cached = getFreshProbeCache(asset.id);
    if (cached?.status === "ready") {
      prefetchedAsset = prefetchedAsset ?? asset;
      prefetchStatus = "ready";
      playableQueue.push(asset);
      continue;
    }

    if (cached?.status === "failed") {
      if (!prefetchError) {
        prefetchStatus = "failed";
        prefetchError = cached.error;
      }
      continue;
    }

    try {
      const resolvedInput = await resolvePlayableInput(asset.path);
      queueProbeCache.set(asset.id, {
        status: "ready",
        checkedAt: Date.now(),
        resolvedInput,
        error: ""
      });
      prefetchedAsset = prefetchedAsset ?? asset;
      prefetchStatus = "ready";
      playableQueue.push(asset);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown queue prefetch error.";
      queueProbeCache.set(asset.id, {
        status: "failed",
        checkedAt: Date.now(),
        resolvedInput: "",
        error: message
      });
      if (!prefetchError) {
        prefetchStatus = "failed";
        prefetchError = message;
      }
    }
  }

  return {
    playableQueue,
    prefetchedAsset,
    prefetchStatus,
    prefetchError
  };
}

function buildAssetQueueSubtitle(
  state: AppState,
  asset: AssetRecord,
  scheduleItem: ReturnType<typeof getCurrentScheduleItem> | null,
  emphasizeSchedule = false
): string {
  const sourceName = state.sources.find((source) => source.id === asset.sourceId)?.name || "";
  const parts: string[] = [];

  if (emphasizeSchedule && scheduleItem?.title && scheduleItem.title !== asset.title) {
    parts.push(scheduleItem.title);
  }
  if (sourceName) {
    parts.push(sourceName);
  }
  if (asset.categoryName || scheduleItem?.categoryName) {
    parts.push(asset.categoryName || scheduleItem?.categoryName || "");
  }

  return parts.filter(Boolean).join(" · ");
}

function buildRuntimeQueueItems(args: {
  state: AppState;
  selection: SelectionResult;
  currentScheduleItem: ReturnType<typeof getCurrentScheduleItem> | null;
  playableQueue: AssetRecord[];
}): AppState["playout"]["queueItems"] {
  const items: AppState["playout"]["queueItems"] = [];
  const queueHead = buildQueueHeadForSelection({
    state: args.state,
    selection: args.selection,
    currentScheduleItem: args.currentScheduleItem
  });
  const pushItem = (item: Omit<AppState["playout"]["queueItems"][number], "id" | "position">) => {
    const position = items.length;
    items.push({
      id: `${item.kind}-${item.assetId || "scene"}-${position}`,
      position,
      ...item
    });
  };

  if (args.selection.lifecycleStatus === "reconnecting") {
    pushItem({
      kind: "reconnect",
      assetId: "",
      title: queueHead.title,
      subtitle: queueHead.subtitle,
      scenePreset: queueHead.scenePreset
    });
  } else if (
    (args.selection.reasonCode === "operator_insert" || args.selection.reasonCode === "scheduled_insert") &&
    args.selection.asset
  ) {
    pushItem({
      kind: "insert",
      assetId: args.selection.asset.id,
      title: queueHead.title,
      subtitle: queueHead.subtitle,
      scenePreset: queueHead.scenePreset
    });
  } else if (args.selection.lifecycleStatus === "standby" || !args.selection.asset) {
    pushItem({
      kind: "standby",
      assetId: "",
      title: queueHead.title,
      subtitle: queueHead.subtitle,
      scenePreset: queueHead.scenePreset
    });
  } else {
    pushItem({
      kind: "asset",
      assetId: args.selection.asset.id,
      title: queueHead.title,
      subtitle: queueHead.subtitle,
      scenePreset: queueHead.scenePreset
    });
  }

  for (const asset of args.playableQueue.slice(0, 6)) {
    pushItem({
      kind: "asset",
      assetId: asset.id,
      title: asset.title,
      subtitle: buildAssetQueueSubtitle(args.state, asset, null),
      scenePreset: resolveOverlayScenePresetForQueueKind(args.state.overlay.scenePreset, "asset", {
        insertScenePreset: args.state.overlay.insertScenePreset,
        standbyScenePreset: args.state.overlay.standbyScenePreset,
        reconnectScenePreset: args.state.overlay.reconnectScenePreset
      })
    });
  }

  return items;
}

type SelectionResult = {
  asset: AssetRecord | null;
  reason: string;
  lifecycleStatus: AppState["playout"]["status"];
  reasonCode: AppState["playout"]["selectionReasonCode"];
  fallbackTier: AppState["playout"]["fallbackTier"];
};

function buildQueueHeadForSelection(args: {
  state: AppState;
  selection: SelectionResult;
  currentScheduleItem: ReturnType<typeof getCurrentScheduleItem> | null;
}) {
  if (args.selection.reasonCode === "manual_next" && args.selection.asset) {
    return {
      title: args.selection.asset.title,
      subtitle: `Queued next by operator · ${
        buildAssetQueueSubtitle(args.state, args.selection.asset, args.currentScheduleItem) || "Operator queue request"
      }`,
      scenePreset: resolveOverlayScenePresetForQueueKind(args.state.overlay.scenePreset, "asset", {
        insertScenePreset: args.state.overlay.insertScenePreset,
        standbyScenePreset: args.state.overlay.standbyScenePreset,
        reconnectScenePreset: args.state.overlay.reconnectScenePreset
      })
    };
  }

  if ((args.selection.reasonCode === "operator_insert" || args.selection.reasonCode === "scheduled_insert") && args.selection.asset) {
    return {
      title: args.selection.asset.title,
      subtitle: `${args.selection.reasonCode === "operator_insert" ? "Insert" : "Automatic insert"} · ${
        buildAssetQueueSubtitle(args.state, args.selection.asset, args.currentScheduleItem) || "Insert requested"
      }`,
      scenePreset: resolveOverlayScenePresetForQueueKind(args.state.overlay.scenePreset, "insert", {
        insertScenePreset: args.state.overlay.insertScenePreset,
        standbyScenePreset: args.state.overlay.standbyScenePreset,
        reconnectScenePreset: args.state.overlay.reconnectScenePreset
      })
    };
  }

  if (args.selection.lifecycleStatus === "reconnecting") {
    return {
      title: "Scheduled reconnect",
      subtitle: args.selection.reason,
      scenePreset: resolveOverlayScenePresetForQueueKind(args.state.overlay.scenePreset, "reconnect", {
        insertScenePreset: args.state.overlay.insertScenePreset,
        standbyScenePreset: args.state.overlay.standbyScenePreset,
        reconnectScenePreset: args.state.overlay.reconnectScenePreset
      })
    };
  }

  if (args.selection.lifecycleStatus === "standby" || !args.selection.asset) {
    return {
      title: args.state.overlay.standbyHeadline || args.state.overlay.headline || "Replay standby",
      subtitle: args.selection.reason,
      scenePreset: resolveOverlayScenePresetForQueueKind(args.state.overlay.scenePreset, "standby", {
        insertScenePreset: args.state.overlay.insertScenePreset,
        standbyScenePreset: args.state.overlay.standbyScenePreset,
        reconnectScenePreset: args.state.overlay.reconnectScenePreset
      })
    };
  }

  return {
    title: args.selection.asset.title,
    subtitle:
      args.selection.reasonCode === "graceful_handoff"
        ? `Finishing current item · ${buildAssetQueueSubtitle(args.state, args.selection.asset, null) || "Schedule handoff pending"}`
        : buildAssetQueueSubtitle(args.state, args.selection.asset, args.currentScheduleItem, true),
    scenePreset: resolveOverlayScenePresetForQueueKind(args.state.overlay.scenePreset, "asset", {
      insertScenePreset: args.state.overlay.insertScenePreset,
      standbyScenePreset: args.state.overlay.standbyScenePreset,
      reconnectScenePreset: args.state.overlay.reconnectScenePreset
    })
  };
}

function choosePlaybackCandidate(state: AppState): SelectionResult {
  const manualOverrideActive = isTimestampActive(state.playout.overrideUntil);
  const skippedAssetId = isTimestampActive(state.playout.skipUntil) ? state.playout.skipAssetId : "";
  const activeInsertAsset =
    state.playout.insertAssetId !== ""
      ? state.assets.find(
          (asset) => asset.id === state.playout.insertAssetId && asset.status === "ready" && asset.id !== skippedAssetId
        ) ?? null
      : null;
  const manualNextAsset =
    state.playout.manualNextAssetId !== ""
      ? state.assets.find(
          (asset) =>
            asset.id === state.playout.manualNextAssetId &&
            asset.status === "ready" &&
            asset.includeInProgramming !== false &&
            asset.id !== skippedAssetId
        ) ?? null
      : null;
  const desiredAsset =
    manualOverrideActive && state.playout.overrideAssetId !== ""
      ? state.assets.find((asset) => asset.id === state.playout.overrideAssetId && asset.status === "ready")
      : state.playout.restartRequestedAt !== "" && state.playout.desiredAssetId !== ""
        ? state.assets.find((asset) => asset.id === state.playout.desiredAssetId && asset.status === "ready")
        : null;

  if (desiredAsset) {
    return {
      asset: desiredAsset,
      reason:
        state.playout.overrideMode === "fallback"
          ? `Temporary fallback override selected asset ${desiredAsset.title}.`
          : `Operator override selected asset ${desiredAsset.title}.`,
      lifecycleStatus: "recovering" as const,
      reasonCode: "operator_override" as const,
      fallbackTier: "operator" as const
    };
  }

  if (activeInsertAsset && state.playout.insertStatus !== "") {
    return {
      asset: activeInsertAsset,
      reason:
        state.playout.insertStatus === "pending"
          ? `Insert ${activeInsertAsset.title} is queued as the next on-air item.`
          : `Insert ${activeInsertAsset.title} is currently on air.`,
      lifecycleStatus: state.playout.insertStatus === "pending" ? ("recovering" as const) : ("running" as const),
      reasonCode: "operator_insert" as const,
      fallbackTier: "operator" as const
    };
  }

  if (
    manualNextAsset &&
    (state.playout.currentAssetId === "" || state.playout.restartRequestedAt !== "" || state.playout.status === "standby")
  ) {
    return {
      asset: manualNextAsset,
      reason: `Operator queued ${manualNextAsset.title} as the next on-air item.`,
      lifecycleStatus: "recovering" as const,
      reasonCode: "manual_next" as const,
      fallbackTier: "operator" as const
    };
  }

  const currentScheduleItem = getCurrentScheduleItem(state);
  const currentPool = currentScheduleItem?.poolId ? state.pools.find((pool) => pool.id === currentScheduleItem.poolId) ?? null : null;
  const processRunning = Boolean(playoutProcess && !playoutProcess.killed);
  const runningScheduledAsset =
    processRunning &&
    state.playout.currentAssetId !== "" &&
    (state.playout.selectionReasonCode === "scheduled_match" || state.playout.selectionReasonCode === "graceful_handoff")
      ? state.assets.find(
          (asset) => asset.id === state.playout.currentAssetId && asset.status === "ready" && asset.id !== skippedAssetId
        ) ?? null
      : null;
  const autoInsertAsset =
    currentPool &&
    state.playout.currentAssetId === "" &&
    currentPool.insertAssetId &&
    currentPool.insertEveryItems > 0 &&
    currentPool.itemsSinceInsert >= currentPool.insertEveryItems
      ? state.assets.find(
          (asset) =>
            asset.id === currentPool.insertAssetId &&
            asset.status === "ready" &&
            asset.includeInProgramming !== false &&
            asset.id !== skippedAssetId
        ) ?? null
      : null;

  if (autoInsertAsset) {
    return {
      asset: autoInsertAsset,
      reason: `Pool ${currentPool?.name || "schedule"} queued automatic insert ${autoInsertAsset.title}.`,
      lifecycleStatus: "recovering" as const,
      reasonCode: "scheduled_insert" as const,
      fallbackTier: "scheduled" as const
    };
  }

  const currentPoolAsset =
    processRunning && currentScheduleItem?.poolId && state.playout.currentAssetId
      ? state.assets.find(
          (asset) =>
            asset.id === state.playout.currentAssetId &&
            asset.status === "ready" &&
            asset.id !== skippedAssetId &&
            currentPool?.sourceIds.includes(asset.sourceId)
        ) ?? null
      : null;

  if (runningScheduledAsset && (!currentPool || !currentPool.sourceIds.includes(runningScheduledAsset.sourceId))) {
    return {
      asset: runningScheduledAsset,
      reason: `Current on-air asset ${runningScheduledAsset.title} will finish before the next scheduled block takes over.`,
      lifecycleStatus: "running" as const,
      reasonCode: "graceful_handoff" as const,
      fallbackTier: "scheduled" as const
    };
  }

  const preferredAsset = currentScheduleItem?.poolId
    ? currentPoolAsset ?? selectPoolAsset(state, currentScheduleItem.poolId, skippedAssetId)
    : state.assets.find((entry) => {
        if (entry.status !== "ready") {
          return false;
        }
        if (entry.id === skippedAssetId) {
          return false;
        }
        if (entry.includeInProgramming === false) {
          return false;
        }
        const matchingSource = state.sources.find((source) => source.id === entry.sourceId);
        return matchingSource?.name === currentScheduleItem?.sourceName;
      });

  if (preferredAsset) {
    return {
      asset: preferredAsset,
      reason: currentScheduleItem
        ? `Scheduled block ${currentScheduleItem.title} is mapped to asset ${preferredAsset.title}.`
        : `Selected asset ${preferredAsset.title}.`,
      lifecycleStatus: "running" as const,
      reasonCode: "scheduled_match" as const,
      fallbackTier: "scheduled" as const
    };
  }

  const globalFallback = [...state.assets]
    .filter((asset) => asset.status === "ready" && asset.isGlobalFallback && asset.includeInProgramming !== false)
    .filter((asset) => asset.id !== skippedAssetId)
    .sort((left, right) => left.fallbackPriority - right.fallbackPriority)[0];

  if (globalFallback) {
    return {
      asset: globalFallback,
      reason: `Global fallback asset ${globalFallback.title} is selected.`,
      lifecycleStatus: "recovering" as const,
      reasonCode: "global_fallback" as const,
      fallbackTier: "global-fallback" as const
    };
  }

  const anyReadyAsset = [...state.assets]
    .filter((asset) => asset.status === "ready" && asset.includeInProgramming !== false)
    .filter((asset) => asset.id !== skippedAssetId)
    .sort((left, right) => left.fallbackPriority - right.fallbackPriority)[0];

  if (anyReadyAsset) {
    return {
      asset: anyReadyAsset,
      reason: `Fallback asset ${anyReadyAsset.title} is selected.`,
      lifecycleStatus: "recovering" as const,
      reasonCode: "generic_fallback" as const,
      fallbackTier: "generic-fallback" as const
    };
  }

  return {
    asset: null,
    reason: "The playout engine could not find a ready asset to put on air.",
    lifecycleStatus: "failed" as const,
    reasonCode: "no_asset" as const,
    fallbackTier: "none" as const
  };
}

async function stopPlayoutProcess(reason = ""): Promise<void> {
  plannedStopReason = reason;
  const currentProcess = playoutProcess;
  stopSceneRendererLoop();

  if (!currentProcess || currentProcess.killed) {
    playoutProcess = null;
    playoutAssetId = "";
    playoutDestinationId = "";
    playoutDestinationIds = [];
    playoutRuntimeTargets = [];
    playoutTargetKind = "";
    return;
  }

  await new Promise<void>((resolve) => {
    const finalize = () => {
      if (playoutProcess === currentProcess) {
        playoutProcess = null;
        playoutAssetId = "";
        playoutDestinationId = "";
        playoutDestinationIds = [];
        playoutRuntimeTargets = [];
        playoutTargetKind = "";
      }
      resolve();
    };

    currentProcess.once("exit", finalize);
    currentProcess.kill("SIGTERM");

    setTimeout(() => {
      if (currentProcess.exitCode === null && !currentProcess.killed) {
        currentProcess.kill("SIGKILL");
      }
    }, 5_000);
  });
}

function getDesiredTargetKind(selection: SelectionResult): "asset" | "insert" | "standby" | "reconnect" {
  if (selection.reasonCode === "operator_insert" || selection.reasonCode === "scheduled_insert") {
    return "insert";
  }
  if (selection.asset) {
    return "asset";
  }
  return selection.lifecycleStatus === "reconnecting" ? "reconnect" : "standby";
}

function isMatchingRunningTarget(args: {
  selection: SelectionResult;
  destinationIds: string[];
}): boolean {
  if (!playoutProcess || playoutProcess.killed) {
    return false;
  }

  const currentIds = [...playoutDestinationIds].sort();
  const desiredIds = [...args.destinationIds].sort();
  if (currentIds.length !== desiredIds.length || currentIds.some((value, index) => value !== desiredIds[index])) {
    return false;
  }

  const desiredKind = getDesiredTargetKind(args.selection);
  if (desiredKind === "asset") {
    const desiredAsset = args.selection.asset;
    if (!desiredAsset) {
      return false;
    }
    return playoutTargetKind === "asset" && playoutAssetId === desiredAsset.id;
  }

  if (desiredKind === "insert") {
    const desiredAsset = args.selection.asset;
    if (!desiredAsset) {
      return false;
    }
    return playoutTargetKind === "insert" && playoutAssetId === desiredAsset.id;
  }

  return playoutTargetKind === "standby" || playoutTargetKind === "reconnect";
}

async function startOrSwitchPlayout(args: {
  asset: AssetRecord | null;
  destinations: StreamDestinationRecord[];
  outputTarget: ReturnType<typeof buildFfmpegOutputTarget>;
  lifecycleStatus: AppState["playout"]["status"];
  reason: string;
  reasonCode: AppState["playout"]["selectionReasonCode"];
  fallbackTier: AppState["playout"]["fallbackTier"];
  overlayEnabled: boolean;
  runtimeTargets: DestinationRuntimeTarget[];
}): Promise<void> {
  const switching = playoutProcess && !playoutProcess.killed;
  if (switching) {
    await stopPlayoutProcess("switch");
  }

  const leadDestination = args.destinations[0] ?? null;
  if (!leadDestination) {
    throw new Error("Cannot start playout without at least one resolved destination.");
  }

  const ffmpegBinary = process.env.FFMPEG_BIN || "ffmpeg";
  const cachedProbe = args.asset ? getFreshProbeCache(args.asset.id) : null;
  const cachedResolvedInput = cachedProbe?.status === "ready" ? cachedProbe.resolvedInput : "";
  const initialSceneFrame = args.overlayEnabled ? await prepareSceneRendererFrame() : null;
  const overlayMode: OnAirOverlayMode = !args.overlayEnabled ? "none" : initialSceneFrame ? "scene" : "text";
  const command = args.asset
    ? getFfmpegCommand(cachedResolvedInput || (await resolvePlayableInput(args.asset.path)), args.outputTarget, overlayMode)
    : getStandbyFfmpegCommand(args.outputTarget, overlayMode);
  const child = spawn(ffmpegBinary, command, {
    stdio: ["ignore", "pipe", "pipe", "pipe"]
  });

  playoutProcess = child;
  playoutAssetId = args.asset?.id ?? "";
  playoutDestinationId = leadDestination.id;
  playoutDestinationIds = args.destinations.map((destination) => destination.id);
  playoutRuntimeTargets = args.runtimeTargets;
  playoutTargetKind = args.asset
    ? args.reasonCode === "operator_insert" || args.reasonCode === "scheduled_insert"
      ? "insert"
      : "asset"
    : args.lifecycleStatus === "reconnecting"
      ? "reconnect"
      : "standby";

  logRuntimeEvent("playout.process.start", {
    destinationIds: playoutDestinationIds,
    targetKind: playoutTargetKind,
    assetId: args.asset?.id ?? "",
    reasonCode: args.reasonCode,
    lifecycleStatus: args.lifecycleStatus
  });

  const pid = child.pid ?? 0;
  const startedAt = new Date().toISOString();

  if (overlayMode === "scene" && initialSceneFrame && isWritablePipe(child.stdio[ON_AIR_SCENE_PIPE_FD])) {
    startSceneRendererLoop(child.stdio[ON_AIR_SCENE_PIPE_FD], initialSceneFrame);
  } else {
    stopSceneRendererLoop();
  }

  await updatePlayoutRuntime((playout) => ({
    ...playout,
    status:
      args.lifecycleStatus === "standby" || args.lifecycleStatus === "reconnecting"
        ? args.lifecycleStatus
        : switching
          ? "switching"
          : args.lifecycleStatus === "recovering"
            ? "recovering"
            : "starting",
    transitionState: switching ? "switching" : "idle",
    transitionTargetKind: args.asset
      ? args.reasonCode === "operator_insert" || args.reasonCode === "scheduled_insert"
        ? "insert"
        : "asset"
      : args.lifecycleStatus === "reconnecting"
        ? "reconnect"
        : "standby",
    transitionTargetAssetId: args.asset?.id ?? "",
    transitionTargetTitle: args.asset?.title ?? (args.lifecycleStatus === "reconnecting" ? "Scheduled reconnect" : "Replay standby"),
    transitionReadyAt: "",
    currentAssetId: args.asset?.id ?? "",
    currentTitle: args.asset?.title ?? "Replay standby",
    desiredAssetId: args.asset?.id ?? "",
    currentDestinationId: leadDestination.id,
    restartRequestedAt: "",
    heartbeatAt: startedAt,
    processPid: pid,
    processStartedAt: startedAt,
    lastTransitionAt: startedAt,
    selectionReasonCode: args.reasonCode,
    fallbackTier: args.fallbackTier,
    lastError: "",
    pendingAction: "",
    pendingActionRequestedAt: "",
    message: args.reason
  }));

  for (const destination of args.destinations) {
    await updateDestinationRecord({
      ...destination,
      status: "ready",
      lastValidatedAt: startedAt,
      lastError: "",
      notes: `${destination.role === "backup" ? "Backup" : "Primary"} destination is active in the current multi-output group.`
    });
  }

  child.stderr?.on("data", (chunk) => {
    const line = chunk.toString().trim();
    if (!line) {
      return;
    }

    void updatePlayoutRuntime((playout) => ({
      ...playout,
      lastStderrSample: line.slice(0, 400),
      heartbeatAt: new Date().toISOString()
    }));

    if (line.toLowerCase().includes("error")) {
      void upsertIncident({
        scope: "playout",
        severity: "warning",
        title: "FFmpeg reported an error",
        message: line.slice(0, 400),
        fingerprint: "playout.ffmpeg.stderr"
      });
    }

    if (isLikelyDestinationOutputError(line)) {
      const destinationIds = matchDestinationFailuresInLog(line, playoutRuntimeTargets);
      for (const destinationId of destinationIds) {
        void markDestinationFailure(destinationId, line);
      }
    }
  });

  child.on("exit", (code) => {
    const wasPlanned = plannedStopReason !== "";
    const lastDestinationId = playoutDestinationId;
    const lastDestinationIds = [...playoutDestinationIds];
    const lastRuntimeTargets = [...playoutRuntimeTargets];
    plannedStopReason = "";
    stopSceneRendererLoop();
    playoutProcess = null;
    playoutAssetId = "";
    playoutDestinationId = "";
    playoutDestinationIds = [];
    playoutRuntimeTargets = [];
    playoutTargetKind = "";
    const exitedAt = new Date().toISOString();
    logRuntimeEvent("playout.process.exit", {
      exitCode: code ?? "",
      planned: wasPlanned,
      destinationIds: lastDestinationIds,
      exitedAt
    });
    void updatePlayoutRuntime((playout) => ({
      ...playout,
      status:
        wasPlanned || code === 0
          ? "idle"
          : playout.crashCountWindow + 1 >= PLAYOUT_CRASH_LOOP_THRESHOLD
            ? "degraded"
            : "failed",
      heartbeatAt: exitedAt,
      transitionTargetKind: "",
      transitionTargetAssetId: "",
      transitionTargetTitle: "",
      transitionReadyAt: "",
      processPid: 0,
      processStartedAt: "",
      lastSuccessfulStartAt:
        wasPlanned ||
        code === 0 ||
        (playout.processStartedAt !== "" && Date.now() - new Date(playout.processStartedAt).getTime() >= PLAYOUT_CRASH_LOOP_WINDOW_MS)
          ? playout.processStartedAt
          : playout.lastSuccessfulStartAt,
      lastSuccessfulAssetId:
        wasPlanned ||
        code === 0 ||
        (playout.processStartedAt !== "" && Date.now() - new Date(playout.processStartedAt).getTime() >= PLAYOUT_CRASH_LOOP_WINDOW_MS)
          ? playout.currentAssetId
          : playout.lastSuccessfulAssetId,
      lastExitCode: String(code ?? ""),
      restartCount: playout.restartCount + 1,
      crashCountWindow:
        wasPlanned ||
        code === 0 ||
        (playout.processStartedAt !== "" && Date.now() - new Date(playout.processStartedAt).getTime() >= PLAYOUT_CRASH_LOOP_WINDOW_MS)
          ? 0
          : playout.crashCountWindow + 1,
      crashLoopDetected: !wasPlanned && code !== 0 && playout.crashCountWindow + 1 >= PLAYOUT_CRASH_LOOP_THRESHOLD,
      currentAssetId: wasPlanned || code === 0 ? "" : playout.currentAssetId,
      currentTitle: wasPlanned || code === 0 ? "" : playout.currentTitle,
      desiredAssetId: wasPlanned || code === 0 ? "" : playout.desiredAssetId,
      lastError: wasPlanned || code === 0 ? playout.lastError : `FFmpeg exited with code ${String(code)}.`,
      transitionState: "idle",
      insertAssetId:
        !wasPlanned && playout.insertStatus === "active" && playout.currentAssetId === playout.insertAssetId
          ? ""
          : playout.insertAssetId,
      insertRequestedAt:
        !wasPlanned && playout.insertStatus === "active" && playout.currentAssetId === playout.insertAssetId
          ? ""
          : playout.insertRequestedAt,
      insertStatus:
        !wasPlanned && playout.insertStatus === "active" && playout.currentAssetId === playout.insertAssetId
          ? ""
          : playout.insertStatus,
      selectionReasonCode:
        wasPlanned
          ? playout.selectionReasonCode
          : code !== 0 && playout.crashCountWindow + 1 >= PLAYOUT_CRASH_LOOP_THRESHOLD
            ? "ffmpeg_crash_loop"
            : playout.selectionReasonCode,
      message:
        wasPlanned
          ? "Playout stopped for a planned transition."
          : code === 0
            ? "Playout process stopped cleanly."
            : playout.crashCountWindow + 1 >= PLAYOUT_CRASH_LOOP_THRESHOLD
              ? "Playout entered crash-loop protection."
              : "Playout process exited unexpectedly."
    }));
    if (!wasPlanned) {
      void upsertIncident({
        scope: "playout",
        severity: code === 0 ? "info" : "critical",
        title: "FFmpeg process exited",
        message: `FFmpeg exited with code ${String(code)}.`,
        fingerprint: "playout.ffmpeg.exit"
      });
      if (code !== 0) {
        void (async () => {
          const state = await readAppState();
          const lastErrorLine = state.playout.lastStderrSample || `FFmpeg exited with code ${String(code)}.`;
          if (isLikelyDestinationOutputError(lastErrorLine)) {
            const destinationIds = matchDestinationFailuresInLog(lastErrorLine, lastRuntimeTargets);
            for (const destinationId of destinationIds) {
              await markDestinationFailure(destinationId, lastErrorLine);
            }
          } else if (lastRuntimeTargets.length === 1 && lastDestinationId) {
            await markDestinationFailure(lastDestinationId, lastErrorLine);
          }
        })();
      }
    }
  });
}

async function syncDestinations(): Promise<void> {
  const state = await readAppState();
  const managedKeys = await readManagedDestinationStreamKeys(state.destinations.map((destination) => destination.id));
  const now = new Date().toISOString();
  for (const destination of state.destinations) {
    const streamTarget = resolveDestinationStreamTarget({
      destination,
      managedKeys,
      env: process.env
    });
    const envConfig = getLegacyDestinationEnvConfig(destination.id, process.env);
    const managedKey = managedKeys[destination.id] || "";
    const streamKeySource = managedKey ? "managed" : envConfig.key ? "env" : "missing";
    const coolingDown = destination.enabled && Boolean(streamTarget) && isDestinationCoolingDown(destination);
    const readyStatus = destination.enabled ? (streamTarget ? "ready" : "missing-config") : "missing-config";
    await updateDestinationRecord({
      ...destination,
      streamKeyPresent: Boolean(managedKey || envConfig.key),
      streamKeySource,
      status: coolingDown ? "error" : readyStatus,
      lastValidatedAt: now,
      lastError: coolingDown ? destination.lastError : readyStatus === "ready" ? "" : destination.lastError,
      notes: coolingDown
        ? `${
            destination.role === "backup" ? "Backup" : "Primary"
          } destination is cooling down after a recent output failure. Retry in ${getDestinationFailureSecondsRemaining(destination)}s.`
        : streamTarget
          ? `${destination.role === "backup" ? "Backup" : "Primary"} destination is configured and ready for multi-output delivery.`
          : destination.id === "destination-backup"
            ? "Configure BACKUP_STREAM_OUTPUT_URL/KEY or save a managed backup stream key."
            : destination.id === "destination-primary"
              ? "Configure STREAM_OUTPUT_URL/KEY or save a managed primary stream key."
              : "Save a managed stream key for this destination to include it in multi-output delivery."
    });
  }
}

async function runPlayoutCycle(): Promise<void> {
  let state = await readAppState();
  if (
    (state.playout.overrideUntil !== "" && !isTimestampActive(state.playout.overrideUntil)) ||
    (state.playout.skipUntil !== "" && !isTimestampActive(state.playout.skipUntil))
  ) {
    await updatePlayoutRuntime((playout, current) => ({
      ...playout,
      overrideMode: isTimestampActive(playout.overrideUntil) ? playout.overrideMode : "schedule",
      overrideAssetId: isTimestampActive(playout.overrideUntil) ? playout.overrideAssetId : "",
      overrideUntil: isTimestampActive(playout.overrideUntil) ? playout.overrideUntil : "",
      skipAssetId: isTimestampActive(playout.skipUntil) ? playout.skipAssetId : "",
      skipUntil: isTimestampActive(playout.skipUntil) ? playout.skipUntil : ""
    }));
    state = await readAppState();
  }

  const managedDestinationKeys = await readManagedDestinationStreamKeys(state.destinations.map((entry) => entry.id));
  const activeDestinationGroup = selectDestinationRuntimeTargets({
    destinations: state.destinations,
    managedKeys: managedDestinationKeys,
    env: process.env
  });
  const destination = activeDestinationGroup.leadDestination;
  const outputTarget = buildFfmpegOutputTarget(activeDestinationGroup.targets);
  let selection: SelectionResult = choosePlaybackCandidate(state);

  if (state.playout.insertStatus !== "" && selection.reasonCode !== "operator_insert") {
    await updatePlayoutRuntime((playout) => ({
      ...playout,
      insertAssetId: "",
      insertRequestedAt: "",
      insertStatus: "",
      heartbeatAt: new Date().toISOString(),
      message: "The pending insert is no longer available. Returning to scheduled playout."
    }));
    state = await readAppState();
    selection = choosePlaybackCandidate(state);
  }

  if (state.playout.manualNextAssetId !== "" && selection.reasonCode !== "manual_next") {
    const manualNextAsset = state.assets.find(
      (asset) =>
        asset.id === state.playout.manualNextAssetId &&
        asset.status === "ready" &&
        asset.includeInProgramming !== false &&
        asset.id !== (isTimestampActive(state.playout.skipUntil) ? state.playout.skipAssetId : "")
    );

    if (!manualNextAsset) {
      await updatePlayoutRuntime((playout) => ({
        ...playout,
        manualNextAssetId: "",
        manualNextRequestedAt: "",
        heartbeatAt: new Date().toISOString(),
        message: "The requested next item is no longer available. Returning to the scheduled queue."
      }));
      state = await readAppState();
      selection = choosePlaybackCandidate(state);
    }
  }

  if (!destination || activeDestinationGroup.targets.length === 0 || !outputTarget.output) {
    await stopPlayoutProcess("destination-missing");
    await upsertIncident({
      scope: "playout",
      severity: "warning",
      title: "Playout destination is not configured",
      message:
        "Configure at least one enabled output with an RTMP URL and stream key so the worker can build an active multi-output group.",
      fingerprint: "playout.output.missing"
    });

    await updatePlayoutRuntime((playout) => ({
      ...playout,
      status: "degraded",
      transitionTargetKind: "",
      transitionTargetAssetId: "",
      transitionTargetTitle: "",
      transitionReadyAt: "",
      currentAssetId: "",
      currentTitle: "",
      desiredAssetId: "",
      queueItems: [],
      insertAssetId: "",
      insertRequestedAt: "",
      insertStatus: "",
      processPid: 0,
      processStartedAt: "",
      heartbeatAt: new Date().toISOString(),
      selectionReasonCode: "destination_missing",
      fallbackTier: "none",
      message: "No active multi-output RTMP destination group is configured."
    }));
    return;
  }

  await resolveIncident("playout.output.missing", "Playout destination is configured.");

  if (state.playout.pendingAction === "refresh") {
    if (playoutProcess && !playoutProcess.killed && state.playout.currentAssetId) {
      const currentAsset = state.assets.find((asset) => asset.id === state.playout.currentAssetId) ?? null;
      if (currentAsset && state.overlay.enabled) {
        await writeOnAirOverlay(state, currentAsset, state.playout.queueItems[0]?.kind || "asset");
      } else {
        await writeStandbySlate(state, state.playout.queueItems[0]?.kind || "standby");
      }
    } else {
      await writeStandbySlate(state, state.playout.queueItems[0]?.kind || "standby");
    }

    await updatePlayoutRuntime((playout) => ({
      ...playout,
      pendingAction: "",
      pendingActionRequestedAt: "",
      heartbeatAt: new Date().toISOString(),
      message: "Broadcast refresh completed."
    }));
    state = await readAppState();
  } else if (state.playout.pendingAction === "rebuild_queue") {
    await updatePlayoutRuntime((playout) => ({
      ...playout,
      nextAssetId: "",
      nextTitle: "",
      transitionTargetKind: "",
      transitionTargetAssetId: "",
      transitionTargetTitle: "",
      transitionReadyAt: "",
      queuedAssetIds: [],
      queueItems: [],
      pendingAction: "",
      pendingActionRequestedAt: "",
      heartbeatAt: new Date().toISOString(),
      message: "Broadcast queue rebuild completed."
    }));
    state = await readAppState();
  }

  const reconnectActive =
    state.playout.restartRequestedAt !== "" &&
    Date.now() - new Date(state.playout.restartRequestedAt).getTime() < PLAYOUT_RECONNECT_WINDOW_MS;
  const reconnectDue =
    !reconnectActive &&
    state.playout.processStartedAt !== "" &&
    Date.now() - new Date(state.playout.processStartedAt).getTime() >= PLAYOUT_RECONNECT_INTERVAL_MS;

  if (reconnectDue) {
    await stopPlayoutProcess("scheduled-reconnect");
    await updatePlayoutRuntime((playout) => ({
      ...playout,
      restartRequestedAt: new Date().toISOString(),
      message: "Scheduled 24h reconnect is starting."
    }));
    state = await readAppState();
  }

  if (reconnectActive || state.playout.restartRequestedAt !== "") {
    await writeStandbySlate(state, "reconnect");
    selection = {
      asset: null,
      reason: "Scheduled reconnect window is active. Standby slate is on air.",
      lifecycleStatus: "reconnecting" as const,
      reasonCode: "scheduled_reconnect" as const,
      fallbackTier: "standby" as const
    };
  } else if (!selection.asset) {
    await upsertIncident({
      scope: "playout",
      severity: "warning",
      title: "No playable asset available",
      message: selection.reason,
      fingerprint: "playout.no-asset"
    });
    await writeStandbySlate(state, "standby");
    selection = {
      asset: null,
      reason: "No playable asset is available. Standby replay slate is on air.",
      lifecycleStatus: "standby" as const,
      reasonCode: "standby" as const,
      fallbackTier: "standby" as const
    };
  }

  if (selection.asset) {
    if (state.overlay.enabled) {
      await writeOnAirOverlay(
        state,
        selection.asset,
        selection.reasonCode === "operator_insert" || selection.reasonCode === "scheduled_insert" ? "insert" : "asset"
      );
    }
    await resolveIncident("playout.no-asset", "A playable asset is available again.");
  }

  if (state.playout.crashLoopDetected && selection.asset && !state.playout.restartRequestedAt) {
    await stopPlayoutProcess("crash-loop-reset");
    await updatePlayoutRuntime((playout) => ({
      ...playout,
      crashLoopDetected: false,
      crashCountWindow: 0,
      restartRequestedAt: new Date().toISOString(),
      lastError: "",
      status: "recovering",
      message: "A playable asset is available again. Playout is restarting automatically."
    }));
    state = await readAppState();
  }

  if (state.playout.crashLoopDetected && !state.playout.restartRequestedAt) {
    await upsertIncident({
      scope: "playout",
      severity: "critical",
      title: "Playout crash-loop protection is active",
      message: "FFmpeg exited repeatedly. Manual intervention is required before automatic restarts resume.",
      fingerprint: "playout.crash-loop"
    });
    await updatePlayoutRuntime((playout) => ({
      ...playout,
      status: "degraded",
      transitionTargetKind: "",
      transitionTargetAssetId: "",
      transitionTargetTitle: "",
      transitionReadyAt: "",
      heartbeatAt: new Date().toISOString(),
      selectionReasonCode: "ffmpeg_crash_loop",
      message: "Crash-loop protection is active."
    }));
    return;
  }

  await resolveIncident("playout.crash-loop", "Playout crash-loop protection is not active.");

  const restartRequested = Boolean(state.playout.restartRequestedAt);
  const currentScheduleItem = getCurrentScheduleItem(state);
  const manualNextQueueAsset =
    state.playout.manualNextAssetId !== "" && state.playout.manualNextAssetId !== selection.asset?.id
      ? state.assets.find(
          (asset) =>
            asset.id === state.playout.manualNextAssetId &&
            asset.status === "ready" &&
            asset.includeInProgramming !== false &&
            asset.id !== (isTimestampActive(state.playout.skipUntil) ? state.playout.skipAssetId : "")
        ) ?? null
      : null;
  const rawQueueAssets = prioritizeManualNextAsset(
    currentScheduleItem?.poolId &&
    selection.asset &&
    (
      selection.reasonCode === "scheduled_match" ||
      selection.reasonCode === "scheduled_insert" ||
      selection.reasonCode === "graceful_handoff" ||
      selection.reasonCode === "manual_next"
    )
      ? getPoolPlaybackQueue(state, currentScheduleItem.poolId, isTimestampActive(state.playout.skipUntil) ? state.playout.skipAssetId : "", selection.asset.id)
      : [],
    manualNextQueueAsset
  );
  const { playableQueue, prefetchedAsset, prefetchStatus, prefetchError } = await getPlayableQueuedAssets(rawQueueAssets);
  const queueItems = buildRuntimeQueueItems({
    state,
    selection,
    currentScheduleItem,
    playableQueue
  });
  const activeQueueItem = queueItems[0] ?? null;
  const nextQueueItem = queueItems[1] ?? null;
  const targetAlreadyRunning = isMatchingRunningTarget({
    selection,
    destinationIds: activeDestinationGroup.targets.map((entry) => entry.destination.id)
  });

  if (prefetchStatus === "failed" && prefetchError) {
    await upsertIncident({
      scope: "playout",
      severity: "warning",
      title: "Next queued asset probe failed",
      message: prefetchError,
      fingerprint: "playout.prefetch.failed"
    });
  } else {
    await resolveIncident("playout.prefetch.failed", "Next queued asset probe succeeded.");
  }

  if (restartRequested) {
    await stopPlayoutProcess("restart-requested");
    await updatePlayoutRuntime((playout) => ({
      ...playout,
      crashLoopDetected: false,
      crashCountWindow: 0,
      lastError: "",
      restartRequestedAt: reconnectActive || selection.reasonCode === "scheduled_reconnect" ? playout.restartRequestedAt : ""
    }));
    state = await readAppState();
  }

  if (!playoutProcess || playoutProcess.killed || restartRequested) {
    try {
      await startOrSwitchPlayout({
        asset: selection.asset,
        destinations: activeDestinationGroup.targets.map((entry) => entry.destination),
        outputTarget,
        lifecycleStatus: selection.lifecycleStatus,
        reason: selection.reason,
        reasonCode: selection.reasonCode,
        fallbackTier: selection.fallbackTier,
        overlayEnabled: state.overlay.enabled,
        runtimeTargets: activeDestinationGroup.targets
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown playout start error.";
      await upsertIncident({
        scope: "playout",
        severity: "critical",
        title: "Playout failed to start",
        message,
        fingerprint: "playout.start.failed"
      });
      await updatePlayoutRuntime((playout) => ({
        ...playout,
        status: "degraded",
        transitionState: "idle",
        transitionTargetKind: "",
        transitionTargetAssetId: "",
        transitionTargetTitle: "",
        transitionReadyAt: "",
        heartbeatAt: new Date().toISOString(),
        lastError: message,
        selectionReasonCode: "resolve_failed",
        fallbackTier: "none",
        nextAssetId: "",
        nextTitle: "",
        queuedAssetIds: [],
        queueItems: [],
        insertAssetId: "",
        insertRequestedAt: "",
        insertStatus: "",
        prefetchedAssetId: "",
        prefetchedTitle: "",
        prefetchedAt: "",
        prefetchStatus: "",
        prefetchError: "",
        message
      }));
      return;
    }
  } else if (!targetAlreadyRunning) {
    try {
      await startOrSwitchPlayout({
        asset: selection.asset,
        destinations: activeDestinationGroup.targets.map((entry) => entry.destination),
        outputTarget,
        lifecycleStatus: "switching",
        reason: selection.reason,
        reasonCode: selection.reasonCode,
        fallbackTier: selection.fallbackTier,
        overlayEnabled: state.overlay.enabled,
        runtimeTargets: activeDestinationGroup.targets
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown playout switch error.";
      await upsertIncident({
        scope: "playout",
        severity: "critical",
        title: "Playout switch failed",
        message,
        fingerprint: "playout.switch.failed"
      });
      await updatePlayoutRuntime((playout) => ({
        ...playout,
        status: "degraded",
        transitionState: "idle",
        transitionTargetKind: "",
        transitionTargetAssetId: "",
        transitionTargetTitle: "",
        transitionReadyAt: "",
        heartbeatAt: new Date().toISOString(),
        lastError: message,
        selectionReasonCode: "resolve_failed",
        nextAssetId: "",
        nextTitle: "",
        queuedAssetIds: [],
        queueItems: [],
        insertAssetId: "",
        insertRequestedAt: "",
        insertStatus: "",
        prefetchedAssetId: "",
        prefetchedTitle: "",
        prefetchedAt: "",
        prefetchStatus: "",
        prefetchError: "",
        message
      }));
      return;
    }
  } else if (selection.asset && state.overlay.enabled) {
    await writeOnAirOverlay(
      state,
      selection.asset,
      selection.reasonCode === "operator_insert" || selection.reasonCode === "scheduled_insert" ? "insert" : "asset"
    );
  } else if (!selection.asset) {
    await writeStandbySlate(state, selection.lifecycleStatus === "reconnecting" ? "reconnect" : "standby");
  }

  const computedPrefetchedAt = prefetchedAsset ? new Date().toISOString() : "";
  const transitionTargetKind = nextQueueItem?.kind ?? "";
  const transitionTargetAssetId = nextQueueItem?.assetId ?? "";
  const transitionTargetTitle = nextQueueItem?.title ?? "";
  const transitionReadyAt =
    nextQueueItem?.kind === "asset"
      ? prefetchedAsset && nextQueueItem.assetId === prefetchedAsset.id
        ? computedPrefetchedAt
        : ""
      : nextQueueItem
        ? new Date().toISOString()
        : "";

  await updatePlayoutRuntime((playout) => ({
    ...playout,
    status:
      selection.lifecycleStatus === "recovering"
        ? "recovering"
        : selection.lifecycleStatus === "standby"
          ? "standby"
          : selection.lifecycleStatus === "reconnecting"
            ? "reconnecting"
            : "running",
    transitionState:
      selection.lifecycleStatus === "standby" || selection.lifecycleStatus === "reconnecting"
        ? "idle"
        : prefetchedAsset
          ? "ready"
          : rawQueueAssets.length > 0
            ? "prefetching"
            : "idle",
    transitionTargetKind,
    transitionTargetAssetId,
    transitionTargetTitle,
    transitionReadyAt,
    queueVersion: incrementQueueVersion(playout.queueVersion, playout.queueItems, queueItems),
    currentAssetId: selection.asset?.id ?? "",
    currentTitle: activeQueueItem?.title || selection.asset?.title || "Replay standby",
    previousAssetId:
      selection.asset && playout.currentAssetId !== "" && playout.currentAssetId !== selection.asset.id
        ? playout.currentAssetId
        : playout.previousAssetId,
    previousTitle:
      selection.asset && playout.currentAssetId !== "" && playout.currentAssetId !== selection.asset.id
        ? playout.currentTitle
        : playout.previousTitle,
    desiredAssetId: selection.asset?.id ?? "",
    nextAssetId: nextQueueItem?.assetId ?? prefetchedAsset?.id ?? "",
    nextTitle: nextQueueItem?.title ?? prefetchedAsset?.title ?? "",
    queuedAssetIds: playableQueue.map((asset) => asset.id),
    queueItems,
    insertAssetId: selection.reasonCode === "operator_insert" && selection.asset ? selection.asset.id : playout.insertAssetId,
    insertRequestedAt:
      selection.reasonCode === "operator_insert" && selection.asset
        ? playout.insertRequestedAt || new Date().toISOString()
        : playout.insertRequestedAt,
    insertStatus:
      selection.reasonCode === "operator_insert"
        ? "active"
        : selection.lifecycleStatus === "standby" || selection.lifecycleStatus === "reconnecting"
          ? playout.insertStatus
          : playout.insertStatus,
    prefetchedAssetId: prefetchedAsset?.id ?? "",
    prefetchedTitle: prefetchedAsset?.title ?? "",
    prefetchedAt: computedPrefetchedAt,
    prefetchStatus,
    prefetchError,
    currentDestinationId: destination.id,
    restartRequestedAt: selection.reasonCode === "scheduled_reconnect" ? playout.restartRequestedAt : "",
    selectionReasonCode: selection.reasonCode,
    fallbackTier: selection.fallbackTier,
    heartbeatAt: new Date().toISOString(),
    pendingAction: "",
    pendingActionRequestedAt: "",
    manualNextAssetId: selection.asset && playout.manualNextAssetId === selection.asset.id ? "" : playout.manualNextAssetId,
    manualNextRequestedAt:
      selection.asset && playout.manualNextAssetId === selection.asset.id ? "" : playout.manualNextRequestedAt,
    message: activeQueueItem?.subtitle || selection.reason
  }));

  if (
    currentScheduleItem?.poolId &&
    selection.reasonCode === "scheduled_match" &&
    selection.asset &&
    state.playout.currentAssetId !== selection.asset.id
  ) {
    await updatePoolCursor(currentScheduleItem.poolId, selection.asset.id, {
      incrementItemsSinceInsert: true
    });
  }

  if (
    currentScheduleItem?.poolId &&
    selection.reasonCode === "scheduled_insert" &&
    selection.asset &&
    state.playout.currentAssetId !== selection.asset.id
  ) {
    const pool = state.pools.find((entry) => entry.id === currentScheduleItem.poolId) ?? null;
    await updatePoolCursor(currentScheduleItem.poolId, pool?.cursorAssetId ?? "", {
      resetItemsSinceInsert: true
    });
  }
}

async function sendDiscordAlert(message: string): Promise<void> {
  const state = await readAppState();
  const webhookUrl = getDiscordWebhookUrl(state);
  if (!webhookUrl) {
    return;
  }

  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: message })
    });
  } catch {
    // Alert delivery errors should not crash the worker loop.
  }
}

async function sendEmailAlert(subject: string, message: string): Promise<void> {
  const state = await readAppState();
  const smtp = getSmtpConfig(state);
  const host = smtp.host;
  const port = smtp.port;
  const from = smtp.from;
  const to = smtp.to;

  if (!host || !port || !from || !to) {
    return;
  }

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: smtp.user
      ? {
          user: smtp.user,
          pass: smtp.password || ""
        }
      : undefined
  });

  await transporter.sendMail({
    from,
    to,
    subject,
    text: message
  });
}

async function sendAlert(subject: string, message: string): Promise<void> {
  await Promise.allSettled([sendDiscordAlert(`Stream247: ${message}`), sendEmailAlert(subject, message)]);
}

async function syncTwitchSchedule(args: {
  state: AppState;
  accessToken: string;
  timeZone: string;
  clientId: string;
  categoryCache: Map<string, { id: string; name: string } | null>;
}): Promise<void> {
  const syncEveryMs = 15 * 60_000;
  const currentDate = getCurrentScheduleMoment({
    now: new Date(),
    timeZone: args.timeZone
  }).date;

  const desiredOccurrences = Array.from({ length: 7 }, (_, offset) =>
    buildScheduleOccurrences({
      date: addDaysToDateString(currentDate, offset),
      blocks: args.state.scheduleBlocks
    })
  )
    .flat()
    .filter((occurrence) => {
      const startIso = toUtcIsoForLocalDateTime({
        date: occurrence.date,
        minuteOfDay: occurrence.startMinuteOfDay,
        timeZone: args.timeZone
      });
      return new Date(startIso).getTime() > Date.now() + 5 * 60_000;
    });

  const desiredKeys = desiredOccurrences.map((occurrence) => occurrence.key).sort();
  const currentKeys = args.state.twitchScheduleSegments.map((segment) => segment.key).sort();
  const sameKeys =
    desiredKeys.length === currentKeys.length && desiredKeys.every((entry, index) => entry === currentKeys[index]);
  const lastScheduleSyncAt = args.state.twitch.lastScheduleSyncAt ? new Date(args.state.twitch.lastScheduleSyncAt).getTime() : 0;
  if (sameKeys && lastScheduleSyncAt > 0 && Date.now() - lastScheduleSyncAt < syncEveryMs) {
    return;
  }

  const existingSegmentsByKey = new Map(args.state.twitchScheduleSegments.map((segment) => [segment.key, segment]));
  const nextSegments: AppState["twitchScheduleSegments"] = [];
  let skippedCount = 0;

  for (const occurrence of desiredOccurrences) {
    if (occurrence.durationMinutes < 30 || occurrence.durationMinutes > 1380) {
      skippedCount += 1;
      continue;
    }

    const startTime = toUtcIsoForLocalDateTime({
      date: occurrence.date,
      minuteOfDay: occurrence.startMinuteOfDay,
      timeZone: args.timeZone
    });

    let category = args.categoryCache.get(occurrence.categoryName) ?? null;
    if (category === null && !args.categoryCache.has(occurrence.categoryName)) {
      category = await resolveTwitchCategory({
        accessToken: args.accessToken,
        categoryName: occurrence.categoryName,
        clientId: args.clientId
      });
      args.categoryCache.set(occurrence.categoryName, category);
    }

    const existingSegment = existingSegmentsByKey.get(occurrence.key);
    const requestBody: Record<string, string | number | boolean> = {
      start_time: startTime,
      timezone: args.timeZone,
      is_recurring: false,
      duration: occurrence.durationMinutes,
      title: occurrence.title.slice(0, 140)
    };

    if (category?.id) {
      requestBody.category_id = category.id;
    }

    const endpoint = existingSegment
      ? `https://api.twitch.tv/helix/schedule/segment?broadcaster_id=${encodeURIComponent(
          args.state.twitch.broadcasterId
        )}&id=${encodeURIComponent(existingSegment.segmentId)}`
      : `https://api.twitch.tv/helix/schedule/segment?broadcaster_id=${encodeURIComponent(args.state.twitch.broadcasterId)}`;

    const response = await fetch(endpoint, {
      method: existingSegment ? "PATCH" : "POST",
      headers: {
        Authorization: `Bearer ${args.accessToken}`,
        "Client-Id": args.clientId,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      if (response.status === 403) {
        throw new Error("Twitch schedule sync requires the broadcaster to be an affiliate or partner for non-recurring segments.");
      }

      throw new Error(`Twitch schedule segment sync failed with status ${response.status}.`);
    }

    const payload = (await response.json()) as {
      data?: {
        segments?: Array<{ id?: string; start_time?: string; title?: string }>;
      };
    };
    const segment = payload.data?.segments?.[0];
    if (!segment?.id) {
      throw new Error("Twitch schedule sync did not return a segment id.");
    }

    nextSegments.push({
      key: occurrence.key,
      segmentId: segment.id,
      blockId: occurrence.blockId,
      startTime: segment.start_time || startTime,
      title: segment.title || occurrence.title,
      syncedAt: new Date().toISOString()
    });
  }

  for (const staleSegment of args.state.twitchScheduleSegments) {
    if (desiredKeys.includes(staleSegment.key)) {
      continue;
    }

    await fetch(
      `https://api.twitch.tv/helix/schedule/segment?broadcaster_id=${encodeURIComponent(
        args.state.twitch.broadcasterId
      )}&id=${encodeURIComponent(staleSegment.segmentId)}`,
      {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${args.accessToken}`,
          "Client-Id": args.clientId
        }
      }
    );
  }

  await replaceTwitchScheduleSegments(nextSegments);
  await updateTwitchConnectionRecord({
    ...args.state.twitch,
    lastScheduleSyncAt: new Date().toISOString(),
    error: ""
  });

  if (skippedCount > 0) {
    await upsertIncident({
      scope: "twitch",
      severity: "warning",
      title: "Some schedule blocks could not be synced to Twitch",
      message: `${skippedCount} schedule block(s) were skipped because Twitch requires a duration between 30 and 1380 minutes.`,
      fingerprint: "twitch.schedule.duration.skipped"
    });
  } else {
    await resolveIncident("twitch.schedule.duration.skipped", "All schedule blocks fit Twitch schedule duration limits.");
  }
}

async function reconcileTwitch(): Promise<void> {
  const state = await readAppState();
  if (state.twitch.status !== "connected" || !state.twitch.accessToken || !state.twitch.broadcasterId) {
    return;
  }

  const currentScheduleItem = getCurrentScheduleItem(state);
  const currentAsset = state.assets.find((asset) => asset.id === state.playout.currentAssetId) ?? null;
  if (!currentScheduleItem && !currentAsset) {
    return;
  }

  const expiresAt = state.twitch.tokenExpiresAt ? new Date(state.twitch.tokenExpiresAt).getTime() : 0;
  let twitchAccessToken = state.twitch.accessToken;
  const twitchClientId = getTwitchClientId(state);
  if (expiresAt > 0 && expiresAt - Date.now() < 5 * 60_000) {
    twitchAccessToken = await refreshBroadcasterAccessToken();
  }

  const desiredTitle = currentAsset?.title || currentScheduleItem?.title || state.playout.currentTitle;
  let desiredCategoryId = getTwitchDefaultCategoryId(state);
  let desiredCategoryName = currentAsset?.categoryName || currentScheduleItem?.categoryName || "";
  const categoryCache = new Map<string, { id: string; name: string } | null>();
  const presenceStatus = describePresenceStatus({
    activeWindows: state.presenceWindows.map((window) => ({
      actor: window.actor,
      minutes: window.minutes,
      createdAt: new Date(window.createdAt),
      expiresAt: new Date(window.expiresAt)
    })),
    now: new Date(),
    fallbackEmoteOnly: state.moderation.fallbackEmoteOnly
  });

  const sync = async (accessToken: string) => {
    const resolvedCategory = await resolveTwitchCategory({
      accessToken,
      categoryName: currentAsset?.categoryName || currentScheduleItem?.categoryName || "",
      clientId: twitchClientId
    });

    if (resolvedCategory) {
      desiredCategoryId = resolvedCategory.id;
      desiredCategoryName = resolvedCategory.name;
      await resolveIncident(
        "twitch.category.lookup.failed",
        `Resolved Twitch category ${resolvedCategory.name} for the current playout item ${desiredTitle}.`
      );
    } else if (!desiredCategoryId) {
      await upsertIncident({
        scope: "twitch",
        severity: "warning",
        title: "Twitch category lookup failed",
        message: `Could not resolve a Twitch category id for "${currentAsset?.categoryName || currentScheduleItem?.categoryName || "unknown"}". Title sync still continues.`,
        fingerprint: "twitch.category.lookup.failed"
      });
    } else {
      await resolveIncident(
        "twitch.category.lookup.failed",
        `Using default Twitch category for the current playout item ${desiredTitle}.`
      );
    }

    const shouldSyncChannelMetadata =
      state.twitch.lastSyncedTitle !== desiredTitle || state.twitch.lastSyncedCategoryId !== desiredCategoryId;

    if (shouldSyncChannelMetadata) {
      const channelBody: Record<string, string> = { title: desiredTitle };
      if (desiredCategoryId) {
        channelBody.game_id = desiredCategoryId;
      }

      const channelResponse = await fetch(
        `https://api.twitch.tv/helix/channels?broadcaster_id=${encodeURIComponent(state.twitch.broadcasterId)}`,
        {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Client-Id": twitchClientId,
            "Content-Type": "application/json"
          },
          body: JSON.stringify(channelBody)
        }
      );

      if (!channelResponse.ok) {
        throw new Error(`Channel metadata sync failed with status ${channelResponse.status}.`);
      }
    }

    const chatResponse = await fetch(
      `https://api.twitch.tv/helix/chat/settings?broadcaster_id=${encodeURIComponent(
        state.twitch.broadcasterId
      )}&moderator_id=${encodeURIComponent(state.twitch.broadcasterId)}`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Client-Id": twitchClientId,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          emote_mode: presenceStatus.chatMode === "emote-only"
        })
      }
    );

    if (!chatResponse.ok) {
      throw new Error(`Chat settings sync failed with status ${chatResponse.status}.`);
    }

    await updateTwitchConnectionRecord({
      ...state.twitch,
      status: "connected",
      lastMetadataSyncAt: new Date().toISOString(),
      lastSyncedTitle: desiredTitle,
      lastSyncedCategoryName: desiredCategoryName,
      lastSyncedCategoryId: desiredCategoryId,
      error: ""
    });
  };

  try {
    await sync(twitchAccessToken);
    await syncTwitchSchedule({
      state,
      accessToken: twitchAccessToken,
      timeZone: process.env.CHANNEL_TIMEZONE || "UTC",
      clientId: twitchClientId,
      categoryCache
    });
    await resolveIncident("twitch.reconcile.failed", "Twitch reconciliation succeeded.");
    await resolveIncident("twitch.schedule.sync.failed", "Twitch schedule synchronization succeeded.");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Twitch reconciliation error.";
    if (message.includes("401")) {
      try {
        twitchAccessToken = await refreshBroadcasterAccessToken();
        await sync(twitchAccessToken);
        await syncTwitchSchedule({
          state: await readAppState(),
          accessToken: twitchAccessToken,
          timeZone: process.env.CHANNEL_TIMEZONE || "UTC",
          clientId: twitchClientId,
          categoryCache
        });
        await resolveIncident("twitch.reconcile.failed", "Twitch reconciliation succeeded after token refresh.");
        await resolveIncident("twitch.schedule.sync.failed", "Twitch schedule synchronization succeeded after token refresh.");
        return;
      } catch (refreshError) {
        const refreshMessage = refreshError instanceof Error ? refreshError.message : "Unknown Twitch refresh failure.";
        await upsertIncident({
          scope: "twitch",
          severity: "critical",
          title: "Twitch token refresh failed",
          message: refreshMessage,
          fingerprint: "twitch.refresh.failed"
        });
      }
    }

    await upsertIncident({
      scope: "twitch",
      severity: "warning",
      title: "Twitch reconciliation failed",
      message,
      fingerprint: "twitch.reconcile.failed"
    });
    if (message.toLowerCase().includes("schedule")) {
      await upsertIncident({
        scope: "twitch",
        severity: "warning",
        title: "Twitch schedule synchronization failed",
        message,
        fingerprint: "twitch.schedule.sync.failed"
      });
    }
    await sendAlert("Twitch reconciliation warning", message);
  }
}

async function runWorkerCycle(): Promise<void> {
  await syncDestinations();
  await syncLocalMediaLibrary();
  await syncDirectMediaSources();
  await syncYoutubePlaylistSources();
  await syncTwitchVodSources();
  await reconcileTwitch();
  await appendAuditEvent("worker.cycle", "Worker reconciliation cycle completed.");
}

async function runHealthcheck(mode: "worker" | "playout"): Promise<void> {
  const state = await readAppState();
  const now = Date.now();

  if (mode === "worker") {
    const lastWorkerCycle = state.auditEvents.find((event) => event.type === "worker.cycle")?.createdAt ?? "";
    if (!lastWorkerCycle) {
      throw new Error("No worker heartbeat has been recorded yet.");
    }

    if (now - new Date(lastWorkerCycle).getTime() > WORKER_HEARTBEAT_STALE_MS) {
      throw new Error("Worker heartbeat is stale.");
    }

    return;
  }

  if (state.playout.status === "failed") {
    throw new Error("Playout runtime is failed.");
  }

  if (state.playout.crashLoopDetected) {
    throw new Error("Playout crash-loop protection is active.");
  }

  if (state.playout.status !== "idle" && state.playout.heartbeatAt) {
    if (now - new Date(state.playout.heartbeatAt).getTime() > PLAYOUT_HEARTBEAT_STALE_MS) {
      throw new Error("Playout heartbeat is stale.");
    }
  }
}

async function runLoop(mode: "worker" | "playout"): Promise<void> {
  const run = mode === "worker" ? runWorkerCycle : runPlayoutCycle;
  const delay = mode === "worker" ? 30_000 : 15_000;

  for (;;) {
    try {
      await run();
    } catch (error) {
      const message = error instanceof Error ? error.message : `Unknown ${mode} error.`;
      logRuntimeEvent("worker.loop.crashed", {
        mode,
        error: message
      });
      await upsertIncident({
        scope: mode === "worker" ? "worker" : "playout",
        severity: "critical",
        title: `${mode} loop crashed`,
        message,
        fingerprint: `${mode}.loop.crashed`
      });
      await sendAlert(`${mode} loop crashed`, message);
    }

    await new Promise((resolve) => setTimeout(resolve, delay));
  }
}

const command = process.argv[2] || "worker";

if (command === "healthcheck") {
  const healthcheckMode = process.argv[3] === "playout" ? "playout" : "worker";
  runHealthcheck(healthcheckMode).catch((error) => {
    logRuntimeEvent("worker.healthcheck.failed", {
      mode: healthcheckMode,
      error: error instanceof Error ? error.message : String(error)
    });
    process.exit(1);
  });
} else {
  const mode = command === "playout" ? "playout" : "worker";
  runLoop(mode).catch((error) => {
    logRuntimeEvent("worker.process.failed", {
      mode,
      error: error instanceof Error ? error.message : String(error)
    });
    process.exit(1);
  });
}
