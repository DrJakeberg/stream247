import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { viewerText, viewerUpperCase, type ViewerMessageKey, type ViewerMessageParams } from "@stream247/core";
import { loadSceneRendererFonts, type SceneRenderFont } from "@stream247/overlay-render";

/**
 * German is longer than English, and the on-air panels are not elastic (M80).
 *
 * A text that does not fit its row does not overflow politely: satori shrinks the label and wraps
 * it, the header grows a line, and the board or the bars underneath lose the height the layout
 * reserved for them. Character clamps in overlay-layout.ts do not catch this — "ÜBERSPRINGEN?" is
 * thirteen characters and the clamp is forty — so every viewer text that shares a row with
 * something else is measured here in the renderer's own fonts and compared with the room the
 * layout gives it on the 1920x1080 design grid.
 *
 * The contract is "German fits where English fits, and never needs more room than English where
 * English already does not": the panels were sized for English, and M80 must not make any of them
 * worse.
 *
 * The room is taken from overlay-layout.ts: the vote panel is 520 wide with 24 padding a side; the
 * next card at most 520 with 20; a chat game box is the provisioned default of 30% of 1920 with 18
 * padding a side; the header chips' paddings are their own.
 */

const VOTE_INNER = 520 - 2 * 24;
const NEXT_INNER = 520 - 2 * 20;
const GAME_INNER = Math.round(1920 * 0.3) - 2 * 18;

type Style = { fontSize: number; fontWeight?: number; letterSpacing?: number };

let fonts: SceneRenderFont[] = [];
let satori: (element: unknown, options: Record<string, unknown>) => Promise<string>;

// satori is the render package's dependency, not the repository's; resolved from there rather
// than added to the root manifest for a test.
async function loadSatori() {
  const requireFromRender = createRequire(path.resolve(import.meta.dirname, "../../packages/render/package.json"));
  const module = (await import(pathToFileURL(requireFromRender.resolve("satori")).href)) as { default: typeof satori };
  return module.default;
}

/** The horizontal extent of the glyph outlines satori draws for one line of text. */
async function inkWidth(value: string, style: Style): Promise<number> {
  const svg = await satori(
    {
      type: "div",
      props: {
        style: { display: "flex", width: 4000, height: 120 },
        children: [
          {
            type: "div",
            props: { style: { display: "flex", whiteSpace: "nowrap", fontFamily: "DejaVu Sans", ...style }, children: value }
          }
        ]
      }
    },
    { width: 4000, height: 120, fonts, embedFont: true }
  );
  const xs: number[] = [];
  for (const match of svg.matchAll(/ d="([^"]+)"/g)) {
    const numbers = (match[1]!.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
    for (let index = 0; index < numbers.length; index += 2) {
      xs.push(numbers[index]!);
    }
  }
  return xs.length > 0 ? Math.max(...xs) - Math.min(...xs) : 0;
}

function text(locale: string, key: ViewerMessageKey, params: ViewerMessageParams = {}, upper = false): string {
  const value = viewerText(locale, key, params);
  return upper ? viewerUpperCase(locale, value) : value;
}

/** One row: what it holds in each language, measured, and the room it has. */
async function row(build: (locale: string) => Promise<number>, room: number) {
  const english = await build("en");
  const german = await build("de");
  return { english: Math.round(english), german: Math.round(german), room, allowed: Math.max(room, Math.round(english)) };
}

const HEADER: Style = { fontSize: 20, fontWeight: 700, letterSpacing: 2 };
const CHIP: Style = { fontSize: 20, fontWeight: 700 };
const GAME_HEADLINE: Style = { fontSize: 18, fontWeight: 700, letterSpacing: 2 };
const GAME_STATUS: Style = { fontSize: 17, fontWeight: 700 };

describe("German viewer texts fit the on-air panels", () => {
  beforeAll(async () => {
    satori = await loadSatori();
    fonts = await loadSceneRendererFonts(process.env);
  });

  it("the poll and skip headers leave room for the countdown chip", async () => {
    for (const key of ["vote.headline", "skip.headline"] as const) {
      const measured = await row(
        async (locale) =>
          (await inkWidth(text(locale, key, {}, true), HEADER)) +
          (await inkWidth(text(locale, "overlay.countdown", { seconds: 120 }), CHIP)) +
          2 * 12,
        VOTE_INNER
      );
      expect({ key, ...measured, fits: measured.german <= measured.allowed }).toMatchObject({ key, fits: true });
    }
  });

  it("the poll hint, the skip progress and the skip option fit the vote panel", async () => {
    const hint = await row((locale) => inkWidth(text(locale, "vote.hint", { tokens: "!1, !2, !3, !4, !5" }), { fontSize: 17 }), VOTE_INNER);
    const progress = await row(
      (locale) => inkWidth(text(locale, "skip.progress", { votes: 99, count: 100 }), { fontSize: 17 }),
      VOTE_INNER
    );
    // token chip "!skip" (17 bold, 9 padding a side), a 10 gap, the title at 21, the count at 19.
    const option = await row(
      async (locale) =>
        (await inkWidth("!skip", { fontSize: 17, fontWeight: 700 })) +
        18 +
        10 +
        (await inkWidth(text(locale, "skip.option"), { fontSize: 21 })) +
        (await inkWidth("100", { fontSize: 19 })),
      VOTE_INNER
    );
    for (const [name, measured] of Object.entries({ hint, progress, option })) {
      expect({ name, fits: measured.german <= measured.allowed, ...measured }).toMatchObject({ name, fits: true });
    }
  });

  it("every game header — headline, gap, status chip — fits the default game box", async () => {
    const games = [
      { game: "snake" as const, statuses: [["game.status.score", { count: 42 }], ["game.status.over", { count: 42 }]] },
      { game: "2048" as const, statuses: [["game.status.score", { count: 20480 }], ["game.status.over", { count: 20480 }]] },
      {
        game: "minesweeper" as const,
        statuses: [
          ["game.status.progress", { cleared: 512, total: 576 }],
          ["game.status.over", { count: 512 }],
          ["game.status.cleared", { count: 576 }]
        ]
      }
    ];
    for (const { game, statuses } of games) {
      for (const [status, params] of statuses as [ViewerMessageKey, ViewerMessageParams][]) {
        const measured = await row(
          async (locale) =>
            (await inkWidth(text(locale, "game.headline", { game: text(locale, `game.name.${game}`) }, true), GAME_HEADLINE)) +
            12 +
            (await inkWidth(text(locale, status, params), GAME_STATUS)) +
            2 * 10,
          GAME_INNER
        );
        expect({ game, status, fits: measured.german <= measured.allowed, ...measured }).toMatchObject({ game, status, fits: true });
      }
    }
  });

  it("the game hints and the next card's heading fit their panels", async () => {
    const hints: [ViewerMessageKey, ViewerMessageParams][] = [
      ["game.hint.minesweeper", { lastColumn: "z", lastRow: 18 }],
      ["game.hint.snake", { emotes: "⬆ ⬇ ⬅ ➡" }],
      ["game.hint.2048", { emotes: "⬆ ⬇ ⬅ ➡" }],
      ["game.hint.arrowRestart", {}],
      ["game.hint.cellRestart", {}]
    ];
    for (const [key, params] of hints) {
      const measured = await row((locale) => inkWidth(text(locale, key, params), { fontSize: 16 }), GAME_INNER);
      expect({ key, fits: measured.german <= measured.allowed, ...measured }).toMatchObject({ key, fits: true });
    }

    for (const label of ["overlay.nextLabel.asset", "overlay.nextLabel.reconnect", "overlay.nextLabel.insert"] as const) {
      const measured = await row(
        (locale) =>
          inkWidth(viewerUpperCase(locale, `${text(locale, label)} · ${text(locale, "overlay.next.noBlock")}`), {
            fontSize: 16,
            fontWeight: 700,
            letterSpacing: 2
          }),
        NEXT_INNER
      );
      expect({ label, fits: measured.german <= measured.allowed, ...measured }).toMatchObject({ label, fits: true });
    }
  });
});
