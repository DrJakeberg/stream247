import { requireApiRoles, resolveSessionUser, sessionCookieFromHeader } from "@/lib/server/auth";
import { getBroadcastSnapshot, readAppState } from "@/lib/server/state";
import { createSseResponse, SSE_CLOSE } from "@/lib/server/sse";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const unauthorized = await requireApiRoles(["owner", "admin", "operator", "moderator", "viewer"]);
  if (unauthorized) {
    return unauthorized;
  }

  // The session is checked again with every snapshot (M125): an open stream ends as soon as its
  // member's access is removed, like every other request of theirs.
  const cookie = sessionCookieFromHeader(request.headers.get("cookie"));
  return createSseResponse(request, "state", async () => {
    const state = await readAppState();
    return resolveSessionUser(cookie, state) ? getBroadcastSnapshot(state) : SSE_CLOSE;
  });
}
