"use client";

import Link from "next/link";
import { AdminPageHeader } from "@/components/admin-page-header";
import { getBroadcastLiveStatusLabel, getBroadcastLiveStatusTone } from "@/components/broadcast-live-status";
import { buildWorkspaceHref } from "@/lib/workspace-navigation";
import type { BroadcastSnapshot } from "@/lib/live-broadcast";
import { PlayoutActionForm } from "@/components/playout-action-form";
import { StatusChip } from "@/components/ui/StatusChip";
import { useLiveSnapshot } from "@/components/use-live-snapshot";
import { getChannelStatusLabel } from "@/lib/channel-status";
import {
  DESTINATION_RECOVERY_LABELS,
  DESTINATION_ROLE_LABELS,
  DESTINATION_STATUS_LABELS,
  describeStreamKey
} from "@/lib/destination-wording";
import { describeIncidentAge, describeOpenIncidentOverflow } from "@/lib/incident-age";
import { describePlayoutReason } from "@/lib/playout-reason";
import { describeScenePreset } from "@/lib/scene-preset-names";

type AssetOption = {
  id: string;
  title: string;
};

export function BroadcastControlRoom(props: { initialSnapshot: BroadcastSnapshot; assets: AssetOption[] }) {
  const { snapshot, connected } = useLiveSnapshot({
    initialSnapshot: props.initialSnapshot,
    stateUrl: "/api/broadcast/state",
    streamUrl: "/api/broadcast/stream"
  });
  const currentQueueItem = snapshot.queueItems[0] ?? null;
  const nextQueueItem = snapshot.queueItems[1] ?? null;
  const activeDestinationCount = snapshot.destinations.filter((destination) => destination.active).length;
  const stagedDestinationCount = snapshot.destinations.filter((destination) => destination.recoveryState === "staged").length;
  const coolingDestinationCount = snapshot.destinations.filter((destination) => destination.recoveryState === "cooldown").length;
  // Ages are measured against the snapshot's own timestamp rather than the browser clock, so the
  // server render and the hydrated render agree, every age on the panel shares one "now", and the
  // render stays pure. An unusable timestamp produces no age line rather than a wrong one.
  const incidentNowMs = new Date(snapshot.generatedAt).getTime();

  return (
    <div className="stack-form">
      <AdminPageHeader
        compact
        description="Use Live control for on-air actions. Current item, next queue, destination health, and scene state update continuously without reloading the page."
        eyebrow="Live"
        title="Operate the live 24/7 output from one workspace."
      >
        <div className="stats-row">
          <StatusChip status={getBroadcastLiveStatusTone(snapshot.twitch)} label={getBroadcastLiveStatusLabel(snapshot.twitch)} />
          {snapshot.presence.active ? (
            <Link
              className="subtle-link"
              href={buildWorkspaceHref("live", "moderation")}
              title={
                snapshot.presence.actor
                  ? `${snapshot.presence.actor} active for ${snapshot.presence.remainingMinutes} more minute(s)`
                  : "Moderation presence active"
              }
            >
              <StatusChip status="ok" label={`Here ${snapshot.presence.remainingMinutes}m`} />
            </Link>
          ) : null}
        </div>
        <div className="status-rail">
          <div>
            <span className="label">Feed</span>
            {/* The same words the public page uses, rather than the value the runtime stores. */}
            <strong>{getChannelStatusLabel(snapshot.playout.status)}</strong>
          </div>
          <div>
            <span className="label">Current</span>
            <strong>{currentQueueItem?.title || snapshot.currentAsset?.title || snapshot.playout.currentTitle || "Standby"}</strong>
          </div>
          <div>
            <span className="label">Next</span>
            <strong>{nextQueueItem?.title || snapshot.nextAsset?.title || snapshot.nextScheduleItem?.title || "Pending"}</strong>
          </div>
          <div>
            <span className="label">Destination</span>
            <strong>
              {activeDestinationCount > 0
                ? `${activeDestinationCount} in use`
                : snapshot.destination
                  ? DESTINATION_STATUS_LABELS[snapshot.destination.status]
                  : "None set up"}
            </strong>
          </div>
          <div>
            <span className="label">Updates</span>
            <strong>{connected ? "Live" : "Polling"}</strong>
          </div>
        </div>
      </AdminPageHeader>

      <section className="grid two">
        <article className="panel">
          <span className="label">On Air</span>
          <h3>Current and next</h3>
          <div className="list">
            <div className="item">
              <strong>{currentQueueItem?.title || snapshot.currentAsset?.title || snapshot.playout.currentTitle || "Standby slate"}</strong>
              <div className="subtle">
                {snapshot.currentScheduleItem
                  ? `${snapshot.currentScheduleItem.startTime} to ${snapshot.currentScheduleItem.endTime} · ${snapshot.currentScheduleItem.categoryName}`
                  : currentQueueItem?.subtitle || snapshot.playout.message}
              </div>
              <div className="subtle">
                Transition {snapshot.playout.transitionState} · queue reason {describePlayoutReason(snapshot.playout.selectionReasonCode) || "none"} · version{" "}
                {snapshot.playout.queueVersion}
              </div>
            </div>
            <div className="item">
              <strong>{nextQueueItem?.title || snapshot.nextAsset?.title || snapshot.nextScheduleItem?.title || "No next item yet"}</strong>
              <div className="subtle">
                Prefetch {snapshot.playout.prefetchStatus || "idle"} · last probe {snapshot.playout.prefetchedAt || "never"}
              </div>
              <div className="subtle">
                Transition target {snapshot.playout.transitionTargetKind || "none"} · ready {snapshot.playout.transitionReadyAt || "not ready"}
              </div>
              {snapshot.playout.manualNextAssetId ? (
                <div className="subtle">Manual next request is active for asset {snapshot.playout.manualNextAssetId}.</div>
              ) : null}
              {nextQueueItem?.subtitle ? <div className="subtle">{nextQueueItem.subtitle}</div> : null}
              {snapshot.playout.prefetchError ? <div className="danger">{snapshot.playout.prefetchError}</div> : null}
            </div>
            <div className="item">
              <strong>Queue preview</strong>
              <div className="subtle">
                {snapshot.queueItems.length > 0
                  ? snapshot.queueItems
                      .slice(0, 6)
                      .map(
                        (item) =>
                          `${item.kind === "asset" ? "Asset" : item.kind === "insert" ? "Insert" : item.kind === "reconnect" ? "Reconnect" : item.kind === "live" ? "Live" : "Standby"}: ${item.title}`
                      )
                      .join(" → ")
                  : "No queue preview is currently available."}
              </div>
            </div>
          </div>
        </article>

        <article className="panel">
          <span className="label">Actions</span>
          <h3>Operator controls</h3>
          {/* The recovery guidance that used to live here is now the order of the buttons themselves. */}
          <PlayoutActionForm
            assets={props.assets}
            currentAssetId={snapshot.currentAsset?.id}
            previousAssetId={snapshot.playout.previousAssetId}
            previousAssetTitle={snapshot.playout.previousTitle}
            nextAssetId={nextQueueItem?.asset?.id || snapshot.nextAsset?.id}
            nextAssetTitle={nextQueueItem?.title || snapshot.nextAsset?.title}
            overrideMode={(snapshot.playout.overrideMode as "schedule" | "asset" | "fallback") || "schedule"}
            liveBridgeStatus={snapshot.liveBridge.status}
            liveBridgeLabel={snapshot.liveBridge.label}
            liveBridgeInputType={snapshot.liveBridge.inputType}
            liveBridgeInputSummary={snapshot.liveBridge.inputSummary}
            liveBridgeLastError={snapshot.liveBridge.lastError}
            recoveringDestinationCount={stagedDestinationCount}
            coolingDestinationCount={coolingDestinationCount}
          />
        </article>

        <article className="panel">
          <span className="label">Replacement audio</span>
          <h3>Secondary audio</h3>
          <div className="list">
            <div className="item">
              <strong>{snapshot.audioLane.title || "Program audio"}</strong>
              <div className="subtle">
                {snapshot.audioLane.configured
                  ? `${snapshot.audioLane.mode} mode · ${snapshot.audioLane.volumePercent}% · ${snapshot.audioLane.active ? "active" : "armed for scheduled playback"}`
                  : "No audio lane is configured for the active pool."}
              </div>
              {snapshot.audioLane.poolName ? <div className="subtle">Pool {snapshot.audioLane.poolName}</div> : null}
              {snapshot.audioLane.sourceName ? <div className="subtle">Source {snapshot.audioLane.sourceName}</div> : null}
            </div>
          </div>
        </article>

        <article className="panel">
          <span className="label">Timed inserts</span>
          <h3>Timed insert</h3>
          <div className="list">
            <div className="item">
              <strong>{snapshot.cuepoints.assetTitle || "No cuepoint insert asset"}</strong>
              <div className="subtle">
                {snapshot.cuepoints.configured
                  ? `Safe-boundary mode · ${snapshot.cuepoints.firedCount}/${snapshot.cuepoints.totalCount} fired`
                  : "Nothing is set to play at a fixed time in this block."}
              </div>
              {snapshot.cuepoints.offsetsSeconds.length > 0 ? (
                <div className="subtle">Offsets {snapshot.cuepoints.offsetsSeconds.map((offset) => `${offset}s`).join(" · ")}</div>
              ) : null}
              {snapshot.cuepoints.nextOffsetSeconds !== null ? (
                <div className="subtle">Next one {snapshot.cuepoints.nextOffsetSeconds}s into the block</div>
              ) : null}
              {snapshot.cuepoints.dueOffsetSeconds !== null ? (
                <div className="subtle">The insert due at {snapshot.cuepoints.dueOffsetSeconds}s is waiting for a safe point to start.</div>
              ) : null}
              {snapshot.cuepoints.lastTriggeredAt ? (
                <div className="subtle">
                  Last fired {snapshot.cuepoints.lastTriggeredAt}
                  {snapshot.cuepoints.lastAssetId ? ` · asset ${snapshot.cuepoints.lastAssetId}` : ""}
                </div>
              ) : null}
            </div>
          </div>
        </article>

        <article className="panel">
          <span className="label">Live Bridge</span>
          <h3>Live takeover</h3>
          <div className="list">
            <div className="item">
              <strong>{snapshot.liveBridge.label || "Live Bridge"}</strong>
              <div className="subtle">
                Status {snapshot.liveBridge.status} · {snapshot.liveBridge.inputType ? snapshot.liveBridge.inputType.toUpperCase() : "no input type"}
              </div>
              <div className="subtle">{snapshot.liveBridge.configured ? snapshot.liveBridge.inputSummary : "No live input configured."}</div>
              {snapshot.liveBridge.requestedAt ? <div className="subtle">Requested {snapshot.liveBridge.requestedAt}</div> : null}
              {snapshot.liveBridge.startedAt ? <div className="subtle">Live since {snapshot.liveBridge.startedAt}</div> : null}
              {snapshot.liveBridge.releasedAt ? <div className="subtle">Release requested {snapshot.liveBridge.releasedAt}</div> : null}
              {snapshot.liveBridge.lastError ? <div className="danger">{snapshot.liveBridge.lastError}</div> : null}
            </div>
          </div>
        </article>

        <article className="panel">
          <span className="label">Destination</span>
          <h3>Sending to Twitch</h3>
          <div className="list">
            <div className="item">
              <strong>{snapshot.destination?.name || "No destination configured"}</strong>
              <div className="subtle">
                {snapshot.destination
                  ? `${snapshot.destination.role} lead · ${snapshot.destination.status} · ${snapshot.destination.rtmpUrl}`
                  : "Configure a destination before going on air."}
              </div>
              <div className="subtle">
                {activeDestinationCount} active · {stagedDestinationCount} staged · {coolingDestinationCount} cooling down
              </div>
              <div className="subtle">
                PID {snapshot.playout.processPid || "not running"} · restarts {snapshot.playout.restartCount} · crash loop{" "}
                {snapshot.playout.crashLoopDetected ? "detected" : "clear"}
              </div>
              <div className="subtle">Last transition {snapshot.playout.lastTransitionAt || "not recorded yet"}</div>
              <div className="subtle">{snapshot.playout.lastStderrSample || "The encoder has not reported any errors."}</div>
            </div>
            {snapshot.destinations.map((destination) => (
              <div className="item" key={destination.id}>
                <strong>{destination.name}</strong>
                <div className="subtle">
                  {DESTINATION_ROLE_LABELS[destination.role]} · priority {destination.priority} ·{" "}
                  {DESTINATION_STATUS_LABELS[destination.status]}
                  {destination.active ? " · in use" : ""}
                </div>
                <div className="subtle">
                  {destination.rtmpUrl || "No RTMP URL configured"} ·{" "}
                  {describeStreamKey(destination.streamKeyPresent, destination.streamKeySource)}
                </div>
                <div className="subtle">{destination.notes}</div>
                <div className="subtle">
                  Recovery: {DESTINATION_RECOVERY_LABELS[destination.recoveryState]}
                  {destination.failureHoldSecondsRemaining > 0 ? ` · retry in ${destination.failureHoldSecondsRemaining}s` : ""}
                </div>
                <div className="subtle">{destination.recoverySummary}</div>
                {destination.lastFailureAt ? (
                  <div className="subtle">
                    Last failure {destination.lastFailureAt} · count {destination.failureCount} · {destination.lastError || "No error sample captured."}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </article>

        <article className="panel">
          <span className="label">Scenes</span>
          <h3>What the overlay shows</h3>
          <div className="list">
            <div className="item">
              <strong>{snapshot.overlay.replayLabel} · {snapshot.overlay.channelName}</strong>
              <div className="subtle">{snapshot.overlay.headline}</div>
              <div className="subtle">
                Preset {describeScenePreset(snapshot.overlay.scenePreset)} · {snapshot.overlay.surfaceStyle} surface · {snapshot.overlay.panelAnchor} anchor ·{" "}
                {snapshot.overlay.titleScale} scale
              </div>
              <div className="subtle">
                Asset headline {snapshot.overlay.headline} · Insert {snapshot.overlay.insertHeadline} · Standby {snapshot.overlay.standbyHeadline} ·
                Reconnect {snapshot.overlay.reconnectHeadline}
              </div>
              <div className="subtle">
                Asset {describeScenePreset(snapshot.overlay.scenePreset)} · Insert {describeScenePreset(snapshot.overlay.insertScenePreset)} · Standby {describeScenePreset(snapshot.overlay.standbyScenePreset)} ·
                Reconnect {describeScenePreset(snapshot.overlay.reconnectScenePreset)}
              </div>
              <div className="subtle">
                Accent {snapshot.overlay.accentColor} · Brand badge {snapshot.overlay.brandBadge || "none"} · Next visible{" "}
                {snapshot.overlay.showNextItem ? "yes" : "no"} · Clock {snapshot.overlay.showClock ? "yes" : "no"}
              </div>
              <div className="subtle">
                Queue preview {snapshot.overlay.showQueuePreview ? `yes (${snapshot.overlay.queuePreviewCount})` : "no"} · Current category{" "}
                {snapshot.overlay.showCurrentCategory ? "yes" : "no"} · Source label {snapshot.overlay.showSourceLabel ? "yes" : "no"}
              </div>
              <div className="subtle">
                Active scene {describeScenePreset(snapshot.activeScene.resolvedPresetId)} · layers{" "}
                {snapshot.activeScene.layers.filter((layer) => layer.enabled).map((layer) => layer.label).join(" → ")}
              </div>
              <div className="subtle">
                Hidden layers{" "}
                {snapshot.overlay.disabledLayers.length > 0
                  ? snapshot.overlay.disabledLayers.join(" → ")
                  : "none"}
              </div>
              {snapshot.overlay.tickerText ? <div className="subtle">{snapshot.overlay.tickerText}</div> : null}
              {snapshot.overlay.emergencyBanner ? <div className="danger">{snapshot.overlay.emergencyBanner}</div> : null}
              <div className="subtle-link-row" style={{ marginTop: 8 }}>
                <Link className="subtle-link" href={buildWorkspaceHref("studio", "scene")}>
                  Open overlay studio
                </Link>
                <Link className="subtle-link" href="/overlay" target="_blank">
                  Open public overlay
                </Link>
              </div>
            </div>
          </div>
        </article>

        <article className="panel">
          <span className="label">Incidents</span>
          <h3>Open problems</h3>
          <div className="list">
            {snapshot.openIncidents.length > 0 ? (
              snapshot.openIncidents.map((incident) => (
                <div className="item" key={incident.id}>
                  <strong>
                    {incident.severity.toUpperCase()} · {incident.scope} · {incident.title}
                  </strong>
                  <div className="subtle">
                    {describeIncidentAge({
                      createdAt: incident.createdAt,
                      updatedAt: incident.updatedAt,
                      nowMs: incidentNowMs
                    })}
                  </div>
                  <div className="subtle">{incident.message}</div>
                </div>
              ))
            ) : (
              <div className="item">
                <strong>No open incidents</strong>
                <div className="subtle">The live system currently reports no unresolved incidents.</div>
              </div>
            )}
            {describeOpenIncidentOverflow(snapshot.openIncidents.length, snapshot.openIncidentCount) ? (
              <div className="item">
                <div className="subtle">
                  {describeOpenIncidentOverflow(snapshot.openIncidents.length, snapshot.openIncidentCount)}
                </div>
              </div>
            ) : null}
          </div>
        </article>

        <article className="panel">
          <span className="label">Worker</span>
          <h3>Behind the scenes</h3>
          <div className="list">
            <div className="item">
              <strong>{snapshot.workerHealth.status}</strong>
              <div className="subtle">{snapshot.workerHealth.summary}</div>
              <div className="subtle">Last run: {snapshot.workerHealth.lastRunAt || "never"}</div>
            </div>
          </div>
        </article>
      </section>
    </div>
  );
}
