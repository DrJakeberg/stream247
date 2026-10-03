import { promises as fs } from "node:fs";
import { execFileText } from "./process-utils.js";

/**
 * Real lengths for local-library files (M96).
 *
 * Remote sources get `durationSeconds` from their listing; local files had none, so every planning
 * number counted each file as the 30-minute estimate: three two-minute files read "Unique library:
 * 90m" instead of 6m. The scan now asks ffprobe for the container duration once per file version.
 *
 * A file version is its size plus its modification time. The key is stored with the asset, so an
 * unchanged file is never probed again, across scans and worker restarts alike; a replaced or edited
 * file gets a new key and is probed once more. A probe that fails stores the key too, so a broken file
 * costs one bounded probe per version, not one per scan.
 *
 * Probing is incremental: each scan stops starting probes once its budget is spent, and the files it
 * did not reach keep what they had (no key, so the next scan takes them). A first scan of a large
 * library therefore fills in over several cycles instead of holding one cycle for minutes.
 */

/** One ffprobe call. Local disk answers in milliseconds; this only bounds a hung NFS read. */
export const LOCAL_DURATION_PROBE_TIMEOUT_MS = 10_000;

/** Probing time per scan, far below the cycle's stall budget (cycle-budget.ts). */
export const LOCAL_DURATION_SCAN_BUDGET_MS = 30_000;

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
};

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
}): Promise<LocalDurationScanResult> {
  const stat = args.stat ?? ((filePath: string) => fs.stat(filePath));
  const probe = args.probe ?? ((filePath: string) => probeLocalFileDurationSeconds(filePath));
  const nowMs = args.nowMs ?? Date.now;
  const budgetMs = args.budgetMs ?? LOCAL_DURATION_SCAN_BUDGET_MS;
  const startedAtMs = nowMs();
  const entries = new Map<string, LocalDurationEntry>();
  let probed = 0;
  let failed = 0;
  let deferred = 0;

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

    if (nowMs() - startedAtMs >= budgetMs) {
      deferred += 1;
      continue;
    }

    let durationSeconds = 0;
    try {
      durationSeconds = await probe(filePath);
    } catch {
      durationSeconds = 0;
    }
    probed += 1;
    if (durationSeconds <= 0) {
      failed += 1;
    }
    entries.set(filePath, { durationSeconds, durationProbeKey: key });
  }

  return { entries, probed, failed, deferred };
}
