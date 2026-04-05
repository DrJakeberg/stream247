import { NextRequest, NextResponse } from "next/server";
import { requireApiRoles } from "@/lib/server/auth";
import { appendAuditEvent, readAppState, updateSourceFieldRecords } from "@/lib/server/state";

type BulkAction = "enable" | "disable" | "sync";

export async function POST(request: NextRequest) {
  const unauthorized = await requireApiRoles(["owner", "admin", "operator"]);
  if (unauthorized) {
    return unauthorized;
  }

  const body = (await request.json()) as { action?: BulkAction; sourceIds?: string[] };
  const action = body.action;
  const sourceIds = Array.isArray(body.sourceIds) ? [...new Set(body.sourceIds.map((value) => String(value).trim()).filter(Boolean))] : [];

  if (action !== "enable" && action !== "disable" && action !== "sync") {
    return NextResponse.json({ message: "A valid bulk action is required." }, { status: 400 });
  }

  if (sourceIds.length === 0) {
    return NextResponse.json({ message: "Select at least one source." }, { status: 400 });
  }

  const state = await readAppState();
  const selectedSources = state.sources.filter((source) => sourceIds.includes(source.id));
  if (selectedSources.length !== sourceIds.length) {
    return NextResponse.json({ message: "One or more selected sources no longer exist." }, { status: 404 });
  }

  if (action === "disable") {
    const enabledAfterDisable = state.sources.filter((source) => {
      if (sourceIds.includes(source.id)) {
        return false;
      }

      return source.enabled ?? true;
    });

    if (enabledAfterDisable.length === 0) {
      return NextResponse.json(
        { message: "You cannot disable every source. Leave at least one source enabled." },
        { status: 400 }
      );
    }
  }

  if (action === "sync") {
    const disabledSources = selectedSources.filter((source) => !(source.enabled ?? true));
    if (disabledSources.length > 0) {
      return NextResponse.json(
        { message: "Enable all selected sources before requesting a bulk sync." },
        { status: 400 }
      );
    }
  }

  const updates = selectedSources.map((source) => {
    if (action === "enable") {
      return {
        id: source.id,
        enabled: true
      };
    }

    if (action === "disable") {
      return {
        id: source.id,
        enabled: false
      };
    }

    return {
      id: source.id,
      status: "Sync queued",
      notes: "Bulk re-sync requested. The worker will refresh this source on the next cycle."
    };
  });

  await updateSourceFieldRecords(updates);
  await appendAuditEvent("source.bulk.updated", `${action} applied to ${sourceIds.length} source(s).`);

  return NextResponse.json({
    ok: true,
    message:
      action === "sync"
        ? `Queued ${sourceIds.length} source sync(s).`
        : `${action === "enable" ? "Enabled" : "Disabled"} ${sourceIds.length} source(s).`
  });
}
