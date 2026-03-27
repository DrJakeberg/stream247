import { NextRequest, NextResponse } from "next/server";
import { requireApiRoles } from "@/lib/server/auth";
import { appendAuditEvent, readAppState, updateAppState } from "@/lib/server/state";

export async function GET() {
  const unauthorized = await requireApiRoles(["owner", "admin", "operator", "moderator", "viewer"]);
  if (unauthorized) {
    return unauthorized;
  }

  const state = await readAppState();
  return NextResponse.json({ sources: state.sources });
}

export async function POST(request: NextRequest) {
  const unauthorized = await requireApiRoles(["owner", "admin", "operator"]);
  if (unauthorized) {
    return unauthorized;
  }

  const body = (await request.json()) as {
    name?: string;
    connectorKind?: "direct-media" | "youtube-playlist" | "twitch-vod";
    externalUrl?: string;
  };

  const name = (body.name ?? "").trim();
  const connectorKind = body.connectorKind ?? "direct-media";
  const externalUrl = (body.externalUrl ?? "").trim();

  if (!name) {
    return NextResponse.json({ message: "Source name is required." }, { status: 400 });
  }

  const typeByConnector = {
    "direct-media": "Direct media URL",
    "youtube-playlist": "YouTube playlist",
    "twitch-vod": "Twitch VOD"
  } as const;

  await updateAppState((state) => ({
    ...state,
    sources: [
      {
        id: `source_${Math.random().toString(36).slice(2, 10)}`,
        name,
        type: typeByConnector[connectorKind],
        connectorKind,
        status: connectorKind === "direct-media" ? "Pending validation" : "Configured",
        externalUrl,
        notes:
          connectorKind === "direct-media"
            ? "Worker will normalize supported direct media URLs into assets."
            : "Connector saved. Full ingestion for this connector type is not implemented yet.",
        lastSyncedAt: ""
      },
      ...state.sources
    ]
  }));

  await appendAuditEvent("source.created", `Created source ${name} (${connectorKind}).`);
  return NextResponse.json({ ok: true, message: `Source ${name} created.` });
}
