// Presence and the attach decision for pushed video sources (M57 stage 2, Etappe B).
//
// Stage B computes whether the playout WOULD attach a pushed source as a live input and logs
// that decision; nothing is acted on yet. The decision itself is I/O-free so the whole matrix is
// testable, and the one network touch — asking the relay's container-internal API whether the
// source is currently publishing — is a bounded fetch whose every failure mode reads as
// "unknown". Unknown always decides "skip": the fail-safe direction is stage 1, where the
// snapshot sampler keeps drawing the panel no matter what this module thinks.

import { relaySourcePath } from "@stream247/core";

/**
 * What the relay knows about a source path: is someone publishing to it right now, and does the
 * published stream carry an audio track. `hasAudio` is advisory (M57 stage 2, Etappe D: it decides
 * whether the live-attach builds an audio branch at all) and only meaningful when publishing.
 */
export type RelayPathPresence = { publishing: boolean; hasAudio?: boolean };

/**
 * Whether a mediamtx path's `tracks` list contains an audio track. mediamtx names tracks by codec
 * ("H264", "MPEG-4 Audio", "Opus", …), so audio is detected by codec name rather than a flag the
 * API does not provide. Anything unrecognised is treated as not-audio, which fails safe: a source
 * whose audio we cannot confirm attaches video-only rather than building a mix around a track that
 * may not be there.
 */
const AUDIO_TRACK_PATTERN = /audio|opus|aac|mp3|g7\d\d|lpcm|\bpcm\b|vorbis|ac-?3|speex/i;

export function relayTracksHaveAudio(tracks: unknown): boolean {
  return Array.isArray(tracks) && tracks.some((track) => typeof track === "string" && AUDIO_TRACK_PATTERN.test(track));
}

// ---------------------------------------------------------------------------
// Circuit breaker
// ---------------------------------------------------------------------------

/**
 * After a failed attach start (wired in stage C), no attach is considered for this long. Three
 * minutes is deliberately much longer than the presence poll: a feed that kills the encode must
 * not be retried at cycle cadence, and an operator watching the incident needs the window to
 * read what happened before the next attempt muddies it.
 */
export const ATTACH_FAILURE_COOLDOWN_MS = 3 * 60_000;

/**
 * In-memory on purpose: an attach failure is a statement about this process's encode, and a
 * restarted worker starting from a closed breaker is the correct reset semantics.
 */
export type AttachBreakerState = {
  /** 0 while closed; otherwise the timestamp of the failure that opened it. */
  openedAtMs: number;
};

export function closedAttachBreaker(): AttachBreakerState {
  return { openedAtMs: 0 };
}

export function openAttachBreaker(nowMs: number): AttachBreakerState {
  return { openedAtMs: nowMs };
}

export function isAttachBreakerOpen(state: AttachBreakerState, nowMs: number): boolean {
  return state.openedAtMs > 0 && nowMs - state.openedAtMs < ATTACH_FAILURE_COOLDOWN_MS;
}

export function attachBreakerRemainingMs(state: AttachBreakerState, nowMs: number): number {
  return isAttachBreakerOpen(state, nowMs) ? state.openedAtMs + ATTACH_FAILURE_COOLDOWN_MS - nowMs : 0;
}

// ---------------------------------------------------------------------------
// The decision
// ---------------------------------------------------------------------------

export type SourceLiveAttachInput = {
  /** The stage-2 live gate (resolveSourceLiveEnabled). */
  sourceLiveEnabled: boolean;
  /** The stage-1 layer gate — live attach never outruns the layer being allowed at all. */
  sourceLayerEnabled: boolean;
  /** The scene's active source layer reference; "" when no enabled source layer exists. */
  sourceId: string;
  /** The relay's answer, or null when it could not be asked (skipped, failed, timed out). */
  presence: RelayPathPresence | null;
  breaker: AttachBreakerState;
  nowMs: number;
};

export type SourceLiveAttachDecision = {
  decision: "attach" | "skip";
  reason: "switched-off" | "no-source-layer" | "breaker-cooldown" | "presence-unknown" | "not-publishing" | "publishing";
};

/**
 * Whether this cycle would attach the source as a live input. The gate order is also the cost
 * order: switches and scene state are free, the breaker is memory, and presence — the only
 * answer that costs a network round trip — is consulted last (callers skip the fetch entirely
 * when an earlier gate already decides, so a disabled feature produces zero relay traffic).
 */
export function decideSourceLiveAttach(input: SourceLiveAttachInput): SourceLiveAttachDecision {
  if (!input.sourceLiveEnabled || !input.sourceLayerEnabled) {
    return { decision: "skip", reason: "switched-off" };
  }
  if (!input.sourceId) {
    return { decision: "skip", reason: "no-source-layer" };
  }
  if (isAttachBreakerOpen(input.breaker, input.nowMs)) {
    return { decision: "skip", reason: "breaker-cooldown" };
  }
  if (input.presence === null) {
    return { decision: "skip", reason: "presence-unknown" };
  }
  return input.presence.publishing
    ? { decision: "attach", reason: "publishing" }
    : { decision: "skip", reason: "not-publishing" };
}

// ---------------------------------------------------------------------------
// What the decision leaves behind for the operator (M57 stage 2, Etappe E)
// ---------------------------------------------------------------------------

/** One row's worth of live state: the decision reason, and when the cooldown ends if there is one. */
export type SourceLiveStateWrite = { sourceId: string; state: string; retryAt: string };

/**
 * Turns a SKIP decision into the state a surface can show, or null when there is nothing to write.
 *
 * A skip is true the moment it is decided — nothing is attached, and nothing later in the cycle can
 * change that. An ATTACH is not: it is an intention. Between deciding and being on air the read URL
 * still has to resolve, the start path still has to be an asset in scene mode, and a process still
 * has to actually take the input — and the cycle deliberately does not restart a running process
 * just to attach, so an intention can go a whole item without ever landing. Writing "live" here was
 * exactly that lie, so this builder returns null for an attach and buildStartedSourceLiveStateWrite
 * below owns the live state instead.
 *
 * The other two rules: a decision without a source id ("no-source-layer" — a statement about the
 * scene, not about any stored source) is written nowhere, and only the cooldown carries a retry
 * moment, so a surface counts down from a real deadline instead of re-deriving one from a stale
 * timestamp.
 */
export function buildSourceLiveStateWrite(args: {
  sourceId: string;
  outcome: SourceLiveAttachDecision;
  breaker: AttachBreakerState;
  nowMs: number;
}): SourceLiveStateWrite | null {
  if (!args.sourceId || args.outcome.decision === "attach") {
    return null;
  }

  const remainingMs = args.outcome.reason === "breaker-cooldown" ? attachBreakerRemainingMs(args.breaker, args.nowMs) : 0;
  return {
    sourceId: args.sourceId,
    state: args.outcome.reason,
    retryAt: remainingMs > 0 ? new Date(args.nowMs + remainingMs).toISOString() : ""
  };
}

/**
 * The state after a process start, where the answer is finally a fact rather than an intention.
 *
 * `inputActive` must come from the flag C+D introduced for exactly this distinction
 * (`playoutLiveSourceInputActive`): true only when a live PiP input was really placed in the
 * command that was spawned. An intention that did not become an input — an unresolvable read URL, a
 * scene-render fallback to text mode, a start that turned out to be a live bridge — is reported as
 * picture-only, never as live.
 */
export function buildStartedSourceLiveStateWrite(args: {
  /** The source the cycle intended to attach; "" when it intended none. */
  intendedSourceId: string;
  /** Whether a live PiP input really went into the running command. */
  inputActive: boolean;
}): SourceLiveStateWrite | null {
  if (!args.intendedSourceId) {
    return null;
  }

  return {
    sourceId: args.intendedSourceId,
    state: args.inputActive ? "publishing" : "attach-unavailable",
    retryAt: ""
  };
}

// ---------------------------------------------------------------------------
// The bounded presence fetch
// ---------------------------------------------------------------------------

/** Far below the cycle stall budget (see cycle-budget.ts); a slow relay reads as unknown. */
const PRESENCE_FETCH_TIMEOUT_MS = 2_000;

/**
 * Asks the relay's container-internal API whether the source path has an active publisher.
 *
 * Three-valued by design: publishing, not publishing (an idle or unknown path — mediamtx
 * answers 404 for a path nobody ever published), or null for "could not tell" (connection
 * refused, server error, timeout, unparseable body). Callers must treat null as "skip", never
 * as "gone" — a relay restart must not read as a source disappearing.
 */
export async function fetchRelaySourcePresence(args: {
  sourceId: string;
  baseUrl?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}): Promise<RelayPathPresence | null> {
  const baseUrl = args.baseUrl ?? "http://relay:9997";
  const fetchImpl = args.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), args.timeoutMs ?? PRESENCE_FETCH_TIMEOUT_MS);

  try {
    const response = await fetchImpl(`${baseUrl}/v3/paths/get/${relaySourcePath(args.sourceId)}`, {
      signal: controller.signal
    });

    if (response.status === 404) {
      return { publishing: false, hasAudio: false };
    }
    if (!response.ok) {
      return null;
    }

    const body = (await response.json()) as { ready?: unknown; tracks?: unknown };
    return { publishing: body.ready === true, hasAudio: relayTracksHaveAudio(body.tracks) };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
