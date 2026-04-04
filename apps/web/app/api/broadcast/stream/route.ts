import { requireApiRoles } from "@/lib/server/auth";
import { getBroadcastSnapshot, readAppState } from "@/lib/server/state";
import { createSseResponse } from "@/lib/server/sse";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const unauthorized = await requireApiRoles(["owner", "admin", "operator", "moderator", "viewer"]);
  if (unauthorized) {
    return unauthorized;
  }

  return createSseResponse(request, "state", async () => getBroadcastSnapshot(await readAppState()));
}
