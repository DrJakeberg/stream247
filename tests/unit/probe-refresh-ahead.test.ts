import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isProbeCandidatePlayFailed, isProbeRefreshDue, planQueuePrefetch } from "../../apps/worker/src/queue-prefetch";

const flatWorker = readFileSync(path.join(process.cwd(), "apps/worker/src/index.ts"), "utf8").replace(/\s+/g, " ");

// M105, review finding R12: a warm remote insert went cold after every five-minute probe-cache expiry, and a
// boundary in that gap bridged it and skipped it for good. The entry is now resolved again before it expires.

const TTL = 5 * 60_000;
const AHEAD = 60_000;
const due = (ageMs: number, status = "ready") => isProbeRefreshDue({ status, checkedAt: 0, nowMs: ageMs, ttlMs: TTL, aheadMs: AHEAD });

describe("isProbeRefreshDue", () => {
  it("is due in the last minute of a ready entry's five, and not before", () => {
    expect(due(0)).toBe(false);
    expect(due(4 * 60_000)).toBe(false);
    expect(due(4 * 60_000 + 1)).toBe(true);
    expect(due(TTL)).toBe(true);
  });

  it("never for a failed entry, which only waits out its short cooldown", () => {
    expect(due(TTL, "failed")).toBe(false);
  });
});

describe("planQueuePrefetch with refreshes", () => {
  const warmInsert = { cacheStatus: "ready" as const, expensive: true, refreshDue: true };
  const coldNext = { cacheStatus: "none" as const, expensive: true };

  it("keeps using a warm entry while it is resolved again, one refresh per cycle", () => {
    expect(planQueuePrefetch([warmInsert, warmInsert], 1, 1)).toEqual(["refresh", "use-cache"]);
  });

  it("does not spend the awaited budget on it: a cold item after it is still resolved", () => {
    expect(planQueuePrefetch([warmInsert, coldNext], 1, 1)).toEqual(["refresh", "resolve"]);
  });

  it("refreshes nothing cheap, nothing not yet due, and nothing without a refresh budget (coverage down, or callers before M105)", () => {
    expect(planQueuePrefetch([{ cacheStatus: "ready", expensive: false, refreshDue: true }], 1, 1)).toEqual(["use-cache"]);
    expect(planQueuePrefetch([{ cacheStatus: "ready", expensive: true, refreshDue: false }], 1, 1)).toEqual(["use-cache"]);
    expect(planQueuePrefetch([warmInsert], 0, 0)).toEqual(["use-cache"]);
    expect(planQueuePrefetch([warmInsert])).toEqual(["use-cache"]);
  });

  it("closes the gap: a cuepoint item warm behind an hour-long archive is never cold at a 15 s scan", () => {
    // A scan every 15 s; the entry is written again 20 s after its refresh started (a yt-dlp resolve).
    let checkedAt = 0;
    let refreshDoneAt: number | null = null;
    const cold: number[] = [];
    for (let now = 0; now <= 60 * 60_000; now += 15_000) {
      if (refreshDoneAt !== null && now >= refreshDoneAt) {
        checkedAt = refreshDoneAt;
        refreshDoneAt = null;
      }
      const fresh = now - checkedAt <= TTL;
      if (!fresh) {
        cold.push(now);
        checkedAt = now + 20_000;
        continue;
      }
      const [action] = planQueuePrefetch(
        [{ cacheStatus: "ready", expensive: true, refreshDue: isProbeRefreshDue({ status: "ready", checkedAt, nowMs: now, ttlMs: TTL, aheadMs: AHEAD }) }],
        1,
        refreshDoneAt === null ? 1 : 0
      );
      if (action === "refresh") {
        refreshDoneAt = now + 20_000;
      }
    }
    expect(cold).toEqual([]);
  });
});

describe("a refresh that lands after its candidate failed to open (review of M105)", () => {
  // A YouTube pair: the first candidate fails under SABR at once, the exit handler drops the entry and
  // records the candidate; a refresh started before that lands afterwards with the same candidate.
  const failed = new Set(["pair:137+140"]);

  it("is neither written nor used, so the retry resolves from the next candidate", () => {
    expect(isProbeCandidatePlayFailed({ status: "ready", candidateId: "pair:137+140" }, failed)).toBe(true);
    expect(isProbeCandidatePlayFailed({ status: "ready", candidateId: "pair:136+140" }, failed)).toBe(false);
  });

  it("leaves alone an entry without a candidate (a local file, a direct URL), a failed entry, and an item with no failure", () => {
    expect(isProbeCandidatePlayFailed({ status: "ready", candidateId: "" }, failed)).toBe(false);
    expect(isProbeCandidatePlayFailed({ status: "failed", candidateId: "pair:137+140" }, failed)).toBe(false);
    expect(isProbeCandidatePlayFailed({ status: "ready", candidateId: "pair:137+140" }, new Set())).toBe(false);
  });

  it("is what the worker checks where an entry is read and where the refresh writes", () => {
    const fresh = flatWorker.slice(flatWorker.indexOf("function getFreshProbeCache("), flatWorker.indexOf("function isExpensiveQueueResolve("));
    expect(fresh).toContain(
      "if (Date.now() - entry.checkedAt > ttl || isProbeCandidatePlayFailed(entry, getPlayFailedCandidateIds(assetId))) { queueProbeCache.delete(assetId); return null; }"
    );
  });
});

describe("R12 wiring in the worker", () => {
  const flat = readFileSync(path.join(process.cwd(), "apps/worker/src/index.ts"), "utf8").replace(/\s+/g, " ");

  it("marks warm entries due for a refresh (not trials), starts it in the background and keeps using the entry", () => {
    expect(flat).toContain("refreshDue: !isReprobe(index) && Boolean(");
    expect(flat).toContain("expensiveBudget > 0 ? MAX_QUEUE_PROBE_REFRESHES_PER_CYCLE : 0");
    expect(flat).toContain('if (action === "refresh") { refreshQueueAssetProbeCache(asset); } if (action === "use-cache" || action === "refresh") {');
    // The background refresh replaces the entry only on success, and dedups against a resolve in flight.
    const refresh = flat.slice(flat.indexOf("function refreshQueueAssetProbeCache("), flat.indexOf("async function getPlayableQueuedAssets("));
    expect(refresh).toContain("if (queueResolvesInFlight.has(asset.id)) { return; }");
    // ... unless the candidate failed to open while it ran (isProbeCandidatePlayFailed).
    expect(refresh).toContain(
      '.then((prepared) => { // The item failed to open on this candidate while the refresh ran: the exit handler dropped the entry // for the retry\'s fresh resolve, and writing it back would hand the retry the same candidate. if (isProbeCandidatePlayFailed({ status: "ready", candidateId: prepared.media.candidateId }, getPlayFailedCandidateIds(asset.id))) { return; } queueProbeCache.set(asset.id, { status: "ready",'
    );
    expect(refresh).not.toContain('status: "failed"');
  });
});
