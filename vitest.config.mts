import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // Agent worktrees under .claude/ are full checkouts of this repo. Without excluding them a
    // local run collects every test twice — once from the working tree and once from each
    // worktree — which doubles the reported counts and runs code that is not what is being changed.
    exclude: ["**/node_modules/**", "**/dist/**", ".claude/**", "**/.next/**"]
  },
  resolve: {
    alias: {
      // Matches the "@/*" path mapping in apps/web/tsconfig.json, so tests can load web modules
      // (and route handlers that import them) the same way Next.js resolves them.
      "@/": `${path.resolve(import.meta.dirname, "apps/web")}/`,
      "@stream247/core": path.resolve(import.meta.dirname, "packages/core/src/index.ts"),
      "@stream247/config": path.resolve(import.meta.dirname, "packages/config/src/index.ts"),
      "@stream247/db": path.resolve(import.meta.dirname, "packages/db/src/index.ts")
    }
  }
});
