import { stripInvisibleCharacters } from "@stream247/core";
import type { AssetRecord } from "@stream247/db";

type DisplayTitleAsset = Pick<AssetRecord, "title" | "titlePrefix">;

export function buildAssetDisplayTitle(asset: DisplayTitleAsset | null | undefined, fallbackTitle = ""): string {
  const baseTitle = stripInvisibleCharacters(String(asset?.title || fallbackTitle || "")).trim();
  return [stripInvisibleCharacters(asset?.titlePrefix || "").trim(), baseTitle].filter(Boolean).join(" ").trim();
}
