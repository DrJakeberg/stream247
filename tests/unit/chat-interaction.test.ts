import { describe, expect, it } from "vitest";
import {
  applySkipVote,
  applyVote,
  closeVoteSession,
  createDefaultChatInteractionConfig,
  evaluateViewerRequest,
  matchRequestCandidate,
  normalizeChatInteractionConfig,
  openVoteSession,
  parseChatCommand,
  type ChatInteractionConfig,
  type VoteSession
} from "@stream247/core";

function config(overrides: Partial<ChatInteractionConfig> = {}): ChatInteractionConfig {
  return { ...createDefaultChatInteractionConfig(), enabled: true, ...overrides };
}

const now = new Date("2026-08-18T12:00:00.000Z");

function session(overrides: Partial<VoteSession> = {}): VoteSession {
  return {
    ...(openVoteSession({
      id: "vote-1",
      candidates: [
        { assetId: "a1", title: "Retro Night" },
        { assetId: "a2", title: "Coding Marathon" },
        { assetId: "a3", title: "Lo-Fi Block" }
      ],
      config: config(),
      now
    }) as VoteSession),
    ...overrides
  };
}

describe("parseChatCommand", () => {
  it("returns none for ordinary chat", () => {
    expect(parseChatCommand("hello everyone", config())).toEqual({ kind: "none" });
    expect(parseChatCommand("", config())).toEqual({ kind: "none" });
  });

  it("parses a numeric vote inside the configured option range", () => {
    expect(parseChatCommand("!2", config())).toEqual({ kind: "vote", option: 2 });
  });

  it("ignores option 0 and options past the configured count", () => {
    expect(parseChatCommand("!0", config())).toEqual({ kind: "none" });
    expect(parseChatCommand("!4", config({ voteOptionCount: 3 }))).toEqual({ kind: "none" });
  });

  it("parses skip and request commands case-insensitively", () => {
    expect(parseChatCommand("!SKIP", config())).toEqual({ kind: "skip" });
    expect(parseChatCommand("!Request Retro Night", config())).toEqual({ kind: "request", query: "Retro Night" });
  });

  it("rejects a request with no query", () => {
    expect(parseChatCommand("!request", config())).toEqual({ kind: "none" });
    expect(parseChatCommand("!request    ", config())).toEqual({ kind: "none" });
  });

  it("bounds an absurdly long request query", () => {
    const parsed = parseChatCommand(`!request ${"x".repeat(500)}`, config());

    expect(parsed.kind).toBe("request");
    expect(parsed.kind === "request" && parsed.query.length).toBeLessThanOrEqual(120);
  });

  it("does not treat a command name with regex metacharacters as a pattern", () => {
    // The command is operator-configured; it must be compared literally, never compiled.
    const cfg = config({ requestCommand: "re(quest" });

    expect(parseChatCommand("!re(quest Retro", cfg)).toEqual({ kind: "request", query: "Retro" });
    expect(parseChatCommand("!rexquest Retro", cfg)).toEqual({ kind: "none" });
    expect(() => parseChatCommand("!anything", cfg)).not.toThrow();
  });

  it("honours the individual feature switches", () => {
    expect(parseChatCommand("!1", config({ votingEnabled: false }))).toEqual({ kind: "none" });
    expect(parseChatCommand("!skip", config({ skipEnabled: false }))).toEqual({ kind: "none" });
    expect(parseChatCommand("!request x", config({ requestsEnabled: false }))).toEqual({ kind: "none" });
    expect(parseChatCommand("!1", config({ enabled: false }))).toEqual({ kind: "none" });
  });
});

describe("openVoteSession", () => {
  it("refuses a poll that is not a choice", () => {
    expect(openVoteSession({ id: "v", candidates: [{ assetId: "a", title: "A" }], config: config(), now })).toBeNull();
  });

  it("numbers the options from one", () => {
    expect(session().options.map((option) => option.token)).toEqual(["!1", "!2", "!3"]);
  });
});

describe("applyVote", () => {
  it("counts a vote", () => {
    const result = applyVote({ session: session(), actor: "Viewer", option: 2, now });

    expect(result.accepted).toBe(true);
    expect(result.session.options[1]?.votes).toBe(1);
  });

  it("treats a viewer as one voter no matter how often they type", () => {
    let current = session();
    for (let i = 0; i < 20; i++) {
      current = applyVote({ session: current, actor: "spammer", option: 1, now }).session;
    }

    expect(current.options[0]?.votes).toBe(1);
  });

  it("moves a ballot instead of adding one when a viewer changes their mind", () => {
    const first = applyVote({ session: session(), actor: "viewer", option: 1, now }).session;
    const second = applyVote({ session: first, actor: "viewer", option: 3, now }).session;

    expect(second.options[0]?.votes).toBe(0);
    expect(second.options[2]?.votes).toBe(1);
    expect(second.options.reduce((sum, option) => sum + option.votes, 0)).toBe(1);
  });

  it("treats the same viewer case-insensitively", () => {
    const first = applyVote({ session: session(), actor: "Viewer", option: 1, now }).session;
    const second = applyVote({ session: first, actor: "viewer", option: 1, now });

    expect(second.accepted).toBe(false);
    expect(second.reason).toBe("unchanged");
  });

  it("rejects votes after the poll closes or expires", () => {
    const closed = { ...session(), status: "closed" as const };
    expect(applyVote({ session: closed, actor: "v", option: 1, now }).reason).toBe("closed");

    const later = new Date(now.getTime() + 10 * 60_000);
    expect(applyVote({ session: session(), actor: "v", option: 1, now: later }).reason).toBe("expired");
  });

  it("rejects an option that does not exist", () => {
    expect(applyVote({ session: session(), actor: "v", option: 9, now }).reason).toBe("unknown-option");
  });
});

describe("closeVoteSession", () => {
  it("reports the winner", () => {
    let current = session();
    for (const actor of ["a", "b", "c"]) {
      current = applyVote({ session: current, actor, option: 2, now }).session;
    }

    const outcome = closeVoteSession(current, config());

    expect(outcome.winnerAssetId).toBe("a2");
    expect(outcome.voterCount).toBe(3);
  });

  it("declines to pick a winner when nobody voted", () => {
    expect(closeVoteSession(session(), config()).reason).toBe("no-votes");
  });

  it("declines when turnout is below the configured minimum", () => {
    const current = applyVote({ session: session(), actor: "a", option: 1, now }).session;

    const outcome = closeVoteSession(current, config({ voteMinimumVoters: 3 }));

    expect(outcome.reason).toBe("below-minimum");
    expect(outcome.winnerAssetId).toBe("");
  });

  it("reports a tie rather than silently favouring candidate order", () => {
    let current = session();
    current = applyVote({ session: current, actor: "a", option: 1, now }).session;
    current = applyVote({ session: current, actor: "b", option: 2, now }).session;

    const outcome = closeVoteSession(current, config({ voteMinimumVoters: 2 }));

    expect(outcome.reason).toBe("tie");
    expect(outcome.winnerAssetId).toBe("");
  });
});

describe("applySkipVote", () => {
  const base = { assetId: "asset-1", config: config(), now };

  it("needs the absolute floor even on a quiet channel", () => {
    const result = applySkipVote({ ...base, state: null, actor: "a", activeChatterCount: 2 });

    expect(result.votesNeeded).toBe(5);
    expect(result.passed).toBe(false);
  });

  it("scales with the number of active chatters", () => {
    const result = applySkipVote({ ...base, state: null, actor: "a", activeChatterCount: 100 });

    expect(result.votesNeeded).toBe(60);
  });

  it("passes once the threshold is met", () => {
    let state = null as Parameters<typeof applySkipVote>[0]["state"];
    let passed = false;
    for (const actor of ["a", "b", "c", "d", "e"]) {
      const result = applySkipVote({ ...base, state, actor, activeChatterCount: 5 });
      state = result.state;
      passed = result.passed;
    }

    expect(passed).toBe(true);
  });

  it("counts a viewer once no matter how often they type", () => {
    let state = null as Parameters<typeof applySkipVote>[0]["state"];
    for (let i = 0; i < 10; i++) {
      state = applySkipVote({ ...base, state, actor: "spammer", activeChatterCount: 5 }).state;
    }

    expect(state?.voters).toEqual(["spammer"]);
  });

  it("restarts the tally when the programme moves on", () => {
    const first = applySkipVote({ ...base, state: null, actor: "a", activeChatterCount: 5 }).state;

    const second = applySkipVote({ ...base, assetId: "asset-2", state: first, actor: "b", activeChatterCount: 5 });

    expect(second.state.voters).toEqual(["b"]);
    expect(second.state.assetId).toBe("asset-2");
  });

  it("lets a stale vote lapse instead of carrying it forward", () => {
    const first = applySkipVote({ ...base, state: null, actor: "a", activeChatterCount: 5 }).state;
    const muchLater = new Date(now.getTime() + 10 * 60_000);

    const second = applySkipVote({ ...base, state: first, actor: "b", activeChatterCount: 5, now: muchLater });

    expect(second.state.voters).toEqual(["b"]);
  });
});

describe("matchRequestCandidate", () => {
  const candidates = [
    { assetId: "a1", title: "Retro Night", requestable: true },
    { assetId: "a2", title: "Retro Night Special", requestable: true },
    { assetId: "a3", title: "Hidden Gem", requestable: false }
  ];

  it("prefers an exact title over a prefix match", () => {
    expect(matchRequestCandidate("retro night", candidates)?.assetId).toBe("a1");
  });

  it("falls back to a prefix match", () => {
    expect(matchRequestCandidate("retro night spec", candidates)?.assetId).toBe("a2");
  });

  it("never returns an asset that was not released for requests", () => {
    expect(matchRequestCandidate("hidden", candidates)).toBeNull();
  });

  it("returns nothing for an empty query", () => {
    expect(matchRequestCandidate("   ", candidates)).toBeNull();
  });
});

describe("evaluateViewerRequest", () => {
  const candidates = [{ assetId: "a1", title: "Retro Night", requestable: true }];
  const base = {
    actor: "viewer",
    query: "retro",
    candidates,
    recentRequests: [],
    queuedRequestCount: 0,
    queuedAssetIds: [],
    config: config(),
    now
  };

  it("accepts a clean request", () => {
    const verdict = evaluateViewerRequest(base);

    expect(verdict).toMatchObject({ accepted: true, assetId: "a1", title: "Retro Night" });
  });

  it("holds a viewer to their cooldown and says how long", () => {
    const verdict = evaluateViewerRequest({
      ...base,
      recentRequests: [{ actor: "Viewer", assetId: "a1", createdAt: new Date(now.getTime() - 60_000).toISOString() }]
    });

    expect(verdict.reason).toBe("cooldown");
    expect(verdict.retryAfterSeconds).toBe(540);
  });

  it("lets a viewer request again once the cooldown has passed", () => {
    const verdict = evaluateViewerRequest({
      ...base,
      recentRequests: [{ actor: "viewer", assetId: "a1", createdAt: new Date(now.getTime() - 601_000).toISOString() }]
    });

    expect(verdict.accepted).toBe(true);
  });

  it("does not let one viewer's cooldown block another", () => {
    const verdict = evaluateViewerRequest({
      ...base,
      actor: "someone-else",
      recentRequests: [{ actor: "viewer", assetId: "a1", createdAt: now.toISOString() }]
    });

    expect(verdict.accepted).toBe(true);
  });

  it("caps how much of the queue viewers can own", () => {
    expect(evaluateViewerRequest({ ...base, queuedRequestCount: 5 }).reason).toBe("queue-full");
  });

  it("refuses to queue the same asset twice", () => {
    expect(evaluateViewerRequest({ ...base, queuedAssetIds: ["a1"] }).reason).toBe("already-queued");
  });

  it("explains a miss instead of failing silently", () => {
    expect(evaluateViewerRequest({ ...base, query: "nothing like this" }).reason).toBe("no-match");
  });

  it("is off when the feature is off", () => {
    expect(evaluateViewerRequest({ ...base, config: config({ requestsEnabled: false }) }).reason).toBe("disabled");
  });
});

describe("normalizeChatInteractionConfig", () => {
  it("returns safe defaults for empty input", () => {
    const normalized = normalizeChatInteractionConfig(null);

    expect(normalized.enabled).toBe(false);
    expect(normalized.requestCommand).toBe("request");
    expect(normalized.skipCommand).toBe("skip");
  });

  it("never lets one viewer skip the programme alone", () => {
    expect(normalizeChatInteractionConfig({ skipMinimumVotes: 0 }).skipMinimumVotes).toBe(2);
    expect(normalizeChatInteractionConfig({ skipMinimumVotes: -50 }).skipMinimumVotes).toBe(2);
    expect(normalizeChatInteractionConfig({ skipThresholdRatio: 0 }).skipThresholdRatio).toBe(0.1);
  });

  it("never removes request throttling entirely", () => {
    expect(normalizeChatInteractionConfig({ requestCooldownSeconds: 0 }).requestCooldownSeconds).toBe(30);
  });

  it("keeps a poll answerable and readable", () => {
    expect(normalizeChatInteractionConfig({ voteDurationSeconds: 1 }).voteDurationSeconds).toBe(15);
    expect(normalizeChatInteractionConfig({ voteDurationSeconds: 99_999 }).voteDurationSeconds).toBe(600);
    expect(normalizeChatInteractionConfig({ voteOptionCount: 1 }).voteOptionCount).toBe(2);
    expect(normalizeChatInteractionConfig({ voteOptionCount: 40 }).voteOptionCount).toBe(5);
  });

  it("strips a leading bang and anything untypable from command names", () => {
    expect(normalizeChatInteractionConfig({ requestCommand: "!Wunsch" }).requestCommand).toBe("wunsch");
    expect(normalizeChatInteractionConfig({ skipCommand: "sk!p me" }).skipCommand).toBe("skpme");
  });

  it("refuses a numeric command that would collide with a vote token", () => {
    expect(normalizeChatInteractionConfig({ requestCommand: "2" }).requestCommand).toBe("request");
  });

  it("falls back rather than accepting an empty command", () => {
    expect(normalizeChatInteractionConfig({ skipCommand: "!!!" }).skipCommand).toBe("skip");
    expect(normalizeChatInteractionConfig({ skipCommand: "   " }).skipCommand).toBe("skip");
  });

  it("keeps a valid configuration untouched", () => {
    const input = {
      enabled: true,
      votingEnabled: false,
      requestsEnabled: true,
      skipEnabled: true,
      voteDurationSeconds: 90,
      voteOptionCount: 4,
      voteMinimumVoters: 10,
      requestCooldownSeconds: 300,
      requestQueueLimit: 3,
      skipThresholdRatio: 0.75,
      skipMinimumVotes: 8,
      skipWindowSeconds: 180,
      requestCommand: "wunsch",
      skipCommand: "weiter"
    };

    expect(normalizeChatInteractionConfig(input)).toEqual(input);
  });
});
