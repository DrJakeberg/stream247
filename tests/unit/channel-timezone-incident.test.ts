import { describe, expect, it } from "vitest";
import type { IncidentRecord } from "@stream247/db";
import { resolveChannelTimeZone } from "@stream247/db";
import {
  CHANNEL_TIMEZONE_INCIDENT_FINGERPRINT,
  planChannelTimeZoneIncident
} from "../../apps/worker/src/channel-timezone.js";
import { classifyIncidentFingerprint } from "../../apps/worker/src/incident-classes.js";

function incident(message: string, status: IncidentRecord["status"] = "open"): IncidentRecord {
  return {
    id: "incident_tz",
    scope: "system",
    severity: "warning",
    status,
    acknowledgedAt: "",
    acknowledgedBy: "",
    title: "Channel timezone is not valid",
    message,
    fingerprint: CHANNEL_TIMEZONE_INCIDENT_FINGERPRINT,
    createdAt: "2026-10-02T12:00:00.000Z",
    updatedAt: "2026-10-02T12:00:00.000Z",
    resolvedAt: ""
  } as IncidentRecord;
}

const typo = { CHANNEL_TIMEZONE: "Europe/Berln" };

describe("channel timezone state incident (M85)", () => {
  it("falls back and raises a state incident for a typo in CHANNEL_TIMEZONE", () => {
    expect(resolveChannelTimeZone({}, typo)).toBe("UTC");
    const plan = planChannelTimeZoneIncident({ managedConfig: undefined, incidents: [], env: typo });
    expect(plan).toEqual({
      action: "raise",
      message:
        'CHANNEL_TIMEZONE="Europe/Berln" in the environment is not a valid timezone, so the schedule runs on UTC. Use an IANA zone name such as Europe/Berlin.'
    });
    expect(classifyIncidentFingerprint(CHANNEL_TIMEZONE_INCIDENT_FINGERPRINT)).toMatchObject({ kind: "state", area: "system" });
  });

  it("does not re-write an open incident whose text still holds, so an acknowledgement stays", () => {
    const first = planChannelTimeZoneIncident({ managedConfig: undefined, incidents: [], env: typo });
    if (first.action !== "raise") throw new Error("expected raise");
    expect(planChannelTimeZoneIncident({ managedConfig: undefined, incidents: [incident(first.message)], env: typo })).toEqual({
      action: "none"
    });
    // A different bad value changes the text and is written again.
    expect(
      planChannelTimeZoneIncident({ managedConfig: undefined, incidents: [incident(first.message)], env: { CHANNEL_TIMEZONE: "Europe/Pariss" } }).action
    ).toBe("raise");
    // A resolved incident from an earlier typo does not count as open.
    expect(
      planChannelTimeZoneIncident({ managedConfig: undefined, incidents: [incident(first.message, "resolved")], env: typo }).action
    ).toBe("raise");
  });

  it("closes the incident once the value is fixed, and does nothing on a healthy install", () => {
    const fixed = { CHANNEL_TIMEZONE: "Europe/Berlin" };
    expect(planChannelTimeZoneIncident({ managedConfig: undefined, incidents: [incident("old")], env: fixed })).toEqual({
      action: "resolve"
    });
    expect(planChannelTimeZoneIncident({ managedConfig: undefined, incidents: [], env: fixed })).toEqual({ action: "none" });
  });
});
