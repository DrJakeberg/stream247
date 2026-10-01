import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { closedSourceBreaker, planSourceBreakerUpdates, type SourceBreakerRecord } from "@stream247/core";
import { DECLARED_SCHEMA } from "../../packages/db/src/schema-manifest";
import { classifyIncidentFingerprint } from "../../apps/worker/src/incident-classes.js";
import { planSourceBreakerIncidents } from "../../apps/worker/src/source-breaker-incidents.js";
import { sourceBreakerOutcomesOf } from "../../apps/worker/src/source-breaker-outcomes.js";
import { TwitchVodCachePendingError } from "../../apps/worker/src/twitch-vod-cache.js";

// M75. The DUT case of 2026-09-28: the YouTube source of pool "TwitchYoutube", 0 of 11 items resolvable.
const YOUTUBE = "source_jjwuu0f3";
const sources = [
  { id: "source_e2au8vv3", name: "Twitch archive" },
  { id: YOUTUBE, name: "YouTube channel" }
];
const T0 = Date.parse("2026-09-28T10:00:00.000Z");
const at = (minutes: number) => new Date(T0 + minutes * 60_000).toISOString();
const FINGERPRINT = `playout.source-breaker.${YOUTUBE}`;

function incidents(
  records: SourceBreakerRecord[],
  minutes: number,
  open: string[] = [],
  quarantined = 0,
  hasPoolCandidate: (sourceId: string) => boolean = () => true
) {
  return planSourceBreakerIncidents({
    records,
    sources,
    quarantinedBySource: new Map(quarantined > 0 ? [[YOUTUBE, { count: quarantined }]] : []),
    openFingerprints: new Set(open),
    nowMs: Date.parse(at(minutes)),
    hasPoolCandidate
  });
}

describe("source breaker incident", () => {
  it("is a playout state keyed by source, not an event and not one entry per item", () => {
    expect(classifyIncidentFingerprint(FINGERPRINT)).toMatchObject({ kind: "state", area: "playout", keyed: "suffix" });
    // Not swallowed by the per-item family it sits next to.
    expect(classifyIncidentFingerprint(FINGERPRINT)?.fingerprint).toBe("playout.source-breaker");
  });

  it("opens with the breaker, follows it into the trial, and resolves when a clean trial closes it", () => {
    const failed = (assetId: string) => ({ sourceId: YOUTUBE, assetId, outcome: "failed" as const, error: "Requested format is not available" });
    let records: SourceBreakerRecord[] = [];
    const apply = (outcomes: Parameters<typeof planSourceBreakerUpdates>[1], minutes: number) => {
      const plan = planSourceBreakerUpdates(records, outcomes, at(minutes));
      const byId = new Map(records.map((record) => [record.sourceId, record] as const));
      for (const record of plan.updates) {
        byId.set(record.sourceId, record);
      }
      records = [...byId.values()];
      return plan;
    };

    apply([failed("y1"), failed("y2")], 0);
    expect(incidents(records, 0)).toEqual([]);

    apply([failed("y3")], 1);
    const [opened] = incidents(records, 1, [], 2);
    expect(opened).toMatchObject({ action: "upsert", fingerprint: FINGERPRINT, title: "YouTube channel is held out of programming" });
    expect(opened && "title" in opened ? opened.message : "").toContain("3 different items");
    expect(opened && "title" in opened ? opened.message : "").toContain("try one item of it after 2026-09-28 10:31 UTC");
    // The per-item count rides along, because that incident stands back while this one is open.
    expect(opened && "title" in opened ? opened.message : "").toContain("2 of its items are also skipped");

    const [trial] = incidents(records, 40, [FINGERPRINT]);
    expect(trial && "title" in trial ? trial.message : "").toContain("the next item a pool picks from it is a trial probe");

    const closing = apply([{ sourceId: YOUTUBE, assetId: "y4", outcome: "ok", error: "" }], 41);
    expect(closing.transitions.map((transition) => transition.kind)).toEqual(["closed"]);
    expect(incidents(records, 41, [FINGERPRINT])).toEqual([
      { action: "resolve", sourceId: YOUTUBE, fingerprint: FINGERPRINT, message: "The source is back in the pool rotation." }
    ]);
    // Once resolved, a closed breaker costs no write on later cycles.
    expect(incidents(records, 42, [])).toEqual([]);
  });

  it("resolves the incident of a source that no longer exists", () => {
    const orphan: SourceBreakerRecord = { ...closedSourceBreaker("source_gone"), state: "open", openedAt: at(0), cooldownSeconds: 1800 };
    expect(incidents([orphan], 5, ["playout.source-breaker.source_gone"])).toEqual([
      { action: "resolve", sourceId: "source_gone", fingerprint: "playout.source-breaker.source_gone", message: "The source no longer exists." }
    ]);
  });

  // M75 review: the source page's Delete removes the breaker row in the same transaction, so no row is
  // left to walk; a state incident is never resolved by age.
  it("resolves the open incident of a source deleted with its row, and leaves other families alone", () => {
    const gone = "playout.source-breaker.source_deleted";
    expect(incidents([], 5, [gone, "playout.source-unplayable.source_deleted", "playout.twitch-cache.failed"])).toEqual([
      { action: "resolve", sourceId: "source_deleted", fingerprint: gone, message: "The source no longer exists." }
    ]);
    expect(incidents([], 5, [])).toEqual([]);
  });

  // M75 review: half-open waits for a trial pick; with every item quarantined (where failed trials end
  // the SABR case) no pick ever comes, and the per-item incident stayed hidden behind this one.
  it("closes a breaker that holds a source no pool could pick anyway, open or half-open", () => {
    const held: SourceBreakerRecord = {
      ...closedSourceBreaker(YOUTUBE),
      state: "open",
      failedAssetIds: ["y1", "y2", "y3"],
      openedAt: at(0),
      cooldownSeconds: 1800,
      lastError: "Requested format is not available"
    };
    const nothingToPick = (sourceId: string) => sourceId !== YOUTUBE;
    for (const minutes of [10, 40]) {
      const [action] = incidents([held], minutes, [FINGERPRINT], 11, nothingToPick);
      expect(action).toMatchObject({ action: "close", sourceId: YOUTUBE, fingerprint: FINGERPRINT, incidentOpen: true });
      expect(action && "message" in action ? action.message : "").toContain("nothing left to hold");
    }
    // Closed without an incident to resolve when none was raised yet; a closed breaker is never closed again.
    expect(incidents([held], 40, [], 11, nothingToPick)).toMatchObject([{ action: "close", incidentOpen: false }]);
    expect(incidents([closedSourceBreaker(YOUTUBE)], 40, [], 11, nothingToPick)).toEqual([]);
  });
});

// M75 review: with remote fallback off (the default) the playout refuses an archive until its download
// is done, and the runner downloads one at a time. A single-source Twitch pool's queue of four held three
// such archives, and the breaker opened on a healthy source within about three cycles.
describe("which outcomes the breaker hears", () => {
  const TWITCH = "source_e2au8vv3";
  const archive = (id: string) => ({ id, sourceId: TWITCH });
  const notCachedYet = "Twitch VOD cache is missing: Twitch VOD is not cached yet.";

  it("leaves out archives still downloading: three of them do not open the breaker", () => {
    const outcomes = sourceBreakerOutcomesOf(
      ["t1", "t2", "t3"].map((id) => ({ asset: archive(id), outcome: "failed" as const, error: notCachedYet, pendingDownload: true }))
    );
    expect(outcomes).toEqual([]);
    expect(planSourceBreakerUpdates([], outcomes, at(0))).toEqual({ updates: [], transitions: [] });
  });

  it("neither counts nor resets: real failures around a pending download still add up", () => {
    const outcomes = sourceBreakerOutcomesOf([
      { asset: archive("t1"), outcome: "failed", error: "HTTP Error 404: Not Found" },
      { asset: archive("t2"), outcome: "failed", error: notCachedYet, pendingDownload: true },
      { asset: archive("t3"), outcome: "failed", error: "HTTP Error 404: Not Found" },
      { asset: archive("t4"), outcome: "ok", error: "" }
    ]);
    expect(outcomes.map((outcome) => [outcome.assetId, outcome.outcome])).toEqual([
      ["t1", "failed"],
      ["t3", "failed"],
      ["t4", "ok"]
    ]);
  });

  it("marks the refusal with a type of its own, still an Error for every other reader", () => {
    const error = new TwitchVodCachePendingError(notCachedYet);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe(notCachedYet);
    expect(error.name).toBe("TwitchVodCachePendingError");
  });
});

// The worker module starts the playout on import, so its wiring is checked in its source.
describe("source breaker wiring", () => {
  const read = (relative: string) => readFileSync(path.join(process.cwd(), relative), "utf8");
  const workerSource = read("apps/worker/src/index.ts");
  const dbSource = read("packages/db/src/index.ts");
  const flatWorker = workerSource.replace(/\s+/g, " ");
  const bodyOf = (source: string, signature: string) => {
    const start = source.indexOf(signature);
    expect(start).toBeGreaterThan(-1);
    const rest = source.slice(start + signature.length);
    const end = rest.search(/\n(?:export )?(?:async )?function /);
    return source.slice(start, end === -1 ? undefined : start + signature.length + end);
  };

  it("gates the worker's selection, queue and lookahead with the breaker as it stands", () => {
    expect(bodyOf(workerSource, "function poolSourceGate(")).toContain("sourceBreakerGate(state.sourceBreakers, Date.now())");
    for (const signature of ["function selectPoolAsset(", "function getPoolPlaybackQueue(", "function lookaheadVideoTitleFromPool("]) {
      expect(bodyOf(workerSource, signature)).toContain("sourceGate: poolSourceGate(state)");
    }
    // The item on air is kept as the pool's current item without asking the gate: an opening breaker
    // never takes a running item off air.
    const currentPoolAsset = workerSource.slice(workerSource.indexOf("const currentPoolAsset ="), workerSource.indexOf("const preferredAsset ="));
    expect(currentPoolAsset).not.toContain("poolSourceGate");
  });

  it("keeps a held source out of the generic fallback tiers too, not out of the global fallback", () => {
    expect(flatWorker).toContain(
      "const heldSourceIds = new Set(poolSourceGate(state).heldSourceIds); const anyReadyAsset = [...state.assets]"
    );
    expect(flatWorker).toContain(".filter((asset) => asset.id !== skippedAssetId && !heldSourceIds.has(asset.sourceId))");
    const globalFallback = flatWorker.slice(flatWorker.indexOf("const globalFallback = [...state.assets]"), flatWorker.indexOf("if (globalFallback) {"));
    expect(globalFallback).not.toContain("heldSourceIds");
    // Both recovery plans: the bridge before a cold resolve and the recovery after a failed one.
    expect(
      flatWorker.match(/planRecoveryAfterPlaybackPreparationFailure\(state\.assets, failedAsset, poolSourceGate\(state\)\.heldSourceIds\)/g)
    ).toHaveLength(2);
  });

  it("keeps the cycle going when the scan's breaker write fails", () => {
    // A throw from the serialized write used to leave runPlayoutCycle before switching and the queue.
    expect(flatWorker).toContain(
      "let heldSources = new Set<string>(); try { heldSources = await applySourceBreakerOutcomes({ state, probeOutcomes, quarantinedBySource }); } catch (writeError) { logRuntimeEvent(\"playout.source-breaker.write_failed\", { scope: \"scan\","
    );
  });

  it("feeds the breaker the outcomes quarantine counted, before the per-item incident is decided", () => {
    const counted = flatWorker.indexOf("const quarantinedBySource = countQuarantinedBySource(state.assets, quarantineOverrides);");
    const applied = flatWorker.indexOf("heldSources = await applySourceBreakerOutcomes({ state, probeOutcomes, quarantinedBySource });");
    const unplayable = flatWorker.indexOf("fingerprint: `playout.source-unplayable.${sourceId}`");
    expect(counted).toBeGreaterThan(-1);
    expect(applied).toBeGreaterThan(counted);
    expect(unplayable).toBeGreaterThan(applied);
    expect(flatWorker).toContain(
      "if (heldSources.has(sourceId)) { await resolveIncident( `playout.source-unplayable.${sourceId}`,"
    );
    const apply = bodyOf(workerSource, "async function applySourceBreakerOutcomes(");
    expect(apply).toContain("await recordSourceBreakerOutcomes(");
    expect(apply).toContain("records: plan.records");
    expect(apply).not.toContain("state.sourceBreakers");
    expect(apply).toContain("fingerprint: `playout.source-breaker.${action.sourceId}`");
  });

  it("closes a breaker with nothing to hold, judged by the pools' own eligibility", () => {
    const flat = (text: string) => text.replace(/\s+/g, " ");
    expect(flat(bodyOf(workerSource, "function sourceHasPoolCandidate("))).toContain(
      'pool.sourceIds.includes(sourceId) && state.assets.some((asset) => asset.sourceId === sourceId && isPoolAssetEligible(pool, asset, ""))'
    );
    const apply = flat(bodyOf(workerSource, "async function applySourceBreakerOutcomes("));
    expect(apply).toContain("hasPoolCandidate: (sourceId) => sourceHasPoolCandidate(args.state, sourceId)");
    expect(apply).toContain('if (action.action === "close") { const closed = await closeSourceBreakerRecord(action.sourceId, nowIso);');
    expect(apply).toContain("if (action.incidentOpen) { await resolveIncident(action.fingerprint, action.message); } continue; }");
    // A closed one is not held, so the per-item incident of the source comes back in the same cycle.
    expect(apply.indexOf('if (action.action === "close")')).toBeLessThan(apply.indexOf("held.add(action.sourceId);"));
  });

  it("tells an archive still downloading from a failure on every path that reaches the breaker", () => {
    const flat = (text: string) => text.replace(/\s+/g, " ");
    // Only while the runner has the download queued or running: a disabled cache or a download that has
    // just failed is still a failure of the source.
    expect(flat(bodyOf(workerSource, "async function resolveAssetPlaybackInput("))).toContain(
      "if (vodCacheJobRunner.isPending(asset.id)) { throw new TwitchVodCachePendingError(message); } throw new Error(message);"
    );
    expect(flat(bodyOf(workerSource, "function resolveQueueAssetIntoProbeCache("))).toContain(
      "pendingDownload: error instanceof TwitchVodCachePendingError,"
    );
    const scan = flat(bodyOf(workerSource, "async function getPlayableQueuedAssets("));
    expect(scan).toContain('probeOutcomes.push({ asset, outcome: "failed", error: cached.error, pendingDownload: cached.pendingDownload });');
    expect(scan).toContain(
      'probeOutcomes.push({ asset, outcome: "failed", error: message, pendingDownload: error instanceof TwitchVodCachePendingError });'
    );
    expect(bodyOf(workerSource, "async function applySourceBreakerOutcomes(")).toContain(
      "recordSourceBreakerOutcomes(sourceBreakerOutcomesOf(args.probeOutcomes), nowIso)"
    );
    const selection = flat(bodyOf(workerSource, "async function recordSelectionResolveOutcome("));
    expect(selection).toContain("pendingDownload: error instanceof TwitchVodCachePendingError");
    expect(selection).toContain("if (outcomes.length === 0) { return; }");
  });

  it("lets the breaker hear the inline resolve of the selection, the only judge of a trial picked straight away", () => {
    const inline = flatWorker.indexOf("prepared = await resolveAssetPlaybackInput(failedAsset);");
    expect(inline).toBeGreaterThan(-1);
    const around = flatWorker.slice(inline - 120, inline + 400);
    expect(around).toContain('} catch (error) { await recordSelectionResolveOutcome(failedAsset, "failed", error); throw error; }');
    expect(around).toContain('await recordSelectionResolveOutcome(failedAsset, "ok");');
    // Only that call: a failed fallback bridge resolve is not the scheduled item's failure.
    expect(flatWorker.match(/recordSelectionResolveOutcome\(failedAsset/g)).toHaveLength(2);
    // It must never throw inside the resolve's own try, where a failed write would read as a failed resolve.
    const record = bodyOf(workerSource, "async function recordSelectionResolveOutcome(");
    expect(record).toContain("} catch (writeError) {");
  });

  it("stores the breaker in its own table on every path an install can take, and never from a whole-state write", () => {
    const create = "CREATE TABLE IF NOT EXISTS source_breakers (";
    expect(dbSource.split(create)).toHaveLength(3);
    expect(dbSource).toContain('id: "20261001_002_source_breakers"');
    expect(DECLARED_SCHEMA.source_breakers).toEqual([
      "cooldown_seconds",
      "failed_asset_ids",
      "last_error",
      "opened_at",
      "source_id",
      "state",
      "updated_at"
    ]);
    const persist = bodyOf(dbSource, "async function persistState(");
    expect(persist).not.toMatch(/INSERT INTO source_breakers|DELETE FROM source_breakers/);
    expect(bodyOf(dbSource, "export async function deleteSourceRecordAndAssets(")).toContain(
      "DELETE FROM source_breakers WHERE source_id = $1"
    );
  });
});
