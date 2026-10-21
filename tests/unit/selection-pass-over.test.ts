import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  closedSourceBreaker,
  nextPoolRotationAsset,
  planSourceBreakerUpdates,
  sourceBreakerGate,
  type ProgrammingOrderAsset,
  type SourceBreakerRecord
} from "@stream247/core";
import { decideSelectionResolveFailure, isPassedOverPoolPick } from "../../apps/worker/src/selection-pass-over.js";

const workerSource = readFileSync(path.join(process.cwd(), "apps/worker/src/index.ts"), "utf8");
const flatWorker = workerSource.replace(/\s+/g, " ");

// M98 follow-up 1 (M112): a pool of three broken items, one source, played by the worker's 15 s cycle.
const SOURCE = "source_broken";
const items: ProgrammingOrderAsset[] = ["a404", "b404", "c404"].map((id, index) => ({
  id,
  sourceId: SOURCE,
  title: id,
  createdAt: new Date(Date.UTC(2026, 9, index + 1)).toISOString()
}));
const CYCLE_MS = 15_000;
// NEXT_ASSET_PROBE_FAILED_TTL_MS in index.ts: how long a failure stays in the probe cache.
const FAILED_TTL_MS = 60_000;

/**
 * Cycles of the selection with every inline resolve failing: what was picked, and the breaker after.
 * `passOver` false is the code before M112: no failure is cached, nothing is passed over.
 */
function runCycles(cycles: number, passOver: boolean): { picks: string[]; breaker: SourceBreakerRecord } {
  const pool = { sourceIds: [SOURCE] };
  const cache = new Map<string, { status: "failed"; pendingDownload: boolean; checkedAt: number }>();
  let breakers: SourceBreakerRecord[] = [closedSourceBreaker(SOURCE)];
  const picks: string[] = [];
  const startMs = Date.parse("2026-10-21T01:00:00.000Z");
  for (let cycle = 0; cycle < cycles; cycle += 1) {
    const nowMs = startMs + cycle * CYCLE_MS;
    const fresh = (id: string) => {
      const entry = cache.get(id);
      return entry && nowMs - entry.checkedAt <= FAILED_TTL_MS ? entry : null;
    };
    const pick = nextPoolRotationAsset({
      pool,
      assets: items,
      isEligible: (asset) => !passOver || !isPassedOverPoolPick(fresh(asset.id)),
      sourceGate: sourceBreakerGate(breakers, nowMs)
    });
    if (!pick) {
      picks.push("fallback");
      continue;
    }
    picks.push(pick.asset.id);
    // The inline resolve fails; the breaker hears it (recordSelectionResolveOutcome), and since M112 the
    // failure goes to the probe cache.
    const nowIso = new Date(nowMs).toISOString();
    const plan = planSourceBreakerUpdates(
      breakers,
      [{ sourceId: SOURCE, assetId: pick.asset.id, outcome: "failed", error: "HTTP Error 404: Not Found" }],
      nowIso
    );
    breakers = breakers.map((record) => plan.updates.find((update) => update.sourceId === record.sourceId) ?? record);
    if (
      passOver &&
      decideSelectionResolveFailure({ reasonCode: "scheduled_match", pendingDownload: false, cached: fresh(pick.asset.id) }) ===
        "record"
    ) {
      cache.set(pick.asset.id, { status: "failed", pendingDownload: false, checkedAt: nowMs });
    }
  }
  return { picks, breaker: breakers[0]! };
}

describe("a pool passes over a pick that cannot be prepared (M112)", () => {
  it("before M112: the pool stays on its first broken item for over four minutes, breaker at one item", () => {
    const { picks, breaker } = runCycles(17, false);
    expect(new Set(picks)).toEqual(new Set(["a404"]));
    expect(breaker.state).toBe("closed");
    expect(breaker.failedAssetIds).toEqual(["a404"]);
  });

  it("moves to the next item each cycle, and the breaker opens on the third, within 45 s", () => {
    const { picks, breaker } = runCycles(17, true);
    expect(picks.slice(0, 3)).toEqual(["a404", "b404", "c404"]);
    // Then the breaker holds the source and the cycle airs the fallback ladder.
    expect(picks.slice(3).every((pick) => pick === "fallback")).toBe(true);
    expect(breaker.state).toBe("open");
    expect(breaker.failedAssetIds).toEqual(["a404", "b404", "c404"]);
  });

  it("decides per failure: schedule picks only, never an archive still downloading, once per fresh failure", () => {
    const failed = { status: "failed" as const, pendingDownload: false };
    expect(decideSelectionResolveFailure({ reasonCode: "scheduled_match", pendingDownload: false, cached: null })).toBe("record");
    expect(decideSelectionResolveFailure({ reasonCode: "scheduled_match", pendingDownload: false, cached: failed })).toBe(
      "already-recorded"
    );
    expect(
      decideSelectionResolveFailure({
        reasonCode: "scheduled_match",
        pendingDownload: false,
        cached: { status: "ready", pendingDownload: false }
      })
    ).toBe("record");
    expect(decideSelectionResolveFailure({ reasonCode: "scheduled_match", pendingDownload: true, cached: null })).toBe("ignore");
    for (const reasonCode of ["operator_insert", "scheduled_insert", "manual_next", "global_fallback", "generic_fallback"]) {
      expect(decideSelectionResolveFailure({ reasonCode, pendingDownload: false, cached: null }), reasonCode).toBe("ignore");
    }
    expect(isPassedOverPoolPick(null)).toBe(false);
    expect(isPassedOverPoolPick(failed)).toBe(true);
    expect(isPassedOverPoolPick({ status: "failed", pendingDownload: true })).toBe(false);
    expect(isPassedOverPoolPick({ status: "ready", pendingDownload: false })).toBe(false);
  });

  it("is wired into the worker's pool pick, its inline resolve and quarantine's list", () => {
    const select = workerSource.slice(
      workerSource.indexOf("function selectPoolAsset("),
      workerSource.indexOf("function getPoolPlaybackQueue(")
    );
    expect(select.replace(/\s+/g, " ")).toContain(
      "isPoolAssetEligible(pool, asset, skippedAssetId, removedNextAssetId) && !isPassedOverPoolPick(getFreshProbeCache(asset.id))"
    );
    // The failure is written as counted: the queue's scan must not count it a second time.
    const record = workerSource.slice(
      workerSource.indexOf("function recordSelectionResolveFailure("),
      workerSource.indexOf("function getFreshProbeCache(")
    );
    expect(record).toContain("cached: getFreshProbeCache(asset.id)");
    expect(record).toContain("outcomeCounted: true");
    expect(record).toContain("pendingDownload: error instanceof TwitchVodCachePendingError");
    expect(flatWorker).toContain(
      "const passedOver = recordSelectionResolveFailure(failedAsset, failedReasonCode, error); if (passedOver) { selectionProbeOutcomes.push(passedOver); }"
    );
    expect(flatWorker.match(/recordSelectionResolveFailure\(/g)).toHaveLength(2);
  });
});
