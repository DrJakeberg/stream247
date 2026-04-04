export const dynamic = "force-dynamic";

import { IncidentActionForm } from "@/components/incident-action-form";
import { Panel } from "@/components/panel";
import {
  getFilteredIncidents,
  getPlayoutQueueAssets,
  getRecentAuditEvents,
  getRuntimeDriftReport,
  getWorkerHealth,
  readAppState
} from "@/lib/server/state";

type SearchParams = Promise<{
  status?: string;
  severity?: string;
  scope?: string;
  q?: string;
}>;

export default async function OpsPage(props: { searchParams: SearchParams }) {
  const searchParams = await props.searchParams;
  const state = await readAppState();
  const status = searchParams.status === "open" || searchParams.status === "resolved" ? searchParams.status : "all";
  const severity =
    searchParams.severity === "info" || searchParams.severity === "warning" || searchParams.severity === "critical"
      ? searchParams.severity
      : "all";
  const scope =
    searchParams.scope === "worker" ||
    searchParams.scope === "playout" ||
    searchParams.scope === "twitch" ||
    searchParams.scope === "source" ||
    searchParams.scope === "system"
      ? searchParams.scope
      : "all";
  const query = (searchParams.q || "").trim();

  const incidents = getFilteredIncidents(state, {
    status,
    severity,
    scope,
    query
  });
  const drift = getRuntimeDriftReport(state);
  const workerHealth = getWorkerHealth(state);
  const queuedAssets = getPlayoutQueueAssets(state);
  const recentAuditEvents = getRecentAuditEvents(state, 12);
  const acknowledgedOpenCount = state.incidents.filter((incident) => incident.status === "open" && incident.acknowledgedAt).length;

  return (
    <>
      <section className="hero">
        <span className="badge">Operations</span>
        <h2>Inspect incidents, runtime drift, and current operator-visible system state.</h2>
        <p>Use this view to triage alert history, see what is drifting, and understand whether worker and playout are healthy.</p>
      </section>

      <section className="grid metrics">
        <article className="metric">
          <span className="label">Open incidents</span>
          <div className="value">{state.incidents.filter((incident) => incident.status === "open").length}</div>
          <p className="subtle">{acknowledgedOpenCount} acknowledged but still open.</p>
        </article>
        <article className="metric">
          <span className="label">Filtered results</span>
          <div className="value">{incidents.length}</div>
          <p className="subtle">Current incident list after status, severity, scope, and text filters.</p>
        </article>
        <article className="metric">
          <span className="label">Drift checks</span>
          <div className="value">{drift.attentionCount}</div>
          <p className="subtle">Checks currently needing attention.</p>
        </article>
        <article className="metric">
          <span className="label">Worker status</span>
          <div className="value">{workerHealth.status}</div>
          <p className="subtle">{workerHealth.summary}</p>
        </article>
      </section>

      <section className="grid two" style={{ marginTop: 24 }}>
        <Panel title="Runtime drift" eyebrow="Ops">
          <div className="list">
            {drift.items.map((item) => (
              <div className="item" key={item.id}>
                <strong>
                  {item.label} · {item.severity.toUpperCase()}
                </strong>
                <div className="subtle">{item.summary}</div>
                <div className="subtle">{item.detail}</div>
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="Runtime snapshot" eyebrow="Current state">
          <div className="list">
            <div className="item">
              <strong>Playout process</strong>
              <div className="subtle">
                Status {state.playout.status} · PID {state.playout.processPid || "not running"} · restarts {state.playout.restartCount}
              </div>
              <div className="subtle">
                Transition {state.playout.transitionState} · prefetch {state.playout.prefetchStatus || "idle"} · last probe{" "}
                {state.playout.prefetchedAt || "never"}
              </div>
              <div className="subtle">
                Current asset {state.playout.currentTitle || "none"} · desired asset {state.playout.desiredAssetId || "none"}
              </div>
              <div className="subtle">
                Next asset {state.playout.nextTitle || "none"} · queue{" "}
                {queuedAssets.length > 0 ? queuedAssets.slice(0, 4).map((asset) => asset.title).join(" → ") : "empty"}
              </div>
              {state.playout.prefetchError ? <div className="subtle">Prefetch error: {state.playout.prefetchError}</div> : null}
            </div>
            <div className="item">
              <strong>Operator control</strong>
              <div className="subtle">
                Mode {state.playout.overrideMode} · override asset {state.playout.overrideAssetId || "none"}
              </div>
              <div className="subtle">
                Override until {state.playout.overrideUntil || "none"} · skip until {state.playout.skipUntil || "none"}
              </div>
            </div>
            <div className="item">
              <strong>Twitch sync</strong>
              <div className="subtle">
                Status {state.twitch.status} · metadata {state.twitch.lastMetadataSyncAt || "never"} · schedule {state.twitch.lastScheduleSyncAt || "never"}
              </div>
              <div className="subtle">{state.twitch.error || "No current Twitch error."}</div>
            </div>
            <div className="item">
              <strong>Destinations</strong>
              <div className="subtle">
                {state.destinations.length > 0
                  ? [...state.destinations]
                      .sort((left, right) => left.priority - right.priority || left.name.localeCompare(right.name))
                      .map((destination) => `${destination.role}:${destination.name}:${destination.status}`)
                      .join(" · ")
                  : "No destinations configured."}
              </div>
            </div>
          </div>
        </Panel>
      </section>

      <section className="grid two" style={{ marginTop: 24 }}>
        <Panel title="Incident history" eyebrow="Filters">
          <form action="/ops" className="stack-form" method="GET">
            <div className="form-grid">
              <label>
                <span className="label">Status</span>
                <select defaultValue={status} name="status">
                  <option value="all">All</option>
                  <option value="open">Open</option>
                  <option value="resolved">Resolved</option>
                </select>
              </label>
              <label>
                <span className="label">Severity</span>
                <select defaultValue={severity} name="severity">
                  <option value="all">All</option>
                  <option value="info">Info</option>
                  <option value="warning">Warning</option>
                  <option value="critical">Critical</option>
                </select>
              </label>
              <label>
                <span className="label">Scope</span>
                <select defaultValue={scope} name="scope">
                  <option value="all">All</option>
                  <option value="worker">Worker</option>
                  <option value="playout">Playout</option>
                  <option value="twitch">Twitch</option>
                  <option value="source">Source</option>
                  <option value="system">System</option>
                </select>
              </label>
            </div>
            <label>
              <span className="label">Search</span>
              <input defaultValue={query} name="q" placeholder="title, message, fingerprint" />
            </label>
            <button className="button" type="submit">
              Apply filters
            </button>
          </form>

          <div className="list" style={{ marginTop: 16 }}>
            {incidents.length > 0 ? (
              incidents.map((incident) => (
                <div className="item" key={incident.id}>
                  <strong>
                    {incident.severity.toUpperCase()} · {incident.scope} · {incident.title}
                  </strong>
                  <div className="subtle">{incident.message}</div>
                  <div className="subtle">
                    Status {incident.status} · created {incident.createdAt} · updated {incident.updatedAt}
                  </div>
                  <div className="subtle">
                    {incident.acknowledgedAt
                      ? `Acknowledged by ${incident.acknowledgedBy || "unknown"} at ${incident.acknowledgedAt}`
                      : "Not acknowledged."}
                  </div>
                  {incident.resolvedAt ? <div className="subtle">Resolved at {incident.resolvedAt}</div> : null}
                  <IncidentActionForm
                    acknowledgedAt={incident.acknowledgedAt}
                    fingerprint={incident.fingerprint}
                    status={incident.status}
                  />
                </div>
              ))
            ) : (
              <div className="item">
                <strong>No incidents match the current filters.</strong>
                <div className="subtle">Try clearing one of the filters or broadening the search text.</div>
              </div>
            )}
          </div>
        </Panel>

        <Panel title="Recent audit trail" eyebrow="Visibility">
          <div className="list">
            {recentAuditEvents.map((event) => (
              <div className="item" key={event.id}>
                <strong>{event.type}</strong>
                <div className="subtle">{event.message}</div>
                <div className="subtle">{event.createdAt}</div>
              </div>
            ))}
          </div>
        </Panel>
      </section>
    </>
  );
}
