import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import path from "node:path";
import nextConfig from "../../apps/web/next.config";
import { LEGACY_REDIRECTS, legacyRedirectTarget } from "../../apps/web/lib/legacy-redirects";
import { config as middlewareConfig, middleware } from "../../apps/web/middleware";
import { buildWorkspaceHref, resolveWorkspaceTabId, WORKSPACE_CONFIG } from "../../apps/web/lib/workspace-navigation";

// next is a dependency of apps/web, not of the repository root; resolve it from there.
const requireFromWeb = createRequire(path.resolve(import.meta.dirname, "../../apps/web/package.json"));
const { NextRequest } = requireFromWeb("next/server") as typeof import("next/server");

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

  // M128 moved these from next.config redirects() into middleware.ts, whose answers carry the security
  // headers. Each case runs the real middleware function on a request.
  const LEGACY_CASES = [
    ["/broadcast", "/live?tab=control"],
    ["/dashboard", "/live?tab=status"],
    ["/moderation", "/live?tab=moderation"],
    ["/schedule", "/program?tab=schedule"],
    ["/pools", "/program?tab=pools"],
    ["/library", "/program?tab=library"],
    ["/sources", "/program?tab=sources"],
    ["/overlay-studio", "/studio?tab=scene"],
    ["/overlays", "/studio?tab=engagement"],
    ["/output", "/studio?tab=output"],
    ["/settings", "/admin?tab=settings"],
    ["/team", "/admin?tab=team"],
    ["/ops", "/live?tab=status"]
  ] as const;

  it("redirects legacy routes into workspace tabs", async () => {
    for (const [source, destination] of LEGACY_CASES) {
      const response = await middleware(new NextRequest(`http://h${source}`));
      expect(response.status, source).toBe(307);
      const location = new URL(response.headers.get("location") ?? "");
      expect(`${location.pathname}${location.search}`, source).toBe(destination);
      expect(response.headers.get("content-security-policy-report-only"), source).toBeNull();
    }
    expect(Object.keys(LEGACY_REDIRECTS).sort()).toEqual(LEGACY_CASES.map(([source]) => source).sort());
    expect(nextConfig.redirects).toBeUndefined();
  });

  it("keeps the request's query and lets the target's tab win, like redirects() did", async () => {
    const response = await middleware(new NextRequest("http://h/library?assetId=asset-1&tab=sources"));
    const location = new URL(response.headers.get("location") ?? "");
    expect(location.pathname).toBe("/program");
    expect(location.searchParams.get("tab")).toBe("library");
    expect(location.searchParams.get("assetId")).toBe("asset-1");
  });

  it("matches exactly /channel and the legacy paths in the middleware matcher", () => {
    // Next.js reads the matcher statically, so it repeats the keys of LEGACY_REDIRECTS as literals.
    expect(middlewareConfig.matcher).toEqual(["/channel", ...Object.keys(LEGACY_REDIRECTS)]);
  });

  it("leaves the detail routes alone", () => {
    // /assets/:id and /sources/:id used to redirect into /program?tab=library&assetId=… and
    // ?tab=sources&sourceId=…. Neither tab ever read the id, so every "open this asset" link landed
    // on the plain list and the detail pages were unreachable. They own their routes again; the
    // program page forwards those two old query shapes instead (the schedule tab keeps assetId, which
    // it reads itself for the metadata drawer).
    expect(middlewareConfig.matcher).not.toContain("/assets/:id");
    expect(middlewareConfig.matcher).not.toContain("/sources/:id");
    expect(legacyRedirectTarget(new URL("http://h/assets/asset-1"))).toBeNull();
    expect(legacyRedirectTarget(new URL("http://h/sources/source-1"))).toBeNull();
    expect(middlewareConfig.matcher).toContain("/library");
  });
});
