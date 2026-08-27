import { describe, expect, it } from "vitest";
import { isDirectMediaUrl, planDirectMediaSync } from "../../apps/worker/src/direct-media.js";
import { planSourceAssetReplacement } from "../../apps/worker/src/source-sync-scope.js";

describe("isDirectMediaUrl", () => {
  it("accepts http(s) links to a supported media file", () => {
    expect(isDirectMediaUrl("https://cdn.example.com/clips/intro.mp4")).toBe(true);
    expect(isDirectMediaUrl("http://cdn.example.com/clips/intro.MKV")).toBe(true);
  });

  it("rejects anything else", () => {
    expect(isDirectMediaUrl("")).toBe(false);
    expect(isDirectMediaUrl("not a url")).toBe(false);
    expect(isDirectMediaUrl("ftp://cdn.example.com/clips/intro.mp4")).toBe(false);
    expect(isDirectMediaUrl("https://cdn.example.com/clips/intro.pdf")).toBe(false);
  });
});

describe("planDirectMediaSync", () => {
  it("splits valid sources from the ones whose URL cannot be used", () => {
    const plan = planDirectMediaSync([
      { id: "src_ok", name: "Intro", externalUrl: "https://cdn.example.com/intro.mp4" },
      { id: "src_bad", name: "Broken", externalUrl: "https://cdn.example.com/page.html" },
      { id: "src_blank", name: "Unset", externalUrl: "  " }
    ]);

    expect(plan.entries.map((entry) => entry.source.id)).toEqual(["src_ok"]);
    expect(plan.entries[0]?.url).toBe("https://cdn.example.com/intro.mp4");
    expect([...plan.invalidSourceIds].sort()).toEqual(["src_bad", "src_blank"]);
  });

  it("trims surrounding whitespace before validating", () => {
    const plan = planDirectMediaSync([{ id: "src", name: "Padded", externalUrl: " https://cdn.example.com/a.mp4 " }]);
    expect(plan.entries[0]?.url).toBe("https://cdn.example.com/a.mp4");
    expect(plan.invalidSourceIds.size).toBe(0);
  });
});

// A2: syncDirectMediaSources skipped the asset-building step for an invalid URL but still handed
// the source id to the wholesale delete, so an operator mistyping one URL — or a URL that was
// fine last cycle — silently deleted that source's stored asset. Same shape as the Twitch wipe.
describe("a direct media source with an unusable URL keeps its stored asset", () => {
  const sources = [
    { id: "src_ok", name: "Intro", externalUrl: "https://cdn.example.com/intro.mp4" },
    { id: "src_bad", name: "Broken", externalUrl: "https://cdn.example.com/page.html" }
  ];

  it("preserves the invalid source while its healthy sibling still refreshes", () => {
    const syncPlan = planDirectMediaSync(sources);
    const replacement = planSourceAssetReplacement({
      sources: sources.map((source) => ({ id: source.id })),
      storedAssets: [{ sourceId: "src_ok" }, { sourceId: "src_bad" }],
      incomingAssets: syncPlan.entries.map((entry) => ({ sourceId: entry.source.id })),
      failedSourceIds: syncPlan.invalidSourceIds
    });

    expect(replacement.replaceableSourceIds).toEqual(["src_ok"]);
    expect(replacement.assetsToWrite).toEqual([{ sourceId: "src_ok" }]);
    expect(replacement.preserved).toEqual([
      { sourceId: "src_bad", decision: "keep-ingest-failed", storedAssetCount: 1 }
    ]);
  });

  it("still lets a brand new invalid source stay empty", () => {
    const syncPlan = planDirectMediaSync([sources[1]!]);
    const replacement = planSourceAssetReplacement({
      sources: [{ id: "src_bad" }],
      storedAssets: [],
      incomingAssets: [],
      failedSourceIds: syncPlan.invalidSourceIds
    });

    expect(replacement.assetsToWrite).toEqual([]);
    // Nothing stored means nothing to lose; the source is simply reported as invalid.
    expect(replacement.preserved[0]?.storedAssetCount).toBe(0);
  });
});
