import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import * as React from "../../apps/web/node_modules/react";
import { renderToStaticMarkup } from "../../apps/web/node_modules/react-dom/server";
import { createInitialSeedState } from "@stream247/db";

// M104 wording pass (planning/research/ux-install.md U13, U14 and the stopped planning branch's S19):
// admin text names no milestone ids, the admin shows the standby text viewers actually read, and the
// Scene tab says first whether overlay output is on and that nothing was published yet.

vi.mock("../../apps/web/node_modules/next/navigation", () => ({
  useRouter: () => ({ refresh: () => undefined, push: () => undefined }),
  usePathname: () => "/studio"
}));

vi.mock("../../apps/web/node_modules/next/link", () => ({
  default: (props: { href: string; children?: unknown }) => React.createElement("a", { href: props.href }, props.children as never)
}));

import { OverlaySettingsForm } from "../../apps/web/components/overlay-settings-form";
import { ToastProvider } from "../../apps/web/components/ui/Toast";
import { describeOnAirWording, describeOverlayHeadlines } from "../../apps/web/lib/overlay-headline-wording";

// The web components are compiled with the classic JSX runtime here.
(globalThis as { React?: unknown }).React = React;

/** A milestone id as the proposal's U13 check names it. */
const MILESTONE_ID = /\bM\d{2}\b/;

const ROOT = new URL("../../", import.meta.url);

function walk(directory: string, found: string[] = []): string[] {
  for (const name of readdirSync(directory)) {
    if (name === "node_modules" || name === ".next") {
      continue;
    }
    const full = path.join(directory, name);
    if (statSync(full).isDirectory()) {
      walk(full, found);
    } else if (/\.tsx?$/.test(name) && !name.endsWith(".d.ts")) {
      found.push(full);
    }
  }
  return found;
}

/**
 * Every piece of text the admin can show, from the web app's source: JSX text, string literals and
 * template parts. Comments are not text a reader sees, so they are not read; they may cite the
 * milestone a decision came from.
 */
function adminTexts(): Array<{ at: string; text: string }> {
  const texts: Array<{ at: string; text: string }> = [];
  for (const directory of ["apps/web/app", "apps/web/components", "apps/web/lib"]) {
    for (const file of walk(new URL(directory, ROOT).pathname)) {
      const source = readFileSync(file, "utf8");
      const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
      const visit = (node: ts.Node) => {
        if (
          ts.isJsxText(node) ||
          ts.isStringLiteral(node) ||
          ts.isNoSubstitutionTemplateLiteral(node) ||
          ts.isTemplateHead(node) ||
          ts.isTemplateMiddle(node) ||
          ts.isTemplateTail(node)
        ) {
          const line = parsed.getLineAndCharacterOfPosition(node.getStart(parsed)).line + 1;
          texts.push({ at: `${path.relative(ROOT.pathname, file)}:${String(line)}`, text: node.text });
        }
        ts.forEachChild(node, visit);
      };
      visit(parsed);
    }
  }
  return texts;
}

describe("U13: admin text names no milestone ids", () => {
  it("finds none in the text the web app can show", () => {
    const texts = adminTexts();
    // The scan has to see the admin's words, or it passes by reading nothing.
    expect(texts.some((entry) => entry.text.includes("Twitch reconnect note"))).toBe(true);
    expect(texts.filter((entry) => MILESTONE_ID.test(entry.text)).map((entry) => `${entry.at}: ${entry.text.trim()}`)).toEqual([]);
  });

  it("finds none in the rendered admin pages the wording baseline recorded", () => {
    const directory = new URL("tests/e2e/wording-baseline.spec.ts-snapshots/", ROOT);
    const pages = readdirSync(directory).filter((name) => name.endsWith(".txt"));
    expect(pages).toContain("studio-engagement-chromium-linux.txt");
    const offenders = pages.flatMap((name) =>
      readFileSync(new URL(name, directory), "utf8")
        .split("\n")
        .filter((line) => MILESTONE_ID.test(line))
        .map((line) => `${name}: ${line}`)
    );
    expect(offenders).toEqual([]);
  });

  it("would notice the old Engagement note", () => {
    expect(MILESTONE_ID.test("Broadcasters connected before M32 must reconnect Twitch once")).toBe(true);
    expect(MILESTONE_ID.test("missing the post-M32 Twitch reconnect")).toBe(true);
  });
});

function renderSceneForm(overrides: { locale: string; live?: Partial<ReturnType<typeof createInitialSeedState>["overlay"]>; basedOnUpdatedAt?: string }) {
  const overlay = createInitialSeedState().overlay;
  const live = { ...overlay, ...overrides.live };
  return renderToStaticMarkup(
    React.createElement(
      ToastProvider,
      null,
      React.createElement(OverlaySettingsForm, {
        liveOverlay: live,
        draftOverlay: live,
        scenePresets: [],
        hasUnpublishedChanges: false,
        basedOnUpdatedAt: overrides.basedOnUpdatedAt ?? "",
        outputSize: { width: 1920, height: 1080 },
        preview: {
          timeZone: "Europe/Berlin",
          locale: overrides.locale,
          currentTitle: "Morning Replay",
          currentCategory: "Archive",
          currentSourceName: "Archive Pool",
          nextTitle: "Next replay block",
          nextTimeLabel: "",
          queueTitles: []
        }
      } as never)
    ) as never
  );
}

/** The markup as text, entities decoded for the few characters the catalogue uses. */
function text(html: string): string {
  return html.replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
}

describe("U14: the admin shows the standby text viewers read", () => {
  it("stores the old default, which never airs as written", () => {
    expect(createInitialSeedState().overlay.standbyHeadline).toBe("Please wait, restream is starting");
  });

  it("names the localized default in the (i) and under the field, and in both scene summaries", () => {
    const german = text(renderSceneForm({ locale: "de", live: { updatedAt: "2026-10-04T10:00:00.000Z" } }));
    expect(german).toContain("cleared, it goes back to Kurze Pause – gleich geht’s weiter.");
    expect(german).toContain("Viewers see: Kurze Pause – gleich geht’s weiter");
    expect(german).toContain("Standby Kurze Pause – gleich geht’s weiter · Reconnect");
    expect(german).not.toContain("Please wait, restream is starting.");
    expect(german).not.toContain("Standby Please wait, restream is starting");

    const english = text(renderSceneForm({ locale: "en", live: { updatedAt: "2026-10-04T10:00:00.000Z" } }));
    expect(english).toContain("cleared, it goes back to Stand by, we’ll be right back.");
    expect(english).toContain("Viewers see: Stand by, we’ll be right back");
  });

  it("says nothing extra for a headline the operator wrote", () => {
    expect(describeOnAirWording("Gleich zurück mit Musik", "de")).toBeNull();
    expect(describeOnAirWording("Please wait, restream is starting", "en")).toBe("Stand by, we’ll be right back");
    // The catalogue's own current English is what airs on an English channel: nothing to add.
    expect(describeOnAirWording("Stand by, we’ll be right back", "en")).toBeNull();
  });

  it("summarises the four headlines as they air, as the control room shows them", () => {
    const overlay = createInitialSeedState().overlay;
    expect(describeOverlayHeadlines(overlay, "de")).toBe(
      "Asset headline Rund um die Uhr auf Sendung · Insert Einspieler läuft · Standby Kurze Pause – gleich geht’s weiter · Reconnect Der Stream verbindet sich neu – gleich geht’s weiter"
    );
    expect(describeOverlayHeadlines({ ...overlay, standbyHeadline: "Back at eight" }, "de")).toContain("Standby Back at eight ·");
  });

  it("feeds the control room's overlay panel from the snapshot's channel language", () => {
    const room = readFileSync(new URL("apps/web/components/broadcast-control-room.tsx", ROOT), "utf8");
    expect(room).toContain("describeOverlayHeadlines(snapshot.overlay, snapshot.locale)");
    const state = readFileSync(new URL("apps/web/lib/server/state.ts", ROOT), "utf8");
    expect(state).toContain("locale: getViewerLocale(state),");
  });
});

describe("S19: the Scene tab says first whether overlay output is on", () => {
  it("opens with an off banner and Not published yet before a first publish, never unknown or never", () => {
    const html = text(renderSceneForm({ locale: "en", live: { enabled: false, updatedAt: "" } }));
    const banner = html.indexOf("scene-output-banner");
    expect(banner).toBeGreaterThan(-1);
    expect(banner).toBeLessThan(html.indexOf("scene-workspace-toolbar"));
    expect(html).toContain("Overlay output is off");
    expect(html).toContain("Not published yet");
    expect(html).not.toMatch(/updated at unknown|Published never/);
  });

  it("says on, and the publish times, once a scene is published", () => {
    const html = text(
      renderSceneForm({ locale: "en", live: { enabled: true, updatedAt: "2026-10-04T10:00:00.000Z" }, basedOnUpdatedAt: "2026-10-04T10:00:00.000Z" })
    );
    expect(html).toContain("Overlay output is on");
    expect(html).toContain("Published 2026-10-04T10:00:00.000Z");
    expect(html).toContain("Draft is based on live scene updated at 2026-10-04T10:00:00.000Z.");
    expect(html).not.toContain("Not published yet");
  });
});
