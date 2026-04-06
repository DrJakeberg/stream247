import { NextRequest, NextResponse } from "next/server";
import { requireApiRoles } from "@/lib/server/auth";
import { appendAuditEvent, deleteAssetCollectionRecord, readAppState } from "@/lib/server/state";

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const unauthorized = await requireApiRoles(["owner", "admin", "operator"]);
  if (unauthorized) {
    return unauthorized;
  }

  const { id } = await params;
  const state = await readAppState();
  const collection = state.assetCollections.find((entry) => entry.id === id);
  if (!collection) {
    return NextResponse.json({ message: "Curated set not found." }, { status: 404 });
  }

  await deleteAssetCollectionRecord(id);
  await appendAuditEvent("asset-collection.deleted", `Deleted curated set ${id}.`);

  return NextResponse.json({
    ok: true,
    message: `Deleted curated set ${collection.name}.`
  });
}
