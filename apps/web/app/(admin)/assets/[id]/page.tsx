export const dynamic = "force-dynamic";

import Link from "next/link";
import { notFound } from "next/navigation";
import { Panel } from "@/components/panel";
import {
  getAssetPlaybackDiagnostics,
  getCurrentScheduleItem,
  getNextScheduleItem,
  getSourceHealthSnapshot,
  readAppState
} from "@/lib/server/state";

export default async function AssetDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const state = await readAppState();
  const asset = state.assets.find((entry) => entry.id === id);

  if (!asset) {
    notFound();
  }

  const source = state.sources.find((entry) => entry.id === asset.sourceId) ?? null;
  const pools = state.pools.filter((pool) => pool.sourceIds.includes(asset.sourceId));
  const sourceSnapshot = getSourceHealthSnapshot(state, asset.sourceId);
  const playbackDiagnostics = getAssetPlaybackDiagnostics(state, asset.id);
  const activeScheduleItem = getCurrentScheduleItem(state);
  const nextScheduleItem = getNextScheduleItem(state);
  const isCurrent = state.playout.currentAssetId === asset.id;
  const isOverride = state.playout.overrideAssetId === asset.id;

  return (
    <>
      <section className="hero">
        <span className="badge">Asset detail</span>
        <h2>{asset.title}</h2>
        <p>
          Inspect asset metadata, source origin, runtime relevance, and programming context before using it in manual
          overrides or schedule planning.
        </p>
      </section>

      <section className="grid metrics">
        <article className="metric">
          <span className="label">Status</span>
          <div className="value">{asset.status}</div>
          <p className="subtle">{asset.updatedAt || asset.createdAt}</p>
        </article>
        <article className="metric">
          <span className="label">Duration</span>
          <div className="value">
            {asset.durationSeconds ? `${Math.round(asset.durationSeconds / 60)}m` : "Unknown"}
          </div>
          <p className="subtle">{asset.publishedAt ? `Published ${asset.publishedAt}` : "No published timestamp available."}</p>
        </article>
        <article className="metric">
          <span className="label">Source</span>
          <div className="value">{source?.name || asset.sourceId}</div>
          <p className="subtle">{source?.connectorKind || "Unknown connector"}</p>
        </article>
        <article className="metric">
          <span className="label">On air state</span>
          <div className="value">{isCurrent ? "Current" : isOverride ? "Override" : "Catalog"}</div>
          <p className="subtle">
            {isCurrent
              ? "This asset is currently on air."
              : isOverride
                ? "This asset is pinned as the current override target."
                : "This asset is available for pool rotation or manual override."}
          </p>
        </article>
      </section>

      <section className="grid two" style={{ marginTop: 24 }}>
        <Panel title="Metadata" eyebrow="Catalog">
          <div className="stack-form">
            <div className="item">
              <strong>Category</strong>
              <div className="subtle">{asset.categoryName || "No category metadata recorded."}</div>
            </div>
            <div className="item">
              <strong>External id</strong>
              <div className="subtle">{asset.externalId || "No external id recorded."}</div>
            </div>
            <div className="item">
              <strong>Path / playable input</strong>
              <div className="subtle asset-path">{asset.path}</div>
            </div>
            <div className="item">
              <strong>Fallback flags</strong>
              <div className="subtle">
                Priority {asset.fallbackPriority} · {asset.isGlobalFallback ? "Global fallback" : "Regular catalog item"}
              </div>
            </div>
          </div>
        </Panel>

        <Panel title="Programming context" eyebrow="Programming">
          <div className="list">
            {pools.map((pool) => (
              <div className="item" key={pool.id}>
                <strong>{pool.name}</strong>
              <div className="subtle">
                {pool.playbackMode} ·{" "}
                {pool.cursorAssetId === asset.id ? "Current pool cursor asset" : "Available in pool rotation"}
              </div>
            </div>
          ))}
            {pools.length === 0 ? (
              <div className="item">
                <strong>No pool membership</strong>
                <div className="subtle">This asset&apos;s source is not currently part of any programming pool.</div>
              </div>
            ) : null}
            <div className="item">
              <strong>Current schedule</strong>
              <div className="subtle">{activeScheduleItem ? activeScheduleItem.title : "No active schedule item."}</div>
              <div className="subtle">Next: {nextScheduleItem ? nextScheduleItem.title : "No next item."}</div>
            </div>
          </div>
        </Panel>

        <Panel title="Related source" eyebrow="Source">
          <div className="stack-form">
            <div className="subtle">{source?.notes || "No source notes available."}</div>
            {source?.externalUrl ? <div className="subtle source-url">{source.externalUrl}</div> : null}
            <div className="subtle">
              {sourceSnapshot.latestRun
                ? `${sourceSnapshot.latestRun.summary} · ${sourceSnapshot.latestRun.finishedAt}`
                : "No source sync run recorded yet."}
            </div>
            <div className="subtle">
              {sourceSnapshot.assetCount} asset(s) from source · {sourceSnapshot.readyAssetCount} ready ·{" "}
              {sourceSnapshot.openIncidentCount} open incident(s)
            </div>
            {sourceSnapshot.latestRun?.errorMessage ? <div className="danger">{sourceSnapshot.latestRun.errorMessage}</div> : null}
            {source ? (
              <Link className="subtle-link" href={`/sources/${source.id}`}>
                Open source detail
              </Link>
            ) : null}
          </div>
        </Panel>

        <Panel title="Runtime state" eyebrow="Ops">
          <div className="stack-form">
            <div className="item">
              <strong>Playback diagnostics</strong>
              <div className="subtle">{playbackDiagnostics.summary}</div>
              <div className="subtle">Status: {playbackDiagnostics.status}</div>
            </div>
            {playbackDiagnostics.details.map((detail) => (
              <div className="item" key={detail}>
                <div className="subtle">{detail}</div>
              </div>
            ))}
            <div className="item">
              <strong>Playout status</strong>
              <div className="subtle">
                {state.playout.status} · {state.playout.selectionReasonCode || "no selection reason"}
              </div>
            </div>
            <div className="item">
              <strong>Current / desired asset ids</strong>
              <div className="subtle">
                Current: {state.playout.currentAssetId || "none"} · Desired: {state.playout.desiredAssetId || "none"}
              </div>
            </div>
            <div className="item">
              <strong>Last playout message</strong>
              <div className="subtle">{state.playout.message || "No runtime message recorded."}</div>
            </div>
          </div>
        </Panel>
      </section>
    </>
  );
}
