import { localizeViewerBuiltInText, stripInvisibleCharacters } from "@stream247/core";
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

/**
 * What the channel title falls back to when no asset names it: the schedule block's title, else
 * what the worker wrote into playout state. The latter is written in English for the admin and the
 * as-run log ("Replay standby", "Scheduled reconnect", "Live Bridge", or a stored headline default),
 * so it passes the viewer edge here and reaches Twitch in the channel language (M80). A title an
 * operator wrote is never translated.
 */
export function resolveTwitchFallbackTitle(args: { locale: string; scheduleTitle: string; playoutTitle: string }): string {
  return args.scheduleTitle || localizeViewerBuiltInText(args.locale, args.playoutTitle);
}
