export const dynamic = "force-dynamic";

import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AssetCurationForm } from "@/components/asset-curation-form";
import { AssetMetadataForm } from "@/components/asset-metadata-form";
import { Panel } from "@/components/panel";
import { buildWorkspaceHref } from "@/lib/workspace-navigation";
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
  const assetCollections = state.assetCollections.filter((collection) => collection.assetIds.includes(asset.id));
  const categorySuggestions = [
    ...new Set(state.assets.map((entry) => entry.categoryName?.trim() || "").filter(Boolean))
  ].sort((left, right) => left.localeCompare(right));
  const hashtags = (() => {
    try {
      const parsed = JSON.parse(asset.hashtagsJson || "[]") as unknown;
      return Array.isArray(parsed) ? parsed.map((entry) => String(entry).trim()).filter(Boolean) : [];
    } catch {
      return [];
    }
  })();

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
        <Panel title="Thumbnail and curated sets" eyebrow="Library">
          <div className="stack-form">
            <div className="asset-card-thumbnail">
              <Image
                alt={`Thumbnail for ${asset.title}`}
                fill
                loading="lazy"
                sizes="(max-width: 900px) 100vw, 50vw"
                src={`/api/assets/${asset.id}/thumbnail`}
                unoptimized
              />
            </div>
            <div className="subtle">
              Local-library assets use generated preview thumbnails when available. Remote or unmatched media falls back
              to a deterministic metadata card so the library stays readable across installs.
            </div>
            <div className="chip-grid">
              {assetCollections.map((collection) => (
                <span
                  className="collection-chip collection-chip-static"
                  key={collection.id}
                  style={{ ["--collection-color" as string]: collection.color }}
                >
                  {collection.name}
                </span>
              ))}
              {assetCollections.length === 0 ? <span className="subtle">No curated sets include this asset yet.</span> : null}
            </div>
          </div>
        </Panel>

        <Panel title="Metadata" eyebrow="Catalog">
          <div className="stack-form">
            <div className="item">
              <strong>Title prefix</strong>
              <div className="subtle">{asset.titlePrefix || "No title prefix configured."}</div>
            </div>
            <div className="item">
              <strong>Category</strong>
              <div className="subtle">{asset.categoryName || "No category metadata recorded."}</div>
            </div>
            <div className="item">
              <strong>Hashtags</strong>
              <div className="subtle">
                {hashtags.length > 0
                  ? hashtags.map((tag) => `#${tag.replace(/^#+/, "")}`).join(", ")
                  : "No Twitch hashtags configured."}
              </div>
            </div>
            <div className="item">
              <strong>Operator notes</strong>
              <div className="subtle">{asset.platformNotes || "No platform notes recorded."}</div>
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
              <strong>Library folder</strong>
              <div className="subtle">{asset.folderPath || "Root library bucket"}</div>
            </div>
            <div className="item">
              <strong>Tags</strong>
              <div className="subtle">{asset.tags && asset.tags.length > 0 ? asset.tags.join(", ") : "No tags assigned."}</div>
            </div>
            <div className="item">
              <strong>Curated sets</strong>
              <div className="subtle">
                {assetCollections.length > 0
                  ? assetCollections.map((collection) => collection.name).join(", ")
                  : "No curated-set membership recorded."}
              </div>
            </div>
            <div className="item">
              <strong>Fallback flags</strong>
              <div className="subtle">
                Priority {asset.fallbackPriority} · {asset.isGlobalFallback ? "Global fallback" : "Regular catalog item"} ·{" "}
                {asset.includeInProgramming ? "included in programming" : "excluded from programming"}
              </div>
            </div>
          </div>
        </Panel>

        <Panel title="Stream metadata" eyebrow="Publishing">
          <div className="subtle" style={{ marginBottom: 12 }}>
            These fields drive the on-air overlay title, Twitch stream title, and per-video category override without
            rewriting ingestion-owned source metadata.
          </div>
          <AssetMetadataForm asset={asset} categorySuggestions={categorySuggestions} />
        </Panel>

        <Panel title="Asset curation" eyebrow="Program">
          <div className="subtle" style={{ marginBottom: 12 }}>
            Exclude assets from automated pool rotation without deleting them, or promote them into the global fallback ladder.
          </div>
          <AssetCurationForm asset={asset} />
        </Panel>

        <Panel title="Program context" eyebrow="Program">
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
              <Link className="subtle-link" href={buildWorkspaceHref("program", "sources", { sourceId: source.id })}>
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
