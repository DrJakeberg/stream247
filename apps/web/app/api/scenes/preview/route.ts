import { NextResponse } from "next/server";
import { getAuthenticatedUserId, requireApiRoles } from "@/lib/server/auth";
import { normalizeScenePreviewRequest } from "@/lib/scene-preview-request";
import { checkScenePreviewRenderer, renderScenePreviewSvg } from "@/lib/server/scene-preview-renderer";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * The studio preview, drawn by the renderer that draws the broadcast.
 *
 * Sister route to ../route.ts, which serves the scene *payload*. This one serves the picture, and
 * it is the same satori pass the worker runs before handing the SVG to resvg — same layout, same
 * safe area, same clamp limits, same fonts. The studio's hand-written imitation disagreed with all
 * four, so it showed the operator panel positions that do not exist on air.
 *
 * SVG rather than PNG, and without embedded glyph outlines, because the answer is inlined into the
 * studio page: there it inherits the page's @font-face rules, which resolve to the very file this
 * process reads for satori. Sent as an <img> instead it would be an isolated document with no
 * fonts, and every frame would have to carry the outlines again.
 */

const PREVIEW_ROLES = ["owner", "admin", "operator", "moderator", "viewer"] as const;

/**
 * Can this deployment draw an overlay at all?
 *
 * satori builds its layout engine on the first render, not when it is imported — so a bundle that
 * lost the engine's payload starts, serves, answers every other check, and fails the first time an
 * operator opens the scene editor. This draws a scene compiled into the build, once, and remembers
 * the answer.
 *
 * Unauthenticated on purpose, and safe to be: it takes no parameters, reads no workspace state,
 * returns no picture, and renders at most once per process. The image smoke test calls it, which is
 * the whole point — a production-only failure needs a production-shaped check.
 */
export async function GET() {
  try {
    return NextResponse.json(await checkScenePreviewRenderer(), {
      headers: { "cache-control": "no-store" }
    });
  } catch (error) {
    return NextResponse.json(
      {
        renderer: "failed",
        message: error instanceof Error ? error.message : "The overlay renderer could not draw a frame."
      },
      { status: 503, headers: { "cache-control": "no-store" } }
    );
  }
}

export async function POST(request: Request) {
  // Answered before the database is touched. A request with no session cookie cannot be authorised
  // by any state, so there is nothing to look up — and the image smoke test depends on it: it runs
  // the web image with no Postgres behind it, and a 401 there proves this module (satori and its
  // bundled layout engine included) really loaded inside the standalone build.
  if (!(await getAuthenticatedUserId())) {
    return NextResponse.json({ message: "Authentication required." }, { status: 401 });
  }

  const unauthorized = await requireApiRoles([...PREVIEW_ROLES]);
  if (unauthorized) {
    return unauthorized;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ message: "Expected a JSON scene payload." }, { status: 400 });
  }

  const scene = normalizeScenePreviewRequest(body);
  if (!scene) {
    return NextResponse.json({ message: "Expected a scene payload to preview." }, { status: 400 });
  }

  let svg: string;
  try {
    svg = await renderScenePreviewSvg(scene);
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "The overlay renderer could not draw this scene." },
      { status: 500 }
    );
  }

  return new Response(svg, {
    headers: {
      "content-type": "image/svg+xml; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}
