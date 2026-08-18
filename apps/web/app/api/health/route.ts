import { NextResponse } from "next/server";
import { getSystemReadiness } from "@/lib/server/readiness";

/**
 * Container healthcheck for the web service.
 *
 * This used to return 200 unconditionally. The Compose healthcheck is `wget -qO- /api/health`,
 * which only inspects the status code, so the web container reported healthy even with Postgres
 * down — and every deployment gate built on it was blind.
 *
 * The status code reflects only what the *web* container is responsible for: serving requests and
 * reaching its own persistence. Broadcast health (playout, uplink, destinations) stays in the body
 * and deliberately does not fail this check, because restarting the web container would not fix a
 * degraded broadcast and would take the admin UI away exactly when it is needed to diagnose it.
 */
export async function GET() {
  const readiness = await getSystemReadiness();
  const persistenceHealthy = readiness.services.persistence === "ok";

  return NextResponse.json(readiness, {
    status: persistenceHealthy ? 200 : 503,
    headers: { "cache-control": "no-store" }
  });
}
