import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { metadata } from "../../apps/web/app/overlay/layout";

const middlewareSource = readFileSync(path.join(process.cwd(), "apps/web/middleware.ts"), "utf8");

describe("overlay indexing guards", () => {
  it("marks the overlay layout as noindex", () => {
    expect(metadata.robots).toMatchObject({
      index: false,
      follow: false
    });
  });

  it("adds an X-Robots-Tag header for the overlay route", () => {
    expect(middlewareSource).toContain('response.headers.set("X-Robots-Tag", "noindex")');
    expect(middlewareSource).toContain('matcher: ["/overlay"]');
  });
});
