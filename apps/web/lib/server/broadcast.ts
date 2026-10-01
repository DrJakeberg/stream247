import {
  decideTwitchVodPlaybackSource,
  isTwitchVodPlaybackAsset,
  isValidLiveBridgeInputUrl,
  normalizeLiveBridgeInputType,
  resolveOperatorOverrideHold,
  resolveVodCacheTuning,
  type OperatorOverrideHold
} from "@stream247/core";
import { appendAuditEvent, readAppState, updateDestinationRecord, updatePlayoutRuntime } from "@/lib/server/state";

type BroadcastAction =
  | { type: "restart" | "hard_reload" }
  | { type: "refresh" | "rebuild_queue" }
  | { type: "force_reconnect" }
  | { type: "recover_outputs" }
  | { type: "bridge_start"; inputType?: "rtmp" | "hls"; inputUrl: string; label?: string }
  | { type: "bridge_release" }
  | { type: "fallback" }
  | { type: "resume" }
  | { type: "trigger_insert"; assetId: string }
  | { type: "play_now"; assetId: string }
  | { type: "move_next"; assetId: string }
  | { type: "remove_next" }
  | { type: "replay_previous" }
  | { type: "skip"; minutes?: number }
  | { type: "override"; assetId: string; minutes?: number };

function addMinutes(minutes: number): string {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

// The relay topology is deploy-time env shared by every container (readiness.ts reads it the same way).
// Under the relay the uplink owns the destinations and the Twitch session; the playout only feeds the
// relay, and a playout restart there does not reconnect anything -- it only restarts the programme.
function isRelayEnabled(): boolean {
  return process.env.STREAM247_RELAY_ENABLED === "1";
}

// The worker's own test for a skip hold that is still running (isTimestampActive).
function isActiveUntil(value: string): boolean {
  return value !== "" && new Date(value).getTime() > Date.now();
}

// The Pin or Fallback that holds the air, by the rule of the worker's override arm (M78).
function operatorOverrideHold(state: Awaited<ReturnType<typeof readAppState>>): OperatorOverrideHold {
  return resolveOperatorOverrideHold({ ...state.playout, assets: state.assets, nowMs: Date.now() });
}

function assetTitle(assets: { id: string; title: string }[], assetId: string): string {
  return assets.find((entry) => entry.id === assetId)?.title || assetId;
}

export async function runBroadcastAction(action: BroadcastAction): Promise<{ ok: true; message: string }> {
  const state = await readAppState();
  const now = new Date().toISOString();

  if (action.type === "refresh" || action.type === "rebuild_queue") {
    const message =
      action.type === "refresh"
        ? "Broadcast refresh requested. Overlay and slate payloads will be rebuilt on the next playout cycle."
        : "Broadcast queue rebuild requested. The next playout cycle will recalculate the visible queue.";
    await updatePlayoutRuntime((playout) => ({
      ...playout,
      pendingAction: action.type,
      pendingActionRequestedAt: now,
      heartbeatAt: now,
      message
    }));
    await appendAuditEvent(
      `broadcast.${action.type}.requested`,
      action.type === "refresh" ? "Broadcast refresh requested." : "Broadcast queue rebuild requested."
    );
    return { ok: true, message };
  }

  if (action.type === "restart" || action.type === "hard_reload") {
    const message =
      action.type === "restart"
        ? "Manual playout restart requested from the admin API."
        : "Hard reload requested. The encoder will restart from scratch on the next playout cycle.";
    await updatePlayoutRuntime((playout) => ({
      ...playout,
      status: "recovering",
      restartRequestedAt: now,
      heartbeatAt: now,
      pendingAction: "",
      pendingActionRequestedAt: "",
      message
    }));
    await appendAuditEvent(
      action.type === "restart" ? "playout.restart.requested" : "broadcast.hard-reload.requested",
      action.type === "restart" ? "Manual playout restart was requested." : "Broadcast hard reload was requested."
    );
    return { ok: true, message };
  }

  if (action.type === "force_reconnect") {
    // The uplink reads nothing the admin could set to ask for a reconnect; it reconnects on its own
    // (the planned reconnect interval, the encoder-stall and destination-stall watchdogs). The playout
    // restart this action requests would reconnect nothing under the relay and only replay the running
    // item from its beginning (M74).
    if (isRelayEnabled()) {
      throw new Error(
        "The relay is on: the uplink holds the Twitch connection and reconnects by itself, so there is nothing to force. Use Restart to restart the programme."
      );
    }
    if (state.playout.liveBridgeStatus === "pending" || state.playout.liveBridgeStatus === "active") {
      throw new Error("Release Live Bridge before forcing a reconnect.");
    }
    const message = "Manual reconnect requested. The encoder will enter the reconnect window on the next playout cycle.";
    await updatePlayoutRuntime((playout) => ({
      ...playout,
      status: "reconnecting",
      restartRequestedAt: now,
      heartbeatAt: now,
      pendingAction: "",
      pendingActionRequestedAt: "",
      message
    }));
    await appendAuditEvent("broadcast.reconnect.requested", "Manual reconnect was requested.");
    return { ok: true, message };
  }

  if (action.type === "recover_outputs") {
    if (state.playout.liveBridgeStatus === "pending" || state.playout.liveBridgeStatus === "active") {
      throw new Error("Release Live Bridge before forcing output recovery.");
    }

    const recoveringDestinations = state.destinations.filter((destination) => destination.status === "recovering");
    if (recoveringDestinations.length === 0) {
      throw new Error("No staged outputs are waiting to rejoin.");
    }

    for (const destination of recoveringDestinations) {
      await updateDestinationRecord({
        ...destination,
        status: "ready",
        lastValidatedAt: now,
        notes: `${destination.role === "backup" ? "Backup" : "Primary"} destination will rejoin on the next ${isRelayEnabled() ? "uplink" : "playout"} cycle after the operator recovery request.`
      });
    }

    const auditMessage = `Operator requested immediate output recovery for ${recoveringDestinations.map((destination) => destination.name).join(", ")}.`;
    // Under the relay the uplink picks the ready outputs up on its own next cycle. Restarting the playout
    // there rejoined nothing and replayed the running item from its beginning (M74).
    if (isRelayEnabled()) {
      const message =
        recoveringDestinations.length === 1
          ? `${recoveringDestinations[0]!.name} will rejoin on the next uplink cycle.`
          : `${recoveringDestinations.length} staged outputs will rejoin on the next uplink cycle.`;
      await appendAuditEvent("broadcast.output-recovery.requested", auditMessage);
      return { ok: true, message };
    }

    const message =
      recoveringDestinations.length === 1
        ? `${recoveringDestinations[0]!.name} will rejoin on the next playout cycle.`
        : `${recoveringDestinations.length} staged outputs will rejoin on the next playout cycle.`;
    await updatePlayoutRuntime((playout) => ({
      ...playout,
      status: "recovering",
      restartRequestedAt: now,
      heartbeatAt: now,
      pendingAction: "",
      pendingActionRequestedAt: "",
      message
    }));
    await appendAuditEvent("broadcast.output-recovery.requested", auditMessage);
    return { ok: true, message };
  }

  if (action.type === "bridge_start") {
    const inputType = normalizeLiveBridgeInputType(String(action.inputType || "rtmp"));
    const inputUrl = String(action.inputUrl || "").trim();
    const label = String(action.label || "").trim().slice(0, 120) || "Live Bridge";

    if (!inputUrl) {
      throw new Error("Provide a Live Bridge input URL.");
    }

    if (!isValidLiveBridgeInputUrl(inputUrl, inputType)) {
      throw new Error(inputType === "rtmp" ? "Live Bridge RTMP input must use rtmp:// or rtmps://." : "Live Bridge HLS input must use http:// or https://.");
    }

    const message = `${label} is queued for live takeover.`;
    await updatePlayoutRuntime((playout) => ({
      ...playout,
      status: "recovering",
      restartRequestedAt: "",
      heartbeatAt: now,
      liveBridgeInputType: inputType,
      liveBridgeInputUrl: inputUrl,
      liveBridgeLabel: label,
      liveBridgeStatus: "pending",
      liveBridgeRequestedAt: now,
      liveBridgeStartedAt: "",
      liveBridgeReleasedAt: "",
      liveBridgeLastError: "",
      pendingAction: "",
      pendingActionRequestedAt: "",
      message
    }));
    await appendAuditEvent("broadcast.live-bridge.requested", `Live Bridge requested for ${label}.`);
    return { ok: true, message };
  }

  if (action.type === "bridge_release") {
    if (state.playout.liveBridgeStatus !== "pending" && state.playout.liveBridgeStatus !== "active" && state.playout.liveBridgeStatus !== "error") {
      throw new Error("Live Bridge is not active.");
    }

    const label = state.playout.liveBridgeLabel || "Live Bridge";
    const message = `${label} is releasing. Scheduled playback will resume on the next safe transition.`;
    await updatePlayoutRuntime((playout) => ({
      ...playout,
      status: "recovering",
      heartbeatAt: now,
      liveBridgeStatus: "releasing",
      liveBridgeReleasedAt: now,
      pendingAction: "rebuild_queue",
      pendingActionRequestedAt: now,
      message
    }));
    await appendAuditEvent("broadcast.live-bridge.released", `Live Bridge release requested for ${label}.`);
    return { ok: true, message };
  }

  if (action.type === "fallback") {
    const fallback = [...state.assets]
      .filter((asset) => asset.status === "ready" && asset.isGlobalFallback && asset.includeInProgramming !== false)
      .sort((left, right) => left.fallbackPriority - right.fallbackPriority)[0];

    if (!fallback) {
      throw new Error("No global fallback asset is configured.");
    }

    // Under the relay the override branch and the normal switch put the fallback on air at the next cycle;
    // the restart flag only restarted it from 0 when it was already on air (M74). Without the relay the
    // slate comes first, as before.
    await updatePlayoutRuntime((playout) => ({
      ...playout,
      ...(isRelayEnabled() ? {} : { status: "recovering" as const, restartRequestedAt: now }),
      desiredAssetId: fallback.id,
      heartbeatAt: now,
      overrideMode: "fallback",
      overrideAssetId: fallback.id,
      overrideUntil: new Date(Date.now() + 60 * 60_000).toISOString(),
      // The override arm leaves out an item under a skip hold (M78), so the operator's newer word lifts it.
      ...(playout.skipAssetId === fallback.id ? { skipAssetId: "", skipUntil: "" } : {}),
      manualNextAssetId: "",
      manualNextRequestedAt: "",
      pendingAction: "",
      pendingActionRequestedAt: "",
      message: `Manual fallback requested for asset ${fallback.title}.`
    }));
    await appendAuditEvent("playout.fallback.requested", `Manual fallback requested for ${fallback.title}.`);
    return { ok: true, message: `Manual fallback requested for ${fallback.title}.` };
  }

  if (action.type === "resume") {
    // Without the relay a restart puts the reconnect slate on air and the pool continues after it, as
    // before. Under the relay there is no slate, and a restart would replay from its beginning whatever
    // the schedule keeps on air; the worker switches to the pool's item by itself once the override and
    // the insert are cleared (M74).
    const relayEnabled = isRelayEnabled();
    await updatePlayoutRuntime((playout) => ({
      ...playout,
      ...(relayEnabled ? {} : { status: "recovering" as const, restartRequestedAt: now }),
      desiredAssetId: "",
      heartbeatAt: now,
      overrideMode: "schedule",
      overrideAssetId: "",
      overrideUntil: "",
      manualNextAssetId: "",
      manualNextRequestedAt: "",
      insertAssetId: "",
      insertRequestedAt: "",
      insertStatus: "",
      skipAssetId: "",
      skipUntil: "",
      pendingAction: "",
      pendingActionRequestedAt: "",
      message: "Operator override cleared. Schedule control resumed."
    }));
    await appendAuditEvent("playout.resume.schedule", "Operator override cleared and schedule control resumed.");
    // A Play now that had not aired yet is dropped by the operator: recorded like the worker's drops, so
    // every insert that never aired has a playout.insert.dropped row.
    if (state.playout.insertStatus === "pending" && state.playout.insertAssetId !== "") {
      await appendAuditEvent(
        "playout.insert.dropped",
        `Insert ${assetTitle(state.assets, state.playout.insertAssetId)} was dropped before it aired (cancelled by Resume schedule).`
      );
    }
    return { ok: true, message: "Schedule control resumed." };
  }

  if (action.type === "trigger_insert" || action.type === "play_now") {
    const asset = state.assets.find((entry) => entry.id === action.assetId && entry.status === "ready");
    if (!asset) {
      throw new Error("The requested insert asset is not available.");
    }
    // As for Move next. The worker would start the item on air again from 0 as an insert.
    if (asset.id === state.playout.currentAssetId) {
      throw new Error("The selected asset is already on air.");
    }
    // The worker's selection order: a Live Bridge first, then a running Pin or Fallback, then the insert,
    // and a skip hold keeps an item out of every arm. Accepted, the insert was dropped at the next cycle
    // ("preempted", "unavailable") after the operator had been told it was coming. A Live Bridge takeover
    // ends an insert (M78): the worker would drop this one as "live-bridge", not play it after the release
    // hours later. The bridge is asked before the Pin: a Pin left running under the bridge is not what
    // keeps the insert off air, and naming it sent the operator to Resume schedule only to be refused
    // again for the bridge.
    if (state.playout.liveBridgeStatus === "pending" || state.playout.liveBridgeStatus === "active") {
      throw new Error(`Live Bridge is on air, and it ends an insert. Release Live Bridge first, then play ${asset.title}.`);
    }
    const overrideHold = operatorOverrideHold(state);
    if (overrideHold !== "") {
      throw new Error(
        `${overrideHold === "fallback" ? "A Fallback" : "A Pin"} is holding the air, and it comes before an insert. Resume schedule first, then play ${asset.title}.`
      );
    }
    if (isActiveUntil(state.playout.skipUntil) && state.playout.skipAssetId === asset.id) {
      throw new Error(`${asset.title} is held out by a Skip or Remove next. Resume schedule clears the hold.`);
    }
    // The playout's own rule (core twitch-vod-playback.ts): it never waits for a download, so an archive
    // that is neither cached nor allowed to stream from Twitch cannot start. Refused here so the operator
    // learns it now; the worker drops such an insert too (logged), and keeps the running item on air.
    if (
      isTwitchVodPlaybackAsset(asset) &&
      decideTwitchVodPlaybackSource({
        cacheReady: asset.cacheStatus === "ready",
        settledTooLarge: asset.cacheStatus === "too-large",
        allowRemoteFallback: resolveVodCacheTuning(state.managedConfig, process.env).allowRemoteFallback
      }) === "unavailable"
    ) {
      throw new Error(
        `${asset.title} is a Twitch archive that is not downloaded yet, and playing replays from Twitch while they download is off, so the playout cannot start it now. Wait until its download has finished, or turn on "While a replay is still downloading, play it from Twitch" in Settings → Operations → Replay cache.`
      );
    }

    // No restart flag and no "recovering": the worker's insert branch picks the insert at its next cycle
    // and switches to it, while the running item stays on air until then. The restart flag used to put
    // the reconnect slate on air instead and let the running item win the selection (M74).
    await updatePlayoutRuntime((playout) => ({
      ...playout,
      heartbeatAt: now,
      insertAssetId: asset.id,
      insertRequestedAt: now,
      insertStatus: "pending",
      manualNextAssetId: "",
      manualNextRequestedAt: "",
      pendingAction: "",
      pendingActionRequestedAt: "",
      message: `${action.type === "play_now" ? "Play now" : "Insert"} requested for ${asset.title}.`
    }));
    await appendAuditEvent(
      action.type === "play_now" ? "playout.play-now.requested" : "playout.insert.requested",
      `${action.type === "play_now" ? "Operator requested play now" : "Operator requested insert"} ${asset.title}.`
    );
    if (state.playout.insertStatus === "pending" && state.playout.insertAssetId !== "" && state.playout.insertAssetId !== asset.id) {
      await appendAuditEvent(
        "playout.insert.dropped",
        `Insert ${assetTitle(state.assets, state.playout.insertAssetId)} was dropped before it aired (replaced by ${asset.title}).`
      );
    }
    return { ok: true, message: `${action.type === "play_now" ? "Play now" : "Insert"} requested for ${asset.title}.` };
  }

  if (action.type === "move_next") {
    const asset = state.assets.find((entry) => entry.id === action.assetId && entry.status === "ready");
    if (!asset) {
      throw new Error("The requested asset is not available to move next.");
    }
    if (asset.id === state.playout.currentAssetId) {
      throw new Error("The selected asset is already on air.");
    }

    await updatePlayoutRuntime((playout) => ({
      ...playout,
      manualNextAssetId: asset.id,
      manualNextRequestedAt: now,
      pendingAction: "rebuild_queue",
      pendingActionRequestedAt: now,
      heartbeatAt: now,
      message: `${asset.title} has been pinned as the next queue item.`
    }));
    await appendAuditEvent("playout.move-next.requested", `Operator moved ${asset.title} to the next queue slot.`);
    return { ok: true, message: `${asset.title} will play next.` };
  }

  if (action.type === "remove_next") {
    const nextQueueItem = state.playout.queueItems[1] ?? null;
    if (!nextQueueItem?.assetId) {
      throw new Error("There is no removable next queue asset.");
    }

    await updatePlayoutRuntime((playout) => ({
      ...playout,
      skipAssetId: nextQueueItem.assetId,
      skipUntil: addMinutes(60),
      manualNextAssetId: playout.manualNextAssetId === nextQueueItem.assetId ? "" : playout.manualNextAssetId,
      manualNextRequestedAt: playout.manualNextAssetId === nextQueueItem.assetId ? "" : playout.manualNextRequestedAt,
      pendingAction: "rebuild_queue",
      pendingActionRequestedAt: now,
      heartbeatAt: now,
      message: `${nextQueueItem.title} was removed from the immediate next slot.`
    }));
    await appendAuditEvent("playout.remove-next.requested", `Operator removed ${nextQueueItem.title} from the next queue slot.`);
    return { ok: true, message: `${nextQueueItem.title} was removed from next.` };
  }

  if (action.type === "replay_previous") {
    const previousAsset = state.assets.find(
      (entry) => entry.id === state.playout.previousAssetId && entry.status === "ready" && entry.includeInProgramming !== false
    );
    if (!previousAsset) {
      throw new Error("There is no ready previous asset to replay next.");
    }

    await updatePlayoutRuntime((playout) => ({
      ...playout,
      manualNextAssetId: previousAsset.id,
      manualNextRequestedAt: now,
      pendingAction: "rebuild_queue",
      pendingActionRequestedAt: now,
      heartbeatAt: now,
      message: `${previousAsset.title} will replay as the next item.`
    }));
    await appendAuditEvent("playout.replay-previous.requested", `Operator queued ${previousAsset.title} as the next replay item.`);
    return { ok: true, message: `${previousAsset.title} will replay next.` };
  }

  if (action.type === "skip") {
    const minutes = Math.max(5, Math.min(240, Number(action.minutes ?? 60) || 60));
    const currentAsset = state.assets.find((entry) => entry.id === state.playout.currentAssetId);
    if (!currentAsset) {
      throw new Error("No current asset is running, so there is nothing to skip.");
    }

    // A Skip of the item a Pin or Fallback holds on air ends that override (M78, owner decision
    // 2026-10-01). The override arm comes before every other arm and ignored the skip hold, so the pinned
    // item started again from 0 -- under the relay at once, without it after the slate -- and only Resume
    // took it off air; a passed chat skip vote did the same. Only the override of the item on air: a Pin
    // the playout has not switched to yet is not what the operator skipped. The schedule then continues
    // as after any Skip (the pool's next pick; a pin does not move the pool's position), with the restart
    // flag and, without the relay, the slate of M74. The chat skip vote mirrors this write but is refused
    // while an override holds (worker drainChatEffects): viewers never end the operator's override.
    const hold = operatorOverrideHold(state);
    const endsOverride = hold !== "" && state.playout.overrideAssetId === currentAsset.id;
    // What the write ended, set inside it: the row it writes can be newer than the row read above, and a
    // Pin of another item written in between stands, so the message, the toast and the audit row are
    // taken from the write, not from the read. `as`: TypeScript's narrowing does not follow the updater.
    let endedOverride = "" as "" | "Pin" | "Fallback";

    await updatePlayoutRuntime((playout) => {
      endedOverride =
        endsOverride && playout.overrideAssetId === currentAsset.id ? (playout.overrideMode === "fallback" ? "Fallback" : "Pin") : "";
      return {
        ...playout,
        status: "recovering",
        restartRequestedAt: now,
        heartbeatAt: now,
        ...(endedOverride !== ""
          ? { desiredAssetId: "", overrideMode: "schedule" as const, overrideAssetId: "", overrideUntil: "" }
          : {}),
        skipAssetId: currentAsset.id,
        skipUntil: addMinutes(minutes),
        pendingAction: "",
        pendingActionRequestedAt: "",
        message:
          endedOverride !== ""
            ? `Skipped ${currentAsset.title} for ${minutes} minutes and ended the ${endedOverride}.`
            : `Skipped ${currentAsset.title} for ${minutes} minutes.`
      };
    });
    await appendAuditEvent(
      "playout.skip.current",
      endedOverride !== ""
        ? `Skipped ${currentAsset.title} for ${minutes} minutes; the ${endedOverride} was ended by Skip.`
        : `Skipped ${currentAsset.title} for ${minutes} minutes.`
    );
    return {
      ok: true,
      message: endedOverride !== "" ? `Current asset skipped and the ${endedOverride} ended.` : "Current asset skipped."
    };
  }

  const assetId = String(action.type === "override" ? action.assetId : "");
  const minutes = Math.max(5, Math.min(240, Number(action.type === "override" ? action.minutes ?? 60 : 60) || 60));
  const asset = state.assets.find((entry) => entry.id === assetId && entry.status === "ready");
  if (!asset) {
    throw new Error("The requested asset is not available for override.");
  }

  // As for Fallback: under the relay a Pin switches at the next cycle, and a Pin of the item on air keeps
  // it running instead of starting it again from 0, which one click on the preselected on-air item did.
  await updatePlayoutRuntime((playout) => ({
    ...playout,
    ...(isRelayEnabled() ? {} : { status: "recovering" as const, restartRequestedAt: now }),
    desiredAssetId: asset.id,
    heartbeatAt: now,
    overrideMode: "asset",
    overrideAssetId: asset.id,
    overrideUntil: addMinutes(minutes),
    // As for Fallback: a Pin of an item a Skip holds out lifts the hold, or the pin would never take the air.
    ...(playout.skipAssetId === asset.id ? { skipAssetId: "", skipUntil: "" } : {}),
    manualNextAssetId: "",
    manualNextRequestedAt: "",
    pendingAction: "",
    pendingActionRequestedAt: "",
    message: `Operator override selected ${asset.title} for ${minutes} minutes.`
  }));
  await appendAuditEvent("playout.override.asset", `Operator pinned ${asset.title} for ${minutes} minutes.`);
  return { ok: true, message: "Operator override applied." };
}
