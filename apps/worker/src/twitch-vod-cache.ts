import { promises as fs } from "node:fs";
import path from "node:path";
import type { AssetRecord } from "@stream247/db";
import { execFileText } from "./process-utils.js";

export const INTERNAL_MEDIA_CACHE_DIRNAME = ".stream247-cache";

export type TwitchVodCacheConfig = {
  enabled: boolean;
  allowRemoteFallback: boolean;
  mediaRoot: string;
  cacheRoot: string;
  ytDlpBinary: string;
  ffprobeBinary: string;
  downloadTimeoutMs: number;
  retentionMs: number;
  partialMaxAgeMs: number;
  maxCacheBytes: number;
  minFreeBytes: number;
  failureCooldownMs: number;
};

export type TwitchVodCacheResult =
  | {
      status: "ready";
      cachePath: string;
      cacheUpdatedAt: string;
      cacheError: "";
    }
  | {
      status: "missing" | "failed";
      cachePath: string;
      cacheUpdatedAt: string;
      cacheError: string;
    };

type ExecText = typeof execFileText;

const DEFAULT_DOWNLOAD_TIMEOUT_SECONDS = 2 * 60;
const DEFAULT_RETENTION_HOURS = 72;
const DEFAULT_PARTIAL_MAX_AGE_HOURS = 6;
const DEFAULT_MAX_CACHE_BYTES = 20 * 1024 * 1024 * 1024;
const DEFAULT_MIN_FREE_BYTES = 15 * 1024 * 1024 * 1024;
const DEFAULT_FAILURE_COOLDOWN_SECONDS = 30 * 60;

function readPositiveNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function getTwitchVodCacheConfig(env: NodeJS.ProcessEnv, mediaRoot: string): TwitchVodCacheConfig {
  const cacheRoot = env.TWITCH_VOD_CACHE_ROOT || path.join(mediaRoot, INTERNAL_MEDIA_CACHE_DIRNAME, "twitch");
  return {
    enabled: env.TWITCH_VOD_CACHE_ENABLED !== "0",
    allowRemoteFallback: env.TWITCH_VOD_CACHE_ALLOW_REMOTE_FALLBACK === "1",
    mediaRoot,
    cacheRoot,
    ytDlpBinary: env.YT_DLP_BIN || "yt-dlp",
    ffprobeBinary: env.FFPROBE_BIN || "ffprobe",
    downloadTimeoutMs: readPositiveNumber(env.TWITCH_VOD_CACHE_DOWNLOAD_TIMEOUT_SECONDS, DEFAULT_DOWNLOAD_TIMEOUT_SECONDS) * 1000,
    retentionMs: readPositiveNumber(env.TWITCH_VOD_CACHE_RETENTION_HOURS, DEFAULT_RETENTION_HOURS) * 60 * 60 * 1000,
    partialMaxAgeMs:
      readPositiveNumber(env.TWITCH_VOD_CACHE_PARTIAL_MAX_AGE_HOURS, DEFAULT_PARTIAL_MAX_AGE_HOURS) * 60 * 60 * 1000,
    maxCacheBytes: readPositiveNumber(env.TWITCH_VOD_CACHE_MAX_BYTES, DEFAULT_MAX_CACHE_BYTES),
    minFreeBytes: readPositiveNumber(env.TWITCH_VOD_CACHE_MIN_FREE_BYTES, DEFAULT_MIN_FREE_BYTES),
    failureCooldownMs:
      readPositiveNumber(env.TWITCH_VOD_CACHE_FAILURE_COOLDOWN_SECONDS, DEFAULT_FAILURE_COOLDOWN_SECONDS) * 1000
  };
}

export function isInternalMediaCachePath(filePath: string, mediaRoot: string): boolean {
  const relativePath = path.relative(mediaRoot, filePath).replace(/\\/g, "/");
  return relativePath === INTERNAL_MEDIA_CACHE_DIRNAME || relativePath.startsWith(`${INTERNAL_MEDIA_CACHE_DIRNAME}/`);
}

export function isTwitchVodAsset(asset: Pick<AssetRecord, "path" | "externalId" | "cachePath">): boolean {
  if (asset.cachePath) {
    return true;
  }

  try {
    const url = new URL(asset.path);
    return /(^|\.)twitch\.tv$/i.test(url.hostname) && /^\/videos\/\d+/i.test(url.pathname);
  } catch {
    return false;
  }
}

export function isTwitchVodCacheCoolingDown(
  asset: Pick<AssetRecord, "path" | "externalId" | "cachePath" | "cacheStatus" | "cacheUpdatedAt">,
  cooldownMs: number,
  nowMs = Date.now()
): boolean {
  if (cooldownMs <= 0 || asset.cacheStatus !== "failed" || !asset.cacheUpdatedAt || !isTwitchVodAsset(asset)) {
    return false;
  }

  const updatedAtMs = new Date(asset.cacheUpdatedAt).getTime();
  if (!Number.isFinite(updatedAtMs)) {
    return false;
  }

  return nowMs - updatedAtMs < cooldownMs;
}

export function buildTwitchVodCachePath(asset: Pick<AssetRecord, "sourceId" | "externalId" | "path">, cacheRoot: string): string {
  const sourceSegment = sanitizePathSegment(asset.sourceId || "source");
  const idSegment = sanitizePathSegment(asset.externalId || extractTwitchVideoId(asset.path) || asset.path);
  return path.join(cacheRoot, sourceSegment, `${idSegment}.mp4`);
}

export async function ensureTwitchVodCache(
  asset: AssetRecord,
  config: TwitchVodCacheConfig,
  execText: ExecText = execFileText
): Promise<TwitchVodCacheResult> {
  const cachePath = asset.cachePath || buildTwitchVodCachePath(asset, config.cacheRoot);
  const existing = await hasUsableFile(cachePath);
  if (existing) {
    return {
      status: "ready",
      cachePath,
      cacheUpdatedAt: new Date().toISOString(),
      cacheError: ""
    };
  }

  if (!config.enabled) {
    return {
      status: "missing",
      cachePath,
      cacheUpdatedAt: new Date().toISOString(),
      cacheError: "Twitch VOD cache is disabled."
    };
  }

  const tmpPath = `${cachePath}.part-${String(process.pid)}-${Math.random().toString(36).slice(2)}.mp4`;
  try {
    await fs.mkdir(path.dirname(cachePath), { recursive: true });
    await removeTargetTransientCacheFiles(cachePath);
    const maintenance = await pruneTwitchVodCache(config, cachePath);
    if (maintenance.freeBytes < config.minFreeBytes) {
      return {
        status: "failed",
        cachePath,
        cacheUpdatedAt: new Date().toISOString(),
        cacheError: `Twitch VOD cache guardrail blocked download: only ${String(maintenance.freeBytes)} free bytes remain after prune, below the required ${String(config.minFreeBytes)} bytes.`
      };
    }

    await execText(
      config.ytDlpBinary,
      [
        "--no-playlist",
        "--no-warnings",
        "--format",
        "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best",
        "--merge-output-format",
        "mp4",
        "--output",
        tmpPath,
        asset.path
      ],
      {
        timeoutMs: config.downloadTimeoutMs,
        killProcessGroup: true,
        forceKillAfterMs: 5_000,
        maxBufferBytes: 1024 * 1024 * 20
      }
    );
    await verifyMediaFile(tmpPath, config.ffprobeBinary, execText);
    await fs.rename(tmpPath, cachePath);
    return {
      status: "ready",
      cachePath,
      cacheUpdatedAt: new Date().toISOString(),
      cacheError: ""
    };
  } catch (error) {
    await fs.rm(tmpPath, { force: true }).catch(() => undefined);
    return {
      status: "failed",
      cachePath,
      cacheUpdatedAt: new Date().toISOString(),
      cacheError: error instanceof Error ? error.message : "Unknown Twitch VOD cache failure."
    };
  }
}

function sanitizePathSegment(value: string): string {
  const normalized = value
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
  return normalized || "item";
}

function extractTwitchVideoId(value: string): string {
  try {
    const url = new URL(value);
    const match = url.pathname.match(/\/videos\/(\d+)/i);
    return match?.[1] ?? "";
  } catch {
    return "";
  }
}

type CacheFileInfo = {
  filePath: string;
  size: number;
  mtimeMs: number;
  transient: boolean;
};

async function pruneTwitchVodCache(
  config: TwitchVodCacheConfig,
  preservedCachePath: string
): Promise<{ freeBytes: number; totalCacheBytes: number }> {
  const cacheFiles = await listCacheFiles(config.cacheRoot);
  const nowMs = Date.now();

  for (const entry of cacheFiles) {
    if (entry.transient && (entry.size === 0 || nowMs - entry.mtimeMs >= config.partialMaxAgeMs)) {
      await fs.rm(entry.filePath, { force: true }).catch(() => undefined);
    }
  }

  let cacheEntries = (await listCacheFiles(config.cacheRoot))
    .filter((entry) => entry.filePath !== preservedCachePath)
    .sort((left, right) => left.mtimeMs - right.mtimeMs);
  let freeBytes = await getFilesystemFreeBytes(config.mediaRoot);
  let totalCacheBytes = cacheEntries.reduce((sum, entry) => sum + entry.size, 0);

  for (const entry of cacheEntries.filter((candidate) => candidate.transient)) {
    if (totalCacheBytes <= config.maxCacheBytes && freeBytes >= config.minFreeBytes) {
      break;
    }

    await fs.rm(entry.filePath, { force: true }).catch(() => undefined);
    totalCacheBytes -= entry.size;
    freeBytes += entry.size;
  }

  let readyFiles = (await listCacheFiles(config.cacheRoot))
    .filter((entry) => !entry.transient && entry.filePath !== preservedCachePath)
    .sort((left, right) => left.mtimeMs - right.mtimeMs);
  totalCacheBytes = readyFiles.reduce((sum, entry) => sum + entry.size, 0);
  freeBytes = await getFilesystemFreeBytes(config.mediaRoot);

  for (const entry of [...readyFiles]) {
    if (nowMs - entry.mtimeMs < config.retentionMs) {
      continue;
    }

    await fs.rm(entry.filePath, { force: true }).catch(() => undefined);
    totalCacheBytes -= entry.size;
    freeBytes += entry.size;
  }

  readyFiles = (await listCacheFiles(config.cacheRoot))
    .filter((entry) => !entry.transient && entry.filePath !== preservedCachePath)
    .sort((left, right) => left.mtimeMs - right.mtimeMs);
  totalCacheBytes = readyFiles.reduce((sum, entry) => sum + entry.size, 0);
  freeBytes = await getFilesystemFreeBytes(config.mediaRoot);

  for (const entry of readyFiles) {
    if (totalCacheBytes <= config.maxCacheBytes && freeBytes >= config.minFreeBytes) {
      break;
    }

    await fs.rm(entry.filePath, { force: true }).catch(() => undefined);
    totalCacheBytes -= entry.size;
    freeBytes += entry.size;
  }

  return {
    freeBytes,
    totalCacheBytes
  };
}

async function removeTargetTransientCacheFiles(cachePath: string): Promise<void> {
  const directoryEntries = await fs.readdir(path.dirname(cachePath), { withFileTypes: true }).catch(() => []);
  const targetName = path.basename(cachePath);

  for (const directoryEntry of directoryEntries) {
    if (!directoryEntry.isFile()) {
      continue;
    }

    const nextPath = path.join(path.dirname(cachePath), directoryEntry.name);
    if (!isTransientCacheFile(nextPath)) {
      continue;
    }

    if (!directoryEntry.name.startsWith(`${targetName}.part-`) && directoryEntry.name !== `${targetName}.temp.mp4`) {
      continue;
    }

    await fs.rm(nextPath, { force: true }).catch(() => undefined);
  }
}

async function listCacheFiles(rootPath: string): Promise<CacheFileInfo[]> {
  const entries: CacheFileInfo[] = [];
  await walkCacheFiles(rootPath, entries);
  return entries;
}

async function walkCacheFiles(rootPath: string, entries: CacheFileInfo[]): Promise<void> {
  const directoryEntries = await fs.readdir(rootPath, { withFileTypes: true }).catch(() => []);
  for (const directoryEntry of directoryEntries) {
    const nextPath = path.join(rootPath, directoryEntry.name);
    if (directoryEntry.isDirectory()) {
      await walkCacheFiles(nextPath, entries);
      continue;
    }
    if (!directoryEntry.isFile()) {
      continue;
    }

    const stat = await fs.stat(nextPath).catch(() => null);
    if (!stat?.isFile()) {
      continue;
    }

    entries.push({
      filePath: nextPath,
      size: stat.size,
      mtimeMs: stat.mtimeMs,
      transient: isTransientCacheFile(nextPath)
    });
  }
}

function isTransientCacheFile(filePath: string): boolean {
  const fileName = path.basename(filePath);
  return (
    fileName.includes(".part-") ||
    fileName.endsWith(".part") ||
    fileName.endsWith(".tmp") ||
    fileName.endsWith(".ytdl") ||
    fileName.endsWith(".temp.mp4")
  );
}

async function getFilesystemFreeBytes(rootPath: string): Promise<number> {
  const stats = await fs.statfs(rootPath);
  return Number(stats.bavail) * Number(stats.bsize);
}

async function hasUsableFile(filePath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile() && stat.size > 0;
  } catch {
    return false;
  }
}

async function verifyMediaFile(filePath: string, ffprobeBinary: string, execText: ExecText): Promise<void> {
  if (!(await hasUsableFile(filePath))) {
    throw new Error("Downloaded Twitch VOD cache file is empty.");
  }

  await execText(ffprobeBinary, ["-v", "error", "-show_entries", "format=duration", "-of", "default=nokey=1:noprint_wrappers=1", filePath], {
    timeoutMs: 30_000,
    maxBufferBytes: 1024 * 1024
  });
}
