import { describe, expect, it } from "vitest";
import type { StreamDestinationRecord } from "../../apps/web/lib/server/state";
import { resolveDestinationStatusChip } from "../../apps/web/lib/destination-status";

function buildDestination(overrides: Partial<StreamDestinationRecord> = {}): StreamDestinationRecord {
  return {
    id: "destination-primary",
    provider: "twitch",
    role: "primary",
    priority: 0,
    outputProfileId: "inherit",
    name: "Primary Twitch Output",
    enabled: true,
    rtmpUrl: "rtmp://example/live",
    streamKeyPresent: true,
    streamKeySource: "env",
    status: "ready",
    notes: "",
    lastValidatedAt: "",
    lastFailureAt: "",
    failureCount: 0,
    lastError: "",
    ...overrides
  };
}

describe("destination status chip helpers", () => {
  it("maps enabled destinations into status-chip states", () => {
    expect(resolveDestinationStatusChip(buildDestination({ status: "ready" }))).toEqual({ label: "Ready", status: "ok" });
    expect(resolveDestinationStatusChip(buildDestination({ status: "recovering" }))).toEqual({
      label: "Recovering",
      status: "degraded"
    });
    expect(resolveDestinationStatusChip(buildDestination({ status: "missing-config" }))).toEqual({
      label: "Missing config",
      status: "not-ready"
    });
    expect(resolveDestinationStatusChip(buildDestination({ status: "error" }))).toEqual({
      label: "Error",
      status: "degraded"
    });
  });

  it("marks disabled destinations as offline regardless of routing status", () => {
    expect(resolveDestinationStatusChip(buildDestination({ enabled: false, status: "ready" }))).toEqual({
      label: "Disabled",
      status: "offline"
    });
  });
});
