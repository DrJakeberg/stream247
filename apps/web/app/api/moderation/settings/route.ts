import { NextRequest, NextResponse } from "next/server";
import { requireApiRoles } from "@/lib/server/auth";
import { appendAuditEvent, updateAppState } from "@/lib/server/state";

export async function PUT(request: NextRequest) {
  const unauthorized = await requireApiRoles(["owner", "admin", "operator"]);
  if (unauthorized) {
    return unauthorized;
  }

  const body = (await request.json()) as {
    enabled?: boolean;
    command?: string;
    defaultMinutes?: number;
    minMinutes?: number;
    maxMinutes?: number;
    requirePrefix?: boolean;
    fallbackEmoteOnly?: boolean;
  };

  const command = (body.command ?? "here").trim();
  const defaultMinutes = Number(body.defaultMinutes ?? 30);
  const minMinutes = Number(body.minMinutes ?? 5);
  const maxMinutes = Number(body.maxMinutes ?? 240);

  if (!command || minMinutes < 1 || defaultMinutes < minMinutes || maxMinutes < defaultMinutes) {
    return NextResponse.json({ message: "Moderation settings are invalid." }, { status: 400 });
  }

  await updateAppState((state) => ({
    ...state,
    moderation: {
      enabled: Boolean(body.enabled),
      command,
      defaultMinutes,
      minMinutes,
      maxMinutes,
      requirePrefix: Boolean(body.requirePrefix),
      fallbackEmoteOnly: Boolean(body.fallbackEmoteOnly)
    }
  }));

  await appendAuditEvent("moderation.updated", `Updated moderator command to ${command}.`);
  return NextResponse.json({ ok: true, message: "Moderation policy saved." });
}
