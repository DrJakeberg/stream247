/**
 * Where the playout can start a Twitch archive from right now (M74).
 *
 * One rule for two callers. The playout applies it in resolveAssetPlaybackInput: a cached file plays
 * from disk; an archive known to exceed the per-replay ceiling (`too-large`, a settled decision) or any
 * archive while remote fallback is on streams from Twitch; anything else throws, because the cycle
 * never waits for a download. The admin's Play now and Insert apply it before they queue an archive, so
 * an operator is told at once instead of the insert failing on the playout. On 2026-10-01 the DUT ran
 * with remote fallback off, where most archives are not cached.
 */
export type TwitchVodPlaybackSource = "cache" | "remote" | "unavailable";

export interface TwitchVodPlaybackInput {
  // The playout looks for the cache file itself; the admin only has the cache state the playout and the
  // download job last recorded on the asset (`cacheStatus === "ready"`).
  cacheReady: boolean;
  // `cacheStatus === "too-large"`: never downloaded, always streamed, independent of the fallback switch.
  settledTooLarge: boolean;
  // TWITCH_VOD_CACHE_ALLOW_REMOTE_FALLBACK, or its managed value in Settings -> Operations -> Replay cache.
  allowRemoteFallback: boolean;
}

export function decideTwitchVodPlaybackSource(input: TwitchVodPlaybackInput): TwitchVodPlaybackSource {
  if (input.cacheReady) {
    return "cache";
  }
  if (input.settledTooLarge || input.allowRemoteFallback) {
    return "remote";
  }
  return "unavailable";
}

/** A Twitch archive as the playout treats one: it has a cache path, or its path is a twitch.tv/videos/<id> URL. */
export function isTwitchVodPlaybackAsset(asset: { path: string; cachePath?: string }): boolean {
  if (asset.cachePath) {
    return true;
  }

  try {
    const url = new URL(asset.path);
    return /(^|\.)twitch\.tv$/i.test(url.hostname) && /^\/videos\/\d+/i.test(url.pathname);
  } catch {
    return false;
  }
}
