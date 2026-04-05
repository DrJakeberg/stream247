import { describe, expect, it } from "vitest";
import { buildLocalLibraryAssetId, buildLocalLibraryFolderPath } from "../../apps/worker/src/local-library";

describe("buildLocalLibraryAssetId", () => {
  it("returns a stable id for the same file path", () => {
    expect(buildLocalLibraryAssetId("/app/data/media/continuity-a.mp4")).toBe(buildLocalLibraryAssetId("/app/data/media/continuity-a.mp4"));
  });

  it("does not collide for similar file names", () => {
    expect(buildLocalLibraryAssetId("/app/data/media/continuity-a.mp4")).not.toBe(buildLocalLibraryAssetId("/app/data/media/continuity-b.mp4"));
  });

  it("derives a relative folder path inside the library root", () => {
    expect(buildLocalLibraryFolderPath("/app/data/media/uploads/season-1/clip.mp4", "/app/data/media")).toBe("uploads/season-1");
    expect(buildLocalLibraryFolderPath("/app/data/media/clip.mp4", "/app/data/media")).toBe("");
  });
});
