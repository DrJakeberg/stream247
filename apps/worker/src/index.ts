import { promises as fs } from "node:fs";
import { execFile, spawn, type ChildProcessByStdio } from "node:child_process";
import nodemailer from "nodemailer";
import path from "node:path";
import type { Readable } from "node:stream";
import {
  addDaysToDateString,
  buildScheduleOccurrences,
  buildSchedulePreview,
  describePresenceStatus,
  getCurrentScheduleMoment,
  isCurrentScheduleTime,
  isLikelyTwitchChannelUrl,
  isLikelyTwitchVodUrl,
  isLikelyYouTubeChannelUrl,
  isLikelyYouTubePlaylistUrl,
  toUtcIsoForLocalDateTime
} from "@stream247/core";
import {
  appendAuditEvent,
  readAppState,
  resolveIncident,
  updateAppState,
  upsertIncident,
  type AppState,
  type AssetRecord,
  type StreamDestinationRecord
} from "@stream247/db";

const mediaExtensions = new Set([".mp4", ".mkv", ".mov", ".m4v", ".webm"]);
let playoutProcess: ChildProcessByStdio<null, Readable, Readable> | null = null;
let playoutAssetId = "";
let playoutDestinationId = "";
let plannedStopReason = "";
const WORKER_HEARTBEAT_STALE_MS = 120_000;
const PLAYOUT_HEARTBEAT_STALE_MS = 60_000;
const PLAYOUT_CRASH_LOOP_THRESHOLD = 3;
const PLAYOUT_CRASH_LOOP_WINDOW_MS = 10 * 60_000;
const PLAYOUT_RECONNECT_INTERVAL_MS = Number(process.env.PLAYOUT_RECONNECT_HOURS || "24") * 60 * 60 * 1000;
const PLAYOUT_RECONNECT_WINDOW_MS = Number(process.env.PLAYOUT_RECONNECT_SECONDS || "20") * 1000;
const standbySlatePath = "/tmp/stream247-standby.txt";

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

function getConfiguredStreamTarget(destination: StreamDestinationRecord | null): string | null {
  if (!destination?.enabled) {
    return null;
  }

  const envUrl = process.env.STREAM_OUTPUT_URL || process.env.TWITCH_RTMP_URL;
  const envKey = process.env.STREAM_OUTPUT_KEY || process.env.TWITCH_STREAM_KEY;
  const streamUrl = destination.rtmpUrl || envUrl;
  const streamKey = envKey;

  if (!streamUrl || !streamKey) {
    return null;
  }

  return `${streamUrl.replace(/\/$/, "")}/${streamKey}`;
}

function getFfmpegCommand(input: string, output: string): string[] {
  return [
    "-hide_banner",
    "-loglevel",
    "warning",
    "-re",
    "-stream_loop",
    "-1",
    "-i",
    input,
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
    "flv",
    output
  ];
}

function getStandbyFfmpegCommand(output: string): string[] {
  return [
    "-hide_banner",
    "-loglevel",
    "warning",
    "-re",
    "-f",
    "lavfi",
    "-i",
    "color=c=0x0b1f18:s=1280x720:r=30",
    "-f",
    "lavfi",
    "-i",
    "anullsrc=channel_layout=stereo:sample_rate=44100",
    "-vf",
    `drawtext=fontfile=/usr/share/fonts/TTF/DejaVuSans.ttf:textfile=${standbySlatePath}:reload=1:fontcolor=white:fontsize=34:x=(w-text_w)/2:y=(h-text_h)/2:line_spacing=12`,
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
    "flv",
    output
  ];
}

async function writeStandbySlate(state: AppState): Promise<void> {
  const currentItem = getCurrentScheduleItem(state);
  const nextPreview = buildSchedulePreview({
    date: getCurrentScheduleMoment({
      now: new Date(),
      timeZone: process.env.CHANNEL_TIMEZONE || "UTC"
    }).date,
    blocks: state.scheduleBlocks
  }).items;
  const nextItem = nextPreview.find((item) => item.id !== currentItem?.blockId) ?? null;
  const lines = [
    state.overlay.replayLabel || "Replay stream",
    state.overlay.headline || "Please wait, restream is starting",
    currentItem ? `Current: ${currentItem.title}` : "Current: Stand by",
    nextItem ? `Next: ${nextItem.title} ${nextItem.startTime}-${nextItem.endTime}` : "Next: Programming will resume shortly"
  ];
  await fs.writeFile(standbySlatePath, `${lines.join("\n")}\n`, "utf8");
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

  await updateAppState((current) => ({
    ...current,
    twitch: {
      ...current.twitch,
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token ?? current.twitch.refreshToken,
      status: "connected",
      tokenExpiresAt,
      lastRefreshAt: refreshedAt,
      error: ""
    }
  }));

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
  const isFallback = filePath.toLowerCase().includes("fallback") || filePath.toLowerCase().includes("standby");
  const id = `asset_${Buffer.from(filePath).toString("base64url").slice(0, 32)}`;
  return {
    id,
    sourceId: "source-local-library",
    title: path.basename(filePath, path.extname(filePath)).replace(/[_-]+/g, " "),
    path: filePath,
    status: "ready",
    fallbackPriority: isFallback ? 1 : 100,
    isGlobalFallback: isFallback,
    createdAt: now,
    updatedAt: now
  };
}

async function syncLocalMediaLibrary(): Promise<void> {
  const mediaRoot = getMediaRoot();
  const discoveredFiles = await walkMediaFiles(mediaRoot);
  const now = new Date().toISOString();
  const discoveredAssets = discoveredFiles.map((filePath) => buildAssetFromPath(filePath, now));

  await updateAppState((state) => {
    const existingByPath = new Map(state.assets.map((asset) => [asset.path, asset]));
    const nextAssets: AssetRecord[] = discoveredAssets.map((asset) => {
      const existing = existingByPath.get(asset.path);
      return existing
        ? {
            ...existing,
            title: asset.title,
            status: "ready",
            fallbackPriority: asset.fallbackPriority,
            isGlobalFallback: asset.isGlobalFallback,
            updatedAt: now
          }
        : asset;
    });

    const otherAssets = state.assets.filter((asset) => asset.sourceId !== "source-local-library");
    const nextSources: AppState["sources"] = state.sources.some((source) => source.id === "source-local-library")
      ? state.sources.map((source) =>
          source.id === "source-local-library"
            ? {
                ...source,
                status: nextAssets.length > 0 ? "Ready" : "Empty",
                lastSyncedAt: now
              }
            : source
        )
      : [
          ...state.sources,
          {
            id: "source-local-library",
            name: "Local Media Library",
            type: "Filesystem scan",
            connectorKind: "local-library",
            status: nextAssets.length > 0 ? "Ready" : "Empty",
            externalUrl: "",
            notes: "Scans files mounted into the media library volume.",
            lastSyncedAt: now
          }
        ];

    return {
      ...state,
      sources: nextSources,
      assets: [...nextAssets, ...otherAssets]
    };
  });

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
}

async function syncDirectMediaSources(): Promise<void> {
  const state = await readAppState();
  const now = new Date().toISOString();
  const directSources = state.sources.filter(
    (source) => source.connectorKind === "direct-media" && (source.enabled ?? true)
  );
  const directAssets: AssetRecord[] = [];
  let hasInvalidSource = false;

  for (const source of directSources) {
    const url = source.externalUrl?.trim() ?? "";
    if (!isDirectMediaUrl(url)) {
      hasInvalidSource = true;
      continue;
    }

    directAssets.push({
      id: `asset_${source.id}`,
      sourceId: source.id,
      title: source.name,
      path: url,
      status: "ready",
      externalId: source.id,
      fallbackPriority: 100,
      isGlobalFallback: false,
      createdAt: now,
      updatedAt: now
    });
  }

  await updateAppState((current) => ({
    ...current,
    sources: current.sources.map((source) => {
      if (source.connectorKind !== "direct-media") {
        return source;
      }

      const valid = isDirectMediaUrl(source.externalUrl?.trim() ?? "");
      return {
        ...source,
        status: valid ? "Ready" : "Invalid URL",
        notes: valid
          ? "Direct media URL normalized into the playout asset catalog."
          : "Direct media sources currently require an http(s) URL ending in a supported media file extension.",
        lastSyncedAt: now
      };
    }),
    assets: [
      ...directAssets,
      ...current.assets.filter((asset) => {
        const matchingSource = current.sources.find((source) => source.id === asset.sourceId);
        return matchingSource?.connectorKind !== "direct-media";
      })
    ]
  }));

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
    status: "ready",
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

function fromUnixTimestamp(value?: number): string | undefined {
  return typeof value === "number" && Number.isFinite(value) ? new Date(value * 1000).toISOString() : undefined;
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

  for (const source of youtubeSources) {
    const externalUrl = source.externalUrl?.trim() ?? "";
    const isValid =
      source.connectorKind === "youtube-playlist"
        ? isLikelyYouTubePlaylistUrl(externalUrl)
        : isLikelyYouTubeChannelUrl(externalUrl);
    if (!isValid) {
      hadFailure = true;
      continue;
    }

    try {
      const payload = await loadFlatCollection(externalUrl);
      const entries = payload.entries ?? [];

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
            externalId: entry.id,
            durationSeconds: entry.duration,
            publishedAt: fromUnixTimestamp(entry.timestamp),
            now
          })
        );
      }
    } catch (error) {
      hadFailure = true;
      const message = error instanceof Error ? error.message : "Unknown YouTube playlist ingestion error.";
      await upsertIncident({
        scope: "source",
        severity: "warning",
        title: source.connectorKind === "youtube-channel" ? "YouTube channel ingestion failed" : "YouTube playlist ingestion failed",
        message: `${source.name}: ${message}`,
        fingerprint: `source.${source.connectorKind}.${source.id}`
      });
    }
  }

  await updateAppState((current) => ({
    ...current,
    sources: current.sources.map((source) => {
      if (source.connectorKind !== "youtube-playlist" && source.connectorKind !== "youtube-channel") {
        return source;
      }

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
    }),
    assets: [
      ...youtubeAssets,
      ...current.assets.filter((asset) => {
        const matchingSource = current.sources.find((source) => source.id === asset.sourceId);
        return matchingSource?.connectorKind !== "youtube-playlist" && matchingSource?.connectorKind !== "youtube-channel";
      })
    ]
  }));

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

  for (const source of twitchSources) {
    const externalUrl = source.externalUrl?.trim() ?? "";
    const isValid =
      source.connectorKind === "twitch-vod" ? isLikelyTwitchVodUrl(externalUrl) : isLikelyTwitchChannelUrl(externalUrl);
    if (!isValid) {
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
            externalId: payload.id,
            categoryName: payload.category || payload.categories?.[0] || "",
            durationSeconds: payload.duration,
            publishedAt: fromUnixTimestamp(payload.timestamp),
            now
          })
        );
      } else {
        const payload = await loadFlatCollection(externalUrl);
        for (const entry of payload.entries ?? []) {
          const id = entry.id ?? "";
          if (!id) {
            continue;
          }

          twitchAssets.push(
            buildRemoteAsset({
              sourceId: source.id,
              assetIdSeed: id,
              title: entry.title || source.name,
              path: entry.webpage_url || `https://www.twitch.tv/videos/${id}`,
              externalId: id,
              durationSeconds: entry.duration,
              publishedAt: fromUnixTimestamp(entry.timestamp),
              now
            })
          );
        }
      }

      await resolveIncident(`source.${source.connectorKind}.${source.id}`, `Twitch source ${source.name} ingested successfully.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown Twitch VOD ingestion error.";
      await upsertIncident({
        scope: "source",
        severity: "warning",
        title: source.connectorKind === "twitch-channel" ? "Twitch channel ingestion failed" : "Twitch VOD ingestion failed",
        message: `${source.name}: ${message}`,
        fingerprint: `source.${source.connectorKind}.${source.id}`
      });
    }
  }

  await updateAppState((current) => ({
    ...current,
    sources: current.sources.map((source) => {
      if (source.connectorKind !== "twitch-vod" && source.connectorKind !== "twitch-channel") {
        return source;
      }

      const sourceAssetCount = twitchAssets.filter((asset) => asset.sourceId === source.id).length;
      return {
        ...source,
        status: sourceAssetCount > 0 ? "Ready" : "Ingestion failed",
        notes:
          sourceAssetCount > 0
            ? "Ingested the Twitch VOD into a playable asset via yt-dlp."
            : "Could not ingest this VOD. Check the URL and worker incident log.",
        lastSyncedAt: now
      };
    }),
    assets: [
      ...twitchAssets,
      ...current.assets.filter((asset) => {
        const matchingSource = current.sources.find((source) => source.id === asset.sourceId);
        return matchingSource?.connectorKind !== "twitch-vod" && matchingSource?.connectorKind !== "twitch-channel";
      })
    ]
  }));
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

function selectPoolAsset(state: AppState, poolId: string, skippedAssetId: string): AssetRecord | null {
  const pool = state.pools.find((entry) => entry.id === poolId);
  if (!pool) {
    return null;
  }

  const eligibleAssets = state.assets.filter((asset) => {
    if (asset.status !== "ready" || asset.id === skippedAssetId) {
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

type SelectionResult = {
  asset: AssetRecord | null;
  reason: string;
  lifecycleStatus: AppState["playout"]["status"];
  reasonCode: AppState["playout"]["selectionReasonCode"];
  fallbackTier: AppState["playout"]["fallbackTier"];
};

function choosePlaybackCandidate(state: AppState): SelectionResult {
  const manualOverrideActive = isTimestampActive(state.playout.overrideUntil);
  const skippedAssetId = isTimestampActive(state.playout.skipUntil) ? state.playout.skipAssetId : "";
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

  const currentScheduleItem = getCurrentScheduleItem(state);
  const preferredAsset = currentScheduleItem?.poolId
    ? selectPoolAsset(state, currentScheduleItem.poolId, skippedAssetId)
    : state.assets.find((entry) => {
        if (entry.status !== "ready") {
          return false;
        }
        if (entry.id === skippedAssetId) {
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
    .filter((asset) => asset.status === "ready" && asset.isGlobalFallback)
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
    .filter((asset) => asset.status === "ready")
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

function stopPlayoutProcess(reason = ""): void {
  plannedStopReason = reason;
  if (playoutProcess && !playoutProcess.killed) {
    playoutProcess.kill("SIGTERM");
  }
  playoutProcess = null;
  playoutAssetId = "";
  playoutDestinationId = "";
}

async function startOrSwitchPlayout(args: {
  asset: AssetRecord | null;
  destination: StreamDestinationRecord;
  streamTarget: string;
  lifecycleStatus: AppState["playout"]["status"];
  reason: string;
  reasonCode: AppState["playout"]["selectionReasonCode"];
  fallbackTier: AppState["playout"]["fallbackTier"];
}): Promise<void> {
  const switching = playoutProcess && !playoutProcess.killed;
  if (switching) {
    stopPlayoutProcess("switch");
  }

  const ffmpegBinary = process.env.FFMPEG_BIN || "ffmpeg";
  const command = args.asset
    ? getFfmpegCommand(await resolvePlayableInput(args.asset.path), args.streamTarget)
    : getStandbyFfmpegCommand(args.streamTarget);
  const child = spawn(ffmpegBinary, command, {
    stdio: ["ignore", "pipe", "pipe"]
  });

  playoutProcess = child;
  playoutAssetId = args.asset?.id ?? "";
  playoutDestinationId = args.destination.id;

  const pid = child.pid ?? 0;
  const startedAt = new Date().toISOString();

  await updateAppState((current) => ({
    ...current,
    playout: {
      ...current.playout,
      status:
        args.lifecycleStatus === "standby" || args.lifecycleStatus === "reconnecting"
          ? args.lifecycleStatus
          : switching
            ? "switching"
            : args.lifecycleStatus === "recovering"
              ? "recovering"
              : "starting",
      currentAssetId: args.asset?.id ?? "",
      currentTitle: args.asset?.title ?? "Replay standby",
      desiredAssetId: args.asset?.id ?? "",
      currentDestinationId: args.destination.id,
      restartRequestedAt: "",
      heartbeatAt: startedAt,
      processPid: pid,
      processStartedAt: startedAt,
      selectionReasonCode: args.reasonCode,
      fallbackTier: args.fallbackTier,
      lastError: "",
      message: args.reason
    }
  }));

  child.stderr.on("data", (chunk) => {
    const line = chunk.toString().trim();
    if (!line) {
      return;
    }

    void updateAppState((current) => ({
      ...current,
      playout: {
        ...current.playout,
        lastStderrSample: line.slice(0, 400),
        heartbeatAt: new Date().toISOString()
      }
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
  });

  child.on("exit", (code) => {
    const wasPlanned = plannedStopReason !== "";
    plannedStopReason = "";
    playoutProcess = null;
    playoutAssetId = "";
    playoutDestinationId = "";
    const exitedAt = new Date().toISOString();
    void updateAppState((current) => ({
      ...current,
      playout: {
        ...current.playout,
        status:
          wasPlanned || code === 0
            ? "idle"
            : current.playout.crashCountWindow + 1 >= PLAYOUT_CRASH_LOOP_THRESHOLD
              ? "degraded"
              : "failed",
        heartbeatAt: exitedAt,
        processPid: 0,
        processStartedAt: "",
        lastSuccessfulStartAt:
          wasPlanned ||
          code === 0 ||
          (current.playout.processStartedAt !== "" &&
            Date.now() - new Date(current.playout.processStartedAt).getTime() >= PLAYOUT_CRASH_LOOP_WINDOW_MS)
            ? current.playout.processStartedAt
            : current.playout.lastSuccessfulStartAt,
        lastSuccessfulAssetId:
          wasPlanned ||
          code === 0 ||
          (current.playout.processStartedAt !== "" &&
            Date.now() - new Date(current.playout.processStartedAt).getTime() >= PLAYOUT_CRASH_LOOP_WINDOW_MS)
            ? current.playout.currentAssetId
            : current.playout.lastSuccessfulAssetId,
        lastExitCode: String(code ?? ""),
        restartCount: current.playout.restartCount + 1,
        crashCountWindow:
          wasPlanned ||
          code === 0 ||
          (current.playout.processStartedAt !== "" &&
            Date.now() - new Date(current.playout.processStartedAt).getTime() >= PLAYOUT_CRASH_LOOP_WINDOW_MS)
            ? 0
            : current.playout.crashCountWindow + 1,
        crashLoopDetected:
          !wasPlanned &&
          code !== 0 &&
          (code === null ? current.playout.crashCountWindow + 1 : current.playout.crashCountWindow + 1) >=
            PLAYOUT_CRASH_LOOP_THRESHOLD,
        lastError: wasPlanned || code === 0 ? current.playout.lastError : `FFmpeg exited with code ${String(code)}.`,
        selectionReasonCode:
          wasPlanned
            ? current.playout.selectionReasonCode
            :
          code !== 0 && current.playout.crashCountWindow + 1 >= PLAYOUT_CRASH_LOOP_THRESHOLD
            ? "ffmpeg_crash_loop"
            : current.playout.selectionReasonCode,
        message:
          wasPlanned
            ? "Playout stopped for a planned transition."
            : code === 0
            ? "Playout process stopped cleanly."
            : current.playout.crashCountWindow + 1 >= PLAYOUT_CRASH_LOOP_THRESHOLD
              ? "Playout entered crash-loop protection."
              : "Playout process exited unexpectedly."
      }
    }));
    if (!wasPlanned) {
      void upsertIncident({
        scope: "playout",
        severity: code === 0 ? "info" : "critical",
        title: "FFmpeg process exited",
        message: `FFmpeg exited with code ${String(code)}.`,
        fingerprint: "playout.ffmpeg.exit"
      });
    }
  });
}

async function syncDestinations(): Promise<void> {
  const now = new Date().toISOString();
  await updateAppState((state) => ({
    ...state,
    destinations: state.destinations.map((destination) => {
      const streamTarget = getConfiguredStreamTarget(destination);
      return {
        ...destination,
        streamKeyPresent: Boolean(process.env.STREAM_OUTPUT_KEY || process.env.TWITCH_STREAM_KEY),
        status: destination.enabled ? (streamTarget ? "ready" : "missing-config") : "missing-config",
        lastValidatedAt: now,
        notes: streamTarget
          ? "Destination is configured and ready for FFmpeg output."
          : "Configure STREAM_OUTPUT_URL/KEY or TWITCH_RTMP_URL/TWITCH_STREAM_KEY."
      };
    })
  }));
}

async function runPlayoutCycle(): Promise<void> {
  let state = await readAppState();
  if (
    (state.playout.overrideUntil !== "" && !isTimestampActive(state.playout.overrideUntil)) ||
    (state.playout.skipUntil !== "" && !isTimestampActive(state.playout.skipUntil))
  ) {
    state = await updateAppState((current) => ({
      ...current,
      playout: {
        ...current.playout,
        overrideMode: isTimestampActive(current.playout.overrideUntil) ? current.playout.overrideMode : "schedule",
        overrideAssetId: isTimestampActive(current.playout.overrideUntil) ? current.playout.overrideAssetId : "",
        overrideUntil: isTimestampActive(current.playout.overrideUntil) ? current.playout.overrideUntil : "",
        skipAssetId: isTimestampActive(current.playout.skipUntil) ? current.playout.skipAssetId : "",
        skipUntil: isTimestampActive(current.playout.skipUntil) ? current.playout.skipUntil : ""
      }
    }));
  }

  const destination = state.destinations.find((entry) => entry.enabled) ?? null;
  const streamTarget = getConfiguredStreamTarget(destination);
  let selection: SelectionResult = choosePlaybackCandidate(state);

  if (!destination || !streamTarget) {
    stopPlayoutProcess("destination-missing");
    await upsertIncident({
      scope: "playout",
      severity: "warning",
      title: "Playout destination is not configured",
      message: "Set STREAM_OUTPUT_URL and STREAM_OUTPUT_KEY or TWITCH_RTMP_URL and TWITCH_STREAM_KEY to enable FFmpeg playout.",
      fingerprint: "playout.output.missing"
    });

    await updateAppState((current) => ({
      ...current,
      playout: {
        ...current.playout,
        status: "degraded",
        currentAssetId: "",
        currentTitle: "",
        desiredAssetId: "",
        processPid: 0,
        processStartedAt: "",
        heartbeatAt: new Date().toISOString(),
        selectionReasonCode: "destination_missing",
        fallbackTier: "none",
        message: "No active RTMP destination is configured."
      }
    }));
    return;
  }

  await resolveIncident("playout.output.missing", "Playout destination is configured.");

  const reconnectActive =
    state.playout.restartRequestedAt !== "" &&
    Date.now() - new Date(state.playout.restartRequestedAt).getTime() < PLAYOUT_RECONNECT_WINDOW_MS;
  const reconnectDue =
    !reconnectActive &&
    state.playout.processStartedAt !== "" &&
    Date.now() - new Date(state.playout.processStartedAt).getTime() >= PLAYOUT_RECONNECT_INTERVAL_MS;

  if (reconnectDue) {
    stopPlayoutProcess("scheduled-reconnect");
    state = await updateAppState((current) => ({
      ...current,
      playout: {
        ...current.playout,
        restartRequestedAt: new Date().toISOString(),
        message: "Scheduled 24h reconnect is starting."
      }
    }));
  }

  if (reconnectActive || state.playout.restartRequestedAt !== "") {
    await writeStandbySlate(state);
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
    await writeStandbySlate(state);
    selection = {
      asset: null,
      reason: "No playable asset is available. Standby replay slate is on air.",
      lifecycleStatus: "standby" as const,
      reasonCode: "standby" as const,
      fallbackTier: "standby" as const
    };
  }

  if (selection.asset) {
    await resolveIncident("playout.no-asset", "A playable asset is available again.");
  }

  if (state.playout.crashLoopDetected && !state.playout.restartRequestedAt) {
    await upsertIncident({
      scope: "playout",
      severity: "critical",
      title: "Playout crash-loop protection is active",
      message: "FFmpeg exited repeatedly. Manual intervention is required before automatic restarts resume.",
      fingerprint: "playout.crash-loop"
    });
    await updateAppState((current) => ({
      ...current,
      playout: {
        ...current.playout,
        status: "degraded",
        heartbeatAt: new Date().toISOString(),
        selectionReasonCode: "ffmpeg_crash_loop",
        message: "Crash-loop protection is active."
      }
    }));
    return;
  }

  await resolveIncident("playout.crash-loop", "Playout crash-loop protection is not active.");

  const restartRequested = Boolean(state.playout.restartRequestedAt);
  const currentScheduleItem = getCurrentScheduleItem(state);
  if (restartRequested) {
    stopPlayoutProcess("restart-requested");
    state = await updateAppState((current) => ({
      ...current,
      playout: {
        ...current.playout,
        crashLoopDetected: false,
        crashCountWindow: 0,
        lastError: "",
        restartRequestedAt:
          reconnectActive || selection.reasonCode === "scheduled_reconnect" ? current.playout.restartRequestedAt : ""
      }
    }));
  }

  if (!playoutProcess || playoutProcess.killed || restartRequested) {
    try {
      await startOrSwitchPlayout({
        asset: selection.asset,
        destination,
        streamTarget,
        lifecycleStatus: selection.lifecycleStatus,
        reason: selection.reason,
        reasonCode: selection.reasonCode,
        fallbackTier: selection.fallbackTier
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
      await updateAppState((current) => ({
        ...current,
        playout: {
          ...current.playout,
          status: "degraded",
          heartbeatAt: new Date().toISOString(),
          lastError: message,
          selectionReasonCode: "resolve_failed",
          fallbackTier: "none",
          message
        }
      }));
      return;
    }
  } else if (selection.asset && (playoutAssetId !== selection.asset.id || playoutDestinationId !== destination.id)) {
    try {
      await startOrSwitchPlayout({
        asset: selection.asset,
        destination,
        streamTarget,
        lifecycleStatus: "switching",
        reason: selection.reason,
        reasonCode: selection.reasonCode,
        fallbackTier: selection.fallbackTier
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
      await updateAppState((current) => ({
        ...current,
        playout: {
          ...current.playout,
          status: "degraded",
          heartbeatAt: new Date().toISOString(),
          lastError: message,
          selectionReasonCode: "resolve_failed",
          message
        }
      }));
      return;
    }
  }

  await updateAppState((current) => ({
    ...current,
    pools:
      currentScheduleItem?.poolId && selection.reasonCode === "scheduled_match"
        ? current.pools.map((pool) =>
            pool.id === currentScheduleItem.poolId
              ? {
                  ...pool,
                  cursorAssetId: selection.asset?.id ?? pool.cursorAssetId,
                  updatedAt: new Date().toISOString()
                }
              : pool
          )
        : current.pools,
    playout: {
      ...current.playout,
      status:
        selection.lifecycleStatus === "recovering"
          ? "recovering"
          : selection.lifecycleStatus === "standby"
            ? "standby"
            : selection.lifecycleStatus === "reconnecting"
              ? "reconnecting"
              : "running",
      currentAssetId: selection.asset?.id ?? "",
      currentTitle: selection.asset?.title ?? "Replay standby",
      desiredAssetId: selection.asset?.id ?? "",
      currentDestinationId: destination.id,
      restartRequestedAt: selection.reasonCode === "scheduled_reconnect" ? current.playout.restartRequestedAt : "",
      overrideMode: current.playout.overrideMode,
      overrideAssetId: current.playout.overrideAssetId,
      overrideUntil: current.playout.overrideUntil,
      skipAssetId: current.playout.skipAssetId,
      skipUntil: current.playout.skipUntil,
      selectionReasonCode: selection.reasonCode,
      fallbackTier: selection.fallbackTier,
      heartbeatAt: new Date().toISOString(),
      message: selection.reason
    }
  }));
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

  await updateAppState((current) => ({
    ...current,
    twitch: {
      ...current.twitch,
      lastScheduleSyncAt: new Date().toISOString(),
      error: ""
    },
    twitchScheduleSegments: nextSegments
  }));

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

    await updateAppState((current) => ({
      ...current,
      twitch: {
        ...current.twitch,
        status: "connected",
        lastMetadataSyncAt: new Date().toISOString(),
        lastSyncedTitle: desiredTitle,
        lastSyncedCategoryName: desiredCategoryName,
        lastSyncedCategoryId: desiredCategoryId,
        error: ""
      }
    }));
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
    // eslint-disable-next-line no-console
    console.error(error);
    process.exit(1);
  });
} else {
  const mode = command === "playout" ? "playout" : "worker";
  runLoop(mode).catch((error) => {
    // eslint-disable-next-line no-console
    console.error(error);
    process.exit(1);
  });
}
