import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  canReleaseVodCache,
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
  // Twitch reports no size at all: both filesize and filesize_approx come back "NA" for its HLS
  // VODs, on every yt-dlp version tried. The first version of this policy read only those fields,
  // so the size check was unreachable and the whole 20GB rule did nothing. Bitrate and duration are
  // available, and pin the size closely enough for the decision being made.

  it("derives the size from bitrate and duration when no size is reported", () => {
    // A real Twitch VOD: 6499.143 kbit/s over 48064 seconds is roughly 36GB.
    const bytes = parseVodSizeBytes("NA|6499.143|48064");

    expect(bytes / 1024 ** 3).toBeGreaterThan(35);
    expect(bytes / 1024 ** 3).toBeLessThan(38);
  });

  it("puts a real Twitch VOD on the correct side of a 20GB limit", () => {
    const twentyGb = 20 * 1024 * 1024 * 1024;

    expect(parseVodSizeBytes("NA|6499.143|48064")).toBeGreaterThan(twentyGb);
    // A two-hour stream at the same bitrate fits comfortably.
    expect(parseVodSizeBytes("NA|6499.143|7200")).toBeLessThan(twentyGb);
  });

  it("prefers a reported size over the estimate", () => {
    expect(parseVodSizeBytes("1000000000|6499.143|48064")).toBe(1000000000);
  });

  it("adds the formats yt-dlp would merge", () => {
    // One line per selected format; a video+audio selection yields two.
    expect(parseVodSizeBytes("1000|NA|NA\n234|NA|NA")).toBe(1234);
    expect(parseVodSizeBytes("NA|8|100\nNA|2|100")).toBe(125_000);
  });

  it("reports an unanswerable line as zero rather than guessing", () => {
    // 0 must mean "no answer" to the caller — reading it as a real size would refuse to cache
    // everything.
    expect(parseVodSizeBytes("NA|NA|NA")).toBe(0);
    expect(parseVodSizeBytes("")).toBe(0);
    expect(parseVodSizeBytes("NA")).toBe(0);
  });

  it("ignores partial and nonsensical values", () => {
    // A bitrate without a duration cannot produce an estimate.
    expect(parseVodSizeBytes("NA|6499|NA")).toBe(0);
    expect(parseVodSizeBytes("NA|NA|48064")).toBe(0);
    expect(parseVodSizeBytes("-5|-1|-1")).toBe(0);
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

describe("when releasing is safe at all", () => {
  // An empty keep list must never be read as "nothing is in use". The playout reports no current
  // asset while reconnecting, in standby, and on a freshly restarted process whose probe cache is
  // still cold — every one of those is a moment when it is about to need the very files it would
  // otherwise be told to delete. Evicting there turns a routine restart into a full re-download of
  // every scheduled VOD.

  it("refuses while the playout has nothing selected", () => {
    expect(canReleaseVodCache("")).toBe(false);
  });

  it("allows it once something is on air", () => {
    expect(canReleaseVodCache("asset-1")).toBe(true);
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

  it("deletes the file it is told has been watched, and only that one", async () => {
    const [onAir, ahead, watched] = await seedCache(["a.mp4", "b.mp4", "c.mp4"]);

    const result = await evictUnusedTwitchVodCache(configFor(), [watched]);

    expect(result.removed).toEqual([watched]);
    await expect(fs.stat(onAir)).resolves.toBeTruthy();
    await expect(fs.stat(ahead)).resolves.toBeTruthy();
    await expect(fs.stat(watched)).rejects.toThrow();
  });

  it("keeps a VOD fetched ahead of its slot", async () => {
    // The failure this replaces: the delete set was derived by elimination — everything not
    // currently in use — so a download that completed while the playout had moved on was removed
    // seconds after finishing. Measured in production at 19.1GB, after 52 minutes of transfer.
    const [prefetched] = await seedCache(["future.mp4"]);

    const result = await evictUnusedTwitchVodCache(configFor(), []);

    expect(result.removed).toEqual([]);
    await expect(fs.stat(prefetched)).resolves.toBeTruthy();
  });

  it("reports how much it freed", async () => {
    const paths = await seedCache(["a.mp4", "b.mp4"]);

    const result = await evictUnusedTwitchVodCache(configFor(), paths);

    expect(result.removed).toHaveLength(2);
    expect(result.freedBytes).toBe(128);
  });

  it("collects a partial nothing is working on any more", async () => {
    // The prune only runs before a download. Once every scheduled VOD is over the size limit no
    // download ever starts, so abandoned partials were collected by nothing at all — 13.8GB of them
    // on the production channel.
    const config = configFor();
    await fs.mkdir(config.cacheRoot, { recursive: true });
    const abandoned = path.join(config.cacheRoot, "old.mp4.part-resume.mp4.part");
    await fs.writeFile(abandoned, "abandoned bytes");
    const longAgo = new Date(Date.now() - config.partialMaxAgeMs - 60_000);
    await fs.utimes(abandoned, longAgo, longAgo);

    const result = await evictUnusedTwitchVodCache(config, []);

    expect(result.removed).toContain(abandoned);
  });

  it("leaves a recent partial alone even with no job holding it", async () => {
    // A download that just started has not written its lock yet on every path; age alone keeps the
    // window from turning into a race.
    const config = configFor();
    await fs.mkdir(config.cacheRoot, { recursive: true });
    const fresh = path.join(config.cacheRoot, "new.mp4.part-resume.mp4.part");
    await fs.writeFile(fresh, "just started");

    const result = await evictUnusedTwitchVodCache(config, []);

    expect(result.removed).not.toContain(fresh);
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
    // Aged past the collection threshold on purpose: the live lock is what has to protect it here,
    // not its timestamp.
    const longAgo = new Date(Date.now() - config.partialMaxAgeMs - 60_000);
    await fs.utimes(partial, longAgo, longAgo);

    await evictUnusedTwitchVodCache(config, []);

    await expect(fs.stat(partial)).resolves.toBeTruthy();
    await expect(fs.stat(lock)).resolves.toBeTruthy();
  });

  it("tolerates an empty cache directory", async () => {
    const result = await evictUnusedTwitchVodCache(configFor(), []);

    expect(result.removed).toEqual([]);
    expect(result.freedBytes).toBe(0);
  });

  it("ignores a blank entry rather than treating it as a path", async () => {
    await seedCache(["a.mp4"]);

    // No asset finished this cycle, which yields "" — it must delete nothing.
    const result = await evictUnusedTwitchVodCache(configFor(), [""]);

    expect(result.removed).toEqual([]);
  });
});
