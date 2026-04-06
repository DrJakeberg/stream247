import { NextRequest, NextResponse } from "next/server";
import { requireApiRoles } from "@/lib/server/auth";
import { appendAuditEvent, readAppState, upsertAssetCollectionRecords } from "@/lib/server/state";

function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^\w-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export async function POST(request: NextRequest) {
  const unauthorized = await requireApiRoles(["owner", "admin", "operator"]);
  if (unauthorized) {
    return unauthorized;
  }

  const body = (await request.json()) as {
    id?: string;
    name?: string;
    description?: string;
    color?: string;
    assetIds?: string[];
  };

  const name = String(body.name ?? "").trim();
  if (!name) {
    return NextResponse.json({ message: "Curated set name is required." }, { status: 400 });
  }

  const state = await readAppState();
  const now = new Date().toISOString();
  const existing = state.assetCollections.find((collection) => collection.id === String(body.id ?? "").trim()) ?? null;
  const nextId =
    existing?.id ||
    (() => {
      const base = slugify(name) || "curated-set";
      let candidate = `collection_${base}`;
      let suffix = 1;
      while (state.assetCollections.some((collection) => collection.id === candidate)) {
        suffix += 1;
        candidate = `collection_${base}_${suffix}`;
      }
      return candidate;
    })();

  await upsertAssetCollectionRecords([
    {
      id: nextId,
      name,
      description: String(body.description ?? existing?.description ?? "").trim(),
      color: String(body.color ?? existing?.color ?? "#0e6d5a").trim(),
      assetIds:
        body.assetIds !== undefined
          ? [...new Set((body.assetIds ?? []).map((assetId) => String(assetId).trim()).filter(Boolean))]
          : existing?.assetIds ?? [],
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    }
  ]);

  await appendAuditEvent(
    existing ? "asset-collection.updated" : "asset-collection.created",
    `${existing ? "Updated" : "Created"} curated set ${nextId}.`
  );

  return NextResponse.json({
    ok: true,
    id: nextId,
    message: existing ? `Updated curated set ${name}.` : `Created curated set ${name}.`
  });
}
