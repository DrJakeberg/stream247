import { describe, expect, it } from "vitest";
import { incrementQueueVersion, prioritizeManualNextAsset } from "../../apps/worker/src/broadcast-queue";

describe("broadcast queue helpers", () => {
  it("promotes a manual next asset to the front without duplicates", () => {
    expect(
      prioritizeManualNextAsset(
        [
          {
            id: "asset-1",
            sourceId: "source-1",
            title: "Asset 1",
            path: "/tmp/asset-1.mp4",
            status: "ready",
            includeInProgramming: true,
            externalId: "",
            categoryName: "",
            durationSeconds: 0,
            publishedAt: "",
            fallbackPriority: 100,
            isGlobalFallback: false,
            createdAt: "",
            updatedAt: ""
          },
          {
            id: "asset-2",
            sourceId: "source-1",
            title: "Asset 2",
            path: "/tmp/asset-2.mp4",
            status: "ready",
            includeInProgramming: true,
            externalId: "",
            categoryName: "",
            durationSeconds: 0,
            publishedAt: "",
            fallbackPriority: 100,
            isGlobalFallback: false,
            createdAt: "",
            updatedAt: ""
          }
        ],
        {
          id: "asset-2",
          sourceId: "source-1",
          title: "Asset 2",
          path: "/tmp/asset-2.mp4",
          status: "ready",
          includeInProgramming: true,
          externalId: "",
          categoryName: "",
          durationSeconds: 0,
          publishedAt: "",
          fallbackPriority: 100,
          isGlobalFallback: false,
          createdAt: "",
          updatedAt: ""
        }
      ).map((asset) => asset.id)
    ).toEqual(["asset-2", "asset-1"]);
  });

  it("bumps queue version only when the visible queue changes", () => {
    const queue = [
      {
        id: "queue-1",
        kind: "asset" as const,
        assetId: "asset-1",
        title: "Asset 1",
        subtitle: "",
        scenePreset: "replay-lower-third" as const,
        position: 0
      }
    ];

    expect(incrementQueueVersion(3, queue, queue)).toBe(3);
    expect(
      incrementQueueVersion(3, queue, [
        {
          ...queue[0],
          assetId: "asset-2",
          title: "Asset 2"
        }
      ])
    ).toBe(4);
  });
});
