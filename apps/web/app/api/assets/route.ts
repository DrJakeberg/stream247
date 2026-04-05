import { NextRequest, NextResponse } from "next/server";
import { requireApiRoles } from "@/lib/server/auth";
import { appendAuditEvent, readAppState, updateAssetCurationRecords } from "@/lib/server/state";

function normalizeTags(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return [...new Set(value.map((entry) => String(entry || "").trim()).filter(Boolean))].slice(0, 24);
}

export async function GET(request: NextRequest) {
  const unauthorized = await requireApiRoles(["owner", "admin", "operator", "moderator", "viewer"]);
  if (unauthorized) {
    return unauthorized;
  }

  const state = await readAppState();
  const query = request.nextUrl.searchParams.get("query")?.trim().toLowerCase() ?? "";
  const sourceId = request.nextUrl.searchParams.get("sourceId")?.trim() ?? "";
  const status = request.nextUrl.searchParams.get("status")?.trim() ?? "";
  const folder = request.nextUrl.searchParams.get("folder")?.trim().toLowerCase() ?? "";
  const tag = request.nextUrl.searchParams.get("tag")?.trim().toLowerCase() ?? "";
  const id = request.nextUrl.searchParams.get("id")?.trim() ?? "";

  const assets = state.assets.filter((asset) => {
    if (id && asset.id !== id) {
      return false;
    }

    if (sourceId && sourceId !== "all" && asset.sourceId !== sourceId) {
      return false;
    }

    if (status && status !== "all" && asset.status !== status) {
      return false;
    }

    if (folder && !asset.folderPath?.toLowerCase().includes(folder)) {
      return false;
    }

    if (tag && !(asset.tags ?? []).some((entry) => entry.toLowerCase().includes(tag))) {
      return false;
    }

    if (!query) {
      return true;
    }

    const haystack = [
      asset.title,
      asset.categoryName || "",
      asset.externalId || "",
      asset.path,
      asset.folderPath || "",
      ...(asset.tags ?? [])
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(query);
  });

  return NextResponse.json({ assets, sources: state.sources });
}

export async function PUT(request: NextRequest) {
  const unauthorized = await requireApiRoles(["owner", "admin", "operator"]);
  if (unauthorized) {
    return unauthorized;
  }

  const body = (await request.json()) as {
    id?: string;
    includeInProgramming?: boolean;
    isGlobalFallback?: boolean;
    fallbackPriority?: number;
    folderPath?: string;
    tags?: string[];
  };

  const id = (body.id ?? "").trim();
  if (!id) {
    return NextResponse.json({ message: "Asset id is required." }, { status: 400 });
  }

  const state = await readAppState();
  const asset = state.assets.find((entry) => entry.id === id);
  if (!asset) {
    return NextResponse.json({ message: "Asset not found." }, { status: 404 });
  }

  const nextInclude =
    typeof body.includeInProgramming === "boolean" ? body.includeInProgramming : asset.includeInProgramming;
  const nextGlobalFallback =
    typeof body.isGlobalFallback === "boolean" ? body.isGlobalFallback : asset.isGlobalFallback;
  const nextFallbackPriority =
    typeof body.fallbackPriority === "number" && Number.isFinite(body.fallbackPriority)
      ? Math.max(1, Math.min(9999, Math.round(body.fallbackPriority)))
      : asset.fallbackPriority;
  const nextFolderPath = typeof body.folderPath === "string" ? body.folderPath.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "") : asset.folderPath ?? "";
  const nextTags = body.tags !== undefined ? normalizeTags(body.tags) : asset.tags ?? [];

  await updateAssetCurationRecords([
    {
      includeInProgramming: nextGlobalFallback ? true : nextInclude,
      isGlobalFallback: nextGlobalFallback,
      fallbackPriority: nextFallbackPriority,
      folderPath: nextFolderPath,
      tags: nextTags,
      id,
      updatedAt: new Date().toISOString()
    }
  ]);

  await appendAuditEvent("asset.updated", `Updated asset ${id}.`);
  return NextResponse.json({ ok: true, message: "Asset updated." });
}
