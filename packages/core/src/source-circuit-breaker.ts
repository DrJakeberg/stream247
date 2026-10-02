/**
 * When the playout stops drawing on a source that serves none of its items (M75).
 *
 * Measured on the DUT, 2026-09-28: YouTube's SABR change left 0 of the 11 items of the YouTube source
 * resolvable. Per-item quarantine (asset-probe-quarantine.ts) learns that one item at a time and needs
 * three failed probes per item, so the source cost about 33 failed boundaries and fallback bridges before
 * its last item was out of play. Since M73 a pool with several sources alternates between them, so every
 * second pick landed on the broken source for as long as that took.
 *
 * The breaker judges the source instead of the item. Probes that fail on three DIFFERENT items of one
 * source, with no clean probe of that source in between, are not three unlucky items: the fault is the
 * source. The pools then pass the whole source over for a cooldown, try one item when it has run out, and
 * take the source back on the first clean probe. Distinct items, not three failures: one item failing
 * again and again is per-item quarantine's case and says nothing about its neighbours.
 *
 * This module cannot tell a network-wide outage from a source fault: a DNS failure is one more failed
 * outcome to it, and three of them on a single-source pool's queue of four open the breaker of a healthy
 * source (pinned in its test). The worker keeps two kinds of failure away from it: a Twitch archive still
 * downloading (apps/worker/src/source-breaker-outcomes.ts), and since M82 a network failure while the
 * channel's own way out is down (probe-network-outage.ts). A network-looking failure the worker could
 * not corroborate -- a dead CDN host, a channel with no public output to ask -- still arrives here and
 * counts; it costs one cooldown, after which a single clean probe closes the breaker. Unlike quarantine
 * that never needs the operator.
 *
 * Pure: time comes in as an argument, so every transition is a table test.
 */

import type { PoolRotationSourceGate } from "./pool-rotation.js";

/** Distinct items of one source whose probes must fail, with no clean probe between, to open it. */
export const SOURCE_BREAKER_FAILED_ITEM_THRESHOLD = 3;
/** The first cooldown. Long enough that a broken source costs one trial probe per half hour at most. */
export const SOURCE_BREAKER_BASE_COOLDOWN_SECONDS = 30 * 60;
/**
 * The longest cooldown. A source that stays broken for a day is retried four times a day: often enough
 * that a fix (a yt-dlp update, an upstream recovery) reaches the air within hours without the operator.
 */
export const SOURCE_BREAKER_MAX_COOLDOWN_SECONDS = 6 * 60 * 60;
/** Bounds the stored list; a source that re-opens for weeks adds one id per re-open. */
const MAX_REMEMBERED_FAILED_ITEMS = 20;

/**
 * Only `closed` and `open` are stored. Half-open is an open breaker whose cooldown has run out: nobody has
 * to write it when the cooldown ends, so a playout that is down at that moment cannot leave the source held.
 */
export type SourceBreakerStoredState = "closed" | "open";
export type SourceBreakerPhase = "closed" | "open" | "half-open";

export type SourceBreakerRecord = {
  sourceId: string;
  state: SourceBreakerStoredState;
  /** Items whose probe failed since the last clean probe of this source, oldest first. */
  failedAssetIds: string[];
  /** When the breaker last opened (or re-opened); empty while closed. */
  openedAt: string;
  /** How long this opening lasts; 0 while closed. Doubles on every re-open. */
  cooldownSeconds: number;
  lastError: string;
  updatedAt: string;
};

export type SourceBreakerOutcome = {
  sourceId: string;
  assetId: string;
  outcome: "ok" | "failed";
  error: string;
};

export function closedSourceBreaker(sourceId: string, updatedAt = ""): SourceBreakerRecord {
  return { sourceId, state: "closed", failedAssetIds: [], openedAt: "", cooldownSeconds: 0, lastError: "", updatedAt };
}

/** When an open breaker lets its one trial item through, in epoch ms; null while closed. */
export function sourceBreakerRetryAtMs(record: SourceBreakerRecord | null | undefined): number | null {
  if (!record || record.state !== "open") {
    return null;
  }
  const openedMs = Date.parse(record.openedAt);
  // An unreadable opening time must not hold the source forever: treat the cooldown as run out.
  return Number.isFinite(openedMs) ? openedMs + Math.max(0, record.cooldownSeconds) * 1000 : 0;
}

export function sourceBreakerPhase(record: SourceBreakerRecord | null | undefined, atMs: number): SourceBreakerPhase {
  const retryAtMs = sourceBreakerRetryAtMs(record);
  if (retryAtMs === null) {
    return "closed";
  }
  return atMs < retryAtMs ? "open" : "half-open";
}

function withFailedItem(failedAssetIds: readonly string[], assetId: string): string[] {
  return [...failedAssetIds.filter((id) => id !== assetId), assetId].slice(-MAX_REMEMBERED_FAILED_ITEMS);
}

/**
 * The record after one counted probe outcome of the source.
 *
 * - closed: a clean probe forgets the failures; a failure adds its item, and the third distinct item
 *   opens the breaker for the base cooldown.
 * - open (cooldown running): ignored. Nothing of the source is picked, so such an outcome is a resolve
 *   that started before the breaker opened; it neither proves the source healthy nor deserves a longer
 *   cooldown for a fault that is already being paid for.
 * - half-open: the trial decides. A clean probe closes the breaker and resets the cooldown; a failure
 *   re-opens it with the cooldown doubled, up to the cap.
 */
export function nextSourceBreakerRecord(
  current: SourceBreakerRecord,
  outcome: Pick<SourceBreakerOutcome, "assetId" | "outcome" | "error">,
  nowIso: string
): SourceBreakerRecord {
  const phase = sourceBreakerPhase(current, Date.parse(nowIso));
  const error = (outcome.error || "").slice(0, 500);

  if (phase === "open") {
    return current;
  }
  if (outcome.outcome === "ok") {
    if (phase === "closed" && current.failedAssetIds.length === 0 && current.lastError === "") {
      return current;
    }
    return closedSourceBreaker(current.sourceId, nowIso);
  }
  if (phase === "half-open") {
    return {
      sourceId: current.sourceId,
      state: "open",
      failedAssetIds: withFailedItem(current.failedAssetIds, outcome.assetId),
      openedAt: nowIso,
      cooldownSeconds: Math.min(
        Math.max(current.cooldownSeconds, SOURCE_BREAKER_BASE_COOLDOWN_SECONDS) * 2,
        SOURCE_BREAKER_MAX_COOLDOWN_SECONDS
      ),
      lastError: error,
      updatedAt: nowIso
    };
  }
  const failedAssetIds = withFailedItem(current.failedAssetIds, outcome.assetId);
  if (failedAssetIds.length >= SOURCE_BREAKER_FAILED_ITEM_THRESHOLD) {
    return {
      sourceId: current.sourceId,
      state: "open",
      failedAssetIds,
      openedAt: nowIso,
      cooldownSeconds: SOURCE_BREAKER_BASE_COOLDOWN_SECONDS,
      lastError: error,
      updatedAt: nowIso
    };
  }
  return { ...current, failedAssetIds, lastError: error, updatedAt: nowIso };
}

export type SourceBreakerTransition = {
  sourceId: string;
  /** `opened` from closed, `reopened` after a failed trial, `closed` after a clean trial. */
  kind: "opened" | "reopened" | "closed";
  record: SourceBreakerRecord;
};

export type SourceBreakerPlan = {
  /** Only the records whose stored state changes. */
  updates: SourceBreakerRecord[];
  transitions: SourceBreakerTransition[];
};

/**
 * Turns one queue scan's counted probe outcomes into the breaker records to store.
 *
 * The outcomes are the ones per-item quarantine counts (planAssetProbeUpdates), each probe once, in scan
 * order, so "no clean probe in between" means what it says: a failure, a success and a failure of three
 * items of one source leave one failed item, not two. The worker adds the inline resolve of the item it
 * selects, which no queue probe ever sees (recordSelectionResolveOutcome in apps/worker/src/index.ts),
 * and leaves out a Twitch archive whose download is still running (apps/worker/src/source-breaker-outcomes.ts)
 * and the failures of the channel's own network outage (M82, probe-network-outage.ts).
 */
export function planSourceBreakerUpdates(
  records: readonly SourceBreakerRecord[],
  outcomes: readonly SourceBreakerOutcome[],
  nowIso: string
): SourceBreakerPlan {
  const current = new Map(records.map((record) => [record.sourceId, record] as const));
  const changed = new Set<string>();
  const transitions: SourceBreakerTransition[] = [];

  for (const probed of outcomes) {
    if (!probed.sourceId || !probed.assetId) {
      continue;
    }
    const before = current.get(probed.sourceId) ?? closedSourceBreaker(probed.sourceId);
    const after = nextSourceBreakerRecord(before, probed, nowIso);
    if (after === before) {
      continue;
    }
    current.set(probed.sourceId, after);
    changed.add(probed.sourceId);
    if (before.state === "closed" && after.state === "open") {
      transitions.push({ sourceId: probed.sourceId, kind: "opened", record: after });
    } else if (before.state === "open" && after.state === "open") {
      transitions.push({ sourceId: probed.sourceId, kind: "reopened", record: after });
    } else if (before.state === "open" && after.state === "closed") {
      transitions.push({ sourceId: probed.sourceId, kind: "closed", record: after });
    }
  }

  return {
    updates: [...changed].map((sourceId) => current.get(sourceId)!),
    transitions
  };
}

/**
 * What the pool rotation may take from each source right now: nothing from an open source, one item
 * from a half-open one (see `PoolRotationSourceGate`). Arrays rather than sets so a server page can hand
 * the gate to a client component as it is.
 */
export function sourceBreakerGate(
  records: readonly SourceBreakerRecord[] | null | undefined,
  atMs: number
): PoolRotationSourceGate {
  const heldSourceIds: string[] = [];
  const trialSourceIds: string[] = [];
  for (const record of records ?? []) {
    const phase = sourceBreakerPhase(record, atMs);
    if (phase === "open") {
      heldSourceIds.push(record.sourceId);
    } else if (phase === "half-open") {
      trialSourceIds.push(record.sourceId);
    }
  }
  return { heldSourceIds, trialSourceIds };
}

export type SourceBreakerView = {
  phase: "open" | "half-open";
  openedAt: string;
  /** When the one trial item may be picked; already past while half-open. */
  retryAt: string;
  cooldownSeconds: number;
  failedItemCount: number;
  lastError: string;
};

/** The breaker as the source pages and the incident show it; null while closed, which shows nothing. */
export function describeSourceBreaker(
  record: SourceBreakerRecord | null | undefined,
  atMs: number
): SourceBreakerView | null {
  const phase = sourceBreakerPhase(record, atMs);
  const retryAtMs = sourceBreakerRetryAtMs(record);
  if (!record || phase === "closed" || retryAtMs === null) {
    return null;
  }
  return {
    phase,
    openedAt: record.openedAt,
    retryAt: new Date(retryAtMs).toISOString(),
    cooldownSeconds: record.cooldownSeconds,
    failedItemCount: record.failedAssetIds.length,
    lastError: record.lastError
  };
}

/** One way to write a breaker time in the incident and on the source pages: minutes, UTC, said so. */
export function formatSourceBreakerTime(iso: string): string {
  return Number.isFinite(Date.parse(iso)) ? `${new Date(iso).toISOString().slice(0, 16).replace("T", " ")} UTC` : "an unknown time";
}
