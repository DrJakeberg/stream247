import { NextResponse } from "next/server";
import { getSystemReadiness } from "@/lib/server/readiness";

/**
 * Liveness: can this process serve requests at all?
 *
 * Deliberately 200 whenever the server is up, including with Postgres unreachable. This backs the
 * Compose healthcheck and the image smoke test, and restarting the web container does not fix a
 * dead database — it only takes away the admin UI needed to diagnose it.
 *
 * The full readiness payload is still in the body for humans and dashboards. For a machine-checkable
 * "is this deployment actually working" signal, use /api/ready, which fails closed.
 */
export async function GET() {
  const readiness = await getSystemReadiness();

  return NextResponse.json(readiness, {
    headers: { "cache-control": "no-store" }
  });
}
