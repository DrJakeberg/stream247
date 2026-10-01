// Throttle for the relay auth endpoint's rejected-publish audit writes.
//
// /api/relay/auth is internet-facing, and without a cap a flood of bad publishes would spend the
// whole per-source/minute audit budget: each write runs an INSERT+DELETE against the 100-row
// audit cap inside the global serialized write lock, so an attacker could both erase the security
// trail and starve legitimate state writes. Two in-process layers (single web container, same as
// the rate limiter). Per source: at most one line per window, so a genuinely attacked source
// shows up once and stays readable. Global: a hard ceiling per window regardless of how the paths
// are rotated, so cycling through many distinct paths cannot flood either the table or the lock.
//
// Lives in its own module rather than in the route file because Next.js route modules may only
// export HTTP handlers — the test seam below would otherwise be rejected at build time.

const AUDIT_WINDOW_MS = 60_000;
const AUDIT_GLOBAL_MAX_PER_WINDOW = 10;
const AUDIT_MAX_TRACKED_PATHS = 2_000;

const lastPublishAuditAtByPath = new Map<string, number>();
let auditWindowStartedAtMs = 0;
let auditWritesInWindow = 0;

/** Whether a rejected publish on `pathKey` should write an audit line right now. */
export function shouldAuditRejectedPublish(pathKey: string, nowMs = Date.now()): boolean {
  // Roll the global window.
  if (nowMs - auditWindowStartedAtMs >= AUDIT_WINDOW_MS) {
    auditWindowStartedAtMs = nowMs;
    auditWritesInWindow = 0;
  }
  if (auditWritesInWindow >= AUDIT_GLOBAL_MAX_PER_WINDOW) {
    return false;
  }

  // Bound the per-path map: under path rotation it would otherwise grow unbounded. Dropping
  // expired entries first, then oldest, mirrors the rate limiter's prune.
  if (lastPublishAuditAtByPath.size > AUDIT_MAX_TRACKED_PATHS) {
    for (const [key, at] of lastPublishAuditAtByPath) {
      if (nowMs - at >= AUDIT_WINDOW_MS) {
        lastPublishAuditAtByPath.delete(key);
      }
    }
    if (lastPublishAuditAtByPath.size > AUDIT_MAX_TRACKED_PATHS) {
      const ordered = [...lastPublishAuditAtByPath.entries()].sort((a, b) => a[1] - b[1]);
      for (const [key] of ordered.slice(0, lastPublishAuditAtByPath.size - AUDIT_MAX_TRACKED_PATHS)) {
        lastPublishAuditAtByPath.delete(key);
      }
    }
  }

  const last = lastPublishAuditAtByPath.get(pathKey);
  if (last !== undefined && nowMs - last < AUDIT_WINDOW_MS) {
    return false;
  }

  lastPublishAuditAtByPath.set(pathKey, nowMs);
  auditWritesInWindow += 1;
  return true;
}

/** Test seam only. */
export function clearRelayAuditThrottleForTests(): void {
  lastPublishAuditAtByPath.clear();
  auditWindowStartedAtMs = 0;
  auditWritesInWindow = 0;
}
