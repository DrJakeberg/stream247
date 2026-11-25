import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import * as React from "../../apps/web/node_modules/react";
import { renderToStaticMarkup } from "../../apps/web/node_modules/react-dom/server";
import type { DestinationRoutingStatus } from "@stream247/core";
import { createInitialSeedState } from "@stream247/db";

// M129 (suggestions 24 and 25): every output row and every source row starts with a badge that says its
// state in words, an outage wears its own critical tone, and destructive buttons look destructive.

vi.mock("../../apps/web/node_modules/next/navigation", () => ({
  useRouter: () => ({ refresh: () => undefined, push: () => undefined, replace: () => undefined }),
  usePathname: () => "/live"
}));

vi.mock("../../apps/web/node_modules/next/link", () => ({
  default: (props: { href: string; children?: unknown }) => React.createElement("a", { href: props.href }, props.children as never)
}));

import { BroadcastControlRoom } from "../../apps/web/components/broadcast-control-room";
import { PlayoutActionForm } from "../../apps/web/components/playout-action-form";
import { RowStateBadge } from "../../apps/web/components/row-state-badge";
import { SourcesWorkspacePanels } from "../../apps/web/components/admin-workspace-sections";
import { ToastProvider } from "../../apps/web/components/ui/Toast";
import { ROW_STATE_LABELS, destinationRowState, sourceRowState, sourceRowStateOf } from "../../apps/web/lib/row-state";
import { getBroadcastSnapshot, type AppState } from "../../apps/web/lib/server/state";

// The web components are compiled with the classic JSX runtime here.
(globalThis as { React?: unknown }).React = React;

const globalsCss = readFileSync(path.join(process.cwd(), "apps/web/app/globals.css"), "utf8");

/** The CSS block of one exact selector, e.g. `.button:disabled`. */
function cssBlock(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return globalsCss.match(new RegExp(`(?:^|\\n)${escaped} \\{([^}]*)\\}`))?.[1] ?? "";
}

/** Each `.item` of the list under the given panel heading, as its opening markup up to the first `<strong>`. */
function itemHeads(html: string, heading: string): string[] {
  const panel = html.slice(html.indexOf(`<h3>${heading}</h3>`));
  const list = panel.slice(0, panel.indexOf("</article>"));
  return list
    .split('<div class="item"')
    .slice(1)
    .map((item) => item.slice(0, item.indexOf("<strong>")));
}

const BADGE_FOR = {
  Ready: "badge badge-ready",
  "Needs setup": "badge badge-action",
  Failing: "badge badge-critical"
} as const;

function badgeHead(text: keyof typeof BADGE_FOR): string {
  return `<span class="${BADGE_FOR[text]}">${text}</span>`;
}

const healthy = { enabled: true, urlUsable: true, breakerHeld: false, lastRunStatus: "success", droughtAlerting: false };

describe("row state", () => {
  it("decides a destination's state only by its stored routing status", () => {
    const expected = {
      ready: "ready",
      "missing-config": "needs-setup",
      error: "failing",
      recovering: "failing"
    } satisfies Record<DestinationRoutingStatus, string>;
    for (const [status, state] of Object.entries(expected)) {
      expect(destinationRowState(status as DestinationRoutingStatus)).toBe(state);
    }
  });

  it("decides a source's state: failing first, then needs setup, otherwise ready", () => {
    expect(sourceRowState(healthy)).toBe("ready");
    // A source still waiting for its first scan has no run yet and is not an outage.
    expect(sourceRowState({ ...healthy, lastRunStatus: "" })).toBe("ready");
    expect(sourceRowState({ ...healthy, lastRunStatus: "skipped" })).toBe("ready");
    expect(sourceRowState({ ...healthy, breakerHeld: true })).toBe("failing");
    expect(sourceRowState({ ...healthy, lastRunStatus: "error" })).toBe("failing");
    expect(sourceRowState({ ...healthy, droughtAlerting: true })).toBe("failing");
    expect(sourceRowState({ ...healthy, enabled: false })).toBe("needs-setup");
    expect(sourceRowState({ ...healthy, urlUsable: false })).toBe("needs-setup");
    expect(sourceRowState({ ...healthy, enabled: false, urlUsable: false, lastRunStatus: "error" })).toBe("failing");
  });

  it("reads the source inputs the same way for the list and the detail page", () => {
    const snapshot = { breaker: null, latestRun: null, health: { alerting: false } };
    expect(sourceRowStateOf({}, snapshot, { isValidUrl: true })).toBe("ready");
    expect(sourceRowStateOf({ enabled: false }, snapshot, { isValidUrl: true })).toBe("needs-setup");
    expect(sourceRowStateOf({}, { ...snapshot, latestRun: { status: "error" } }, { isValidUrl: false })).toBe("failing");
    expect(sourceRowStateOf({}, { ...snapshot, breaker: { phase: "open" } }, { isValidUrl: true })).toBe("failing");
    expect(sourceRowStateOf({}, { ...snapshot, health: { alerting: true } }, { isValidUrl: true })).toBe("failing");
  });

  it("renders the state in the badge's words and class, never colour alone", () => {
    expect(ROW_STATE_LABELS).toEqual({ ready: "Ready", "needs-setup": "Needs setup", failing: "Failing" });
    expect(renderToStaticMarkup(React.createElement(RowStateBadge, { state: "ready" }))).toBe(badgeHead("Ready"));
    expect(renderToStaticMarkup(React.createElement(RowStateBadge, { state: "needs-setup" }))).toBe(badgeHead("Needs setup"));
    expect(renderToStaticMarkup(React.createElement(RowStateBadge, { state: "failing" }))).toBe(badgeHead("Failing"));
  });
});

describe("Sending to Twitch rows", () => {
  function render(statuses: DestinationRoutingStatus[]) {
    const seed = getBroadcastSnapshot(createInitialSeedState());
    const template = seed.destinations[0];
    const destinations = statuses.map((status, index) => ({ ...template, id: `d${index}`, name: `Output ${index}`, status }));
    const snapshot = { ...seed, destination: destinations[0] ?? null, destinations };
    return renderToStaticMarkup(React.createElement(BroadcastControlRoom, { initialSnapshot: snapshot, assets: [] }));
  }

  it("starts the lead row and every output row with its state badge", () => {
    const heads = itemHeads(render(["ready", "missing-config", "error", "recovering"]), "Sending to Twitch");
    expect(heads).toEqual([
      `>${badgeHead("Ready")} `,
      `>${badgeHead("Ready")} `,
      `>${badgeHead("Needs setup")} `,
      `>${badgeHead("Failing")} `,
      `>${badgeHead("Failing")} `
    ]);
  });

  it("reads Needs setup on the lead row when no destination exists", () => {
    expect(itemHeads(render([]), "Sending to Twitch")).toEqual([`>${badgeHead("Needs setup")} `]);
  });
});

describe("Source connector rows", () => {
  it("starts every source row with its state badge and keeps the stored status as plain text", () => {
    const seed = createInitialSeedState();
    const base = seed.sources[0];
    const state: AppState = {
      ...seed,
      sources: [
        { ...base, id: "s-ready", name: "Ready source", connectorKind: "local-library", externalUrl: "", enabled: true, status: "Pending scan" },
        { ...base, id: "s-off", name: "Disabled source", connectorKind: "local-library", externalUrl: "", enabled: false, status: "Ready" },
        { ...base, id: "s-bad", name: "Bad URL source", connectorKind: "youtube-playlist", externalUrl: "https://example.com", enabled: true, status: "Invalid URL" }
      ],
      sourceSyncRuns: [
        { ...(seed.sourceSyncRuns[0] ?? {}), id: "r1", sourceId: "s-bad", startedAt: "2026-11-25T10:00:00.000Z", finishedAt: "2026-11-25T10:01:00.000Z", status: "error", summary: "Failed", discoveredAssets: 0, readyAssets: 0, errorMessage: "boom" } as AppState["sourceSyncRuns"][number]
      ]
    };
    const html = renderToStaticMarkup(
      React.createElement(ToastProvider, null, React.createElement(SourcesWorkspacePanels, { state }))
    );
    // The source rows, without the example rows of the folded "Change this source" forms.
    const rows = html
      .split('<div class="item"')
      .slice(1)
      .filter((item) => item.startsWith('><div class="stack-form">'))
      .map((item) => item.slice(0, item.indexOf("</strong>")));
    expect(rows).toEqual([
      `><div class="stack-form"><div>${badgeHead("Ready")} <strong>Ready source`,
      `><div class="stack-form"><div>${badgeHead("Needs setup")} <strong>Disabled source`,
      `><div class="stack-form"><div>${badgeHead("Failing")} <strong>Bad URL source`
    ]);
    // One state pill per row: the worker's free-text status is no longer a second badge.
    expect(html).toContain('<span class="subtle">Pending scan</span>');
    expect(html).not.toContain('<span class="badge">Pending scan</span>');
  });

  it("puts the same badge before the name on the source detail page", () => {
    const source = readFileSync(path.join(process.cwd(), "apps/web/app/(admin)/sources/[id]/page.tsx"), "utf8").replace(/\s+/g, " ");
    expect(source).toContain('<div className="stats-row"> <RowStateBadge state={sourceRowStateOf(source, health, diagnostics)} /> <h2>{source.name}</h2>');
    const list = readFileSync(path.join(process.cwd(), "apps/web/components/admin-workspace-sections.tsx"), "utf8");
    expect(list).toContain("sourceRowStateOf(source, snapshot, getSourceConnectorDiagnostics(state, source.id))");
  });
});

describe("dangerous and disabled buttons", () => {
  it("draws Remove next as a danger button", () => {
    const html = renderToStaticMarkup(
      React.createElement(PlayoutActionForm, { assets: [{ id: "A", title: "Item A" }], overrideMode: "schedule", nextAssetId: "A" })
    );
    expect(html.match(/<button class="([^"]*)"[^>]*>Remove next<\/button>/)?.[1]).toBe("button button-danger");
  });

  it("draws Delete curated set as a danger button", () => {
    const source = readFileSync(path.join(process.cwd(), "apps/web/components/asset-library-browser.tsx"), "utf8");
    const button = source.slice(0, source.indexOf("Delete curated set"));
    expect(button.slice(button.lastIndexOf("<button"))).toContain('className="button button-danger"');
  });

  it("gives the critical badge the existing critical tone tokens", () => {
    expect(cssBlock(".badge-critical").replace(/\s+/g, " ").trim()).toBe(
      "background: var(--tone-critical-bg); color: var(--tone-critical-fg);"
    );
  });

  it("fades a disabled button further and hides its border", () => {
    const block = cssBlock(".button:disabled");
    const opacity = Number(block.match(/opacity:\s*([\d.]+)/)?.[1]);
    expect(opacity).toBeLessThan(0.7);
    expect(block).toMatch(/border-color:\s*transparent;/);
    expect(block).toMatch(/cursor:\s*not-allowed;/);
  });
});
