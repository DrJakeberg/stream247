import { createHash } from "node:crypto";
import path from "node:path";

export function buildLocalLibraryAssetId(filePath: string): string {
  return `asset_${createHash("sha256").update(filePath).digest("hex").slice(0, 24)}`;
}

export function buildLocalLibraryFolderPath(filePath: string, mediaRoot: string): string {
  const relativeDirectory = path.relative(mediaRoot, path.dirname(filePath)).replace(/\\/g, "/").replace(/^\.\/?/, "");
  return relativeDirectory === "." ? "" : relativeDirectory;
}
