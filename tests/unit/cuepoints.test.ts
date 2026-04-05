import { describe, expect, it } from "vitest";
import { buildCuepointKey } from "@stream247/core";
import type { AppState } from "@stream247/db";
import { getCuepointInsertPlan } from "../../apps/worker/src/cuepoints";

function createState(overrides: Partial<AppState["playout"]> = {}): AppState {
  return {
    scheduleBlocks: [
      {
        id: "block-1",
        title: "Prime Replay",
        categoryName: "Gaming",
        dayOfWeek: 0,
        startMinuteOfDay: 600,
        durationMinutes: 60,
        showId: "",
        poolId: "pool-1",
        sourceName: "Replay Pool",
        cuepointAssetId: "",
        cuepointOffsetsSeconds: [600, 1800]
      }
    ],
    pools: [
      {
        id: "pool-1",
        name: "Replay Pool",
        sourceIds: ["source-1"],
        playbackMode: "round-robin",
        cursorAssetId: "",
        insertAssetId: "asset-insert",
        insertEveryItems: 0,
        audioLaneAssetId: "",
        audioLaneVolumePercent: 100,
        itemsSinceInsert: 0,
        updatedAt: ""
      }
    ],
    assets: [
      {
        id: "asset-insert",
        sourceId: "source-1",
        title: "Cue Sting",
        path: "/tmp/cue-sting.mp4",
        status: "ready",
        includeInProgramming: true,
        externalId: "",
        categoryName: "Insert",
        durationSeconds: 30,
        publishedAt: "",
        fallbackPriority: 100,
        isGlobalFallback: false,
        createdAt: "",
        updatedAt: ""
      }
    ],
    playout: {
      cuepointWindowKey: "",
      cuepointFiredKeys: [],
      cuepointLastTriggeredAt: "",
      cuepointLastAssetId: "",
      ...overrides
    }
  } as AppState;
}

describe("cuepoint helpers", () => {
  it("arms the next due cuepoint insert at a safe boundary", () => {
    const currentScheduleItem = {
      blockId: "block-1",
      key: "2026-04-05:block-1:600:60",
      title: "Prime Replay",
      startTime: "10:00",
      endTime: "11:00",
      startMinuteOfDay: 600,
      durationMinutes: 60,
      poolId: "pool-1"
    };

    const plan = getCuepointInsertPlan({
      state: createState(),
      currentScheduleItem,
      skippedAssetId: "",
      now: new Date("2026-04-05T10:31:00.000Z"),
      timeZone: "UTC"
    });

    expect(plan?.asset.id).toBe("asset-insert");
    expect(plan?.offsetSeconds).toBe(600);
    expect(plan?.cuepointKey).toBe(buildCuepointKey(currentScheduleItem.key, 600));
    expect(plan?.totalCount).toBe(2);
  });

  it("skips already-fired cuepoints and advances to the next pending offset", () => {
    const occurrenceKey = "2026-04-05:block-1:600:60";
    const currentScheduleItem = {
      blockId: "block-1",
      key: occurrenceKey,
      title: "Prime Replay",
      startTime: "10:00",
      endTime: "11:00",
      startMinuteOfDay: 600,
      durationMinutes: 60,
      poolId: "pool-1"
    };

    const plan = getCuepointInsertPlan({
      state: createState({
        cuepointWindowKey: occurrenceKey,
        cuepointFiredKeys: [buildCuepointKey(occurrenceKey, 600)]
      }),
      currentScheduleItem,
      skippedAssetId: "",
      now: new Date("2026-04-05T10:31:00.000Z"),
      timeZone: "UTC"
    });

    expect(plan?.offsetSeconds).toBe(1800);
    expect(plan?.cuepointKey).toBe(buildCuepointKey(occurrenceKey, 1800));
    expect(plan?.firedCount).toBe(1);
  });

  it("returns no plan when the schedule window is inactive", () => {
    const plan = getCuepointInsertPlan({
      state: createState(),
      currentScheduleItem: {
        blockId: "block-1",
        key: "2026-04-05:block-1:600:60",
        title: "Prime Replay",
        startTime: "10:00",
        endTime: "11:00",
        startMinuteOfDay: 600,
        durationMinutes: 60,
        poolId: "pool-1"
      },
      skippedAssetId: "",
      now: new Date("2026-04-05T08:00:00.000Z"),
      timeZone: "UTC"
    });

    expect(plan).toBeNull();
  });
});
