export const dynamic = "force-dynamic";

import { AdminPageHeader } from "@/components/admin-page-header";
import { LibraryWorkspacePanels } from "@/components/admin-workspace-sections";
import { readAppState } from "@/lib/server/state";
import { requireAuthenticatedUser } from "@/lib/server/auth";

export default async function LibraryPage() {
  // Every page checks the sign-in itself (M125): the layout's check is not a guarantee for every render path.
  await requireAuthenticatedUser();
  const state = await readAppState();

  return (
    <div className="stack-form">
      <AdminPageHeader
        description="Library is the programming-facing catalog of playable files. Use Sources for ingest configuration and Pools for schedule group logic."
        eyebrow="Library"
        title="Browse the playable catalog and upload local media."
      />

      <div className="grid two">
        <LibraryWorkspacePanels state={state} />
      </div>
    </div>
  );
}
