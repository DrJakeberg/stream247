export const dynamic = "force-dynamic";

import { Panel } from "@/components/panel";
import { SourceCreateForm } from "@/components/source-create-form";
import { readAppState } from "@/lib/server/state";

export default async function SourcesPage() {
  const state = await readAppState();

  return (
    <div className="grid two">
      <Panel title="Add source" eyebrow="Sources">
        <p className="subtle">
          Direct media URLs, YouTube playlists, and Twitch VODs are ingestible now. Playlist and VOD sources are
          normalized through yt-dlp into playable assets for the playout runtime.
        </p>
        <SourceCreateForm />
      </Panel>
      <Panel title="Source connectors" eyebrow="Catalog">
        <p className="subtle">
          Connectors normalize external video sources into playable assets for the playout queue. The worker currently
          scans the local media library, ingests direct media URLs, expands YouTube playlists, and resolves Twitch VODs
          into PostgreSQL-backed assets.
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
              <tr key={source.id}>
                <td>
                  {source.name}
                  {source.externalUrl ? <div className="subtle">{source.externalUrl}</div> : null}
                </td>
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
                Mount files into the media library volume or add a direct media URL source.
              </div>
            </div>
          ) : null}
        </div>
      </Panel>
    </div>
  );
}
