import type { DestinationRoutingStatus } from "@stream247/core";

/**
 * Words for the things a destination is stored as.
 *
 * These pages were printing the stored identifiers straight out: a badge reading "primary", a line
 * reading "missing-config", a note reading "key source env". Those are the shapes the database
 * wants, not answers to what an operator is asking, and "missing-config" in particular reads like a
 * fault when it only means nobody has filled it in yet.
 *
 * The maps are exhaustive over their unions on purpose — the test holds them to it — so a new
 * status cannot reach a page as a bare identifier just because someone forgot this file existed.
 */

export const DESTINATION_ROLE_LABELS = {
  primary: "Primary",
  backup: "Backup"
} as const satisfies Record<"primary" | "backup", string>;

export const DESTINATION_STATUS_LABELS = {
  ready: "Ready",
  recovering: "Recovering",
  "missing-config": "Not set up yet",
  error: "Not working"
} as const satisfies Record<DestinationRoutingStatus, string>;

export const STREAM_KEY_SOURCE_LABELS = {
  env: "set in the server configuration",
  managed: "stored here",
  missing: "not set"
} as const satisfies Record<"env" | "managed" | "missing", string>;

export function describeStreamKey(present: boolean, source: "env" | "managed" | "missing" | undefined): string {
  if (!present) {
    return "Stream key missing";
  }
  return `Stream key ${STREAM_KEY_SOURCE_LABELS[source ?? "missing"]}`;
}
