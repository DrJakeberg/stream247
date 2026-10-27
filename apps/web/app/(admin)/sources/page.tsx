export const dynamic = "force-dynamic";

import { AdminPageHeader } from "@/components/admin-page-header";
import { SourcesWorkspacePanels } from "@/components/admin-workspace-sections";
import { readAppState } from "@/lib/server/state";
import { requireAuthenticatedUser } from "@/lib/server/auth";

export default async function SourcesPage() {
  // Every page checks the sign-in itself (M125): the layout's check is not a guarantee for every render path.
  await requireAuthenticatedUser();
  const state = await readAppState();

  return (
    <div className="stack-form">
      <AdminPageHeader
        description="Sources are the ingest pipelines that fetch or scan upstream media. Use Library for playable assets and Pools for programming groups."
        eyebrow="Sources"
        title="Manage ingest pipelines and source connectors."
      />

      <div className="grid two">
        <SourcesWorkspacePanels state={state} />
      </div>
    </div>
  );
}
