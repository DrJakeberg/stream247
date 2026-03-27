import { Panel } from "@/components/panel";
import { readAppState } from "@/lib/server/state";

export default async function SourcesPage() {
  const state = await readAppState();

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
          {state.sources.map((source) => (
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
