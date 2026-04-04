import { NextResponse } from "next/server";
import { requireApiRoles } from "@/lib/server/auth";
import { readAppState } from "@/lib/server/state";

export async function GET() {
  const unauthorized = await requireApiRoles(["owner", "admin", "operator", "moderator", "viewer"]);
  if (unauthorized) {
    return unauthorized;
  }

  const state = await readAppState();
  const destination = state.destinations.find((entry) => entry.id === state.playout.currentDestinationId) ?? null;
  const currentAsset = state.assets.find((entry) => entry.id === state.playout.currentAssetId) ?? null;
  const desiredAsset = state.assets.find((entry) => entry.id === state.playout.desiredAssetId) ?? null;
  const nextAsset = state.assets.find((entry) => entry.id === state.playout.nextAssetId) ?? null;
  const prefetchedAsset = state.assets.find((entry) => entry.id === state.playout.prefetchedAssetId) ?? null;
  const queuedAssets = state.playout.queuedAssetIds
    .map((id) => state.assets.find((entry) => entry.id === id))
    .filter((entry): entry is NonNullable<typeof currentAsset> => Boolean(entry));
  const queueItems = state.playout.queueItems.map((item) => ({
    ...item,
    asset: item.assetId ? state.assets.find((entry) => entry.id === item.assetId) ?? null : null
  }));
  const overrideAsset = state.assets.find((entry) => entry.id === state.playout.overrideAssetId) ?? null;

  return NextResponse.json({
    playout: state.playout,
    destination,
    currentAsset,
    desiredAsset,
    nextAsset,
    prefetchedAsset,
    queuedAssets,
    queueItems,
    overrideAsset
  });
}
