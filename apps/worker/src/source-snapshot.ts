// Snapshot sampler for the scene's video source layer (M57 stage 1).
//
// Architecture decision: the playout ffmpeg keeps exactly two video inputs (programme feed and
// the overlay PNG pipe). An embedded camera/feed therefore reaches the frame as an overlay
// PANEL at snapshot cadence — a short-lived capture process grabs one frame every few seconds,
// the renderer inlines it as a data URI, and the encode never gains a third live input it could
// stall on. Everything in this module is I/O-free policy; the one spawner at the bottom follows
// the asset-thumbnail pattern (bounded execFile, cleanup on failure) plus atomic temp+rename so
// the renderer can never read a half-written capture.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { promises as fs } from "node:fs";
import path from "node:path";
import { getCycleAwaitCeilingMs } from "./cycle-budget.js";

const execFileAsync = promisify(execFile);

const SOURCE_SNAPSHOT_DIRECTORY = ".stream247-source-frames";

/** Captures are downscaled to this width: plenty for an overlay panel, small enough to inline. */
const SOURCE_SNAPSHOT_WIDTH = 960;

/**
 * Requested capture timeout. A reachable feed answers a single-frame grab in low seconds; one
 * that takes longer is effectively down and the sampler should fail fast, count the failure, and
 * try again next interval rather than hold a process open.
 */
const SOURCE_SNAPSHOT_REQUESTED_TIMEOUT_MS = 10_000;

/** Consecutive failures before the operator hears about it as an incident. */
export const SOURCE_SNAPSHOT_FAILURE_INCIDENT_THRESHOLD = 3;

/** Frames older than this are leftovers as far as the disk sweep is concerned. */
const SOURCE_SNAPSHOT_EVICTABLE_AGE_MS = 10 * 60_000;

function sanitizeSourceId(sourceId: string): string {
  return sourceId.replace(/[^a-zA-Z0-9_-]/g, "_");
}

export function getSourceSnapshotDirectory(mediaRoot: string): string {
  return path.join(mediaRoot, SOURCE_SNAPSHOT_DIRECTORY);
}

export function getSourceSnapshotPath(sourceId: string, mediaRoot: string): string {
  return path.join(getSourceSnapshotDirectory(mediaRoot), `${sanitizeSourceId(sourceId)}.png`);
}

/**
 * Where a capture lands before the rename. The suffix keeps it out of the renderer's way (it
 * only ever reads the final .png path) and makes leftovers recognisable to the disk sweep.
 */
export function getSourceSnapshotTempPath(sourceId: string, mediaRoot: string): string {
  return `${getSourceSnapshotPath(sourceId, mediaRoot)}.tmp`;
}

/**
 * The capture timeout actually passed to execFile — always below the cycle stall budget
 * (cycle-budget.ts invariant). The sampler runs detached from the reconciliation cycle, but the
 * renderer loop it reports into shares the process with that cycle, and a capture that outlives
 * the stall guard would be indistinguishable from the hang the guard exists to catch.
 */
export function resolveSourceSnapshotTimeoutMs(env: NodeJS.ProcessEnv): number {
  return Math.min(SOURCE_SNAPSHOT_REQUESTED_TIMEOUT_MS, getCycleAwaitCeilingMs(env));
}

/** One capture per interval, and never two at once — the in-flight guard is the backpressure. */
export function shouldStartSourceCapture(args: {
  nowMs: number;
  lastStartedAtMs: number;
  intervalMs: number;
  inFlight: boolean;
}): boolean {
  if (args.inFlight) {
    return false;
  }
  // A sampler that has never run starts immediately: waiting a full interval after the layer
  // goes live would add dead seconds to every playout start for no protective value.
  if (args.lastStartedAtMs <= 0) {
    return true;
  }
  return args.nowMs - args.lastStartedAtMs >= args.intervalMs;
}

/**
 * Whether the last capture is fresh enough to draw. Three intervals of grace: one slow or failed
 * capture must not blink the layer off air, but a feed that misses three in a row is gone and
 * the layer hides (the owner-default away-behaviour — see sourceFrameVisible in the layout).
 */
export function deriveSourceFrameStatus(args: {
  nowMs: number;
  lastSuccessAtMs: number;
  intervalMs: number;
}): "live" | "stale" {
  if (args.lastSuccessAtMs <= 0) {
    return "stale";
  }
  return args.nowMs - args.lastSuccessAtMs <= args.intervalMs * 3 ? "live" : "stale";
}

export function shouldRaiseSourceSnapshotIncident(consecutiveFailures: number): boolean {
  return consecutiveFailures >= SOURCE_SNAPSHOT_FAILURE_INCIDENT_THRESHOLD;
}

/**
 * The capture command: exactly one frame, downscaled, into the temp path. RTSP is pinned to TCP
 * because UDP transport across container networks loses packets silently and yields corrupt
 * frames instead of errors — a wrong picture on air is worse than a failed capture.
 */
export function buildSourceSnapshotArgs(args: { url: string; targetPath: string }): string[] {
  const command = ["-y", "-hide_banner", "-loglevel", "error"];
  if (args.url.startsWith("rtsp://") || args.url.startsWith("rtsps://")) {
    command.push("-rtsp_transport", "tcp");
  }
  command.push(
    "-i",
    args.url,
    "-frames:v",
    "1",
    "-vf",
    `scale=${String(SOURCE_SNAPSHOT_WIDTH)}:-2`,
    "-f",
    "image2",
    args.targetPath
  );
  return command;
}

export type SourceFrameFileInfo = {
  filePath: string;
  modifiedAtMs: number;
  bytes: number;
};

/**
 * What the disk-watermark sweep may delete from the snapshot directory: every temp leftover, and
 * any final frame old enough that no sampler is refreshing it (a live one is rewritten every few
 * seconds, so its mtime never ages). A deleted live frame would regenerate within one interval
 * anyway — the age gate only avoids pointless churn against an active sampler.
 */
export function selectEvictableSourceFrames(args: {
  files: SourceFrameFileInfo[];
  nowMs: number;
  maxAgeMs?: number;
}): SourceFrameFileInfo[] {
  const maxAgeMs = args.maxAgeMs ?? SOURCE_SNAPSHOT_EVICTABLE_AGE_MS;
  return args.files.filter(
    (file) => file.filePath.endsWith(".tmp") || args.nowMs - file.modifiedAtMs > maxAgeMs
  );
}

/**
 * A feed URL fit for logs and incidents: origin and path only. Feed URLs routinely embed
 * credentials and tokens — the same reason playback inputs are summarised before logging.
 */
export function summarizeSourceFeed(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.hostname}${parsed.pathname}`;
  } catch {
    return "unparseable feed address";
  }
}

export type SourceSnapshotCaptureResult = { ok: true } | { ok: false; error: string };

/**
 * Grabs one frame from the feed into the source's snapshot path, atomically.
 *
 * ffmpeg writes the temp path; only a fully written file is renamed onto the final name (rename
 * within one directory is atomic on POSIX), so a reader can see the previous frame or the new
 * one but never a torn file. On any failure the temp file is removed and the previous final
 * frame stays untouched — a failed capture degrades to a slightly older picture, then to the
 * hidden layer once the staleness grace runs out.
 */
export async function captureSourceSnapshot(args: {
  url: string;
  sourceId: string;
  mediaRoot: string;
  timeoutMs: number;
  ffmpegBinary?: string;
}): Promise<SourceSnapshotCaptureResult> {
  const targetPath = getSourceSnapshotPath(args.sourceId, args.mediaRoot);
  const tempPath = getSourceSnapshotTempPath(args.sourceId, args.mediaRoot);
  await fs.mkdir(path.dirname(targetPath), { recursive: true });

  try {
    await execFileAsync(
      args.ffmpegBinary || process.env.FFMPEG_BIN || "ffmpeg",
      buildSourceSnapshotArgs({ url: args.url, targetPath: tempPath }),
      { timeout: args.timeoutMs, killSignal: "SIGKILL" }
    );
    await fs.rename(tempPath, targetPath);
    return { ok: true };
  } catch (error) {
    await fs.unlink(tempPath).catch(() => {});
    // execFile failures quote the whole command line — feed URL, embedded credentials and all —
    // so the address is scrubbed to its summary before the message can reach a log or incident.
    const raw = error instanceof Error ? error.message : String(error);
    return { ok: false, error: raw.split(args.url).join(summarizeSourceFeed(args.url)).slice(0, 300) };
  }
}
