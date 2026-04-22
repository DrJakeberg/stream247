import { NextResponse } from "next/server";
import { normalizeEngagementSettings } from "@stream247/core";
import { requireApiRoles } from "@/lib/server/auth";
import {
  appendAuditEvent,
  readAppState,
  updateEngagementSettingsRecord,
  type EngagementSettingsRecord
} from "@/lib/server/state";

type EngagementSettingsRequest = {
  chatEnabled?: unknown;
  alertsEnabled?: unknown;
  donationsEnabled?: unknown;
  channelPointsEnabled?: unknown;
  gameEnabled?: unknown;
  soloModeEnabled?: unknown;
  smallGroupModeEnabled?: unknown;
  crowdModeEnabled?: unknown;
  gameWindowMinutes?: unknown;
  chatMode?: unknown;
  chatPosition?: unknown;
  alertPosition?: unknown;
  style?: unknown;
  maxMessages?: unknown;
  rateLimitPerMinute?: unknown;
};

export async function GET() {
  const unauthorized = await requireApiRoles(["owner", "admin", "operator", "moderator", "viewer"]);
  if (unauthorized) {
    return unauthorized;
  }

  const state = await readAppState();
  return NextResponse.json({
    engagement: state.engagement,
    recentEvents: state.engagementEvents
  });
}

export async function PUT(request: Request) {
  const unauthorized = await requireApiRoles(["owner", "admin"]);
  if (unauthorized) {
    return unauthorized;
  }

  const state = await readAppState();
  const body = (await request.json()) as EngagementSettingsRequest;
  const normalized = normalizeEngagementSettings({
    ...state.engagement,
    ...body
  });
  const engagement: EngagementSettingsRecord = {
    ...normalized,
    updatedAt: new Date().toISOString()
  };

  await updateEngagementSettingsRecord(engagement);
  await appendAuditEvent(
    "overlay.engagement.updated",
    `Updated engagement overlay settings: chat ${engagement.chatEnabled ? "enabled" : "disabled"}, alerts ${
      engagement.alertsEnabled ? "enabled" : "disabled"
    }, bits ${engagement.donationsEnabled ? "enabled" : "disabled"}, channel points ${
      engagement.channelPointsEnabled ? "enabled" : "disabled"
    }, game ${engagement.gameEnabled ? "enabled" : "disabled"} (${engagement.gameWindowMinutes}m window).`
  );

  return NextResponse.json({ ok: true, engagement, message: "Engagement overlay settings updated." });
}
