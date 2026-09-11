export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import LibraryPage from "@/app/(admin)/library/page";
import PoolsPage from "@/app/(admin)/pools/page";
import SchedulePage from "@/app/(admin)/schedule/page";
import SourcesPage from "@/app/(admin)/sources/page";
import { WorkspaceTabs } from "@/components/workspace-tabs";
import { resolveWorkspaceTabId } from "@/lib/workspace-navigation";

export default async function ProgramWorkspacePage(props: {
  searchParams: Promise<{
    tab?: string | string[];
    lens?: string | string[];
    day?: string | string[];
    assetId?: string | string[];
    sourceId?: string | string[];
  }>;
}) {
  const searchParams = await props.searchParams;
  const tab = resolveWorkspaceTabId("program", searchParams.tab);
  // The old /assets/:id and /sources/:id redirects landed here with the id as a query, and the library
  // and sources tabs never read it, so every "open this asset" link came back as the plain list. Those
  // two tabs forward to the detail pages instead. The schedule tab is not touched: it reads assetId
  // itself to open the metadata drawer beside the timeline.
  const assetId = Array.isArray(searchParams.assetId) ? searchParams.assetId[0] : searchParams.assetId;
  if (assetId && tab === "library") {
    redirect(`/assets/${encodeURIComponent(assetId)}`);
  }
  const sourceId = Array.isArray(searchParams.sourceId) ? searchParams.sourceId[0] : searchParams.sourceId;
  if (sourceId && tab === "sources") {
    redirect(`/sources/${encodeURIComponent(sourceId)}`);
  }

  return (
    <div className="stack-form">
      <WorkspaceTabs activeTabId={tab} workspaceId="program" />
      {tab === "schedule" ? <SchedulePage searchParams={Promise.resolve(searchParams)} /> : null}
      {tab === "pools" ? <PoolsPage /> : null}
      {tab === "library" ? <LibraryPage /> : null}
      {tab === "sources" ? <SourcesPage /> : null}
    </div>
  );
}
