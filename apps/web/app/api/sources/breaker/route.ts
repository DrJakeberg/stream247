import { NextRequest, NextResponse } from "next/server";
import { requireApiRoles } from "@/lib/server/auth";
import { appendAuditEvent, closeSourceBreakerRecord, readAppState, resolveIncident } from "@/lib/server/state";

/**
 * Close a source's circuit breaker now (M75): the operator fixed the source (a yt-dlp update, a changed
 * URL) and does not want to wait for the trial probe after the cooldown, which can be up to six hours.
 * Owner and admin only: it puts a source back on air that the playout took off it.
 */
export async function POST(request: NextRequest) {
  const unauthorized = await requireApiRoles(["owner", "admin"]);
  if (unauthorized) {
    return unauthorized;
  }

  const body = (await request.json().catch(() => ({}))) as { id?: string };
  const id = (body.id ?? "").trim();
  if (!id) {
    return NextResponse.json({ message: "Source id is required." }, { status: 400 });
  }

  const state = await readAppState();
  const source = state.sources.find((entry) => entry.id === id);
  if (!source) {
    return NextResponse.json({ message: "Source not found." }, { status: 404 });
  }

  const closed = await closeSourceBreakerRecord(source.id, new Date().toISOString());
  if (!closed) {
    return NextResponse.json({ message: "This source is not held out of programming." }, { status: 409 });
  }

  // The playout would resolve it on its next cycle anyway; resolving here keeps the list honest at once.
  await resolveIncident(`playout.source-breaker.${source.id}`, "The breaker was closed by an operator; the source is back in the pool rotation.");
  await appendAuditEvent(
    "source.breaker.closed",
    `Source breaker of ${source.name} (${source.id}) closed by hand; it had been held since ${closed.openedAt}.`
  );
  return NextResponse.json({ ok: true, message: "The source is back in the pool rotation from the next cycle." });
}
