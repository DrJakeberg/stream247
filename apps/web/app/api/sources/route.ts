import { NextRequest, NextResponse } from "next/server";
import {
  isLikelyTwitchChannelUrl,
  isLikelyTwitchVodUrl,
  isLikelyYouTubeChannelUrl,
  isLikelyYouTubePlaylistUrl
} from "@stream247/core";
import { requireApiRoles } from "@/lib/server/auth";
import { appendAuditEvent, readAppState, updateAppState } from "@/lib/server/state";

type ConnectorKind = "direct-media" | "youtube-playlist" | "youtube-channel" | "twitch-vod" | "twitch-channel";

function validateSource(connectorKind: ConnectorKind, externalUrl: string): string | null {
  if (connectorKind === "youtube-playlist" && !isLikelyYouTubePlaylistUrl(externalUrl)) {
    return "YouTube playlist sources require a playlist URL with a list parameter.";
  }

  if (connectorKind === "youtube-channel" && !isLikelyYouTubeChannelUrl(externalUrl)) {
    return "YouTube channel sources require a channel, handle, or user URL.";
  }

  if (connectorKind === "twitch-vod" && !isLikelyTwitchVodUrl(externalUrl)) {
    return "Twitch VOD sources require a twitch.tv/videos/<id> URL.";
  }

  if (connectorKind === "twitch-channel" && !isLikelyTwitchChannelUrl(externalUrl)) {
    return "Twitch channel sources require a twitch.tv/<channel> URL.";
  }

  return null;
}

const typeByConnector: Record<ConnectorKind, string> = {
  "direct-media": "Direct media URL",
  "youtube-playlist": "YouTube playlist",
  "youtube-channel": "YouTube channel",
  "twitch-vod": "Twitch VOD",
  "twitch-channel": "Twitch channel"
};

const notesByConnector: Record<ConnectorKind, string> = {
  "direct-media": "Worker will normalize supported direct media URLs into assets.",
  "youtube-playlist": "Worker will ingest playlist entries into playable assets via yt-dlp.",
  "youtube-channel": "Worker will ingest channel videos into playable assets via yt-dlp.",
  "twitch-vod": "Worker will ingest the Twitch VOD into a playable asset via yt-dlp.",
  "twitch-channel": "Worker will ingest channel archive VODs into playable assets via yt-dlp."
};

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
    connectorKind?: ConnectorKind;
    externalUrl?: string;
  };

  const name = (body.name ?? "").trim();
  const connectorKind = body.connectorKind ?? "direct-media";
  const externalUrl = (body.externalUrl ?? "").trim();

  if (!name) {
    return NextResponse.json({ message: "Source name is required." }, { status: 400 });
  }

  const validationError = validateSource(connectorKind, externalUrl);
  if (validationError) {
    return NextResponse.json({ message: validationError }, { status: 400 });
  }

  await updateAppState((state) => ({
    ...state,
    sources: [
      {
        id: `source_${Math.random().toString(36).slice(2, 10)}`,
        name,
        type: typeByConnector[connectorKind],
        connectorKind,
        enabled: true,
        status: connectorKind === "direct-media" ? "Pending validation" : "Configured",
        externalUrl,
        notes: notesByConnector[connectorKind],
        lastSyncedAt: ""
      },
      ...state.sources
    ]
  }));

  await appendAuditEvent("source.created", `Created source ${name} (${connectorKind}).`);
  return NextResponse.json({ ok: true, message: `Source ${name} created.` });
}

export async function PUT(request: NextRequest) {
  const unauthorized = await requireApiRoles(["owner", "admin", "operator"]);
  if (unauthorized) {
    return unauthorized;
  }

  const body = (await request.json()) as {
    id?: string;
    name?: string;
    connectorKind?: ConnectorKind;
    externalUrl?: string;
    enabled?: boolean;
  };

  const id = (body.id ?? "").trim();
  const name = (body.name ?? "").trim();
  const connectorKind = body.connectorKind ?? "direct-media";
  const externalUrl = (body.externalUrl ?? "").trim();

  if (!id) {
    return NextResponse.json({ message: "Source id is required." }, { status: 400 });
  }
  if (!name) {
    return NextResponse.json({ message: "Source name is required." }, { status: 400 });
  }
  const validationError = validateSource(connectorKind, externalUrl);
  if (validationError) {
    return NextResponse.json({ message: validationError }, { status: 400 });
  }

  try {
    await updateAppState((state) => {
      const existing = state.sources.find((source) => source.id === id);
      if (!existing) {
        throw new Error("Source not found.");
      }

      return {
        ...state,
        sources: state.sources.map((source) =>
          source.id === id
            ? {
                ...source,
                name,
                type: typeByConnector[connectorKind],
                connectorKind,
                enabled: body.enabled ?? source.enabled ?? true,
                externalUrl,
                notes: notesByConnector[connectorKind]
              }
            : source
        )
      };
    });
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Could not update source." },
      { status: 400 }
    );
  }

  await appendAuditEvent("source.updated", `Updated source ${name} (${connectorKind}).`);
  return NextResponse.json({ ok: true, message: `Source ${name} updated.` });
}

export async function DELETE(request: NextRequest) {
  const unauthorized = await requireApiRoles(["owner", "admin", "operator"]);
  if (unauthorized) {
    return unauthorized;
  }

  const body = (await request.json()) as { id?: string };
  const id = (body.id ?? "").trim();
  if (!id) {
    return NextResponse.json({ message: "Source id is required." }, { status: 400 });
  }

  try {
    await updateAppState((state) => {
      const existing = state.sources.find((source) => source.id === id);
      if (!existing) {
        throw new Error("Source not found.");
      }

      const referencedPools = state.pools.filter((pool) => pool.sourceIds.includes(id));
      const referencedScheduleBlocks = state.scheduleBlocks.filter(
        (block) => block.poolId && referencedPools.some((pool) => pool.id === block.poolId)
      );

      if (state.sources.length <= 1) {
        throw new Error("You cannot delete the last remaining source. Disable it instead or add another source first.");
      }

      if (referencedPools.length > 0 || referencedScheduleBlocks.length > 0) {
        throw new Error(
          `Source is still referenced by ${referencedPools.length} pool(s) and ${referencedScheduleBlocks.length} schedule block(s). Remove those references before deleting the source.`
        );
      }

      return {
        ...state,
        sources: state.sources.filter((source) => source.id !== id),
        assets: state.assets.filter((asset) => asset.sourceId !== id),
        pools: state.pools,
        scheduleBlocks: state.scheduleBlocks
      };
    });
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Could not delete source." },
      { status: 400 }
    );
  }

  await appendAuditEvent("source.deleted", `Deleted source ${id}.`);
  return NextResponse.json({ ok: true, message: "Source deleted." });
}
