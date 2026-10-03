import { describe, expect, it } from "vitest";
import { createInitialSeedState, type AppState } from "@stream247/db";
import { findUnplayableWeekBlocks, getGoLiveChecklist } from "../../apps/web/lib/server/onboarding";
import { getMaterializedProgrammingWeekPreview } from "../../apps/web/lib/server/state";

// M91 "Honest first run" (planning/research/ux-install.md I1, owner decision 5.1 Q5): a fresh install
// starts empty except the local library, and readiness counts only what can air.

const NOW = new Date("2026-10-07T12:00:00.000Z");

function pool(id: string, sourceIds: string[]): AppState["pools"][number] {
  return {
    id,
    name: id,
    sourceIds,
    playbackMode: "round-robin",
    cursorAssetId: "",
    sourceCursors: {},
    insertAssetId: "",
    insertEveryItems: 0,
    itemsSinceInsert: 0,
    audioLaneAssetId: "",
    audioLaneVolumePercent: 100,
    updatedAt: ""
  } as AppState["pools"][number];
}

function block(id: string, poolId: string, dayOfWeek: number, startMinuteOfDay = 20 * 60): AppState["scheduleBlocks"][number] {
  return { id, title: id, categoryName: "Talk", dayOfWeek, startMinuteOfDay, durationMinutes: 120, poolId, sourceName: "Local Media Library" };
}

function readyAsset(id: string, sourceId = "source-local-library"): AppState["assets"][number] {
  return {
    id,
    sourceId,
    title: id,
    path: `/media/${id}.mp4`,
    status: "ready",
    includeInProgramming: true,
    durationSeconds: 1800,
    fallbackPriority: 0,
    isGlobalFallback: false,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z"
  } as AppState["assets"][number];
}

function stateWith(overrides: Partial<AppState>): AppState {
  return { ...createInitialSeedState(), ...overrides };
}

function statusOf(state: AppState, id: string) {
  return getGoLiveChecklist(state, NOW).find((item) => item.id === id);
}

describe("createInitialSeedState (M91, I1)", () => {
  it("bootstraps an empty database with no pool, no schedule block and no source without a URL", () => {
    const seed = createInitialSeedState();
    expect(seed.pools).toEqual([]);
    expect(seed.scheduleBlocks).toEqual([]);
    expect(seed.assets).toEqual([]);
    // The local library is the only source, and it is the one kind that needs no URL.
    expect(seed.sources.map((source) => [source.id, source.connectorKind])).toEqual([["source-local-library", "local-library"]]);
    expect(seed.sources.filter((source) => source.connectorKind !== "local-library" && !source.externalUrl)).toEqual([]);
  });

  it("leaves a fresh install's pools and schedule as open steps, not ready", () => {
    const seed = createInitialSeedState();
    expect(statusOf(seed, "pools")?.status).toBe("action");
    expect(statusOf(seed, "schedule")?.status).toBe("action");
    expect(statusOf(seed, "assets")?.status).toBe("action");
  });
});

describe("readiness counts only what can air (M91, I1)", () => {
  it("a pool used by a block with 0 ready assets is action, and so is its week", () => {
    const state = stateWith({ pools: [pool("pool-a", ["source-local-library"])], scheduleBlocks: [block("evening", "pool-a", 3)] });
    expect(statusOf(state, "pools")?.status).toBe("action");
    const schedule = statusOf(state, "schedule");
    expect(schedule?.status).toBe("action");
    expect(schedule?.detail).toContain("Wed 20:00 evening");
  });

  it("a pool with a ready asset that no block uses is action", () => {
    const state = stateWith({ pools: [pool("pool-a", ["source-local-library"])], assets: [readyAsset("a1")] });
    expect(statusOf(state, "pools")?.status).toBe("action");
    expect(statusOf(state, "schedule")?.status).toBe("action");
  });

  it("a pool used by a block and holding a ready asset is ready, and a week of such blocks is ready", () => {
    const state = stateWith({
      pools: [pool("pool-a", ["source-local-library"])],
      scheduleBlocks: [block("evening", "pool-a", 3), block("night", "pool-a", 5)],
      assets: [readyAsset("a1")]
    });
    expect(statusOf(state, "pools")).toMatchObject({ status: "ready", detail: "1 pool(s) are scheduled and have a ready video." });
    expect(statusOf(state, "schedule")?.status).toBe("ready");
  });

  it("a week with an unplayable block is action, even when another block can air", () => {
    const state = stateWith({
      sources: [
        ...createInitialSeedState().sources,
        { id: "src-yt", name: "YouTube", type: "Managed ingestion", connectorKind: "youtube-playlist", enabled: true, status: "Ready", externalUrl: "https://www.youtube.com/playlist?list=PL1" }
      ],
      pools: [pool("pool-a", ["source-local-library"]), pool("pool-empty", ["src-yt"])],
      scheduleBlocks: [block("evening", "pool-a", 3), block("prime", "pool-empty", 5, 18 * 60)],
      assets: [readyAsset("a1")]
    });
    expect(statusOf(state, "pools")?.status).toBe("ready");
    const schedule = statusOf(state, "schedule");
    expect(schedule?.status).toBe("action");
    expect(schedule?.detail).toContain("Fri 18:00 prime");
    expect(findUnplayableWeekBlocks(state, getMaterializedProgrammingWeekPreview(state, NOW))).toEqual(["Fri 18:00 prime"]);
  });

  it("a placeholder source without a URL does not count as a content source", () => {
    const state = stateWith({
      sources: [
        { id: "source-youtube", name: "YouTube Playlist", type: "Managed ingestion", connectorKind: "youtube-playlist", enabled: true, status: "Planned", externalUrl: "" }
      ]
    });
    expect(statusOf(state, "sources")?.status).toBe("action");
    const withLibrary = stateWith({
      sources: [...createInitialSeedState().sources, ...state.sources]
    });
    expect(statusOf(withLibrary, "sources")).toMatchObject({
      status: "ready",
      detail: "1 source(s) can deliver media. 1 more are disabled or have no URL yet."
    });
  });
});
