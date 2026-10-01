// Font resolution for the overlay renderer.
//
// This lives in a shared package rather than in the worker because two processes now draw the same
// overlay: the worker rasterises the on-air frame, and the web app renders the studio preview. If
// each resolved its own fonts, "the preview uses the same font as the broadcast" would be a hope.
// Here it is a fact — one candidate list, one pair of environment overrides, one answer.

import { promises as fs } from "node:fs";

export type SceneRenderFont = {
  name: string;
  data: Buffer;
  weight: 400 | 700;
  style: "normal";
};

/** One resolved face: the bytes satori lays out with, and the path they came from. */
export type SceneRenderFontFile = {
  path: string;
  data: Buffer;
};

export type SceneRenderFontFiles = {
  regular: SceneRenderFontFile;
  /** Falls back to the regular face when no bold file is installed, exactly as satori is fed. */
  bold: SceneRenderFontFile;
};

// Families referenced by the layout's typography presets. Every preset resolves to a real loaded
// family; satori drops text silently if a referenced family is missing, so all three are aliased
// onto whatever font files are available rather than left dangling.
//
// Exported because the browser has to alias them the same way: the preview SVG is inlined into the
// page and carries font-family="Stream247 Sans" (and Serif, and Mono) with no embedded outlines, so
// the page's @font-face rules must point all three at the same file the renderer read.
export const OVERLAY_LAYOUT_FONT_FAMILIES = ["Stream247 Sans", "Stream247 Serif", "Stream247 Mono"] as const;

export const OVERLAY_FONT_CANDIDATES = {
  regular: [
    "/usr/share/fonts/TTF/DejaVuSans.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/dejavu/DejaVuSans.ttf"
  ],
  bold: [
    "/usr/share/fonts/TTF/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf"
  ]
} as const;

async function readFirstAvailable(candidates: readonly string[], override: string): Promise<SceneRenderFontFile | null> {
  for (const candidate of [override, ...candidates].filter(Boolean)) {
    try {
      return { path: candidate, data: await fs.readFile(candidate) };
    } catch {
      continue;
    }
  }

  return null;
}

/**
 * Resolves the font files themselves.
 *
 * Separate from loadSceneRendererFonts because the web app needs the raw file to serve it to the
 * browser: an inlined preview SVG without embedded outlines draws nothing until the page has a
 * @font-face for it, and the only way to guarantee it is the *same* font is to hand out the bytes
 * this resolver just read.
 */
export async function resolveSceneRendererFontFiles(env: NodeJS.ProcessEnv): Promise<SceneRenderFontFiles> {
  const regular = await readFirstAvailable(OVERLAY_FONT_CANDIDATES.regular, env.OVERLAY_FONT_REGULAR_PATH || "");
  if (!regular) {
    throw new Error(
      `No overlay font found. Set OVERLAY_FONT_REGULAR_PATH or install a font at one of: ${OVERLAY_FONT_CANDIDATES.regular.join(", ")}`
    );
  }

  const bold = (await readFirstAvailable(OVERLAY_FONT_CANDIDATES.bold, env.OVERLAY_FONT_BOLD_PATH || "")) ?? regular;

  return { regular, bold };
}

/**
 * Loads the font files once. Fonts are the only external input the renderer needs; without at
 * least a regular face satori cannot lay out any text.
 */
export async function loadSceneRendererFonts(env: NodeJS.ProcessEnv): Promise<SceneRenderFont[]> {
  const files = await resolveSceneRendererFontFiles(env);

  return OVERLAY_LAYOUT_FONT_FAMILIES.flatMap<SceneRenderFont>((name) => [
    { name, data: files.regular.data, weight: 400, style: "normal" },
    { name, data: files.bold.data, weight: 700, style: "normal" }
  ]);
}
