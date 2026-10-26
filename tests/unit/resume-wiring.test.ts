import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DECLARED_SCHEMA } from "@stream247/db";

// M124 (PLANS.md M77). The decisions are pure functions in apps/worker/src/resume-interrupted.ts and
// packages/core/src/resume-point.ts (resume-interrupted.test.ts); apps/worker/src/index.ts cannot be
// imported in a unit test (it starts the worker), so this pins where the playout uses them, the way
// operator-play-now-wiring.test.ts does. The stack proof is scripts/resume-smoke.sh (`pnpm test:resume`).
const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");
const workerSource = read("apps/worker/src/index.ts");
const dbSource = read("packages/db/src/index.ts");
const webStateSource = read("apps/web/lib/server/state.ts");
const flat = (text: string) => text.replace(/\s+/g, " ");

function bodyOf(source: string, signature: string): string {
  const start = source.indexOf(signature);
  expect(start, `${signature} not found`).toBeGreaterThan(-1);
  const ends = ["\nfunction ", "\nasync function ", "\nexport "].map((marker) => source.indexOf(marker, start + 1)).filter((index) => index > -1);
  return source.slice(start, ends.length > 0 ? Math.min(...ends) : undefined);
}

describe("the start of a continued item", () => {
  const start = flat(bodyOf(workerSource, "async function startOrSwitchPlayout("));

  it("seeks only a file on disk, and says so when the file is gone", () => {
    expect(start).toContain(
      "const startOffsetSeconds = wantedStartSeconds > 0 && isSeekableInput({ input: resolvedProgramInput, audioInput: resolvedProgramAudioInput }) ? wantedStartSeconds : 0;"
    );
    expect(start).toContain('logRuntimeEvent("playout.resume.not_seekable", {');
    // The programme input, and only it, starts there (getFfmpegCommand -> buildFfmpegInputArgs).
    expect(start).toContain("activeTickerCrawl, resolvedProgramAudioInput, startOffsetSeconds )");
    expect(flat(bodyOf(workerSource, "function getFfmpegCommand("))).toContain(
      "...buildFfmpegInputArgs({ input, realtime: true, startSeconds: programStartSeconds })"
    );
  });

  it("records where it started: the runtime row, the as-run row, the log and the run that keeps the point", () => {
    expect(start).toContain(
      "processStartedAt: startedAt, currentStartOffsetSeconds: startOffsetSeconds, resumePoints: startDropsResumeAssetId ? removeResumePointsOfAsset(playout.resumePoints, startDropsResumeAssetId) : decideResumePointsAtStart(playout.resumePoints, startResumeRun),"
    );
    // A continuation that cannot seek (its archive left the cache) gives the point up, so it is not
    // started from 0 again at every later cut.
    expect(start).toContain('const startDropsResumeAssetId = args.resume?.resumed && args.asset && !startResumeRun ? args.asset.id : "";');
    expect(start).toContain("formatCandidate: playoutFormatCandidateId, startOffsetSeconds })");
    expect(start).toContain('logRuntimeEvent("playout.resume.start", {');
    expect(start).toContain("failedPlayoutExitWrite.supersede(); playoutStartOffsetSeconds = startOffsetSeconds;");
    expect(start).toContain(
      'playoutResumeRun = resumeRunOf({ targetKind: playoutTargetKind, reasonCode: args.reasonCode, poolId: args.resume?.poolId ?? "", assetId: playoutAssetId,'
    );
  });

  it("measures the item, not the run: the duration bound, the chapters, the expected end", () => {
    expect(flat(bodyOf(workerSource, "async function enforceAssetDurationBound("))).toContain("processStartedAtMs: playoutItemZeroMs(),");
    expect(flat(bodyOf(workerSource, "function emitDueAssetChapterBoundaries("))).toContain(
      "elapsedSeconds: Math.max(0, Math.floor((Date.now() - playoutItemZeroMs()) / 1000))"
    );
    expect(flat(bodyOf(workerSource, "function playoutItemZeroMs("))).toContain(
      "return playoutProcessStartedAtMs > 0 ? playoutProcessStartedAtMs - playoutStartOffsetSeconds * 1000 : 0;"
    );
    expect(flat(bodyOf(workerSource, "function onAirItemStartedAt("))).toContain("return onAirItemZeroAt(state.playout);");
    expect(flat(workerSource)).toContain("processStartedAt: onAirItemZeroAt(state.playout), asset }) ||");
    expect(flat(workerSource)).toContain(
      "Math.max(0, Math.floor((Date.now() - new Date(onAirItemZeroAt(state.playout)).getTime()) / 1000))"
    );
    // The web (public programme, its cache key, the overlay preview) and the chat bot's row.
    expect(webStateSource.match(/onAirItemZeroAt\(state\.playout\)/g)?.length).toBe(3);
    expect(webStateSource).not.toContain("state.playout.processStartedAt");
    expect(flat(bodyOf(dbSource, "export function playoutProgrammeRowOf("))).toContain("processStartedAt: onAirItemZeroAt(playout),");
    expect(flat(bodyOf(dbSource, "export async function readPlayoutProgrammeTitles("))).toContain(
      'processStartedAt: onAirItemZeroAt({ processStartedAt: row?.process_started_at ?? "", currentStartOffsetSeconds: Number(row?.current_start_offset_seconds) || 0 }),'
    );
  });
});

describe("the point through the run's life", () => {
  it("is written at the exit from the run's own stop intent", () => {
    const exit = flat(workerSource.slice(workerSource.indexOf('child.on("exit", (code, signal) => {')));
    expect(exit).toContain("const lastStopIntent = asRunStopIntent; const lastResumeRun = playoutResumeRun;");
    expect(exit).toContain(
      "const resumeExitKind = classifyResumeExit({ plannedReason, stopIntent: lastStopIntent, naturalBoundary, exitedCleanly, immediateOpenFailure });"
    );
    expect(exit).toContain(
      'processStartedAt: "", currentStartOffsetSeconds: 0, resumePoints: decideResumePointsAfterExit({ points: playout.resumePoints, run: lastResumeRun, kind: resumeExitKind, exitedAtMs, completedAssetId: resumeExitKind === "ended" && (plannedReason === "" || plannedReason === "duration-bound") ? lastAssetId : "" }),'
    );
    expect(exit).toContain("playoutStartOffsetSeconds = 0; playoutResumeRun = null;");
  });

  it("is written by every cycle while the item plays, so a container that dies with ffmpeg leaves it", () => {
    const cycle = flat(bodyOf(workerSource, "async function runPlayoutCycle("));
    expect(cycle).toContain(
      "await updatePlayoutRuntime((playout, current) => ({ ...playout, // The resume points still owed, and the position of the pool's item on air (M124): a container that // dies with ffmpeg leaves no exit to write it, so every cycle writes it (resume-interrupted.ts). resumePoints: decideResumeCheckpoint({ points: playout.resumePoints, run: playoutResumeRun, processRunning: isPlayoutProcessRunning(), pools: current.pools, nowMs: Date.now() }),"
    );
  });

  it("hands the pool's own pick its pool, and a continued one its position", () => {
    const cycle = flat(bodyOf(workerSource, "async function runPlayoutCycle("));
    expect(cycle).toContain(
      'const resumeOfSelection = selection.asset && selection.reasonCode === "scheduled_match" && asRunSchedule.poolId ? { poolId: asRunSchedule.poolId, startSeconds: selection.resumeStartSeconds ?? 0, resumed: selection.resumeStartSeconds !== undefined } : null;'
    );
    expect(cycle.match(/resume: resumeOfSelection, consumed: consumedRequests \}\);/g)?.length).toBe(2);
  });

  it("keeps the cached archive of a cut replay on disk", () => {
    const release = flat(bodyOf(workerSource, "async function releaseWatchedVodCache("));
    const kept = release.indexOf('reason: "resume-point"');
    expect(kept).toBeGreaterThan(-1);
    expect(kept).toBeLessThan(release.indexOf("evictUnusedTwitchVodCache("));
    expect(release).toContain(
      "state.playout.resumePoints.some((point) => point.assetId === finishedAsset.id && isResumePointValid(point, Date.now()))"
    );
  });
});

describe("the selection that continues the item", () => {
  const choose = flat(bodyOf(workerSource, "function choosePlaybackCandidate("));

  it("comes after the operator arms, the retry and the inserts, and before the pool's next pick", () => {
    const resume = choose.indexOf("const resumePick = selectPoolResumeItem(state, currentScheduleItem?.poolId ?? \"\", {");
    expect(resume).toBeGreaterThan(choose.indexOf("const retryDecision = decideInputOpenRetry("));
    expect(resume).toBeGreaterThan(choose.indexOf("manualNextAsset &&"));
    expect(choose).toContain("runningAssetId: processRunning ? playoutAssetId : \"\",");
    // A dated block's takeover and the block on air both continue the cut item first.
    expect(choose).toContain("? resumePick?.asset ?? selectPoolAsset(state, currentScheduleItem.poolId, skippedAssetId, removedNextAssetId)");
    expect(choose).toContain(
      "currentPoolAsset ?? resumePick?.asset ?? selectPoolAsset(state, currentScheduleItem.poolId, skippedAssetId, removedNextAssetId)"
    );
    expect(choose).toContain("...(resumeStart ? { resumeStartSeconds: resumeStart.startSeconds } : {})");
    // The retry of a continued item that failed to open keeps its position: its own pool's point, once.
    expect(choose).toContain('...(retryResume?.kind === "resume" ? { resumeStartSeconds: retryResume.startSeconds } : {}),');
    expect(choose).toContain(
      'point.assetId === retryAsset.id && point.poolId === (currentScheduleItem?.poolId ?? "") && isResumePointValid(point, scheduleNow.getTime()) && !isResumePointExhausted(point)'
    );
  });

  it("holds the item to the pool's own rules", () => {
    const pick = flat(bodyOf(workerSource, "function selectPoolResumeItem("));
    expect(pick).toContain("pool.sourceIds.includes(asset.sourceId) && !heldSourceIds.includes(asset.sourceId) && isPoolAssetEligible(pool, asset, options.skippedAssetId, options.removedNextAssetId),");
    // The Next card and !next name it too.
    expect(flat(bodyOf(workerSource, "function predictWorkerNextOnAir("))).toContain(
      "? resumed?.asset ?? selectPoolAsset(state, block.poolId, skippedAssetId, removedNextAssetId)"
    );
  });
});

describe("the stored columns", () => {
  it("ship in the baseline and in a migration, and the whole-row write carries them", () => {
    for (const line of [
      "ALTER TABLE playout_runtime ADD COLUMN IF NOT EXISTS current_start_offset_seconds INTEGER NOT NULL DEFAULT 0;",
      "ALTER TABLE playout_runtime ADD COLUMN IF NOT EXISTS resume_points TEXT NOT NULL DEFAULT '[]';",
      "ALTER TABLE as_run_log ADD COLUMN IF NOT EXISTS start_offset_seconds INTEGER NOT NULL DEFAULT 0;"
    ]) {
      // The baseline's ALTER block and the migration, word for word.
      expect(dbSource.split(line).length - 1).toBe(2);
    }
    expect(dbSource).toContain('id: "20261026_001_resume_interrupted_item"');
    expect(DECLARED_SCHEMA.playout_runtime).toEqual(expect.arrayContaining(["current_start_offset_seconds", "resume_points"]));
    expect(DECLARED_SCHEMA.as_run_log).toContain("start_offset_seconds");
    expect(flat(dbSource)).toContain("worker_heartbeat_at, remove_next_asset_id, remove_next_until, current_start_offset_seconds, resume_points )");
    expect(flat(dbSource)).toContain("JSON.stringify(playout.resumePoints ?? [])");
  });
});
