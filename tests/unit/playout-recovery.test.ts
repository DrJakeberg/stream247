import { describe, expect, it } from "vitest";
import type { AssetRecord } from "@stream247/db";
import { planRecoveryAfterPlaybackPreparationFailure } from "../../apps/worker/src/playout-recovery";

function createAsset(overrides: Partial<AssetRecord> = {}): AssetRecord {
  return {
    id: "asset_default",
    sourceId: "source-default",
    title: "Default asset",
    path: "/app/data/media/default.mp4",
    status: "ready",
    includeInProgramming: true,
    fallbackPriority: 100,
    isGlobalFallback: false,
    createdAt: "2026-04-23T00:00:00.000Z",
    updatedAt: "2026-04-23T00:00:00.000Z",
    ...overrides
  };
}

describe("playout recovery selection", () => {
  it("prefers a global fallback asset after a preparation failure", () => {
    const failed = createAsset({
      id: "asset_twitch",
      sourceId: "source-twitch",
      title: "Twitch VOD",
      path: "https://www.twitch.tv/videos/123456789",
      externalId: "123456789"
    });
    const fallback = createAsset({
      id: "asset_fallback",
      sourceId: "source-local-library",
      title: "Continuity fallback",
      path: "/app/data/media/fallback/continuity-fallback-a.mp4",
      isGlobalFallback: true,
      fallbackPriority: 1
    });
    const normal = createAsset({
      id: "asset_normal",
      title: "Normal fallback candidate",
      path: "/app/data/media/library/normal.mp4",
      fallbackPriority: 20
    });

    const recovery = planRecoveryAfterPlaybackPreparationFailure([failed, normal, fallback], failed);

    expect(recovery.asset?.id).toBe("asset_fallback");
    expect(recovery.reasonCode).toBe("global_fallback");
    expect(recovery.fallbackTier).toBe("global-fallback");
  });

  it("prefers a non-Twitch fallback before another Twitch asset", () => {
    const failed = createAsset({
      id: "asset_twitch_failed",
      sourceId: "source-twitch",
      title: "Failed Twitch VOD",
      path: "https://www.twitch.tv/videos/222222222",
      externalId: "222222222"
    });
    const youtube = createAsset({
      id: "asset_youtube",
      sourceId: "source-youtube",
      title: "YouTube fallback",
      path: "https://www.youtube.com/watch?v=abc123",
      fallbackPriority: 30
    });
    const otherTwitch = createAsset({
      id: "asset_twitch_other",
      sourceId: "source-twitch",
      title: "Other Twitch VOD",
      path: "https://www.twitch.tv/videos/333333333",
      externalId: "333333333",
      fallbackPriority: 1
    });

    const recovery = planRecoveryAfterPlaybackPreparationFailure([failed, otherTwitch, youtube], failed);

    expect(recovery.asset?.id).toBe("asset_youtube");
    expect(recovery.reasonCode).toBe("generic_fallback");
    expect(recovery.fallbackTier).toBe("generic-fallback");
  });
});

describe("more than one asset marked as the global fallback", () => {
  // Both fallback videos on the test channel carry the flag. The selection takes the first match
  // after sorting, so which one covers an outage is decided by fallbackPriority — not by chance,
  // but not obviously either. Written down after an incident where the channel fell back and the
  // fallback then exited 255: the choice mattered and nothing described it.
  const failed = createAsset({ id: "asset_scheduled", title: "Scheduled asset" });

  it("takes the higher-priority one, not whichever comes first in the list", () => {
    const second = createAsset({ id: "asset_fallback_b", title: "Fallback B", isGlobalFallback: true, fallbackPriority: 20 });
    const first = createAsset({ id: "asset_fallback_a", title: "Fallback A", isGlobalFallback: true, fallbackPriority: 10 });

    // Deliberately passed in the wrong order: the result must come from the priority, not the array.
    const plan = planRecoveryAfterPlaybackPreparationFailure([second, first, failed], failed);

    expect(plan.asset?.id).toBe("asset_fallback_a");
    expect(plan.fallbackTier).toBe("global-fallback");
  });

  it("never returns the asset that just failed, even when it is a global fallback itself", () => {
    // The case that matters when a fallback is the thing that broke: it must not be handed back.
    const failedFallback = createAsset({
      id: "asset_fallback_a",
      title: "Fallback A",
      isGlobalFallback: true,
      fallbackPriority: 10
    });
    const other = createAsset({ id: "asset_fallback_b", title: "Fallback B", isGlobalFallback: true, fallbackPriority: 20 });

    const plan = planRecoveryAfterPlaybackPreparationFailure([failedFallback, other], failedFallback);

    expect(plan.asset?.id).toBe("asset_fallback_b");
  });
});
