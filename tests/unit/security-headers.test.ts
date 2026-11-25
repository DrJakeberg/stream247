import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it } from "vitest";
import nextConfig from "../../apps/web/next.config";
import { LEGACY_REDIRECTS } from "../../apps/web/lib/legacy-redirects";
import { config as middlewareConfig, middleware } from "../../apps/web/middleware";

// next is a dependency of apps/web, not of the repository root; resolve it from there.
const requireFromWeb = createRequire(path.resolve(import.meta.dirname, "../../apps/web/package.json"));
const { NextRequest } = requireFromWeb("next/server") as typeof import("next/server");
// The function the build uses to turn a headers()/redirects() source into the routes-manifest regex.
const { buildCustomRoute } = requireFromWeb("next/dist/lib/build-custom-route") as {
  buildCustomRoute: (type: "header" | "redirect", route: { source: string }) => { regex: string };
};

const EXPECTED_HEADERS = [
  { key: "Strict-Transport-Security", value: "max-age=31536000" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "same-origin" }
];

const SAMPLE_PATHS = [
  "/",
  "/channel",
  "/channel.ics",
  "/login",
  "/live",
  "/api/channel/live",
  "/api/scenes/preview",
  "/_next/static/chunks/x.js",
  "/no-such-page/deeper"
];

async function catchAllEntry() {
  const entries = (await nextConfig.headers?.()) ?? [];
  const catchAll = entries.filter((entry) => entry.source === "/:path*");
  expect(catchAll).toHaveLength(1);
  return catchAll[0];
}

function matchesHeaderSource(source: string, pathname: string) {
  return new RegExp(buildCustomRoute("header", { source }).regex).test(pathname);
}

describe("security headers in next.config (M128)", () => {
  it("sets exactly the five headers on a catch-all source", async () => {
    const entry = await catchAllEntry();
    expect(entry.headers).toEqual(EXPECTED_HEADERS);
    expect(entry.has ?? []).toEqual([]);
    expect(entry.missing ?? []).toEqual([]);
  });

  // The legacy admin paths are redirected in middleware.ts (Next.js 15.5 answers a redirects() entry before
  // headers(), but applies headers() to a middleware answer); tests/e2e/admin-smoke.spec.ts checks a 307.
  it("covers every sample path and the legacy paths in a basePath-free build", async () => {
    const entry = await catchAllEntry();
    expect(nextConfig.basePath ?? "").toBe("");
    expect(nextConfig.redirects).toBeUndefined();
    const legacyPaths = Object.keys(LEGACY_REDIRECTS);
    expect(legacyPaths.length).toBeGreaterThan(0);
    for (const pathname of [...SAMPLE_PATHS, ...legacyPaths]) {
      expect(matchesHeaderSource(entry.source, pathname), pathname).toBe(true);
    }
  });

  it("is documented in docs/deployment.md with each value", () => {
    const doc = readFileSync(path.resolve(import.meta.dirname, "../../docs/deployment.md"), "utf8");
    for (const { key, value } of EXPECTED_HEADERS) {
      expect(doc.includes(`\`${key}: ${value}\``), `${key}: ${value}`).toBe(true);
    }
    expect(doc.includes("Content-Security-Policy-Report-Only")).toBe(true);
  });
});

describe("report-only nonce policy on /channel (M128)", () => {
  function reportOnlyPolicy(response: Response) {
    const policy = response.headers.get("content-security-policy-report-only") ?? "";
    const nonce = /'nonce-([^']+)'/.exec(policy)?.[1] ?? "";
    return { policy, nonce };
  }

  it("runs on /channel and otherwise only on the legacy redirect paths", async () => {
    expect(middlewareConfig.matcher[0]).toBe("/channel");
    for (const pathname of middlewareConfig.matcher.slice(1)) {
      const response = await middleware(new NextRequest(`http://h${pathname}`));
      expect(response.status, pathname).toBe(307);
      expect(response.headers.get("content-security-policy-report-only"), pathname).toBeNull();
    }
    // The matcher regex Next.js builds also lets these 404 paths through; they get no page policy.
    for (const pathname of ["/channel.json", "/broadcast.json"]) {
      const response = await middleware(new NextRequest(`http://h${pathname}`));
      expect(response.headers.get("x-middleware-next"), pathname).toBe("1");
      expect(response.headers.get("content-security-policy-report-only"), pathname).toBeNull();
    }
  });

  it("drops a client-sent enforced CSP request header, so the client cannot choose the nonce", async () => {
    const response = await middleware(
      new NextRequest("http://h/channel", { headers: { "content-security-policy": "script-src 'nonce-abc'" } })
    );
    expect(response.headers.get("x-middleware-override-headers")?.split(",")).not.toContain("content-security-policy");
    expect(response.headers.get("x-middleware-request-content-security-policy")).toBeNull();
    expect(reportOnlyPolicy(response).nonce).not.toBe("abc");
  });

  it("answers with a fresh nonce policy and forwards it to the renderer", async () => {
    const first = await middleware(new NextRequest("http://h/channel"));
    const second = await middleware(new NextRequest("http://h/channel"));

    // NextResponse.next(): the request continues to the page.
    expect(first.headers.get("x-middleware-next")).toBe("1");
    expect(first.headers.get("content-security-policy")).toBeNull();

    const { policy, nonce } = reportOnlyPolicy(first);
    const scriptSrc = policy.split(";").map((part) => part.trim()).find((part) => part.startsWith("script-src ")) ?? "";
    expect(scriptSrc).toContain("'self'");
    expect(scriptSrc).toContain(`'nonce-${nonce}'`);
    expect(scriptSrc).toContain("'strict-dynamic'");
    expect(scriptSrc).not.toContain("'unsafe-inline'");
    for (const directive of ["object-src 'none'", "base-uri 'none'", "connect-src 'self'", "frame-ancestors 'none'"]) {
      expect(policy).toContain(directive);
    }

    // At least 128 bits of base64 (16 bytes is 24 characters with padding).
    expect(Buffer.from(nonce, "base64").length).toBeGreaterThanOrEqual(16);
    expect(reportOnlyPolicy(second).nonce).not.toBe(nonce);

    // Next.js stamps the nonce from the forwarded request header (app-render reads either CSP header).
    expect(first.headers.get("x-middleware-override-headers")?.split(",")).toContain("content-security-policy-report-only");
    expect(first.headers.get("x-middleware-request-content-security-policy-report-only")).toBe(policy);
  });
});
