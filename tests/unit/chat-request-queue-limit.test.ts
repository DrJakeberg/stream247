import { describe, expect, it } from "vitest";
import { createDefaultChatInteractionConfig, type ChatInteractionConfig, type RequestCandidate } from "@stream247/core";
import { ChatViewerRequestPass, type ChatViewerRequestHistory } from "../../apps/worker/src/chat-viewer-requests";

/**
 * The queue cap for "!request", inside a single drain pass.
 *
 * Repair [5] made the cap and the cooldown read real history instead of empty placeholders. But
 * the queue it read them against was the worker cycle's snapshot, state.playout.queuedAssetIds,
 * and drainChatEffects decides every accumulated request against it in one loop. The snapshot does
 * not move while that loop runs — an accepted request only reaches it through updatePlayoutRuntime,
 * which the loop never reads back. So with a cap of two and ten viewers typing "!request" inside
 * the same ~30 second cycle, all ten saw the same zero: the cap never bound, and neither did
 * "that one is already in the queue".
 *
 * There is a second-order version of the same mistake. markChatViewerRequestsPlayed marks every
 * queued row whose asset is not in the list it is handed; called with the frozen snapshot on the
 * next turn of the loop, it marks the row this pass just wrote as "played" — so even the count
 * that did reach the database was wiped before it could be read.
 */

/**
 * The three database calls of the drain, with the semantics of the SQL in packages/db:
 * countQueued counts queued rows whose asset is in the list, markPlayed retires every queued row
 * whose asset is not, and listRecent returns rows newer than the cutoff.
 */
function fakeHistory(): ChatViewerRequestHistory & { rows: { actor: string; assetId: string; createdAt: string; status: string }[] } {
  const rows: { actor: string; assetId: string; createdAt: string; status: string }[] = [];
  return {
    rows,
    async markPlayed(queuedAssetIds) {
      for (const row of rows) {
        if (row.status === "queued" && !queuedAssetIds.includes(row.assetId)) {
          row.status = "played";
        }
      }
    },
    async listRecent(sinceIso) {
      return rows.filter((row) => row.createdAt > sinceIso).map(({ actor, assetId, createdAt }) => ({ actor, assetId, createdAt }));
    },
    async countQueued(queuedAssetIds) {
      return rows.filter((row) => row.status === "queued" && queuedAssetIds.includes(row.assetId)).length;
    }
  };
}

const candidates: RequestCandidate[] = Array.from({ length: 12 }, (_, index) => ({
  assetId: `asset-${index + 1}`,
  title: `Track ${index + 1}`,
  requestable: true
}));

function config(overrides: Partial<ChatInteractionConfig> = {}): ChatInteractionConfig {
  return {
    ...createDefaultChatInteractionConfig(),
    enabled: true,
    requestsEnabled: true,
    requestQueueLimit: 2,
    // Ten different viewers, so nothing here is decided by the per-viewer cooldown.
    requestCooldownSeconds: 300,
    ...overrides
  };
}

/**
 * One drain pass, exactly as drainChatEffects runs it: decide, and on acceptance write the row
 * and extend the playout queue. The pass object is the production one.
 */
async function runPass(
  requests: { actor: string; query: string }[],
  options: { queuedAssetIds?: string[]; config?: ChatInteractionConfig } = {}
): Promise<{ reasons: string[]; queued: string[] }> {
  const history = fakeHistory();
  const settings = options.config ?? config();
  const queued = [...(options.queuedAssetIds ?? [])];
  const pass = new ChatViewerRequestPass({ queuedAssetIds: queued, history });
  const reasons: string[] = [];

  for (const request of requests) {
    const { verdict } = await pass.decide({ ...request, candidates, config: settings, now: new Date("2026-09-02T12:00:00.000Z") });
    if (!verdict.accepted) {
      reasons.push(verdict.reason);
      continue;
    }
    reasons.push("accepted");
    history.rows.push({ actor: request.actor, assetId: verdict.assetId, createdAt: new Date().toISOString(), status: "queued" });
    queued.push(verdict.assetId);
  }

  return { reasons, queued };
}

describe("the !request queue cap inside one drain pass", () => {
  it("binds from the limit on when ten viewers ask in the same cycle", async () => {
    const { reasons, queued } = await runPass(
      Array.from({ length: 10 }, (_, index) => ({ actor: `viewer${index + 1}`, query: `Track ${index + 1}` }))
    );

    expect(reasons.slice(0, 2)).toEqual(["accepted", "accepted"]);
    expect(reasons.slice(2)).toEqual(Array.from({ length: 8 }, () => "queue-full"));
    expect(queued).toEqual(["asset-1", "asset-2"]);
  });

  it("counts what the cycle already held towards the same cap", async () => {
    // One viewer request is already in the queue from an earlier cycle, so a cap of two leaves
    // room for exactly one more.
    const { reasons } = await runPass(
      [
        { actor: "ada", query: "Track 5" },
        { actor: "bea", query: "Track 6" }
      ],
      { queuedAssetIds: [] }
    );
    expect(reasons).toEqual(["accepted", "accepted"]);

    const raised = await runPass(
      [
        { actor: "ada", query: "Track 5" },
        { actor: "bea", query: "Track 6" },
        { actor: "cal", query: "Track 7" }
      ],
      { config: config({ requestQueueLimit: 3 }) }
    );
    expect(raised.reasons).toEqual(["accepted", "accepted", "accepted"]);
  });

  it("queues the same title once, however many viewers ask for it in the pass", async () => {
    const { reasons, queued } = await runPass(
      [
        { actor: "ada", query: "Track 4" },
        { actor: "bea", query: "Track 4" },
        { actor: "cal", query: "Track 4" }
      ],
      { config: config({ requestQueueLimit: 5 }) }
    );

    expect(reasons).toEqual(["accepted", "already-queued", "already-queued"]);
    expect(queued).toEqual(["asset-4"]);
  });

  it("does not retire the rows the pass itself just wrote", async () => {
    const history = fakeHistory();
    const pass = new ChatViewerRequestPass({ queuedAssetIds: [], history });
    const settings = config({ requestQueueLimit: 5 });
    const now = new Date("2026-09-02T12:00:00.000Z");

    const first = await pass.decide({ actor: "ada", query: "Track 1", candidates, config: settings, now });
    history.rows.push({ actor: "ada", assetId: first.verdict.assetId, createdAt: now.toISOString(), status: "queued" });

    const second = await pass.decide({ actor: "bea", query: "Track 2", candidates, config: settings, now });

    // markPlayed ran again before this decision. The row from the first request is still queued,
    // so the cap can still see it.
    expect(history.rows.map((row) => row.status)).toEqual(["queued"]);
    expect(second.queuedRequestCount).toBe(1);
  });
});
