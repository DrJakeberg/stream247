export const dynamic = "force-dynamic";

import SettingsPage from "@/app/(admin)/settings/page";
import TeamPage from "@/app/(admin)/team/page";
import { WorkspaceTabs } from "@/components/workspace-tabs";
import { resolveWorkspaceTabId } from "@/lib/workspace-navigation";

export default async function AdminWorkspacePage(props: {
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  const searchParams = await props.searchParams;
  const tab = resolveWorkspaceTabId("admin", searchParams.tab);

  return (
    <div className="stack-form">
      <WorkspaceTabs activeTabId={tab} workspaceId="admin" />
      {tab === "team" ? <TeamPage /> : null}
      {tab === "settings" ? <SettingsPage /> : null}
    </div>
  );
}
