/**
 * The state incident for an unusable channel timezone (M85).
 *
 * `resolveChannelTimeZone` no longer throws on a typo such as `CHANNEL_TIMEZONE=Europe/Berln`; it
 * skips the value and the schedule runs on the saved zone or on UTC. That keeps the channel on air,
 * but it moves every block by hours, so the operator has to see it. This module is the pure
 * decision; the worker cycle reads the state and writes the incident.
 *
 * Raised once and re-written only when the text changes, because upsertIncident re-opens the row
 * and clears an acknowledgement on every call. Closed by the same check once the value is fixed.
 */

import { findChannelTimeZoneProblem, type AppState } from "@stream247/db";

export const CHANNEL_TIMEZONE_INCIDENT_FINGERPRINT = "config.channel-timezone.invalid";

export type ChannelTimeZoneIncidentPlan =
  | { action: "raise"; message: string }
  | { action: "resolve" }
  | { action: "none" };

export function planChannelTimeZoneIncident(args: {
  managedConfig: AppState["managedConfig"] | undefined;
  incidents: AppState["incidents"];
  env?: Record<string, string | undefined>;
}): ChannelTimeZoneIncidentPlan {
  const problem = findChannelTimeZoneProblem(args.managedConfig, args.env ?? process.env);
  const open = args.incidents.find(
    (incident) => incident.fingerprint === CHANNEL_TIMEZONE_INCIDENT_FINGERPRINT && incident.status === "open"
  );
  if (problem) {
    return open && open.message === problem ? { action: "none" } : { action: "raise", message: problem };
  }
  return open ? { action: "resolve" } : { action: "none" };
}
