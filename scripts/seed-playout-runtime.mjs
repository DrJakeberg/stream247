// Seeds a fixed playout runtime so the live surfaces render deterministically.
//
// The dev stack leaves worker/playout/uplink stopped on purpose: they rewrite heartbeats and
// readiness continuously, and no two page loads would match. That makes the UI reproducible but
// also empty — the dashboard, the program page and the channel page all show "nothing on air",
// which is the one state nobody needs a screenshot of. Every surface that actually reports on a
// running channel was therefore outside the visual suite.
//
// This writes the runtime the stopped worker would otherwise own, with fixed ids and fixed
// timestamps, through the same updatePlayoutRuntime the worker uses rather than raw SQL, so the
// seeded shape cannot drift from the one production writes.
//
// Usage: node scripts/seed-playout-runtime.mjs
// Requires DATABASE_URL to point at the dev database.

// Imported by path rather than by package name: pnpm links workspace packages only into the
// workspaces that depend on them, and the repo root is not one, so "@stream247/db" does not resolve
// from here. Requires `pnpm build` to have run, which `dev-stack.sh up` already depends on.
import {
  readAppState,
  replaceAllScheduleBlocks,
  replaceAssetsForSourceIds,
  updatePlayoutRuntime,
  updateTwitchConnectionRecord
} from "../packages/db/dist/index.js";

// Fixed instants, not offsets from now: the point is that two runs produce identical bytes.
const STARTED_AT = "2026-03-14T20:00:00.000Z";
const HEARTBEAT_AT = "2026-03-14T20:42:00.000Z";

/**
 * Two assets, fixed in every field.
 *
 * The API fixture cannot create these: registering media goes through an upload, and a dev stack
 * has no media to upload. Without them the workspace has pools and schedule blocks pointing at
 * nothing, so every surface that names what is playing renders empty.
 */
const ASSETS = [
  {
    id: "dev-asset-on-air",
    sourceId: "dev-source",
    title: "Abendprogramm — Folge 12",
    path: "/app/data/media/dev/abendprogramm-12.mp4",
    status: "ready",
    includeInProgramming: true,
    categoryName: "Replay",
    durationSeconds: 3600,
    fallbackPriority: 0,
    isGlobalFallback: false,
    createdAt: "2026-03-01T09:00:00.000Z",
    updatedAt: "2026-03-01T09:00:00.000Z"
  },
  {
    id: "dev-asset-next",
    sourceId: "dev-source",
    title: "Abendprogramm — Folge 13",
    path: "/app/data/media/dev/abendprogramm-13.mp4",
    status: "ready",
    includeInProgramming: true,
    categoryName: "Replay",
    durationSeconds: 2700,
    fallbackPriority: 1,
    isGlobalFallback: false,
    createdAt: "2026-03-01T09:05:00.000Z",
    updatedAt: "2026-03-01T09:05:00.000Z"
  }
];

async function main() {
  const state = await readAppState();

  // replaceAssetsForSourceIds, not updateAssetRecords.
  //
  // The comment above these assets says the workspace renders empty without them — and it has been,
  // silently, because updateAssetRecords is an UPDATE. On an empty table it matches no rows and
  // succeeds, so the seed reported success while writing nothing. Every surface that resolves
  // playable material has been recording its empty state into the baselines as though that were the
  // seeded content: "No playable video resolved", on every block of every day.
  await replaceAssetsForSourceIds([...new Set(ASSETS.map((asset) => asset.sourceId))], ASSETS);

  const asset = ASSETS[0];
  const nextAsset = ASSETS[1];

  await updatePlayoutRuntime((playout) => ({
    ...playout,
    status: "running",
    transitionState: "idle",
    currentAssetId: asset.id,
    currentTitle: asset.title,
    nextAssetId: nextAsset?.id ?? "",
    nextTitle: nextAsset?.title ?? "",
    processPid: 4242,
    processStartedAt: STARTED_AT,
    heartbeatAt: HEARTBEAT_AT,
    lastTransitionAt: STARTED_AT,
    lastSuccessfulStartAt: STARTED_AT,
    lastSuccessfulAssetId: asset.id,
    restartCount: 0,
    crashCountWindow: 0,
    crashLoopDetected: false,
    lastError: "",
    lastStderrSample: "",
    selectionReasonCode: "scheduled_match",
    message: "Scheduled block is on air.",
    uplinkStatus: "running",
    uplinkInputMode: "hls",
    uplinkStartedAt: STARTED_AT,
    uplinkHeartbeatAt: HEARTBEAT_AT,
    uplinkRestartCount: 0,
    uplinkUnplannedRestartCount: 0,
    uplinkLastExitCode: "",
    uplinkLastExitReason: "",
    programFeedStatus: "fresh",
    programFeedUpdatedAt: HEARTBEAT_AT,
    programFeedTargetSeconds: 2,
    programFeedBufferedSeconds: 60
  }));

  // A week with no gaps in it.
  //
  // The fixture used to seed a handful of blocks at fixed hours — 20:00 on weekdays, and so on —
  // which left most of the day unprogrammed. Whether anything was on air then depended on what time
  // the suite happened to run, and four surfaces render exactly that: the live pages, the public
  // channel page and the scene preview. They went red on their own when the clock crossed a
  // boundary, with no change to any code.
  //
  // Every hour of every day belongs to a block now, and the times are fixed rather than relative to
  // now, so the same block is on air at 03:00 as at 15:00. Saturday still runs into Sunday, because
  // the carry-over path is worth having in the fixture and not only in unit tests.
  const pool = state.pools[0]?.id ?? "";
  const week = [];
  for (let day = 0; day <= 6; day += 1) {
    const dayStart = day === 0 ? 60 : 0;
    if (day !== 0) {
      week.push({ day, title: "Nachtschleife", categoryName: "Archiv", start: dayStart, minutes: 360 - dayStart });
    }
    const morning = day === 0 ? 60 : 360;
    const eveningStart = day === 6 ? 1380 : 1200;
    week.push({ day, title: "Tagesprogramm", categoryName: "Talk", start: morning, minutes: eveningStart - morning });
    if (day !== 6) {
      week.push({ day, title: "Abendprogramm", categoryName: "Musik", start: 1200, minutes: 240 });
    }
  }
  // Saturday 23:00 for two hours, running into Sunday: the one deliberate carry-over.
  week.push({ day: 6, title: "Nachtschleife", categoryName: "Archiv", start: 1380, minutes: 120 });

  await replaceAllScheduleBlocks(
    week.map((block) => ({
      id: `fixture-${block.day}-${block.start}`,
      title: block.title,
      categoryName: block.categoryName,
      dayOfWeek: block.day,
      startMinuteOfDay: block.start,
      durationMinutes: block.minutes,
      poolId: pool,
      sourceName: "Lokale Bibliothek",
      repeatMode: "single"
    }))
  );

  // A broadcaster login, so the public channel page can render the one thing it is for.
  //
  // Without it watchUrl resolves to empty and the watch link is correctly absent — which left the
  // audience-facing primary action outside every screenshot. The token fields stay empty: nothing
  // here talks to Twitch, and a fixture that carries credential-shaped strings invites someone to
  // treat them as real.
  await updateTwitchConnectionRecord({
    status: "connected",
    broadcasterId: "dev-broadcaster",
    broadcasterLogin: "stream247dev",
    accessToken: "",
    refreshToken: "",
    connectedAt: STARTED_AT,
    tokenExpiresAt: "",
    lastRefreshAt: "",
    lastMetadataSyncAt: HEARTBEAT_AT,
    lastSyncedTitle: "",
    lastSyncedCategoryName: "",
    lastSyncedCategoryId: "",
    lastScheduleSyncAt: "",
    liveStatus: "live",
    viewerCount: 128,
    startedAt: STARTED_AT,
    error: ""
  });

  console.log(`Seeded a running playout runtime on "${asset.title}".`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
