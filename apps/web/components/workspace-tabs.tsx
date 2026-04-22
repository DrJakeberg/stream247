import Link from "next/link";
import { buildWorkspaceHref, WORKSPACE_CONFIG, type WorkspaceId } from "@/lib/workspace-navigation";

export function WorkspaceTabs(props: { workspaceId: WorkspaceId; activeTabId: string }) {
  const workspace = WORKSPACE_CONFIG[props.workspaceId];

  return (
    <nav aria-label={`${workspace.label} tabs`} className="workspace-tabs">
      {workspace.tabs.map((tab) => {
        const isActive = tab.id === props.activeTabId;
        return (
          <Link
            aria-current={isActive ? "page" : undefined}
            className={isActive ? "workspace-tab-link workspace-tab-link-active" : "workspace-tab-link"}
            href={buildWorkspaceHref(props.workspaceId, tab.id)}
            key={tab.id}
            title={tab.label}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
