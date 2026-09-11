import { describe, expect, it } from "vitest";
import {
  classifyAssetRetention,
  selectAssetRetentionDeletions,
  type AssetRetentionSnapshot
} from "../../packages/db/src/asset-retention";

// The conservative library sweep. Deleting an asset row that anything still points at is the
// dangerous failure, so these tests enumerate every reference path the schema knows and pin that
// each one, on its own, protects an orphaned asset. Deletion additionally requires the asset to
// have been OBSERVED orphaned for the whole protection window (the mark, written by the sweep
// itself) — losing a source must never make weeks-old assets deletable the same day.

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-08-26T12:00:00.000Z");
const OLD = new Date(NOW - 30 * DAY_MS).toISOString();
const LAST_WEEK = new Date(NOW - 8 * DAY_MS).toISOString();

function emptySnapshot(): AssetRetentionSnapshot {
  return {
    sources: [{ id: "source-live", name: "Live source" }],
    assets: [],
    pools: [],
    scheduleBlocks: [],
    assetCollections: [],
    playout: {
      currentAssetId: "",
      previousAssetId: "",
      desiredAssetId: "",
      nextAssetId: "",
      prefetchedAssetId: "",
      transitionTargetAssetId: "",
      manualNextAssetId: "",
      lastSuccessfulAssetId: "",
      overrideAssetId: "",
      insertAssetId: "",
      skipAssetId: "",
      cuepointLastAssetId: "",
      queuedAssetIds: [],
      queueItems: []
    },
    chat: {
      voteWinnerAssetId: "",
      voteOptionAssetIds: [],
      viewerRequestAssetIds: [],
      skipVoteAssetId: ""
    },
    orphanFirstSeenAt: {}
  };
}

function orphanAsset(id: string) {
  return { id, sourceId: "source-gone", isGlobalFallback: false, createdAt: OLD, updatedAt: OLD };
}

function classify(snapshot: AssetRetentionSnapshot) {
  return classifyAssetRetention(snapshot, { nowMs: NOW, protectionDays: 7 });
}

describe("classifyAssetRetention", () => {
  it("deletes only orphaned, unreferenced assets past the protection window", () => {
    const snapshot = emptySnapshot();
    snapshot.assets = [
      { ...orphanAsset("asset-orphan"), },
      { id: "asset-sourced", sourceId: "source-live", isGlobalFallback: false, createdAt: OLD, updatedAt: OLD }
    ];
    snapshot.orphanFirstSeenAt = { "asset-orphan": LAST_WEEK };

    const result = classify(snapshot);

    expect(result.deletableAssetIds).toEqual(["asset-orphan"]);
    expect(result.counters.assetsTotal).toBe(2);
    expect(result.counters.keptWithSource).toBe(1);
    expect(result.counters.orphaned).toBe(1);
    expect(result.counters.deletable).toBe(1);
  });

  it("never deletes an asset that still has its source, even if marked and old", () => {
    const snapshot = emptySnapshot();
    snapshot.assets = [{ id: "asset-a", sourceId: "source-live", isGlobalFallback: false, createdAt: OLD, updatedAt: OLD }];
    snapshot.orphanFirstSeenAt = { "asset-a": LAST_WEEK };

    const result = classify(snapshot);

    expect(result.deletableAssetIds).toEqual([]);
    expect(result.orphanedAssetIds).toEqual([]);
  });

  // One case per reference path in the schema. Each mutation alone must protect the orphan.
  const referenceCases: Array<{
    name: string;
    counter: string;
    mutate: (snapshot: AssetRetentionSnapshot, id: string) => void;
  }> = [
    {
      name: "pool cursor",
      counter: "referencedByPoolRuntime",
      mutate: (s, id) => {
        s.pools = [{ sourceIds: [], cursorAssetId: id, insertAssetId: "", audioLaneAssetId: "" }];
      }
    },
    {
      name: "pool insert asset",
      counter: "referencedByPoolRuntime",
      mutate: (s, id) => {
        s.pools = [{ sourceIds: [], cursorAssetId: "", insertAssetId: id, audioLaneAssetId: "" }];
      }
    },
    {
      name: "pool audio lane",
      counter: "referencedByPoolRuntime",
      mutate: (s, id) => {
        s.pools = [{ sourceIds: [], cursorAssetId: "", insertAssetId: "", audioLaneAssetId: id }];
      }
    },
    {
      name: "pool still lists the deleted source id",
      counter: "referencedByPoolSource",
      mutate: (s) => {
        s.pools = [{ sourceIds: ["source-gone"], cursorAssetId: "", insertAssetId: "", audioLaneAssetId: "" }];
      }
    },
    {
      name: "schedule cuepoint",
      counter: "referencedBySchedule",
      mutate: (s, id) => {
        s.scheduleBlocks = [{ cuepointAssetId: id }];
      }
    },
    {
      name: "curated set membership",
      counter: "referencedByCollection",
      mutate: (s, id) => {
        s.assetCollections = [{ assetIds: [id] }];
      }
    },
    {
      name: "playout current asset",
      counter: "referencedByPlayout",
      mutate: (s, id) => {
        s.playout.currentAssetId = id;
      }
    },
    {
      name: "playout prefetched asset",
      counter: "referencedByPlayout",
      mutate: (s, id) => {
        s.playout.prefetchedAssetId = id;
      }
    },
    {
      name: "playout manual-next asset",
      counter: "referencedByPlayout",
      mutate: (s, id) => {
        s.playout.manualNextAssetId = id;
      }
    },
    {
      name: "queued asset ids",
      counter: "referencedByQueue",
      mutate: (s, id) => {
        s.playout.queuedAssetIds = [id];
      }
    },
    {
      name: "queue items",
      counter: "referencedByQueue",
      mutate: (s, id) => {
        s.playout.queueItems = [{ assetId: id }];
      }
    },
    {
      name: "chat vote option",
      counter: "referencedByChat",
      mutate: (s, id) => {
        s.chat.voteOptionAssetIds = [id];
      }
    },
    {
      name: "chat vote winner",
      counter: "referencedByChat",
      mutate: (s, id) => {
        s.chat.voteWinnerAssetId = id;
      }
    },
    {
      name: "chat viewer request",
      counter: "referencedByChat",
      mutate: (s, id) => {
        s.chat.viewerRequestAssetIds = [id];
      }
    },
    {
      name: "chat skip campaign",
      counter: "referencedByChat",
      mutate: (s, id) => {
        s.chat.skipVoteAssetId = id;
      }
    }
  ];

  for (const testCase of referenceCases) {
    it(`keeps an orphaned asset referenced via ${testCase.name}`, () => {
      const snapshot = emptySnapshot();
      snapshot.assets = [orphanAsset("asset-ref")];
      snapshot.orphanFirstSeenAt = { "asset-ref": LAST_WEEK };
      testCase.mutate(snapshot, "asset-ref");

      const result = classify(snapshot);

      expect(result.deletableAssetIds).toEqual([]);
      expect(result.counters.keptOrphanedReferenced).toBe(1);
      expect((result.counters as unknown as Record<string, number>)[testCase.counter]).toBe(1);
    });
  }

  it("keeps a global fallback asset even when orphaned and unreferenced", () => {
    const snapshot = emptySnapshot();
    snapshot.assets = [{ ...orphanAsset("asset-fallback"), isGlobalFallback: true }];
    snapshot.orphanFirstSeenAt = { "asset-fallback": LAST_WEEK };

    const result = classify(snapshot);

    expect(result.deletableAssetIds).toEqual([]);
    expect(result.counters.keptAsGlobalFallback).toBe(1);
  });

  it("protects an orphan until the mark has aged the whole window", () => {
    const snapshot = emptySnapshot();
    snapshot.assets = [orphanAsset("asset-young")];
    snapshot.orphanFirstSeenAt = { "asset-young": new Date(NOW - 2 * DAY_MS).toISOString() };

    const result = classify(snapshot);

    expect(result.deletableAssetIds).toEqual([]);
    expect(result.counters.keptOrphanedInProtectionWindow).toBe(1);
  });

  it("protects an orphan the sweep sees for the first time — the clock starts now", () => {
    const snapshot = emptySnapshot();
    snapshot.assets = [orphanAsset("asset-new-orphan")];

    const result = classify(snapshot);

    expect(result.deletableAssetIds).toEqual([]);
    expect(result.orphanedAssetIds).toEqual(["asset-new-orphan"]);
    expect(result.counters.keptOrphanedInProtectionWindow).toBe(1);
  });

  it("protects an orphan whose own row was touched inside the window, despite an old mark", () => {
    const snapshot = emptySnapshot();
    snapshot.assets = [{ ...orphanAsset("asset-fresh"), updatedAt: new Date(NOW - 1 * DAY_MS).toISOString() }];
    snapshot.orphanFirstSeenAt = { "asset-fresh": LAST_WEEK };

    const result = classify(snapshot);

    expect(result.deletableAssetIds).toEqual([]);
    expect(result.counters.keptOrphanedInProtectionWindow).toBe(1);
  });
});

describe("selectAssetRetentionDeletions", () => {
  it("deletes nothing while the switch is off, but the candidate counters still tell the story", () => {
    const snapshot = emptySnapshot();
    snapshot.assets = [orphanAsset("asset-candidate")];
    snapshot.orphanFirstSeenAt = { "asset-candidate": LAST_WEEK };
    const classification = classify(snapshot);

    expect(classification.counters.deletable).toBe(1);
    expect(selectAssetRetentionDeletions(classification, false)).toEqual([]);
    expect(selectAssetRetentionDeletions(classification, true)).toEqual(["asset-candidate"]);
  });
});
