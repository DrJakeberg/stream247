import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { promises as fs } from "node:fs";
import path from "node:path";

const execFileAsync = promisify(execFile);
const THUMBNAIL_DIRECTORY = ".stream247-thumbnails";

function sanitizeAssetId(assetId: string): string {
  return assetId.replace(/[^a-zA-Z0-9_-]/g, "_");
}

export function getAssetThumbnailPath(assetId: string, mediaRoot: string): string {
  return path.join(mediaRoot, THUMBNAIL_DIRECTORY, `${sanitizeAssetId(assetId)}.jpg`);
}

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
      targetPath
    ]);
    return true;
  } catch {
    await fs.unlink(targetPath).catch(() => {});
    return false;
  }
}
