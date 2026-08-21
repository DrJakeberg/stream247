// Detached Twitch VOD cache job runner.
//
// Caching a VOD is a multi-GB download that can legitimately run for tens of minutes. Awaiting one
// inside a reconciliation cycle is a category error: the cycle has a hard stall budget measured in
// minutes, so any download longer than that budget takes the whole process down (the v1.5.17
// production restart loop). Downloads therefore run here, detached, and cycles only ever *observe*
// their outcome.
//
// Guarantees:
//  - request() returns synchronously; nothing on a cycle ever awaits a download.
//  - Single-flight per asset: repeated requests while a job is running are no-ops.
//  - One download at a time: a queue of uncached remote assets cannot saturate disk or bandwidth.
//  - Failures are recorded with a cooldown so a permanently broken VOD is not retried every cycle.

import type { AssetRecord } from "@stream247/db";
import type { TwitchVodCacheConfig, TwitchVodCacheResult } from "./twitch-vod-cache.js";

export type VodCacheJobState = "queued" | "running" | "ready" | "failed";

export type VodCacheJobSnapshot = {
  assetId: string;
  state: VodCacheJobState;
  startedAt: string;
  finishedAt: string;
  error: string;
};

type EnsureCache = (
  asset: AssetRecord,
  config: TwitchVodCacheConfig,
  execText: undefined,
  options: { mode: "background" }
) => Promise<TwitchVodCacheResult>;

export type VodCacheJobRunnerOptions = {
  ensureCache: EnsureCache;
  /** Persist the updated cache columns for an asset. Failures here must not kill the runner. */
  onResult: (asset: AssetRecord, result: TwitchVodCacheResult) => Promise<void>;
  /** Structured logging hook. */
  onEvent?: (event: string, fields: Record<string, unknown>) => void;
  now?: () => number;
};

export class VodCacheJobRunner {
  private readonly options: VodCacheJobRunnerOptions;
  private readonly jobs = new Map<string, VodCacheJobSnapshot>();
  private readonly queue: AssetRecord[] = [];
  private draining = false;

  constructor(options: VodCacheJobRunnerOptions) {
    this.options = options;
  }

  private now(): number {
    return this.options.now ? this.options.now() : Date.now();
  }

  private log(event: string, fields: Record<string, unknown>): void {
    this.options.onEvent?.(event, fields);
  }

  /**
   * Assets this runner is currently working on or still has queued.
   *
   * The cache eviction needs it: a download that completes for an asset the playout has already
   * moved past would otherwise be deleted the moment it lands, and the bandwidth spent on it wasted
   * entirely.
   */
  getPendingAssetIds(): string[] {
    // Filtered on state, not on presence in the map: finished jobs stay there as history, so reading
    // the keys raw reports every asset ever downloaded. The cache eviction keeps whatever this
    // returns, which would have pinned the entire cache forever and quietly cancelled the whole
    // point of releasing a VOD once it has been watched.
    const active = [...this.jobs.entries()]
      .filter(([, job]) => job.state === "queued" || job.state === "running")
      .map(([assetId]) => assetId);
    return [...new Set([...active, ...this.queue.map((asset) => asset.id)])];
  }

  /**
   * Ask for an asset to be cached. Returns true when a new job was accepted, false when the asset
   * is already queued/running or still inside its failure cooldown. Never throws, never blocks.
   */
  request(asset: AssetRecord, config: TwitchVodCacheConfig): boolean {
    if (!config.enabled) {
      return false;
    }

    const existing = this.jobs.get(asset.id);
    if (existing && (existing.state === "queued" || existing.state === "running")) {
      return false;
    }

    if (existing?.state === "failed" && config.failureCooldownMs > 0) {
      const finishedAtMs = Date.parse(existing.finishedAt);
      if (Number.isFinite(finishedAtMs) && this.now() - finishedAtMs < config.failureCooldownMs) {
        return false;
      }
    }

    this.jobs.set(asset.id, {
      assetId: asset.id,
      state: "queued",
      startedAt: "",
      finishedAt: "",
      error: ""
    });
    this.queue.push(asset);
    this.log("vod.cache.job.queued", { assetId: asset.id, queueDepth: this.queue.length });
    void this.drain(config);
    return true;
  }

  private async drain(config: TwitchVodCacheConfig): Promise<void> {
    if (this.draining) {
      return;
    }

    this.draining = true;
    try {
      for (;;) {
        const asset = this.queue.shift();
        if (!asset) {
          return;
        }

        await this.runJob(asset, config);
      }
    } finally {
      this.draining = false;
    }
  }

  private async runJob(asset: AssetRecord, config: TwitchVodCacheConfig): Promise<void> {
    const startedAt = new Date(this.now()).toISOString();
    this.jobs.set(asset.id, { assetId: asset.id, state: "running", startedAt, finishedAt: "", error: "" });
    this.log("vod.cache.job.start", { assetId: asset.id, timeoutMs: config.backgroundDownloadTimeoutMs });

    let result: TwitchVodCacheResult;
    try {
      result = await this.options.ensureCache(asset, config, undefined, { mode: "background" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown Twitch VOD cache job failure.";
      this.jobs.set(asset.id, {
        assetId: asset.id,
        state: "failed",
        startedAt,
        finishedAt: new Date(this.now()).toISOString(),
        error: message
      });
      this.log("vod.cache.job.failed", { assetId: asset.id, error: message });
      return;
    }

    const finishedAt = new Date(this.now()).toISOString();
    this.jobs.set(asset.id, {
      assetId: asset.id,
      state: result.status === "ready" ? "ready" : "failed",
      startedAt,
      finishedAt,
      error: result.status === "ready" ? "" : result.cacheError
    });
    this.log(result.status === "ready" ? "vod.cache.job.ready" : "vod.cache.job.failed", {
      assetId: asset.id,
      durationMs: Date.parse(finishedAt) - Date.parse(startedAt),
      error: result.status === "ready" ? "" : result.cacheError
    });

    try {
      await this.options.onResult(asset, result);
    } catch (error) {
      this.log("vod.cache.job.persist_failed", {
        assetId: asset.id,
        error: error instanceof Error ? error.message : "Unknown persistence failure."
      });
    }
  }

  isPending(assetId: string): boolean {
    const job = this.jobs.get(assetId);
    return job?.state === "queued" || job?.state === "running";
  }

  getSnapshot(assetId: string): VodCacheJobSnapshot | null {
    return this.jobs.get(assetId) ?? null;
  }

  getPendingCount(): number {
    return this.queue.length + (this.draining ? 1 : 0);
  }
}
