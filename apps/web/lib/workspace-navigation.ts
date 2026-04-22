export type WorkspaceId = "live" | "program" | "studio" | "admin";

export type WorkspaceTab = {
  id: string;
  label: string;
};

export type WorkspaceNavItem = {
  id: WorkspaceId;
  href: string;
  label: string;
};

type WorkspaceConfig = WorkspaceNavItem & {
  defaultTab: string;
  tabs: readonly WorkspaceTab[];
};

export const WORKSPACE_CONFIG: Record<WorkspaceId, WorkspaceConfig> = {
  live: {
    id: "live",
    href: "/live",
    label: "Live",
    defaultTab: "control",
    tabs: [
      { id: "control", label: "Control" },
      { id: "status", label: "Status" },
      { id: "moderation", label: "Moderation" }
    ]
  },
  program: {
    id: "program",
    href: "/program",
    label: "Program",
    defaultTab: "schedule",
    tabs: [
      { id: "schedule", label: "Schedule" },
      { id: "pools", label: "Pools" },
      { id: "library", label: "Library" },
      { id: "sources", label: "Sources" }
    ]
  },
  studio: {
    id: "studio",
    href: "/studio",
    label: "Studio",
    defaultTab: "scene",
    tabs: [
      { id: "scene", label: "Scene" },
      { id: "engagement", label: "Engagement" },
      { id: "output", label: "Output" }
    ]
  },
  admin: {
    id: "admin",
    href: "/admin",
    label: "Admin",
    defaultTab: "settings",
    tabs: [
      { id: "settings", label: "Settings" },
      { id: "team", label: "Team" }
    ]
  }
};

export const ADMIN_WORKSPACES: WorkspaceNavItem[] = [
  WORKSPACE_CONFIG.live,
  WORKSPACE_CONFIG.program,
  WORKSPACE_CONFIG.studio,
  WORKSPACE_CONFIG.admin
];

export function buildWorkspaceHref(
  workspaceId: WorkspaceId,
  tabId?: string,
  extraParams?: Record<string, string | undefined>
): string {
  const workspace = WORKSPACE_CONFIG[workspaceId];
  const params = new URLSearchParams();

  if (tabId) {
    params.set("tab", tabId);
  }

  if (extraParams) {
    for (const [key, value] of Object.entries(extraParams)) {
      if (value) {
        params.set(key, value);
      }
    }
  }

  const query = params.toString();
  return query ? `${workspace.href}?${query}` : workspace.href;
}

export function resolveWorkspaceTabId(
  workspaceId: WorkspaceId,
  value: string | string[] | undefined
): string {
  const workspace = WORKSPACE_CONFIG[workspaceId];
  const candidate = Array.isArray(value) ? value[0] : value;

  if (candidate && workspace.tabs.some((tab) => tab.id === candidate)) {
    return candidate;
  }

  return workspace.defaultTab;
}
