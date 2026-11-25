import path from "node:path";
import type { NextConfig } from "next";
import { SECURITY_HEADERS } from "./lib/security-headers";

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: path.join(__dirname, "../.."),
  // No serverExternalPackages entry for satori, on purpose.
  //
  // The obvious instinct with a layout engine is to mark it external so Next leaves it alone. Here
  // that would be the wrong way round: satori ships its layout engine already inlined as base64
  // inside its own bundle, with no .node binary and no separate .wasm file to find, so webpack
  // bundles the whole thing into a server chunk that "output: standalone" copies wholesale.
  // Externalising it would instead make the runtime resolve satori from node_modules and leave the
  // image depending on file tracing having copied it — a failure that only appears in production.
  // Verified after a build: the engine's payload lands in .next/standalone/apps/web/.next/server.

  // The workspace packages are consumed as TypeScript source and compile with NodeNext, which
  // requires explicit ".js" specifiers in relative imports. Webpack has to be told that a ".js"
  // specifier may resolve to the ".ts" file it was written for.
  webpack(config) {
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      ".js": [".ts", ".tsx", ".js"]
    };
    return config;
  },
  // M128: the security headers on every answer, static assets included. There is no redirects() entry: Next.js
  // 15.5 answers those before it applies headers(), so the legacy admin paths are redirected in middleware.ts
  // (lib/legacy-redirects.ts), whose answers do get these. The values are baked in at build time
  // (lib/security-headers.ts explains each); a reverse proxy that sets the same headers should either drop
  // its own or overwrite these, so there is one source (docs/deployment.md). HSTS has no includeSubDomains
  // or preload: those are the operator's choice, made in the proxy. The per-request nonce policy of /channel
  // lives in middleware.ts too.
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  }
};

export default nextConfig;
