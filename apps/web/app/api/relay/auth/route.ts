import { NextResponse } from "next/server";
import { evaluateRelayAuth, stripInvisibleCharacters } from "@stream247/core";
import { readOverlayVideoSourceIngestCredentials, readRelayInternalKey } from "@stream247/db";
import { appendAuditEvent } from "@/lib/server/state";
import { consumeRateLimit, getClientIdentifier, RELAY_AUTH_RATE_LIMIT } from "@/lib/server/rate-limit";

// The relay's credential check (M57 stage 2). mediamtx POSTs
// {user, password, ip, path, action, protocol, query} for every publish and read, and a 2xx
// answer means "allowed". The policy itself is the pure function in @stream247/core — this route
// only feeds it the stored credentials and translates the decision.
//
// Deliberately NO session gate: the caller is mediamtx, and the credential being verified IS the
// request body. But this route is NOT container-internal — `web` publishes its port and Traefik
// routes the host — so it must be treated as internet-facing and hardened accordingly:
//
//   * every refusal looks the same from outside: a bare 403, no reason, no body, whatever went
//     wrong (bad key, unknown path, malformed body, database down, rate limit). Anything more
//     specific hands an unauthenticated prober a map.
//   * the rate limit keys on the TRANSPORT PEER (X-Forwarded-For, set by our own Traefik), never
//     on `body.ip` — that field is attacker-controlled, so keying on it would make the limit both
//     trivially evadable (rotate the value) and abusable (put a real publisher's ip there to
//     exhaust its bucket).
//   * rejected publishes leave an audit line, but a THROTTLED one: without a cap, a flood of bad
//     publishes would spend the whole per-source/minute audit budget, and each write runs an
//     INSERT+DELETE against the 100-row audit cap inside the global serialized write lock — so an
//     attacker could both erase the security trail and starve legitimate state writes. Rejected
//     reads never audit at all (every port scanner would otherwise write the trail).

function denied(): Response {
  return new Response(null, { status: 403 });
}

function field(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.slice(0, maxLength) : "";
}

// --- Rejected-publish audit throttle ---------------------------------------------------------
//
// Two layers, both in-process (this is a single-web-container deployment, same as the rate
// limiter). Per source: at most one line per window, so a genuinely attacked source shows up
// once and stays readable. Global: a hard ceiling on writes per window regardless of how the
// paths are rotated, so neither the audit table nor the serialized write lock can be flooded by
// cycling through many distinct paths.
const AUDIT_WINDOW_MS = 60_000;
const AUDIT_GLOBAL_MAX_PER_WINDOW = 10;
const AUDIT_MAX_TRACKED_PATHS = 2_000;

const lastPublishAuditAtByPath = new Map<string, number>();
let auditWindowStartedAtMs = 0;
let auditWritesInWindow = 0;

function shouldAuditRejectedPublish(pathKey: string, nowMs: number): boolean {
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

export async function POST(request: Request): Promise<Response> {
  // The whole of body handling is fail-closed: a parse error, or a body that is not a JSON
  // object (literal null, a string, an array), collapses to the same empty request the policy
  // will reject — never an uncaught TypeError that would surface as a 500 and stand out from
  // every other refusal.
  let body: Record<string, unknown> = {};
  try {
    const parsed = (await request.json()) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      body = parsed as Record<string, unknown>;
    }
  } catch {
    return denied();
  }

  const relayRequest = {
    user: field(body.user, 200),
    password: field(body.password, 500),
    ip: field(body.ip, 64),
    path: field(body.path, 200),
    action: field(body.action, 32),
    protocol: field(body.protocol, 16),
    query: field(body.query, 500)
  };

  // Keyed on the real peer, not body.ip. getClientIdentifier reads X-Forwarded-For (our Traefik)
  // and falls back to X-Real-IP, then "unknown".
  const peer = getClientIdentifier(request.headers);
  const limit = consumeRateLimit(`relay-auth:${peer}`, RELAY_AUTH_RATE_LIMIT);
  if (!limit.allowed) {
    return denied();
  }

  try {
    // Both stores are read on every request, allowed or not, so the response time carries no
    // hint about which check a rejection came from; the policy evaluation itself costs one
    // constant-time comparison on every branch.
    const [sources, internalKey] = await Promise.all([
      readOverlayVideoSourceIngestCredentials(),
      readRelayInternalKey()
    ]);

    const decision = evaluateRelayAuth({ request: relayRequest, sources, internalKey });
    if (decision.allow) {
      return NextResponse.json({ ok: true });
    }

    if (relayRequest.action === "publish") {
      // The path names what was attacked; the credential never travels. The path is
      // attacker-chosen text, so it is sanitised and bounded before it may enter the audit log,
      // and the write is throttled so it cannot flood the trail or the serialized write lock.
      const pathSummary = stripInvisibleCharacters(relayRequest.path).replace(/[\r\n]+/g, " ").trim().slice(0, 80);
      if (shouldAuditRejectedPublish(pathSummary, Date.now())) {
        await appendAuditEvent(
          "relay.publish_rejected",
          `The relay refused a publish attempt on "${pathSummary || "an empty path"}".`
        );
      }
    }

    return denied();
  } catch {
    // A database blip fails closed. The relay will ask again on the next connection attempt.
    return denied();
  }
}
