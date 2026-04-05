import { describe, expect, it } from "vitest";
import type { AppState } from "@stream247/db";
import { resolvePoolAudioLane, shouldUsePoolAudioLane } from "../../apps/worker/src/audio-lanes";

function createState(): AppState {
  return {
    pools: [
      {
        id: "pool-1",
        name: "Replay Pool",
        sourceIds: ["source-1"],
        playbackMode: "round-robin",
        cursorAssetId: "",
        insertAssetId: "insert-1",
        insertEveryItems: 0,
        audioLaneAssetId: "asset-audio-bed",
        audioLaneVolumePercent: 64,
        itemsSinceInsert: 0,
        updatedAt: ""
      }
    ],
    assets: [
      {
        id: "asset-audio-bed",
        sourceId: "source-1",
        title: "Audio Bed",
        path: "/tmp/audio-bed.mp3",
        status: "ready",
        includeInProgramming: true,
        externalId: "",
        categoryName: "Bed",
        durationSeconds: 3600,
        publishedAt: "",
        fallbackPriority: 100,
        isGlobalFallback: false,
        createdAt: "",
        updatedAt: ""
      }
    ]
  } as AppState;
}

describe("audio lane helpers", () => {
  it("uses pool audio lanes only for scheduled asset playback", () => {
    expect(shouldUsePoolAudioLane({ queueKind: "asset", reasonCode: "scheduled_match" })).toBe(true);
    expect(shouldUsePoolAudioLane({ queueKind: "asset", reasonCode: "manual_next" })).toBe(true);
    expect(shouldUsePoolAudioLane({ queueKind: "insert", reasonCode: "scheduled_insert" })).toBe(false);
    expect(shouldUsePoolAudioLane({ queueKind: "live", reasonCode: "live_bridge" })).toBe(false);
  });

  it("resolves a ready audio lane asset for the active pool", () => {
    const resolved = resolvePoolAudioLane({
      state: createState(),
      poolId: "pool-1",
      queueKind: "asset",
      reasonCode: "scheduled_match"
    });

    expect(resolved?.asset.id).toBe("asset-audio-bed");
    expect(resolved?.volumePercent).toBe(64);
    expect(resolved?.poolName).toBe("Replay Pool");
  });

  it("falls back cleanly when the current target should not use an audio lane", () => {
    const resolved = resolvePoolAudioLane({
      state: createState(),
      poolId: "pool-1",
      queueKind: "insert",
      reasonCode: "scheduled_insert"
    });

    expect(resolved).toBeNull();
  });
});
