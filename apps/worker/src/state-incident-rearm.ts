/**
 * Re-arms the in-memory "incident is open" flags of the observation-only state monitors after a
 * worker restart (M95, H5).
 *
 * The disk watermark and the system-volume watch remember in a module variable that their incident
 * is open, so they resolve it once when space comes back instead of on every idle cycle. A restart
 * reset those variables to false while the incident row stayed open: the monitor then saw "nothing
 * open, nothing to do" and the incident never closed, even with the disk long since freed. Seeding
 * the flags from the open rows on the first cycle lets each monitor re-measure and close it itself.
 */

export type StateIncidentFlags = {
  diskWatermarkIncidentRaised: boolean;
  systemVolumeIncidentOpen: boolean;
};

const DISK_WATERMARK_FINGERPRINTS = new Set(["disk.watermark.evicted", "disk.watermark.exhausted"]);
const SYSTEM_VOLUME_FINGERPRINT = "system.volume.low";

export function rearmStateIncidentFlags(
  incidents: ReadonlyArray<{ fingerprint: string; status: string }>
): StateIncidentFlags {
  const open = incidents.filter((incident) => incident.status === "open");
  return {
    diskWatermarkIncidentRaised: open.some((incident) => DISK_WATERMARK_FINGERPRINTS.has(incident.fingerprint)),
    systemVolumeIncidentOpen: open.some((incident) => incident.fingerprint === SYSTEM_VOLUME_FINGERPRINT)
  };
}
