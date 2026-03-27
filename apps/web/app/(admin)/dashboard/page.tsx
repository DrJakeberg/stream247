export const dynamic = "force-dynamic";

import { Panel } from "@/components/panel";
import { TwitchConnectPanel } from "@/components/twitch-connect-panel";
import { getActivePresenceWindows, getPresenceStatus, getSchedulePreview, readAppState } from "@/lib/server/state";
import { getTwitchAuthorizeUrl } from "@/lib/server/twitch";

export default async function DashboardPage() {
  const state = await readAppState();
  const schedulePreview = getSchedulePreview(state);
  const presenceStatus = getPresenceStatus(state);
  const activeWindows = getActivePresenceWindows(state);
  const openIncidents = state.incidents.filter((incident) => incident.status === "open");
  const activeDestination = state.destinations.find((entry) => entry.id === state.playout.currentDestinationId) ?? state.destinations[0];
  const currentAsset = state.assets.find((entry) => entry.id === state.playout.currentAssetId) ?? null;
  type ScheduleItem = (typeof schedulePreview.items)[number];

  return (
    <>
      <section className="hero">
        <span className="badge">Installable alpha</span>
        <h2>Operate a 24/7 channel from a real initialized workspace.</h2>
        <p>
          The admin UI now reads persisted state, tracks initialization, and keeps moderation and Twitch readiness
          visible.
        </p>
      </section>

      <section className="grid metrics">
        <article className="metric">
          <span className="label">Workspace</span>
          <div className="value">{state.initialized ? "Ready" : "Setup"}</div>
          <p className="subtle">{state.owner ? `Owner: ${state.owner.email}` : "Owner account missing."}</p>
        </article>
        <article className="metric">
          <span className="label">Twitch</span>
          <div className="value">{state.twitch.status}</div>
          <p className="subtle">
            {state.twitch.status === "connected"
              ? `Broadcaster ${state.twitch.broadcasterLogin || state.twitch.broadcasterId}`
              : state.twitch.error || "OAuth connection not completed yet."}
          </p>
        </article>
        <article className="metric">
          <span className="label">Moderator window</span>
          <div className="value">{presenceStatus.chatMode === "normal" ? "Active" : "Fallback"}</div>
          <p className="subtle">{presenceStatus.summary}</p>
        </article>
        <article className="metric">
          <span className="label">Playout runtime</span>
          <div className="value">{state.playout.status}</div>
          <p className="subtle">{state.playout.message}</p>
        </article>
        <article className="metric">
          <span className="label">Destination</span>
          <div className="value">{activeDestination?.status ?? "missing"}</div>
          <p className="subtle">
            {activeDestination
              ? `${activeDestination.name} · ${activeDestination.streamKeyPresent ? "stream key present" : "stream key missing"}`
              : "No playout destination is configured."}
          </p>
        </article>
        <article className="metric">
          <span className="label">Assets</span>
          <div className="value">{state.assets.length}</div>
          <p className="subtle">Local ingestion and future connectors feed the asset catalog.</p>
        </article>
        <article className="metric">
          <span className="label">Incidents</span>
          <div className="value">{openIncidents.length}</div>
          <p className="subtle">
            {openIncidents.length > 0 ? `${openIncidents[0].title}` : "No open incidents at the moment."}
          </p>
        </article>
        <article className="metric">
          <span className="label">Team access</span>
          <div className="value">{state.teamAccessGrants.length}</div>
          <p className="subtle">{state.users.length} authenticated user record(s) in the workspace.</p>
        </article>
      </section>

      <section className="grid two" style={{ marginTop: 24 }}>
        <Panel title="Upcoming schedule" eyebrow="Schedule">
          <div className="list">
            {schedulePreview.items.map((item: ScheduleItem) => (
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
              <strong>Encoder runtime</strong>
              <div className="subtle">
                {activeDestination ? `${activeDestination.name} · ${activeDestination.rtmpUrl}` : "No destination selected."}
              </div>
              <div className="subtle">
                PID {state.playout.processPid || "not running"} · restart count {state.playout.restartCount} · asset{" "}
                {currentAsset?.title ?? state.playout.currentTitle ?? "none"}
              </div>
              <div className="subtle">
                Last stderr: {state.playout.lastStderrSample || "No FFmpeg stderr captured yet."}
              </div>
            </div>
            {openIncidents.length > 0 ? (
              openIncidents.slice(0, 4).map((incident) => (
                <div className="item" key={incident.id}>
                  <strong>
                    {incident.severity.toUpperCase()} · {incident.title}
                  </strong>
                  <div className="subtle">{incident.message}</div>
                </div>
              ))
            ) : (
              <div className="item">
                <strong>System readiness</strong>
                <div className="subtle">
                  Database persistence, background worker reconciliation, and playout heartbeat are now active.
                </div>
              </div>
            )}
            <div className="item">
              <strong>Active moderator windows</strong>
              <div className="subtle">
                {activeWindows.length > 0
                  ? `${activeWindows.length} active check-in window(s).`
                  : "No moderator presence windows are active."}
              </div>
            </div>
            <div className="item">
              <strong>Broadcast destination</strong>
              <div className="subtle">
                {activeDestination
                  ? `${activeDestination.status} · ${activeDestination.notes}`
                  : "RTMP destination is missing. Set STREAM_OUTPUT_URL/KEY or TWITCH_RTMP_URL/TWITCH_STREAM_KEY."}
              </div>
            </div>
            <TwitchConnectPanel authorizeUrl={getTwitchAuthorizeUrl("broadcaster-connect")} />
          </div>
        </Panel>
      </section>
    </>
  );
}
