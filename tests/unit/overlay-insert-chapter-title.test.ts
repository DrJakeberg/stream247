import { describe, expect, it } from "vitest";
import { serializeAssetChapters } from "@stream247/core";
import type { AppState } from "@stream247/core";
import { buildActiveScenePayload } from "../../apps/web/lib/server/state";

/**
 * The chapter title on air, and the studio preview that claims to mirror it.
 *
 * `writeOnAirOverlay` in the worker resolves the chapter for whatever asset is on air, whatever the
 * queue kind: it passes the asset straight to `overlayOnAirChapterTitle`, whose own guards do the
 * deciding. The web preview gated the same lookup on `queueKind === "asset"`, so an insert — which
 * is an asset, playing, with `currentAssetId` set to it — was named by its queue entry on the
 * preview and by its chapter on the channel. The two surfaces disagreed about what was on air.
 */
// buildActiveScenePayload takes no injectable clock, so the fixture is anchored to the wall clock
// instead: five minutes in, which is past the 120-second chapter mark whenever the test runs.
const STARTED = new Date(Date.now() - 300_000).toISOString();

function stateWithChapteredInsert(kind: "asset" | "insert"): AppState {
  return {
    assets: [
      {
        id: "asset_1",
        sourceId: "source_1",
        title: "Long recording",
        titlePrefix: "",
        categoryName: "",
        chaptersJson: serializeAssetChapters([
          { offsetSeconds: 0, title: "Cold open" },
          { offsetSeconds: 120, title: "The middle part" }
        ])
      }
    ],
    sources: [{ id: "source_1", name: "Source" }],
    playout: {
      currentAssetId: "asset_1",
      nextAssetId: "",
      processStartedAt: STARTED,
      currentTitle: "queue entry title",
      nextTitle: "",
      liveBridgeLabel: "",
      liveBridgeInputType: "rtmp",
      queueItems: [{ kind, title: "queue entry title" }],
      queuedAssetIds: []
    },
    scheduleBlocks: [],
    settings: { timeZone: "UTC" },
    overlay: { queuePreviewCount: 3, channelName: "Stream247", headline: "" }
  } as unknown as AppState;
}

describe("insert scenes are named by the chapter that is on air", () => {
  it("names a chaptered insert by its chapter, exactly as the channel does", () => {
    const payload = buildActiveScenePayload(stateWithChapteredInsert("insert"));
    expect(payload.heroTitle).toBe("The middle part");
  });

  it("still names a chaptered asset by its chapter", () => {
    const payload = buildActiveScenePayload(stateWithChapteredInsert("asset"));
    expect(payload.heroTitle).toBe("The middle part");
  });

  // The deliberate exception, pinned so the next person does not "simplify" it away: a live bridge
  // is named by the bridge even when a stale currentAssetId still points at a chaptered asset. The
  // worker reaches the same outcome by passing a null asset on its live path.
  it("does not let a stale asset lend its chapter to a live bridge", () => {
    const state = stateWithChapteredInsert("asset");
    state.playout.queueItems = [{ kind: "live", title: "" }] as never;
    state.playout.liveBridgeLabel = "Studio B";
    const payload = buildActiveScenePayload(state, { queueKind: "live" });
    expect(payload.heroTitle).toBe("Studio B");
  });
});
