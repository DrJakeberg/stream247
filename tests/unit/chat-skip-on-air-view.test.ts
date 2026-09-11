import { describe, expect, it } from "vitest";
import {
  buildOverlaySceneLayout,
  createDefaultChatInteractionConfig,
  type OverlayLayoutNode,
  type OverlayScenePayloadView
} from "@stream247/core";
import {
  ChatControlRuntime,
  buildEngagementOverlayViewFromSkipVote,
  buildEngagementOverlayViewFromVoteSession,
  chooseEngagementOverlayView
} from "../../apps/worker/src/chat-control";
import { loadSceneRendererFonts, renderSceneFrame } from "../../apps/worker/src/scene-renderer";

/**
 * Skip progress has to reach the screen of the people producing it.
 *
 * The vote overlay went through this once already: everything worked worker-side while the render
 * path had no producer. Skip votes had the same gap one layer earlier — the tally was never even
 * persisted, so the playout container had nothing to read and viewers typing !skip rallied nobody.
 * These tests pin the projection from the persisted campaign row to the overlay view, its refusal
 * to resurrect a stale row after a worker restart, and how the one panel slot is shared with the
 * poll.
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

function createCampaign(overrides: Partial<Parameters<typeof buildEngagementOverlayViewFromSkipVote>[0]> = {}) {
  return {
    assetId: "asset-1",
    skipCommand: "skip",
    votes: 3,
    votesNeeded: 5,
    expiresAt: new Date(NOW.getTime() + 90_000).toISOString(),
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

describe("the skip campaign viewers vote in reaches the on-air view", () => {
  it("projects a collecting campaign into a populated skip panel view", () => {
    const view = buildEngagementOverlayViewFromSkipVote(createCampaign(), NOW);

    expect(view).not.toBeNull();
    expect(view!.kind).toBe("skip-vote");
    expect(view!.options).toHaveLength(1);
    expect(view!.options[0]).toMatchObject({ token: "!skip", votes: 3 });
    // The single bar reads as progress toward passing, so the denominator is the threshold.
    expect(view!.totalVotes).toBe(5);
    expect(view!.threshold).toBe(5);
    expect(view!.secondsRemaining).toBe(90);
    expect(view!.headline).toBeTruthy();
    expect(view!.hint).toContain("3");
    expect(view!.hint).toContain("5");
  });

  it("shows the operator's own command word, not a hardcoded one", () => {
    const view = buildEngagementOverlayViewFromSkipVote(createCampaign({ skipCommand: "weiter" }), NOW);

    expect(view!.options[0]?.token).toBe("!weiter");
  });

  it("returns null for a cleared row and for one with a broken deadline", () => {
    expect(buildEngagementOverlayViewFromSkipVote(createCampaign({ votes: 0 }), NOW)).toBeNull();
    expect(buildEngagementOverlayViewFromSkipVote(createCampaign({ votesNeeded: 0 }), NOW)).toBeNull();
    expect(buildEngagementOverlayViewFromSkipVote(createCampaign({ expiresAt: "" }), NOW)).toBeNull();
    expect(buildEngagementOverlayViewFromSkipVote(createCampaign({ expiresAt: "not-a-date" }), NOW)).toBeNull();
  });

  it("refuses to fabricate progress from a row older than its own window", () => {
    // The tally lives in worker memory; after a worker restart the persisted numbers are the only
    // trace of a campaign that no longer exists. A row whose window has lapsed must render
    // nothing — resurrecting it would show viewers a campaign they can no longer join.
    const stale = createCampaign({ expiresAt: new Date(NOW.getTime() - 1_000).toISOString() });

    expect(buildEngagementOverlayViewFromSkipVote(stale, NOW)).toBeNull();
    // The boundary itself counts as lapsed, so a frame rendered at the exact deadline shows
    // nothing rather than a 0s campaign.
    expect(
      buildEngagementOverlayViewFromSkipVote(createCampaign({ expiresAt: NOW.toISOString() }), NOW)
    ).toBeNull();
  });

  it("puts the campaign on the frame when the view is fed to the layout", () => {
    const engagement = buildEngagementOverlayViewFromSkipVote(createCampaign(), NOW);
    const texts = collectText(
      buildOverlaySceneLayout({ payload: createPayload(), engagement }, { width: 1920, height: 1080, now: NOW })
    );

    expect(texts).toContain("!skip");
    expect(texts).toContain("90s");
    // The skip panel claims the right rail from "up next" while the campaign runs.
    expect(texts).not.toContain("UP NEXT · 21:30");
  });

  it("draws exactly what the worker-side tally would draw for the same campaign", () => {
    const config = { ...createDefaultChatInteractionConfig(), enabled: true, skipMinimumVotes: 5 };
    const runtime = new ChatControlRuntime({ now: () => NOW });
    runtime.handleMessage({ actor: "viewer-one", message: "!skip", currentAssetId: "asset-1", config });
    runtime.handleMessage({ actor: "viewer-two", message: "!skip", currentAssetId: "asset-1", config });

    // The persisted row is flushed straight from this snapshot, so projecting the snapshot must
    // give the same view the worker would draw — the two sides of the process boundary cannot
    // drift.
    const record = runtime.getSkipVoteRecord(config);
    expect(record).not.toBeNull();
    expect(buildEngagementOverlayViewFromSkipVote(record!, NOW)).toEqual(runtime.getOverlayView(config));
  });

  it("keeps operator vocabulary out of everything the panel says", () => {
    const view = buildEngagementOverlayViewFromSkipVote(createCampaign(), NOW);
    const lines = [view!.headline, view!.hint, ...view!.options.map((option) => option.title)];
    const offenders = lines.filter((line) => OPERATOR_WORDS.some((word) => line.toLowerCase().includes(word)));

    expect(offenders).toEqual([]);
  });
});

describe("one panel slot shared between the poll and the skip campaign", () => {
  const voteSession = (secondsLeft: number) => ({
    status: "open" as const,
    closesAt: new Date(NOW.getTime() + secondsLeft * 1000).toISOString(),
    options: [
      { token: "!1", title: "Retro Night", votes: 2 },
      { token: "!2", title: "Coding Marathon", votes: 1 }
    ]
  });
  const skipCampaign = (secondsLeft: number) =>
    createCampaign({ expiresAt: new Date(NOW.getTime() + secondsLeft * 1000).toISOString() });

  it("passes a lone view through unchanged", () => {
    const vote = buildEngagementOverlayViewFromVoteSession(voteSession(60), NOW);
    const skip = buildEngagementOverlayViewFromSkipVote(skipCampaign(90), NOW);

    expect(chooseEngagementOverlayView(vote, null)).toBe(vote);
    expect(chooseEngagementOverlayView(null, skip)).toBe(skip);
    expect(chooseEngagementOverlayView(null, null)).toBeNull();
  });

  it("gives the slot to whichever runs out of time first", () => {
    // The panel whose deadline is closer has the scarce resource; the other still has runway once
    // the first resolves. The ordering cannot flap mid-flight: both countdowns tick at the same
    // rate, so whichever ends first stays ending-first until it actually ends.
    const vote = buildEngagementOverlayViewFromVoteSession(voteSession(60), NOW);
    const skip = buildEngagementOverlayViewFromSkipVote(skipCampaign(90), NOW);

    expect(chooseEngagementOverlayView(vote, skip)?.kind).toBe("vote-next");

    const urgentSkip = buildEngagementOverlayViewFromSkipVote(skipCampaign(30), NOW);
    expect(chooseEngagementOverlayView(vote, urgentSkip)?.kind).toBe("skip-vote");
  });

  it("breaks a dead-even tie toward the skip campaign", () => {
    // A lapsed campaign disappears silently, while an unseen poll still closes visibly and the
    // schedule carries on — so the tie goes to the one whose failure nobody would ever notice.
    const vote = buildEngagementOverlayViewFromVoteSession(voteSession(60), NOW);
    const skip = buildEngagementOverlayViewFromSkipVote(skipCampaign(60), NOW);

    expect(chooseEngagementOverlayView(vote, skip)?.kind).toBe("skip-vote");
  });
});

/**
 * Rasterises one real frame with the skip panel through satori and resvg, matching the vote and
 * game panels' smokes: the layout tests assert the tree, this asserts satori accepts it, because a
 * render-time rejection degrades the loop to a frozen frame. Skips (inconclusive, not failed) on
 * machines without a usable font, which is the renderer's own startup requirement anyway.
 */
describe("skip panel rasterisation smoke", () => {
  it("renders a PNG frame containing the skip panel", async () => {
    let fonts;
    try {
      fonts = await loadSceneRendererFonts(process.env);
    } catch {
      // No fonts on this machine; smoke is inconclusive rather than failed.
      return;
    }

    const engagement = buildEngagementOverlayViewFromSkipVote(createCampaign(), NOW);
    const png = await renderSceneFrame({ payload: createPayload(), engagement, width: 1280, height: 720 }, fonts);

    expect(png.length).toBeGreaterThan(1000);
    // PNG magic bytes.
    expect(png.subarray(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  }, 30_000);
});
