import { promises as fs } from "node:fs";
import path from "node:path";
import type { AssetRecord } from "@stream247/db";
import { clampToCycleAwaitCeiling } from "./cycle-budget.js";
import { DEFAULT_LOCK_STALE_MS, acquireFileLock, type FileLock } from "./file-lock.js";
import { execFileText } from "./process-utils.js";

export const INTERNAL_MEDIA_CACHE_DIRNAME = ".stream247-cache";

export type TwitchVodCacheConfig = {
  enabled: boolean;
  allowRemoteFallback: boolean;
  mediaRoot: string;
  cacheRoot: string;
  ytDlpBinary: string;
  ffprobeBinary: string;
  /**
   * Timeout for a download awaited inside a reconciliation cycle. Clamped to the cycle-await
   * ceiling so a long configured timeout can never outlive the loop stall guard.
   */
  downloadTimeoutMs: number;
  /**
   * Timeout for a download run as a detached background job, where nothing is waiting on it.
   * This is the operator-configured value, unclamped.
   */
  backgroundDownloadTimeoutMs: number;
  /** True when the configured download timeout was unsafe for cycle use and had to be reduced. */
  downloadTimeoutClamped: boolean;
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
  const configuredDownloadTimeoutMs =
    readPositiveNumber(env.TWITCH_VOD_CACHE_DOWNLOAD_TIMEOUT_SECONDS, DEFAULT_DOWNLOAD_TIMEOUT_SECONDS) * 1000;
  const awaitedDownloadTimeout = clampToCycleAwaitCeiling(configuredDownloadTimeoutMs, env);
  return {
    enabled: env.TWITCH_VOD_CACHE_ENABLED !== "0",
    allowRemoteFallback: env.TWITCH_VOD_CACHE_ALLOW_REMOTE_FALLBACK === "1",
    mediaRoot,
    cacheRoot,
    ytDlpBinary: env.YT_DLP_BIN || "yt-dlp",
    ffprobeBinary: env.FFPROBE_BIN || "ffprobe",
    downloadTimeoutMs: awaitedDownloadTimeout.effectiveMs,
    backgroundDownloadTimeoutMs: configuredDownloadTimeoutMs,
    downloadTimeoutClamped: awaitedDownloadTimeout.clamped,
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

/**
 * Read-only cache lookup. Does no network work and starts no download, so it is always safe to
 * await on a reconciliation cycle. Returns "ready" only when a complete, usable cache file exists.
 */
export async function peekTwitchVodCache(
  asset: Pick<AssetRecord, "sourceId" | "externalId" | "path" | "cachePath">,
  config: TwitchVodCacheConfig
): Promise<TwitchVodCacheResult> {
  const cachePath = asset.cachePath || buildTwitchVodCachePath(asset, config.cacheRoot);
  const cacheUpdatedAt = new Date().toISOString();

  if (await hasUsableFile(cachePath)) {
    return { status: "ready", cachePath, cacheUpdatedAt, cacheError: "" };
  }

  return {
    status: "missing",
    cachePath,
    cacheUpdatedAt,
    cacheError: config.enabled ? "Twitch VOD is not cached yet." : "Twitch VOD cache is disabled."
  };
}

export type TwitchVodCacheMode =
  /** Awaited inside a reconciliation cycle: bounded by the clamped cycle-await timeout. */
  | "cycle"
  /** Detached background job: nothing waits on it, so the full configured timeout applies. */
  | "background";

export async function ensureTwitchVodCache(
  asset: AssetRecord,
  config: TwitchVodCacheConfig,
  execText: ExecText = execFileText,
  options: { mode?: TwitchVodCacheMode } = {}
): Promise<TwitchVodCacheResult> {
  const mode: TwitchVodCacheMode = options.mode ?? "cycle";
  const downloadTimeoutMs = mode === "background" ? config.backgroundDownloadTimeoutMs : config.downloadTimeoutMs;
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

  // A background job owns a stable part path so an interrupted download resumes where it stopped.
  // A per-attempt random path (still used for the bounded cycle path, where nothing is expected to
  // survive) meant every playout restart re-downloaded a multi-GB VOD from zero — with the process
  // restarting every ~5 minutes, the download could never finish no matter how long it ran.
  const tmpPath =
    mode === "background"
      ? `${cachePath}.part-resume.mp4`
      : `${cachePath}.part-${String(process.pid)}-${Math.random().toString(36).slice(2)}.mp4`;

  // Only one process may own the stable resume path at a time; the worker and playout containers
  // share the media volume and can both request the same asset.
  let lock: FileLock | null = null;
  if (mode === "background") {
    await fs.mkdir(path.dirname(cachePath), { recursive: true });
    lock = await acquireFileLock(`${cachePath}.lock`);
    if (!lock) {
      return {
        status: "missing",
        cachePath,
        cacheUpdatedAt: new Date().toISOString(),
        cacheError: "Another Twitch VOD cache job already holds this asset."
      };
    }
  }

  try {
    await fs.mkdir(path.dirname(cachePath), { recursive: true });
    if (mode !== "background") {
      await removeTargetTransientCacheFiles(cachePath);
    }
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
        ...(mode === "background" ? ["--continue"] : ["--no-continue"]),
        "--format",
        "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best",
        "--merge-output-format",
        "mp4",
        "--output",
        tmpPath,
        asset.path
      ],
      {
        timeoutMs: downloadTimeoutMs,
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
    // Keep a background job's partial download so the next attempt resumes instead of restarting
    // from zero. Stale partials are reaped by pruneTwitchVodCache once they exceed partialMaxAgeMs.
    if (mode !== "background") {
      await fs.rm(tmpPath, { force: true }).catch(() => undefined);
    }
    return {
      status: "failed",
      cachePath,
      cacheUpdatedAt: new Date().toISOString(),
      cacheError: error instanceof Error ? error.message : "Unknown Twitch VOD cache failure."
    };
  } finally {
    await lock?.release();
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

/**
 * True when a live download job holds the lock for the cache entry this file belongs to.
 *
 * Partial downloads used to be disposable: each attempt wrote a uniquely named part file and the
 * next attempt started over. Since background jobs resume into a stable part path, a partial is
 * accumulated work — often tens of gigabytes — and evicting one mid-flight means it can never
 * finish. With several large VODs queued that is an endless loop: every new job destroys the
 * previous job's progress, which is the same "never completes" failure the download timeout used
 * to cause, only moved into the background.
 *
 * The lock file the running job maintains (with a heartbeat) is the signal for "someone is working
 * on this right now"; a stale lock means the holder died and the partial is fair game again.
 */
async function isLockedByLiveJob(filePath: string, nowMs: number): Promise<boolean> {
  // ".../<id>.mp4.part-resume.mp4" and its fragment siblings all belong to ".../<id>.mp4".
  const marker = filePath.indexOf(".part-resume");
  if (marker === -1) {
    return false;
  }

  const lockPath = `${filePath.slice(0, marker)}.lock`;
  const stat = await fs.stat(lockPath).catch(() => null);
  if (!stat?.isFile()) {
    return false;
  }

  return nowMs - stat.mtimeMs < DEFAULT_LOCK_STALE_MS;
}

async function pruneTwitchVodCache(
  config: TwitchVodCacheConfig,
  preservedCachePath: string
): Promise<{ freeBytes: number; totalCacheBytes: number }> {
  const cacheFiles = await listCacheFiles(config.cacheRoot);
  const nowMs = Date.now();

  for (const entry of cacheFiles) {
    if (entry.transient && (entry.size === 0 || nowMs - entry.mtimeMs >= config.partialMaxAgeMs)) {
      if (await isLockedByLiveJob(entry.filePath, nowMs)) {
        continue;
      }
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

    if (await isLockedByLiveJob(entry.filePath, nowMs)) {
      continue;
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
    fileName.endsWith(".lock") ||
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
