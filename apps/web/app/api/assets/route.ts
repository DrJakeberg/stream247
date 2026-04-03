import { NextRequest, NextResponse } from "next/server";
import { requireApiRoles } from "@/lib/server/auth";
import { readAppState } from "@/lib/server/state";

export async function GET(request: NextRequest) {
  const unauthorized = await requireApiRoles(["owner", "admin", "operator", "moderator", "viewer"]);
  if (unauthorized) {
    return unauthorized;
  }

  const state = await readAppState();
  const query = request.nextUrl.searchParams.get("query")?.trim().toLowerCase() ?? "";
  const sourceId = request.nextUrl.searchParams.get("sourceId")?.trim() ?? "";
  const status = request.nextUrl.searchParams.get("status")?.trim() ?? "";
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

    if (!query) {
      return true;
    }

    const haystack = [asset.title, asset.categoryName || "", asset.externalId || "", asset.path].join(" ").toLowerCase();
    return haystack.includes(query);
  });

  return NextResponse.json({ assets, sources: state.sources });
}
