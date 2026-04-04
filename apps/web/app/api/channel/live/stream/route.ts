import { getPublicChannelSnapshot, readAppState } from "@/lib/server/state";
import { createSseResponse } from "@/lib/server/sse";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  return createSseResponse(request, "state", async () => getPublicChannelSnapshot(await readAppState()));
}
