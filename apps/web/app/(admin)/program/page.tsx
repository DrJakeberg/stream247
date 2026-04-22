export const dynamic = "force-dynamic";

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
  }>;
}) {
  const searchParams = await props.searchParams;
  const tab = resolveWorkspaceTabId("program", searchParams.tab);

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
