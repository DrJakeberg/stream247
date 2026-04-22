import { stripInvisibleCharacters } from "@stream247/core";
import type { AssetRecord } from "@stream247/db";

type TwitchMetadataAsset = Pick<AssetRecord, "title" | "titlePrefix" | "hashtagsJson">;

export function parseAssetHashtagsJson(value: string | undefined): string[] {
  try {
    const parsed = JSON.parse(value || "[]") as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map((entry) => stripInvisibleCharacters(String(entry ?? "")).trim().replace(/^#+/, "").replace(/\s+/g, ""))
      .filter(Boolean)
      .map((entry) => `#${entry}`);
  } catch {
    return [];
  }
}

export function buildTwitchMetadataTitle(asset: TwitchMetadataAsset | null, fallbackTitle: string): string {
  const baseTitle = stripInvisibleCharacters(String(asset?.title || fallbackTitle || "")).trim();
  const title = [stripInvisibleCharacters(asset?.titlePrefix || "").trim(), baseTitle, ...parseAssetHashtagsJson(asset?.hashtagsJson)]
    .filter(Boolean)
    .join(" ");

  return stripInvisibleCharacters(title).trim().slice(0, 140).trim();
}
