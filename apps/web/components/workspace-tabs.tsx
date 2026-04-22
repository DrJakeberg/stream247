import { Tabs } from "@/components/ui/Tabs";
import { buildWorkspaceHref, WORKSPACE_CONFIG, type WorkspaceId } from "@/lib/workspace-navigation";

export function WorkspaceTabs(props: { workspaceId: WorkspaceId; activeTabId: string }) {
  const workspace = WORKSPACE_CONFIG[props.workspaceId];

  return (
    <Tabs
      activeId={props.activeTabId}
      ariaLabel={`${workspace.label} tabs`}
      items={workspace.tabs.map((tab) => ({
        id: tab.id,
        href: buildWorkspaceHref(props.workspaceId, tab.id),
        label: tab.label
      }))}
    />
  );
}
