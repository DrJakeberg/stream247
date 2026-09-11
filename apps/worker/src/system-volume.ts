/**
 * Observation-only watch on the volumes the media watermark cannot see.
 *
 * enforceDiskWatermark measures getMediaRoot() and can evict there. A filling OS volume or
 * database volume is invisible to it, and the worker could not evacuate anything on either one
 * anyway — the only correct reaction is a critical incident plus an alert, so an operator frees
 * space before Postgres stops accepting writes or the host runs dry. This module is the pure
 * decision; the wiring in the worker measures and reports.
 *
 * How it measures, and what that honestly covers:
 *
 * - The database volume cannot be statfs'd from the worker container (other volume, possibly
 *   another host). What the worker CAN see over SQL is pg_database_size(current_database()) —
 *   the logical size of this one database. That number is reported in the incident and the
 *   runtime log so the operator can tell whether the database is what is eating the volume, but
 *   it is not a free-space measurement: it excludes WAL, other databases on the same cluster and
 *   filesystem overhead, and it knows nothing about how large the volume underneath is.
 * - The OS volume is approximated by statfs on "/" inside the worker container. On the intended
 *   single-host compose deployment the container root lives on the host's Docker data directory,
 *   which shares the OS disk, so pressure there is pressure here. The approximation misses
 *   deployments where Docker data sits on its own partition or the database runs on another
 *   machine — then "/" only speaks for the worker's own root filesystem, nothing more.
 *
 * The decision has the same once-per-breach shape as the eviction watermark's incident handling:
 * raise when free space first crosses below the trigger, stay silent while the incident is open,
 * resolve only above the (higher) recovery mark so a value hovering at the edge cannot turn one
 * incident into a drumbeat of alerts.
 */

import type { ResolvedSystemVolumeWatermark } from "@stream247/core";

export type SystemVolumeDecision =
  /** Free space crossed below the trigger and no incident is open: raise + alert, once. */
  | "raise"
  /** Free space is back above the recovery mark and an incident is open: resolve it. */
  | "resolve"
  /** Nothing to do — healthy, already-raised, in the hysteresis gap, or unmeasurable. */
  | "none";

export function decideSystemVolumeObservation(args: {
  freeBytes: number;
  totalBytes: number;
  config: ResolvedSystemVolumeWatermark;
  /** True while the incident raised by an earlier cycle is still open. */
  incidentOpen: boolean;
}): SystemVolumeDecision {
  const { freeBytes, totalBytes, config, incidentOpen } = args;

  // An unmeasurable volume reads as "no opinion", never as pressure: statfs handing back zeros
  // or garbage must not page anyone, and it must not resolve a real incident either.
  if (!Number.isFinite(freeBytes) || !Number.isFinite(totalBytes) || totalBytes <= 0 || freeBytes < 0) {
    return "none";
  }

  const freeRatio = freeBytes / totalBytes;

  if (!incidentOpen) {
    return freeRatio < config.triggerFreeRatio ? "raise" : "none";
  }

  return freeRatio >= config.recoverFreeRatio ? "resolve" : "none";
}
