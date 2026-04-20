import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_ENGAGEMENT_SETTINGS,
  isEngagementAlertsRuntimeEnabled,
  isEngagementChatRuntimeEnabled,
  normalizeEngagementSettings
} from "@stream247/core";
import { createChatRateLimiter, createRingBuffer, parseTwitchIrcMessage } from "../../apps/worker/src/twitch-engagement";

const { mockAppendEngagementEventRecord, mockGetBroadcastSnapshot, mockReadAppState } = vi.hoisted(() => ({
  mockAppendEngagementEventRecord: vi.fn(),
  mockGetBroadcastSnapshot: vi.fn(),
  mockReadAppState: vi.fn()
}));

vi.mock("next/server", () => ({
  NextResponse: {
    json(payload: unknown, init?: ResponseInit) {
      return new Response(JSON.stringify(payload), {
        status: init?.status ?? 200,
        headers: {
          "content-type": "application/json"
        }
      });
    }
  }
}));

vi.mock("@/lib/server/state", () => ({
  appendEngagementEventRecord: mockAppendEngagementEventRecord,
  getBroadcastSnapshot: mockGetBroadcastSnapshot,
  readAppState: mockReadAppState
}));

vi.mock("@/lib/server/sse", async () => vi.importActual("../../apps/web/lib/server/sse"));

import { GET, POST } from "../../apps/web/app/api/overlay/events/route";

const envKeys = ["NODE_ENV", "STREAM_ALERTS_ENABLED", "STREAM_CHAT_OVERLAY_ENABLED", "TWITCH_EVENTSUB_SECRET"] as const;
const originalEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));

function restoreEnv() {
  for (const key of envKeys) {
    const value = originalEnv[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

function baseEngagement(overrides: Partial<typeof DEFAULT_ENGAGEMENT_SETTINGS> = {}) {
  return {
    ...DEFAULT_ENGAGEMENT_SETTINGS,
    ...overrides,
    updatedAt: ""
  };
}

function signedEventSubRequest(body: string, secret = "eventsub-secret", headers: Record<string, string> = {}) {
  const messageId = headers["twitch-eventsub-message-id"] ?? "eventsub-message-1";
  const timestamp = headers["twitch-eventsub-message-timestamp"] ?? "2026-04-20T10:00:00.000Z";
  const signature = `sha256=${createHmac("sha256", secret).update(`${messageId}${timestamp}${body}`).digest("hex")}`;
  return new Request("http://localhost/api/overlay/events", {
    method: "POST",
    body,
    headers: {
      "content-type": "application/json",
      "twitch-eventsub-message-id": messageId,
      "twitch-eventsub-message-timestamp": timestamp,
      "twitch-eventsub-message-signature": headers["twitch-eventsub-message-signature"] ?? signature,
      "twitch-eventsub-message-type": headers["twitch-eventsub-message-type"] ?? "notification"
    }
  });
}

describe("engagement layer helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    restoreEnv();
    process.env.NODE_ENV = "test";
    process.env.STREAM_ALERTS_ENABLED = "0";
    process.env.STREAM_CHAT_OVERLAY_ENABLED = "0";
    delete process.env.TWITCH_EVENTSUB_SECRET;
    mockAppendEngagementEventRecord.mockImplementation(async (event) => ({
      id: event.id,
      kind: event.kind,
      actor: event.actor,
      message: event.message,
      createdAt: event.createdAt
    }));
  });

  afterEach(() => {
    restoreEnv();
  });

  it("keeps chat and alerts disabled unless both settings and env gates are enabled", () => {
    const settings = baseEngagement({ alertsEnabled: true, chatEnabled: true });

    expect(isEngagementChatRuntimeEnabled(settings, { STREAM_CHAT_OVERLAY_ENABLED: "0" })).toBe(false);
    expect(isEngagementChatRuntimeEnabled(settings, { STREAM_CHAT_OVERLAY_ENABLED: "1" })).toBe(true);
    expect(isEngagementAlertsRuntimeEnabled(settings, { STREAM_ALERTS_ENABLED: "0" })).toBe(false);
    expect(isEngagementAlertsRuntimeEnabled(settings, { STREAM_ALERTS_ENABLED: "1" })).toBe(true);
  });

  it("normalizes string booleans without accidentally enabling engagement", () => {
    expect(normalizeEngagementSettings({ alertsEnabled: "false", chatEnabled: "0" })).toMatchObject({
      alertsEnabled: false,
      chatEnabled: false
    });
    expect(normalizeEngagementSettings({ alertsEnabled: "true", chatEnabled: "1" })).toMatchObject({
      alertsEnabled: true,
      chatEnabled: true
    });
  });

  it("parses tagged Twitch IRC chat lines into safe overlay events", () => {
    const message = parseTwitchIrcMessage(
      "@badge-info=;badges=;display-name=Test\\sViewer;id=chat-1 :testviewer!testviewer@testviewer.tmi.twitch.tv PRIVMSG #stream247 :Hello chat"
    );

    expect(message).toEqual({
      id: "chat-1",
      actor: "Test Viewer",
      message: "Hello chat"
    });
  });

  it("keeps only the configured ring-buffer capacity", () => {
    const buffer = createRingBuffer<number>(2);
    buffer.push(1);
    buffer.push(2);
    buffer.push(3);

    expect(buffer.values()).toEqual([2, 3]);
  });

  it("rate-limits chat messages per rolling minute", () => {
    const limiter = createChatRateLimiter(2);

    expect(limiter.allow(1_000)).toBe(true);
    expect(limiter.allow(2_000)).toBe(true);
    expect(limiter.allow(3_000)).toBe(false);
    expect(limiter.allow(61_001)).toBe(true);
  });
});

describe("engagement EventSub and SSE routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    restoreEnv();
    process.env.NODE_ENV = "production";
    process.env.STREAM_ALERTS_ENABLED = "1";
    process.env.TWITCH_EVENTSUB_SECRET = "eventsub-secret";
    mockReadAppState.mockResolvedValue({
      engagement: baseEngagement({ alertsEnabled: true }),
      engagementEvents: []
    });
    mockAppendEngagementEventRecord.mockImplementation(async (event) => ({
      id: event.id,
      kind: event.kind,
      actor: event.actor,
      message: event.message,
      createdAt: event.createdAt
    }));
  });

  afterEach(() => {
    restoreEnv();
  });

  it("accepts signed follow notifications and stores alert events", async () => {
    const body = JSON.stringify({
      subscription: { type: "channel.follow" },
      event: { user_name: "New Viewer", user_login: "newviewer" }
    });

    const response = await POST(signedEventSubRequest(body));

    expect(response.status).toBe(200);
    expect(mockAppendEngagementEventRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "follow",
        actor: "New Viewer",
        message: "New Viewer followed the channel."
      })
    );
  });

  it("returns the EventSub challenge after signature verification", async () => {
    const body = JSON.stringify({ challenge: "challenge-token" });

    const response = await POST(signedEventSubRequest(body, "eventsub-secret", { "twitch-eventsub-message-type": "webhook_callback_verification" }));

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("challenge-token");
    expect(mockReadAppState).not.toHaveBeenCalled();
  });

  it("rejects invalid EventSub signatures in production", async () => {
    const body = JSON.stringify({ subscription: { type: "channel.subscribe" }, event: { user_name: "Subscriber" } });

    const response = await POST(signedEventSubRequest(body, "eventsub-secret", { "twitch-eventsub-message-signature": "sha256=invalid" }));

    expect(response.status).toBe(403);
    expect(mockAppendEngagementEventRecord).not.toHaveBeenCalled();
  });

  it("ignores alerts when runtime gates are disabled", async () => {
    mockReadAppState.mockResolvedValue({
      engagement: baseEngagement({ alertsEnabled: true }),
      engagementEvents: []
    });
    process.env.STREAM_ALERTS_ENABLED = "0";
    const body = JSON.stringify({ subscription: { type: "channel.subscribe" }, event: { user_name: "Subscriber" } });

    const response = await POST(signedEventSubRequest(body));

    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ ignored: true, reason: "alerts-disabled" });
    expect(mockAppendEngagementEventRecord).not.toHaveBeenCalled();
  });

  it("streams the current engagement snapshot over SSE", async () => {
    const engagement = {
      settings: {
        chatEnabled: true,
        alertsEnabled: true,
        chatRuntimeEnabled: true,
        alertsRuntimeEnabled: true,
        chatMode: "active",
        chatPosition: "bottom-left",
        alertPosition: "top-right",
        style: "compact",
        maxMessages: 5,
        rateLimitPerMinute: 30,
        updatedAt: ""
      },
      chatStatus: "connected",
      recentEvents: []
    };
    mockGetBroadcastSnapshot.mockReturnValue({ engagement });
    const abortController = new AbortController();

    const response = await GET(new Request("http://localhost/api/overlay/events", { signal: abortController.signal }));
    const reader = response.body?.getReader();
    const chunk = await reader?.read();
    abortController.abort();
    await reader?.cancel().catch(() => undefined);
    const text = new TextDecoder().decode(chunk?.value);

    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(text).toContain("event: engagement");
    expect(text).toContain(JSON.stringify(engagement));
  });
});
