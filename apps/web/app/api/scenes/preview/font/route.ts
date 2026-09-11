import { NextResponse } from "next/server";
import { resolveSceneRendererFontFiles } from "@stream247/overlay-render";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * The font the preview is drawn with.
 *
 * The preview SVG is inlined into the studio page and carries no glyph outlines, so the browser
 * draws it with whatever the page's @font-face resolves to. Pointing that at a web font, or at a
 * local() family, would make the preview honest about geometry and quietly wrong about type — the
 * one thing the whole exercise is meant to fix. So the page loads the very file this process just
 * read for satori.
 *
 * Deliberately unauthenticated. What it serves is DejaVu, a freely redistributable font that is
 * already installed on the host; there is no workspace data in it, nothing is looked up, and two
 * fixed names are the entire input. Serving it openly also keeps the smoke test honest: it can
 * confirm the runner image really has ttf-dejavu installed, which is otherwise a failure that only
 * shows up in production, and only as a preview drawn in the wrong typeface.
 */

const FACES = ["regular", "bold"] as const;
type FontFace = (typeof FACES)[number];

function readFace(value: string | null): FontFace | null {
  if (!value) {
    return "regular";
  }

  // A name, never a path. The two faces are fixed here and nothing from the query string ever
  // reaches the filesystem.
  return FACES.includes(value as FontFace) ? (value as FontFace) : null;
}

export async function GET(request: Request) {
  const face = readFace(new URL(request.url).searchParams.get("face"));
  if (!face) {
    return NextResponse.json({ message: `Unknown font face. Expected one of: ${FACES.join(", ")}.` }, { status: 404 });
  }

  let files;
  try {
    files = await resolveSceneRendererFontFiles(process.env);
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "No overlay font is installed." },
      { status: 503 }
    );
  }

  const file = files[face];

  return new Response(new Uint8Array(file.data), {
    headers: {
      "content-type": "font/ttf",
      // The file only changes when the image is rebuilt, and the studio asks for it on every load.
      "cache-control": "public, max-age=604800, immutable"
    }
  });
}
