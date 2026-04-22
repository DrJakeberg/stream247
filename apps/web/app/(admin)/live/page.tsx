export const dynamic = "force-dynamic";

import BroadcastPage from "@/app/(admin)/broadcast/page";
import DashboardPage from "@/app/(admin)/dashboard/page";
import ModerationPage from "@/app/(admin)/moderation/page";
import { WorkspaceTabs } from "@/components/workspace-tabs";
import { resolveWorkspaceTabId } from "@/lib/workspace-navigation";

export default async function LiveWorkspacePage(props: {
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  const searchParams = await props.searchParams;
  const tab = resolveWorkspaceTabId("live", searchParams.tab);

  return (
    <div className="stack-form">
      <WorkspaceTabs activeTabId={tab} workspaceId="live" />
      {tab === "status" ? <DashboardPage /> : null}
      {tab === "moderation" ? <ModerationPage /> : null}
      {tab === "control" ? <BroadcastPage /> : null}
    </div>
  );
}
