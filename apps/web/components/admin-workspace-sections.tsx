import Link from "next/link";
import { buildWorkspaceHref } from "@/lib/workspace-navigation";
import { AssetLibraryBrowser } from "@/components/asset-library-browser";
import { LibraryUploadForm } from "@/components/library-upload-form";
import { Panel } from "@/components/panel";
import { PoolDeleteForm } from "@/components/pool-delete-form";
import { PoolForm } from "@/components/pool-form";
import { SourceActionsForm } from "@/components/source-actions-form";
import { SourceBulkActionsForm } from "@/components/source-bulk-actions-form";
import { SourceCreateForm } from "@/components/source-create-form";
import { getSourceHealthSnapshot, type AppState } from "@/lib/server/state";

function buildSourceAssetCounts(state: AppState) {
  const assetCountBySource = new Map<string, number>();
  const readyAssetCountBySource = new Map<string, number>();

  for (const asset of state.assets) {
    assetCountBySource.set(asset.sourceId, (assetCountBySource.get(asset.sourceId) ?? 0) + 1);
    if (asset.status === "ready") {
      readyAssetCountBySource.set(asset.sourceId, (readyAssetCountBySource.get(asset.sourceId) ?? 0) + 1);
    }
  }

  return { assetCountBySource, readyAssetCountBySource };
}

export function SourcesWorkspacePanels({ state }: { state: AppState }) {
  const { assetCountBySource, readyAssetCountBySource } = buildSourceAssetCounts(state);

  return (
    <>
      <Panel title="Add source" eyebrow="Ingest">
        <p className="subtle">
          Add a connector for the upstream media feed you want Stream247 to ingest. Sources are ingestion pipelines,
          not the playable catalog itself.
        </p>
        <SourceCreateForm />
      </Panel>

      <Panel title="Source connectors" eyebrow="Sources">
        <p className="subtle">
          Review connector status, bulk sync sources, and edit each ingest pipeline without mixing in uploads, pools,
          or the asset browser.
        </p>
        <div style={{ marginBottom: 16 }}>
          <SourceBulkActionsForm sources={state.sources} />
        </div>
        <div className="list">
          {state.sources.map((source) => {
            const snapshot = getSourceHealthSnapshot(state, source.id);
            return (
              <div className="item" key={source.id}>
                <div className="stack-form">
                  <div>
                    <strong>{source.name}</strong>
                    <div className="subtle">{source.type}</div>
                    {source.externalUrl ? <div className="subtle source-url">{source.externalUrl}</div> : null}
                  </div>
                  <div className="stats-row">
                    <span className="badge">{source.status}</span>
                    <span className="subtle">{source.enabled ?? true ? "Enabled" : "Disabled"}</span>
                    <span className="subtle">{assetCountBySource.get(source.id) ?? 0} assets</span>
                    <span className="subtle">{readyAssetCountBySource.get(source.id) ?? 0} ready</span>
                    <span className="subtle">{source.lastSyncedAt || "Not synced yet"}</span>
                  </div>
                  <div className="subtle">
                    {snapshot.latestRun
                      ? `${snapshot.latestRun.summary} · ${snapshot.latestRun.finishedAt}`
                      : "No sync run recorded yet."}
                  </div>
                  {snapshot.latestRun?.errorMessage ? <div className="danger">{snapshot.latestRun.errorMessage}</div> : null}
                  <div className="stats-row">
                    <span className="subtle">{snapshot.references.pools.length} pool refs</span>
                    <span className="subtle">{snapshot.references.scheduleBlocks.length} schedule refs</span>
                    <span className="subtle">{snapshot.openIncidentCount} open incident(s)</span>
                  </div>
                  <div className="stats-row">
                    <Link className="subtle-link" href={buildWorkspaceHref("program", "sources", { sourceId: source.id })}>
                      Open detail
                    </Link>
                  </div>
                  <SourceActionsForm source={source} />
                </div>
              </div>
            );
          })}
          {state.sources.length === 0 ? (
            <div className="item">
              <strong>No sources configured yet</strong>
              <div className="subtle">Add a YouTube, Twitch, direct-media, or local-library source to start ingestion.</div>
            </div>
          ) : null}
        </div>
      </Panel>
    </>
  );
}

export function PoolsWorkspacePanels({ state }: { state: AppState }) {
  return (
    <>
      <Panel title="Create pool" eyebrow="Program">
        <p className="subtle">
          Pools are the scheduler&apos;s programming units. Group ready assets from one or more sources and apply insert
          or audio-lane behavior here.
        </p>
        <PoolForm assets={state.assets} sources={state.sources} />
      </Panel>

      <Panel title="Pools" eyebrow="Program">
        <div className="list">
          {state.pools.map((pool) => (
            <div className="item" key={pool.id}>
              <strong>{pool.name}</strong>
              <div className="subtle">
                {pool.sourceIds.length} source(s) · {pool.playbackMode}
              </div>
              <div className="subtle">
                {pool.insertAssetId && pool.insertEveryItems > 0
                  ? `Insert ${state.assets.find((asset) => asset.id === pool.insertAssetId)?.title || pool.insertAssetId} every ${pool.insertEveryItems} item(s)`
                  : "No automatic inserts configured"}
              </div>
              <div className="subtle">
                {pool.sourceIds
                  .map((sourceId) => state.sources.find((source) => source.id === sourceId)?.name || sourceId)
                  .join(", ")}
              </div>
              <div className="subtle">
                {state.assets.filter((asset) => pool.sourceIds.includes(asset.sourceId)).length} total assets ·{" "}
                {state.assets.filter((asset) => pool.sourceIds.includes(asset.sourceId) && asset.status === "ready").length} ready
              </div>
              <div style={{ marginTop: 12 }}>
                <PoolForm assets={state.assets} pool={pool} sources={state.sources} />
              </div>
              <div style={{ marginTop: 8 }}>
                <PoolDeleteForm id={pool.id} name={pool.name} />
              </div>
            </div>
          ))}
          {state.pools.length === 0 ? (
            <div className="item">
              <strong>No pools configured yet</strong>
              <div className="subtle">Create pools to schedule different source groups across the week.</div>
            </div>
          ) : null}
        </div>
      </Panel>
    </>
  );
}

export function LibraryWorkspacePanels({ state }: { state: AppState }) {
  return (
    <>
      <Panel title="Upload local media" eyebrow="Library">
        <p className="subtle">
          Upload new files into the shared local media library. The local-library source will ingest them on the next
          worker cycle.
        </p>
        <LibraryUploadForm />
      </Panel>

      <Panel title="Asset library" eyebrow="Catalog">
        <p className="subtle">
          Search the playable catalog by title, source, folder, tag, or curated set. This is the programming-facing
          library, separate from source ingest configuration and pool rules.
        </p>
        <AssetLibraryBrowser assetCollections={state.assetCollections} assets={state.assets} sources={state.sources} />
      </Panel>
    </>
  );
}
