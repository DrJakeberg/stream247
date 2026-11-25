import { getPublicChannelSnapshot, readAppState } from "@/lib/server/state";
import { createRateLimiter, type RateLimitRule } from "@/lib/server/rate-limit";

// The public status JSON, GET /api/channel/live (M128).
//
// Anonymous, and polled by every open /channel tab, so every request used to read the whole state
// from the database. It now answers from one serialized body shared by everyone for a few seconds.
// The SSE stream pushes every five seconds and the page's fallback poll runs every ten, so a body up
// to five seconds old is nothing a viewer can see; the database sees at most twelve reads a minute.

export const CHANNEL_STATUS_CACHE_MS = 5_000;

// Counts every request, cached hits included: behind the cache a limit on reads alone could never
// trigger. One tab whose SSE connection keeps failing makes about 26 requests a minute (a fetch per
// stream error plus the ten-second poll), so this leaves room for a few tabs behind one address.
export const CHANNEL_STATUS_RATE_LIMIT: RateLimitRule = { limit: 120, windowMs: 60_000 };

// A store of its own: callers rotating addresses here must not evict the sign-in buckets. Over its
// bound it drops a tenth at once, so a flood of addresses does not sort the store on every request.
export const channelStatusRateLimiter = createRateLimiter(10_000, 9_000);

export type CachedPublicChannelStatus = {
  body: string;
  /** The last instant (epoch ms) at which `body` is still served. */
  expiresAt: number;
};

let cached: CachedPublicChannelStatus | null = null;
let inFlight: Promise<CachedPublicChannelStatus> | null = null;

/**
 * The public snapshot as JSON, read at most once per CHANNEL_STATUS_CACHE_MS.
 *
 * Concurrent misses share one read. A failed read is not cached: every request waiting on it gets the
 * rejection, and the next request reads again.
 */
export function readCachedPublicChannelStatus(nowMs = Date.now()): Promise<CachedPublicChannelStatus> {
  if (cached && nowMs <= cached.expiresAt) {
    return Promise.resolve(cached);
  }

  if (!inFlight) {
    // Started from a resolved promise, so a read that throws at once still rejects this promise
    // instead of throwing here and leaving a stale flight behind.
    const flight = Promise.resolve()
      .then(() => readAppState())
      .then((state) => {
        const entry = { body: JSON.stringify(getPublicChannelSnapshot(state)), expiresAt: nowMs + CHANNEL_STATUS_CACHE_MS };
        cached = entry;
        return entry;
      });
    inFlight = flight;
    const settle = () => {
      if (inFlight === flight) {
        inFlight = null;
      }
    };
    flight.then(settle, settle);
  }

  return inFlight;
}

/** Test seam only. */
export function clearPublicChannelStatusCache(): void {
  cached = null;
  inFlight = null;
  channelStatusRateLimiter.clear();
}
