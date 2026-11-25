import { NextResponse, type NextRequest } from "next/server";
import { legacyRedirectTarget } from "./lib/legacy-redirects";
import { buildChannelReportOnlyCsp, CHANNEL_REPORT_ONLY_CSP_HEADER, createCspNonce } from "./lib/security-headers";

// M128, two jobs. The enforced headers (frame-ancestors among them) come from next.config.ts headers() on
// every route, and Next.js applies them to a middleware answer too.
// 1. The legacy admin paths (lib/legacy-redirects.ts) get their 307 here rather than from next.config
//    redirects(), whose answers Next.js 15.5 sends without the headers() values.
// 2. /channel gets a nonce-based script policy, report-only, as the first page. The policy goes on the
//    response for the browser and on the forwarded request headers, where Next.js reads the nonce and stamps
//    it on every script it renders. Edge runtime: Web APIs only.
export function middleware(request: NextRequest) {
  const redirectTarget = legacyRedirectTarget(request.nextUrl);
  if (redirectTarget) {
    return NextResponse.redirect(redirectTarget, 307);
  }
  // Next.js compiles a data-route variant into every matcher literal, so `/channel.json` and
  // `/broadcast.json` arrive here too; they are 404s and get no page policy.
  if (request.nextUrl.pathname !== "/channel") {
    return NextResponse.next();
  }

  const policy = buildChannelReportOnlyCsp(createCspNonce(), { dev: process.env.NODE_ENV !== "production" });
  const requestHeaders = new Headers(request.headers);
  // Next.js reads the nonce from an enforced CSP request header before the report-only one, so a client-sent
  // one would choose the nonce stamped into its own page; only the policy set here may reach the renderer.
  requestHeaders.delete("content-security-policy");
  requestHeaders.set(CHANNEL_REPORT_ONLY_CSP_HEADER, policy);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set(CHANNEL_REPORT_ONLY_CSP_HEADER, policy);
  return response;
}

// Literals only: Next.js reads the matcher statically. The legacy paths must equal the keys of
// LEGACY_REDIRECTS (tests/unit/workspace-routing.test.ts).
export const config = {
  matcher: [
    "/channel",
    "/broadcast",
    "/dashboard",
    "/moderation",
    "/schedule",
    "/pools",
    "/library",
    "/sources",
    "/overlay-studio",
    "/overlays",
    "/output",
    "/settings",
    "/team",
    "/ops"
  ]
};
