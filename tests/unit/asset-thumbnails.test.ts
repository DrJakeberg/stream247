import { afterEach, describe, expect, it } from "vitest";
import { buildAssetThumbnailFallbackSvg, getAssetThumbnailPath as getServerAssetThumbnailPath } from "../../apps/web/lib/server/asset-thumbnails";
import {
  THUMBNAIL_SWEEP_LIMIT,
  getAssetThumbnailPath as getWorkerAssetThumbnailPath,
  selectEvictableThumbnails,
  type ThumbnailFileInfo
} from "../../apps/worker/src/asset-thumbnails";

const originalMediaLibraryRoot = process.env.MEDIA_LIBRARY_ROOT;

afterEach(() => {
  process.env.MEDIA_LIBRARY_ROOT = originalMediaLibraryRoot;
});

describe("asset thumbnail helpers", () => {
  it("uses the same sanitized thumbnail path for browser and worker helpers", () => {
    process.env.MEDIA_LIBRARY_ROOT = "/tmp/stream247-media";

    expect(getServerAssetThumbnailPath("asset:replay/one")).toBe(
      "/tmp/stream247-media/.stream247-thumbnails/asset_replay_one.jpg"
    );
    expect(getWorkerAssetThumbnailPath("asset:replay/one", "/tmp/stream247-media")).toBe(
      "/tmp/stream247-media/.stream247-thumbnails/asset_replay_one.jpg"
    );
  });

  it("escapes asset metadata in the fallback svg card", () => {
    const svg = buildAssetThumbnailFallbackSvg({
      id: "asset_1",
      sourceId: "source_local",
      title: `Replay & "Sting" <01>`,
      path: "/tmp/replay.mp4",
      folderPath: "uploads/highlights",
      tags: [],
      status: "ready",
      includeInProgramming: true,
      externalId: "asset-1",
      categoryName: "Highlights",
      durationSeconds: 120,
      publishedAt: "",
      fallbackPriority: 1,
      isGlobalFallback: false,
      createdAt: "2026-04-06T10:00:00.000Z",
      updatedAt: "2026-04-06T10:00:00.000Z"
    });

    expect(svg).toContain("Replay &amp; &quot;Sting&quot; &lt;01&gt;");
    expect(svg).toContain("Folder: uploads/highlights");
    expect(svg).toContain("Source: source_local");
  });
});

describe("choosing thumbnails a disk-pressure sweep may take", () => {
  const NOW = new Date("2026-08-25T01:00:00.000Z").getTime();
  const HOUR = 60 * 60 * 1000;

  function thumbnail(filePath: string, ageMs: number): ThumbnailFileInfo {
    return { filePath, modifiedAtMs: NOW - ageMs, bytes: 40_000 };
  }

  it("takes the oldest first and never a protected one", () => {
    // Thumbnails carry no reference index of their own, so protection is by asset id: the caller
    // maps every schedule/queue asset through getAssetThumbnailPath and passes the result here.
    const selected = selectEvictableThumbnails({
      files: [
        thumbnail("/media/.stream247-thumbnails/newer.jpg", 2 * HOUR),
        thumbnail("/media/.stream247-thumbnails/oldest.jpg", 90 * 24 * HOUR),
        thumbnail("/media/.stream247-thumbnails/scheduled.jpg", 400 * 24 * HOUR)
      ],
      protectedPaths: ["/media/.stream247-thumbnails/scheduled.jpg"]
    });

    // The protected thumbnail stays even though it is by far the oldest: age is an ordering, not a
    // permission.
    expect(selected.map((file) => file.filePath)).toEqual([
      "/media/.stream247-thumbnails/oldest.jpg",
      "/media/.stream247-thumbnails/newer.jpg"
    ]);
  });

  it("caps one sweep rather than clearing a backlog in a single cycle", () => {
    const backlog = Array.from({ length: THUMBNAIL_SWEEP_LIMIT + 200 }, (_, index) =>
      thumbnail(`/media/.stream247-thumbnails/asset-${index}.jpg`, index * HOUR)
    );

    expect(selectEvictableThumbnails({ files: backlog, protectedPaths: [] })).toHaveLength(THUMBNAIL_SWEEP_LIMIT);
  });

  it("ignores blank protected entries rather than resolving them to a directory", () => {
    const files = [thumbnail("/media/.stream247-thumbnails/only.jpg", HOUR)];

    expect(selectEvictableThumbnails({ files, protectedPaths: [""] })).toHaveLength(1);
  });

  it("selects nothing when everything is protected", () => {
    const files = [thumbnail("/media/.stream247-thumbnails/live.jpg", 5 * HOUR)];

    expect(
      selectEvictableThumbnails({ files, protectedPaths: ["/media/.stream247-thumbnails/live.jpg"] })
    ).toEqual([]);
  });
});
