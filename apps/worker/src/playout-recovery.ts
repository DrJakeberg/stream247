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
  failedAsset: AssetRecord
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

  const nonTwitchFallback = candidates.find((asset) => !isTwitchVodAsset(asset));
  if (nonTwitchFallback) {
    return {
      asset: nonTwitchFallback,
      reason: `Playback input for ${failedAsset.title} is not ready. Fallback asset ${nonTwitchFallback.title} is selected while the source recovers.`,
      reasonCode: "generic_fallback",
      fallbackTier: "generic-fallback"
    };
  }

  const anyFallback = candidates[0];
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

  const publishedDelta = new Date(left.publishedAt || left.createdAt).getTime() - new Date(right.publishedAt || right.createdAt).getTime();
  if (publishedDelta !== 0) {
    return publishedDelta;
  }

  return left.title.localeCompare(right.title);
}
