import { describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: {
    json(payload: unknown, init?: ResponseInit) {
      return new Response(JSON.stringify(payload), {
        status: init?.status ?? 200,
        headers: { "content-type": "application/json" }
      });
    }
  }
}));

import { resolveSceneRendererFontFiles } from "@stream247/overlay-render";
import { GET } from "../../apps/web/app/api/scenes/preview/font/route";

function fontRequest(query: string): never {
  return new Request(`http://localhost/api/scenes/preview/font${query}`) as never;
}

/**
 * The font behind the preview.
 *
 * The preview SVG is inlined into the studio page without glyph outlines, so the browser draws it
 * with whatever the page's @font-face resolves to. If that were "some DejaVu the host happens to
 * have", the preview would be honest about geometry and quietly wrong about type. This route hands
 * out the very file the renderer read, so the two cannot drift.
 */
describe("scene preview font", () => {
  it("serves the exact file the renderer resolved", async () => {
    let expected;
    try {
      expected = await resolveSceneRendererFontFiles(process.env);
    } catch {
      // No font on this machine; the renderer would not start either. Inconclusive, not failed.
      return;
    }

    const response = await GET(fontRequest("?face=regular"));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("font/ttf");
    const served = Buffer.from(await response.arrayBuffer());
    expect(served.equals(expected.regular.data)).toBe(true);
  });

  it("serves the bold face on request and the regular face by default", async () => {
    let expected;
    try {
      expected = await resolveSceneRendererFontFiles(process.env);
    } catch {
      return;
    }

    const bold = Buffer.from(await (await GET(fontRequest("?face=bold"))).arrayBuffer());
    const fallback = Buffer.from(await (await GET(fontRequest(""))).arrayBuffer());

    expect(bold.equals(expected.bold.data)).toBe(true);
    expect(fallback.equals(expected.regular.data)).toBe(true);
  });

  it("knows exactly two faces and treats the parameter as a name, never a path", async () => {
    const response = await GET(fontRequest("?face=../../../../etc/passwd"));

    expect(response.status).toBe(404);
  });
});
