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
  const key = (offset: number) => {
    const chapter = chapters.find((entry) => entry.offsetSeconds === offset);
    if (!chapter) {
      throw new Error(`no chapter at ${String(offset)}`);
    }
    return buildAssetChapterKey(windowKey, chapter);
  };

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

  // M108: until then a stall announced both boundaries, in offset order. The earlier chapter is
  // over by the time the cycle sees it, so announcing it names a game no longer on air.
  it("announces only the later boundary when two pass within one cycle, and marks both fired", () => {
    const progress = getDueAssetChapterBoundaries({
      windowKey,
      chapters,
      firedChapterKeys: [key(0)],
      elapsedSeconds: 2000
    });
    expect(progress.dueChapters.map((chapter) => chapter.offsetSeconds)).toEqual([1800]);
    expect(progress.firedChapterKeys).toEqual(
      expect.arrayContaining([key(600), key(1800)])
    );

    const next = getDueAssetChapterBoundaries({
      windowKey,
      chapters,
      firedChapterKeys: progress.firedChapterKeys,
      elapsedSeconds: 2030
    });
    expect(next.dueChapters).toEqual([]);
  });

  it("announces a single crossing exactly as before", () => {
    const progress = getDueAssetChapterBoundaries({
      windowKey,
      chapters,
      firedChapterKeys: [key(0)],
      elapsedSeconds: 615
    });
    expect(progress.dueChapters.map((chapter) => chapter.offsetSeconds)).toEqual([600]);
  });

  // Seen on the DUT 2026-10-06: a probe filled the chapters of the item on air two hours in, and
  // every boundary between offset 0 and now fired in one cycle.
  it("announces only the current chapter when chapters arrive for the item on air mid-item", () => {
    const progress = getDueAssetChapterBoundaries({ windowKey, chapters, firedChapterKeys: [], elapsedSeconds: 7200 });
    expect(progress.dueChapters).toEqual([{ offsetSeconds: 1800, categoryName: "Gaming", title: "Third hour" }]);
    expect([...progress.firedChapterKeys].sort()).toEqual(
      [0, 600, 1800].map((offset) => key(offset)).sort()
    );
  });

  it("announces only the current chapter after a worker restart empties the fired set mid-item", () => {
    // Same playout process, so the same window key; only the worker's memory is new.
    const progress = getDueAssetChapterBoundaries({ windowKey, chapters, firedChapterKeys: [], elapsedSeconds: 900 });
    expect(progress.dueChapters.map((chapter) => chapter.offsetSeconds)).toEqual([600]);
  });

  it("announces nothing when a replaced list adds a boundary before the chapter already announced", () => {
    // The old list had 0 and 1800, both announced; the new one adds 600, which is already over.
    const progress = getDueAssetChapterBoundaries({
      windowKey,
      chapters,
      firedChapterKeys: [key(0), key(1800)],
      elapsedSeconds: 2000
    });
    expect(progress.dueChapters).toEqual([]);
    expect(progress.firedChapterKeys).toContain(key(600));
  });

  // M108 review: a recheck replaces yt-dlp's stand-in while the archive is on air, in its first hour.
  // The chapter on air keeps offset 0 but now names another game; keyed on the offset alone it counted
  // as announced and the log never showed it.
  it("announces the chapter on air once more when a replaced list changes what it says", () => {
    const standIn = { offsetSeconds: 0, categoryName: "WARDOGS", title: "WARDOGS" };
    const replaced = [
      { offsetSeconds: 0, categoryName: "Just Chatting", title: "Just Chatting" },
      { offsetSeconds: 3600, categoryName: "WARDOGS", title: "WARDOGS" }
    ];
    const progress = getDueAssetChapterBoundaries({
      windowKey,
      chapters: replaced,
      firedChapterKeys: [buildAssetChapterKey(windowKey, standIn)],
      elapsedSeconds: 1000
    });
    expect(progress.dueChapters).toEqual([replaced[0]]);

    const next = getDueAssetChapterBoundaries({
      windowKey,
      chapters: replaced,
      firedChapterKeys: progress.firedChapterKeys,
      elapsedSeconds: 1030
    });
    expect(next.dueChapters).toEqual([]);
  });

  it("announces nothing when a replaced list keeps the chapter on air as it was", () => {
    const standIn = { offsetSeconds: 0, categoryName: "WARDOGS", title: "WARDOGS" };
    const progress = getDueAssetChapterBoundaries({
      windowKey,
      chapters: [standIn, { offsetSeconds: 3600, categoryName: "Just Chatting", title: "Just Chatting" }],
      firedChapterKeys: [buildAssetChapterKey(windowKey, standIn)],
      elapsedSeconds: 1000
    });
    expect(progress.dueChapters).toEqual([]);
  });

  it("starts a fresh fired set under a new window key when playback restarts", () => {
    // The playout restarts an asset from second zero, so keys from the previous run must not
    // suppress the boundaries of the new one.
    const restartedWindowKey = buildAssetChapterWindowKey("asset-1", "2026-08-25T11:00:00.000Z");
    const progress = getDueAssetChapterBoundaries({
      windowKey: restartedWindowKey,
      chapters,
      firedChapterKeys: [key(0), key(600)],
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
