"use client";

import Link from "next/link";
import { buildWorkspaceHref } from "@/lib/workspace-navigation";
import type { BroadcastSnapshot } from "@/lib/live-broadcast";
import { OpenProblemsPanel } from "@/components/open-problems-panel";
import { PlayoutActionForm } from "@/components/playout-action-form";
import { RowStateBadge } from "@/components/row-state-badge";
import { useLiveSnapshot } from "@/components/use-live-snapshot";
import {
  DESTINATION_RECOVERY_LABELS,
  DESTINATION_ROLE_LABELS,
  DESTINATION_STATUS_LABELS,
  describeStreamKey
} from "@/lib/destination-wording";
import { describePlayoutReason } from "@/lib/playout-reason";
import { destinationRowState } from "@/lib/row-state";
import { describeScenePreset } from "@/lib/scene-preset-names";
import { describeOverlayHeadlines } from "@/lib/overlay-headline-wording";
import { describePendingPlayoutRequests, listOperatorHolds, resumeHasSomethingToClear } from "@/lib/operator-holds";
import { localizeViewerBuiltInText, resolveOverlayHeadlineForQueueKind } from "@stream247/core";

/** The next item's preparation in words: "ready" is what an operator wants to know at a glance. */
function describeNextItemReadiness(prefetchStatus: string): string {
  if (prefetchStatus === "ready") {
    return "Checked and ready to play.";
  }
  if (prefetchStatus === "failed") {
    return "The check of this item failed; playout will try the one after it.";
  }
  return "Not checked yet.";
}

type AssetOption = {
  id: string;
  title: string;
};

export function BroadcastControlRoom(props: { initialSnapshot: BroadcastSnapshot; assets: AssetOption[] }) {
  const { snapshot } = useLiveSnapshot({
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
  // What the operator's actions still hold (M120). Measured against the snapshot's time like the ages.
  const titleOf = (assetId: string) =>
    props.assets.find((asset) => asset.id === assetId)?.title ||
    snapshot.queueItems.find((item) => item.asset?.id === assetId)?.title ||
    (snapshot.playout.currentAssetId === assetId ? snapshot.playout.currentTitle : "") ||
    "an item no longer in the library";
  const operatorHolds = Number.isFinite(incidentNowMs) ? listOperatorHolds(snapshot.playout, titleOf, incidentNowMs) : [];
  const pendingRequests = describePendingPlayoutRequests(snapshot.playout.pendingAction);

  return (
    <div className="stack-form live-control">
      <section className="grid two">
        {/*
          First on purpose (M90, U7/U9): the answer to "what is wrong and what do I press" leads the
          page, right after the Live workspace header and tabs (the page's one header since M129). A
          dead worker or playout cannot report itself, so those two come from the heartbeats and go first.
        */}
        <OpenProblemsPanel
          heartbeatProblems={snapshot.heartbeatProblems}
          nowMs={incidentNowMs}
          openIncidentCount={snapshot.openIncidentCount}
          openIncidents={snapshot.openIncidents}
        />

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
              {describePlayoutReason(snapshot.playout.selectionReasonCode) ? (
                <div className="subtle">Why this item: {describePlayoutReason(snapshot.playout.selectionReasonCode)}</div>
              ) : null}
            </div>
            <div className="item">
              <strong>{nextQueueItem?.title || snapshot.nextAsset?.title || snapshot.nextScheduleItem?.title || "No next item yet"}</strong>
              <div className="subtle">{describeNextItemReadiness(snapshot.playout.prefetchStatus)}</div>
              {snapshot.playout.manualNextAssetId ? <div className="subtle">Queued next by an operator (Move next).</div> : null}
              {nextQueueItem?.subtitle ? <div className="subtle">{nextQueueItem.subtitle}</div> : null}
              {snapshot.playout.prefetchError ? <div className="danger">{snapshot.playout.prefetchError}</div> : null}
            </div>
            {operatorHolds.length > 0 || pendingRequests ? (
              <div className="item" data-testid="operator-holds">
                <strong>Operator holds</strong>
                {operatorHolds.map((hold) => (
                  <div className="subtle" key={hold.kind}>
                    {hold.text}
                  </div>
                ))}
                {operatorHolds.length > 0 ? <div className="subtle">Resume schedule clears all of these.</div> : null}
                {pendingRequests ? <div className="subtle">{pendingRequests}</div> : null}
              </div>
            ) : null}
            {/*
              The engine's own words ("Transition idle · queue reason none · version 0", "ready not
              ready") answered nobody's question in the first line of the page (M90, U10). They stay
              one click away for whoever is debugging the engine.
            */}
            <details className="disclosure">
              <summary>Details</summary>
              <div className="subtle" style={{ marginTop: 8 }}>
                Transition state: {snapshot.playout.transitionState} · queue version {snapshot.playout.queueVersion}
              </div>
              <div className="subtle">
                Next item check: {snapshot.playout.prefetchStatus || "not run"}
                {snapshot.playout.prefetchedAt ? ` at ${snapshot.playout.prefetchedAt}` : ""}
              </div>
              <div className="subtle">
                Transition target: {snapshot.playout.transitionTargetKind || "none"}
                {snapshot.playout.transitionReadyAt ? ` · prepared at ${snapshot.playout.transitionReadyAt}` : " · not prepared yet"}
              </div>
              {snapshot.playout.manualNextAssetId ? (
                <div className="subtle">Move next holds asset {snapshot.playout.manualNextAssetId}.</div>
              ) : null}
            </details>
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
            insertStatus={snapshot.playout.insertStatus}
            resumeEnabled={Number.isFinite(incidentNowMs) && resumeHasSomethingToClear(snapshot.playout, incidentNowMs)}
            liveBridgeStatus={snapshot.liveBridge.status}
            liveBridgeLabel={snapshot.liveBridge.label}
            liveBridgeInputType={snapshot.liveBridge.inputType}
            liveBridgeInputSummary={snapshot.liveBridge.inputSummary}
            liveBridgeLastError={snapshot.liveBridge.lastError}
            recoveringDestinationCount={stagedDestinationCount}
            relayEnabled={snapshot.relayEnabled}
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
            {/*
              M129: every output row starts with its state in a badge. The lines under it keep the
              four-way status wording, so Recovering stays distinguishable from Not working.
            */}
            <div className="item">
              <RowStateBadge state={snapshot.destination ? destinationRowState(snapshot.destination.status) : "needs-setup"} />{" "}
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
                <RowStateBadge state={destinationRowState(destination.status)} /> <strong>{destination.name}</strong>
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
              <strong>
                {localizeViewerBuiltInText(snapshot.locale, snapshot.overlay.replayLabel)} ·{" "}
                {localizeViewerBuiltInText(snapshot.locale, snapshot.overlay.channelName)}
              </strong>
              <div className="subtle">{resolveOverlayHeadlineForQueueKind(snapshot.overlay.headline, "asset", undefined, snapshot.locale)}</div>
              <div className="subtle">
                Preset {describeScenePreset(snapshot.overlay.scenePreset)} · {snapshot.overlay.surfaceStyle} surface · {snapshot.overlay.panelAnchor} anchor ·{" "}
                {snapshot.overlay.titleScale} scale
              </div>
              <div className="subtle">{describeOverlayHeadlines(snapshot.overlay, snapshot.locale)}</div>
              <div className="subtle">
                Asset {describeScenePreset(snapshot.overlay.scenePreset)} · Insert {describeScenePreset(snapshot.overlay.insertScenePreset)} · Standby {describeScenePreset(snapshot.overlay.standbyScenePreset)} ·
                Reconnect {describeScenePreset(snapshot.overlay.reconnectScenePreset)}
              </div>
              <div className="subtle">
                Accent {snapshot.overlay.accentColor} · Brand badge {snapshot.overlay.brandBadge || "none"} · Next visible{" "}
                {snapshot.overlay.showNextItem ? "yes" : "no"} · Clock {snapshot.overlay.showClock ? "yes" : "no"}
              </div>
              <div className="subtle">
                Current category {snapshot.overlay.showCurrentCategory ? "yes" : "no"} · Source label{" "}
                {snapshot.overlay.showSourceLabel ? "yes" : "no"}
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
              </div>
            </div>
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
