// Budgeted chapter backfill for sources whose listing ingest cannot deliver chapters.
//
// The twitch-vod connector resolves one video per sync and gets its chapters for free from the
// same `--dump-single-json` call. Every collection connector (YouTube playlists and channels,
// Twitch channel archives) lists its items with `--flat-playlist`, which never includes chapters,
// and direct media is never probed at all — so "mehrere Kategorien mit Kapitelwechsel je Quelle"
// only ever worked for single Twitch VODs. This module closes that gap with one metadata-only
// probe per asset, spread over reconciliation cycles:
//
// - budgeted: at most a handful of probes per cycle (env-tunable, capped so a cycle of worst-case
//   probes stays inside the cycle-await ceiling that guards the loop stall budget);
// - polite: a probe runs once per asset ever when it completes — "no chapters" is a final answer,
//   not a retry — and failures wait out a cooldown, following the twitch-vod-cache pattern;
// - safe: discovered chapters are stored through the same only-fill-empty rule as re-ingest, so
//   operator edits always win, and the stored shape is the same chaptersJson the boundary
//   emission and Helix sync already consume — nothing downstream changes.
import type { AssetRecord, SourceRecord } from "@stream247/db";
import { buildAssetChaptersFromSourceMetadata, parseAssetChaptersJson, serializeAssetChapters } from "@stream247/core";
import { getCycleAwaitCeilingMs } from "./cycle-budget.js";
import { execFileText } from "./process-utils.js";

export const DEFAULT_CHAPTER_BACKFILL_PER_CYCLE = 3;
/** Matches the twitch-vod-cache failure cooldown: long enough to be polite, short enough to heal. */
const DEFAULT_FAILURE_COOLDOWN_SECONDS = 30 * 60;
/**
 * How long an "the probe worked and there were no chapters" answer is trusted before it is
 * checked once more. A week: long enough that rechecks are a rounding error against the per-cycle
 * budget even for a large library, short enough that a video whose chapters were hidden behind a
 * rate limit or an extractor regression is not mis-categorised on air for a season.
 */
export const DEFAULT_CHAPTER_EMPTY_RECHECK_SECONDS = 7 * 24 * 60 * 60;
/** A probe only reads metadata; anything slower than this is a hung network call. */
const CHAPTER_PROBE_TIMEOUT_MS = 30_000;

export type ChapterBackfillConfig = {
  /** Maximum probes per reconciliation cycle. 0 disables the backfill. */
  perCycleBudget: number;
  failureCooldownMs: number;
  /** How long an empty-but-valid result is trusted before one recheck. 0 disables rechecks. */
  emptyResultRecheckMs: number;
  probeTimeoutMs: number;
  ytDlpBinary: string;
  ffprobeBinary: string;
};

export function getChapterBackfillConfig(env: NodeJS.ProcessEnv): ChapterBackfillConfig {
  const probeTimeoutMs = Math.min(CHAPTER_PROBE_TIMEOUT_MS, getCycleAwaitCeilingMs(env));
  // The whole backfill runs awaited on the cycle, so worst case (every probe timing out) must
  // stay inside the single-operation ceiling rather than eating the entire stall budget.
  const budgetCeiling = Math.max(1, Math.floor(getCycleAwaitCeilingMs(env) / probeTimeoutMs));

  const rawBudget = Number(env.CHAPTER_BACKFILL_PER_CYCLE);
  const requestedBudget =
    Number.isFinite(rawBudget) && rawBudget >= 0 ? Math.floor(rawBudget) : DEFAULT_CHAPTER_BACKFILL_PER_CYCLE;

  const rawCooldown = Number(env.CHAPTER_BACKFILL_FAILURE_COOLDOWN_SECONDS);
  const cooldownSeconds = Number.isFinite(rawCooldown) && rawCooldown > 0 ? rawCooldown : DEFAULT_FAILURE_COOLDOWN_SECONDS;

  // 0 is a meaningful setting here (never recheck), so it is kept rather than replaced by the
  // default the way a nonsensical value is. An unset or blank variable is not a 0.
  const rawRecheckText = env.CHAPTER_BACKFILL_EMPTY_RECHECK_SECONDS?.trim() ?? "";
  const rawRecheck = Number(rawRecheckText);
  const recheckSeconds =
    rawRecheckText !== "" && Number.isFinite(rawRecheck) && rawRecheck >= 0
      ? Math.floor(rawRecheck)
      : DEFAULT_CHAPTER_EMPTY_RECHECK_SECONDS;

  return {
    perCycleBudget: Math.min(requestedBudget, budgetCeiling),
    failureCooldownMs: cooldownSeconds * 1000,
    emptyResultRecheckMs: recheckSeconds * 1000,
    probeTimeoutMs,
    ytDlpBinary: env.YT_DLP_BIN || "yt-dlp",
    ffprobeBinary: env.FFPROBE_BIN || "ffprobe"
  };
}

export type ChapterBackfillAsset = Pick<
  AssetRecord,
  "id" | "sourceId" | "path" | "chaptersJson" | "chaptersProbeStatus" | "chaptersProbedAt"
>;
export type ChapterBackfillSource = Pick<SourceRecord, "id" | "connectorKind" | "enabled">;

export type ChapterBackfillCandidate = {
  assetId: string;
  path: string;
  probe: "yt-dlp" | "ffprobe";
  /** True for Twitch archives, where the chapter title names the game and thus the category. */
  chapterTitleNamesCategory: boolean;
};

// Which connector kinds can deliver chapters for already-listed assets, and how. twitch-vod is
// deliberately absent (its sync re-fetches full metadata every cycle anyway), local-library too —
// its files never leave the scan pipeline, a deliberate omission until someone needs it.
const PROBE_BY_CONNECTOR_KIND: Partial<
  Record<SourceRecord["connectorKind"], Pick<ChapterBackfillCandidate, "probe" | "chapterTitleNamesCategory">>
> = {
  "youtube-playlist": { probe: "yt-dlp", chapterTitleNamesCategory: false },
  "youtube-channel": { probe: "yt-dlp", chapterTitleNamesCategory: false },
  "twitch-channel": { probe: "yt-dlp", chapterTitleNamesCategory: true },
  "direct-media": { probe: "ffprobe", chapterTitleNamesCategory: false }
};

/**
 * True while a probe outcome is still within its waiting period.
 *
 * An unreadable or missing timestamp cannot prove the outcome was recent, so the asset stays
 * probeable — the same call isTwitchVodCacheCoolingDown makes.
 */
function isWithinProbeInterval(probedAt: string | undefined, intervalMs: number, nowMs: number): boolean {
  if (intervalMs <= 0 || !probedAt) {
    return false;
  }

  const probedAtMs = new Date(probedAt).getTime();
  return Number.isFinite(probedAtMs) && nowMs - probedAtMs < intervalMs;
}

/**
 * How this asset's stored probe outcome bears on spending budget now.
 *
 * `settled` used to include every successful probe, which made "the probe worked and found no
 * chapters" an absorbing state. That answer is also what a rate limit, a geo- or subscriber-only
 * variant and a yt-dlp extractor regression produce, and there was no way back out of it: unlike
 * "failed", which healed through its cooldown, "ok" never healed. So an empty success is treated
 * as provisional and rechecked once, much later.
 */
type ProbeDisposition = "never-probed" | "retry-failure" | "recheck-empty" | "waiting";

function classifyProbeDisposition(
  asset: ChapterBackfillAsset,
  args: { failureCooldownMs: number; emptyResultRecheckMs: number; nowMs: number }
): ProbeDisposition {
  if (asset.chaptersProbeStatus === "failed") {
    return isWithinProbeInterval(asset.chaptersProbedAt, args.failureCooldownMs, args.nowMs) ? "waiting" : "retry-failure";
  }

  // Only ever an *empty* success reaches here: a probe that found chapters stored them, and an
  // asset with stored chapters was filtered out before this point.
  if (asset.chaptersProbeStatus === "ok") {
    // 0 means an operator turned rechecks off and accepts the old absorbing behaviour.
    if (args.emptyResultRecheckMs <= 0) {
      return "waiting";
    }
    return isWithinProbeInterval(asset.chaptersProbedAt, args.emptyResultRecheckMs, args.nowMs)
      ? "waiting"
      : "recheck-empty";
  }

  return "never-probed";
}

/**
 * Pick which assets this cycle spends its probe budget on.
 *
 * Skips anything that already has chapters — operator edits and earlier fills are final and are
 * never re-probed — plus failures inside their cooldown and empty results inside their (much
 * longer) recheck interval.
 *
 * Priority is never-probed, then failure retries, then empty-result rechecks. A newly ingested
 * asset must get its first probe before the library's settled backlog is revisited, and rechecks
 * are the least urgent of the three: they are re-asking a question that already has a plausible
 * answer. The per-cycle budget is unchanged, so rechecks cost cycle time only in cycles where
 * nothing more urgent is waiting — the cycle-await ceiling invariant is untouched.
 */
export function selectChapterBackfillCandidates(args: {
  assets: ChapterBackfillAsset[];
  sources: ChapterBackfillSource[];
  budget: number;
  failureCooldownMs: number;
  emptyResultRecheckMs: number;
  nowMs: number;
}): ChapterBackfillCandidate[] {
  if (args.budget <= 0) {
    return [];
  }

  const sourceById = new Map(args.sources.map((source) => [source.id, source] as const));
  const buckets: Record<Exclude<ProbeDisposition, "waiting">, Array<{ asset: ChapterBackfillAsset; candidate: ChapterBackfillCandidate }>> = {
    "never-probed": [],
    "retry-failure": [],
    "recheck-empty": []
  };

  for (const asset of args.assets) {
    const source = sourceById.get(asset.sourceId);
    const probe = source && (source.enabled ?? true) ? PROBE_BY_CONNECTOR_KIND[source.connectorKind] : undefined;
    if (!probe || !asset.path) {
      continue;
    }

    if (parseAssetChaptersJson(asset.chaptersJson).length > 0) {
      continue;
    }

    const disposition = classifyProbeDisposition(asset, {
      failureCooldownMs: args.failureCooldownMs,
      emptyResultRecheckMs: args.emptyResultRecheckMs,
      nowMs: args.nowMs
    });
    if (disposition === "waiting") {
      continue;
    }

    buckets[disposition].push({ asset, candidate: { assetId: asset.id, path: asset.path, ...probe } });
  }

  // Oldest outcome first within a bucket, so nothing sits at the back of the queue forever.
  const byProbedAt = (
    left: { asset: ChapterBackfillAsset },
    right: { asset: ChapterBackfillAsset }
  ): number => String(left.asset.chaptersProbedAt).localeCompare(String(right.asset.chaptersProbedAt));

  return [
    ...buckets["never-probed"],
    ...buckets["retry-failure"].sort(byProbedAt),
    ...buckets["recheck-empty"].sort(byProbedAt)
  ]
    .slice(0, args.budget)
    .map((entry) => entry.candidate);
}

/**
 * Map a `yt-dlp --dump-single-json` payload to stored chapters json. Same building block the
 * twitch-vod sync uses, so YouTube titles stay free text while Twitch titles double as category
 * candidates — resolution to a Helix id happens at sync time, exactly as before.
 */
export function buildChaptersJsonFromYtDlpProbe(output: string, options: { chapterTitleNamesCategory: boolean }): string {
  const payload = JSON.parse(output) as { chapters?: Array<{ start_time?: number; title?: string }> };
  return serializeAssetChapters(buildAssetChaptersFromSourceMetadata(payload.chapters, options));
}

/**
 * Map `ffprobe -show_chapters -print_format json` output to stored chapters json. ffprobe reports
 * offsets as decimal strings and the display name under tags.title; embedded titles are free text,
 * so they never name a category.
 */
export function buildChaptersJsonFromFfprobeOutput(output: string): string {
  const payload = JSON.parse(output) as { chapters?: Array<{ start_time?: unknown; tags?: { title?: unknown } }> };
  const entries = (Array.isArray(payload.chapters) ? payload.chapters : []).map((chapter) => ({
    start_time: Number(chapter.start_time),
    title: typeof chapter.tags?.title === "string" ? chapter.tags.title : ""
  }));
  return serializeAssetChapters(buildAssetChaptersFromSourceMetadata(entries, { chapterTitleNamesCategory: false }));
}

export type ChapterProbeResult = { status: "ok"; chaptersJson: string } | { status: "failed"; error: string };

/**
 * Run one metadata-only probe. Never throws: a probe failure is an expected outcome the caller
 * records for the cooldown, not something that may take the reconciliation cycle down.
 */
export async function probeAssetChapters(
  candidate: ChapterBackfillCandidate,
  config: ChapterBackfillConfig,
  exec: typeof execFileText = execFileText
): Promise<ChapterProbeResult> {
  try {
    if (candidate.probe === "ffprobe") {
      const output = await exec(
        config.ffprobeBinary,
        ["-v", "error", "-show_chapters", "-print_format", "json", candidate.path],
        { timeoutMs: config.probeTimeoutMs, killProcessGroup: true, maxBufferBytes: 4 * 1024 * 1024 }
      );
      return { status: "ok", chaptersJson: buildChaptersJsonFromFfprobeOutput(output) };
    }

    // Same invocation the twitch-vod sync uses: --dump-single-json simulates, nothing downloads.
    const output = await exec(config.ytDlpBinary, ["--dump-single-json", "--no-playlist", candidate.path], {
      timeoutMs: config.probeTimeoutMs,
      killProcessGroup: true
    });
    return {
      status: "ok",
      chaptersJson: buildChaptersJsonFromYtDlpProbe(output, { chapterTitleNamesCategory: candidate.chapterTitleNamesCategory })
    };
  } catch (error) {
    return { status: "failed", error: error instanceof Error ? error.message : String(error) };
  }
}
