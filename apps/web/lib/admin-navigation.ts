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
      { href: "/broadcast", label: "Control" },
      { href: "/dashboard", label: "Status" },
      { href: "/moderation", label: "Moderation" }
    ]
  },
  {
    id: "programming",
    label: "Program",
    items: [
      { href: "/schedule", label: "Schedule" },
      { href: "/pools", label: "Pools" },
      { href: "/library", label: "Library" }
    ]
  },
  {
    id: "stream-studio",
    label: "Studio",
    items: [
      { href: "/overlay-studio", label: "Scene" },
      { href: "/overlays", label: "Engagement" },
      { href: "/output", label: "Output" }
    ]
  },
  {
    id: "workspace",
    label: "Admin",
    items: [
      { href: "/sources", label: "Sources" },
      { href: "/team", label: "Team" },
      { href: "/settings", label: "Settings" }
    ]
  }
];

export const ADMIN_NAV_ITEMS = ADMIN_NAV_SECTIONS.flatMap((section) => section.items);
