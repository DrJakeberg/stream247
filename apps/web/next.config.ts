import path from "node:path";
import type { NextConfig } from "next";
import { buildWorkspaceHref } from "./lib/workspace-navigation";

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: path.join(__dirname, "../.."),
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
