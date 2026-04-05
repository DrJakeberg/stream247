import { normalizeAudioLaneVolumePercent } from "@stream247/core";
import { NextRequest, NextResponse } from "next/server";
import { requireApiRoles } from "@/lib/server/auth";
import { appendAuditEvent, createPoolRecord, deletePoolRecord, readAppState, updatePoolRecord } from "@/lib/server/state";

function normalizeBody(body: {
  id?: string;
  name?: string;
  sourceIds?: string[];
  insertAssetId?: string;
  insertEveryItems?: number;
  audioLaneAssetId?: string;
  audioLaneVolumePercent?: number;
}) {
  return {
    id: (body.id ?? "").trim(),
    name: (body.name ?? "").trim(),
    sourceIds: Array.isArray(body.sourceIds) ? body.sourceIds.map((value) => String(value).trim()).filter(Boolean) : [],
    insertAssetId: String(body.insertAssetId ?? "").trim(),
    insertEveryItems: Math.max(0, Math.min(100, Number(body.insertEveryItems ?? 0) || 0)),
    audioLaneAssetId: String(body.audioLaneAssetId ?? "").trim(),
    audioLaneVolumePercent: normalizeAudioLaneVolumePercent(Number(body.audioLaneVolumePercent ?? 100) || 100)
  };
}

function resolveAudioLaneAsset(state: Awaited<ReturnType<typeof readAppState>>, audioLaneAssetId: string) {
  if (!audioLaneAssetId) {
    return null;
  }

  const asset = state.assets.find((entry) => entry.id === audioLaneAssetId && entry.status === "ready") ?? null;
  if (!asset) {
    return undefined;
  }

  const source = state.sources.find((entry) => entry.id === asset.sourceId) ?? null;
  if (!source || (source.connectorKind !== "local-library" && source.connectorKind !== "direct-media")) {
    return undefined;
  }

  return asset;
}

export async function GET() {
  const unauthorized = await requireApiRoles(["owner", "admin", "operator", "moderator", "viewer"]);
  if (unauthorized) {
    return unauthorized;
  }

  const state = await readAppState();
  return NextResponse.json({ pools: state.pools });
}

export async function POST(request: NextRequest) {
  const unauthorized = await requireApiRoles(["owner", "admin", "operator"]);
  if (unauthorized) {
    return unauthorized;
  }

  const payload = normalizeBody((await request.json()) as {
    name?: string;
    sourceIds?: string[];
    insertAssetId?: string;
    insertEveryItems?: number;
    audioLaneAssetId?: string;
    audioLaneVolumePercent?: number;
  });
  if (!payload.name) {
    return NextResponse.json({ message: "Pool name is required." }, { status: 400 });
  }
  if (payload.sourceIds.length === 0) {
    return NextResponse.json({ message: "Select at least one source for the pool." }, { status: 400 });
  }

  const state = await readAppState();
  const validSourceIds = new Set(state.sources.map((source) => source.id));
  const sourceIds = payload.sourceIds.filter((sourceId) => validSourceIds.has(sourceId));
  if (sourceIds.length === 0) {
    return NextResponse.json({ message: "Pool sources are no longer available." }, { status: 400 });
  }
  const validInsertAsset = payload.insertAssetId
    ? state.assets.find((asset) => asset.id === payload.insertAssetId && asset.status === "ready") ?? null
    : null;
  if (payload.insertAssetId && !validInsertAsset) {
    return NextResponse.json({ message: "The selected insert asset is no longer available." }, { status: 400 });
  }
  const validAudioLaneAsset = resolveAudioLaneAsset(state, payload.audioLaneAssetId);
  if (payload.audioLaneAssetId && !validAudioLaneAsset) {
    return NextResponse.json(
      { message: "Audio lane assets must be ready local-library or direct-media items." },
      { status: 400 }
    );
  }

  await createPoolRecord({
    id: `pool_${Math.random().toString(36).slice(2, 10)}`,
    name: payload.name,
    sourceIds,
    playbackMode: "round-robin",
    cursorAssetId: "",
    insertAssetId: validInsertAsset?.id ?? "",
    insertEveryItems: payload.insertEveryItems,
    itemsSinceInsert: 0,
    audioLaneAssetId: validAudioLaneAsset?.id ?? "",
    audioLaneVolumePercent: payload.audioLaneVolumePercent,
    updatedAt: new Date().toISOString()
  });

  await appendAuditEvent("pool.created", `Created pool ${payload.name}.`);
  return NextResponse.json({ ok: true, message: `Pool ${payload.name} created.` });
}

export async function PUT(request: NextRequest) {
  const unauthorized = await requireApiRoles(["owner", "admin", "operator"]);
  if (unauthorized) {
    return unauthorized;
  }

  const payload = normalizeBody((await request.json()) as {
    id?: string;
    name?: string;
    sourceIds?: string[];
    insertAssetId?: string;
    insertEveryItems?: number;
    audioLaneAssetId?: string;
    audioLaneVolumePercent?: number;
  });
  if (!payload.id) {
    return NextResponse.json({ message: "Pool id is required." }, { status: 400 });
  }
  if (!payload.name) {
    return NextResponse.json({ message: "Pool name is required." }, { status: 400 });
  }
  if (payload.sourceIds.length === 0) {
    return NextResponse.json({ message: "Select at least one source for the pool." }, { status: 400 });
  }

  try {
    const state = await readAppState();
    const existing = state.pools.find((pool) => pool.id === payload.id);
    if (!existing) {
      throw new Error("Pool not found.");
    }

    const validSourceIds = new Set(state.sources.map((source) => source.id));
    const sourceIds = payload.sourceIds.filter((sourceId) => validSourceIds.has(sourceId));
    if (sourceIds.length === 0) {
      throw new Error("Pool sources are no longer available.");
    }
    const validInsertAsset = payload.insertAssetId
      ? state.assets.find((asset) => asset.id === payload.insertAssetId && asset.status === "ready") ?? null
      : null;
    if (payload.insertAssetId && !validInsertAsset) {
      throw new Error("The selected insert asset is no longer available.");
    }
    const validAudioLaneAsset = resolveAudioLaneAsset(state, payload.audioLaneAssetId);
    if (payload.audioLaneAssetId && !validAudioLaneAsset) {
      throw new Error("Audio lane assets must be ready local-library or direct-media items.");
    }

    await updatePoolRecord({
      ...existing,
      name: payload.name,
      sourceIds,
      insertAssetId: validInsertAsset?.id ?? "",
      insertEveryItems: payload.insertEveryItems,
      audioLaneAssetId: validAudioLaneAsset?.id ?? "",
      audioLaneVolumePercent: payload.audioLaneVolumePercent,
      updatedAt: new Date().toISOString()
    });
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Could not update pool." },
      { status: 400 }
    );
  }

  await appendAuditEvent("pool.updated", `Updated pool ${payload.name}.`);
  return NextResponse.json({ ok: true, message: `Pool ${payload.name} updated.` });
}

export async function DELETE(request: NextRequest) {
  const unauthorized = await requireApiRoles(["owner", "admin", "operator"]);
  if (unauthorized) {
    return unauthorized;
  }

  const payload = normalizeBody((await request.json()) as { id?: string });
  if (!payload.id) {
    return NextResponse.json({ message: "Pool id is required." }, { status: 400 });
  }

  try {
    const state = await readAppState();
    const existing = state.pools.find((pool) => pool.id === payload.id);
    if (!existing) {
      throw new Error("Pool not found.");
    }

    await deletePoolRecord(payload.id);
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Could not delete pool." },
      { status: 400 }
    );
  }

  await appendAuditEvent("pool.deleted", `Deleted pool ${payload.id}.`);
  return NextResponse.json({ ok: true, message: "Pool deleted." });
}
