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
import { readAppState, updateAssetRecords, updatePlayoutRuntime } from "../packages/db/dist/index.js";

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
  if (!state.assets.some((entry) => entry.id === ASSETS[0].id)) {
    await updateAssetRecords(ASSETS);
  }

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

  console.log(`Seeded a running playout runtime on "${asset.title}".`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
