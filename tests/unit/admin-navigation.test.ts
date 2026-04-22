import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ADMIN_NAV_SECTIONS } from "../../apps/web/lib/admin-navigation";

const adminNavigationSource = readFileSync(
  path.join(process.cwd(), "apps/web/components/admin-navigation.tsx"),
  "utf8"
);

describe("admin navigation", () => {
  it("surfaces moderation in the live section and removes the old ops route", () => {
    const liveSection = ADMIN_NAV_SECTIONS.find((section) => section.id === "live");

    expect(ADMIN_NAV_SECTIONS.map((section) => section.label)).toEqual(["Live", "Program", "Studio", "Admin"]);
    expect(liveSection?.items).toEqual([
      { href: "/broadcast", label: "Control" },
      { href: "/dashboard", label: "Status" },
      { href: "/moderation", label: "Moderation" }
    ]);
    expect(ADMIN_NAV_SECTIONS.flatMap((section) => section.items).some((item) => item.href === "/ops")).toBe(false);
  });

  it("uses Next Link while preserving the nested-path active-state check", () => {
    expect(adminNavigationSource).toContain('import Link from "next/link";');
    expect(adminNavigationSource).toContain("pathname === item.href || pathname.startsWith(`${item.href}/`)");
    expect(adminNavigationSource).toContain("<Link");
    expect(adminNavigationSource).not.toContain("<a");
    expect(adminNavigationSource).toContain('item.href === "/moderation" && snapshot.presence.active');
    expect(adminNavigationSource).toContain('className="nav-link-dot"');
  });
});
