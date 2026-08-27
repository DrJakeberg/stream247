import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

export function buildLocalLibraryAssetId(filePath: string): string {
  return `asset_${createHash("sha256").update(filePath).digest("hex").slice(0, 24)}`;
}

export function buildLocalLibraryFolderPath(filePath: string, mediaRoot: string): string {
  const relativeDirectory = path.relative(mediaRoot, path.dirname(filePath)).replace(/\\/g, "/").replace(/^\.\/?/, "");
  return relativeDirectory === "." ? "" : relativeDirectory;
}

export const MEDIA_FILE_EXTENSIONS = new Set([".mp4", ".mkv", ".mov", ".m4v", ".webm"]);

/** The slice of `fs.Dirent` the walk needs, so tests can drive it without a real filesystem. */
export type MediaDirectoryEntry = { name: string; isDirectory: () => boolean };

export type MediaLibraryScan = {
  /** Media files the scan could see. Meaningful as a complete listing only while `failed` is false. */
  files: string[];
  /**
   * True when any directory in the tree could not be listed — an unmounted volume, an NFS
   * timeout, EACCES, EMFILE, or one unreadable subdirectory. It is the single bit that separates
   * "the library is empty" from "the scan did not finish", and callers must never treat the
   * second as the first: `files` is then a floor, not the truth.
   */
  failed: boolean;
  /** Directories that could not be listed, for the operator-facing message. */
  failedDirectories: string[];
};

/** Keeps a pathological tree from turning one log line into a megabyte. */
const MAX_REPORTED_FAILED_DIRECTORIES = 10;

/**
 * Walk the media library, distinguishing an empty tree from a broken one.
 *
 * The predecessor swallowed every readdir error and returned `[]`, so `syncLocalMediaLibrary`
 * could not tell an empty library from an unreadable mount and deleted every local asset —
 * including the global fallback, which is exactly the asset the channel falls back to when
 * everything else is gone. Errors are therefore collected rather than swallowed: the walk still
 * returns whatever it managed to read (useful for the log), but `failed` tells the caller the
 * listing is not evidence of absence.
 */
export async function scanMediaFiles(args: {
  root: string;
  isExcluded?: (absolutePath: string) => boolean;
  readdir?: (directory: string) => Promise<MediaDirectoryEntry[]>;
}): Promise<MediaLibraryScan> {
  const readdir = args.readdir ?? ((directory: string) => fs.readdir(directory, { withFileTypes: true }));
  const failedDirectories: string[] = [];

  const walk = async (directory: string): Promise<string[]> => {
    let entries: MediaDirectoryEntry[];
    try {
      entries = await readdir(directory);
    } catch {
      failedDirectories.push(directory);
      return [];
    }

    const nested = await Promise.all(
      entries.map(async (entry): Promise<string[]> => {
        const absolutePath = path.join(directory, entry.name);
        if (args.isExcluded?.(absolutePath)) {
          return [];
        }
        if (entry.isDirectory()) {
          return walk(absolutePath);
        }
        return MEDIA_FILE_EXTENSIONS.has(path.extname(entry.name).toLowerCase()) ? [absolutePath] : [];
      })
    );

    return nested.flat();
  };

  const files = await walk(args.root);

  return {
    files,
    failed: failedDirectories.length > 0,
    failedDirectories: failedDirectories.slice(0, MAX_REPORTED_FAILED_DIRECTORIES)
  };
}
