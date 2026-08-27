import { describe, expect, it } from "vitest";
import {
  decideSourceAssetReplacement,
  selectReplaceableSourceIds
} from "../../apps/worker/src/source-sync-scope.js";

describe("decideSourceAssetReplacement", () => {
  it("replaces a source that ingested normally", () => {
    expect(
      decideSourceAssetReplacement({
        sourceId: "src_a",
        ingestFailed: false,
        incomingAssetCount: 12,
        storedAssetCount: 11
      })
    ).toBe("replace");
  });

  // The v1.5.31 on-air failure: a transient yt-dlp error on one Twitch source pushed zero assets
  // for it, but the source id stayed in the wholesale delete list. Every asset of that source —
  // including the one currently on air — was deleted, the pool went empty, the selector fell to
  // global_fallback and cut the running programme with a silent stopPlayoutProcess("switch").
  it("keeps stored assets when the ingest threw", () => {
    expect(
      decideSourceAssetReplacement({
        sourceId: "src_a",
        ingestFailed: true,
        incomingAssetCount: 0,
        storedAssetCount: 40
      })
    ).toBe("keep-ingest-failed");
  });

  it("keeps stored assets when a previously populated source suddenly returns nothing", () => {
    expect(
      decideSourceAssetReplacement({
        sourceId: "src_a",
        ingestFailed: false,
        incomingAssetCount: 0,
        storedAssetCount: 40
      })
    ).toBe("keep-empty-result");
  });

  it("still allows a genuinely empty source to stay empty", () => {
    expect(
      decideSourceAssetReplacement({
        sourceId: "src_new",
        ingestFailed: false,
        incomingAssetCount: 0,
        storedAssetCount: 0
      })
    ).toBe("replace");
  });

  it("never keeps stale rows when the ingest returned content", () => {
    expect(
      decideSourceAssetReplacement({
        sourceId: "src_a",
        ingestFailed: false,
        incomingAssetCount: 1,
        storedAssetCount: 40
      })
    ).toBe("replace");
  });
});

describe("selectReplaceableSourceIds", () => {
  it("scopes the wholesale delete to the sources that actually ingested", () => {
    expect(
      selectReplaceableSourceIds([
        { sourceId: "ok", ingestFailed: false, incomingAssetCount: 3, storedAssetCount: 3 },
        { sourceId: "threw", ingestFailed: true, incomingAssetCount: 0, storedAssetCount: 7 },
        { sourceId: "empty-now", ingestFailed: false, incomingAssetCount: 0, storedAssetCount: 7 },
        { sourceId: "fresh", ingestFailed: false, incomingAssetCount: 0, storedAssetCount: 0 }
      ])
    ).toEqual(["ok", "fresh"]);
  });

  // A failure on one source must not stop a healthy sibling from being refreshed.
  it("isolates sources from each other", () => {
    expect(
      selectReplaceableSourceIds([
        { sourceId: "a", ingestFailed: true, incomingAssetCount: 0, storedAssetCount: 5 },
        { sourceId: "b", ingestFailed: false, incomingAssetCount: 9, storedAssetCount: 9 }
      ])
    ).toEqual(["b"]);
  });

  it("returns an empty list when every source failed", () => {
    expect(
      selectReplaceableSourceIds([
        { sourceId: "a", ingestFailed: true, incomingAssetCount: 0, storedAssetCount: 5 },
        { sourceId: "b", ingestFailed: true, incomingAssetCount: 0, storedAssetCount: 5 }
      ])
    ).toEqual([]);
  });
});
