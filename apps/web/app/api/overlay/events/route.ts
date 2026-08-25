import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import {
  isEngagementAlertsRuntimeEnabled,
  isEngagementChannelPointsRuntimeEnabled,
  isEngagementDonationAlertsRuntimeEnabled,
  resolveTwitchEventSubSecret,
  type ManagedEventSubSecretInput
} from "@stream247/core";
import { appendEngagementEventRecord, getBroadcastSnapshot, readAppState } from "@/lib/server/state";
import { createSseResponse } from "@/lib/server/sse";

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
    bits?: number;
    message?: string;
    user_input?: string;
    reward?: {
      title?: string;
    };
  };
};

function verifyEventSubSignature(request: Request, rawBody: string, managedConfig: ManagedEventSubSecretInput): boolean {
  const secret = resolveTwitchEventSubSecret(managedConfig, process.env);
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

function eventSubKind(subscriptionType: string | undefined): "follow" | "subscribe" | "cheer" | "channel-point" | null {
  if (subscriptionType === "channel.follow") {
    return "follow";
  }
  if (subscriptionType === "channel.subscribe") {
    return "subscribe";
  }
  if (subscriptionType === "channel.cheer") {
    return "cheer";
  }
  if (subscriptionType === "channel.channel_points_custom_reward_redemption.add") {
    return "channel-point";
  }
  return null;
}

function buildEventSubMessage(args: {
  kind: "follow" | "subscribe" | "cheer" | "channel-point";
  actor: string;
  payload: EventSubPayload["event"];
}): string {
  if (args.kind === "follow") {
    return `${args.actor} followed the channel.`;
  }
  if (args.kind === "subscribe") {
    return `${args.actor} subscribed to the channel.`;
  }
  if (args.kind === "cheer") {
    const bits = Number.isFinite(args.payload?.bits) ? Math.max(0, Number(args.payload?.bits)) : 0;
    const base = `${args.actor} cheered ${bits} bits.`;
    const comment = (args.payload?.message || "").trim();
    return comment ? `${base} ${comment}` : base;
  }

  const rewardTitle = (args.payload?.reward?.title || "").trim() || "a channel point reward";
  const userInput = (args.payload?.user_input || "").trim();
  const base = `${args.actor} redeemed ${rewardTitle}.`;
  return userInput ? `${base} ${userInput}` : base;
}

export async function GET(request: Request) {
  return createSseResponse(request, "engagement", async () => getBroadcastSnapshot(await readAppState()).engagement, {
    snapshotIntervalMs: 1000,
    errorMessage: "Unknown engagement SSE error."
  });
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  // State is read before signature verification since M56: the shared secret itself may live in
  // managed config, with the env variable as fallback.
  const state = await readAppState();
  if (!verifyEventSubSignature(request, rawBody, state.managedConfig)) {
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

  // Only notifications describe something that happened. A revocation carries the same subscription
  // type but no event body, so falling through here turned "this subscription is dead" into a cheer
  // or follow alert on the overlay, attributed to "Viewer". Twitch also reserves the right to add
  // message types, so this accepts a known one rather than excluding the ones known today.
  if (messageType !== "notification") {
    return NextResponse.json(
      { ok: true, ignored: true, reason: messageType === "revocation" ? "subscription-revoked" : "unsupported-message-type" },
      { status: 202 }
    );
  }

  if (!isEngagementAlertsRuntimeEnabled(state.engagement, process.env, state.managedConfig)) {
    return NextResponse.json({ ok: true, ignored: true, reason: "alerts-disabled" }, { status: 202 });
  }

  const kind = eventSubKind(payload.subscription?.type);
  if (!kind) {
    return NextResponse.json({ ok: true, ignored: true, reason: "unsupported-event" }, { status: 202 });
  }
  if (kind === "cheer" && !isEngagementDonationAlertsRuntimeEnabled(state.engagement, process.env, state.managedConfig)) {
    return NextResponse.json({ ok: true, ignored: true, reason: "donations-disabled" }, { status: 202 });
  }
  if (kind === "channel-point" && !isEngagementChannelPointsRuntimeEnabled(state.engagement, process.env, state.managedConfig)) {
    return NextResponse.json({ ok: true, ignored: true, reason: "channel-points-disabled" }, { status: 202 });
  }

  const actor = payload.event?.user_name || payload.event?.user_login || payload.event?.user_id || "Viewer";
  const message = buildEventSubMessage({ kind, actor, payload: payload.event });
  const event = await appendEngagementEventRecord({
    id: `eventsub-${randomUUID()}`,
    kind,
    actor,
    message,
    createdAt: new Date().toISOString()
  });

  return NextResponse.json({ ok: true, event });
}
