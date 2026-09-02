// One drainChatEffects pass over the "!request" effects the IRC handler recorded.
//
// The rules themselves are pure and live in packages/core/chat-interaction.ts. What lives here is
// the part that has to know about a pass: which history the cooldown and the cap are decided on,
// and what the queue looks like while the pass is still running. The database access is injected
// so the pass can be measured without one — apps/worker/src/index.ts starts a worker on import,
// so the loop around it is not reachable from a test any other way.

import { evaluateViewerRequest } from "@stream247/core";
import type { ChatInteractionConfig, RequestCandidate, RequestVerdict, ViewerRequestRecord } from "@stream247/core";

/** The viewer-request history, exactly the three database calls the drain makes. */
export type ChatViewerRequestHistory = {
  /** A queued request whose asset is no longer in the queue has been played — say so. */
  markPlayed(queuedAssetIds: string[]): Promise<void>;
  /** Requests newer than `sinceIso`, for the per-viewer cooldown. */
  listRecent(sinceIso: string): Promise<ViewerRequestRecord[]>;
  /** Queued requests whose asset is one of these ids, for the outstanding-request cap. */
  countQueued(queuedAssetIds: string[]): Promise<number>;
};

export type ChatViewerRequestDecision = {
  actor: string;
  query: string;
  candidates: RequestCandidate[];
  config: ChatInteractionConfig;
  now: Date;
};

export type ChatViewerRequestOutcome = {
  verdict: RequestVerdict;
  /** Viewer requests already waiting in the queue when this one was judged. */
  queuedRequestCount: number;
};

/**
 * The queue as one drain pass sees it.
 *
 * A pass is one worker cycle's worth of chat: drainChatEffects takes everything the IRC handler
 * recorded since the last cycle and decides it in a loop.
 */
export class ChatViewerRequestPass {
  private readonly queuedAssetIds: string[];
  private readonly history: ChatViewerRequestHistory;

  constructor(args: { queuedAssetIds: string[]; history: ChatViewerRequestHistory }) {
    this.queuedAssetIds = [...args.queuedAssetIds];
    this.history = args.history;
  }

  /** The queue the next request of this pass is judged against. */
  queueView(): string[] {
    return [...this.queuedAssetIds];
  }

  /**
   * Decides one request against the history and the queue, and records an accepted one so the
   * rest of the pass sees it.
   */
  async decide(request: ChatViewerRequestDecision): Promise<ChatViewerRequestOutcome> {
    const queuedAssetIds = this.queueView();
    // The history the cooldown and the cap are decided on. A request whose asset has left the
    // queue has been played and no longer counts against the cap; the cooldown looks back exactly
    // as far as it is long.
    await this.history.markPlayed(queuedAssetIds);
    const sinceIso = new Date(
      request.now.getTime() - Math.max(0, request.config.requestCooldownSeconds) * 1000
    ).toISOString();
    const [recentRequests, queuedRequestCount] = await Promise.all([
      this.history.listRecent(sinceIso),
      this.history.countQueued(queuedAssetIds)
    ]);

    const verdict = evaluateViewerRequest({
      actor: request.actor,
      query: request.query,
      candidates: request.candidates,
      recentRequests,
      queuedRequestCount,
      queuedAssetIds,
      config: request.config,
      now: request.now
    });

    return { verdict, queuedRequestCount };
  }
}
