import { NextRequest, NextResponse } from "next/server";
import { requireApiRoles } from "@/lib/server/auth";
import { exportChannelBlueprint, importChannelBlueprint, type BlueprintImportOptions } from "@/lib/server/channel-blueprints";

function slugifyFileName(value: string): string {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^\w.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export async function GET() {
  const unauthorized = await requireApiRoles(["owner", "admin"]);
  if (unauthorized) {
    return unauthorized;
  }

  const blueprint = await exportChannelBlueprint();
  const fileName = `${slugifyFileName(blueprint.blueprintName || "stream247-channel") || "stream247-channel"}.channel-blueprint.json`;
  return new Response(JSON.stringify(blueprint, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${fileName}"`
    }
  });
}

export async function POST(request: NextRequest) {
  const unauthorized = await requireApiRoles(["owner", "admin"]);
  if (unauthorized) {
    return unauthorized;
  }

  const body = (await request.json()) as { blueprint?: unknown; options?: BlueprintImportOptions };

  try {
    const normalized = await importChannelBlueprint(body.blueprint ?? body, body.options);
    return NextResponse.json({
      ok: true,
      message: `Imported blueprint ${normalized.blueprint.blueprintName}.`,
      summary: {
        sources: normalized.importedSources.length,
        pools: normalized.importedPools.length,
        showProfiles: normalized.importedShowProfiles.length,
        scheduleBlocks: normalized.importedScheduleBlocks.length,
        curatedSets: normalized.importedAssetCollections.length,
        presets: normalized.importedPresets.length
      },
      warnings: normalized.warnings,
      sections: normalized.sections
    });
  } catch (error) {
    return NextResponse.json(
      {
        message: error instanceof Error ? error.message : "Could not import channel blueprint."
      },
      { status: 400 }
    );
  }
}
