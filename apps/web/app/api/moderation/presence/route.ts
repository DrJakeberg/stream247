import { NextRequest, NextResponse } from "next/server";
import { createDefaultModerationConfig, parseModeratorCheckIn } from "@stream247/core";

export async function POST(request: NextRequest) {
  const body = (await request.json()) as { actor?: string; input?: string };
  const config = createDefaultModerationConfig();
  const window = parseModeratorCheckIn({
    actor: body.actor ?? "unknown",
    input: body.input ?? "",
    now: new Date(),
    config
  });

  if (!window) {
    return NextResponse.json(
      { ok: false, message: "Input did not match the configured moderator command." },
      { status: 400 }
    );
  }

  return NextResponse.json({
    ok: true,
    window: {
      actor: window.actor,
      minutes: window.minutes,
      expiresAt: window.expiresAt.toISOString()
    }
  });
}

