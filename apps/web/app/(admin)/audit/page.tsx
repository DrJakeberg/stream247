export const dynamic = "force-dynamic";

import { AUDIT_EVENT_PROTECTED_RETENTION_LIMIT, AUDIT_EVENT_RETENTION_LIMIT } from "@stream247/db";
import { Panel } from "@/components/panel";
import {
  AUDIT_CATEGORY_BADGE_TONES,
  AUDIT_CATEGORY_LABELS,
  classifyAuditEventType,
  describeAuditOverflow,
  isNotableAuditEvent,
  partitionNotableAuditEvents,
  summariseAuditActivity
} from "@/lib/audit-activity";
import { requireRoles } from "@/lib/server/auth";
import { getRecentAuditEvents, readAppState } from "@/lib/server/state";

/**
 * How much of the retained trail this page reads: both windows, as the state read does.
 *
 * Retention keeps the newest `AUDIT_EVENT_RETENTION_LIMIT` entries of every kind plus the newest
 * `AUDIT_EVENT_PROTECTED_RETENTION_LIMIT` protected ones, and the whole table already travels with
 * every state read, so asking for all of it costs nothing extra here. It is read in full so the
 * counts and the edges describe the trail rather than a page of it; the lists below cap what they
 * render instead.
 */
const AUDIT_READ_LIMIT = AUDIT_EVENT_RETENTION_LIMIT + AUDIT_EVENT_PROTECTED_RETENTION_LIMIT;

/** Rows rendered per panel. Both caps are reported rather than applied silently. */
const NOTABLE_ROW_LIMIT = 60;
const RECENT_ROW_LIMIT = 60;

export default async function AuditPage() {
  await requireRoles(["owner", "admin"]);
  const state = await readAppState();

  const events = getRecentAuditEvents(state, AUDIT_READ_LIMIT);
  const summary = summariseAuditActivity(events, AUDIT_EVENT_RETENTION_LIMIT);
  const notable = events.filter(isNotableAuditEvent);
  // Entries an outsider can write are folded per type first, so the row cap below cannot be filled
  // by them and push a real sign-in out of sight.
  const { listed: notableListed, folded: notableFolded } = partitionNotableAuditEvents(notable);
  const notableRows = notableListed.slice(0, NOTABLE_ROW_LIMIT);
  const recentRows = events.slice(0, RECENT_ROW_LIMIT);
  const notableOverflow = describeAuditOverflow(notableRows.length, notableListed.length);
  const recentOverflow = describeAuditOverflow(recentRows.length, events.length);

  return (
    <>
      <section className="grid metrics">
        <article className="metric">
          <span className="label">Retained entries</span>
          <div className="value">{summary.total}</div>
          <p className="subtle">
            The trail keeps the newest {AUDIT_EVENT_RETENTION_LIMIT} entries, and the newest{" "}
            {AUDIT_EVENT_PROTECTED_RETENTION_LIMIT} security entries beyond them.
          </p>
        </article>
        <article className="metric">
          <span className="label">Security</span>
          <div className="value">{summary.securityCount}</div>
          <p className="subtle">
            Sign-ins, account connections, keys, team grants, destinations, deletions, incidents and integration
            errors.
          </p>
        </article>
        <article className="metric">
          <span className="label">Configuration</span>
          <div className="value">{summary.configurationCount}</div>
          <p className="subtle">Settings and moderation changes.</p>
        </article>
        <article className="metric">
          <span className="label">Complete since</span>
          <div className="value" data-runtime-timestamp>
            {summary.completeSince ? summary.completeSince.slice(0, 10) : "—"}
          </div>
          <p className="subtle">
            {summary.completeSince
              ? "Retention is a count, not a period, so this edge moves with how busy the workspace is. Security entries can reach further back."
              : "Nothing has been recorded yet."}
          </p>
        </article>
      </section>

      <section className="grid two" style={{ marginTop: 24 }}>
        <Panel title="Security and configuration" eyebrow="Audit">
          <p className="subtle">
            Entries that changed access to the workspace or how it is configured. Security entries are kept in their
            own window. Configuration entries share the general window with worker and relay activity, so they are
            complete only back to the edge shown above.
          </p>
          <div className="list">
            {notableFolded.map((group) => (
              <div className="item" key={`folded-${group.type}`}>
                <div className="stats-row">
                  <strong>{group.type}</strong>
                  <span className={`badge badge-${AUDIT_CATEGORY_BADGE_TONES.security}`}>
                    {group.count} {group.count === 1 ? "entry" : "entries"}
                  </span>
                </div>
                <div className="subtle">
                  Can be caused from outside the workspace, so it is summarised here rather than listed. Newest:{" "}
                  {group.newestMessage}
                </div>
                <div className="subtle" data-runtime-timestamp>
                  {group.newestCreatedAt}
                </div>
              </div>
            ))}
            {notableRows.map((event) => {
              const category = classifyAuditEventType(event.type);
              return (
                <div className="item" key={event.id}>
                  <div className="stats-row">
                    <strong>{event.type}</strong>
                    <span className={`badge badge-${AUDIT_CATEGORY_BADGE_TONES[category]}`}>
                      {AUDIT_CATEGORY_LABELS[category]}
                    </span>
                  </div>
                  <div className="subtle">{event.message}</div>
                  <div className="subtle" data-runtime-timestamp>
                    {event.createdAt}
                  </div>
                </div>
              );
            })}
            {notableRows.length === 0 && notableFolded.length === 0 ? (
              <div className="item">
                <strong>No security or configuration entries retained</strong>
                <div className="subtle">
                  Connecting a Twitch account, revealing a relay key, granting team access, or changing settings will
                  appear here.
                </div>
              </div>
            ) : null}
          </div>
          {notableOverflow ? (
            <p className="subtle" style={{ marginTop: 12 }}>
              {notableOverflow}
            </p>
          ) : null}
        </Panel>

        <Panel title="All recent activity" eyebrow="Audit">
          <p className="subtle">Every retained entry, newest first, including catalog and playout actions.</p>
          <div className="list">
            {recentRows.map((event) => (
              <div className="item" key={event.id}>
                <strong>{event.type}</strong>
                <div className="subtle">{event.message}</div>
                <div className="subtle" data-runtime-timestamp>
                  {event.createdAt}
                </div>
              </div>
            ))}
            {recentRows.length === 0 ? (
              <div className="item">
                <strong>No audit entries yet</strong>
                <div className="subtle">Operator and security actions are recorded here as they happen.</div>
              </div>
            ) : null}
          </div>
          {recentOverflow ? (
            <p className="subtle" style={{ marginTop: 12 }}>
              {recentOverflow}
            </p>
          ) : null}
        </Panel>
      </section>
    </>
  );
}
