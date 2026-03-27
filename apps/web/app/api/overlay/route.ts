import { NextResponse } from "next/server";
import { requireApiRoles } from "@/lib/server/auth";
import { appendAuditEvent, readAppState, updateAppState } from "@/lib/server/state";

export async function GET() {
  const unauthorized = await requireApiRoles(["owner", "admin", "operator", "moderator", "viewer"]);
  if (unauthorized) {
    return unauthorized;
  }

  const state = await readAppState();
  return NextResponse.json({ overlay: state.overlay });
}

export async function PUT(request: Request) {
  const unauthorized = await requireApiRoles(["owner", "admin", "operator"]);
  if (unauthorized) {
    return unauthorized;
  }

  const payload = (await request.json()) as Partial<{
    enabled: boolean;
    channelName: string;
    headline: string;
    accentColor: string;
    showClock: boolean;
    showNextItem: boolean;
    showScheduleTeaser: boolean;
    emergencyBanner: string;
  }>;

  const now = new Date().toISOString();

  await updateAppState((state) => ({
    ...state,
    overlay: {
      ...state.overlay,
      enabled: payload.enabled ?? state.overlay.enabled,
      channelName: (payload.channelName ?? state.overlay.channelName).trim().slice(0, 80) || "Stream247",
      headline: (payload.headline ?? state.overlay.headline).trim().slice(0, 120) || "Always on air",
      accentColor: (payload.accentColor ?? state.overlay.accentColor).trim().slice(0, 20) || "#0e6d5a",
      showClock: payload.showClock ?? state.overlay.showClock,
      showNextItem: payload.showNextItem ?? state.overlay.showNextItem,
      showScheduleTeaser: payload.showScheduleTeaser ?? state.overlay.showScheduleTeaser,
      emergencyBanner: (payload.emergencyBanner ?? state.overlay.emergencyBanner).trim().slice(0, 180),
      updatedAt: now
    }
  }));

  await appendAuditEvent("overlay.updated", "Overlay settings were updated.");
  return NextResponse.json({ ok: true, message: "Overlay settings updated." });
}
