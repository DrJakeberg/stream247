// In-process rate limiting for authentication endpoints.
//
// Password login and TOTP verification had no limit and no lockout: both were unbounded
// brute-force surfaces on an internet-facing deployment. A six-digit TOTP is only 10^6 codes, and
// with a ±1 step tolerance an unthrottled attacker gets there quickly.
//
// State is per process. Stream247 is a single-workspace, single-web-container deployment, so that
// is the whole surface; if the web tier is ever scaled out this has to move to shared storage, and
// the limiter would then be per replica rather than per deployment.

export type RateLimitRule = {
  /** Attempts permitted inside the window. */
  limit: number;
  windowMs: number;
};

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
};

type Bucket = {
  count: number;
  resetAt: number;
};

// Bounds memory: an attacker rotating the key (a different email per attempt) must not be able to
// grow this map without limit. Well past any realistic number of legitimate concurrent users.
const MAX_TRACKED_KEYS = 10_000;

// Sweeping every key on every request would put an O(n) scan on the hot path exactly when the
// endpoint is under attack. Sweeping is amortised instead: at most once per interval, or
// immediately when the map is over its bound.
const PRUNE_INTERVAL_MS = 30_000;

const buckets = new Map<string, Bucket>();
let lastPruneAt = 0;

function prune(nowMs: number): void {
  const overBound = buckets.size > MAX_TRACKED_KEYS;
  if (!overBound && nowMs - lastPruneAt < PRUNE_INTERVAL_MS) {
    return;
  }

  lastPruneAt = nowMs;

  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= nowMs) {
      buckets.delete(key);
    }
  }

  if (buckets.size <= MAX_TRACKED_KEYS) {
    return;
  }

  // Still oversized after dropping expired entries: evict oldest-expiring first. Under this much
  // pressure the deployment is being attacked, and dropping tracking for the least recently
  // relevant key is preferable to unbounded growth.
  const ordered = [...buckets.entries()].sort((a, b) => a[1].resetAt - b[1].resetAt);
  for (const [key] of ordered.slice(0, buckets.size - MAX_TRACKED_KEYS)) {
    buckets.delete(key);
  }
}

/**
 * Records one attempt against `key` and reports whether it is allowed.
 *
 * A rejected attempt does not extend the window: the limit is on attempts per window, not a
 * penalty that a determined attacker could keep resetting.
 */
export function consumeRateLimit(key: string, rule: RateLimitRule, nowMs = Date.now()): RateLimitResult {
  prune(nowMs);

  const existing = buckets.get(key);
  const bucket = existing && existing.resetAt > nowMs ? existing : { count: 0, resetAt: nowMs + rule.windowMs };

  bucket.count += 1;
  buckets.set(key, bucket);

  const allowed = bucket.count <= rule.limit;
  return {
    allowed,
    remaining: Math.max(0, rule.limit - bucket.count),
    retryAfterSeconds: allowed ? 0 : Math.max(1, Math.ceil((bucket.resetAt - nowMs) / 1000))
  };
}

/** Clears a key after a genuine success, so one bad day does not lock a legitimate user out. */
export function resetRateLimit(key: string): void {
  buckets.delete(key);
}

/** Test seam only. */
export function clearAllRateLimits(): void {
  buckets.clear();
  lastPruneAt = 0;
}

/**
 * Derives a client identifier from proxy headers.
 *
 * These headers are attacker-controlled unless a trusted proxy sets them, so the value is only
 * ever used to *narrow* a limit, never to widen or bypass one: every limited endpoint also keys on
 * something the attacker cannot rotate freely, such as the account being targeted.
 */
export function getClientIdentifier(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for") ?? "";
  const first = forwarded.split(",")[0]?.trim() ?? "";
  return first || headers.get("x-real-ip")?.trim() || "unknown";
}

export const LOGIN_RATE_LIMIT: RateLimitRule = { limit: 10, windowMs: 15 * 60_000 };
export const TWO_FACTOR_RATE_LIMIT: RateLimitRule = { limit: 8, windowMs: 15 * 60_000 };
// Keyed on the address mediamtx reports for the connecting client. Generous enough for a flaky
// publisher reconnecting in a loop (the relay asks once per connection, not per frame), far too
// tight for guessing a generated key — and it bounds the audit noise a scanner can produce.
export const RELAY_AUTH_RATE_LIMIT: RateLimitRule = { limit: 60, windowMs: 60_000 };
