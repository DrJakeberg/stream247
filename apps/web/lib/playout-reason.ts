import type { PlayoutRuntimeRecord } from "@stream247/db";

type SelectionReasonCode = PlayoutRuntimeRecord["selectionReasonCode"];

/**
 * Why the thing that is on air is the thing that is on air.
 *
 * This is genuinely useful — it is the first question during an incident — and it was being
 * answered with the value as stored: "scheduled_match", "ffmpeg_crash_loop", "no_asset". The
 * wording baseline found "scheduled_match" on five separate pages, including two that only carry
 * the shared status rail.
 *
 * The phrasings say what the identifier says and no more. Where a name is already a word an
 * operator would use ("Standby", "Live bridge") it stays; where it names a failure, it describes
 * the failure rather than the enum.
 *
 * Typed against the record, so a code added later fails to compile here instead of appearing on
 * five pages as an identifier.
 */
export const PLAYOUT_REASON_LABELS = {
  operator_override: "An operator pinned this",
  scheduled_match: "Matched the schedule",
  graceful_handoff: "Handed over from the previous item",
  live_bridge: "Live bridge is on air",
  global_fallback: "Fell back to the global filler",
  generic_fallback: "Fell back to generic filler",
  no_asset: "Nothing was available to play",
  destination_missing: "No destination is set up",
  resolve_failed: "The media could not be resolved",
  ffmpeg_crash_loop: "The encoder kept crashing",
  operator_insert: "An operator inserted this",
  scheduled_insert: "A scheduled insert",
  manual_next: "Chosen as next by hand",
  standby: "Standby",
  scheduled_reconnect: "A scheduled reconnect",
  "": ""
} as const satisfies Record<SelectionReasonCode, string>;

export function describePlayoutReason(code: SelectionReasonCode | string | undefined): string {
  if (!code) {
    return "";
  }

  return PLAYOUT_REASON_LABELS[code as SelectionReasonCode] ?? "";
}
