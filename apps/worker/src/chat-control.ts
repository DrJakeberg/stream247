// Runtime for viewer-driven programme control.
//
// Owns the live vote tally, the skip tally, and request cooldowns in memory, and exposes what the
// overlay needs to draw. The pure rules live in packages/core/chat-interaction.ts; this file is
// only the moving parts: who is talking right now, when a poll opens and closes, and how often
// state is flushed to Postgres for the playout container to read.
//
// Writes are deliberately buffered. Chat runs in the worker container and the overlay renders in
// the playout container, so the tally has to be shared through the database — but state writes go
// through a global serialisation lock, and a busy poll answering dozens of ballots per second
// would otherwise hammer it.

import {
  applySkipVote,
  applyVote,
  closeVoteSession,
  openVoteSession,
  parseChatCommand,
  type ChatCommand,
  type ChatInteractionConfig,
  type OverlayEngagementView,
  type SkipVoteState,
  type VoteOutcome,
  type VoteSession
} from "@stream247/core";

export type ChatControlEffect =
  | { kind: "none" }
  | { kind: "vote-recorded"; option: number }
  | { kind: "skip-recorded"; votes: number; votesNeeded: number }
  | { kind: "skip-passed"; assetId: string }
  | { kind: "request"; actor: string; query: string };

export type ChatControlOptions = {
  now?: () => Date;
  onEvent?: (event: string, fields: Record<string, unknown>) => void;
};

/** Viewers counted as "active" for the skip threshold. */
const ACTIVE_CHATTER_WINDOW_MS = 5 * 60_000;

export class ChatControlRuntime {
  private readonly options: ChatControlOptions;
  private readonly chatterSeenAt = new Map<string, number>();
  private session: VoteSession | null = null;
  private skipState: SkipVoteState | null = null;
  private lastOutcome: VoteOutcome | null = null;
  private dirty = false;

  constructor(options: ChatControlOptions = {}) {
    this.options = options;
  }

  private now(): Date {
    return this.options.now ? this.options.now() : new Date();
  }

  private log(event: string, fields: Record<string, unknown>): void {
    this.options.onEvent?.(event, fields);
  }

  private pruneChatters(nowMs: number): void {
    for (const [actor, seenAt] of this.chatterSeenAt.entries()) {
      if (seenAt < nowMs - ACTIVE_CHATTER_WINDOW_MS) {
        this.chatterSeenAt.delete(actor);
      }
    }
  }

  getActiveChatterCount(): number {
    this.pruneChatters(this.now().getTime());
    return this.chatterSeenAt.size;
  }

  /**
   * Handles one chat message and reports what the caller should act on.
   *
   * Never throws: this runs inside the IRC socket data handler, where an exception would take the
   * worker process down.
   */
  handleMessage(args: {
    actor: string;
    message: string;
    currentAssetId: string;
    config: ChatInteractionConfig;
  }): ChatControlEffect {
    try {
      const now = this.now();
      const actor = args.actor.trim();
      if (actor) {
        this.chatterSeenAt.set(actor.toLowerCase(), now.getTime());
      }

      const command: ChatCommand = parseChatCommand(args.message, args.config);

      if (command.kind === "vote") {
        if (!this.session || this.session.status !== "open") {
          return { kind: "none" };
        }

        const result = applyVote({ session: this.session, actor, option: command.option, now });
        if (!result.accepted) {
          return { kind: "none" };
        }

        this.session = result.session;
        this.dirty = true;
        return { kind: "vote-recorded", option: command.option };
      }

      if (command.kind === "skip") {
        const result = applySkipVote({
          state: this.skipState,
          actor,
          assetId: args.currentAssetId,
          activeChatterCount: this.getActiveChatterCount(),
          config: args.config,
          now
        });
        this.skipState = result.state;

        if (!result.accepted) {
          return { kind: "none" };
        }

        this.dirty = true;
        if (result.passed) {
          this.log("chat.skip.passed", { assetId: args.currentAssetId, votes: result.state.voters.length });
          return { kind: "skip-passed", assetId: args.currentAssetId };
        }

        return { kind: "skip-recorded", votes: result.state.voters.length, votesNeeded: result.votesNeeded };
      }

      if (command.kind === "request") {
        return { kind: "request", actor, query: command.query };
      }

      return { kind: "none" };
    } catch (error) {
      this.log("chat.command.failed", {
        error: error instanceof Error ? error.message : "Unknown chat command failure."
      });
      return { kind: "none" };
    }
  }

  openVote(args: { id: string; candidates: { assetId: string; title: string }[]; config: ChatInteractionConfig }): boolean {
    const session = openVoteSession({
      id: args.id,
      candidates: args.candidates,
      config: args.config,
      now: this.now()
    });

    if (!session) {
      return false;
    }

    this.session = session;
    this.lastOutcome = null;
    this.dirty = true;
    this.log("chat.vote.opened", { id: args.id, options: session.options.length });
    return true;
  }

  /** Closes the poll if its deadline has passed. Returns the outcome exactly once. */
  settleVoteIfDue(config: ChatInteractionConfig): VoteOutcome | null {
    if (!this.session || this.session.status !== "open") {
      return null;
    }

    if (this.now().getTime() < Date.parse(this.session.closesAt)) {
      return null;
    }

    const outcome = closeVoteSession(this.session, config);
    this.session = outcome.session;
    this.lastOutcome = outcome;
    this.dirty = true;
    this.log("chat.vote.closed", {
      id: outcome.session.id,
      reason: outcome.reason,
      winnerAssetId: outcome.winnerAssetId,
      voterCount: outcome.voterCount
    });
    return outcome;
  }

  clearSkipVote(): void {
    if (this.skipState) {
      this.skipState = null;
      this.dirty = true;
    }
  }

  getSession(): VoteSession | null {
    return this.session;
  }

  getLastOutcome(): VoteOutcome | null {
    return this.lastOutcome;
  }

  /** True when something changed since the last flush, so callers can skip needless writes. */
  consumeDirty(): boolean {
    const dirty = this.dirty;
    this.dirty = false;
    return dirty;
  }

  /**
   * What the overlay should draw right now, or null when nothing is running.
   */
  getOverlayView(config: ChatInteractionConfig): OverlayEngagementView | null {
    const now = this.now();

    if (this.session?.status === "open") {
      const closesAtMs = Date.parse(this.session.closesAt);
      return {
        kind: "vote-next",
        headline: "Was läuft als Nächstes?",
        options: this.session.options.map((option) => ({
          token: option.token,
          title: option.title,
          votes: option.votes
        })),
        totalVotes: this.session.options.reduce((sum, option) => sum + option.votes, 0),
        secondsRemaining: Math.max(0, Math.round((closesAtMs - now.getTime()) / 1000)),
        threshold: 0,
        hint: `Schreib ${this.session.options.map((option) => option.token).join(", ")} in den Chat`
      };
    }

    if (this.skipState && this.skipState.voters.length > 0) {
      const votesNeeded = applySkipVote({
        state: this.skipState,
        // Probe with an actor already counted, so this reports the threshold without casting a vote.
        actor: this.skipState.voters[0] ?? "",
        assetId: this.skipState.assetId,
        activeChatterCount: this.getActiveChatterCount(),
        config,
        now
      }).votesNeeded;

      return {
        kind: "skip-vote",
        headline: "Überspringen?",
        options: [{ token: `!${config.skipCommand}`, title: "Weiter zum nächsten Video", votes: this.skipState.voters.length }],
        totalVotes: votesNeeded,
        secondsRemaining: Math.max(
          0,
          Math.round((Date.parse(this.skipState.startedAt) + config.skipWindowSeconds * 1000 - now.getTime()) / 1000)
        ),
        threshold: votesNeeded,
        hint: `${String(this.skipState.voters.length)} von ${String(votesNeeded)} Stimmen`
      };
    }

    return null;
  }
}
