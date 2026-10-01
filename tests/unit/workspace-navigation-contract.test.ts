import { describe, expect, it } from "vitest";
import { ADMIN_WORKSPACES, WORKSPACE_CONFIG, buildWorkspaceHref } from "@/lib/workspace-navigation";

/**
 * The shape of the product, held still.
 *
 * This replaces tests/browser/admin-navigation.test.ts, which asserted a four-section IA with links
 * to /broadcast and /schedule. That structure was replaced by workspaces and tabs; the test kept
 * describing the old one and had been failing on `ADMIN_NAV_SECTIONS` being undefined — for long
 * enough that nobody noticed, because no npm script ran that directory. A test that cannot pass and
 * never runs is not coverage, it is a note claiming to be one.
 *
 * What is worth pinning is the arrangement itself: four workspaces, in this order, with these tabs.
 * Rearranging it is a decision, not a side effect, and several things now derive their wording from
 * this table.
 */
describe("workspace navigation contract", () => {
  it("has four workspaces in the order the shell shows them", () => {
    expect(ADMIN_WORKSPACES.map((workspace) => workspace.label)).toEqual(["Live", "Program", "Studio", "Admin"]);
  });

  it("keeps the tabs each workspace is made of", () => {
    expect(
      ADMIN_WORKSPACES.map((workspace) => ({
        label: workspace.label,
        tabs: workspace.tabs.map((tab) => tab.label)
      }))
    ).toEqual([
      { label: "Live", tabs: ["Control", "Status", "Moderation"] },
      { label: "Program", tabs: ["Schedule", "Pools", "Library", "Sources"] },
      { label: "Studio", tabs: ["Scene", "Engagement", "Output"] },
      { label: "Admin", tabs: ["Settings", "Team"] }
    ]);
  });

  it("builds a reachable href for every tab", () => {
    for (const workspace of Object.values(WORKSPACE_CONFIG)) {
      for (const tab of workspace.tabs) {
        const href = buildWorkspaceHref(workspace.id, tab.id);
        expect(href).toBe(`${workspace.href}?tab=${tab.id}`);
      }
    }
  });

  it("gives every workspace and tab a label a person would say out loud", () => {
    for (const workspace of Object.values(WORKSPACE_CONFIG)) {
      expect(workspace.label).toMatch(/^[A-Z]/);
      for (const tab of workspace.tabs) {
        expect(tab.label).toMatch(/^[A-Z]/);
        expect(tab.label).not.toBe(tab.id);
      }
    }
  });
});
