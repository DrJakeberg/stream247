import { Panel } from "@/components/panel";
import { moderationState, schedulePreview } from "@/lib/mock-data";

export default function DashboardPage() {
  return (
    <>
      <section className="hero">
        <span className="badge">Twitch-first v1 scaffold</span>
        <h2>Operate a 24/7 channel without dead air.</h2>
        <p>
          Sources, schedules, moderation rules, alerts, and Twitch metadata all
          converge in one operational surface.
        </p>
      </section>

      <section className="grid metrics">
        <article className="metric">
          <span className="label">Current state</span>
          <div className="value">Streaming</div>
          <p className="subtle">Fallback-safe queue generated for 24 hours.</p>
        </article>
        <article className="metric">
          <span className="label">Next switch</span>
          <div className="value">18:00</div>
          <p className="subtle">Prime Time YouTube Playlist</p>
        </article>
        <article className="metric">
          <span className="label">Moderator window</span>
          <div className="value">
            {moderationState.status.chatMode === "normal" ? "Active" : "Expired"}
          </div>
          <p className="subtle">{moderationState.status.summary}</p>
        </article>
      </section>

      <section className="grid two" style={{ marginTop: 24 }}>
        <Panel title="Upcoming schedule" eyebrow="Schedule">
          <div className="list">
            {schedulePreview.items.map((item) => (
              <div className="item" key={item.id}>
                <strong>{item.title}</strong>
                <div className="subtle">
                  {item.startTime} to {item.endTime} · {item.categoryName}
                </div>
                <div className="subtle">{item.reason}</div>
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="Alerts and drift" eyebrow="Ops">
          <div className="list">
            <div className="item">
              <strong>Queue coverage healthy</strong>
              <div className="subtle">
                Fallback slate available if a source sync fails.
              </div>
            </div>
            <div className="item">
              <strong>Moderator policy enabled</strong>
              <div className="subtle">
                Default command <code>here 30</code>, fallback emote-only when
                no active presence window exists.
              </div>
            </div>
          </div>
        </Panel>
      </section>
    </>
  );
}

