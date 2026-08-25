import { describe, expect, it } from "vitest";
import { createDefaultChatInteractionConfig, type ChatInteractionConfig } from "@stream247/core";
import { ChatControlRuntime } from "../../apps/worker/src/chat-control.js";

function config(overrides: Partial<ChatInteractionConfig> = {}): ChatInteractionConfig {
  return { ...createDefaultChatInteractionConfig(), enabled: true, ...overrides };
}

function createRuntime(startMs = Date.parse("2026-08-18T12:00:00.000Z")) {
  let nowMs = startMs;
  const events: string[] = [];
  const runtime = new ChatControlRuntime({
    now: () => new Date(nowMs),
    onEvent: (event) => events.push(event)
  });
  return {
    runtime,
    events,
    advance: (seconds: number) => {
      nowMs += seconds * 1000;
    }
  };
}

const candidates = [
  { assetId: "a1", title: "Retro Night" },
  { assetId: "a2", title: "Coding Marathon" }
];

describe("ChatControlRuntime voting", () => {
  it("ignores votes when no poll is running", () => {
    const { runtime } = createRuntime();

    expect(runtime.handleMessage({ actor: "v", message: "!1", currentAssetId: "x", config: config() })).toEqual({
      kind: "none"
    });
  });

  it("records a vote while a poll is open", () => {
    const { runtime } = createRuntime();
    runtime.openVote({ id: "vote-1", candidates, config: config() });

    const effect = runtime.handleMessage({ actor: "viewer", message: "!2", currentAssetId: "x", config: config() });

    expect(effect).toEqual({ kind: "vote-recorded", option: 2 });
    expect(runtime.getSession()?.options[1]?.votes).toBe(1);
  });

  it("settles the poll only once its deadline passes", () => {
    const { runtime, advance } = createRuntime();
    runtime.openVote({ id: "vote-1", candidates, config: config({ voteDurationSeconds: 60 }) });
    for (const actor of ["a", "b", "c"]) {
      runtime.handleMessage({ actor, message: "!1", currentAssetId: "x", config: config() });
    }

    expect(runtime.settleVoteIfDue(config())).toBeNull();

    advance(61);
    const outcome = runtime.settleVoteIfDue(config());

    expect(outcome?.winnerAssetId).toBe("a1");
  });

  it("keeps a settled poll readable but no longer open", () => {
    // reconcileChatInteraction decides whether to open the next poll by asking whether one is
    // *open*. A settled session stays in the runtime so its outcome can be read, so testing for
    // mere presence would make the first poll of a process the only one that ever opens.
    const { runtime, advance } = createRuntime();
    runtime.openVote({ id: "vote-1", candidates, config: config() });
    advance(120);
    runtime.settleVoteIfDue(config());

    expect(runtime.getSession()).not.toBeNull();
    expect(runtime.getSession()?.status).toBe("closed");
  });

  it("opens a fresh poll once the previous one has settled", () => {
    const { runtime, advance } = createRuntime();
    runtime.openVote({ id: "vote-1", candidates, config: config() });
    advance(120);
    runtime.settleVoteIfDue(config());

    expect(runtime.openVote({ id: "vote-2", candidates, config: config() })).toBe(true);
    expect(runtime.getSession()?.id).toBe("vote-2");
    expect(runtime.getSession()?.status).toBe("open");
    // A fresh poll starts from zero rather than inheriting the previous tally.
    expect(runtime.getSession()?.options.every((option) => option.votes === 0)).toBe(true);
  });

  it("does not settle the same poll twice", () => {
    const { runtime, advance } = createRuntime();
    runtime.openVote({ id: "vote-1", candidates, config: config() });
    advance(120);

    expect(runtime.settleVoteIfDue(config())).not.toBeNull();
    expect(runtime.settleVoteIfDue(config())).toBeNull();
  });
});

describe("ChatControlRuntime skip votes", () => {
  it("reports progress toward the threshold", () => {
    const { runtime } = createRuntime();
    const cfg = config({ skipMinimumVotes: 3 });

    const effect = runtime.handleMessage({ actor: "a", message: "!skip", currentAssetId: "asset-1", config: cfg });

    expect(effect).toEqual({ kind: "skip-recorded", votes: 1, votesNeeded: 3 });
  });

  it("passes once enough distinct viewers ask", () => {
    const { runtime } = createRuntime();
    const cfg = config({ skipMinimumVotes: 3 });
    let effect;
    for (const actor of ["a", "b", "c"]) {
      effect = runtime.handleMessage({ actor, message: "!skip", currentAssetId: "asset-1", config: cfg });
    }

    expect(effect).toEqual({ kind: "skip-passed", assetId: "asset-1" });
  });

  it("cannot be passed by one viewer repeating themselves", () => {
    const { runtime } = createRuntime();
    const cfg = config({ skipMinimumVotes: 3 });
    let effect;
    for (let i = 0; i < 10; i++) {
      effect = runtime.handleMessage({ actor: "spammer", message: "!skip", currentAssetId: "asset-1", config: cfg });
    }

    expect(effect).toEqual({ kind: "none" });
  });
});

describe("ChatControlRuntime overlay view", () => {
  it("shows nothing when nothing is running", () => {
    const { runtime } = createRuntime();

    expect(runtime.getOverlayView(config())).toBeNull();
  });

  it("shows the poll with a live countdown", () => {
    const { runtime, advance } = createRuntime();
    runtime.openVote({ id: "vote-1", candidates, config: config({ voteDurationSeconds: 60 }) });
    runtime.handleMessage({ actor: "a", message: "!1", currentAssetId: "x", config: config() });
    advance(20);

    const view = runtime.getOverlayView(config());

    expect(view?.kind).toBe("vote-next");
    expect(view?.secondsRemaining).toBe(40);
    expect(view?.options[0]?.votes).toBe(1);
  });

  it("takes a lapsed poll off the view rather than counting below zero", () => {
    const { runtime, advance } = createRuntime();
    runtime.openVote({ id: "vote-1", candidates, config: config({ voteDurationSeconds: 60 }) });
    advance(600);

    // This used to freeze the panel at 0s until the worker cycle settled the poll. Now the
    // deadline itself removes it — the projection is shared with the playout container, where an
    // orphaned open row must leave the screen without anyone around to close it.
    expect(runtime.getOverlayView(config())).toBeNull();
  });

  it("shows skip progress without casting a vote of its own", () => {
    const { runtime } = createRuntime();
    const cfg = config({ skipMinimumVotes: 4 });
    runtime.handleMessage({ actor: "a", message: "!skip", currentAssetId: "asset-1", config: cfg });

    const before = runtime.getOverlayView(cfg);
    const after = runtime.getOverlayView(cfg);

    expect(before?.kind).toBe("skip-vote");
    expect(before?.options[0]?.votes).toBe(1);
    // Rendering the overlay must not change the tally.
    expect(after?.options[0]?.votes).toBe(1);
  });

  it("takes a lapsed skip campaign off the view rather than freezing it at 0s", () => {
    const { runtime, advance } = createRuntime();
    const cfg = config({ skipMinimumVotes: 4, skipWindowSeconds: 120 });
    runtime.handleMessage({ actor: "a", message: "!skip", currentAssetId: "asset-1", config: cfg });
    advance(600);

    // The same rule the playout-side projection applies to a stale persisted row: a campaign
    // whose window has lapsed collected nothing and must leave the screen, not sit at 0s.
    expect(runtime.getOverlayView(cfg)).toBeNull();
  });

  it("shows the poll when it closes sooner than the skip window", () => {
    // Both panels share one slot; the one that runs out of time first wins it (defaults: the
    // 60s poll beats the 120s skip window).
    const { runtime } = createRuntime();
    runtime.handleMessage({ actor: "a", message: "!skip", currentAssetId: "asset-1", config: config() });
    runtime.openVote({ id: "vote-1", candidates, config: config() });

    expect(runtime.getOverlayView(config())?.kind).toBe("vote-next");
  });

  it("shows skip progress when its window closes sooner than the poll", () => {
    const { runtime } = createRuntime();
    const cfg = config({ voteDurationSeconds: 300, skipWindowSeconds: 60 });
    runtime.handleMessage({ actor: "a", message: "!skip", currentAssetId: "asset-1", config: cfg });
    runtime.openVote({ id: "vote-1", candidates, config: cfg });

    expect(runtime.getOverlayView(cfg)?.kind).toBe("skip-vote");
  });
});

describe("ChatControlRuntime skip snapshot", () => {
  it("reports nothing while no campaign is collecting", () => {
    const { runtime } = createRuntime();

    expect(runtime.getSkipVoteRecord(config())).toBeNull();
  });

  it("bakes the threshold and the window end into the snapshot", () => {
    const { runtime } = createRuntime();
    const cfg = config({ skipMinimumVotes: 4, skipWindowSeconds: 120 });
    runtime.handleMessage({ actor: "a", message: "!skip", currentAssetId: "asset-1", config: cfg });
    runtime.handleMessage({ actor: "b", message: "!skip", currentAssetId: "asset-1", config: cfg });

    const record = runtime.getSkipVoteRecord(cfg);

    expect(record).toMatchObject({ assetId: "asset-1", skipCommand: "skip", votes: 2, votesNeeded: 4 });
    // The window end is derived from the campaign start, not from "now": the snapshot must not
    // slide the deadline forward every time it is taken.
    expect(record?.expiresAt).toBe(new Date(Date.parse(record?.startedAt ?? "") + 120_000).toISOString());
  });

  it("clears the snapshot with the campaign", () => {
    const { runtime } = createRuntime();
    runtime.handleMessage({ actor: "a", message: "!skip", currentAssetId: "asset-1", config: config() });
    runtime.clearSkipVote();

    expect(runtime.getSkipVoteRecord(config())).toBeNull();
  });
});

describe("ChatControlRuntime bookkeeping", () => {
  it("counts distinct recent chatters", () => {
    const { runtime, advance } = createRuntime();
    for (const actor of ["a", "b", "B", "c"]) {
      runtime.handleMessage({ actor, message: "hello", currentAssetId: "x", config: config() });
    }

    expect(runtime.getActiveChatterCount()).toBe(3);

    advance(600);
    expect(runtime.getActiveChatterCount()).toBe(0);
  });

  it("reports dirty state once per change so callers can skip needless writes", () => {
    const { runtime } = createRuntime();
    runtime.openVote({ id: "vote-1", candidates, config: config() });

    expect(runtime.consumeDirty()).toBe(true);
    expect(runtime.consumeDirty()).toBe(false);
  });

  it("never throws out of the IRC data path", () => {
    const { runtime } = createRuntime();

    for (const message of ["", "!", "!!!", "!request", "!999999999999", " ", "!skip".repeat(500)]) {
      expect(() =>
        runtime.handleMessage({ actor: "viewer", message, currentAssetId: "asset-1", config: config() })
      ).not.toThrow();
    }
  });

  it("passes a request through for the caller to resolve", () => {
    const { runtime } = createRuntime();

    const effect = runtime.handleMessage({
      actor: "viewer",
      message: "!request retro night",
      currentAssetId: "x",
      config: config()
    });

    expect(effect).toEqual({ kind: "request", actor: "viewer", query: "retro night" });
  });
});
