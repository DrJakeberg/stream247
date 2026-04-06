import { promises as fs } from "node:fs";
import path from "node:path";
import type { AssetRecord } from "@/lib/server/state";

const THUMBNAIL_DIRECTORY = ".stream247-thumbnails";

function sanitizeAssetId(assetId: string): string {
  return assetId.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function getMediaRoot(): string {
  return process.env.MEDIA_LIBRARY_ROOT || path.join(process.cwd(), "data", "media");
}

export function getAssetThumbnailPath(assetId: string): string {
  return path.join(getMediaRoot(), THUMBNAIL_DIRECTORY, `${sanitizeAssetId(assetId)}.jpg`);
}

export async function readAssetThumbnail(assetId: string): Promise<Buffer | null> {
  try {
    return await fs.readFile(getAssetThumbnailPath(assetId));
  } catch {
    return null;
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function buildAssetThumbnailFallbackSvg(asset: AssetRecord): string {
  const title = escapeHtml(asset.title || "Untitled asset");
  const category = escapeHtml(asset.categoryName || "Catalog item");
  const folder = escapeHtml(asset.folderPath || "root");
  const source = escapeHtml(asset.sourceId);
  const duration = asset.durationSeconds ? `${Math.max(1, Math.round(asset.durationSeconds / 60))}m` : "natural";

  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360" role="img" aria-label="${title}">
      <defs>
        <linearGradient id="bg" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0%" stop-color="#0e6d5a" />
          <stop offset="100%" stop-color="#1b1a16" />
        </linearGradient>
      </defs>
      <rect width="640" height="360" fill="url(#bg)" rx="24" />
      <rect x="22" y="22" width="596" height="316" rx="18" fill="rgba(255,249,239,0.14)" stroke="rgba(255,249,239,0.24)" />
      <text x="36" y="64" fill="#f7f1e6" font-family="Inter, Arial, sans-serif" font-size="18" opacity="0.84">Stream247 Library</text>
      <text x="36" y="118" fill="#ffffff" font-family="Inter, Arial, sans-serif" font-size="34" font-weight="700">${title.slice(0, 28)}</text>
      <text x="36" y="158" fill="#f7f1e6" font-family="Inter, Arial, sans-serif" font-size="18" opacity="0.9">${category}</text>
      <text x="36" y="286" fill="#f7f1e6" font-family="Inter, Arial, sans-serif" font-size="16" opacity="0.88">Folder: ${folder}</text>
      <text x="36" y="314" fill="#f7f1e6" font-family="Inter, Arial, sans-serif" font-size="16" opacity="0.88">Source: ${source}</text>
      <text x="520" y="314" fill="#f7f1e6" font-family="Inter, Arial, sans-serif" font-size="16" opacity="0.88">${duration}</text>
    </svg>
  `.trim();
}
