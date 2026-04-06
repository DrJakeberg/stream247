import { afterEach, describe, expect, it } from "vitest";
import { buildAssetThumbnailFallbackSvg, getAssetThumbnailPath as getServerAssetThumbnailPath } from "../../apps/web/lib/server/asset-thumbnails";
import { getAssetThumbnailPath as getWorkerAssetThumbnailPath } from "../../apps/worker/src/asset-thumbnails";

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
