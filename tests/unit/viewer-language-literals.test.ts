import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * No viewer-facing literal is left outside the catalogue (M80 acceptance).
 *
 * A source-text guard, and it knows it: it lists the sentences that only ever had a viewer meaning
 * and makes sure none of them is written in a file that builds viewer output any more, so a second
 * copy of one cannot quietly bypass the channel language. Titles the worker keeps in English on
 * purpose — "Replay standby", "Scheduled reconnect", "Live Bridge" in playout state and the as-run
 * log, for the admin — are not listed: they are translated where they leave for viewers
 * (localizeViewerBuiltInText), and the surface tests check that.
 */

const SOURCES = [
  "packages/core/src/index.ts",
  "packages/core/src/overlay-layout.ts",
  "packages/core/src/chat-game.ts",
  "packages/core/src/chat-game-2048.ts",
  "packages/core/src/chat-game-minesweeper.ts",
  "packages/core/src/operator-precedence.ts",
  "apps/worker/src/index.ts",
  "apps/worker/src/chat-control.ts",
  "apps/worker/src/chat-game.ts",
  "apps/worker/src/twitch-engagement.ts",
  "apps/worker/src/twitch-metadata.ts",
  "apps/web/lib/server/state.ts",
  "apps/web/components/overlay-settings-form.tsx",
  "apps/web/app/channel/page.tsx",
  "apps/web/components/live-channel-page.tsx",
  "apps/web/lib/public-channel-view.ts",
  "apps/web/lib/public-programme-calendar.ts"
];

const VIEWER_ONLY_LITERALS = [
  '"Now Playing"',
  '"Insert On Air"',
  '"Live Now"',
  '"Reconnect Window"',
  '"After Insert"',
  '"Returning With"',
  '"After Live"',
  // Without quotes, so a heading typed straight into JSX is found as well as a string.
  "Up next",
  "After that",
  "No next block configured",
  "Nothing scheduled next",
  '"Schedule not available"',
  '"Coming up next"',
  '"Programming will resume shortly"',
  "Program resumes shortly",
  '"Schedule resumes after live mode"',
  "Stand by",
  '"Replay stream"',
  '"Source to be announced"',
  "Chat plays ",
  "Game over",
  "Board cleared",
  "to start the next round",
  "Steer with ",
  "Merge with ",
  "Dig with column",
  "No game is running",
  "No room for the game layer",
  "only a moderator can start",
  "Game stopped.",
  "skip votes are paused",
  "your check-in could not be saved",
  "window set to",
  "Was läuft als Nächstes?",
  "Überspringen?",
  "Weiter zum nächsten Video",
  "in den Chat",
  "Stimmen`",
  "`Now: ${",
  "`Next: ${",
  "`Insert: ${",
  "`After this: ${",
  "`Resuming with: ${",
  "`Queue: ${",
  "`Current: ${",
  "`Later: ${",
  "Live Bridge · ${",
  "item`",
  // The public page /channel. channel-status.ts is not scanned: its "On air", "Starting up" and
  // "Off air" are the admin's English labels, kept apart from the viewer's on purpose.
  "What is live now",
  "All times are shown in",
  "Upcoming lineup",
  "Watch the stream",
  "On air now",
  "No next item published yet",
  "will appear here as soon as",
  "Nothing further is scheduled yet",
  "Updating every few seconds"
];

/**
 * Reachable code that draws nothing today, left English on purpose (M80 inventory, section 11):
 * the metadata widget fallbacks (buildOverlaySceneMetadataWidgetContent, used by tests only) and the
 * payload's schedule teaser fields, which no renderer draws. Listed line by line, so a new use of
 * one of these sentences anywhere else still fails.
 */
const NOT_SHOWN_TODAY = [
  'title: args.payload.nextTitle || "Nothing scheduled next",',
  'label: labelOverride || args.payload.heroLabel || "Now Playing",',
  ': heroBody || "Programming will resume shortly";',
  '? nextTitle || "Schedule resumes after live mode"',
  ': nextTitle || "Programming will resume shortly";',
  '? currentSourceName || "Source to be announced"',
  'scheduleTitle: currentTitle || "Stand by",'
];

describe("viewer-facing literals live in the catalogue", () => {
  it("leaves none of them in a file that builds viewer output", () => {
    const offenders: string[] = [];
    for (const path of SOURCES) {
      const lines = readFileSync(new URL(`../../${path}`, import.meta.url), "utf8").split("\n");
      lines.forEach((line, index) => {
        if (NOT_SHOWN_TODAY.includes(line.trim())) {
          return;
        }
        for (const literal of VIEWER_ONLY_LITERALS) {
          if (line.includes(literal)) {
            offenders.push(`${path}:${index + 1}: ${literal}`);
          }
        }
      });
    }
    expect(offenders).toEqual([]);
  });

  it("still finds the section-11 lines it lets through, so the allowance cannot outlive them", () => {
    const core = readFileSync(new URL("../../packages/core/src/index.ts", import.meta.url), "utf8")
      .split("\n")
      .map((line) => line.trim());
    expect(NOT_SHOWN_TODAY.filter((line) => !core.includes(line))).toEqual([]);
  });
});

/**
 * The public page is JSX, and a list of sentences cannot guard JSX: a heading typed between two
 * tags has no quotes to match, and a word nobody listed ("Schedule") is not looked for at all. So
 * the two files that lay the page out are parsed, and every text a viewer could read must arrive
 * through an expression — `view.*` or `header.*`, built from the catalogue by
 * public-channel-view.ts. A letter in a JSX text node, in a string inside a child expression, or in
 * a prop that carries text fails.
 */
const PUBLIC_PAGE_LAYOUTS = ["apps/web/app/channel/page.tsx", "apps/web/components/live-channel-page.tsx"];

/** Props that never hold words for a reader. Every other prop with a written string is text. */
const NON_TEXT_PROPS = new Set(["className", "href", "rel", "target", "id", "key", "role", "type"]);

function writtenWordsInJsx(path: string, source: string): string[] {
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: string[] = [];
  const report = (node: ts.Node, text: string) => {
    if (/\p{L}/u.test(text)) {
      found.push(`${path}:${file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1}: ${text.trim()}`);
    }
  };
  // `written` is true where a string literal would be shown: inside a child expression or a text prop.
  const visit = (node: ts.Node, written: boolean) => {
    if (ts.isJsxText(node)) {
      report(node, node.text);
      return;
    }
    if (ts.isJsxAttribute(node)) {
      const textProp = !NON_TEXT_PROPS.has(node.name.getText(file));
      if (node.initializer) {
        visit(node.initializer, textProp);
      }
      return;
    }
    if (written && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))) {
      report(node, node.text);
    }
    if (written && ts.isTemplateExpression(node)) {
      report(node, [node.head.text, ...node.templateSpans.map((span) => span.literal.text)].join(" "));
    }
    const childWritten = ts.isJsxExpression(node) && (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent)) ? true : written;
    ts.forEachChild(node, (child) => visit(child, childWritten));
  };
  visit(file, false);
  return found;
}

describe("the public page lays out catalogue texts and writes none of its own", () => {
  const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

  it("has no written word in its JSX", () => {
    expect(PUBLIC_PAGE_LAYOUTS.flatMap((path) => writtenWordsInJsx(path, read(path)))).toEqual([]);
  });

  it("would notice a heading typed back in, quoted or not", () => {
    // The guard is only worth its name if these fail; each is a way the page was written before M80.
    const live = read("apps/web/components/live-channel-page.tsx");
    const page = read("apps/web/app/channel/page.tsx");
    const mutations: [string, string, string, string][] = [
      // M100: the three block cards became the Now card, the next 24 hours and the week.
      ["apps/web/components/live-channel-page.tsx", live, "{view.weekHeading}", "After that"],
      ["apps/web/components/live-channel-page.tsx", live, "{view.nextHeading}", "Up next"],
      ["apps/web/components/live-channel-page.tsx", live, "{view.now.title}", '{view.now.title || "Stand by"}'],
      ["apps/web/components/live-channel-page.tsx", live, "{view.now.detail}", "{`${view.now.detail} to follow`}"],
      ["apps/web/components/live-channel-page.tsx", live, "{group.moreLabel}", "{`${group.moreLabel} more`}"],
      ["apps/web/app/channel/page.tsx", page, "{header.badge}", "Schedule"],
      ["apps/web/app/channel/page.tsx", page, "title={header.lineupTitle}", 'title="Upcoming lineup"']
    ];
    for (const [path, source, from, to] of mutations) {
      expect(source).toContain(from);
      expect({ to, found: writtenWordsInJsx(path, source.replace(from, to)).length }).toEqual({ to, found: 1 });
    }
  });
});
