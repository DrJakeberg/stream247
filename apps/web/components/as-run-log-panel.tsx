import { AS_RUN_RETENTION_DAYS, buildAsRunRowView, type AsRunRecord } from "@stream247/core";
import { Panel } from "@/components/panel";

/**
 * The as-run log (M76) on the Live status tab: every playout run of the last 24 hours, newest first.
 *
 * Read-only and without a single control, so the tab's control budget does not move: the question it
 * answers -- what was on air at 19:38, and why did it end -- used to be reconstructed from container
 * logs that every redeploy throws away. Times are UTC, which the logs and the database speak, with the
 * channel's own clock beside them, which the schedule speaks.
 */
export function AsRunLogPanel(props: {
  /** null when the log could not be read; the status tab still renders. */
  records: AsRunRecord[] | null;
  limit: number;
  nowMs: number;
  timeZone: string;
  sources: { id: string; name: string }[];
  pools: { id: string; name: string }[];
  blocks: { id: string; title: string }[];
}) {
  const sourceNames = new Map(props.sources.map((source) => [source.id, source.name] as const));
  const poolNames = new Map(props.pools.map((pool) => [pool.id, pool.name] as const));
  const blockTitles = new Map(props.blocks.map((block) => [block.id, block.title] as const));
  const rows = (props.records ?? []).map((record) =>
    buildAsRunRowView(record, {
      nowMs: props.nowMs,
      timeZone: props.timeZone,
      sourceName: (id) => sourceNames.get(id) ?? "",
      poolName: (id) => poolNames.get(id) ?? "",
      blockTitle: (id) => blockTitles.get(id) ?? ""
    })
  );

  return (
    <Panel
      eyebrow="As-run log"
      info={`One row per playout run: what aired, how it was fed, why it ended. Kept ${AS_RUN_RETENTION_DAYS} days; GET /api/as-run?from=&to= reads any window, and from = to answers what was on air at that moment.`}
      title="On air, last 24 hours"
    >
      {props.records === null ? (
        <div className="list">
          <div className="item">
            <strong>The as-run log could not be read</strong>
            <div className="subtle">The database did not answer this read; reload the page to try again.</div>
          </div>
        </div>
      ) : rows.length === 0 ? (
        <div className="list">
          <div className="item">
            <strong>Nothing aired in the last 24 hours</strong>
            <div className="subtle">Every playout start writes a row here, from the first start after the upgrade on.</div>
          </div>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Start</th>
                <th>End</th>
                <th>What aired</th>
                <th>How</th>
                <th>Why it ended</th>
                <th>Planned / aired</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>
                    {row.start}
                    {row.startChannel ? <div className="subtle">{row.startChannel}</div> : null}
                  </td>
                  <td>
                    {row.end}
                    {row.endChannel ? <div className="subtle">{row.endChannel}</div> : null}
                  </td>
                  <td>
                    <strong>{row.title}</strong>
                    <div className="subtle">{row.origin ? `${row.kind} · ${row.origin}` : row.kind}</div>
                  </td>
                  <td>{row.input}</td>
                  <td>{row.ended}</td>
                  <td>{row.timing}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {props.records !== null && props.records.length >= props.limit ? (
        <p className="subtle">
          Showing the newest {props.limit} runs. GET /api/as-run with a narrower from and to reaches the rest.
        </p>
      ) : null}
    </Panel>
  );
}
