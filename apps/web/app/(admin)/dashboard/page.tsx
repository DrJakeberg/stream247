export const dynamic = "force-dynamic";

import Link from "next/link";
import {
  TWITCH_METADATA_WAITING_MESSAGE,
  describeIncidentOperatorAction,
  resolveTwitchMetadataSyncGate,
  selectActiveDestinationGroup
} from "@stream247/core";
import { AdminPageHeader } from "@/components/admin-page-header";
import { AsRunLogPanel } from "@/components/as-run-log-panel";
import { GoLiveChecklist } from "@/components/go-live-checklist";
import { IncidentActionForm } from "@/components/incident-action-form";
import { LegacyAnchorRedirect } from "@/components/legacy-anchor-redirect";
import { Panel } from "@/components/panel";
import { TwitchConnectPanel } from "@/components/twitch-connect-panel";
import { describeTwitchConnection } from "@/components/twitch-connection-status";
import { getGoLiveChecklist } from "@/lib/server/onboarding";
import { DESTINATION_ROLE_LABELS, DESTINATION_STATUS_LABELS, describeStreamKey } from "@/lib/destination-wording";
import {
  describeRuntimeReadinessSentence,
  getActivePresenceWindows,
  getHeartbeatProblems,
  getCurrentScheduleItem,
  getManagedTwitchConfig,
  getNextScheduleItem,
  getOpenIncidentPanel,
  getPlayoutQueueAssets,
  getPresenceStatus,
  getSchedulePreview,
  getWorkspaceTimeZone,
  readAppState,
  readRecentAsRunLog
} from "@/lib/server/state";
import { isTwitchAuthorizeConfigured } from "@/lib/server/twitch";
import { buildWorkspaceHref } from "@/lib/workspace-navigation";

export default async function DashboardPage() {
  const state = await readAppState();
  const twitchAuthorizeUrl = (await isTwitchAuthorizeConfigured()) ? "/api/integrations/twitch/connect" : null;
  const metadataSyncGate = resolveTwitchMetadataSyncGate({
    configuredLogin: getManagedTwitchConfig(state).broadcastChannelLogin,
    identityLogin: state.twitch.broadcasterLogin,
    broadcasterConnection: state.twitchBroadcaster
  });
  const twitchConnection = describeTwitchConnection(state.twitch);
  const checklist = getGoLiveChecklist(state);
  const schedulePreview = getSchedulePreview(state);
  const presenceStatus = getPresenceStatus(state);
  const activeWindows = getActivePresenceWindows(state);
  const incidentPanel = getOpenIncidentPanel(state);
  // The as-run log (M76): the last 24 hours; a failed read comes back as null records, not as an error.
  const asRunLog = await readRecentAsRunLog();
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
        description="Use Live status to decide whether the workspace is ready for sustained on-air operation. Live control remains the action surface."
        eyebrow="Readiness"
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
          <div className="value">{twitchConnection.label}</div>
          <p className="subtle">{twitchConnection.detail}</p>
          {twitchConnection.consequence ? <p className="subtle">{twitchConnection.consequence}</p> : null}
          {/* The stored message stays available underneath. It is the only place the upstream
              wording survives on this surface, and dropping it would trade one kind of blindness
              for another — but it is no longer the first thing anyone reads. */}
          {state.twitch.status !== "connected" && state.twitch.error ? (
            <p className="subtle">Reported by Twitch: {state.twitch.error}</p>
          ) : null}
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
          <span className="label">Moderation presence</span>
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
          <div className="value">{incidentPanel.openCount}</div>
          <p className="subtle">
            {incidentPanel.listed[0] ? incidentPanel.listed[0].title : "No open incidents at the moment."}
          </p>
        </article>
        <article className="metric">
          <span className="label">Team access</span>
          <div className="value">{state.teamAccessGrants.length}</div>
          <p className="subtle">{state.users.length} authenticated user record(s) in the workspace.</p>
        </article>
      </section>

      <section className="grid two" style={{ marginTop: 24 }}>
        <Panel title="Readiness" eyebrow="Launch">
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
        {/*
          The forms moved to Studio → Output (M99, U1): this tab called itself read-only while it held the
          stream-key form. What each destination is and how it is doing stays here, one line each.
        */}
        <Panel title="Output destinations" eyebrow="Delivery">
          <div className="list">
            {orderedDestinations.map((destination) => (
              <div className="item" key={destination.id}>
                <strong>{destination.name}</strong>
                <div className="subtle">
                  {DESTINATION_ROLE_LABELS[destination.role]} · priority {destination.priority} ·{" "}
                  {DESTINATION_STATUS_LABELS[destination.status]}
                  {activeDestinationIds.has(destination.id) ? " · in use" : ""} ·{" "}
                  {describeStreamKey(destination.streamKeyPresent, destination.streamKeySource)}
                </div>
                {destination.lastFailureAt ? (
                  <div className="subtle">
                    Last failure {destination.lastFailureAt} · count {destination.failureCount} · {destination.lastError || "No error sample captured."}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
          <p className="subtle" style={{ marginTop: 12 }}>
            <Link href={`${buildWorkspaceHref("studio", "output")}#output-destinations`}>
              Add or change destinations and stream keys in Studio → Output
            </Link>
          </p>
          <LegacyAnchorRedirect
            anchors={["output-destinations"]}
            target={`${buildWorkspaceHref("studio", "output")}#output-destinations`}
          />
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
              <div className="subtle" style={{ marginTop: 12 }}>
                Use Live control for skip, fallback, restart, override, replay, and Live Bridge actions. This status view stays read-only.
              </div>
            </div>
            {incidentPanel.listed.length > 0 ? (
              incidentPanel.listed.map((incident) => (
                <div className="item" key={incident.id}>
                  <strong>
                    {incident.severity.toUpperCase()} · {incident.title}
                  </strong>
                  <div className="subtle">{incident.ageLabel}</div>
                  <div className="subtle">{incident.message}</div>
                  {describeIncidentOperatorAction(incident.fingerprint) ? (
                    <div className="subtle">What to do: {describeIncidentOperatorAction(incident.fingerprint)}</div>
                  ) : null}
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
            ) : null}
            {incidentPanel.listed.length === 0 || getHeartbeatProblems(state).length > 0 ? (
              <div className="item">
                <strong>System readiness</strong>
                {/* Built from the heartbeats, not fixed text: it claimed both were active before either ran (M90, U8). */}
                <div className="subtle">{describeRuntimeReadinessSentence(state, incidentPanel.openCount)}</div>
              </div>
            ) : null}
            {incidentPanel.overflow ? (
              <div className="item">
                <div className="subtle">{incidentPanel.overflow}</div>
              </div>
            ) : null}
            <div className="item">
              <strong>Active moderation presence</strong>
              <div className="subtle">
                {activeWindows.length > 0
                  ? `${activeWindows.length} active check-in window(s).`
                  : "No moderation presence is active."}
              </div>
            </div>
            <div className="item">
              <strong>Live destination</strong>
              <div className="subtle">
                {activeDestination
                  ? `${activeDestination.status} · ${activeDestination.notes}`
                  : "RTMP destination is missing. Configure primary or backup output env vars first."}
              </div>
            </div>
            <div className="item">
              <strong>Twitch metadata sync</strong>
              {metadataSyncGate.mode === "waiting-for-broadcaster" ? (
                <div className="subtle">
                  {TWITCH_METADATA_WAITING_MESSAGE} Title and category for {metadataSyncGate.broadcastChannelLogin} sync
                  once the broadcaster account is connected.
                </div>
              ) : null}
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
              <div className="subtle">The picture is drawn by the playout; the studio preview is the same drawing.</div>
            </div>
            <TwitchConnectPanel
              authorizeUrl={twitchAuthorizeUrl}
              broadcastChannel={
                metadataSyncGate.mode === "identity"
                  ? { mode: "identity", broadcastChannelLogin: "" }
                  : { mode: metadataSyncGate.mode, broadcastChannelLogin: metadataSyncGate.broadcastChannelLogin }
              }
            />
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

      <section style={{ marginTop: 24 }}>
        <AsRunLogPanel
          blocks={state.scheduleBlocks}
          limit={asRunLog.limit}
          nowMs={asRunLog.nowMs}
          pools={state.pools}
          records={asRunLog.records}
          sources={state.sources}
          timeZone={getWorkspaceTimeZone(state)}
        />
      </section>
    </>
  );
}
