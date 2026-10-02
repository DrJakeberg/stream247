import { compareProgrammingAssets } from "@stream247/core";
import type { AssetRecord } from "@stream247/db";
import { isTwitchVodAsset } from "./twitch-vod-cache.js";

export type PlaybackPreparationRecoveryPlan =
  | {
      asset: AssetRecord;
      reason: string;
      reasonCode: "global_fallback" | "generic_fallback";
      fallbackTier: "global-fallback" | "generic-fallback";
    }
  | {
      asset: null;
      reason: string;
      reasonCode: "standby";
      fallbackTier: "standby";
    };

export function planRecoveryAfterPlaybackPreparationFailure(
  assets: AssetRecord[],
  failedAsset: AssetRecord,
  // Sources the source circuit breaker holds (M75 review): the generic tiers pass their items over, as
  // the any-ready tier of the worker's selection does, because the hold stops their quarantine counters
  // and they would fail here like the item being bridged. The global fallback asset is the operator's
  // own pick and is not gated.
  heldSourceIds: readonly string[] = []
): PlaybackPreparationRecoveryPlan {
  const candidates = [...assets]
    .filter((asset) => asset.status === "ready" && asset.includeInProgramming !== false && asset.id !== failedAsset.id)
    .sort(compareRecoveryCandidates);

  const globalFallback = candidates.find((asset) => asset.isGlobalFallback);
  if (globalFallback) {
    return {
      asset: globalFallback,
      reason: `Playback input for ${failedAsset.title} is not ready. Global fallback asset ${globalFallback.title} is selected instead.`,
      reasonCode: "global_fallback",
      fallbackTier: "global-fallback"
    };
  }

  const held = new Set(heldSourceIds);
  const genericCandidates = candidates.filter((asset) => !held.has(asset.sourceId));
  const nonTwitchFallback = genericCandidates.find((asset) => !isTwitchVodAsset(asset));
  if (nonTwitchFallback) {
    return {
      asset: nonTwitchFallback,
      reason: `Playback input for ${failedAsset.title} is not ready. Fallback asset ${nonTwitchFallback.title} is selected while the source recovers.`,
      reasonCode: "generic_fallback",
      fallbackTier: "generic-fallback"
    };
  }

  const anyFallback = genericCandidates[0];
  if (anyFallback) {
    return {
      asset: anyFallback,
      reason: `Playback input for ${failedAsset.title} is not ready. Fallback asset ${anyFallback.title} is selected while the source recovers.`,
      reasonCode: "generic_fallback",
      fallbackTier: "generic-fallback"
    };
  }

  return {
    asset: null,
    reason: `Playback input for ${failedAsset.title} is not ready and no fallback asset is currently available.`,
    reasonCode: "standby",
    fallbackTier: "standby"
  };
}

function compareRecoveryCandidates(left: AssetRecord, right: AssetRecord): number {
  const fallbackPriorityDelta = left.fallbackPriority - right.fallbackPriority;
  if (fallbackPriorityDelta !== 0) {
    return fallbackPriorityDelta;
  }

  // Within one priority a library file comes before a remote item: it plays without a remote
  // resolution (yt-dlp, the network), and a failed preparation is exactly what is being bridged.
  // Before 2.1 this held almost always, by accident: every sync restamped remote items with the sync
  // time, so they sorted after the library. With M72's real, often months-old YouTube dates a YouTube
  // item would win the generic-fallback tier on a channel without a global fallback.
  const localDelta = Number(!isLocalLibraryAsset(left)) - Number(!isLocalLibraryAsset(right));
  if (localDelta !== 0) {
    return localDelta;
  }

  // Then the item order a pool uses within one source. The ladder does not alternate between sources
  // the way a pool does since M73: it wants the most dependable candidate, not a fair share.
  return compareProgrammingAssets(left, right);
}

function isLocalLibraryAsset(asset: AssetRecord): boolean {
  // Library scans store a plain file path; every remote connector stores a URL.
  return !/^[a-z][a-z0-9+.-]*:\/\//i.test(asset.path.trim());
}
