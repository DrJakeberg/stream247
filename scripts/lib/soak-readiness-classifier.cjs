"use strict";

const DEFAULT_RUNAWAY_THRESHOLD = 20;
const DEFAULT_TOLERATED_TRANSIENT_SAMPLES = 1;

function isProgramFeedFresh(data) {
  return data.services?.programFeed === "ok" && data.programFeed?.status === "fresh";
}

function isUplinkHealthyDetailed(data) {
  return data.services?.uplink === "ok" && data.uplink?.status === "running";
}

function isPlayoutTransient(data) {
  if (data.playout?.transient === true) {
    return true;
  }
  return (
    data.services?.playout === "not-ready" &&
    data.playout?.status === "failed" &&
    !data.playout?.crashLoopDetected &&
    isProgramFeedFresh(data) &&
    isUplinkHealthyDetailed(data) &&
    data.services?.destination === "ok"
  );
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
  const broadcastReady = data.broadcastReady === true;

  if (!(data.status === "ok" || data.status === "degraded")) {
    issuesFatal.push(`readiness.status=${data.status}`);
  }

  if (data.broadcastReady !== true && !playoutTransient) {
    issuesFatal.push(`broadcastReady=${String(data.broadcastReady)}`);
  }

  if (services.worker === "not-ready") {
    issuesFatal.push("worker=not-ready");
  }

  if (services.playout === "not-ready" && !playoutTransient) {
    issuesFatal.push("playout=not-ready");
  }

  if (data.playout?.crashLoopDetected) {
    issuesFatal.push("playout.crashLoopDetected=true");
  }

  if (data.programFeed?.status === "stale" || data.programFeed?.status === "failed") {
    issuesFatal.push(`programFeed=${data.programFeed.status}`);
  }
  if (services.programFeed === "not-ready") {
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

  // Uplink unplanned restart classification: warning unless user-impact or runaway.
  const currentUplinkRestarts = Number(data.uplink?.unplannedRestartCount ?? 0);
  const uplinkRestartDelta = currentUplinkRestarts - baselineUplinkRestarts;
  const userImpactNow = !broadcastReady || !programFeedFresh;
  if (uplinkRestartDelta > 0 && (userImpactNow || uplinkRestartDelta > runawayThreshold)) {
    issuesFatal.push(`uplinkUnplannedRestarts=${currentUplinkRestarts}(delta=${uplinkRestartDelta})`);
  }

  const details = buildDetails(data, uplinkRestartDelta, playoutTransient);

  const transientReasons = [];
  if (transientKinds.has("uplink")) transientReasons.push("uplink=not-ready");
  if (transientKinds.has("destination")) transientReasons.push(`destination=${destinationStatus}`);

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
