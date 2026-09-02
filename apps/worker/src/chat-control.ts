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
import { ActiveChatterRoster } from "./active-chatters.js";

export type ChatControlEffect =
  | { kind: "none" }
  | { kind: "vote-recorded"; option: number }
  | { kind: "skip-recorded"; votes: number; votesNeeded: number }
  | { kind: "skip-passed"; assetId: string }
  | { kind: "request"; actor: string; query: string };

export type ChatControlOptions = {
  now?: () => Date;
  onEvent?: (event: string, fields: Record<string, unknown>) => void;
  /**
   * Who counts as "active" for the skip threshold. The worker hands in the roster the engagement
   * game tracker fills and windows (see active-chatters.ts), so the share of the room a skip needs
   * is a share of the same room the overlays page reports. Left out, the runtime keeps a roster of
   * its own over the default engagement window.
   */
  activeChatters?: ActiveChatterRoster;
};

export class ChatControlRuntime {
  private readonly options: ChatControlOptions;
  private readonly activeChatters: ActiveChatterRoster;
  private session: VoteSession | null = null;
  private skipState: SkipVoteState | null = null;
  private lastOutcome: VoteOutcome | null = null;
  private dirty = false;

  constructor(options: ChatControlOptions = {}) {
    this.options = options;
    this.activeChatters = options.activeChatters ?? new ActiveChatterRoster();
  }

  private now(): Date {
    return this.options.now ? this.options.now() : new Date();
  }

  private log(event: string, fields: Record<string, unknown>): void {
    this.options.onEvent?.(event, fields);
  }

  getActiveChatterCount(): number {
    return this.activeChatters.countActive(this.now().getTime());
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
      this.activeChatters.recordSeen(actor, now.getTime());

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
   * The persistable snapshot of the running skip campaign, or null while none is collecting.
   *
   * This is what the worker flushes to chat_skip_vote for the playout container. The threshold is
   * baked in at snapshot time because it derives from the active-chatter count, which only this
   * process knows; the window end is derived from the campaign's own start so taking a snapshot
   * never slides the deadline. The same Math.max(10, ...) clamp as applySkipVote, so the persisted
   * deadline agrees with the rule that actually lapses the tally.
   */
  getSkipVoteRecord(config: ChatInteractionConfig): SkipVoteOverlaySource & { startedAt: string } | null {
    if (!this.skipState || this.skipState.voters.length === 0) {
      return null;
    }

    const votesNeeded = applySkipVote({
      state: this.skipState,
      // Probe with an actor already counted, so this reports the threshold without casting a vote.
      actor: this.skipState.voters[0] ?? "",
      assetId: this.skipState.assetId,
      activeChatterCount: this.getActiveChatterCount(),
      config,
      now: this.now()
    }).votesNeeded;

    return {
      assetId: this.skipState.assetId,
      skipCommand: config.skipCommand,
      votes: this.skipState.voters.length,
      votesNeeded,
      startedAt: this.skipState.startedAt,
      expiresAt: new Date(
        Date.parse(this.skipState.startedAt) + Math.max(10, config.skipWindowSeconds) * 1000
      ).toISOString()
    };
  }

  /**
   * What the overlay should draw right now, or null when nothing is running.
   *
   * Built from the same projections and the same chooser the playout container uses on the
   * persisted rows, so what the worker would draw and what actually goes on air cannot drift.
   */
  getOverlayView(config: ChatInteractionConfig): OverlayEngagementView | null {
    const now = this.now();
    const voteView = this.session ? buildEngagementOverlayViewFromVoteSession(this.session, now) : null;
    const skipRecord = this.getSkipVoteRecord(config);
    const skipView = skipRecord ? buildEngagementOverlayViewFromSkipVote(skipRecord, now) : null;
    return chooseEngagementOverlayView(voteView, skipView);
  }
}

/**
 * The slice of a poll the overlay projection needs. Both the live VoteSession in the worker and
 * the persisted chat_vote_session row satisfy it, so the same projection serves both sides of the
 * process boundary and their wording cannot drift apart.
 */
export type VoteSessionOverlaySource = {
  status: "open" | "closed";
  closesAt: string;
  options: { token: string; title: string; votes: number }[];
};

/**
 * Projects a poll into what the overlay draws. Used by the playout container, which only ever
 * reads: the render model is re-derived from the row on every render interval, never stored, so
 * the countdown ticks between the worker's change-driven flushes. Returns null — no panel — when
 * no poll is open, when it has nothing to choose from, or when its deadline has passed: a worker
 * that dies mid-poll leaves the row open forever, and the deadline inside the row is the only
 * signal playout has to take the panel off air.
 */
export function buildEngagementOverlayViewFromVoteSession(
  session: VoteSessionOverlaySource,
  now: Date
): OverlayEngagementView | null {
  if (session.status !== "open" || session.options.length === 0) {
    return null;
  }

  const closesAtMs = Date.parse(session.closesAt);
  if (!Number.isFinite(closesAtMs) || closesAtMs <= now.getTime()) {
    return null;
  }

  return {
    kind: "vote-next",
    headline: "Was läuft als Nächstes?",
    options: session.options.map((option) => ({
      token: option.token,
      title: option.title,
      votes: option.votes
    })),
    totalVotes: session.options.reduce((sum, option) => sum + option.votes, 0),
    secondsRemaining: Math.max(0, Math.round((closesAtMs - now.getTime()) / 1000)),
    threshold: 0,
    hint: `Schreib ${session.options.map((option) => option.token).join(", ")} in den Chat`
  };
}

/**
 * The slice of a skip campaign the overlay projection needs. Both the worker's snapshot and the
 * persisted chat_skip_vote row satisfy it, for the same reason as VoteSessionOverlaySource: one
 * projection on both sides of the process boundary, so the wording cannot drift apart.
 */
export type SkipVoteOverlaySource = {
  assetId: string;
  skipCommand: string;
  votes: number;
  votesNeeded: number;
  expiresAt: string;
};

/**
 * Projects a skip campaign into what the overlay draws. Returns null — no panel — for an empty or
 * cleared row, and for a row whose window has lapsed. The lapse check is the worker-restart guard:
 * the tally itself lives in worker memory, so after a restart the persisted numbers are the only
 * trace of a campaign that no longer exists, and rendering them would fabricate progress viewers
 * can no longer join. A row older than its own window says nothing, on either side.
 */
export function buildEngagementOverlayViewFromSkipVote(
  record: SkipVoteOverlaySource,
  now: Date
): OverlayEngagementView | null {
  if (record.votes <= 0 || record.votesNeeded <= 0) {
    return null;
  }

  const expiresAtMs = Date.parse(record.expiresAt);
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= now.getTime()) {
    return null;
  }

  const command = record.skipCommand.trim() || "skip";
  return {
    kind: "skip-vote",
    headline: "Überspringen?",
    options: [{ token: `!${command}`, title: "Weiter zum nächsten Video", votes: record.votes }],
    // The layout draws each option's share of totalVotes as its bar, so handing it the threshold
    // makes the single bar read as progress toward passing.
    totalVotes: record.votesNeeded,
    secondsRemaining: Math.max(0, Math.round((expiresAtMs - now.getTime()) / 1000)),
    threshold: record.votesNeeded,
    hint: `${String(record.votes)} von ${String(record.votesNeeded)} Stimmen`
  };
}

/**
 * Decides which engagement view gets the panel when both a poll and a skip campaign are live.
 *
 * There is one panel slot on the rail, and splitting it would leave both halves unreadable at
 * broadcast size. The one with less time left wins: its chance of being seen is the scarce
 * resource, and the other still has runway once the first resolves. With the default settings the
 * 60s poll therefore shows over the 120s skip window, then the skip campaign inherits the slot for
 * its remaining minute. Ties go to the skip campaign because its failure mode is silent — a lapsed
 * campaign just disappears — while an unseen poll still closes visibly and the schedule carries on.
 */
export function chooseEngagementOverlayView(
  voteView: OverlayEngagementView | null,
  skipView: OverlayEngagementView | null
): OverlayEngagementView | null {
  if (!voteView || !skipView) {
    return voteView ?? skipView;
  }

  return skipView.secondsRemaining <= voteView.secondsRemaining ? skipView : voteView;
}
