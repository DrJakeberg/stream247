import { NextResponse } from "next/server";
import { requireApiRoles } from "@/lib/server/auth";
import { appendAuditEvent, updateAppState } from "@/lib/server/state";

export async function POST() {
  const unauthorized = await requireApiRoles(["owner", "admin", "operator"]);
  if (unauthorized) {
    return unauthorized;
  }

  await updateAppState((state) => ({
    ...state,
    playout: {
      ...state.playout,
      status: "recovering",
      restartRequestedAt: new Date().toISOString(),
      heartbeatAt: new Date().toISOString(),
      message: "Manual playout restart requested from the admin API."
    }
  }));

  await appendAuditEvent("playout.restart.requested", "Manual playout restart was requested.");
  return NextResponse.json({ ok: true, message: "Playout restart requested." });
}
