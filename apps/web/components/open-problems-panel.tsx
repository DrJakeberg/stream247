import type { LiveHeartbeatProblem, LiveIncidentSummary } from "@/lib/live-broadcast";
import { describeHeartbeatAge, describeIncidentAge, describeOpenIncidentOverflow } from "@/lib/incident-age";

/**
 * "Open problems" on Live → Control: what is wrong and what to press, in that order (M90).
 *
 * A stale or missing worker or playout heartbeat comes first. Neither process can report its own
 * death, so those entries are computed from the heartbeats (`getHeartbeatProblems`) rather than read
 * from the incident table, and nothing below them is true while they hold. Every entry ends with the
 * action from the catalogue in @stream247/core when it has one.
 */
export function OpenProblemsPanel(props: {
  heartbeatProblems: LiveHeartbeatProblem[];
  openIncidents: LiveIncidentSummary[];
  openIncidentCount: number;
  /** The snapshot's own time, so server render and hydration agree on every age. */
  nowMs: number;
}) {
  return (
    <article className="panel open-problems" data-testid="open-problems">
      <span className="label">Incidents</span>
      <h3>Open problems</h3>
      <div className="list">
        {props.heartbeatProblems.map((problem) => (
          <div className="item" key={problem.id}>
            <strong>CRITICAL · {problem.service} · {problem.title}</strong>
            <div className="subtle">{describeHeartbeatAge(problem.lastAt, props.nowMs)}</div>
            <div className="subtle">{problem.message}</div>
            <div className="subtle">What to do: {problem.action}</div>
          </div>
        ))}
        {props.openIncidents.length > 0 ? (
          props.openIncidents.map((incident) => (
            <div className="item" key={incident.id}>
              <strong>
                {incident.severity.toUpperCase()} · {incident.scope} · {incident.title}
              </strong>
              <div className="subtle">
                {describeIncidentAge({
                  createdAt: incident.createdAt,
                  updatedAt: incident.updatedAt,
                  nowMs: props.nowMs
                })}
              </div>
              <div className="subtle">{incident.message}</div>
              {incident.action ? <div className="subtle">What to do: {incident.action}</div> : null}
            </div>
          ))
        ) : props.heartbeatProblems.length === 0 ? (
          <div className="item">
            <strong>No open incidents</strong>
            <div className="subtle">The live system currently reports no unresolved incidents.</div>
          </div>
        ) : null}
        {describeOpenIncidentOverflow(props.openIncidents.length, props.openIncidentCount) ? (
          <div className="item">
            <div className="subtle">
              {describeOpenIncidentOverflow(props.openIncidents.length, props.openIncidentCount)}
            </div>
          </div>
        ) : null}
      </div>
    </article>
  );
}
