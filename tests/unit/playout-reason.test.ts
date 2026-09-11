import { describe, expect, it } from "vitest";
import { PLAYOUT_REASON_LABELS, describePlayoutReason } from "@/lib/playout-reason";

/** Every code the runtime can store, listed here so a new one fails loudly rather than leaking. */
const ALL_CODES = [
  "operator_override",
  "scheduled_match",
  "graceful_handoff",
  "live_bridge",
  "global_fallback",
  "generic_fallback",
  "no_asset",
  "destination_missing",
  "resolve_failed",
  "ffmpeg_crash_loop",
  "operator_insert",
  "scheduled_insert",
  "manual_next",
  "standby",
  "scheduled_reconnect",
  ""
] as const;

describe("why the current item is on air", () => {
  it("has words for every code the runtime can store", () => {
    expect(Object.keys(PLAYOUT_REASON_LABELS).sort()).toEqual([...ALL_CODES].sort());
  });

  it("never shows the identifier itself", () => {
    // The wording baseline found "scheduled_match" on five pages, two of which only carry the
    // shared status rail. That is the failure this exists to stop.
    for (const code of ALL_CODES) {
      const label = describePlayoutReason(code);
      if (!code) {
        expect(label).toBe("");
        continue;
      }
      expect(label).toBeTruthy();
      expect(label).not.toContain("_");
      // Not lowercased before comparing: "standby" is already the word an operator would use, and
      // the identifier happens to be spelled the same. "Standby" is a label; "standby" is the value.
      expect(label).not.toBe(code);
    }
  });

  it("says nothing rather than guessing at a code it does not know", () => {
    expect(describePlayoutReason(undefined)).toBe("");
    expect(describePlayoutReason("something_new")).toBe("");
  });
});
