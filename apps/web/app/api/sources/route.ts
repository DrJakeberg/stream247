import { NextRequest, NextResponse } from "next/server";
import { isLikelyTwitchVodUrl, isLikelyYouTubePlaylistUrl } from "@stream247/core";
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

  if (connectorKind === "youtube-playlist" && !isLikelyYouTubePlaylistUrl(externalUrl)) {
    return NextResponse.json({ message: "YouTube playlist sources require a playlist URL with a list parameter." }, { status: 400 });
  }

  if (connectorKind === "twitch-vod" && !isLikelyTwitchVodUrl(externalUrl)) {
    return NextResponse.json({ message: "Twitch VOD sources require a twitch.tv/videos/<id> URL." }, { status: 400 });
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
            : connectorKind === "youtube-playlist"
              ? "Worker will ingest playlist entries into playable assets via yt-dlp."
              : "Worker will ingest the Twitch VOD into a playable asset via yt-dlp.",
        lastSyncedAt: ""
      },
      ...state.sources
    ]
  }));

  await appendAuditEvent("source.created", `Created source ${name} (${connectorKind}).`);
  return NextResponse.json({ ok: true, message: `Source ${name} created.` });
}
