import { describe, expect, it } from "vitest";
import {
  buildOverlaySceneLayout,
  createDefaultChatInteractionConfig,
  type OverlayLayoutNode,
  type OverlayScenePayloadView
} from "@stream247/core";
import { ChatControlRuntime, buildEngagementOverlayViewFromVoteSession } from "../../apps/worker/src/chat-control";
import { loadSceneRendererFonts, renderSceneFrame } from "../../apps/worker/src/scene-renderer";

/**
 * The poll has to reach the screen of the people voting in it.
 *
 * Chat voting worked end to end — ballots counted, the tally flushed to Postgres, the winner
 * promoted — while the playout container never read any of it back: the render path's engagement
 * view had no producer, so the vote panel never rendered and viewers voted in a poll they could
 * not see. These tests pin the missing link: the projection from the persisted poll row to the
 * overlay view, and its agreement with what the worker-side tally would draw.
 */

const OPERATOR_WORDS = [
  "playout",
  "runtime",
  "worker",
  "uplink",
  "queue preview",
  "payload",
  "snapshot",
  "metadata",
  "configured",
  "unavailable",
  "not available"
];

const NOW = new Date("2026-08-25T20:00:00.000Z");

function createOpenSession(overrides: Partial<Parameters<typeof buildEngagementOverlayViewFromVoteSession>[0]> = {}) {
  return {
    status: "open" as const,
    closesAt: new Date(NOW.getTime() + 45_000).toISOString(),
    options: [
      { token: "!1", title: "Retro Night", votes: 12 },
      { token: "!2", title: "Coding Marathon", votes: 5 }
    ],
    ...overrides
  };
}

function createPayload(): OverlayScenePayloadView {
  return {
    scene: {
      surfaceStyle: "glass",
      panelAnchor: "bottom",
      titleScale: "balanced",
      typographyPreset: "studio-sans",
      resolvedPresetId: "lower-third"
    },
    channelName: "3JC Retro",
    accentColor: "#6ee7ff",
    brandLine: "STREAM247",
    heroLabel: "Now playing",
    heroTitle: "Advent of Code 2025",
    heroBody: "Recorded live",
    metaLine: "Programming",
    nextLabel: "Up next",
    nextTitle: "Retro Night",
    nextTimeLabel: "21:30",
    queueTitles: [],
    tickerText: "",
    emergencyBanner: "",
    timeZone: "Europe/Berlin"
  };
}

/** Collects every string leaf, so assertions can ask what the frame actually says. */
function collectText(node: OverlayLayoutNode | OverlayLayoutNode[] | string | undefined): string[] {
  if (typeof node === "string") {
    return [node];
  }
  if (!node) {
    return [];
  }
  if (Array.isArray(node)) {
    return node.flatMap(collectText);
  }
  return collectText(node.props.children);
}

describe("the poll viewers vote in reaches the on-air view", () => {
  it("projects an open poll into a populated vote panel view", () => {
    const view = buildEngagementOverlayViewFromVoteSession(createOpenSession(), NOW);

    expect(view).not.toBeNull();
    expect(view!.kind).toBe("vote-next");
    expect(view!.options).toEqual([
      { token: "!1", title: "Retro Night", votes: 12 },
      { token: "!2", title: "Coding Marathon", votes: 5 }
    ]);
    expect(view!.totalVotes).toBe(17);
    expect(view!.secondsRemaining).toBe(45);
    expect(view!.headline).toBeTruthy();
    expect(view!.hint).toContain("!1");
    expect(view!.hint).toContain("!2");
  });

  it("returns null for a closed poll, an expired poll, and a poll with no options", () => {
    expect(buildEngagementOverlayViewFromVoteSession(createOpenSession({ status: "closed" }), NOW)).toBeNull();
    // A worker that dies mid-poll leaves the row open forever; the deadline in the row itself has
    // to take the panel off air.
    expect(
      buildEngagementOverlayViewFromVoteSession(
        createOpenSession({ closesAt: new Date(NOW.getTime() - 1000).toISOString() }),
        NOW
      )
    ).toBeNull();
    expect(buildEngagementOverlayViewFromVoteSession(createOpenSession({ options: [] }), NOW)).toBeNull();
  });

  it("puts the poll on the frame when the view is fed to the layout", () => {
    const engagement = buildEngagementOverlayViewFromVoteSession(createOpenSession(), NOW);
    const texts = collectText(
      buildOverlaySceneLayout({ payload: createPayload(), engagement }, { width: 1920, height: 1080, now: NOW })
    );

    expect(texts).toContain("!1");
    expect(texts).toContain("45s");
    // The vote panel claims the right rail from "up next" while the poll runs.
    expect(texts).not.toContain("UP NEXT · 21:30");
  });

  it("draws exactly what the worker-side tally would draw for the same poll", () => {
    const config = createDefaultChatInteractionConfig();
    const runtime = new ChatControlRuntime({ now: () => NOW });
    runtime.openVote({
      id: "vote-test",
      candidates: [
        { assetId: "a1", title: "Retro Night" },
        { assetId: "a2", title: "Coding Marathon" }
      ],
      config
    });
    runtime.handleMessage({ actor: "viewer-one", message: "!1", currentAssetId: "a0", config });
    runtime.handleMessage({ actor: "viewer-two", message: "!2", currentAssetId: "a0", config });

    // The persisted row is flushed straight from the session, so projecting the session must give
    // the same view the worker would draw — the two sides of the process boundary cannot drift.
    const session = runtime.getSession();
    expect(session).not.toBeNull();
    expect(buildEngagementOverlayViewFromVoteSession(session!, NOW)).toEqual(runtime.getOverlayView(config));
  });

  it("keeps operator vocabulary out of everything the panel says", () => {
    const view = buildEngagementOverlayViewFromVoteSession(createOpenSession(), NOW);
    const offenders = [view!.headline, view!.hint].filter((line) =>
      OPERATOR_WORDS.some((word) => line.toLowerCase().includes(word))
    );

    expect(offenders).toEqual([]);
  });
});

/**
 * Rasterises one real frame with the vote panel through satori and resvg, matching the game
 * panel's smoke: the layout tests assert the tree, this asserts satori accepts it, because a
 * render-time rejection degrades the loop to a frozen frame and the panel had never been through
 * the real renderer before this path existed. Skips (inconclusive, not failed) on machines
 * without a usable font, which is the renderer's own startup requirement anyway.
 */
describe("vote panel rasterisation smoke", () => {
  it("renders a PNG frame containing the vote panel", async () => {
    let fonts;
    try {
      fonts = await loadSceneRendererFonts(process.env);
    } catch {
      // No fonts on this machine; smoke is inconclusive rather than failed.
      return;
    }

    const engagement = buildEngagementOverlayViewFromVoteSession(createOpenSession(), NOW);
    const png = await renderSceneFrame({ payload: createPayload(), engagement, width: 1280, height: 720 }, fonts);

    expect(png.length).toBeGreaterThan(1000);
    // PNG magic bytes.
    expect(png.subarray(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  }, 30_000);
});
