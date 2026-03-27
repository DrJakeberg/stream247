import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node"
  },
  resolve: {
    alias: {
      "@stream247/core": path.resolve(import.meta.dirname, "packages/core/src/index.ts"),
      "@stream247/config": path.resolve(import.meta.dirname, "packages/config/src/index.ts")
    }
  }
});
