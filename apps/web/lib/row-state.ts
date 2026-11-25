import type { DestinationRoutingStatus } from "@stream247/core";

/**
 * The state an output row or a source row leads with (M129): one of three words, each on its own badge
 * tone. The detail lines under the badge keep saying what exactly is wrong.
 */
export type RowState = "ready" | "needs-setup" | "failing";

export const ROW_STATE_LABELS = {
  ready: "Ready",
  "needs-setup": "Needs setup",
  failing: "Failing"
} satisfies Record<RowState, string>;

/**
 * Only the stored routing status decides: the worker already sets it. A disabled destination is stored as
 * missing-config; a recovering one is staged and not carrying the broadcast yet, so it reads as an outage.
 */
const DESTINATION_ROW_STATES = {
  ready: "ready",
  "missing-config": "needs-setup",
  error: "failing",
  recovering: "failing"
} satisfies Record<DestinationRoutingStatus, RowState>;

export function destinationRowState(status: DestinationRoutingStatus): RowState {
  return DESTINATION_ROW_STATES[status];
}

export type SourceRowStateInput = {
  enabled: boolean;
  /** getSourceConnectorDiagnostics().isValidUrl */
  urlUsable: boolean;
  /** The source breaker (M75) holds the source out of the pools. */
  breakerHeld: boolean;
  /** The newest sync run's status, "" before the first scan. */
  lastRunStatus: string;
  /** The barren-run drought is past its alert threshold. */
  droughtAlerting: boolean;
};

/**
 * Failing wins over needs setup: a broken source that is also disabled still has an error to read. The
 * worker's free-text status ("Scan failed (assets preserved)", "Sync queued", ...) is not read; open
 * incidents are left out because one can stay open after its cause has ended.
 */
export function sourceRowState(input: SourceRowStateInput): RowState {
  if (input.breakerHeld || input.lastRunStatus === "error" || input.droughtAlerting) {
    return "failing";
  }
  if (!input.enabled || !input.urlUsable) {
    return "needs-setup";
  }
  return "ready";
}

/** The sources list and the source detail page read the same three server results through this. */
export function sourceRowStateOf(
  source: { enabled?: boolean },
  snapshot: { breaker: unknown; latestRun: { status: string } | null; health: { alerting: boolean } },
  diagnostics: { isValidUrl: boolean }
): RowState {
  return sourceRowState({
    enabled: source.enabled ?? true,
    urlUsable: diagnostics.isValidUrl,
    breakerHeld: Boolean(snapshot.breaker),
    lastRunStatus: snapshot.latestRun?.status ?? "",
    droughtAlerting: snapshot.health.alerting
  });
}
