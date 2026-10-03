/**
 * When the playout stops choosing an item whose source will not serve it.
 *
 * Measured on the DUT, 2026-09-07: a YouTube item in a pool returned "Requested format is not available"
 * from yt-dlp on every prefetch. The probe caught it each time, the playout bridged with the fallback and
 * the channel stayed on air — and then the scheduler chose the same item again. Nothing recorded that the
 * item was unplayable, so the loop ran for hours: bridge, incident, self-resolve, bridge again. The item
 * showed as `ready` in the library the whole time and never aired.
 *
 * The failure count lives on the asset so the decision survives a worker restart, and it takes a few
 * failures rather than one because a probe can fail for reasons that pass on their own — a rate limit, a
 * DNS blip, a CDN reset. Three consecutive failures is not a blip; nothing seen on the DUT recovered after
 * two. One thing does last longer than two probes, and it is not the item's fault: an outage of the
 * channel's own network. A failed probe is retried after a minute, so three minutes without a way out
 * were three failures, and before M95 a quarantined item was never probed again (now it gets one trial a
 * day, selectQuarantineReprobes). Since M82 the playout does not hand
 * such a failure to this module at all (probe-network-outage.ts): it neither counts nor resets.
 *
 * Quarantine deliberately does NOT touch `includeInProgramming`. That flag is the operator's own choice
 * and overwriting it would lose what they set and lie about who decided. Quarantine is a separate, visible
 * state that the operator clears once the source is fixed or the item is replaced, and that a clean daily
 * trial clears by itself.
 */
export const ASSET_PROBE_QUARANTINE_THRESHOLD = 3;

export type AssetProbeState = {
  /** Consecutive prefetch probe failures. A success sets it back to zero. */
  playbackProbeFailures?: number;
  /** What the last failing probe said, for the person who has to decide what to do about it. */
  playbackProbeError?: string;
  playbackProbedAt?: string;
};

/** Has this item failed to probe often enough that automatic selection should pass it over? */
export function isAssetProbeQuarantined(asset: AssetProbeState): boolean {
  return (asset.playbackProbeFailures ?? 0) >= ASSET_PROBE_QUARANTINE_THRESHOLD;
}

/**
 * The next probe state for an item, given how the probe went.
 *
 * A success clears everything: an item that plays again is not on probation for what it did last week.
 */
export function nextAssetProbeState(args: {
  current: AssetProbeState;
  outcome: "ok" | "failed";
  error?: string;
  nowIso: string;
}): Required<AssetProbeState> {
  if (args.outcome === "ok") {
    return { playbackProbeFailures: 0, playbackProbeError: "", playbackProbedAt: args.nowIso };
  }
  return {
    playbackProbeFailures: (args.current.playbackProbeFailures ?? 0) + 1,
    playbackProbeError: (args.error ?? "").slice(0, 500),
    playbackProbedAt: args.nowIso
  };
}

/** Reached quarantine with this very failure — the moment worth telling someone about. */
export function crossedIntoQuarantine(before: AssetProbeState, after: AssetProbeState): boolean {
  return !isAssetProbeQuarantined(before) && isAssetProbeQuarantined(after);
}

export type AssetProbeOutcome = {
  assetId: string;
  sourceId: string;
  title: string;
  outcome: "ok" | "failed";
  error: string;
  current: AssetProbeState;
  /** The daily trial of an item already in quarantine (selectQuarantineReprobes). */
  reprobe?: boolean;
};

export type AssetProbePlan = {
  /** Only the items whose stored state actually changes. */
  updates: Array<{ id: string } & Required<AssetProbeState>>;
  /** Items that reached quarantine with this very probe, for the log line. */
  crossed: Array<{ assetId: string; title: string; failures: number; error: string }>;
  /** Per source: how many of its probed items are quarantined, with one example. */
  quarantinedBySource: Map<string, { count: number; title: string; error: string }>;
  /** Sources this scan probed at all — the ones whose incident may be resolved. */
  probedSourceIds: string[];
};

/**
 * Turns one queue scan's probe outcomes into what to store and what to report.
 *
 * Per item, deliberately. The worker's `prefetchStatus` collapses a whole scan into a single
 * "ready"/"failed", so a later success overwrote an earlier failure and the failing item's counter never
 * grew: on the DUT under 2.0.0-rc.3 the same item failed three times in twenty minutes and stayed at
 * zero. Every probed item is decided on its own outcome here, which is why this is a function with a
 * test rather than a few lines inside the cycle.
 */
export function planAssetProbeUpdates(outcomes: AssetProbeOutcome[], nowIso: string): AssetProbePlan {
  const updates: AssetProbePlan["updates"] = [];
  const crossed: AssetProbePlan["crossed"] = [];
  const quarantinedBySource = new Map<string, { count: number; title: string; error: string }>();

  for (const probed of outcomes) {
    if (probed.reprobe && probed.outcome === "failed") {
      // A failed daily trial changes nothing but the time of the try (and what it said), which is what
      // keeps the next trial a day away. The count stays, so the item reads as it did before.
      const failures = probed.current.playbackProbeFailures ?? 0;
      const after = { playbackProbeFailures: failures, playbackProbeError: probed.error.slice(0, 500), playbackProbedAt: nowIso };
      updates.push({ id: probed.assetId, ...after });
      if (isAssetProbeQuarantined(after)) {
        const entry = quarantinedBySource.get(probed.sourceId) ?? { count: 0, title: "", error: "" };
        quarantinedBySource.set(probed.sourceId, {
          count: entry.count + 1,
          title: entry.title || probed.title,
          error: entry.error || after.playbackProbeError
        });
      }
      continue;
    }
    const after = nextAssetProbeState({
      current: probed.current,
      outcome: probed.outcome,
      error: probed.error,
      nowIso
    });
    if (
      after.playbackProbeFailures !== (probed.current.playbackProbeFailures ?? 0) ||
      after.playbackProbeError !== (probed.current.playbackProbeError ?? "")
    ) {
      updates.push({ id: probed.assetId, ...after });
    }
    if (crossedIntoQuarantine(probed.current, after)) {
      crossed.push({
        assetId: probed.assetId,
        title: probed.title,
        failures: after.playbackProbeFailures,
        error: after.playbackProbeError
      });
    }
    if (isAssetProbeQuarantined(after)) {
      const entry = quarantinedBySource.get(probed.sourceId) ?? { count: 0, title: "", error: "" };
      quarantinedBySource.set(probed.sourceId, {
        count: entry.count + 1,
        title: entry.title || probed.title,
        error: entry.error || after.playbackProbeError
      });
    }
  }

  return {
    updates,
    crossed,
    quarantinedBySource,
    probedSourceIds: [...new Set(outcomes.map((probed) => probed.sourceId))]
  };
}

export type QuarantineCountable = {
  id: string;
  sourceId: string;
  title: string;
  playbackProbeFailures?: number;
  playbackProbeError?: string;
};

/**
 * How many items each source currently has out of rotation, counted from stored state.
 *
 * Not from the probes of one scan. A quarantined item is kept out of the queue, so it is never probed
 * again and never appears in a later scan — count from the scan and the number shrinks to zero while the
 * items stay skipped, and the incident resolves itself. That is the exact invisibility this whole change
 * exists to remove. On the DUT the incident said "1 item(s)" while all eleven items of the source were
 * skipped.
 *
 * `overrides` carries the values written in this cycle, which the caller's state snapshot predates.
 */
export function countQuarantinedBySource(
  assets: QuarantineCountable[],
  overrides: Map<string, AssetProbeState> = new Map()
): Map<string, { count: number; title: string; error: string }> {
  const bySource = new Map<string, { count: number; title: string; error: string }>();
  for (const asset of assets) {
    const state = overrides.get(asset.id) ?? {
      playbackProbeFailures: asset.playbackProbeFailures,
      playbackProbeError: asset.playbackProbeError
    };
    if (!isAssetProbeQuarantined(state)) {
      continue;
    }
    const entry = bySource.get(asset.sourceId) ?? { count: 0, title: "", error: "" };
    bySource.set(asset.sourceId, {
      count: entry.count + 1,
      title: entry.title || asset.title,
      error: entry.error || state.playbackProbeError || ""
    });
  }
  return bySource;
}

/** How long a quarantined item waits between two automatic trials (owner Q1, M95). */
export const QUARANTINE_REPROBE_INTERVAL_MS = 24 * 60 * 60_000;

/**
 * How long a network outage the playout saw holds the trials back. The outage check runs only when a
 * failure is about to be counted, so nothing says when an outage ended; the nightly outages measured on
 * the DUT lasted one to four minutes.
 */
export const QUARANTINE_REPROBE_OUTAGE_HOLD_MS = 10 * 60_000;

export type QuarantineReprobeCandidate = {
  id: string;
  sourceId: string;
  status?: string;
  includeInProgramming?: boolean;
  playbackProbeFailures?: number;
  playbackProbedAt?: string;
};

/**
 * Which quarantined items get their one automatic trial in this cycle (M95, H9; owner Q1).
 *
 * Quarantine was for good: a YouTube item that failed three probes during a bad night never came back,
 * even once its source served it again, until someone cleared it by hand. Now each quarantined item is
 * tried once per day, at most one item per source per cycle, so a source with many items does not turn
 * into a burst of resolves. Nothing is tried while the source's breaker is open or half-open (the breaker
 * already decides that source; its own trial is the one that counts) or while the channel's own network
 * was out a moment ago (the trial would test the network, not the item).
 *
 * A clean trial clears the quarantine like any clean probe; a failed one only records when it was tried
 * (planAssetProbeUpdates). The operator's choices are left alone: an item excluded from programming or
 * not ready is not tried, and the quarantine can still be cleared by hand.
 */
export function selectQuarantineReprobes<T extends QuarantineReprobeCandidate>(args: {
  assets: readonly T[];
  nowMs: number;
  /** Sources whose breaker is open or half-open. */
  gatedSourceIds: ReadonlySet<string>;
  /** Sources some pool plays from; items of other sources would never air either way. */
  poolSourceIds: ReadonlySet<string>;
  /** When the playout last saw its own network out, 0 for never. */
  networkOutageSeenAtMs: number;
  intervalMs?: number;
}): T[] {
  const intervalMs = args.intervalMs ?? QUARANTINE_REPROBE_INTERVAL_MS;
  if (args.networkOutageSeenAtMs > 0 && args.nowMs - args.networkOutageSeenAtMs < QUARANTINE_REPROBE_OUTAGE_HOLD_MS) {
    return [];
  }

  const bySource = new Map<string, { asset: T; probedAtMs: number }>();
  for (const asset of args.assets) {
    if (!isAssetProbeQuarantined(asset)) {
      continue;
    }
    if ((asset.status ?? "ready") !== "ready" || asset.includeInProgramming === false) {
      continue;
    }
    if (args.gatedSourceIds.has(asset.sourceId) || !args.poolSourceIds.has(asset.sourceId)) {
      continue;
    }
    const parsed = Date.parse(asset.playbackProbedAt ?? "");
    // No time at all (an old row): due now. A time in the future (a clock that jumped back) waits.
    const probedAtMs = Number.isFinite(parsed) ? parsed : 0;
    if (args.nowMs - probedAtMs < intervalMs) {
      continue;
    }
    const chosen = bySource.get(asset.sourceId);
    if (!chosen || probedAtMs < chosen.probedAtMs || (probedAtMs === chosen.probedAtMs && asset.id < chosen.asset.id)) {
      bySource.set(asset.sourceId, { asset, probedAtMs });
    }
  }

  return [...bySource.values()].map((entry) => entry.asset).sort((left, right) => left.id.localeCompare(right.id));
}
