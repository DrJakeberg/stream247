export type AdminNavigationItem = {
  href: string;
  label: string;
};

export type AdminNavigationSection = {
  id: string;
  label: string;
  items: AdminNavigationItem[];
};

export const ADMIN_NAV_SECTIONS: AdminNavigationSection[] = [
  {
    id: "live",
    label: "Live",
    items: [
      { href: "/broadcast", label: "Broadcast" },
      { href: "/dashboard", label: "Dashboard" },
      { href: "/moderation", label: "Moderation" }
    ]
  },
  {
    id: "programming",
    label: "Programming",
    items: [
      { href: "/schedule", label: "Schedule" },
      { href: "/pools", label: "Pools" },
      { href: "/library", label: "Library" }
    ]
  },
  {
    id: "stream-studio",
    label: "Stream Studio",
    items: [
      { href: "/overlay-studio", label: "Scene Studio" },
      { href: "/overlays", label: "Overlays" },
      { href: "/output", label: "Output" }
    ]
  },
  {
    id: "workspace",
    label: "Workspace",
    items: [
      { href: "/sources", label: "Sources" },
      { href: "/team", label: "Team" },
      { href: "/settings", label: "Settings" }
    ]
  }
];

export const ADMIN_NAV_ITEMS = ADMIN_NAV_SECTIONS.flatMap((section) => section.items);
