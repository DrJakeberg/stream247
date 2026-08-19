import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  evictUnusedTwitchVodCache,
  getTwitchVodCacheConfig,
  parseVodSizeBytes
} from "../../apps/worker/src/twitch-vod-cache.js";

// The cache policy: a VOD under the per-asset limit is downloaded, played and then dropped;
// anything above it is streamed from Twitch and never downloaded at all.
//
// The failure this replaces: with a cap smaller than the scheduled VODs, every download ran for
// hours, saturated the line, and was evicted before it finished — so the channel never got a local
// file and never stopped trying.

let dir = "";

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "stream247-policy-"));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

function configFor(env: Record<string, string> = {}) {
  return getTwitchVodCacheConfig({ ...env } as NodeJS.ProcessEnv, dir);
}

describe("VOD size probe", () => {
  it("adds the sizes of the formats yt-dlp would merge", () => {
    // A video+audio selection prints one line per format.
    expect(parseVodSizeBytes("1000\n234\n")).toBe(1234);
  });

  it("reads a single reported size", () => {
    expect(parseVodSizeBytes("21474836480")).toBe(21474836480);
  });

  it("reports an unavailable size as zero rather than guessing", () => {
    // Twitch does not always expose one, and 0 must mean "no answer" to the caller — treating it as
    // a real size would refuse to cache everything.
    expect(parseVodSizeBytes("NA")).toBe(0);
    expect(parseVodSizeBytes("")).toBe(0);
    expect(parseVodSizeBytes("NA\nNA\n")).toBe(0);
  });

  it("ignores noise around the numbers", () => {
    expect(parseVodSizeBytes("  4096  \nNA\n2048\n")).toBe(6144);
    expect(parseVodSizeBytes("-5\n0\n100")).toBe(100);
  });
});

describe("per-asset size limit", () => {
  it("defaults to 20GB", () => {
    expect(configFor().maxAssetBytes).toBe(20 * 1024 * 1024 * 1024);
  });

  it("is configurable", () => {
    expect(configFor({ TWITCH_VOD_CACHE_MAX_ASSET_BYTES: "1073741824" }).maxAssetBytes).toBe(1073741824);
  });

  it("falls back to the default for a nonsense value rather than caching nothing", () => {
    expect(configFor({ TWITCH_VOD_CACHE_MAX_ASSET_BYTES: "0" }).maxAssetBytes).toBe(20 * 1024 * 1024 * 1024);
    expect(configFor({ TWITCH_VOD_CACHE_MAX_ASSET_BYTES: "lots" }).maxAssetBytes).toBe(20 * 1024 * 1024 * 1024);
  });
});

describe("releasing cached VODs once they are no longer needed", () => {
  async function seedCache(names: string[]): Promise<string[]> {
    const config = configFor();
    await fs.mkdir(config.cacheRoot, { recursive: true });
    const paths: string[] = [];
    for (const name of names) {
      const filePath = path.join(config.cacheRoot, name);
      await fs.writeFile(filePath, "x".repeat(64));
      paths.push(filePath);
    }
    return paths;
  }

  it("keeps what is on air and what is queued next, drops the rest", async () => {
    const [onAir, next, watched] = await seedCache(["a.mp4", "b.mp4", "c.mp4"]);

    const result = await evictUnusedTwitchVodCache(configFor(), [onAir, next]);

    expect(result.removed).toEqual([watched]);
    await expect(fs.stat(onAir)).resolves.toBeTruthy();
    await expect(fs.stat(next)).resolves.toBeTruthy();
    await expect(fs.stat(watched)).rejects.toThrow();
  });

  it("reports how much it freed", async () => {
    await seedCache(["a.mp4", "b.mp4"]);

    const result = await evictUnusedTwitchVodCache(configFor(), []);

    expect(result.removed).toHaveLength(2);
    expect(result.freedBytes).toBe(128);
  });

  it("never touches a download in progress", async () => {
    // Partials belong to the prune, which can tell an abandoned one from a job still writing it.
    // Deleting one here would destroy hours of accumulated transfer.
    const config = configFor();
    await fs.mkdir(config.cacheRoot, { recursive: true });
    const partial = path.join(config.cacheRoot, "a.mp4.part-resume.mp4");
    const lock = path.join(config.cacheRoot, "a.mp4.lock");
    await fs.writeFile(partial, "downloading");
    await fs.writeFile(lock, "{}");

    await evictUnusedTwitchVodCache(config, []);

    await expect(fs.stat(partial)).resolves.toBeTruthy();
    await expect(fs.stat(lock)).resolves.toBeTruthy();
  });

  it("tolerates an empty cache directory", async () => {
    const result = await evictUnusedTwitchVodCache(configFor(), []);

    expect(result.removed).toEqual([]);
    expect(result.freedBytes).toBe(0);
  });

  it("ignores blank entries in the keep list", async () => {
    const [onAir] = await seedCache(["a.mp4"]);

    // A missing next asset yields "" — it must not be read as "keep nothing".
    const result = await evictUnusedTwitchVodCache(configFor(), [onAir, ""]);

    expect(result.removed).toEqual([]);
  });
});
