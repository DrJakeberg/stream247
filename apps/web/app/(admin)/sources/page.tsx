import { Panel } from "@/components/panel";

const sources = [
  { name: "YouTube Playlist", type: "Managed ingestion", status: "Ready" },
  { name: "Twitch Archive", type: "Twitch VOD sync", status: "Ready" },
  { name: "Fallback Slate", type: "Local media", status: "Standby" }
];

export default function SourcesPage() {
  return (
    <Panel title="Source connectors" eyebrow="Sources">
      <p className="subtle">
        Connectors normalize external video sources into playable assets for the
        playout queue.
      </p>
      <table className="table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Type</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {sources.map((source) => (
            <tr key={source.name}>
              <td>{source.name}</td>
              <td>{source.type}</td>
              <td>{source.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}

