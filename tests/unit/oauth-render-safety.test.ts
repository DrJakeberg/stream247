import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// /login returned 500 in production for weeks.
//
// The page called getTwitchAuthorizeUrl during render. That function mints a single-use OAuth state
// and writes it to a cookie, and Next.js only permits setting cookies in a Route Handler or Server
// Action — so rendering the page threw "Cookies can only be modified in a Server Action or Route
// Handler" and the whole page 500'd.
//
// Nothing caught it. The visual suite covers /login, but it runs against a stack with no Twitch
// credentials, where getTwitchAuthorizeUrl returns null before ever reaching the cookie write. The
// failure existed only where Twitch was configured, which is every real workspace and no test one.
//
// A screenshot cannot express "this must not happen when a credential is present". This can: pages
// may check whether sign-in is configured, but only routes may mint the URL.

const webRoot = path.resolve(import.meta.dirname, "../../apps/web");

/** Page and layout files — everything Next.js renders as a Server Component. */
const RENDERED_FILES = [
  "app/login/page.tsx",
  "app/setup/page.tsx",
  "app/(admin)/dashboard/page.tsx",
  "app/(admin)/layout.tsx",
  "app/channel/page.tsx",
  "app/page.tsx"
];

/** Route handlers, where writing a cookie is legal. */
const ROUTE_FILES = [
  "app/api/auth/twitch/start/route.ts",
  "app/api/integrations/twitch/connect/route.ts"
];

function read(relativePath: string): string {
  return readFileSync(path.join(webRoot, relativePath), "utf8");
}

describe("cookie writes never happen during a render", () => {
  it.each(RENDERED_FILES)("%s does not mint an OAuth authorize URL", (file) => {
    // getTwitchAuthorizeUrl issues the state cookie. isTwitchAuthorizeConfigured is the read-only
    // check a page is allowed to make.
    expect(read(file)).not.toContain("getTwitchAuthorizeUrl");
  });

  it.each(RENDERED_FILES)("%s does not call issueOAuthState directly either", (file) => {
    expect(read(file)).not.toContain("issueOAuthState");
  });

  it("gives pages a check that reads state without writing any", () => {
    const source = read("lib/server/twitch.ts");
    const checkBody = source.slice(
      source.indexOf("export async function isTwitchAuthorizeConfigured"),
      source.indexOf("export async function getTwitchAuthorizeUrl")
    );

    expect(checkBody).toContain("getManagedTwitchConfig");
    expect(checkBody).not.toContain("issueOAuthState");
  });

  it.each(ROUTE_FILES)("%s is where the authorize URL is actually built", (file) => {
    const source = read(file);

    expect(source).toContain("getTwitchAuthorizeUrl");
    // A route handler, not a page: this is the context Next.js allows a cookie write in.
    expect(source).toMatch(/export async function (GET|POST)/);
  });

  it("keeps the sign-in route reachable before anyone is signed in", () => {
    // /login links here, so requiring a session would make signing in impossible.
    expect(read("app/api/auth/twitch/start/route.ts")).not.toContain("requireApiRoles");
  });
});
