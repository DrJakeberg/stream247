import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: path.join(__dirname, "../.."),
  async redirects() {
    return [
      {
        source: "/ops",
        destination: "/dashboard",
        permanent: true
      }
    ];
  }
};

export default nextConfig;
