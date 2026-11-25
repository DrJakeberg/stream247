import { isProtectedAuditEventType } from "@stream247/core";
import type { AuditEvent } from "@stream247/db";

/**
 * Reading the audit trail as an operator rather than as a log.
 *
 * The trail is written durably and pruned in two windows (`selectRetainedAuditEvents`): the newest
 * entries of every kind, plus the newest entries of the kinds an audit trail exists for. But it had
 * no reader. `getRecentAuditEvents` existed and nothing called it; the only audit surface in the
 * product was the per-source list on the source detail page, which by construction cannot show a
 * sign-in, a revealed relay key, or a stream destination being deleted.
 *
 * So the question this module answers is the one an operator actually opens an audit view with:
 * "did anything touch access or credentials". Everything else is real activity and worth listing,
 * but it is not what that visit is about.
 */

export type AuditActivityCategory = "security" | "configuration" | "activity";

/**
 * Security-relevant types that the retention rule does not protect on their own account.
 *
 * The base of the security category is `isProtectedAuditEventType` from `@stream247/core`, the
 * pattern the pruning SQL uses: one vocabulary, so the screen and the retention rule cannot drift
 * into disagreeing about what an audit trail is for. These few are added because they answer the
 * same question without being in that pattern. The `relay.` family is NOT matched as a prefix: since
 * the relay watch (M126) it is mostly `relay.watchdog.*` and `relay.reachable` chatter, which would
 * bury a revealed ingest key under reconnects. `twitch.` likewise is mostly schedule and EventSub
 * reconciliation; connecting or disconnecting the broadcaster account is the part that changes who
 * the channel publishes as.
 */
const SECURITY_TYPES = new Set([
  "relay.internal_key.revealed",
  "relay.publish_rejected",
  "twitch.broadcaster.connected",
  "twitch.broadcaster.disconnected"
]);

/** Types that change how the appliance is configured, without themselves granting access. */
const CONFIGURATION_TYPE_PREFIXES = ["settings.", "moderation."] as const;

/**
 * Routine entries inside a configuration family. `moderation.checkin` is a moderator checking in
 * from chat, written once per check-in by the worker; as configuration it would fill the notable
 * panel on any channel with an active moderator.
 */
const ACTIVITY_TYPE_PREFIXES = ["moderation.checkin"] as const;

export function classifyAuditEventType(type: string): AuditActivityCategory {
  const normalised = (type || "").trim().toLowerCase();

  if (SECURITY_TYPES.has(normalised) || isProtectedAuditEventType(normalised)) {
    return "security";
  }

  if (ACTIVITY_TYPE_PREFIXES.some((prefix) => normalised.startsWith(prefix))) {
    return "activity";
  }

  if (CONFIGURATION_TYPE_PREFIXES.some((prefix) => normalised.startsWith(prefix))) {
    return "configuration";
  }

  return "activity";
}

/**
 * Notable types that someone outside the workspace can cause to be written.
 *
 * `relay.publish_rejected` is written for any refused publish on the relay auth hook (throttled to
 * ten a minute globally), and `twitch.error` / `twitch.broadcaster.error` are written from the OAuth
 * callbacks, which an anonymous visitor can reach. They stay security entries, but listed one row per
 * entry they would fill the capped notable panel within minutes and push a real sign-in or team
 * grant below the line where nobody sees it. So they are folded into one summary row per type.
 */
export const OUTSIDER_WRITABLE_AUDIT_TYPES: ReadonlySet<string> = new Set([
  "relay.publish_rejected",
  "twitch.error",
  "twitch.broadcaster.error"
]);

export type FoldedAuditType = {
  type: string;
  count: number;
  newestCreatedAt: string;
  newestMessage: string;
};

/**
 * Splits notable entries (newest first) into the ones listed row by row and the outsider-writable
 * ones folded per type, so the row cap only ever applies to entries an outsider cannot write.
 */
export function partitionNotableAuditEvents(notable: AuditEvent[]): { listed: AuditEvent[]; folded: FoldedAuditType[] } {
  const listed: AuditEvent[] = [];
  const folded = new Map<string, FoldedAuditType>();

  for (const event of notable) {
    const type = (event.type || "").trim().toLowerCase();
    if (!OUTSIDER_WRITABLE_AUDIT_TYPES.has(type)) {
      listed.push(event);
      continue;
    }
    const existing = folded.get(type);
    if (!existing) {
      folded.set(type, { type, count: 1, newestCreatedAt: event.createdAt, newestMessage: event.message });
      continue;
    }
    existing.count += 1;
    if (event.createdAt > existing.newestCreatedAt) {
      existing.newestCreatedAt = event.createdAt;
      existing.newestMessage = event.message;
    }
  }

  return { listed, folded: [...folded.values()] };
}

/** Whether an entry belongs in the notable panel rather than only in the full list. */
export function isNotableAuditEvent(event: Pick<AuditEvent, "type">): boolean {
  return classifyAuditEventType(event.type) !== "activity";
}

export const AUDIT_CATEGORY_LABELS: Record<AuditActivityCategory, string> = {
  security: "Security",
  configuration: "Configuration",
  activity: "Activity"
};

/**
 * Badge tone per category, using the tones the rest of the admin surfaces already use.
 *
 * Security entries are not failures, so `action` would overstate them on a quiet day; they are the
 * rows that should draw the eye when scanning, which is what `ready` does here.
 */
export const AUDIT_CATEGORY_BADGE_TONES: Record<AuditActivityCategory, string> = {
  security: "ready",
  configuration: "optional",
  activity: "optional"
};

export type AuditActivitySummary = {
  /** Entries handed to the summary: the retained trail, not the all-time count. */
  total: number;
  securityCount: number;
  configurationCount: number;
  /**
   * Since when every entry is on record: the createdAt of the oldest entry in the general window.
   *
   * Retention is a count bound rather than an age bound, so how far back the trail reaches is a
   * property of how busy the workspace has been and cannot be stated as a fixed period. Beyond this
   * edge only protected entries remain, so an operator checking whether something from last week
   * would still be here needs this edge, not the oldest row.
   */
  completeSince: string;
  /** The createdAt of the oldest retained entry of any kind (a protected one, once the general window is full). */
  oldestCreatedAt: string;
  newestCreatedAt: string;
};

/**
 * @param generalWindow the general retention window (`AUDIT_EVENT_RETENTION_LIMIT`). Entries beyond
 *   it, newest first, survived only because they are protected.
 */
export function summariseAuditActivity(events: AuditEvent[], generalWindow = Number.POSITIVE_INFINITY): AuditActivitySummary {
  const timestamps = events
    .map((event) => event.createdAt)
    .filter((value): value is string => Boolean(value))
    .sort();
  const newestFirst = [...timestamps].reverse();
  const general = newestFirst.slice(0, Math.max(0, generalWindow));

  return {
    total: events.length,
    securityCount: events.filter((event) => classifyAuditEventType(event.type) === "security").length,
    configurationCount: events.filter((event) => classifyAuditEventType(event.type) === "configuration").length,
    completeSince: general[general.length - 1] || "",
    oldestCreatedAt: timestamps[0] || "",
    newestCreatedAt: timestamps[timestamps.length - 1] || ""
  };
}

/**
 * What the panel is not showing.
 *
 * The same reason `describeOpenIncidentOverflow` exists: a cap is fine, a silent cap is not, because
 * the entry being looked for may be the one below the line. Here it matters more than usual: the
 * trail is evidence, and an operator who reads an audit list as complete when it is truncated draws
 * a conclusion the screen did not support.
 */
export function describeAuditOverflow(shown: number, total: number): string {
  const hidden = Math.max(0, total - shown);
  if (hidden === 0) {
    return "";
  }

  return `${hidden} older retained entr${hidden === 1 ? "y is" : "ies are"} not shown here.`;
}
