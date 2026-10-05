import { promises as fs } from "node:fs";
import { getCycleAwaitCeilingMs } from "./cycle-budget.js";
import { ExecFileTextError, execFileText } from "./process-utils.js";

/**
 * Real lengths for local-library files (M96).
 *
 * Remote sources get `durationSeconds` from their listing; local files had none, so every planning
 * number counted each file as the 30-minute estimate: three two-minute files read "Unique library:
 * 90m" instead of 6m. The scan now asks ffprobe for the container duration once per file version.
 *
 * A file version is its size plus its modification time. The key is stored with the asset, so an
 * unchanged file is never probed again, across scans and worker restarts alike; a replaced or edited
 * file gets a new key and is probed once more. A probe that ffprobe answered without a duration stores
 * the key too, so a broken file costs one bounded probe per version, not one per scan. A probe that got no
 * answer -- the 10 s timeout on a busy disk or a slow mount, ffprobe that could not be started -- says
 * nothing about the file: it stores nothing, and the file is tried again after LOCAL_DURATION_PROBE_RETRY_MS
 * (review finding R14, 2026-10-05; until then such a file kept duration 0 for good, until it was touched).
 *
 * Probing is incremental: each scan stops starting probes once its budget is spent, and the files it
 * did not reach keep what they had (no key, so the next scan takes them). A first scan of a large
 * library therefore fills in over several cycles instead of holding one cycle for minutes.
 */

/** One ffprobe call. Local disk answers in milliseconds; this only bounds a hung NFS read. */
export const LOCAL_DURATION_PROBE_TIMEOUT_MS = 10_000;

/**
 * A file whose probe got no answer waits this long before it is probed again, so a hung mount costs one
 * timeout per file per half hour and the files after it are not starved of the scan budget. Kept in memory:
 * a restart tries such files again at once.
 */
export const LOCAL_DURATION_PROBE_RETRY_MS = 30 * 60_000;

/** Probing time per scan, far below the cycle's stall budget (cycle-budget.ts). */
export const LOCAL_DURATION_SCAN_BUDGET_MS = 30_000;

/**
 * The scan budget under the cycle-await ceiling. The budget is checked before a probe starts, so the
 * last probe can run one timeout past it; with a short stall timeout the budget shrinks to keep the
 * whole step inside the ceiling.
 */
export function resolveLocalDurationScanBudgetMs(env: NodeJS.ProcessEnv): number {
  return Math.min(LOCAL_DURATION_SCAN_BUDGET_MS, Math.max(0, getCycleAwaitCeilingMs(env) - LOCAL_DURATION_PROBE_TIMEOUT_MS));
}

export type LocalDurationStat = { size: number; mtimeMs: number };

export type LocalDurationEntry = {
  /** Whole seconds; 0 means unknown. */
  durationSeconds: number;
  /** The file version the duration belongs to, "" when it was never probed. */
  durationProbeKey: string;
};

export function buildDurationProbeKey(stat: LocalDurationStat): string {
  return `${Math.trunc(stat.size)}:${Math.trunc(stat.mtimeMs)}`;
}

/**
 * Whole seconds from `ffprobe -show_entries format=duration` output, 0 when there is none.
 *
 * A file shorter than a second still has a length, so it rounds up to 1 rather than down to the
 * "unknown" value.
 */
export function parseFfprobeDurationSeconds(output: string): number {
  const value = Number.parseFloat(output.trim().split(/\s+/)[0] ?? "");
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }
  return Math.max(1, Math.round(value));
}

export async function probeLocalFileDurationSeconds(
  filePath: string,
  options: { ffprobeBinary?: string; timeoutMs?: number } = {}
): Promise<number> {
  const output = await execFileText(
    options.ffprobeBinary || process.env.FFPROBE_BIN || "ffprobe",
    ["-v", "error", "-show_entries", "format=duration", "-of", "default=nokey=1:noprint_wrappers=1", filePath],
    { timeoutMs: options.timeoutMs ?? LOCAL_DURATION_PROBE_TIMEOUT_MS, killProcessGroup: true, maxBufferBytes: 64 * 1024 }
  );
  return parseFfprobeDurationSeconds(output);
}

export type LocalDurationScanResult = {
  /** One entry per file whose stat succeeded; a file missing here keeps its stored values. */
  entries: Map<string, LocalDurationEntry>;
  probed: number;
  failed: number;
  /** Files left for a later scan because the budget ran out. */
  deferred: number;
  /** Probes that got no answer (timeout, ffprobe not started); retried after LOCAL_DURATION_PROBE_RETRY_MS. */
  unanswered: number;
};

/** A probe that got no answer, and when its file version may be probed again. */
export type LocalDurationRetry = { key: string; notBeforeMs: number };

/**
 * Whether a failed probe said nothing about the file: ffprobe did not answer in time, could not be started,
 * or was ended by a signal. An exit with a code (ffprobe read the file and refused it) is an answer, and so
 * is any error this cannot classify, which keeps the M96 rule for it.
 */
export function isUnansweredDurationProbe(error: unknown): boolean {
  if (!(error instanceof ExecFileTextError)) {
    return false;
  }
  return error.kind === "timeout" || error.kind === "spawn" || (error.kind === "exit" && error.exitCode === null);
}

/**
 * The duration of every scanned file, probing only files whose version changed.
 *
 * `stat`, `probe` and `nowMs` are injectable so tests can count probes and drive the budget.
 */
export async function resolveLocalFileDurations(args: {
  files: string[];
  existingByPath: Map<string, { durationSeconds?: number; durationProbeKey?: string }>;
  stat?: (filePath: string) => Promise<LocalDurationStat>;
  probe?: (filePath: string) => Promise<number>;
  nowMs?: () => number;
  budgetMs?: number;
  /** Unanswered probes by file path, kept by the caller across scans (in memory). */
  retries?: Map<string, LocalDurationRetry>;
}): Promise<LocalDurationScanResult> {
  const stat = args.stat ?? ((filePath: string) => fs.stat(filePath));
  const probe = args.probe ?? ((filePath: string) => probeLocalFileDurationSeconds(filePath));
  const nowMs = args.nowMs ?? Date.now;
  const budgetMs = args.budgetMs ?? resolveLocalDurationScanBudgetMs(process.env);
  const startedAtMs = nowMs();
  const retries = args.retries ?? new Map<string, LocalDurationRetry>();
  const entries = new Map<string, LocalDurationEntry>();
  let probed = 0;
  let failed = 0;
  let deferred = 0;
  let unanswered = 0;

  for (const filePath of args.files) {
    let key: string;
    try {
      key = buildDurationProbeKey(await stat(filePath));
    } catch {
      // Gone between listing and stat, or unreadable: nothing to learn, keep what is stored.
      continue;
    }

    const existing = args.existingByPath.get(filePath);
    if (existing?.durationProbeKey === key) {
      entries.set(filePath, { durationSeconds: existing.durationSeconds ?? 0, durationProbeKey: key });
      continue;
    }

    // Waiting after a probe that got no answer: like a deferred file, it keeps what is stored. A new version
    // of the file is probed at once.
    const retry = retries.get(filePath);
    if (retry && retry.key === key && nowMs() < retry.notBeforeMs) {
      continue;
    }

    if (nowMs() - startedAtMs >= budgetMs) {
      deferred += 1;
      continue;
    }

    let durationSeconds = 0;
    try {
      durationSeconds = await probe(filePath);
    } catch (error) {
      if (isUnansweredDurationProbe(error)) {
        probed += 1;
        unanswered += 1;
        retries.set(filePath, { key, notBeforeMs: nowMs() + LOCAL_DURATION_PROBE_RETRY_MS });
        continue;
      }
      durationSeconds = 0;
    }
    retries.delete(filePath);
    probed += 1;
    if (durationSeconds <= 0) {
      failed += 1;
    }
    entries.set(filePath, { durationSeconds, durationProbeKey: key });
  }

  return { entries, probed, failed, deferred, unanswered };
}
