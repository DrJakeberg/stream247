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
    downloadTimeoutMs: readPositiveNumber(env.TWITCH_VOD_CACHE_DOWNLOAD_TIMEOUT_SECONDS, 2 * 60 * 60) * 1000
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
