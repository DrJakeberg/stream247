export const dynamic = "force-dynamic";

import Link from "next/link";
import { notFound } from "next/navigation";
import { Panel } from "@/components/panel";
import { SourceActionsForm } from "@/components/source-actions-form";
import { SourceSyncForm } from "@/components/source-sync-form";
import {
  getSourceConnectorDiagnostics,
  getSourceAuditEvents,
  getSourceHealthSnapshot,
  getSourceIncidents,
  getSourceRecoveryActions,
  getSourceSyncRuns,
  getSourceReferences,
  readAppState
} from "@/lib/server/state";

const dayLabels = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export default async function SourceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const state = await readAppState();
  const source = state.sources.find((entry) => entry.id === id);

  if (!source) {
    notFound();
  }

  const assets = state.assets
    .filter((asset) => asset.sourceId === source.id)
    .sort((left, right) => new Date(right.publishedAt || right.updatedAt).getTime() - new Date(left.publishedAt || left.updatedAt).getTime());
  const readyAssets = assets.filter((asset) => asset.status === "ready");
  const errorAssets = assets.filter((asset) => asset.status === "error");
  const incidents = getSourceIncidents(state, source.id);
  const syncRuns = getSourceSyncRuns(state, source.id);
  const auditEvents = getSourceAuditEvents(state, source.id);
  const references = getSourceReferences(state, source.id);
  const health = getSourceHealthSnapshot(state, source.id);
  const diagnostics = getSourceConnectorDiagnostics(state, source.id);
  const recoveryActions = getSourceRecoveryActions(state, source.id);

  return (
    <>
      <section className="hero">
        <span className="badge">Source detail</span>
        <h2>{source.name}</h2>
        <p>
          Review source health, imported assets, pool references, and recent sync activity in one place instead of
          working from the flat library view only.
        </p>
      </section>

      <section className="grid metrics">
        <article className="metric">
          <span className="label">Connector</span>
          <div className="value">{source.connectorKind}</div>
          <p className="subtle">{source.type}</p>
        </article>
        <article className="metric">
          <span className="label">Sync status</span>
          <div className="value">{source.status}</div>
          <p className="subtle">{source.lastSyncedAt || "No sync has completed yet."}</p>
        </article>
        <article className="metric">
          <span className="label">Assets</span>
          <div className="value">{assets.length}</div>
          <p className="subtle">
            {readyAssets.length} ready · {errorAssets.length} error
          </p>
        </article>
        <article className="metric">
          <span className="label">Open incidents</span>
          <div className="value">{health.openIncidentCount}</div>
          <p className="subtle">
            {health.latestRun ? `${health.latestRun.status} · ${health.latestRun.summary}` : "No sync result recorded yet."}
          </p>
        </article>
      </section>

      <section className="grid two" style={{ marginTop: 24 }}>
        <Panel title="Source actions" eyebrow="Catalog">
          <div className="stack-form">
            {source.externalUrl ? <div className="subtle source-url">{source.externalUrl}</div> : null}
            <div className="subtle">{source.notes || "No source notes are recorded yet."}</div>
            <SourceSyncForm enabled={source.enabled ?? true} sourceId={source.id} />
            <SourceActionsForm source={source} />
          </div>
        </Panel>

        <Panel title="Programming references" eyebrow="Programming">
          <div className="list">
            {references.pools.map((pool) => (
              <div className="item" key={pool.id}>
                <strong>{pool.name}</strong>
                <div className="subtle">
                  Playback: {pool.playbackMode} · {pool.sourceIds.length} source(s)
                </div>
              </div>
            ))}
            {references.scheduleBlocks.map((block) => (
              <div className="item" key={block.id}>
                <strong>{block.title}</strong>
                <div className="subtle">
                  {dayLabels[block.dayOfWeek] || `Day ${block.dayOfWeek}`} · {Math.floor(block.startMinuteOfDay / 60)
                    .toString()
                    .padStart(2, "0")}
                  :
                  {(block.startMinuteOfDay % 60).toString().padStart(2, "0")} · {block.durationMinutes} min
                </div>
              </div>
            ))}
            {references.pools.length === 0 && references.scheduleBlocks.length === 0 ? (
              <div className="item">
                <strong>No programming references</strong>
                <div className="subtle">This source is not currently used by any pool or weekly schedule block.</div>
              </div>
            ) : null}
          </div>
        </Panel>

        <Panel title="Connector diagnostics" eyebrow="Troubleshooting">
          <div className="list">
            <div className="item">
              <strong>Expected input</strong>
              <div className="subtle">{diagnostics.expectedInput}</div>
              <div className="subtle">
                URL check: {diagnostics.isValidUrl ? "looks valid" : "does not match the expected connector pattern"}
              </div>
            </div>
            {diagnostics.hints.map((hint) => (
              <div className="item" key={hint}>
                <div className="subtle">{hint}</div>
              </div>
            ))}
            {recoveryActions.map((action) => (
              <div className="item" key={action}>
                <strong>Suggested next step</strong>
                <div className="subtle">{action}</div>
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="Sync and incident history" eyebrow="Ops">
          <div className="list">
            {syncRuns.map((run) => (
              <div className="item" key={run.id}>
                <div className="stats-row">
                  <strong>{run.summary}</strong>
                  <span className={`badge badge-${run.status === "success" ? "ready" : run.status === "error" ? "action" : "optional"}`}>
                    {run.status}
                  </span>
                </div>
                <div className="subtle">
                  {run.startedAt} to {run.finishedAt}
                </div>
                <div className="subtle">
                  {run.discoveredAssets} discovered · {run.readyAssets} ready
                </div>
                {run.errorMessage ? <div className="danger">{run.errorMessage}</div> : null}
              </div>
            ))}
            {incidents.map((incident) => (
              <div className="item" key={incident.id}>
                <div className="stats-row">
                  <strong>{incident.title}</strong>
                  <span className={`badge badge-${incident.status === "resolved" ? "optional" : "action"}`}>{incident.status}</span>
                </div>
                <div className="subtle">{incident.message}</div>
                <div className="subtle">
                  {incident.updatedAt || incident.createdAt} · {incident.severity} · {incident.scope}
                </div>
              </div>
            ))}
            {auditEvents.map((event) => (
              <div className="item" key={event.id}>
                <strong>{event.type}</strong>
                <div className="subtle">{event.message}</div>
                <div className="subtle">{event.createdAt}</div>
              </div>
            ))}
            {syncRuns.length === 0 && incidents.length === 0 && auditEvents.length === 0 ? (
              <div className="item">
                <strong>No sync history yet</strong>
                <div className="subtle">Run the worker once or request a manual source sync to build a history trail.</div>
              </div>
            ) : null}
          </div>
        </Panel>

        <Panel title="Imported assets" eyebrow="Library">
          <div className="list">
            {assets.slice(0, 24).map((asset) => (
              <div className="item" key={asset.id}>
                <div className="stats-row">
                  <strong className="truncate-title">{asset.title}</strong>
                  <span className={`badge badge-${asset.status === "ready" ? "ready" : asset.status === "error" ? "action" : "optional"}`}>
                    {asset.status}
                  </span>
                </div>
                <div className="subtle">
                  {asset.durationSeconds ? `${Math.round(asset.durationSeconds / 60)} min` : "Natural duration unknown"} ·{" "}
                  {asset.categoryName || "No category"}{asset.publishedAt ? ` · ${asset.publishedAt.slice(0, 10)}` : ""}
                </div>
                <div className="subtle asset-path">{asset.path}</div>
                <div style={{ marginTop: 8 }}>
                  <Link className="subtle-link" href={`/assets/${asset.id}`}>
                    Open asset detail
                  </Link>
                </div>
              </div>
            ))}
            {assets.length === 0 ? (
              <div className="item">
                <strong>No assets imported yet</strong>
                <div className="subtle">This source has not produced any assets so far.</div>
              </div>
            ) : null}
          </div>
        </Panel>
      </section>
    </>
  );
}
