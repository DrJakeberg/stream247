export const dynamic = "force-dynamic";

import { selectActiveDestinationGroup } from "@stream247/core";
import { AdminPageHeader } from "@/components/admin-page-header";
import { GoLiveChecklist } from "@/components/go-live-checklist";
import { DestinationCreateForm } from "@/components/destination-create-form";
import { DestinationSettingsForm } from "@/components/destination-settings-form";
import { IncidentActionForm } from "@/components/incident-action-form";
import { Panel } from "@/components/panel";
import { PlayoutActionForm } from "@/components/playout-action-form";
import { TwitchConnectPanel } from "@/components/twitch-connect-panel";
import { getGoLiveChecklist } from "@/lib/server/onboarding";
import {
  getActivePresenceWindows,
  getCurrentScheduleItem,
  getNextScheduleItem,
  getPlayoutQueueAssets,
  getPresenceStatus,
  getSchedulePreview,
  readAppState
} from "@/lib/server/state";
import { getTwitchAuthorizeUrl } from "@/lib/server/twitch";

export default async function DashboardPage() {
  const state = await readAppState();
  const twitchAuthorizeUrl = await getTwitchAuthorizeUrl("broadcaster-connect");
  const checklist = getGoLiveChecklist(state);
  const schedulePreview = getSchedulePreview(state);
  const presenceStatus = getPresenceStatus(state);
  const activeWindows = getActivePresenceWindows(state);
  const openIncidents = state.incidents.filter((incident) => incident.status === "open");
  const recentIncidents = [...state.incidents]
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, 8);
  const activeDestination = state.destinations.find((entry) => entry.id === state.playout.currentDestinationId) ?? state.destinations[0];
  const orderedDestinations = [...state.destinations].sort((left, right) => left.priority - right.priority || left.name.localeCompare(right.name));
  const activeDestinationIds = new Set(
    selectActiveDestinationGroup(
      orderedDestinations.map((destination) => ({
        id: destination.id,
        name: destination.name,
        role: destination.role,
        priority: destination.priority,
        enabled: destination.enabled,
        streamKeyPresent: destination.streamKeyPresent,
        status: destination.status
      }))
    ).activeDestinationIds
  );
  const currentAsset = state.assets.find((entry) => entry.id === state.playout.currentAssetId) ?? null;
  const queuedAssets = getPlayoutQueueAssets(state);
  const overrideAsset = state.assets.find((entry) => entry.id === state.playout.overrideAssetId) ?? null;
  const currentScheduleItem = getCurrentScheduleItem(state);
  const nextScheduleItem = getNextScheduleItem(state);
  type ScheduleItem = (typeof schedulePreview.items)[number];

  return (
    <>
      <AdminPageHeader
        description="Use Dashboard to decide whether the workspace is ready for sustained on-air operation. Broadcast remains the live action surface."
        eyebrow="Dashboard"
        title="Check readiness, integrations, and current channel posture."
      />

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
          {state.twitch.lastMetadataSyncAt ? (
            <p className="subtle">
              Last metadata sync: {state.twitch.lastSyncedTitle || "no title"} ·{" "}
              {state.twitch.lastSyncedCategoryName || "no category"}
            </p>
          ) : null}
          {state.twitch.lastScheduleSyncAt ? (
            <p className="subtle">Last schedule sync: {state.twitch.lastScheduleSyncAt}</p>
          ) : null}
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
          <p className="subtle">
            Control mode: {state.playout.overrideMode}
            {overrideAsset ? ` · ${overrideAsset.title}` : ""}
            {state.playout.liveBridgeStatus ? ` · Live Bridge ${state.playout.liveBridgeStatus}` : ""}
          </p>
        </article>
        <article className="metric">
          <span className="label">Destination</span>
          <div className="value">
            {activeDestinationIds.size > 0 ? `${activeDestinationIds.size} active` : activeDestination?.status ?? "missing"}
          </div>
          <p className="subtle">
            {activeDestination
              ? `${activeDestination.name} lead · ${activeDestination.role} · ${activeDestination.streamKeyPresent ? "stream key present" : "stream key missing"}`
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
        <Panel title="Go-live readiness" eyebrow="Launch">
          <p className="subtle">
            This checklist is the fastest way to understand whether the channel is configured well enough for reliable
            24/7 operation.
          </p>
          <GoLiveChecklist items={checklist} />
        </Panel>
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
        <Panel title="Output destinations" eyebrow="Delivery">
          <p className="subtle">
            Stream247 can now fan one channel out to multiple active outputs. Healthy primary outputs are preferred
            together; backup outputs take over only when no primary output group is available.
          </p>
          <div className="item" style={{ marginBottom: 16 }}>
            <DestinationCreateForm />
          </div>
          <div className="list">
            {orderedDestinations.map((destination) => (
              <div className="item" key={destination.id}>
                <strong>{destination.name}</strong>
                <div className="subtle">
                  {destination.role} · priority {destination.priority} · {destination.status}
                  {activeDestinationIds.has(destination.id) ? " · active" : ""}
                </div>
                <div className="subtle">
                  {destination.rtmpUrl || "No RTMP URL configured"} · {destination.streamKeyPresent ? "stream key present" : "stream key missing"} · key source{" "}
                  {destination.streamKeySource || "missing"}
                </div>
                {destination.lastFailureAt ? (
                  <div className="subtle">
                    Last failure {destination.lastFailureAt} · count {destination.failureCount} · {destination.lastError || "No error sample captured."}
                  </div>
                ) : null}
                <div style={{ marginTop: 12 }}>
                  <DestinationSettingsForm destination={destination} />
                </div>
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="Alerts and drift" eyebrow="Runtime">
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
                Transition {state.playout.transitionState} · next probe {state.playout.prefetchStatus || "idle"} · next{" "}
                {state.playout.prefetchedTitle || state.playout.nextTitle || "none"}
              </div>
              <div className="subtle">
                Last stderr: {state.playout.lastStderrSample || "No FFmpeg stderr captured yet."}
              </div>
              <div className="subtle">
                Current schedule: {currentScheduleItem ? currentScheduleItem.title : "none"} · Next:{" "}
                {nextScheduleItem ? nextScheduleItem.title : "none"}
              </div>
              <div className="subtle">
                Queue: {queuedAssets.length > 0 ? queuedAssets.slice(0, 3).map((asset) => asset.title).join(" → ") : "no queued assets"}
              </div>
              <PlayoutActionForm
                assets={state.assets.filter((asset) => asset.status === "ready").map((asset) => ({ id: asset.id, title: asset.title }))}
                currentAssetId={currentAsset?.id}
                overrideMode={state.playout.overrideMode}
                liveBridgeStatus={(state.playout.liveBridgeStatus || "idle") as "idle" | "pending" | "active" | "releasing" | "error"}
                liveBridgeLabel={state.playout.liveBridgeLabel}
                liveBridgeInputType={state.playout.liveBridgeInputType}
                liveBridgeInputSummary={state.playout.liveBridgeInputUrl ? "Configured live input" : ""}
                liveBridgeLastError={state.playout.liveBridgeLastError}
              />
            </div>
            {openIncidents.length > 0 ? (
              openIncidents.slice(0, 4).map((incident) => (
                <div className="item" key={incident.id}>
                  <strong>
                    {incident.severity.toUpperCase()} · {incident.title}
                  </strong>
                  <div className="subtle">{incident.message}</div>
                  <div className="subtle">
                    {incident.acknowledgedAt
                      ? `Acknowledged by ${incident.acknowledgedBy || "unknown"} at ${incident.acknowledgedAt}`
                      : "Not acknowledged yet."}
                  </div>
                  <IncidentActionForm
                    acknowledgedAt={incident.acknowledgedAt}
                    fingerprint={incident.fingerprint}
                    status={incident.status}
                  />
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
                  : "RTMP destination is missing. Configure primary or backup output env vars first."}
              </div>
            </div>
            <div className="item">
              <strong>Twitch metadata sync</strong>
              <div className="subtle">
                {state.twitch.lastMetadataSyncAt
                  ? `${state.twitch.lastSyncedTitle || "no title"} · ${state.twitch.lastSyncedCategoryName || "no category"}`
                  : "No Twitch metadata sync has completed yet."}
              </div>
              <div className="subtle">
                {state.twitch.lastMetadataSyncAt
                  ? `Last synced at ${state.twitch.lastMetadataSyncAt}`
                  : "Connect Twitch and let the worker complete a reconciliation cycle."}
              </div>
            </div>
            <div className="item">
              <strong>Twitch schedule sync</strong>
              <div className="subtle">
                {state.twitch.lastScheduleSyncAt
                  ? `${state.twitchScheduleSegments.length} segment(s) managed by Stream247`
                  : "No Twitch schedule sync has completed yet."}
              </div>
              <div className="subtle">
                {state.twitch.lastScheduleSyncAt
                  ? `Last synced at ${state.twitch.lastScheduleSyncAt}`
                  : "Future schedule blocks will be mirrored to Twitch after the worker syncs them."}
              </div>
            </div>
            <div className="item">
              <strong>Overlay output</strong>
              <div className="subtle">
                {state.overlay.enabled
                  ? `${state.overlay.channelName} · ${state.overlay.headline}`
                  : "Overlay is currently disabled."}
              </div>
              <div className="subtle">
                Stream247 captures <code>{`${process.env.APP_URL || "http://localhost:3000"}/overlay`}</code> as the
                internal overlay output.
              </div>
            </div>
            <TwitchConnectPanel authorizeUrl={twitchAuthorizeUrl} />
          </div>
        </Panel>
      </section>

      <section style={{ marginTop: 24 }}>
        <Panel title="Incident history" eyebrow="Incidents">
          <div className="list">
            {recentIncidents.length > 0 ? (
              recentIncidents.map((incident) => (
                <div className="item" key={incident.id}>
                  <strong>
                    {incident.severity.toUpperCase()} · {incident.scope} · {incident.title}
                  </strong>
                  <div className="subtle">{incident.message}</div>
                  <div className="subtle">
                    Status {incident.status} · created {incident.createdAt} · updated {incident.updatedAt}
                  </div>
                  <div className="subtle">
                    {incident.acknowledgedAt
                      ? `Acknowledged by ${incident.acknowledgedBy || "unknown"} at ${incident.acknowledgedAt}`
                      : "Not acknowledged."}
                  </div>
                  {incident.resolvedAt ? <div className="subtle">Resolved at {incident.resolvedAt}</div> : null}
                  <IncidentActionForm
                    acknowledgedAt={incident.acknowledgedAt}
                    fingerprint={incident.fingerprint}
                    status={incident.status}
                  />
                </div>
              ))
            ) : (
              <div className="item">
                <strong>No incidents recorded</strong>
                <div className="subtle">Incident history will appear here once the worker or playout runtime emits one.</div>
              </div>
            )}
          </div>
        </Panel>
      </section>
    </>
  );
}
