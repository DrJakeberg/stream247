import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const adminNavigationSource = readFileSync(path.join(process.cwd(), "apps/web/lib/admin-navigation.ts"), "utf8");
const adminLayoutSource = readFileSync(path.join(process.cwd(), "apps/web/app/(admin)/layout.tsx"), "utf8");
const dashboardSource = readFileSync(path.join(process.cwd(), "apps/web/app/(admin)/dashboard/page.tsx"), "utf8");
const overlaysSource = readFileSync(path.join(process.cwd(), "apps/web/app/(admin)/overlays/page.tsx"), "utf8");
const overlayStudioSource = readFileSync(path.join(process.cwd(), "apps/web/app/(admin)/overlay-studio/page.tsx"), "utf8");

describe("admin terminology copy", () => {
  it("uses the Live / Program / Studio / Admin workspace language", () => {
    expect(adminNavigationSource).toContain('label: "Program"');
    expect(adminNavigationSource).toContain('label: "Studio"');
    expect(adminNavigationSource).toContain('label: "Admin"');
    expect(adminLayoutSource).toContain("Live covers control, status, and moderation");
  });

  it("drops the old dashboard, overlays, and scene studio labels from the main admin surfaces", () => {
    expect(adminNavigationSource).not.toContain('label: "Dashboard"');
    expect(adminNavigationSource).not.toContain('label: "Overlays"');
    expect(adminNavigationSource).not.toContain('label: "Scene Studio"');
    expect(dashboardSource).toContain('eyebrow="Readiness"');
    expect(overlaysSource).toContain('eyebrow="Engagement"');
    expect(overlayStudioSource).toContain('eyebrow="Scene"');
  });
});
