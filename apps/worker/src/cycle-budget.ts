// Single source of truth for the reconciliation-cycle stall budget.
//
// runLoop wraps every cycle in runWithStallGuard(LOOP_STALL_TIMEOUT_MS). A cycle that neither
// resolves nor rejects inside that window is treated as a hung loop and the process exits.
//
// Several cycle steps await external work (yt-dlp resolves, Twitch VOD cache prep, ffprobe).
// Each carries its own timeout, and until v1.5.18 nothing forced those timeouts to stay below
// the stall budget. A production .env with TWITCH_VOD_CACHE_DOWNLOAD_TIMEOUT_SECONDS=7200 made a
// single awaited cache download outlive the 300s guard by 24x, so the guard fired on every cycle
// that touched an uncached Twitch VOD and the playout container restarted every ~5 minutes
// forever (observed: 423 restarts, the channel pinned to fallback content).
//
// The invariant this module enforces: any single operation awaited on a cycle must be bounded
// well below the stall budget, so a slow-but-progressing operation can time out, be reported, and
// let the cycle finish normally instead of taking the whole process down with it.

export const DEFAULT_LOOP_STALL_TIMEOUT_MS = 300_000;
const MIN_LOOP_STALL_TIMEOUT_SECONDS = 60;

// An awaited operation gets at most this share of the stall budget. The remainder covers the
// rest of the cycle (state reads, process start, DB writes) plus the incident/report path that
// runs after the operation times out.
export const CYCLE_AWAIT_BUDGET_FRACTION = 0.5;

// Never clamp below this: a ceiling so tight that no real remote resolve could ever finish would
// trade a restart loop for a permanent "everything times out" loop.
const MIN_CYCLE_AWAIT_CEILING_MS = 15_000;

export function getLoopStallTimeoutMs(env: NodeJS.ProcessEnv): number {
  const raw = env.STREAM247_LOOP_STALL_TIMEOUT_SECONDS;
  if (raw === undefined || raw === "") {
    return DEFAULT_LOOP_STALL_TIMEOUT_MS;
  }

  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= MIN_LOOP_STALL_TIMEOUT_SECONDS
    ? parsed * 1000
    : DEFAULT_LOOP_STALL_TIMEOUT_MS;
}

/**
 * Hard ceiling for any single operation awaited inside a reconciliation cycle.
 */
export function getCycleAwaitCeilingMs(env: NodeJS.ProcessEnv): number {
  const ceiling = Math.floor(getLoopStallTimeoutMs(env) * CYCLE_AWAIT_BUDGET_FRACTION);
  return Math.max(MIN_CYCLE_AWAIT_CEILING_MS, ceiling);
}

export type ClampedTimeout = {
  /** Timeout to actually pass to the awaited operation. */
  effectiveMs: number;
  /** Timeout the operator configured. */
  requestedMs: number;
  /** True when the configured timeout was unsafe and had to be reduced. */
  clamped: boolean;
  ceilingMs: number;
};

/**
 * Clamp a configured timeout down to the cycle-await ceiling.
 *
 * Callers that run *off* the cycle (detached background jobs) must not use this — they are free
 * to honour the full configured timeout because nothing is waiting on them.
 */
export function clampToCycleAwaitCeiling(requestedMs: number, env: NodeJS.ProcessEnv): ClampedTimeout {
  const ceilingMs = getCycleAwaitCeilingMs(env);
  const requested = Number.isFinite(requestedMs) && requestedMs > 0 ? Math.floor(requestedMs) : ceilingMs;
  return {
    effectiveMs: Math.min(requested, ceilingMs),
    requestedMs: requested,
    clamped: requested > ceilingMs,
    ceilingMs
  };
}
