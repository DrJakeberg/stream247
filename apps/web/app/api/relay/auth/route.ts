import { NextResponse } from "next/server";
import { evaluateRelayAuth, stripInvisibleCharacters } from "@stream247/core";
import { readOverlayVideoSourceIngestCredentials, readRelayInternalKey } from "@stream247/db";
import { appendAuditEvent } from "@/lib/server/state";
import { consumeRateLimit, getClientIdentifier, RELAY_AUTH_RATE_LIMIT } from "@/lib/server/rate-limit";
import { shouldAuditRejectedPublish } from "@/lib/server/relay-audit-throttle";

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
