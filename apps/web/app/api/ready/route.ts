import { NextResponse } from "next/server";
import { getSystemReadiness } from "@/lib/server/readiness";

/**
 * Readiness: is this deployment actually able to do its job?
 *
 * Unlike /api/health (liveness, always 200 while the process serves), this fails closed so
 * deployment gates and monitoring get a signal they can act on. Until 1.5.19 every check in the
 * project used /api/health, which returned 200 unconditionally — so a rollout with Postgres
 * unreachable passed its gates and reported healthy.
 *
 * 503 when persistence is unreachable or the workspace was never initialised: nothing works without
 * those. A degraded broadcast is reported in the body but does not fail the check, because that is
 * an operational condition to alert on, not a reason to roll a deployment back.
 */
export async function GET() {
  const readiness = await getSystemReadiness();
  const ready = readiness.services.persistence === "ok" && readiness.initialized;

  return NextResponse.json(
    { ...readiness, ready },
    {
      status: ready ? 200 : 503,
      headers: { "cache-control": "no-store" }
    }
  );
}
