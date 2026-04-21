import { describe, expect, it } from "vitest";
import { ADMIN_NAV_ITEMS, ADMIN_NAV_SECTIONS } from "../../apps/web/lib/admin-navigation";

describe("admin navigation contract", () => {
  it("matches the four-section, eleven-link IA", () => {
    expect(ADMIN_NAV_SECTIONS.map((section) => section.label)).toEqual([
      "Live",
      "Programming",
      "Stream Studio",
      "Workspace"
    ]);

    expect(
      ADMIN_NAV_SECTIONS.map((section) => ({
        id: section.id,
        labels: section.items.map((item) => item.label),
        hrefs: section.items.map((item) => item.href)
      }))
    ).toEqual([
      {
        id: "live",
        labels: ["Broadcast", "Dashboard"],
        hrefs: ["/broadcast", "/dashboard"]
      },
      {
        id: "programming",
        labels: ["Schedule", "Pools", "Library"],
        hrefs: ["/schedule", "/pools", "/library"]
      },
      {
        id: "stream-studio",
        labels: ["Scene Studio", "Overlays", "Output"],
        hrefs: ["/overlay-studio", "/overlays", "/output"]
      },
      {
        id: "workspace",
        labels: ["Sources", "Team", "Settings"],
        hrefs: ["/sources", "/team", "/settings"]
      }
    ]);

    expect(ADMIN_NAV_ITEMS).toHaveLength(11);
    expect(new Set(ADMIN_NAV_ITEMS.map((item) => item.href)).size).toBe(11);
    expect(ADMIN_NAV_SECTIONS.every((section) => !("description" in section))).toBe(true);
  });
});
