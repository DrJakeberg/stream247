import path from "node:path";
import type { NextConfig } from "next";
import { buildWorkspaceHref } from "./lib/workspace-navigation";

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
  async redirects() {
    return [
      {
        source: "/broadcast",
        destination: buildWorkspaceHref("live", "control"),
        permanent: false
      },
      {
        source: "/dashboard",
        destination: buildWorkspaceHref("live", "status"),
        permanent: false
      },
      {
        source: "/moderation",
        destination: buildWorkspaceHref("live", "moderation"),
        permanent: false
      },
      {
        source: "/schedule",
        destination: buildWorkspaceHref("program", "schedule"),
        permanent: false
      },
      {
        source: "/pools",
        destination: buildWorkspaceHref("program", "pools"),
        permanent: false
      },
      {
        source: "/library",
        destination: buildWorkspaceHref("program", "library"),
        permanent: false
      },
      {
        source: "/sources",
        destination: buildWorkspaceHref("program", "sources"),
        permanent: false
      },
      {
        source: "/assets/:id",
        destination: buildWorkspaceHref("program", "library", { assetId: ":id" }),
        permanent: false
      },
      {
        source: "/sources/:id",
        destination: buildWorkspaceHref("program", "sources", { sourceId: ":id" }),
        permanent: false
      },
      {
        source: "/overlay-studio",
        destination: buildWorkspaceHref("studio", "scene"),
        permanent: false
      },
      {
        source: "/overlays",
        destination: buildWorkspaceHref("studio", "engagement"),
        permanent: false
      },
      {
        source: "/output",
        destination: buildWorkspaceHref("studio", "output"),
        permanent: false
      },
      {
        source: "/settings",
        destination: buildWorkspaceHref("admin", "settings"),
        permanent: false
      },
      {
        source: "/team",
        destination: buildWorkspaceHref("admin", "team"),
        permanent: false
      },
      {
        source: "/ops",
        destination: buildWorkspaceHref("live", "status"),
        permanent: false
      }
    ];
  }
};

export default nextConfig;
