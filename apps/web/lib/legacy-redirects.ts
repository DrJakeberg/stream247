import { buildWorkspaceHref } from "./workspace-navigation";

// The old top-level admin paths and the workspace tab each one now lives in. middleware.ts answers them with
// a 307; until M128 they were next.config.ts redirects(), which Next.js 15.5 answers before it applies
// headers(), so those 307s carried no security headers. A redirect from middleware gets the headers() values.
// middleware.ts lists the same paths as literals in its matcher (Next.js reads the matcher statically), and
// tests/unit/workspace-routing.test.ts keeps the two lists equal.
//
// /assets/:id and /sources/:id are NOT redirected: they are the detail pages. Until 2026-09-06 they were sent
// to the library/sources tab with ?assetId=/?sourceId=, which nothing read, so every "Open asset detail" link
// landed back on the list. program/page.tsx forwards those old query links to the detail pages instead.
export const LEGACY_REDIRECTS: Readonly<Record<string, string>> = {
  "/broadcast": buildWorkspaceHref("live", "control"),
  "/dashboard": buildWorkspaceHref("live", "status"),
  "/moderation": buildWorkspaceHref("live", "moderation"),
  "/schedule": buildWorkspaceHref("program", "schedule"),
  "/pools": buildWorkspaceHref("program", "pools"),
  "/library": buildWorkspaceHref("program", "library"),
  "/sources": buildWorkspaceHref("program", "sources"),
  "/overlay-studio": buildWorkspaceHref("studio", "scene"),
  "/overlays": buildWorkspaceHref("studio", "engagement"),
  "/output": buildWorkspaceHref("studio", "output"),
  "/settings": buildWorkspaceHref("admin", "settings"),
  "/team": buildWorkspaceHref("admin", "team"),
  "/ops": buildWorkspaceHref("live", "status")
};

// The target of a legacy path, or null. The request's own query is kept and the target's tab wins, the way
// next.config redirects() merged them (an old /library?assetId=… link still reaches program/page.tsx).
export function legacyRedirectTarget(url: URL): URL | null {
  const destination = Object.hasOwn(LEGACY_REDIRECTS, url.pathname) ? LEGACY_REDIRECTS[url.pathname] : undefined;
  if (!destination) {
    return null;
  }
  const target = new URL(destination, url);
  const merged = new URLSearchParams(url.searchParams);
  for (const [key, value] of target.searchParams) {
    merged.set(key, value);
  }
  target.search = merged.toString();
  return target;
}
