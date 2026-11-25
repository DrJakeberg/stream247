import { NextResponse } from "next/server";
import { getClientIdentifier } from "@/lib/server/rate-limit";
import {
  CHANNEL_STATUS_RATE_LIMIT,
  channelStatusRateLimiter,
  readCachedPublicChannelStatus
} from "@/lib/server/public-channel-status";

export const dynamic = "force-dynamic";

// The fields and states of this answer are a contract that only ever gains fields: see "The public
// status JSON" in docs/operations.md. The SSE stream next to it is neither cached nor limited here.
export async function GET(request: Request) {
  const nowMs = Date.now();

  // Before the cache, so cached hits count: one address cannot poll without bound either way.
  const limit = channelStatusRateLimiter.consume(
    `channel-live:${getClientIdentifier(request.headers)}`,
    CHANNEL_STATUS_RATE_LIMIT,
    nowMs
  );
  if (!limit.allowed) {
    return NextResponse.json(
      { message: "Too many requests. Try again shortly." },
      { status: 429, headers: { "retry-after": String(limit.retryAfterSeconds), "cache-control": "no-store" } }
    );
  }

  try {
    const status = await readCachedPublicChannelStatus(nowMs);
    const maxAge = Math.max(0, Math.ceil((status.expiresAt - nowMs) / 1000));
    return new NextResponse(status.body, {
      headers: { "content-type": "application/json", "cache-control": `public, max-age=${maxAge}` }
    });
  } catch (error) {
    // The message only: a database error can carry a host name or more.
    console.error("[channel-live] state read failed:", error instanceof Error ? error.message : error);
    return NextResponse.json(
      { message: "The channel status is unavailable right now." },
      { status: 503, headers: { "cache-control": "no-store" } }
    );
  }
}
