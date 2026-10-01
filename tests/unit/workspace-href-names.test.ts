import { describe, expect, it } from "vitest";
import { WORKSPACE_CONFIG, buildWorkspaceHref, describeWorkspaceHref } from "@/lib/workspace-navigation";

describe("naming what a workspace link leads to", () => {
  it("names a tab the way the navigation names it", () => {
    expect(describeWorkspaceHref(buildWorkspaceHref("admin", "settings"))).toBe("Admin · Settings");
    expect(describeWorkspaceHref(buildWorkspaceHref("program", "sources"))).toBe("Program · Sources");
    expect(describeWorkspaceHref(buildWorkspaceHref("live", "status"))).toBe("Live · Status");
  });

  it("never puts a query string in front of an operator", () => {
    // What this replaced: the label was the href with a slash stripped off, so the checklist read
    // "Open admin?tab=settings". Every workspace link has to survive that, not just the ones that
    // happened to be on the page when it was noticed.
    for (const workspace of Object.values(WORKSPACE_CONFIG)) {
      for (const tab of workspace.tabs) {
        const name = describeWorkspaceHref(buildWorkspaceHref(workspace.id, tab.id));
        expect(name).not.toMatch(/[?=/]/);
        expect(name).toBe(`${workspace.label} · ${tab.label}`);
      }
    }
  });

  it("falls back to setup for links that leave the workspaces", () => {
    expect(describeWorkspaceHref("/setup")).toBe("setup");
    expect(describeWorkspaceHref("/")).toBe("setup");
  });

  it("names the workspace alone when no tab is given", () => {
    expect(describeWorkspaceHref(buildWorkspaceHref("studio"))).toBe("Studio");
  });

  it("ignores a tab that does not exist rather than inventing a name for it", () => {
    expect(describeWorkspaceHref("/live?tab=nonsense")).toBe("Live");
  });
});
