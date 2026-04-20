import type { AssetRecord } from "@stream247/db";

type DisplayTitleAsset = Pick<AssetRecord, "title" | "titlePrefix">;

export function buildAssetDisplayTitle(asset: DisplayTitleAsset | null | undefined, fallbackTitle = ""): string {
  const baseTitle = String(asset?.title || fallbackTitle || "").trim();
  return [asset?.titlePrefix?.trim() || "", baseTitle].filter(Boolean).join(" ").trim();
}
