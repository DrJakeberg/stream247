import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { isEngagementAlertsRuntimeEnabled } from "@stream247/core";
import { appendEngagementEventRecord, getBroadcastSnapshot, readAppState } from "@/lib/server/state";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type EventSubPayload = {
  challenge?: string;
  subscription?: {
    type?: string;
  };
  event?: {
    user_name?: string;
    user_login?: string;
    user_id?: string;
    broadcaster_user_name?: string;
    broadcaster_user_login?: string;
    tier?: string;
  };
};

function createEngagementSseResponse(request: Request) {
  const encoder = new TextEncoder();
  let snapshotInterval: NodeJS.Timeout | null = null;
  let heartbeatInterval: NodeJS.Timeout | null = null;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const push = async () => {
        try {
          const snapshot = getBroadcastSnapshot(await readAppState()).engagement;
          controller.enqueue(encoder.encode(`event: engagement\ndata: ${JSON.stringify(snapshot)}\n\n`));
        } catch (error) {
          const message = error instanceof Error ? error.message : "Unknown engagement SSE error.";
          controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ message })}\n\n`));
        }
      };

      await push();
      snapshotInterval = setInterval(() => void push(), 1000);
      heartbeatInterval = setInterval(() => controller.enqueue(encoder.encode(": keep-alive\n\n")), 15000);

      request.signal.addEventListener(
        "abort",
        () => {
          if (snapshotInterval) {
            clearInterval(snapshotInterval);
          }
          if (heartbeatInterval) {
            clearInterval(heartbeatInterval);
          }
          controller.close();
        },
        { once: true }
      );
    },
    cancel() {
      if (snapshotInterval) {
        clearInterval(snapshotInterval);
      }
      if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
      }
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive"
    }
  });
}

function verifyEventSubSignature(request: Request, rawBody: string): boolean {
  const secret = process.env.TWITCH_EVENTSUB_SECRET || "";
  if (!secret) {
    return process.env.NODE_ENV !== "production";
  }

  const messageId = request.headers.get("twitch-eventsub-message-id") || "";
  const timestamp = request.headers.get("twitch-eventsub-message-timestamp") || "";
  const signature = request.headers.get("twitch-eventsub-message-signature") || "";
  if (!messageId || !timestamp || !signature.startsWith("sha256=")) {
    return false;
  }

  const expected = `sha256=${createHmac("sha256", secret).update(`${messageId}${timestamp}${rawBody}`).digest("hex")}`;
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(signature);
  return expectedBuffer.length === actualBuffer.length && timingSafeEqual(expectedBuffer, actualBuffer);
}

function eventSubKind(subscriptionType: string | undefined): "follow" | "subscribe" | null {
  if (subscriptionType === "channel.follow") {
    return "follow";
  }
  if (subscriptionType === "channel.subscribe") {
    return "subscribe";
  }
  return null;
}

export async function GET(request: Request) {
  return createEngagementSseResponse(request);
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  if (!verifyEventSubSignature(request, rawBody)) {
    return NextResponse.json({ message: "Invalid EventSub signature." }, { status: 403 });
  }

  let payload: EventSubPayload;
  try {
    payload = JSON.parse(rawBody || "{}") as EventSubPayload;
  } catch {
    return NextResponse.json({ message: "Invalid EventSub payload." }, { status: 400 });
  }
  const messageType = request.headers.get("twitch-eventsub-message-type") || "";
  if (messageType === "webhook_callback_verification" && payload.challenge) {
    return new Response(payload.challenge, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }

  const state = await readAppState();
  if (!isEngagementAlertsRuntimeEnabled(state.engagement, process.env)) {
    return NextResponse.json({ ok: true, ignored: true, reason: "alerts-disabled" }, { status: 202 });
  }

  const kind = eventSubKind(payload.subscription?.type);
  if (!kind) {
    return NextResponse.json({ ok: true, ignored: true, reason: "unsupported-event" }, { status: 202 });
  }

  const actor = payload.event?.user_name || payload.event?.user_login || payload.event?.user_id || "Viewer";
  const message = kind === "follow" ? `${actor} followed the channel.` : `${actor} subscribed to the channel.`;
  const event = await appendEngagementEventRecord({
    id: `eventsub-${randomUUID()}`,
    kind,
    actor,
    message,
    createdAt: new Date().toISOString()
  });

  return NextResponse.json({ ok: true, event });
}
