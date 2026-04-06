import { NextRequest } from "next/server";
import { requireApiRoles } from "@/lib/server/auth";
import { readAssetThumbnail, buildAssetThumbnailFallbackSvg } from "@/lib/server/asset-thumbnails";
import { readAppState } from "@/lib/server/state";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const unauthorized = await requireApiRoles(["owner", "admin", "operator", "moderator", "viewer"]);
  if (unauthorized) {
    return unauthorized;
  }

  const { id } = await params;
  const state = await readAppState();
  const asset = state.assets.find((entry) => entry.id === id);
  if (!asset) {
    return new Response("Not found", { status: 404 });
  }

  const thumbnail = await readAssetThumbnail(asset.id);
  if (thumbnail) {
    return new Response(new Uint8Array(thumbnail), {
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "private, max-age=60"
      }
    });
  }

  return new Response(buildAssetThumbnailFallbackSvg(asset), {
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": "private, max-age=60"
    }
  });
}
