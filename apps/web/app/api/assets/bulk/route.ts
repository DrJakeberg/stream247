import { NextRequest, NextResponse } from "next/server";
import { requireApiRoles } from "@/lib/server/auth";
import { appendAuditEvent, readAppState, updateAssetRecords } from "@/lib/server/state";

type BulkAction = "include" | "exclude" | "mark_global_fallback" | "clear_global_fallback";

export async function POST(request: NextRequest) {
  const unauthorized = await requireApiRoles(["owner", "admin", "operator"]);
  if (unauthorized) {
    return unauthorized;
  }

  const body = (await request.json()) as { action?: BulkAction; assetIds?: string[] };
  const action = body.action;
  const assetIds = Array.isArray(body.assetIds) ? [...new Set(body.assetIds.map((value) => String(value).trim()).filter(Boolean))] : [];

  if (
    action !== "include" &&
    action !== "exclude" &&
    action !== "mark_global_fallback" &&
    action !== "clear_global_fallback"
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

  const now = new Date().toISOString();
  const updatedAssets = selectedAssets.map((asset) => {
    switch (action) {
      case "include":
        return {
          ...asset,
          includeInProgramming: true,
          updatedAt: now
        };
      case "exclude":
        return {
          ...asset,
          includeInProgramming: false,
          isGlobalFallback: false,
          updatedAt: now
        };
      case "mark_global_fallback":
        return {
          ...asset,
          includeInProgramming: true,
          isGlobalFallback: true,
          fallbackPriority: Math.max(1, asset.fallbackPriority || 1),
          updatedAt: now
        };
      case "clear_global_fallback":
        return {
          ...asset,
          isGlobalFallback: false,
          updatedAt: now
        };
    }
  });

  await updateAssetRecords(updatedAssets);
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
            : `Cleared global fallback flags on ${assetIds.length} asset(s).`
  });
}
