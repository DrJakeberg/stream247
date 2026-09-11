import { describe, expect, it } from "vitest";
import {
  DESTINATION_RECOVERY_LABELS,
  DESTINATION_ROLE_LABELS,
  DESTINATION_STATUS_LABELS,
  STREAM_KEY_SOURCE_LABELS,
  describeStreamKey
} from "@/lib/destination-wording";

/** Every value the routing status can hold, listed here so a new one fails this file loudly. */
const ALL_STATUSES = ["ready", "recovering", "missing-config", "error"] as const;

describe("wording for destinations", () => {
  it("covers every routing status", () => {
    for (const status of ALL_STATUSES) {
      expect(DESTINATION_STATUS_LABELS[status]).toBeTruthy();
    }
    expect(Object.keys(DESTINATION_STATUS_LABELS).sort()).toEqual([...ALL_STATUSES].sort());
  });

  it("never hands an identifier back as a label", () => {
    // The failure this replaces: pages rendered the stored value directly, so an operator read
    // "missing-config" and "key source env".
    const labels = [
      ...Object.values(DESTINATION_ROLE_LABELS),
      ...Object.values(DESTINATION_STATUS_LABELS),
      ...Object.values(STREAM_KEY_SOURCE_LABELS),
      ...Object.values(DESTINATION_RECOVERY_LABELS)
    ];

    for (const label of labels) {
      expect(label).not.toMatch(/[-_]/);
      expect(label).not.toBe(label.toUpperCase());
    }
  });

  it("says a missing key is missing before it says where a key came from", () => {
    expect(describeStreamKey(false, "env")).toBe("Stream key missing");
    expect(describeStreamKey(true, "env")).toBe("Stream key set in the server configuration");
    expect(describeStreamKey(true, "managed")).toBe("Stream key stored here");
    expect(describeStreamKey(true, undefined)).toBe("Stream key not set");
  });

  it("covers every recovery state, including the one that is not a fault", () => {
    const states = ["active", "staged", "cooldown", "ready", "missing-config"] as const;

    for (const state of states) {
      expect(DESTINATION_RECOVERY_LABELS[state]).toBeTruthy();
    }
    expect(Object.keys(DESTINATION_RECOVERY_LABELS).sort()).toEqual([...states].sort());
    // The one that mattered: an unconfigured destination is an empty form, not a broken one.
    expect(DESTINATION_RECOVERY_LABELS["missing-config"]).toBe("Not set up yet");
  });
});
