import { NextRequest, NextResponse } from "next/server";
import { requireApiRoles } from "@/lib/server/auth";
import { appendAuditEvent, readAppState, upsertSourceRecord } from "@/lib/server/state";

export async function POST(request: NextRequest) {
  const unauthorized = await requireApiRoles(["owner", "admin", "operator"]);
  if (unauthorized) {
    return unauthorized;
  }

  const body = (await request.json()) as { id?: string };
  const id = (body.id ?? "").trim();
  if (!id) {
    return NextResponse.json({ message: "Source id is required." }, { status: 400 });
  }

  try {
    const state = await readAppState();
    const source = state.sources.find((entry) => entry.id === id);
    if (!source) {
      throw new Error("Source not found.");
    }

    if (!(source.enabled ?? true)) {
      throw new Error("Enable the source before requesting a manual sync.");
    }

    await upsertSourceRecord({
      ...source,
      status: "Sync queued",
      notes: "Manual re-sync requested. The worker will refresh this source on the next cycle."
    });
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Could not queue a source sync." },
      { status: 400 }
    );
  }

  await appendAuditEvent("source.sync.requested", `Manual re-sync requested for source ${id}.`);
  return NextResponse.json({ ok: true, message: "Source sync queued. The worker will pick it up on the next cycle." });
}
