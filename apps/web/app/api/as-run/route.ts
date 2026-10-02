import { NextResponse } from "next/server";
import { resolveAsRunWindow } from "@stream247/core";
import { requireApiRoles } from "@/lib/server/auth";
import { listAsRunRecords } from "@/lib/server/state";

export const dynamic = "force-dynamic";

// The as-run log (M76), read-only: what was on air between `from` and `to` (ISO timestamps, default the
// last 24 hours), newest first, at most `limit` runs (default 200, capped at 1000). `from = to` answers
// "what was on air at that moment". The same roles that may see the live status.
export async function GET(request: Request) {
  const unauthorized = await requireApiRoles(["owner", "admin", "operator", "moderator", "viewer"]);
  if (unauthorized) {
    return unauthorized;
  }

  const url = new URL(request.url);
  const resolved = resolveAsRunWindow({
    from: url.searchParams.get("from"),
    to: url.searchParams.get("to"),
    limit: url.searchParams.get("limit"),
    nowMs: Date.now()
  });
  if (!resolved.ok) {
    return NextResponse.json({ message: resolved.message }, { status: 400 });
  }

  const records = await listAsRunRecords(resolved.window);
  return NextResponse.json({
    from: resolved.window.fromIso,
    to: resolved.window.toIso,
    limit: resolved.window.limit,
    // A full page may have more behind it: narrow the window rather than raise the cap.
    truncated: records.length >= resolved.window.limit,
    records
  });
}
