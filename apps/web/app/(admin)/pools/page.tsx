export const dynamic = "force-dynamic";

import { AdminPageHeader } from "@/components/admin-page-header";
import { PoolsWorkspacePanels } from "@/components/admin-workspace-sections";
import { readAppState } from "@/lib/server/state";
import { requireAuthenticatedUser } from "@/lib/server/auth";

export default async function PoolsPage() {
  // Every page checks the sign-in itself (M125): the layout's check is not a guarantee for every render path.
  await requireAuthenticatedUser();
  const state = await readAppState();

  return (
    <div className="stack-form">
      <AdminPageHeader
        description="Pools define which ready assets rotate together during scheduled playback. Use them as the bridge between ingest and the weekly schedule."
        eyebrow="Pools"
        title="Manage programming pools."
      />

      <div className="grid two">
        <PoolsWorkspacePanels state={state} />
      </div>
    </div>
  );
}
