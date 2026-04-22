import { describe, expect, it } from "vitest";
import nextConfig from "../../apps/web/next.config";
import { buildWorkspaceHref, resolveWorkspaceTabId, WORKSPACE_CONFIG } from "../../apps/web/lib/workspace-navigation";

describe("workspace routing", () => {
  it("resolves tabs with a workspace default fallback", () => {
    expect(resolveWorkspaceTabId("live", "status")).toBe("status");
    expect(resolveWorkspaceTabId("live", "unknown")).toBe(WORKSPACE_CONFIG.live.defaultTab);
    expect(resolveWorkspaceTabId("program", ["sources", "library"])).toBe("sources");
  });

  it("builds workspace hrefs with tab and detail context", () => {
    expect(buildWorkspaceHref("live")).toBe("/live");
    expect(buildWorkspaceHref("studio", "scene")).toBe("/studio?tab=scene");
    expect(buildWorkspaceHref("program", "library", { assetId: "asset-123" })).toBe("/program?tab=library&assetId=asset-123");
  });

  it("redirects legacy routes into workspace tabs", async () => {
    const redirects = await nextConfig.redirects?.();

    expect(redirects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: "/broadcast", destination: "/live?tab=control", permanent: false }),
        expect.objectContaining({ source: "/dashboard", destination: "/live?tab=status", permanent: false }),
        expect.objectContaining({ source: "/moderation", destination: "/live?tab=moderation", permanent: false }),
        expect.objectContaining({ source: "/schedule", destination: "/program?tab=schedule", permanent: false }),
        expect.objectContaining({ source: "/pools", destination: "/program?tab=pools", permanent: false }),
        expect.objectContaining({ source: "/library", destination: "/program?tab=library", permanent: false }),
        expect.objectContaining({ source: "/sources", destination: "/program?tab=sources", permanent: false }),
        expect.objectContaining({ source: "/assets/:id", destination: "/program?tab=library&assetId=%3Aid", permanent: false }),
        expect.objectContaining({ source: "/sources/:id", destination: "/program?tab=sources&sourceId=%3Aid", permanent: false }),
        expect.objectContaining({ source: "/overlay-studio", destination: "/studio?tab=scene", permanent: false }),
        expect.objectContaining({ source: "/overlays", destination: "/studio?tab=engagement", permanent: false }),
        expect.objectContaining({ source: "/output", destination: "/studio?tab=output", permanent: false }),
        expect.objectContaining({ source: "/settings", destination: "/admin?tab=settings", permanent: false }),
        expect.objectContaining({ source: "/team", destination: "/admin?tab=team", permanent: false }),
        expect.objectContaining({ source: "/ops", destination: "/live?tab=status", permanent: false })
      ])
    );
  });
});
