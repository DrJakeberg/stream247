import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { AssetRecord } from "@stream247/db";
import {
  buildTwitchVodCachePath,
  ensureTwitchVodCache,
  getTwitchVodCacheConfig,
  isInternalMediaCachePath,
  isTwitchVodCacheCoolingDown,
  isTwitchVodAsset
} from "../../apps/worker/src/twitch-vod-cache";

function createTwitchAsset(overrides: Partial<AssetRecord> = {}): AssetRecord {
  return {
    id: "asset_twitch_123",
    sourceId: "source-twitch",
    title: "Twitch archive",
    path: "https://www.twitch.tv/videos/123456789",
    status: "ready",
    includeInProgramming: true,
    externalId: "123456789",
    fallbackPriority: 100,
    isGlobalFallback: false,
    createdAt: "2026-04-19T10:00:00.000Z",
    updatedAt: "2026-04-19T10:00:00.000Z",
    ...overrides
  };
}

describe("Twitch VOD cache", () => {
  it("defaults to enabled queue cache under the media root", () => {
    const config = getTwitchVodCacheConfig({}, "/app/data/media");

    expect(config.enabled).toBe(true);
    expect(config.allowRemoteFallback).toBe(false);
    expect(config.cacheRoot).toBe("/app/data/media/.stream247-cache/twitch");
    expect(config.downloadTimeoutMs).toBe(2 * 60 * 1000);
    expect(config.failureCooldownMs).toBe(30 * 60 * 1000);
  });

  it("builds stable sanitized cache paths from source and Twitch id", () => {
    const asset = createTwitchAsset({ sourceId: "source/twitch vod", externalId: "v123456789" });

    expect(buildTwitchVodCachePath(asset, "/media/.stream247-cache/twitch")).toBe(
      "/media/.stream247-cache/twitch/source-twitch-vod/v123456789.mp4"
    );
  });

  it("detects Twitch VOD assets and internal cache paths", () => {
    expect(isTwitchVodAsset(createTwitchAsset())).toBe(true);
    expect(isTwitchVodAsset(createTwitchAsset({ path: "https://example.com/video.mp4", cachePath: "/cache/video.mp4" }))).toBe(true);
    expect(isTwitchVodAsset(createTwitchAsset({ path: "https://example.com/video.mp4", externalId: "" }))).toBe(false);

    expect(isInternalMediaCachePath("/app/data/media/.stream247-cache/twitch/source/item.mp4", "/app/data/media")).toBe(true);
    expect(isInternalMediaCachePath("/app/data/media/library/item.mp4", "/app/data/media")).toBe(false);
  });

  it("reuses an existing non-empty cache file without running download commands", async () => {
    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "stream247-cache-"));
    const asset = createTwitchAsset();
    const config = getTwitchVodCacheConfig({}, tmpRoot);
    const cachePath = buildTwitchVodCachePath(asset, config.cacheRoot);
    await fs.mkdir(path.dirname(cachePath), { recursive: true });
    await fs.writeFile(cachePath, "cached-media");
    let commandCount = 0;

    const result = await ensureTwitchVodCache(asset, config, async () => {
      commandCount += 1;
      return "";
    });

    expect(result.status).toBe("ready");
    expect(result.cachePath).toBe(cachePath);
    expect(commandCount).toBe(0);
  });

  it("downloads atomically and verifies a missing cache file", async () => {
    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "stream247-cache-"));
    const asset = createTwitchAsset();
    const config = getTwitchVodCacheConfig({}, tmpRoot);

    const result = await ensureTwitchVodCache(asset, config, async (file, args) => {
      if (file === "yt-dlp") {
        const outputPath = args[args.indexOf("--output") + 1];
        await fs.writeFile(outputPath!, "downloaded-media");
      }
      return "1.0";
    });

    expect(result.status).toBe("ready");
    await expect(fs.stat(result.cachePath)).resolves.toMatchObject({ size: "downloaded-media".length });
    await expect(fs.readdir(path.dirname(result.cachePath))).resolves.toEqual(["123456789.mp4"]);
  });

  it("treats recent failed Twitch cache assets as cooling down", () => {
    const asset = createTwitchAsset({
      cacheStatus: "failed",
      cacheUpdatedAt: "2026-04-23T10:00:00.000Z"
    });

    expect(isTwitchVodCacheCoolingDown(asset, 30 * 60 * 1000, new Date("2026-04-23T10:10:00.000Z").getTime())).toBe(true);
    expect(isTwitchVodCacheCoolingDown(asset, 30 * 60 * 1000, new Date("2026-04-23T10:40:00.000Z").getTime())).toBe(false);
  });

  it("prunes stale transient files and old cache files before a fresh download", async () => {
    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "stream247-cache-"));
    const asset = createTwitchAsset();
    const config = getTwitchVodCacheConfig(
      {
        TWITCH_VOD_CACHE_MAX_BYTES: "8",
        TWITCH_VOD_CACHE_PARTIAL_MAX_AGE_HOURS: "1"
      },
      tmpRoot
    );
    const oldDir = path.join(config.cacheRoot, "source-twitch");
    await fs.mkdir(oldDir, { recursive: true });
    const oldCachePath = path.join(oldDir, "old.mp4");
    const oldPartialPath = path.join(oldDir, "old.part-deadbeef.mp4");
    await fs.writeFile(oldCachePath, "123456789");
    await fs.writeFile(oldPartialPath, "partial");
    const oldTime = new Date("2026-04-22T00:00:00.000Z");
    await fs.utimes(oldCachePath, oldTime, oldTime);
    await fs.utimes(oldPartialPath, oldTime, oldTime);

    const result = await ensureTwitchVodCache(asset, config, async (file, args) => {
      if (file === "yt-dlp") {
        const outputPath = args[args.indexOf("--output") + 1];
        await fs.writeFile(outputPath!, "new-media");
      }
      return "1.0";
    });

    expect(result.status).toBe("ready");
    await expect(fs.readdir(oldDir)).resolves.toEqual(["123456789.mp4"]);
  });

  it("removes leftover transient files for the same Twitch VOD before retrying a download", async () => {
    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "stream247-cache-"));
    const asset = createTwitchAsset();
    const config = getTwitchVodCacheConfig({}, tmpRoot);
    const assetDir = path.join(config.cacheRoot, "source-twitch");
    const stalePartial = path.join(assetDir, "123456789.mp4.part-stale.mp4");
    const staleMarker = path.join(assetDir, "123456789.mp4.part-stale.mp4.ytdl");
    await fs.mkdir(assetDir, { recursive: true });
    await fs.writeFile(stalePartial, "stale-download");
    await fs.writeFile(staleMarker, "marker");

    const result = await ensureTwitchVodCache(asset, config, async (file, args) => {
      expect(await fs.readdir(assetDir)).not.toContain("123456789.mp4.part-stale.mp4");
      expect(await fs.readdir(assetDir)).not.toContain("123456789.mp4.part-stale.mp4.ytdl");
      if (file === "yt-dlp") {
        const outputPath = args[args.indexOf("--output") + 1];
        await fs.writeFile(outputPath!, "fresh-download");
      }
      return "1.0";
    });

    expect(result.status).toBe("ready");
    await expect(fs.readdir(assetDir)).resolves.toEqual(["123456789.mp4"]);
  });

  it("fails fast when the cache guardrail still leaves too little free space", async () => {
    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "stream247-cache-"));
    const asset = createTwitchAsset();
    const config = getTwitchVodCacheConfig(
      {
        TWITCH_VOD_CACHE_MIN_FREE_BYTES: "999999999999999"
      },
      tmpRoot
    );

    const result = await ensureTwitchVodCache(asset, config, async () => {
      throw new Error("download should not start");
    });

    expect(result.status).toBe("failed");
    expect(result.cacheError).toContain("guardrail blocked download");
  });

  it("reports download failures without leaving partial files", async () => {
    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "stream247-cache-"));
    const asset = createTwitchAsset();
    const config = getTwitchVodCacheConfig({}, tmpRoot);

    const result = await ensureTwitchVodCache(asset, config, async () => {
      throw new Error("network failed");
    });

    expect(result.status).toBe("failed");
    expect(result.cacheError).toContain("network failed");
    await expect(fs.readdir(path.dirname(result.cachePath))).resolves.toEqual([]);
  });
});
