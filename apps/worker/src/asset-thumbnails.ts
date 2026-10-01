import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { promises as fs } from "node:fs";
import path from "node:path";

const execFileAsync = promisify(execFile);
const THUMBNAIL_DIRECTORY = ".stream247-thumbnails";

function sanitizeAssetId(assetId: string): string {
  return assetId.replace(/[^a-zA-Z0-9_-]/g, "_");
}

export function getThumbnailDirectory(mediaRoot: string): string {
  return path.join(mediaRoot, THUMBNAIL_DIRECTORY);
}

export function getAssetThumbnailPath(assetId: string, mediaRoot: string): string {
  return path.join(getThumbnailDirectory(mediaRoot), `${sanitizeAssetId(assetId)}.jpg`);
}

/**
 * Where a render lands before the rename. The suffix keeps it out of the readers' way — they only
 * ever open the final .jpg — and makes leftovers recognisable to the disk sweep. Same shape as
 * getSourceSnapshotTempPath.
 */
export function getAssetThumbnailTempPath(assetId: string, mediaRoot: string): string {
  return `${getAssetThumbnailPath(assetId, mediaRoot)}.tmp`;
}

/**
 * How many thumbnails one disk-watermark sweep may remove. Thumbnails are small, so the cap is
 * about bounding the number of filesystem operations a single worker cycle performs — the same
 * reasoning as the program feed sweep cap — not about limiting how much space comes back.
 */
export const THUMBNAIL_SWEEP_LIMIT = 500;

export type ThumbnailFileInfo = {
  filePath: string;
  modifiedAtMs: number;
  bytes: number;
};

/**
 * Picks the thumbnails a disk-pressure sweep may delete: oldest first, capped, and never one that
 * belongs to a protected asset.
 *
 * Thumbnails have no reference index of their own the way the VOD cache has watched paths and the
 * program feed has its playlist, so protection is by asset id: the caller passes the thumbnail
 * paths of every asset the schedule blocks, pools and broadcast queue currently reference (see
 * collectDiskProtectedAssetIds), built with getAssetThumbnailPath so the id-to-filename mapping
 * cannot drift from the one the writer uses. Losing an unprotected thumbnail is cosmetic — it is
 * regenerated from the media file on the next library sync — which is why this is the last
 * eviction stage rather than the first.
 */
export function selectEvictableThumbnails(args: {
  files: ThumbnailFileInfo[];
  protectedPaths: readonly string[];
  limit?: number;
}): ThumbnailFileInfo[] {
  const protectedResolved = new Set(args.protectedPaths.filter((entry) => entry).map((entry) => path.resolve(entry)));

  return args.files
    .filter((file) => !protectedResolved.has(path.resolve(file.filePath)))
    // Oldest first, so a capped sweep drains from the far end — the thumbnails least likely to
    // belong to anything still active — instead of whatever order the directory listing returned.
    .sort((left, right) => left.modifiedAtMs - right.modifiedAtMs)
    .slice(0, args.limit ?? THUMBNAIL_SWEEP_LIMIT);
}

/**
 * Render the asset's thumbnail, atomically.
 *
 * ffmpeg writes the temp path; only a completed render is renamed onto the final name (rename
 * within one directory is atomic on POSIX). The predecessor deleted the existing thumbnail first
 * and pointed `ffmpeg -y` straight at the target, so an OOM kill, disk pressure or plain load left
 * the asset with no picture at all, or with a half-written one that readers would happily serve —
 * and the previous, perfectly good frame was already gone. A failed render now degrades to
 * "yesterday's thumbnail", which is not a defect anyone can see. Same pattern as
 * captureSourceSnapshot.
 */
export async function ensureLocalAssetThumbnail(args: {
  assetId: string;
  inputPath: string;
  mediaRoot: string;
  ffmpegBinary?: string;
}): Promise<boolean> {
  if (!args.inputPath || !path.isAbsolute(args.inputPath)) {
    return false;
  }

  const targetPath = getAssetThumbnailPath(args.assetId, args.mediaRoot);
  const tempPath = getAssetThumbnailTempPath(args.assetId, args.mediaRoot);
  await fs.mkdir(path.dirname(targetPath), { recursive: true });

  try {
    const [inputStat, targetStat] = await Promise.all([
      fs.stat(args.inputPath),
      fs.stat(targetPath).catch(() => null)
    ]);
    if (targetStat && targetStat.mtimeMs >= inputStat.mtimeMs) {
      return true;
    }
  } catch {
    return false;
  }

  try {
    await execFileAsync(args.ffmpegBinary || process.env.FFMPEG_BIN || "ffmpeg", [
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-ss",
      "00:00:01",
      "-i",
      args.inputPath,
      "-frames:v",
      "1",
      "-vf",
      "scale=640:-2",
      tempPath
    ]);
    await fs.rename(tempPath, targetPath);
    return true;
  } catch {
    // Only the incomplete render is removed. Whatever was already on the final path stays.
    await fs.unlink(tempPath).catch(() => {});
    return false;
  }
}
