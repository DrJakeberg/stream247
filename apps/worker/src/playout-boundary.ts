export interface BoundaryProbe {
  status: "ready" | "failed";
  resolvedInput: string;
  // The audio track of a video+audio pair (YouTube, 2.1). Travels with resolvedInput: a decision that
  // reuses the input reuses its audio, never a different one.
  resolvedAudioInput?: string;
  // The asset this probe was resolved for. Carried on the entry itself so the boundary can prove
  // the prefetched input belongs to the asset it is about to start, rather than trusting that the
  // caller looked it up under the right key.
  assetId: string;
}

export interface BoundaryInputDecision {
  // "cache":   reuse the prefetched resolved input — no inline resolve at the boundary.
  // "resolve": fall through to an inline resolveAssetPlaybackInput call.
  source: "cache" | "resolve";
  input: string;
  audioInput: string;
}

/**
 * Decide the playback input for an asset selected at a playout boundary.
 *
 * Prefers the input already resolved by the off-boundary queue prefetch so that a Twitch-VOD
 * cache / yt-dlp resolve never runs inline between the old ffmpeg exit and the new one. That
 * inline resolve is what left playout idle with an empty currentAsset (broadcastReady=false)
 * in the v1.5.10 CLEAN4 soak. On a stale/missing/failed probe (or one with no resolvedInput)
 * it returns "resolve", preserving the previous inline behavior — never worse than before.
 *
 * The asymmetry that matters: a prefetch is an optimisation, so declining one costs a few seconds
 * of fallback, while honouring a probe that belongs to a *different* asset would put the wrong
 * programme on air. Any doubt therefore resolves to "resolve". `selectedAssetId` is the asset the
 * cycle actually decided to start; a probe that does not name that asset is ignored, so a queue
 * change between prefetch and boundary (skip vote, operator insert, schedule flip, chapter jump)
 * can never redirect playout to stale content.
 */
export function decideBoundaryPlaybackInput(probe: BoundaryProbe | null, selectedAssetId: string): BoundaryInputDecision {
  if (!probe || probe.status !== "ready" || !probe.resolvedInput) {
    return { source: "resolve", input: "", audioInput: "" };
  }
  if (!selectedAssetId || probe.assetId !== selectedAssetId) {
    return { source: "resolve", input: "", audioInput: "" };
  }
  return { source: "cache", input: probe.resolvedInput, audioInput: probe.resolvedAudioInput ?? "" };
}

// An ffmpeg process that fails this quickly after start did not play any content — it failed at
// input-open time, which for a remote-resolved asset means the resolved URL was dead/expired.
export const IMMEDIATE_OPEN_FAILURE_MAX_MS = 15_000;

export interface ImmediateOpenFailureInput {
  exitCode: number | string | null;
  exitSignal: string | null;
  stderrSample: string;
  // Milliseconds the process ran before exiting, or null if unknown (treated as immediate).
  ranForMs: number | null;
}

/**
 * (A) Detect an immediate input-open failure: ffmpeg exits almost immediately because the
 * resolved remote URL is dead/expired (observed as exitCode=8 / "Error opening input" on a
 * scheduled YouTube googlevideo URL). Callers invalidate that asset's resolved-input cache so
 * the next attempt re-resolves a fresh URL instead of reusing the dead one. A signal-terminated
 * exit (SIGKILL/SIGTERM) is a planned/forced stop, not an open failure.
 */
export function isImmediateInputOpenFailure(input: ImmediateOpenFailureInput): boolean {
  if (input.exitSignal) {
    return false;
  }
  const codeNum = typeof input.exitCode === "number" ? input.exitCode : Number.parseInt(String(input.exitCode ?? ""), 10);
  const stderr = (input.stderrSample || "").toLowerCase();
  const openError =
    codeNum === 8 ||
    stderr.includes("error opening input") ||
    stderr.includes("server returned 4") ||
    stderr.includes("http error 4") ||
    stderr.includes("403 forbidden") ||
    stderr.includes("404 not found") ||
    stderr.includes("410 gone");
  const immediate = input.ranForMs === null || input.ranForMs <= IMMEDIATE_OPEN_FAILURE_MAX_MS;
  return immediate && openError;
}

export interface BroadcastCoverageInput {
  // A playout ffmpeg process is currently running and feeding the program feed.
  playoutProcessRunning: boolean;
}

/**
 * Broadcast coverage is "down" — a cold resolve would open a no-playout gap that drains the
 * program-feed buffer — whenever no playout process is currently running. This is true for BOTH
 * a failed exit (v1.5.14) AND a clean natural-boundary exit (the v1.5.14-soak gap: global_fallback
 * ended cleanly, the next scheduled Twitch VOD was cold, and the ~93s inline resolve left no
 * process running while the ~60s feed buffer drained). When a process is still running (steady
 * state, or fallback already covering after a bridge), a cold resolve is covered by the live feed,
 * so we keep the existing inline-resolve behavior.
 */
export function isBroadcastCoverageDown(input: BroadcastCoverageInput): boolean {
  return !input.playoutProcessRunning;
}

export interface BoundaryBridgeInput {
  // The selected scheduled asset needs a slow remote resolve (Twitch cache prep / yt-dlp).
  assetExpensive: boolean;
  // The selected asset's resolved input is already warm in the probe cache.
  cacheWarm: boolean;
  // The broadcast path has no running playout process (see isBroadcastCoverageDown) — true for a
  // failed exit AND a clean natural-boundary exit — so a multi-minute cold resolve would leave
  // broadcastReady=false rather than coasting on the program-feed buffer.
  broadcastDown: boolean;
  // A cheap (local) fallback asset is available to bridge with.
  fallbackAvailable: boolean;
}

/**
 * (B) Decide whether to bridge to the local fallback before doing a cold expensive remote
 * resolve. When the previous playout failed (broadcast going dark) and the next scheduled asset
 * needs a ~60-120s cold resolve, we start the instant local fallback first so broadcastReady
 * recovers in seconds; the scheduled asset then resolves on a later cycle while fallback covers,
 * and playout switches to it once ready. When broadcast is still coasting (clean boundary), or
 * the asset is cheap/warm, or no fallback exists, we keep the existing inline-resolve behavior.
 */
export function shouldBridgeToFallbackBeforeResolve(input: BoundaryBridgeInput): boolean {
  return input.assetExpensive && !input.cacheWarm && input.broadcastDown && input.fallbackAvailable;
}

export interface RunningInputGuardInput {
  // A playout ffmpeg process is alive.
  processRunning: boolean;
  // That process plays exactly what this cycle selected, to the same destinations
  // (isMatchingRunningTarget).
  targetMatches: boolean;
  // A restart or reconnect was requested; the restart needs a fresh input, so it must resolve.
  restartRequested: boolean;
}

/**
 * Keep the input the running programme was started with: do not resolve it again.
 *
 * Until 2.1 every playout cycle (every 15 s) re-resolved the asset that was already on air. A
 * successful re-resolve was thrown away (start/switch only run when the target does not match),
 * but a FAILED one raised playout.asset-preparation.failed and switched the running programme to
 * the global fallback. Measured on the DUT 2026-09-28: seven of nine YouTube runs lasted exactly
 * 18 s (15 s cycle + yt-dlp error + stop) — the "YouTube aborts after a few seconds" report.
 * Skipping the resolve loses nothing: a start or switch that does happen still resolves (or reuses
 * the probe cache) inside startOrSwitchPlayout.
 */
export function shouldKeepRunningInput(input: RunningInputGuardInput): boolean {
  return input.processRunning && input.targetMatches && !input.restartRequested;
}

export interface ReconnectSlateInput {
  // STREAM247_RELAY_ENABLED: the uplink holds the destination connection, the playout only feeds the relay.
  relayEnabled: boolean;
  liveBridgeActive: boolean;
  // Direct mode only: the reconnect window opened by restartRequestedAt is still running.
  reconnectActive: boolean;
  // restartRequestedAt is set: Restart, Hard reload, Skip (also by chat vote), the crash-loop reset, a due
  // reconnect, and in direct mode Pin, Fallback, Resume, Force reconnect and Recover outputs.
  restartRequested: boolean;
}

/**
 * Put the reconnect standby slate on air for this cycle?
 *
 * The slate belongs to direct RTMP mode: there the playout's own ffmpeg holds the Twitch connection, a
 * restart drops and reopens it, and the slate covers that reconnect (42adb20, where every restart was
 * meant to show it). Under the relay the uplink owns the connection and never sees a playout restart,
 * so the slate covers nothing and only takes the programme off air. Measured on the DUT 2026-10-01
 * (v2.1.0-rc.1, relay on): an operator Play now put the slate on air for 18 s (reasonCode
 * scheduled_reconnect) and the cycle after it started a different pool item from offset 0.
 * reconnectActive is already false under the relay (4043eb6); the restart arm was not.
 */
export function shouldShowReconnectSlate(input: ReconnectSlateInput): boolean {
  if (input.liveBridgeActive) {
    return false;
  }
  return input.reconnectActive || (!input.relayEnabled && input.restartRequested);
}

// Planned stops that end the item for good: the cycle after them moves on to the next item instead of
// starting the stopped one again (duration-bound.ts, the feed watchdogs). A "switch" or
// "restart-requested" stop is different: something else, or the same item again, starts right after it.
export const ITEM_ENDING_STOP_REASONS: ReadonlySet<string> = new Set(["duration-bound", "feed-stalled", "feed-audio-stalled"]);

export interface InsertExitInput {
  // The reason stopPlayoutProcess recorded, "" for an exit nobody asked for (natural EOF, a crash).
  plannedReason: string;
  insertStatus: string;
  insertAssetId: string;
  // The runtime's on-air asset when the process exited.
  currentAssetId: string;
}

/**
 * Clear the operator insert when its process exits?
 *
 * An active insert stays selected for as long as the runtime row names it, so an insert that ends and is
 * not cleared starts again from 0 at the next cycle, for ever. Until M74 only an unplanned exit cleared
 * it; an insert ended by its duration bound (remote VODs without EOF, several times a day:
 * duration-bound.ts) or by a feed watchdog replayed. A pending insert has not aired and is not touched
 * here.
 */
export function shouldClearInsertOnExit(input: InsertExitInput): boolean {
  if (input.insertStatus !== "active" || input.currentAssetId !== input.insertAssetId) {
    return false;
  }
  return input.plannedReason === "" || ITEM_ENDING_STOP_REASONS.has(input.plannedReason);
}

export interface InsertAfterSelectionInput {
  insertStatus: string;
  selectionReasonCode: string;
  selectionIsLive: boolean;
  // A pending insert's item is still ready and not under a skip hold.
  insertAvailable: boolean;
}

export type InsertDropReason = "preempted" | "unavailable" | "live-bridge";

export interface InsertAfterSelection {
  clear: boolean;
  // Why a pending insert is dropped (logged and audited); "" for an insert that aired, which is ended,
  // not dropped, and for an insert that stays.
  dropReason: InsertDropReason | "";
}

/**
 * What the cycle does with the operator insert once the selection names something else.
 *
 * Any selection but the insert ends it: an active insert has been cut, a pending one is dropped before
 * it aired. A Live Bridge takeover used to be the exception (M74 left the insert in place), so an insert
 * on air at the takeover started again from 0 after the release, and a pending Play now aired whenever
 * the bridge was released, possibly hours later. Since M78 the takeover ends an active insert and drops
 * a pending one as "live-bridge"; after the release the schedule continues. A Pin or Fallback (the
 * override arm, before the insert arm) drops a pending insert as "preempted".
 */
export function decideInsertAfterSelection(input: InsertAfterSelectionInput): InsertAfterSelection {
  if (input.insertStatus === "" || input.selectionReasonCode === "operator_insert") {
    return { clear: false, dropReason: "" };
  }
  if (input.insertStatus !== "pending") {
    return { clear: true, dropReason: "" };
  }
  return {
    clear: true,
    dropReason: input.selectionIsLive ? "live-bridge" : input.insertAvailable ? "preempted" : "unavailable"
  };
}

export interface InsertPrepareFailureInput {
  selectionReasonCode: string;
  insertStatus: string;
  insertAssetId: string;
  // A playout ffmpeg process is alive, and the runtime's on-air asset ("" for none).
  processRunning: boolean;
  currentAssetId: string;
}

// "drop": a pending insert, cleared before it aired. "end": an insert that aired and is no longer the
// item on air. "recover": not the insert's own failure, the recovery plan runs.
export type InsertPrepareFailure = "drop" | "end" | "recover";

/**
 * What the cycle does when the operator insert it selected cannot be prepared.
 *
 * While something is on air, a pending insert is the insert's failure, not the programme's: it is dropped
 * and the item on air stays (M74). An insert that is itself on air and fails to prepare for a Restart is
 * the programme's failure, and the recovery plan covers it. With nothing on air the recovery plan runs
 * too, so the channel is not left dark.
 *
 * That left one row for good (combination review): the recovery's fallback is not an operator_insert
 * selection, so the cycle-end write keeps the insert `active`, the "restart-requested" stop does not
 * clear it (shouldClearInsertOnExit), and decideInsertAfterSelection keeps an insert the selection still
 * names. Every cycle after it selected the insert again and resolved it inline, up to the resolve
 * timeout, with the fallback on air until Resume. An insert has no resume (M78): once another item is on
 * air it is ended, and the schedule continues.
 */
export function decideInsertAfterPrepareFailure(input: InsertPrepareFailureInput): InsertPrepareFailure {
  if (input.selectionReasonCode !== "operator_insert" || !input.processRunning || input.currentAssetId === "") {
    return "recover";
  }
  if (input.insertStatus === "pending") {
    return "drop";
  }
  return input.insertStatus === "active" && input.currentAssetId !== input.insertAssetId ? "end" : "recover";
}

export interface PreviousAssetInput {
  // The runtime's on-air asset when the cycle began, "" after an exit cleared it (or for a slate).
  onAirAtCycleStart: string;
  // lastSuccessfulAssetId: the asset the last cleanly ended (or long-running) process played.
  lastEndedAssetId: string;
  // What the cycle puts or keeps on air: "" for a slate or standby.
  incomingAssetId: string;
  incomingIsLive: boolean;
  previousAssetId: string;
}

/**
 * The asset Replay previous offers: the last one that left the air for something else.
 *
 * The cycle used to compare the runtime row it re-read at its end, after startOrSwitchPlayout had
 * already written the new asset into it, so the outgoing asset never differed from the incoming one and
 * previousAssetId stayed empty for good. The outgoing asset is what was on air when the cycle began; at a
 * natural end the exit handler has already cleared that, and the asset it just ended is
 * lastSuccessfulAssetId. A restart of the same asset, or a slate, leaves the previous asset as it is.
 */
export function decidePreviousAssetId(input: PreviousAssetInput): string {
  const outgoing = input.onAirAtCycleStart || input.lastEndedAssetId;
  if (outgoing === "") {
    return input.previousAssetId;
  }
  if (input.incomingIsLive || (input.incomingAssetId !== "" && input.incomingAssetId !== outgoing)) {
    return outgoing;
  }
  return input.previousAssetId;
}

export interface RunningAssetTargetInput {
  // What the selection asks for: "insert" for operator_insert / scheduled_insert, otherwise "asset".
  desiredKind: "asset" | "insert";
  desiredAssetId: string;
  // What the running process was started as.
  runningKind: string;
  runningAssetId: string;
}

/**
 * Is the item the selection names the one already on air, so the process keeps running?
 *
 * Same asset and same kind, as always. In addition, an item on air as an insert that the schedule now
 * picks as its own item runs on: Resume during a Play now of the pool's own next item (on the DUT the
 * YouTube items belong to the same pool as the archives), or a Pin of the insert on air. Comparing the
 * kind as well restarted that item from 0 -- the same item, cut and started again (M74 review). The other
 * direction (an item on air as itself, then asked for as an insert) is not a hand-over; the admin
 * refuses Play now for the item on air.
 */
export function runningAssetTargetMatches(input: RunningAssetTargetInput): boolean {
  if (input.runningAssetId === "" || input.runningAssetId !== input.desiredAssetId) {
    return false;
  }
  return input.runningKind === input.desiredKind || (input.desiredKind === "asset" && input.runningKind === "insert");
}

export interface PoolPositionInput {
  selectionReasonCode: string;
  selectedAssetId: string;
  // The runtime row the cycle selected from: what was on air and why.
  runtimeCurrentAssetId: string;
  runtimeReasonCode: string;
}

/**
 * Does this cycle's selection take the pool position (the cursor write, and the queue walk after it)?
 *
 * A scheduled match that starts a new item does (M73). An item that simply runs on does not -- an archive
 * another pool started, a Move next that plays to its end. One more case does: an item on air as an
 * operator insert that the pool now picks as its own next item (Resume of a Play now of exactly that
 * item). The selection skips the running insert as the pool's current item, so this pick came from the
 * pool's position, and leaving the position where it was played the item a third time after its end.
 */
export function selectionTakesPoolPosition(input: PoolPositionInput): boolean {
  if (input.selectionReasonCode !== "scheduled_match" || input.selectedAssetId === "") {
    return false;
  }
  return input.runtimeCurrentAssetId !== input.selectedAssetId || input.runtimeReasonCode === "operator_insert";
}

export interface InsertFields {
  insertAssetId: string;
  insertRequestedAt: string;
  insertStatus: "" | "pending" | "active";
}

export interface CycleEndInsertInput {
  selectionIsOperatorInsert: boolean;
  selectedAssetId: string;
  // The runtime row as the cycle-end write finds it: the admin may have changed it while the cycle ran.
  row: InsertFields;
  now: string;
}

/**
 * The insert fields the cycle-end write leaves.
 *
 * The cycle that starts an insert marks it active -- but only if the row still names that insert. The
 * cycle can run for a minute or more (an inline yt-dlp or Twitch resolve) and the admin writes the row
 * meanwhile: a Resume that cancelled the insert, or a newer Play now, used to be overwritten with the
 * old insert, active, which then played to its end (M74 review). Otherwise the row's fields stand.
 */
export function decideCycleEndInsert(input: CycleEndInsertInput): InsertFields {
  if (input.selectionIsOperatorInsert && input.selectedAssetId !== "" && input.row.insertAssetId === input.selectedAssetId) {
    return {
      insertAssetId: input.selectedAssetId,
      insertRequestedAt: input.row.insertRequestedAt || input.now,
      insertStatus: "active"
    };
  }
  return { ...input.row };
}

export interface CycleEndStatusInput<S extends string> {
  // What the cycle's selection makes of the air (running, recovering, standby, reconnecting).
  computed: S;
  // The status on the row as the cycle-end write finds it.
  row: S;
  // A playout process is running at the moment of the write.
  processRunning: boolean;
}

/**
 * The status the cycle-end write leaves (M105).
 *
 * The write describes the item the cycle started as on air. When that ffmpeg has already ended and its
 * exit write came first (an input refused at once, while the start's own writes ran), the row says
 * `failed` (or `degraded` for the crash-loop guard) with nothing running; overwritten with `running`, the
 * next cycle owed the item no retry (decideInputOpenRetry reads `failed`) and the crash-loop state read as
 * healthy. That status stands; anything else is the cycle's to write, as before.
 */
export function decideCycleEndStatus<S extends string>(input: CycleEndStatusInput<S>): S {
  if (!input.processRunning && (input.row === "failed" || input.row === "degraded")) {
    return input.row;
  }
  return input.computed;
}

export interface CycleEndRestartFlagInput {
  // The restart flag this cycle read when it decided whether to restart ("" when it read none).
  consumed: string;
  // The flag on the row as the write finds it: the admin, or the chat's skip vote, may have set a newer one.
  row: string;
  // The flag doubles as the start of direct mode's reconnect window (scheduled reconnect, Force reconnect,
  // a Restart without the relay); a write inside that window leaves it as it is.
  keepReconnectWindow: boolean;
  // When the process on air was spawned (ms), 0 for none. A flag written before it is satisfied by it.
  spawnedAtMs?: number;
}

/**
 * The restart flag a playout write of the cycle leaves (M89, H4).
 *
 * The cycle reads the row once, decides, and can then run for a minute or more (an inline resolve, the
 * queue probes, the start) before it writes. Its writes used to clear the flag from a constant, so a
 * Restart, Hard reload, Recover outputs or Force reconnect pressed while the cycle ran -- or a skip vote
 * the chat loop applied meanwhile -- was erased without a restart, while the admin had answered
 * "requested". Now only the value the cycle read is cleared: the same value is the one it acted on, a
 * newer one is the next cycle's, and the reconnect window keeps whatever the row holds, as before.
 */
export function decideCycleEndRestartFlag(input: CycleEndRestartFlagInput): string {
  if (input.keepReconnectWindow) {
    return input.row;
  }
  if (input.row === input.consumed) {
    return "";
  }
  // A flag newer than the one the cycle read but older than the spawn of the process now on air was
  // satisfied by that spawn (review finding R1, 2026-10-05). It was aimed at the item the cycle was
  // already switching away from: a Skip, a passed chat vote or a Restart of B pressed while the cycle
  // resolved C. Kept, it stopped C on the next cycle and started it again from 0, and the as-run log
  // recorded an operator restart nobody pressed. A press after the spawn is still the next cycle's.
  const writtenAtMs = Date.parse(input.row);
  if ((input.spawnedAtMs ?? 0) > 0 && Number.isFinite(writtenAtMs) && writtenAtMs <= (input.spawnedAtMs ?? 0)) {
    return "";
  }
  return input.row;
}

export interface PendingActionFields {
  pendingAction: "" | "refresh" | "rebuild_queue";
  pendingActionRequestedAt: string;
}

/**
 * The pending action (Refresh, a queue rebuild) a playout write of the cycle leaves (M89, H4).
 *
 * As for the restart flag: the action the cycle read, with its request time, is the one it carried out
 * and is cleared; one the admin wrote since (a second Refresh, the rebuild of a Move next or Remove next)
 * stands for the next cycle.
 */
export function decideCycleEndPendingAction(input: { consumed: PendingActionFields; row: PendingActionFields }): PendingActionFields {
  if (
    input.row.pendingAction === input.consumed.pendingAction &&
    input.row.pendingActionRequestedAt === input.consumed.pendingActionRequestedAt
  ) {
    return { pendingAction: "", pendingActionRequestedAt: "" };
  }
  return { pendingAction: input.row.pendingAction, pendingActionRequestedAt: input.row.pendingActionRequestedAt };
}

/**
 * The insert fields a failed start or switch leaves (M89, H4).
 *
 * The failure ends the insert this cycle read: it could not start, and it is recorded as dropped. A Play
 * now the admin wrote while the cycle ran is a different request (another item, or the same item asked
 * for again) and stands for the next cycle; the failure used to clear it with the rest.
 */
export function decideFailedCycleInsert(input: { consumed: InsertFields; row: InsertFields }): InsertFields {
  if (input.row.insertAssetId === input.consumed.insertAssetId && input.row.insertRequestedAt === input.consumed.insertRequestedAt) {
    return { insertAssetId: "", insertRequestedAt: "", insertStatus: "" };
  }
  return { ...input.row };
}
