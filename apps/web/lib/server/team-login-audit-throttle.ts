// Throttle for the audit rows of failed team sign-ins with Twitch (M127).
//
// /api/auth/twitch/callback is reachable without a session, and an anonymous client can fail it at
// will: /api/auth/twitch/login hands out a fresh state cookie on every visit, and a made-up code fails
// the exchange. Every failure used to write an audit row, and each write runs an INSERT plus the
// retention prune inside the global serialized write lock. Same shape as relay-audit-throttle.ts: per
// failure kind at most one row per window, so a real problem still shows up once a minute, and a hard
// ceiling for all kinds together. The kinds are a fixed set chosen by the route, never caller text,
// so the per-kind map stays a handful of entries and needs no pruning. The row that is written says how
// many of its kind were left out since the last one, so a flood still shows its size.
//
// Its own module because Next.js route modules may only export HTTP handlers.

const AUDIT_WINDOW_MS = 60_000;
const AUDIT_GLOBAL_MAX_PER_WINDOW = 10;

const lastAuditAtByReason = new Map<string, number>();
const suppressedByReason = new Map<string, number>();
let auditWindowStartedAtMs = 0;
let auditWritesInWindow = 0;

/**
 * Whether a failed team sign-in of this kind should write an audit row right now: null when it should
 * not, otherwise how many failures of this kind were left out since its last row.
 */
export function claimTeamLoginFailureAudit(reason: string, nowMs = Date.now()): number | null {
  if (nowMs - auditWindowStartedAtMs >= AUDIT_WINDOW_MS) {
    auditWindowStartedAtMs = nowMs;
    auditWritesInWindow = 0;
  }

  const last = lastAuditAtByReason.get(reason);
  if (auditWritesInWindow >= AUDIT_GLOBAL_MAX_PER_WINDOW || (last !== undefined && nowMs - last < AUDIT_WINDOW_MS)) {
    suppressedByReason.set(reason, (suppressedByReason.get(reason) ?? 0) + 1);
    return null;
  }

  lastAuditAtByReason.set(reason, nowMs);
  auditWritesInWindow += 1;
  const suppressed = suppressedByReason.get(reason) ?? 0;
  suppressedByReason.delete(reason);
  return suppressed;
}

/** Whether a failed team sign-in of this kind should write an audit row right now. */
export function shouldAuditTeamLoginFailure(reason: string, nowMs = Date.now()): boolean {
  return claimTeamLoginFailureAudit(reason, nowMs) !== null;
}

/** Test seam only. */
export function clearTeamLoginAuditThrottleForTests(): void {
  lastAuditAtByReason.clear();
  suppressedByReason.clear();
  auditWindowStartedAtMs = 0;
  auditWritesInWindow = 0;
}
