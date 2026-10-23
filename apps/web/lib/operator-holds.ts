import { pendingPlayoutActionIncludes } from "@stream247/core";

/**
 * What the operator's actions still hold, in words, for the live view (M120).
 *
 * Until M120 the control room showed a Move next and nothing else: a Skip's hold or a Remove next kept an
 * item out for up to four hours with no trace on the page, and Resume schedule, which clears them, was
 * greyed out unless a Pin, a Fallback or an insert ran. A Refresh or queue rebuild waiting for its cycle
 * was invisible too.
 */
export interface OperatorHoldsInput {
  overrideMode: string;
  overrideAssetId: string;
  overrideUntil: string;
  insertAssetId: string;
  insertStatus: string;
  manualNextAssetId: string;
  skipAssetId: string;
  skipUntil: string;
  removeNextAssetId: string;
  removeNextUntil: string;
  pendingAction: string;
}

export type OperatorHoldKind = "pin" | "fallback" | "insert" | "move_next" | "skip" | "remove_next";

export interface OperatorHoldLine {
  kind: OperatorHoldKind;
  text: string;
}

function minutesLeft(until: string, nowMs: number): number {
  const untilMs = until === "" ? Number.NaN : new Date(until).getTime();
  return Number.isFinite(untilMs) ? Math.ceil((untilMs - nowMs) / 60_000) : 0;
}

// "for 42 more min", "for 1 h 5 min more": the hold's end in the viewer's terms without a clock zone.
function describeTimeLeft(minutes: number): string {
  if (minutes < 60) {
    return `for ${minutes} more min`;
  }
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `for ${hours} h more` : `for ${hours} h ${rest} min more`;
}

function overrideRunning(input: OperatorHoldsInput, nowMs: number): boolean {
  return input.overrideMode !== "schedule" && input.overrideMode !== "" && input.overrideAssetId !== "" && minutesLeft(input.overrideUntil, nowMs) > 0;
}

function insertWaitingOrOnAir(input: OperatorHoldsInput): boolean {
  return input.insertAssetId !== "" && (input.insertStatus === "pending" || input.insertStatus === "active");
}

/**
 * Whether Resume schedule changes what is on air: a Pin, a Fallback or an operator insert holds it. Only
 * then does Resume restart the playout without the relay (the slate, then the pool's next item); clearing
 * a skip hold, a Remove next or a Move next changes only what comes next.
 */
export function resumeTakesTheAir(input: OperatorHoldsInput, nowMs: number): boolean {
  return overrideRunning(input, nowMs) || insertWaitingOrOnAir(input);
}

/** Every hold Resume schedule clears, in the order the playout asks them. Expired holds are left out. */
export function listOperatorHolds(input: OperatorHoldsInput, titleOf: (assetId: string) => string, nowMs: number): OperatorHoldLine[] {
  const lines: OperatorHoldLine[] = [];
  if (overrideRunning(input, nowMs)) {
    const kind = input.overrideMode === "fallback" ? "fallback" : "pin";
    lines.push({
      kind,
      text: `${kind === "fallback" ? "Fallback on air" : "Pinned on air"}: ${titleOf(input.overrideAssetId)} ${describeTimeLeft(minutesLeft(input.overrideUntil, nowMs))}.`
    });
  }
  if (insertWaitingOrOnAir(input)) {
    lines.push({
      kind: "insert",
      text:
        input.insertStatus === "pending"
          ? `Play now: ${titleOf(input.insertAssetId)} takes the air at the next playout cycle.`
          : `Play now: ${titleOf(input.insertAssetId)} is on air to its end.`
    });
  }
  if (input.manualNextAssetId !== "") {
    lines.push({ kind: "move_next", text: `Move next: ${titleOf(input.manualNextAssetId)} plays next.` });
  }
  const skipMinutes = input.skipAssetId === "" ? 0 : minutesLeft(input.skipUntil, nowMs);
  if (skipMinutes > 0) {
    lines.push({ kind: "skip", text: `Skipped: ${titleOf(input.skipAssetId)} stays out ${describeTimeLeft(skipMinutes)}.` });
  }
  const removeMinutes = input.removeNextAssetId === "" ? 0 : minutesLeft(input.removeNextUntil, nowMs);
  if (removeMinutes > 0) {
    lines.push({
      kind: "remove_next",
      text: `Removed from next: ${titleOf(input.removeNextAssetId)} stays out ${describeTimeLeft(removeMinutes)}.`
    });
  }
  return lines;
}

/** Whether Resume schedule has anything to clear: the condition that enables the button. */
export function resumeHasSomethingToClear(input: OperatorHoldsInput, nowMs: number): boolean {
  return listOperatorHolds(input, () => "", nowMs).length > 0;
}

/** The Refresh and queue rebuild that wait for the next playout cycle, as the buttons name them. */
export function describePendingPlayoutRequests(pendingAction: string): string {
  const names = [
    ...(pendingPlayoutActionIncludes(pendingAction, "refresh") ? ["Refresh scenes"] : []),
    ...(pendingPlayoutActionIncludes(pendingAction, "rebuild_queue") ? ["Rebuild queue"] : [])
  ];
  return names.length === 0 ? "" : `Waiting for the next playout cycle: ${names.join(" and ")}.`;
}
