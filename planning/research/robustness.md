# Research R3: self-healing and an adversarial bug review

- Date: 2026-10-01 / 02 (UTC).
- Base: `m75-source-breaker` at `ab42e11`, the 2.2.0 candidate.
- Branch: `claude/r3-robustness-e26toj`.
- Scope: the R3 brief. Part 1 covers self-healing. Part 2 reviews three areas adversarially: worker selection and transitions, schedule maths across midnight and daylight saving time, and migrations.
- Nothing was fixed. No product code, `PLANS.md` or `CHANGELOG.md` was touched.

## How this was checked

- **Abbreviations:** `I` = `apps/worker/src/index.ts` (9,978 lines), `DB` = `packages/db/src/index.ts`, `IC` = `apps/worker/src/incident-classes.ts`. Line numbers refer to `ab42e11`.
- **Evidence levels:**
  - **Confirmed:** shown by a probe test against the real exported functions, or by a live run of the real build.
  - **Reproduction:** the logic lives only in `I`, which cannot be imported in tests. The probe copies the cited lines verbatim and runs them next to the real core and db functions.
  - **Suspicion:** code reading only.
- **Live runs.** The worker was built (`pnpm --filter … build`) and `apps/worker/dist/index.js` ran in worker, playout and uplink mode against `postgres:16-alpine` in Docker. Twitch is unreachable from the sandbox (proxy 403), so the Twitch probe stubs only the OAuth token endpoint, through a `--import` preload.
- **Migration probes.** These ran against a real Postgres 16. Older releases were rebuilt from `git archive <tag>` (v1.5.17, v1.5.43, v2.0.0, v2.1.0-rc.2).
- **Probe location.** The probes sat under `tests/r3-probes/` (untracked, not committed). Under the brief, only this file is committed, so the probe sources are reproduced in the appendix. Each probe passes by asserting the wrong behaviour. The one exception is the migration F1 probe: it fails because it asserts the correct behaviour.
  - Command: `pnpm exec vitest run tests/r3-probes` gives `Test Files 1 failed | 14 passed (15)`, `Tests 1 failed | 46 passed (47)`. The failure is migration F1.
- **`pnpm validate` on the unchanged branch** ended with `Tests 3 failed | 2612 passed (2615)`, so validate stops before `build`.
  - **`process-utils` timeout test:** a known cloud-only failure, caused by no zombie reaping.
  - **Two time-zone-name tests** (`ops-state.test.ts:719`, `viewer-messages.test.ts:115`), with `expected 'GMT' to be 'Coordinated Universal Time'`. The cause is the sandbox's Node v22.22.0 with ICU 77.1, where `longGeneric` for UTC is `"GMT"`.
    - The shipped base image is unaffected: `docker run --rm node:22-alpine` reports v22.23.3, ICU 78.3, `"GMT+00:00"`, which the filter handles.
    - CI on `ab42e11` is green (run 36930249348, job `validate` = success).
    - See O2.

---

## Top findings

1. **A Postgres stop or crash takes the channel off air.**
   - Playout, uplink and worker all exited with code 1, 0 to 11 s after `docker stop` of Postgres.
   - Under tini, the container dies and ffmpeg with it.
   - Confirmed by a live run (S1).
2. **A rejected Twitch refresh token stalls the whole worker cycle forever.**
   - `worker.loop.crashed` repeats every 30 s.
   - No heartbeat, no incident sweep, no live status, no EventSub, no chat.
   - The Twitch status still says "connected".
   - Confirmed by a live run (S2).
3. **The web process never recovers from a failed first database bootstrap, while `/api/health` stays 200.**
   - Triggers: Postgres down at web start, or the upgrade boot losing a deadlock to an old container that is still writing.
   - Confirmed by probes (S3, M1, M2).
4. **Operator actions are lost or undone.**
   - Restart, Hard reload, Recover outputs and Refresh pressed during a cycle are erased by the cycle-end write (W4, reproduction).
   - "Remove next" is undone by a later Skip or a passed viewer skip vote, which puts the removed item on air (W2, reproduction).
5. **Schedule maths across midnight.**
   - Cuepoint inserts of a block that runs past midnight air a second time after 00:00 (C1, confirmed).
   - The Twitch schedule gets a phantom second segment one day late for every such block (C2, confirmed).
   - The overlap check misses real overlaps across midnight and rejects valid schedules (C3, confirmed; audit U21 still open).

A further notable finding is W1 (reproduction): a remote (YouTube/Twitch) insert asset never airs, and from then on every item boundary flashes the fallback for one cycle.

---

## Part 1: Self-healing

### 1.1 What recovers by itself

| Fault | Detection | Automatic action | Bound / backoff | Incident | Tested by |
|---|---|---|---|---|---|
| Hung cycle (any mode) | `runWithStallGuard` `process-utils.ts:157`, I:9889; ceiling `cycle-budget.ts:17` (300 s) | `process.exit(1)` I:9910; Compose `restart: unless-stopped` (`docker-compose.yml:80,119,144`) | one exit per 300 s hang | `<mode>.loop.stalled` I:9905 (guarded) | `worker-loop-stall-guard.test.ts`, `cycle-budget.test.ts` |
| Cycle throws while the DB is reachable | I:9913 | log, incident, alert; next cycle after 30 s / 15 s (I:9881) | fixed cadence, unbounded; alerts deduped 30 min (I:8553) | `<mode>.loop.crashed` I:9925 | sweep only (`incident-auto-resolution.test.ts`) |
| Idle Postgres client dropped | `pool.on("error")` DB:1580 | logged; the pool replaces the client | — | log (seen live) | source pin only |
| Postgres hangs under 300 s (`docker pause` 50 s) | none (no pool connect timeout, DB:1572) | queries block, then resume | stall guard at 300 s | — | live run in this research; no repo test |
| Deadlock / serialization failure on a state write | DB:1389-1396 | retry DB:4357-4387 | 3 tries, 75 ms × n | — | none |
| Playout ffmpeg exits | exit handler I:6425-6512 | immediate new cycle | crash loop = 3 short failure exits (I:849-850), then auto reset once anything is playable (I:7468-7479); no growing backoff | `playout.ffmpeg.exit` I:6533 | `ffmpeg-runtime.test.ts`, `playout-boundary.test.ts` |
| Feed not advancing | `playout-feed-health.ts:39`, I:1763 | stop, next cycle restarts | 45 s stale / 90 s grace (`managed-runtime.ts:629-630`) | `playout.feed-stall` I:1784 | `playout-feed-health.test.ts` |
| Video without audio | `feed-audio-health.ts:70`, I:1718 | stop, restart | 90 s / 60 s grace | `playout.feed-audio` I:1732 | `feed-audio-health.test.ts` |
| Remote VOD runs past its end | I:1837-1858 | planned stop | duration + 15 s (`managed-runtime.ts:634`) | — | `duration-bound.test.ts` |
| Nothing playable / preparation failure | I:7211-7218, `playout-recovery.ts` | global fallback, then generic fallback, then standby slate | 60 s resolve (I:498, I:1953) | `playout.no-asset` I:7217 | `playout-recovery.test.ts` |
| Item fails its probe 3× | `asset-probe-quarantine.ts:22`, I:1057 | item held out of selection | permanent (see 1.2) | `playout.source-unplayable.<src>` I:7677 | `asset-probe-quarantine.test.ts` |
| Source fails on 3 distinct items (M75) | `source-circuit-breaker.ts:106-150` | source held; half-open trial | 30 min, doubling to 6 h | `playout.source-breaker.<id>` I:6891 | `source-circuit-breaker.test.ts`, `source-breaker-wiring.test.ts` |
| Own network outage (M82) | `core/probe-network-outage.ts`, I:6686-6760 | failures counted by neither breaker nor quarantine | 10 s verdict | log only | `probe-network-outage.test.ts` |
| Output rejected / failing | `markDestinationFailure` I:2110-2156 | hold, prefer the next output, rejoin | 60 s cooldown (`core/src/index.ts:3655`) | `playout.destination.<id>.failed` I:2155 | `destination-failure-cooldown.test.ts` |
| Uplink never encodes / timestamp storm / out_time frozen / every destination in error | I:8424-8519, gated by `canBlameUplinkForStall` I:8403 | stop and restart in the same cycle | 300 s / storm / 45+60 s / env; **no backoff** | `uplink.*` I:8442, I:8459, I:8481, I:8516 | `uplink-progress.test.ts`, `uplink-destination-stall.test.ts`, `uplink-seam.test.ts` |
| Uplink exits (including a relay restart cutting its input) | I:8232-8286 | next uplink cycle restarts it | 15 s cadence | `uplink.process.exit` I:8272 | `uplink-progress.test.ts` |
| Program feed not fresh at the handoff | I:8321, I:8346-8358 | uplink waits (`waiting-for-feed`) and does not restart | until fresh | `program-feed.input` I:8192 | `program-feed-maintenance.test.ts` |
| Twitch's 48 h cut | direct I:7158-7181; uplink I:8362-8391 | planned stop, standby, reconnect | 48 h | — | `ffmpeg-runtime.test.ts` |
| VOD download slow or failing | `VodCacheJobRunner` I:1063, `vod-cache-jobs.ts:95-140` | job fails, cooldown; item played from Twitch or skipped | duration-scaled timeout (`vod-download-timeout.ts`) | `playout.twitch-cache.failed` I:1103 | `vod-cache-jobs.test.ts`, `vod-download-timeout.test.ts` |
| Source sync fails | per-source try/catch (I:4280, I:4326) | assets kept (`source.sync.assets_preserved` I:4222, seen live); retried | incident after 3 barren runs (`core/source-health.ts:43`) | `source.<kind>.<id>` I:4195 | `source-sync-scope.test.ts`, `source-health.test.ts` |
| Twitch record stuck on "error" with a good token | `twitch-connection-heal.ts:37`, I:8791 | validate, then reconnect | 10 min | audit | `twitch-connection-heal.test.ts` |
| Twitch 401 during sync | I:9123-9158 | refresh both tokens, retry once | one retry per cycle | `twitch.refresh.failed` I:9147 | none |
| Live status / EventSub failure | try/catch I:9293, I:9350-9410 | logged, retried next cycle | 30 s | `twitch.eventsub.sync.failed` I:9410 | `twitch-live-status.test.ts`, `eventsub-status.test.ts` |
| Chat socket silently dead / login refused | `twitch-engagement.ts:471-506`, `:36` | reconnect on the next sync | 6 min idle / 5 min cooldown | `twitch.chat.login-rejected` I:606 | `engagement.test.ts` |
| Media disk filling | `enforceDiskWatermark` I:1378 | eviction ladder | one stage per cycle | `disk.watermark.*` I:1437, I:1463 | `disk-watermark.test.ts` |
| Docker log growth | `x-logging` `docker-compose.yml:4-8` | json-file rotation | 5 × 20 MB per service | — | — |
| Stale event incidents | `resolveFinishedIncidents` I:9689-9728, IC:551-573 | closed when the area is healthy | 10 min stable, recurrence cap | audit | `incident-auto-resolution.test.ts`, `incident-classes.test.ts` |
| As-run row left open by a killed playout | I:9885 | closed as process-gone | at boot | — | `as-run.test.ts` |
| Schema drift repaired | DB:4272-4299 | resolved at a clean boot | boot | `schema.drift` | `schema-drift-check.test.ts` |
| Bootstrap race between processes | `pg_advisory_xact_lock` DB:5943 | serialised; later runners see the recorded ids | — | — | M-probe: 8 processes at once, `schema_migrations total/distinct = 34/34` |

### 1.2 What needs a human

| Fault | Where it stops | Incident | Operator action | Evidence |
|---|---|---|---|---|
| **S1 Postgres stop or crash lasting at least one cycle** | `await upsertIncident` I:9920 and `await sendAlert` I:9927 in the failed branch have no catch (the stalled branch has one, I:9899-9910). `runLoop` rejects, then `process.exit(1)` (I:9971-9976). tini is PID 1 (`docker/worker.Dockerfile:36`), so the container stops and **ffmpeg dies with it**. While the DB stays down, each restart fails its first cycle again. | none (DB down) | none possible; the broadcast drops until the DB is back | **Confirmed, live run** (below) |
| **S2 Twitch refresh token revoked or refused** | The proactive refresh at I:8847-8848 (and the broadcaster slot at I:8909-8910) has no try/catch. `reconcileTwitch` (I:9749) throws, so the heartbeat I:9776, the sweep I:9779, live status, EventSub and chat are all skipped every cycle. | `worker.loop.crashed` only; status stays `connected` | reconnect Twitch | **Confirmed, live run** |
| **S3 Web's first bootstrap fails** | `globalThis.__stream247DbReady` caches the rejected promise (DB:5936-5958). Only `resetDatabaseConnectionsForTests` clears it. `/api/health` returns 200 by design (`apps/web/app/api/health/route.ts:14-19`), and the Compose web healthcheck uses it (`docker-compose.yml:70`). | none | `docker compose restart web` | **Confirmed, probe** |
| **S4 Restart / Hard reload / Recover outputs / Refresh pressed during a cycle** | The cycle-end write I:7980 (inside I:7933) and I:7710 / I:6226 clear `restartRequestedAt` without comparing it to the value the cycle read (I:7506). `pendingAction` is cleared the same way (I:8013-8014). Already listed in `PLANS.md:4569-4573`. | none | press again | **Reproduction** (W4) |
| Disk / system-volume incident open across a restart | The open flags live only in memory (I:1243, I:1478). Resolution needs the flag (I:1404-1417; `system-volume.ts:57-58` returns only raise/none). The sweep never closes state incidents (IC:748). | stays open | resolve by hand | Suspicion (code reading) |
| Wrong `APP_SECRET` | `secrets.key-mismatch` is only ever upserted (DB:1668-1695) | critical, never closed | restore the secret, resolve by hand | code reading |
| Item quarantined | permanent (`asset-probe-quarantine.ts:17-22`; the counter is kept on sync, DB:6339-6343) | `playout.source-unplayable.<src>` | clear the quarantine on the asset | code reading, intended (Q1) |
| Crash loop with nothing playable | I:7482-7500 | `playout.crash-loop` says "Manual intervention is required" (I:7489), which overstates it when media exists | add media or a fallback | code reading |
| Disk full with nothing evictable / system volume low | I:1425-1437 / I:1480-1525 | `disk.watermark.exhausted`, `system.volume.low` | free space | code reading |
| Bad stream key | retried every 60 s forever (I:2110-2156) | `playout.destination.<id>.failed` | fix the key | code reading |
| Process alive but unhealthy | Compose restarts on exit only, never on `unhealthy`. There is no autoheal, and the relay has no healthcheck (`docker-compose.yml:100-116`). | healthcheck log | restart the container | code reading |
| yt-dlp listing or VOD metadata hangs | `execFileText` with no `timeoutMs` (I:4120, I:4447; `process-utils.ts:127` arms a timer only if > 0) | `worker.loop.stalled` after 300 s, then a worker restart | none | Suspicion |
| Twitch HTTP response hangs | 6 `fetch` calls with no timeout (I:3647, 3746, 8700, 8743, 8991, 9044) | stall guard at 300 s | none | Suspicion |

**S1 evidence.**
- Setup: real `apps/worker/dist/index.js` in three modes against `r3-selfheal-pg`, then `docker stop -t 5 r3-selfheal-pg` at 22:50:31, a 45 s wait, then `docker start`.
- Output:
  ```
  playout: 22:50:31.192 db.pool.idle_client_error "terminating connection due to administrator command"
           22:50:42.557 worker.loop.crashed  "connect ECONNREFUSED 127.0.0.1:55432"
           22:50:42.559 worker.process.failed …   EXITED code=1 at 22:50:42 after 61s
  worker:  22:50:45.997 worker.loop.crashed … 22:50:45.998 worker.process.failed …  EXITED code=1
  uplink:  22:50:31.396 worker.loop.crashed … worker.process.failed …  EXITED code=1 at 22:50:31
  ```
- Limits, also measured:
  - `docker restart` (0.43 s down): all three survived, because no cycle query landed in the gap.
  - `docker pause` for 50 s: all three survived, because queries hang without a connect timeout.
- So a refused-connection window that overlaps a cycle query is what kills a process. A Postgres stop or crash lasting one cycle or more (15 s playout and uplink, 30 s worker) is certain to. Examples are a Postgres image update, an OOM kill of Postgres, or a host-level restart of only the DB container.

**S2 evidence.**
- Setup: real worker binary, real Postgres, `twitch_connection` seeded `status=connected` with `tokenExpiresAt` = now − 60 s. A `--import fetch-stub.mjs` preload answers only `id.twitch.tv/oauth2/token` with HTTP 400.
- Command: `timeout 140 node --import fetch-stub.mjs apps/worker/dist/index.js worker`
- Output:
  ```
  22:56:17.853 r3-stub oauth2/token 400
  22:56:17.854 worker.loop.crashed "Twitch token refresh failed with status 400."
  22:56:48 … 22:57:19 … 22:57:50 … 22:58:21 … worker.loop.crashed (same, every 30 s)
  healthcheck worker → "No worker heartbeat has been recorded yet."  exit=1
  incidents: worker.loop.crashed | open     (no twitch.refresh.failed row)
  twitch_connection: connected|…|           (status unchanged, error empty)
  ```
- Control run: the same with `token_expires_at` in 2030 ran 45 s with no `loop.crashed`, and `healthcheck worker` exit=0.
- A Twitch 5xx or network outage while the token is within 5 min of expiry causes the same stall until Twitch answers again.

**S3 evidence.**
- Probe: `tests/r3-probes/selfheal/ensure-database-cached-rejection.test.ts`.
- Output:
  ```
  [probe] ensureDatabase #1 (db down): connect ECONNREFUSED 127.0.0.1:55499
  [probe] ensureDatabase #2 (db up): connect ECONNREFUSED 127.0.0.1:55499
  [probe] same cached error object: true
  [probe] getDatabaseHealth (db up): error
  [probe] ensureDatabase #3 after resetDatabaseConnectionsForTests: ok
  ```
- A web process that bootstrapped once survives later outages, because the pool reconnects. The bug applies when web starts or restarts while Postgres is down or still starting, or when the bootstrap loses a deadlock (M2).

### 1.3 Where automatic recovery is missing and would be safe

Constraint on every item: nothing here writes Pin, Fallback, Insert, Skip, `includeInProgramming` or a breaker the operator closed (`packages/core/src/operator-precedence.ts`; M78/M79). Nothing restarts a healthy ffmpeg, and nothing touches the relay pin `bluenviron/mediamtx:1.15.4`.

| # | Proposal | Trigger and bound | Why safe | Effort | Risk |
|---|---|---|---|---|---|
| H1 | **Isolate the Twitch refresh.** Wrap I:8847 and I:8909 in try/catch: write `twitch.refresh.failed` and return from that step only. On HTTP 400 `invalid_grant`, set the identity status to `error` with a state incident "reconnect Twitch" (Q3). Better still, run each integration step of `runWorkerCycle` isolated, so the heartbeat and the sweep always run. | the refresh throws; the existing heal re-checks every 10 min | moves no on-air state; the heal path exists | S | low. An unrefreshable but still valid access token can flip between error and connected until it expires (≤ 4 h); the heal should skip expired tokens. |
| H2 | **Survive a database blip.** Guard I:9920-9927 like the stalled branch. Exit only after N consecutive failed cycles (Q2, proposed 5 min). Add `connectionTimeoutMillis` to the pool (DB:1572) so a hang fails fast instead of using up the 300 s stall budget. | refused DB connection; bounded by N | ffmpeg keeps playing its resolved input; a long outage still ends in an exit | S–M | medium: a half-dead process for at most N cycles |
| H3 | **Retry a failed bootstrap.** Clear `__stream247DbReady` when the promise rejects. Retry on `40P01` / `55P03` with backoff. Run migrations with `SET LOCAL lock_timeout` (M1, M2). | each call after a failure | the advisory lock serialises retries; a failed boot rolls back completely (M-probe) | S | low |
| H4 | **Keep a newer operator request.** Clear `restartRequestedAt` and `pendingAction` only if the row still holds the value this cycle read, like `decideCycleEndInsert` (`playout-boundary.ts:392`). | every cycle end | carries out the operator's own action | S–M | medium: direct-mode reconnect reuses the field as its window start (I:7165-7178), so it needs a direct- and relay-mode soak, as `PLANS.md:4569-4573` says |
| H5 | **Re-arm state incidents after a restart.** Seed the disk and system-volume flags from open incidents on the first cycle. Resolve `secrets.key-mismatch` at a boot where every secret decrypts. | first cycle / boot | re-measures the condition before closing | S | low |
| H6 | **Time out external calls.** Add `timeoutMs` to the yt-dlp calls (I:4120, I:4447), clamped by `clampToCycleAwaitCeiling`, and `AbortSignal.timeout` to the six worker fetches. | per call | turns a 300 s stall and restart into one failed step | S | low |
| H7 | **Back off.** Use a growing backoff for the crash-loop reset (I:7468) and the uplink watchdog restarts (I:8527-8537), up to 5 min. Correct the "Manual intervention" text. | per trigger | bounded restarts | M | medium: dark time grows |
| H8 | **Restart on unhealthy, without a new dependency.** Let each process exit after its own healthcheck condition has failed for N minutes. The healthcheck logic already exists (I:9795, I:9832). Optionally add a relay healthcheck for observability. | N minutes unhealthy | uses Compose's existing restart-on-exit | S–M | medium: a wrong N restarts a playing channel; never apply to playout while its feed advances (Q7) |
| H9 | **Re-probe quarantined items slowly** (Q1). One trial per item per 24 h, at most one per source per cycle. Only while the breaker is closed and no outage verdict holds. | 24 h | failure changes nothing; the operator can still clear by hand | S–M | low |

---

## Part 2: Adversarial review

### 2.1 Worker selection and transitions

**W1. A remote insert asset never airs, and the fallback flashes at every boundary from then on.** Reproduction.

- **Evidence: no quarantine or breaker check.** The automatic insert (I:5403-5416) and `getCuepointInsertPlan` (`cuepoints.ts:76-87`) check only `ready`, `includeInProgramming` and the skip hold. They do not check quarantine or the source breaker, which every other selection path applies (I:4686; `docs/operations.md:409ff`).
- **Evidence: never warmed.** The rotation excludes the insert asset (I:4687), so it never enters the queue scan that fills the probe cache (I:4870, I:4886).
- **Evidence: bridged instead of played.** At the boundary, `isExpensiveQueueResolve` is true for YouTube/Twitch, so a local fallback is bridged in (I:7277-7296).
- **Evidence: counter never consumed.** The fallback replaced the selection, so the `scheduled_insert` counter reset (I:8044-8056) never runs and no cuepoint fired key is written (I:7909). The next cycle sees the fallback running and skips both insert checks (I:5404, I:5423). The same repeats at every boundary.
- **Evidence: no protection for a broken insert.** A broken insert of any kind is retried the same way: `decideInsertAfterPrepareFailure` (`playout-boundary.ts:279-287`). It is never quarantined, because it is never queue-probed, and it never opens the breaker, because it is one item.
- **Probe:** `tests/r3-probes/selection/failing-pool-insert.probe.test.ts` (3 tests).
- **Impact:** inserts with a remote asset silently never air. One cycle of fallback at every item boundary, and a flapping "preparation failed" incident. Local-file stings are not affected.
- **Proposal:**
  - Warm the due insert in the queue scan.
  - Count a failed or bridged insert as consumed (Q6).
  - Apply `isAssetBlockedForAutomaticSelection` and the breaker gate to both insert checks.
- **Effort / risk:** M / low–medium.

**W2. "Remove next" is undone by a later Skip or a passed viewer skip vote.** Reproduction with real core functions.

- **Evidence: one shared slot.** Remove next, Skip and the chat vote all write the single `skipAssetId`/`skipUntil` slot (`apps/web/lib/server/broadcast.ts:398-406` and `:458-470`; I:9483-9492).
- **Evidence: the scenario.** B is on air and the operator removed C, the next item. A passed vote on B (`decidePassedSkipVote` checks only that the hold is not already on B) moves the hold to B. `nextPoolRotationAsset` then picks **C**; without the vote it picks D. The operator's own Skip does the same.
- **Probe:** `tests/r3-probes/selection/remove-next-vs-skip-hold.probe.test.ts`.
- **Conflict with docs and milestones:** `docs/operations.md:85` says Remove next holds the item out for an hour. M78/M79 say viewers never override the operator.
- **Proposal:** a separate Remove-next hold, or a small set of holds (Q5).
- **Effort / risk:** M (schema, web and worker) / low.

**W3 = C1** (cuepoints after midnight). This was found independently by the selection review and the schedule review; see 2.2.

**W4. The cycle-end write erases operator requests made while a cycle runs.** Reproduction.

- **Evidence: what gets cleared.** I:7980 and I:8013-8014 clear `restartRequestedAt` (except for a scheduled reconnect) and `pendingAction` on the fresh row. A cycle can take up to minutes (resolves up to 60 s, probes, start). Nothing wakes the playout on a web write (no LISTEN).
- **Evidence: who is affected.** Writers: `apps/web/lib/server/broadcast.ts` restart/hard_reload (:85), force_reconnect (:115), recover_outputs (:163), and the non-relay fallback, resume and override paths (:243, :269, :500).
- **Evidence: knock-on effects.**
  - "Move next" followed by Skip then waits a whole item, because the Move next check needs `restartRequestedAt` (I:5371-5376).
  - The start/switch failure writes (I:7790, I:7866) also clear `insertAssetId` without a check, wiping a Play now written during the cycle.
- **Probes:**
  - `tests/r3-probes/selection/cycle-end-erases-restart.probe.test.ts` (4 tests).
  - `tests/r3-probes/selfheal/restart-flag-swallowed.repro.test.ts`, run against real `updatePlayoutRuntime` and Postgres. Output: `press timestamp written by web: …23:01:00.146Z` / `restartRequestedAt seen by cycle N+1: ""`.
- **Proposal:** H4.

**W5. The week view and the worker disagree on the cuepoint asset.** Confirmed.

- **Evidence:** the worker uses `block.cuepointAssetId || pool.insertAssetId` whatever the cadence is (`cuepoints.ts:76`; the existing unit test relies on it with `insertEveryItems: 0`). `materializePoolWindow` falls back only when the cadence is above 0 (`packages/core/src/index.ts:3010-3020`).
- **Result:** for the same block the week view shows `cuepointCount 0` and lists the sting as a normal item, while the worker airs 2 cuepoint inserts.
- **Probe:** `tests/r3-probes/selection/cuepoint-preview-divergence.probe.test.ts`.
- **Proposal:** one shared "cuepoint asset of a block" helper.
- **Effort / risk:** S / very low.

**W6. After an input-open failure the item is dropped, and a queued Move next or a due insert slips by one item.** Reproduction / suspicion.

- **Evidence:**
  - After an unplanned exit, `currentAssetId` stays set and the status is `failed` (I:6453).
  - The pool pointer already names the failed item, so `nextPoolRotationAsset` moves on.
  - `docs/operations.md:383` and I:6402-6420 suggest a stale googlevideo URL is re-resolved "on the next attempt", but that attempt only comes when the rotation comes round again.
- **Probe:** `tests/r3-probes/selection/crash-abandons-item.probe.test.ts`.
- **Note:** resuming mid-item is M77, which is deferred. Retrying an item that never started is not M77.
- **Proposal:** retry the same item once after an immediate input-open failure, and treat `failed` like an empty `currentAssetId` in the Move next and insert checks.
- **Effort / risk:** S–M / low–medium (crash-loop interplay).

**W7. A late exit of an abandoned ffmpeg wipes the state of its replacement.** Audit U33, still present. Confirmed (static probe).

- **Evidence:** the playout exit handler (I:6317) runs `stopSceneRendererLoop(); playoutProcess = null; playoutAssetId = ""…` (I:6350-6358) without the `playoutProcess === currentProcess` guard that `finalize` has (I:5601).
- **Trigger:** only after the 20 s stop deadline (I:884, I:5643-5649), for example a hung mount.
- **Impact:** the replacement is orphaned with no watchdog or overlay writer, and a third process is spawned onto the same `program.m3u8`.
- **Proposal:** return early when the exiting child is not the current one.
- **Effort / risk:** S / low.
- **Not checked:** the uplink exit handler (I:8232) may have the same pattern.

**W8. The standby/reconnect slate in scene mode keeps the previous item's overlay.** Audit U32, still present. Confirmed (static probe).

- **Evidence:** `writeStandbySlate` (I:3490-3526) writes only the text file. `currentScenePayload` is assigned only at I:3621. `ensureScenePayload` returns early when a payload exists (I:3207-3210). The scene branch of the standby command composites only the PNG pipe (I:2586-2611).
- **Impact:** during standby or reconnect, viewers see the previous item's title as if it were on air.
- **Proposal:** set the standby payload in `writeStandbySlate`.
- **Effort / risk:** S–M / medium (changes the on-air picture; needs a visual check).

**Checked and sound:**
- Pool rotation: alternation, looping, a vanished per-source cursor, a pointer from a removed source, duplicate or empty source ids, a single-item pool whose item is held, and the breaker trial gate (`pool-rotation.ts`, well covered by `tests/unit/pool-rotation.test.ts`).
- Stable item order (`compareProgrammingAssets`).
- NaN, negative and infinite durations (estimate fallback; `shouldEndAssetAtDurationBound` refuses non-finite input).
- `updatePoolCursor` runs under the state lock.
- Operator-precedence rules: the vote is decided on the fresh row.
- Block handoff: a running item of another pool plays to its end, as documented. Back-to-back blocks of one pool continue.
- Insert and audio-lane exclusion agree between the worker, the preview and the week view.

### 2.2 Schedule maths across midnight and daylight saving time

Probes: `tests/r3-probes/schedule/*.test.ts` (appendix). Zone used: Europe/Berlin.

**C1. Cuepoints of a block that runs past midnight fire again after 00:00.** Confirmed.

- **Evidence:** the occurrence key carries the date and changes at midnight: `2026-10-03:late:1380:120` becomes `2026-10-04:late:1380:120:carry` (`toScheduleOccurrence`, `packages/core/src/index.ts:3406`). The fired list is kept only while the key is unchanged (I:7906-7908, `cuepoints.ts:88-89`).
- **Probe P10:** a Saturday 23:00 block with 120 min and cuepoints at 900 s and 2700 s. Both aired before midnight; at 00:05, `getCuepointInsertPlan` returns offset 900 again.
  ```
  P10 keys: 2026-10-03:late:1380:120 -> 2026-10-04:late:1380:120:carry | plan after midnight: 900 2026-10-04:late:1380:120:carry@900
  ```
- **Impact:** every cuepoint that aired before midnight airs again, one per boundary.
- **Proposal:** key fired cuepoints by block id and start date, the same for the evening part and the carry-over.
- **Effort / risk:** S / low.

**C2. The Twitch schedule sync posts a phantom segment one day late for every block that runs past midnight.** Confirmed for the core functions. That `syncTwitchSchedule` feeds every occurrence of the 7-day window into `toUtcIsoForLocalDateTime(date, startMinuteOfDay)` (I:8630-8643, I:8665-8669) is code reading; the probe makes the same two core calls.

- **Evidence:** the 7-day window includes carry-over occurrences. A carry-over keeps `startMinuteOfDay` 1380 but carries the *next* date, and `start_time` is computed from `date + startMinuteOfDay`.
  ```
  P3 tuesday occurrences: [{"key":"2026-10-06:mon-late:1380:120:carry","date":"2026-10-06","startMinuteOfDay":1380,"carry":true}]
  P3 real segment start: 2026-10-05T21:00:00.000Z phantom segment start: 2026-10-06T21:00:00.000Z
  ```
- **Impact on Twitch:**
  - Twitch shows a Monday 23:00 block a second time on Tuesday 23:00.
  - With a daily 23:00–01:00 block, every day gets two identical segments.
  - **Suspicion, not checked because Twitch is unreachable:** if Twitch rejects the overlapping duplicate, the sync throws mid-loop. Segments already created are then not recorded (`replaceTwitchScheduleSegments` I:8757 is never reached), so each 15-minute sync could create them again.
- **Proposal:** skip `carriesOverFromPreviousDay` occurrences in the sync. Record each created segment before the next request.
- **Effort / risk:** S / low.

**C3. The overlap check is wrong across midnight.** Audit U21, still present. Confirmed.

- **Evidence:** `findScheduleConflicts` (`packages/core/src/index.ts:3308-3357`) folds the after-midnight part onto the *same* weekday and compares only same-weekday blocks.
  ```
  P1 conflicts: []                                  (Sat 23:00+240 vs Sun 01:00+120: real overlap, missed)
  P1 on air Sun 01:30: sun-early                   (worker: latest start wins, Saturday block cut)
  P2 conflicts: ["sat-late","sat-early"]            (Sat 23:00+240 vs Sat 01:00+120: no overlap, rejected)
  ```
- **Impact:** the API rejects a valid schedule (`apps/web/app/api/schedule/blocks/route.ts:143,275,390`; templates `route.ts:175`) and accepts one that cuts a block short.
- **Proposal:** compare occurrences on a 7-day minute line (`dayOfWeek*1440 + start`, modulo 10080).
- **Effort / risk:** S / low. Saved schedules that are now "conflicting" must stay loadable.

**C4. An unusable `CHANNEL_TIMEZONE` in the environment breaks every schedule read.** Confirmed for the throw.

- **Evidence:** the wizard validates the managed value (`apps/web/app/api/settings/instance/route.ts:44`), but the env value wins and is never validated (`packages/db/src/instance-config.ts:34`).
  ```
  P9 resolved zone: Europe/Berln usable: false
  P9 getCurrentScheduleMoment: RangeError: Invalid time zone specified: Europe/Berln
  ```
- **Suspicion (code reading):** `getCurrentScheduleItem` (I:4644) runs inside every playout cycle (I:7507), and the web uses the same resolver (`apps/web/lib/server/state.ts:286-289`). A typo in `stack.env` would therefore crash every playout cycle and every schedule-showing page, and the channel would go dark at the end of the current item.
- **Proposal:** in `resolveChannelTimeZone`, fall back to the managed value, then UTC, when the env value fails `isUsableTimeZone`, and raise a state incident. Check at boot.
- **Effort / risk:** S / low.

**C5. Daylight saving time: the schedule runs on wall-clock time, and some numbers count wall-clock minutes.** Confirmed behaviour; whether it is wrong is a product question (Q4).

- **P6:** on the spring-forward Sunday a block 02:00+60 is never on air (0 minutes).
- **P7:** on the fall-back Sunday the same block is on air for 120 real minutes, and the following block starts 1 h later in real time.
- **P8:** cuepoint elapsed time counts wall-clock minutes. A block from 01:00 at 03:30 on the spring-forward day reports 9000 s after 5400 real seconds, so a cuepoint fires up to 1 h early.
- **P4:** a non-existent local time maps one hour *early*: 02:30 on 2026-03-29 gives `2026-03-29T00:30:00.000Z`, which is 01:30 local. The Twitch segment for such a block is posted at 01:30.
- **P5:** an ambiguous time (02:30 on 2026-10-25) maps to the second occurrence (`01:30Z`).
- **Twitch duration** stays the wall-clock duration, so the posted end is 1 h off on both switch nights.
- **Impact:** twice a year, for blocks touching 02:00–03:00 (Europe).
- **Proposal:** keep wall clock (Q4), document it, compute cuepoint elapsed time from real instants, and map non-existent times forward.
- **Effort / risk:** S / low.

**C6. The week view counts a block that runs past midnight in full on both days.** Confirmed.

```
P11 scheduled minutes per day: 2026-10-05:120 2026-10-06:120 2026-10-07:0 … sum: 240
```

- `buildMaterializedProgrammingWeek` sums `durationMinutes` of carry-overs (`packages/core/src/index.ts:3233`). The UI shows "m scheduled" (`apps/web/components/program-week-lens.tsx:29`, `schedule-editor-workspace.tsx:191`).
- **Proposal:** count only the part inside the day.
- **Effort / risk:** S / very low.

**Sound:**
- `findCurrentScheduleOccurrence` (minute ranges, carry-overs, newest start wins).
- `listUpcomingScheduleOccurrences` (never offers a carry-over as upcoming).
- `findNextScheduleOccurrenceAcrossDays`.
- Exactly-midnight ends (a 23:00+60 block is not carried).
- 1440-minute blocks.
- The Saturday to Sunday wrap in `buildScheduleOccurrences`.

### 2.3 Migrations and bootstrap (real Postgres 16)

**M1 = S3.** A failed bootstrap is never retried in that process. Confirmed by two independent probes. Proposal: H3.

**M2. The upgrade boot can lose a deadlock to an old-release process that is still writing.** Confirmed with a synthetic but realistic lock order.

- **Evidence:** all pending DDL runs in one transaction under `pg_advisory_xact_lock` (DB:5940-5944). Each `ALTER TABLE` holds ACCESS EXCLUSIVE until COMMIT. There is no `lock_timeout` and no retry.
- **Setup:** a v1.5.43 DB, where the boot alters `overlay_settings` before `pools`, and an "old writer" `BEGIN; UPDATE pools …; pg_sleep(x); UPDATE overlay_settings …; COMMIT`.
  ```
  sleep=0.6s boot={"ok":false,"code":"40P01","error":"deadlock detected"} old-writer=committed recorded-post-0903=0
  sleep=1.2s boot={"ok":true} old-writer=ERROR: deadlock detected recorded-post-0903=6
  ```
- **Result:** either side can lose, and the rollback is clean.
- **Impact:** during `docker compose up -d`, while an old container still writes:
  - if the new web loses, M1 leaves it dead;
  - if a worker process loses, it exits and retries;
  - even without a deadlock, the boot waits with no bound.
- **Proposal:** H3 plus `SET LOCAL lock_timeout`.
- **Effort / risk:** S–M / low–medium.

**M3. A `CREATE TABLE IF NOT EXISTS` over an existing incompatible table is recorded as applied.** Confirmed.

- **Evidence:** a hand-made `source_breakers (source_id TEXT PRIMARY KEY)` led to `migration recorded = 1` and the drift incident `critical 6 declared column(s) are absent: source_breakers.cooldown_seconds, …`.
- The drift check (`findMissingDeclaredColumns` DB:4204) compares column names only. Missing indexes, defaults, constraints and type changes are never reported.
- **Proposal:** extend the declared schema to cover index names and column types.
- **Effort / risk:** M / low.

**M4. The audit trail stores secrets verbatim, and the one-shot redaction migration does not cover rows written since then.** Confirmed.

- **Evidence:** `appendAuditEvent` (DB:6057-6060) inserts `message` without `redactSecrets`. `upsertIncident` does redact.
  ```
  audit_events.message = publish to rtmp://live.twitch.tv/app/live_987654321_zyxwvutsrqponmlkjihg failed
  incidents.message    = rtmp://live.twitch.tv/app/<redacted>
  ```
- A key written by v1.5.43, v2.0.0 or v2.1.0-rc.2 survives the upgrade, because `20260902_001_redact_stored_secrets` is already recorded. Worker audit messages embed error text (I:6926, I:7354).
- **Impact:** a stream key can sit in the audit log and on the dashboard. This conflicts with the rule never to show a stream key.
- **Proposal:** redact in `appendAuditEvent`, and add a second redaction migration under a new id.
- **Effort / risk:** S / low.
- The probe used a synthetic key, never a real one.

**M5. One malformed `custom_layers_json` would block every upgrade from before the named-scenes migration.** Suspicion.

- **Evidence:** the cast `…::json` at DB:3955-3971 throws on non-JSON text, and the whole boot rolls back on every start. Writers use `JSON.stringify`, so this needs a corrupted or hand-edited row.
- **Proposal:** guard the cast (`pg_input_is_valid`, Postgres 16).
- **Effort:** S.

**M6. Merge artefact.** `20260825_007_asset_chapter_probe` (around DB:3745-3752) repeats three `ADD COLUMN IF NOT EXISTS` lines that belong to `20260907_001`. Harmless. Leave applied migrations as they are.

**Verified sound (probes):**
- **Concurrency:** 8 processes bootstrapping an empty DB at once ended with `schema_migrations total|distinct = 34|34`, no double seeding, and a schema identical to a fresh install. 8 processes upgrading a v2.0.0 DB at once went `31 -> 34|34` with no errors.
- **Upgrades:** v1.5.17, v1.5.43, v2.0.0 and v2.1.0-rc.2 DBs with data, each seeded through the old release's own API, upgraded cleanly. The catalog diff against a fresh install (columns with type, NOT NULL, default and identity; indexes; constraints) showed **0 differences** for all four. A second boot was idempotent.
- **Failure atomicity:** a migration failing halfway rolled back everything, recorded nothing, and was retried and applied after the conflict was removed.
- **Downgrade:** v1.5.43, v2.0.0 and v2.1.0-rc.2 builds could boot, read and write the migrated DB. A newer column value survived an old full-state write.
- **Ordering:** 34 unconditional `push` calls with 34 unique ids; the `if (!some)` guards only prevent duplicates.
- **Destructive steps:** the only `DROP` is `presence_windows_pkey`, which is re-added with the data kept. The `UPDATE`s without `WHERE` only normalise values and are idempotent. There is no `ALTER TYPE`, `TRUNCATE`, or `NOT NULL` without a default on a populated table.

### 2.4 Older audit findings that bear on robustness (`planning/audit-2026-09-02.md`)

| ID | Verdict | Evidence | Proposal | Effort |
|---|---|---|---|---|
| U3 | still present, confirmed | The Live page drift panel uses 45 s (`apps/web/lib/server/state.ts:1587,1596`) while readiness and the worker use 60 s (`readiness.ts:97`, I:487). Probe: a 50 s old heartbeat gives drift `"Playout heartbeat is stale."` and readiness `playout: ok`. In HLS mode readiness uses the feed time (`readiness.ts:78-84`), so the two can disagree for longer. | one shared constant and one effective-heartbeat function | S |
| U14 | still present, confirmed; partly mitigated by M57 E | The rollback relay URLs default to unkeyed `rtmp://relay:1935/live/program` (`apps/worker/src/ffmpeg-runtime.ts:99,103`, `.env.example:25-26`, `.env.production.example:42-43`), which the relay policy denies (`packages/core/src/relay-ingest.ts:183-192`; probe: `{"allow":false,"reason":"bad-internal-key"}`). The worker never reads the key. | derive the keyed URL in the worker when the env URL has no `pass=`, or raise an incident at boot | S–M |
| U15 | still present, confirmed | No CI smoke runs playout → HLS → uplink. Three smokes write a file output with the relay off; `fresh-compose` turns the relay on but only checks readiness (`.github/workflows/ci.yml:157-182`). | a relay-on runtime smoke that asserts `program.m3u8` MEDIA-SEQUENCE grows and the uplink output grows | M–L |
| U18 | still present, confirmed | `scripts/soak-monitor.sh:120-125,155` count restarts for web, worker and playout only, not **uplink** or relay. | one shared service list including uplink and relay | S |
| U30 | still present, partly intended | The worker heartbeat threshold of 240 s is declared three times (I:485, `readiness.ts:6`, `state.ts:1539`); the incident engine uses 120 s on purpose (IC:575-576). | one shared constant | S |
| U31 | fixed in 1.5.42 | `CHANGELOG.md:743-772`; guarded by `tests/unit/on-air-overlay-mode-wiring.test.ts:48` | — | — |
| U32 | still present | see W8 | — | — |
| U33 | still present | see W7 | — | — |
| U37 | fixed in 2.1.0-rc.2 | `CHANGELOG.md:51`; `updateAssetCacheRecords` DB:6439-6459; `updateAssetRecords` has no callers left | optional: delete the dead function | S |

The other 30 unverified audit findings were outside R3 and were not triaged.

### 2.5 Other observations

- **O1.** U18 matters for the release gate: an uplink container that crashes and comes back inside the 60 s staleness window passes the 24 h soak today.
- **O2.** Two unit tests (`ops-state.test.ts:719`, `viewer-messages.test.ts:115`) assert an ICU-version-dependent string. They fail on Node v22.22.0 / ICU 77.1 (`"GMT"`) and pass on the current `node:22-alpine` (v22.23.3 / ICU 78.3, `"GMT+00:00"`) and in CI. The product code accepts both forms only partly: `formatViewerTimeZoneName` filters `GMT+…` but not a bare `GMT`. Low risk, and it shows only on that ICU version.

---

## Proposed milestones (for the "Vorschlag" thread)

Numbering is left to the Vorschlag thread (the next free number is M84). Priority: Now = before more features.

| Milestone | Type | Priority | Goal | Acceptance | Touched areas | Risk | Rollback |
|---|---|---|---|---|---|---|---|
| A Database Blip Does Not Take The Channel Off Air | Reliability | Now | A Postgres stop or restart leaves ffmpeg and the uplink running | H2 + H3. New unit tests: a pure counter (below N no exit, at N exit) and the cached-rejection retry. A source pin on the guarded branch. Re-run the S1 harness: `docker stop` of Postgres for 45 s leaves all three processes alive. DUT check (owner): `docker compose stop postgres; sleep 45; docker compose start postgres` during air, then the playout and uplink `StartedAt` are unchanged | worker, db, tests, docs | medium | revert commit |
| The Worker Cycle Survives A Twitch Refresh Failure | Reliability | Now | A dead refresh token costs one incident, not the whole cycle | H1. Test: refresh throws → heartbeat written, sweep runs, `twitch.refresh.failed` open, no `worker.loop.crashed`. `invalid_grant` → status `error` with a state incident. Re-run the S2 harness | worker, core, tests, docs | low | revert commit |
| Operator Actions Are Never Lost | Behavior | Now | Restart, Hard reload, Recover outputs, Refresh and Remove next do what the operator pressed | H4 + W2. A pure `decideCycleEndRestartFlag` table (same → clear, newer → keep, reconnect window → keep). A Remove-next hold that Skip and votes do not overwrite. Probes W2 and W4 turned into tests. Soak in direct and relay mode | worker, web, db, tests, docs | medium | revert commit |
| Schedule Maths Across Midnight | Bug | Now | A block past midnight behaves like one block everywhere | C1 (date-independent cuepoint key), C2 (no carry-over segments; record each created segment), C3 (7-day overlap line), C6. Probes P1-P3, P10 and P11 turned into tests | core, worker, web, tests, docs | low | revert commit |
| Inserts From Remote Sources Air | Bug | Next | A YouTube or Twitch insert airs, or is skipped once, never forever | W1 (warm, consume, gate), W5. Probe W1 turned into tests | worker, core, tests, docs | low–medium | revert commit |
| Safe Configuration And Upgrades | Reliability | Next | A typo or an upgrade never takes the channel down | C4, M2 (`lock_timeout`, retry), M4 (audit redaction plus a new migration), M5 (guarded cast). Tests for each | db, core, worker, tests, docs | low | revert commit; the redaction migration is one-way (it removes secrets) |
| Self-Healing Fills The Gaps | Reliability | Next | No stale incident, no endless hang, no orphan encoder | H5, H6, W7, U3/U30 shared constants, U18 soak lists | worker, web, scripts, tests | low | revert commit |
| The Production Path Has A Smoke | Test | Next | CI exercises playout → HLS → uplink | U15 smoke in CI | scripts, CI | low (CI only) | revert commit |
| Standby Shows Standby | Bug | Later | The standby slate never shows the previous item | W8 plus a design-baseline check | worker, tests | medium | revert commit |
| Backoff And Health Restarts | Reliability | Later | Repeated restarts slow down; a hung process restarts itself | H7, H8 (after Q7) | worker, compose, docs | medium | revert commit |

## Questions for Benjamin

1. **Should quarantined items get a slow re-probe** (one try per item per 24 h, only while the breaker is closed and no outage verdict holds)? *Recommendation: yes. Otherwise a YouTube item that heals never returns, and a failed try changes nothing.*
2. **How long may the database be unreachable before playout gives up and restarts?** *Recommendation: 5 minutes. That covers a Postgres restart or image update, and a broken DB still ends in a visible restart.*
3. **When Twitch rejects the refresh token, should the account show "error"** (chat, metadata and EventSub visibly off, incident "reconnect Twitch") instead of "connected" while nothing works? *Recommendation: yes.*
4. **Daylight saving time: should blocks follow the wall clock?** A 20:00 block stays at 20:00 local. A block inside 02:00–03:00 is skipped in March and plays twice in October. *Recommendation: yes, keep the wall clock, document it, and only fix the counts (cuepoint timing, Twitch segment start and end).*
5. **Should "Remove next" survive a later Skip or a passed viewer skip vote?** *Recommendation: yes. The operator wins, as M78/M79 already say for Pin and inserts.*
6. **A due insert that cannot be prepared (remote, broken or held): skip it this round, or keep retrying?** *Recommendation: skip it once, count it as played, and raise an incident naming the insert.*
7. **Should a process restart itself when its own healthcheck has failed for N minutes?** Compose ignores "unhealthy" today. *Recommendation: yes for worker and uplink (N = 5 min). For playout only when the feed does not advance, so a playing channel is never cut.*

## What could not be checked

- Anything on the DUT or Portainer host:
  - the real restart behaviour of the production stack (S1 was run with the same image layout and entrypoint locally, not on the DUT);
  - whether Postgres has ever stopped there during air.
- The Twitch API, which is blocked by the sandbox proxy:
  - whether overlapping schedule segments are rejected (C2 follow-on);
  - real refresh responses (S2 used a stub that answers 400).
- ffmpeg, yt-dlp and mediamtx end to end. There was no media and no stream target in the sandbox. W1 and W6 rest on reproductions of `I`.
- The real timing of the W4 race against a running playout.
- Releases older than v1.5.17 (no `packages/db` in those tags). Large-table migration timing. Postgres versions other than 16.
- Next.js with several route bundles sharing `globalThis` (S3 was shown with the db package directly).
- The remaining 30 unverified findings of `planning/audit-2026-09-02.md`.
- The uplink exit handler (I:8232) for the W7 pattern.

---

## Appendix: probe sources

Reproduce with `pnpm install`, then place each file at its path and run `pnpm exec vitest run tests/r3-probes`.
- Probes under `selfheal/` expect `postgres:16-alpine` on 127.0.0.1:55432 (`docker run -d --name r3-selfheal-pg -e POSTGRES_USER=stream247 -e POSTGRES_PASSWORD=stream247 -e POSTGRES_DB=stream247 -p 127.0.0.1:55432:5432 postgres:16-alpine`). The restart probe also needs `CREATE DATABASE r3restart`.
- Migration probes start their own containers (`r3-mig-*`).
- Bundles built from old tags (`migrations/old/`) and schema dumps (`migrations/out/`) are generated and not reproduced here.


<details><summary><code>tests/r3-probes/audit/u-static-source-probes.test.ts</code></summary>

```ts
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Static probes for audit findings whose code lives in apps/worker/src/index.ts (not importable) or in scripts.
const root = path.resolve(import.meta.dirname, "../../..");
const read = (f: string) => readFileSync(path.join(root, f), "utf8");
const worker = read("apps/worker/src/index.ts");
const lineOf = (text: string, needle: string, from = 0) => text.slice(0, text.indexOf(needle, from)).split("\n").length;

function functionBody(src: string, signature: string): string {
  const start = src.indexOf(signature);
  if (start < 0) throw new Error(`missing ${signature}`);
  let depth = 0;
  let i = src.indexOf("{", src.indexOf(")", start));
  // skip to the body brace after the return type
  i = src.indexOf("{\n", start);
  for (let j = i; j < src.length; j++) {
    if (src[j] === "{") depth++;
    if (src[j] === "}") depth--;
    if (depth === 0) return src.slice(start, j + 1);
  }
  throw new Error("unbalanced");
}

describe("U18 soak-monitor container restart set", () => {
  it("counts web/worker/playout only", () => {
    const soak = read("scripts/soak-monitor.sh");
    const loop = soak.split("\n").filter((l) => /for service in /.test(l));
    const collect = soak.slice(soak.indexOf("collect_container_restart_counts() {"), soak.indexOf("restart_count_for_service() {"));
    console.log("U18 loops:", JSON.stringify(loop), "collect mentions uplink:", collect.includes("uplink"), "relay:", collect.includes("relay"));
    expect(collect).not.toContain("uplink");
    expect(loop.some((l) => l.includes("uplink"))).toBe(false);
    expect(read("docker-compose.yml")).toMatch(/^  uplink:/m);
  });
});

describe("U30 worker heartbeat stale thresholds", () => {
  it("four independent declarations, two values", () => {
    const hits = [
      ["apps/worker/src/index.ts", /const WORKER_HEARTBEAT_STALE_MS = (\d[\d_]*)/],
      ["apps/web/lib/server/state.ts", /const WORKER_HEARTBEAT_STALE_MS = (\d[\d_]*)/],
      ["apps/web/lib/server/readiness.ts", /const WORKER_HEARTBEAT_STALE_MS = (\d[\d_]*)/],
      ["apps/worker/src/incident-classes.ts", /const WORKER_CYCLE_FRESH_MS = (\d[\d_]*)/]
    ].map(([f, re]) => [f, (read(f as string).match(re as RegExp) || [])[1]]);
    console.log("U30:", JSON.stringify(hits));
    expect(new Set(hits.map((h) => h[1])).size).toBe(2);
  });
});

describe("U32 standby slate does not update the scene payload", () => {
  it("writeStandbySlate never assigns currentScenePayload; ensureScenePayload keeps a stale one", () => {
    const standby = functionBody(worker, "async function writeStandbySlate(");
    const ensure = functionBody(worker, "async function ensureScenePayload(");
    const assignments = [...worker.matchAll(/currentScenePayload = /g)].map((m) => worker.slice(0, m.index).split("\n").length);
    console.log("U32 writeStandbySlate@", lineOf(worker, "async function writeStandbySlate("), "assigns payload:", standby.includes("currentScenePayload ="),
      "| ensureScenePayload early-return:", ensure.includes("if (currentScenePayload) {\n    return;"), "| all assignments at lines:", JSON.stringify(assignments));
    expect(standby).not.toContain("currentScenePayload");
    expect(ensure).toContain("if (currentScenePayload) {\n    return;");
    expect(assignments.length).toBe(1);
  });
});

describe("U33 playout exit handler has no identity guard", () => {
  it("clears global process state unconditionally while finalize() is guarded", () => {
    const exitIdx = worker.indexOf('child.on("exit", (code, signal) => {');
    const handlerHead = worker.slice(exitIdx, worker.indexOf("playoutProcess = null;", exitIdx) + 40);
    const guarded = /if \(playoutProcess !== child\)|if \(playoutProcess === child\)|playoutProcess !== child/.test(handlerHead);
    console.log("U33 exit handler@", lineOf(worker, 'child.on("exit", (code, signal) => {'), "guard present before clearing:", guarded,
      "| stopSceneRendererLoop before guard:", handlerHead.includes("stopSceneRendererLoop();"),
      "| finalize guard@", lineOf(worker, "if (playoutProcess === currentProcess) {"));
    expect(guarded).toBe(false);
    expect(handlerHead).toContain("stopSceneRendererLoop();");
    expect(worker).toContain("finalize();\n    }, PLAYOUT_STOP_DEADLINE_MS);");
  });
});

describe("U15 no smoke runs the relay/HLS uplink topology with content", () => {
  it("content smokes write a file output without STREAM247_RELAY_ENABLED", () => {
    const out: Record<string, { relay: boolean; fileOutput: boolean }> = {};
    for (const f of ["scripts/e2e-smoke.sh", "scripts/queue-continuity-smoke.sh", "scripts/runtime-parity-smoke.sh", "scripts/fresh-compose-bootstrap-smoke.sh"]) {
      const t = read(f);
      out[f] = { relay: /STREAM247_RELAY_ENABLED=1/.test(t), fileOutput: /STREAM_OUTPUT_URL=\/tmp/.test(t) };
    }
    const fc = read("scripts/fresh-compose-bootstrap-smoke.sh");
    console.log("U15:", JSON.stringify(out), "| fresh-compose checks program.m3u8:", fc.includes("program.m3u8"), "uplink progress:", /uplink(Status|HeartbeatAt|\.status)/.test(fc));
    for (const f of ["scripts/e2e-smoke.sh", "scripts/queue-continuity-smoke.sh", "scripts/runtime-parity-smoke.sh"]) {
      expect(out[f].relay).toBe(false);
    }
    expect(fc.includes("program.m3u8")).toBe(false);
  });
});
```

</details>

<details><summary><code>tests/r3-probes/audit/u14-relay-default-url.test.ts</code></summary>

```ts
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { evaluateRelayAuth } from "../../../packages/core/src/relay-ingest";
import { getRelayInputUrl, getRelayPublishUrl } from "../../../apps/worker/src/ffmpeg-runtime";

// U14 probe: the shipped default rollback URL carries no credential, so the relay auth denies it.
const root = path.resolve(import.meta.dirname, "../../..");

function decide(url: string, action: "publish" | "read") {
  const u = new URL(url.replace(/^rtmp:/, "http:"));
  return evaluateRelayAuth({
    request: { action, path: u.pathname.replace(/^\//, ""), user: u.searchParams.get("user") || "", password: u.searchParams.get("pass") || "", ip: "", protocol: "rtmp", query: u.search.slice(1) } as any,
    sources: [],
    internalKey: "k-internal"
  });
}

describe("U14 relay rollback default URL", () => {
  it("worker default (env unset) is denied for publish and read", () => {
    const pub = getRelayPublishUrl({} as any);
    const rd = getRelayInputUrl({} as any);
    const p = decide(pub, "publish");
    const r = decide(rd, "read");
    console.log("U14 default publish:", pub, JSON.stringify(p), "read:", rd, JSON.stringify(r));
    expect(p.allow).toBe(false);
    expect(r.allow).toBe(false);
  });

  it("env templates ship the unkeyed URL", () => {
    for (const f of [".env.example", ".env.production.example", "scripts/fresh-compose-bootstrap-smoke.sh"]) {
      const text = readFileSync(path.join(root, f), "utf8");
      const lines = text.split("\n").filter((l) => /^STREAM247_RELAY_(OUTPUT|INPUT)_URL=/.test(l));
      console.log("U14", f, JSON.stringify(lines));
      for (const l of lines) {
        const v = l.split("=").slice(1).join("=");
        expect(decide(v, l.includes("OUTPUT") ? "publish" : "read").allow).toBe(false);
      }
    }
  });
});
```

</details>

<details><summary><code>tests/r3-probes/audit/u3-heartbeat-thresholds.test.ts</code></summary>

```ts
import { describe, expect, it, vi } from "vitest";

// U3 probe: drift report (Live page) vs /api/system/readiness disagree for a 50s-old playout heartbeat.
const holder: { state: any } = { state: null };
vi.mock("../../../apps/web/lib/server/state", async (orig) => {
  const actual: any = await orig();
  return { ...actual, readAppState: async () => holder.state };
});
vi.mock("@stream247/db", async (orig) => {
  const actual: any = await orig();
  return { ...actual, getDatabaseHealth: async () => "ok" };
});

function minimalState(heartbeatAgeMs: number): any {
  const hb = new Date(Date.now() - heartbeatAgeMs).toISOString();
  return {
    initialized: true,
    owner: { email: "o@x", passwordHash: "h", createdAt: hb },
    users: [], teamAccessGrants: [], sources: [], assets: [], pools: [], scheduleBlocks: [], incidents: [],
    auditEvents: [], presenceWindows: [], sourceSyncRuns: [], overrides: [],
    destinations: [{ id: "d", name: "Twitch", provider: "twitch", role: "primary", priority: 0, enabled: true, streamKeyPresent: true, streamKeySource: "env", status: "ready", rtmpUrl: "", notes: "" }],
    twitch: { status: "connected", lastSyncedTitle: "", lastSyncedCategoryName: "" },
    moderation: {}, overlay: {},
    playout: {
      status: "running", heartbeatAt: hb, workerHeartbeatAt: new Date().toISOString(),
      overrideMode: "schedule", currentAssetId: "", crashLoopDetected: false,
      uplinkStatus: "running", uplinkHeartbeatAt: new Date().toISOString()
    }
  };
}

describe("U3 playout heartbeat threshold drift", () => {
  it("50s-old heartbeat: drift panel says stale, readiness says ok", async () => {
    delete process.env.STREAM247_RELAY_ENABLED;
    const { getRuntimeDriftReport } = await import("../../../apps/web/lib/server/state");
    const { getSystemReadiness } = await import("../../../apps/web/lib/server/readiness");
    holder.state = minimalState(50_000);
    let drift: any;
    try {
      drift = getRuntimeDriftReport(holder.state).items.find((i: any) => i.id === "playout-heartbeat");
    } catch (e) {
      drift = { error: String(e) };
    }
    const readiness: any = await getSystemReadiness();
    console.log("U3 drift:", JSON.stringify(drift), "readiness.playout:", readiness.services?.playout, "status:", readiness.status);
    expect(drift.severity).toBe("warning");
    expect(readiness.services.playout).toBe("ok");
  });
});
```

</details>

<details><summary><code>tests/r3-probes/migrations/audit-sink.mjs</code></summary>

```js

const db = await import(process.argv[2]);
await db.ensureDatabase();
await db.appendAuditEvent("r3.audit", "publish to rtmp://live.twitch.tv/app/live_987654321_zyxwvutsrqponmlkjihg failed");
await db.upsertIncident({ scope: "playout", severity: "warning", title: "t", message: "rtmp://live.twitch.tv/app/live_987654321_zyxwvutsrqponmlkjihg", fingerprint: "r3.audit" });
console.log(JSON.stringify({ ok: true }));
await new Promise((r) => setTimeout(r, 300)); process.exit();
```

</details>

<details><summary><code>tests/r3-probes/migrations/build-bundles.mjs</code></summary>

```js
// Builds standalone node bundles of packages/db for old release tags and for the working tree, so
// several separate node processes (or an old release) can run ensureDatabase against one Postgres.
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const repo = path.resolve(import.meta.dirname, "../../..");
const here = import.meta.dirname;
const require = createRequire(path.join(repo, "packages/db/package.json"));
const esbuild = (await import(path.join(repo, "node_modules/.pnpm/esbuild@0.27.4/node_modules/esbuild/lib/main.js"))).default;
const pgPath = path.dirname(require.resolve("pg/package.json"));

async function bundle(srcRoot, outfile) {
  await esbuild.build({
    entryPoints: [path.join(srcRoot, "packages/db/src/index.ts")],
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    outfile,
    logLevel: "error",
    external: ["pg-native"],
    nodePaths: [path.join(pgPath, "..")],
    alias: { "@stream247/core": path.join(srcRoot, "packages/core/src/index.ts"), pg: pgPath },
    banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" }
  });
}

const targets = process.argv.slice(2);
for (const target of targets) {
  if (target === "current") {
    await bundle(repo, path.join(here, "old/current/db.mjs"));
  } else {
    const dir = path.join(here, "old", target);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    execSync(`git -C ${repo} archive ${target} packages/db/src packages/core/src | tar -x -C ${dir}`);
    await bundle(dir, path.join(dir, "db.mjs"));
  }
  console.log("built", target);
}
```

</details>

<details><summary><code>tests/r3-probes/migrations/downgrade-check.mjs</code></summary>

```js

const db = await import(process.argv[2]);
const out = {};
try { await db.ensureDatabase(); out.ensure = "ok"; } catch (e) { out.ensure = "ERR " + e.message; }
try { const s = await db.readAppState(); out.read = "ok pools=" + s.pools.length; } catch (e) { out.read = "ERR " + e.message; }
try { await db.updateAppState((s) => s); out.write = "ok"; } catch (e) { out.write = "ERR " + e.message; }
try { await db.appendAuditEvent("r3.downgrade", "hello"); out.audit = "ok"; } catch (e) { out.audit = "ERR " + e.message; }
console.log(JSON.stringify({ ok: true, ...out }));
await new Promise((r) => setTimeout(r, 300)); process.exit();
```

</details>

<details><summary><code>tests/r3-probes/migrations/migrations.probe.test.ts</code></summary>

```ts
// R3 adversarial probe: migrations + bootstrap against a real Postgres (untracked, not part of validate).
// Run: pnpm exec vitest run tests/r3-probes/migrations
//
// Every scenario logs what it observed with a "[probe]" prefix; the asserts state the SAFE expectation,
// so a failing assert is a finding, and a passing one is a verified-sound property.
import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const here = import.meta.dirname;
const PG = "r3-mig-pg";
const PORT = 55433;
const LATE = "r3-mig-late";
const LATE_PORT = 55435;
const SECRET = "r3-probe-secret";
const CURRENT = path.join(here, "old/current/db.mjs");
const OLD_TAGS = ["v1.5.17", "v1.5.43", "v2.0.0", "v2.1.0-rc.2"];
const outDir = path.join(here, "out");

const url = (db: string, port = PORT) => `postgresql://stream247:stream247@127.0.0.1:${port}/${db}`;

async function docker(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("docker", args, { maxBuffer: 64 * 1024 * 1024 });
  return stdout.trim();
}

async function psql(db: string, sql: string): Promise<string> {
  return docker(["exec", PG, "psql", "-U", "stream247", "-d", db, "-v", "ON_ERROR_STOP=1", "-Atc", sql]);
}

async function startPg(name: string, port: number): Promise<void> {
  await docker(["rm", "-f", name]).catch(() => "");
  await docker([
    "run", "-d", "--rm", "--name", name,
    "-e", "POSTGRES_DB=stream247", "-e", "POSTGRES_USER=stream247", "-e", "POSTGRES_PASSWORD=stream247",
    "-p", `127.0.0.1:${port}:5432`, "postgres:16-alpine"
  ]);
  // pg_isready answers during the init-script restart; require two consecutive successes over TCP.
  let streak = 0;
  for (let i = 0; i < 120 && streak < 3; i += 1) {
    try {
      await docker(["exec", name, "psql", "-h", "127.0.0.1", "-U", "stream247", "-d", "stream247", "-Atc", "select 1"]);
      streak += 1;
    } catch {
      streak = 0;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
}

type RunResult = { code: number | null; stdout: string; stderr: string; json: Record<string, unknown> | null };

function runNode(script: string, args: string[], db: string, extraEnv: Record<string, string> = {}): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(here, script), ...args], {
      cwd: here,
      env: { ...process.env, DATABASE_URL: url(db), APP_SECRET: SECRET, ...extraEnv }
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("close", (code) => {
      const line = stdout.trim().split("\n").reverse().find((l) => l.startsWith("{\"label\"") || l.startsWith("{\"ok\""));
      resolve({ code, stdout, stderr, json: line ? JSON.parse(line) : null });
    });
  });
}

const ensure = (bundle: string, db: string, label = "proc") => runNode("run-ensure.mjs", [bundle, label], db);

async function createDb(name: string): Promise<void> {
  await psql("stream247", `DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  await psql("stream247", `CREATE DATABASE ${name}`);
}

/** A column-order-independent description of the schema: columns, indexes, constraints, identity. */
async function describeSchema(db: string): Promise<string[]> {
  const columns = await psql(db, `
    SELECT format('COL %s.%s %s notnull=%s default=%s identity=%s', c.relname, a.attname,
      format_type(a.atttypid, a.atttypmod), a.attnotnull, coalesce(pg_get_expr(d.adbin, d.adrelid), '-'), a.attidentity)
    FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
    WHERE n.nspname = 'public' AND c.relkind = 'r' AND a.attnum > 0 AND NOT a.attisdropped ORDER BY 1`);
  const indexes = await psql(db, `SELECT 'IDX ' || indexdef FROM pg_indexes WHERE schemaname = 'public' ORDER BY 1`);
  const constraints = await psql(db, `
    SELECT format('CON %s %s %s', c.conrelid::regclass, c.conname, pg_get_constraintdef(c.oid))
    FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace WHERE n.nspname = 'public' ORDER BY 1`);
  const tables = await psql(db, `SELECT 'TBL ' || tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY 1`);
  return [tables, columns, indexes, constraints].join("\n").split("\n").filter(Boolean).sort();
}

function diff(fresh: string[], other: string[]): { onlyFresh: string[]; onlyOther: string[] } {
  const a = new Set(fresh);
  const b = new Set(other);
  return { onlyFresh: fresh.filter((l) => !b.has(l)), onlyOther: other.filter((l) => !a.has(l)) };
}

describe.sequential("R3 migration probes", () => {
  let freshSchema: string[] = [];

  beforeAll(async () => {
    fs.mkdirSync(outDir, { recursive: true });
    await execFileAsync(process.execPath, [path.join(here, "build-bundles.mjs"), "current", ...OLD_TAGS], { cwd: here });
    await startPg(PG, PORT);
  }, 240_000);

  afterAll(async () => {
    await docker(["rm", "-f", PG]).catch(() => "");
    await docker(["rm", "-f", LATE]).catch(() => "");
  });

  it("fresh install: reference schema + idempotent second boot", async () => {
    await createDb("fresh");
    const first = await ensure(CURRENT, "fresh", "fresh-1");
    const second = await ensure(CURRENT, "fresh", "fresh-2");
    console.log("[probe] fresh boots", first.json, second.json);
    freshSchema = await describeSchema("fresh");
    fs.writeFileSync(path.join(outDir, "fresh.schema.txt"), freshSchema.join("\n"));
    const migs = await psql("fresh", "SELECT count(*), count(DISTINCT id) FROM schema_migrations");
    console.log("[probe] fresh schema_migrations count|distinct =", migs, "described lines =", freshSchema.length);
    expect(first.json?.ok).toBe(true);
    expect(second.json?.ok).toBe(true);
  }, 120_000);

  it("concurrency: 8 separate node processes bootstrap an EMPTY database at once", async () => {
    await createDb("conc_empty");
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) => ensure(CURRENT, "conc_empty", `p${i}`)));
    for (const r of results) console.log("[probe] conc_empty", JSON.stringify(r.json), r.stderr.split("\n").filter((l) => /error|ERR/i.test(l)).slice(0, 2).join(" | "));
    const migs = await psql("conc_empty", "SELECT count(*) || '|' || count(DISTINCT id) FROM schema_migrations");
    const seeds = await psql("conc_empty", `SELECT (SELECT count(*) FROM system_state) || '|' || (SELECT count(*) FROM sources) || '|' || (SELECT count(*) FROM pools) || '|' || (SELECT count(*) FROM schedule_blocks) || '|' || (SELECT count(*) FROM stream_destinations)`);
    const freshSeeds = await psql("fresh", `SELECT (SELECT count(*) FROM system_state) || '|' || (SELECT count(*) FROM sources) || '|' || (SELECT count(*) FROM pools) || '|' || (SELECT count(*) FROM schedule_blocks) || '|' || (SELECT count(*) FROM stream_destinations)`);
    console.log("[probe] conc_empty schema_migrations total|distinct =", migs, "seed counts system|sources|pools|blocks|dest =", seeds, "single-boot reference =", freshSeeds);
    expect(results.every((r) => r.json?.ok)).toBe(true);
    expect(seeds).toBe(freshSeeds);
    const d = diff(freshSchema, await describeSchema("conc_empty"));
    expect(d).toEqual({ onlyFresh: [], onlyOther: [] });
  }, 120_000);

  it("concurrency: 8 processes upgrade a v2.0.0 database with pending migrations at once", async () => {
    await createDb("conc_pending");
    const seeded = await runNode("seed-old.mjs", [path.join(here, "old/v2.0.0/db.mjs")], "conc_pending");
    console.log("[probe] conc_pending seed v2.0.0", seeded.json);
    const before = await psql("conc_pending", "SELECT count(*) FROM schema_migrations");
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) => ensure(CURRENT, "conc_pending", `p${i}`)));
    for (const r of results) console.log("[probe] conc_pending", JSON.stringify(r.json));
    const after = await psql("conc_pending", "SELECT count(*) || '|' || count(DISTINCT id) FROM schema_migrations");
    console.log("[probe] conc_pending schema_migrations before =", before, "after total|distinct =", after);
    expect(results.every((r) => r.json?.ok)).toBe(true);
  }, 120_000);

  for (const tag of OLD_TAGS) {
    it(`upgrade path: ${tag} database with data -> current, compared with a fresh install`, async () => {
      const db = `up_${tag.replace(/[^a-z0-9]/gi, "_")}`;
      await createDb(db);
      const seeded = await runNode("seed-old.mjs", [path.join(here, `old/${tag}/db.mjs`)], db);
      console.log(`[probe] ${tag} seed`, seeded.json, seeded.code);
      const fingerprint = `SELECT (SELECT count(*) FROM audit_events) || '|' || (SELECT count(*) FROM incidents) || '|' || (SELECT count(*) FROM presence_windows) || '|' || (SELECT count(*) FROM pools) || '|' || (SELECT count(*) FROM sources) || '|' || (SELECT count(*) FROM assets) || '|' || (SELECT headline FROM overlay_settings)`;
      const before = await psql(db, fingerprint);
      const up1 = await ensure(CURRENT, db, `${tag}-up1`);
      const up2 = await ensure(CURRENT, db, `${tag}-up2`);
      const after = await psql(db, fingerprint);
      console.log(`[probe] ${tag} upgrade`, up1.json, up2.json, "rows before =", before, "after =", after);
      const secretLeft = await psql(db, `SELECT count(*) FROM audit_events WHERE message LIKE '%live_123456789_abc%'`);
      const incidentMsg = await psql(db, `SELECT message FROM incidents WHERE fingerprint = 'r3.probe'`);
      const scenes = await psql(db, `SELECT active_scene_id || ' ' || left(scenes_json, 120) FROM overlay_settings`);
      const drift = await psql(db, `SELECT count(*) FROM incidents WHERE fingerprint = 'schema.drift' AND status <> 'resolved'`).catch((e) => String(e));
      console.log(`[probe] ${tag} after-upgrade: unredacted audit rows =`, secretLeft, "| incident msg =", incidentMsg, "| scenes =", scenes, "| open schema.drift incidents =", drift);
      const upgraded = await describeSchema(db);
      fs.writeFileSync(path.join(outDir, `${db}.schema.txt`), upgraded.join("\n"));
      const d = diff(freshSchema, upgraded);
      fs.writeFileSync(path.join(outDir, `${db}.diff.txt`), [`ONLY IN FRESH (${d.onlyFresh.length}):`, ...d.onlyFresh, "", `ONLY IN UPGRADED (${d.onlyOther.length}):`, ...d.onlyOther].join("\n"));
      console.log(`[probe] ${tag} schema diff vs fresh: onlyFresh=${d.onlyFresh.length} onlyUpgraded=${d.onlyOther.length}\n  - ` + d.onlyFresh.join("\n  - ") + "\n  + " + d.onlyOther.join("\n  + "));
      expect(up1.json?.ok).toBe(true);
      expect(up2.json?.ok).toBe(true);
      expect(d).toEqual({ onlyFresh: [], onlyOther: [] });
    }, 180_000);
  }

  it("downgrade: the v2.1.0-rc.2 build runs against a database the current build migrated", async () => {
    const db = "up_v2_1_0_rc_2";
    const script = path.join(here, "downgrade-check.mjs");
    fs.writeFileSync(script, `
const db = await import(process.argv[2]);
const out = {};
try { await db.ensureDatabase(); out.ensure = "ok"; } catch (e) { out.ensure = "ERR " + e.message; }
try { const s = await db.readAppState(); out.read = "ok pools=" + s.pools.length; } catch (e) { out.read = "ERR " + e.message; }
try { await db.updateAppState((s) => s); out.write = "ok"; } catch (e) { out.write = "ERR " + e.message; }
try { await db.appendAuditEvent("r3.downgrade", "hello"); out.audit = "ok"; } catch (e) { out.audit = "ERR " + e.message; }
console.log(JSON.stringify({ ok: true, ...out }));
await new Promise((r) => setTimeout(r, 300)); process.exit();
`);
    await psql(db, `UPDATE pools SET source_cursors = '{"src-x":"asset-y"}' WHERE id = 'pool-r3'`);
    for (const olderTag of ["v1.5.43", "v2.0.0"]) {
      const older = await runNode("downgrade-check.mjs", [path.join(here, `old/${olderTag}/db.mjs`)], db);
      console.log(`[probe] downgrade ${olderTag} on migrated db:`, JSON.stringify(older.json), older.code);
    }
    const res = await runNode("downgrade-check.mjs", [path.join(here, "old/v2.1.0-rc.2/db.mjs")], db);
    const cursors = await psql(db, `SELECT source_cursors FROM pools WHERE id = 'pool-r3'`);
    const reUp = await ensure(CURRENT, db, "re-upgrade");
    console.log("[probe] downgrade v2.1.0-rc.2 on migrated db:", res.json, "| pool-r3 source_cursors after old write =", cursors, "| re-upgrade", reUp.json);
    expect(res.json?.ensure).toBe("ok");
    expect(res.json?.write).toBe("ok");
  }, 120_000);

  it("failure atomicity: a pending migration that fails rolls back the whole boot and is retried next boot", async () => {
    const db = "fail_mid";
    await createDb(db);
    await runNode("seed-old.mjs", [path.join(here, "old/v2.0.0/db.mjs")], db);
    // A leftover as_run_log without the column the migration's index needs (e.g. a hand-made table or
    // a half-restored dump). CREATE TABLE IF NOT EXISTS skips it; the CREATE INDEX then fails.
    await psql(db, "CREATE TABLE as_run_log (id TEXT PRIMARY KEY)");
    const r1 = await ensure(CURRENT, db, "fail-1");
    const state1 = await psql(db, `SELECT string_agg(id, ',') FROM schema_migrations WHERE id >= '20261001'`);
    const col1 = await psql(db, `SELECT count(*) FROM information_schema.columns WHERE table_name = 'pools' AND column_name = 'source_cursors'`);
    const brk1 = await psql(db, `SELECT to_regclass('public.source_breakers') IS NOT NULL`);
    console.log("[probe] fail_mid boot 1:", r1.json, "| recorded 2026-10 migrations =", JSON.stringify(state1), "| pools.source_cursors exists =", col1, "| source_breakers exists =", brk1);
    await psql(db, "DROP TABLE as_run_log");
    const r2 = await ensure(CURRENT, db, "fail-2");
    const state2 = await psql(db, `SELECT string_agg(id, ',' ORDER BY id) FROM schema_migrations WHERE id >= '20261001'`);
    console.log("[probe] fail_mid boot 2 after removing the conflict:", r2.json, "| recorded =", state2);
    expect(r1.json?.ok).toBe(false);
    expect(state1).toBe("");
    expect(col1).toBe("0");
    expect(r2.json?.ok).toBe(true);
  }, 120_000);

  it("silent skip: CREATE TABLE IF NOT EXISTS over a pre-existing incompatible table is recorded as applied", async () => {
    const db = "silent_skip";
    await createDb(db);
    await runNode("seed-old.mjs", [path.join(here, "old/v2.1.0-rc.2/db.mjs")], db);
    await psql(db, "CREATE TABLE source_breakers (source_id TEXT PRIMARY KEY)");
    const r = await ensure(CURRENT, db, "skip");
    const recorded = await psql(db, `SELECT count(*) FROM schema_migrations WHERE id = '20261001_002_source_breakers'`);
    const drift = await psql(db, `SELECT coalesce(string_agg(severity || ' ' || left(message, 140), ' / '), '-') FROM incidents WHERE fingerprint = 'schema.drift'`);
    console.log("[probe] silent_skip:", r.json, "| migration recorded =", recorded, "| drift incident =", drift);
    expect(r.json?.ok).toBe(true);
  }, 120_000);

  it("lock interplay: an old process's open write transaction during the upgrade boot (deadlock)", async () => {
    const db = "deadlock";
    await createDb(db);
    await runNode("seed-old.mjs", [path.join(here, "old/v1.5.43/db.mjs")], db);
    // Old-release writer: row-locks pools, then (after the new boot has ALTERed overlay_settings) wants
    // overlay_settings. The new boot ALTERs overlay_settings (20260903_001) before pools (20261001_001).
    const old = docker(["exec", PG, "psql", "-U", "stream247", "-d", db, "-v", "ON_ERROR_STOP=1", "-Atc",
      "BEGIN; UPDATE pools SET name = name; SELECT pg_sleep(2.5); UPDATE overlay_settings SET headline = headline; COMMIT;"])
      .then(() => "old-writer: committed").catch((e) => "old-writer: " + String(e.stderr ?? e).split("\n").find((l) => l.includes("ERROR")));
    await new Promise((r) => setTimeout(r, 700));
    const boot = await ensure(CURRENT, db, "upgrade-under-load");
    console.log("[probe] deadlock: new boot =", boot.json, "|", await old);
    const recorded = await psql(db, `SELECT count(*) FROM schema_migrations WHERE id >= '20260903'`);
    console.log("[probe] deadlock: post-2026-09-03 migrations recorded =", recorded);
  }, 120_000);

  it("lock interplay: can the UPGRADE BOOT itself be the deadlock victim?", async () => {
    // Same cycle, but the boot starts waiting first, so its own deadlock check (deadlock_timeout=1s)
    // is the one that finds the cycle.
    const outcomes: string[] = [];
    for (const sleep of [0.6, 0.9, 1.2]) {
      const db = `deadlock_${String(sleep).replace(".", "")}`;
      await createDb(db);
      await runNode("seed-old.mjs", [path.join(here, "old/v1.5.43/db.mjs")], db);
      const old = docker(["exec", PG, "psql", "-U", "stream247", "-d", db, "-v", "ON_ERROR_STOP=1", "-Atc",
        `BEGIN; UPDATE pools SET name = name; SELECT pg_sleep(${sleep}); UPDATE overlay_settings SET headline = headline; COMMIT;`])
        .then(() => "committed").catch((e) => String(e.stderr ?? e).split("\n").find((l) => l.includes("ERROR")) ?? "error");
      await new Promise((r) => setTimeout(r, 150));
      const boot = await ensure(CURRENT, db, "boot");
      const recorded = await psql(db, `SELECT count(*) FROM schema_migrations WHERE id >= '20260903'`);
      outcomes.push(`sleep=${sleep}s boot=${JSON.stringify(boot.json)} old-writer=${await old} recorded-post-0903=${recorded}`);
    }
    console.log("[probe] deadlock-victim:\n  " + outcomes.join("\n  "));
  }, 180_000);

  it("audit sink: does the CURRENT appendAuditEvent redact a stream key (the redaction migration is one-shot)?", async () => {
    const db = "audit_sink";
    await createDb(db);
    const script = path.join(here, "audit-sink.mjs");
    fs.writeFileSync(script, `
const db = await import(process.argv[2]);
await db.ensureDatabase();
await db.appendAuditEvent("r3.audit", "publish to rtmp://live.twitch.tv/app/live_987654321_zyxwvutsrqponmlkjihg failed");
await db.upsertIncident({ scope: "playout", severity: "warning", title: "t", message: "rtmp://live.twitch.tv/app/live_987654321_zyxwvutsrqponmlkjihg", fingerprint: "r3.audit" });
console.log(JSON.stringify({ ok: true }));
await new Promise((r) => setTimeout(r, 300)); process.exit();
`);
    const r = await runNode("audit-sink.mjs", [CURRENT], db);
    const audit = await psql(db, `SELECT message FROM audit_events WHERE type = 'r3.audit'`);
    const incident = await psql(db, `SELECT message FROM incidents WHERE fingerprint = 'r3.audit'`);
    console.log("[probe] audit sink:", r.json, "| audit_events.message =", audit, "| incidents.message =", incident);
  }, 60_000);

  it("cached rejection: a bootstrap that failed once is never retried in the same process", async () => {
    // In-process, against the real source module, exactly as web/worker load it.
    process.env.DATABASE_URL = url("stream247", LATE_PORT);
    process.env.APP_SECRET = SECRET;
    const dbmod = await import("@stream247/db");
    await dbmod.resetDatabaseConnectionsForTests();
    const first = await dbmod.ensureDatabase().then(() => "ok", (e: Error & { code?: string }) => `ERR ${e.code ?? ""} ${e.message}`);
    await startPg(LATE, LATE_PORT);
    const direct = await docker(["exec", LATE, "psql", "-U", "stream247", "-d", "stream247", "-Atc", "select 'db is up'"]);
    const second = await dbmod.ensureDatabase().then(() => "ok", (e: Error & { code?: string }) => `ERR ${e.code ?? ""} ${e.message}`);
    const health = await dbmod.getDatabaseHealth();
    const read = await dbmod.readAppState().then(() => "ok", (e: Error) => `ERR ${e.message}`);
    await dbmod.resetDatabaseConnectionsForTests();
    const afterReset = await dbmod.ensureDatabase().then(() => "ok", (e: Error) => `ERR ${e.message}`);
    console.log("[probe] cached rejection: first =", first, "| db:", direct, "| second =", second, "| health =", health, "| readAppState =", read, "| after reset =", afterReset);
    await dbmod.resetDatabaseConnectionsForTests();
    expect(second).toBe("ok");
  }, 120_000);
});
```

</details>

<details><summary><code>tests/r3-probes/migrations/run-ensure.mjs</code></summary>

```js
// usage: node run-ensure.mjs <bundle.mjs> [label]  — runs ensureDatabase once, prints a JSON line.
const [bundlePath, label = "proc"] = process.argv.slice(2);
const db = await import(bundlePath);
const t0 = Date.now();
try {
  await db.ensureDatabase();
  console.log(JSON.stringify({ label, ok: true, ms: Date.now() - t0 }));
} catch (error) {
  console.log(JSON.stringify({ label, ok: false, ms: Date.now() - t0, code: error?.code, error: String(error?.message ?? error) }));
  process.exitCode = 1;
}
// Let the drift-report setImmediate writes settle, then close.
await new Promise((r) => setTimeout(r, 500));
await db.resetDatabaseConnectionsForTests?.().catch(() => {});
process.exit();
```

</details>

<details><summary><code>tests/r3-probes/migrations/seed-old.mjs</code></summary>

```js
// usage: node seed-old.mjs <bundle.mjs>  — bootstraps with that release's code and writes realistic rows
// through that release's own API, so the upgrade starts from data an old release really produced.
const [bundlePath] = process.argv.slice(2);
const db = await import(bundlePath);
const out = { ok: true, steps: [] };
const step = async (name, fn) => {
  try { await fn(); out.steps.push(`${name}:ok`); } catch (e) { out.steps.push(`${name}:ERR ${e.message}`); }
};
await db.ensureDatabase();
await step("audit", () => db.appendAuditEvent("playout.failed", "ffmpeg could not open rtmp://live.twitch.tv/app/live_123456789_abcdefghijklmnopqrstuv"));
await step("incident", () => db.upsertIncident({ scope: "playout", severity: "critical", title: "uplink failed", message: "Bearer abcdefghijklmnop rejected; key=supersecret", fingerprint: "r3.probe" }));
const now = new Date();
const exp = new Date(now.getTime() + 30 * 60_000).toISOString();
await step("presence", () => db.appendPresenceWindowRecord({ actor: "mod_a", minutes: 30, requestedMinutes: 30, appliedMinutes: 30, clampReason: "accepted", createdAt: now.toISOString(), expiresAt: exp }));
await step("state", () => db.updateAppState((state) => ({
  ...state,
  overlay: { ...state.overlay, headline: "R3 probe headline", customLayers: [{ id: "layer-r3", kind: "text", name: "R3", text: "hello", x: 1, y: 2, width: 30, height: 10, visible: true }] },
  pools: [...state.pools, { ...(state.pools[0] ?? {}), id: "pool-r3", name: "R3 pool", sourceIds: state.sources.map((s) => s.id).slice(0, 2), cursorAssetId: "", updatedAt: now.toISOString() }]
})));
console.log(JSON.stringify(out));
await new Promise((r) => setTimeout(r, 500));
await db.resetDatabaseConnectionsForTests?.().catch(() => {});
process.exit();
```

</details>

<details><summary><code>tests/r3-probes/schedule/cuepoint-midnight.test.ts</code></summary>

```ts
import { describe, expect, it } from "vitest";
import { buildScheduleOccurrences, findCurrentScheduleOccurrence, getCurrentScheduleMoment, type ScheduleBlock } from "@stream247/core";
import type { AppState } from "@stream247/db";
import { getCuepointInsertPlan } from "../../../apps/worker/src/cuepoints";

const block = {
  id: "late", title: "Late Replay", categoryName: "Gaming", dayOfWeek: 6, startMinuteOfDay: 23 * 60,
  durationMinutes: 120, showId: "", poolId: "pool-1", sourceName: "Pool", repeatMode: "single", repeatGroupId: "",
  cuepointAssetId: "", cuepointOffsetsSeconds: [900, 2700]
} as unknown as ScheduleBlock;

function state(playout: Partial<AppState["playout"]>): AppState {
  return {
    scheduleBlocks: [block],
    pools: [{ id: "pool-1", name: "Pool", sourceIds: ["s"], playbackMode: "round-robin", cursorAssetId: "", insertAssetId: "sting",
      insertEveryItems: 0, audioLaneAssetId: "", audioLaneVolumePercent: 100, itemsSinceInsert: 0, updatedAt: "" }],
    assets: [{ id: "sting", sourceId: "s", title: "Sting", path: "/x.mp4", status: "ready", includeInProgramming: true, externalId: "",
      categoryName: "", durationSeconds: 30, publishedAt: "", fallbackPriority: 100, isGlobalFallback: false, createdAt: "", updatedAt: "" }],
    playout: { cuepointWindowKey: "", cuepointFiredKeys: [], cuepointLastTriggeredAt: "", cuepointLastAssetId: "", ...playout }
  } as unknown as AppState;
}

function current(now: Date) {
  const m = getCurrentScheduleMoment({ now, timeZone: "UTC" });
  return findCurrentScheduleOccurrence({ occurrences: buildScheduleOccurrences({ date: m.date, blocks: [block] }), currentTime: m.time })!;
}

describe("R3 probe: cuepoints of a block that runs past midnight", () => {
  it("P10 fire again after midnight because the occurrence key changes", () => {
    // Sat 2026-10-03 23:50 UTC: both offsets (23:15, 23:45) are behind us; mimic the worker having fired both.
    const evening = current(new Date("2026-10-03T23:50:00Z"));
    const fired = [`${evening.key}@900`, `${evening.key}@2700`];
    const atMidnightPlus5 = current(new Date("2026-10-04T00:05:00Z"));
    // apps/worker/src/index.ts:7906-7908 keeps fired keys only while the window key is unchanged.
    const plan = getCuepointInsertPlan({
      state: state({ cuepointWindowKey: evening.key, cuepointFiredKeys: fired }),
      currentScheduleItem: atMidnightPlus5,
      skippedAssetId: "",
      now: new Date("2026-10-04T00:05:00Z"),
      timeZone: "UTC"
    });
    console.log("P10 keys:", evening.key, "->", atMidnightPlus5.key, "| plan after midnight:", plan?.offsetSeconds, plan?.cuepointKey);
    expect(plan?.offsetSeconds).toBe(900);
  });
});
```

</details>

<details><summary><code>tests/r3-probes/schedule/schedule-probes.test.ts</code></summary>

```ts
import { describe, expect, it } from "vitest";
import {
  buildScheduleOccurrences,
  findCurrentScheduleOccurrence,
  findScheduleConflicts,
  getCurrentScheduleMoment,
  getScheduleElapsedSeconds,
  toUtcIsoForLocalDateTime,
  type ScheduleBlock
} from "@stream247/core";

function block(id: string, dayOfWeek: number, start: string, durationMinutes: number): ScheduleBlock {
  const [h, m] = start.split(":").map(Number);
  return {
    id,
    title: id,
    categoryName: "Just Chatting",
    dayOfWeek,
    startMinuteOfDay: h * 60 + m,
    durationMinutes,
    showId: "",
    poolId: "pool-1",
    sourceName: "pool",
    repeatMode: "single",
    repeatGroupId: "",
    cuepointAssetId: "",
    cuepointOffsetsSeconds: []
  } as unknown as ScheduleBlock;
}

describe("R3 probe: conflict check across midnight", () => {
  it("P1 misses a real overlap: Sat 23:00+240 runs to Sun 03:00, Sun 01:00+120 starts inside it", () => {
    const blocks = [block("sat-late", 6, "23:00", 240), block("sun-early", 0, "01:00", 120)];
    // Real overlap Sun 01:00-03:00. Expected both ids.
    console.log("P1 conflicts:", JSON.stringify(findScheduleConflicts(blocks)));
    // The worker resolves the overlap by "latest start wins": at Sun 01:30 the Sun block is on air.
    const sunday = buildScheduleOccurrences({ date: "2026-10-04", blocks });
    console.log("P1 on air Sun 01:30:", findCurrentScheduleOccurrence({ occurrences: sunday, currentTime: "01:30" })?.blockId);
    expect(findScheduleConflicts(blocks)).toEqual([]);
  });

  it("P2 flags a non-overlap: Sat 23:00+240 (to Sun 03:00) and Sat 01:00+120 (Sat 01:00-03:00)", () => {
    const blocks = [block("sat-late", 6, "23:00", 240), block("sat-early", 6, "01:00", 120)];
    console.log("P2 conflicts:", JSON.stringify(findScheduleConflicts(blocks)));
    expect(findScheduleConflicts(blocks).sort()).toEqual(["sat-early", "sat-late"]);
  });
});

describe("R3 probe: Twitch schedule sync and carry-over occurrences", () => {
  it("P3 a carry-over occurrence keeps the start minute of the previous evening but the date of the next day", () => {
    const blocks = [block("mon-late", 1, "23:00", 120)];
    // 2026-10-05 is a Monday, 2026-10-06 a Tuesday.
    const tuesday = buildScheduleOccurrences({ date: "2026-10-06", blocks });
    const carry = tuesday[0];
    console.log("P3 tuesday occurrences:", JSON.stringify(tuesday.map((o) => ({ key: o.key, date: o.date, startMinuteOfDay: o.startMinuteOfDay, carry: o.carriesOverFromPreviousDay }))));
    // Verbatim reproduction of apps/worker/src/index.ts syncTwitchSchedule: start_time is computed from
    // occurrence.date + occurrence.startMinuteOfDay for every occurrence of the 7-day window.
    const startTime = toUtcIsoForLocalDateTime({ date: carry.date, minuteOfDay: carry.startMinuteOfDay, timeZone: "Europe/Berlin" });
    const monday = buildScheduleOccurrences({ date: "2026-10-05", blocks }).filter((o) => !o.carriesOverFromPreviousDay)[0];
    const realStart = toUtcIsoForLocalDateTime({ date: monday.date, minuteOfDay: monday.startMinuteOfDay, timeZone: "Europe/Berlin" });
    console.log("P3 real segment start:", realStart, "phantom segment start:", startTime);
    expect(carry.carriesOverFromPreviousDay).toBe(true);
    expect(startTime).toBe("2026-10-06T21:00:00.000Z");
  });
});

describe("R3 probe: daylight saving time (Europe/Berlin)", () => {
  it("P4 a non-existent local time (spring forward 2026-03-29 02:30)", () => {
    const iso = toUtcIsoForLocalDateTime({ date: "2026-03-29", minuteOfDay: 150, timeZone: "Europe/Berlin" });
    const back = getCurrentScheduleMoment({ now: new Date(iso), timeZone: "Europe/Berlin" });
    console.log("P4 02:30 on 2026-03-29 ->", iso, "-> local", back.date, back.time);
  });

  it("P5 an ambiguous local time (fall back 2026-10-25 02:30)", () => {
    const iso = toUtcIsoForLocalDateTime({ date: "2026-10-25", minuteOfDay: 150, timeZone: "Europe/Berlin" });
    console.log("P5 02:30 on 2026-10-25 ->", iso);
  });

  it("P6 a block 02:00+60 on the spring-forward Sunday is never on air", () => {
    const blocks = [block("sun-0200", 0, "02:00", 60)];
    const hits: string[] = [];
    // Every real minute of 2026-03-29 local (UTC 2026-03-28T23:00 .. 2026-03-29T22:00).
    for (let t = Date.parse("2026-03-28T23:00:00Z"); t < Date.parse("2026-03-29T22:00:00Z"); t += 60_000) {
      const moment = getCurrentScheduleMoment({ now: new Date(t), timeZone: "Europe/Berlin" });
      const occ = findCurrentScheduleOccurrence({
        occurrences: buildScheduleOccurrences({ date: moment.date, blocks }),
        currentTime: moment.time
      });
      if (occ) hits.push(moment.time);
    }
    console.log("P6 minutes on air:", hits.length);
    expect(hits.length).toBe(0);
  });

  it("P7 a block 02:00+60 on the fall-back Sunday is on air for 120 real minutes", () => {
    const blocks = [block("sun-0200", 0, "02:00", 60)];
    let minutes = 0;
    for (let t = Date.parse("2026-10-24T22:00:00Z"); t < Date.parse("2026-10-25T23:00:00Z"); t += 60_000) {
      const moment = getCurrentScheduleMoment({ now: new Date(t), timeZone: "Europe/Berlin" });
      const occ = findCurrentScheduleOccurrence({ occurrences: buildScheduleOccurrences({ date: moment.date, blocks }), currentTime: moment.time });
      if (occ) minutes += 1;
    }
    console.log("P7 real minutes on air:", minutes);
    expect(minutes).toBe(120);
  });

  it("P8 cuepoint elapsed time counts wall-clock minutes, not real ones, across the switch", () => {
    // Block starts Sun 2026-03-29 01:00 local; at 03:30 local only 90 real minutes have passed.
    const elapsed = getScheduleElapsedSeconds({ startMinuteOfDay: 60, currentTime: "03:30" });
    console.log("P8 elapsed seconds reported:", elapsed, "real:", 90 * 60);
    expect(elapsed).toBe(150 * 60);
  });
});
```

</details>

<details><summary><code>tests/r3-probes/schedule/timezone-env.test.ts</code></summary>

```ts
import { describe, expect, it } from "vitest";
import { getCurrentScheduleMoment } from "@stream247/core";
import { isUsableTimeZone, resolveChannelTimeZone } from "@stream247/db";

describe("R3 probe: CHANNEL_TIMEZONE from the environment is not validated", () => {
  it("P9 a typo passes through the resolver and throws inside the schedule clock", () => {
    const zone = resolveChannelTimeZone({ channelTimezone: "Europe/Berlin" }, { CHANNEL_TIMEZONE: "Europe/Berln" });
    console.log("P9 resolved zone:", zone, "usable:", isUsableTimeZone(zone));
    let error = "";
    try {
      getCurrentScheduleMoment({ now: new Date(), timeZone: zone });
    } catch (caught) {
      error = String(caught);
    }
    console.log("P9 getCurrentScheduleMoment:", error);
    expect(error).toMatch(/RangeError/);
  });
});
```

</details>

<details><summary><code>tests/r3-probes/schedule/week-minutes.test.ts</code></summary>

```ts
import { describe, expect, it } from "vitest";
import { buildMaterializedProgrammingWeek, type ScheduleBlock } from "@stream247/core";

describe("R3 probe: week summary with a block across midnight", () => {
  it("P11 counts the full duration on both days", () => {
    const block = { id: "late", title: "Late", categoryName: "", dayOfWeek: 1, startMinuteOfDay: 1380, durationMinutes: 120,
      showId: "", poolId: "", sourceName: "x", repeatMode: "single", repeatGroupId: "", cuepointAssetId: "", cuepointOffsetsSeconds: [] } as unknown as ScheduleBlock;
    const week = buildMaterializedProgrammingWeek({ startDate: "2026-10-05", blocks: [block], pools: [], assets: [] });
    const perDay = week.map((d) => `${d.date}:${d.totalScheduledMinutes}`);
    console.log("P11 scheduled minutes per day:", perDay.join(" "), "sum:", week.reduce((t, d) => t + d.totalScheduledMinutes, 0));
    expect(week[0].totalScheduledMinutes + week[1].totalScheduledMinutes).toBe(240);
  });
});
```

</details>

<details><summary><code>tests/r3-probes/selection/crash-abandons-item.probe.test.ts</code></summary>

```ts
// PROBE (r3, transitions). After an unplanned ffmpeg exit the runtime keeps currentAssetId = A
// (index.ts:6453) but no process runs, so neither "running item runs on" arm applies (runningScheduledAsset
// and currentPoolAsset both require processRunning, index.ts:5393-5402 / 5457-5467) and the pool picks the
// item AFTER its stored pointer -- which is A itself (written when A started, index.ts:8035-8041).
// A is therefore never retried: not after a mid-item crash (M77 territory, deferred), and not after an
// immediate input-open failure of a stale resolved URL either, although index.ts:6402-6420 drops the probe
// cache and skips the failed format candidate "so the next attempt re-resolves" (docs/operations.md:383:
// "skipped for the item for 30 minutes") -- the next attempt only comes when the rotation comes round again.
import { describe, expect, it } from "vitest";
import { nextPoolRotationAsset } from "@stream247/core";

const assets = ["A", "B", "C"].map((id, i) => ({ id, sourceId: "yt", title: id, status: "ready", createdAt: `2026-01-0${i + 1}T00:00:00Z` }));

describe("item that failed at input-open", () => {
  it("is not picked again: the pool moves on to B", () => {
    // Pointer = A (A was started by a scheduled_match, then exited with code 8 after 2 s).
    const pick = nextPoolRotationAsset({ pool: { sourceIds: ["yt"], cursorAssetId: "A" }, assets, isEligible: () => true });
    expect(pick?.asset.id).toBe("B");
  });
});
```

</details>

<details><summary><code>tests/r3-probes/selection/cuepoint-midnight-refire.probe.test.ts</code></summary>

```ts
// PROBE (r3, boundaries). A block that runs past midnight changes its occurrence key at 00:00
// ("D1:block:1380:120" -> "D2:block:1380:120:carry", core toScheduleOccurrence index.ts:3406). The worker
// keys the fired cue points on that key (cuepoints.ts:88-89, index.ts:7906-7908), so at midnight the
// fired list is dropped and every cue point already aired before midnight is due again.
import { describe, expect, it } from "vitest";
import { buildCuepointKey, buildScheduleOccurrences, findCurrentScheduleOccurrence } from "@stream247/core";
import type { AppState } from "@stream247/db";
import { getCuepointInsertPlan } from "../../../apps/worker/src/cuepoints";

// 2026-04-05 is a Sunday (dayOfWeek 0); 2026-04-06 Monday.
const block = {
  id: "late",
  title: "Late Night",
  categoryName: "",
  dayOfWeek: 0,
  startMinuteOfDay: 23 * 60,
  durationMinutes: 120,
  poolId: "pool-1",
  sourceName: "Pool",
  cuepointAssetId: "sting",
  cuepointOffsetsSeconds: [600, 1800] // 23:10 and 23:30
};
const state = (playout: Record<string, unknown>) =>
  ({
    scheduleBlocks: [block],
    pools: [{ id: "pool-1", name: "Pool", sourceIds: ["s"], insertAssetId: "", insertEveryItems: 0, itemsSinceInsert: 0 }],
    assets: [{ id: "sting", sourceId: "s", title: "Sting", status: "ready", includeInProgramming: true }],
    playout: { cuepointWindowKey: "", cuepointFiredKeys: [], ...playout }
  }) as unknown as AppState;

const occurrenceAt = (date: string, time: string) =>
  findCurrentScheduleOccurrence({ occurrences: buildScheduleOccurrences({ date, blocks: [block] }), currentTime: time })!;

describe("cue points of a block across midnight", () => {
  it("fires 23:10 and 23:30 again after 00:00", () => {
    const before = occurrenceAt("2026-04-05", "23:50");
    const fired = [buildCuepointKey(before.key, 600), buildCuepointKey(before.key, 1800)];
    const planBefore = getCuepointInsertPlan({
      state: state({ cuepointWindowKey: before.key, cuepointFiredKeys: fired }),
      currentScheduleItem: before,
      skippedAssetId: "",
      now: new Date("2026-04-05T23:50:00.000Z"),
      timeZone: "UTC"
    });
    expect(planBefore).toBeNull(); // both aired, nothing due: correct

    const after = occurrenceAt("2026-04-06", "00:05");
    expect(after.blockId).toBe("late");
    // eslint-disable-next-line no-console
    console.log("key before:", before.key, " key after:", after.key);
    expect(after.key).not.toBe(before.key);
    const planAfter = getCuepointInsertPlan({
      state: state({ cuepointWindowKey: before.key, cuepointFiredKeys: fired }), // row as the 23:50 cycle left it
      currentScheduleItem: after,
      skippedAssetId: "",
      now: new Date("2026-04-06T00:05:00.000Z"),
      timeZone: "UTC"
    });
    // BUG: the 23:10 cue point is due again (and after it airs, 23:30 at the next boundary).
    expect(planAfter?.offsetSeconds).toBe(600);
    expect(planAfter?.firedCount).toBe(0);
  });
});
```

</details>

<details><summary><code>tests/r3-probes/selection/cuepoint-preview-divergence.probe.test.ts</code></summary>

```ts
// PROBE (r3, selection). The worker fires cue point inserts with the pool's insert asset whenever the
// block has no own cue point asset (cuepoints.ts:76 `block.cuepointAssetId || pool.insertAssetId`), also
// with insertEveryItems = 0 -- the configuration tests/unit/cuepoints.test.ts itself uses. The week lens
// (core materializePoolWindow, index.ts:3010-3020) only falls back to the pool insert asset when
// insertEveryItems > 0, so it shows no cue point inserts for a block that will get them on air.
import { describe, expect, it } from "vitest";
import { buildMaterializedProgrammingWeek } from "@stream247/core";
import type { AppState } from "@stream247/db";
import { getCuepointInsertPlan } from "../../../apps/worker/src/cuepoints";

const date = "2026-04-05";
const block = {
  id: "block-1",
  title: "Prime Replay",
  categoryName: "Gaming",
  dayOfWeek: 0, // 2026-04-05 is a Sunday
  startMinuteOfDay: 600,
  durationMinutes: 60,
  poolId: "pool-1",
  sourceName: "Replay Pool",
  cuepointAssetId: "",
  cuepointOffsetsSeconds: [600, 1800]
};
const pool = {
  id: "pool-1",
  name: "Replay Pool",
  sourceIds: ["source-1"],
  playbackMode: "round-robin",
  cursorAssetId: "",
  insertAssetId: "asset-insert",
  insertEveryItems: 0,
  itemsSinceInsert: 0,
  audioLaneAssetId: "",
  audioLaneVolumePercent: 100,
  updatedAt: ""
};
const mk = (id: string, title: string, durationSeconds: number) => ({
  id,
  sourceId: "source-1",
  title,
  path: `/media/${id}.mp4`,
  status: "ready",
  includeInProgramming: true,
  externalId: "",
  categoryName: "",
  durationSeconds,
  publishedAt: "",
  fallbackPriority: 100,
  isGlobalFallback: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: ""
});
const assets = [mk("asset-insert", "Cue Sting", 30), mk("a1", "Ep 1", 900), mk("a2", "Ep 2", 900), mk("a3", "Ep 3", 900)];

describe("cue point inserts: worker vs. week lens", () => {
  it("worker arms the pool insert asset at the 10:10 cue point", () => {
    const plan = getCuepointInsertPlan({
      state: {
        scheduleBlocks: [block],
        pools: [pool],
        assets,
        playout: { cuepointWindowKey: "", cuepointFiredKeys: [] }
      } as unknown as AppState,
      currentScheduleItem: {
        blockId: "block-1",
        key: `${date}:block-1:600:60`,
        title: block.title,
        startTime: "10:00",
        endTime: "11:00",
        startMinuteOfDay: 600,
        durationMinutes: 60,
        poolId: "pool-1"
      },
      skippedAssetId: "",
      now: new Date(`${date}T10:16:00.000Z`),
      timeZone: "UTC"
    });
    expect(plan?.asset.id).toBe("asset-insert");
  });

  it("week lens for the same block shows zero cue point inserts (divergence)", () => {
    const week = buildMaterializedProgrammingWeek({ startDate: date, blocks: [block], pools: [pool], assets });
    const materialized = week[0]!.blocks[0]!;
    // eslint-disable-next-line no-console
    console.log("week lens:", materialized.cuepointCount, materialized.items.map((i) => `${i.kind}:${i.assetId}`).join(" "), materialized.notes);
    expect(materialized.cuepointCount).toBe(0); // worker will air 2
    expect(materialized.items.some((i) => i.kind === "insert")).toBe(false);
    // And the insert asset, eligible in the rotation at cadence 0, is shown as a regular item instead.
    expect(materialized.items.some((i) => i.assetId === "asset-insert" && i.kind === "asset")).toBe(true);
  });
});
```

</details>

<details><summary><code>tests/r3-probes/selection/cycle-end-erases-restart.probe.test.ts</code></summary>

```ts
// PROBE (r3, transitions). REPRODUCTION of the playout cycle's end write (apps/worker/src/index.ts:7944-8019),
// which runs updatePlayoutRuntime on the FRESH row but sets restartRequestedAt and pendingAction from
// constants, not from what the cycle consumed. A Restart / Hard reload / Recover outputs (direct mode) or a
// Refresh written by the admin (apps/web/lib/server/broadcast.ts:58-96) while the cycle runs -- the cycle
// awaits inline resolves, queue probes and startOrSwitchPlayout, i.e. seconds to minutes -- is erased.
// The code already acknowledges this for Skip (index.ts:7816: "A Skip whose restart flag the end write of a
// cycle in flight erased"), which survives only through its skip hold; a plain Restart has no such second
// field and is lost silently while the admin answered "requested".
import { describe, expect, it } from "vitest";

type Row = { restartRequestedAt: string; pendingAction: string; pendingActionRequestedAt: string; currentAssetId: string };

// Verbatim fields of the end write (index.ts:7980, 8013-8014).
const cycleEndWrite = (selection: { reasonCode: string; assetId: string }) => (playout: Row): Row => ({
  ...playout,
  currentAssetId: selection.assetId,
  restartRequestedAt: selection.reasonCode === "scheduled_reconnect" ? playout.restartRequestedAt : "",
  pendingAction: "",
  pendingActionRequestedAt: ""
});

// What updatePlayoutRuntime does (packages/db/src/index.ts:9108-9120): updater over the row read under the lock.
function updatePlayoutRuntime(db: { row: Row }, updater: (row: Row) => Row) {
  db.row = updater(db.row);
}

describe("cycle end write vs. an admin action during the cycle", () => {
  it("erases a Restart requested while the cycle was in flight", () => {
    const db = { row: { restartRequestedAt: "", pendingAction: "", pendingActionRequestedAt: "", currentAssetId: "A" } };
    const snapshotAtCycleStart = { ...db.row }; // readAppState() at the top of runPlayoutCycle
    // admin: runBroadcastAction({ type: "restart" }) while the cycle awaits a resolve
    updatePlayoutRuntime(db, (p) => ({ ...p, restartRequestedAt: "2026-10-01T12:00:05.000Z", pendingAction: "", pendingActionRequestedAt: "" }));
    // admin: Refresh
    updatePlayoutRuntime(db, (p) => ({ ...p, pendingAction: "refresh", pendingActionRequestedAt: "2026-10-01T12:00:06.000Z" }));
    expect(snapshotAtCycleStart.restartRequestedAt).toBe(""); // the cycle never saw it
    updatePlayoutRuntime(db, cycleEndWrite({ reasonCode: "scheduled_match", assetId: "A" }));
    expect(db.row.restartRequestedAt).toBe(""); // BUG: request lost, never acted on
    expect(db.row.pendingAction).toBe(""); // BUG: refresh lost
  });
});

// REPRODUCTION, verbatim condition of the manual-next arm (apps/worker/src/index.ts:5371-5376).
function manualNextArmTaken(playout: { currentAssetId: string; restartRequestedAt: string; status: string }, skippedAssetId: string, manualNextReady: boolean) {
  return (
    manualNextReady &&
    (playout.currentAssetId === "" ||
      (playout.restartRequestedAt !== "" && playout.currentAssetId === skippedAssetId) ||
      playout.status === "standby")
  );
}

describe("Move next X, then Skip the running item A", () => {
  it("with the restart flag intact, X goes on air", () => {
    expect(manualNextArmTaken({ currentAssetId: "A", restartRequestedAt: "t", status: "recovering" }, "A", true)).toBe(true);
  });
  it("when the in-flight cycle erased the flag, the pool's pick replaces A and X waits a whole item", () => {
    // Skip hold on A still active, restartRequestedAt erased by the end write above, A still running.
    expect(manualNextArmTaken({ currentAssetId: "A", restartRequestedAt: "", status: "running" }, "A", true)).toBe(false);
  });
  it("after an ffmpeg crash the exit handler keeps currentAssetId (index.ts:6454) and status 'failed': X waits too", () => {
    expect(manualNextArmTaken({ currentAssetId: "A", restartRequestedAt: "", status: "failed" }, "", true)).toBe(false);
  });
});
```

</details>

<details><summary><code>tests/r3-probes/selection/failing-pool-insert.probe.test.ts</code></summary>

```ts
// PROBE (r3, selection). A pool's automatic insert (insertAssetId + insertEveryItems) that cannot be
// prepared is retried at EVERY boundary, with a fallback blip each time:
//  1. the auto-insert arm ignores quarantine and the source breaker (index.ts:5403-5416), unlike the
//     rotation (isPoolAssetEligible, 4686-4700) and every fallback tier of choosePlaybackCandidate;
//  2. the insert never enters the queue (the rotation excludes it), so the queue probe never quarantines it,
//     and an inline resolve failure only feeds the breaker (recordSelectionResolveOutcome, 6777ff.), which
//     needs 3 DISTINCT items -- one insert asset never opens it;
//  3. a scheduled_insert prepare failure is "recover" (playout-boundary.ts:279-287), the selection is
//     replaced by the recovery plan (index.ts:7377-7400), so `selection.reasonCode === "scheduled_insert"`
//     is false at the counter reset (index.ts:8044-8056) and itemsSinceInsert stays >= insertEveryItems.
import { describe, expect, it } from "vitest";
import { isAssetProbeQuarantined, sourceBreakerGate } from "@stream247/core";
import {
  decideBoundaryPlaybackInput,
  decideInsertAfterPrepareFailure,
  isBroadcastCoverageDown,
  shouldBridgeToFallbackBeforeResolve
} from "../../../apps/worker/src/playout-boundary";
import { planRecoveryAfterPlaybackPreparationFailure } from "../../../apps/worker/src/playout-recovery";

type A = {
  id: string;
  sourceId: string;
  title: string;
  path: string;
  status: string;
  includeInProgramming: boolean;
  isGlobalFallback: boolean;
  fallbackPriority: number;
  playbackProbeFailures?: number;
  createdAt: string;
};
const insert: A = {
  id: "sting",
  sourceId: "yt",
  title: "Sting",
  path: "https://www.youtube.com/watch?v=x",
  status: "ready",
  includeInProgramming: true,
  isGlobalFallback: false,
  fallbackPriority: 100,
  playbackProbeFailures: 5,
  createdAt: "2026-01-01T00:00:00Z"
};
const slate: A = { ...insert, id: "slate", sourceId: "lib", title: "Slate", path: "/media/slate.mp4", isGlobalFallback: true, fallbackPriority: 0, playbackProbeFailures: 0 };

// REPRODUCTION, verbatim predicate of index.ts:5403-5416 (autoInsertAsset), minus the outer pool lookup.
function autoInsertAsset(
  state: { playout: { currentAssetId: string }; assets: A[] },
  currentPool: { insertAssetId: string; insertEveryItems: number; itemsSinceInsert: number },
  skippedAssetId: string
) {
  return currentPool &&
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
}

describe("failing automatic pool insert", () => {
  it("is selected although quarantined and its source held by the breaker", () => {
    expect(isAssetProbeQuarantined(insert)).toBe(true);
    const gate = sourceBreakerGate(
      [{ sourceId: "yt", state: "open", failedAssetIds: ["a", "b", "c"], openedAt: new Date().toISOString(), cooldownSeconds: 3600, lastError: "x", updatedAt: "" } as never],
      Date.now()
    );
    expect(gate.heldSourceIds).toContain("yt");
    const picked = autoInsertAsset(
      { playout: { currentAssetId: "" }, assets: [insert, slate] },
      { insertAssetId: "sting", insertEveryItems: 3, itemsSinceInsert: 3 },
      ""
    );
    expect(picked?.id).toBe("sting"); // selected anyway
  });

  it("a prepare failure goes to recovery, the selection becomes the fallback and the counter is not reset", () => {
    expect(
      decideInsertAfterPrepareFailure({
        selectionReasonCode: "scheduled_insert",
        insertStatus: "",
        insertAssetId: "",
        processRunning: false,
        currentAssetId: ""
      })
    ).toBe("recover");
    const plan = planRecoveryAfterPlaybackPreparationFailure([insert, slate] as never, insert as never, []);
    expect(plan.reasonCode).toBe("global_fallback");
    // index.ts:8048-8052: reset only when selection.reasonCode === "scheduled_insert"
    const selectionReasonCodeAtCycleEnd: string = plan.reasonCode;
    const counterReset = selectionReasonCodeAtCycleEnd === "scheduled_insert";
    expect(counterReset).toBe(false);
    // next boundary: currentAssetId "" again, itemsSinceInsert >= 3 still -> the same insert again.
    const again = autoInsertAsset(
      { playout: { currentAssetId: "" }, assets: [insert, slate] },
      { insertAssetId: "sting", insertEveryItems: 3, itemsSinceInsert: 4 },
      ""
    );
    expect(again?.id).toBe("sting");
  });

  it("a REMOTE pool/cue point insert that is healthy never airs when a local fallback exists", () => {
    // The insert is not in the queue (rotation excludes it, index.ts:4687), so queueProbeCache never holds
    // it (only getPlayableQueuedAssets sets it, index.ts:4870/4886): the boundary decision is a cold resolve.
    const healthy = { ...insert, playbackProbeFailures: 0 };
    expect(decideBoundaryPlaybackInput(null, healthy.id).source).toBe("resolve");
    // At a natural end / duration bound the process is gone.
    const broadcastDown = isBroadcastCoverageDown({ playoutProcessRunning: false });
    // isExpensiveQueueResolve (index.ts:4819-4831): a youtube watch URL is expensive.
    const assetExpensive = true;
    const plan = planRecoveryAfterPlaybackPreparationFailure([healthy, slate] as never, healthy as never, []);
    expect(plan.asset?.id).toBe("slate");
    expect(
      shouldBridgeToFallbackBeforeResolve({ assetExpensive, cacheWarm: false, broadcastDown, fallbackAvailable: true })
    ).toBe(true);
    // index.ts:7277-7296: selection := fallback (reasonCode global_fallback), insertTrigger "" -> no counter
    // reset (8048), no cue point fired key (7909). Next cycle currentAssetId = "slate" != "" so the insert
    // arm (5404) and the cue point arm (5423) are not taken; the pool's next item replaces the slate.
    // Next natural boundary: same again. The insert never airs; every boundary shows the slate briefly.
    const nextCycle = autoInsertAsset(
      { playout: { currentAssetId: "slate" }, assets: [healthy, slate] },
      { insertAssetId: "sting", insertEveryItems: 3, itemsSinceInsert: 3 },
      ""
    );
    expect(nextCycle).toBeNull();
  });
});
```

</details>

<details><summary><code>tests/r3-probes/selection/remove-next-vs-skip-hold.probe.test.ts</code></summary>

```ts
// PROBE (r3, selection). Remove next and Skip share ONE skip-hold slot (skipAssetId/skipUntil).
// A later Skip or a passed chat vote overwrites the hold that "Remove next" put on the next item,
// so the removed item airs immediately -- a chat vote overriding an operator action (M78/M79 intent).
import { describe, expect, it } from "vitest";
import { decidePassedSkipVote, nextPoolRotationAsset } from "@stream247/core";

const assets = ["A", "B", "C", "D"].map((id, i) => ({
  id,
  sourceId: "src",
  title: id,
  status: "ready",
  createdAt: `2026-01-0${i + 1}T00:00:00.000Z`
}));
const now = Date.parse("2026-10-01T12:00:00.000Z");
const in60 = new Date(now + 60 * 60_000).toISOString();

// The worker's pool eligibility as far as the skip hold goes (index.ts:4686-4700 isPoolAssetEligible).
const pickAfter = (cursor: string, skipped: string) =>
  nextPoolRotationAsset({
    pool: { sourceIds: ["src"], cursorAssetId: cursor },
    assets,
    isEligible: (a) => a.status === "ready" && a.id !== skipped
  })?.asset.id;

describe("Remove next hold vs. a later skip-hold write", () => {
  it("operator removed C (next after B); chat vote on B passes and C airs next", () => {
    // State after the operator's Remove next (apps/web/lib/server/broadcast.ts:398-406): B on air, C held.
    const row = {
      overrideMode: "schedule",
      overrideAssetId: "",
      overrideUntil: "",
      skipAssetId: "C",
      skipUntil: in60,
      liveBridgeStatus: "",
      liveBridgeInputUrl: "",
      insertAssetId: "",
      insertStatus: "",
      currentAssetId: "B",
      assets,
      nowMs: now
    };
    expect(pickAfter("B", row.skipAssetId)).toBe("D"); // the operator's intent: C is out

    const decision = decidePassedSkipVote({ ...row, votedAssetId: "B" });
    expect(decision.kind).toBe("apply");

    // REPRODUCTION of the worker's write on "apply" (apps/worker/src/index.ts:9483-9492, verbatim fields):
    //   skipAssetId: effect.assetId, skipUntil: now + CHAT_SKIP_HOLD_MINUTES, restartRequestedAt: now
    const afterVote = { ...row, skipAssetId: "B" };
    const next = pickAfter("B", afterVote.skipAssetId);
    // BUG: the item the operator removed for an hour is what the vote puts on air.
    expect(next).toBe("C");
  });

  it("the operator's own Skip of B also lifts their Remove next of C (broadcast.ts:458-470 overwrites skipAssetId)", () => {
    const afterSkip = { skipAssetId: "B" };
    expect(pickAfter("B", afterSkip.skipAssetId)).toBe("C");
  });
});
```

</details>

<details><summary><code>tests/r3-probes/selfheal/ensure-database-cached-rejection.test.ts</code></summary>

```ts
// R3 probe (untracked): does ensureDatabase cache a rejected bootstrap promise forever?
// Needs a reachable Postgres at R3_PG_TARGET (default 127.0.0.1:55432, the r3-selfheal-pg container).
// The DB URL points at a local TCP forwarder that is CLOSED at first (ECONNREFUSED, like Postgres
// being down when web boots) and OPENED later (Postgres back).
import net from "node:net";
import { afterAll, describe, expect, it } from "vitest";

const target = (process.env.R3_PG_TARGET ?? "127.0.0.1:55432").split(":");
const PROXY_PORT = 55499;
process.env.DATABASE_URL = `postgresql://stream247:stream247@127.0.0.1:${PROXY_PORT}/stream247`;

let server: net.Server | null = null;
function openForwarder(): Promise<void> {
  server = net.createServer((client) => {
    const upstream = net.connect(Number(target[1]), target[0]);
    client.pipe(upstream).pipe(client);
    client.on("error", () => upstream.destroy());
    upstream.on("error", () => client.destroy());
  });
  return new Promise((resolve) => server!.listen(PROXY_PORT, "127.0.0.1", () => resolve()));
}

describe("ensureDatabase after a failed first bootstrap", () => {
  afterAll(async () => {
    const db = await import("@stream247/db");
    await db.resetDatabaseConnectionsForTests();
    server?.close();
  });

  it("keeps failing after Postgres is reachable again, until the module-global promise is reset", async () => {
    const db = await import("@stream247/db");
    await db.resetDatabaseConnectionsForTests();

    // 1. Postgres "down": bootstrap rejects.
    const first = await db.ensureDatabase().then(() => "ok", (e: Error) => e);
    expect(first).toBeInstanceOf(Error);
    console.log("[probe] ensureDatabase #1 (db down):", (first as Error).message);

    // 2. Postgres "back".
    await openForwarder();
    const direct = await new Promise<string>((resolve) => {
      const s = net.connect(PROXY_PORT, "127.0.0.1", () => { s.end(); resolve("tcp-open"); });
      s.on("error", (e) => resolve(`tcp-error ${e.message}`));
    });
    console.log("[probe] forwarder now:", direct);

    const second = await db.ensureDatabase().then(() => "ok", (e: Error) => e);
    console.log("[probe] ensureDatabase #2 (db up):", second instanceof Error ? second.message : second);
    console.log("[probe] same cached error object:", second === first);
    const health = await db.getDatabaseHealth();
    console.log("[probe] getDatabaseHealth (db up):", health);
    const read = await db.readAppState().then(() => "ok", (e: Error) => `rejects: ${e.message}`);
    console.log("[probe] readAppState (db up):", read);

    expect(second).toBe(first);
    expect(health).toBe("error");
    expect(read).toMatch(/^rejects/);

    // 3. Only the test-only reset clears it.
    await db.resetDatabaseConnectionsForTests();
    const third = await db.ensureDatabase().then(() => "ok", (e: Error) => e.message);
    console.log("[probe] ensureDatabase #3 after resetDatabaseConnectionsForTests:", third);
    expect(third).toBe("ok");
  }, 60_000);
});
```

</details>

<details><summary><code>tests/r3-probes/selfheal/harness/fetch-stub.mjs</code></summary>

```js
// Preload for the real worker binary: Twitch is unreachable from this sandbox (proxy 403), so the
// one HTTP response under test is synthesised. Everything else (DB, worker loop) is real.
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input.url ?? String(input);
  if (url.includes("twitch.tv")) {
    const isRefresh = url.startsWith("https://id.twitch.tv/oauth2/token");
    console.error(JSON.stringify({ ts: new Date().toISOString(), component: "r3-stub", url, status: isRefresh ? 400 : 200 }));
    if (isRefresh) {
      return new Response(JSON.stringify({ status: 400, message: "Invalid refresh token" }), { status: 400, headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { "content-type": "application/json" } });
  }
  return realFetch(input, init);
};
```

</details>

<details><summary><code>tests/r3-probes/selfheal/harness/run.sh</code></summary>

```bash
#!/bin/bash
# usage: run.sh <mode> <dir>
MODE=$1; DIR=$2; mkdir -p $DIR/media; cd $DIR
export DATABASE_URL=postgresql://stream247:stream247@127.0.0.1:55432/stream247
export MEDIA_LIBRARY_ROOT=$DIR/media
export APP_SECRET=r3-selfheal-probe-secret-0123456789abcdef0123456789
export NODE_ENV=production
start=$(date +%s)
node /home/claude/stream247/apps/worker/dist/index.js $MODE > $DIR/out.log 2>&1
code=$?
echo "EXITED code=$code at $(date -u +%H:%M:%S) after $(( $(date +%s)-start ))s" >> $DIR/out.log
```

</details>

<details><summary><code>tests/r3-probes/selfheal/harness/seed-twitch.mjs</code></summary>

```js
const db = await import("/home/claude/stream247/packages/db/dist/index.js");
await db.ensureDatabase();
const s = await db.readAppState();
await db.updateTwitchConnectionRecord({
  ...s.twitch,
  status: "connected",
  broadcasterId: "123456",
  broadcasterLogin: "r3probe",
  accessToken: "expired-access-token",
  refreshToken: "revoked-refresh-token",
  connectedAt: new Date(Date.now() - 86400000).toISOString(),
  tokenExpiresAt: new Date(Date.now() - 60000).toISOString(),
  error: ""
});
const after = await db.readAppState();
console.log("seeded twitch:", after.twitch.status, after.twitch.tokenExpiresAt, "workerHeartbeatAt=", after.playout.workerHeartbeatAt);
process.exit(0);
```

</details>

<details><summary><code>tests/r3-probes/selfheal/restart-flag-swallowed.repro.test.ts</code></summary>

```ts
// R3 probe (untracked) -- REPRODUCTION, not the worker itself (apps/worker/src/index.ts starts loops on
// import). It runs the real @stream247/db updatePlayoutRuntime against real Postgres with the exact
// updaters the code uses:
//   web press     apps/web/lib/server/broadcast.ts:82-90  (restart / hard_reload)
//   cycle read    apps/worker/src/index.ts:6938 (+ re-reads up to 7479; none after the restart check)
//   cycle decides apps/worker/src/index.ts:7506  restartRequested = Boolean(state.playout.restartRequestedAt) && ...
//   cycle end     apps/worker/src/index.ts:7980  restartRequestedAt: reasonCode === "scheduled_reconnect" ? playout.restartRequestedAt : ""
// Needs Postgres at 127.0.0.1:55432 with database r3restart (container r3-selfheal-pg).
import { afterAll, describe, expect, it } from "vitest";

process.env.DATABASE_URL = process.env.R3_RESTART_DB_URL ?? "postgresql://stream247:stream247@127.0.0.1:55432/r3restart";

describe("operator Restart pressed while a playout cycle runs", () => {
  afterAll(async () => {
    const db = await import("@stream247/db");
    await db.resetDatabaseConnectionsForTests();
  });

  it("is cleared by the cycle-end write without any restart happening", async () => {
    const db = await import("@stream247/db");
    await db.resetDatabaseConnectionsForTests();
    await db.updatePlayoutRuntime((p) => ({ ...p, restartRequestedAt: "" }));

    // Cycle N starts (I:6938).
    const state = await db.readAppState();
    const selection = { reasonCode: "scheduled", queueKind: "asset" as const };

    // Operator presses Restart while cycle N is resolving its input (broadcast.ts:82-90).
    const now = new Date().toISOString();
    await db.updatePlayoutRuntime((playout) => ({
      ...playout,
      status: "recovering",
      restartRequestedAt: now,
      heartbeatAt: now,
      pendingAction: "",
      pendingActionRequestedAt: "",
      message: "Manual playout restart requested from the admin API."
    }));

    // Cycle N decides from its own snapshot (I:7506).
    const restartRequested = Boolean(state.playout.restartRequestedAt) && selection.queueKind !== "live";

    // Cycle N end-of-cycle write (I:7933 updater, field at I:7980). `playout` is the FRESH row.
    let seenByUpdater = "";
    await db.updatePlayoutRuntime((playout) => {
      seenByUpdater = playout.restartRequestedAt;
      return {
        ...playout,
        restartRequestedAt: selection.reasonCode === "scheduled_reconnect" ? playout.restartRequestedAt : ""
      };
    });

    // Cycle N+1 reads.
    const next = await db.readAppState();
    console.log("[probe] cycle N acted on restart:", restartRequested);
    console.log("[probe] press timestamp written by web:", now);
    console.log("[probe] value the cycle-end updater saw:", seenByUpdater);
    console.log("[probe] restartRequestedAt seen by cycle N+1:", JSON.stringify(next.playout.restartRequestedAt));

    expect(restartRequested).toBe(false);
    expect(seenByUpdater).toBe(now);
    expect(next.playout.restartRequestedAt).toBe("");
  }, 60_000);
});
```

</details>
