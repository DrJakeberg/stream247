import { describe, expect, it } from "vitest";
import { decideSystemVolumeObservation } from "../../apps/worker/src/system-volume";
import { resolveSystemVolumeWatermarkConfig } from "../../packages/core/src/index.js";

// The observation-only counterpart to the media-volume watermark. The worker cannot evacuate
// anything on the OS or database volume, so the only correct reaction to pressure there is a
// critical incident plus an alert, raised exactly once per breach and resolved once free space
// climbs back above the recovery mark. These tests pin the once-per-breach hysteresis; the
// wiring in the worker only measures and carries the incident flag between cycles.

const GB = 1024 ** 3;
const TOTAL_BYTES = 50 * GB;
const config = resolveSystemVolumeWatermarkConfig(null, {}); // 10% trigger, 15% recover

function decide(freeGb: number, incidentOpen: boolean) {
  return decideSystemVolumeObservation({
    freeBytes: freeGb * GB,
    totalBytes: TOTAL_BYTES,
    config,
    incidentOpen
  });
}

describe("decideSystemVolumeObservation", () => {
  it("stays quiet while free space sits above the trigger", () => {
    expect(decide(20, false)).toBe("none");
  });

  it("raises exactly once when free space falls below the trigger", () => {
    expect(decide(4, false)).toBe("raise");
    // The next cycle still measures low, but the incident is already open: fingerprint dedupe
    // would absorb a second upsert, yet the alert must not fire again — so the decision is to
    // do nothing at all.
    expect(decide(4, true)).toBe("none");
  });

  it("does not resolve in the gap between trigger and recovery", () => {
    // 6 GB of 50 GB is 12% free: above the 10% trigger, below the 15% recovery mark. Resolving
    // here would re-raise a few cycles later and turn one incident into a drumbeat.
    expect(decide(6, true)).toBe("none");
  });

  it("resolves once free space is back above the recovery mark", () => {
    expect(decide(8, true)).toBe("resolve");
    expect(decide(8, false)).toBe("none");
  });

  it("treats an unmeasurable volume as no opinion, never as pressure", () => {
    expect(
      decideSystemVolumeObservation({ freeBytes: Number.NaN, totalBytes: TOTAL_BYTES, config, incidentOpen: false })
    ).toBe("none");
    expect(decideSystemVolumeObservation({ freeBytes: 0, totalBytes: 0, config, incidentOpen: false })).toBe("none");
    expect(decideSystemVolumeObservation({ freeBytes: -1, totalBytes: TOTAL_BYTES, config, incidentOpen: false })).toBe(
      "none"
    );
  });
});
