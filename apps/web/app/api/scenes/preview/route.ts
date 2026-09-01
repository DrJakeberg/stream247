import { NextResponse } from "next/server";
import { loadSceneRendererFonts, renderSceneSvg, type SceneRenderFont } from "@stream247/overlay-render";
import { getAuthenticatedUserId, requireApiRoles } from "@/lib/server/auth";
import { normalizeScenePreviewRequest } from "@/lib/scene-preview-request";

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
 * process just read for satori. Sent as an <img> instead it would be an isolated document with no
 * fonts, and every frame would have to carry the outlines again.
 */

const PREVIEW_ROLES = ["owner", "admin", "operator", "moderator", "viewer"] as const;

let fontsPromise: Promise<SceneRenderFont[]> | null = null;

function sceneFonts(): Promise<SceneRenderFont[]> {
  if (!fontsPromise) {
    fontsPromise = loadSceneRendererFonts(process.env).catch((error: unknown) => {
      // Not cached as a rejection: installing the font should fix the studio without a restart.
      fontsPromise = null;
      throw error;
    });
  }

  return fontsPromise;
}

// Renders run one at a time, always.
//
// This box encodes a 24/7 channel while it serves the studio, and the scene editor asks for a
// frame every time the operator changes something. Six concurrent renders would be six cores taken
// away from the encoder for as long as they run. A queue costs the operator a few milliseconds of
// latency; it costs the channel nothing.
let renderQueue: Promise<unknown> = Promise.resolve();
let activeRenders = 0;
let peakRenders = 0;

/** Test seam: the highest number of renders ever in flight together. Must never exceed one. */
export function peakConcurrentScenePreviewRenders(): number {
  return peakRenders;
}

function queueRender<T>(task: () => Promise<T>): Promise<T> {
  const result = renderQueue.then(async () => {
    activeRenders += 1;
    peakRenders = Math.max(peakRenders, activeRenders);
    try {
      return await task();
    } finally {
      activeRenders -= 1;
    }
  });

  // The chain must survive a failed render, or one bad body would wedge every later preview.
  renderQueue = result.catch(() => undefined);
  return result;
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
    svg = await queueRender(async () => renderSceneSvg(scene, await sceneFonts(), { embedFont: false }));
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
