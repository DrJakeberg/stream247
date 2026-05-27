"use strict";

const DEFAULT_RUNAWAY_THRESHOLD = 20;
const DEFAULT_TOLERATED_TRANSIENT_SAMPLES = 1;

function isProgramFeedFresh(data) {
  return data.services?.programFeed === "ok" && data.programFeed?.status === "fresh";
}

function isUplinkHealthyDetailed(data) {
  return data.services?.uplink === "ok" && data.uplink?.status === "running";
}

// "Candidate" pattern for a playout-supervised in-process restart: playout is failed
// but everything around it is still nominal (uplink healthy, destination ok, no crash
// loop). The feed may or may not still be fresh — see isPlayoutTransient (strict) vs
// the stale-feed-during-transient grace below.
function isPlayoutTransientCandidate(data) {
  if (data.playout?.transient === true) {
    return true;
  }
  return (
    data.services?.playout === "not-ready" &&
    data.playout?.status === "failed" &&
    !data.playout?.crashLoopDetected &&
    isUplinkHealthyDetailed(data) &&
    data.services?.destination === "ok"
  );
}

// Strict playoutTransient: candidate AND program feed is still fresh — fully tolerated
// with no consecutive-sample limit (the existing behavior).
function isPlayoutTransient(data) {
  return isPlayoutTransientCandidate(data) && isProgramFeedFresh(data);
}

function buildDetails(data, uplinkRestartDelta, playoutTransient) {
  return [
    `playoutStatus=${data.playout?.status ?? "unknown"}`,
    `lastExitCode=${data.playout?.lastExitCode ?? ""}`,
    `restartCount=${data.playout?.restartCount ?? "unknown"}`,
    `crashCountWindow=${data.playout?.crashCountWindow ?? "unknown"}`,
    `currentAsset=${data.playout?.currentAssetId ?? ""}`,
    `uplinkStatus=${data.uplink?.status ?? "unknown"}`,
    `uplinkUnplannedRestarts=${data.uplink?.unplannedRestartCount ?? "unknown"}`,
    `programFeed=${data.programFeed?.status ?? "unknown"}`,
    `playoutTransient=${String(playoutTransient)}`,
    `uplinkUnplannedRestartsDelta=${uplinkRestartDelta}`
  ];
}

/**
 * Classify one readiness sample. Returns one of:
 *   { kind: "ok",        line }                 — healthy sample, log line for the log file
 *   { kind: "fail",      reasons, line }        — immediate fail, exit the soak now
 *   { kind: "transient", transientKinds, reasons, line }
 *       — uplink and/or destination momentarily not-ready while everything else is healthy.
 *       Caller tracks consecutive occurrences per kind; only exits after exceeding the tolerated count.
 *
 * Warning: `uplinkUnplannedRestarts` increments are treated as a *warning* (folded into the
 * log line) when broadcastReady=true and programFeed=fresh, unless the delta exceeds the
 * runaway threshold. Otherwise they become an immediate fail.
 */
function classifyReadinessSample(data, opts = {}) {
  const baselineUplinkRestarts = Number(opts.baselineUplinkRestarts ?? 0);
  const runawayThreshold = Number(opts.runawayThreshold ?? DEFAULT_RUNAWAY_THRESHOLD);

  const issuesFatal = [];
  const transientKinds = new Set();

  const services = data.services ?? {};
  const programFeedFresh = isProgramFeedFresh(data);
  const playoutTransient = isPlayoutTransient(data);
  const playoutTransientCandidate = isPlayoutTransientCandidate(data);
  const feedStale =
    data.programFeed?.status === "stale" || data.programFeed?.status === "failed";
  // "Stale feed during an active playout transient recovery" — the candidate pattern is
  // satisfied (playout failed + uplink/destination still healthy + no crash loop) but the
  // feed has briefly gone stale because the playout supervisor is restarting the ffmpeg
  // child. Tolerated as a transient kind for a single consecutive sample by default; the
  // shell loop escalates after the configured count.
  const playoutTransientStaleFeed =
    playoutTransientCandidate && !playoutTransient && feedStale;
  const inAnyPlayoutTransient = playoutTransient || playoutTransientStaleFeed;
  const broadcastReady = data.broadcastReady === true;

  if (!(data.status === "ok" || data.status === "degraded")) {
    issuesFatal.push(`readiness.status=${data.status}`);
  }

  if (data.broadcastReady !== true && !inAnyPlayoutTransient) {
    issuesFatal.push(`broadcastReady=${String(data.broadcastReady)}`);
  }

  if (services.worker === "not-ready") {
    issuesFatal.push("worker=not-ready");
  }

  if (services.playout === "not-ready" && !inAnyPlayoutTransient) {
    issuesFatal.push("playout=not-ready");
  }

  if (data.playout?.crashLoopDetected) {
    issuesFatal.push("playout.crashLoopDetected=true");
  }

  if (feedStale && !playoutTransientStaleFeed) {
    issuesFatal.push(`programFeed=${data.programFeed.status}`);
  }
  if (services.programFeed === "not-ready" && !playoutTransientStaleFeed) {
    issuesFatal.push("programFeed=not-ready");
  }

  if (data.uplink?.status === "failed") {
    issuesFatal.push("uplink=failed");
  }

  // Transient-eligible: uplink/destination not-ready (a single sample is tolerated;
  // consecutive samples are escalated to fatal by the caller).
  const uplinkTransientCandidate = services.uplink === "not-ready";
  if (uplinkTransientCandidate) {
    transientKinds.add("uplink");
  }
  const destinationStatus = services.destination ?? "unknown";
  const destinationTransientCandidate = destinationStatus !== "ok" && destinationStatus !== "unknown";
  if (destinationTransientCandidate) {
    transientKinds.add("destination");
  }
  if (playoutTransientStaleFeed) {
    transientKinds.add("playoutTransientStaleFeed");
  }

  // Uplink unplanned restart classification: warning unless user-impact or runaway. While
  // a playout transient (strict or stale-feed) is active, the "user impact" condition is
  // already attributable to the in-progress recovery and is not counted as additional fault.
  const currentUplinkRestarts = Number(data.uplink?.unplannedRestartCount ?? 0);
  const uplinkRestartDelta = currentUplinkRestarts - baselineUplinkRestarts;
  const userImpactNow =
    (!broadcastReady || !programFeedFresh) && !inAnyPlayoutTransient;
  if (uplinkRestartDelta > 0 && (userImpactNow || uplinkRestartDelta > runawayThreshold)) {
    issuesFatal.push(`uplinkUnplannedRestarts=${currentUplinkRestarts}(delta=${uplinkRestartDelta})`);
  }

  const details = buildDetails(data, uplinkRestartDelta, playoutTransient);

  const transientReasons = [];
  if (transientKinds.has("uplink")) transientReasons.push("uplink=not-ready");
  if (transientKinds.has("destination")) transientReasons.push(`destination=${destinationStatus}`);
  if (transientKinds.has("playoutTransientStaleFeed")) {
    transientReasons.push("playoutTransientStaleFeed=true");
  }

  if (issuesFatal.length > 0) {
    // Include transient reasons in the fail line for forensics — they don't change the verdict
    // but they tell the operator the full picture (e.g. dest also degraded at the moment).
    return {
      kind: "fail",
      reasons: issuesFatal,
      line: [...issuesFatal, ...transientReasons, ...details].join(", ")
    };
  }

  if (transientKinds.size > 0) {
    return {
      kind: "transient",
      transientKinds: [...transientKinds],
      reasons: transientReasons,
      line: [...transientReasons, ...details].join(", ")
    };
  }

  return {
    kind: "ok",
    line: [
      `status=${data.status}`,
      `broadcastReady=${String(data.broadcastReady)}`,
      `worker=${services.worker ?? "unknown"}`,
      `playout=${services.playout ?? "unknown"}`,
      `uplink=${services.uplink ?? "unknown"}`,
      `programFeed=${services.programFeed ?? "unknown"}`,
      `destination=${services.destination ?? "unknown"}`,
      `reason=${data.playout?.selectionReasonCode ?? ""}`,
      `fallback=${data.playout?.fallbackTier ?? ""}`,
      `sseConnections=${data.sseConnections ?? "unknown"}`,
      ...details
    ].join(" ")
  };
}

module.exports = {
  classifyReadinessSample,
  DEFAULT_RUNAWAY_THRESHOLD,
  DEFAULT_TOLERATED_TRANSIENT_SAMPLES
};
