import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ADMIN_WORKSPACES } from "../../apps/web/lib/admin-navigation";

const adminNavigationSource = readFileSync(
  path.join(process.cwd(), "apps/web/components/admin-navigation.tsx"),
  "utf8"
);

describe("admin navigation", () => {
  it("collapses the sidebar to four workspace entries", () => {
    expect(ADMIN_WORKSPACES.map(({ href, id, label }) => ({ href, id, label }))).toEqual([
      { href: "/live", id: "live", label: "Live" },
      { href: "/program", id: "program", label: "Program" },
      { href: "/studio", id: "studio", label: "Studio" },
      { href: "/admin", id: "admin", label: "Admin" }
    ]);
  });

  it("uses Next Link while preserving the workspace active-state check", () => {
    expect(adminNavigationSource).toContain('import Link from "next/link";');
    expect(adminNavigationSource).toContain("pathname === item.href || pathname.startsWith(`${item.href}/`)");
    expect(adminNavigationSource).toContain("<Link");
    expect(adminNavigationSource).not.toContain("<a");
    expect(adminNavigationSource).toContain('item.href === "/live" && snapshot.presence.active');
    expect(adminNavigationSource).toContain('className="nav-link-dot"');
  });
});
