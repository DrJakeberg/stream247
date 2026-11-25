import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { WORKSPACE_CONFIG, buildWorkspaceHref, resolveWorkspaceTabId } from "../../apps/web/lib/workspace-navigation";

const auditPageSource = readFileSync(path.join(process.cwd(), "apps/web/app/(admin)/audit/page.tsx"), "utf8");
const adminWorkspacePageSource = readFileSync(path.join(process.cwd(), "apps/web/app/(admin)/admin/page.tsx"), "utf8");

/**
 * The audit view exists and is reachable.
 *
 * `getRecentAuditEvents` was exported with no caller anywhere in the repo, so the trail had a reader
 * only for the per-source list. Wiring is the whole point of this surface: a selector that nothing
 * renders is what was wrong before, and the failure mode is silent — nothing breaks when a tab stops
 * being rendered, the page simply goes blank.
 */
describe("admin audit workspace", () => {
  it("is a tab of the Admin workspace", () => {
    expect(WORKSPACE_CONFIG.admin.tabs.map((tab) => tab.id)).toContain("audit");
    expect(resolveWorkspaceTabId("admin", "audit")).toBe("audit");
    expect(buildWorkspaceHref("admin", "audit")).toBe("/admin?tab=audit");
  });

  it("is rendered by the Admin workspace page for that tab", () => {
    expect(adminWorkspacePageSource).toContain('import AuditPage from "@/app/(admin)/audit/page"');
    expect(adminWorkspacePageSource).toContain('{tab === "audit" ? <AuditPage /> : null}');
  });

  it("reads the workspace-wide trail rather than a per-source slice", () => {
    expect(auditPageSource).toContain("getRecentAuditEvents");
    expect(auditPageSource).not.toContain("getSourceAuditEvents");
  });

  it("is restricted to the roles that can change access", () => {
    expect(auditPageSource).toContain('requireRoles(["owner", "admin"])');
  });

  it("reads both retention windows, not only the general one", () => {
    expect(auditPageSource).toContain(
      "const AUDIT_READ_LIMIT = AUDIT_EVENT_RETENTION_LIMIT + AUDIT_EVENT_PROTECTED_RETENTION_LIMIT;"
    );
    expect(auditPageSource).toContain("summariseAuditActivity(events, AUDIT_EVENT_RETENTION_LIMIT)");
  });

  it("shows the security-relevant entries separately from everything else", () => {
    expect(auditPageSource).toContain("isNotableAuditEvent");
    expect(auditPageSource).toContain("Security and configuration");
    expect(auditPageSource).toContain("All recent activity");
  });

  it("folds outsider-writable entries before the notable cap applies", () => {
    expect(auditPageSource).toContain("partitionNotableAuditEvents(notable)");
    expect(auditPageSource).toContain("notableListed.slice(0, NOTABLE_ROW_LIMIT)");
    expect(auditPageSource).toContain("describeAuditOverflow(notableRows.length, notableListed.length)");
  });

  it("does not promise that configuration entries outlive the general window", () => {
    expect(auditPageSource).not.toContain("Routine worker traffic is not");
    expect(auditPageSource).toContain("complete only back to the edge shown above");
  });

  it("reports both row caps instead of truncating in silence", () => {
    expect(auditPageSource).toContain("describeAuditOverflow");
    expect(auditPageSource).toContain("notableOverflow");
    expect(auditPageSource).toContain("recentOverflow");
  });

  it("marks its timestamps as runtime state so the design baseline can mask them", () => {
    // Every visible instant on this page moves per run. `data-runtime-timestamp` is the attribute
    // tests/e2e/design-baseline.spec.ts masks; without it, adding this surface to the baseline
    // would produce a snapshot that goes red on the clock rather than on a design change.
    // Four instants: the "Complete since" edge, a notable row, a folded outsider-writable type's
    // newest entry, and a recent-activity row.
    expect(auditPageSource.match(/data-runtime-timestamp/g)?.length).toBe(4);
  });
});
