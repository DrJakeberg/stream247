import { NextResponse } from "next/server";
import { clearSessionCookie, getAuthenticatedUser } from "@/lib/server/auth";
import { bumpUserSessionEpoch } from "@/lib/server/state";

/**
 * Signs out (M127): ends every session of the account on the server, on every device, by advancing its
 * session epoch, and clears the cookie here. Only a valid session can do that, so a cookie that is already
 * signed out cannot sign the account out again. The cookie is cleared whatever happens.
 */
export async function POST() {
  const user = await getAuthenticatedUser();
  let ended = true;
  if (user) {
    try {
      await bumpUserSessionEpoch(user.id);
    } catch {
      ended = false;
    }
  }

  await clearSessionCookie();
  if (!ended) {
    return NextResponse.json(
      { ok: false, message: "Signed out on this device; other sessions could not be ended, try again." },
      { status: 503 }
    );
  }
  return NextResponse.json({ ok: true });
}
