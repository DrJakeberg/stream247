import { NextResponse } from "next/server";
import { requireApiRoles } from "@/lib/server/auth";
import { appendAuditEvent, readAppState, updateTwitchBroadcasterConnectionRecord } from "@/lib/server/state";

/**
 * Clears the broadcaster slot. Tokens are wiped rather than kept around disabled: a disconnect is
 * the operator saying this token must not be used, and the sync gate flips back to its visible
 * waiting state on the next worker cycle — the same state as before the account was connected.
 */
export async function POST() {
  const unauthorized = await requireApiRoles(["owner", "admin"]);
  if (unauthorized) {
    return unauthorized;
  }

  const state = await readAppState();
  const previousLogin = state.twitchBroadcaster.broadcasterLogin;

  await updateTwitchBroadcasterConnectionRecord({
    status: "not-connected",
    broadcasterId: "",
    broadcasterLogin: "",
    accessToken: "",
    refreshToken: "",
    connectedAt: "",
    tokenExpiresAt: "",
    lastRefreshAt: "",
    error: ""
  });

  await appendAuditEvent(
    "twitch.broadcaster.disconnected",
    previousLogin ? `Disconnected broadcast channel account ${previousLogin}.` : "Cleared the broadcaster connection slot."
  );

  return NextResponse.json({ ok: true });
}
