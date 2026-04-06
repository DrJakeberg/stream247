import { NextRequest, NextResponse } from "next/server";
import { requireApiRoles } from "@/lib/server/auth";
import {
  appendAuditEvent,
  readAppState,
  updateAssetCollectionMemberships,
  updateAssetCurationRecords
} from "@/lib/server/state";

type BulkAction =
  | "include"
  | "exclude"
  | "mark_global_fallback"
  | "clear_global_fallback"
  | "set_folder"
  | "clear_folder"
  | "append_tags"
  | "replace_tags"
  | "clear_tags"
  | "add_to_curated_set"
  | "remove_from_curated_set";

function normalizeTags(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return [...new Set(value.map((entry) => String(entry || "").trim()).filter(Boolean))].slice(0, 24);
}

export async function POST(request: NextRequest) {
  const unauthorized = await requireApiRoles(["owner", "admin", "operator"]);
  if (unauthorized) {
    return unauthorized;
  }

  const body = (await request.json()) as {
    action?: BulkAction;
    assetIds?: string[];
    folderPath?: string;
    tags?: string[];
    collectionId?: string;
  };
  const action = body.action;
  const assetIds = Array.isArray(body.assetIds) ? [...new Set(body.assetIds.map((value) => String(value).trim()).filter(Boolean))] : [];
  const folderPath = typeof body.folderPath === "string" ? body.folderPath.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "") : "";
  const tags = normalizeTags(body.tags);
  const collectionId = typeof body.collectionId === "string" ? body.collectionId.trim() : "";

  if (
    action !== "include" &&
    action !== "exclude" &&
    action !== "mark_global_fallback" &&
    action !== "clear_global_fallback" &&
    action !== "set_folder" &&
    action !== "clear_folder" &&
    action !== "append_tags" &&
    action !== "replace_tags" &&
    action !== "clear_tags" &&
    action !== "add_to_curated_set" &&
    action !== "remove_from_curated_set"
  ) {
    return NextResponse.json({ message: "A valid bulk asset action is required." }, { status: 400 });
  }

  if (assetIds.length === 0) {
    return NextResponse.json({ message: "Select at least one asset." }, { status: 400 });
  }

  const state = await readAppState();
  const selectedAssets = state.assets.filter((asset) => assetIds.includes(asset.id));
  if (selectedAssets.length !== assetIds.length) {
    return NextResponse.json({ message: "One or more selected assets no longer exist." }, { status: 404 });
  }

  if (action === "set_folder" && !folderPath) {
    return NextResponse.json({ message: "Folder path is required for this bulk action." }, { status: 400 });
  }

  if ((action === "append_tags" || action === "replace_tags") && tags.length === 0) {
    return NextResponse.json({ message: "Enter at least one tag for this bulk action." }, { status: 400 });
  }

  if ((action === "add_to_curated_set" || action === "remove_from_curated_set") && !collectionId) {
    return NextResponse.json({ message: "Choose a curated set for this bulk action." }, { status: 400 });
  }

  if (
    (action === "add_to_curated_set" || action === "remove_from_curated_set") &&
    !state.assetCollections.some((collection) => collection.id === collectionId)
  ) {
    return NextResponse.json({ message: "The selected curated set no longer exists." }, { status: 404 });
  }

  if (action === "add_to_curated_set" || action === "remove_from_curated_set") {
    await updateAssetCollectionMemberships([
      {
        collectionId,
        assetIds,
        mode: action === "add_to_curated_set" ? "append" : "remove",
        updatedAt: new Date().toISOString()
      }
    ]);
    await appendAuditEvent("asset.bulk.updated", `${action} applied to ${assetIds.length} asset(s).`);

    const collectionName = state.assetCollections.find((collection) => collection.id === collectionId)?.name || collectionId;
    return NextResponse.json({
      ok: true,
      message:
        action === "add_to_curated_set"
          ? `Added ${assetIds.length} asset(s) to ${collectionName}.`
          : `Removed ${assetIds.length} asset(s) from ${collectionName}.`
    });
  }

  const now = new Date().toISOString();
  const updates = selectedAssets.map((asset) => {
    switch (action) {
      case "include":
        return {
          id: asset.id,
          includeInProgramming: true,
          updatedAt: now
        };
      case "exclude":
        return {
          id: asset.id,
          includeInProgramming: false,
          isGlobalFallback: false,
          updatedAt: now
        };
      case "mark_global_fallback":
        return {
          id: asset.id,
          includeInProgramming: true,
          isGlobalFallback: true,
          fallbackPriority: Math.max(1, asset.fallbackPriority || 1),
          updatedAt: now
        };
      case "clear_global_fallback":
        return {
          id: asset.id,
          isGlobalFallback: false,
          updatedAt: now
        };
      case "set_folder":
        return {
          id: asset.id,
          folderPath,
          updatedAt: now
        };
      case "clear_folder":
        return {
          id: asset.id,
          folderPath: "",
          updatedAt: now
        };
      case "append_tags":
        return {
          id: asset.id,
          appendTags: tags,
          updatedAt: now
        };
      case "replace_tags":
        return {
          id: asset.id,
          tags,
          updatedAt: now
        };
      case "clear_tags":
        return {
          id: asset.id,
          tags: [],
          updatedAt: now
        };
    }
  });

  await updateAssetCurationRecords(updates);
  await appendAuditEvent("asset.bulk.updated", `${action} applied to ${assetIds.length} asset(s).`);

  return NextResponse.json({
    ok: true,
    message:
      action === "include"
        ? `Included ${assetIds.length} asset(s) in programming.`
        : action === "exclude"
          ? `Excluded ${assetIds.length} asset(s) from programming.`
          : action === "mark_global_fallback"
            ? `Marked ${assetIds.length} asset(s) as global fallback candidates.`
            : action === "clear_global_fallback"
              ? `Cleared global fallback flags on ${assetIds.length} asset(s).`
              : action === "set_folder"
                ? `Updated the folder path on ${assetIds.length} asset(s).`
                : action === "clear_folder"
                  ? `Cleared the folder path on ${assetIds.length} asset(s).`
                  : action === "append_tags"
                    ? `Added tags to ${assetIds.length} asset(s).`
                    : action === "replace_tags"
                      ? `Replaced tags on ${assetIds.length} asset(s).`
                      : `Cleared tags on ${assetIds.length} asset(s).`
  });
}
