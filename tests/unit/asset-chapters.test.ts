import { describe, expect, it } from "vitest";
import {
  buildAssetChapterKey,
  buildAssetChaptersFromSourceMetadata,
  buildAssetChapterWindowKey,
  getAssetChapterAt,
  getDueAssetChapterBoundaries,
  normalizeAssetChapters,
  parseAssetChaptersJson,
  parseChapterOffsetInput
} from "@stream247/core";

describe("chapter list normalisation", () => {
  it("sorts by offset and keeps the first entry when offsets collide", () => {
    expect(
      normalizeAssetChapters([
        { offsetSeconds: 600, categoryName: "Music", title: "Second hour" },
        { offsetSeconds: 0, categoryName: "Just Chatting", title: "Intro" },
        { offsetSeconds: 600, categoryName: "Duplicate", title: "Never on air" }
      ])
    ).toEqual([
      { offsetSeconds: 0, categoryName: "Just Chatting", title: "Intro" },
      { offsetSeconds: 600, categoryName: "Music", title: "Second hour" }
    ]);
  });

  it("drops negative, non-numeric and empty entries", () => {
    expect(
      normalizeAssetChapters([
        { offsetSeconds: -5, categoryName: "Gaming", title: "Before the start" },
        { offsetSeconds: Number.NaN, categoryName: "Gaming", title: "Nowhere" },
        { offsetSeconds: 30, categoryName: "", title: "" },
        { offsetSeconds: 90.9, categoryName: "Gaming", title: "Kept" }
      ])
    ).toEqual([{ offsetSeconds: 90, categoryName: "Gaming", title: "Kept" }]);
  });

  it("normalises anything unparseable to the empty list — the rollback shape", () => {
    // An empty list must always mean "behave exactly as before chapters existed", so corrupt
    // stored JSON degrades to that instead of erroring playout or ingest.
    expect(normalizeAssetChapters("not a list")).toEqual([]);
    expect(parseAssetChaptersJson("{broken")).toEqual([]);
    expect(parseAssetChaptersJson(undefined)).toEqual([]);
  });
});

describe("the chapter on air at a given second", () => {
  const chapters = [
    { offsetSeconds: 0, categoryName: "Just Chatting", title: "Intro" },
    { offsetSeconds: 600, categoryName: "Music", title: "Second hour" }
  ];

  it("returns the last chapter whose offset has been reached", () => {
    expect(getAssetChapterAt(chapters, 0)?.title).toBe("Intro");
    expect(getAssetChapterAt(chapters, 599)?.title).toBe("Intro");
    expect(getAssetChapterAt(chapters, 600)?.title).toBe("Second hour");
  });

  it("returns null before the first offset and for an empty list", () => {
    expect(getAssetChapterAt([{ offsetSeconds: 120, categoryName: "Gaming", title: "Late start" }], 60)).toBeNull();
    expect(getAssetChapterAt([], 3600)).toBeNull();
  });
});

describe("chapter boundary detection", () => {
  const windowKey = buildAssetChapterWindowKey("asset-1", "2026-08-25T10:00:00.000Z");
  const chapters = [
    { offsetSeconds: 0, categoryName: "Just Chatting", title: "Intro" },
    { offsetSeconds: 600, categoryName: "Music", title: "Second hour" },
    { offsetSeconds: 1800, categoryName: "Gaming", title: "Third hour" }
  ];

  it("fires each crossed boundary exactly once", () => {
    const first = getDueAssetChapterBoundaries({ windowKey, chapters, firedChapterKeys: [], elapsedSeconds: 15 });
    expect(first.dueChapters.map((chapter) => chapter.offsetSeconds)).toEqual([0]);

    const second = getDueAssetChapterBoundaries({
      windowKey,
      chapters,
      firedChapterKeys: first.firedChapterKeys,
      elapsedSeconds: 30
    });
    expect(second.dueChapters).toEqual([]);
  });

  it("catches up on every boundary missed during a stall, in offset order", () => {
    const progress = getDueAssetChapterBoundaries({
      windowKey,
      chapters,
      firedChapterKeys: [buildAssetChapterKey(windowKey, 0)],
      elapsedSeconds: 2000
    });
    expect(progress.dueChapters.map((chapter) => chapter.offsetSeconds)).toEqual([600, 1800]);
  });

  it("starts a fresh fired set under a new window key when playback restarts", () => {
    // The playout restarts an asset from second zero, so keys from the previous run must not
    // suppress the boundaries of the new one.
    const restartedWindowKey = buildAssetChapterWindowKey("asset-1", "2026-08-25T11:00:00.000Z");
    const progress = getDueAssetChapterBoundaries({
      windowKey: restartedWindowKey,
      chapters,
      firedChapterKeys: [buildAssetChapterKey(windowKey, 0), buildAssetChapterKey(windowKey, 600)],
      elapsedSeconds: 15
    });
    expect(progress.dueChapters.map((chapter) => chapter.offsetSeconds)).toEqual([0]);
  });
});

describe("chapters from source metadata", () => {
  it("uses the chapter title as category candidate for Twitch VODs only", () => {
    const entries = [
      { start_time: 0, end_time: 600, title: "Just Chatting" },
      { start_time: 600, end_time: 1200, title: "Elden Ring" }
    ];

    expect(buildAssetChaptersFromSourceMetadata(entries, { chapterTitleNamesCategory: true })).toEqual([
      { offsetSeconds: 0, categoryName: "Just Chatting", title: "Just Chatting" },
      { offsetSeconds: 600, categoryName: "Elden Ring", title: "Elden Ring" }
    ]);
    expect(buildAssetChaptersFromSourceMetadata(entries, { chapterTitleNamesCategory: false })[0]?.categoryName).toBe("");
  });

  it("returns the empty list when the payload carries no chapters", () => {
    expect(buildAssetChaptersFromSourceMetadata(undefined, { chapterTitleNamesCategory: true })).toEqual([]);
  });
});

describe("operator-typed chapter offsets", () => {
  it("accepts plain seconds, mm:ss and hh:mm:ss", () => {
    expect(parseChapterOffsetInput("90")).toBe(90);
    expect(parseChapterOffsetInput("1:30")).toBe(90);
    expect(parseChapterOffsetInput("01:01:30")).toBe(3690);
  });

  it("rejects anything else instead of guessing", () => {
    expect(parseChapterOffsetInput("")).toBeNull();
    expect(parseChapterOffsetInput("1:99")).toBeNull();
    expect(parseChapterOffsetInput("soon")).toBeNull();
  });
});
