import { describe, expect, it } from "vitest";
import { scanMediaFiles, type MediaDirectoryEntry } from "../../apps/worker/src/local-library.js";
import { decideSourceAssetReplacement, planSourceAssetReplacement } from "../../apps/worker/src/source-sync-scope.js";

function dir(name: string): MediaDirectoryEntry {
  return { name, isDirectory: () => true };
}

function file(name: string): MediaDirectoryEntry {
  return { name, isDirectory: () => false };
}

/** A readdir stand-in: a map of directory -> entries, with listed paths failing like a bad mount. */
function fakeReaddir(tree: Record<string, MediaDirectoryEntry[]>, broken: Record<string, string> = {}) {
  return async (directory: string): Promise<MediaDirectoryEntry[]> => {
    const code = broken[directory];
    if (code) {
      const error = new Error(`${code}: cannot read ${directory}`) as NodeJS.ErrnoException;
      error.code = code;
      throw error;
    }
    const entries = tree[directory];
    if (!entries) {
      const error = new Error(`ENOENT: no such directory ${directory}`) as NodeJS.ErrnoException;
      error.code = "ENOENT";
      throw error;
    }
    return entries;
  };
}

const tree: Record<string, MediaDirectoryEntry[]> = {
  "/media": [file("standby-fallback.mp4"), file("notes.txt"), dir("shows")],
  "/media/shows": [file("episode-1.mp4"), file("episode-2.mkv")]
};

describe("scanMediaFiles", () => {
  it("collects media files recursively and ignores non-media entries", async () => {
    const scan = await scanMediaFiles({ root: "/media", readdir: fakeReaddir(tree) });

    expect(scan.files).toEqual([
      "/media/standby-fallback.mp4",
      "/media/shows/episode-1.mp4",
      "/media/shows/episode-2.mkv"
    ]);
    expect(scan.failed).toBe(false);
    expect(scan.failedDirectories).toEqual([]);
  });

  it("reports a genuinely empty directory as an empty but successful scan", async () => {
    const scan = await scanMediaFiles({ root: "/media", readdir: fakeReaddir({ "/media": [] }) });

    expect(scan.files).toEqual([]);
    expect(scan.failed).toBe(false);
  });

  it("skips excluded paths without failing the scan", async () => {
    const scan = await scanMediaFiles({
      root: "/media",
      readdir: fakeReaddir(tree),
      isExcluded: (absolutePath) => absolutePath === "/media/shows"
    });

    expect(scan.files).toEqual(["/media/standby-fallback.mp4"]);
    expect(scan.failed).toBe(false);
  });

  // The A1 failure mode: an unmounted volume, an NFS blip or EACCES on the root used to be
  // indistinguishable from "the library is empty", and the caller then deleted every local asset.
  it("marks an unreadable root as failed instead of empty", async () => {
    const scan = await scanMediaFiles({
      root: "/media",
      readdir: fakeReaddir(tree, { "/media": "EACCES" })
    });

    expect(scan.failed).toBe(true);
    expect(scan.failedDirectories).toEqual(["/media"]);
    expect(scan.files).toEqual([]);
  });

  // One unreadable subdirectory is the subtler case: the scan still returns files, so a naive
  // caller sees a plausible listing and deletes everything the broken subtree contributed.
  it("marks a partial scan as failed and still returns what it could read", async () => {
    const scan = await scanMediaFiles({
      root: "/media",
      readdir: fakeReaddir(tree, { "/media/shows": "EMFILE" })
    });

    expect(scan.failed).toBe(true);
    expect(scan.failedDirectories).toEqual(["/media/shows"]);
    expect(scan.files).toEqual(["/media/standby-fallback.mp4"]);
  });
});

describe("a failed library scan never replaces stored assets", () => {
  // Worse than the Twitch incident: the local library holds the global fallback asset, so a wipe
  // here leaves the channel with nothing at all to fall back to.
  it("keeps the stored library — including the global fallback — when the scan failed", () => {
    expect(
      decideSourceAssetReplacement({
        sourceId: "source-local-library",
        ingestFailed: true,
        incomingAssetCount: 0,
        storedAssetCount: 12
      })
    ).toBe("keep-ingest-failed");
  });

  // A partial scan that still returned files is the nastier variant: the count looks healthy.
  it("keeps the stored library when a partial scan returned fewer files than are stored", () => {
    expect(
      decideSourceAssetReplacement({
        sourceId: "source-local-library",
        ingestFailed: true,
        incomingAssetCount: 1,
        storedAssetCount: 12
      })
    ).toBe("keep-ingest-failed");
  });

  it("still lets an emptied library empty itself when the scan succeeded", () => {
    expect(
      decideSourceAssetReplacement({
        sourceId: "source-local-library",
        ingestFailed: false,
        incomingAssetCount: 0,
        storedAssetCount: 0
      })
    ).toBe("replace");
  });

  // The whole point of A1: the local library is where the global fallback lives. If a broken mount
  // wipes it, the channel has no programme *and* nothing to fall back to.
  it("plans no delete at all when the scan failed, so the global fallback row survives", async () => {
    const scan = await scanMediaFiles({ root: "/media", readdir: fakeReaddir(tree, { "/media": "ENOTCONN" }) });
    const storedAssets = [
      { sourceId: "source-local-library", id: "asset_fallback", isGlobalFallback: true },
      { sourceId: "source-local-library", id: "asset_episode", isGlobalFallback: false }
    ];

    const plan = planSourceAssetReplacement({
      sources: [{ id: "source-local-library" }],
      storedAssets,
      incomingAssets: scan.files.map((filePath) => ({ sourceId: "source-local-library", id: filePath })),
      failedSourceIds: scan.failed ? new Set(["source-local-library"]) : new Set<string>()
    });

    expect(plan.replaceableSourceIds).toEqual([]);
    expect(plan.assetsToWrite).toEqual([]);
    expect(plan.preserved).toEqual([
      { sourceId: "source-local-library", decision: "keep-ingest-failed", storedAssetCount: 2 }
    ]);
  });

  // Disk-pressure eviction protects assets by walking the stored rows; wiping them first is what
  // turned the original incident into a cascade, so the preserved rows have to stay visible.
  it("keeps the stored rows a partial scan would otherwise have pruned", async () => {
    const scan = await scanMediaFiles({ root: "/media", readdir: fakeReaddir(tree, { "/media/shows": "EACCES" }) });
    const storedAssets = [
      { sourceId: "source-local-library", id: "a" },
      { sourceId: "source-local-library", id: "b" },
      { sourceId: "source-local-library", id: "c" }
    ];

    const plan = planSourceAssetReplacement({
      sources: [{ id: "source-local-library" }],
      storedAssets,
      // A partial scan still produces a plausible-looking listing — that is what makes it dangerous.
      incomingAssets: scan.files.map((filePath) => ({ sourceId: "source-local-library", id: filePath })),
      failedSourceIds: scan.failed ? new Set(["source-local-library"]) : new Set<string>()
    });

    expect(scan.files).toHaveLength(1);
    expect(plan.replaceableSourceIds).toEqual([]);
    expect(plan.preserved[0]?.storedAssetCount).toBe(3);
  });
});
