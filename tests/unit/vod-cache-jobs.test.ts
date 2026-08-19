import { describe, expect, it, vi } from "vitest";
import { VodCacheJobRunner } from "../../apps/worker/src/vod-cache-jobs.js";
import type { TwitchVodCacheConfig, TwitchVodCacheResult } from "../../apps/worker/src/twitch-vod-cache.js";

function createConfig(overrides: Partial<TwitchVodCacheConfig> = {}): TwitchVodCacheConfig {
  return {
    enabled: true,
    allowRemoteFallback: false,
    mediaRoot: "/app/data/media",
    cacheRoot: "/app/data/media/.stream247-cache/twitch",
    ytDlpBinary: "yt-dlp",
    ffprobeBinary: "ffprobe",
    downloadTimeoutMs: 150_000,
    backgroundDownloadTimeoutMs: 7_200_000,
    downloadTimeoutClamped: true,
    retentionMs: 72 * 60 * 60 * 1000,
    partialMaxAgeMs: 6 * 60 * 60 * 1000,
    maxCacheBytes: 20 * 1024 ** 3,
    minFreeBytes: 15 * 1024 ** 3,
    failureCooldownMs: 30 * 60 * 1000,
    ...overrides
  };
}

function createAsset(id: string) {
  return { id, path: `https://www.twitch.tv/videos/${id}` } as never;
}

function ready(): TwitchVodCacheResult {
  return { status: "ready", cachePath: "/cache/a.mp4", cacheUpdatedAt: new Date().toISOString(), cacheError: "" };
}

function failed(error: string): TwitchVodCacheResult {
  return { status: "failed", cachePath: "/cache/a.mp4", cacheUpdatedAt: new Date().toISOString(), cacheError: error };
}

describe("VodCacheJobRunner", () => {
  it("returns immediately and never blocks the caller on the download", async () => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const ensureCache = vi.fn(async () => {
      await gate;
      return ready();
    });
    const runner = new VodCacheJobRunner({ ensureCache, onResult: async () => {} });

    const accepted = runner.request(createAsset("v1"), createConfig());

    expect(accepted).toBe(true);
    expect(runner.isPending("v1")).toBe(true);
    release();
    await vi.waitFor(() => expect(runner.isPending("v1")).toBe(false));
    expect(runner.getSnapshot("v1")?.state).toBe("ready");
  });

  it("is single-flight per asset", async () => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const ensureCache = vi.fn(async () => {
      await gate;
      return ready();
    });
    const runner = new VodCacheJobRunner({ ensureCache, onResult: async () => {} });
    const config = createConfig();

    expect(runner.request(createAsset("v1"), config)).toBe(true);
    expect(runner.request(createAsset("v1"), config)).toBe(false);
    expect(runner.request(createAsset("v1"), config)).toBe(false);

    release();
    await vi.waitFor(() => expect(runner.isPending("v1")).toBe(false));
    expect(ensureCache).toHaveBeenCalledTimes(1);
  });

  it("downloads one asset at a time", async () => {
    let concurrent = 0;
    let peak = 0;
    const ensureCache = vi.fn(async () => {
      concurrent += 1;
      peak = Math.max(peak, concurrent);
      await new Promise((resolve) => setTimeout(resolve, 5));
      concurrent -= 1;
      return ready();
    });
    const runner = new VodCacheJobRunner({ ensureCache, onResult: async () => {} });
    const config = createConfig();

    for (const id of ["v1", "v2", "v3", "v4"]) {
      runner.request(createAsset(id), config);
    }

    await vi.waitFor(() => expect(ensureCache).toHaveBeenCalledTimes(4));
    expect(peak).toBe(1);
  });

  it("runs the download in background mode so the full configured timeout applies", async () => {
    const ensureCache = vi.fn(async () => ready());
    const runner = new VodCacheJobRunner({ ensureCache, onResult: async () => {} });

    runner.request(createAsset("v1"), createConfig());

    await vi.waitFor(() => expect(ensureCache).toHaveBeenCalledTimes(1));
    expect(ensureCache.mock.calls[0]?.[3]).toEqual({ mode: "background" });
  });

  it("holds a failed asset for the cooldown before retrying", async () => {
    let nowMs = 1_000_000;
    const ensureCache = vi.fn(async () => failed("VOD unavailable"));
    const runner = new VodCacheJobRunner({
      ensureCache,
      onResult: async () => {},
      now: () => nowMs
    });
    const config = createConfig({ failureCooldownMs: 60_000 });

    runner.request(createAsset("v1"), config);
    await vi.waitFor(() => expect(runner.getSnapshot("v1")?.state).toBe("failed"));

    nowMs += 30_000;
    expect(runner.request(createAsset("v1"), config)).toBe(false);

    nowMs += 31_000;
    expect(runner.request(createAsset("v1"), config)).toBe(true);
  });

  it("keeps draining after a job throws", async () => {
    const ensureCache = vi
      .fn<() => Promise<TwitchVodCacheResult>>()
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValue(ready());
    const runner = new VodCacheJobRunner({ ensureCache, onResult: async () => {} });
    const config = createConfig();

    runner.request(createAsset("v1"), config);
    runner.request(createAsset("v2"), config);

    await vi.waitFor(() => expect(runner.getSnapshot("v2")?.state).toBe("ready"));
    expect(runner.getSnapshot("v1")?.state).toBe("failed");
    expect(runner.getSnapshot("v1")?.error).toBe("network down");
  });

  it("survives a persistence failure without losing the job outcome", async () => {
    const ensureCache = vi.fn(async () => ready());
    const events: string[] = [];
    const runner = new VodCacheJobRunner({
      ensureCache,
      onResult: async () => {
        throw new Error("db offline");
      },
      onEvent: (event) => events.push(event)
    });

    runner.request(createAsset("v1"), createConfig());

    await vi.waitFor(() => expect(events).toContain("vod.cache.job.persist_failed"));
    expect(runner.getSnapshot("v1")?.state).toBe("ready");
  });

  it("declines work when the cache is disabled", () => {
    const ensureCache = vi.fn(async () => ready());
    const runner = new VodCacheJobRunner({ ensureCache, onResult: async () => {} });

    expect(runner.request(createAsset("v1"), createConfig({ enabled: false }))).toBe(false);
    expect(ensureCache).not.toHaveBeenCalled();
  });
});

describe("what the runner still owes", () => {
  // The cache eviction keeps whatever this reports. A download that lands for an asset the playout
  // has already moved past would otherwise be deleted the moment it appears, wasting every byte
  // spent on it and leaving the asset to be requested again later.
  it("reports queued and running assets, without duplicates", () => {
    const runner = new VodCacheJobRunner({
      ensureCache: () => new Promise(() => undefined),
      onResult: async () => undefined
    });
    const config = createConfig();

    runner.request(createAsset("a"), config);
    runner.request(createAsset("b"), config);
    runner.request(createAsset("a"), config);

    const pending = runner.getPendingAssetIds();
    expect(pending).toHaveLength(new Set(pending).size);
    expect(pending).toEqual(expect.arrayContaining(["a", "b"]));
  });

  it("reports nothing when idle", () => {
    const runner = new VodCacheJobRunner({
      ensureCache: async () => ({ status: "ready" as const, cachePath: "/c/a.mp4", cacheUpdatedAt: "", cacheError: "" as const }),
      onResult: async () => undefined
    });

    expect(runner.getPendingAssetIds()).toEqual([]);
  });
});
