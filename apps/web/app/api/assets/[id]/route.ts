import { NextRequest, NextResponse } from "next/server";
import { stripInvisibleCharacters } from "@stream247/core";
import { requireApiRoles } from "@/lib/server/auth";
import {
  appendAuditEvent,
  readAppState,
  updateAssetMetadataRecords,
  type AssetMetadataUpdateRecord
} from "@/lib/server/state";

type AssetMetadataRequest = {
  title?: unknown;
  titlePrefix?: unknown;
  categoryName?: unknown;
  hashtags?: unknown;
  hashtagsJson?: unknown;
  platformNotes?: unknown;
};

function normalizeText(value: unknown, maxLength: number): string {
  return stripInvisibleCharacters(String(value ?? "")).trim().slice(0, maxLength);
}

function normalizeHashtagValue(value: unknown): string {
  return stripInvisibleCharacters(String(value ?? ""))
    .trim()
    .replace(/^#+/, "")
    .replace(/\s+/g, "");
}

function normalizeHashtagList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return [...new Set(value.map(normalizeHashtagValue).filter(Boolean))].slice(0, 12);
  }

  if (typeof value === "string") {
    return [...new Set(value.split(",").map(normalizeHashtagValue).filter(Boolean))].slice(0, 12);
  }

  return [];
}

function normalizeHashtagsJson(body: AssetMetadataRequest): string | undefined {
  if (body.hashtags !== undefined) {
    return JSON.stringify(normalizeHashtagList(body.hashtags));
  }

  if (body.hashtagsJson === undefined) {
    return undefined;
  }

  if (typeof body.hashtagsJson !== "string") {
    return JSON.stringify([]);
  }

  try {
    const parsed = JSON.parse(body.hashtagsJson) as unknown;
    return JSON.stringify(normalizeHashtagList(parsed));
  } catch {
    return JSON.stringify(normalizeHashtagList(body.hashtagsJson));
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const unauthorized = await requireApiRoles(["owner", "admin", "operator"]);
  if (unauthorized) {
    return unauthorized;
  }

  const { id } = await params;
  const assetId = normalizeText(id, 80);
  if (!assetId) {
    return NextResponse.json({ message: "Asset id is required." }, { status: 400 });
  }

  const body = (await request.json()) as AssetMetadataRequest;
  const state = await readAppState();
  const asset = state.assets.find((entry) => entry.id === assetId);
  if (!asset) {
    return NextResponse.json({ message: "Asset not found." }, { status: 404 });
  }

  const update: AssetMetadataUpdateRecord = {
    id: assetId,
    updatedAt: new Date().toISOString()
  };

  if (body.title !== undefined) {
    const title = normalizeText(body.title, 200);
    if (!title) {
      return NextResponse.json({ message: "Asset title cannot be empty." }, { status: 400 });
    }
    update.title = title;
  }

  if (body.titlePrefix !== undefined) {
    update.titlePrefix = normalizeText(body.titlePrefix, 20);
  }

  if (body.categoryName !== undefined) {
    update.categoryName = normalizeText(body.categoryName, 120);
  }

  const hashtagsJson = normalizeHashtagsJson(body);
  if (hashtagsJson !== undefined) {
    update.hashtagsJson = hashtagsJson;
  }

  if (body.platformNotes !== undefined) {
    update.platformNotes = normalizeText(body.platformNotes, 1000);
  }

  if (
    update.title === undefined &&
    update.titlePrefix === undefined &&
    update.categoryName === undefined &&
    update.hashtagsJson === undefined &&
    update.platformNotes === undefined
  ) {
    return NextResponse.json({ message: "No metadata changes were provided." }, { status: 400 });
  }

  await updateAssetMetadataRecords([update]);
  await appendAuditEvent("asset.metadata.updated", `Updated asset metadata for ${assetId}.`);

  return NextResponse.json({ ok: true, message: "Asset metadata updated." });
}
