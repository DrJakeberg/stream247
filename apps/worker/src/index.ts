import { promises as fs } from "node:fs";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { abortableDelay } from "./abortable-delay.js";
import {
  canBlameUplinkForStall,
  createUplinkDiscontinuityState,
  createUplinkProgressState,
  isDiscontinuityStorm,
  observeDiscontinuityLine,
  type UplinkDiscontinuityState,
  getUplinkStallOptions,
  hasNeverProgressed,
  isUplinkStalled,
  shouldRestartForNoProgress,
  observeUplinkProgress,
  pickUplinkGroupStartedAt,
  type UplinkProgressState
} from "./uplink-progress.js";
import nodemailer from "nodemailer";
import path from "node:path";
import type { Writable } from "node:stream";
import {
  DEFAULT_DESTINATION_FAILURE_COOLDOWN_SECONDS,
  addDaysToDateString,
  buildOverlayScenePayload,
  type OverlayChatView,
  type OverlayEngagementView,
  type OverlayGameView,
  buildOverlayTextLinesFromScenePayload,
  isEngagementChatRuntimeEnabled,
  formatCuepointOffsetLabel,
  buildScheduleOccurrences,
  describePresenceStatus,
  findCurrentScheduleOccurrence,
  findNextScheduleOccurrence,
  getDestinationFailureSecondsRemaining as getDestinationFailureHoldSecondsRemaining,
  getCurrentScheduleMoment,
  isDestinationFailureCoolingDown,
  listUpcomingScheduleOccurrences,
  lookaheadVideoTitleFromPool as lookaheadPoolVideoTitle,
  normalizeLiveBridgeInputType,
  isLikelyTwitchChannelUrl,
  isLikelyTwitchVodUrl,
  isLikelyYouTubeChannelUrl,
  isLikelyYouTubePlaylistUrl,
  resolveOverlayScenePresetForQueueKind,
  summarizeLiveBridgeInput,
  type LiveBridgeInputType,
  toUtcIsoForLocalDateTime,
  createDefaultChatInteractionConfig,
  formatChatGameInfoReply,
  formatChatGameNoRoomReply,
  type ChatGameCommand,
  evaluateViewerRequest,
  type ChatInteractionConfig,
  TWITCH_METADATA_WAITING_MESSAGE,
  isBroadcastChannelSplit,
  resolveBroadcastChannelLogin,
  resolveTwitchMetadataSyncGate,
  buildAssetChaptersFromSourceMetadata,
  buildAssetChapterWindowKey,
  describeSourceHealth,
  getAssetChapterAt,
  getDueAssetChapterBoundaries,
  parseAssetChaptersJson,
  serializeAssetChapters,
  resolveAlertsRuntimeEnabled,
  resolveAssetRetentionConfig,
  resolveDiskWatermarkConfig,
  resolveEncoderQualitySettings,
  resolveSystemVolumeWatermarkConfig,
  resolveSourceLayerRuntimeEnabled,
  resolveSourceLiveEnabled,
  resolveSourceLiveGainPercent,
  resolveSourceLayerPixelBox,
  resolveSourceSnapshotIntervalSeconds,
  resolveTwitchEventSubSecret,
  resolveTwitchScheduleSyncEnabled,
  type OverlayCustomLayerView,
  type OverlaySourceFrameView,
  type ResolvedEncoderQualitySettings,
  redactSecrets,
  resolveChatSettingsWrite,
} from "@stream247/core";
import {
  buildSourceLiveStateWrite,
  buildStartedSourceLiveStateWrite,
  closedAttachBreaker,
  decideSourceLiveAttach,
  fetchRelaySourcePresence,
  isAttachBreakerOpen,
  openAttachBreaker,
  type SourceLiveStateWrite
} from "./relay-presence.js";
import {
  appendSourceSyncRuns,
  appendAuditEvent,
  appendPresenceWindowRecord,
  readManagedDestinationStreamKeys,
  replaceAssetsForSourceIds,
  readAppState,
  replaceTwitchScheduleSegments,
  resolveAppBaseUrl,
  resolveChannelTimeZone,
  resolveIncident,
  updateDestinationRecord,
  updateEngagementGameRuntimeRecord,
  updateAssetChapterProbeRecords,
  updateAssetRecords,
  updatePlayoutRuntime,
  updatePoolCursor,
  updateTwitchBroadcasterConnectionRecord,
  updateTwitchConnectionRecord,
  upsertSources,
  upsertIncident,
  type AppState,
  type AssetRecord,
  type OutputSettingsRecord,
  type StreamDestinationRecord,
  readChatInteractionSettingsRecord,
  readChatOverlayMessagesRecord,
  readChatSkipVoteRecord,
  readChatVoteSessionRecord,
  writeChatOverlayMessagesRecord,
  writeChatSkipVoteRecord,
  writeChatVoteSessionRecord,
  type ChatOverlayMessagesRecord,
  type ChatSkipVoteRecord,
  type ChatVoteSessionRecord,
  clearChatGameRuntimeRecord,
  readChatGameRuntimeRecord,
  readChatGameSettingsRecord,
  writeChatGameSettingsRecord,
  updateAppState,
  readDatabaseSizeBytes,
  runAssetRetentionSweep,
  writeChatGameRuntimeRecord,
  readManagedConfigRecord,
  readOverlayVideoSourceUrls,
  recordOverlayVideoSourceLiveState,
  type ManagedConfigRecord,
  appendChatViewerRequestRecord,
  listRecentChatViewerRequests,
  countQueuedChatViewerRequests,
  markChatViewerRequestsPlayed,
} from "@stream247/db";
import {
  ON_AIR_SCENE_PIPE_FD,
  ON_AIR_SCENE_PIPE_FRAMERATE,
  ON_AIR_SCENE_PIPE_FRAME_INTERVAL_MS,
  ON_AIR_SCENE_PIPE_QUEUE_FRAMES,
  ON_AIR_SCENE_PIPE_LEAD_FRAMES,
  framesDueByNow,
  getSceneRendererIntervalMs,
  getSceneRendererViewport,
  type OnAirOverlayMode
} from "./on-air-scene.js";
import { incrementQueueVersion, prioritizeManualNextAsset } from "./broadcast-queue.js";
import { getChapterBackfillConfig, probeAssetChapters, selectChapterBackfillCandidates } from "./chapter-backfill.js";
import { isDirectMediaUrl, planDirectMediaSync } from "./direct-media.js";
import { buildLocalLibraryAssetId, buildLocalLibraryFolderPath, scanMediaFiles } from "./local-library.js";
import { resolvePoolAudioLane, type ResolvedAudioLane } from "./audio-lanes.js";
import { getCuepointInsertPlan } from "./cuepoints.js";
import {
  buildFfmpegOutputTarget,
  evaluateUplinkDestinationStall,
  groupDestinationRuntimeTargetsByOutputProfile,
  getLegacyDestinationEnvConfig,
  matchDestinationFailuresInLog,
  resolveDestinationStreamTarget,
  selectDestinationRuntimeTargets,
  selectUplinkStopStrategy,
  type DestinationRuntimeTarget,
  type DestinationRuntimeTargetGroup
} from "./multi-output.js";
import { logRuntimeEvent } from "./runtime-log.js";
import { AlertDeduper, deliverAlert } from "./alerts.js";
import {
  ensureLocalAssetThumbnail,
  getAssetThumbnailPath,
  getThumbnailDirectory,
  selectEvictableThumbnails,
  type ThumbnailFileInfo
} from "./asset-thumbnails.js";
import {
  collectDiskProtectedAssetIds,
  decideDiskWatermarkAction,
  type DiskWatermarkStage,
  type DiskWatermarkStageResult
} from "./disk-watermark.js";
import { decideSystemVolumeObservation } from "./system-volume.js";
import {
  captureSourceSnapshot,
  deriveSourceFrameStatus,
  getSourceSnapshotDirectory,
  getSourceSnapshotPath,
  resolveSourceSnapshotTimeoutMs,
  selectEvictableSourceFrames,
  shouldRaiseSourceSnapshotIncident,
  shouldStartSourceCapture,
  summarizeSourceFeed,
  type SourceFrameFileInfo
} from "./source-snapshot.js";
import {
  appendFfmpegOutputArgs,
  buildProgramFeedOutputTarget,
  buildUplinkFfmpegCommand,
  describeFfmpegExit,
  buildFfmpegInputArgs,
  buildSourceLivePipFilterComplex,
  buildSourceLivePipInputArgs,
  decideLiveSourceAudio,
  getProgramFeedConfig,
  getRelayInputUrl,
  getRelayPublishUrl,
  getPlayoutReconnectConfig,
  getUplinkInputMode,
  isRelayModeEnabled,
  isLikelyDestinationOutputError,
  isLikelyProgramFeedInputError,
  isNaturalPlayoutBoundary,
  shouldRequestImmediatePlayoutRetry,
  shouldSkipInitialSceneCapture,
  type SourceLivePipAudio
} from "./ffmpeg-runtime.js";
import { clampToCycleAwaitCeiling, getLoopStallTimeoutMs } from "./cycle-budget.js";
import { VodCacheJobRunner } from "./vod-cache-jobs.js";
import {
  ChatControlRuntime,
  buildEngagementOverlayViewFromSkipVote,
  buildEngagementOverlayViewFromVoteSession,
  chooseEngagementOverlayView,
  type ChatControlEffect
} from "./chat-control.js";
import { buildChatOverlayViewFromMessages } from "./chat-overlay.js";
import {
  loadSceneRendererFonts,
  renderSceneFrame,
  sceneFrameCacheKey,
  type SceneRenderFont,
  type SceneRenderRequest
} from "./scene-renderer.js";
import { execFileText, runWithStallGuard } from "./process-utils.js";
import {
  createFeedAudioState,
  getFeedAudioOptions,
  isFeedAudioStalled,
  observeFeedAudio
} from "./feed-audio-health.js";
import {
  ensureTwitchVodCache,
  buildTwitchVodCachePath,
  canReleaseVodCache,
  collectReleasableVodCachePaths,
  evictUnusedTwitchVodCache,
  formatGigabytes,
  getTwitchVodCacheConfig,
  peekTwitchVodCache,
  isInternalMediaCachePath,
  isTwitchVodAsset,
  isTwitchVodCacheCoolingDown
} from "./twitch-vod-cache.js";
import { planRecoveryAfterPlaybackPreparationFailure } from "./playout-recovery.js";
import { measureIncidentAreaHealth, planIncidentResolutions } from "./incident-classes.js";
import { getPlayoutFeedHealthOptions, shouldRestartStalledPlayout } from "./playout-feed-health.js";
import { getDurationBoundOptions, shouldEndAssetAtDurationBound } from "./duration-bound.js";
import {
  PROGRAM_FEED_SWEEP_LIMIT,
  selectStaleProgramFeedSegments,
  sumSegmentBytes
} from "./program-feed-maintenance.js";
import {
  decideBoundaryPlaybackInput,
  isBroadcastCoverageDown,
  isImmediateInputOpenFailure,
  shouldBridgeToFallbackBeforeResolve
} from "./playout-boundary.js";
import { decideQueuePrefetchBudget, planQueuePrefetch, raceResolveAgainstDeath } from "./queue-prefetch.js";
import { LoopWakeLatch } from "./loop-wake.js";
import { ProgrammeGapTracker } from "./playout-gap.js";
import {
  buildPreservedAssetsNote,
  decideSourceDroughtIncident,
  describeSourceSyncStatus,
  planSourceAssetReplacement,
  planSourceIncidentResolution,
  type SourceSyncOutcome
} from "./source-sync-scope.js";
import { buildAssetDisplayTitle } from "./asset-display-title.js";
import { buildTwitchMetadataTitle } from "./twitch-metadata.js";
import { ActiveChatterRoster } from "./active-chatters.js";
import { EngagementGameTracker } from "./engagement-game.js";
import {
  ChatGameRuntime,
  buildChatGameOverlayViewFromRuntimeRecord,
  hasActiveChatGameLayer,
  resolveChatGameLayerProvisioning,
  resolveChatGameLayerTeardown
} from "./chat-game.js";
import {
  getOutputGopSize,
  getOutputScaleFactor,
  getOutputVideoFilter,
  getWorkerStreamOutputSettings,
  isStreamScaleEnabled,
  type WorkerStreamOutputSettings
} from "./output-settings.js";
import { createTwitchUserIdResolver } from "./twitch-broadcast-channel.js";
import { describeChatConnectionPhase, TwitchChatBridge } from "./twitch-engagement.js";
import { syncTwitchEventSubSubscriptions } from "./twitch-eventsub.js";
import { fetchTwitchLiveStatus } from "./twitch-live-status.js";
import { decideTwitchChannelMetadataWrite } from "./twitch-sync-policy.js";
import { decideTwitchConnectionHeal, validateTwitchAccessToken } from "./twitch-connection-heal.js";

/** The single synthetic source every locally mounted file belongs to — the global fallback included. */
const LOCAL_LIBRARY_SOURCE_ID = "source-local-library";
let playoutProcess: ChildProcess | null = null;
let playoutProcessStartedAtMs = 0;
let playoutAssetId = "";
let playoutDestinationId = "";
let playoutDestinationIds: string[] = [];
let playoutRuntimeTargets: DestinationRuntimeTarget[] = [];
let playoutTargetKind: "asset" | "insert" | "standby" | "reconnect" | "live" | "" = "";
let playoutResolvedInput = "";
let playoutLastStderrSample = "";
let playoutLiveBridgeInputUrl = "";
let playoutLiveBridgeInputType: LiveBridgeInputType | "" = "";
// M57 stage 2, Etappe C. Two flags because the renderer and the breaker ask different questions.
// `playoutLiveSourceAttached` is the renderer's: skip the opaque snapshot panel whenever we INTEND
// to attach (set before the initial frame is drawn, so the panel never flashes over the live
// video); harmless if a scene-render fallback means no PiP is actually built, because text mode
// draws no source panel anyway. `playoutLiveSourceInputActive` is the breaker's: it is true only
// when a live PiP input was really placed in the running command, so a plain program failure in a
// scene-render fallback can never be blamed on — and open the breaker over — a PiP that was never
// there.
let playoutLiveSourceAttached = false;
let playoutLiveSourceInputActive = false;
// M57 stage 2, Etappe E. What the studio was last told about a pushed source, and the chain the
// telling runs on.
//
// The write is fire-and-forget on purpose: it sits on the reconciliation path, which the comment
// at resolveLiveSourceAttach's caller warns must not await anything expensive before
// startOrSwitchPlayout, and recordOverlayVideoSourceLiveState takes the global state-write lock
// with no timeout of its own. Observation data must never be able to hold up the broadcast path.
//
// Chained rather than simply detached because the lock is a Postgres advisory lock, not an
// in-process queue: two loose writes could commit in the wrong order and leave the studio showing
// the older state. Tail-chaining keeps submission order, and the dedupe key keeps the chain short.
let lastSourceLiveStateKey = "";
let sourceLiveStateWriteChain: Promise<void> = Promise.resolve();
// Chapter boundaries already announced for the current playback window. In-memory on purpose:
// the window key is (asset id, process start), and both this fired set and the ffmpeg process
// die together — a worker restart replays the asset from second zero, so the boundaries must
// re-fire, which an empty set after restart does automatically.
let chapterBoundaryWindowKey = "";
let chapterBoundaryFiredKeys: string[] = [];
// When the worker process last PATCHed helix/channels. Worker-process state (reconcileTwitch runs
// only there); losing it on restart merely allows one immediate write, which is the safe side of
// a throttle.
let lastChannelMetadataWriteAtMs = 0;
// What the chat-settings sync last wrote and when: the write is decided per cycle, not repeated.
let lastChatSettingsWrite: { emoteOnly: boolean | null; atMs: number } = { emoteOnly: null, atMs: 0 };
const CHAT_SETTINGS_REASSERT_INTERVAL_MS = 10 * 60_000;
let plannedStopReason = "";
let uplinkProcesses: UplinkProcessRuntime[] = [];
let uplinkReconnectUntil = "";
const uplinkDestinationStallStartedAt: Map<string, number> = new Map();
// Worker reconciliation can legitimately run for a little over two minutes when
// source sync and Twitch reconciliation happen in one cycle, so keep the stale
// window above the steady-state cadence to avoid false healthcheck failures.
const WORKER_HEARTBEAT_STALE_MS = 240_000;
type WorkerScheduleOccurrence = ReturnType<typeof buildScheduleOccurrences>[number];
const PLAYOUT_HEARTBEAT_STALE_MS = 60_000;
// Hard ceiling on a single reconciliation cycle. If a cycle neither resolves
// nor rejects within this window it is treated as a hung loop (e.g. an
// unbounded yt-dlp/fetch network stall) and the process exits so the
// `restart: unless-stopped` policy brings up a fresh process instead of the
// loop hanging silently for hours while the heartbeat goes stale.
const LOOP_STALL_TIMEOUT_MS = getLoopStallTimeoutMs(process.env);
// Timeout for resolving a remote playable URL via yt-dlp `--get-url`. Without
// this, a network stall to the source leaves the playout-selection await
// hanging forever and wedges the whole playout loop. Clamped to the cycle-await
// ceiling so an operator-configured value can never outlive the stall guard.
const PLAYABLE_INPUT_RESOLVE_TIMEOUT_MS = (() => {
  const raw = process.env.STREAM247_PLAYABLE_INPUT_RESOLVE_TIMEOUT_SECONDS;
  const parsed = raw === undefined || raw === "" ? Number.NaN : Number.parseInt(raw, 10);
  const configured = Number.isFinite(parsed) && parsed > 0 ? parsed * 1000 : 60_000;
  return clampToCycleAwaitCeiling(configured, process.env).effectiveMs;
})();
// One roster of who is talking, shared by the engagement game and the skip vote, so the count the
// overlays page prints is the count a skip needs a share of. See active-chatters.ts.
const activeChatters = new ActiveChatterRoster();
const engagementGameTracker = new EngagementGameTracker(activeChatters);
// Owns the live vote and skip tallies. See chat-control.ts.
const chatControl = new ChatControlRuntime({
  activeChatters,
  onEvent: (event, fields) => logRuntimeEvent(event, fields)
});
// Owns the running chat game (snake). See chat-game.ts.
const chatGameRuntime = new ChatGameRuntime({
  onEvent: (event, fields) => logRuntimeEvent(event, fields)
});
const twitchChatBridge = new TwitchChatBridge({
  async onModeratorPresenceCheckIn(window) {
    try {
      await appendPresenceWindowRecord({
        actor: window.actor,
        minutes: window.minutes,
        requestedMinutes: window.requestedMinutes,
        appliedMinutes: window.appliedMinutes,
        clampReason: window.clampReason,
        createdAt: window.createdAt.toISOString(),
        expiresAt: window.expiresAt.toISOString()
      });
      await appendAuditEvent(
        "moderation.checkin",
        `${window.actor} checked in for ${window.appliedMinutes} minutes via Twitch chat (${window.clampReason}).`
      );
    } catch (error) {
      // Recorded where the operator looks, then rethrown so the bridge tells the moderator.
      await upsertIncident({
        scope: "twitch",
        severity: "warning",
        title: "A moderator check-in was not saved",
        message: `${window.actor}'s check-in for ${window.appliedMinutes} minutes could not be written: ${error instanceof Error ? error.message : String(error)}`,
        fingerprint: "moderation.checkin.persist-failed"
      }).catch(() => undefined);
      throw error;
    }
  },
  onChatMessage(message) {
    engagementGameTracker.recordChatMessage({
      actor: message.actor,
      createdAt: message.createdAt
    });

    // Synchronous and non-throwing by contract: this runs inside the IRC socket data handler.
    // The heavier consequences (promoting a vote winner, queueing a request, forcing a boundary)
    // are applied by the worker cycle, which reads the runtime's state.
    const effect = chatControl.handleMessage({
      actor: message.actor,
      message: message.message,
      currentAssetId: latestPlayoutAssetId,
      config: latestChatInteractionConfig
    });

    if (effect.kind === "skip-passed" || effect.kind === "request") {
      pendingChatEffects.push(effect);
    }

    // Every accepted skip vote goes on air within a second (see CHAT_SKIP_FLUSH_DELAY_MS). The
    // passed campaign flushes too: its full bar stays honest on screen until the worker cycle
    // applies the skip and clears the row.
    if (effect.kind === "skip-recorded" || effect.kind === "skip-passed") {
      scheduleChatSkipFlush();
    }

    // The game shares the same intake as votes: every message, before the display rate limiter,
    // so emote-only rooms still steer it. Inputs apply synchronously in arrival order — several
    // emotes between two rendered frames move the snake several cells, which is the intended
    // behaviour of a game that moves only on input.
    if (chatGameRuntime.handleChatMessage(message.message)) {
      scheduleChatGameFlush();
    }
  },
  onChatGameCommand: (args) => handleChatGameCommand(args),
  // Any change to the overlay-facing buffer — a message that passed the display limiter, a
  // moderation removal, a disconnect clearing everything — reaches the persisted row within the
  // flush window. Moderation is why this cannot wait for the worker cycle: a deleted message
  // must leave the broadcast in about a second, not in up to thirty.
  onOverlayMessagesChanged() {
    scheduleChatOverlayFlush();
  },
  // A refused login is the one chat fault an operator has to act on: the token cannot read chat,
  // so no amount of reconnecting will help. It gets an incident rather than another disconnect
  // line, because the fix is granting chat access and reconnecting the Twitch account.
  onConnectionPhaseChanged(phase, detail) {
    logRuntimeEvent("chat.connection.phase", { phase, detail });
    if (phase === "login-rejected") {
      void upsertIncident({
        scope: "twitch",
        severity: "warning",
        title: "Twitch chat login refused",
        message: `${describeChatConnectionPhase(phase)}. Twitch said: ${detail || "login refused"}.`,
        fingerprint: "twitch.chat.login-rejected"
      }).catch(() => undefined);
      return;
    }

    // "idle" means chat was switched off, which retires the request to reconnect just as a
    // successful login does — otherwise the incident would outlive the feature it describes.
    if (phase === "connected" || phase === "idle") {
      void resolveIncident("twitch.chat.login-rejected", describeChatConnectionPhase(phase)).catch(() => undefined);
    }
  }
});
// Latest values the IRC handler needs but cannot fetch itself, refreshed by the worker cycle.
let latestPlayoutAssetId = "";
let latestChatInteractionConfig = createDefaultChatInteractionConfig();
// Latest engagement settings, cached by the worker cycle for the chat-overlay flush. Null until
// the first cycle: flushing before settings are known could only write a wrong gate.
let latestEngagementSettings: AppState["engagement"] | null = null;
// Managed config from the most recent cycle read of whichever mode this process runs (worker,
// playout and uplink each refresh it), for the readers that fire between or inside cycles: the
// throttled chat flush, the watchdog thresholds, the feed geometry and the VOD cache tuning.
// Null only before the first cycle, which resolves as env-only — exactly the pre-M56 behaviour.
let latestManagedConfig: AppState["managedConfig"] | null = null;
// Effects the socket handler cannot apply itself; drained by the worker cycle.
const pendingChatEffects: ChatControlEffect[] = [];

// A game command may do real work at most this often. Info is a pair of reads, starting a round is
// an overlay write plus a settings write plus a reconcile — a room typing "!game" in unison must
// not turn that into a write storm, and Twitch would drop the duplicate replies anyway.
const CHAT_GAME_COMMAND_COOLDOWN_MS = 5_000;
let lastChatGameCommandAt = 0;

/**
 * Answers a game command from chat.
 *
 * Info is open to the room; starting and stopping a round are moderator-only, because they switch
 * a panel on and off in the live broadcast — the one surface viewers cannot opt out of. The
 * moderator badge is what Twitch puts on the operator's own account, so this needs no broadcaster
 * right and no API call: the badge arrives in the PRIVMSG tags.
 *
 * Returns the line to say back, or "" for silence.
 */
async function handleChatGameCommand(args: {
  command: ChatGameCommand;
  actor: string;
  isModerator: boolean;
}): Promise<string> {
  const now = Date.now();
  if (now - lastChatGameCommandAt < CHAT_GAME_COMMAND_COOLDOWN_MS) {
    return "";
  }
  lastChatGameCommandAt = now;

  const settings = await readChatGameSettingsRecord();

  if (args.command.kind === "info") {
    // The settings row names which game the rules are for; the runtime says whether a round is
    // actually on air. Both are needed: settings alone would announce a game nobody can see.
    return formatChatGameInfoReply({
      running: chatGameRuntime.isActive() ? { gameId: settings.gameId } : null,
      settings
    });
  }

  if (!args.isModerator) {
    return `${args.actor}: only a moderator can start or stop a game. Type !game to see what is running.`;
  }

  if (args.command.kind === "stop") {
    await updateAppState((state) => ({ ...state, overlay: { ...state.overlay, ...resolveChatGameLayerTeardown(state.overlay) } }));
    await reconcileChatGame();
    await appendAuditEvent("chat.game.stopped", `${args.actor} stopped the chat game from Twitch chat.`);
    return "Game stopped.";
  }

  const gameId = args.command.gameId;
  // The overlay first, then the rules: reconcileChatGame reads both, and a settings row naming a
  // game nobody can see would be the exact state the operator reported — a game that "does
  // nothing". Writing the layer first means the worst interleaving is an empty panel for one
  // cycle, never a silently ignored round.
  const written = await updateAppState((state) => {
    const provisioning = resolveChatGameLayerProvisioning(state.overlay);
    return provisioning.ok ? { ...state, overlay: { ...state.overlay, ...provisioning.overlay } } : state;
  });
  // Judged on the state as written, never on what chat asked for: normalizeState drops layers past
  // the studio's cap without a word, and a reply built from the intent would announce a board
  // nobody can see. Nothing else is touched on a refusal — no rules row, no audit line, and the
  // overlay is exactly as the operator left it.
  if (!hasActiveChatGameLayer(written.overlay)) {
    return formatChatGameNoRoomReply({ gameId, layerCount: written.overlay.customLayers.length });
  }
  await writeChatGameSettingsRecord({ ...settings, gameId, updatedAt: new Date().toISOString() });
  // Immediately, not on the next cycle: a viewer who typed "!snake" and waits half a minute for a
  // board concludes the command did not work and types it again.
  await reconcileChatGame();
  await appendAuditEvent("chat.game.started", `${args.actor} started ${gameId} from Twitch chat.`);

  return formatChatGameInfoReply({ running: { gameId }, settings: { ...settings, gameId } });
}

// Game-state writes are throttled to one per this window. State writes go through the global
// serialisation lock, and a room hammering four emotes must not turn into a write per message —
// while the 30s worker cycle alone would leave the on-air snake half a minute behind the chat
// that steers it. One flush a second keeps both sides honest; playout reads on its own cadence.
const CHAT_GAME_FLUSH_DELAY_MS = 1_000;
let chatGameFlushTimer: NodeJS.Timeout | null = null;

function scheduleChatGameFlush(): void {
  if (chatGameFlushTimer) {
    return;
  }

  chatGameFlushTimer = setTimeout(() => {
    chatGameFlushTimer = null;
    void flushChatGameRuntime().catch((error: unknown) => {
      // A failed flush loses at most one second of moves, and the next input reschedules; the
      // round itself lives in memory and the worker cycle flushes again anyway.
      logRuntimeEvent("chat.game.flush_failed", {
        error: error instanceof Error ? error.message : String(error)
      });
    });
  }, CHAT_GAME_FLUSH_DELAY_MS);
}

async function flushChatGameRuntime(): Promise<void> {
  if (!chatGameRuntime.consumeDirty()) {
    return;
  }

  const record = chatGameRuntime.getRuntimeRecord();
  if (record) {
    await writeChatGameRuntimeRecord(record);
  }
}

// Skip progress reaches the screen on the game's cadence, not the worker cycle's. The 30s cycle
// is fine for the poll — it runs a minute and its ballots trickle — but a skip campaign is a
// rally: someone typed !skip and needs the count on air while others can still join a 120s
// window. Write volume stays bounded without consulting the dirty flag, because only an accepted
// vote schedules a flush and each viewer is accepted at most once per campaign.
const CHAT_SKIP_FLUSH_DELAY_MS = 1_000;
let chatSkipFlushTimer: NodeJS.Timeout | null = null;

function scheduleChatSkipFlush(): void {
  if (chatSkipFlushTimer) {
    return;
  }

  chatSkipFlushTimer = setTimeout(() => {
    chatSkipFlushTimer = null;
    void flushChatSkipVote().catch((error: unknown) => {
      // A failed flush costs at most a second of on-air progress; the next accepted vote
      // reschedules, and the worker cycle flushes again regardless.
      logRuntimeEvent("chat.skip.flush_failed", {
        error: error instanceof Error ? error.message : String(error)
      });
    });
  }, CHAT_SKIP_FLUSH_DELAY_MS);
}

/**
 * Writes the campaign snapshot, or the empty record when none is collecting — clearing must reach
 * the row too, or the overlay would replay a finished campaign until its window lapsed. Does not
 * consume the runtime's dirty flag: that belongs to the cycle flush, and stealing it here would
 * suppress the poll write that shares it.
 */
async function flushChatSkipVote(): Promise<void> {
  const record = chatControl.getSkipVoteRecord(latestChatInteractionConfig);
  await writeChatSkipVoteRecord({ ...(record ?? {}), updatedAt: new Date().toISOString() });
}

// Chat-overlay writes share the skip vote's throttle shape: at most one write per window however
// fast the room talks, because every state write crosses the global serialisation lock.
const CHAT_OVERLAY_FLUSH_DELAY_MS = 1_000;
let chatOverlayFlushTimer: NodeJS.Timeout | null = null;
// What was last written, so a cycle that changed nothing writes nothing.
let lastChatOverlayFlushKey = "";

function scheduleChatOverlayFlush(): void {
  if (chatOverlayFlushTimer) {
    return;
  }

  chatOverlayFlushTimer = setTimeout(() => {
    chatOverlayFlushTimer = null;
    void flushChatOverlayMessages().catch((error: unknown) => {
      // A failed flush costs at most a second of chat freshness; the next buffer change
      // reschedules, and the worker cycle flushes again regardless.
      logRuntimeEvent("chat.overlay.flush_failed", {
        error: error instanceof Error ? error.message : String(error)
      });
    });
  }, CHAT_OVERLAY_FLUSH_DELAY_MS);
}

/**
 * Writes the bridge's current buffer as the on-air chat row: display name, text, timestamp —
 * the login the bridge keeps for moderation matching stays in the worker, and user ids never
 * existed on this path at all. With the runtime gate off the row is written empty, which is what
 * takes the panel off air when an operator disables chat between two messages.
 */
async function flushChatOverlayMessages(): Promise<void> {
  const settings = latestEngagementSettings;
  if (!settings) {
    return;
  }

  const enabled = isEngagementChatRuntimeEnabled(settings, process.env, latestManagedConfig);
  const record = {
    enabled,
    position: settings.chatPosition,
    maxMessages: settings.maxMessages,
    messages: enabled
      ? twitchChatBridge.getRecentMessages().map((event) => ({
          name: event.actor,
          text: event.message,
          at: event.createdAt,
          ...(event.segments.length > 0 ? { segments: event.segments } : {})
        }))
      : []
  };

  const key = JSON.stringify(record);
  if (key === lastChatOverlayFlushKey) {
    return;
  }

  await writeChatOverlayMessagesRecord({ ...record, updatedAt: new Date().toISOString() });
  lastChatOverlayFlushKey = key;
}
const PLAYOUT_CRASH_LOOP_THRESHOLD = 3;
const PLAYOUT_CRASH_LOOP_WINDOW_MS = 10 * 60_000;
// A function rather than module-level constants since M56 part 2: the cadence is managed config
// first, and a value saved in the GUI must reach the next cycle without a process restart.
function getPlayoutReconnectRuntimeConfig() {
  return getPlayoutReconnectConfig(process.env, latestManagedConfig);
}
const TWITCH_EVENTSUB_SYNC_INTERVAL_MS = 10 * 60_000;
const TWITCH_LIVE_STATUS_SYNC_INTERVAL_MS = 60_000;
const STREAM247_RELAY_ENABLED = isRelayModeEnabled(process.env);
const STREAM247_UPLINK_INPUT_MODE = getUplinkInputMode(process.env);
const STREAM247_RELAY_DESTINATION_ID = "relay-local";
const DESTINATION_FAILURE_COOLDOWN_SECONDS = Number(
  process.env.DESTINATION_FAILURE_COOLDOWN_SECONDS || String(DEFAULT_DESTINATION_FAILURE_COOLDOWN_SECONDS)
);
const UPLINK_DESTINATION_STALL_RESTART_SECONDS = (() => {
  // Default lowered from 300s to 60s alongside DEFAULT_DESTINATION_FAILURE_COOLDOWN_SECONDS.
  // Together they keep the destination-recovery window ~1 min for a single-destination setup
  // instead of ~5 min (the May 28 stuck-error shape).
  const raw = process.env.STREAM247_UPLINK_DESTINATION_STALL_RESTART_SECONDS;
  if (raw === undefined || raw === "") {
    return 60;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 60;
})();
const NEXT_ASSET_PROBE_READY_TTL_MS = 5 * 60_000;
const NEXT_ASSET_PROBE_FAILED_TTL_MS = 60_000;
// At most one expensive (remote: Twitch VOD cache prep / yt-dlp resolve) queue prefetch may be
// awaited per playout cycle, so a cascade of uncached remote queue assets cannot accumulate
// several sequential ~60-120s resolves and trip the 300s loop stall guard. See queue-prefetch.ts.
const MAX_EXPENSIVE_QUEUE_RESOLVES_PER_CYCLE = 1;
// Hard ceiling on how long stopPlayoutProcess may wait for a child to disappear. SIGTERM escalates
// to SIGKILL after 5s; a child that survives even that (uninterruptible I/O) must not hold the
// reconciliation cycle hostage until the stall guard restarts the container.
const PLAYOUT_STOP_DEADLINE_MS = 20_000;
// Latest overlay scene payload, refreshed by writeOnAirOverlay on every state change that touches
// the overlay. The scene renderer reads it on its own cadence instead of re-reading application
// state per frame.
let currentScenePayload: ReturnType<typeof buildWorkerScenePayload> | null = null;
// Live chat-driven overlay state, projected from the persisted poll and skip rows by the scene
// renderer loop. Null when neither is running.
let currentSceneEngagement: OverlayEngagementView | null = null;
// The last poll row read from Postgres, kept so the countdown ticks between reads and a failed
// read cannot blank a running poll.
let lastVoteSessionRecord: ChatVoteSessionRecord | null = null;
// The last skip-campaign row, kept for the same reason: a database blip must not blank a running
// campaign, and the projection's own deadline check takes a genuinely stale row off air.
let lastSkipVoteRecord: ChatSkipVoteRecord | null = null;
// The chat game as last read from the runtime record, refreshed by the scene renderer loop.
// Null when no game is running or no scene carries a game layer.
let currentSceneGame: OverlayGameView | null = null;
// Live chat as the overlay draws it, projected from the persisted chat_overlay_messages row by
// the scene renderer loop. Null when chat is disabled or the row holds nothing fresh.
let currentSceneChat: OverlayChatView | null = null;
// The last chat row, kept for the same reason as the poll and skip rows: a database blip must
// not blank the panel, and the projection's own per-message TTL ages a genuinely stale row off.
let lastChatOverlayRecord: ChatOverlayMessagesRecord | null = null;
// The sampled video-source frame the renderer draws (M57). Null hides the layer — including
// while the feed is away, which is the owner-default behaviour. Filled by the detached sampler
// below; the renderer loop only ever reads it.
let currentSceneSourceFrame: OverlaySourceFrameView | null = null;
// Sampler bookkeeping. All plain module state like the scene views above: single renderer loop,
// single sampler, no concurrent writers beyond the one in-flight capture guarded here.
let sourceSnapshotInFlight = false;
let sourceSnapshotLastStartedAtMs = 0;
let sourceSnapshotLastSuccessAtMs = 0;
let sourceSnapshotDataUri = "";
let sourceSnapshotCapturedAt = "";
let sourceSnapshotSourceId = "";
let sourceSnapshotFailures = 0;
// Managed switch, cadence and decrypted feed URL, re-read on a slow TTL so a settings change
// lands within seconds without putting a config read on every renderer tick.
let sourceSnapshotPolicy: {
  checkedAtMs: number;
  sourceId: string;
  enabled: boolean;
  intervalMs: number;
  url: string;
} | null = null;
const SOURCE_SNAPSHOT_POLICY_TTL_MS = 10_000;
let sceneRendererFonts: SceneRenderFont[] | null = null;
const standbySlatePath = "/tmp/stream247-standby.txt";
const onAirOverlayPath = "/tmp/stream247-on-air.txt";

type QueueProbeCacheEntry = {
  status: "ready" | "failed";
  checkedAt: number;
  resolvedInput: string;
  error: string;
  // The asset this entry was resolved for, so the boundary can verify the prefetched input belongs
  // to the asset it is about to start instead of trusting the map key. See playout-boundary.ts.
  assetId: string;
};

type UplinkProcessRuntime = {
  key: string;
  process: ChildProcess;
  destinationIds: string[];
  runtimeTargets: DestinationRuntimeTarget[];
  outputSettings: WorkerStreamOutputSettings;
  startedAt: string;
  plannedStopReason: string;
  /** ffmpeg's own out_time, watched to tell an uplink that is running from one that is working. */
  progress: UplinkProgressState;
  /** Demuxer resyncs, watched to catch an uplink that encodes fine but with audio and video torn apart. */
  discontinuity: UplinkDiscontinuityState;
};

const queueProbeCache = new Map<string, QueueProbeCacheEntry>();
let sceneRendererAbortController: AbortController | null = null;
const PLAYOUT_RECOVERY_SCENE_CAPTURE_SKIP_WINDOW_MS = 60_000;
// Wakes requested from inside a running cycle are latched, not dropped. See loop-wake.ts.
const playoutLoopWake = new LoopWakeLatch();
// True while the running process carries real programme content (scheduled tier) rather than a
// fallback/bridge. Only used to measure boundary gaps. See playout-gap.ts.
let playoutIsProgramme = false;
const programmeGapTracker = new ProgrammeGapTracker();
let twitchEventSubLastSyncKey = "";
let twitchEventSubNextSyncAt = 0;
let twitchLiveStatusLastSyncKey = "";
let twitchLiveStatusNextSyncAt = 0;
// When the stored Twitch token was last re-checked against Twitch. Process-lifetime only: a
// restart re-checking once is cheap, and persisting it would be one more field to keep honest.
let twitchConnectionHealLastAttemptAt = 0;
// Process-lifetime cache for the broadcast channel's user id; see twitch-broadcast-channel.ts.
const twitchUserIdResolver = createTwitchUserIdResolver();

function isTimestampActive(value: string): boolean {
  return value !== "" && new Date(value).getTime() > Date.now();
}

function getManagedString(state: AppState, key: keyof AppState["managedConfig"], envFallback = ""): string {
  return state.managedConfig[key] || envFallback;
}

function getTwitchClientId(state: AppState): string {
  return getManagedString(state, "twitchClientId", process.env.TWITCH_CLIENT_ID || "");
}

function getTwitchClientSecret(state: AppState): string {
  return getManagedString(state, "twitchClientSecret", process.env.TWITCH_CLIENT_SECRET || "");
}

function getTwitchDefaultCategoryId(state: AppState): string {
  return getManagedString(state, "twitchDefaultCategoryId", process.env.TWITCH_DEFAULT_CATEGORY_ID || "");
}

function getTwitchBroadcastChannelLogin(state: AppState): string {
  return getManagedString(state, "twitchBroadcastChannelLogin", process.env.TWITCH_BROADCAST_CHANNEL_LOGIN || "");
}

function getDiscordWebhookUrl(state: AppState): string {
  return getManagedString(state, "discordWebhookUrl", process.env.DISCORD_WEBHOOK_URL || "");
}

function getSmtpConfig(state: AppState) {
  return {
    host: getManagedString(state, "smtpHost", process.env.SMTP_HOST || ""),
    port: Number(getManagedString(state, "smtpPort", process.env.SMTP_PORT || "0") || "0"),
    user: getManagedString(state, "smtpUser", process.env.SMTP_USER || ""),
    password: getManagedString(state, "smtpPassword", process.env.SMTP_PASSWORD || ""),
    from: getManagedString(state, "smtpFrom", process.env.SMTP_FROM || process.env.SMTP_USER || ""),
    to: getManagedString(state, "alertEmailTo", process.env.ALERT_EMAIL_TO || "")
  };
}

function getMediaRoot(): string {
  return process.env.MEDIA_LIBRARY_ROOT || path.join(process.cwd(), "data", "media");
}

// Re-resolved on every call rather than memoised: since M56 part 2 the tuning is managed config
// first, and a value saved in the GUI must take effect on the next cycle, not the next deploy.
function getTwitchVodCacheRuntimeConfig() {
  return getTwitchVodCacheConfig(process.env, getMediaRoot(), latestManagedConfig);
}

function isAssetBlockedForAutomaticSelection(asset: AssetRecord): boolean {
  return isTwitchVodCacheCoolingDown(asset, getTwitchVodCacheRuntimeConfig().failureCooldownMs);
}

// Twitch VOD downloads run here, detached from every reconciliation cycle. See vod-cache-jobs.ts.
const vodCacheJobRunner = new VodCacheJobRunner({
  ensureCache: (asset, config, execText, options) => ensureTwitchVodCache(asset, config, execText, options),
  async onResult(asset, result) {
    await updateAssetRecords([
      {
        ...asset,
        cachePath: result.cachePath,
        cacheStatus: result.status,
        cacheUpdatedAt: result.cacheUpdatedAt,
        cacheError: result.cacheError,
        updatedAt: result.cacheUpdatedAt
      }
    ]);

    if (result.status === "ready") {
      await resolveIncident("playout.twitch-cache.failed", "Twitch VOD cache is ready.");
      return;
    }

    if (result.status === "too-large") {
      // Not a failure: the VOD is simply played from Twitch. Raising an incident here would leave a
      // permanent warning on a channel that is working exactly as configured.
      logRuntimeEvent("vod.cache.too_large", {
        assetId: asset.id,
        sizeBytes: result.sizeBytes,
        limitBytes: getTwitchVodCacheRuntimeConfig().maxAssetBytes
      });
      await resolveIncident("playout.twitch-cache.failed", "Twitch VOD is streamed directly.");
      return;
    }

    await upsertIncident({
      scope: "playout",
      severity: "warning",
      title: "Twitch VOD cache job failed",
      message: result.cacheError || "The Twitch VOD cache job did not produce a usable file.",
      fingerprint: "playout.twitch-cache.failed"
    });
  },
  onEvent: (event, fields) => logRuntimeEvent(event, fields)
});

/**
 * Deletes the cached VOD that just finished playing, and collects abandoned partials.
 *
 * Errors are swallowed: this runs inside the playout reconciliation cycle, and failing to free disk
 * is never a reason to interrupt the channel. The size cap still bounds the cache if this does
 * nothing at all.
 */
async function releaseWatchedVodCache(
  currentAssetId: string,
  finishedAssetId: string,
  state: AppState
): Promise<void> {
  try {
    const config = getTwitchVodCacheRuntimeConfig();
    if (!config.enabled || !canReleaseVodCache(currentAssetId)) {
      return;
    }

    const watchedPaths = state.assets
      .filter((asset) => asset.id === finishedAssetId && isTwitchVodAsset(asset))
      .map((asset) => asset.cachePath || buildTwitchVodCachePath(asset, config.cacheRoot));

    const released = await evictUnusedTwitchVodCache(config, watchedPaths);
    if (released.removed.length > 0) {
      logRuntimeEvent("vod.cache.released", {
        files: released.removed.length,
        freedBytes: released.freedBytes
      });
    }
  } catch (error) {
    logRuntimeEvent("vod.cache.release_failed", {
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

function isProgramFeedMode(): boolean {
  return STREAM247_RELAY_ENABLED && STREAM247_UPLINK_INPUT_MODE === "hls";
}

function getProgramFeedRuntimeConfig() {
  return getProgramFeedConfig(process.env, getMediaRoot(), latestManagedConfig);
}

/**
 * Deletes segments from playout runs that have ended.
 *
 * The muxer's delete_segments only reaches what the current process knows about, and with
 * append_list every restart abandons whatever was still inside the window. Measured on the test
 * channel before this existed: 8878 files and 3.7 GB in a directory whose live window is six
 * segments, the oldest from 125 days earlier.
 *
 * Runs on the boundary rather than on a timer, next to the VOD cache release, because that is when
 * a run has just ended and left its tail behind. The disk watermark monitor reuses it as its
 * feed-segments stage, which is why it reports what it freed instead of only that it ran.
 */
async function sweepProgramFeedSegments(): Promise<{ files: number; freedBytes: number }> {
  if (!isProgramFeedMode()) {
    return { files: 0, freedBytes: 0 };
  }

  try {
    const config = getProgramFeedRuntimeConfig();
    const playlist = await fs.readFile(config.playlistPath, "utf8").catch(() => "");
    const entries = await fs.readdir(config.directory, { withFileTypes: true });
    const segments: Array<{ name: string; modifiedAtMs: number; bytes: number }> = [];

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".ts")) {
        continue;
      }
      const stats = await fs.stat(path.join(config.directory, entry.name)).catch(() => null);
      if (stats) {
        segments.push({ name: entry.name, modifiedAtMs: stats.mtimeMs, bytes: stats.size });
      }
    }

    const stale = selectStaleProgramFeedSegments({ segments, playlist, nowMs: Date.now() });
    if (stale.length === 0) {
      return { files: 0, freedBytes: 0 };
    }

    const freedBytes = sumSegmentBytes(segments, stale);
    for (const name of stale) {
      await fs.rm(path.join(config.directory, name), { force: true });
    }

    logRuntimeEvent("program-feed.segments.swept", {
      files: stale.length,
      freedBytes,
      remaining: segments.length - stale.length,
      // Named so a backlog draining over several boundaries is visible as progress rather than
      // looking like the same sweep running over and over without effect.
      capped: stale.length >= PROGRAM_FEED_SWEEP_LIMIT
    });
    return { files: stale.length, freedBytes };
  } catch (error) {
    logRuntimeEvent("program-feed.sweep_failed", {
      error: error instanceof Error ? error.message : String(error)
    });
    return { files: 0, freedBytes: 0 };
  }
}

// Global disk self-protection (M55). The staging decision is pure and lives in disk-watermark.ts;
// everything here is the I/O around it: measuring the volume, running the chosen stage, and
// telling the operator what happened.

/** Stages already run in the current eviction episode. Empty whenever free space is healthy. */
let diskWatermarkEpisode: DiskWatermarkStageResult[] = [];
/** True while a watermark incident is open, so resolution runs once instead of on every idle cycle. */
let diskWatermarkIncidentRaised = false;

/** How each stage's haul is named in incidents, so the operator reads what was freed, not a key. */
const DISK_WATERMARK_STAGE_DETAIL: Record<DiskWatermarkStage, string> = {
  "source-frames": "sampled video-source frames",
  "vod-cache": "unused Twitch VOD cache entries",
  "feed-segments": "orphaned program-feed segments",
  thumbnails: "old asset thumbnails"
};

function formatFreePercent(freeBytes: number, totalBytes: number): string {
  return `${((freeBytes / totalBytes) * 100).toFixed(1)}%`;
}

/**
 * Runs one eviction stage and reports what it freed. Every stage composes an existing, already
 * safety-reasoned mechanism rather than deleting on its own: the VOD cache eviction with its
 * partial/lock rules, the capped feed sweep with its playlist-and-age rules, and the capped
 * thumbnail selection. Protection always comes from collectDiskProtectedAssetIds — media the
 * schedule or queue still references is never offered to any of them.
 */
async function runDiskWatermarkStage(
  stage: DiskWatermarkStage,
  state: AppState
): Promise<{ freedBytes: number; removedFiles: number }> {
  if (stage === "source-frames") {
    // Sampled source frames are the cheapest loss on the ladder: a live one regenerates within
    // one capture interval, an old one belongs to a sampler that stopped. No protection set —
    // nothing here is ever the only copy of anything.
    const directory = getSourceSnapshotDirectory(getMediaRoot());
    const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
    const files: SourceFrameFileInfo[] = [];
    for (const entry of entries) {
      if (!entry.isFile()) {
        continue;
      }
      const filePath = path.join(directory, entry.name);
      const stats = await fs.stat(filePath).catch(() => null);
      if (stats) {
        files.push({ filePath, modifiedAtMs: stats.mtimeMs, bytes: stats.size });
      }
    }

    let freedBytes = 0;
    let removedFiles = 0;
    for (const file of selectEvictableSourceFrames({ files, nowMs: Date.now() })) {
      const deleted = await fs.rm(file.filePath, { force: true }).then(
        () => true,
        () => false
      );
      if (deleted) {
        freedBytes += file.bytes;
        removedFiles += 1;
      }
    }
    return { freedBytes, removedFiles };
  }

  if (stage === "vod-cache") {
    const config = getTwitchVodCacheRuntimeConfig();

    // The same gate the boundary release uses: a playout that cannot say what it is playing is
    // reconnecting, in standby, or freshly restarted — exactly the moments its runtime keep-list
    // is incomplete. Skipping costs one cycle and advances the ladder to stages whose protection
    // does not depend on the playout knowing its own state.
    if (!canReleaseVodCache(state.playout.currentAssetId)) {
      return { freedBytes: 0, removedFiles: 0 };
    }

    const protectedIds = collectDiskProtectedAssetIds(state);
    const protectedPaths = state.assets
      .filter((asset) => protectedIds.has(asset.id) && isTwitchVodAsset(asset))
      .map((asset) => asset.cachePath || buildTwitchVodCachePath(asset, config.cacheRoot));
    const releasable = await collectReleasableVodCachePaths(config, protectedPaths);
    const result = await evictUnusedTwitchVodCache(config, releasable);
    return { freedBytes: result.freedBytes, removedFiles: result.removed.length };
  }

  if (stage === "feed-segments") {
    // In relay mode this is the same capped, playlist-respecting sweep the boundary runs; outside
    // relay mode there is no program feed and the stage frees nothing, which simply advances the
    // ladder.
    const result = await sweepProgramFeedSegments();
    return { freedBytes: result.freedBytes, removedFiles: result.files };
  }

  // Thumbnails have no reference index of their own (no playlist, no watched paths), so protection
  // is by asset id: every asset the schedule blocks, pools and broadcast queue reference maps
  // through getAssetThumbnailPath, and only files outside that set are offered for eviction.
  const mediaRoot = getMediaRoot();
  const protectedPaths = [...collectDiskProtectedAssetIds(state)].map((assetId) =>
    getAssetThumbnailPath(assetId, mediaRoot)
  );
  const directory = getThumbnailDirectory(mediaRoot);
  const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
  const files: ThumbnailFileInfo[] = [];
  for (const entry of entries) {
    // .jpg.tmp leftovers can only come from a process that died between the render and the
    // rename; nothing reads them, so they are sweepable like the source-frame temps.
    if (!entry.isFile() || !(entry.name.endsWith(".jpg") || entry.name.endsWith(".jpg.tmp"))) {
      continue;
    }
    const filePath = path.join(directory, entry.name);
    const stats = await fs.stat(filePath).catch(() => null);
    if (stats) {
      files.push({ filePath, modifiedAtMs: stats.mtimeMs, bytes: stats.size });
    }
  }

  let freedBytes = 0;
  let removedFiles = 0;
  for (const file of selectEvictableThumbnails({ files, protectedPaths })) {
    const deleted = await fs.rm(file.filePath, { force: true }).then(
      () => true,
      () => false
    );
    if (deleted) {
      freedBytes += file.bytes;
      removedFiles += 1;
    }
  }
  return { freedBytes, removedFiles };
}

/**
 * The disk watermark monitor: one measurement and at most one eviction stage per worker cycle.
 *
 * Bounded on purpose, for the same reason the feed sweep is capped: a disk that filled over weeks
 * does not need to be emptied inside one cycle, and a cycle that suddenly deletes tens of
 * gigabytes is itself a reliability event. One stage per 30-second cycle drains pressure fast
 * enough while keeping each cycle's cost roughly constant.
 *
 * Errors are swallowed into a runtime event: failing to free disk is never a reason to fail the
 * worker cycle, and the per-cache guardrails still hold if this does nothing at all.
 */
async function enforceDiskWatermark(): Promise<void> {
  try {
    // Managed config wins, env is the fallback. The read is tolerant on purpose: with the
    // database unreachable the watermark degrades to env-only resolution instead of dying —
    // the same posture it had before the settings moved into managed config. (Actually running
    // an eviction stage has always needed application state for the protection set.)
    const managedConfig = await readAppState()
      .then((state) => state.managedConfig)
      .catch(() => null);
    const config = resolveDiskWatermarkConfig(managedConfig, process.env);
    if (!config.enabled) {
      return;
    }

    const mediaRoot = getMediaRoot();
    const volume = await fs.statfs(mediaRoot);
    const freeBytes = Number(volume.bavail) * Number(volume.bsize);
    const totalBytes = Number(volume.blocks) * Number(volume.bsize);
    const decision = decideDiskWatermarkAction({
      freeBytes,
      totalBytes,
      config,
      completedStages: diskWatermarkEpisode
    });

    if (decision.kind === "idle") {
      if (diskWatermarkIncidentRaised) {
        diskWatermarkIncidentRaised = false;
        const message = "Free space on the media volume is back above the watermark.";
        await resolveIncident("disk.watermark.evicted", message);
        await resolveIncident("disk.watermark.exhausted", message);
      }
      return;
    }

    if (decision.kind === "recovered") {
      logRuntimeEvent("disk.watermark.recovered", { freedBytes: decision.freedBytes, freeBytes, totalBytes });
      diskWatermarkEpisode = [];
      if (diskWatermarkIncidentRaised) {
        diskWatermarkIncidentRaised = false;
        const message = `Eviction freed ${formatGigabytes(decision.freedBytes)}; free space on the media volume is back above the recovery watermark.`;
        await resolveIncident("disk.watermark.evicted", message);
        await resolveIncident("disk.watermark.exhausted", message);
      }
      return;
    }

    if (decision.kind === "exhausted") {
      logRuntimeEvent("disk.watermark.exhausted", { freedBytes: decision.freedBytes, freeBytes, totalBytes });
      // The episode ends but the ladder may retry on later cycles, because evictable media does
      // appear on its own — a VOD finishes playing, a playout run leaves its segment tail behind.
      // The critical incident is what tells the operator that retrying alone will not fix this.
      diskWatermarkEpisode = [];
      diskWatermarkIncidentRaised = true;
      await upsertIncident({
        scope: "system",
        severity: "critical",
        title: "Media disk is almost full and eviction cannot free it",
        message: `Free space on the media volume is down to ${formatFreePercent(freeBytes, totalBytes)} (${formatGigabytes(freeBytes)} of ${formatGigabytes(totalBytes)}) and every eviction stage — sampled video frames, unused VOD cache, orphaned feed segments, old thumbnails — has run without reaching the ${String(Math.round(config.recoverFreeRatio * 100))}% recovery watermark; only ${formatGigabytes(decision.freedBytes)} could be reclaimed. Media the schedule still references is never evicted, so an operator has to free space before playout, feed segments or downloads start failing writes.`,
        fingerprint: "disk.watermark.exhausted"
      });
      return;
    }

    const state = await readAppState();
    const result = await runDiskWatermarkStage(decision.stage, state);
    diskWatermarkEpisode = [...diskWatermarkEpisode, { stage: decision.stage, freedBytes: result.freedBytes }];
    logRuntimeEvent("disk.watermark.stage", {
      stage: decision.stage,
      freedBytes: result.freedBytes,
      files: result.removedFiles,
      freeBytes,
      totalBytes
    });

    // The incident names what was freed and why, so the operator can read what happened without
    // the runtime log. Stages that freed nothing only log — on a genuinely full disk the incident
    // that matters is the critical one, and it must not be buried under empty-handed sweeps.
    if (result.freedBytes > 0) {
      diskWatermarkIncidentRaised = true;
      await upsertIncident({
        scope: "system",
        severity: "warning",
        title: "Low disk space triggered media eviction",
        message: `Free space on the media volume fell to ${formatFreePercent(freeBytes, totalBytes)} (${formatGigabytes(freeBytes)} of ${formatGigabytes(totalBytes)}), below the ${String(Math.round(config.triggerFreeRatio * 100))}% watermark; removed ${String(result.removedFiles)} ${DISK_WATERMARK_STAGE_DETAIL[decision.stage]} (${formatGigabytes(result.freedBytes)}) to climb back above ${String(Math.round(config.recoverFreeRatio * 100))}%. Media the schedule still references is never touched.`,
        fingerprint: "disk.watermark.evicted"
      });
    }
  } catch (error) {
    logRuntimeEvent("disk.watermark.check_failed", {
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

// The second watermark: observation only, for the volumes eviction cannot help (M57). The pure
// decision and the honest description of what the measurement covers live in system-volume.ts;
// this is the I/O around it. The flag carries "the incident is already open" between cycles so
// the alert fires once per breach, not once per 30-second measurement — after a worker restart
// it resets, and the raise then re-runs into the same fingerprint, which upsertIncident absorbs.
let systemVolumeIncidentOpen = false;

async function observeSystemVolume(): Promise<void> {
  try {
    // Same tolerant managed-config read as the eviction watermark: with the database unreachable
    // the thresholds degrade to env-only resolution instead of dying.
    const managedConfig = await readAppState()
      .then((state) => state.managedConfig)
      .catch(() => null);
    const config = resolveSystemVolumeWatermarkConfig(managedConfig, process.env);

    // "/" is the worker container's root filesystem — the closest observable stand-in for the OS
    // volume (see system-volume.ts for exactly how far that approximation carries).
    const volume = await fs.statfs("/");
    const freeBytes = Number(volume.bavail) * Number(volume.bsize);
    const totalBytes = Number(volume.blocks) * Number(volume.bsize);
    const decision = decideSystemVolumeObservation({
      freeBytes,
      totalBytes,
      config,
      incidentOpen: systemVolumeIncidentOpen
    });

    if (decision === "raise") {
      systemVolumeIncidentOpen = true;
      // Reported for context, not thresholded: the database's logical size tells the operator
      // whether the database is what is eating the volume. -1 means it could not be read; the
      // incident still fires, because the free-space measurement is the one that matters.
      const databaseSizeBytes = await readDatabaseSizeBytes().catch(() => -1);
      const databaseDetail =
        databaseSizeBytes >= 0
          ? `the application database currently holds ${formatGigabytes(databaseSizeBytes)}`
          : "the application database size could not be read";
      const message = `Free space on the system volume is down to ${formatFreePercent(freeBytes, totalBytes)} (${formatGigabytes(freeBytes)} of ${formatGigabytes(totalBytes)}), measured at the worker's root filesystem as the closest observable stand-in for the OS and database volumes; ${databaseDetail}. Nothing here can be freed automatically — media eviction only relieves the media volume — so an operator has to free space before the database or the host stops accepting writes.`;
      logRuntimeEvent("system.volume.low", { freeBytes, totalBytes, databaseSizeBytes });
      await upsertIncident({
        scope: "system",
        severity: "critical",
        title: "System volume is running out of space",
        message,
        fingerprint: "system.volume.low"
      });
      await sendAlert("System volume warning", message);
      return;
    }

    if (decision === "resolve") {
      systemVolumeIncidentOpen = false;
      logRuntimeEvent("system.volume.recovered", { freeBytes, totalBytes });
      await resolveIncident("system.volume.low", "Free space on the system volume is back above the recovery mark.");
    }
  } catch (error) {
    logRuntimeEvent("system.volume.check_failed", {
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

// The asset-retention sweep (M57): at most once per hour, because it hydrates the full state
// under the write lock and the growth it addresses builds over weeks, not cycles. The decision
// logic and the reference-path inventory live in @stream247/db (asset-retention.ts); this wiring
// resolves the managed switch and reports. The counters are logged on EVERY sweep — with the
// switch off, the sweep classifies and logs what it WOULD delete and why the rest stays, so an
// operator watches first and enables second.
const ASSET_RETENTION_SWEEP_INTERVAL_MS = 60 * 60_000;
let assetRetentionLastSweepMs = 0;

async function sweepAssetRetention(): Promise<void> {
  const nowMs = Date.now();
  if (nowMs - assetRetentionLastSweepMs < ASSET_RETENTION_SWEEP_INTERVAL_MS) {
    return;
  }
  assetRetentionLastSweepMs = nowMs;

  try {
    const managedConfig = await readAppState()
      .then((state) => state.managedConfig)
      .catch(() => null);
    const config = resolveAssetRetentionConfig(managedConfig, process.env);
    const result = await runAssetRetentionSweep({
      protectionDays: config.protectionDays,
      deleteEnabled: config.enabled
    });
    logRuntimeEvent("assets.retention.sweep", {
      enabled: config.enabled,
      protectionDays: config.protectionDays,
      ...result.counters,
      deletedAssets: result.deletedAssets,
      deletedCollectionItems: result.deletedCollectionItems,
      danglingCollectionItems: result.danglingCollectionItems,
      newlyMarkedOrphans: result.newlyMarkedOrphans,
      clearedOrphanMarks: result.clearedOrphanMarks
    });
  } catch (error) {
    // Failing to sweep is never a reason to fail the cycle; the next attempt comes an hour
    // later, which matches how slowly this problem grows.
    logRuntimeEvent("assets.retention.sweep_failed", {
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

function createProgramFeedRunId(): string {
  return `${Date.now()}-${process.pid}`;
}

async function ensureProgramFeedDirectory(): Promise<void> {
  const config = getProgramFeedRuntimeConfig();
  await fs.mkdir(config.directory, { recursive: true });
}

/**
 * Counts audio and video packets in the newest program-feed segment.
 *
 * Video alone proves nothing: when a source runs out, the fps filter keeps manufacturing frames by
 * duplicating the last one, so packets keep flowing while nothing real is being played. Audio
 * cannot be duplicated, which makes it the honest signal for "is there still a source behind this".
 *
 * Returns null when the feed cannot be read at all, so an unreadable directory reads as "no
 * opinion" rather than as a stall.
 */
async function probeProgramFeedPackets(
  playlistPath: string
): Promise<{ audioPackets: number; videoPackets: number } | null> {
  try {
    const directory = path.dirname(playlistPath);
    const playlist = await fs.readFile(playlistPath, "utf8");
    const segments = playlist.split("\n").filter((line) => line.trim().endsWith(".ts"));
    const newest = segments[segments.length - 1];
    if (!newest) {
      return null;
    }

    const segmentPath = path.join(directory, newest.trim());
    const [audio, video] = await Promise.all([
      countPackets(segmentPath, "a"),
      countPackets(segmentPath, "v")
    ]);
    return { audioPackets: audio, videoPackets: video };
  } catch {
    return null;
  }
}

async function countPackets(segmentPath: string, stream: "a" | "v"): Promise<number> {
  const output = await execFileText(
    process.env.FFPROBE_BIN || "ffprobe",
    ["-v", "error", "-select_streams", stream, "-show_entries", "packet=size", "-of", "csv=p=0", segmentPath],
    { timeoutMs: 15_000, killProcessGroup: true, maxBufferBytes: 1024 * 1024 }
  );
  return output.split("\n").filter((line) => line.trim()).length;
}

async function readProgramFeedRuntimeStatus(): Promise<{
  status: AppState["playout"]["programFeedStatus"];
  updatedAt: string;
  playlistPath: string;
  targetSeconds: number;
  bufferedSeconds: number;
}> {
  const config = getProgramFeedRuntimeConfig();

  try {
    const stat = await fs.stat(config.playlistPath);
    const updatedAt = stat.mtime.toISOString();
    const ageMs = Math.max(0, Date.now() - stat.mtime.getTime());
    const staleMs = (config.bufferedSeconds + config.failoverSeconds) * 1000;
    return {
      status: ageMs <= staleMs ? "fresh" : "stale",
      updatedAt,
      playlistPath: config.playlistPath,
      targetSeconds: config.targetSeconds,
      bufferedSeconds: config.bufferedSeconds
    };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return {
      status: code === "ENOENT" ? "bootstrapping" : "failed",
      updatedAt: "",
      playlistPath: config.playlistPath,
      targetSeconds: config.targetSeconds,
      bufferedSeconds: config.bufferedSeconds
    };
  }
}

let feedAudioState = createFeedAudioState(Date.now());

/**
 * Restarts the playout when its feed has carried video without audio for too long.
 *
 * A source that runs out does not stop the process: ffmpeg stays alive and the fps filter keeps
 * manufacturing frames from the last one. In production that ran for two and a half days and ten
 * million duplicated frames, with every liveness check green — while the uplink, unable to
 * determine the parameters of an audio stream that never received a packet, wrote nothing at all
 * and the channel was off the air the entire time.
 */
async function enforceProgramFeedAudio(playlistPath: string): Promise<void> {
  try {
    if (!playoutProcess || !playlistPath) {
      return;
    }

    const sample = await probeProgramFeedPackets(playlistPath);
    if (!sample) {
      return;
    }

    const options = getFeedAudioOptions(process.env, latestManagedConfig);
    const observed = { ...sample, atMs: Date.now() };
    feedAudioState = observeFeedAudio(feedAudioState, observed);

    if (!isFeedAudioStalled(feedAudioState, observed, playoutProcessStartedAtMs, options)) {
      return;
    }

    const silentSeconds = Math.round((observed.atMs - feedAudioState.lastAudioAtMs) / 1000);
    logRuntimeEvent("playout.feed_audio.restart", {
      silentSeconds,
      videoPackets: observed.videoPackets
    });
    await upsertIncident({
      scope: "playout",
      severity: "warning",
      title: "Playout restarted after its source ran dry",
      message: `The program feed has carried video without any audio for ${silentSeconds}s. Video alone does not prove a source is still playing — the fps filter duplicates the last frame indefinitely — so this is treated as an exhausted or stalled source and the playout is restarted.`,
      fingerprint: "playout.feed-audio"
    });

    feedAudioState = createFeedAudioState(Date.now());
    await stopPlayoutProcess("feed-audio-stalled");
  } catch (error) {
    logRuntimeEvent("playout.feed_audio.check_failed", {
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

/**
 * Restarts the playout when its process is alive but the feed has stopped advancing.
 *
 * Caught live: ffmpeg blocked for 3h43m at 0% CPU on a remote source that stopped delivering, its
 * -reconnect flags set and never firing. The feed stood still, the uplink exited "end of input"
 * once a minute, and the channel was dark for four minutes. The uplink has a watchdog for "running
 * is not working"; this is the same idea one stage earlier.
 *
 * Complementary to enforceProgramFeedAudio, not overlapping: that one catches a feed that still
 * advances but carries no audio; this one catches a feed that does not advance at all.
 */
async function enforceProgramFeedProgress(feed: { updatedAt: string }): Promise<void> {
  try {
    const options = getPlayoutFeedHealthOptions(process.env, latestManagedConfig);
    const parsedUpdatedAt = feed.updatedAt ? new Date(feed.updatedAt).getTime() : 0;
    const feedUpdatedAtMs = Number.isFinite(parsedUpdatedAt) ? parsedUpdatedAt : 0;
    const nowMs = Date.now();

    if (
      !shouldRestartStalledPlayout({
        playoutRunning: isPlayoutProcessRunning(),
        processStartedAtMs: playoutProcessStartedAtMs,
        feedUpdatedAtMs,
        nowMs,
        options
      })
    ) {
      return;
    }

    const staleSeconds = Math.round((nowMs - feedUpdatedAtMs) / 1000);
    logRuntimeEvent("playout.feed_stall.restart", {
      staleSeconds,
      thresholdSeconds: Math.round(options.staleMs / 1000)
    });
    await upsertIncident({
      scope: "playout",
      severity: "warning",
      title: "Playout restarted after its feed stopped advancing",
      message: `The playout process is still running but the program feed has not advanced for ${staleSeconds}s. This is the shape of an input that hangs without erroring; restarting is the only way forward.`,
      fingerprint: "playout.feed-stall"
    });

    await stopPlayoutProcess("feed-stalled");
  } catch (error) {
    logRuntimeEvent("playout.feed_stall.check_failed", {
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

/**
 * Ends the current asset deliberately once elapsed playback passes its known duration plus a
 * margin.
 *
 * This is the planned answer to the fault the two watchdogs above only rescue: a remotely
 * streamed VOD reaches its end without ffmpeg receiving EOF, the fps filter manufactures video
 * from the last frame, and the uplink encoder watchdog (at ~45s) and the feed-audio watchdog (at
 * 91s) fight over a feed that stopped carrying content at the moment the asset ended. When the
 * duration is known we do not wait for any of that: the stop below takes the same planned-stop
 * path every deliberate transition takes, the exit handler records a planned transition rather
 * than a failure, and the remainder of the same playout cycle starts the next queue item. No
 * incident is raised because nothing failed — this is scheduling, not rescue.
 *
 * The elapsed clock is the same playoutProcessStartedAtMs the feed watchdogs use; every asset
 * starts from position zero, so wall time since process start can only run ahead of the playback
 * position (brief rebuffering), never behind — the margin absorbs that. Cuepoints are keyed on
 * schedule wall-clock time, not on this process clock, so a cuepoint due during the asset has
 * fired (or will fire on the following cycle) exactly as it does after a natural EOF. Assets with
 * an unknown duration never reach the stop; for those the feed-audio watchdog remains the net,
 * which is why neither watchdog is removed.
 */
async function enforceAssetDurationBound(assets: AssetRecord[]): Promise<void> {
  if (!playoutProcess || playoutProcess.killed) {
    return;
  }

  const asset = playoutAssetId ? assets.find((entry) => entry.id === playoutAssetId) ?? null : null;
  const durationSeconds = asset?.durationSeconds ?? 0;
  const options = getDurationBoundOptions(process.env, latestManagedConfig);
  const nowMs = Date.now();
  if (
    !shouldEndAssetAtDurationBound({
      targetKind: playoutTargetKind,
      durationSeconds,
      processStartedAtMs: playoutProcessStartedAtMs,
      nowMs,
      marginSeconds: options.marginSeconds
    })
  ) {
    return;
  }

  logRuntimeEvent("playout.duration_bound.end", {
    assetId: playoutAssetId,
    durationSeconds,
    elapsedSeconds: Math.round((nowMs - playoutProcessStartedAtMs) / 1000)
  });
  await stopPlayoutProcess("duration-bound");
}

async function updateProgramFeedRuntimeStatus(): Promise<Awaited<ReturnType<typeof readProgramFeedRuntimeStatus>>> {
  const feed = await readProgramFeedRuntimeStatus();
  await updatePlayoutRuntime((playout) => ({
    ...playout,
    programFeedStatus: feed.status,
    programFeedUpdatedAt: feed.updatedAt,
    programFeedPlaylistPath: feed.playlistPath,
    programFeedTargetSeconds: feed.targetSeconds,
    programFeedBufferedSeconds: feed.bufferedSeconds
  }));
  await enforceProgramFeedAudio(feed.playlistPath);
  await enforceProgramFeedProgress(feed);
  return feed;
}

function isResolvableRemoteVideoUrl(value: string): boolean {
  return isLikelyYouTubePlaylistUrl(value) || isLikelyTwitchVodUrl(value) || value.includes("youtube.com/watch");
}

function summarizePlaybackInput(input: string): string {
  if (!input) {
    return "";
  }

  try {
    const url = new URL(input);
    return `${url.origin}${url.pathname}`;
  } catch {
    return input;
  }
}

async function resolvePlayableInput(input: string): Promise<string> {
  if (!input.startsWith("http://") && !input.startsWith("https://")) {
    return input;
  }

  if (isDirectMediaUrl(input)) {
    return input;
  }

  if (!isResolvableRemoteVideoUrl(input)) {
    return input;
  }

  const ytDlpBinary = process.env.YT_DLP_BIN || "yt-dlp";
  const resolved = await execFileText(
    ytDlpBinary,
    ["--no-warnings", "--no-playlist", "--format", "best", "--get-url", input],
    { timeoutMs: PLAYABLE_INPUT_RESOLVE_TIMEOUT_MS, killProcessGroup: true }
  );

  const directUrl = resolved.split("\n").find(Boolean)?.trim();
  if (!directUrl) {
    throw new Error(`Could not resolve a playable media URL for ${input}.`);
  }

  return directUrl;
}

async function resolveAssetPlaybackInput(asset: AssetRecord): Promise<{ asset: AssetRecord; input: string }> {
  const cacheConfig = getTwitchVodCacheRuntimeConfig();

  if (!isTwitchVodAsset(asset)) {
    const input = await resolvePlayableInput(asset.path);
    await resolveIncident("playout.asset-preparation.failed", "Asset playback input resolved successfully.");
    return {
      asset,
      input
    };
  }

  // Never download here. This runs on the playout reconciliation cycle, which has a hard stall
  // budget; a VOD download is unbounded work by nature. Look the cache up, and if it is not there
  // yet hand the download to the detached job runner and let the caller bridge to fallback. The
  // asset becomes playable on a later cycle once the job finishes.
  const result = await peekTwitchVodCache(asset, cacheConfig);
  const updatedAsset: AssetRecord = {
    ...asset,
    cachePath: result.cachePath,
    cacheStatus: result.status,
    cacheUpdatedAt: result.cacheUpdatedAt,
    cacheError: result.cacheError,
    updatedAt: result.cacheUpdatedAt
  };

  // A VOD already known to exceed the cache limit is a settled decision, not a pending download.
  // peekTwitchVodCache only looks for a local file, so it reports "missing" every cycle; without
  // this the job runner would be handed the same oversized download again for as long as the asset
  // stays scheduled.
  const settledTooLarge = asset.cacheStatus === "too-large";
  if (settledTooLarge) {
    updatedAsset.cacheStatus = "too-large";
    updatedAsset.cacheError = asset.cacheError;
  } else if (result.status !== "ready") {
    vodCacheJobRunner.request(asset, cacheConfig);
  }

  await updateAssetRecords([updatedAsset]);

  if (result.status === "ready") {
    await resolveIncident("playout.twitch-cache.failed", "Twitch VOD cache is ready.");
    await resolveIncident("playout.asset-preparation.failed", "Asset playback input resolved successfully.");
    return {
      asset: updatedAsset,
      input: result.cachePath
    };
  }

  // Streaming from Twitch is the configured outcome for an oversized VOD, so it does not depend on
  // the remote-fallback switch: that switch governs what happens while a cacheable VOD is still
  // downloading, which is a different question.
  if (settledTooLarge || cacheConfig.allowRemoteFallback) {
    const input = await resolvePlayableInput(asset.path);
    await resolveIncident("playout.asset-preparation.failed", "Asset playback input resolved successfully.");
    return {
      asset: updatedAsset,
      input
    };
  }

  throw new Error(`Twitch VOD cache is ${result.status}: ${result.cacheError || "local cache file is not ready."}`);
}

function isDestinationCoolingDown(destination: StreamDestinationRecord): boolean {
  return isDestinationFailureCoolingDown(destination.status, destination.lastFailureAt, DESTINATION_FAILURE_COOLDOWN_SECONDS);
}

function getDestinationFailureSecondsRemaining(destination: StreamDestinationRecord): number {
  return getDestinationFailureHoldSecondsRemaining(destination.lastFailureAt, DESTINATION_FAILURE_COOLDOWN_SECONDS);
}

async function markDestinationFailure(destinationId: string, errorMessage: string): Promise<void> {
  if (!destinationId) {
    return;
  }

  const state = await readAppState();
  const destination = state.destinations.find((entry) => entry.id === destinationId);
  if (!destination) {
    return;
  }

  const now = new Date().toISOString();
  const nextError = errorMessage.slice(0, 400);
  if (
    destination.status === "error" &&
    destination.lastError === nextError &&
    destination.lastFailureAt !== "" &&
    Date.now() - new Date(destination.lastFailureAt).getTime() < 15_000
  ) {
    return;
  }

  await updateDestinationRecord({
    ...destination,
    status: "error",
    lastValidatedAt: now,
    lastFailureAt: now,
    failureCount: destination.failureCount + 1,
    lastError: nextError,
    notes: `${
      destination.role === "backup" ? "Backup" : "Primary"
    } destination failed recently. Worker will prefer the next healthy output until the hold expires.`
  });
  logRuntimeEvent("destination.failure", {
    destinationId,
    role: destination.role,
    failureCount: destination.failureCount + 1,
    error: nextError
  });

  await upsertIncident({
    scope: "playout",
    severity: "warning",
    title: `${destination.name} output failed`,
    message: nextError,
    fingerprint: `playout.destination.${destination.id}.failed`
  });
}

function getRelayDestinationRecord(): StreamDestinationRecord {
  const now = new Date().toISOString();
  const programFeedMode = isProgramFeedMode();
  const runtimeUrl = programFeedMode ? getProgramFeedRuntimeConfig().playlistPath : getRelayPublishUrl(process.env);
  return {
    id: STREAM247_RELAY_DESTINATION_ID,
    provider: "custom-rtmp",
    role: "primary",
    priority: -1,
    name: programFeedMode ? "Local HLS program feed" : "Local relay",
    enabled: true,
    rtmpUrl: runtimeUrl,
    streamKeyPresent: true,
    streamKeySource: "env",
    status: "ready",
    notes: programFeedMode
      ? "Buffered local HLS feed used between program playout and the persistent uplink."
      : "Local relay target used between program playout and the persistent uplink.",
    lastValidatedAt: now,
    lastFailureAt: "",
    failureCount: 0,
    lastError: ""
  };
}

function getRelayRuntimeTarget(): DestinationRuntimeTarget {
  const destination = getRelayDestinationRecord();
  return {
    destination,
    target: destination.rtmpUrl
  };
}

function getRelayOutputTarget(): ReturnType<typeof buildFfmpegOutputTarget> {
  if (isProgramFeedMode()) {
    return buildProgramFeedOutputTarget(getProgramFeedRuntimeConfig(), createProgramFeedRunId());
  }

  return {
    muxer: "flv",
    output: getRelayPublishUrl(process.env)
  };
}

function getRunningUplinkProcesses(): UplinkProcessRuntime[] {
  return uplinkProcesses.filter((entry) => !entry.process.killed && entry.process.exitCode === null);
}

function getRunningUplinkDestinationIds(): string[] {
  return [...new Set(getRunningUplinkProcesses().flatMap((entry) => entry.destinationIds))];
}

function getRunningUplinkStartedAt(): string {
  return pickUplinkGroupStartedAt(getRunningUplinkProcesses().map((entry) => entry.startedAt));
}

function isMatchingRunningUplinkGroup(group: DestinationRuntimeTargetGroup): boolean {
  const desiredDestinationIds = [...group.targets.map((entry) => entry.destination.id)].sort();
  return getRunningUplinkProcesses().some((entry) => {
    if (entry.key !== group.key) {
      return false;
    }

    const currentDestinationIds = [...entry.destinationIds].sort();
    return (
      currentDestinationIds.length === desiredDestinationIds.length &&
      currentDestinationIds.every((value, index) => value === desiredDestinationIds[index])
    );
  });
}

function findRunningUplinkProcessByKey(key: string): UplinkProcessRuntime | null {
  return getRunningUplinkProcesses().find((entry) => entry.key === key) ?? null;
}

function joinVideoFilters(filters: Array<string | null | undefined>): string {
  return filters.filter(Boolean).join(",");
}

function getMediaOverlayFilter(textPath: string, output: WorkerStreamOutputSettings): string {
  const scale = getOutputScaleFactor(output);
  const fontSize = Math.max(14, Math.round(20 * scale));
  const borderWidth = Math.max(6, Math.round(10 * scale));
  const margin = Math.max(20, Math.round(32 * scale));
  const lineSpacing = Math.max(5, Math.round(8 * scale));
  return `drawtext=fontfile=/usr/share/fonts/TTF/DejaVuSans.ttf:textfile=${textPath}:reload=1:fontcolor=white:fontsize=${fontSize}:box=1:boxcolor=0x00000099:boxborderw=${borderWidth}:x=${margin}:y=h-th-${margin}:line_spacing=${lineSpacing}`;
}

type AudioLaneCommandConfig = {
  input: string;
  volumePercent: number;
};

/**
 * A pushed source attached as a live PiP input (M57 stage 2, Etappes C/D). Only ever consumed in
 * scene overlay mode — the graph overlays the live picture under the scene PNG, which non-scene
 * modes do not produce — and its input is always appended LAST so the scene pipe keeps its index.
 * `audio` is null when the source carries no audio track OR the programme has no confirmed audio to
 * mix against: video-only attach, never a start blockade.
 */
type LiveSourceCommandConfig = {
  inputArgs: string[];
  box: { left: number; top: number; width: number; height: number };
  audio: SourceLivePipAudio | null;
};

function getFfmpegCommand(
  input: string,
  outputTarget: ReturnType<typeof buildFfmpegOutputTarget>,
  overlayMode: OnAirOverlayMode,
  audioLane: AudioLaneCommandConfig | null,
  output: WorkerStreamOutputSettings,
  encoder: ResolvedEncoderQualitySettings,
  liveSource: LiveSourceCommandConfig | null = null
): string[] {
  const command = ["-hide_banner", "-loglevel", "warning", "-y", ...buildFfmpegInputArgs({ input, realtime: true })];
  const outputVideoFilter = isStreamScaleEnabled(process.env) ? getOutputVideoFilter(output) : "";

  if (audioLane) {
    command.push(...buildFfmpegInputArgs({ input: audioLane.input, loop: true }));
  }

  // A live source only makes sense in scene mode: the PiP overlays under the scene PNG, and text /
  // none modes have no scene pipe to overlay onto. Everywhere else it is ignored, so a scene-render
  // fallback silently drops the attach for this start rather than building an untested graph.
  const attachLive = Boolean(liveSource) && overlayMode === "scene";
  let pipAudioMapped = false;

  if (overlayMode === "scene") {
    const sceneInputIndex = audioLane ? 2 : 1;
    command.push(
      "-f",
      "image2pipe",
      "-framerate",
      String(ON_AIR_SCENE_PIPE_FRAMERATE),
      "-thread_queue_size",
      String(ON_AIR_SCENE_PIPE_QUEUE_FRAMES),
      "-vcodec",
      "png",
      "-i",
      `pipe:${ON_AIR_SCENE_PIPE_FD}`
    );
    if (attachLive && liveSource) {
      // The PiP is the LAST input, so its index follows the scene pipe: the arithmetic ties the
      // two together rather than hard-coding either.
      const pipInputIndex = sceneInputIndex + 1;
      command.push(...liveSource.inputArgs);
      const parts = buildSourceLivePipFilterComplex({
        outputVideoFilter,
        sceneInputIndex,
        pipInputIndex,
        fps: output.fps,
        box: liveSource.box,
        audio: liveSource.audio
      });
      pipAudioMapped = parts.audioMapped;
      command.push("-filter_complex", parts.filterComplex, "-map", "[vout]");
      command.push("-map", pipAudioMapped ? "[aout]" : audioLane ? "1:a:0" : "0:a?");
    } else {
      command.push(
        "-filter_complex",
        outputVideoFilter
          ? `[0:v]${outputVideoFilter}[base];[base][${sceneInputIndex}:v]overlay=0:0:format=auto[vout]`
          : `[0:v][${sceneInputIndex}:v]overlay=0:0:format=auto[vout]`,
        "-map",
        "[vout]"
      );
      command.push("-map", audioLane ? "1:a:0" : "0:a?");
    }
  } else if (overlayMode === "text") {
    command.push("-vf", joinVideoFilters([outputVideoFilter, getMediaOverlayFilter(onAirOverlayPath, output)]));
    command.push("-map", "0:v:0", "-map", audioLane ? "1:a:0" : "0:a?");
  } else {
    if (outputVideoFilter) {
      command.push("-vf", outputVideoFilter);
    }
    command.push("-map", "0:v:0", "-map", audioLane ? "1:a:0" : "0:a?");
  }

  // The lane's volume is applied by -af only when the lane audio was NOT already folded into the
  // PiP mix (where the graph carries the volume). -shortest is set whenever an audio lane loops OR a
  // PiP input is live: it bounds the encode to the programme's OWN stream — [vout] follows the
  // programme video (overlay's main input) and [aout] is amix duration=first — so a looping lane, the
  // ever-fed scene pipe (which never EOFs), or a still-publishing PiP cannot stretch a programme that
  // ends. Note it does NOT rescue a programme that never delivers EOF (a remote source that hangs):
  // [vout] then never ends either, and the duration-bound and feed-audio watchdogs are the net there,
  // exactly as without a PiP.
  if (audioLane && !pipAudioMapped) {
    command.push("-af", `volume=${Math.max(0, Math.min(1, audioLane.volumePercent / 100)).toFixed(3)}`);
  }
  if ((audioLane && !pipAudioMapped) || attachLive) {
    command.push("-shortest");
  }

  command.push(
    "-c:v",
    "libx264",
    "-preset",
    encoder.preset,
    "-maxrate",
    encoder.maxrate,
    "-bufsize",
    encoder.bufsize,
    "-pix_fmt",
    "yuv420p",
    "-g",
    getOutputGopSize(output),
    "-tune",
    "zerolatency",
    "-bf",
    "0",
    "-c:a",
    "aac",
    "-ar",
    "44100",
    "-b:a",
    encoder.audioBitrate
  );
  appendFfmpegOutputArgs(command, outputTarget);

  return command;
}

function getLiveBridgeFfmpegCommand(
  input: string,
  outputTarget: ReturnType<typeof buildFfmpegOutputTarget>,
  overlayMode: OnAirOverlayMode,
  output: WorkerStreamOutputSettings,
  encoder: ResolvedEncoderQualitySettings
): string[] {
  const command = ["-hide_banner", "-loglevel", "warning", "-y", ...buildFfmpegInputArgs({ input })];
  const outputVideoFilter = isStreamScaleEnabled(process.env) ? getOutputVideoFilter(output) : "";

  if (overlayMode === "scene") {
    command.push(
      "-f",
      "image2pipe",
      "-framerate",
      String(ON_AIR_SCENE_PIPE_FRAMERATE),
      "-thread_queue_size",
      String(ON_AIR_SCENE_PIPE_QUEUE_FRAMES),
      "-vcodec",
      "png",
      "-i",
      `pipe:${ON_AIR_SCENE_PIPE_FD}`
    );
    command.push(
      "-filter_complex",
      outputVideoFilter
        ? `[0:v]${outputVideoFilter}[base];[base][1:v]overlay=0:0:format=auto[vout]`
        : "[0:v][1:v]overlay=0:0:format=auto[vout]",
      "-map",
      "[vout]",
      "-map",
      "0:a?"
    );
  } else if (overlayMode === "text") {
    command.push("-vf", joinVideoFilters([outputVideoFilter, getMediaOverlayFilter(onAirOverlayPath, output)]));
    command.push("-map", "0:v:0", "-map", "0:a?");
  } else {
    if (outputVideoFilter) {
      command.push("-vf", outputVideoFilter);
    }
    command.push("-map", "0:v:0", "-map", "0:a?");
  }

  command.push(
    "-c:v",
    "libx264",
    "-preset",
    encoder.preset,
    "-maxrate",
    encoder.maxrate,
    "-bufsize",
    encoder.bufsize,
    "-pix_fmt",
    "yuv420p",
    "-g",
    getOutputGopSize(output),
    "-tune",
    "zerolatency",
    "-bf",
    "0",
    "-c:a",
    "aac",
    "-ar",
    "44100",
    "-b:a",
    encoder.audioBitrate
  );
  appendFfmpegOutputArgs(command, outputTarget);

  return command;
}

function getStandbyFfmpegCommand(
  outputTarget: ReturnType<typeof buildFfmpegOutputTarget>,
  overlayMode: OnAirOverlayMode,
  output: WorkerStreamOutputSettings,
  encoder: ResolvedEncoderQualitySettings
): string[] {
  const scale = getOutputScaleFactor(output);
  const command = [
    "-hide_banner",
    "-loglevel",
    "warning",
    "-y",
    "-re",
    "-f",
    "lavfi",
    "-i",
    `color=c=0x0b1f18:s=${output.width}x${output.height}:r=${output.fps}`,
    "-f",
    "lavfi",
    "-i",
    "anullsrc=channel_layout=stereo:sample_rate=44100",
  ];

  if (overlayMode === "scene") {
    command.push(
      "-f",
      "image2pipe",
      "-framerate",
      String(ON_AIR_SCENE_PIPE_FRAMERATE),
      "-thread_queue_size",
      String(ON_AIR_SCENE_PIPE_QUEUE_FRAMES),
      "-vcodec",
      "png",
      "-i",
      `pipe:${ON_AIR_SCENE_PIPE_FD}`
    );
    command.push("-filter_complex", "[0:v][2:v]overlay=0:0:format=auto[vout]", "-map", "[vout]", "-map", "1:a");
  } else {
    command.push(
      "-vf",
      `drawtext=fontfile=/usr/share/fonts/TTF/DejaVuSans.ttf:textfile=${standbySlatePath}:reload=1:fontcolor=white:fontsize=${Math.max(20, Math.round(34 * scale))}:x=(w-text_w)/2:y=(h-text_h)/2:line_spacing=${Math.max(8, Math.round(12 * scale))}`,
      "-map",
      "0:v:0",
      "-map",
      "1:a"
    );
  }

  command.push(
    "-c:v",
    "libx264",
    "-preset",
    encoder.preset,
    "-maxrate",
    encoder.maxrate,
    "-bufsize",
    encoder.bufsize,
    "-pix_fmt",
    "yuv420p",
    "-g",
    getOutputGopSize(output),
    "-tune",
    "zerolatency",
    "-bf",
    "0",
    "-c:a",
    "aac",
    "-ar",
    "44100",
    "-b:a",
    encoder.audioBitrate,
    "-shortest"
  );
  appendFfmpegOutputArgs(command, outputTarget);

  return command;
}

function shouldUseSceneRenderer(): boolean {
  return (process.env.SCENE_RENDERER_ENABLED || "1") !== "0";
}

/**
 * Fonts are loaded once per process: they are the renderer's only external input, and re-reading
 * them per frame would put filesystem I/O on the render path for no benefit.
 */
async function getSceneRendererFonts(): Promise<SceneRenderFont[]> {
  sceneRendererFonts ??= await loadSceneRendererFonts(process.env);
  return sceneRendererFonts;
}

function buildSceneRenderRequest(outputSettings: WorkerStreamOutputSettings): SceneRenderRequest | null {
  if (!currentScenePayload) {
    return null;
  }

  const viewport = getSceneRendererViewport(process.env, outputSettings);
  return {
    payload: currentScenePayload,
    engagement: currentSceneEngagement,
    game: currentSceneGame,
    chat: currentSceneChat,
    // When the source is attached as a live PiP input, the renderer must NOT draw its snapshot
    // panel: that panel is opaque and would sit ON TOP of the live video (which the encoder lays
    // under the scene PNG). Nulling the frame here makes buildOverlaySceneLayout skip the source
    // layer entirely, leaving a hole for the live picture to show through. v1 draws no chrome
    // around the live window.
    sourceFrame: playoutLiveSourceAttached ? null : currentSceneSourceFrame,
    width: viewport.width,
    height: viewport.height
  };
}

/** True when the current scene carries an enabled game layer, so the game path can run at all. */
function scenePayloadHasGameLayer(): boolean {
  return Boolean(currentScenePayload?.scene.customLayers.some((layer) => layer.kind === "game" && layer.enabled));
}

/**
 * Refreshes the on-air game view from the runtime record.
 *
 * The game is steered in the worker container and drawn in the playout container, so the state
 * crosses through Postgres like the vote tally does. Gated on the scene actually carrying a game
 * layer — with game layers off there is no read, no view, and no game code in the render path.
 * A failed read keeps the last view: a database blip must not blank a running game, and a frozen
 * board beats a flickering one.
 */
async function refreshSceneGameView(): Promise<void> {
  if (!scenePayloadHasGameLayer()) {
    currentSceneGame = null;
    return;
  }

  try {
    currentSceneGame = buildChatGameOverlayViewFromRuntimeRecord(await readChatGameRuntimeRecord());
  } catch (error) {
    logRuntimeEvent("scene.game.read_failed", {
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

/**
 * Refreshes the on-air engagement view — the poll or the skip campaign — from the persisted rows.
 *
 * Both are tallied in the worker container and drawn in the playout container, so the state
 * crosses through Postgres exactly like the chat game's does. Unlike the game there is no scene
 * layer to gate on — the engagement panel rides the right rail of every scene — so the gate is the
 * payload itself plus what the rows say. The views are re-derived per interval rather than only
 * per read, because the countdowns have to tick between the worker's change-driven flushes; that
 * same re-derivation takes an expired poll or a lapsed campaign off air even when a failed read
 * keeps the last rows around. When both rows project to something, chooseEngagementOverlayView
 * settles the one panel slot the same way the worker-side view does.
 */
async function refreshSceneEngagementView(): Promise<void> {
  if (!currentScenePayload) {
    currentSceneEngagement = null;
    return;
  }

  try {
    lastVoteSessionRecord = await readChatVoteSessionRecord();
    lastSkipVoteRecord = await readChatSkipVoteRecord();
  } catch (error) {
    logRuntimeEvent("scene.engagement.read_failed", {
      error: error instanceof Error ? error.message : String(error)
    });
  }

  const now = new Date();
  currentSceneEngagement = chooseEngagementOverlayView(
    lastVoteSessionRecord ? buildEngagementOverlayViewFromVoteSession(lastVoteSessionRecord, now) : null,
    lastSkipVoteRecord ? buildEngagementOverlayViewFromSkipVote(lastSkipVoteRecord, now) : null
  );
}

/**
 * Refreshes the on-air chat view from the persisted row.
 *
 * Chat arrives in the worker container and the overlay renders here, so the messages cross
 * through Postgres like the poll, the skip campaign, and the game. Re-projected per interval
 * rather than per read for the same reason the engagement view is: the per-message TTL has to
 * age messages off air between the worker's change-driven flushes, including when a failed read
 * keeps the last row around. A failed read keeps the last view rather than blanking a lively
 * panel over a database blip.
 */
async function refreshSceneChatView(): Promise<void> {
  if (!currentScenePayload) {
    currentSceneChat = null;
    return;
  }

  try {
    lastChatOverlayRecord = await readChatOverlayMessagesRecord();
  } catch (error) {
    logRuntimeEvent("scene.chat.read_failed", {
      error: error instanceof Error ? error.message : String(error)
    });
  }

  currentSceneChat = lastChatOverlayRecord
    ? buildChatOverlayViewFromMessages(lastChatOverlayRecord, new Date())
    : null;
}

/** The first enabled source layer with a linked source; one frame input, one drawn layer. */
function scenePayloadSourceLayer(): OverlayCustomLayerView | null {
  for (const entry of currentScenePayload?.scene.customLayers ?? []) {
    if (entry.kind === "source" && entry.enabled && entry.sourceId) {
      return entry;
    }
  }
  return null;
}

function scenePayloadSourceLayerId(): string {
  return scenePayloadSourceLayer()?.sourceId ?? "";
}

/**
 * Refreshes the sampled video-source frame for the renderer (M57).
 *
 * Runs on the renderer loop's cadence, never on the reconciliation path, and never blocks on a
 * capture: the actual ffmpeg grab is detached behind an in-flight guard, and this function only
 * decides whether one is due and projects the last capture into a view. The gate order means
 * "switch off" needs no restart — within the policy TTL the sampler stops starting captures and
 * the frame goes null, so the next rasterisation simply has no panel.
 */
async function refreshSceneSourceFrame(): Promise<void> {
  const sourceId = scenePayloadSourceLayerId();
  if (!sourceId) {
    currentSceneSourceFrame = null;
    return;
  }

  const nowMs = Date.now();
  if (
    !sourceSnapshotPolicy ||
    sourceSnapshotPolicy.sourceId !== sourceId ||
    nowMs - sourceSnapshotPolicy.checkedAtMs > SOURCE_SNAPSHOT_POLICY_TTL_MS
  ) {
    try {
      const managed = await readManagedConfigRecord();
      const enabled = resolveSourceLayerRuntimeEnabled(managed, process.env);
      const intervalMs = resolveSourceSnapshotIntervalSeconds(managed, process.env) * 1000;
      const url = enabled ? ((await readOverlayVideoSourceUrls([sourceId]))[sourceId] ?? "") : "";
      if (sourceSnapshotPolicy && sourceSnapshotPolicy.sourceId !== sourceId) {
        // The scene now points at a different source: forget the old cadence so the new feed is
        // sampled immediately instead of waiting out the previous source's interval.
        sourceSnapshotLastStartedAtMs = 0;
        sourceSnapshotLastSuccessAtMs = 0;
        sourceSnapshotFailures = 0;
      }
      sourceSnapshotPolicy = { checkedAtMs: nowMs, sourceId, enabled, intervalMs, url };
    } catch (error) {
      // A failed read keeps the last policy: a database blip must not stop a healthy sampler,
      // and with no policy at all the layer simply stays hidden until the next tick.
      logRuntimeEvent("scene.source.policy_read_failed", {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  const policy = sourceSnapshotPolicy;
  if (!policy || policy.sourceId !== sourceId || !policy.enabled || !policy.url) {
    currentSceneSourceFrame = null;
    return;
  }

  if (
    shouldStartSourceCapture({
      nowMs,
      lastStartedAtMs: sourceSnapshotLastStartedAtMs,
      intervalMs: policy.intervalMs,
      inFlight: sourceSnapshotInFlight
    })
  ) {
    startSourceSnapshotCapture(policy.url, sourceId);
  }

  currentSceneSourceFrame =
    sourceSnapshotDataUri && sourceSnapshotSourceId === sourceId
      ? {
          dataUri: sourceSnapshotDataUri,
          status: deriveSourceFrameStatus({
            nowMs,
            lastSuccessAtMs: sourceSnapshotLastSuccessAtMs,
            intervalMs: policy.intervalMs
          }),
          capturedAt: sourceSnapshotCapturedAt
        }
      : null;
}

// --- Source live attach decision (M57 stage 2, Etappes B–D) ----------------------------------

// In-memory by design (see relay-presence.ts). The breaker opens on a failed attach start (wired
// in Etappe C, in the playout exit handler) and its cooldown already participated in the decision
// from Etappe B, so the logged behaviour is the acted-on behaviour.
let sourceLiveAttachBreaker = closedAttachBreaker();
let lastSourceLiveAttachLogKey = "";

/**
 * What a decided attach carries into the playout start: the read URL, the layer placement (for the
 * PiP box), the configured gain, and whether the relay reported an audio track on the source.
 */
type ResolvedLiveSourceAttach = {
  sourceId: string;
  readUrl: string;
  placement: OverlayCustomLayerView;
  gainPercent: number;
  hasAudioTrack: boolean;
};

/**
 * Hands the studio the last thing that actually happened to a pushed source (M57 stage 2, Etappe E).
 *
 * Deduped on the whole write, so a state that has not changed costs nothing, and detached from the
 * caller: the broadcast path must never wait on an observation write (see the chain declaration
 * above). A failure is logged and dropped — the next change writes again.
 */
function recordSourceLiveState(write: SourceLiveStateWrite | null): void {
  if (!write) {
    return;
  }

  const key = `${write.sourceId}:${write.state}:${write.retryAt}`;
  if (key === lastSourceLiveStateKey) {
    return;
  }
  lastSourceLiveStateKey = key;

  sourceLiveStateWriteChain = sourceLiveStateWriteChain
    .then(() => recordOverlayVideoSourceLiveState(write))
    .catch((error: unknown) => {
      logRuntimeEvent("playout.source-live.state_write_failed", {
        source: write.sourceId,
        error: error instanceof Error ? error.message : String(error)
      });
    });
}

/**
 * Decides whether this cycle would attach the scene's pushed source as a live PiP input, logs the
 * decision on change (the operator-facing transition marker from Etappe B), and — when the answer
 * is attach — resolves the read URL and placement the start path needs. The presence fetch only
 * happens when the upcoming selection is an ASSET (a live bridge or standby slate never builds a
 * PiP, so polling the relay for them is wasted traffic), both switches are on, the scene has an
 * active source layer and the breaker is closed — so a disabled feature, or any non-asset selection,
 * costs zero relay traffic; the URL read only happens on an actual attach. Returns null whenever the
 * source stays on the stage-1 snapshot panel.
 */
async function resolveLiveSourceAttach(
  managed: ManagedConfigRecord,
  selectionIsAsset: boolean
): Promise<ResolvedLiveSourceAttach | null> {
  const nowMs = Date.now();
  const layer = scenePayloadSourceLayer();
  const sourceId = layer?.sourceId ?? "";

  // A live bridge or standby slate can never carry a PiP, so there is no attach decision to make or
  // log for them — and polling the relay would be wasted traffic. The attach-decision log is an
  // asset-playout marker; it resumes when an asset is selected again.
  //
  // The studio state, however, must NOT simply pause here: a source that was live when the last
  // asset ended would otherwise keep claiming to be on air right through a live bridge or a standby
  // slate. So the honest state for that stretch is written before returning.
  if (!selectionIsAsset) {
    recordSourceLiveState(sourceId ? { sourceId, state: "not-asset-playout", retryAt: "" } : null);
    return null;
  }

  const sourceLiveEnabled = resolveSourceLiveEnabled(managed, process.env);
  const sourceLayerEnabled = resolveSourceLayerRuntimeEnabled(managed, process.env);

  const presence =
    sourceLiveEnabled && sourceLayerEnabled && sourceId !== "" && !isAttachBreakerOpen(sourceLiveAttachBreaker, nowMs)
      ? await fetchRelaySourcePresence({ sourceId })
      : null;

  const outcome = decideSourceLiveAttach({
    sourceLiveEnabled,
    sourceLayerEnabled,
    sourceId,
    presence,
    breaker: sourceLiveAttachBreaker,
    nowMs
  });

  const logKey = `${outcome.decision}:${outcome.reason}:${sourceId}`;
  if (logKey !== lastSourceLiveAttachLogKey) {
    lastSourceLiveAttachLogKey = logKey;
    logRuntimeEvent("playout.source-live.attach_decision", {
      decision: outcome.decision,
      reason: outcome.reason,
      ...(sourceId ? { source: sourceId } : {})
    });
  }

  // The same decision, projected for the operator (Etappe E) — but only where the decision is
  // already the final answer. buildSourceLiveStateWrite returns null for an ATTACH precisely
  // because deciding to attach is not attaching: the URL still has to resolve below, and even then
  // the intent is only consumed if a process actually (re)starts. The live state is written by the
  // start path instead, from the flag that means an input really went into the command.
  recordSourceLiveState(buildSourceLiveStateWrite({ sourceId, outcome, breaker: sourceLiveAttachBreaker, nowMs }));

  if (outcome.decision !== "attach" || !layer) {
    return null;
  }

  // Attach decided: resolve the internal read URL now (never stored — derived on read). A missing
  // URL means the source is not fully provisioned, so fall back to the snapshot panel rather than
  // starting ffmpeg against an empty input.
  let readUrl = "";
  try {
    readUrl = (await readOverlayVideoSourceUrls([sourceId]))[sourceId] ?? "";
  } catch (error) {
    logRuntimeEvent("playout.source-live.url_read_failed", {
      source: sourceId,
      error: error instanceof Error ? error.message : String(error)
    });
  }
  if (!readUrl) {
    // Decided to attach, but the source has no address to read from — not provisioned, or the
    // internal key could not be resolved. The answer is final here, so it is recorded here: the
    // start path will never see this intent and could not correct a stale "live" on its own.
    recordSourceLiveState({ sourceId, state: "attach-unavailable", retryAt: "" });
    return null;
  }

  return {
    sourceId,
    readUrl,
    placement: layer,
    gainPercent: resolveSourceLiveGainPercent(managed, process.env),
    hasAudioTrack: presence?.hasAudio === true
  };
}

/** One detached capture at a time; the guard in shouldStartSourceCapture is the backpressure. */
function startSourceSnapshotCapture(url: string, sourceId: string): void {
  sourceSnapshotInFlight = true;
  sourceSnapshotLastStartedAtMs = Date.now();

  void (async () => {
    const result = await captureSourceSnapshot({
      url,
      sourceId,
      mediaRoot: getMediaRoot(),
      timeoutMs: resolveSourceSnapshotTimeoutMs(process.env)
    });

    if (result.ok) {
      const png = await fs.readFile(getSourceSnapshotPath(sourceId, getMediaRoot()));
      sourceSnapshotDataUri = `data:image/png;base64,${png.toString("base64")}`;
      sourceSnapshotCapturedAt = new Date().toISOString();
      sourceSnapshotLastSuccessAtMs = Date.now();
      sourceSnapshotSourceId = sourceId;
      if (sourceSnapshotFailures > 0) {
        await resolveIncident("playout.source-snapshot.failed", "The scene's video source is delivering frames again.");
      }
      sourceSnapshotFailures = 0;
      return;
    }

    sourceSnapshotFailures += 1;
    // The feed address never reaches a log or an incident whole — same custody rule as playback
    // inputs, because feed URLs routinely embed credentials.
    logRuntimeEvent("scene.source.capture_failed", {
      feed: summarizeSourceFeed(url),
      failures: sourceSnapshotFailures,
      error: result.error
    });
    if (shouldRaiseSourceSnapshotIncident(sourceSnapshotFailures)) {
      await upsertIncident({
        scope: "playout",
        severity: "warning",
        title: "The scene's video source is not delivering frames",
        message: `Sampling ${summarizeSourceFeed(url)} has failed ${String(sourceSnapshotFailures)} times in a row. The video source layer is hidden on air until a capture succeeds again; playout itself is unaffected.`,
        fingerprint: "playout.source-snapshot.failed"
      });
    }
  })()
    .catch((error: unknown) => {
      logRuntimeEvent("scene.source.capture_crashed", {
        error: error instanceof Error ? error.message : String(error)
      });
    })
    .finally(() => {
      sourceSnapshotInFlight = false;
    });
}

function isWritablePipe(value: unknown): value is Writable {
  return Boolean(value) && typeof (value as Writable).write === "function";
}

async function captureRenderedSceneFrame(outputSettings: WorkerStreamOutputSettings): Promise<Buffer> {
  const request = buildSceneRenderRequest(outputSettings);
  if (!request) {
    throw new Error("No overlay scene payload is available to render yet.");
  }

  return renderSceneFrame(request, await getSceneRendererFonts());
}

/**
 * Guarantees a scene payload exists before the first frame is rendered.
 *
 * The reconciliation cycle writes the overlay payload *after* starting playout, so on the first
 * start of a process the cache is still empty. Because the overlay mode is baked into the ffmpeg
 * command for the whole run, rendering nothing there would pin the overlay to text mode until the
 * next asset boundary. The previous Chromium renderer did not have this ordering problem because
 * it fetched state over HTTP from the web app rather than from worker-local memory.
 */
async function ensureScenePayload(asset: AssetRecord | null): Promise<void> {
  if (currentScenePayload) {
    return;
  }

  try {
    const state = await readAppState();
    if (!state.overlay.enabled) {
      return;
    }

    await writeOnAirOverlay(state, asset, state.playout.queueItems[0]?.kind || (asset ? "asset" : ""));
  } catch (error) {
    logRuntimeEvent("scene.payload.prime_failed", {
      error: error instanceof Error ? error.message : "Unknown scene payload priming failure."
    });
  }
}

async function prepareSceneRendererFrame(outputSettings: WorkerStreamOutputSettings): Promise<Buffer | null> {
  if (!shouldUseSceneRenderer()) {
    return null;
  }

  try {
    const frame = await captureRenderedSceneFrame(outputSettings);
    await resolveIncident("playout.scene-render.failed", "On-air scene renderer is healthy.");
    return frame;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown on-air scene renderer error.";
    logRuntimeEvent("scene.render.fallback", { error: message });
    await upsertIncident({
      scope: "playout",
      severity: "warning",
      title: "On-air scene renderer fell back to text mode",
      message,
      fingerprint: "playout.scene-render.failed"
    });
    return null;
  }
}

function stopSceneRendererLoop(): void {
  sceneRendererAbortController?.abort();
  sceneRendererAbortController = null;
}

function startSceneRendererLoop(
  targetPipe: Writable,
  initialFrame: Buffer,
  outputSettings: WorkerStreamOutputSettings
): void {
  stopSceneRendererLoop();
  const controller = new AbortController();
  const intervalMs = getSceneRendererIntervalMs(process.env);
  sceneRendererAbortController = controller;

  let currentFrame = initialFrame;

  // A pipe whose reader goes away emits 'error', and a stream error with no listener is an uncaught
  // exception -- which this process answers with exit(1). Nothing here used to register one: the
  // drain wait happened to serve as the stream's only error listener, and passing it the abort
  // signal removed it at exactly the wrong moment, since teardown aborts and then SIGTERMs ffmpeg in
  // the same turn. Every ordinary asset boundary took that path, so this is registered up front and
  // for the whole lifetime of the pipe.
  targetPipe.on("error", (error: unknown) => {
    logRuntimeEvent("scene.pipe.error", {
      error: error instanceof Error ? error.message : String(error)
    });
  });

  // Feeding the pipe and rasterising the scene run independently on purpose. ffmpeg pulls this
  // input at ON_AIR_SCENE_PIPE_FRAMERATE and `overlay` blocks until both of its inputs have a
  // frame, so a writer that pauses for the render interval throttles the whole encode down to the
  // render rate. That is what halved the programme feed: frames were pushed every 2s into a pipe
  // declared at 1fps, and playout produced 30s of video per minute of wall clock.
  //
  // Pacing is against the wall clock rather than against backpressure. Writing until the pipe
  // pushes back keeps the overlay fed, but it also keeps every buffer between here and ffmpeg
  // permanently full, and a scene change then waits behind all of it -- tens of seconds for a
  // cheaply compressing lower third. Staying a fixed lead ahead of real time feeds the filter just
  // as reliably and bounds that delay to the lead itself.
  const startedAtMs = Date.now();

  // The renderer's normal life is logged, not only its failures.
  //
  // Its sole observable used to be scene.pipe.error. When a fallback video exited 255 forty-three
  // seconds into playback and took the uplink's encoder down with it, the logs could not say
  // whether the overlay had been feeding that process at all — and a starved overlay pipe is the
  // documented way to stall this encode. Two plausible causes, no way to separate them.
  logRuntimeEvent("scene.pipe.open", {});
  const idleMs = Math.max(50, Math.floor(ON_AIR_SCENE_PIPE_FRAME_INTERVAL_MS / 4));
  let framesWritten = 0;

  const sleep = (ms: number) => abortableDelay(ms, controller.signal);

  void (async () => {
    while (!controller.signal.aborted && !targetPipe.destroyed) {
      try {
        if (framesWritten >= framesDueByNow(startedAtMs, Date.now(), ON_AIR_SCENE_PIPE_LEAD_FRAMES)) {
          await sleep(idleMs);
          continue;
        }

        framesWritten += 1;
        if (!targetPipe.write(currentFrame)) {
          // Only reached if ffmpeg has fallen behind its own declared rate; waiting for drain keeps
          // the lead from turning into an unbounded backlog.
          await once(targetPipe, "drain", { signal: controller.signal });
        }
      } catch {
        break;
      }
    }

    // How many frames actually reached ffmpeg, and for how long. A transition where the overlay
    // never fed the new process looks like a handful of frames and a lifetime of seconds; one that
    // fed it properly looks like roughly one frame per second of playback.
    logRuntimeEvent("scene.pipe.closed", {
      framesWritten,
      livedForMs: Date.now() - startedAtMs
    });

    // Stopping the writer has to stop the renderer with it. The writer also leaves this loop on a
    // dead pipe, and the module-level handle is cleared below -- without this abort the renderer
    // would keep rasterising frames nobody reads, unreachable by stopSceneRendererLoop().
    controller.abort();

    if (!targetPipe.destroyed) {
      targetPipe.end();
    }

    if (sceneRendererAbortController === controller) {
      sceneRendererAbortController = null;
    }
  })().catch((error: unknown) => {
    // An un-awaited async IIFE that rejects is an unhandled rejection, which this process only
    // logs -- leaving a dead loop behind and no indication of why.
    logRuntimeEvent("scene.pipe.writer_failed", {
      error: error instanceof Error ? error.message : String(error)
    });
  });

  void (async () => {
    let currentKey = "";

    while (!controller.signal.aborted && !targetPipe.destroyed) {
      try {
        await refreshSceneGameView();
        await refreshSceneEngagementView();
        await refreshSceneChatView();
        await refreshSceneSourceFrame();
        const request = buildSceneRenderRequest(outputSettings);
        if (request) {
          // The scene only changes when its content changes. Re-pushing the cached PNG keeps the
          // ffmpeg overlay input fed without rasterising an identical lower third for the entire
          // length of a video.
          const nextKey = sceneFrameCacheKey(request);
          if (nextKey !== currentKey) {
            currentFrame = await renderSceneFrame(request, await getSceneRendererFonts());
            currentKey = nextKey;
            await resolveIncident("playout.scene-render.failed", "On-air scene renderer is healthy.");
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown on-air scene renderer error.";
        logRuntimeEvent("scene.render.update_failed", { error: message });
        // Recording the incident goes through the same database the render may have just failed on,
        // so it gets its own guard. Losing the incident is survivable; losing this loop is not.
        await upsertIncident({
          scope: "playout",
          severity: "warning",
          title: "On-air scene renderer update failed",
          message,
          fingerprint: "playout.scene-render.failed"
        }).catch(() => undefined);
      }

      await sleep(intervalMs);
    }
  })().catch((error: unknown) => {
    // Deliberately does not abort the controller. A dead renderer leaves the writer pushing the
    // last good frame, so the overlay freezes; aborting would starve the overlay input instead and
    // throttle the entire encode. A stale lower third beats a stalled channel.
    logRuntimeEvent("scene.render.loop_failed", {
      error: error instanceof Error ? error.message : String(error)
    });
  });
}

function buildWorkerScenePayload(args: {
  state: AppState;
  queueKind: AppState["playout"]["queueItems"][number]["kind"] | "";
  currentTitle: string;
  nextTitle: string;
  nextScheduleItem?: WorkerScheduleOccurrence | null;
  nextTimeLabel?: string;
  currentCategory?: string;
  currentSourceName?: string;
  queueTitles?: string[];
}){
  const nextScheduleTitle = args.nextScheduleItem?.title ?? "";
  const resolvedNextTitle =
    args.nextScheduleItem && (!args.nextTitle || args.nextTitle === nextScheduleTitle)
      ? resolveScheduleOccurrenceOverlayTitle(args.state, args.nextScheduleItem) || nextScheduleTitle
      : args.nextTitle;

  return buildOverlayScenePayload({
    overlay: {
      channelName: args.state.overlay.channelName,
      replayLabel: args.state.overlay.replayLabel,
      brandBadge: args.state.overlay.brandBadge,
      accentColor: args.state.overlay.accentColor,
      scenePreset: args.state.overlay.scenePreset,
      insertScenePreset: args.state.overlay.insertScenePreset,
      standbyScenePreset: args.state.overlay.standbyScenePreset,
      reconnectScenePreset: args.state.overlay.reconnectScenePreset,
      headline: args.state.overlay.headline,
      insertHeadline: args.state.overlay.insertHeadline,
      standbyHeadline: args.state.overlay.standbyHeadline,
      reconnectHeadline: args.state.overlay.reconnectHeadline,
      surfaceStyle: args.state.overlay.surfaceStyle,
      panelAnchor: args.state.overlay.panelAnchor,
      titleScale: args.state.overlay.titleScale,
      typographyPreset: args.state.overlay.typographyPreset,
      showClock: args.state.overlay.showClock,
      showNextItem: args.state.overlay.showNextItem,
      showScheduleTeaser: args.state.overlay.showScheduleTeaser,
      showCurrentCategory: args.state.overlay.showCurrentCategory,
      showSourceLabel: args.state.overlay.showSourceLabel,
      showQueuePreview: args.state.overlay.showQueuePreview,
      queuePreviewCount: args.state.overlay.queuePreviewCount,
      emergencyBanner: args.state.overlay.emergencyBanner,
      tickerText: args.state.overlay.tickerText,
      layerOrder: args.state.overlay.layerOrder,
      disabledLayers: args.state.overlay.disabledLayers,
      customLayers: args.state.overlay.customLayers
    },
    queueKind: args.queueKind || "asset",
    target: "on-air-text",
    currentTitle: args.currentTitle,
    currentCategory: args.currentCategory,
    currentSourceName: args.currentSourceName,
    nextTitle: resolvedNextTitle,
    nextTimeLabel: args.nextTimeLabel,
    queueTitles: args.queueTitles,
    timeZone: resolveChannelTimeZone(args.state.managedConfig)
  });
}

async function writeStandbySlate(
  state: AppState,
  queueKind: AppState["playout"]["queueItems"][number]["kind"] | "" = state.playout.queueItems[0]?.kind || "standby"
): Promise<void> {
  const scheduleMoment = getCurrentScheduleMoment({
    now: new Date(),
    timeZone: resolveChannelTimeZone(state.managedConfig)
  });
  const occurrences = buildScheduleOccurrences({
    date: scheduleMoment.date,
    blocks: state.scheduleBlocks
  });
  const currentItem = findCurrentScheduleOccurrence({
    occurrences,
    currentTime: scheduleMoment.time
  });
  const upcomingItems = listUpcomingScheduleOccurrences({
    occurrences,
    currentTime: scheduleMoment.time,
    currentOccurrence: currentItem
  });
  const nextItem = upcomingItems[0] ?? null;
  const payload = buildWorkerScenePayload({
    state,
    queueKind,
    currentTitle: currentItem?.title || "Stand by",
    nextTitle: nextItem ? nextItem.title : "Programming will resume shortly",
    nextScheduleItem: nextItem,
    nextTimeLabel: nextItem ? `${nextItem.startTime}-${nextItem.endTime}` : "No next block configured",
    currentCategory: currentItem?.categoryName,
    currentSourceName: currentItem?.sourceName,
    queueTitles: upcomingItems.slice(0, state.overlay.queuePreviewCount).map((item) => item.title)
  });
  const lines = buildOverlayTextLinesFromScenePayload(payload);
  await fs.writeFile(standbySlatePath, `${lines.join("\n")}\n`, "utf8");
}

/**
 * The chapter-aware display title for the asset that is on air right now.
 *
 * Derived from elapsed playback rather than from the boundary fired set, so every overlay
 * rewrite — the 15s cycle, an operator refresh, a scene re-render — shows the chapter that is
 * actually playing instead of the one that was current at the last boundary event. Empty when
 * the asset is not the one on air, has no chapters, or the active chapter carries no title;
 * callers then fall back to the asset title exactly as before chapters existed.
 */
function resolveOnAirChapterTitle(state: AppState, asset: AssetRecord | null): string {
  if (!asset || state.playout.currentAssetId !== asset.id || state.playout.processStartedAt === "") {
    return "";
  }

  const chapters = parseAssetChaptersJson(asset.chaptersJson);
  if (chapters.length === 0) {
    return "";
  }

  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - new Date(state.playout.processStartedAt).getTime()) / 1000));
  const chapter = getAssetChapterAt(chapters, elapsedSeconds);
  if (!chapter || chapter.title === "") {
    return "";
  }

  // The replay prefix stays: a chapter changes what plays, not the fact that it is a replay.
  return buildAssetDisplayTitle({ title: chapter.title, titlePrefix: asset.titlePrefix });
}

async function writeOnAirOverlay(
  state: AppState,
  asset: AssetRecord | null,
  queueKind: AppState["playout"]["queueItems"][number]["kind"] | "" = state.playout.queueItems[0]?.kind || "asset",
  overrides: {
    currentTitle?: string;
    nextTitle?: string;
    nextTimeLabel?: string;
    currentCategory?: string;
    currentSourceName?: string;
    queueTitles?: string[];
  } = {}
): Promise<void> {
  const currentItem = getCurrentScheduleItem(state);
  const nextItem = getNextScheduleItem(state);
  const queueTitles =
    overrides.queueTitles ??
    state.playout.queuedAssetIds
      .map((id) => {
        const queuedAsset = state.assets.find((entry) => entry.id === id);
        return buildAssetDisplayTitle(queuedAsset);
      })
      .filter(Boolean)
      .slice(0, state.overlay.queuePreviewCount);
  const payload = buildWorkerScenePayload({
      state,
      queueKind,
      currentTitle:
        overrides.currentTitle ||
        resolveOnAirChapterTitle(state, asset) ||
        buildAssetDisplayTitle(asset) ||
        state.playout.currentTitle ||
        currentItem?.title ||
        "Stand by",
      nextTitle: overrides.nextTitle || nextItem?.title || "Coming up next",
      nextScheduleItem: nextItem,
      nextTimeLabel: overrides.nextTimeLabel || (nextItem ? `${nextItem.startTime}-${nextItem.endTime}` : "No next block configured"),
      currentCategory: overrides.currentCategory || currentItem?.categoryName || asset?.categoryName,
      currentSourceName:
        overrides.currentSourceName ||
        currentItem?.sourceName ||
        (asset ? state.sources.find((source) => source.id === asset.sourceId)?.name : ""),
      queueTitles
    });

  // The scene renderer runs on its own cadence, decoupled from the reconciliation cycle. Caching
  // the payload here means every state change that already refreshes the overlay text also feeds
  // the rendered scene, without the renderer having to re-read application state per frame.
  currentScenePayload = payload;

  const lines = buildOverlayTextLinesFromScenePayload(payload);
  await fs.writeFile(onAirOverlayPath, `${lines.join("\n")}\n`, "utf8");
}

/**
 * The refresh-grant HTTP exchange, shared by the identity and the broadcaster-slot refresh. What
 * differs between the two — which record holds the refresh token and where the result is stored —
 * stays in the callers; copying the exchange instead would let the two flows drift apart on
 * exactly the error handling that 401 recovery depends on.
 */
async function requestTwitchTokenRefresh(args: {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  errorLabel: string;
}): Promise<{ access_token: string; refresh_token?: string; expires_in?: number }> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: args.refreshToken,
    client_id: args.clientId,
    client_secret: args.clientSecret
  });

  const response = await fetch("https://id.twitch.tv/oauth2/token", {
    method: "POST",
    body
  });

  if (!response.ok) {
    throw new Error(`${args.errorLabel} failed with status ${response.status}.`);
  }

  return (await response.json()) as { access_token: string; refresh_token?: string; expires_in?: number };
}

// Renamed from refreshBroadcasterAccessToken: it always refreshed the *identity* connection
// (state.twitch), and since M51 "broadcaster" means the second slot — the old name pointed at
// the wrong one of the two.
async function refreshIdentityAccessToken(): Promise<string> {
  const state = await readAppState();
  const clientId = getTwitchClientId(state);
  const clientSecret = getTwitchClientSecret(state);

  if (!clientId || !clientSecret || !state.twitch.refreshToken) {
    throw new Error("Missing Twitch client credentials or refresh token.");
  }

  const payload = await requestTwitchTokenRefresh({
    clientId,
    clientSecret,
    refreshToken: state.twitch.refreshToken,
    errorLabel: "Twitch token refresh"
  });
  const refreshedAt = new Date().toISOString();
  const tokenExpiresAt = payload.expires_in
    ? new Date(Date.now() + payload.expires_in * 1000).toISOString()
    : state.twitch.tokenExpiresAt;

  await updateTwitchConnectionRecord({
    ...state.twitch,
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token ?? state.twitch.refreshToken,
    status: "connected",
    tokenExpiresAt,
    lastRefreshAt: refreshedAt,
    error: ""
  });

  await resolveIncident("twitch.refresh.failed", "Twitch token refresh succeeded.");
  return payload.access_token;
}

/**
 * Mirror of refreshIdentityAccessToken for the broadcaster slot. Deliberately does not touch the
 * slot's status on failure: an error status would flip the metadata gate to waiting, and since
 * the gate is what decides whether this refresh runs at all, a transient failure would lock the
 * slot out of ever refreshing again. The stale token stays, the next cycle retries, and the
 * caller's incident names the failure.
 */
async function refreshBroadcasterSlotAccessToken(): Promise<string> {
  const state = await readAppState();
  const clientId = getTwitchClientId(state);
  const clientSecret = getTwitchClientSecret(state);

  if (!clientId || !clientSecret || !state.twitchBroadcaster.refreshToken) {
    throw new Error("Missing Twitch client credentials or broadcaster refresh token.");
  }

  const payload = await requestTwitchTokenRefresh({
    clientId,
    clientSecret,
    refreshToken: state.twitchBroadcaster.refreshToken,
    errorLabel: "Twitch broadcaster token refresh"
  });
  const refreshedAt = new Date().toISOString();

  await updateTwitchBroadcasterConnectionRecord({
    ...state.twitchBroadcaster,
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token ?? state.twitchBroadcaster.refreshToken,
    status: "connected",
    tokenExpiresAt: payload.expires_in
      ? new Date(Date.now() + payload.expires_in * 1000).toISOString()
      : state.twitchBroadcaster.tokenExpiresAt,
    lastRefreshAt: refreshedAt,
    error: ""
  });

  await resolveIncident("twitch.refresh.failed", "Twitch broadcaster token refresh succeeded.");
  return payload.access_token;
}

async function resolveTwitchCategory(args: {
  accessToken: string;
  categoryName: string;
  clientId: string;
}): Promise<{ id: string; name: string } | null> {
  const normalizedName = args.categoryName.trim();
  if (!normalizedName) {
    return null;
  }

  const response = await fetch(
    `https://api.twitch.tv/helix/search/categories?query=${encodeURIComponent(normalizedName)}&first=10`,
    {
      headers: {
        Authorization: `Bearer ${args.accessToken}`,
        "Client-Id": args.clientId
      }
    }
  );

  if (!response.ok) {
    throw new Error(`Category lookup failed with status ${response.status}.`);
  }

  const payload = (await response.json()) as {
    data?: Array<{ id?: string; name?: string }>;
  };

  const exactMatch =
    payload.data?.find((entry) => entry.name?.toLowerCase() === normalizedName.toLowerCase() && entry.id && entry.name) ??
    payload.data?.find((entry) => entry.id && entry.name);

  return exactMatch?.id && exactMatch.name
    ? {
        id: exactMatch.id,
        name: exactMatch.name
      }
    : null;
}

function buildAssetFromPath(filePath: string, now: string): AssetRecord {
  const mediaRoot = getMediaRoot();
  const isFallback = filePath.toLowerCase().includes("fallback") || filePath.toLowerCase().includes("standby");
  const id = buildLocalLibraryAssetId(filePath);
  return {
    id,
    sourceId: LOCAL_LIBRARY_SOURCE_ID,
    title: path.basename(filePath, path.extname(filePath)).replace(/[_-]+/g, " "),
    path: filePath,
    folderPath: buildLocalLibraryFolderPath(filePath, mediaRoot),
    tags: [],
    status: "ready",
    includeInProgramming: true,
    fallbackPriority: isFallback ? 1 : 100,
    isGlobalFallback: isFallback,
    createdAt: now,
    updatedAt: now
  };
}

async function syncLocalMediaLibrary(): Promise<void> {
  const mediaRoot = getMediaRoot();
  const startedAt = new Date().toISOString();
  const scan = await scanMediaFiles({
    root: mediaRoot,
    isExcluded: (absolutePath) => isInternalMediaCachePath(absolutePath, mediaRoot)
  });
  const now = new Date().toISOString();
  const discoveredAssets = scan.files.map((filePath) => buildAssetFromPath(filePath, now));
  const state = await readAppState();
  const existingByPath = new Map(state.assets.map((asset) => [asset.path, asset]));
  const nextAssets: AssetRecord[] = discoveredAssets.map((asset) => {
    const existing = existingByPath.get(asset.path);
    return existing
        ? {
          ...existing,
          title: asset.title,
          folderPath: asset.folderPath,
          status: "ready",
          includeInProgramming: existing.includeInProgramming,
          fallbackPriority: asset.fallbackPriority,
          isGlobalFallback: asset.isGlobalFallback,
          updatedAt: now
        }
      : asset;
  });

  for (const asset of nextAssets) {
    await ensureLocalAssetThumbnail({
      assetId: asset.id,
      inputPath: asset.path,
      mediaRoot
    });
  }

  // A scan that could not list some directory proves nothing about the library's contents, so it
  // is fed in as a failed ingest and the wholesale replace below is skipped. Without that, an
  // unmounted volume deleted every local asset — the global fallback among them, which is the one
  // asset the channel needs when everything else is gone.
  const outcome: SourceSyncOutcome = {
    sourceId: LOCAL_LIBRARY_SOURCE_ID,
    ingestFailed: scan.failed,
    incomingAssetCount: nextAssets.length,
    storedAssetCount: state.assets.filter((asset) => asset.sourceId === LOCAL_LIBRARY_SOURCE_ID).length
  };
  const description = describeSourceSyncStatus(outcome, {
    ready: "Ready",
    empty: "Empty",
    preserved: "Scan failed (assets preserved)"
  });
  const failedDirectories = scan.failedDirectories.join(", ");

  await upsertSources([
    {
      id: LOCAL_LIBRARY_SOURCE_ID,
      name: "Local Media Library",
      type: "Filesystem scan",
      connectorKind: "local-library",
      enabled: true,
      status: description.status,
      externalUrl: "",
      notes: description.assetsPreserved
        ? `Could not read ${failedDirectories}; kept the ${description.effectiveAssetCount} stored item(s) rather than treating an unreadable mount as an empty library.`
        : "Scans files mounted into the media library volume.",
      lastSyncedAt: now
    }
  ]);
  await replaceSyncedSourceAssets({
    connector: "local-library",
    sources: [{ id: LOCAL_LIBRARY_SOURCE_ID }],
    storedAssets: state.assets,
    incomingAssets: nextAssets,
    failedSourceIds: scan.failed ? new Set([LOCAL_LIBRARY_SOURCE_ID]) : new Set()
  });

  if (scan.failed) {
    await upsertIncident({
      scope: "source",
      severity: "warning",
      title: "Local media library scan failed",
      message: `Could not read ${failedDirectories} under ${mediaRoot}. The ${description.effectiveAssetCount} stored item(s) were kept.`,
      fingerprint: "source.local-library.scan-failed"
    });
  } else {
    await resolveIncident("source.local-library.scan-failed", "The local media library scan completed without read errors.");
  }

  // The "library is empty" incident only makes sense once the scan is trustworthy; raising it on a
  // broken mount would point the operator at their content instead of their storage.
  if (discoveredAssets.length > 0) {
    await resolveIncident("source.local-library.empty", "Local media library now contains playable assets.");
  } else if (!scan.failed) {
    await upsertIncident({
      scope: "source",
      severity: "warning",
      title: "Local media library is empty",
      message: `No media files were found under ${mediaRoot}.`,
      fingerprint: "source.local-library.empty"
    });
  }

  await appendSourceSyncRuns([
    buildSourceSyncRun({
      sourceId: LOCAL_LIBRARY_SOURCE_ID,
      startedAt,
      finishedAt: now,
      status: scan.failed ? "error" : discoveredAssets.length > 0 ? "success" : "skipped",
      summary: scan.failed
        ? "Local media library scan could not be completed; stored assets were kept."
        : discoveredAssets.length > 0
          ? `Discovered ${discoveredAssets.length} file(s) in the local media library.`
          : "Local media library scan completed with no playable files.",
      discoveredAssets: discoveredAssets.length,
      readyAssets: discoveredAssets.length,
      errorMessage: scan.failed ? `Could not read ${failedDirectories}.` : ""
    })
  ]);
}

async function syncDirectMediaSources(): Promise<void> {
  const state = await readAppState();
  const now = new Date().toISOString();
  const directSources = state.sources.filter(
    (source) => source.connectorKind === "direct-media" && (source.enabled ?? true)
  );
  const startedAt = new Date().toISOString();
  // One pass decides both which sources produced an asset and which may be emptied, so the two
  // lists cannot drift apart the way they did when the invalid-URL branch only skipped the first.
  const plan = planDirectMediaSync(directSources);
  const directAssets: AssetRecord[] = plan.entries.map(({ source, url }) => ({
    id: `asset_${source.id}`,
    sourceId: source.id,
    title: source.name,
    path: url,
    folderPath: buildSourceFolderPath(source.connectorKind, source.name),
    tags: [],
    status: "ready",
    includeInProgramming: true,
    externalId: source.id,
    fallbackPriority: 100,
    isGlobalFallback: false,
    createdAt: now,
    updatedAt: now
  }));
  const storedBySource = new Map<string, number>();
  for (const asset of state.assets) {
    storedBySource.set(asset.sourceId, (storedBySource.get(asset.sourceId) ?? 0) + 1);
  }

  const syncRuns: AppState["sourceSyncRuns"] = directSources.map((source) => {
    const invalid = plan.invalidSourceIds.has(source.id);
    const preservedAssets = invalid ? (storedBySource.get(source.id) ?? 0) : 0;
    return buildSourceSyncRun({
      sourceId: source.id,
      startedAt,
      finishedAt: now,
      status: invalid ? "error" : "success",
      summary: invalid
        ? preservedAssets > 0
          ? "Direct media URL validation failed; the stored asset was kept."
          : "Direct media URL validation failed."
        : "Direct media URL normalized into a playable asset.",
      discoveredAssets: invalid ? 0 : 1,
      readyAssets: invalid ? 0 : 1,
      errorMessage: invalid ? "Direct media URLs must be http(s) links ending in a supported media file extension." : ""
    });
  });

  await upsertSources(
    directSources.map((source) => {
      const invalid = plan.invalidSourceIds.has(source.id);
      const preservedAssets = invalid ? (storedBySource.get(source.id) ?? 0) : 0;
      return {
        ...source,
        status: invalid ? (preservedAssets > 0 ? "Invalid URL (asset preserved)" : "Invalid URL") : "Ready",
        notes: invalid
          ? preservedAssets > 0
            ? "Direct media sources require an http(s) URL ending in a supported media file extension. The previously ingested asset stays available until the URL is fixed."
            : "Direct media sources currently require an http(s) URL ending in a supported media file extension."
          : "Direct media URL normalized into the playout asset catalog.",
        lastSyncedAt: now
      };
    })
  );
  await replaceSyncedSourceAssets({
    connector: "direct-media",
    sources: directSources,
    storedAssets: state.assets,
    incomingAssets: directAssets,
    failedSourceIds: plan.invalidSourceIds
  });
  await appendSourceSyncRuns(syncRuns);

  if (plan.invalidSourceIds.size > 0) {
    await upsertIncident({
      scope: "source",
      severity: "warning",
      title: "One or more direct media sources are invalid",
      message: "Direct media URLs must be http(s) links ending in a supported media file extension.",
      fingerprint: "source.direct-media.invalid"
    });
  } else {
    await resolveIncident("source.direct-media.invalid", "All direct media sources are valid.");
  }
}

type YtDlpPlaylistEntry = {
  id?: string;
  title?: string;
  duration?: number;
  timestamp?: number;
  url?: string;
  webpage_url?: string;
  original_url?: string;
};

type YtDlpPlaylistResponse = {
  title?: string;
  entries?: YtDlpPlaylistEntry[];
};

type YtDlpVideoResponse = {
  id?: string;
  title?: string;
  duration?: number;
  timestamp?: number;
  category?: string;
  categories?: string[];
  webpage_url?: string;
  original_url?: string;
  chapters?: Array<{ start_time?: number; end_time?: number; title?: string }>;
};

function buildRemoteAsset(args: {
  sourceId: string;
  assetIdSeed: string;
  title: string;
  path: string;
  folderPath?: string;
  externalId?: string;
  categoryName?: string;
  chaptersJson?: string;
  durationSeconds?: number;
  publishedAt?: string;
  now: string;
}): AssetRecord {
  return {
    id: `asset_${args.sourceId}_${args.assetIdSeed}`.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 120),
    sourceId: args.sourceId,
    title: args.title,
    path: args.path,
    folderPath: args.folderPath ?? "",
    tags: [],
    status: "ready",
    includeInProgramming: true,
    externalId: args.externalId,
    categoryName: args.categoryName,
    chaptersJson: args.chaptersJson,
    durationSeconds: args.durationSeconds,
    publishedAt: args.publishedAt,
    fallbackPriority: 100,
    isGlobalFallback: false,
    createdAt: args.now,
    updatedAt: args.now
  };
}

function buildSourceSyncRun(args: {
  sourceId: string;
  startedAt: string;
  finishedAt: string;
  status: AppState["sourceSyncRuns"][number]["status"];
  summary: string;
  discoveredAssets: number;
  readyAssets: number;
  errorMessage?: string;
}) {
  return {
    id: `sync_${Math.random().toString(36).slice(2, 10)}`,
    sourceId: args.sourceId,
    startedAt: args.startedAt,
    finishedAt: args.finishedAt,
    status: args.status,
    summary: args.summary,
    discoveredAssets: args.discoveredAssets,
    readyAssets: args.readyAssets,
    errorMessage: args.errorMessage ?? ""
  };
}

function fromUnixTimestamp(value?: number): string | undefined {
  return typeof value === "number" && Number.isFinite(value) ? new Date(value * 1000).toISOString() : undefined;
}

function getTwitchArchiveUrl(channelUrl: string): string {
  try {
    const url = new URL(channelUrl);
    url.pathname = `${url.pathname.replace(/\/+$/, "")}/videos`;
    url.searchParams.set("filter", "archives");
    url.searchParams.set("sort", "time");
    return url.toString();
  } catch {
    return channelUrl;
  }
}

function normalizeTwitchVideoId(value: string): string {
  return value.replace(/^v(?=\d+$)/i, "");
}

function buildSourceFolderPath(connectorKind: AppState["sources"][number]["connectorKind"], sourceName: string): string {
  const safeName = sourceName
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^\w/-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return [connectorKind, safeName || "source"].filter(Boolean).join("/");
}

async function loadFlatCollection(url: string): Promise<YtDlpPlaylistResponse> {
  const ytDlpBinary = process.env.YT_DLP_BIN || "yt-dlp";
  const output = await execFileText(ytDlpBinary, [
    "--flat-playlist",
    "--dump-single-json",
    "--playlist-end",
    process.env.SOURCE_SYNC_LIMIT || "200",
    url
  ]);
  return JSON.parse(output) as YtDlpPlaylistResponse;
}

/**
 * Open or close the per-source entry from what the run history now says.
 *
 * Replaces the unconditional `resolveIncident` both connector syncs used to call on any run that
 * did not throw. On 2026-08-27 that call closed the Twitch source's entry on every cycle while the
 * archive listing kept coming back empty, so the incident list stayed clean through hours of filler
 * — and it also erased entries a genuine failure had raised one cycle earlier.
 *
 * The fingerprint is the existing keyed `source` family, which incident-classes.ts already
 * classifies as a state: a source that is not delivering is a condition, and the next delivering
 * run is what ends it. Nothing new is registered, and a source cannot appear twice.
 */
async function reconcileSourceDroughtIncident(args: {
  state: AppState;
  source: AppState["sources"][number];
  /** Runs this cycle produced, not yet in `state`. */
  runsThisCycle: AppState["sourceSyncRuns"];
  /** `planSourceIncidentResolution`'s verdict for this source, inverted. */
  ingestFailedThisCycle: boolean;
  storedAssetCount: number;
}): Promise<void> {
  const { source } = args;
  const runs = [...args.runsThisCycle, ...args.state.sourceSyncRuns]
    .filter((run) => run.sourceId === source.id)
    .sort((left, right) => new Date(right.finishedAt || right.startedAt).getTime() - new Date(left.finishedAt || left.startedAt).getTime());

  const pools = args.state.pools.filter((pool) => pool.sourceIds.includes(source.id));
  const poolIds = new Set(pools.map((pool) => pool.id));
  const blocks = args.state.scheduleBlocks.filter((block) => block.poolId && poolIds.has(block.poolId));

  const decision = decideSourceDroughtIncident({
    runs,
    storedAssetCount: args.storedAssetCount,
    referencedByPool: pools.length > 0,
    ingestFailedThisCycle: args.ingestFailedThisCycle
  });

  if (decision.action === "resolve") {
    await resolveIncident(`source.${source.connectorKind}.${source.id}`, `${source.name} is delivering again.`);
    return;
  }

  if (decision.action === "leave") {
    return;
  }

  const health = describeSourceHealth({
    lastSyncedAt: source.lastSyncedAt ?? "",
    runs,
    storedAssetCount: args.storedAssetCount,
    poolNames: pools.map((pool) => pool.name),
    blockNames: [...new Set(blocks.map((block) => block.title))],
    nowMs: Date.now()
  });

  // This upsert overwrites whatever the per-source catch wrote a moment ago, so the newest run's
  // error travels with it. Without that, a source failing for the third cycle would trade its
  // "HTTP 503" for a sentence about how long it has been failing, and the diagnosis would be gone
  // from the one place an operator reads during an incident.
  const lastError = runs[0]?.errorMessage?.trim() ?? "";

  await upsertIncident({
    scope: "source",
    // Nothing stored and something scheduled from it is the channel on the filler slate; a drought
    // in front of an intact archive is a stale programme, which is a different night.
    severity: args.storedAssetCount > 0 ? "warning" : "critical",
    title: `${source.name} has stopped delivering`,
    message: [health.headline, health.impact, lastError].filter(Boolean).join(" "),
    fingerprint: `source.${source.connectorKind}.${source.id}`
  });
}

/**
 * Replace stored assets only for the sources this sync actually learned something about.
 *
 * The wholesale `replaceAssetsForSourceIds` is a delete-then-reinsert, so including a source whose
 * ingest failed deletes its entire archive — including whatever is on air right now. Sources that
 * are held back keep their existing rows and emit `source.sync.assets_preserved` so the skip is
 * visible instead of silent. See source-sync-scope.ts.
 */
async function replaceSyncedSourceAssets(args: {
  connector: string;
  sources: { id: string }[];
  storedAssets: AssetRecord[];
  incomingAssets: AssetRecord[];
  failedSourceIds: Set<string>;
}): Promise<void> {
  const plan = planSourceAssetReplacement({
    sources: args.sources,
    storedAssets: args.storedAssets,
    incomingAssets: args.incomingAssets,
    failedSourceIds: args.failedSourceIds
  });

  for (const preserved of plan.preserved) {
    logRuntimeEvent("source.sync.assets_preserved", {
      connector: args.connector,
      sourceId: preserved.sourceId,
      decision: preserved.decision,
      storedAssets: preserved.storedAssetCount
    });
  }

  if (plan.replaceableSourceIds.length === 0) {
    return;
  }

  // The sync computed both lists together, so an empty write here really is an emptied source.
  await replaceAssetsForSourceIds(plan.replaceableSourceIds, plan.assetsToWrite, { allowEmptyReplacement: true });
}

async function syncYoutubePlaylistSources(): Promise<void> {
  const state = await readAppState();
  const now = new Date().toISOString();
  const youtubeSources = state.sources.filter(
    (source) =>
      (source.connectorKind === "youtube-playlist" || source.connectorKind === "youtube-channel") && (source.enabled ?? true)
  );
  const youtubeAssets: AssetRecord[] = [];
  // Per-source throughout — asset replacement, status wording and incident resolution all read
  // this set. A source we learned nothing about must keep its stored assets instead of being wiped
  // by the wholesale replace below, and must not drag its healthy siblings' incidents open with
  // it. See source-sync-scope.ts. It is a necessary input to the incident decision and not a
  // sufficient one: a listing that comes back empty without failing never enters this set, which is
  // why the resolve below also reads the run history.
  const failedSourceIds = new Set<string>();
  const syncRuns: AppState["sourceSyncRuns"] = [];

  for (const source of youtubeSources) {
    const startedAt = new Date().toISOString();
    const externalUrl = source.externalUrl?.trim() ?? "";
    const isValid =
      source.connectorKind === "youtube-playlist"
        ? isLikelyYouTubePlaylistUrl(externalUrl)
        : isLikelyYouTubeChannelUrl(externalUrl);
    if (!isValid) {
      failedSourceIds.add(source.id);
      syncRuns.push(buildSourceSyncRun({
        sourceId: source.id,
        startedAt,
        finishedAt: now,
        status: "error",
        summary: "Source URL validation failed before yt-dlp ingestion.",
        discoveredAssets: 0,
        readyAssets: 0,
        errorMessage:
          source.connectorKind === "youtube-playlist"
            ? "YouTube playlist sources require a playlist URL with a list parameter."
            : "YouTube channel sources require a channel, handle, or user URL."
      }));
      continue;
    }

    try {
      const payload = await loadFlatCollection(externalUrl);
      const entries = payload.entries ?? [];
      let sourceAssetCount = 0;

      for (const entry of entries) {
        const id = entry.id ?? entry.url ?? entry.webpage_url ?? "";
        const videoUrl = entry.webpage_url || (entry.id ? `https://www.youtube.com/watch?v=${entry.id}` : entry.url ?? "");
        if (!id || !videoUrl) {
          continue;
        }

        youtubeAssets.push(
          buildRemoteAsset({
            sourceId: source.id,
            assetIdSeed: id,
            title: entry.title || `${source.name} item`,
            path: videoUrl,
            folderPath: buildSourceFolderPath(source.connectorKind, source.name),
            externalId: entry.id,
            durationSeconds: entry.duration,
            publishedAt: fromUnixTimestamp(entry.timestamp),
            now
          })
        );
        sourceAssetCount += 1;
      }

      syncRuns.push(buildSourceSyncRun({
        sourceId: source.id,
        startedAt,
        finishedAt: now,
        status: sourceAssetCount > 0 ? "success" : "skipped",
        summary:
          sourceAssetCount > 0
            ? `Imported ${sourceAssetCount} YouTube item(s) from ${source.connectorKind}.`
            : "YouTube ingestion completed but returned no playable items.",
        discoveredAssets: sourceAssetCount,
        readyAssets: sourceAssetCount,
        errorMessage: ""
      }));
    } catch (error) {
      failedSourceIds.add(source.id);
      const message = error instanceof Error ? error.message : "Unknown YouTube playlist ingestion error.";
      syncRuns.push(buildSourceSyncRun({
        sourceId: source.id,
        startedAt,
        finishedAt: now,
        status: "error",
        summary: "yt-dlp ingestion failed.",
        discoveredAssets: 0,
        readyAssets: 0,
        errorMessage: message
      }));
      await upsertIncident({
        scope: "source",
        severity: "warning",
        title: source.connectorKind === "youtube-channel" ? "YouTube channel ingestion failed" : "YouTube playlist ingestion failed",
        message: `${source.name}: ${message}`,
        fingerprint: `source.${source.connectorKind}.${source.id}`
      });
    }
  }

  await upsertSources(
    youtubeSources.map((source) => {
      // Describing the source from the same outcome the replacement decision uses is the point:
      // "Ingestion failed" alone read identically whether the archive survived or was deleted.
      const description = describeSourceSyncStatus({
        sourceId: source.id,
        ingestFailed: failedSourceIds.has(source.id),
        incomingAssetCount: youtubeAssets.filter((asset) => asset.sourceId === source.id).length,
        storedAssetCount: state.assets.filter((asset) => asset.sourceId === source.id).length
      });
      return {
        ...source,
        status: description.status,
        notes: description.assetsPreserved
          ? buildPreservedAssetsNote(description.effectiveAssetCount)
          : description.effectiveAssetCount > 0
            ? `Ingested ${description.effectiveAssetCount} YouTube item(s) via yt-dlp.`
            : "Could not ingest this YouTube source. Check the URL and worker incident log.",
        lastSyncedAt: now
      };
    })
  );
  await replaceSyncedSourceAssets({
    connector: "youtube",
    sources: youtubeSources,
    storedAssets: state.assets,
    incomingAssets: youtubeAssets,
    failedSourceIds
  });
  await appendSourceSyncRuns(syncRuns);

  // Every source gets a verdict, and the two halves compose: the per-source gate says whether THIS
  // cycle's ingest was clean, the run history says whether the source is actually delivering. A
  // gate-only resolve still closes the entry for a source that answered with nothing, which is the
  // 2026-08-27 failure; a history-only resolve still closes it for a partial library scan that
  // returned files while a directory was unreadable.
  const resolvable = new Set(planSourceIncidentResolution({ sources: youtubeSources, failedSourceIds }).resolve);
  for (const source of youtubeSources) {
    await reconcileSourceDroughtIncident({
      state,
      source,
      runsThisCycle: syncRuns,
      ingestFailedThisCycle: !resolvable.has(source.id),
      // The archive as it stands before this sync's replace — what the channel still has to play.
      storedAssetCount: state.assets.filter((asset) => asset.sourceId === source.id).length
    });
  }
}

async function syncTwitchVodSources(): Promise<void> {
  const ytDlpBinary = process.env.YT_DLP_BIN || "yt-dlp";
  const state = await readAppState();
  const now = new Date().toISOString();
  const twitchSources = state.sources.filter(
    (source) => (source.connectorKind === "twitch-vod" || source.connectorKind === "twitch-channel") && (source.enabled ?? true)
  );
  const twitchAssets: AssetRecord[] = [];
  // A source whose ingest threw contributed nothing; it must keep its stored assets rather than be
  // wiped by the wholesale replace below. See source-sync-scope.ts.
  const failedSourceIds = new Set<string>();
  const syncRuns: AppState["sourceSyncRuns"] = [];

  for (const source of twitchSources) {
    const startedAt = new Date().toISOString();
    const externalUrl = source.externalUrl?.trim() ?? "";
    const isValid =
      source.connectorKind === "twitch-vod" ? isLikelyTwitchVodUrl(externalUrl) : isLikelyTwitchChannelUrl(externalUrl);
    if (!isValid) {
      // A URL that fails validation is not evidence the archive is gone — the stored VODs stay.
      failedSourceIds.add(source.id);
      syncRuns.push(buildSourceSyncRun({
        sourceId: source.id,
        startedAt,
        finishedAt: now,
        status: "error",
        summary: "Source URL validation failed before Twitch ingestion.",
        discoveredAssets: 0,
        readyAssets: 0,
        errorMessage:
          source.connectorKind === "twitch-vod"
            ? "Twitch VOD sources require a twitch.tv/videos/<id> URL."
            : "Twitch channel sources require a twitch.tv/<channel> URL."
      }));
      await upsertIncident({
        scope: "source",
        severity: "warning",
        title: "Twitch source URL is invalid",
        message:
          source.connectorKind === "twitch-vod"
            ? `${source.name} requires a twitch.tv/videos/<id> URL.`
            : `${source.name} requires a twitch.tv/<channel> URL.`,
        fingerprint: `source.${source.connectorKind}.${source.id}`
      });
      continue;
    }

    try {
      if (source.connectorKind === "twitch-vod") {
        const output = await execFileText(ytDlpBinary, ["--dump-single-json", "--no-playlist", externalUrl]);
        const payload = JSON.parse(output) as YtDlpVideoResponse;
        const assetPath = payload.webpage_url || payload.original_url || externalUrl;
        const assetIdSeed = payload.id || externalUrl;

        twitchAssets.push(
          buildRemoteAsset({
            sourceId: source.id,
            assetIdSeed,
            title: payload.title || source.name,
            path: assetPath,
            folderPath: buildSourceFolderPath(source.connectorKind, source.name),
            externalId: payload.id,
            categoryName: payload.category || payload.categories?.[0] || "",
            // Twitch VOD chapters are named after the game on air at that point, so the chapter
            // title is also the category candidate. The db layer only stores this when the asset
            // has no chapters yet — operator edits survive every re-sync.
            chaptersJson: serializeAssetChapters(
              buildAssetChaptersFromSourceMetadata(payload.chapters, { chapterTitleNamesCategory: true })
            ),
            durationSeconds: payload.duration,
            publishedAt: fromUnixTimestamp(payload.timestamp),
            now
          })
        );
        syncRuns.push(buildSourceSyncRun({
          sourceId: source.id,
          startedAt,
          finishedAt: now,
          status: "success",
          summary: "Imported the Twitch VOD into the asset catalog.",
          discoveredAssets: 1,
          readyAssets: 1,
          errorMessage: ""
        }));
      } else {
        const payload = await loadFlatCollection(getTwitchArchiveUrl(externalUrl));
        let sourceAssetCount = 0;
        for (const entry of payload.entries ?? []) {
          const id = entry.id ?? "";
          if (!id) {
            continue;
          }
          const normalizedId = normalizeTwitchVideoId(id);

          twitchAssets.push(
            buildRemoteAsset({
              sourceId: source.id,
              assetIdSeed: id,
              title: entry.title || source.name,
              path: entry.webpage_url || `https://www.twitch.tv/videos/${normalizedId}`,
              folderPath: buildSourceFolderPath(source.connectorKind, source.name),
              externalId: normalizedId,
              durationSeconds: entry.duration,
              publishedAt: fromUnixTimestamp(entry.timestamp),
              now
            })
          );
          sourceAssetCount += 1;
        }
        syncRuns.push(buildSourceSyncRun({
          sourceId: source.id,
          startedAt,
          finishedAt: now,
          status: sourceAssetCount > 0 ? "success" : "skipped",
          summary:
            sourceAssetCount > 0
              ? `Imported ${sourceAssetCount} Twitch archive item(s).`
              : "Twitch archive ingestion completed but returned no playable items.",
          discoveredAssets: sourceAssetCount,
          readyAssets: sourceAssetCount,
          errorMessage: ""
        }));
      }

    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown Twitch VOD ingestion error.";
      failedSourceIds.add(source.id);
      syncRuns.push(buildSourceSyncRun({
        sourceId: source.id,
        startedAt,
        finishedAt: now,
        status: "error",
        summary: "Twitch ingestion failed.",
        discoveredAssets: 0,
        readyAssets: 0,
        errorMessage: message
      }));
      await upsertIncident({
        scope: "source",
        severity: "warning",
        title: source.connectorKind === "twitch-channel" ? "Twitch channel ingestion failed" : "Twitch VOD ingestion failed",
        message: `${source.name}: ${message}`,
        fingerprint: `source.${source.connectorKind}.${source.id}`
      });
    }
  }

  await upsertSources(
    twitchSources.map((source) => {
      // The source of the original wipe. The status now says whether the archive survived it.
      const description = describeSourceSyncStatus({
        sourceId: source.id,
        ingestFailed: failedSourceIds.has(source.id),
        incomingAssetCount: twitchAssets.filter((asset) => asset.sourceId === source.id).length,
        storedAssetCount: state.assets.filter((asset) => asset.sourceId === source.id).length
      });
      return {
        ...source,
        status: description.status,
        notes: description.assetsPreserved
          ? buildPreservedAssetsNote(description.effectiveAssetCount)
          : description.effectiveAssetCount > 0
            ? source.connectorKind === "twitch-channel"
              ? `Ingested ${description.effectiveAssetCount} Twitch archive item(s) via yt-dlp.`
              : "Ingested the Twitch VOD into a playable asset via yt-dlp."
            : source.connectorKind === "twitch-channel"
              ? "Could not ingest Twitch channel archives. Check the URL and worker incident log."
              : "Could not ingest this VOD. Check the URL and worker incident log.",
        lastSyncedAt: now
      };
    })
  );
  await replaceSyncedSourceAssets({
    connector: "twitch",
    sources: twitchSources,
    storedAssets: state.assets,
    incomingAssets: twitchAssets,
    failedSourceIds
  });
  await appendSourceSyncRuns(syncRuns);

  // After the loop, like the YouTube sync, so the invalid-URL branch — which `continue`s before the
  // try — is reconciled too. Inside the try it was unreachable for exactly the source whose URL an
  // operator is most likely to be fixing.
  const resolvable = new Set(planSourceIncidentResolution({ sources: twitchSources, failedSourceIds }).resolve);
  for (const source of twitchSources) {
    await reconcileSourceDroughtIncident({
      state,
      source,
      runsThisCycle: syncRuns,
      ingestFailedThisCycle: !resolvable.has(source.id),
      // The archive as it stands before this sync's replace — what the channel still has to play.
      storedAssetCount: state.assets.filter((asset) => asset.sourceId === source.id).length
    });
  }
}

/**
 * Fetch chapters for assets whose ingest could not deliver them.
 *
 * Collection connectors list their items with --flat-playlist, which never carries chapters, so
 * YouTube items, Twitch archive VODs and direct media arrive chapterless. This step spends a small
 * per-cycle probe budget on those assets (one metadata-only call each, no download) and stores the
 * result through the same only-fill-empty rule re-ingest uses — operator edits always win, and an
 * asset that has chapters is never probed again. A probe that came back empty is trusted for a
 * week and then asked once more, because "no chapters" is also what a rate limit and a broken
 * extractor return. Failures go into a short cooldown instead of an incident: a missing chapter
 * list degrades nothing on air, so the log entry is enough. The written chaptersJson feeds the
 * existing boundary emission and Helix sync untouched.
 */
async function backfillAssetChapters(): Promise<void> {
  const config = getChapterBackfillConfig(process.env);
  if (config.perCycleBudget <= 0) {
    return;
  }

  const state = await readAppState();
  const candidates = selectChapterBackfillCandidates({
    assets: state.assets,
    sources: state.sources,
    budget: config.perCycleBudget,
    failureCooldownMs: config.failureCooldownMs,
    emptyResultRecheckMs: config.emptyResultRecheckMs,
    nowMs: Date.now()
  });

  for (const candidate of candidates) {
    const result = await probeAssetChapters(candidate, config);
    const probedAt = new Date().toISOString();

    if (result.status === "ok") {
      await updateAssetChapterProbeRecords([
        { id: candidate.assetId, chaptersProbeStatus: "ok", chaptersProbedAt: probedAt, chaptersJson: result.chaptersJson }
      ]);
      continue;
    }

    await updateAssetChapterProbeRecords([{ id: candidate.assetId, chaptersProbeStatus: "failed", chaptersProbedAt: probedAt }]);
    logRuntimeEvent("asset.chapters.probe_failed", {
      assetId: candidate.assetId,
      probe: candidate.probe,
      error: result.error
    });
  }
}

function getCurrentScheduleItem(state: AppState): ReturnType<typeof buildScheduleOccurrences>[number] | null {
  const timeZone = resolveChannelTimeZone(state.managedConfig);
  const scheduleMoment = getCurrentScheduleMoment({
    now: new Date(),
    timeZone
  });

  const occurrences = buildScheduleOccurrences({
    date: scheduleMoment.date,
    blocks: state.scheduleBlocks
  });
  return findCurrentScheduleOccurrence({
    occurrences,
    currentTime: scheduleMoment.time
  });
}

function getNextScheduleItem(state: AppState): ReturnType<typeof buildScheduleOccurrences>[number] | null {
  const timeZone = resolveChannelTimeZone(state.managedConfig);
  const scheduleMoment = getCurrentScheduleMoment({
    now: new Date(),
    timeZone
  });

  const occurrences = buildScheduleOccurrences({
    date: scheduleMoment.date,
    blocks: state.scheduleBlocks
  });
  const current = findCurrentScheduleOccurrence({
    occurrences,
    currentTime: scheduleMoment.time
  });
  return findNextScheduleOccurrence({
    occurrences,
    currentTime: scheduleMoment.time,
    currentOccurrence: current
  });
}

function getPoolEligibleAssets(state: AppState, poolId: string, skippedAssetId = ""): AssetRecord[] {
  const pool = state.pools.find((entry) => entry.id === poolId);
  if (!pool) {
    return [];
  }
  const excludedAssetIds = new Set<string>();
  if (pool.insertAssetId && pool.insertEveryItems > 0) {
    excludedAssetIds.add(pool.insertAssetId);
  }
  if (pool.audioLaneAssetId) {
    excludedAssetIds.add(pool.audioLaneAssetId);
  }

  return state.assets
    .filter((asset) => {
      if (
        asset.status !== "ready" ||
        asset.id === skippedAssetId ||
        asset.includeInProgramming === false ||
        isAssetBlockedForAutomaticSelection(asset) ||
        excludedAssetIds.has(asset.id)
      ) {
        return false;
      }

      return pool.sourceIds.includes(asset.sourceId);
    })
    .sort((left, right) => {
      const publishedDelta =
        new Date(left.publishedAt || left.createdAt).getTime() - new Date(right.publishedAt || right.createdAt).getTime();
      if (publishedDelta !== 0) {
        return publishedDelta;
      }

      return left.title.localeCompare(right.title);
    });
}

function lookaheadVideoTitleFromPool(state: AppState, poolId: string): string {
  const pool = state.pools.find((entry) => entry.id === poolId);
  return lookaheadPoolVideoTitle({
    pool: pool ?? null,
    assets: state.assets
  });
}

function resolveScheduleOccurrenceOverlayTitle(state: AppState, item: WorkerScheduleOccurrence | null): string {
  if (!item) {
    return "";
  }

  return item.poolId ? lookaheadVideoTitleFromPool(state, item.poolId) || item.title : item.title;
}

function selectPoolAsset(state: AppState, poolId: string, skippedAssetId: string): AssetRecord | null {
  const pool = state.pools.find((entry) => entry.id === poolId);
  if (!pool) {
    return null;
  }
  const eligibleAssets = getPoolEligibleAssets(state, poolId, skippedAssetId);

  if (eligibleAssets.length === 0) {
    return null;
  }

  if (!pool.cursorAssetId) {
    return eligibleAssets[0] ?? null;
  }

  const currentIndex = eligibleAssets.findIndex((asset) => asset.id === pool.cursorAssetId);
  if (currentIndex === -1) {
    return eligibleAssets[0] ?? null;
  }

  return eligibleAssets[(currentIndex + 1) % eligibleAssets.length] ?? eligibleAssets[0] ?? null;
}

function getPoolPlaybackQueue(state: AppState, poolId: string, skippedAssetId: string, currentAssetId = "", limit = 4): AssetRecord[] {
  const pool = state.pools.find((entry) => entry.id === poolId);
  if (!pool) {
    return [];
  }
  const eligibleAssets = getPoolEligibleAssets(state, poolId, skippedAssetId);

  if (eligibleAssets.length === 0) {
    return [];
  }

  const primaryReferenceId = currentAssetId || pool.cursorAssetId;
  let startIndex = primaryReferenceId ? eligibleAssets.findIndex((asset) => asset.id === primaryReferenceId) : -1;
  if (startIndex === -1 && currentAssetId && pool.cursorAssetId) {
    startIndex = eligibleAssets.findIndex((asset) => asset.id === pool.cursorAssetId);
  }
  const queue: AssetRecord[] = [];

  for (let offset = 1; offset <= Math.min(limit, eligibleAssets.length); offset += 1) {
    const index = startIndex === -1 ? offset - 1 : (startIndex + offset) % eligibleAssets.length;
    const candidate = eligibleAssets[index];
    if (!candidate || candidate.id === currentAssetId || queue.some((asset) => asset.id === candidate.id)) {
      continue;
    }
    queue.push(candidate);
  }

  return queue;
}

function getFreshProbeCache(assetId: string): QueueProbeCacheEntry | null {
  const entry = queueProbeCache.get(assetId);
  if (!entry) {
    return null;
  }

  const ttl = entry.status === "ready" ? NEXT_ASSET_PROBE_READY_TTL_MS : NEXT_ASSET_PROBE_FAILED_TTL_MS;
  if (Date.now() - entry.checkedAt > ttl) {
    queueProbeCache.delete(assetId);
    return null;
  }

  return entry;
}

// True when resolving this asset requires a remote operation that can block for its full
// timeout: Twitch VOD cache prep (ensureTwitchVodCache), or a resolvable remote video URL
// (yt-dlp --get-url). Mirrors the branching in resolvePlayableInput so local files and direct
// media URLs — which resolve effectively instantly — are not treated as expensive.
function isExpensiveQueueResolve(asset: AssetRecord): boolean {
  if (isTwitchVodAsset(asset)) {
    return true;
  }
  const path = asset.path;
  if (!path.startsWith("http://") && !path.startsWith("https://")) {
    return false;
  }
  if (isDirectMediaUrl(path)) {
    return false;
  }
  return isResolvableRemoteVideoUrl(path);
}

// Assets whose expensive prefetch resolve is still running in the background after the cycle
// abandoned the await (covering playout process died mid-resolve). Used to avoid double-resolving
// the same asset on the next cycle; the background completion writes the probe cache itself.
const queueResolvesInFlight = new Set<string>();

function isPlayoutProcessRunning(): boolean {
  return playoutProcess !== null && playoutProcess.exitCode === null && !playoutProcess.killed;
}

// Resolves when the current playout process exits; null when no process is running. Disposal
// detaches the listener so abandoned watchers do not pile up on long-lived processes.
function watchPlayoutProcessExit(): { promise: Promise<void>; dispose: () => void } | null {
  const child = playoutProcess;
  if (!child || child.exitCode !== null || child.killed) {
    return null;
  }
  let onExit: () => void = () => {};
  const promise = new Promise<void>((resolve) => {
    onExit = () => resolve();
    child.once("exit", onExit);
  });
  return {
    promise,
    dispose: () => {
      child.off("exit", onExit);
    }
  };
}

// Resolve one queue asset and write the probe cache on completion — kept as a self-contained
// promise chain so a cycle that abandons the await (process death) still gets the cache written
// when the resolve eventually finishes in the background.
function resolveQueueAssetIntoProbeCache(asset: AssetRecord): Promise<{ asset: AssetRecord; input: string }> {
  queueResolvesInFlight.add(asset.id);
  return resolveAssetPlaybackInput(asset)
    .then((prepared) => {
      queueProbeCache.set(asset.id, {
        status: "ready",
        checkedAt: Date.now(),
        resolvedInput: prepared.input,
        error: "",
        assetId: asset.id
      });
      return prepared;
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "Unknown queue prefetch error.";
      queueProbeCache.set(asset.id, {
        status: "failed",
        checkedAt: Date.now(),
        resolvedInput: "",
        error: message,
        assetId: asset.id
      });
      throw error;
    })
    .finally(() => {
      queueResolvesInFlight.delete(asset.id);
    });
}

async function getPlayableQueuedAssets(
  queueAssets: AssetRecord[],
  options: { expensiveBudget?: number } = {}
): Promise<{
  playableQueue: AssetRecord[];
  prefetchedAsset: AssetRecord | null;
  prefetchStatus: "" | "ready" | "failed";
  prefetchError: string;
  deferredExpensive: boolean;
}> {
  const playableQueue: AssetRecord[] = [];
  let prefetchedAsset: AssetRecord | null = null;
  let prefetchStatus: "" | "ready" | "failed" = "";
  let prefetchError = "";
  let deferredExpensive = false;

  // Cap awaited expensive (remote) resolves per cycle (v1.5.13), with the budget forced to 0 by
  // the caller while broadcast coverage is down (no running playout process): an awaited ~60-120s
  // resolve in that state sits between the boundary and startOrSwitchPlayout while the ~60s feed
  // buffer drains — the v1.5.16 soak failure. Cached/local/direct candidates are unaffected.
  const expensiveBudget = options.expensiveBudget ?? MAX_EXPENSIVE_QUEUE_RESOLVES_PER_CYCLE;
  const cachedEntries = queueAssets.map((asset) => getFreshProbeCache(asset.id));
  const expensiveFlags = queueAssets.map((asset) => isExpensiveQueueResolve(asset));
  const actions = planQueuePrefetch(
    queueAssets.map((asset, index) => ({
      cacheStatus: cachedEntries[index]?.status ?? "none",
      expensive: expensiveFlags[index]!
    })),
    expensiveBudget
  );

  for (let index = 0; index < queueAssets.length; index += 1) {
    const asset = queueAssets[index]!;
    const cached = cachedEntries[index];
    const action = actions[index];

    if (action === "use-cache") {
      prefetchedAsset = prefetchedAsset ?? asset;
      prefetchStatus = "ready";
      playableQueue.push(asset);
      continue;
    }

    if (action === "skip-failed") {
      if (!prefetchError && cached) {
        prefetchStatus = "failed";
        prefetchError = cached.error;
      }
      continue;
    }

    if (action === "defer") {
      // Expensive remote resolve beyond this cycle's budget. Leave the cache state untouched so
      // the asset is retried on a future cycle; do not block this cycle on it.
      deferredExpensive = true;
      continue;
    }

    if (expensiveFlags[index] && queueResolvesInFlight.has(asset.id)) {
      // A previous cycle's abandoned resolve for this asset is still running in the background
      // and will write the probe cache itself — do not start a duplicate.
      deferredExpensive = true;
      continue;
    }

    if (expensiveFlags[index] && !isPlayoutProcessRunning()) {
      // Coverage dropped after the plan was made (the process died earlier in this cycle).
      // Starting a new ~60-120s resolve now would block the restart path — defer instead.
      deferredExpensive = true;
      continue;
    }

    try {
      if (!expensiveFlags[index]) {
        // Cheap (local/direct) resolves return effectively instantly — await normally.
        const prepared = await resolveQueueAssetIntoProbeCache(asset);
        prefetchedAsset = prefetchedAsset ?? prepared.asset;
        prefetchStatus = "ready";
        playableQueue.push(prepared.asset);
        continue;
      }

      // Expensive resolve: stop waiting the moment the covering playout process dies, so a
      // boundary landing mid-resolve no longer holds the cycle (and the next start) hostage for
      // the remainder of the resolve — the exact 94s no-playout gap of the v1.5.16 soak failure.
      // The resolve keeps running in the background and writes the probe cache on completion.
      const death = watchPlayoutProcessExit();
      const outcome = await raceResolveAgainstDeath(resolveQueueAssetIntoProbeCache(asset), death?.promise ?? null);
      death?.dispose();
      if (outcome.kind === "abandoned") {
        logRuntimeEvent("playout.prefetch.abandoned", {
          assetId: asset.id,
          reason: "playout-process-exited"
        });
        deferredExpensive = true;
        break;
      }
      if (outcome.kind === "resolved") {
        prefetchedAsset = prefetchedAsset ?? outcome.value.asset;
        prefetchStatus = "ready";
        playableQueue.push(outcome.value.asset);
        continue;
      }
      throw outcome.error;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown queue prefetch error.";
      if (!prefetchError) {
        prefetchStatus = "failed";
        prefetchError = message;
      }
    }
  }

  return {
    playableQueue,
    prefetchedAsset,
    prefetchStatus,
    prefetchError,
    deferredExpensive
  };
}

function buildAssetQueueSubtitle(
  state: AppState,
  asset: AssetRecord,
  scheduleItem: ReturnType<typeof getCurrentScheduleItem> | null,
  emphasizeSchedule = false
): string {
  const sourceName = state.sources.find((source) => source.id === asset.sourceId)?.name || "";
  const parts: string[] = [];

  if (emphasizeSchedule && scheduleItem?.title && scheduleItem.title !== asset.title) {
    parts.push(scheduleItem.title);
  }
  if (sourceName) {
    parts.push(sourceName);
  }
  if (asset.categoryName || scheduleItem?.categoryName) {
    parts.push(asset.categoryName || scheduleItem?.categoryName || "");
  }

  return parts.filter(Boolean).join(" · ");
}

function buildRuntimeQueueItems(args: {
  state: AppState;
  selection: SelectionResult;
  currentScheduleItem: ReturnType<typeof getCurrentScheduleItem> | null;
  playableQueue: AssetRecord[];
}): AppState["playout"]["queueItems"] {
  const items: AppState["playout"]["queueItems"] = [];
  const queueHead = buildQueueHeadForSelection({
    state: args.state,
    selection: args.selection,
    currentScheduleItem: args.currentScheduleItem
  });
  const pushItem = (item: Omit<AppState["playout"]["queueItems"][number], "id" | "position">) => {
    const position = items.length;
    items.push({
      id: `${item.kind}-${item.assetId || "scene"}-${position}`,
      position,
      ...item
    });
  };

  if (args.selection.lifecycleStatus === "reconnecting") {
    pushItem({
      kind: "reconnect",
      assetId: "",
      title: queueHead.title,
      subtitle: queueHead.subtitle,
      scenePreset: queueHead.scenePreset
    });
  } else if (
    (args.selection.reasonCode === "operator_insert" || args.selection.reasonCode === "scheduled_insert") &&
    args.selection.asset
  ) {
    pushItem({
      kind: "insert",
      assetId: args.selection.asset.id,
      title: queueHead.title,
      subtitle: queueHead.subtitle,
      scenePreset: queueHead.scenePreset
    });
  } else if (args.selection.queueKind === "live") {
    pushItem({
      kind: "live",
      assetId: "",
      title: queueHead.title,
      subtitle: queueHead.subtitle,
      scenePreset: queueHead.scenePreset
    });
  } else if (args.selection.lifecycleStatus === "standby" || !args.selection.asset) {
    pushItem({
      kind: "standby",
      assetId: "",
      title: queueHead.title,
      subtitle: queueHead.subtitle,
      scenePreset: queueHead.scenePreset
    });
  } else {
    pushItem({
      kind: "asset",
      assetId: args.selection.asset.id,
      title: queueHead.title,
      subtitle: queueHead.subtitle,
      scenePreset: queueHead.scenePreset
    });
  }

  for (const asset of args.playableQueue.slice(0, 6)) {
    pushItem({
      kind: "asset",
      assetId: asset.id,
      title: buildAssetDisplayTitle(asset),
      subtitle: buildAssetQueueSubtitle(args.state, asset, null),
      scenePreset: resolveOverlayScenePresetForQueueKind(args.state.overlay.scenePreset, "asset", {
        insertScenePreset: args.state.overlay.insertScenePreset,
        standbyScenePreset: args.state.overlay.standbyScenePreset,
        reconnectScenePreset: args.state.overlay.reconnectScenePreset
      })
    });
  }

  return items;
}

type SelectionResult = {
  asset: AssetRecord | null;
  queueKind: AppState["playout"]["queueItems"][number]["kind"];
  insertTrigger: "" | "manual" | "pool-interval" | "cuepoint";
  cuepointKey: string;
  cuepointOffsetSeconds: number;
  liveBridgeInputUrl: string;
  liveBridgeInputType: LiveBridgeInputType | "";
  liveBridgeLabel: string;
  reason: string;
  lifecycleStatus: AppState["playout"]["status"];
  reasonCode: AppState["playout"]["selectionReasonCode"];
  fallbackTier: AppState["playout"]["fallbackTier"];
};

function buildQueueHeadForSelection(args: {
  state: AppState;
  selection: SelectionResult;
  currentScheduleItem: ReturnType<typeof getCurrentScheduleItem> | null;
}) {
  if (args.selection.reasonCode === "manual_next" && args.selection.asset) {
    return {
      title: buildAssetDisplayTitle(args.selection.asset),
      subtitle: `Queued next by operator · ${
        buildAssetQueueSubtitle(args.state, args.selection.asset, args.currentScheduleItem) || "Operator queue request"
      }`,
      scenePreset: resolveOverlayScenePresetForQueueKind(args.state.overlay.scenePreset, "asset", {
        insertScenePreset: args.state.overlay.insertScenePreset,
        standbyScenePreset: args.state.overlay.standbyScenePreset,
        reconnectScenePreset: args.state.overlay.reconnectScenePreset
      })
    };
  }

  if ((args.selection.reasonCode === "operator_insert" || args.selection.reasonCode === "scheduled_insert") && args.selection.asset) {
    return {
      title: buildAssetDisplayTitle(args.selection.asset),
      subtitle: `${
        args.selection.reasonCode === "operator_insert"
          ? "Insert"
          : args.selection.insertTrigger === "cuepoint"
            ? "Cuepoint insert"
            : "Automatic insert"
      } · ${
        buildAssetQueueSubtitle(args.state, args.selection.asset, args.currentScheduleItem) || "Insert requested"
      }`,
      scenePreset: resolveOverlayScenePresetForQueueKind(args.state.overlay.scenePreset, "insert", {
        insertScenePreset: args.state.overlay.insertScenePreset,
        standbyScenePreset: args.state.overlay.standbyScenePreset,
        reconnectScenePreset: args.state.overlay.reconnectScenePreset
      })
    };
  }

  if (args.selection.lifecycleStatus === "reconnecting") {
    return {
      title: "Scheduled reconnect",
      subtitle: args.selection.reason,
      scenePreset: resolveOverlayScenePresetForQueueKind(args.state.overlay.scenePreset, "reconnect", {
        insertScenePreset: args.state.overlay.insertScenePreset,
        standbyScenePreset: args.state.overlay.standbyScenePreset,
        reconnectScenePreset: args.state.overlay.reconnectScenePreset
      })
    };
  }

  if (args.selection.queueKind === "live") {
    return {
      title: args.selection.liveBridgeLabel || "Live Bridge",
      subtitle: `${args.selection.reason} · ${summarizeLiveBridgeInput(args.selection.liveBridgeInputUrl)}`,
      scenePreset: resolveOverlayScenePresetForQueueKind(args.state.overlay.scenePreset, "live", {
        insertScenePreset: args.state.overlay.insertScenePreset,
        standbyScenePreset: args.state.overlay.standbyScenePreset,
        reconnectScenePreset: args.state.overlay.reconnectScenePreset
      })
    };
  }

  if (args.selection.lifecycleStatus === "standby" || !args.selection.asset) {
    return {
      title: args.state.overlay.standbyHeadline || args.state.overlay.headline || "Replay standby",
      subtitle: args.selection.reason,
      scenePreset: resolveOverlayScenePresetForQueueKind(args.state.overlay.scenePreset, "standby", {
        insertScenePreset: args.state.overlay.insertScenePreset,
        standbyScenePreset: args.state.overlay.standbyScenePreset,
        reconnectScenePreset: args.state.overlay.reconnectScenePreset
      })
    };
  }

  return {
    title: buildAssetDisplayTitle(args.selection.asset),
    subtitle:
      args.selection.reasonCode === "graceful_handoff"
        ? `Finishing current item · ${buildAssetQueueSubtitle(args.state, args.selection.asset, null) || "Schedule handoff pending"}`
        : buildAssetQueueSubtitle(args.state, args.selection.asset, args.currentScheduleItem, true),
    scenePreset: resolveOverlayScenePresetForQueueKind(args.state.overlay.scenePreset, "asset", {
      insertScenePreset: args.state.overlay.insertScenePreset,
      standbyScenePreset: args.state.overlay.standbyScenePreset,
      reconnectScenePreset: args.state.overlay.reconnectScenePreset
    })
  };
}

function choosePlaybackCandidate(state: AppState): SelectionResult {
  const createSelection = (
    overrides: Omit<
      SelectionResult,
      "queueKind" | "insertTrigger" | "cuepointKey" | "cuepointOffsetSeconds" | "liveBridgeInputUrl" | "liveBridgeInputType" | "liveBridgeLabel"
    > &
      Partial<
        Pick<
          SelectionResult,
          "queueKind" | "insertTrigger" | "cuepointKey" | "cuepointOffsetSeconds" | "liveBridgeInputUrl" | "liveBridgeInputType" | "liveBridgeLabel"
        >
      >
  ): SelectionResult => ({
    queueKind: "asset",
    insertTrigger: "",
    cuepointKey: "",
    cuepointOffsetSeconds: 0,
    liveBridgeInputUrl: "",
    liveBridgeInputType: "",
    liveBridgeLabel: "",
    ...overrides
  });
  const manualOverrideActive = isTimestampActive(state.playout.overrideUntil);
  const skippedAssetId = isTimestampActive(state.playout.skipUntil) ? state.playout.skipAssetId : "";
  const liveBridgeActive =
    state.playout.liveBridgeInputUrl !== "" &&
    (state.playout.liveBridgeStatus === "pending" || state.playout.liveBridgeStatus === "active");

  if (liveBridgeActive) {
    return createSelection({
      asset: null,
      queueKind: "live",
      liveBridgeInputUrl: state.playout.liveBridgeInputUrl,
      liveBridgeInputType: normalizeLiveBridgeInputType(state.playout.liveBridgeInputType || "rtmp"),
      liveBridgeLabel: state.playout.liveBridgeLabel || "Live Bridge",
      reason:
        state.playout.liveBridgeStatus === "pending"
          ? "Live Bridge takeover is preparing the live input."
          : "Live Bridge is on air. Scheduled playback will resume when the bridge is released.",
      lifecycleStatus: state.playout.liveBridgeStatus === "pending" ? ("recovering" as const) : ("running" as const),
      reasonCode: "live_bridge" as const,
      fallbackTier: "operator" as const
    });
  }

  const activeInsertAsset =
    state.playout.insertAssetId !== ""
      ? state.assets.find(
          (asset) => asset.id === state.playout.insertAssetId && asset.status === "ready" && asset.id !== skippedAssetId
        ) ?? null
      : null;
  const manualNextAsset =
    state.playout.manualNextAssetId !== ""
      ? state.assets.find(
          (asset) =>
            asset.id === state.playout.manualNextAssetId &&
            asset.status === "ready" &&
            asset.includeInProgramming !== false &&
            asset.id !== skippedAssetId
        ) ?? null
      : null;
  const desiredAsset =
    manualOverrideActive && state.playout.overrideAssetId !== ""
      ? state.assets.find((asset) => asset.id === state.playout.overrideAssetId && asset.status === "ready")
      : state.playout.restartRequestedAt !== "" && state.playout.desiredAssetId !== ""
        ? state.assets.find((asset) => asset.id === state.playout.desiredAssetId && asset.status === "ready")
        : null;

  if (desiredAsset) {
    return createSelection({
      asset: desiredAsset,
      reason:
        state.playout.overrideMode === "fallback"
          ? `Temporary fallback override selected asset ${desiredAsset.title}.`
          : `Operator override selected asset ${desiredAsset.title}.`,
      lifecycleStatus: "recovering" as const,
      reasonCode: "operator_override" as const,
      fallbackTier: "operator" as const
    });
  }

  if (activeInsertAsset && state.playout.insertStatus !== "") {
    return createSelection({
      asset: activeInsertAsset,
      queueKind: "insert",
      insertTrigger: state.playout.selectionReasonCode === "operator_insert" ? "manual" : "",
      reason:
        state.playout.insertStatus === "pending"
          ? `Insert ${activeInsertAsset.title} is queued as the next on-air item.`
          : `Insert ${activeInsertAsset.title} is currently on air.`,
      lifecycleStatus: state.playout.insertStatus === "pending" ? ("recovering" as const) : ("running" as const),
      reasonCode: "operator_insert" as const,
      fallbackTier: "operator" as const
    });
  }

  if (
    manualNextAsset &&
    (state.playout.currentAssetId === "" || state.playout.restartRequestedAt !== "" || state.playout.status === "standby")
  ) {
    return createSelection({
      asset: manualNextAsset,
      reason: `Operator queued ${manualNextAsset.title} as the next on-air item.`,
      lifecycleStatus: "recovering" as const,
      reasonCode: "manual_next" as const,
      fallbackTier: "operator" as const
    });
  }

  const currentScheduleItem = getCurrentScheduleItem(state);
  const currentPool = currentScheduleItem?.poolId ? state.pools.find((pool) => pool.id === currentScheduleItem.poolId) ?? null : null;
  const processRunning = Boolean(playoutProcess && !playoutProcess.killed);
  const runningScheduledAsset =
    processRunning &&
    state.playout.currentAssetId !== "" &&
    (state.playout.selectionReasonCode === "scheduled_match" || state.playout.selectionReasonCode === "graceful_handoff")
      ? state.assets.find(
          (asset) => asset.id === state.playout.currentAssetId && asset.status === "ready" && asset.id !== skippedAssetId
        ) ?? null
      : null;
  const autoInsertAsset =
    currentPool &&
    state.playout.currentAssetId === "" &&
    currentPool.insertAssetId &&
    currentPool.insertEveryItems > 0 &&
    currentPool.itemsSinceInsert >= currentPool.insertEveryItems
      ? state.assets.find(
          (asset) =>
            asset.id === currentPool.insertAssetId &&
            asset.status === "ready" &&
            asset.includeInProgramming !== false &&
            asset.id !== skippedAssetId
        ) ?? null
      : null;
  const cuepointInsertPlan = getCuepointInsertPlan({
    state,
    currentScheduleItem,
    skippedAssetId
  });

  if (cuepointInsertPlan && state.playout.currentAssetId === "") {
    return createSelection({
      asset: cuepointInsertPlan.asset,
      queueKind: "insert",
      insertTrigger: "cuepoint",
      cuepointKey: cuepointInsertPlan.cuepointKey,
      cuepointOffsetSeconds: cuepointInsertPlan.offsetSeconds,
      reason: `Cuepoint ${formatCuepointOffsetLabel(cuepointInsertPlan.offsetSeconds)} in ${cuepointInsertPlan.blockTitle} queued ${cuepointInsertPlan.asset.title}.`,
      lifecycleStatus: "recovering" as const,
      reasonCode: "scheduled_insert" as const,
      fallbackTier: "scheduled" as const
    });
  }

  if (autoInsertAsset) {
    return createSelection({
      asset: autoInsertAsset,
      queueKind: "insert",
      insertTrigger: "pool-interval",
      reason: `Pool ${currentPool?.name || "schedule"} queued automatic insert ${autoInsertAsset.title}.`,
      lifecycleStatus: "recovering" as const,
      reasonCode: "scheduled_insert" as const,
      fallbackTier: "scheduled" as const
    });
  }

  const currentPoolAsset =
    processRunning && currentScheduleItem?.poolId && state.playout.currentAssetId
      ? state.assets.find(
          (asset) =>
            asset.id === state.playout.currentAssetId &&
            asset.status === "ready" &&
            asset.id !== skippedAssetId &&
            currentPool?.sourceIds.includes(asset.sourceId)
        ) ?? null
      : null;

  if (runningScheduledAsset && (!currentPool || !currentPool.sourceIds.includes(runningScheduledAsset.sourceId))) {
    return createSelection({
      asset: runningScheduledAsset,
      reason: `Current on-air asset ${runningScheduledAsset.title} will finish before the next scheduled block takes over.`,
      lifecycleStatus: "running" as const,
      reasonCode: "graceful_handoff" as const,
      fallbackTier: "scheduled" as const
    });
  }

  const preferredAsset = currentScheduleItem?.poolId
      ? currentPoolAsset ?? selectPoolAsset(state, currentScheduleItem.poolId, skippedAssetId)
    : state.assets.find((entry) => {
        if (entry.status !== "ready") {
          return false;
        }
        if (entry.id === skippedAssetId) {
          return false;
        }
        if (entry.includeInProgramming === false) {
          return false;
        }
        if (isAssetBlockedForAutomaticSelection(entry)) {
          return false;
        }
        const matchingSource = state.sources.find((source) => source.id === entry.sourceId);
        return matchingSource?.name === currentScheduleItem?.sourceName;
      });

  if (preferredAsset) {
    return createSelection({
      asset: preferredAsset,
      reason: currentScheduleItem
        ? `Scheduled block ${currentScheduleItem.title} is mapped to asset ${preferredAsset.title}.`
        : `Selected asset ${preferredAsset.title}.`,
      lifecycleStatus: "running" as const,
      reasonCode: "scheduled_match" as const,
      fallbackTier: "scheduled" as const
    });
  }

  const globalFallback = [...state.assets]
    .filter(
      (asset) =>
        asset.status === "ready" &&
        asset.isGlobalFallback &&
        asset.includeInProgramming !== false &&
        !isAssetBlockedForAutomaticSelection(asset)
    )
    .filter((asset) => asset.id !== skippedAssetId)
    .sort((left, right) => left.fallbackPriority - right.fallbackPriority)[0];

  if (globalFallback) {
    return createSelection({
      asset: globalFallback,
      reason: `Global fallback asset ${globalFallback.title} is selected.`,
      lifecycleStatus: "recovering" as const,
      reasonCode: "global_fallback" as const,
      fallbackTier: "global-fallback" as const
    });
  }

  const anyReadyAsset = [...state.assets]
    .filter((asset) => asset.status === "ready" && asset.includeInProgramming !== false && !isAssetBlockedForAutomaticSelection(asset))
    .filter((asset) => asset.id !== skippedAssetId)
    .sort((left, right) => left.fallbackPriority - right.fallbackPriority)[0];

  if (anyReadyAsset) {
    return createSelection({
      asset: anyReadyAsset,
      reason: `Fallback asset ${anyReadyAsset.title} is selected.`,
      lifecycleStatus: "recovering" as const,
      reasonCode: "generic_fallback" as const,
      fallbackTier: "generic-fallback" as const
    });
  }

  return createSelection({
    asset: null,
    queueKind: "standby",
    reason: "The playout engine could not find a ready asset to put on air.",
    lifecycleStatus: "failed" as const,
    reasonCode: "no_asset" as const,
    fallbackTier: "none" as const
  });
}

async function stopPlayoutProcess(reason = ""): Promise<void> {
  plannedStopReason = reason;
  const currentProcess = playoutProcess;
  stopSceneRendererLoop();

  if (!currentProcess || currentProcess.killed) {
    playoutProcess = null;
    playoutAssetId = "";
    playoutDestinationId = "";
    playoutDestinationIds = [];
    playoutRuntimeTargets = [];
    playoutTargetKind = "";
    playoutResolvedInput = "";
    playoutLastStderrSample = "";
    playoutLiveBridgeInputUrl = "";
    playoutLiveBridgeInputType = "";
    // No exit handler will run for this path, so nothing would ever clear the reason we just set.
    // Leaving it set makes the next genuine crash look like an operator-planned stop.
    plannedStopReason = "";
    return;
  }

  await new Promise<void>((resolve) => {
    let settled = false;
    const finalize = () => {
      // Reachable from both the exit handler and the stop deadline; the second call must not
      // clear state that a newly started process already owns.
      if (settled) {
        return;
      }
      settled = true;

      if (playoutProcess === currentProcess) {
        playoutProcess = null;
        playoutAssetId = "";
        playoutDestinationId = "";
        playoutDestinationIds = [];
        playoutRuntimeTargets = [];
        playoutTargetKind = "";
        playoutResolvedInput = "";
        playoutLastStderrSample = "";
        playoutLiveBridgeInputUrl = "";
        playoutLiveBridgeInputType = "";
      }
      resolve();
    };

    currentProcess.once("exit", finalize);
    try {
      currentProcess.kill("SIGTERM");
    } catch {
      // Process may have raced to exit between the exitCode check and the signal.
    }

    // `killed` is set the moment SIGTERM is *delivered*, not when the child actually exits, so the
    // previous `&& !currentProcess.killed` guard made this escalation unreachable: an ffmpeg stuck
    // in a blocking read on a dead remote input or a blocking write to a stalled RTMP socket never
    // got SIGKILL, and the await below never resolved.
    const escalation = setTimeout(() => {
      if (currentProcess.exitCode === null) {
        try {
          currentProcess.kill("SIGKILL");
        } catch {
          // Already exited between the check and the signal.
        }
      }
    }, 5_000);

    // A child that ignores even SIGKILL (uninterruptible I/O) must not wedge the reconciliation
    // cycle until the stall guard restarts the whole container.
    const deadline = setTimeout(() => {
      logRuntimeEvent("playout.stop.deadline_exceeded", {
        reason,
        pid: currentProcess.pid ?? 0
      });
      finalize();
    }, PLAYOUT_STOP_DEADLINE_MS);

    currentProcess.once("exit", () => {
      clearTimeout(escalation);
      clearTimeout(deadline);
    });
  });
}

async function stopUplinkProcess(entry: UplinkProcessRuntime, reason = ""): Promise<void> {
  entry.plannedStopReason = reason;

  if (!entry.process || entry.process.exitCode !== null) {
    uplinkProcesses = uplinkProcesses.filter((candidate) => candidate !== entry);
    entry.plannedStopReason = "";
    return;
  }

  const strategy = selectUplinkStopStrategy(reason);

  await new Promise<void>((resolve) => {
    const finalize = () => {
      uplinkProcesses = uplinkProcesses.filter((candidate) => candidate !== entry);
      resolve();
    };

    entry.process.once("exit", finalize);
    try {
      entry.process.kill(strategy.initialSignal);
    } catch {
      // Process may have raced to exit between the exitCode check and kill.
    }

    if (strategy.escalateToSigkillAfterMs > 0) {
      setTimeout(() => {
        if (entry.process.exitCode === null) {
          try {
            entry.process.kill("SIGKILL");
          } catch {
            // Already exited between the check and the signal.
          }
        }
      }, strategy.escalateToSigkillAfterMs);
    }
  });
}

async function stopAllUplinkProcesses(reason = ""): Promise<void> {
  const running = [...getRunningUplinkProcesses()];
  for (const entry of running) {
    await stopUplinkProcess(entry, reason);
  }
}

function getDesiredTargetKind(selection: SelectionResult): "asset" | "insert" | "standby" | "reconnect" | "live" {
  if (selection.queueKind === "live") {
    return "live";
  }
  if (selection.reasonCode === "operator_insert" || selection.reasonCode === "scheduled_insert") {
    return "insert";
  }
  if (selection.asset) {
    return "asset";
  }
  return selection.lifecycleStatus === "reconnecting" ? "reconnect" : "standby";
}

function isMatchingRunningSelection(selection: SelectionResult): boolean {
  if (!playoutProcess || playoutProcess.killed) {
    return false;
  }

  const desiredKind = getDesiredTargetKind(selection);
  if (desiredKind === "asset" || desiredKind === "insert") {
    const desiredAsset = selection.asset;
    if (!desiredAsset) {
      return false;
    }
    return playoutTargetKind === desiredKind && playoutAssetId === desiredAsset.id;
  }

  if (desiredKind === "live") {
    return (
      playoutTargetKind === "live" &&
      playoutLiveBridgeInputUrl === selection.liveBridgeInputUrl &&
      playoutLiveBridgeInputType === selection.liveBridgeInputType
    );
  }

  return playoutTargetKind === "standby" || playoutTargetKind === "reconnect";
}

function isMatchingRunningTarget(args: {
  selection: SelectionResult;
  destinationIds: string[];
}): boolean {
  const currentIds = [...playoutDestinationIds].sort();
  const desiredIds = [...args.destinationIds].sort();
  if (currentIds.length !== desiredIds.length || currentIds.some((value, index) => value !== desiredIds[index])) {
    return false;
  }
  return isMatchingRunningSelection(args.selection);
}

function shouldStageRecoveredDestination(destination: StreamDestinationRecord, streamTarget: string | null): boolean {
  return (
    Boolean(playoutProcess && !playoutProcess.killed) &&
    playoutDestinationIds.length > 0 &&
    !playoutDestinationIds.includes(destination.id) &&
    Boolean(streamTarget) &&
    !isDestinationCoolingDown(destination) &&
    destination.lastFailureAt !== "" &&
    (destination.status === "error" || destination.status === "recovering")
  );
}

async function promoteRecoveringDestinations(reason: "manual" | "transition"): Promise<number> {
  const state = await readAppState();
  const recoveringDestinations = state.destinations.filter((destination) => destination.status === "recovering");
  if (recoveringDestinations.length === 0) {
    return 0;
  }

  const now = new Date().toISOString();
  for (const destination of recoveringDestinations) {
    await updateDestinationRecord({
      ...destination,
      status: "ready",
      lastValidatedAt: now,
      notes:
        reason === "manual"
          ? `${destination.role === "backup" ? "Backup" : "Primary"} destination is rejoining immediately after an operator recovery request.`
          : `${destination.role === "backup" ? "Backup" : "Primary"} destination is rejoining on a natural transition after the recovery hold expired.`
    });
    await resolveIncident(
      `playout.destination.${destination.id}.failed`,
      reason === "manual"
        ? "Operator requested immediate output recovery."
        : "Destination recovered and will rejoin on the next natural transition."
    );
  }

  logRuntimeEvent("destination.recovery.promoted", {
    reason,
    destinationIds: recoveringDestinations.map((destination) => destination.id)
  });
  return recoveringDestinations.length;
}

// Audio-presence probe results, keyed by a caller-chosen string. A dedicated cache rather than a
// field on queueProbeCache: the resolution probe overwrites its entry wholesale on every re-resolve,
// which would silently wipe an audio verdict carried on the same record. The programme input caches
// by asset id (a stable input); the live SOURCE never caches (see probeInputHasAudio's caller).
type AudioProbeEntry = { checkedAt: number; hasAudio: boolean };
const audioProbeCache = new Map<string, AudioProbeEntry>();

/**
 * Whether an input carries an audio stream, bounded (M57 stage 2, Etappe D). Never a start blockade:
 * any probe failure or timeout resolves to "no audio", which downgrades the attach to video-only
 * rather than holding the channel. The timeout is clamped to the cycle-await ceiling so a slow remote
 * probe cannot eat the reconciliation budget; RTSP inputs are pinned to TCP like every other read.
 * A cacheKey caches the verdict (stable programme inputs); omit it for the live source, whose audio
 * can change between attaches — a stale "has audio" would reintroduce the graph-init crash it exists
 * to prevent, so the source is probed fresh every time.
 */
async function probeInputHasAudio(input: string, options: { cacheKey?: string } = {}): Promise<boolean> {
  const cacheKey = options.cacheKey ?? "";
  const cached = cacheKey ? audioProbeCache.get(cacheKey) : null;
  if (cached && Date.now() - cached.checkedAt < NEXT_ASSET_PROBE_READY_TTL_MS) {
    return cached.hasAudio;
  }

  const { effectiveMs } = clampToCycleAwaitCeiling(4_000, process.env);
  const transport = input.startsWith("rtsp://") || input.startsWith("rtsps://") ? ["-rtsp_transport", "tcp"] : [];
  let hasAudio = false;
  try {
    const output = await execFileText(
      process.env.FFPROBE_BIN || "ffprobe",
      ["-v", "error", ...transport, "-select_streams", "a", "-show_entries", "stream=index", "-of", "csv=p=0", input],
      { timeoutMs: effectiveMs, killProcessGroup: true, maxBufferBytes: 256 * 1024 }
    );
    hasAudio = output.split("\n").some((line) => line.trim() !== "");
  } catch (error) {
    logRuntimeEvent("playout.source-live.audio_probe_failed", {
      probe: cacheKey || "source",
      error: error instanceof Error ? error.message : String(error)
    });
    hasAudio = false;
  }

  if (cacheKey) {
    audioProbeCache.set(cacheKey, { checkedAt: Date.now(), hasAudio });
  }
  return hasAudio;
}

/**
 * Turns a decided attach into the concrete PiP command config: the RTSP input args, the pixel box
 * (computed against the renderer's own viewport, so the live window lands exactly where the skipped
 * snapshot panel would have), and the audio branch. The audio branch is gated by decideLiveSourceAudio
 * on the programme having a KNOWN finite duration (else the feed-audio watchdog must stay the net) and
 * only ever references the source audio after PROBING it (the relay's advisory track flag alone would
 * risk a graph-init crash on a lying or racing publisher). Otherwise video-only, never blocked.
 */
async function buildLiveSourceCommandConfig(args: {
  attach: ResolvedLiveSourceAttach;
  outputSettings: WorkerStreamOutputSettings;
  audioLane: ResolvedAudioLane | null;
  programInput: string;
  assetId: string;
  programDurationSeconds: number;
}): Promise<LiveSourceCommandConfig> {
  const viewport = getSceneRendererViewport(process.env, args.outputSettings);
  const box = resolveSourceLayerPixelBox(args.attach.placement, viewport);

  let audio: SourceLivePipAudio | null = null;
  const programKnownDuration = Number.isFinite(args.programDurationSeconds) && args.programDurationSeconds > 0;
  // Probe only on the path that could actually mix: known-duration programme AND the relay's advisory
  // flag hinting at audio (skips the RTSP open when there is plainly none). The source probe is the
  // authority — never the advisory flag — so a relay that reports audio the pull cannot deliver falls
  // back to video-only here instead of crashing ffmpeg into the breaker.
  if (programKnownDuration && args.attach.hasAudioTrack && (await probeInputHasAudio(args.attach.readUrl))) {
    const programAudioConfirmed = args.audioLane
      ? true
      : await probeInputHasAudio(args.programInput, { cacheKey: args.assetId });
    audio = decideLiveSourceAudio({
      programDurationSeconds: args.programDurationSeconds,
      sourceAudioConfirmed: true,
      hasAudioLane: Boolean(args.audioLane),
      laneVolumePercent: args.audioLane?.volumePercent ?? 0,
      programAudioConfirmed,
      sourceGainPercent: args.attach.gainPercent
    });
  }

  return { inputArgs: buildSourceLivePipInputArgs(args.attach.readUrl), box, audio };
}

async function startOrSwitchPlayout(args: {
  asset: AssetRecord | null;
  resolvedAssetInput?: string;
  liveBridge:
    | {
        inputUrl: string;
        inputType: LiveBridgeInputType;
        label: string;
      }
    | null;
  audioLane: ResolvedAudioLane | null;
  /**
   * A pushed source to attach as a live PiP input this start, or null to leave the source on the
   * stage-1 snapshot panel. Non-null only at natural playout boundaries with the feature on, the
   * layer present, the source publishing and the breaker closed — the decision is made by the
   * caller (resolveLiveSourceAttach); this function turns it into ffmpeg inputs.
   */
  liveSource: ResolvedLiveSourceAttach | null;
  destinations: StreamDestinationRecord[];
  outputTarget: ReturnType<typeof buildFfmpegOutputTarget>;
  updateDestinations?: boolean;
  lifecycleStatus: AppState["playout"]["status"];
  reason: string;
  reasonCode: AppState["playout"]["selectionReasonCode"];
  fallbackTier: AppState["playout"]["fallbackTier"];
  overlayEnabled: boolean;
  outputSettings: OutputSettingsRecord;
  /** Managed config from the caller's state read; the encoder settings resolve through it. */
  managedConfig: AppState["managedConfig"] | null;
  runtimeTargets: DestinationRuntimeTarget[];
  runtimeStatus: AppState["playout"]["status"];
  runtimeHeartbeatAt: string;
  runtimeLastExitCode: string;
}): Promise<void> {
  const switching = playoutProcess && !playoutProcess.killed;
  if (switching) {
    await stopPlayoutProcess("switch");
  }

  const leadDestination = args.destinations[0] ?? null;
  if (!leadDestination) {
    throw new Error("Cannot start playout without at least one resolved destination.");
  }

  const ffmpegBinary = process.env.FFMPEG_BIN || "ffmpeg";
  const cachedProbe = args.asset ? getFreshProbeCache(args.asset.id) : null;
  const cachedResolvedInput = cachedProbe?.status === "ready" ? cachedProbe.resolvedInput : "";
  const skipInitialSceneCapture = shouldSkipInitialSceneCapture({
    overlayEnabled: args.overlayEnabled,
    switching: Boolean(switching),
    playoutStatus: args.runtimeStatus,
    lastExitCode: args.runtimeLastExitCode,
    heartbeatAt: args.runtimeHeartbeatAt,
    windowMs: PLAYOUT_RECOVERY_SCENE_CAPTURE_SKIP_WINDOW_MS
  });
  if (skipInitialSceneCapture) {
    logRuntimeEvent("scene.render.recovery.skip", {
      reasonCode: args.reasonCode,
      runtimeStatus: args.runtimeStatus
    });
  }
  const outputSettings = getWorkerStreamOutputSettings(process.env, args.outputSettings);
  // Set the renderer skip BEFORE the initial frame is drawn, so a live attach's very first frame
  // already omits the snapshot panel instead of flashing it over the live video. Only the asset
  // path (no liveBridge) can carry a PiP; overlay must be on for any scene panel to exist at all.
  const intendLiveAttach = Boolean(args.liveSource) && Boolean(args.asset) && !args.liveBridge && args.overlayEnabled;
  playoutLiveSourceAttached = intendLiveAttach;
  if (args.overlayEnabled && !skipInitialSceneCapture) {
    await ensureScenePayload(args.asset ?? null);
  }
  const initialSceneFrame = args.overlayEnabled && !skipInitialSceneCapture ? await prepareSceneRendererFrame(outputSettings) : null;
  const overlayMode: OnAirOverlayMode = !args.overlayEnabled ? "none" : initialSceneFrame ? "scene" : "text";
  let resolvedAudioLaneInput = "";

  if (args.audioLane) {
    try {
      resolvedAudioLaneInput = await resolvePlayableInput(args.audioLane.asset.path);
      await resolveIncident("playout.audio-lane.failed", "Audio lane input resolved successfully.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown audio lane resolution error.";
      logRuntimeEvent("playout.audio-lane.fallback", {
        poolId: args.audioLane.poolId,
        assetId: args.audioLane.asset.id,
        error: message
      });
      await upsertIncident({
        scope: "playout",
        severity: "warning",
        title: "Audio lane fell back to program audio",
        message,
        fingerprint: "playout.audio-lane.failed"
      });
    }
  }

  if (isProgramFeedMode()) {
    await ensureProgramFeedDirectory();
  }

  const resolvedProgramInput = args.liveBridge
    ? args.liveBridge.inputUrl
    : args.asset
      ? args.resolvedAssetInput || cachedResolvedInput || (await resolveAssetPlaybackInput(args.asset)).input
      : "";
  const encoder = resolveEncoderQualitySettings(args.managedConfig, process.env);
  // Resolve the PiP config only when we will actually build it: asset path, scene mode, attach
  // decided. buildLiveSourceCommandConfig may run a bounded ffprobe for programme audio, so it is
  // awaited here, off the reconciliation loop's own timing (this start is already asynchronous).
  const liveSourceConfig =
    args.liveSource && args.asset && !args.liveBridge && overlayMode === "scene"
      ? await buildLiveSourceCommandConfig({
          attach: args.liveSource,
          outputSettings,
          audioLane: resolvedAudioLaneInput && args.audioLane ? args.audioLane : null,
          programInput: resolvedProgramInput,
          assetId: args.asset.id,
          programDurationSeconds: args.asset.durationSeconds ?? 0
        })
      : null;
  playoutLiveSourceInputActive = Boolean(liveSourceConfig);
  // The only place that may tell the studio a source is live (M57 stage 2, Etappe E). Everything
  // upstream of here is an intention: the decision, the resolved URL, even a non-null liveSource on
  // this call — a start that turned out to be a live bridge or fell back to text mode takes no PiP
  // input at all. `playoutLiveSourceInputActive` is the fact, and it is what gets reported.
  recordSourceLiveState(
    buildStartedSourceLiveStateWrite({
      intendedSourceId: args.liveSource?.sourceId ?? "",
      inputActive: playoutLiveSourceInputActive
    })
  );
  const command = args.liveBridge
    ? getLiveBridgeFfmpegCommand(args.liveBridge.inputUrl, args.outputTarget, overlayMode, outputSettings, encoder)
    : args.asset
      ? getFfmpegCommand(
          resolvedProgramInput,
          args.outputTarget,
          overlayMode,
          resolvedAudioLaneInput && args.audioLane
            ? {
                input: resolvedAudioLaneInput,
                volumePercent: args.audioLane.volumePercent
              }
            : null,
          outputSettings,
          encoder,
          liveSourceConfig
        )
      : getStandbyFfmpegCommand(args.outputTarget, overlayMode, outputSettings, encoder);
  if (liveSourceConfig) {
    logRuntimeEvent("playout.source-live.attached", {
      source: args.liveSource?.sourceId ?? "",
      audio: liveSourceConfig.audio ? "mixed" : "video-only"
    });
  }
  const child = spawn(ffmpegBinary, command, {
    stdio: ["ignore", "pipe", "pipe", "pipe"]
  });

  // Without an 'error' listener, EventEmitter rethrows a spawn failure (missing ffmpeg binary,
  // EAGAIN under process pressure, EACCES) as an uncaught exception that the try/catch around the
  // caller cannot see, because it is emitted asynchronously.
  child.on("error", (error) => {
    logRuntimeEvent("playout.process.spawn_failed", {
      binary: ffmpegBinary,
      error: error instanceof Error ? error.message : String(error)
    });
  });

  playoutProcess = child;
  playoutProcessStartedAtMs = Date.now();
  playoutAssetId = args.asset?.id ?? "";
  playoutDestinationId = leadDestination.id;
  playoutDestinationIds = args.destinations.map((destination) => destination.id);
  playoutRuntimeTargets = args.runtimeTargets;
  playoutTargetKind = args.liveBridge
    ? "live"
    : args.asset
      ? args.reasonCode === "operator_insert" || args.reasonCode === "scheduled_insert"
        ? "insert"
        : "asset"
      : args.lifecycleStatus === "reconnecting"
        ? "reconnect"
        : "standby";
  playoutResolvedInput = resolvedProgramInput;
  playoutLastStderrSample = "";
  playoutLiveBridgeInputUrl = args.liveBridge?.inputUrl ?? "";
  playoutLiveBridgeInputType = args.liveBridge?.inputType ?? "";

  logRuntimeEvent("playout.process.start", {
    destinationIds: playoutDestinationIds,
    targetKind: playoutTargetKind,
    assetId: args.asset?.id ?? "",
    input: summarizePlaybackInput(playoutResolvedInput),
    liveInputType: args.liveBridge?.inputType ?? "",
    audioLaneAssetId: args.audioLane?.asset.id ?? "",
    reasonCode: args.reasonCode,
    lifecycleStatus: args.lifecycleStatus
  });

  // Boundary gap measurement. "scheduled" tier is real programme content; every other tier is a
  // fallback/bridge covering the boundary. Observation only — nothing below feeds a decision.
  playoutIsProgramme = (playoutTargetKind === "asset" || playoutTargetKind === "insert") && args.fallbackTier === "scheduled";
  if (playoutIsProgramme && args.asset) {
    const gap = programmeGapTracker.closeGap(args.asset.id, Date.now());
    if (gap) {
      logRuntimeEvent("playout.boundary.gap", {
        fromAssetId: gap.fromAssetId,
        toAssetId: gap.toAssetId,
        gapMs: gap.gapMs,
        bridgeStarts: gap.bridgeStarts,
        reasonCode: args.reasonCode
      });
    }
  } else if (args.asset) {
    programmeGapTracker.noteBridge(args.asset.id);
  }

  const pid = child.pid ?? 0;
  const startedAt = new Date().toISOString();
  const programFeedConfig = isProgramFeedMode() ? getProgramFeedRuntimeConfig() : null;

  if (overlayMode === "scene" && initialSceneFrame && isWritablePipe(child.stdio[ON_AIR_SCENE_PIPE_FD])) {
    startSceneRendererLoop(child.stdio[ON_AIR_SCENE_PIPE_FD], initialSceneFrame, outputSettings);
  } else {
    stopSceneRendererLoop();
  }

  await updatePlayoutRuntime((playout) => ({
    ...playout,
    status:
      args.lifecycleStatus === "standby" || args.lifecycleStatus === "reconnecting"
        ? args.lifecycleStatus
        : switching
          ? "switching"
          : args.lifecycleStatus === "recovering"
            ? "recovering"
            : "starting",
    transitionState: switching ? "switching" : "idle",
    transitionTargetKind: args.asset
      ? args.reasonCode === "operator_insert" || args.reasonCode === "scheduled_insert"
        ? "insert"
        : "asset"
      : args.liveBridge
        ? "live"
        : args.lifecycleStatus === "reconnecting"
          ? "reconnect"
          : "standby",
    transitionTargetAssetId: args.asset?.id ?? "",
    transitionTargetTitle:
      buildAssetDisplayTitle(args.asset) ||
      args.liveBridge?.label ||
      (args.lifecycleStatus === "reconnecting" ? "Scheduled reconnect" : "Replay standby"),
    transitionReadyAt: "",
    currentAssetId: args.asset?.id ?? "",
    currentTitle: buildAssetDisplayTitle(args.asset) || args.liveBridge?.label || "Replay standby",
    desiredAssetId: args.asset?.id ?? "",
    currentDestinationId: leadDestination.id,
    restartRequestedAt: "",
    heartbeatAt: startedAt,
    processPid: pid,
    processStartedAt: startedAt,
    lastTransitionAt: startedAt,
    selectionReasonCode: args.reasonCode,
    fallbackTier: args.fallbackTier,
    liveBridgeStatus: args.liveBridge
      ? playout.liveBridgeStatus === "releasing"
        ? "releasing"
        : "active"
      : playout.liveBridgeStatus,
    liveBridgeStartedAt: args.liveBridge ? playout.liveBridgeStartedAt || startedAt : playout.liveBridgeStartedAt,
    liveBridgeReleasedAt: args.liveBridge
      ? playout.liveBridgeStatus === "releasing"
        ? playout.liveBridgeReleasedAt
        : ""
      : playout.liveBridgeReleasedAt,
    liveBridgeLastError: args.liveBridge && playout.liveBridgeStatus !== "releasing" ? "" : playout.liveBridgeLastError,
    programFeedPlaylistPath: programFeedConfig?.playlistPath ?? playout.programFeedPlaylistPath,
    programFeedTargetSeconds: programFeedConfig?.targetSeconds ?? playout.programFeedTargetSeconds,
    programFeedBufferedSeconds: programFeedConfig?.bufferedSeconds ?? playout.programFeedBufferedSeconds,
    lastError: "",
    pendingAction: "",
    pendingActionRequestedAt: "",
    message: args.reason
  }));

  // One fingerprint for the whole family, not one per asset: see incident-classes.ts. The asset
  // that failed is named in the incident's message, which is where the detail belongs.
  await resolveIncident(
    "playout.ffmpeg.exit",
    args.asset ? `Asset ${args.asset.title} started successfully.` : "Playout process started successfully."
  );

  if (args.updateDestinations !== false) {
    for (const destination of args.destinations) {
      await updateDestinationRecord({
        ...destination,
        status: "ready",
        lastValidatedAt: startedAt,
        // Failures since the last clean start — the counter meant nothing while it only ever grew.
        failureCount: 0,
        lastError: "",
        notes: `${destination.role === "backup" ? "Backup" : "Primary"} destination is active in the current multi-output group.`
      });
    }
  }

  child.stderr?.on("data", (chunk) => {
    const line = redactSecrets(chunk.toString().trim());
    if (!line) {
      return;
    }

    playoutLastStderrSample = line.slice(0, 400);

    // Also to the container log, the way the uplink already does.
    //
    // The runtime field alone is not a record: it is cleared when the next process starts, so a
    // failure that is followed by a restart leaves an exit code with nothing beside it. That is
    // exactly what happened when the fallback video exited 255 and took the uplink's encoder down
    // with it — lastExitCode said 255, lastStderrSample was empty, and the reason was gone.
    logRuntimeEvent("playout.ffmpeg.stderr", {
      message: playoutLastStderrSample
    });

    void updatePlayoutRuntime((playout) => ({
      ...playout,
      lastStderrSample: playoutLastStderrSample,
      heartbeatAt: new Date().toISOString()
    }));

    if (line.toLowerCase().includes("error")) {
      void upsertIncident({
        scope: "playout",
        severity: "warning",
        title: "FFmpeg reported an error",
        message: line.slice(0, 400),
        fingerprint: "playout.ffmpeg.stderr"
      });
    }

    if (isLikelyDestinationOutputError(line)) {
      const destinationIds = matchDestinationFailuresInLog(line, playoutRuntimeTargets);
      for (const destinationId of destinationIds) {
        void markDestinationFailure(destinationId, line);
      }
    }
  });

  child.on("exit", (code, signal) => {
    // Keep the reason string, not just the boolean: a `planned: true` exit used to be
    // indistinguishable between "a watchdog/switch deliberately killed it" and "ffmpeg reached EOF
    // cleanly", which made three consecutive mid-asset stops on the DUT undiagnosable from the log.
    const plannedReason = plannedStopReason;
    const wasPlanned = plannedReason !== "";
    const exitedCleanly = code === 0 && !signal;
    const exitReason = describeFfmpegExit(code, signal ?? null);
    const lastDestinationIds = [...playoutDestinationIds];
    const lastRuntimeTargets = [...playoutRuntimeTargets];
    const lastTargetKind = playoutTargetKind;
    const lastAssetId = playoutAssetId;
    const lastResolvedInput = playoutResolvedInput;
    const lastInputSummary = summarizePlaybackInput(lastResolvedInput);
    const lastStderrSample = playoutLastStderrSample;
    const naturalBoundary =
      !wasPlanned &&
      isNaturalPlayoutBoundary({
        targetKind: lastTargetKind,
        code,
        signal: signal ?? null
      });
    const nonFailureExit = wasPlanned || exitedCleanly;
    const lastLiveBridgeInputUrl = playoutLiveBridgeInputUrl;
    const hadLiveSourceInput = playoutLiveSourceInputActive;
    const ranForMs = playoutProcessStartedAtMs > 0 ? Date.now() - playoutProcessStartedAtMs : null;
    // Open a boundary measurement only when real programme content left the air; a fallback ending
    // is part of the gap that is already being measured, not the start of a new one.
    if (playoutIsProgramme && lastAssetId) {
      programmeGapTracker.openGap(lastAssetId, Date.now());
    }
    playoutIsProgramme = false;
    plannedStopReason = "";
    stopSceneRendererLoop();
    playoutProcess = null;
    playoutProcessStartedAtMs = 0;
    playoutAssetId = "";
    playoutDestinationId = "";
    playoutDestinationIds = [];
    playoutRuntimeTargets = [];
    playoutTargetKind = "";
    playoutResolvedInput = "";
    playoutLastStderrSample = "";
    playoutLiveBridgeInputUrl = "";
    playoutLiveBridgeInputType = "";
    playoutLiveSourceInputActive = false;
    // A failed attach start — an unplanned, non-clean exit of a process that actually carried a
    // live PiP input — opens the attach breaker (M57 stage 2, Etappe C). For the cooldown the
    // next starts skip the presence fetch and decide "skip", so a feed that kills the encode is
    // retried at breaker cadence (minutes), not cycle cadence, and cannot drive the crash-loop
    // counter to its threshold on its own. A natural boundary or a clean/planned stop is not a
    // failure and never opens it.
    if (hadLiveSourceInput && !wasPlanned && !naturalBoundary && !exitedCleanly) {
      sourceLiveAttachBreaker = openAttachBreaker(Date.now());
      logRuntimeEvent("playout.source-live.attach_failed", {
        exitCode: code ?? "",
        exitSignal: signal ?? "",
        assetId: lastAssetId
      });
    }
    const exitedAt = new Date().toISOString();
    logRuntimeEvent("playout.process.exit", {
      exitCode: code ?? "",
      exitSignal: signal ?? "",
      exitReason,
      planned: wasPlanned || naturalBoundary,
      naturalBoundary,
      // "" for a natural EOF; otherwise names which stop path cut the process ("switch",
      // "duration-bound", "feed-stalled", "scheduled-reconnect", ...).
      plannedReason,
      ranForMs: ranForMs ?? -1,
      targetKind: lastTargetKind,
      assetId: lastAssetId,
      input: lastInputSummary,
      lastStderrSample,
      destinationIds: lastDestinationIds,
      exitedAt
    });
    // (A) A remote-resolved asset that fails immediately at input-open time was started with a
    // dead/expired resolved URL (e.g. a stale googlevideo URL → exitCode=8 / "Error opening
    // input"). Drop its probe cache so the next attempt re-resolves a fresh URL instead of
    // reusing the dead one.
    if (
      !wasPlanned &&
      lastAssetId &&
      isImmediateInputOpenFailure({
        exitCode: code ?? null,
        exitSignal: signal ?? null,
        stderrSample: lastStderrSample,
        ranForMs
      })
    ) {
      queueProbeCache.delete(lastAssetId);
      logRuntimeEvent("playout.input.reresolve", {
        assetId: lastAssetId,
        exitCode: code ?? "",
        ranForMs: ranForMs ?? -1,
        input: lastInputSummary
      });
    }
    let crashLoopDetectedAfterExit = false;
    const runtimeUpdate = updatePlayoutRuntime((playout) => {
      const ranPastCrashWindow =
        playout.processStartedAt !== "" && Date.now() - new Date(playout.processStartedAt).getTime() >= PLAYOUT_CRASH_LOOP_WINDOW_MS;
      const nextCrashCountWindow = nonFailureExit || ranPastCrashWindow ? 0 : playout.crashCountWindow + 1;
      crashLoopDetectedAfterExit = !nonFailureExit && nextCrashCountWindow >= PLAYOUT_CRASH_LOOP_THRESHOLD;
      const failureMessage = lastStderrSample ? `FFmpeg ${exitReason}. Last stderr: ${lastStderrSample}` : `FFmpeg ${exitReason}.`;

      return {
        ...playout,
        status: nonFailureExit ? "idle" : crashLoopDetectedAfterExit ? "degraded" : "failed",
        heartbeatAt: exitedAt,
        transitionTargetKind: "",
        transitionTargetAssetId: "",
        transitionTargetTitle: "",
        transitionReadyAt: "",
        processPid: 0,
        processStartedAt: "",
        lastSuccessfulStartAt: nonFailureExit || ranPastCrashWindow ? playout.processStartedAt : playout.lastSuccessfulStartAt,
        lastSuccessfulAssetId: nonFailureExit || ranPastCrashWindow ? playout.currentAssetId : playout.lastSuccessfulAssetId,
        lastExitCode: String(code ?? signal ?? ""),
        restartCount: playout.restartCount + 1,
        crashCountWindow: nextCrashCountWindow,
        crashLoopDetected: crashLoopDetectedAfterExit,
        currentAssetId: nonFailureExit ? "" : playout.currentAssetId,
        currentTitle: nonFailureExit ? "" : playout.currentTitle,
        desiredAssetId: nonFailureExit ? "" : playout.desiredAssetId,
        lastError: nonFailureExit ? playout.lastError : failureMessage,
        transitionState: "idle",
        insertAssetId:
          !wasPlanned && playout.insertStatus === "active" && playout.currentAssetId === playout.insertAssetId
            ? ""
            : playout.insertAssetId,
        insertRequestedAt:
          !wasPlanned && playout.insertStatus === "active" && playout.currentAssetId === playout.insertAssetId
            ? ""
            : playout.insertRequestedAt,
        insertStatus:
          !wasPlanned && playout.insertStatus === "active" && playout.currentAssetId === playout.insertAssetId
            ? ""
            : playout.insertStatus,
        liveBridgeStatus:
          lastTargetKind === "live" && !wasPlanned && !exitedCleanly
            ? "error"
            : lastTargetKind === "live" && wasPlanned
              ? playout.liveBridgeStatus
              : playout.liveBridgeStatus,
        liveBridgeLastError:
          lastTargetKind === "live" && !wasPlanned && !exitedCleanly
            ? `Live Bridge input ${exitReason}.`
            : playout.liveBridgeLastError,
        selectionReasonCode: wasPlanned ? playout.selectionReasonCode : crashLoopDetectedAfterExit ? "ffmpeg_crash_loop" : playout.selectionReasonCode,
        message: wasPlanned
          ? "Playout stopped for a planned transition."
          : naturalBoundary
            ? "Playout reached a natural asset boundary and is selecting the next item."
          : exitedCleanly
            ? "Playout process stopped cleanly."
            : crashLoopDetectedAfterExit
              ? "Playout entered crash-loop protection."
              : `Playout process ${exitReason}.`
      };
    });
    void runtimeUpdate
      .then(() => {
        if (isProgramFeedMode()) {
          void updateProgramFeedRuntimeStatus().catch((error) => {
            logRuntimeEvent("program_feed.status.update.failed", {
              error: error instanceof Error ? error.message : String(error)
            });
          });
        }
        if (
          shouldRequestImmediatePlayoutRetry({
            planned: wasPlanned,
            naturalBoundary,
            crashLoopDetected: crashLoopDetectedAfterExit
          })
        ) {
          requestImmediatePlayoutCycle("ffmpeg-exit");
        }
      })
      .catch((error) => {
        logRuntimeEvent("playout.runtime.update.failed", {
          error: error instanceof Error ? error.message : String(error)
        });
      });
    if (!wasPlanned && !naturalBoundary) {
      const incidentMessage = lastStderrSample
        ? `FFmpeg ${exitReason}. Last stderr: ${lastStderrSample}`
        : `FFmpeg ${exitReason}.`;
      void upsertIncident({
        scope: "playout",
        severity: exitedCleanly ? "info" : "critical",
        title: lastAssetId && !exitedCleanly ? "Playout asset failed" : "FFmpeg process exited",
        message: lastAssetId
          ? `${incidentMessage} Asset ${lastAssetId}${lastInputSummary ? ` (${lastInputSummary})` : ""}.`
          : incidentMessage,
        // Deliberately not keyed by asset. It used to be, and every asset that ever failed left a
        // separate permanently open critical entry -- dozens of rows for one recurring cause. The
        // upsert already collapses repeats onto one row and refreshes its timestamp; the fingerprint
        // was simply too granular for that to help.
        fingerprint: "playout.ffmpeg.exit"
      });
      if (!exitedCleanly) {
        if (lastTargetKind === "live") {
          void upsertIncident({
            scope: "playout",
            severity: "warning",
            title: "Live Bridge input disconnected",
            message: `Live Bridge input ${summarizeLiveBridgeInput(lastLiveBridgeInputUrl)} exited unexpectedly.`,
            fingerprint: "playout.live-bridge.exit"
          });
        }
        void (async () => {
          const state = await readAppState();
          const lastErrorLine = state.playout.lastStderrSample || `FFmpeg ${exitReason}.`;
          if (isLikelyDestinationOutputError(lastErrorLine)) {
            const destinationIds = matchDestinationFailuresInLog(lastErrorLine, lastRuntimeTargets, { allowSingleTargetFallback: false });
            for (const destinationId of destinationIds) {
              await markDestinationFailure(destinationId, lastErrorLine);
            }
          }
        })();
      }
    }
  });
}

async function syncDestinations(): Promise<void> {
  const state = await readAppState();
  const managedKeys = await readManagedDestinationStreamKeys(state.destinations.map((destination) => destination.id));
  const now = new Date().toISOString();
  for (const destination of state.destinations) {
    const streamTarget = resolveDestinationStreamTarget({
      destination,
      managedKeys,
      env: process.env
    });
    const envConfig = getLegacyDestinationEnvConfig(destination.id, process.env);
    const managedKey = managedKeys[destination.id] || "";
    const streamKeySource = managedKey ? "managed" : envConfig.key ? "env" : "missing";
    const coolingDown = destination.enabled && Boolean(streamTarget) && isDestinationCoolingDown(destination);
    const stagedRecovery = destination.enabled && shouldStageRecoveredDestination(destination, streamTarget);
    const readyStatus = destination.enabled ? (streamTarget ? "ready" : "missing-config") : "missing-config";
    const nextStatus = coolingDown ? "error" : stagedRecovery ? "recovering" : readyStatus;
    if (stagedRecovery && destination.status !== "recovering") {
      logRuntimeEvent("destination.recovery.staged", {
        destinationId: destination.id,
        role: destination.role
      });
    }
    await updateDestinationRecord({
      ...destination,
      streamKeyPresent: Boolean(managedKey || envConfig.key),
      streamKeySource,
      status: nextStatus,
      lastValidatedAt: now,
      lastError: destination.lastError,
      notes: coolingDown
        ? `${
            destination.role === "backup" ? "Backup" : "Primary"
          } destination is cooling down after a recent output failure. Retry in ${getDestinationFailureSecondsRemaining(destination)}s.`
        : stagedRecovery
          ? `${
              destination.role === "backup" ? "Backup" : "Primary"
            } destination recovered, but it is staged until the next natural transition or an operator-triggered output recovery.`
        : streamTarget
          ? `${destination.role === "backup" ? "Backup" : "Primary"} destination is configured and ready for multi-output delivery.`
          : destination.id === "destination-backup"
            ? "Configure BACKUP_STREAM_OUTPUT_URL/KEY or save a managed backup stream key."
            : destination.id === "destination-primary"
              ? "Configure STREAM_OUTPUT_URL/KEY or save a managed primary stream key."
              : "Save a managed stream key for this destination to include it in multi-output delivery."
    });

    if (!coolingDown && streamTarget && destination.lastFailureAt !== "") {
      await resolveIncident(
        `playout.destination.${destination.id}.failed`,
        stagedRecovery
          ? "Destination recovered and is staged for the next natural transition."
          : "Destination recovered and is available for multi-output delivery again."
      );
    }
  }
}

/**
 * Announce every chapter offset the current playback has crossed since the last cycle.
 *
 * This is the cuepoint pattern one level down: elapsed time within the asset instead of within
 * the schedule block, measured against the playout process's own start clock because that is the
 * moment the asset began at second zero. The event always fires and is always recorded — even
 * while the Twitch metadata sync is gated waiting for the broadcaster connection — so the log
 * shows which chapters passed, and the sync (which reads elapsed time, not these events) starts
 * applying chapters the moment the broadcaster connects, without a restart.
 */
function emitDueAssetChapterBoundaries(asset: AssetRecord | null): void {
  if (!asset || !isPlayoutProcessRunning() || playoutAssetId !== asset.id || playoutProcessStartedAtMs <= 0) {
    return;
  }

  const chapters = parseAssetChaptersJson(asset.chaptersJson);
  if (chapters.length === 0) {
    return;
  }

  const windowKey = buildAssetChapterWindowKey(asset.id, new Date(playoutProcessStartedAtMs).toISOString());
  if (chapterBoundaryWindowKey !== windowKey) {
    chapterBoundaryWindowKey = windowKey;
    chapterBoundaryFiredKeys = [];
  }

  const progress = getDueAssetChapterBoundaries({
    windowKey,
    chapters,
    firedChapterKeys: chapterBoundaryFiredKeys,
    elapsedSeconds: Math.max(0, Math.floor((Date.now() - playoutProcessStartedAtMs) / 1000))
  });
  chapterBoundaryFiredKeys = progress.firedChapterKeys;

  for (const chapter of progress.dueChapters) {
    logRuntimeEvent("playout.chapter.boundary", {
      assetId: asset.id,
      offsetSeconds: chapter.offsetSeconds,
      categoryName: chapter.categoryName,
      title: chapter.title
    });
  }
}

async function runPlayoutCycle(): Promise<void> {
  let state = await readAppState();
  // The playout and uplink modes run as their own processes, so each cycle refreshes the managed
  // config it hands to the between-cycle readers (watchdog options, feed geometry, VOD cache
  // tuning). Before the first cycle those resolve env-only — exactly the pre-M56 behaviour.
  latestManagedConfig = state.managedConfig;
  if (
    (state.playout.overrideUntil !== "" && !isTimestampActive(state.playout.overrideUntil)) ||
    (state.playout.skipUntil !== "" && !isTimestampActive(state.playout.skipUntil))
  ) {
    await updatePlayoutRuntime((playout, current) => ({
      ...playout,
      overrideMode: isTimestampActive(playout.overrideUntil) ? playout.overrideMode : "schedule",
      overrideAssetId: isTimestampActive(playout.overrideUntil) ? playout.overrideAssetId : "",
      overrideUntil: isTimestampActive(playout.overrideUntil) ? playout.overrideUntil : "",
      skipAssetId: isTimestampActive(playout.skipUntil) ? playout.skipAssetId : "",
      skipUntil: isTimestampActive(playout.skipUntil) ? playout.skipUntil : ""
    }));
    state = await readAppState();
  }

  // Before anything looks at the running process: an asset that has played past its known
  // duration plus margin is over, whatever ffmpeg thinks. Stopping here, ahead of the selection
  // logic, makes the rest of this cycle indistinguishable from one that began just after a
  // natural EOF exit — the selection sees no running process and starts the next queue item.
  await enforceAssetDurationBound(state.assets);

  const previewSelection = choosePlaybackCandidate(state);
  if (playoutProcess && !playoutProcess.killed && !isMatchingRunningSelection(previewSelection)) {
    const promotedCount = await promoteRecoveringDestinations("transition");
    if (promotedCount > 0) {
      state = await readAppState();
    }
  }

  const managedDestinationKeys = await readManagedDestinationStreamKeys(state.destinations.map((entry) => entry.id));
  const activeDestinationGroup = selectDestinationRuntimeTargets({
    destinations: state.destinations,
    managedKeys: managedDestinationKeys,
    env: process.env
  });
  const relayTarget = getRelayRuntimeTarget();
  const playoutTargets = STREAM247_RELAY_ENABLED ? [relayTarget] : activeDestinationGroup.targets;
  const destination = STREAM247_RELAY_ENABLED ? relayTarget.destination : activeDestinationGroup.leadDestination;
  const outputTarget = STREAM247_RELAY_ENABLED ? getRelayOutputTarget() : buildFfmpegOutputTarget(activeDestinationGroup.targets);
  if (isProgramFeedMode()) {
    await ensureProgramFeedDirectory();
    await updateProgramFeedRuntimeStatus();
  }
  let selection: SelectionResult = choosePlaybackCandidate(state);

  if (state.playout.insertStatus !== "" && selection.reasonCode !== "operator_insert" && selection.queueKind !== "live") {
    await updatePlayoutRuntime((playout) => ({
      ...playout,
      insertAssetId: "",
      insertRequestedAt: "",
      insertStatus: "",
      heartbeatAt: new Date().toISOString(),
      message: "The pending insert is no longer available. Returning to scheduled playout."
    }));
    state = await readAppState();
    selection = choosePlaybackCandidate(state);
  }

  if (state.playout.manualNextAssetId !== "" && selection.reasonCode !== "manual_next") {
    const manualNextAsset = state.assets.find(
      (asset) =>
        asset.id === state.playout.manualNextAssetId &&
        asset.status === "ready" &&
        asset.includeInProgramming !== false &&
        asset.id !== (isTimestampActive(state.playout.skipUntil) ? state.playout.skipAssetId : "")
    );

    if (!manualNextAsset) {
      await updatePlayoutRuntime((playout) => ({
        ...playout,
        manualNextAssetId: "",
        manualNextRequestedAt: "",
        heartbeatAt: new Date().toISOString(),
        message: "The requested next item is no longer available. Returning to the scheduled queue."
      }));
      state = await readAppState();
      selection = choosePlaybackCandidate(state);
    }
  }

  if (!destination || playoutTargets.length === 0 || !outputTarget.output) {
    await stopPlayoutProcess("destination-missing");
    await upsertIncident({
      scope: "playout",
      severity: "warning",
      title: "Playout destination is not configured",
      message:
        "Configure at least one enabled output with an RTMP URL and stream key so the worker can build an active multi-output group.",
      fingerprint: "playout.output.missing"
    });

    await updatePlayoutRuntime((playout) => ({
      ...playout,
      status: "degraded",
      transitionTargetKind: "",
      transitionTargetAssetId: "",
      transitionTargetTitle: "",
      transitionReadyAt: "",
      currentAssetId: "",
      currentTitle: "",
      desiredAssetId: "",
      queueItems: [],
      insertAssetId: "",
      insertRequestedAt: "",
      insertStatus: "",
      processPid: 0,
      processStartedAt: "",
      heartbeatAt: new Date().toISOString(),
      selectionReasonCode: "destination_missing",
      fallbackTier: "none",
      message: "No active multi-output RTMP destination group is configured."
    }));
    return;
  }

  await resolveIncident("playout.output.missing", "Playout destination is configured.");

  if (state.playout.pendingAction === "refresh") {
    if (playoutProcess && !playoutProcess.killed && state.playout.liveBridgeStatus === "active") {
      if (state.overlay.enabled) {
        await writeOnAirOverlay(state, null, "live", {
          currentTitle: state.playout.liveBridgeLabel || state.playout.currentTitle || "Live Bridge",
          currentCategory: "Live input",
          currentSourceName: `Live Bridge · ${(state.playout.liveBridgeInputType || "rtmp").toUpperCase()}`,
          nextTitle: state.playout.nextTitle || "Schedule resumes after live mode"
        });
      } else {
        await writeStandbySlate(state, "live");
      }
    } else if (playoutProcess && !playoutProcess.killed && state.playout.currentAssetId) {
      const currentAsset = state.assets.find((asset) => asset.id === state.playout.currentAssetId) ?? null;
      if (currentAsset && state.overlay.enabled) {
        await writeOnAirOverlay(state, currentAsset, state.playout.queueItems[0]?.kind || "asset");
      } else {
        await writeStandbySlate(state, state.playout.queueItems[0]?.kind || "standby");
      }
    } else {
      await writeStandbySlate(state, state.playout.queueItems[0]?.kind || "standby");
    }

    await updatePlayoutRuntime((playout) => ({
      ...playout,
      pendingAction: "",
      pendingActionRequestedAt: "",
      heartbeatAt: new Date().toISOString(),
      message: "Broadcast refresh completed."
    }));
    state = await readAppState();
  } else if (state.playout.pendingAction === "rebuild_queue") {
    await updatePlayoutRuntime((playout) => ({
      ...playout,
      nextAssetId: "",
      nextTitle: "",
      transitionTargetKind: "",
      transitionTargetAssetId: "",
      transitionTargetTitle: "",
      transitionReadyAt: "",
      queuedAssetIds: [],
      queueItems: [],
      pendingAction: "",
      pendingActionRequestedAt: "",
      heartbeatAt: new Date().toISOString(),
      message: "Broadcast queue rebuild completed."
    }));
    state = await readAppState();
  }

  const liveBridgeActive =
    state.playout.liveBridgeInputUrl !== "" &&
    (state.playout.liveBridgeStatus === "pending" || state.playout.liveBridgeStatus === "active");
  const playoutReconnect = getPlayoutReconnectRuntimeConfig();
  const reconnectActive =
    !STREAM247_RELAY_ENABLED &&
    !liveBridgeActive &&
    state.playout.restartRequestedAt !== "" &&
    Date.now() - new Date(state.playout.restartRequestedAt).getTime() < playoutReconnect.windowMs;
  const reconnectDue =
    !STREAM247_RELAY_ENABLED &&
    !liveBridgeActive &&
    !reconnectActive &&
    state.playout.processStartedAt !== "" &&
    Date.now() - new Date(state.playout.processStartedAt).getTime() >= playoutReconnect.intervalMs;

  if (reconnectDue) {
    await stopPlayoutProcess("scheduled-reconnect");
    await updatePlayoutRuntime((playout) => ({
      ...playout,
      restartRequestedAt: new Date().toISOString(),
      message: `Scheduled ${playoutReconnect.intervalHours}h reconnect is starting.`
    }));
    state = await readAppState();
  }

  if (!liveBridgeActive && (reconnectActive || state.playout.restartRequestedAt !== "")) {
    await writeStandbySlate(state, "reconnect");
    selection = {
      asset: null,
      queueKind: "reconnect",
      insertTrigger: "",
      cuepointKey: "",
      cuepointOffsetSeconds: 0,
      liveBridgeInputUrl: "",
      liveBridgeInputType: "",
      liveBridgeLabel: "",
      reason: "Scheduled reconnect window is active. Standby slate is on air.",
      lifecycleStatus: "reconnecting" as const,
      reasonCode: "scheduled_reconnect" as const,
      fallbackTier: "standby" as const
    };
  } else if (selection.queueKind !== "live" && !selection.asset) {
    await upsertIncident({
      scope: "playout",
      severity: "warning",
      title: "No playable asset available",
      message: selection.reason,
      fingerprint: "playout.no-asset"
    });
    await writeStandbySlate(state, "standby");
    selection = {
      asset: null,
      queueKind: "standby",
      insertTrigger: "",
      cuepointKey: "",
      cuepointOffsetSeconds: 0,
      liveBridgeInputUrl: "",
      liveBridgeInputType: "",
      liveBridgeLabel: "",
      reason: "No playable asset is available. Standby replay slate is on air.",
      lifecycleStatus: "standby" as const,
      reasonCode: "standby" as const,
      fallbackTier: "standby" as const
    };
  }

  let resolvedSelectionInput = "";
  if (selection.asset) {
    const failedAsset = selection.asset;
    try {
      // Reuse the input already resolved by the off-boundary queue prefetch
      // (getPlayableQueuedAssets warms queueProbeCache during prior cycles while the
      // current asset is still playing). Without this, a Twitch-VOD cache / yt-dlp resolve
      // runs inline at the asset boundary and leaves playout idle with an empty currentAsset
      // (broadcastReady=false) until it completes. On a cache miss we fall through to the
      // same inline resolve, so this is never worse than before.
      const boundaryDecision = decideBoundaryPlaybackInput(getFreshProbeCache(failedAsset.id), failedAsset.id);
      if (boundaryDecision.source === "cache") {
        selection = { ...selection, asset: failedAsset };
        resolvedSelectionInput = boundaryDecision.input;
      } else {
        // Cache miss → a cold expensive remote resolve is needed. (B) If no playout process is
        // currently running — a failed exit OR a clean natural-boundary exit — bridge to the
        // instant local fallback now so broadcastReady stays up (feed covered) instead of going
        // dark for the ~60-120s cold resolve. The fallback restarts in seconds; on the next cycle
        // the scheduled asset resolves while fallback covers the feed, then playout switches to it
        // once ready. v1.5.13's prefetch cap and the 300s stall guard are untouched.
        const assetExpensive = isExpensiveQueueResolve(failedAsset);
        const broadcastDown = isBroadcastCoverageDown({
          playoutProcessRunning: playoutProcess !== null && playoutProcess.exitCode === null && !playoutProcess.killed
        });
        const bridgePlan =
          assetExpensive && broadcastDown
            ? planRecoveryAfterPlaybackPreparationFailure(state.assets, failedAsset)
            : null;
        const bridgeAsset =
          bridgePlan && bridgePlan.asset && !isExpensiveQueueResolve(bridgePlan.asset) ? bridgePlan.asset : null;
        if (
          bridgeAsset &&
          bridgePlan &&
          shouldBridgeToFallbackBeforeResolve({
            assetExpensive,
            cacheWarm: false,
            broadcastDown,
            fallbackAvailable: Boolean(bridgeAsset)
          })
        ) {
          const bridged = await resolveAssetPlaybackInput(bridgeAsset);
          logRuntimeEvent("playout.boundary.fallback_bridge", {
            scheduledAssetId: failedAsset.id,
            fallbackAssetId: bridged.asset.id,
            fallbackTier: bridgePlan.fallbackTier
          });
          selection = {
            asset: bridged.asset,
            queueKind: "asset",
            insertTrigger: "",
            cuepointKey: "",
            cuepointOffsetSeconds: 0,
            liveBridgeInputUrl: "",
            liveBridgeInputType: "",
            liveBridgeLabel: "",
            reason: "Bridged to local fallback while the scheduled asset re-resolves.",
            lifecycleStatus: "recovering" as const,
            reasonCode: bridgePlan.reasonCode,
            fallbackTier: bridgePlan.fallbackTier
          };
          resolvedSelectionInput = bridged.input;
          requestImmediatePlayoutCycle("boundary-fallback-bridge");
        } else {
          const prepared = await resolveAssetPlaybackInput(failedAsset);
          selection = { ...selection, asset: prepared.asset };
          resolvedSelectionInput = prepared.input;
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown Twitch VOD cache preparation error.";
      await upsertIncident({
        scope: "playout",
        severity: "warning",
        title: isTwitchVodAsset(failedAsset) ? "Twitch VOD cache preparation failed" : "Asset playback preparation failed",
        message,
        fingerprint: isTwitchVodAsset(failedAsset) ? "playout.twitch-cache.failed" : "playout.asset-preparation.failed"
      });
      const recoveryPlan = planRecoveryAfterPlaybackPreparationFailure(state.assets, failedAsset);
      if (recoveryPlan.asset) {
        try {
          const recovered = await resolveAssetPlaybackInput(recoveryPlan.asset);
          selection = {
            asset: recovered.asset,
            queueKind: "asset",
            insertTrigger: "",
            cuepointKey: "",
            cuepointOffsetSeconds: 0,
            liveBridgeInputUrl: "",
            liveBridgeInputType: "",
            liveBridgeLabel: "",
            reason: recoveryPlan.reason,
            lifecycleStatus: "recovering" as const,
            reasonCode: recoveryPlan.reasonCode,
            fallbackTier: recoveryPlan.fallbackTier
          };
          resolvedSelectionInput = recovered.input;
        } catch {
          await writeStandbySlate(state, "standby");
          selection = {
            asset: null,
            queueKind: "standby",
            insertTrigger: "",
            cuepointKey: "",
            cuepointOffsetSeconds: 0,
            liveBridgeInputUrl: "",
            liveBridgeInputType: "",
            liveBridgeLabel: "",
            reason: recoveryPlan.reason,
            lifecycleStatus: "standby" as const,
            reasonCode: "standby" as const,
            fallbackTier: "standby" as const
          };
        }
      } else {
        await writeStandbySlate(state, "standby");
        selection = {
          asset: null,
          queueKind: "standby",
          insertTrigger: "",
          cuepointKey: "",
          cuepointOffsetSeconds: 0,
          liveBridgeInputUrl: "",
          liveBridgeInputType: "",
          liveBridgeLabel: "",
          reason: recoveryPlan.reason,
          lifecycleStatus: "standby" as const,
          reasonCode: "standby" as const,
          fallbackTier: "standby" as const
        };
      }
    }
  }

  if (selection.queueKind === "live") {
    if (state.overlay.enabled) {
      await writeOnAirOverlay(state, null, "live", {
        currentTitle: selection.liveBridgeLabel || "Live Bridge",
        currentCategory: "Live input",
        currentSourceName: `Live Bridge · ${(selection.liveBridgeInputType || "rtmp").toUpperCase()}`,
        nextTitle: getNextScheduleItem(state)?.title || "Schedule resumes after live mode",
        nextTimeLabel: getNextScheduleItem(state)
          ? `${getNextScheduleItem(state)?.startTime}-${getNextScheduleItem(state)?.endTime}`
          : "No next block configured"
      });
    }
    await resolveIncident("playout.no-asset", "Live Bridge is on air.");
    await resolveIncident("playout.live-bridge.exit", "Live Bridge input is healthy.");
  } else if (selection.asset) {
    if (state.overlay.enabled) {
      await writeOnAirOverlay(
        state,
        selection.asset,
        selection.reasonCode === "operator_insert" || selection.reasonCode === "scheduled_insert" ? "insert" : "asset"
      );
    }
    await resolveIncident("playout.no-asset", "A playable asset is available again.");
  }

  if (state.playout.crashLoopDetected && (selection.asset || selection.queueKind === "live") && !state.playout.restartRequestedAt) {
    await stopPlayoutProcess("crash-loop-reset");
    await updatePlayoutRuntime((playout) => ({
      ...playout,
      crashLoopDetected: false,
      crashCountWindow: 0,
      restartRequestedAt: new Date().toISOString(),
      lastError: "",
      status: "recovering",
      message: "A playable asset is available again. Playout is restarting automatically."
    }));
    state = await readAppState();
  }

  if (state.playout.crashLoopDetected && !state.playout.restartRequestedAt) {
    await upsertIncident({
      scope: "playout",
      severity: "critical",
      title: "Playout crash-loop protection is active",
      message: "FFmpeg exited repeatedly. Manual intervention is required before automatic restarts resume.",
      fingerprint: "playout.crash-loop"
    });
    await updatePlayoutRuntime((playout) => ({
      ...playout,
      status: "degraded",
      transitionTargetKind: "",
      transitionTargetAssetId: "",
      transitionTargetTitle: "",
      transitionReadyAt: "",
      heartbeatAt: new Date().toISOString(),
      selectionReasonCode: "ffmpeg_crash_loop",
      message: "Crash-loop protection is active."
    }));
    return;
  }

  await resolveIncident("playout.crash-loop", "Playout crash-loop protection is not active.");

  const restartRequested = Boolean(state.playout.restartRequestedAt) && selection.queueKind !== "live";
  const currentScheduleItem = getCurrentScheduleItem(state);
  const currentAudioLane = resolvePoolAudioLane({
    state,
    poolId: currentScheduleItem?.poolId,
    queueKind: selection.queueKind,
    reasonCode: selection.reasonCode
  });
  // M57 stage 2, Etappes B–D: decide the live-source attach for this cycle (logged on change) once
  // the selection is final, so the relay presence poll runs only when the upcoming programme is an
  // ASSET — never during a live bridge or standby slate, which can never carry a PiP. Null leaves the
  // source on the stage-1 snapshot panel; a non-null intent is consumed only when a process actually
  // (re)starts, so an already-running target is never restarted mid-asset to attach — the attach
  // lands at the next natural boundary instead.
  const selectionIsAsset = selection.queueKind !== "live" && Boolean(selection.asset);
  const liveSourceAttach = await resolveLiveSourceAttach(state.managedConfig, selectionIsAsset);
  const manualNextQueueAsset =
    state.playout.manualNextAssetId !== "" && state.playout.manualNextAssetId !== selection.asset?.id
      ? state.assets.find(
          (asset) =>
            asset.id === state.playout.manualNextAssetId &&
            asset.status === "ready" &&
            asset.includeInProgramming !== false &&
            asset.id !== (isTimestampActive(state.playout.skipUntil) ? state.playout.skipAssetId : "")
        ) ?? null
      : null;
  const rawQueueAssets = prioritizeManualNextAsset(
    currentScheduleItem?.poolId &&
    (selection.queueKind === "live" ||
      (selection.asset &&
        (selection.reasonCode === "scheduled_match" ||
          selection.reasonCode === "scheduled_insert" ||
          selection.reasonCode === "graceful_handoff" ||
          selection.reasonCode === "manual_next")))
      ? getPoolPlaybackQueue(
          state,
          currentScheduleItem.poolId,
          isTimestampActive(state.playout.skipUntil) ? state.playout.skipAssetId : "",
          selection.asset?.id ?? ""
        )
      : [],
    manualNextQueueAsset
  );
  // While broadcast coverage is down (no running playout process — clean or failed boundary),
  // the prefetch must not await any expensive remote resolve before startOrSwitchPlayout below
  // restores coverage; the queue warms on the immediate follow-up cycle instead (see the
  // deferredExpensive wake at the end of this cycle).
  const prefetchBudget = decideQueuePrefetchBudget({
    coverageDown: !isPlayoutProcessRunning(),
    defaultBudget: MAX_EXPENSIVE_QUEUE_RESOLVES_PER_CYCLE
  });
  const { playableQueue, prefetchedAsset, prefetchStatus, prefetchError, deferredExpensive } =
    await getPlayableQueuedAssets(rawQueueAssets, { expensiveBudget: prefetchBudget });
  const queueItems = buildRuntimeQueueItems({
    state,
    selection,
    currentScheduleItem,
    playableQueue
  });
  const activeQueueItem = queueItems[0] ?? null;
  const nextQueueItem = queueItems[1] ?? null;
  const targetAlreadyRunning = isMatchingRunningTarget({
    selection,
    destinationIds: playoutTargets.map((entry) => entry.destination.id)
  });

  if (!currentAudioLane) {
    await resolveIncident("playout.audio-lane.failed", "Audio lane is not active.");
  }

  if (prefetchStatus === "failed" && prefetchError) {
    await upsertIncident({
      scope: "playout",
      severity: "warning",
      title: "Next queued asset probe failed",
      message: prefetchError,
      fingerprint: "playout.prefetch.failed"
    });
  } else {
    await resolveIncident("playout.prefetch.failed", "Next queued asset probe succeeded.");
  }

  if (restartRequested) {
    await stopPlayoutProcess("restart-requested");
    await updatePlayoutRuntime((playout) => ({
      ...playout,
      crashLoopDetected: false,
      crashCountWindow: 0,
      lastError: "",
      restartRequestedAt: reconnectActive || selection.reasonCode === "scheduled_reconnect" ? playout.restartRequestedAt : ""
    }));
    state = await readAppState();
  }

  if (!playoutProcess || playoutProcess.killed || restartRequested) {
    try {
      await startOrSwitchPlayout({
        asset: selection.asset,
        resolvedAssetInput: resolvedSelectionInput,
        liveBridge:
          selection.queueKind === "live"
            ? {
                inputUrl: selection.liveBridgeInputUrl,
                inputType: selection.liveBridgeInputType || "rtmp",
                label: selection.liveBridgeLabel || "Live Bridge"
              }
            : null,
        audioLane: currentAudioLane,
        liveSource: liveSourceAttach,
        destinations: playoutTargets.map((entry) => entry.destination),
        outputTarget,
        updateDestinations: !STREAM247_RELAY_ENABLED,
        lifecycleStatus: selection.lifecycleStatus,
        reason: selection.reason,
        reasonCode: selection.reasonCode,
        fallbackTier: selection.fallbackTier,
        overlayEnabled: state.overlay.enabled,
        outputSettings: state.output,
        managedConfig: state.managedConfig,
        runtimeTargets: playoutTargets,
        runtimeStatus: state.playout.status,
        runtimeHeartbeatAt: state.playout.heartbeatAt,
        runtimeLastExitCode: state.playout.lastExitCode
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown playout start error.";
      await upsertIncident({
        scope: "playout",
        severity: "critical",
        title: "Playout failed to start",
        message,
        fingerprint: "playout.start.failed"
      });
      await updatePlayoutRuntime((playout) => ({
        ...playout,
        status: "degraded",
        transitionState: "idle",
        transitionTargetKind: "",
        transitionTargetAssetId: "",
        transitionTargetTitle: "",
        transitionReadyAt: "",
        heartbeatAt: new Date().toISOString(),
        lastError: message,
        selectionReasonCode: "resolve_failed",
        fallbackTier: "none",
        nextAssetId: "",
        nextTitle: "",
        queuedAssetIds: [],
        queueItems: [],
        insertAssetId: "",
        insertRequestedAt: "",
        insertStatus: "",
        prefetchedAssetId: "",
        prefetchedTitle: "",
        prefetchedAt: "",
        prefetchStatus: "",
        prefetchError: "",
        liveBridgeStatus: selection.queueKind === "live" ? "error" : playout.liveBridgeStatus,
        liveBridgeLastError: selection.queueKind === "live" ? message : playout.liveBridgeLastError,
        message
      }));
      return;
    }
  } else if (!targetAlreadyRunning) {
    try {
      await startOrSwitchPlayout({
        asset: selection.asset,
        resolvedAssetInput: resolvedSelectionInput,
        liveBridge:
          selection.queueKind === "live"
            ? {
                inputUrl: selection.liveBridgeInputUrl,
                inputType: selection.liveBridgeInputType || "rtmp",
                label: selection.liveBridgeLabel || "Live Bridge"
              }
            : null,
        audioLane: currentAudioLane,
        liveSource: liveSourceAttach,
        destinations: playoutTargets.map((entry) => entry.destination),
        outputTarget,
        updateDestinations: !STREAM247_RELAY_ENABLED,
        lifecycleStatus: "switching",
        reason: selection.reason,
        reasonCode: selection.reasonCode,
        fallbackTier: selection.fallbackTier,
        overlayEnabled: state.overlay.enabled,
        outputSettings: state.output,
        managedConfig: state.managedConfig,
        runtimeTargets: playoutTargets,
        runtimeStatus: state.playout.status,
        runtimeHeartbeatAt: state.playout.heartbeatAt,
        runtimeLastExitCode: state.playout.lastExitCode
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown playout switch error.";
      await upsertIncident({
        scope: "playout",
        severity: "critical",
        title: "Playout switch failed",
        message,
        fingerprint: "playout.switch.failed"
      });
      await updatePlayoutRuntime((playout) => ({
        ...playout,
        status: "degraded",
        transitionState: "idle",
        transitionTargetKind: "",
        transitionTargetAssetId: "",
        transitionTargetTitle: "",
        transitionReadyAt: "",
        heartbeatAt: new Date().toISOString(),
        lastError: message,
        selectionReasonCode: "resolve_failed",
        nextAssetId: "",
        nextTitle: "",
        queuedAssetIds: [],
        queueItems: [],
        insertAssetId: "",
        insertRequestedAt: "",
        insertStatus: "",
        prefetchedAssetId: "",
        prefetchedTitle: "",
        prefetchedAt: "",
        prefetchStatus: "",
        prefetchError: "",
        liveBridgeStatus: selection.queueKind === "live" ? "error" : playout.liveBridgeStatus,
        liveBridgeLastError: selection.queueKind === "live" ? message : playout.liveBridgeLastError,
        message
      }));
      return;
    }
  } else if (selection.queueKind === "live" && state.overlay.enabled) {
    await writeOnAirOverlay(state, null, "live", {
      currentTitle: selection.liveBridgeLabel || "Live Bridge",
      currentCategory: "Live input",
      currentSourceName: `Live Bridge · ${(selection.liveBridgeInputType || "rtmp").toUpperCase()}`,
      nextTitle: nextQueueItem?.title || "Schedule resumes after live mode"
    });
  } else if (selection.asset && state.overlay.enabled) {
    await writeOnAirOverlay(
      state,
      selection.asset,
      selection.reasonCode === "operator_insert" || selection.reasonCode === "scheduled_insert" ? "insert" : "asset"
    );
  } else if (!selection.asset) {
    await writeStandbySlate(state, selection.lifecycleStatus === "reconnecting" ? "reconnect" : "standby");
  }

  const computedPrefetchedAt = prefetchedAsset ? new Date().toISOString() : "";
  const transitionTargetKind = nextQueueItem?.kind ?? "";
  const transitionTargetAssetId = nextQueueItem?.assetId ?? "";
  const transitionTargetTitle = nextQueueItem?.title ?? "";
  const cuepointWindowKey = currentScheduleItem?.key ?? "";
  const cuepointFiredKeys =
    cuepointWindowKey && state.playout.cuepointWindowKey === cuepointWindowKey ? [...state.playout.cuepointFiredKeys] : [];
  if (selection.insertTrigger === "cuepoint" && selection.cuepointKey && !cuepointFiredKeys.includes(selection.cuepointKey)) {
    cuepointFiredKeys.push(selection.cuepointKey);
  }
  const transitionReadyAt =
    nextQueueItem?.kind === "asset"
      ? prefetchedAsset && nextQueueItem.assetId === prefetchedAsset.id
        ? computedPrefetchedAt
        : ""
      : nextQueueItem
        ? new Date().toISOString()
        : "";

  await updatePlayoutRuntime((playout) => ({
    ...playout,
    status:
      selection.lifecycleStatus === "recovering"
        ? "recovering"
        : selection.lifecycleStatus === "standby"
          ? "standby"
          : selection.lifecycleStatus === "reconnecting"
            ? "reconnecting"
            : "running",
    transitionState:
      selection.lifecycleStatus === "standby" || selection.lifecycleStatus === "reconnecting"
        ? "idle"
        : prefetchedAsset
          ? "ready"
          : rawQueueAssets.length > 0
            ? "prefetching"
            : "idle",
    transitionTargetKind,
    transitionTargetAssetId,
    transitionTargetTitle,
    transitionReadyAt,
    queueVersion: incrementQueueVersion(playout.queueVersion, playout.queueItems, queueItems),
    currentAssetId: selection.asset?.id ?? "",
    currentTitle: activeQueueItem?.title || selection.liveBridgeLabel || buildAssetDisplayTitle(selection.asset) || "Replay standby",
    previousAssetId:
      (selection.asset && playout.currentAssetId !== "" && playout.currentAssetId !== selection.asset.id) ||
      (selection.queueKind === "live" && playout.currentAssetId !== "")
        ? playout.currentAssetId
        : playout.previousAssetId,
    previousTitle:
      (selection.asset && playout.currentAssetId !== "" && playout.currentAssetId !== selection.asset.id) ||
      (selection.queueKind === "live" && playout.currentAssetId !== "")
        ? playout.currentTitle
        : playout.previousTitle,
    desiredAssetId: selection.asset?.id ?? "",
    nextAssetId: nextQueueItem?.assetId ?? prefetchedAsset?.id ?? "",
    nextTitle: nextQueueItem?.title ?? buildAssetDisplayTitle(prefetchedAsset),
    queuedAssetIds: playableQueue.map((asset) => asset.id),
    queueItems,
    insertAssetId: selection.reasonCode === "operator_insert" && selection.asset ? selection.asset.id : playout.insertAssetId,
    insertRequestedAt:
      selection.reasonCode === "operator_insert" && selection.asset
        ? playout.insertRequestedAt || new Date().toISOString()
        : playout.insertRequestedAt,
    insertStatus:
      selection.reasonCode === "operator_insert"
        ? "active"
        : selection.lifecycleStatus === "standby" || selection.lifecycleStatus === "reconnecting"
          ? playout.insertStatus
          : playout.insertStatus,
    prefetchedAssetId: prefetchedAsset?.id ?? "",
    prefetchedTitle: buildAssetDisplayTitle(prefetchedAsset),
    prefetchedAt: computedPrefetchedAt,
    prefetchStatus,
    prefetchError,
    currentDestinationId: destination.id,
    restartRequestedAt: selection.reasonCode === "scheduled_reconnect" ? playout.restartRequestedAt : "",
    selectionReasonCode: selection.reasonCode,
    fallbackTier: selection.fallbackTier,
    liveBridgeInputType: selection.queueKind === "live" ? selection.liveBridgeInputType : playout.liveBridgeInputType,
    liveBridgeInputUrl: selection.queueKind === "live" ? selection.liveBridgeInputUrl : playout.liveBridgeInputUrl,
    liveBridgeLabel: selection.queueKind === "live" ? selection.liveBridgeLabel : playout.liveBridgeLabel,
    liveBridgeStatus:
      selection.queueKind === "live"
        ? playout.liveBridgeStatus === "releasing"
          ? "releasing"
          : "active"
        : playout.liveBridgeStatus === "releasing"
          ? ""
          : playout.liveBridgeStatus,
    liveBridgeStartedAt:
      selection.queueKind === "live"
        ? playout.liveBridgeStartedAt || new Date().toISOString()
        : playout.liveBridgeStartedAt,
    liveBridgeReleasedAt:
      selection.queueKind === "live"
        ? playout.liveBridgeStatus === "releasing"
          ? playout.liveBridgeReleasedAt
          : ""
        : playout.liveBridgeStatus === "releasing"
          ? new Date().toISOString()
          : playout.liveBridgeReleasedAt,
    liveBridgeLastError: selection.queueKind === "live" && playout.liveBridgeStatus !== "releasing" ? "" : playout.liveBridgeLastError,
    cuepointWindowKey,
    cuepointFiredKeys,
    cuepointLastTriggeredAt:
      selection.insertTrigger === "cuepoint" && selection.cuepointKey ? new Date().toISOString() : playout.cuepointLastTriggeredAt,
    cuepointLastAssetId: selection.insertTrigger === "cuepoint" && selection.asset ? selection.asset.id : playout.cuepointLastAssetId,
    heartbeatAt: new Date().toISOString(),
    pendingAction: "",
    pendingActionRequestedAt: "",
    manualNextAssetId: selection.asset && playout.manualNextAssetId === selection.asset.id ? "" : playout.manualNextAssetId,
    manualNextRequestedAt:
      selection.asset && playout.manualNextAssetId === selection.asset.id ? "" : playout.manualNextRequestedAt,
    message: activeQueueItem?.subtitle || selection.reason
  }));

  // Free cached VODs the moment they stop being needed. Keyed on what is in use rather than on a
  // playback-ended event, so a skip, a crash or a boundary frees the disk just as an ordinary
  // finish does.
  // Exactly one asset stops playing per transition, and that is the only thing worth deleting.
  // Deriving the delete set by elimination — everything not currently in use — removed VODs that had
  // been fetched ahead of their slot and never played, including a 19.1GB download seconds after
  // the 52 minutes it took to fetch.
  const finishedAssetId =
    selection.asset && state.playout.currentAssetId && state.playout.currentAssetId !== selection.asset.id
      ? state.playout.currentAssetId
      : "";
  await releaseWatchedVodCache(selection.asset?.id ?? "", finishedAssetId, state);
  await sweepProgramFeedSegments();

  emitDueAssetChapterBoundaries(selection.asset);

  if (
    currentScheduleItem?.poolId &&
    selection.reasonCode === "scheduled_match" &&
    selection.asset &&
    state.playout.currentAssetId !== selection.asset.id
  ) {
    await updatePoolCursor(currentScheduleItem.poolId, selection.asset.id, {
      incrementItemsSinceInsert: true
    });
  }

  if (
    currentScheduleItem?.poolId &&
    selection.reasonCode === "scheduled_insert" &&
    selection.asset &&
    state.playout.currentAssetId !== selection.asset.id
  ) {
    const pool = state.pools.find((entry) => entry.id === currentScheduleItem.poolId) ?? null;
    await updatePoolCursor(currentScheduleItem.poolId, pool?.cursorAssetId ?? "", {
      resetItemsSinceInsert: true
    });
  }

  if (prefetchBudget === 0 && deferredExpensive && isPlayoutProcessRunning()) {
    // Queue prefetch was skipped because coverage was down at the start of this cycle; coverage
    // is live again (startOrSwitchPlayout above), so warm the queue immediately instead of
    // waiting out the loop delay. Deliberately NOT requested for budget>0 deferrals (cap or
    // in-flight dedup) — those resume on the normal cadence and must not busy-wake the loop.
    requestImmediatePlayoutCycle("deferred-prefetch");
  }
}

async function startUplink(group: DestinationRuntimeTargetGroup, managedConfig: AppState["managedConfig"] | null): Promise<void> {
  const ffmpegBinary = process.env.FFMPEG_BIN || "ffmpeg";
  const inputMode = STREAM247_UPLINK_INPUT_MODE;
  const inputUrl = inputMode === "hls" ? getProgramFeedRuntimeConfig().playlistPath : getRelayInputUrl(process.env);
  const outputTarget = buildFfmpegOutputTarget(group.targets);
  const command = buildUplinkFfmpegCommand(inputUrl, outputTarget, {
    inputMode,
    env: process.env,
    outputSettings: group.settings,
    managedConfig
  });
  const child = spawn(ffmpegBinary, command, {
    stdio: ["ignore", "pipe", "pipe"]
  });

  // See the playout spawn: an unlistened 'error' event is an uncaught exception.
  child.on("error", (error) => {
    logRuntimeEvent("uplink.process.spawn_failed", {
      binary: ffmpegBinary,
      error: error instanceof Error ? error.message : String(error)
    });
  });

  const startedAt = new Date().toISOString();
  const runtime: UplinkProcessRuntime = {
    key: group.key,
    process: child,
    destinationIds: group.targets.map((entry) => entry.destination.id),
    runtimeTargets: group.targets,
    outputSettings: group.settings,
    startedAt,
    plannedStopReason: "",
    progress: createUplinkProgressState(Date.now()),
    discontinuity: createUplinkDiscontinuityState(Date.now())
  };

  // ffmpeg writes -progress here. It has to be consumed even if nothing watched it: an unread pipe
  // fills and blocks the process, which would manufacture the very stall this is meant to catch.
  child.stdout?.on("data", (chunk: Buffer) => {
    runtime.progress = observeUplinkProgress(runtime.progress, chunk.toString(), Date.now());
  });

  uplinkProcesses = [...uplinkProcesses.filter((entry) => entry.key !== group.key), runtime];
  const runningDestinationIds = getRunningUplinkDestinationIds();

  logRuntimeEvent("uplink.process.start", {
    inputMode,
    inputUrl,
    destinationIds: runtime.destinationIds,
    outputProfile: group.label
  });

  await updatePlayoutRuntime((playout) => ({
    ...playout,
    uplinkStatus: "running",
    uplinkInputMode: inputMode,
    uplinkStartedAt: getRunningUplinkStartedAt() || startedAt,
    uplinkHeartbeatAt: startedAt,
    uplinkDestinationIds: runningDestinationIds,
    uplinkReconnectUntil,
    uplinkLastExitCode: "",
    uplinkLastExitReason: "",
    uplinkLastExitPlanned: false
  }));

  for (const destination of group.targets.map((entry) => entry.destination)) {
    await updateDestinationRecord({
      ...destination,
      status: "ready",
      lastValidatedAt: startedAt,
      // Failures since the last clean start — the counter meant nothing while it only ever grew.
      failureCount: 0,
      lastError: "",
      notes: `${
        destination.role === "backup" ? "Backup" : "Primary"
      } destination is active in the persistent uplink group at ${group.label}.`
    });
  }

  child.stderr?.on("data", (chunk) => {
    const line = redactSecrets(chunk.toString().trim());
    if (!line) {
      return;
    }

    runtime.discontinuity = observeDiscontinuityLine(runtime.discontinuity, line, Date.now());

    logRuntimeEvent("uplink.ffmpeg.stderr", {
      message: line.slice(0, 400)
    });

    const feedInputError = inputMode === "hls" && isLikelyProgramFeedInputError(line);
    if (feedInputError) {
      void upsertIncident({
        scope: "playout",
        severity: "warning",
        title: "Program feed input stalled",
        message: line.slice(0, 400),
        fingerprint: "program-feed.input"
      });
      void updateProgramFeedRuntimeStatus().catch((error) => {
        logRuntimeEvent("program_feed.status.update.failed", {
          error: error instanceof Error ? error.message : String(error)
        });
      });
      return;
    }

    if (line.toLowerCase().includes("error")) {
      void upsertIncident({
        scope: "playout",
        severity: "warning",
        title: "Uplink FFmpeg reported an error",
        message: line.slice(0, 400),
        fingerprint: "uplink.ffmpeg.stderr"
      });
    }

    if (isLikelyDestinationOutputError(line)) {
      const destinationIds = matchDestinationFailuresInLog(line, runtime.runtimeTargets);
      for (const destinationId of destinationIds) {
        void markDestinationFailure(destinationId, line);
      }
    }
  });

  child.on("exit", (code, signal) => {
    const stopReason = runtime.plannedStopReason;
    // A stall we stopped ourselves is still a failure of the channel: counting it as planned would
    // hide it from the unplanned-restart tally that operators watch, and skip the restart.
    const wasPlanned = stopReason !== "" && stopReason !== "destination-stalled" && stopReason !== "encoder-stalled";
    const exitReason = describeFfmpegExit(code, signal ?? null);
    const lastDestinationIds = [...runtime.destinationIds];
    const lastRuntimeTargets = [...runtime.runtimeTargets];
    runtime.plannedStopReason = "";
    uplinkProcesses = uplinkProcesses.filter((entry) => entry !== runtime);
    const remainingDestinationIds = getRunningUplinkDestinationIds();
    const nextStartedAt = getRunningUplinkStartedAt();
    logRuntimeEvent("uplink.process.exit", {
      exitCode: code ?? "",
      exitSignal: signal ?? "",
      exitReason,
      planned: wasPlanned,
      destinationIds: lastDestinationIds,
      outputProfile: group.label
    });

    void updatePlayoutRuntime((playout) => ({
      ...playout,
      uplinkStatus:
        stopReason === "scheduled-reconnect"
          ? "scheduled-reconnect"
          : getRunningUplinkProcesses().length > 0
            ? "running"
            : wasPlanned
              ? "idle"
              : "failed",
      uplinkStartedAt: nextStartedAt,
      uplinkHeartbeatAt: new Date().toISOString(),
      uplinkDestinationIds: remainingDestinationIds.length > 0 ? remainingDestinationIds : lastDestinationIds,
      uplinkRestartCount: playout.uplinkRestartCount + 1,
      uplinkUnplannedRestartCount: playout.uplinkUnplannedRestartCount + (wasPlanned ? 0 : 1),
      uplinkLastExitCode: String(code ?? signal ?? ""),
      uplinkLastExitReason: exitReason,
      uplinkLastExitPlanned: wasPlanned,
      uplinkReconnectUntil
    })).catch((error) => {
      logRuntimeEvent("uplink.runtime.update.failed", {
        error: error instanceof Error ? error.message : String(error)
      });
    });

    if (!wasPlanned) {
      void upsertIncident({
        scope: "playout",
        severity: "warning",
        title: "Persistent uplink restarted",
        message: `Uplink FFmpeg ${exitReason} for ${group.label}. The uplink loop will reconnect independently of program playout.`,
        fingerprint: "uplink.process.exit"
      });

      void (async () => {
        const lastErrorLine = `Uplink FFmpeg ${exitReason}.`;
        if (isLikelyDestinationOutputError(lastErrorLine)) {
          const destinationIds = matchDestinationFailuresInLog(lastErrorLine, lastRuntimeTargets, {
            allowSingleTargetFallback: false
          });
          for (const destinationId of destinationIds) {
            await markDestinationFailure(destinationId, lastErrorLine);
          }
        }
      })();
    }
  });
}

async function runUplinkCycle(): Promise<void> {
  if (!STREAM247_RELAY_ENABLED) {
    await stopAllUplinkProcesses("relay-disabled");
    await updatePlayoutRuntime((playout) => ({
      ...playout,
      uplinkStatus: "idle",
      uplinkStartedAt: "",
      uplinkInputMode: STREAM247_UPLINK_INPUT_MODE,
      uplinkHeartbeatAt: new Date().toISOString(),
      uplinkDestinationIds: []
    }));
    return;
  }

  const state = await readAppState();
  // Same refresh as the playout cycle: this mode is its own process and must not depend on the
  // worker cycle having run to see a managed value.
  latestManagedConfig = state.managedConfig;
  const managedDestinationKeys = await readManagedDestinationStreamKeys(state.destinations.map((entry) => entry.id));
  const activeDestinationGroup = selectDestinationRuntimeTargets({
    destinations: state.destinations,
    managedKeys: managedDestinationKeys,
    env: process.env
  });
  const destinationGroups = groupDestinationRuntimeTargetsByOutputProfile({
    targets: activeDestinationGroup.targets,
    streamOutput: state.output,
    env: process.env
  });
  const destinationIds = activeDestinationGroup.targets.map((entry) => entry.destination.id);
  const now = Date.now();
  const programFeed = isProgramFeedMode() ? await updateProgramFeedRuntimeStatus() : null;

  if (activeDestinationGroup.targets.length === 0 || destinationGroups.length === 0) {
    await stopAllUplinkProcesses("destination-missing");
    await updatePlayoutRuntime((playout) => ({
      ...playout,
      uplinkStatus: "failed",
      uplinkStartedAt: "",
      uplinkInputMode: STREAM247_UPLINK_INPUT_MODE,
      uplinkHeartbeatAt: new Date().toISOString(),
      uplinkDestinationIds: [],
      uplinkReconnectUntil: ""
    }));
    await upsertIncident({
      scope: "playout",
      severity: "warning",
      title: "Persistent uplink destination is not configured",
      message: "Configure at least one enabled output with an RTMP URL and stream key so the uplink can publish from the local relay.",
      fingerprint: "uplink.output.missing"
    });
    return;
  }

  await resolveIncident("uplink.output.missing", "Persistent uplink destination is configured.");
  if (programFeed && getRunningUplinkProcesses().length === 0 && programFeed.status !== "fresh") {
    await updatePlayoutRuntime((playout) => ({
      ...playout,
      uplinkStatus: "waiting-for-feed",
      uplinkStartedAt: "",
      uplinkInputMode: STREAM247_UPLINK_INPUT_MODE,
      uplinkHeartbeatAt: new Date().toISOString(),
      uplinkDestinationIds: destinationIds
    }));
    return;
  }
  if (programFeed?.status === "fresh") {
    await resolveIncident("program-feed.input", "Program feed is fresh.");
  }

  const uplinkReconnect = getPlayoutReconnectRuntimeConfig();
  const reconnectActive = uplinkReconnectUntil !== "" && now < new Date(uplinkReconnectUntil).getTime();
  const reconnectDue =
    !reconnectActive &&
    getRunningUplinkStartedAt() !== "" &&
    now - new Date(getRunningUplinkStartedAt()).getTime() >= uplinkReconnect.intervalMs;

  if (reconnectDue) {
    uplinkReconnectUntil = new Date(now + uplinkReconnect.windowMs).toISOString();
    await stopAllUplinkProcesses("scheduled-reconnect");
    // The only cycle exit that did not already record a heartbeat of its own: the process exit
    // handler writes one, but fire-and-forget, so the healthcheck could see a stale timestamp
    // through a scheduled reconnect. Record it here where the cycle can await it.
    await updatePlayoutRuntime((playout) => ({
      ...playout,
      uplinkHeartbeatAt: new Date().toISOString(),
      uplinkReconnectUntil
    }));
    return;
  }

  if (reconnectActive) {
    await updatePlayoutRuntime((playout) => ({
      ...playout,
      uplinkStatus: "scheduled-reconnect",
      uplinkStartedAt: getRunningUplinkStartedAt(),
      uplinkInputMode: STREAM247_UPLINK_INPUT_MODE,
      uplinkHeartbeatAt: new Date().toISOString(),
      uplinkDestinationIds: destinationIds,
      uplinkReconnectUntil
    }));
    return;
  }

  if (uplinkReconnectUntil !== "") {
    uplinkReconnectUntil = "";
  }

  // The destination-stall check below asks whether the *targets* are healthy. It cannot see an
  // ffmpeg that is alive, holds its connections open and encodes nothing -- which is how this
  // channel lost audio/video sync while every destination still reported "ready". out_time is the
  // one signal that separates the two.
  const uplinkStallOptions = getUplinkStallOptions(process.env, state.managedConfig);
  // When the uplink reads the program feed, a feed that is not fresh is reason enough for out_time
  // to stand still: ffmpeg has nothing to encode. Restarting on that would produce a restart loop
  // for the whole duration of a playout outage, and would not fix anything even once.
  const feedCanSupplyUplink = canBlameUplinkForStall(
    STREAM247_UPLINK_INPUT_MODE,
    state.playout.programFeedStatus
  );
  for (const running of feedCanSupplyUplink ? getRunningUplinkProcesses() : []) {
    const startedAtMs = new Date(running.startedAt).getTime();
    if (!Number.isFinite(startedAtMs)) {
      continue;
    }

    if (hasNeverProgressed(running.progress, now, startedAtMs, uplinkStallOptions)) {
      const runningSeconds = Math.round((now - startedAtMs) / 1000);
      logRuntimeEvent("uplink.encoder.no_progress", {
        outputProfile: running.key,
        destinationIds: running.destinationIds,
        runningSeconds
      });

      // Past the restart threshold no benign explanation is left. This used to be reported and
      // never acted on: the uplink was observed running 65 minutes without encoding a frame, never
      // opening an RTMP connection, logging this line every 15 seconds while the channel was off
      // the air. A restart that does not help is at least visible in the restart tally.
      if (!shouldRestartForNoProgress(running.progress, now, startedAtMs, uplinkStallOptions)) {
        continue;
      }

      logRuntimeEvent("uplink.encoder.no_progress.restart", {
        outputProfile: running.key,
        destinationIds: running.destinationIds,
        runningSeconds
      });
      await upsertIncident({
        scope: "playout",
        severity: "warning",
        title: "Uplink restarted after never encoding a frame",
        message: `The uplink process for ${running.key} has been running for ${runningSeconds}s without encoding anything, so nothing has reached the destination in that time. Restarting it; if this repeats, the program feed itself is likely unreadable rather than the uplink being at fault.`,
        fingerprint: `uplink.no-progress.${running.key}`
      });
      await stopUplinkProcess(running, "encoder-stalled");
      continue;
    }

    if (isDiscontinuityStorm(running.discontinuity, now, startedAtMs, uplinkStallOptions)) {
      logRuntimeEvent("uplink.discontinuity_storm.restart", {
        outputProfile: running.key,
        destinationIds: running.destinationIds,
        eventsInWindow: running.discontinuity.count
      });
      await upsertIncident({
        scope: "playout",
        severity: "warning",
        title: "Uplink restarted after its input timeline came apart",
        message: `The uplink process for ${running.key} reported ${running.discontinuity.count} timestamp discontinuities in a minute. It keeps encoding in this state but corrects audio and video onto separate timelines, which viewers hear as the tracks drifting apart. Reattaching it to the live edge clears the seam.`,
        fingerprint: `uplink.discontinuity-storm.${running.key}`
      });
      await stopUplinkProcess(running, "encoder-stalled");
      continue;
    }

    if (!isUplinkStalled(running.progress, now, startedAtMs, uplinkStallOptions)) {
      continue;
    }

    const stalledSeconds = Math.round((now - running.progress.lastAdvanceAtMs) / 1000);
    logRuntimeEvent("uplink.encoder_stall.restart", {
      outputProfile: running.key,
      destinationIds: running.destinationIds,
      stalledSeconds,
      thresholdSeconds: Math.round(uplinkStallOptions.stallMs / 1000)
    });
    await upsertIncident({
      scope: "playout",
      severity: "warning",
      title: "Uplink restarted after it stopped encoding",
      message: `The uplink process for ${running.key} is still running but has not advanced its output timestamp for ${stalledSeconds}s. Restarting it so the channel does not keep an open but silent connection.`,
      fingerprint: `uplink.encoder-stall.${running.key}`
    });
    await stopUplinkProcess(running, "encoder-stalled");
  }

  for (const running of getRunningUplinkProcesses()) {
    const runningDestinationStatuses = running.destinationIds
      .map((id) => state.destinations.find((destination) => destination.id === id)?.status ?? "")
      .filter((status) => status !== "");
    const stallDecision = evaluateUplinkDestinationStall({
      destinationStatuses: runningDestinationStatuses,
      stallStartedAt: uplinkDestinationStallStartedAt.get(running.key),
      nowMs: now,
      thresholdSeconds: UPLINK_DESTINATION_STALL_RESTART_SECONDS
    });
    if (stallDecision.decision === "clear") {
      uplinkDestinationStallStartedAt.delete(running.key);
      continue;
    }
    if (stallDecision.decision === "wait") {
      uplinkDestinationStallStartedAt.set(running.key, stallDecision.nextStallStartedAt);
      continue;
    }
    uplinkDestinationStallStartedAt.delete(running.key);
    logRuntimeEvent("uplink.destination_stall.restart", {
      destinationIds: running.destinationIds,
      outputProfile: running.key,
      stallSeconds: stallDecision.stallSeconds,
      thresholdSeconds: UPLINK_DESTINATION_STALL_RESTART_SECONDS
    });
    await upsertIncident({
      scope: "playout",
      severity: "warning",
      title: "Uplink restarted after every destination stalled",
      message: `All destinations for ${running.key} have been in error state for ${stallDecision.stallSeconds}s. Restarting the uplink so the fifo muxer reopens the destination connection from a clean slate.`,
      fingerprint: `uplink.destination-stall.${running.key}`
    });
    await stopUplinkProcess(running, "destination-stalled");
  }

  for (const running of getRunningUplinkProcesses()) {
    if (!destinationGroups.some((group) => isMatchingRunningUplinkGroup(group) && running.key === group.key)) {
      await stopUplinkProcess(running, "destination-change");
    }
  }

  for (const group of destinationGroups) {
    const existing = findRunningUplinkProcessByKey(group.key);
    if (existing && !isMatchingRunningUplinkGroup(group)) {
      await stopUplinkProcess(existing, "destination-change");
    }

    if (!isMatchingRunningUplinkGroup(group)) {
      await startUplink(group, state.managedConfig);
    }
  }

  const runningDestinationIds = getRunningUplinkDestinationIds();
  const runningStartedAt = getRunningUplinkStartedAt();
  await updatePlayoutRuntime((playout) => ({
    ...playout,
    uplinkStatus: "running",
    uplinkStartedAt: runningStartedAt,
    uplinkInputMode: STREAM247_UPLINK_INPUT_MODE,
    uplinkHeartbeatAt: new Date().toISOString(),
    uplinkDestinationIds: runningDestinationIds.length > 0 ? runningDestinationIds : destinationIds,
    uplinkReconnectUntil
  }));
}

// One alert per condition per half hour; the key is the text with its numbers blanked, so a
// message that carries a changing percentage or status still counts as the same condition.
const alertDeduper = new AlertDeduper(30 * 60_000);

async function sendAlert(subject: string, message: string): Promise<void> {
  const key = `${subject}|${message.replace(/\d+/g, "#")}`;
  if (!alertDeduper.shouldSend(key, Date.now())) {
    return;
  }
  const state = await readAppState();
  const smtp = getSmtpConfig(state);
  const report = await deliverAlert({
    subject,
    message,
    discordWebhookUrl: getDiscordWebhookUrl(state),
    smtp,
    fetchImpl: fetch,
    createTransport: (settings) =>
      nodemailer.createTransport({
        host: settings.host,
        port: settings.port,
        secure: settings.port === 465,
        auth: settings.user ? { user: settings.user, pass: settings.password || "" } : undefined
      })
  });
  logRuntimeEvent("alert.delivery", { subject, discord: report.discord, email: report.email, delivered: report.delivered });

  const failures = (["discord", "email"] as const)
    .map((channel) => ({ channel, report: report[channel] }))
    .filter((entry): entry is { channel: "discord" | "email"; report: { outcome: "failed"; detail: string } } => entry.report.outcome === "failed");
  try {
    if (failures.length > 0) {
      await upsertIncident({
        scope: "system",
        severity: "warning",
        title: "Alerts are not reaching a channel",
        message: failures.map((entry) => `${entry.channel}: ${entry.report.detail}`).join(" · "),
        fingerprint: "alerts.delivery"
      });
    } else if (report.delivered) {
      await resolveIncident("alerts.delivery", "Alert delivery is working again.");
    }
    if (report.discord.outcome === "unconfigured" && report.email.outcome === "unconfigured") {
      await upsertIncident({
        scope: "system",
        severity: "info",
        title: "No alert channel is configured",
        message: `An alert was raised ("${subject}") but neither a Discord webhook nor SMTP is set up, so nobody was told.`,
        fingerprint: "alerts.unconfigured"
      });
    } else {
      await resolveIncident("alerts.unconfigured", "An alert channel is configured.");
    }
  } catch {
    // Recording the delivery outcome must never take the worker loop down with it.
  }
  // A failed delivery is not "sent": let the next cycle try the same condition again.
  if (!report.delivered) {
    alertDeduper.forget(key);
  }
}

async function syncTwitchSchedule(args: {
  state: AppState;
  accessToken: string;
  // Passed explicitly rather than read from the connection state: with a broadcast-channel split
  // the schedule belongs to the broadcaster connection's channel, not the identity's, and the
  // token must match the channel the segments are written to.
  broadcasterId: string;
  timeZone: string;
  clientId: string;
  categoryCache: Map<string, { id: string; name: string } | null>;
}): Promise<void> {
  const syncEveryMs = 15 * 60_000;
  const currentDate = getCurrentScheduleMoment({
    now: new Date(),
    timeZone: args.timeZone
  }).date;

  const desiredOccurrences = Array.from({ length: 7 }, (_, offset) =>
    buildScheduleOccurrences({
      date: addDaysToDateString(currentDate, offset),
      blocks: args.state.scheduleBlocks
    })
  )
    .flat()
    .filter((occurrence) => {
      const startIso = toUtcIsoForLocalDateTime({
        date: occurrence.date,
        minuteOfDay: occurrence.startMinuteOfDay,
        timeZone: args.timeZone
      });
      return new Date(startIso).getTime() > Date.now() + 5 * 60_000;
    });

  const desiredKeys = desiredOccurrences.map((occurrence) => occurrence.key).sort();
  const currentKeys = args.state.twitchScheduleSegments.map((segment) => segment.key).sort();
  const sameKeys =
    desiredKeys.length === currentKeys.length && desiredKeys.every((entry, index) => entry === currentKeys[index]);
  const lastScheduleSyncAt = args.state.twitch.lastScheduleSyncAt ? new Date(args.state.twitch.lastScheduleSyncAt).getTime() : 0;
  if (sameKeys && lastScheduleSyncAt > 0 && Date.now() - lastScheduleSyncAt < syncEveryMs) {
    return;
  }

  const existingSegmentsByKey = new Map(args.state.twitchScheduleSegments.map((segment) => [segment.key, segment]));
  const nextSegments: AppState["twitchScheduleSegments"] = [];
  let skippedCount = 0;

  for (const occurrence of desiredOccurrences) {
    if (occurrence.durationMinutes < 30 || occurrence.durationMinutes > 1380) {
      skippedCount += 1;
      continue;
    }

    const startTime = toUtcIsoForLocalDateTime({
      date: occurrence.date,
      minuteOfDay: occurrence.startMinuteOfDay,
      timeZone: args.timeZone
    });

    let category = args.categoryCache.get(occurrence.categoryName) ?? null;
    if (category === null && !args.categoryCache.has(occurrence.categoryName)) {
      category = await resolveTwitchCategory({
        accessToken: args.accessToken,
        categoryName: occurrence.categoryName,
        clientId: args.clientId
      });
      args.categoryCache.set(occurrence.categoryName, category);
    }

    const existingSegment = existingSegmentsByKey.get(occurrence.key);
    const requestBody: Record<string, string | number | boolean> = {
      start_time: startTime,
      timezone: args.timeZone,
      is_recurring: false,
      duration: occurrence.durationMinutes,
      title: occurrence.title.slice(0, 140)
    };

    if (category?.id) {
      requestBody.category_id = category.id;
    }

    const endpoint = existingSegment
      ? `https://api.twitch.tv/helix/schedule/segment?broadcaster_id=${encodeURIComponent(
          args.broadcasterId
        )}&id=${encodeURIComponent(existingSegment.segmentId)}`
      : `https://api.twitch.tv/helix/schedule/segment?broadcaster_id=${encodeURIComponent(args.broadcasterId)}`;

    const response = await fetch(endpoint, {
      method: existingSegment ? "PATCH" : "POST",
      headers: {
        Authorization: `Bearer ${args.accessToken}`,
        "Client-Id": args.clientId,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      if (response.status === 403) {
        throw new Error("Twitch schedule sync requires the broadcaster to be an affiliate or partner for non-recurring segments.");
      }

      throw new Error(`Twitch schedule segment sync failed with status ${response.status}.`);
    }

    const payload = (await response.json()) as {
      data?: {
        segments?: Array<{ id?: string; start_time?: string; title?: string }>;
      };
    };
    const segment = payload.data?.segments?.[0];
    if (!segment?.id) {
      throw new Error("Twitch schedule sync did not return a segment id.");
    }

    nextSegments.push({
      key: occurrence.key,
      segmentId: segment.id,
      blockId: occurrence.blockId,
      startTime: segment.start_time || startTime,
      title: segment.title || occurrence.title,
      syncedAt: new Date().toISOString()
    });
  }

  for (const staleSegment of args.state.twitchScheduleSegments) {
    if (desiredKeys.includes(staleSegment.key)) {
      continue;
    }

    await fetch(
      `https://api.twitch.tv/helix/schedule/segment?broadcaster_id=${encodeURIComponent(
        args.broadcasterId
      )}&id=${encodeURIComponent(staleSegment.segmentId)}`,
      {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${args.accessToken}`,
          "Client-Id": args.clientId
        }
      }
    );
  }

  await replaceTwitchScheduleSegments(nextSegments);
  await updateTwitchConnectionRecord({
    ...args.state.twitch,
    lastScheduleSyncAt: new Date().toISOString(),
    error: ""
  });

  if (skippedCount > 0) {
    await upsertIncident({
      scope: "twitch",
      severity: "warning",
      title: "Some schedule blocks could not be synced to Twitch",
      message: `${skippedCount} schedule block(s) were skipped because Twitch requires a duration between 30 and 1380 minutes.`,
      fingerprint: "twitch.schedule.duration.skipped"
    });
  } else {
    await resolveIncident("twitch.schedule.duration.skipped", "All schedule blocks fit Twitch schedule duration limits.");
  }
}

/**
 * Puts the connection status back on measurement when the record says broken but the token is not.
 *
 * Runs before reconcileTwitch on purpose: that function returns immediately unless the status is
 * connected, and so do the moderation sync, the schedule sync and the event registration behind
 * it. A record wrongly stuck on error therefore switches three features off and keeps them off,
 * with no path back that does not involve a second trip through OAuth — which is a lot to ask of
 * an operator whose token was fine the whole time.
 *
 * Deliberately narrow. It only ever moves error to connected, never the other way: deciding that a
 * connection is broken stays with the code that actually tried to use it. Everything about the
 * record other than the status and the stale error text is left exactly as it was, so the healed
 * connection carries the same token, the same account and the same sync history it always had.
 */
async function healTwitchConnection(): Promise<void> {
  const state = await readAppState();
  const decision = decideTwitchConnectionHeal({
    status: state.twitch.status,
    accessToken: state.twitch.accessToken,
    lastAttemptAt: twitchConnectionHealLastAttemptAt,
    now: Date.now()
  });

  if (!decision.attempt) {
    return;
  }

  twitchConnectionHealLastAttemptAt = Date.now();
  const verdict = await validateTwitchAccessToken(state.twitch.accessToken);

  if (!verdict.healthy) {
    // Logged rather than acted on. A rejected token means the error status was right all along,
    // a short grant means only a reconnect will do, and an unreachable Twitch means we learned
    // nothing — none of the three is a reason to write anything to the record.
    logRuntimeEvent("twitch.connection.heal.declined", {
      reason: verdict.reason,
      ...(verdict.reason === "rejected" ? { status: verdict.status } : {}),
      ...(verdict.reason === "missing-scopes" ? { missingScopes: verdict.missingScopes.join(" ") } : {}),
      ...(verdict.reason === "unreachable" ? { error: verdict.message } : {})
    });
    return;
  }

  await updateTwitchConnectionRecord({
    ...state.twitch,
    status: "connected",
    error: ""
  });

  await appendAuditEvent(
    "twitch.connected",
    `Restored the Twitch connection for ${verdict.login || state.twitch.broadcasterLogin} after the stored access still checked out.`
  );
  logRuntimeEvent("twitch.connection.heal.restored", { login: verdict.login, userId: verdict.userId });
}

async function reconcileTwitch(): Promise<void> {
  const state = await readAppState();
  if (state.twitch.status !== "connected" || !state.twitch.accessToken || !state.twitch.broadcasterId) {
    return;
  }

  // Refreshed before the early return below, not after it. The stored token is what the chat bridge
  // authenticates with on every sync, and that sync runs whether or not anything is scheduled. With
  // the refresh sitting behind "is something playing", a channel with an empty programme let its
  // token expire and then could not reconnect to chat — the one part of the product that is
  // supposed to keep working while nothing is on air.
  const expiresAt = state.twitch.tokenExpiresAt ? new Date(state.twitch.tokenExpiresAt).getTime() : 0;
  let twitchAccessToken = state.twitch.accessToken;
  const twitchClientId = getTwitchClientId(state);
  if (expiresAt > 0 && expiresAt - Date.now() < 5 * 60_000) {
    twitchAccessToken = await refreshIdentityAccessToken();
  }

  const currentScheduleItem = getCurrentScheduleItem(state);
  const currentAsset = state.assets.find((asset) => asset.id === state.playout.currentAssetId) ?? null;
  if (!currentScheduleItem && !currentAsset) {
    return;
  }

  // The chapter on air right now, derived from elapsed playback rather than from boundary
  // events. That makes the sync level-based: every cycle asks "what should the channel say at
  // this second", which applies a crossed boundary within one cycle and also lets a broadcaster
  // account connected mid-video catch up on the next cycle without any replayed events.
  const currentChapter =
    currentAsset && state.playout.currentAssetId === currentAsset.id && state.playout.processStartedAt !== ""
      ? getAssetChapterAt(
          parseAssetChaptersJson(currentAsset.chaptersJson),
          Math.max(0, Math.floor((Date.now() - new Date(state.playout.processStartedAt).getTime()) / 1000))
        )
      : null;
  // The chapter title replaces the asset title inside the usual composition, so the replay
  // prefix and hashtags still apply; an empty chapter title falls back to the asset title.
  const metadataAsset =
    currentAsset && currentChapter?.title ? { ...currentAsset, title: currentChapter.title } : currentAsset;
  const desiredTitle = metadataAsset
    ? buildTwitchMetadataTitle(metadataAsset, currentScheduleItem?.title || state.playout.currentTitle)
    : currentScheduleItem?.title || state.playout.currentTitle;
  let desiredCategoryId = getTwitchDefaultCategoryId(state);
  const desiredCategoryCandidate =
    currentChapter?.categoryName || currentAsset?.categoryName || currentScheduleItem?.categoryName || "";
  let desiredCategoryName = desiredCategoryCandidate;
  const categoryCache = new Map<string, { id: string; name: string } | null>();
  const presenceStatus = describePresenceStatus({
    activeWindows: state.presenceWindows.map((window) => ({
      actor: window.actor,
      minutes: window.minutes,
      createdAt: new Date(window.createdAt),
      expiresAt: new Date(window.expiresAt)
    })),
    now: new Date(),
    fallbackEmoteOnly: state.moderation.fallbackEmoteOnly,
    enabled: state.moderation.enabled
  });
  const metadataSyncGate = resolveTwitchMetadataSyncGate({
    configuredLogin: getTwitchBroadcastChannelLogin(state),
    identityLogin: state.twitch.broadcasterLogin,
    broadcasterConnection: state.twitchBroadcaster
  });

  // The broadcaster slot's token ages exactly like the identity's, so it gets the same
  // treatment: refreshed ahead of expiry rather than only after a 401, and rebindable by the
  // 401 retry below. Only relevant in broadcaster mode — while waiting there is no token, and
  // without a split the identity token carries the writes.
  let broadcasterSlotAccessToken = state.twitchBroadcaster.accessToken;
  if (metadataSyncGate.mode === "broadcaster") {
    const slotExpiresAt = state.twitchBroadcaster.tokenExpiresAt
      ? new Date(state.twitchBroadcaster.tokenExpiresAt).getTime()
      : 0;
    if (slotExpiresAt > 0 && slotExpiresAt - Date.now() < 5 * 60_000) {
      broadcasterSlotAccessToken = await refreshBroadcasterSlotAccessToken();
    }
  }

  const sync = async (accessToken: string) => {
    let channelWriteThrottled = false;

    if (metadataSyncGate.mode === "waiting-for-broadcaster") {
      // The identity token could write title and category — but only to the identity's own
      // channel, which is the wrong-channel failure this gate exists to end. Until the broadcaster
      // account is connected the sync waits visibly instead of writing somewhere wrong. The wait
      // sits before the category lookup on purpose: resolving categories for a write that cannot
      // happen would spend rate limit on nothing. Emote-only below is unaffected — it is a
      // moderator action and needs no broadcaster token.
      await upsertIncident({
        scope: "twitch",
        severity: "info",
        title: "Twitch metadata sync is waiting for the broadcast channel connection",
        message: `${TWITCH_METADATA_WAITING_MESSAGE} Title and category for ${metadataSyncGate.broadcastChannelLogin} stay untouched until the broadcaster account is connected.`,
        fingerprint: "twitch.metadata.waiting-for-broadcaster"
      });
    } else {
      await resolveIncident(
        "twitch.metadata.waiting-for-broadcaster",
        "Twitch metadata sync has a channel it may write to."
      );

      // With a broadcaster connection the writes carry its token and target its channel; without
      // a split they carry the identity's, which is the pre-split behaviour unchanged.
      const metadataBroadcasterId =
        metadataSyncGate.mode === "broadcaster" ? state.twitchBroadcaster.broadcasterId : state.twitch.broadcasterId;
      const metadataAccessToken =
        metadataSyncGate.mode === "broadcaster" ? broadcasterSlotAccessToken : accessToken;

      const resolvedCategory = await resolveTwitchCategory({
        accessToken,
        categoryName: desiredCategoryCandidate,
        clientId: twitchClientId
      });

      if (resolvedCategory) {
        desiredCategoryId = resolvedCategory.id;
        desiredCategoryName = resolvedCategory.name;
        await resolveIncident(
          "twitch.category.lookup.failed",
          `Resolved Twitch category ${resolvedCategory.name} for the current playout item ${desiredTitle}.`
        );
      } else if (!desiredCategoryId) {
        await upsertIncident({
          scope: "twitch",
          severity: "warning",
          title: "Twitch category lookup failed",
          message: `Could not resolve a Twitch category id for "${desiredCategoryCandidate || "unknown"}". Title sync still continues.`,
          fingerprint: "twitch.category.lookup.failed"
        });
      } else {
        await resolveIncident(
          "twitch.category.lookup.failed",
          `Using default Twitch category for the current playout item ${desiredTitle}.`
        );
      }

      // One decision point in front of the channel PATCH: gate, skip-if-unchanged, and the
      // 30-second write throttle that chapter boundaries made necessary. See twitch-sync-policy.
      const writeDecision = decideTwitchChannelMetadataWrite({
        gateMode: metadataSyncGate.mode,
        desiredTitle,
        desiredCategoryId,
        lastSyncedTitle: state.twitch.lastSyncedTitle,
        lastSyncedCategoryId: state.twitch.lastSyncedCategoryId,
        lastWriteAtMs: lastChannelMetadataWriteAtMs,
        nowMs: Date.now()
      });
      channelWriteThrottled = !writeDecision.write && writeDecision.reason === "throttled";

      if (writeDecision.write) {
        const channelBody: Record<string, string> = { title: desiredTitle };
        if (desiredCategoryId) {
          channelBody.game_id = desiredCategoryId;
        }

        const channelResponse = await fetch(
          `https://api.twitch.tv/helix/channels?broadcaster_id=${encodeURIComponent(metadataBroadcasterId)}`,
          {
            method: "PATCH",
            headers: {
              Authorization: `Bearer ${metadataAccessToken}`,
              "Client-Id": twitchClientId,
              "Content-Type": "application/json"
            },
            body: JSON.stringify(channelBody)
          }
        );

        if (!channelResponse.ok) {
          throw new Error(`Channel metadata sync failed with status ${channelResponse.status}.`);
        }

        lastChannelMetadataWriteAtMs = Date.now();
      }
    }

    // Emote-only is a moderator action, not a broadcaster one: Helix chat-settings accepts
    // broadcaster_id=<channel> with moderator_id=<caller> for any caller who moderates there. So
    // unlike title and category this write does not have to wait for a broadcaster connection —
    // it targets the broadcast channel directly, whose id is looked up by login and cached for
    // the process lifetime. Without a split both ids collapse to the identity, as before.
    const broadcastChannelLogin = resolveBroadcastChannelLogin({
      configuredLogin: getTwitchBroadcastChannelLogin(state),
      identityLogin: state.twitch.broadcasterLogin
    });
    const chatSettingsBroadcasterId = isBroadcastChannelSplit({
      configuredLogin: getTwitchBroadcastChannelLogin(state),
      identityLogin: state.twitch.broadcasterLogin
    })
      ? await twitchUserIdResolver.resolve({
          login: broadcastChannelLogin,
          accessToken,
          clientId: twitchClientId
        })
      : state.twitch.broadcasterId;

    // Decided, not repeated: a switched-off policy leaves Twitch alone, an unchanged mode is not
    // rewritten every 30 s, and a hand change on Twitch is re-asserted at most every ten minutes.
    const desiredEmoteOnly = presenceStatus.chatMode === "emote-only";
    const chatSettingsDecision = resolveChatSettingsWrite({
      moderationEnabled: state.moderation.enabled,
      desiredEmoteOnly,
      lastWrittenEmoteOnly: lastChatSettingsWrite.emoteOnly,
      lastWriteAtMs: lastChatSettingsWrite.atMs,
      nowMs: Date.now(),
      reassertIntervalMs: CHAT_SETTINGS_REASSERT_INTERVAL_MS
    });
    if (chatSettingsDecision.write) {
      const chatResponse = await fetch(
        `https://api.twitch.tv/helix/chat/settings?broadcaster_id=${encodeURIComponent(
          chatSettingsBroadcasterId
        )}&moderator_id=${encodeURIComponent(state.twitch.broadcasterId)}`,
        {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Client-Id": twitchClientId,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ emote_mode: desiredEmoteOnly })
        }
      );

      if (!chatResponse.ok) {
        // Forget the last write so the next cycle tries again rather than believing it stuck.
        lastChatSettingsWrite = { emoteOnly: null, atMs: 0 };
        throw new Error(`Chat settings sync failed with status ${chatResponse.status}.`);
      }
      lastChatSettingsWrite = { emoteOnly: desiredEmoteOnly, atMs: Date.now() };
      // The one line that says what Stream247 did to the channel's chat mode, and why.
      logRuntimeEvent("twitch.chat_settings.written", {
        emoteOnly: desiredEmoteOnly,
        reason: chatSettingsDecision.reason,
        broadcasterId: chatSettingsBroadcasterId
      });
    }

    // Recorded only when metadata actually synced. Booking a "last synced" title while waiting
    // would make the dashboard claim a sync that never reached any channel. A throttled write is
    // the same lie one step smaller, so its last-synced values stay untouched too — that is also
    // what makes the next cycle still see the difference and retry after the interval.
    if (metadataSyncGate.mode !== "waiting-for-broadcaster") {
      await updateTwitchConnectionRecord({
        ...state.twitch,
        status: "connected",
        lastMetadataSyncAt: new Date().toISOString(),
        lastSyncedTitle: channelWriteThrottled ? state.twitch.lastSyncedTitle : desiredTitle,
        lastSyncedCategoryName: channelWriteThrottled ? state.twitch.lastSyncedCategoryName : desiredCategoryName,
        lastSyncedCategoryId: channelWriteThrottled ? state.twitch.lastSyncedCategoryId : desiredCategoryId,
        error: ""
      });
    }
  };

  const syncScheduleIfEnabled = async (accessToken: string, syncState: AppState, successMessage: string): Promise<void> => {
    if (!resolveTwitchScheduleSyncEnabled(syncState.managedConfig, process.env)) {
      await resolveIncident("twitch.schedule.sync.failed", "Twitch schedule sync is disabled by configuration.");
      return;
    }

    // Same gate as title and category: schedule segments are broadcaster-owned writes, and the
    // waiting incident from sync() already names the state, so this only has to not write.
    if (metadataSyncGate.mode === "waiting-for-broadcaster") {
      await resolveIncident("twitch.schedule.sync.failed", TWITCH_METADATA_WAITING_MESSAGE);
      return;
    }

    await syncTwitchSchedule({
      state: syncState,
      // Both sides of the M51/M52 merge belong here: the token and broadcaster id follow the
      // metadata gate (identity vs. broadcaster connection), and the timezone follows managed
      // config rather than the env.
      accessToken: metadataSyncGate.mode === "broadcaster" ? syncState.twitchBroadcaster.accessToken : accessToken,
      broadcasterId:
        metadataSyncGate.mode === "broadcaster" ? syncState.twitchBroadcaster.broadcasterId : syncState.twitch.broadcasterId,
      timeZone: resolveChannelTimeZone(syncState.managedConfig),
      clientId: twitchClientId,
      categoryCache
    });
    await resolveIncident("twitch.schedule.sync.failed", successMessage);
  };

  try {
    await sync(twitchAccessToken);
    await resolveIncident("twitch.reconcile.failed", "Twitch reconciliation succeeded.");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Twitch reconciliation error.";
    if (message.includes("401")) {
      try {
        // The message does not say which token 401'd, and in broadcaster mode a sync uses both:
        // the identity's for the category lookup and chat settings, the slot's for the channel
        // PATCH. Refreshing both before the single retry keeps the recovery one round instead of
        // burning the retry on the token that was still fine.
        twitchAccessToken = await refreshIdentityAccessToken();
        if (metadataSyncGate.mode === "broadcaster") {
          broadcasterSlotAccessToken = await refreshBroadcasterSlotAccessToken();
        }
        await sync(twitchAccessToken);
        await resolveIncident("twitch.reconcile.failed", "Twitch reconciliation succeeded after token refresh.");
      } catch (refreshError) {
        const refreshMessage = refreshError instanceof Error ? refreshError.message : "Unknown Twitch refresh failure.";
        await upsertIncident({
          scope: "twitch",
          severity: "critical",
          title: "Twitch token refresh failed",
          message: refreshMessage,
          fingerprint: "twitch.refresh.failed"
        });
        await upsertIncident({
          scope: "twitch",
          severity: "warning",
          title: "Twitch reconciliation failed",
          message: refreshMessage,
          fingerprint: "twitch.reconcile.failed"
        });
        await sendAlert("Twitch reconciliation warning", refreshMessage);
        return;
      }
    } else {
      await upsertIncident({
        scope: "twitch",
        severity: "warning",
        title: "Twitch reconciliation failed",
        message,
        fingerprint: "twitch.reconcile.failed"
      });
      await sendAlert("Twitch reconciliation warning", message);
      return;
    }
  }

  try {
    await syncScheduleIfEnabled(twitchAccessToken, await readAppState(), "Twitch schedule synchronization succeeded.");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Twitch schedule synchronization error.";
    if (message.includes("401")) {
      try {
        // Same both-tokens rule as the metadata retry above. The schedule sync re-reads state,
        // so the slot refresh only has to persist the new token for the retry to pick it up.
        twitchAccessToken = await refreshIdentityAccessToken();
        if (metadataSyncGate.mode === "broadcaster") {
          await refreshBroadcasterSlotAccessToken();
        }
        await syncScheduleIfEnabled(
          twitchAccessToken,
          await readAppState(),
          "Twitch schedule synchronization succeeded after token refresh."
        );
        return;
      } catch (refreshError) {
        const refreshMessage =
          refreshError instanceof Error ? refreshError.message : "Unknown Twitch schedule refresh failure.";
        await upsertIncident({
          scope: "twitch",
          severity: "critical",
          title: "Twitch token refresh failed",
          message: refreshMessage,
          fingerprint: "twitch.refresh.failed"
        });
        await upsertIncident({
          scope: "twitch",
          severity: "warning",
          title: "Twitch schedule synchronization failed",
          message: refreshMessage,
          fingerprint: "twitch.schedule.sync.failed"
        });
        await sendAlert("Twitch schedule sync warning", refreshMessage);
        return;
      }
    }

    await upsertIncident({
      scope: "twitch",
      severity: "warning",
      title: "Twitch schedule synchronization failed",
      message,
      fingerprint: "twitch.schedule.sync.failed"
    });
    await sendAlert("Twitch schedule sync warning", message);
  }
}

async function reconcileTwitchLiveStatus(): Promise<void> {
  const state = await readAppState();
  const clientId = getTwitchClientId(state);
  const clientSecret = getTwitchClientSecret(state);
  const broadcasterId = state.twitch.broadcasterId.trim();
  // The poll asks about the broadcast channel, not the connected account: those differ when the
  // stream key sends video to a channel the identity merely moderates, and the widget would
  // otherwise report the moderator's own (empty) channel as the live status. Part of the sync key
  // so a settings change re-polls immediately instead of serving the old channel for a minute.
  const broadcastChannelLogin = resolveBroadcastChannelLogin({
    configuredLogin: getTwitchBroadcastChannelLogin(state),
    identityLogin: state.twitch.broadcasterLogin
  });
  const usesBroadcastChannelLogin = isBroadcastChannelSplit({
    configuredLogin: getTwitchBroadcastChannelLogin(state),
    identityLogin: state.twitch.broadcasterLogin
  });
  const syncKey = [state.twitch.status, broadcasterId, broadcastChannelLogin, clientId, clientSecret].join("|");
  const now = Date.now();

  if (syncKey === twitchLiveStatusLastSyncKey && now < twitchLiveStatusNextSyncAt) {
    return;
  }

  twitchLiveStatusLastSyncKey = syncKey;
  twitchLiveStatusNextSyncAt = now + TWITCH_LIVE_STATUS_SYNC_INTERVAL_MS;

  if (state.twitch.status !== "connected" || !broadcasterId || !clientId || !clientSecret) {
    if (state.twitch.liveStatus !== "unknown" || state.twitch.viewerCount !== 0 || state.twitch.startedAt) {
      await updateTwitchConnectionRecord({
        ...state.twitch,
        liveStatus: "unknown",
        viewerCount: 0,
        startedAt: ""
      });
    }
    return;
  }

  try {
    const snapshot = await fetchTwitchLiveStatus(
      usesBroadcastChannelLogin
        ? { broadcasterLogin: broadcastChannelLogin, clientId, clientSecret }
        : { broadcasterId, clientId, clientSecret }
    );

    if (
      state.twitch.liveStatus === snapshot.liveStatus &&
      state.twitch.viewerCount === snapshot.viewerCount &&
      (state.twitch.startedAt || "") === snapshot.startedAt
    ) {
      return;
    }

    await updateTwitchConnectionRecord({
      ...state.twitch,
      liveStatus: snapshot.liveStatus,
      viewerCount: snapshot.viewerCount,
      startedAt: snapshot.startedAt
    });
  } catch (error) {
    if (state.twitch.liveStatus !== "unknown" || state.twitch.viewerCount !== 0 || state.twitch.startedAt) {
      await updateTwitchConnectionRecord({
        ...state.twitch,
        liveStatus: "unknown",
        viewerCount: 0,
        startedAt: ""
      });
    }

    logRuntimeEvent("twitch.live-status.sync.failed", {
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

async function reconcileTwitchEventSub(): Promise<void> {
  const state = await readAppState();
  const clientId = getTwitchClientId(state);
  const clientSecret = getTwitchClientSecret(state);
  const syncKey = [
    state.engagement.alertsEnabled ? "alerts-on" : "alerts-off",
    resolveAlertsRuntimeEnabled(state.managedConfig, process.env) ? "runtime-on" : "runtime-off",
    state.twitch.status,
    state.twitch.broadcasterId,
    clientId,
    resolveAppBaseUrl(state.managedConfig),
    resolveTwitchEventSubSecret(state.managedConfig, process.env) ? "secret-set" : "secret-missing"
  ].join("|");
  const now = Date.now();
  if (syncKey === twitchEventSubLastSyncKey && now < twitchEventSubNextSyncAt) {
    return;
  }

  twitchEventSubLastSyncKey = syncKey;
  twitchEventSubNextSyncAt = now + TWITCH_EVENTSUB_SYNC_INTERVAL_MS;

  try {
    const result = await syncTwitchEventSubSubscriptions({
      state,
      env: process.env,
      clientId,
      clientSecret
    });

    if (result.status === "skipped") {
      if (result.enabled) {
        await upsertIncident({
          scope: "twitch",
          severity: "warning",
          title: "Twitch EventSub registration skipped",
          message: `EventSub alerts are enabled, but registration skipped: ${result.reason || "unknown reason"}.`,
          fingerprint: "twitch.eventsub.sync.skipped"
        });
      } else {
        await resolveIncident("twitch.eventsub.sync.failed", "Twitch EventSub alerts are disabled.");
        await resolveIncident("twitch.eventsub.sync.skipped", "Twitch EventSub alerts are disabled.");
      }
      return;
    }

    await resolveIncident("twitch.eventsub.sync.failed", "Twitch EventSub synchronization succeeded.");
    await resolveIncident("twitch.eventsub.sync.skipped", "Twitch EventSub configuration is complete.");
    if (result.created.length > 0 || result.deleted.length > 0) {
      await appendAuditEvent(
        "twitch.eventsub.sync",
        `EventSub ${result.status}; created=${result.created.join(",") || "none"} deleted=${result.deleted.length}.`
      );
    }
  } catch (error) {
    twitchEventSubNextSyncAt = Date.now() + 2 * 60_000;
    const message = error instanceof Error ? error.message : "Unknown Twitch EventSub sync error.";
    await upsertIncident({
      scope: "twitch",
      severity: "warning",
      title: "Twitch EventSub synchronization failed",
      message,
      fingerprint: "twitch.eventsub.sync.failed"
    });
  }
}

async function reconcileEngagementGame(): Promise<void> {
  const state = await readAppState();
  const snapshot = engagementGameTracker.getSnapshot(state.engagement, new Date());
  if (!engagementGameTracker.isSnapshotChanged(snapshot)) {
    return;
  }

  await updateEngagementGameRuntimeRecord(snapshot);
}

// Tracks which asset the last vote was opened against, so a poll is opened once per programme
// item rather than every cycle.
let lastVotedAssetId = "";
// How long a chat-skipped item is held out of selection, matching the operator skip default.
const CHAT_SKIP_HOLD_MINUTES = 60;

/**
 * Drives the viewer vote from the worker cycle.
 *
 * The poll opens shortly after an item goes on air and settles well before the boundary, so the
 * result is visible to viewers before it takes effect. Candidates come from the upcoming queue, so
 * a vote can only ever reorder what was already scheduled to play -- chat steers the programme, it
 * does not bypass it.
 *
 * The tally lives in the ChatControlRuntime and is flushed here only when it changed, because
 * state writes serialise on a global lock and a busy poll would otherwise hammer it.
 */
/**
 * Applies the effects the IRC handler could only record: a passed skip vote and viewer requests.
 *
 * Requests are resolved against assets explicitly released for viewer requests, with the requester's
 * cooldown and the outstanding-request cap enforced. A rejection is recorded with its reason rather
 * than dropped, so an operator can see why chat did not get what it asked for.
 */
async function drainChatEffects(state: AppState, config: ChatInteractionConfig): Promise<void> {
  const effects = pendingChatEffects.splice(0, pendingChatEffects.length);
  if (effects.length === 0) {
    return;
  }

  for (const effect of effects) {
    if (effect.kind === "skip-passed") {
      const now = new Date().toISOString();
      logRuntimeEvent("chat.skip.applied", { assetId: effect.assetId });
      await appendAuditEvent("chat.skip", "Chat voted to skip the current item.");
      // Exactly what the operator skip does (lib/server/broadcast.ts): hold the asset out of
      // selection for a while and restart playout, rather than inventing a second skip path that
      // could drift from it.
      await updatePlayoutRuntime((playout) => ({
        ...playout,
        status: "recovering",
        restartRequestedAt: now,
        heartbeatAt: now,
        skipAssetId: effect.assetId,
        skipUntil: new Date(Date.now() + CHAT_SKIP_HOLD_MINUTES * 60_000).toISOString(),
        message: "Skipped by chat vote."
      }));
      chatControl.clearSkipVote();
      continue;
    }

    if (effect.kind !== "request") {
      continue;
    }

    // The history the cooldown and the cap are decided on. A request whose asset has left the
    // queue has been played and no longer counts against the cap; the cooldown looks back exactly
    // as far as it is long.
    await markChatViewerRequestsPlayed(state.playout.queuedAssetIds);
    const [recentRequests, queuedRequestCount] = await Promise.all([
      listRecentChatViewerRequests(new Date(Date.now() - Math.max(0, config.requestCooldownSeconds) * 1000).toISOString()),
      countQueuedChatViewerRequests(state.playout.queuedAssetIds)
    ]);
    const verdict = evaluateViewerRequest({
      actor: effect.actor,
      query: effect.query,
      candidates: state.assets.map((asset) => ({
        assetId: asset.id,
        title: buildAssetDisplayTitle(asset) || asset.id,
        // Only assets that are ready and not blocked may be requested.
        requestable: asset.status === "ready" && !isAssetBlockedForAutomaticSelection(asset)
      })),
      recentRequests,
      queuedRequestCount,
      queuedAssetIds: state.playout.queuedAssetIds,
      config,
      now: new Date()
    });

    if (!verdict.accepted) {
      logRuntimeEvent("chat.request.rejected", { actor: effect.actor, query: effect.query, reason: verdict.reason });
      continue;
    }

    await updatePlayoutRuntime((playout) => ({
      ...playout,
      queuedAssetIds: [...playout.queuedAssetIds, verdict.assetId]
    }));
    await appendChatViewerRequestRecord({ actor: effect.actor, assetId: verdict.assetId });
    logRuntimeEvent("chat.request.queued", { actor: effect.actor, assetId: verdict.assetId, queuedRequestCount: queuedRequestCount + 1 });
    await appendAuditEvent("chat.request", `${effect.actor} requested "${verdict.title}" from chat.`);
  }
}

async function reconcileChatInteraction(): Promise<void> {
  const config = await readChatInteractionSettingsRecord();
  latestChatInteractionConfig = config;

  if (!config.enabled) {
    // Disabling viewer control ends the campaign in memory too, not just its row: otherwise a
    // re-enable within the window would resurrect a tally collected under the old rules.
    chatControl.clearSkipVote();
    if (chatControl.consumeDirty()) {
      await writeChatVoteSessionRecord({ status: "closed", updatedAt: new Date().toISOString() });
      await flushChatSkipVote();
    }
    return;
  }

  const state = await readAppState();

  const outcome = chatControl.settleVoteIfDue(config);
  if (outcome?.winnerAssetId) {
    // Promote the winner to the front of the queue. Everything else keeps its order, so a vote
    // reorders the queue rather than replacing it.
    const remaining = state.playout.queuedAssetIds.filter((id) => id !== outcome.winnerAssetId);
    await updatePlayoutRuntime((playout) => ({
      ...playout,
      queuedAssetIds: [outcome.winnerAssetId, ...remaining]
    }));
    await appendAuditEvent(
      "chat.vote.decided",
      `Chat voted for "${outcome.winnerTitle}" (${String(outcome.totalVotes)} votes from ${String(outcome.voterCount)} viewers).`
    );
  } else if (outcome) {
    await appendAuditEvent("chat.vote.undecided", `Chat vote closed without a decision (${outcome.reason}).`);
  }

  const currentAssetId = state.playout.currentAssetId;
  latestPlayoutAssetId = currentAssetId;

  // A campaign belongs to one item — applySkipVote restarts the tally when the programme moves
  // on, but only when the next vote arrives. Without this clear, a boundary with no further
  // !skip would leave the previous item's progress on air for up to a full window.
  const skipSnapshot = chatControl.getSkipVoteRecord(config);
  if (skipSnapshot && currentAssetId && skipSnapshot.assetId !== currentAssetId) {
    chatControl.clearSkipVote();
  }

  await drainChatEffects(state, config);

  // Checks for an *open* session, not merely a present one: a settled poll stays in the runtime
  // with status "closed" so its outcome can be read, and testing for presence alone would let the
  // first poll of a process be the only one that ever opens.
  const canOpenVote =
    config.votingEnabled &&
    Boolean(currentAssetId) &&
    currentAssetId !== lastVotedAssetId &&
    chatControl.getSession()?.status !== "open";

  if (canOpenVote) {
    const candidates = state.playout.queuedAssetIds
      .map((id) => state.assets.find((asset) => asset.id === id))
      .filter((asset): asset is AssetRecord => Boolean(asset))
      .slice(0, Math.max(2, config.voteOptionCount))
      .map((asset) => ({ assetId: asset.id, title: buildAssetDisplayTitle(asset) || asset.id }));

    if (chatControl.openVote({ id: `vote-${currentAssetId}-${String(Date.now())}`, candidates, config })) {
      lastVotedAssetId = currentAssetId;
    }
  }

  if (chatControl.consumeDirty()) {
    const session = chatControl.getSession();
    await writeChatVoteSessionRecord({
      id: session?.id ?? "",
      status: session?.status ?? "closed",
      openedAt: session?.openedAt ?? "",
      closesAt: session?.closesAt ?? "",
      options: session?.options ?? [],
      ballots: session?.ballots ?? {},
      winnerAssetId: chatControl.getLastOutcome()?.winnerAssetId ?? "",
      updatedAt: new Date().toISOString()
    });
    // The dirty flag covers both tallies, so a skip change flushes here too — this is also the
    // write that clears the row after clearSkipVote, which the throttled flush never sees.
    await flushChatSkipVote();
  }
}

/**
 * Reconciles the chat game against its settings and the live scene.
 *
 * Active means: the published overlay is on and some scene layer of kind "game" is enabled. The
 * intake follows the layer, not just the settings, so switching the layer off stops the game from
 * consuming chat at all and clears its persisted state — layers off must mean no game anywhere,
 * which is also the rollback story for the whole feature.
 */
async function reconcileChatGame(): Promise<void> {
  const settings = await readChatGameSettingsRecord();
  const state = await readAppState();
  const active = hasActiveChatGameLayer(state.overlay);

  // The persisted round is only fetched when the runtime might adopt it: on activation, or after
  // a restart when memory is empty. A running round never re-reads its own writes.
  const restore = active && !chatGameRuntime.isActive() ? await readChatGameRuntimeRecord() : null;
  const result = chatGameRuntime.sync({ active, settings, restore });

  if (result.becameInactive) {
    await clearChatGameRuntimeRecord();
    await appendAuditEvent("chat.game.cleared", "Chat game layer was disabled; game state was removed.");
    return;
  }

  await flushChatGameRuntime();
}

/**
 * Closes the incidents that describe an event which is over.
 *
 * The classification, both thresholds and every health rule are in incident-classes.ts; this is
 * only the I/O around it. It runs in the worker cycle rather than in the playout or uplink process
 * because it is the one loop that reads whole application state anyway, and because every signal it
 * needs is already persisted there by the other two: the playlist mtime and the playout heartbeat,
 * the uplink's status, uptime and destination states, and the worker cycle's own audit trail.
 * Nothing new is measured. The two windows that decide what those signals are worth -- the program
 * feed's staleness allowance and the uplink watchdogs -- are resolved from the same config the
 * runtime resolves them from, so a raised threshold cannot make the sweep more confident than the
 * mechanism it is reasoning about.
 *
 * It is not a one-shot startup step on purpose. An install whose channel is down at boot would get
 * nothing out of a startup sweep -- the areas are not healthy yet, and correctly so. Running every
 * cycle means the backlog clears the moment the channel has genuinely been well for the stability
 * window, which is exactly the claim the resolution note makes.
 */
async function resolveFinishedIncidents(state: AppState): Promise<void> {
  try {
    const nowMs = Date.now();
    const feedConfig = getProgramFeedConfig(process.env, getMediaRoot(), state.managedConfig);
    // The uplink publishes through the destinations the runtime last recorded for it; any of them
    // sitting in "error" is what evaluateUplinkDestinationStall watches, and it is reason enough to
    // stop calling the area healthy.
    const uplinkDestinationIds = new Set(state.playout.uplinkDestinationIds);
    const plan = planIncidentResolutions({
      incidents: state.incidents,
      healthyAreas: measureIncidentAreaHealth({
        nowMs,
        programFeedMode: isProgramFeedMode(),
        uplinkInputMode: STREAM247_UPLINK_INPUT_MODE,
        relayEnabled: STREAM247_RELAY_ENABLED,
        workerHeartbeatAt: state.playout.workerHeartbeatAt,
        // Exactly the allowance readProgramFeedRuntimeStatus uses to call the playlist stale.
        programFeedStaleMs: (feedConfig.bufferedSeconds + feedConfig.failoverSeconds) * 1000,
        uplinkWatchdogMs: getUplinkStallOptions(process.env, state.managedConfig),
        uplinkDestinationsHealthy: state.destinations
          .filter((destination) => uplinkDestinationIds.has(destination.id))
          .every((destination) => destination.status !== "error"),
        playout: state.playout
      }),
      nowMs
    });

    for (const entry of plan) {
      await resolveIncident(entry.fingerprint, entry.message);
      logRuntimeEvent("incident.auto_resolved", {
        fingerprint: entry.fingerprint,
        area: entry.area,
        reason: entry.reason
      });
    }
  } catch (error) {
    logRuntimeEvent("incident.auto_resolve_failed", {
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

async function runWorkerCycle(): Promise<void> {
  // Disk self-protection runs before the syncs so a failing external integration — Twitch down, a
  // source erroring — can never stand between a filling disk and the one mechanism that frees it.
  await enforceDiskWatermark();
  // The observation-only sibling: OS/database volume pressure cannot be evicted away, only
  // reported, and the report must not wait behind a wedged sync either.
  await observeSystemVolume();
  await sweepAssetRetention();
  await syncDestinations();
  await syncLocalMediaLibrary();
  await syncDirectMediaSources();
  await syncYoutubePlaylistSources();
  await syncTwitchVodSources();
  // After the syncs, so assets discovered this cycle can already receive their chapters.
  await backfillAssetChapters();
  // Ahead of the reconcile, because everything below is gated on the connected status and a
  // record wrongly stuck on error would otherwise keep gating it away forever.
  await healTwitchConnection();
  await reconcileTwitch();
  await reconcileTwitchLiveStatus();
  await reconcileTwitchEventSub();
  const chatCycleState = await readAppState();
  latestEngagementSettings = chatCycleState.engagement;
  latestManagedConfig = chatCycleState.managedConfig;
  await twitchChatBridge.sync(chatCycleState, process.env);
  // The cycle flush is what carries settings changes (position, count, the enable gate) to the
  // row when no chat is arriving to trigger the throttled one; identical content writes nothing.
  await flushChatOverlayMessages().catch((error: unknown) => {
    logRuntimeEvent("chat.overlay.flush_failed", {
      error: error instanceof Error ? error.message : String(error)
    });
  });
  await reconcileEngagementGame();
  await reconcileChatInteraction();
  await reconcileChatGame();
  // A runtime heartbeat, not an audit entry. This fires every 30 seconds; writing it to the audit
  // trail filled that 100-row ring with routine noise and evicted every security-relevant entry
  // within about fifteen minutes.
  await updatePlayoutRuntime((playout) => ({ ...playout, workerHeartbeatAt: new Date().toISOString() }));
  // Last, and reading state again: the heartbeat above is this cycle's own proof that the worker
  // loop is alive, and the syncs before it may have raised or closed incidents of their own.
  await resolveFinishedIncidents(await readAppState());
}

type RuntimeMode = "worker" | "playout" | "uplink";

async function runHealthcheck(mode: RuntimeMode): Promise<void> {
  const state = await readAppState();
  const now = Date.now();

  if (mode === "worker") {
    const lastWorkerCycle = state.playout.workerHeartbeatAt;
    if (!lastWorkerCycle) {
      throw new Error("No worker heartbeat has been recorded yet.");
    }

    if (now - new Date(lastWorkerCycle).getTime() > WORKER_HEARTBEAT_STALE_MS) {
      throw new Error("Worker heartbeat is stale.");
    }

    return;
  }

  if (mode === "uplink") {
    if (!STREAM247_RELAY_ENABLED) {
      return;
    }

    // The uplink cycle already wrote this on every path it can exit through, so the `uplink.cycle`
    // audit entry it used to append alongside was never the only evidence -- just the noisier copy.
    const lastUplinkCycle = state.playout.uplinkHeartbeatAt;
    if (!lastUplinkCycle) {
      throw new Error("No uplink heartbeat has been recorded yet.");
    }

    if (now - new Date(lastUplinkCycle).getTime() > PLAYOUT_HEARTBEAT_STALE_MS) {
      throw new Error("Uplink heartbeat is stale.");
    }

    if (state.playout.uplinkStatus === "failed") {
      throw new Error(`Uplink failed: ${state.playout.uplinkLastExitReason || "unknown error"}`);
    }

    if (state.playout.programFeedStatus === "failed") {
      throw new Error("Program feed is failed.");
    }

    return;
  }

  if (state.playout.status === "failed") {
    throw new Error("Playout runtime is failed.");
  }

  if (state.playout.crashLoopDetected) {
    throw new Error("Playout crash-loop protection is active.");
  }

  if (state.playout.status !== "idle" && state.playout.heartbeatAt) {
    if (now - new Date(state.playout.heartbeatAt).getTime() > PLAYOUT_HEARTBEAT_STALE_MS) {
      throw new Error("Playout heartbeat is stale.");
    }
  }
}

function requestImmediatePlayoutCycle(reason: string): void {
  // Never drops the request: with no waiter armed (i.e. called from inside a running cycle) the
  // latch remembers it and waitForNextLoop skips the delay below.
  const delivery = playoutLoopWake.request(reason);
  logRuntimeEvent("playout.loop.wake", { reason, delivery });
}

async function waitForNextLoop(mode: RuntimeMode, delay: number): Promise<void> {
  if (mode !== "playout") {
    await new Promise((resolve) => setTimeout(resolve, delay));
    return;
  }

  const latchedReason = playoutLoopWake.takePending();
  if (latchedReason !== "") {
    logRuntimeEvent("playout.loop.wake.immediate", { reason: latchedReason });
    return;
  }

  await new Promise<void>((resolve) => {
    let settled = false;
    let timeout: NodeJS.Timeout;
    const finish = () => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      playoutLoopWake.disarm(finish);
      resolve();
    };
    timeout = setTimeout(finish, delay);
    playoutLoopWake.arm(finish);
  });
}

async function runLoop(mode: RuntimeMode): Promise<void> {
  const run = mode === "worker" ? runWorkerCycle : mode === "uplink" ? runUplinkCycle : runPlayoutCycle;
  const delay = mode === "worker" ? 30_000 : 15_000;

  for (;;) {
    const result = await runWithStallGuard(run, LOOP_STALL_TIMEOUT_MS);

    if (result.status === "stalled") {
      // The cycle hung past the ceiling (unbounded await). Recover by
      // restarting the process rather than looping with a leaked hung
      // operation while the heartbeat goes stale and the broadcast stays dark.
      logRuntimeEvent("worker.loop.stalled", {
        mode,
        stallMs: LOOP_STALL_TIMEOUT_MS
      });
      try {
        await upsertIncident({
          scope: mode === "worker" ? "worker" : "playout",
          severity: "critical",
          title: `${mode} loop stalled`,
          message: `${mode} cycle did not complete within ${LOOP_STALL_TIMEOUT_MS}ms; restarting the process to recover.`,
          fingerprint: `${mode}.loop.stalled`
        });
      } catch {
        // Best-effort incident; we are about to exit regardless.
      }
      process.exit(1);
    }

    if (result.status === "failed") {
      const error = result.error;
      const message = error instanceof Error ? error.message : `Unknown ${mode} error.`;
      logRuntimeEvent("worker.loop.crashed", {
        mode,
        error: message
      });
      await upsertIncident({
        scope: mode === "worker" ? "worker" : "playout",
        severity: "critical",
        title: `${mode} loop crashed`,
        message,
        fingerprint: `${mode}.loop.crashed`
      });
      await sendAlert(`${mode} loop crashed`, message);
    }

    await waitForNextLoop(mode, delay);
  }
}

const command = process.argv[2] || "worker";

// The runtime is full of deliberately fire-and-forget writes from child-process event handlers
// (`void updatePlayoutRuntime(...)` in the ffmpeg stderr handler and friends). Those go through
// withSerializedStateWrite, which rethrows after its retries, so a transient Postgres outage during
// a burst of ffmpeg stderr output would reject with nobody listening. Node 22 treats an unhandled
// rejection as a fatal error, so that silently killed the broadcast: no incident, no alert, no
// worker.loop.crashed entry -- the operator saw nothing. Degrade to a logged event instead; the
// reconciliation loop already knows how to recover from a failed cycle.
process.on("unhandledRejection", (reason) => {
  logRuntimeEvent("worker.unhandled_rejection", {
    mode: command,
    error: reason instanceof Error ? reason.message : String(reason)
  });
});

// An uncaught exception can leave module state inconsistent, so this only makes the failure
// visible before handing over to the restart policy -- it does not try to continue.
process.on("uncaughtException", (error) => {
  logRuntimeEvent("worker.uncaught_exception", {
    mode: command,
    error: error instanceof Error ? error.message : String(error)
  });
  process.exit(1);
});

if (command === "healthcheck") {
  const healthcheckMode: RuntimeMode = process.argv[3] === "playout" ? "playout" : process.argv[3] === "uplink" ? "uplink" : "worker";
  runHealthcheck(healthcheckMode).catch((error) => {
    logRuntimeEvent("worker.healthcheck.failed", {
      mode: healthcheckMode,
      error: error instanceof Error ? error.message : String(error)
    });
    process.exit(1);
  });
} else {
  const mode: RuntimeMode = command === "playout" ? "playout" : command === "uplink" ? "uplink" : "worker";
  runLoop(mode).catch((error) => {
    logRuntimeEvent("worker.process.failed", {
      mode,
      error: error instanceof Error ? error.message : String(error)
    });
    process.exit(1);
  });
}
