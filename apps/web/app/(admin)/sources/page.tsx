export const dynamic = "force-dynamic";

import { AssetLibraryBrowser } from "@/components/asset-library-browser";
import { Panel } from "@/components/panel";
import { PoolDeleteForm } from "@/components/pool-delete-form";
import { PoolForm } from "@/components/pool-form";
import { SourceCreateForm } from "@/components/source-create-form";
import { SourceActionsForm } from "@/components/source-actions-form";
import { readAppState } from "@/lib/server/state";

export default async function SourcesPage() {
  const state = await readAppState();
  const assetCountBySource = new Map<string, number>();
  const readyAssetCountBySource = new Map<string, number>();

  for (const asset of state.assets) {
    assetCountBySource.set(asset.sourceId, (assetCountBySource.get(asset.sourceId) ?? 0) + 1);
    if (asset.status === "ready") {
      readyAssetCountBySource.set(asset.sourceId, (readyAssetCountBySource.get(asset.sourceId) ?? 0) + 1);
    }
  }

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
      <Panel title="Source library" eyebrow="Catalog">
        <p className="subtle">
          Sources now act like a programming library, not just connector rows. Edit naming, connector type, source URL,
          and enabled state directly here, then review how many assets each source currently contributes to your pools.
        </p>
        <div className="list">
          {state.sources.map((source) => (
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
                <SourceActionsForm source={source} />
              </div>
            </div>
          ))}
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
              <div className="subtle">
                {state.assets.filter((asset) => pool.sourceIds.includes(asset.sourceId)).length} total assets ·{" "}
                {state.assets.filter((asset) => pool.sourceIds.includes(asset.sourceId) && asset.status === "ready").length} ready
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
      <Panel title="Asset library" eyebrow="Catalog">
        <p className="subtle">
          Search the current playable catalog by title, category, source, and status. This should make channel-scale
          programming much easier than working from raw source rows alone.
        </p>
        <AssetLibraryBrowser assets={state.assets} sources={state.sources} />
      </Panel>
    </div>
  );
}
