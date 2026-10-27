export const dynamic = "force-dynamic";

import BroadcastPage from "@/app/(admin)/broadcast/page";
import DashboardPage from "@/app/(admin)/dashboard/page";
import ModerationPage from "@/app/(admin)/moderation/page";
import { LiveWorkspaceHeader } from "@/components/live-workspace-header";
import { WorkspaceTabs } from "@/components/workspace-tabs";
import { getBroadcastSnapshot, readAppState } from "@/lib/server/state";
import { resolveWorkspaceTabId } from "@/lib/workspace-navigation";
import { requireAuthenticatedUser } from "@/lib/server/auth";

export default async function LiveWorkspacePage(props: {
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  // Every page checks the sign-in itself (M125): the layout's check is not a guarantee for every render path.
  await requireAuthenticatedUser();
  const [searchParams, state] = await Promise.all([props.searchParams, readAppState()]);
  const tab = resolveWorkspaceTabId("live", searchParams.tab);

  return (
    <div className="stack-form">
      <LiveWorkspaceHeader initialSnapshot={getBroadcastSnapshot(state)} />
      <WorkspaceTabs activeTabId={tab} workspaceId="live" />
      {tab === "status" ? <DashboardPage /> : null}
      {tab === "moderation" ? <ModerationPage /> : null}
      {tab === "control" ? <BroadcastPage /> : null}
    </div>
  );
}
