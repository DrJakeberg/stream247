# Stream247 Plan

What to build next. The rules for every session are in `AGENTS.md`. Everything up to and including
2.2.0-rc.1 (M0-M83: milestone sections, progress notes, DUT checks, follow-up lists) is kept verbatim in
`planning/archive/plans-m0-m83.md`; `git log --follow` on that file shows its history.
2.3.0 (M84-M106 and M109, and the superseded M83 row: rows, notes and the DUT checks it ran) is in
`planning/archive/plans-m84-m109.md`.
2.3.1 (M107, M108 and M110: rows, notes and the M108 DUT checks) is in
`planning/archive/plans-m107-m110.md`.

How this file works:

- **Open** lists every milestone whose release commit is not yet on `main`. A row leaves the table when
  its release commit lands and is entered under **Shipped**.
- A milestone that needs more than its row (decisions, measurements, DUT checks, follow-ups) gets a
  section under **Milestone notes** at the end of this file. When its release ships, the section moves to
  an archive file under `planning/archive/`, text unchanged.
- Checks that only the device under test (DUT) can run do not hold a merge; they go under **DUT checks for
  the next release candidate**, and the release that ships them runs them.

## Open

| Milestone | Type | Priority | Status | Goal | Acceptance | Touched Areas | Risk | Rollback |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| M111 The Soak Monitor Follows The Web Container | Ops | Now | Complete | The soak monitor measures the `web` container where it is now and notices a Docker daemon restart (owner decision 2026-10-20: "ja, mach den Soak-Monitor robuster"; on 2026-10-18 a daemon restart moved `web` from `172.22.0.7` to `.5`, the soak asked the old address for 6 min and ended `outage-exceeded` although the channel was on air again 16 s later) | `--follow-web` takes the readiness URL from `web`'s address on the stack network (`docker compose ps -q web`, `docker inspect`, the project's network first), reads it again on a refused connection (curl 7) and, when it moved, logs one `web-address-changed old=… new=…` line and takes the sample there; no `web` at the start stops with a clear message; an explicit `CHECK_BASE_URL` keeps today's behaviour and is never looked up; every docker call is bounded (`SOAK_DOCKER_TIMEOUT_SECONDS`, 10 s), so a daemon that does not answer cannot hold the samples back and a long off-air time with `dockerd` down still ends `outage-exceeded`; every service's `State.StartedAt` is read after each healthy sample and once more when an outage ends the soak, never while one runs, a move of all is logged as `docker-daemon-restart startedAt=…`, of some as `container-started-again`, neither fails the soak by itself, both are counted in the completion line (`dockerRestarts=N containersStartedAgain=N`); script tests for these cases fail without the change; step 10 of *Safe Upgrade Flow* uses `--follow-web` and a log name with seconds | scripts (soak monitor), tests, docs (deployment, README), `AGENTS.md` soak line | low: an ops script only; the start-time read adds five `docker compose ps` and five `docker inspect` calls per healthy sample, each bounded | revert the merge; a soak started with `--follow-web` is started again with `CHECK_BASE_URL=http://<web address>:3000` |
| M112 A Broken Source Neither Crashes Nor Stalls The Loop | Reliability | Now | Complete | Suggestions 1, 2 and 3 of `planning/suggestions-2026-10-04.md` (owner's go 2026-10-20 23:55 UTC: "Nichts zurückhalten, kann alles nach seinen tests auf main"): a noisy ffmpeg no longer exhausts the connection pool (M98 follow-up 2), a pool no longer stays on a pick that cannot be prepared (M98 follow-up 1), sources on a dead host no longer hold the worker cycle until the stall guard (M87 limit) | `pnpm exec vitest run tests/unit/coalescing-writer.test.ts tests/unit/selection-pass-over.test.ts tests/unit/remote-call-budget.test.ts` green: (1) a burst of 400 stderr lines with two per-line writes exhausts a 10-connection model pool (> 100 "timeout exceeded when trying to connect"), the same burst through `CoalescingWriter` gives 0 and leaves a connection to the cycle; the two stderr handlers of `index.ts` call no `updatePlayoutRuntime(`, `upsertIncident(`, `markDestinationFailure(` or `updateProgramFeedRuntimeStatus(` directly; (2) three broken items of one source, every resolve failing, 15 s cycles: without the pass-over the pool picks the first for 17 cycles and the breaker holds one item, with it the picks are the three items and then the fallback, the breaker open with three items; the failed pick is written to the probe cache as counted and joins quarantine's list after the outage filter (pins in `selection-pass-over.test.ts`, `probe-network-outage.test.ts`, `source-breaker-wiring.test.ts`); (3) the worker's budget classes on a simulated clock: without the budget two dead YouTube hosts and a dead Twitch host hold one cycle > 300 s; with it, for stall guards of 60, 120 and 300 s and 1 or 10 s of earlier steps, 60 cycles of two dead and two healthy YouTube sources and one dead and one healthy Twitch source: every call ends by 80 % of the stall guard, no healthy source is ever reported failed, each dead host is reported and never twice within 10 min, every healthy source syncs again within a bounded number of cycles; a 115 s YouTube and a 110 s Twitch listing are never reported failed; five 100 s YouTube channels and a 100 s Twitch source: no failure, the Twitch source waits one cycle at most, each YouTube source five at most; three 100 s Twitch channels and two YouTube sources: each YouTube source waits one cycle at most, each Twitch source two; Twitch sources that were deferred and then disabled hold no YouTube source back; a healthy Twitch source behind two YouTube listings that leave no room after them (119.5 s after 1 s, 115 s after 10 s, 40 s at a 120 s stall guard) or behind seven dead YouTube hosts waits one cycle at most; a Twitch sync without room even alone (earlier steps leave 120.5 s) keeps YouTube waiting one cycle at most; a host back after 5 min syncs within the pause plus 5 min and on every cycle after; pins: both syncs take `fitsWhole` (YouTube with the Twitch reserve), walk `orderDeferredFirst`, skip paused sources, pause on a timeout, the chapter backfill takes `fitsWhole` | `apps/worker` (`coalescing-writer.ts`, `selection-pass-over.ts`, `remote-call-budget.ts`, `index.ts`), tests, `docs/operations.md` | low: the stderr sample and incidents in the database lag a burst by up to 2 s / 10 s (the container log keeps every line); a pool item whose probe failed in the last minute loses its turn in this pass of the rotation; a source deferred by the budget is synced a cycle later, one whose call ran out of its 2 min 10 min later; more slow sources than fit one cycle sync over several | revert the merge |
| M113 Overlay Data And Twitch Segments That Do Not Go Unnoticed | Reliability | Now | Complete | Suggestions 4 and 5 of `planning/suggestions-2026-10-04.md` (owner's go 2026-10-20 23:55 UTC): no JSON column of the overlay or of a stored scene preset can fail every state read any more (M85 guarded only `custom_layers_json`), and a stale Twitch schedule segment Twitch did not delete is tried again and named instead of forgotten (M88) | (4) `pnpm exec vitest run tests/integration/db-roundtrip.test.ts` green, its test "reads overlay rows and presets whose other JSON columns are unreadable or wrongly shaped (M113)": the live row holds text that is not JSON in `layer_order_json`, `disabled_layers_json`, `scenes_json` and `panel_placements_json`, the draft JSON of the wrong shape (`5`, `"chat"`, `null`, `[1, 2]`), three presets hold a cut-off object, `null` and fields of the wrong type (`"disabledLayers": 5` made the normalizer throw `includes is not a function`); `readOverlayStudioState`, `listOverlayScenePresetRecords` and `readAppState` succeed with the default layer order, no disabled layers, no placed panels and at least one scene; without the change the same test fails with `SyntaxError: Unterminated string in JSON`; (5) `pnpm exec vitest run tests/unit/twitch-schedule-cleanup.test.ts tests/unit/schedule-midnight.test.ts tests/unit/incident-classes.test.ts` green: a 2xx or 404 counts as deleted, 400/401/403/429/500/503 and a request without an answer do not; of six stale segments (204, 404, 500, 429, timeout, and a 400 for one that started 30 min ago) every one is asked once in order, the 500, 429 and timeout ones are kept unchanged for the next sync, the started one is dropped and logged with `kept: false`; a segment refused once and deleted on the next sync is gone after two syncs; kept keys do not count as a change of the schedule (no full resend every cycle), a newly removed block still does; a PATCH of a stored segment that answers 404 (deleted by hand, or a delete Twitch did not confirm and that is planned again) is sent again as a POST instead of failing every sync; pins: the sync deletes through `deleteStaleTwitchScheduleSegments`, stores `[...nextSegments, ...staleCleanup.kept]`, raises `twitch.schedule.delete.failed` (state, warning, registered in `incident-classes.ts`) while one is kept and closes it otherwise, logs `twitch.schedule.segment.delete_failed`; the pin test fails on `main` without the change | `packages/db` (overlay and preset readers), `apps/worker` (`twitch-schedule-cleanup.ts`, `index.ts`, `incident-classes.ts`), tests, `docs/operations.md` | low: an unreadable overlay column now reads as an empty one (default order, no panels) instead of stopping the state read; a kept segment is retried with the regular 15-min sync, and after a worker restart once at once | revert the merge |
| M114 A Frozen Process Restarts And The Relay Is Watched | Reliability | Now | Complete | Suggestion 6 of `planning/suggestions-2026-10-04.md` (owner's go 2026-10-20 23:55 UTC; owner's choice 2026-10-21 08:11 UTC: "A: Aufpasser im Container", relay "Melden und neu starten", see the M114 notes): a worker, playout or uplink process with a blocked event loop or stopped by SIGSTOP restarts after five minutes (M103 could not, Compose does not restart `unhealthy` containers), and a relay that stops answering is reported (the pinned image cannot run a healthcheck) | `pnpm exec vitest run tests/unit/process-supervisor.test.ts tests/unit/relay-watch.test.ts tests/unit/incident-classes.test.ts tests/unit/incident-actions.test.ts` green: the supervisor kills a child whose event loop blocks, one stopped by SIGSTOP and one that never sends a heartbeat (SIGKILL, exit 1, a marker for the next process), and leaves a child that sends heartbeats alone and ends with its exit code (3); silence counts from the last heartbeat, from the start before the first; the marker is handed out once, an unreadable one is dropped; the real `startSupervisorHeartbeat` keeps a supervised child alive past the bound, and a closed IPC channel does not crash the child (exit 4, not the uncaught-exception path's 9; without the change it is 9); the Dockerfile `CMD` and the playout and uplink `command` of `docker-compose.yml` and `docker-compose.dev.yml` run `apps/worker/dist/supervisor.js`, the three healthchecks still `index.js healthcheck`; `index.ts` starts the heartbeat and reports `<mode>.health.frozen-restart` before `runLoop`; `RelayWatch` raises `relay.unreachable` at 120 s without an answer and once, never while answers come in between, closes on the first answer (also one an earlier process left open) and when nothing uses the relay; any HTTP answer counts as alive, a refused or hung request (5 s) not; `relay.unreachable` is a state incident with the action `docker compose restart relay`; the worker cycle has the step `relay`; the relay service keeps `bluenviron/mediamtx:1.15.4` and has no healthcheck. Run by hand with the built worker on PostgreSQL 16 (M114 notes): `kill -STOP` of the child ended the supervisor after 305 s (`worker.supervisor.frozen`), the next start raised `worker.health.frozen-restart`; with relay mode on and no relay the worker raised `relay.unreachable` after 125 s and closed it on the next cycle once a stand-in answered on `relay:9997`. Follow-up (owner's choice 2026-10-22 20:34 UTC, "A und kleiner Relay-Wächter"): `pnpm exec vitest run tests/unit/relay-restart.test.ts` green: the policy restarts after 180 s without an answer (more than the incident's 120 s) and once, never while answers come in between, backs off 5, 10, 20, 40, then 60 min, starts again after 30 min of answers, and leaves a stopped, paused or missing relay alone, and one that has not answered since the start or its last restart; answers from before a stop do not count towards the reset; a round finds the relay by the watchdog's own `com.docker.compose.project` label, `com.docker.compose.service=relay` and `com.docker.compose.oneoff=False`, prefers the running container and posts only `/containers/<relay>/restart?t=10`, asks no API of a paused relay, and does nothing without its own container or the socket; `docker-compose.yml` has `relay-watchdog` with `relay-watchdog.js` and the socket, no `env_file`, and no other service but traefik mounts the socket. Run with the real relay image in Docker (M114 notes): a relay stopped with `docker kill -s STOP` was restarted after 210 s and its API answered 200, a paused one was left alone for 5 min | `apps/worker` (`process-supervisor.ts`, `supervisor.ts`, `relay-watch.ts`, `relay-restart.ts`, `relay-watchdog.ts`, `index.ts`, `incident-classes.ts`), `packages/core` (`incident-actions.ts`), `docker/worker.Dockerfile`, `docker-compose.yml`, `docker-compose.dev.yml`, tests, `docs/operations.md` | low: one more node process per worker, playout and uplink container (about 40 MB each); a process that blocks its event loop for five minutes is killed, with the playout's ffmpeg when its container ends; a compose file of the operator's own that keeps `index.js` as its command runs without the supervisor as before; the relay probe adds at most 5 s to a worker cycle while the relay hangs; `relay-watchdog` holds the Docker socket (root on the host), used only to find and restart the relay | revert the merge |
| M115 A Stock RTMP Server Takes The Uplink | Reliability | Now | Complete | Suggestion 7 of `planning/suggestions-2026-10-04.md` (owner's go 2026-10-20 23:55 UTC; owner's choice 2026-10-22 20:34 UTC: "Ja, reparieren"): an output on the operator's own RTMP server (the M99 wizard offers *Another RTMP service*) publishes and keeps publishing; before, every encoded tee output started with an empty AVC sequence header, MediaMTX refused it and the fifo never published again (M98 follow-up 3) | `pnpm exec vitest run tests/unit/tee-global-header.test.ts tests/unit/ffmpeg-runtime.test.ts` green: an encoded tee output gets `-flags:v +global_header` right before `-f tee`, the uplink's copy command, the relay's flv output and the HLS feed do not, and every `appendFfmpegOutputArgs` call of the playout (relay off, tee straight to the destinations) takes the default; `pnpm test:broadcast-path` in the pull request's CI (the real images) green with phase 5: a second primary destination on MediaMTX 1.15.4 (the relay's image) closes its connection at most once over the 60 s measurement (one uplink restart for another reason is tolerated), logs no `unable to parse H264 config`, and a reader gets bytes back; mutation: the worker image's ffmpeg with the uplink's encoder and tee options minus the flag is refused by the same server (the count of that line rises) | `apps/worker/src/ffmpeg-runtime.ts`, `scripts/broadcast-path-smoke.sh`, tests, `docs/operations.md` | low: Twitch gets the complete header OBS sends instead of an empty one (DUT check below); a stream copy is unchanged | revert the merge |
| M116 The Setup And Schedule Texts Say What Happens, The Library List Comes First | UX | Now | Complete | Suggestions 8, 12 and 13 of `planning/suggestions-2026-10-04.md` (owner's go 2026-10-20 23:55 UTC): the setup form no longer says an unusable `CHANNEL_TIMEZONE` overrides the saved zone (M85 skips it), the schedule tips no longer describe the model before M88, and the library list no longer sits below curated sets and bulk editing (R2 U3, left out by M99) | `pnpm exec vitest run tests/unit/onboarding-first-run.test.ts tests/unit/schedule-midnight.test.ts tests/unit/setup-first-programme.test.ts` green: (8) `/setup?step=instance` with `CHANNEL_TIMEZONE=Europe/Berln` and the saved zone `America/New_York` says the variable "is not a time zone name this install knows, so it is ignored and the zone saved here is used (empty means UTC)", never "overrides", and shows the saved zone in the field; with ` Europe/Vienna ` it still says it overrides; unset, nothing about the environment; (12) the *Conflicts only* tip counts the part of a block past midnight on the next day and says a dated block over the weekly programme is not a clash (no "on the same weekday"), the cuepoint tip says each time fires once per airing also past midnight (no "re-arm"), the start tip names the next day's block a block past midnight runs into (no "on the same day"), the behaviour pinned by the C1 and C3 cases of the same file; (13) a library of two assets renders the first card after the filters and before the selection line, the curated sets and the bulk fields; each of the three fails on `main` without the change; `scripts/design-baseline.sh` green with the library baselines re-recorded | `apps/web` (`apps/web/app/setup/page.tsx`, `setup-instance-form.tsx`, `schedule-editor-workspace.tsx`, `schedule-block-form.tsx`, `asset-library-browser.tsx`), tests, design and wording baselines of the library, `docs/operations.md` | low: wording and the order of one page; selecting assets and acting on them now happens below the list | revert the merge |
| M117 A Password Change Signs The Old Sessions Out | Security | Now | Complete | Suggestion 9 of `planning/suggestions-2026-10-04.md` (owner's go 2026-10-20 23:55 UTC): after a change or reset of the owner password, a session signed in with the old one (a leaked one included) no longer stays valid for up to 30 days (M91: "sessions are stateless"), and first-run setup no longer hard-codes the minimum length 10 | `pnpm exec vitest run tests/unit/session-password-binding.test.ts tests/unit/owner-password-change.test.ts tests/unit/onboarding-first-run.test.ts` green: a session cookie carries a stamp of the password it signed in with (`userId:issuedAt:stamp:signature`, the stamp an HMAC of the stored hash with the app secret); it resolves while the hash is unchanged and not after it changed, a cookie for the new hash does; a user row without a hash takes the `system_state` hash as the sign-in does; a Twitch sign-in of the team survives an owner password change; a cookie of the old three-part shape, a forged stamp and another user id are refused; the 30-day expiry still holds; mutation: without the stamp comparison in `resolveSessionUser` the change test fails; the change route sets a new cookie for the changing session with the new hash, answers "Every other signed-in session is signed out." and audits "other sessions were signed out"; the setup form renders the length it is given (`minLength="12"` for 12), and `apps/web/app/api/setup/bootstrap/route.ts`, `setup-form.tsx` and `change-password-form.tsx` contain no literal 10 for it; `pnpm test:integration` green, `first-run.test.ts`: a session from a sign-in with the old password resolves before the container reset command and is refused after it, the sign-in with the new one resolves | `apps/web` (`apps/web/lib/server/auth.ts`, the sign-in, 2FA, Twitch, bootstrap and password routes, `setup-form.tsx`, `change-password-form.tsx`, `apps/web/app/setup/page.tsx`, the settings page), `apps/worker/src/reset-owner-password.ts`, tests, `docs/operations.md` | low: the update signs everyone out once (older cookies carry no stamp); a password change keeps only the session that made it | revert the merge |
| M118 The Week View And /channel Plan With What Really Airs | UX | Now | Complete | Suggestions 14, 15, 16 and 17 of `planning/suggestions-2026-10-04.md` (owner's go 2026-10-20 23:55 UTC): the week projection (week view, `/channel`, `/channel.ics`) no longer lists a Twitch VOD in its cache cooldown (M94, M97 "Not built"), starts the block on air after the item on air, not now, fills a dated block of the weekly block's own pool between the weekly block's two parts, projects a 24 h block of very short clips to its end (M97 "Left"), lets an item that runs over its block delay the next weekly block, keeps an item of unknown length as *Now* (M100 "Left"), and the live view's cuepoint summary applies a dated block's air windows like the worker (M101 "Left") | `pnpm exec vitest run tests/unit/week-projection-times.test.ts` green: (15) a 10-14 block at 10:10 with the item on air ending 11:00 lists its next items at 11:00, 12:00, 13:00 (not 10:10) with the day still 240 min projected; weekly 18-22 and a dated 20-21 of one pool give a1-a6 18:00-19:40, a7-a9 20:00-20:40, a1-a3 21:00-21:40, the worker's `walkPoolRotation` order item by item; a 24 h block of seven 3-second clips projects 1440 min (5 000 items gave 250) and hands Tuesday clip `28800 mod 7 + 1`; (16) the item on air 10:40-11:40 holds weekly B (11-13) to 11:40 in the week view and in `/channel`'s *Up next*; a projected 50-min item from weekly A (10-11) starts weekly B at 11:40, a dated B at 11:00 with A cut; a block the item before covers completely lists nothing, reads *Covered by the item before* and is not `empty`; an item on air without a length stays *Now* with `endsAt` "", the page says "since 10:00" with no progress bar, and *Up next* starts at 10:30 (the 30-min estimate), with a length of 25 min at 10:25; (14) a Twitch VOD whose download failed at 10:45 is skipped by the projection until 11:15 (default cooldown 30 min, read from the managed setting or env as the worker reads it) and picked after, with a note; `getTwitchVodCacheCooldownEndMs` (core) and the worker's `isTwitchVodCacheCoolingDown` agree on four cases; (17) at 21:15 on a weekly 18-22 with cuepoints 18:30, 20:00, 21:10 and a dated 20-21, the worker's plan and the live summary both give due 21:10, total 2 (the summary gave 3 before); seven of the cases fail on `main` (run with the core and web changes stashed), the cuepoint case fails with the air windows removed from `getOccurrenceCuepointProgress`; `tests/unit/pool-rotation.test.ts` and `tests/unit/schedule-midnight.test.ts` pin `createBlockProjection` and the shared cuepoint function | `packages/core` (`index.ts`: the week projection, `getOccurrenceCuepointProgress`; `twitch-vod-playback.ts`; viewer messages), `apps/web/lib/server/state.ts`, `apps/web/lib/public-programme.ts`, `apps/web/lib/public-channel-view.ts`, `apps/worker/src` (`cuepoints.ts`, `twitch-vod-cache.ts`), tests, `docs/operations.md`, `docs/architecture.md` | low: projection only, nothing on air changes; a week of 1-second clips takes longer to project (at most 200 000 items per block) | revert the merge |

The findings outside the milestones in `planning/suggestions-2026-10-04.md` are taken in their order, one
milestone at a time, since the owner's go of 2026-10-20 23:55 UTC (1-3: M112, 4-5: M113, 6: M114, 7: M115, 8, 12 and 13: M116, 9: M117, 14-17: M118; 26 and 27 only the owner
can do). Waiting for the owner: for M86 the confirmation that only cycles
in which the database cannot be reached count towards the five-minute exit (recommended: keep it so;
*Decision* in the M86 notes, `planning/archive/plans-m84-m109.md`).

## Owner-gated and deferred

Never started by a session on its own. The gate says what has to happen first.

| Milestone | Gate | State | Details |
| --- | --- | --- | --- |
| M66 Live Bridge Rehearsal | Needs a live source pushed by the owner and replaces the programme on air: never without the owner | In progress since 2.0: live-bridge takeover and release observed on the DT stack with the operator present; findings recorded | archive, section *M66 Live Bridge Rehearsal* |
| M57 Embedded Video Sources As Scene Layers, soak part | Needs a live source pushed by the owner and overlays the programme on air: never without the owner | Stages 1 and 2 (A-E) done; open: a mandatory DT soak gate before any deploy, plus per-layer cadence | archive, section *M57 Embedded Video Sources As Scene Layers* |
| M77 Resume Interrupted Item | Deferred by the owner on 2026-10-01: start only when the owner asks | Scope when started: persisted offset, `-ss` for cached Twitch VODs first, duration bound and chapter windows offset-aware, soaked on the DUT because it touches the seam chain | archive, row M77 |
| M81 Admin Interface Language | Deferred by the owner on 2026-10-01 (viewer side first, M80): start only when the owner asks | The admin interface in the channel language | archive, row M81 |

## Known follow-ups

Not milestones. Each line names where the full text is: "Mxx" means the *Follow-ups* list (or *Limits and
follow-ups*, *Open*) of that milestone's section in `planning/archive/plans-m0-m83.md`. "Covered by Mxx"
means a planned milestone above takes it on.
For M84-M106 and M109 that section is in `planning/archive/plans-m84-m109.md`.
For M107, M108 and M110 it is in `planning/archive/plans-m107-m110.md`.

Playout and pools:

- Two pools that share a source keep separate positions and can pick the archive the other pool just
  aired; a product decision (M73).
- Preview blocks start from the stored position, so two blocks of one pool on one day preview the same
  first items (M73). The week view and the Day lens's fill preview carry the rotation since M97; the Day
  lens's video timeline (`buildSchedulePreviewVideoSlots`) still starts each block from the stored position.
- A manual next, Play now or Pin does not move the pool's position; the item can come round again (M73,
  M74, M78).
- A vanished position cannot be continued after; storing the order key of the last started item per
  source would fix it (M73).
- After a rollback below 2.1 and a re-upgrade, the pool's other sources keep their 2.1 positions and can
  repeat items (M73).
- A pool cannot choose which source plays first other than by naming (M73).
- Move next is cleared by Play now (M74).
- An insert on air restarts from 0 after a direct-mode planned reconnect (M74, M78).
- The admin reads an archive's cache state, not the file: an evicted cache that still says `ready` passes
  the refusal (M74).
- Force reconnect and Recover outputs do not know the relay mode (M74).
- Per-item quarantine counts a queued or running Twitch download as a failed probe (M75).
- Deleting a source leaves its `playout.source-unplayable.<sourceId>` incident open (M75).
- A pool with only a broken source can stay stuck on one item that fails inline every cycle (M75).
- The previews apply the breaker as it stands to the whole week (M75).
- A block mapped to a source by name and the global fallback asset ignore the breaker (M75).
- The breaker's cooldowns and threshold are constants, not managed settings (M75).
- The IRC handler learns of a new Pin or insert only at the next worker cycle (M78, M79).
- Starting a Live Bridge does not warn that a pending Play now will be dropped (M78).
- M82 limits: the output host stands for the whole way out; the corroboration check costs up to 2.5 s
  in the cycle; an archive refused because its download failed in an outage still counts; a blip
  shorter than one resolve can count one failure; an uncorroborated network-looking failure is not
  logged as such (M82).
- A scheduled uplink reconnect that falls on the nightly blip leaves that blip without M109's grace; it
  could keep the on-air time of a profile it stops while it delivers, or begin an episode when it stops a
  faulted process (M109, *Not covered*).
- The admin's scene preview (`buildActiveScenePayload`, `/api/scenes`) still shows the queue's next item
  under the next block's window; it needs the worker's picks in the web app (M107, *Deferred*).

Sources and library:

- Operator edits of title and category are overwritten by every sync (M72).
- YouTube approximate dates stay in the bucket of the first sync; keeping the earliest observed value
  would refine them (M72).
- Twitch archives that drop out of a listing and return play after newer ones (M72).
- The source detail page sorts by `publishedAt || updatedAt`, and `updatedAt` changes on every sync
  (M72).
- `updateAssetRecords` has no caller left; remove it with its web re-export (M72).
- `<source> item` / `Video aus <source>` is stored at ingest in the language of that sync (M80).
- The `twitch-vod` connector stores chapters at ingest from the same extractor and may store the same
  stand-in, which nothing rechecks (M108).
- The admin's chapter editor shows no sign that a chapter list is provisional, nor that one was capped
  (M108).
- An empty chapter list whose probes keep failing is marked `failed` and retried every 30 minutes for as
  long as it is listed (M108).
- `docker-compose.yml` passes the `.env` file whole and lists none of the chapter backfill settings (M108).

As-run log and monitoring:

- Daily on-air percentage and per-item audience from the as-run table (M76).
- The e2e fixture seeds no as-run rows; the design baseline shows the empty panel only (M76).
- A run that started before the read window still counts against the 200-row page (M76).
- Live bridge rows do not record which push source was on air (M76).
- The soak's critical-incident check is skipped without a session cookie (handoff for 2.1.0 and 2.2.0).
- Unconfirmed after M80: the control-density budget of 35 (`tests/e2e/control-density.spec.ts`) is not
  measured, the setup wizard's instance step has no baseline, the `/channel` desktop picture and the
  studio scene pictures are not confirmed (M80).
- Not re-verified after M64: the proxy profile has no smoke; guide sections 1, 2, 5, 6, 7 and 9 were not
  walked again (M64). Related to M92.
- Readiness says `broadcastReady=false` while only the worker is stopped, although the channel airs, so a
  soak would count a worker stop as an outage (M106).

Viewers and language:

- `/api/channel/live` still carries `playout.message`, the operator's status text (M80).
- The Minesweeper header overflows the default game box on `game over` and `board cleared` (M80).
- A German channel cannot keep one of the six English headline defaults verbatim (M80).
- The `/channel` header follows a language change only after a reload (M80).
- The equality rule cannot tell an operator's `Stand by` from the worker's (M80).
- The studio's *Replay label* tip is English on a German channel; admin text, left for M81 (M80).

Ideas from the competitor comparison, not planned: alerts on air, the 48-hour reconnect at an item
boundary, loudness normalisation, a reaction when the creator goes live. (`!next` / `!schedule` are
covered by M104, the progress bar by M100.)

Repository and operations:

- A Portainer API key once appeared in plain text in a chat log; whether it was rotated is open (from the
  session prompt deleted in M84). Owner's step.
- `planning/archive/audit-2026-09-02.md`: R3 triaged 9 of its findings (`planning/research/robustness.md`);
  the rest are unverified.
- `package-lock.json` sits next to `pnpm-lock.yaml` and CI installs with `--frozen-lockfile=false`, so a
  lockfile drift is not caught; the npm lockfile looks unused (proposal section 6).
- Two unit tests assert an ICU-dependent zone name (`tests/unit/viewer-messages.test.ts`,
  `tests/unit/ops-state.test.ts`); a Node build with ICU 77 would turn them red (proposal section 6).
- The design baselines lag the code in wording; the 1 % pixel tolerance hides it (proposal section 6).
- `docs/deployment.md`: *Upgrading To 2.3* says the release carries "M84-M105", but it carries M109 too;
  *Operating Policy (since v1.5.19)* and the *Production Default* example still name v1.5.19 as the
  production baseline (M106).

## DUT checks for the next release candidate

Checks a milestone could not run in the cloud. The owner runs them on the DUT after the next candidate is
deployed; the release that ships them records the results.
2.3.0's results are in the M106 notes of `planning/archive/plans-m84-m109.md`, the entries that
passed under its *DUT checks of 2.3.0 (run)*; the entries below are still to run. Still to run as well:
the 2.2.0-rc.1 entries of M78, M79 and the M80 chat part (`planning/archive/plans-m0-m83.md`, last item
below), and the last part of the M100 entry (the Next card's `in N min` on the picture), which moved
with M100 but has no recorded result.
2.3.1's results are in the M110 notes of `planning/archive/plans-m107-m110.md`, the two M108
entries under its *DUT checks of 2.3.1 (run)*; the M107 entry below did not run (owner decision
2026-10-20).

- M89, on the deployed candidate, once with the relay (the DUT's mode) and once in direct mode (where the
  owner runs one, for example on DT): a Restart pressed while a playout cycle runs restarts. The cycles
  that run longest start an item, so press *Soft restart* (Live → *If something is stuck*) within a
  few seconds after a new item came on air, three times over the evening. Passes when each press has its
  `playout.restart.requested` audit row and, at most one cycle (about 30 s) later, an as-run row that ended
  `operator-restart`; before M89 a press inside a cycle had the audit row and no restart.

  ```sh
  ssh dut 'docker exec -i stream247-postgres-1 psql -U stream247 -d stream247 -At' <<'SQL'
  SELECT 'press', created_at FROM audit_events WHERE type = 'playout.restart.requested'
    AND created_at > to_char(now() - interval '6 hours', 'YYYY-MM-DD"T"HH24:MI:SS')
  UNION ALL
  SELECT 'restart', ended_at FROM as_run_log WHERE end_reason = 'operator-restart'
    AND ended_at > to_char(now() - interval '6 hours', 'YYYY-MM-DD"T"HH24:MI:SS')
  ORDER BY 2;
  SQL
  ```

- M90, on the deployed candidate: stop the worker for five minutes while the channel airs (playout and
  uplink keep running; the worker only syncs sources, Twitch and incidents). Passes when `Live → Control`
  shows "The worker has stopped reporting" as the first entry of *Open problems*, with "Last heard from
  N minutes ago" and the restart command, `/api/system/readiness` reports `"worker":"degraded"`,
  and the entry is gone once the worker's first cycle after the restart has finished: up to about three
  minutes, not one, because the worker writes its heartbeat only at the end of a whole cycle and the first
  cycle after a start runs every source sync (`runWorkerCycle` in `apps/worker/src/index.ts`). Then press
  *Soft restart* once and answer *Cancel*: no `playout.restart.requested` audit row may appear.

  ```sh
  ssh dut 'docker stop stream247-worker-1; sleep 300; docker exec stream247-web-1 wget -qO- http://127.0.0.1:3000/api/system/readiness | grep -o "\"worker\":\"[a-z-]*\""'
  ssh dut 'docker start stream247-worker-1'
  ```

- M93, after the repin: the migration ran and every existing block stayed undated. Passes on `1|0`.
  Then, in `Program → Schedule → Day`, add a block *Runs: Once* on a date four to six days ahead, 30 min or
  longer, at a time a weekly block covers. Passes when, after the next worker cycle,
  `https://www.twitch.tv/jimpanse247/schedule` shows the one-off entry on its date with the weekly block
  cut around it, and no other date changed. Each cut part is sent on its own when it lasts 30 min to 23 h
  (a shorter or longer part is left out): under a weekly block of 23 h or less the date shows the part
  before, the one-off and the part after; under a 24 h block (a 24/7 grid of one block a day), which Twitch
  never gets as a whole, the same three entries appear on that date only, the two parts with the weekly
  title (`planTwitchScheduleSegments`,
  `apps/worker/src/twitch-schedule-plan.ts`). Delete the test block afterwards: the next cycle restores the
  single weekly entry of a block of 23 h or less, and removes all three entries under a 24 h block, which
  then has no entry at all, as before. Twitch's answer to these segments was not reachable from the cloud.

  ```sh
  ssh dut 'docker exec -i stream247-postgres-1 psql -U stream247 -d stream247 -At' <<'SQL'
  SELECT (SELECT COUNT(*) FROM schema_migrations WHERE id = '20261003_001_schedule_block_dates'),
         (SELECT COUNT(*) FROM schedule_blocks WHERE valid_from <> '' OR valid_until <> '');
  SQL
  ```

  On air (M105, R7): add a block *Runs: Once* for today, 30 minutes, starting 15 to 30 minutes ahead,
  inside a weekly block whose item on air will still run at its start (a multi-hour archive), from a pool
  with other sources. Passes when, after its end, the as-run rows of the last hour show the item on air
  ended `switch` within a minute after the one-off's start, the one-off's first item starting then with
  the one-off's `block_id`, the one-off's item on air at its end ended `switch` (or `natural-end` exactly
  then) within a minute after it, and the weekly block's item starting then; and the playout log has two
  `playout.schedule.takeover` lines, `edge` `start` and `end`. Delete the block afterwards. Give the
  one-off a pool whose next item is local, YouTube or an archive already cached: an uncached Twitch
  archive moves the cut to the end of its download (a `playout.schedule.takeover_deferred` line first), by
  design since the review of the M105 change.

  ```sh
  ssh dut 'docker exec -i stream247-postgres-1 psql -U stream247 -d stream247 -At' <<'SQL'
  SELECT started_at, ended_at, end_reason, block_id, title FROM as_run_log
    WHERE started_at > to_char(now() - interval '1 hour', 'YYYY-MM-DD"T"HH24:MI:SS')
       OR ended_at > to_char(now() - interval '1 hour', 'YYYY-MM-DD"T"HH24:MI:SS')
    ORDER BY started_at;
  SQL
  ssh dut 'docker logs --since 1h stream247-playout-1 2>&1 | grep playout.schedule.takeover'
  ```

- M94 and M105 (R11, R13), on the deployed candidate, with a YouTube item **from a source the block's
  pool does not use** as the block's cuepoint item (Program → Schedule, a block of the coming evening
  with one cuepoint about 20 minutes in; delete it afterwards). Passes when, after the block, the as-run
  log has a row of the cuepoint item with `queue_kind` `insert` whose `end_reason` is `natural-end` or
  `duration-bound` and whose `aired_seconds` is at least `planned_seconds - 5` (it played to its end;
  until M105 such an insert was cut at the next cycle with `switch`, which "aired longer than 10 s" did
  not catch), or (if YouTube refused it) the audit trail has one `playout.insert.skipped` row naming it
  (reason `bridged`, `prepare-failed`, `start-failed`, or `open-failed` after two starts: one or two
  `failed` rows of about 0 s before it) and no later attempt of it in that block. Stubbed in the cloud,
  where YouTube is not reachable.

  ```sh
  ssh dut 'docker exec -i stream247-postgres-1 psql -U stream247 -d stream247 -At' <<'SQL'
  SELECT 'aired', started_at, title, end_reason, aired_seconds, planned_seconds FROM as_run_log WHERE queue_kind = 'insert'
    AND started_at > to_char(now() - interval '6 hours', 'YYYY-MM-DD"T"HH24:MI:SS')
  UNION ALL
  SELECT 'skipped', created_at, message, '', 0, 0 FROM audit_events WHERE type = 'playout.insert.skipped'
    AND created_at > to_char(now() - interval '6 hours', 'YYYY-MM-DD"T"HH24:MI:SS')
  ORDER BY 2;
  SQL
  ```

- M96, after the repin: the local library's files carry their real length. The first command, run once a
  few worker cycles have passed, prints `0|<n>` with `<n>` the number of local files (no file left without
  a probed version); a file ffprobe cannot read shows up in the second command with `0` and is worth a look.
  The Day lens (`Program -> Schedule`) then shows no "30-minute estimate" note for a pool of local files.
  And, with the overlay in scene mode, local files now end by the duration bound (R15 of the 2026-10-05
  review): the third command, a day after the repin, shows `duration-bound` rows with an average overrun
  (`aired - planned`) of about 15 s and no `feed-watchdog` row, and the last two print `0` (a count above
  `0` is compared with the as-run rows of its time: it fails the check only at the end of a local file).

  ```sh
  ssh dut 'docker exec -i stream247-postgres-1 psql -U stream247 -d stream247 -At' <<'SQL'
  SELECT COUNT(*) FILTER (WHERE duration_probe_key = ''), COUNT(*) FROM assets WHERE source_id = 'source-local-library';
  SELECT title, duration_seconds FROM assets WHERE source_id = 'source-local-library' ORDER BY duration_seconds, title;
  SELECT end_reason, COUNT(*), ROUND(AVG(aired_seconds - planned_seconds)) FROM as_run_log
    WHERE source_id = 'source-local-library' AND planned_seconds > 0
      AND started_at > to_char(now() - interval '24 hours', 'YYYY-MM-DD"T"HH24:MI:SS')
    GROUP BY end_reason ORDER BY 2 DESC;
  SQL
  ssh dut 'docker logs --since 24h stream247-playout-1 2>&1 | grep -c playout.feed_audio.restart'
  ssh dut 'docker logs --since 24h stream247-uplink-1 2>&1 | grep -c uplink.encoder_stall.restart'
  ```

- M97, after the repin: `Program -> Schedule -> Week` shows what airs. With a pool used by two blocks of
  one day, note the first video of the second block in the morning; it is the one Live names when that
  block starts. A block past midnight is listed once, as *23:00 → 01:00 Sun*, and today's blocks that have
  ended read *Aired earlier today*.

- M99, after the repin: the stream key the DUT already has is where operators now look for it.
  `Studio -> Output -> Output destinations` lists *Primary Twitch Output* with *Stream key stored here* (or
  *set in the server configuration*), `Live -> Status` lists it without forms and links there, and `/setup`
  (signed in) shows *Where the stream goes* and *First programme* as *Done* when the readiness lines *Live
  destination*, *Program pools* and *Weekly schedule* are ready.

- M101, on the deployed candidate in the week before a clock change (the next is Sunday 2026-10-25): a
  block touching 02:00-03:00 on that Sunday is on the Twitch schedule of jimpanse247 with the real length it
  airs (Sunday 01:00-04:00 reads 01:00-04:00 and lasts 4 hours; a block in 02:00-03:00 starts at the first
  02:00 and lasts 2 hours). Without such a block, save a test block "Once" on that Sunday 01:00-04:00, let
  one Twitch sync run, check the Twitch dashboard's schedule, then delete the block.

- M102, on the deployed candidate with the scene overlay on: the standby slate shows standby. After an item
  with a known title aired, take every item out of programming (Library, select all, bulk *Exclude*), then
  press *Skip*. Taking items out does not stop the one on air: it plays to its end (hours for a Twitch
  archive), and a change of weekly block does not cut it either; the Skip's hold is what keeps it from
  being picked again. The picture reads `Stand by` / `Gleich geht’s weiter` with the current block's title (or
  `Stand by`) and never the title that aired before. Put the items back with bulk *Include*, and mark the
  global fallback item again (bulk *Exclude* clears the mark, and *Include* does not restore it); the next
  item's own title is on the picture from its start. A Restart in direct mode shows the reconnect slate the
  same way.
- M104, on the deployed candidate with *Enable viewer control* on (Studio → Engagement), the channel in
  German and the app URL set: from a viewer account (not the bot), type in the broadcast channel's chat
  `!commands`, then after 65 s `!now`, after another 65 s `!next` (one answer to these three per viewer a
  minute, shared: `ChatReplyCooldown` in `packages/core/src/chat-replies.ts`), then `!request zzzz` and after
  it `!request` with a word from a requestable title (in this order: after an accepted request the refusal
  would be the cooldown). Passes when the bot answers each once, in German and addressed `@<account>`: the command list
  without switched-off commands, `gerade läuft: …` with the title on air, `als Nächstes …` with
  `Programm: <APP_URL>/channel`, `… kein Video …` and `… steht in der Warteschlange auf Platz N.`; a second
  `!now` from the same account within a minute gets no answer; `ssh dut 'docker logs stream247-worker-1 2>&1 | grep -c chat.say.dropped'`
  prints `0`.

- M105 (part D, R22), on the deployed candidate with *Enable viewer control* on: within 20 s after an item
  change (Live → Status shows the new title), type `!now` from a viewer account. Passes when the bot names
  the new title, not the one before.

- The candidate's soak (R31 of the 2026-10-05 review) measures the channel, not the way in, and sees
  container restarts and critical incidents. It is started as step 10 of *Safe Upgrade Flow* in `docs/deployment.md` says, from the
  release checkout on the DUT (`<checkout>`). Before it counts: the soak script is main's (the first
  command prints `1`); the log's first line reads `Starting soak monitor for 24h at http://<web address>:3000`,
  `web`'s address on the stack network that `--follow-web` reads (step 10; the M111 check below compares it
  with `docker inspect`), not the public URL: the 2.1.0 soak's only outage was a 220 s Cloudflare `522` on
  the public route while the channel stayed on air (`CHECK_BASE_URL=http://127.0.0.1:3000` only on a stack
  that publishes `3000`, which the DUT's Portainer stack does not); and its
  `Baseline container restarts` line shows numbers for `web`, `worker`, `playout` and `uplink`, not
  `unknown` (the counts come from `docker compose ps` in the directory above `scripts/`; without the
  stack's compose project there, restarts go unseen). Without `SESSION_COOKIE` every sample logs
  `openCriticalIncidents=skipped(no-session-cookie)`, so after the soak the last command lists the critical
  incidents of its 24 hours; each one is reported.

  ```sh
  ssh dut 'grep -c "SOAK_RESTART_SERVICES=\"web worker playout uplink relay\"" <checkout>/scripts/soak-monitor.sh'
  ssh dut 'log=$(ls -t ~/logs/soak-*.log | head -1); head -1 "$log"; grep -m1 "Baseline container restarts" "$log"'
  ssh dut 'docker exec -i stream247-postgres-1 psql -U stream247 -d stream247 -At' <<'SQL'
  SELECT created_at, fingerprint, status, resolved_at FROM incidents WHERE severity = 'critical'
    AND updated_at > to_char(now() - interval '25 hours', 'YYYY-MM-DD"T"HH24:MI:SS') ORDER BY created_at;
  SQL
  ```

- M107, during a long archive in the TwitchYoutube block that is expected to end after the block does: the
  on-air Next card names the video the next block's pool starts with and `about <its expected start>` /
  `ca. …`, not the block's window, and `!next` in the chat of `jimpanse247` names the same title with the
  same time.

- M111, at the start of the next candidate's soak (step 10 of *Safe Upgrade Flow*, now with
  `--follow-web`): the log line `Following the web container: address=… network=…` names `web`'s current
  address on the stack network, the one the second command prints, and `Baseline container starts:` shows
  a start time for every service, not `unknown` (`relay` too while the relay runs). Passes when both hold
  and the first sample reads `status=ok`.

  ```sh
  ssh dut 'grep -E "Starting soak|Following the web|Baseline container" ~/logs/soak-<stamp>.log'
  ssh dut 'docker inspect -f "{{range \$k, \$v := .NetworkSettings.Networks}}{{\$k}}={{\$v.IPAddress}} {{end}}" stream247-web-1'
  ```

- M112, on the candidate's first day on air: no `worker.loop.crashed` and no `worker.unhandled_rejection`
  in the playout and uplink logs; any `ffmpeg.stderr.write_failed`, `source.sync.deferred`,
  `source.sync.paused` or
  `playout.selection.passed_over` line is listed with its time in the result (none is expected on a
  healthy day; a `passed_over` names an item whose resolve failed, which the incident list should name
  too). Passes when the first two counts are 0.

  ```sh
  ssh dut 'docker logs --since 24h stream247-playout-1 2>&1 | grep -cE "worker.loop.crashed|worker.unhandled_rejection"'
  ssh dut 'docker logs --since 24h stream247-uplink-1 2>&1 | grep -cE "worker.loop.crashed|worker.unhandled_rejection"'
  ssh dut 'for c in playout uplink worker; do docker logs --since 24h stream247-$c-1 2>&1 | grep -E "ffmpeg.stderr.write_failed|source.sync.deferred|source.sync.paused|playout.selection.passed_over|asset.chapters.deferred"; done'
  ```

- M113, once `jimpanse247` writes the schedule (the M101 owner step): delete or move a block with a
  segment on Twitch, wait one worker cycle, and check that the segment is gone from the channel's schedule
  and that no `twitch.schedule.delete.failed` incident is open. Passes when the first command prints no
  open row and the second count is 0 (a line with `"kept":true` that a later sync cleared is listed with
  its time in the result).

  ```sh
  ssh dut 'docker exec -i stream247-postgres-1 psql -U stream247 -d stream247 -At' <<'SQL'
  SELECT status, updated_at, message FROM incidents
    WHERE fingerprint = 'twitch.schedule.delete.failed' AND status <> 'resolved';
  SQL
  ssh dut 'docker logs --since 24h stream247-worker-1 2>&1 | grep -c "twitch.schedule.segment.delete_failed"'
  ```

- M114, after the repin and outside a soak (a restart fails a soak): the three containers run under the
  supervisor, and a stopped worker process restarts within six minutes. Passes when the first command
  lists `supervisor.js` and `index.js` for each of worker, playout and uplink, the restart count after the
  wait is one higher than before, the log has one `worker.supervisor.frozen` line and the query lists an
  open or resolved `worker.health.frozen-restart` row. The worker is chosen because stopping it does not
  cut the air.

  ```sh
  ssh dut 'for c in worker playout uplink; do docker top stream247-$c-1 -o pid,args | grep -E "supervisor.js|index.js"; done'
  ssh dut 'docker inspect -f "{{.RestartCount}}" stream247-worker-1'
  ssh dut 'docker exec stream247-worker-1 sh -c "kill -STOP \$(pgrep -f \"dist/index.js worker\")"'
  # wait six minutes
  ssh dut 'docker inspect -f "{{.RestartCount}}" stream247-worker-1'
  ssh dut 'docker logs --since 10m stream247-worker-1 2>&1 | grep -c "worker.supervisor.frozen"'
  ssh dut 'docker exec -i stream247-postgres-1 psql -U stream247 -d stream247 -At' <<'SQL'
  SELECT status, created_at FROM incidents WHERE fingerprint = 'worker.health.frozen-restart';
  SQL
  ```

- M114 follow-up, after the repin and outside a soak, at a time when a short cut on air is acceptable
  (the relay carries the programme to the uplink): a relay that stops answering is restarted. Passes when
  `relay-watchdog` runs, the relay's start time after the wait is newer than before, and the log has one
  `relay.watchdog.restart` line with `attempt` 1.

  ```sh
  ssh dut 'docker inspect -f "{{.State.Status}} {{.State.StartedAt}}" stream247-relay-watchdog-1 stream247-relay-1'
  ssh dut 'docker kill -s STOP stream247-relay-1'
  # wait four minutes
  ssh dut 'docker inspect -f "{{.State.Status}} {{.State.StartedAt}}" stream247-relay-1'
  ssh dut 'docker logs --since 10m stream247-relay-watchdog-1 2>&1 | grep relay.watchdog.restart'
  ```

- M115, after the repin: the uplink's ffmpeg asks for the global header and Twitch still takes the
  stream. Passes when the first command prints 1 or more, the second prints `True`, and the uplink's
  unplanned restart count an hour after the repin is the one it had right after it (`/api/system/readiness`,
  `uplink.unplannedRestartCount`).

  ```sh
  ssh dut 'docker top stream247-uplink-1 -o args | grep -c "global_header"'
  ssh dut 'docker exec stream247-playout-1 yt-dlp --simulate --print "%(is_live)s" https://www.twitch.tv/jimpanse247'
  ```

- M117, after the repin: everyone is signed out once (older cookies carry no password stamp). Then sign in
  as the owner in two browsers, change the password under Admin → Settings → Security in the first.
  Passes when the first stays signed in, the second lands on `/login` at its next page load, and the
  audit trail has `auth.password.changed` with "other sessions were signed out".

- M118, after the repin: `/channel` plans with the video on air. While a weekly block's video runs past
  the block's end into the next weekly block, open `/channel` and `Program → Schedule → Week`. Passes when
  *Up next* and the week view's next block both start their first video when the video on air ends (the
  time on the *Now* card), not at the block's start.

- The checks of 2.2.0-rc.1 are in the archive, sections M75-M82. That candidate never reached the DUT, so
  the 2.3.0 candidate runs them too.

## Shipped

| Release | Date | Milestones | Where |
| --- | --- | --- | --- |
| 2.3.1 | 2026-10-20 | M107, M108 (release M110) | archive `planning/archive/plans-m107-m110.md`, sections M107, M108, M110; `CHANGELOG.md` |
| 2.3.0 | 2026-10-15 | M84-M105, M109 (release M106; M83 superseded by M106) | archive `planning/archive/plans-m84-m109.md`, sections M85-M104, M106 and M109; `CHANGELOG.md` |
| (2.2.0) | Not released: release commit `e81b6f4` never tagged, `v2.2.0-rc.1` never deployed; these milestones shipped with 2.3.0 (M106, owner decision 2026-10-05) | M64, M75, M76, M78, M79, M80, M82 | archive, sections M64, M75, M76, M78-M80, M82 and the M83 row; `CHANGELOG.md`, *2.2.0-rc.1* |
| 2.1.0 | 2026-10-02 | M68, M69, M70, M72, M73, M74 (release M71) | archive, sections M68-M74; `CHANGELOG.md` |
| 2.0.0 | 2026-09-09 | M59, M60, M61, M62, M63, M65 (release M67) | archive, sections M59-M67; `CHANGELOG.md` |
| 1.x | 2026-03-27 (1.0.0) to 2026-09-05 (1.5.47) | M0-M58 | archive, milestone tables, phase sections and *Progress Notes*; `CHANGELOG.md` |

## Milestone notes

Sections for milestones in **Open** that need more than their row, appended in milestone order.
### M111 The Soak Monitor Follows The Web Container

- Evidence: on 2026-10-18 at 22:15:15 UTC an `apt-get dist-upgrade` on the DUT upgraded `containerd.io`;
  the Docker daemon restarted and every container with it, on air again 16 s later. `web` came back as
  `172.22.0.5` and `172.22.0.7` went to `worker`, so the soak with `CHECK_BASE_URL=http://172.22.0.7:3000`
  read `curl: (7) Failed to connect to 172.22.0.7 port 3000 after 0 ms` for 6 min and ended
  `outage-exceeded` (M110 notes). `http://127.0.0.1:3000`, the address step 10 gave until now, fails on
  the Portainer stack too, which does not publish `web`'s port (M106 notes in the archive).
- Did the monitor see the daemon restart? No. Its restart check compares only `RestartCount`
  (`docker compose ps -q <service>`, then `docker inspect`), which counts the restart policy's restarts;
  a daemon restart starts the same containers again and leaves it at 0 (the counts stayed `web=0 …`).
  Only a readiness sample could catch the gap, and at one sample a minute a 16 s gap at an address that
  stays the same passes unseen.
- Rule: `--follow-web` (without `CHECK_BASE_URL`; no `.env` needed) measures `http://<web address>:3000`,
  the address from `docker inspect` of the project's `web` container, on the network named after the
  project when it is on several. On a refused connection (curl exit 7, the 2026-10-18 shape; only `web`
  listens on 3000, so an address handed to another service refuses) it reads the address again; when it
  moved it logs `web-address-changed old=… new=… network=…` and takes the same sample there. No `web`
  container or no address at the start stops it (`Cannot follow the web container: …`); mid-run the
  sample counts as failed and its line carries `web-address-lookup-failed: …`. `CHECK_BASE_URL` alone
  keeps the old behaviour exactly; the two exclude each other.
- Decision on the daemon restart (the brief's safer reading): record and report, the outage rules
  unchanged. After each healthy sample, and once more when an outage ends the soak, the monitor reads
  every service's `State.StartedAt` (never while an outage runs, see the next point): all moved is logged
  once as `docker-daemon-restart startedAt=<time> services=…`, some moved as `container-started-again …`,
  and the completion line adds `dockerRestarts=N containersStartedAgain=N`; a pass with either above 0 is
  "passed with failure". Recommendation: keep it so rather than failing the soak like a container
  restart. The restart of 2026-10-18 cost 16 s of air, less than the nightly reconnect the outage window
  carries; a host upgrade is not an app fault, and the samples still fail the soak when the stack does not
  heal within the window. A restart by the restart policy still fails the soak as before.
- Docker calls on the failure path (review of the first draft): with socket activation (`docker.socket`,
  `TimeoutStartUSec=infinity` on the development host, which has the DUT's apt packaging) a docker call made while `dockerd` is
  stopped or starting waits instead of failing. The draft read the start times before every sample, so a
  monitor stuck there took no samples, and a long off-air time with `dockerd` down could end as a pass.
  Rule: every docker call goes through `timeout $SOAK_DOCKER_TIMEOUT_SECONDS` (10 s; a call that does not
  answer reads `unknown`, the follow lookup `web-address-lookup-failed: docker did not answer within …`);
  the start times are read only after a healthy sample and at the `outage-exceeded` exit, so with
  `CHECK_BASE_URL` the failure path asks docker nothing, as at `2ee0866`, and with `--follow-web` only the
  one bounded lookup. The exit read lets the log of a soak that a daemon restart ended name it (the
  2026-10-18 run would have read `docker-daemon-restart` right above `outage-exceeded`).
- Tests in `tests/unit/release-readiness.test.ts`, with stubbed `docker` and `curl` on `PATH` and the
  `SOAK_CLOCK_FILE` clock: the address moves mid-run (one changed line, no failed sample, no outage); a
  public `CHECK_BASE_URL` (no `NetworkSettings` lookup, a refused connection counted as before); no `web`,
  no address, both options (a clear message, no sample); `web` without an address at the refused sample
  (counted, followed at the next); a daemon restart (one line, `dockerRestarts=1`); one container started
  again (`containersStartedAgain=1`); the 2026-10-18 replay with `--follow-web` (no outage, both lines).
  All seven fail against the script of `2ee0866`. Three more with a docker stub that hangs from the second
  sample on (`SOAK_DOCKER_TIMEOUT_SECONDS=0.2`): `--follow-web` keeps sampling and ends `outage-exceeded` at
  360 s (one bounded lookup per refused sample, then the closing read); an explicit `CHECK_BASE_URL` asks
  docker nothing during the outage (only the five closing calls); the 2026-10-18 run as it ran (old address
  in `CHECK_BASE_URL`) logs `docker-daemon-restart` right above `outage-exceeded`. Against the first draft
  the two hanging ones hang until the test's 60 s limit and the third misses its line; against `2ee0866`
  the first and the third fail, the second only on the closing read (that script's failure path asked
  docker nothing, the behaviour it pins).
- Not measured in this session: `curl`'s exit code at a real stale container address (the session's
  sandbox times out on every container address, curl 28); the DUT log of 2026-10-18 shows 7. The
  monitor's `curl` calls still have no timeout of their own (unchanged). The docker timeout is tested with
  a hanging stub only, not against a stopped socket-activated `dockerd`. The first `--follow-web` soak is
  under *DUT checks for the next release candidate*.
- Merge PR (2026-10-21): the unit run exited 1 with every test green, `[vitest-worker]: Timeout calling
  "onTaskUpdate"` (CI job 118956625641, and twice in the cloud). The root-env lock's poll and hand-over pause
  used `Atomics.wait`, so release-readiness kept its worker's event loop blocked for its whole synchronous
  run (about 160 s alone); both release test files now wait on timers. 51 tests unchanged, no error line.

### M112 A Broken Source Neither Crashes Nor Stalls The Loop

- Checked against `main` at `abc4676` first: none of the three was fixed by M105-M111.
  `planning/review-2026-10-05.md` has no entry for them; at `abc4676` the playout's stderr handler still
  fired `void updatePlayoutRuntime(` and `void upsertIncident(` per chunk (`apps/worker/src/index.ts`,
  the handler after the M105 comment on listeners), `selectPoolAsset` knew no failed pick, and the two
  source syncs passed `SOURCE_SYNC_YTDLP_TIMEOUT_MS` to every call.
- **1, the noisy ffmpeg (M98 follow-up 2).** Each stderr chunk of the playout fired a runtime write
  (`updatePlayoutRuntime`: a whole state read under the state write lock), each line with "error" an
  incident upsert, each output error a destination write (`markDestinationFailure`, another whole state
  read); the uplink the same minus the runtime write, plus a feed-status write per feed input error. All
  unawaited. `CoalescingWriter` (`apps/worker/src/coalescing-writer.ts`) keeps one write in flight per
  kind and keeps only the latest value meanwhile; the first of a burst is written at once (an incident
  opens on its first line), the last always. Intervals: runtime sample 2 s, each stderr incident 10 s
  (keyed by fingerprint: `playout.ffmpeg.stderr`, `uplink.ffmpeg.stderr`, `program-feed.input`),
  destination failure per destination with no interval (`markDestinationFailure` keeps its own 15 s
  dedup), feed status 5 s. The log line per chunk is unchanged. A failed write is logged once as
  `ffmpeg.stderr.write_failed` with its writer instead of an unhandled rejection. Not measured with the
  real mp4 in the cloud (the stack's images do not build here); the test models it with a pg-like pool
  (10 connections, a caller waiting longer than the timeout fails with pg's message).
- **2, the pool on a broken pick (M98 follow-up 1).** A failed inline resolve of a `scheduled_match` pick
  is written to the probe cache as a failed, already-counted probe (`recordSelectionResolveFailure`) and
  added to the list quarantine counts, after the same network-outage filter (`dropNetworkOutageOutcomes`,
  path `selection`) and not twice for an item the queue probed in the same cycle; the breaker keeps
  hearing it from `recordSelectionResolveOutcome` only, so no outcome is counted twice. `selectPoolAsset`
  passes over an item whose fresh cache entry is a failure (`isPassedOverPoolPick`), for the minute the
  cache keeps a failure (`NEXT_ASSET_PROBE_FAILED_TTL_MS`). While a fresh failure is cached, a further
  failure of the same item neither refreshes its time nor counts again, so quarantine counts at most
  one failure a minute per item, as for the queue's probes. Not passed over and not recorded: a Twitch
  archive still downloading (`TwitchVodCachePendingError`), and every pick that is not the schedule's
  (inserts, Move next, Pin, fallbacks).
  - Decision (within the suggestion's "do it"): the pass-over also applies to a failure the queue's
    prefetch found, not only the inline resolve's. Both are the same probe-cache entry, and before M112
    the boundary picked such an item and resolved it inline again. Cost: an item whose probe failed once
    by chance in the minute before its turn loses that turn in this pass of the rotation.
  - A dated block's takeover whose pick fails to resolve (review T1, M105) still holds the item on air
    for that cycle; from the next cycle the takeover's pick is the pool's next item, so a pool with one
    broken item takes the air with its second one instead of waiting the minute.
  - Not changed: the schedule preview, the week view and the overlay's next title come from core's
    rotation and do not know the worker's probe cache; for up to a minute they can name an item the
    worker passes over.
- **3, the dead host (M87 limit).** One deadline per cycle (`apps/worker/src/remote-call-budget.ts`):
  80 % of the stall guard after the start of `runWorkerCycle` (`RemoteCallBudget.forCycle`, 240 s by
  default), the rest kept for the steps after the calls. The YouTube and Twitch syncs (listing and
  Twitch VOD metadata) and the chapter probes start a call only when its whole own timeout still ends
  before the deadline (`fitsWhole`); no timeout is ever cut short. A source without room is left out of
  that cycle's sync entirely (no run, no status, no replace, no incident: as if the sync had not reached
  it) and goes first in its sync's next run, longest waiting first (`orderDeferredFirst`,
  `source.sync.deferred`), so an overloaded sync takes turns. When a Twitch source was deferred, the
  YouTube sync's calls after its first keep one call's timeout for it (`reserveMs`), and its first call
  too when the Twitch sync's last run started no call at all behind a YouTube call
  (`twitchSyncHeldBack`): the two syncs take turns whenever the cycle has room for one call after the
  earlier steps. The deferred sources are
  kept per sync step and replaced by each run, so a source disabled while deferred drops out. A call that runs out of its timeout is reported as failed as before and its source
  is paused for 10 min (`SourceSyncPauses`, process memory, keyed by source id and URL,
  `source.sync.paused`).
  - Worst case with the defaults: two whole listings of 120 s per cycle, ending by 240 s, against the
    300 s stall guard. Each dead host costs one call per 10 min.
  - Not covered: the steps after the calls (Twitch requests, 10 s each, chat) get the remaining 20 %
    (60 s by default, 12 s at the 60 s minimum); a Twitch API that hangs on every request on top of dead
    source hosts can still reach a stall guard set near its minimum, as before M112. With a stall guard
    near 60 s and earlier steps that leave less than one call's 30 s, the syncs wait for a faster cycle.
    The chapter backfill runs after both syncs and has no reserve of its own: while slow listings fill
    every cycle, chapters wait (they are a backfill, nothing airs from them).
- Reviews (fresh subagents, six rounds). Item 3 changed design each round and ended at the simplest
  rules: the first shared budget let a dead YouTube host take every cycle's time from Twitch and
  chapters; cutting a timeout short to what was left reported healthy slow sources as failed; step
  budgets with a deferral after one cut-short timeout still reported a recovered or slow healthy source
  (walked last, or cut short twice), starved Twitch at a 60 s stall guard, and documented a pause cost
  that was twice the real one. Now no timeout is cut short, so none of these can happen; overload is
  handled by deferring and taking turns. The fourth round found that the Twitch reserve, asked for
  every YouTube call, held back the YouTube sync entirely under a heavy Twitch load, and that a Twitch
  source disabled while deferred kept it so until a restart (now the first YouTube call has no reserve
  and the deferred sets are per step). The fifth found that a first YouTube call that leaves less than
  one call's time (a 115 s listing after 10 s of earlier steps, a dead host) then kept Twitch waiting
  for good (now the first call keeps the reserve too after a Twitch run without a call). The sixth (60,000
  random cycle mixes, no healthy source reported failed) found that a Twitch sync that could not fit even
  alone then held YouTube back too (now only a Twitch run held back behind a YouTube call counts). Also found and fixed: chapter probes could get a cut-short
  timeout (now whole only); a pause outlived a fixed URL (now keyed by the URL too); the
  `program-feed.input` upsert held back 10 s could reopen the incident the uplink had just resolved
  (that key writes one at a time, without the interval); a throwing error reporter could leave an
  unhandled rejection (caught). Left as they are, documented in `docs/operations.md`: the runtime queue
  still lists (and labels as prefetched) a passed-over item, and warms the items after it, the actual
  pick; a destination's failure count grows per coalesced write, not per line; a pick that failed during
  the channel's own network outage is passed over for up to a minute after the network is back (not
  counted). Left, not documented for operators: the outage check runs once for the breaker's record and
  once for quarantine's, so a verdict that changes between the two can count a failure for one and not
  the other (the same can already happen between two cycles); a cycle that ends early after the pick's
  failure was cached (the crash-loop hold, a throwing step) loses that one count for quarantine, the
  breaker keeps it.
- Tests: `tests/unit/coalescing-writer.test.ts`, `tests/unit/selection-pass-over.test.ts`,
  `tests/unit/remote-call-budget.test.ts`; pins updated in `tests/unit/probe-network-outage.test.ts`,
  `tests/unit/source-breaker-wiring.test.ts` (the new lines after the breaker's record of the failed
  resolve) and `tests/unit/source-listing.test.ts` (the listing takes the budget's timeout).
- `CHANGELOG.md` is not touched: per `AGENTS.md` the release commit writes its section.

### M113 Overlay Data And Twitch Segments That Do Not Go Unnoticed

- Checked against `main` at `85de666` first: neither was fixed by M105-M112, and
  `planning/review-2026-10-05.md` has no entry for them. At `85de666` `mapOverlayRowToRecord` parsed
  `layer_order_json`, `disabled_layers_json`, `scenes_json` and `panel_placements_json` bare
  (`packages/db/src/index.ts:1140-1148`, only `custom_layers_json` guarded), the preset reader
  `overlay_json` (`:1250`), and `syncTwitchSchedule` awaited the stale DELETE without reading its answer
  and then wrote only the planned segments (`apps/worker/src/index.ts:10164-10183`).
- **4, overlay columns.** One helper per shape, `parseStoredJsonArray` and `parseStoredJsonObject`: text
  that is not JSON, or JSON of the other shape, reads as the empty column. The normalizer after them
  handles wrong entries inside a list or an object, except `disabledLayers` of a preset that is not a
  list, which now reads as none. No warning is
  raised for such a row, as with M85: the studio shows the fallback, and saving writes the column anew.
- **5, stale segments.** `apps/worker/src/twitch-schedule-cleanup.ts`. Decisions: a 404 counts as deleted
  (the segment is not there); a segment whose start has passed is dropped after a failed delete, because
  it is no longer an upcoming entry and keeping it would hold the warning open with no way to clear it;
  the retry rides on the regular sync (15 min) instead of every worker cycle, because the stored keys
  would otherwise never equal the plan and every cycle would resend the whole schedule. The set of kept
  keys is held in memory, so after a worker restart the first sync runs once at once. A stored segment
  whose PATCH answers 404 is created anew with a POST (found by the review: a delete Twitch carried out
  without confirming it keeps a dead id, and a block planned again would otherwise fail every sync; the
  same was true before for a segment deleted by hand). A 401 on a delete
  does not trigger the token refresh by itself; the channel and schedule writes of the same cycle do.
- Not measured: Twitch's real answer to a DELETE of a past segment (the proxy blocks twitch.tv); the
  code does not depend on it. The M113 entry under *DUT checks for the next release candidate* covers the live path.
- `CHANGELOG.md` is not touched: per `AGENTS.md` the release commit writes its section.

### M114 A Frozen Process Restarts And The Relay Is Watched

- Checked against `main` at `21f0646` first: still open. The M103 self-restart runs in the process's own
  loop (`enforceHealthSelfRestart`, `apps/worker/src/index.ts:11661`), and the stall guard
  (`runWithStallGuard`, `:11588`) is a timer on the same event loop, so neither runs in a blocked or
  stopped process; only `traefik` mounted the Docker socket (`docker-compose.yml:30`), and `relay` was the
  one service without a healthcheck. `planning/review-2026-10-05.md` has no entry for it.
- **The relay image.** `bluenviron/mediamtx:1.15.4` holds `/mediamtx` and `LICENSE`, nothing else
  (`docker export` of a container of it, listed with `tar -t`): no shell, no HTTP client, no health
  subcommand (`/mediamtx --help` names only `--version` and `--upgrade`). A Compose healthcheck cannot run
  inside it, and the pin stays.
- **Owner's choice (2026-10-21 08:11 UTC, two cards in the M114 thread).** "Wer soll eingefrorene worker-,
  playout- und uplink-Prozesse neu starten?" → "A: Aufpasser im Container" (no Docker socket). "Was soll
  passieren, wenn das Relay nicht mehr antwortet?" → "2: Melden und neu starten". Restarting the relay
  needs the Docker socket, which A leaves out; the follow-up question is in the thread, and until it is
  answered M114 reports the relay (part of every option).
- **Supervisor.** `apps/worker/src/process-supervisor.ts`, entry `apps/worker/src/supervisor.ts`. The
  child sends `stream247.heartbeat` over the IPC channel every 10 s from an unref'd timer; the supervisor
  checks every 5 s and kills the child with SIGKILL after five minutes (the M103 bound) without one, writes
  `stream247-frozen-<mode>.json` to the temp directory (kept across a container restart) and exits 1; the
  next process reads it and raises `<mode>.health.frozen-restart` (the marker stays until the incident is written, so a database that is not up yet only postpones it to the next start) (warning, event, closed by the
  area's health like the M103 incident). A child that ends by itself ends the supervisor with its code;
  SIGTERM, SIGINT and SIGHUP are passed on, so `docker stop` ends the child as before (it has no handler of its own; the supervisor then exits 143). Tini
  stays PID 1.
- **Relay watch.** `apps/worker/src/relay-watch.ts`, worker cycle step `relay`: while relay mode or live
  sources are on, `GET http://relay:9997/v3/paths/list?itemsPerPage=1` (5 s); any HTTP answer is alive.
  Two minutes without one raise `relay.unreachable` (critical, state, action `docker compose restart
  relay`); the first answer closes it, and so does switching both uses off.
- **Run by hand** (built worker, PostgreSQL 16 in Docker, 2026-10-21): `node apps/worker/dist/supervisor.js
  worker` showed two processes (`supervisor.js worker`, `index.js worker`); `kill -STOP` of the child at
  08:19:59 UTC, at 08:24:57 the log had `{"event":"worker.supervisor.frozen","mode":"worker","silentForMs":304974}`,
  supervisor and child were gone; the next start logged `worker.health.frozen_restart` and the incidents
  table had `worker.health.frozen-restart|warning|open`.
- **Review without prior knowledge** (subagent, on `fabb5cd`): no high or medium finding. Fixed: a heartbeat
  on a closed IPC channel reached the uncaught-exception handler (now `process.connected` and a send
  callback, test added and seen failing first), the marker was dropped before its incident was written,
  and the "never sends a heartbeat" stand-in sent one. Left as is: a one-off `index.js <cmd>` in the
  container falls through to worker mode as before and would report the marker too; SIGUSR1/2 and SIGQUIT
  are not passed on; `docker pause` is not covered (stated above).
- **Relay watch by hand** (same run, `STREAM247_RELAY_ENABLED=1`, no relay at first): `relay.unreachable`
  logged at 08:27:15 UTC with `unreachableForMs` 125240, row `relay.unreachable|critical|open`; with a
  stand-in answering on `relay:9997` the next cycle logged `relay.reachable` (08:29:20) and the row read
  `resolved|The relay answers again.`
- `CHANGELOG.md` is not touched: per `AGENTS.md` the release commit writes its section.
- **Follow-up: relay watchdog (owner's choice 2026-10-22 20:34 UTC).** Card "Wie passen „A: Aufpasser im
  Container“ und „Relay neu starten“ zusammen?" → "A und kleiner Relay-Wächter": the supervisor stays, and a
  service of its own with the Docker socket restarts only the relay. `apps/worker/src/relay-restart.ts`
  (`RelayRestartPolicy`, the Docker calls, one round), entry `apps/worker/src/relay-watchdog.ts`, service
  `relay-watchdog` from the worker image. It finds its own container by `HOSTNAME`, the project by its
  `com.docker.compose.project` label, the relay by that label and `com.docker.compose.service=relay`.
  No database, so it works while the rest is down; the worker's `relay.unreachable` (two minutes) tells
  the operator first, and its action now names the watchdog. Restarts back off 5, 10, 20, 40, 60 min and
  reset after 30 min of answers; a relay that is stopped or paused is left alone (someone's decision).
- **Run with the real image** (2026-10-22, Compose project with `bluenviron/mediamtx:1.15.4` and the
  watchdog from the built worker on `node:22-alpine`): `docker kill -s STOP m114wd-relay-1` at 20:38:19
  UTC; at 20:41:59 `{"event":"relay.watchdog.restart","unreachableForMs":210186,"attempt":1}`, the relay
  started again at 20:42:09 and `GET http://relay:9997/v3/paths/list` answered 200.
  Then `docker pause m114wd-relay-1` at 20:42:39: at 20:47:41 still `paused`, start time unchanged, no
  further `relay.watchdog.restart` line.
- **Review of the follow-up** (subagent without prior knowledge, on `5b3974f`): no blocking finding. Fixed:
  a relay that never answers (another network, `api: no`) would have been restarted every hour, so a
  restart now needs an answer since the start or the last restart (`relay.watchdog.never_answered`);
  one-off `docker compose run relay` containers are filtered out and a running container is preferred;
  the round loop catches errors and the response stream has an error handler (a crash would have lost
  the backoff); the restart call waits up to 60 s; answers from before a stop no longer count towards the
  30-minute reset; hold lines are logged once per streak; the incident action uses `logCommand`. Left as
  is, documented in `docs/operations.md`: the watchdog does nothing with a `hostname:` override,
  `network_mode: host` or `docker stack deploy`.
  Run again with the real image after these fixes: SIGSTOP at 20:55:07 UTC, `relay.watchdog.restart` at
  20:59:02 (`unreachableForMs` 210202, attempt 1), relay running again from 20:59:13.

### M115 A Stock RTMP Server Takes The Uplink

- Checked against `main` at `5d2d08a` first: still open. `buildTeeOutputOptions`
  (`apps/worker/src/multi-output.ts:171`) gives every destination `f=flv` behind `tee` with the fifo, and
  neither the uplink's encoded command (`buildUplinkFfmpegCommand`, `apps/worker/src/ffmpeg-runtime.ts`)
  nor the playout's three encoded commands (`apps/worker/src/index.ts`, relay off) asked the encoder for a
  global header. M105 to M114 did not touch it; `planning/review-2026-10-05.md` has no entry for it.
- **Measured in the cloud container** (2026-10-21, Ubuntu ffmpeg 6.1, `bluenviron/mediamtx:1.15.4` pulled
  through `mirror.gcr.io`, the uplink's encoder and tee options, 30 s): without the flag 34 connections,
  the first closed `unable to parse H264 config: invalid size 1`, the next 28 ended with
  `extract_extradata: A non-NULL packet sent after an EOF`, the path never ready. With `-flags:v
  +global_header`: one connection, path ready, `bytesReceived` 4704648; a `docker restart` of the server
  10 s in was reconnected by the fifo and the path was ready again. The real worker image cannot be pulled
  here (its blob host answers 403), so the broadcast smoke's phase 5 measures it in the pull request's CI,
  with a mutation run of the same image's ffmpeg without the flag.
- **Owner's choice** (2026-10-22 20:34 UTC, card in the M115 thread): "Soll ein eigener RTMP-Server (nicht
  Twitch) als Ziel zuverlässig gehen?" → "Ja, reparieren".
- **Measured with the real images** (pull request CI, run 39580526227 on `dc13a34`, broadcast smoke):
  `Stock RTMP server: closed connections 0 -> 0 over 60s; refused headers 0; a reader got 17257 bytes in
  5 s`; mutation with the worker image's ffmpeg: `refused headers 0 -> 1 without the global header`. The
  bug is confirmed on the Alpine image, not only on the stand-in.
- **Review without prior knowledge** (subagent, on `dc13a34`): no high finding. Fixed in `b086d61`: one
  uplink restart for another reason during the measurement no longer fails phase 5, a refused header is
  named while waiting for the first publish, the `PHASES` comment names phase 5. Left as is: two of the four
  unit tests guard against regressions and pass on `main` too; the source pin in the fourth reads calls with
  a regular expression.
- **Why only encoded outputs.** With `-c copy` the header comes from the input, and ffmpeg warns that the
  option was used for no stream; the uplink's copy command (relay input, no output profile) passes
  `streamCopy`.
- `CHANGELOG.md` is not touched: per `AGENTS.md` the release commit writes its section.

### M117 A Password Change Signs The Old Sessions Out

- Checked against `main` at `22b6b13` first: still open. `parseSessionValue` (`apps/web/lib/server/auth.ts`)
  checked only the signature and the 30-day age, `setOwnerPasswordHash` changed nothing a session carries,
  and `apps/web/app/api/setup/bootstrap/route.ts` checked `password.length < 10` while the change route and
  the reset command used `MIN_OWNER_PASSWORD_LENGTH`. M105 to M116 did not touch it.
- **How.** No new table or column: the cookie carries a 16-hex stamp, `HMAC(app secret, "password:" +
  stored hash)`, inside the signed payload, and `getAuthenticatedUser` compares it with the stamp of the
  user's current hash (`sessionPasswordHash`: the user row's hash, else the `system_state` one, as the
  sign-in reads it; empty for Twitch sign-ins). A change or reset writes a new hash, so every older stamp
  stops matching. The stamp does not reveal the hash: it is keyed with the app secret and truncated.
  `getAuthenticatedUserId` (the database-free pre-check of the scene preview) still checks only signature
  and age; the role check after it reads the user and the stamp.
- **Choices made without asking** (the suggestion answers them, or they follow the usual practice): the
  session that changes the password stays signed in; the reset command signs out every owner session;
  team members signed in with Twitch are not touched, they have no password. Cookies from before M117 have
  no stamp and are refused, so the update signs everyone out once rather than keeping old sessions that a
  change could not end.
- **Minimum length.** The two forms take it as a prop from their server pages (`MIN_OWNER_PASSWORD_LENGTH`
  from `@stream247/db`), since a client component cannot import that package.
- **Review without prior knowledge** (subagent, on `c1d2bba`): no high finding; every reader of the cookie
  goes through the stamp check, and all five `setSessionCookie` callers pass the right hash. Fixed: the
  forged-stamp case now builds a correctly signed cookie with another password's stamp (before, it failed
  on the signature). Left as is, outside this milestone: a 2FA challenge issued in the five minutes before
  a change still completes with a valid one-time code (the challenge is not bound to the password);
  `upsertUserRecord` writes `password_hash` from the copy it read, so a sign-in racing a change can write the
  old hash back (older than M117, which now also revives the old sessions in that window); a Twitch
  identity linked to the local owner row would keep `authProvider: "local"` and change its e-mail, which
  `setOwnerPasswordHash` matches on (not possible today).
- `CHANGELOG.md` is not touched: per `AGENTS.md` the release commit writes its section.

### M118 The Week View And /channel Plan With What Really Airs

- Checked against `main` at `caf3d40` first: all four still open. `materializePoolWindow` used only
  quarantine and the breaker (no cooldown), filled the block on air from `nowMinuteOfDay`, filled each
  block whole in block order, stopped at 5 000 items, started every block at its own start;
  `getPublicProgrammeCurrentItem` returned null without a length; `summarizeCuepoints` called
  `getCuepointProgress` without air windows. M105 to M117 did not touch them.
- **How.** The projection is now `createBlockProjection`: a block filled one air window at a time.
  `buildMaterializedProgrammingWeek` walks every window of the week in time order with one rotation state
  per pool, and a "busy until" time: the item on air (`onAirItemEndMinute`) or an item that ran over its
  block's last window. A window waits for it unless it takes the air with a cut (a dated block, or the
  block after one ends, R7); the window on air now always does. Cuepoints before now count as fired, as
  before; cuepoints of a block delayed by the item before do not (the worker fires them at the next
  boundary). The item bound is the window's length over the shortest item it can play (at least 1 s),
  capped at 200 000.
- **Cooldown.** The rule moved to core (`getTwitchVodCacheCooldownEndMs`, the worker's
  `isTwitchVodCacheCoolingDown` calls it). `getProjectionClock` (web) turns each end into a minute of the
  week (`itemHolds`), with the cooldown from `resolveVodCacheTuning`, as the worker. The projection asks at
  each pick, so the item comes back once its cooldown has ended; when every item of the pool is held it
  waits for the first to end. An insert or cuepoint item in its cooldown is not inserted then, like the
  worker's insert checks.
- **Choices made without asking** (the suggestions say "do it", the rest follows the worker): an item of
  unknown length is planned with the 30-minute estimate the week view already uses for such items, or with
  now once that has passed; `/channel`'s *Now* then shows "since HH:MM" (new viewer text, en and de) and
  no progress bar. A block that the item before covers completely reads *Covered by the item before*
  (status `balanced`, not `empty`: it has material). `nowMinuteOfDay` now carries the seconds, so the
  item times on `/channel` no longer round to the minute.
- **Tests changed, not weakened.** `pool-rotation.test.ts` pinned `function materializePoolWindow(` to
  contain `createPoolRotation(`; the function is `createBlockProjection` now, same assertion.
  `schedule-midnight.test.ts` pinned `occurrenceKey: getScheduleOccurrenceRunKey(currentScheduleItem)` in
  `state.ts`; it now pins that worker and web call `getOccurrenceCuepointProgress` with the occurrence and
  that the core function keys by the run.
- `CHANGELOG.md` is not touched: per `AGENTS.md` the release commit writes its section.
