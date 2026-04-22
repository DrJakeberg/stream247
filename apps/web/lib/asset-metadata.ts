import { stripInvisibleCharacters } from "@stream247/core";

export const REPLAY_TITLE_PREFIX = "Replay:";

export function normalizeHashtagChip(value: string): string {
  return stripInvisibleCharacters(value)
    .trim()
    .replace(/^#+/, "")
    .replace(/\s+/g, "");
}

export function parseAssetHashtagsJson(value: string | undefined): string[] {
  try {
    const parsed = JSON.parse(value || "[]") as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return [...new Set(parsed.map((entry) => normalizeHashtagChip(String(entry ?? ""))).filter(Boolean))];
  } catch {
    return [];
  }
}

export function isReplayTitlePrefix(value: string | undefined): boolean {
  const normalized = stripInvisibleCharacters(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");

  return normalized === "replay" || normalized === "replay:";
}

export function buildAssetMetadataTitlePrefix(args: {
  replayEnabled: boolean;
  existingPrefix?: string;
}): string {
  if (args.replayEnabled) {
    return REPLAY_TITLE_PREFIX;
  }

  return isReplayTitlePrefix(args.existingPrefix) ? "" : stripInvisibleCharacters(args.existingPrefix || "").trim();
}

export function buildAssetDisplayTitle(
  asset: { title?: string; titlePrefix?: string } | null | undefined,
  fallbackTitle = ""
): string {
  const baseTitle = stripInvisibleCharacters(String(asset?.title || fallbackTitle || "")).trim();

  return [stripInvisibleCharacters(asset?.titlePrefix || "").trim(), baseTitle].filter(Boolean).join(" ").trim();
}

export function getShowProfileCategoryOptions(
  showProfiles: Array<{
    categoryName?: string;
  }>
): string[] {
  return [...new Set(showProfiles.map((show) => stripInvisibleCharacters(show.categoryName || "").trim()).filter(Boolean))].sort(
    (left, right) => left.localeCompare(right)
  );
}
