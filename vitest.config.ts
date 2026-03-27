import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node"
  },
  resolve: {
    alias: {
      "@stream247/core": path.resolve(__dirname, "packages/core/src/index.ts"),
      "@stream247/config": path.resolve(__dirname, "packages/config/src/index.ts")
    }
  }
});

