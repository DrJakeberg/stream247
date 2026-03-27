export const dynamic = "force-dynamic";

import { Panel } from "@/components/panel";
import { readAppState } from "@/lib/server/state";

export default async function SourcesPage() {
  const state = await readAppState();

  return (
    <Panel title="Source connectors" eyebrow="Sources">
      <p className="subtle">
        Connectors normalize external video sources into playable assets for the playout queue. The worker currently
        scans the local media library automatically and stores the catalog in PostgreSQL.
      </p>
      <table className="table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Type</th>
            <th>Status</th>
            <th>Last sync</th>
          </tr>
        </thead>
        <tbody>
          {state.sources.map((source) => (
            <tr key={source.name}>
              <td>{source.name}</td>
              <td>{source.type}</td>
              <td>{source.status}</td>
              <td>{source.lastSyncedAt || "Not synced yet"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="list" style={{ marginTop: 24 }}>
        {state.assets.slice(0, 8).map((asset) => (
          <div className="item" key={asset.id}>
            <strong>{asset.title}</strong>
            <div className="subtle">
              {asset.status} · {asset.path}
            </div>
          </div>
        ))}
        {state.assets.length === 0 ? (
          <div className="item">
            <strong>No assets ingested yet</strong>
            <div className="subtle">
              Mount files into the media library volume and let the worker scan them into the catalog.
            </div>
          </div>
        ) : null}
      </div>
    </Panel>
  );
}
