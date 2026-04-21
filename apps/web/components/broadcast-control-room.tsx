"use client";

import Link from "next/link";
import { AdminPageHeader } from "@/components/admin-page-header";
import { getBroadcastLiveStatusLabel, getBroadcastLiveStatusTone } from "@/components/broadcast-live-status";
import type { BroadcastSnapshot } from "@/lib/live-broadcast";
import { PlayoutActionForm } from "@/components/playout-action-form";
import { StatusChip } from "@/components/ui/StatusChip";
import { useLiveSnapshot } from "@/components/use-live-snapshot";

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

  return (
    <div className="stack-form">
      <AdminPageHeader
        compact
        description="Use Broadcast for live actions. Current item, next queue, destination health, and scene state update continuously without reloading the page."
        eyebrow="Broadcast"
        title="Operate the live 24/7 output from one workspace."
      >
        <div className="stats-row">
          <StatusChip status={getBroadcastLiveStatusTone(snapshot.twitch)} label={getBroadcastLiveStatusLabel(snapshot.twitch)} />
        </div>
        <div className="status-rail">
          <div>
            <span className="label">Feed</span>
            <strong>{snapshot.playout.status}</strong>
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
                ? `${activeDestinationCount} active`
                : snapshot.destination?.status || "missing"}
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
                Transition {snapshot.playout.transitionState} · queue reason {snapshot.playout.selectionReasonCode || "none"} · version{" "}
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
          <p className="subtle">
            Use soft actions first. Hard reload is still available, but queue rebuild and scene refresh should be the
            normal recovery path.
          </p>
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
          <span className="label">Audio lane</span>
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
          <span className="label">Cuepoints</span>
          <h3>Timed insert state</h3>
          <div className="list">
            <div className="item">
              <strong>{snapshot.cuepoints.assetTitle || "No cuepoint insert asset"}</strong>
              <div className="subtle">
                {snapshot.cuepoints.configured
                  ? `Safe-boundary mode · ${snapshot.cuepoints.firedCount}/${snapshot.cuepoints.totalCount} fired`
                  : "No cuepoints are configured for the current schedule block."}
              </div>
              {snapshot.cuepoints.offsetsSeconds.length > 0 ? (
                <div className="subtle">Offsets {snapshot.cuepoints.offsetsSeconds.map((offset) => `${offset}s`).join(" · ")}</div>
              ) : null}
              {snapshot.cuepoints.nextOffsetSeconds !== null ? (
                <div className="subtle">Next cuepoint at {snapshot.cuepoints.nextOffsetSeconds}s from block start</div>
              ) : null}
              {snapshot.cuepoints.dueOffsetSeconds !== null ? (
                <div className="subtle">A cuepoint at {snapshot.cuepoints.dueOffsetSeconds}s is armed for the next safe insert boundary.</div>
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
          <h3>Output health</h3>
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
              <div className="subtle">{snapshot.playout.lastStderrSample || "No recent FFmpeg stderr sample."}</div>
            </div>
            {snapshot.destinations.map((destination) => (
              <div className="item" key={destination.id}>
                <strong>{destination.name}</strong>
                <div className="subtle">
                  {destination.role} · priority {destination.priority} · {destination.status}
                  {destination.active ? " · active" : ""}
                </div>
                <div className="subtle">
                  {destination.rtmpUrl || "No RTMP URL configured"} · {destination.streamKeyPresent ? "stream key present" : "stream key missing"} · key source{" "}
                  {destination.streamKeySource}
                </div>
                <div className="subtle">{destination.notes}</div>
                <div className="subtle">
                  Recovery {destination.recoveryState}
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
          <h3>Current overlay payload</h3>
          <div className="list">
            <div className="item">
              <strong>{snapshot.overlay.replayLabel} · {snapshot.overlay.channelName}</strong>
              <div className="subtle">{snapshot.overlay.headline}</div>
              <div className="subtle">
                Preset {snapshot.overlay.scenePreset} · {snapshot.overlay.surfaceStyle} surface · {snapshot.overlay.panelAnchor} anchor ·{" "}
                {snapshot.overlay.titleScale} scale
              </div>
              <div className="subtle">
                Asset headline {snapshot.overlay.headline} · Insert {snapshot.overlay.insertHeadline} · Standby {snapshot.overlay.standbyHeadline} ·
                Reconnect {snapshot.overlay.reconnectHeadline}
              </div>
              <div className="subtle">
                Asset {snapshot.overlay.scenePreset} · Insert {snapshot.overlay.insertScenePreset} · Standby {snapshot.overlay.standbyScenePreset} ·
                Reconnect {snapshot.overlay.reconnectScenePreset}
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
                Active scene {snapshot.activeScene.resolvedPresetId} · layers{" "}
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
                <Link className="subtle-link" href="/overlay-studio">
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
                  <div className="subtle">{incident.message}</div>
                </div>
              ))
            ) : (
              <div className="item">
                <strong>No open incidents</strong>
                <div className="subtle">The live system currently reports no unresolved incidents.</div>
              </div>
            )}
          </div>
        </article>

        <article className="panel">
          <span className="label">Worker</span>
          <h3>Background health</h3>
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
