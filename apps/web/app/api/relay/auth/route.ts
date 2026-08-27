import { NextResponse } from "next/server";
import { evaluateRelayAuth, stripInvisibleCharacters } from "@stream247/core";
import { readOverlayVideoSourceIngestCredentials, readRelayInternalKey } from "@stream247/db";
import { appendAuditEvent } from "@/lib/server/state";
import { consumeRateLimit, RELAY_AUTH_RATE_LIMIT } from "@/lib/server/rate-limit";

// The relay's credential check (M57 stage 2). mediamtx POSTs
// {user, password, ip, path, action, protocol, query} for every publish and read, and a 2xx
// answer means "allowed". The policy itself is the pure function in @stream247/core — this route
// only feeds it the stored credentials and translates the decision.
//
// Deliberately NO session gate: the caller is mediamtx on the container network, and the
// credential being verified IS the request body. That is also why every refusal must look the
// same from outside — a bare 403 with no body, whatever actually went wrong (bad key, unknown
// path, malformed request, database down, rate limit). Anything more specific would hand an
// unauthenticated prober a map. Rejected publishes leave an audit line instead; rejected reads
// do not (every port scanner would otherwise write the audit trail).

function denied(): Response {
  return new Response(null, { status: 403 });
}

function field(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.slice(0, maxLength) : "";
}

export async function POST(request: Request): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
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

  const limit = consumeRateLimit(`relay-auth:${relayRequest.ip || "unknown"}`, RELAY_AUTH_RATE_LIMIT);
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
      // attacker-chosen text, so it is sanitised and bounded before it may enter the audit log.
      const pathSummary = stripInvisibleCharacters(relayRequest.path).replace(/[\r\n]+/g, " ").trim().slice(0, 80);
      await appendAuditEvent(
        "relay.publish_rejected",
        `The relay refused a publish attempt on "${pathSummary || "an empty path"}".`
      );
    }

    return denied();
  } catch {
    // A database blip fails closed. The relay will ask again on the next connection attempt.
    return denied();
  }
}
