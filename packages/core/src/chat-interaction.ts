// Chat-driven programme control.
//
// Viewers steer the channel from Twitch chat: they vote on what plays next, request a specific
// item from the released library, and can collectively skip what is on air. All of it is pure
// state transitions here, so the rules are testable without a socket, a database, or a stream.
//
// Every path is hostile-input territory: the message text comes from anonymous viewers, and the
// command names are operator-configured. Nothing here interpolates user input into a pattern, and
// every entry point is bounded (one vote per viewer, cooldowns, caps).

export type ChatInteractionConfig = {
  /** Master switch for all chat-driven control. */
  enabled: boolean;
  votingEnabled: boolean;
  requestsEnabled: boolean;
  skipEnabled: boolean;
  /** How long a "what plays next" poll stays open. */
  voteDurationSeconds: number;
  /** How many candidates a poll offers. */
  voteOptionCount: number;
  /** Minimum distinct voters before a poll result is honoured at all. */
  voteMinimumVoters: number;
  /** Per-viewer cooldown between accepted requests. */
  requestCooldownSeconds: number;
  /** Cap on outstanding viewer requests in the queue. */
  requestQueueLimit: number;
  /** Share of active voters required to skip, 0..1. */
  skipThresholdRatio: number;
  /** Floor on skip votes regardless of ratio, so two people cannot skip an empty channel. */
  skipMinimumVotes: number;
  /** How long a skip vote collects before it lapses. */
  skipWindowSeconds: number;
  requestCommand: string;
  skipCommand: string;
};

export function createDefaultChatInteractionConfig(): ChatInteractionConfig {
  return {
    enabled: false,
    votingEnabled: true,
    requestsEnabled: true,
    skipEnabled: true,
    voteDurationSeconds: 60,
    voteOptionCount: 3,
    voteMinimumVoters: 3,
    requestCooldownSeconds: 600,
    requestQueueLimit: 5,
    skipThresholdRatio: 0.6,
    skipMinimumVotes: 5,
    skipWindowSeconds: 120,
    requestCommand: "request",
    skipCommand: "skip"
  };
}

export type ChatCommand =
  | { kind: "vote"; option: number }
  | { kind: "request"; query: string }
  | { kind: "skip" }
  | { kind: "none" };

const MAX_REQUEST_QUERY_LENGTH = 120;

/**
 * Parses one chat message into a command.
 *
 * Matching is done with plain string operations rather than a constructed RegExp: the command
 * names are operator-configured, and building a pattern from them is how an unescaped "(" used to
 * throw inside the IRC socket handler and take the worker down.
 */
export function parseChatCommand(message: string, config: ChatInteractionConfig): ChatCommand {
  if (!config.enabled) {
    return { kind: "none" };
  }

  const trimmed = message.trim();
  if (!trimmed.startsWith("!")) {
    return { kind: "none" };
  }

  const body = trimmed.slice(1);
  const separatorIndex = body.search(/\s/);
  const head = (separatorIndex === -1 ? body : body.slice(0, separatorIndex)).toLowerCase();
  const rest = separatorIndex === -1 ? "" : body.slice(separatorIndex + 1).trim();

  if (config.votingEnabled && /^\d{1,2}$/.test(head)) {
    const option = Number.parseInt(head, 10);
    // Option 0 does not exist; anything past the configured count is a typo, not a vote.
    if (option >= 1 && option <= config.voteOptionCount) {
      return { kind: "vote", option };
    }
    return { kind: "none" };
  }

  if (config.skipEnabled && head === config.skipCommand.trim().toLowerCase() && head.length > 0) {
    return { kind: "skip" };
  }

  if (config.requestsEnabled && head === config.requestCommand.trim().toLowerCase() && head.length > 0) {
    const query = rest.slice(0, MAX_REQUEST_QUERY_LENGTH).trim();
    return query ? { kind: "request", query } : { kind: "none" };
  }

  return { kind: "none" };
}

export type VoteOption = {
  /** Chat token viewers type, e.g. "!2". Derived, never operator-supplied. */
  token: string;
  assetId: string;
  title: string;
  votes: number;
};

export type VoteSession = {
  id: string;
  status: "open" | "closed";
  openedAt: string;
  closesAt: string;
  options: VoteOption[];
  /** actor -> chosen option index (1-based). One vote per viewer; a later vote replaces it. */
  ballots: Record<string, number>;
};

export function openVoteSession(args: {
  id: string;
  candidates: { assetId: string; title: string }[];
  config: ChatInteractionConfig;
  now: Date;
}): VoteSession | null {
  const candidates = args.candidates.slice(0, Math.max(2, args.config.voteOptionCount));
  // A poll with fewer than two candidates is not a choice.
  if (candidates.length < 2) {
    return null;
  }

  return {
    id: args.id,
    status: "open",
    openedAt: args.now.toISOString(),
    closesAt: new Date(args.now.getTime() + Math.max(10, args.config.voteDurationSeconds) * 1000).toISOString(),
    options: candidates.map((candidate, index) => ({
      token: `!${String(index + 1)}`,
      assetId: candidate.assetId,
      title: candidate.title,
      votes: 0
    })),
    ballots: {}
  };
}

export type VoteApplication = {
  session: VoteSession;
  accepted: boolean;
  reason: "" | "closed" | "expired" | "unknown-option" | "unchanged";
};

/**
 * Records a viewer's vote. Re-voting moves the existing ballot rather than adding a second one, so
 * the tally can never exceed the number of distinct voters.
 */
export function applyVote(args: {
  session: VoteSession;
  actor: string;
  option: number;
  now: Date;
}): VoteApplication {
  const { session, actor, option } = args;

  if (session.status !== "open") {
    return { session, accepted: false, reason: "closed" };
  }

  if (args.now.getTime() >= Date.parse(session.closesAt)) {
    return { session, accepted: false, reason: "expired" };
  }

  if (option < 1 || option > session.options.length) {
    return { session, accepted: false, reason: "unknown-option" };
  }

  const normalizedActor = actor.trim().toLowerCase();
  if (!normalizedActor) {
    return { session, accepted: false, reason: "unknown-option" };
  }

  const previous = session.ballots[normalizedActor];
  if (previous === option) {
    return { session, accepted: false, reason: "unchanged" };
  }

  const options = session.options.map((entry, index) => {
    const position = index + 1;
    let votes = entry.votes;
    if (previous === position) {
      votes -= 1;
    }
    if (position === option) {
      votes += 1;
    }
    return { ...entry, votes: Math.max(0, votes) };
  });

  return {
    session: { ...session, options, ballots: { ...session.ballots, [normalizedActor]: option } },
    accepted: true,
    reason: ""
  };
}

export type VoteOutcome = {
  session: VoteSession;
  /** Empty when the poll did not produce an actionable result. */
  winnerAssetId: string;
  winnerTitle: string;
  totalVotes: number;
  voterCount: number;
  reason: "" | "no-votes" | "below-minimum" | "tie";
};

/**
 * Closes a poll and resolves the winner.
 *
 * A tie is reported rather than broken arbitrarily: silently picking the first option would make
 * the programme depend on candidate ordering, which viewers cannot see or reason about. The caller
 * falls back to the normal schedule, which is the honest outcome of "chat did not decide".
 */
export function closeVoteSession(session: VoteSession, config: ChatInteractionConfig): VoteOutcome {
  const closed: VoteSession = { ...session, status: "closed" };
  const voterCount = Object.keys(session.ballots).length;
  const totalVotes = session.options.reduce((sum, option) => sum + option.votes, 0);

  if (totalVotes === 0) {
    return { session: closed, winnerAssetId: "", winnerTitle: "", totalVotes, voterCount, reason: "no-votes" };
  }

  if (voterCount < Math.max(1, config.voteMinimumVoters)) {
    return { session: closed, winnerAssetId: "", winnerTitle: "", totalVotes, voterCount, reason: "below-minimum" };
  }

  const topVotes = Math.max(...session.options.map((option) => option.votes));
  const leaders = session.options.filter((option) => option.votes === topVotes);

  if (leaders.length !== 1) {
    return { session: closed, winnerAssetId: "", winnerTitle: "", totalVotes, voterCount, reason: "tie" };
  }

  return {
    session: closed,
    winnerAssetId: leaders[0]!.assetId,
    winnerTitle: leaders[0]!.title,
    totalVotes,
    voterCount,
    reason: ""
  };
}

export type SkipVoteState = {
  /** Normalised actor names that have voted to skip the current item. */
  voters: string[];
  startedAt: string;
  /** Asset the vote applies to; a boundary invalidates it. */
  assetId: string;
};

export type SkipVoteResult = {
  state: SkipVoteState;
  accepted: boolean;
  passed: boolean;
  votesNeeded: number;
  reason: "" | "duplicate" | "no-asset";
};

/**
 * Records a skip vote and reports whether the threshold is met.
 *
 * The threshold is a share of currently active chatters with an absolute floor, so a quiet channel
 * cannot be skipped by two people, and a busy one still needs genuine consensus.
 */
export function applySkipVote(args: {
  state: SkipVoteState | null;
  actor: string;
  assetId: string;
  activeChatterCount: number;
  config: ChatInteractionConfig;
  now: Date;
}): SkipVoteResult {
  const { config, now } = args;
  const normalizedActor = args.actor.trim().toLowerCase();
  const votesNeeded = Math.max(
    Math.max(1, config.skipMinimumVotes),
    Math.ceil(Math.max(0, args.activeChatterCount) * Math.min(1, Math.max(0, config.skipThresholdRatio)))
  );

  if (!args.assetId || !normalizedActor) {
    return {
      state: args.state ?? { voters: [], startedAt: now.toISOString(), assetId: args.assetId },
      accepted: false,
      passed: false,
      votesNeeded,
      reason: "no-asset"
    };
  }

  // A vote belongs to one item. When the programme moves on, or the collection window lapses,
  // the tally restarts rather than carrying stale votes into the next video.
  const windowMs = Math.max(10, config.skipWindowSeconds) * 1000;
  const expired = args.state ? now.getTime() - Date.parse(args.state.startedAt) >= windowMs : true;
  const base: SkipVoteState =
    !args.state || expired || args.state.assetId !== args.assetId
      ? { voters: [], startedAt: now.toISOString(), assetId: args.assetId }
      : args.state;

  if (base.voters.includes(normalizedActor)) {
    return { state: base, accepted: false, passed: base.voters.length >= votesNeeded, votesNeeded, reason: "duplicate" };
  }

  const state: SkipVoteState = { ...base, voters: [...base.voters, normalizedActor] };
  return { state, accepted: true, passed: state.voters.length >= votesNeeded, votesNeeded, reason: "" };
}

export type ViewerRequestRecord = {
  actor: string;
  assetId: string;
  createdAt: string;
};

export type RequestVerdict = {
  accepted: boolean;
  reason: "" | "disabled" | "cooldown" | "queue-full" | "no-match" | "already-queued";
  /** Seconds the viewer must wait before requesting again. Only set for "cooldown". */
  retryAfterSeconds: number;
  assetId: string;
  title: string;
};

export type RequestCandidate = {
  assetId: string;
  title: string;
  /** Only assets explicitly released for viewer requests are eligible. */
  requestable: boolean;
};

/**
 * Matches a viewer's request against the released library, cheapest signal first.
 *
 * Scoring is deliberately simple and explainable: an exact title match beats a prefix match, which
 * beats a substring match. Viewers can predict what they will get, which matters more here than
 * clever ranking.
 */
export function matchRequestCandidate(query: string, candidates: RequestCandidate[]): RequestCandidate | null {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return null;
  }

  const eligible = candidates.filter((candidate) => candidate.requestable);
  const scored = eligible
    .map((candidate) => {
      const title = candidate.title.trim().toLowerCase();
      if (!title) {
        return null;
      }
      if (title === needle) {
        return { candidate, score: 3 };
      }
      if (title.startsWith(needle)) {
        return { candidate, score: 2 };
      }
      if (title.includes(needle)) {
        return { candidate, score: 1 };
      }
      return null;
    })
    .filter((entry): entry is { candidate: RequestCandidate; score: number } => entry !== null)
    .sort((a, b) => b.score - a.score || a.candidate.title.localeCompare(b.candidate.title));

  return scored[0]?.candidate ?? null;
}

/**
 * Decides whether a viewer request is honoured.
 *
 * Every rejection has a reason the caller can say out loud in chat: silent failure is the fastest
 * way to make viewers spam the command.
 */
export function evaluateViewerRequest(args: {
  actor: string;
  query: string;
  candidates: RequestCandidate[];
  recentRequests: ViewerRequestRecord[];
  queuedRequestCount: number;
  queuedAssetIds: string[];
  config: ChatInteractionConfig;
  now: Date;
}): RequestVerdict {
  const { config, now } = args;
  const empty = { retryAfterSeconds: 0, assetId: "", title: "" };

  if (!config.enabled || !config.requestsEnabled) {
    return { accepted: false, reason: "disabled", ...empty };
  }

  if (args.queuedRequestCount >= Math.max(1, config.requestQueueLimit)) {
    return { accepted: false, reason: "queue-full", ...empty };
  }

  const normalizedActor = args.actor.trim().toLowerCase();
  const cooldownMs = Math.max(0, config.requestCooldownSeconds) * 1000;
  if (cooldownMs > 0) {
    const last = args.recentRequests
      .filter((entry) => entry.actor.trim().toLowerCase() === normalizedActor)
      .map((entry) => Date.parse(entry.createdAt))
      .filter((value) => Number.isFinite(value))
      .sort((a, b) => b - a)[0];

    if (last !== undefined && now.getTime() - last < cooldownMs) {
      return {
        accepted: false,
        reason: "cooldown",
        retryAfterSeconds: Math.ceil((cooldownMs - (now.getTime() - last)) / 1000),
        assetId: "",
        title: ""
      };
    }
  }

  const match = matchRequestCandidate(args.query, args.candidates);
  if (!match) {
    return { accepted: false, reason: "no-match", ...empty };
  }

  if (args.queuedAssetIds.includes(match.assetId)) {
    return { accepted: false, reason: "already-queued", retryAfterSeconds: 0, assetId: match.assetId, title: match.title };
  }

  return { accepted: true, reason: "", retryAfterSeconds: 0, assetId: match.assetId, title: match.title };
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Math.round(Number(value));
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, parsed));
}

function normalizeCommandName(value: unknown, fallback: string): string {
  // Commands are typed by viewers and compared literally. Restricting them to word characters
  // keeps them typable, keeps them from colliding with the "!<number>" vote tokens, and removes
  // any question of what a stray character would do downstream.
  const normalized = String(value ?? "")
    .trim()
    .replace(/^!+/, "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "");

  return normalized && !/^\d+$/.test(normalized) ? normalized.slice(0, 24) : fallback;
}

/**
 * Validates operator-supplied viewer-control settings.
 *
 * Every bound here is a safety property, not cosmetics: an unbounded option count would let a poll
 * offer tokens viewers cannot type, a zero cooldown would remove request throttling entirely, and a
 * zero skip threshold would let a single viewer skip the programme.
 */
export function normalizeChatInteractionConfig(
  input: Partial<ChatInteractionConfig> | null | undefined
): ChatInteractionConfig {
  const defaults = createDefaultChatInteractionConfig();
  const source = input ?? defaults;

  return {
    enabled: Boolean(source.enabled),
    votingEnabled: source.votingEnabled === undefined ? defaults.votingEnabled : Boolean(source.votingEnabled),
    requestsEnabled: source.requestsEnabled === undefined ? defaults.requestsEnabled : Boolean(source.requestsEnabled),
    skipEnabled: source.skipEnabled === undefined ? defaults.skipEnabled : Boolean(source.skipEnabled),
    // A poll shorter than 15s is not answerable; longer than 10 minutes outlives most items.
    voteDurationSeconds: clampInt(source.voteDurationSeconds, defaults.voteDurationSeconds, 15, 600),
    // At least a choice, at most what fits on the overlay and in a viewer's head.
    voteOptionCount: clampInt(source.voteOptionCount, defaults.voteOptionCount, 2, 5),
    voteMinimumVoters: clampInt(source.voteMinimumVoters, defaults.voteMinimumVoters, 1, 1000),
    // Never 0: that would remove per-viewer request throttling altogether.
    requestCooldownSeconds: clampInt(source.requestCooldownSeconds, defaults.requestCooldownSeconds, 30, 86_400),
    requestQueueLimit: clampInt(source.requestQueueLimit, defaults.requestQueueLimit, 1, 50),
    skipThresholdRatio: Math.max(
      0.1,
      Math.min(1, Number.isFinite(Number(source.skipThresholdRatio)) ? Number(source.skipThresholdRatio) : defaults.skipThresholdRatio)
    ),
    // Never below 2: one viewer must not be able to skip the programme on their own.
    skipMinimumVotes: clampInt(source.skipMinimumVotes, defaults.skipMinimumVotes, 2, 1000),
    skipWindowSeconds: clampInt(source.skipWindowSeconds, defaults.skipWindowSeconds, 30, 3600),
    requestCommand: normalizeCommandName(source.requestCommand, defaults.requestCommand),
    skipCommand: normalizeCommandName(source.skipCommand, defaults.skipCommand)
  };
}
