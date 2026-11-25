// Response headers the web app sets on every answer (M128), shared by next.config.ts, middleware.ts and the
// tests. next.config.ts imports this file, so it stays free of the "@/" alias and of anything server-only.

export type SecurityHeader = { key: string; value: string };

// Fixed values, baked into the build through next.config.ts headers(); docs/deployment.md names each one and
// tests/unit/security-headers.test.ts keeps the two in sync.
// - HSTS has no includeSubDomains and no preload: the app cannot know the operator's other subdomains, and
//   preload is a one-way choice for the operator; a reverse proxy can widen it. Browsers ignore HSTS on
//   plain-HTTP and IP answers, so LAN access on http://<ip>:3000 is unaffected.
// - Nothing in the product frames its own pages (the studio preview inlines its SVG, the browser overlay
//   route is gone), so every route refuses to be framed, through both the old and the CSP header.
// - Only frame-ancestors is enforced. The script policy runs report-only on /channel (middleware.ts).
export const SECURITY_HEADERS: SecurityHeader[] = [
  { key: "Strict-Transport-Security", value: "max-age=31536000" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "same-origin" }
];

export const CHANNEL_REPORT_ONLY_CSP_HEADER = "content-security-policy-report-only";

// The nonce-based policy for the public channel page, reported only. Next.js reads the nonce from the
// forwarded request header and stamps it on every script it renders; 'strict-dynamic' lets those scripts
// load the page's chunks. Development needs 'unsafe-eval' for React's dev tooling. There is no report-uri:
// a report endpoint would be a new unauthenticated write surface, so violations show in the browser console.
export function buildChannelReportOnlyCsp(nonce: string, options: { dev: boolean }): string {
  const scriptSrc = ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'", ...(options.dev ? ["'unsafe-eval'"] : [])];
  return [
    "default-src 'self'",
    `script-src ${scriptSrc.join(" ")}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'"
  ].join("; ");
}

// 16 random bytes (128 bits), base64. Web Crypto only, so it runs in the edge runtime of the middleware.
export function createCspNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}
