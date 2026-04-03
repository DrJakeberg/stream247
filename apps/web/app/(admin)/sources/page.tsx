export const dynamic = "force-dynamic";

import { Panel } from "@/components/panel";
import { PoolDeleteForm } from "@/components/pool-delete-form";
import { PoolForm } from "@/components/pool-form";
import { SourceCreateForm } from "@/components/source-create-form";
import { SourceActionsForm } from "@/components/source-actions-form";
import { readAppState } from "@/lib/server/state";

export default async function SourcesPage() {
  const state = await readAppState();

  return (
    <div className="grid two">
      <Panel title="Add source" eyebrow="Sources">
        <p className="subtle">
          Direct media URLs, full YouTube playlists or channels, and Twitch VOD or channel archive sources are
          ingestible now. Channel-based connectors preserve source metadata like original title and natural duration.
        </p>
        <SourceCreateForm />
      </Panel>
      <Panel title="Create pool" eyebrow="Programming">
        <p className="subtle">
          Pools are the weekly scheduler&apos;s programming units. The playout runtime rotates through ready assets from
          the selected sources in round-robin order.
        </p>
        <PoolForm sources={state.sources} />
      </Panel>
      <Panel title="Source connectors" eyebrow="Catalog">
        <p className="subtle">
          Connectors normalize external video sources into playable assets for the playout queue. The worker currently
          scans the local media library, ingests direct media URLs, expands YouTube playlists/channels, and resolves
          Twitch VODs/channels into PostgreSQL-backed assets.
        </p>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Type</th>
                <th>Enabled</th>
                <th>Status</th>
                <th>Last sync</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {state.sources.map((source) => (
                <tr key={source.id}>
                  <td className="source-cell">
                    <strong>{source.name}</strong>
                    {source.externalUrl ? <div className="subtle source-url">{source.externalUrl}</div> : null}
                  </td>
                  <td>{source.type}</td>
                  <td>{source.enabled ?? true ? "Yes" : "No"}</td>
                  <td>{source.status}</td>
                  <td>{source.lastSyncedAt || "Not synced yet"}</td>
                  <td className="actions-cell">
                    <SourceActionsForm source={source} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      <Panel title="Pools" eyebrow="Programming">
        <div className="list">
          {state.pools.map((pool) => (
            <div className="item" key={pool.id}>
              <strong>{pool.name}</strong>
              <div className="subtle">
                {pool.sourceIds.length} source(s) · {pool.playbackMode}
              </div>
              <div className="subtle">
                {pool.sourceIds
                  .map((sourceId) => state.sources.find((source) => source.id === sourceId)?.name || sourceId)
                  .join(", ")}
              </div>
              <div style={{ marginTop: 12 }}>
                <PoolForm pool={pool} sources={state.sources} />
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
      <Panel title="Recent assets" eyebrow="Catalog">
        <div className="list" style={{ marginTop: 24 }}>
          {state.assets.slice(0, 8).map((asset) => (
            <div className="item" key={asset.id}>
              <strong>{asset.title}</strong>
              <div className="subtle">
                {asset.status} · {asset.durationSeconds ? `${Math.round(asset.durationSeconds / 60)}m` : "natural duration unknown"} · {asset.path}
              </div>
              <div className="subtle">
                {asset.categoryName || "No source category"}{asset.publishedAt ? ` · ${asset.publishedAt.slice(0, 10)}` : ""}
              </div>
            </div>
          ))}
          {state.assets.length === 0 ? (
            <div className="item">
              <strong>No assets ingested yet</strong>
              <div className="subtle">
                Mount files into the media library volume or add a direct media URL source.
              </div>
            </div>
          ) : null}
        </div>
      </Panel>
    </div>
  );
}
