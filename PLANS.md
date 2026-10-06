# Stream247 Plan

What to build next. The rules for every session are in `AGENTS.md`. Everything up to and including
2.2.0-rc.1 (M0-M83: milestone sections, progress notes, DUT checks, follow-up lists) is kept verbatim in
`planning/archive/plans-m0-m83.md`; `git log --follow` on that file shows its history.

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
| M83 Release 2.2.0 | Release | Now | Superseded by M106 (owner decision 2026-10-05: 2.2.0-rc.1 was never deployed or soaked; its code ships in 2.3.0) | Ship M64, M75, M76, M78, M79, M80 and M82 (owner decision 2026-10-01: the version is 2.2.0, not 2.1.1 - two new tables, a new setting and a visible default change are more than a patch) | After v2.1.0 is tagged: this branch merged, `v2.2.0-rc.1` on the DUT with a PostgreSQL backup first, the channel language set to German, the DUT checks of each milestone section run, the two measurements of the nightly outage read (M82), a 24-h soak, then 2.2.0 tagged with its GitHub release and repinned; `docs/deployment.md` names the upgrade section *Upgrading To 2.2* (earlier sections of this file still say *Upgrading Past 2.1.0*); details, the DUT checks of each milestone and the soak go into `planning/archive/plans-m0-m83.md` (sections M71 and M75-M82; the release thread adds the M83 section there) | release, docs | medium | repin v2.1.0 |
| M84 One Plan And A Reference Check | Docs + Ops | Now | Complete | One short plan, one rule file, history archived, and no doc can point at a missing file | `wc -l < PLANS.md` < 300; `wc -l < AGENTS.md` ≤ 120; `test ! -e IMPLEMENT.md && test ! -e planning/next-session-prompt.md && ! ls -d release-prune-backup-*`; `git log --follow --oneline planning/archive/plans-m0-m83.md \| wc -l` > 1; the new PLANS.md lists M57, M66, M77, M81 under "Owner-gated and deferred"; `grep -c "recovery-stack\|full-product-reset-audit\|automatically continue" AGENTS.md` = 0; each of the 12 items of 3.3 is found by a keyword grep on AGENTS.md (`jimpanse247`, `mediamtx:1.15.4`, `passed with failure`, `its own milestone`, `M66`, `M77`, `force`, `pnpm validate`, `deleted or weakened`, `German`, `texts, names`, `Hard blockers`), each ≥ 1; new `tests/unit/doc-refs.test.ts` fails on a backticked repo path in `AGENTS.md`, `PLANS.md`, `README.md`, `CONTRIBUTING.md` or `docs/*.md` that does not exist (mutation: adding `` `docs/nope.md` `` to AGENTS.md turns it red) and is green on the tree (fixes `docs/architecture.md:331`) | `AGENTS.md`, `PLANS.md`, IMPLEMENT.md (deleted), `planning/**`, release-prune-backup-* (deleted), `docs/architecture.md`, `.github/pull_request_template.md`, `tests/unit/` | low; losing an open follow-up is the risk, checked by comparing the old open rows and follow-up blocks with the new plan | revert the commit |
| M85 Safe Configuration And Secrets | Reliability + Security | Now | Complete | A stream key never stays in the audit log, and a zone typo never breaks the schedule | M4: `appendAuditEvent` redacts like `upsertIncident`; a new migration id redacts existing `audit_events` rows; integration test: a synthetic `rtmp://…/live_…` key written through `appendAuditEvent` and one seeded before the migration both read back as `<redacted>`. C4: `resolveChannelTimeZone({}, {CHANNEL_TIMEZONE:"Europe/Berln"})` returns the managed zone or `UTC` and a state incident is raised; unit test. M5: the `custom_layers_json` cast is guarded; integration test boots a DB with one malformed row | `packages/db`, `apps/worker`, tests, `docs/operations.md` | low; the redaction migration is one-way (it removes secrets on purpose) | revert the commit; redacted rows stay redacted |
| M86 A Database Blip Does Not Take The Channel Off Air | Reliability | Now | Complete | A Postgres restart or short outage leaves ffmpeg and the uplink running; web recovers by itself | H2: the failed-cycle branch is guarded; a process exits only after 5 min of consecutive failed cycles (owner Q2); pool `connectionTimeoutMillis` set. Unit test of a pure counter (below 5 min no exit, at 5 min exit). H3: a rejected `__stream247DbReady` is cleared; retry on `40P01`/`55P03`; migrations run with `SET LOCAL lock_timeout`; integration test: `ensureDatabase` fails with Postgres down, succeeds after Postgres starts, no reset helper called. R3's S1 probe (appendix of `planning/research/robustness.md`) becomes an integration test: Postgres stopped for 45 s, the worker process in all three modes is still running afterwards. DUT check (owner): `docker compose stop postgres; sleep 45; docker compose start postgres` during air, playout and uplink `StartedAt` unchanged | `apps/worker`, `packages/db`, `apps/web/lib/server`, tests, `docs/operations.md` | medium: a half-dead process for at most 5 min | revert the commit |
| M87 An External Failure Costs One Step, Not The Cycle | Reliability | Now | Complete | A refused Twitch token or a hanging call never stops heartbeat, sweep, live status or chat | H1: each integration step of the worker cycle is isolated; a refresh throw writes `twitch.refresh.failed`; HTTP 400 `invalid_grant` sets the identity status `error` with a state incident "reconnect Twitch" (owner Q3). H6: yt-dlp calls get `timeoutMs`, the six worker `fetch` calls `AbortSignal.timeout`. Tests: refresh throws → heartbeat written, sweep ran, no `worker.loop.crashed`; `invalid_grant` → status `error`; a fetch stub that never answers is aborted within its timeout. R3's S2 probe becomes an integration test: with the token endpoint stubbed to HTTP 400, `healthcheck worker` exits 0 after two cycles | `apps/worker`, `packages/core`, tests, `docs/operations.md` | low | revert the commit |
| M88 Schedule Maths Across Midnight | Bug | Now | Complete | A block past midnight behaves like one block everywhere | C1: fired cuepoints keyed by block and start date; test: Sat 23:00+120 with cuepoints at 900 s and 2700 s, at 00:05 `getCuepointInsertPlan` returns null. C2/B1: no carry-over segments in the Twitch plan, extracted as pure `planTwitchScheduleSegments`, each created segment recorded before the next request; test: Monday 23:00+120 over 7 days gives 1 segment, no `:carry` key. C3/B2: overlap on a 7-day minute line; test: Mon 23:00+120 vs Mon 00:00+30 → `[]`, vs Tue 00:00+30 → both ids (the probe in 1.1 shows today's opposite); `tests/unit/schedule-template-conflicts.test.ts:62-68` pins today's wrong model (both blocks on weekday 1); its fixture moves to weekday 1 + 2, it still asserts the conflict and gains the false-positive case, so it is strengthened, not weakened (the owner is told in the report). B3: keep-rule uses the effective start; test with horizon 60 at Tue 00:30 returns the pool. C6: day totals count only the part inside the day; test: 120 + 120 = 240 over two days becomes 60 + 60. Owner decision 2026-10-02 11:35 UTC: R1's three corrections reach main only with M88 and stay on `claude/r1-scheduling-competitors-v5o5zi` until then; M88 takes them over from that branch at `97f4037`: the bare "GMT" zone name (`d789981`), the week lens counting a midnight block once with its fill pill inside the card (`7891a85`, covers C6), `/channel` "After that" from the schedule (`a41d327`, `51e69ee`, covers V1, which then leaves M100) and their re-recorded baselines (`81f0eb6`); their tests pass unchanged in M88 | `packages/core`, `apps/worker`, tests, `docs/operations.md` | low; hidden overlaps in saved schedules show up in the editor, saved schedules stay loadable (test) | revert the commit |
| M89 Operator Actions Are Never Lost | Behavior | Now | Complete | Restart, Hard reload, Recover outputs, Refresh and Remove next do what the operator pressed | H4: pure `decideCycleEndRestartFlag` (same value → clear, newer → keep, reconnect window → keep) and the same for `pendingAction` and `insertAssetId`; table test. W2: a separate Remove-next hold that Skip and passed votes do not overwrite (owner Q5); test: B on air, C removed, passed vote on B → next is D. R3's W2 and W4 probes become tests. DUT check (owner): a Restart pressed during a cycle restarts, in direct and relay mode, as the M76 combination review in `planning/archive/plans-m0-m83.md` asks | `apps/worker`, `apps/web`, `packages/db` (additive column), tests, `docs/operations.md` | medium: direct-mode reconnect reuses the field | revert the commit; the additive column stays unused |
| M90 The 3 A.M. Answer | UX + Reliability | Next | Complete | A tired operator sees what is wrong and what to press, first | U7: a stale or missing worker or playout heartbeat is the first "Open problems" entry with its age in words and the restart command; unit test. U8: the status sentence follows the heartbeats; `grep -rn "are now active" apps/web` → no output. U10: incident messages store no relative time (test on the writer); engine fields behind "Details" (`grep -rn "ready not ready" apps/web` → no output). U11: all three interrupting actions of "If something is stuck" confirm, Soft restart, Force reconnect and Hard reload (`apps/web/components/playout-action-form.tsx:97,105,128`; in direct mode Force reconnect drops the uplink); component test per button. Every critical incident fingerprint maps to one operator action in a catalogue (`IncidentRecord` has no such field today, `packages/db/src/index.ts:399-412`); a unit test collects all `fingerprint:` literals in `apps/worker/src` and fails on a critical one without an action; the crash-loop text no longer says only "Manual intervention is required" (`apps/worker/src/index.ts:7486`). U12: render test: without a connected bot account the Live chip reads "Not connected to Twitch", never "Checking". audit U3/U30: one heartbeat constant and one effective-heartbeat function used by state, readiness and worker; test that a 50 s old heartbeat gives the same verdict everywhere. U9 (default R2 Q4 in 5.2): Playwright at 390 px, "Open problems" above y = 1 400 | `apps/web`, `apps/worker`, `packages/core`, tests, baselines, `docs/ui.md` | low | revert the commit |
| M91 Honest First Run | UX + Data | Next | Complete | A fresh install starts empty, readiness counts only what can air, and plain HTTP is explained | I1 (decided 5.1 Q5): an empty DB bootstraps with no pool, no schedule block and no URL-less source (unit test on `createInitialSeedState`); existing installs keep their rows (integration test); readiness: a pool is ready only when a block uses it and it has a ready asset, the schedule only when the coming week has no unplayable block (`tests/unit/onboarding*.test.ts`). I2 (decided 5.1 Q6): over `http:` on a host other than `localhost`/`127.0.0.1`, `/setup` and `/login` show the two ways out; render test. I6: component test: the URL field is prefilled with the request origin and the zone field with the browser zone. I7: render test of the password warning under the field plus, per decided 5.1 Q8, a change-password form under Admin → Settings → Security that requires the current password (API test: wrong current password refused, right one changes it) and a one-line container command for a reset documented in `docs/operations.md` (integration test: the reset entry point run against a test database sets a new password and sign-in with it succeeds); no e-mail reset. I8: render test: the login hint has no line clamp and, without Twitch app credentials, contains "Twitch app credentials" and the link to `/setup` step 3 | `packages/db` seed, `apps/web`, tests, baselines, `docs/getting-started.md` | low: only `isDatabaseEmpty` installs change | revert the commit |
| M92 Getting Started A Stranger Can Follow | Docs + Ops | Next | Complete | The guide leads a stranger from an empty host to air without a gap | I4: `docs/getting-started.md` gets "Get the files" (clone a release tag, or download `docker-compose.yml` and `docker/mediamtx.yml`), the link `https://dev.twitch.tv/console/apps` (also in wizard step 3) and a numbered stream-key step; `grep -c "dev.twitch.tv/console" docs/getting-started.md` ≥ 1. I3: unit test that the four compose image defaults equal the newest non-rc `## X.Y.Z` heading in `CHANGELOG.md`, so a release commit that forgets them fails. I5: the same one-or-two-accounts sentence in wizard and guide (decided 5.1 Q9). `pnpm test:fresh-compose` green | `docs/`, `apps/web/app/setup`, `tests/unit/`, `README.md` | low | revert the commit |
| M93 Dated And One-Off Schedule Blocks | Feature | Next | Complete | "The next 10 days at 20:00 this playlist" and "once on 10 Oct" can be saved on a 24/7 grid, and air, previews, `/channel` and Twitch agree | R1 row A (decided 5.1 Q1, Q2): `valid_from`/`valid_until` in baseline, ALTER, migration, manifest, mapper, writers and blueprints; filter in `buildScheduleOccurrences`; dated layer ranks first in `findCurrentScheduleOccurrence`; `applyScheduleLayers` with `airWindows`; conflicts per layer; ended rows listed as ended; form field *Runs*; "Single day" renamed to "One weekday, every week". Tests: a 10-day run has day 10 and not day 11; a once-block airs once; a carry-over past `valid_until` still ends; weekly 18-22 + dated 20-21 gives three windows with one key; a cuepoint is not re-fired; the 24/7 grid + dated 20:00 block saves (today `["grid","special"]`); schema-manifest and DB round-trip tests | `packages/core`, `packages/db`, `apps/web`, `apps/worker`, tests, baselines, `docs/` | medium: touches the one function every schedule consumer uses; additive columns | revert the commit; before a reverse repin below M93, delete every dated or one-off block (or restore the pre-upgrade dump): an older image ignores the date columns, so it airs those blocks every week, ended ones included, and its whole-state writes erase the dates (`docs/deployment.md`, *Upgrading To 2.3*) |
| M94 Inserts From Remote Sources Air | Bug | Next | Complete | A YouTube or Twitch insert airs, or is skipped once with an incident, never retried forever | W1: the due insert is warmed in the queue scan; a failed or bridged insert counts as consumed and raises an incident naming it (owner Q6); both insert checks apply quarantine and breaker. W5: one shared "cuepoint asset of a block" helper used by worker and preview; test: `insertEveryItems: 0` with a pool insert asset gives the same cuepoint count in both. W6: an item that failed to open is retried once; `failed` treated like an empty current item in the Move next and insert checks. R3's W1 probe becomes a test | `apps/worker`, `packages/core`, tests | low–medium: crash-loop interplay | revert the commit |
| M95 Self-Healing Fills The Gaps | Reliability | Next | Complete | No stale incident, no orphan encoder, no permanently lost item | H5: disk and system-volume flags re-armed from open incidents on the first cycle; `secrets.key-mismatch` resolved at a boot where every secret decrypts; tests. W7: the playout exit handler returns when the exiting child is not current (static test as R3's); the uplink handler checked for the same pattern. H9: one re-probe per quarantined item per 24 h, one per source per cycle, only with the breaker closed and no outage verdict (owner Q1); test. U18: `scripts/soak-monitor.sh` counts uplink and relay restarts; shell test or `bash -n` plus a fixture run | `apps/worker`, `scripts/`, tests, `docs/operations.md` | low | revert the commit |
| M96 Local File Durations | Data | Next | Complete | Local-library assets carry their real length, so planning numbers are right | U4: `ffprobe` duration at scan time, bounded timeout, cached by size + mtime; unit test on a generated 2-minute file → `durationSeconds` within 1 s of 120; an unchanged file is not probed again (spy); Day lens shows "Unique library: 6m" for three such files | `apps/worker`, `packages/db`, tests | medium: a large first scan is slower, so probing is incremental | revert the commit; stored durations are harmless to old images |
| M97 Week View Tells The Truth | UX | Next | Complete | The week view shows what will play, with dates, overnight blocks once, and why a block repeats | U5: each pool's rotation carried across blocks in time order through the worker's rotation function (shared, not copied); dates on day headers; hours, not minutes; an overnight block shown once with "→ 01:00 Sun"; repeat reason with numbers. U6: confirmation before "Replace existing schedule blocks"; "Edit block" and "Add block" on the week view. Tests in `program-week-projection`: three items, two blocks, the second block starts with item 2, not item 1; a 24 h block reads "24 h"; a block with 6 min of video in 24 h carries the reason "plays ≈ 240 times"; an overnight block appears on one day only. e2e: "Replace existing schedule blocks" opens a confirmation and Cancel leaves the blocks unchanged | `packages/core`, `apps/web`, tests, baselines | medium: preview must not drift from the worker, so one shared function | revert the commit |
| M98 The Production Path Has A Smoke | Test | Next | Complete | CI exercises playout → HLS → uplink with the relay on | U15: a CI job starts the stack with the relay on and asserts that `program.m3u8` MEDIA-SEQUENCE grows and the uplink output grows over 60 s; the job fails when the uplink is stopped (mutation run) | `.github/workflows/ci.yml`, `scripts/`, `docker-compose*.yml` | low (CI only) | revert the commit |
| M99 Wizard To First Programme | UX | Later | Complete | `/setup` ends with a stream key and a playing week | U1 (decided 5.1 Q9): skippable step "Where the stream goes" with the Twitch preset, the key stored encrypted and masked; the destination form moves to Studio → Output, the old anchor redirects. U2: skippable step "First programme" creates a pool from chosen media and applies the "Always-on single pool" template. R2 U3: render test: an empty library says how to add media, a filtered-empty library says the filters hide everything. e2e: a fresh owner completes both steps and readiness shows destination, pools and schedule ready | `apps/web`, tests, baselines, `docs/getting-started.md` | medium: moves a form operators know | revert the commit |
| M100 Public Programme For Viewers | Feature | Later | Complete | Viewers see what comes next and the coming week, in their own time | V1 ("After that" from the schedule) comes with M88 through R1's commits `a41d327` and `51e69ee` and is not built again here. V2: "Scheduled now" when playout is down. R1 row B: a 7-day list on `/channel` per day, dated items marked; `/channel.ics` validated by a parser test; times per default R2 Q7 in 5.2 (viewer's zone first; unit test with a browser zone other than the channel zone). Layout per 2.5a: a *Now* card with progress bar and remaining time (unit test on the remaining-time and progress values for a fixed clock), a *Next* list of the next 24 h at item level from the shared week projection, consecutive items of one block grouped with "N more" (test: 3 blocks × 5 items give 3 groups with "4 more" each), crossing midnight without a break (test); Playwright at 390 px: the *Now* card is above the fold. R2 V7: the on-air Next card adds "in N min" to its bare time range (`packages/core/src/viewer-messages/en.ts:29`) through the catalogue, en + de, unit test for a fixed clock. Catalogue parity en/de green | `apps/web`, `packages/core`, tests, baselines, `docs/` | low | revert the commit |
| M101 Schedule Across DST, Wall Clock Kept | Bug | Later | Complete | Twice a year the counts are right while blocks keep their wall-clock times (owner Q4) | C5: cuepoint elapsed time from real instants (test: block from 01:00, at 03:30 local on 2027-03-28 reports 5 400 s, not 9 000 s); a non-existent local time maps forward (02:30 on 2026-03-29 → `01:30Z`, not `00:30Z`); the Twitch segment end follows real minutes; `docs/operations.md` states the wall-clock rule (skipped in March, twice in October) | `packages/core`, `apps/worker`, tests, docs | low | revert the commit |
| M102 Standby Shows Standby | Bug | Later | Complete | The standby or reconnect slate never shows the previous item's title | W8: `writeStandbySlate` sets the standby scene payload; unit test on the payload; a design-baseline check of the standby frame | `apps/worker`, tests, baselines | medium: changes the on-air picture | revert the commit |
| M103 Backoff And Health Restarts | Reliability | Later | Complete | Repeated restarts slow down; a hung worker or uplink restarts itself | H7: growing backoff up to 5 min for the crash-loop reset and the uplink watchdog; the crash-loop incident no longer says "Manual intervention is required" when playable media exists (unit test on the message). H8 (owner Q7): worker and uplink exit after 5 min of failing their own healthcheck; playout only while its feed does not advance. Tests: backoff sequence; a playing playout with an advancing feed never exits | `apps/worker`, `docker-compose.yml`, tests, docs | medium: dark time grows with backoff; a wrong rule could restart a playing channel | revert the commit |
| M104 Wording Pass And Chat Answers | UX | Later | Complete | Admin text names no milestone ids; viewers can ask the bot | U13: render test fails on `\bM\d{2}\b` in admin text. U14: the admin preview and (i) show the localized standby text. S19 (lead from the stopped planning branch, re-checked): overlay output is one checkbox among many (`apps/web/components/overlay-settings-form.tsx:890`) and the Scene tab shows "unknown" / "never" before a first publish; Scene gets an on/off banner at the top and "Not published yet"; render test. V5/V6 (decided 5.1 Q7): `!commands` (only enabled commands), `!now`, `!next` with the `/channel` link, one reply per `!request` (queued with position, no match, cooldown, queue full), each with its own switch, 60 s per viewer and 10 s global cooldown, en + de; unit tests per reply | `apps/web`, `apps/worker`, `packages/core`, tests, baselines | medium: chat volume and Twitch rate limits | revert the commit |
| M105 Review Fixes Before 2.3 | Reliability + Docs | Now | Complete | The defects the 2026-10-05 review of M84-M104 confirmed are fixed before the next candidate, and the repository stops advertising a 2.2.0 that does not exist | A dated or one-off block takes the air at its start and gives it back at its end, cutting the item on air (owner decision 5.1 Q1, 2026-10-01); a scheduled insert from a source outside the block's pool plays to its end; an upgrade and rollback section for everything since 2.1.0 with a pre-rollback step for dated blocks, the downgrade-note rule back in AGENTS.md; compose and env defaults pin a release that exists; the CHANGELOG lists no 2.2.0; the confirmed minor findings fixed or recorded with a reason (list: `planning/review-2026-10-05.md`); `pnpm validate`, baselines and smokes green | worker, core, web, db, docs | medium | revert the merge |
| M106 Release 2.3.0 | Release | Now | Planned | Ship 2.2.0-rc.1 (M64, M75, M76, M78-M80, M82) and M84-M105 as 2.3.0 (owner decision 2026-10-05) | `v2.3.0-rc.1` on the DUT after a PostgreSQL backup, migrations counted, channel language set to German, the DUT checks run, a 24-h soak, then 2.3.0 tagged with its GitHub release and repinned | release, docs | medium | repin v2.1.0 after the dated-block step |
| M107 The Overlay Shows The Next Video | UX | Now | Complete | The on-air "Next" card names the video that airs next, as `!next` does (owner request 2026-10-06: "the overlay shows the next programme block, what comes at 16:00, but what interests me is what !next says, the next video") (ships in 2.3.1 after 2.3.0; owner decision 2026-10-06, so the running 2.3.0-rc.1 soak is not reset) | One prediction of the item that will actually air next serves the scene payload, text mode and `!next`: the playout's next queue item while something plays, from the block that will be current when the item on air ends (the next block's pool when the item runs past the block end, a dated block's first pick when it takes over first), with its expected start time; the next block only when nothing plays or no next item is known; both languages; tests that the card and `!next` agree | core, worker, tests, docs | low | revert the merge |

M84-M104 were approved by the owner on 2026-10-02 (all 21, as written). Their source is `planning/proposal-2026-10.md`: references in these rows such as "decided 5.1 Q5", "2.5a", "3.3" and finding ids (S1, C3, I1, U7, …) point into that file and the research files under `planning/research/`. Order: M84 first, then the table order with M88 before M93, M93 before M100 and M91 before M99; one milestone per thread, the next starts after the previous one is merged.

State on 2026-10-05: production runs v2.1.0. `v2.2.0-rc.1` was tagged but never deployed, and the release
commit `e81b6f4` (`release: v2.2.0`) was never tagged; no 2.2.0 images exist. M84-M104 are merged on `main`
after it. Owner decision 2026-10-05: M105 fixes the review's findings, then everything ships as 2.3.0 (M106);
until then `main` pins v2.1.0 and its version reads `2.2.0-rc.1`, the last that exists. Steps and commands:
`HANDOFF.md`. Findings outside the milestones, waiting for the owner to pick numbers:
`planning/suggestions-2026-10-04.md`.

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

Sources and library:

- Operator edits of title and category are overwritten by every sync (M72).
- YouTube approximate dates stay in the bucket of the first sync; keeping the earliest observed value
  would refine them (M72).
- Twitch archives that drop out of a listing and return play after newer ones (M72).
- The source detail page sorts by `publishedAt || updatedAt`, and `updatedAt` changes on every sync
  (M72).
- `updateAssetRecords` has no caller left; remove it with its web re-export (M72).
- `<source> item` / `Video aus <source>` is stored at ingest in the language of that sync (M80).

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

## DUT checks for the next release candidate

Checks a milestone could not run in the cloud. The owner runs them on the DUT after the next candidate is
deployed; the release that ships them records the results.

- M85, after the repin: the scrub ran and no Twitch key is left in the audit trail or the incidents. The
  query prints counts, never a key; it passes on `1|0|0`. And the incident `config.channel-timezone.invalid`
  is not open on `/live?tab=status`.

  ```sh
  ssh dut 'docker exec -i stream247-postgres-1 psql -U stream247 -d stream247 -At' <<'SQL'
  SELECT (SELECT COUNT(*) FROM schema_migrations WHERE id = '20261002_001_redact_stored_secrets_again'),
         (SELECT COUNT(*) FROM audit_events WHERE message ~ 'live_[0-9]+_'),
         (SELECT COUNT(*) FROM incidents WHERE message ~ 'live_[0-9]+_');
  SQL
  ```

- M86, during air on the deployed candidate: a 45 s PostgreSQL stop leaves playout and uplink running.
  Passes when both `StartedAt` values are the same before and after, and the playout log shows
  `worker.loop.database_unreachable` but no `worker.loop.database_outage_exit`.

  ```sh
  ssh dut 'docker inspect -f "{{.Name}} {{.State.StartedAt}}" stream247-playout-1 stream247-uplink-1'
  ssh dut 'docker stop stream247-postgres-1; sleep 45; docker start stream247-postgres-1'
  ssh dut 'sleep 60; docker inspect -f "{{.Name}} {{.State.StartedAt}}" stream247-playout-1 stream247-uplink-1'
  ssh dut 'docker logs --since 5m stream247-playout-1 2>&1 | grep -oE "worker.loop.database_[a-z_]+" | sort | uniq -c'
  ```

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

- M91, after the repin: an existing install keeps its rows (only an empty database starts empty), and
  the reset command is in the worker image. Passes when the three counts are the same before and after
  the repin and the last command prints `present`. Then, from another machine on the home network, open
  `http://<DUT address>:3000/login`: the page shows "Signing in will not work over plain HTTP from
  another machine" with the two ways out (skip if port 3000 is firewalled). The reset itself is not run
  on the DUT.

  ```sh
  ssh dut 'docker exec stream247-postgres-1 psql -U stream247 -d stream247 -Atc "SELECT (SELECT COUNT(*) FROM sources), (SELECT COUNT(*) FROM pools), (SELECT COUNT(*) FROM schedule_blocks)"'
  ssh dut 'docker exec stream247-worker-1 test -f apps/worker/dist/reset-owner-password.js && echo present'
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

- M95, on the deployed candidate, if any item is quarantined at the repin (the first command prints more
  than 0): each such item gets one trial within 25 hours. Passes when the second command, run 25 hours
  after the repin, counts at least as many `playout.asset.reprobe.*` lines as the first printed items, and
  the third prints no `playout.source-breaker.opened` line whose `failedAssetIds` lists only items that
  were quarantined at the repin. Real YouTube and Twitch sources are not reachable from the cloud.
  And the next soak's baseline line lists `uplink=` and `relay=` with numbers, not `unknown`.
  M105 (R34): before the repin, the fifth command lists the quarantined Twitch archives with their
  `cache_status`; in the 25 hours after it, the sixth (the downloads queued) names no archive the fifth
  listed as quarantined and not `ready`, except one whose trial cleared it and that the pool's queue then
  reached (each uncached one shows a `playout.asset.reprobe.availability` line instead of a download).

  ```sh
  ssh dut 'docker exec stream247-postgres-1 psql -U stream247 -d stream247 -Atc "SELECT COUNT(*) FROM assets WHERE playback_probe_failures >= 3"'
  ssh dut 'docker logs --since 25h stream247-playout-1 2>&1 | grep -oE "playout.asset.reprobe.(cleared|failed|availability)" | sort | uniq -c'
  ssh dut 'docker logs --since 25h stream247-playout-1 2>&1 | grep "playout.source-breaker.opened"'
  ssh dut 'grep "Baseline container restarts" ~/logs/soak-<stamp>.log'
  ssh dut 'docker exec stream247-postgres-1 psql -U stream247 -d stream247 -Atc "SELECT id, cache_status FROM assets WHERE playback_probe_failures >= 3 AND path LIKE '"'"'%twitch.tv/videos/%'"'"' ORDER BY id"'
  ssh dut 'docker logs --since 25h stream247-playout-1 2>&1 | grep "vod.cache.job.queued"'
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

- M100, on the deployed candidate while a video airs: the public programme names it and the next ones. The
  first command prints the Now card's kind (`item` while a video airs; `block` only on the standby slate or
  a live input) and how many groups *Up next* has (at least one on a scheduled channel); the second counts
  the calendar's events (at least one). Then open `/channel` on a phone: the Now card with its bar is on the
  first screen, and the times are the phone's. On the picture, within an hour before a block change, the
  Next card reads `… · in N min` (en) or `… · in N Min.` (de).

  ```sh
  ssh dut 'docker exec stream247-web-1 wget -qO- http://127.0.0.1:3000/api/channel/live' | jq -r '[.programme.now.kind, (.programme.next | length)] | @tsv'
  ssh dut 'docker exec stream247-web-1 wget -qO- http://127.0.0.1:3000/channel.ics | grep -c BEGIN:VEVENT'
  ```

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
- M103, after the candidate's soak: no process restarted itself and the backoff fired only where a
  watchdog did. `ssh dut 'for s in worker playout uplink; do docker logs stream247-$s-1 2>&1 | grep -cE "worker.health.self_restart"; done'`
  prints `0` three times; `ssh dut 'docker logs stream247-uplink-1 2>&1 | grep -E "uplink.watchdog.backoff|worker.health.unhealthy" | tail -20'`
  lists any backoff with its `attempt` and `backoffMs` next to the watchdog restart before it. Any
  `worker.health.self_restart` is reported with the reason it names.
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

- M105 (part C), through the candidate's soak, which begins with the repin's container restart: an ffmpeg
  that ends during its own start is handled (on 2026-10-02 10:24 UTC under v2.1.0 a YouTube item started
  right after a restart was bridged 15 s later as if still on air, then the switch waited out the 20 s
  stop deadline). Passes when the first command prints no `playout.stop.deadline_exceeded` line, or each
  one it prints is a hung process (a `playout.process.exit_ignored` line follows it); a
  `playout.stop.already_exited` line is a start that failed to spawn and is reported. And no restart
  nobody pressed (R1): the second command lists the `operator-restart` ends and the restart presses of
  the same 25 hours; every `asrun` row has a `press` row (Restart or Hard reload) up to a minute before it.

  ```sh
  ssh dut 'docker logs --since 25h stream247-playout-1 2>&1 | grep -E "playout.stop.(deadline_exceeded|already_exited)|playout.process.exit_ignored"'
  ssh dut 'docker exec -i stream247-postgres-1 psql -U stream247 -d stream247 -At' <<'SQL'
  SELECT 'asrun', ended_at, title FROM as_run_log WHERE end_reason = 'operator-restart'
    AND ended_at > to_char(now() - interval '25 hours', 'YYYY-MM-DD"T"HH24:MI:SS')
  UNION ALL
  SELECT 'press', created_at, type FROM audit_events WHERE type IN ('playout.restart.requested', 'broadcast.hard-reload.requested')
    AND created_at > to_char(now() - interval '25 hours', 'YYYY-MM-DD"T"HH24:MI:SS')
  ORDER BY 2;
  SQL
  ```

- M105 (part D, R35 and R4), through the candidate's soak, which spans the DUT's nightly network blip (about
  00:02 UTC): the uplink's restarts during the blip are not counted and nothing holds the uplink once the
  network is back. Passes when the first command shows `uplink.watchdog.network_outage` at the blip, an
  `uplink.watchdog.network_outage.uncounted` line for each watchdog restart until
  `uplink.watchdog.network_back`, and no `uplink.watchdog.backoff` line from the blip until ten minutes after
  `network_back`; a `restart_waits` line (a timestamp storm kept on air) is reported with its time. The
  soak's outage lines of the blip (second command) are reported with their seconds next to the uplink
  lines; under 2.1.0 the uplink was back 50 to 70 s after a blip. A blip without any
  `uplink.watchdog.network_outage` line (the uplink never restarted, so it never asked) passes too.

  ```sh
  ssh dut 'docker logs --since 25h stream247-uplink-1 2>&1 | grep -E "uplink.watchdog.(network_outage|network_back|backoff|hold_ended)|uplink.(encoder_stall|destination_stall|encoder.no_progress|discontinuity_storm).restart" | tail -40'
  ssh dut 'log=$(ls -t ~/logs/soak-*.log | head -1); grep -E "outage" "$log" | tail -20'
  ```

- M105 (part D, R22), on the deployed candidate with *Enable viewer control* on: within 20 s after an item
  change (Live → Status shows the new title), type `!now` from a viewer account. Passes when the bot names
  the new title, not the one before.

- The candidate's soak (R31 of the 2026-10-05 review) measures the channel, not the way in, and sees
  container restarts and critical incidents. It is started as step 10 of *Safe Upgrade Flow* in `docs/deployment.md` says, from the
  release checkout on the DUT (`<checkout>`). Before it counts: the soak script is main's (the first
  command prints `1`); the log's first line reads `Starting soak monitor for 24h at http://127.0.0.1:3000`
  (set `CHECK_BASE_URL` to that address, or `APP_URL` in the `.env` the script reads: the 2.1.0 soak's only
  outage was a 220 s Cloudflare `522` on the public route while the channel stayed on air); and its
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

- The checks of 2.2.0-rc.1 are in the archive, sections M75-M82. That candidate never reached the DUT, so
  the 2.3.0 candidate runs them too.

## Shipped

| Release | Date | Milestones | Where |
| --- | --- | --- | --- |
| (2.2.0) | Not released: release commit `e81b6f4` never tagged, `v2.2.0-rc.1` never deployed; these milestones ship with 2.3.0 (M106, owner decision 2026-10-05) | M64, M75, M76, M78, M79, M80, M82 | archive, sections M64, M75, M76, M78-M80, M82 and the M83 row; `CHANGELOG.md`, *2.2.0-rc.1* |
| 2.1.0 | 2026-10-02 | M68, M69, M70, M72, M73, M74 (release M71) | archive, sections M68-M74; `CHANGELOG.md` |
| 2.0.0 | 2026-09-09 | M59, M60, M61, M62, M63, M65 (release M67) | archive, sections M59-M67; `CHANGELOG.md` |
| 1.x | 2026-03-27 (1.0.0) to 2026-09-05 (1.5.47) | M0-M58 | archive, milestone tables, phase sections and *Progress Notes*; `CHANGELOG.md` |

## Milestone notes

Sections for milestones in **Open** that need more than their row, appended in milestone order.

### M85 Safe Configuration And Secrets

Done on branch `claude/m85-audit-log-stream-keys-f7f4u2`.

- **M4, stream keys in the audit trail.** `appendAuditEvent` runs the message through `redactSecrets`
  before the insert, as `upsertIncident` does; the whole-state write (`persistState`) redacts the audit
  rows it rewrites as well, because a state write can carry an entry that never passed the sink. The
  scrub of `20260902_001_redact_stored_secrets` is now one function, `redactStoredSecrets`, and runs again
  under the new id `20261002_001_redact_stored_secrets_again` (incidents, audit trail, destination and
  runtime errors; idempotent, one-way). Integration test: a synthetic `rtmp://live.twitch.tv/app/live_…`
  key written through `appendAuditEvent`, and one inserted by SQL before the migration on a database
  where the first scrub is already recorded, both read back as `rtmp://live.twitch.tv/app/<redacted>`.
- **C4, a typo in the channel timezone.** `resolveChannelTimeZone` skips a value `Intl` rejects: env,
  then the saved zone, then `UTC`. `findChannelTimeZoneProblem` names the skipped value; the worker raises
  the state incident `config.channel-timezone.invalid` (warning, area `system`) once per text and closes it
  when the value is fixed (`apps/worker/src/channel-timezone.ts`, registered in `incident-classes.ts`).
  `isUsableTimeZone` caches its answer, because the resolver now asks on every schedule read.
- **M5, malformed `custom_layers_json`.** The named-scenes migration casts only text that
  `pg_input_is_valid(…, 'json')` accepts and gives any other row an empty layer list; the column is left as
  it was. The overlay reader parses the column with a fallback to `[]`, so the boot and every later state
  read survive the row. Integration test: an older database with one such row boots, records the
  migration, and `readAppState` succeeds. Without the guard the same test fails with
  `invalid input syntax for type json`, and every later test in the file with it.
- Not changed: the setup form's sentence that `CHANNEL_TIMEZONE` "overrides whatever is saved here" is not
  true for an unusable value; a wording change needs new baselines, so it is left for a UI milestone.

### M86 A Database Blip Does Not Take The Channel Off Air

- **H2, the failed-cycle branch.** `runLoop` writes the `<mode>.loop.crashed` incident and the alert
  inside `try` blocks, as the stalled branch already did. A failed cycle whose incident write fails too
  could not reach the database; `DatabaseOutageBudget` (`apps/worker/src/database-outage.ts`) counts
  those from the first one of a streak, and the process exits only once the streak has lasted five
  minutes (owner Q2), logged as `worker.loop.database_outage_exit`. A completed cycle, or a failed one
  whose incident write succeeds, ends the streak. Decision: a failure while the database answers never
  counts towards the exit, so a cycle that keeps failing for another reason keeps looping as before
  M86 instead of taking ffmpeg down every five minutes. The pool has `connectionTimeoutMillis` 15 s; it
  bounds connecting and waiting for a free pooled client, not a query already running (a paused database
  still ends in the 300 s stall guard). A pool wait that times out while the database is up but busy
  counts as unreachable; before M86 the same wait ran into the stall guard.
- **H3, the bootstrap.** `ensureDatabase` clears a rejected `__stream247DbReady`, so the next call boots
  again (every caller of the failed attempt still sees its error). The bootstrap transaction sets
  `lock_timeout` 5 s after it holds the advisory lock (the lock that serialises the boots stays
  unbounded) and retries `40P01` and `55P03` with 250, 500 and 1000 ms backoff, four attempts in all.
- **Tests.** `tests/unit/database-outage.test.ts`: the counter (no exit below five minutes, exit at five,
  reset by a reachable cycle) and a source pin on the guarded branch.
  `tests/integration/database-outage.test.ts`, against a real `postgres:16-alpine` on a fixed port:
  `ensureDatabase` fails with the container stopped and succeeds after `docker start` with no reset
  helper; a bootstrap behind a held `ACCESS EXCLUSIVE` lock on `schema_migrations` logs a `55P03` retry
  and succeeds; R3's S1 run: the built worker in `worker`, `playout` and `uplink` mode, Postgres stopped
  for 45 s, all three still running with `worker.loop.database_unreachable` in their logs, and each
  writes a heartbeat again after the restart. The two source-pin tests and all three integration tests fail on the code before M86. The S1 test needs
  `apps/worker/dist` (built by `pnpm typecheck`, which runs before `pnpm test` in CI and in `validate`).
- Not changed: web needed no code of its own (`apps/web/lib/server` reads through `ensureDatabase`).
  During the outage the playout cycle cannot pick the next item, so ffmpeg's current input is what keeps
  the channel on air; when it ends inside the outage the programme stops until the database is back.
- **Review 2026-10-05 (R3), fixed in M105.** The exit write of an ffmpeg that ended inside the outage was
  refused and dropped, so after the outage an operator insert that had ended still read as active and
  aired again from 0 (not a regression: before M86 the row was as stale). The refused write is now kept
  and applied again before the next state read, dropped at the next spawn (`apps/worker/src/playout-exit-write.ts`,
  `tests/unit/playout-exit-write.test.ts`).

### M87 An External Failure Costs One Step, Not The Cycle

- **H1, the cycle.** `runWorkerCycle` runs its 17 integration steps through `runIsolatedCycleSteps`
  (`apps/worker/src/cycle-steps.ts`): a step that throws is logged as `worker.step.failed`, opens the
  warning state incident `worker.step.failed.<step>` (registered in `incident-classes.ts`, keyed by the
  fixed step name), and the next step runs. The heartbeat and `resolveFinishedIncidents` follow the steps.
  A step's success closes its incident once per process and again after a failure, not on every cycle.
  Decision: when the incident of a failed step cannot be written, the database is gone, so the cycle ends
  there as before M87 and M86's outage budget counts it; carrying on would add one 15 s connection
  timeout per remaining step and could run a paused database into the stall guard.
- **H1, the refresh (owner Q3).** The refresh exchange moved to `apps/worker/src/twitch-token-refresh.ts`.
  A failed proactive refresh of the bot account opens `twitch.refresh.failed` and ends the `twitch-sync`
  step only. HTTP 400 (or 401) whose body says `invalid_grant` or "Invalid refresh token" is a refused
  token: the connection is set to `error` with a fixed text and the critical state incident
  `twitch.reconnect.required` ("Reconnect Twitch") opens; the first cycle that finds the connection
  `connected` again closes both. The same applies to the two 401-retry refreshes. The connection heal
  skips a record carrying the refused text, so a still-valid access token cannot flip it back to connected
  (R3's flapping risk). The broadcaster slot's refresh is caught the same way, but its status stays as it
  is (see `refreshBroadcasterSlotAccessToken`).
- **H6, timeouts.** `fetchWithTimeout` (`apps/worker/src/http-timeout.ts`, 10 s, `AbortSignal.timeout`
  plus a race for an implementation that ignores the signal) carries the six Twitch requests R3 counted in
  `index.ts`, the refresh exchange, the EventSub sync, the broadcast-channel id lookup and the Discord
  alert; the token validate of the heal gets the same signal. The two yt-dlp calls without a timeout
  (flat listing, Twitch VOD metadata) get 2 min, clamped by `clampToCycleAwaitCeiling`, with
  `killProcessGroup`.
- **Tests.** `tests/unit/external-failure-isolation.test.ts`: a throwing refresh step leaves the later
  steps, the heartbeat and the sweep running; a failure that cannot be recorded ends the cycle;
  `invalid_grant` and Twitch's body are refused, 503, 429 and a client error are not; a fetch that never
  answers is aborted within its timeout (150 ms in the test), also when it ignores the signal, and a
  webhook token never reaches the message; source pins: no bare `fetch(` in `index.ts`, every
  `execFileText` call there has `timeoutMs`. `tests/integration/twitch-refresh-refused.test.ts` is R3's S2
  run: the built worker, the token endpoint stubbed to HTTP 400 "Invalid refresh token", two cycles, then
  `healthcheck worker` exits 0, `twitch.refresh.failed` and `twitch.reconnect.required` are open, no
  `worker.loop.crashed`, a seeded old `worker.loop.stalled` was closed by the sweep, and the connection
  reads `error`. On the code before M87 the same test fails ("fewer than two worker cycles wrote a
  heartbeat").
- Not measured: Twitch's real answer to a revoked refresh token. The test uses the body Twitch documents;
  both that and the OAuth `invalid_grant` match. A body that matches neither keeps the status and leaves
  `twitch.refresh.failed` open, as before M87 minus the crashed cycle.
- Not changed: the worker polls the live status and syncs EventSub only while the connection is
  `connected` (and `/live` shows it only then), so after a refused token the live status reads "unknown"
  until the reconnect. That follows from owner Q3 (status `error`); the live-status poll itself runs on
  the app's credentials and would not need the user token.
- Limit: the yt-dlp timeout is per call; the source syncs walk their sources one by one, so three or
  more sources on a host that stops answering can still take one cycle to the stall guard. A per-step
  budget would close that.
- Review (fresh subagent): a refused broadcast channel token in the shared 401 retry put the bot account
  into error; the error now carries its account and only the bot's refusal marks it
  (`isIdentityRefreshRefusal`). The channel owner's scope check (core's validate helper) now gets
  `fetchWithTimeout` too. Left: a reconnect that lands between the refusal and the error write is
  overwritten (narrow window); a disconnect instead of a reconnect leaves "Reconnect Twitch" open.
- **Review 2026-10-05 (R2), fixed in M105.** Isolating the steps took away the only alert for an
  integration that keeps failing: before M87 a throwing step ended the cycle and `worker.loop.crashed` sent
  a Discord/e-mail alert, one per 30 min; since then a refused token found by the proactive refresh (the
  usual path) only opened incidents. Now `twitch.reconnect.required` alerts when it opens (`opensIncident`,
  `apps/worker/src/alerts.ts`), and a step that failed on every run for 30 min alerts, again every 30 min
  while it lasts (`CycleStepAlertWatch`, `apps/worker/src/cycle-steps.ts`; a success ends the count, a
  database outage alerts nothing). Tests in `tests/unit/external-failure-isolation.test.ts`. The review of
  the M105 change found the new alert in the shared `markIdentityRefreshRefused`, so a refusal found by the
  reconciliation's or the schedule sync's 401 retry alerted twice (their own warning too; `sendAlert`
  dedups by subject): those two now send their warning only for a failure that is not a refused token.

### M88 Schedule Maths Across Midnight

- **R1's corrections.** Cherry-picked from `claude/r1-scheduling-competitors-v5o5zi` at `97f4037` with
  `-x`, unchanged and without conflicts: `d789981` (bare "GMT"), `7891a85` (week lens, C6 for scheduled
  minutes), `a41d327` and `51e69ee` (`/channel` "After that", V1), `81f0eb6` (their baselines). Their tests
  pass unchanged.
- **C1, cuepoints.** `getScheduleOccurrenceRunKey` gives a carry-over the key of the occurrence on its
  start date; the worker's `cuepointWindowKey`, the cuepoint keys and the live cuepoint summary use it, so
  a cuepoint fired before 00:00 stays fired after it. Equal to the occurrence key for every other block,
  so a stored window key stays valid across the upgrade.
- **C2/B1, Twitch.** `planTwitchScheduleSegments` (`apps/worker/src/twitch-schedule-plan.ts`) leaves the
  carry-over out; a phantom segment already on Twitch is deleted by the existing stale pass. Each segment
  Twitch accepts is written at once (`upsertTwitchScheduleSegment`); the final full replace stays. Side
  effect: blocks Twitch cannot take (under 30 or over 1380 min) are no longer in the desired key list, so
  they no longer force a full sync every cycle.
- **C3/B2, overlap.** Blocks are compared on a circular 7-day minute line. Decision: a save is refused
  only for an overlap the saved blocks take part in (`findScheduleConflictsInvolving`, used by create,
  duplicate, edit and a template laid over the week; *Clone day* since M105, review finding R10, where it
  still saved with only its empty-weekday check, `tests/unit/schedule-clone-day.test.ts`), so an overlap
  that was already saved and is now revealed is marked in the editor without locking every other edit. An edit of one of the two blocks (even a
  title change) is refused until it ends the overlap. `tests/unit/schedule-template-conflicts.test.ts`:
  the midnight fixture moved from weekday 1 + 1 to 1 + 2 and still asserts the conflict; a new case
  asserts the same-weekday early block is no conflict (strengthened, not weakened).
- **B3, cache keep-rule.** `collectUpcomingPoolIds` uses `effectiveStartMinuteOfDay`.
- **C6, day totals.** Projected minutes are cut at the day's edges like scheduled minutes (R1 counted
  scheduled minutes once; projected still counted the block's full projection on both days).
  A block that ends before 00:00 but whose projection overflows past it counts the overflow on no day
  (it has no carry-over); before M88 its whole projection counted on its own day.
- **Tests.** `tests/unit/schedule-midnight.test.ts`; 10 of its cases and both midnight cases of the
  template test fail on the code before M88 (the Twitch plan is new, so its cases have no "before").
- Not checked: Twitch's answer to a duplicate segment (unreachable from the cloud). Not changed: the
  editor's *Conflicts only* tip still says "on the same weekday" (a wording change needs baselines).

### M89 Operator Actions Are Never Lost

- **H4, the cycle's writes.** Three pure decisions in `apps/worker/src/playout-boundary.ts`, each "clear
  what the cycle read, keep anything newer": `decideCycleEndRestartFlag` (the restart branch, the start
  write in `startOrSwitchPlayout` and the cycle end; the reconnect window of direct mode keeps the row's
  value under the same conditions as before), `decideCycleEndPendingAction` (the Refresh and queue-rebuild
  handlers, the start write, the cycle end) and `decideFailedCycleInsert` (the failed start, the failed
  switch, the missing destination and an insert that failed to prepare drop only the insert the cycle
  read; review finding). The cycle records what it read
  where it decides (`consumedPendingAction` before the handlers, `consumedRequests` and `consumedInsert`
  next to `restartRequested`). With no write in between the outcome is the old one; the difference is a
  newer request, which the next cycle now carries out. That covers Restart, Hard reload, Recover outputs,
  Force reconnect, Refresh, a chat vote applied during the cycle, and Move next followed by Skip (the
  manual-next arm needs the Skip's flag).
- **W2, the Remove next hold (owner Q5).** Two additive columns, `remove_next_asset_id` and
  `remove_next_until` (base schema, ALTER list, migration `20261002_002_remove_next_hold`, manifest).
  Remove next writes them instead of the skip hold, so Skip and the chat vote, which write the skip hold, no
  longer lift it, and a skip hold already in place stays. The worker holds the item out of every arm
  (selection, pool eligibility, queue, cuepoints, manual next) and clears an expired hold with the skip
  hold; core `heldOutAssetIds` / `isAssetHeldOut` give the override arm, the chat's operator hold and the
  Play now refusal the same rule. Decision: a Pin, Fallback, Move next or Replay previous of the removed
  item is the operator's newer word and lifts the hold (as a Pin already lifts a skip hold); Resume clears
  it. The as-run intent still reads the skip hold only (a removed item is not on air). Asset retention keeps
  a held item.
- **Tests.** `tests/unit/operator-actions-never-lost.test.ts`: the three tables; R3's W4 probe with the
  decisions (Restart and Refresh survive the end write, Move next then Skip takes the manual-next arm); R3's
  W2 probe (B on air, C removed, a passed vote on B or a Skip of B → next is D); the admin writes; source
  pins on every worker write (no `restartRequestedAt: ""` or `pendingAction: ""` is left in `index.ts`).
  `tests/integration/db-roundtrip.test.ts`: the migration on a database without the columns, and R3's
  restart-flag-swallowed run on real Postgres (the press is read by the next cycle, then cleared once).
  Three source pins (`pool-rotation`, `operator-play-now-wiring`) now also name the Remove next hold or
  the request-time check of a failed insert. 35 of
  the 37 unit cases fail on the code before M89.
- Not changed: the web's own actions still overwrite each other (Restart clears a pending Refresh, as
  before); Resume is still enabled only while a Pin, Fallback or insert is in effect, also when a hold is
  what the operator wants cleared. Not measured: the real timing of the race on a playing channel (DUT
  check above).
- **Review 2026-10-05 (R1), fixed in M105.** "Keep anything newer" also kept a Skip, a passed chat vote or
  a Restart aimed at the item a cycle was already switching away from; the next cycle restarted the new
  item from 0 and the as-run log recorded an operator restart nobody pressed. A flag written before the
  spawn of the item now on air counts as done by that spawn (`decideCycleEndRestartFlag` with
  `spawnedAtMs`, in the start write and the cycle end); a press after the spawn is still carried out. A
  Force reconnect of direct mode pressed in that window is done by the new process's own connection.
  Table cases in `tests/unit/operator-actions-never-lost.test.ts`.

### M90 The 3 A.M. Answer

- **Audit U3/U30, one heartbeat verdict.** `packages/core/src/heartbeat.ts` holds the two windows
  (worker 240 s, playout and uplink 60 s), `judgeHeartbeat` (fresh up to the window, stale beyond it,
  missing without a timestamp) and `resolveEffectivePlayoutHeartbeatAt` (in HLS mode a fresh feed read
  by a running uplink counts while playout is meant to be on air, as readiness did before). The Live
  page (`getWorkerHealth`, `getPlayoutHeartbeatHealth`, the drift report), readiness and the worker's
  container healthcheck (now the pure `decideHealthcheck` in `apps/worker/src/healthcheck.ts`) all
  judge through it; no file declares its own heartbeat window. The Live page's 45 s became 60 s, and
  it counts the feed in HLS mode like readiness. The incident engine's 120 s windows are a different
  question (how long an area must be healthy before a past event closes) and stay. Behaviour change:
  in HLS relay mode the playout container's healthcheck now also counts a fresh program feed, as
  readiness did, so a hung playout loop behind a live feed no longer fails it; the loop stall ceiling
  still ends such a process.
- **U7, U9.** `getHeartbeatProblems` (web) turns a stale or missing worker or playout heartbeat into the
  first entries of *Open problems*, with the age in words ("Last heard from 7 minutes ago") and the
  restart command; they are computed when the page is drawn, never stored. *Open problems*
  (`apps/web/components/open-problems-panel.tsx`) is the first panel of `Live → Control` at every
  width; Playwright checks it above y = 1 400 at 390 px (`tests/e2e/workspace-layout.spec.ts`).
  `docs/ui.md` names that on-call check as the one mobile commitment (R2 Q4 default).
- **U8.** The *System readiness* sentence on `Live → Status` is built from the same heartbeat problems,
  and shows under open incidents too while the worker or playout is silent.
- **U10.** The source-drought incident is written with `describeSourceHealth({ clock: "absolute" })`
  ("the first of them at 2026-10-02 02:40 UTC"); the page keeps the relative wording. It was the only
  incident writer with a relative time. *Current and next* reads "Checked and ready to play." and the
  engine fields are under *Details*.
- **Operator actions.** `packages/core/src/incident-actions.ts` maps every critical fingerprint to one
  action (looked up by fingerprint when a card is drawn; `IncidentRecord` is unchanged, so open
  incidents get the sentence too). `tests/unit/incident-actions.test.ts` reads every `fingerprint:`
  with its severity from the worker and `packages/db` and fails on a critical one without an entry.
  The crash-loop message names the action instead of "Manual intervention is required".
- **U11.** Soft restart, Force reconnect and Hard reload ask first; the question says what viewers see
  (relay: a short cut, the Twitch connection stays up; direct: the stream drops for a moment). Force
  reconnect is greyed out with the relay, where the server refuses it.
- **U12.** The Live chips read "Not connected to Twitch" while no Twitch account is connected; the label
  is longer than the 12 characters the three connected labels keep, and wraps in the sidebar chip.
- **Tests.** `heartbeat-verdict` (a 50 s heartbeat is fresh on the Live page, in readiness and in the
  healthcheck, direct and HLS; 70 s is stale in all three), `incident-actions`, `three-am-answer`
  (render tests of *Open problems*, the status sentence, each interrupting button with Cancel and OK,
  and the chip). `incident-age` reads the panel from its new file.
- Not changed: a web action still writes `heartbeatAt: now` (`apps/web/lib/server/broadcast.ts`), so a
  button press hides a stale playout heartbeat for up to 60 s.
- **Review 2026-10-05 (R25), fixed in M105.** The keyed `source` entry matched every `source.` fingerprint,
  so the three source-wide warnings (`source.local-library.scan-failed`, `source.local-library.empty`,
  `source.direct-media.invalid`) got "check this source's address and whether it is still online", wrong
  for a mount or permission fault. They have entries of their own, and an exact entry now wins over a
  keyed family (`findIncidentOperatorAction`); a test fails on a new literal `source.` fingerprint without
  one. R19 (M99's move) corrected the `playout.start.failed` action too.

### M91 Honest First Run

- **I1, empty start.** `createInitialSeedState` (`packages/db`, now exported) seeds only the local media
  library; the demo pool, its two blocks and the two URL-less placeholder sources are gone. Only
  `isDatabaseEmpty` installs get it; an existing install keeps every row, the old demo rows included
  (`tests/integration/first-run.test.ts`). `scripts/lib/dev-fixture.sh` no longer draws on
  `source-youtube`.
- **I1, readiness.** `getGoLiveChecklist` counts what can air: *Content sources* only the local library and
  enabled sources with a URL; *Program pools* only a pool a block uses that holds a ready video
  (`poolHasPlayableAsset` in core, the schedule preview's eligibility); *Weekly schedule* only when every
  block of the coming week has something to play. `findUnplayableWeekBlocks` is shared with the schedule
  page's "Needs attention" panel, which computed the same list inline. Since M105 (review finding R18) a
  pool counts as scheduled, and the schedule as ready, only through the blocks of the coming week (the
  week view's projection), and the week must hold one: a schedule of dated blocks that have ended or start
  after the week read ready before, and *First programme* read Done.
- **I2.** `InsecureHttpNotice` on `/setup` and `/login`: in production, over `http:` on a host other than
  `localhost`, `127.0.0.1` or `::1`, one notice with the two ways out (HTTPS via the `proxy` profile or
  one's own, or an SSH tunnel to `localhost:3000`). The server renders it from the request's forwarded
  protocol and host; after hydration the browser's own address decides. Cookies stay `Secure` (decided
  5.1 Q6).
- **I6.** The instance step prefills the public URL with the request origin and the zone with the
  browser's (`useSyncExternalStore`, so the server's zone never shows), each with "check it" in its hint,
  while nothing is saved and the environment does not pin it. The step summary names the language too.
  Since M105 (review finding R16) the zone only on a first run: once the public URL was saved or the
  schedule has a block, an empty zone is UTC in use, and the field stays empty with "Empty means UTC, and
  the channel runs on UTC now"; before, saving the step to fix the URL moved every block by the browser's
  offset (`zoneInUse`, a render test in `onboarding-first-run`).
  The searchable zone list R2 suggested is not built.
- **I7.** The warning sits under the password field in step 1. *Change password* under Admin → Settings →
  Security (local owner only, current password required, rate-limited like sign-in, audit
  `auth.password.changed`). The reset is `apps/worker/dist/reset-owner-password.js` in the worker image:
  it asks twice without echo, reads piped input as one line, writes both the `system_state` hash and the
  local owner user (`setOwnerPasswordHash`), audit `auth.password.reset`; `docs/operations.md`, *Owner
  password lost*. The scrypt format moved from `apps/web/lib/server/auth.ts` to
  `packages/db/src/owner-password.ts` so both write the same thing. Sessions are stateless, so a change
  does not sign other sessions out; they expire as before.
- **I8.** The Twitch sign-in hint names what is missing ("the Twitch app credentials are not saved" with
  a link to `/setup?step=twitch-app`, or the public URL with step 2) and is not clamped (`.login-hints`);
  the login eyebrow reads "Owner sign-in".
- **Tests.** `onboarding-readiness` (seed, readiness), `onboarding-first-run` (render tests of both pages
  over LAN HTTP, the instance prefill, the warning, the login hint and its CSS), `owner-password-change`
  (the route with the real scrypt format), `tests/integration/first-run.test.ts` (empty bootstrap, rows
  kept through a restart, the built reset command followed by the real sign-in route).

### M92 Getting Started A Stranger Can Follow

- **I4.** `docs/getting-started.md` has a new section 1, *Get the files*: clone a release tag
  (`git clone --depth 1 --branch vX.Y.Z`) or download `docker-compose.yml` and `docker/mediamtx.yml` (and,
  for a `.env`, `.env.production.example`) from the tag into a directory that keeps `docker/`. These are
  the two files the fresh-compose smoke's guide pass copies. Section 3 links
  `https://dev.twitch.tv/console/apps`, and so does setup step 3 (`TWITCH_DEVELOPER_CONSOLE_URL` in
  `apps/web/lib/twitch-account-texts.ts`). New section 7, *Stream key*, in four numbered steps: from the
  Twitch Creator Dashboard to *Managed stream key* of *Primary Twitch Output* under `Live → Status →
  Output destinations`. The sections after 0 moved up by one (old 1-5 → 2-6, old 6-9 → 8-11); the
  guide's own cross-references, its unit test and the smoke's comment follow. The README's Quick Start
  gained the same two steps.
- **I3.** `tests/unit/getting-started-guide.test.ts` compares the four compose image defaults (web,
  worker, playout, and the uplink on the worker image) with the first `## X.Y.Z` heading of
  `CHANGELOG.md`; `-rc.N` headings do not count, matching the release commits, which change the defaults
  only for a final version. Mutation: playout on `v2.1.0` turns it red.
- **I5 (decided 5.1 Q9).** One sentence, `TWITCH_ACCOUNT_COUNT_SENTENCE`: "One Twitch account can be both
  the broadcast channel and the bot account, but two are recommended: a separate bot account keeps chat
  and moderation off the channel's own login." Setup step 4 renders the constant; the guide's section 2
  carries it word for word (unit test) and no longer says not to run as the broadcast channel.
- **Not changed.** Setup steps 3 and 4 are not in the design or wording baselines, so none needed
  re-recording. No DUT check: nothing here runs differently on a host.

### M93 Dated And One-Off Schedule Blocks

- **Model.** `schedule_blocks.valid_from` / `valid_until` (`TEXT NOT NULL DEFAULT ''`, channel-local
  `YYYY-MM-DD`, inclusive; empty = unbounded) in the base schema, the ALTER list, migration
  `20261003_001_schedule_block_dates`, the manifest, both mappers, all four writers (whole state, insert,
  replace, update), the repeat-set update and blueprints. The dates bound when an occurrence *starts*, so a
  block crossing midnight on its last date still runs into the next day. *Once* is both dates equal; the
  route derives the weekday from the date.
- **Layer (5.1 Q1).** `buildScheduleOccurrences` filters by date and passes the occurrences through
  `applyScheduleLayers`: a dated occurrence gets its whole range as `airWindows`, an undated one its range
  minus the dated ranges of the day before, the day and the day after; one taken over completely is left
  out. The weekly occurrence keeps its key and start, so cuepoints count from it. `isScheduleOccurrenceOnAir`
  reads the windows and `findCurrentScheduleOccurrence` ranks dated first. Lists (`listUpcoming…`, `/channel`,
  the standby slate, the Twitch plan) read one entry per window via `listScheduleAirSegments`; a window
  after the first is keyed `<key>@<minute>`. Twitch gets one segment per window; under 30 min is skipped
  as before.
- **Cuepoints.** When the dated block comes on, the worker's window key moves to the dated run and the
  weekly block's fired keys go with it. Instead of keeping a second key, `getCuepointProgress` takes the
  air windows: only a cuepoint inside the window on air now is due, so one from an earlier window is not
  fired again and one inside the dated part is skipped (the test fails on main: the 18:15 cuepoint fires
  again at 21:05).
- **Conflicts.** Per layer: dated over undated is no conflict; two dated blocks conflict only when their
  runs meet: for a shared span under eight days the real runs are compared (Mon 1-7 Oct and Mon 7-20 Oct
  do not meet), otherwise the weekday line decides; the day after the last date counts for a block
  crossing midnight.
- **Lists.** A window that starts after midnight is listed on the date it starts (as that date's
  carry-over window), so a dated block at 00:30 is named next ahead of the weekly block resuming at 01:00.
- **Editor.** Field *Runs* (*Every week* / *Between dates* / *Once*) before Repeat behavior; *Daily*
  between dates creates only the weekdays the dates contain (three for 1-3 Oct). Ended blocks are listed
  faded with *Ended 10 Oct*, left off the timeline, and *Hide ended* filters them; a save whose last date
  is before today is refused. The timeline draws dated blocks over the weekly ones, inset with a dashed
  edge; the week lens lists a cut block's windows and the run's dates. "Single day" reads "One weekday,
  every week".
- **Decisions without the owner (routine).** Duplicate refuses a weekday outside the block's dates; clone
  day copies a dated block only onto weekdays its dates contain; the weekly coverage summary counts the
  weekly grid alone; projected minutes of a cut weekly block are not cut (M97 reworks the projection).
- **Review (fresh subagent).** All acceptance items met; it found the list order after midnight, the
  over-strict dated conflict and an unhelpful error for a malformed date on create, all fixed with tests.
  Left as is: a repeat-set edit checks the dates against the edited copy's weekday only (other copies
  outside the dates are saved and never air), and an ended block's edit is refused until it gets new
  dates (R1 1.3: a window entirely in the past is refused).
- **Baselines.** `scripts/design-baseline.sh` on a fresh stack: 77 passed; the day lens and the block form
  are not in the snapshots, so nothing was re-recorded.
- **Not built.** R1's inline takeover notice in the form (1.3 step 8) and the "for N days" helper: not in
  this row's acceptance.
- **M105, review finding R7: the takeover on air.** The worker now does what the projection, `/channel`,
  Twitch and `docs/operations.md` said since M93: a dated or one-off block takes the air at its start and
  gives it back at its end, cutting the item on air (as-run `switch`). Before, only the pool the worker
  consulted changed and the item finished first, so a one-off under a multi-hour archive could pass
  without airing. `apps/worker/src/schedule-takeover.ts` reads the boundary from the run the last cycle
  recorded (`cuepointWindowKey`): a new run that is dated, or a change from a dated run to a block on air.
  At that cycle neither keep-arm of `choosePlaybackCandidate` holds the item, so the new block's pool
  picks; the operator arms (Pin, Fallback, Play now / Insert, Live Bridge) come first and still win, and
  once they end nothing is cut. Weekly to weekly keeps the graceful handoff; a dated block with nothing
  after it lets its item finish; the worker logs `playout.schedule.takeover`. The week projection cuts a
  block's last item where such a takeover follows (`cutAtEnd`), and `/channel`'s *Up next* with it. Tests:
  `tests/unit/schedule-takeover.test.ts` (the decision; the selection across cycles every 15 s: the
  one-off swallowed before M105 and cut at 20:00 and 21:00 now, as-run and projection agreeing on every
  start and cut, a Pin across the start, weekly to weekly still graceful; the wiring in `index.ts`), one
  case in `tests/unit/public-programme.test.ts`. Left: `/channel`'s *Now* card shows the item's own end,
  not the cut; the dated block's first item is not warmed ahead of its start, so a cold prepare delays the
  cut by that long (the item on air plays on meanwhile); when the new pool's pick is the item already on
  air it plays on.
- **M105, review of the M105 change (2026-10-05).** As first written the takeover had four holes, now
  closed in `apps/worker/src/schedule-takeover.ts` and the cycle. (1) A pick that could not be prepared
  inline (an uncached Twitch archive with `TWITCH_VOD_CACHE_ALLOW_REMOTE_FALLBACK=0`, a yt-dlp resolve that
  failed) fell into the recovery plan and cut the healthy item for the global or generic fallback or the
  standby slate until the download was done; and a block with no eligible item cut it for the fallback
  ladder. Now the takeover waits (`decideTakeoverPrepareFailure`, `scheduleTakeoverWaiting`): the item on
  air plays on, the cycle records the run before the boundary so the next one tries again, the queue
  prefetch warms the pick meanwhile, and `playout.schedule.takeover_deferred` is logged once. So the
  sentence above holds for a failed prepare too. (2) An edit of the dated block on air (start or length,
  also of its series) changed its run key and read as a new start, cutting its own item; a run of the same
  block is no boundary now. (3) The selection and the recorded run read two clocks; a cycle straddling the
  minute recorded the dated run without the cut, and the archive swallowed the one-off as before R7. The
  cycle now reads the schedule once (`scheduleNow`) for every selection, the insert skips and the end
  write. (4) On the fall-back night every wall-clock change in the repeated hour was a cut (three in an
  hour); none is now (`isRepeatedWallClockMinute`). Tests in `tests/unit/schedule-takeover.test.ts` (each
  case also fails with the rule taken out). Warming the next dated block's first item ahead of its start
  is not built (`planning/review-2026-10-05.md`).

### M94 Inserts From Remote Sources Air

- **W1, warm.** The queue scan takes the due scheduled insert ahead of the pool's next items, with their
  expensive-resolve budget, as a warm-only item: its probe is cached and counted (quarantine, breaker), but
  it never becomes the queue, the prefetched item or its status. Due means the pool's interval insert once
  it is the item after the one on air (`isPoolIntervalInsertDueNext`), and a cuepoint item while a
  cuepoint is due or comes within the probe cache's lifetime of five minutes (`getCuepointWarmAsset`).
  Only under the conditions the pool's queue is scanned (`poolQueueScanned`).
- **W1, skip once (owner Q6).** A scheduled insert that the boundary bridges (cold remote resolve with
  nothing on air) or that fails to prepare is used up as if it had started: the pool's counter is reset,
  the cuepoint is fired (`decideScheduledInsertSkip`; the cycle's snapshot carries it to the cycle-end
  write). Incident `playout.insert.skipped` (warning, event, closed by playout health) and audit row
  of the same name, both naming the insert. A start or switch failure of ffmpeg for a scheduled insert
  skips it the same way (review finding), so no path leaves it due for good. The bridge itself is
  unchanged, so the fallback covers one cycle.
- **W1, gate.** Both insert checks, and the warm step, refuse an item that is quarantined, in its Twitch
  cache cooldown, or from a source the breaker holds open (`automaticItemBlockedPredicate`); a half-open
  source's item may be its trial, as in the pool. The week view applies the same rule to its insert items.
- **W5.** `resolveBlockCuepointAssetId` in core (block's item, else the pool's insert item, any cadence)
  is used by the worker, the week view and the live view's cuepoint summary.
- **W6.** An immediate input-open failure owes one retry (`input-open-retry.ts`, kept in memory for ten
  minutes): the next cycle starts the same item again ahead of Move next and the inserts, with its
  original reason code, so the pool's position does not move. When the channel is dark and the item is
  remote, the existing bridge covers the resolve and the retry follows it. The retry's own failure is
  final and does not add to the crash-loop count, so the guard trips no sooner than before (three
  different items); every later failure of the same item counts again, so a pool of one that keeps
  failing still trips it (review finding: first cut left them uncounted for ten minutes). The retry does
  not take the pool's position again. `failed` with nothing running frees the slot for Move next and both insert checks
  (`isCurrentItemSlotFree`).
- **Tests.** `tests/unit/inserts-from-remote-sources.test.ts` (R3's W1 and W6 probes as tests; W5's
  worker-versus-week count fails on main: 0 against 2). Four source pins changed with the code and keep
  their assertions: Move next's slot condition, the pool cursor writes (now three, the third pinned), the
  cuepoint call with the gate, and the queue's reason codes, now read from the named condition.
- **Review (fresh subagent).** Found the uncounted repeat failures, the start failure, a double count
  of the position after a bridge and the bridge's error named as the insert's; all fixed with tests.
  Left as is: an owed retry is dropped without a log line when a reconnect slate or standby takes that
  cycle; the week view does not know the Twitch cache cooldown; the worker wiring is pinned by source
  text, the decisions are run.
- **Not measured.** A real YouTube or Twitch insert on air (DUT check above).
- **Review 2026-10-05, fixed in M105.** R11 (major): a scheduled insert whose item is not from one of the
  block pool's sources was cut at the next cycle for the pool's pick (since v2.1.0; this section's fixture
  put the sting's source into the pool, and the DUT check's "longer than 10 s" passed a cut insert).
  `keepsRunningScheduledInsert` (`apps/worker/src/scheduled-insert.ts`) holds it to its end, behind the
  operator arms and the R7 takeover, with no trigger so nothing is used up twice; multi-cycle test with a
  YouTube sting under a Twitch pool (`tests/unit/scheduled-insert-plays-out.test.ts`); the DUT check now
  asks for `natural-end` or `duration-bound` and the planned length. R12: a warm insert went cold at each
  five-minute probe expiry and a boundary in that gap skipped it; a ready entry of a remote item is
  resolved again in the background in its last minute and replaced only on success (`isProbeRefreshDue`,
  `tests/unit/probe-refresh-ahead.test.ts`). R13: a scheduled insert that fails at input-open is retried
  once with the next format candidate like a pool item (W6 above excluded it), and a second failure is
  reported as `playout.insert.skipped` with reason `open-failed`
  (`tests/unit/scheduled-insert-open-retry.test.ts`).

### M95 Self-Healing Fills The Gaps

- **H5, volume incidents.** The worker's new first step `state-incident-rearm` reads the open incidents
  once per process (`rearmStateIncidentFlags`, `apps/worker/src/state-incident-rearm.ts`) and seeds the
  in-memory flags of the disk watermark (`disk.watermark.evicted`, `.exhausted`) and the system-volume
  watch (`system.volume.low`). Both monitors then re-measure on the same cycle and resolve through their
  own hysteresis; nothing is closed without a measurement. A failed read leaves the step to the next cycle.
- **H5, key mismatch.** In the same step `resolveSecretKeyMismatchWhenSecretsDecrypt` (`packages/db`)
  opens every stored ciphertext (managed config, managed secrets, destination stream keys, overlay video
  source URLs and publish keys, two-factor secrets) with the current key, without raising anything, and
  resolves `secrets.key-mismatch` only when none fails and this process saw no failure. With no open
  incident it reads nothing. Twitch tokens are stored in plain text and are not part of it.
- **W7.** The playout exit handler returns before it touches any state when `isStaleProcessExit` says the
  exiting child is not current: another process is current, or the stop deadline abandoned it
  (`abandonedPlayoutProcesses`, filled only by the deadline). A process that left the slot without being
  abandoned (the already-signalled branch of `stopPlayoutProcess`) is still recorded, as before. The late
  exit logs `playout.process.exit_ignored`; its as-run row is closed by `watchAsRunEnd` as before. This also
  covers the M94 retry marker the M94 thread named. **Uplink, checked:** each uplink process has its own
  runtime entry; its exit handler reads that entry's planned reason and removes that entry by identity, and
  `stopUplinkProcess` has no deadline, so the pattern does not occur there; pinned by a static test.
- **H9 (owner Q1).** `selectQuarantineReprobes` (core) picks quarantined, ready, included items of sources a
  pool uses, 24 h after their last probe, one per source per cycle (the longest waiting), none while the
  source's breaker is open or half-open or within 10 min of a network outage the playout saw
  (`QUARANTINE_REPROBE_OUTAGE_HOLD_MS`; the outage check runs only when a failure is counted, so it has no
  "outage ended" moment). The trials go through the queue scan after the pool's items, only with a process
  on air, using the expensive-resolve budget the queue left, and never trigger an immediate cycle. A clean
  trial clears the quarantine (`planAssetProbeUpdates`); a failed one keeps the count and only stores the
  time and error. The source breaker hears neither (`sourceBreakerOutcomesOf`), so known-bad items cannot
  open the breaker of a source that serves everything else. Network-outage failures are dropped as before.
- **U18.** `scripts/soak-monitor.sh` reads restart counts for one list, `web worker playout uplink relay`, in
  the baseline and the check. A service that does not run reads `unknown` and is skipped. The docs said a
  restart "by more than one" fails the soak; the script fails on any increase, and the docs now say so.
- **Tests.** `tests/unit/self-healing-gaps.test.ts` (H5 flags and step order, W7 guard decision plus the
  static test turned around from R3's U33 probe, the uplink check, H9 selection and outcomes, the soak list);
  `tests/unit/release-readiness.test.ts`: a fixture run fails on an uplink and on a relay restart (fails with
  the old list), and the baseline line of the existing restart test now names all five services;
  `tests/integration/self-healing-incidents.test.ts`: the built worker against PostgreSQL 16 closes all three
  seeded incidents on its first cycle (fails with the step removed), and the key-mismatch incident stays open
  while one stored secret is sealed under another key.
- **Review (fresh subagent).** All four items met. Fixed: the stop deadline now clears the stop's planned
  reason and as-run intent itself, since the abandoned process's late exit no longer does (left set, the
  replacement's first crash would have read as planned); the docs name the trigger watermark as the media
  volume's close point after a restart; the trial wiring of the queue scan is pinned. Left as is: with the
  one expensive resolve per cycle unused by the queue, a trial takes it and that cycle waits for one remote
  resolve (bounded by its timeout and abandoned when the playout process dies, as for the queue); a step
  whose secret scan keeps throwing reports `worker.step.failed.state-incident-rearm` every cycle like any
  failing step; a failed trial of a Twitch archive still downloading counts as that day's trial.
- **Not measured.** W7 with a real hung ffmpeg (static and decision tests only); H9 against real YouTube
  and Twitch sources (DUT check above).
- **Review 2026-10-05 (R34), fixed in M105.** A trial of a quarantined Twitch archive missing from the
  cache started its full download, queued one at a time ahead of the archives the programme needed. Such
  a trial now only asks whether the archive still resolves (yt-dlp, no download, nothing cached); a
  cached, too-large or non-Twitch item is tried as before (`apps/worker/src/quarantine-trial.ts`,
  `tests/unit/quarantine-trial.test.ts`). Decision: a clean answer lifts the quarantine, and the download
  comes when the pool's queue reaches the archive. DUT check above extended.

### M96 Local File Durations

- **U4.** The local-library scan asks `ffprobe -show_entries format=duration` for each file
  (`apps/worker/src/local-durations.ts`, 10 s per call, process group killed on timeout) and stores the
  whole seconds in `assets.duration_seconds`, like remote listings do. The file version it belongs to
  (`size:mtimeMs`) goes into the new additive column `assets.duration_probe_key` (baseline, `ALTER`,
  migration `20261003_002_asset_duration_probe_key`, manifest). A file whose key matches is not probed
  again, across scans and worker restarts; the whole-state write and the source-sync write carry the key, so
  an unrelated app-state write does not send every file back to ffprobe.
- **Incremental.** A scan stops starting probes after 30 s and leaves the rest without a key for the next
  scans (worker cycle every 30 s), so a large first scan fills in over a few cycles instead of holding one.
  With a short `STREAM247_LOOP_STALL_TIMEOUT_SECONDS` the budget shrinks so budget plus one probe timeout
  stay inside the cycle-await ceiling (`resolveLocalDurationScanBudgetMs`). A scan that could not list some
  directory probes nothing, since its assets are not written and the probes would only repeat.
  The runtime event `local-library.durations.probed` reports `probed`, `failed`, `deferred`.
- **Decisions.** A file ffprobe cannot read stores its key with duration 0 (unknown, the 30-minute estimate),
  so it costs one probe per file version, not one per scan. For a probed local file the duration belongs to
  its version: a replaced file whose probe fails reads unknown, not the old file's length
  (`chooseStoredAssetSyncFields`); remote listings keep the old rule (no duration never erases a known one).
- **Side effect on air.** A local file with a known duration now has the duration bound (`apps/worker/src/duration-bound.ts`)
  like cached Twitch VODs: it is ended at duration + margin (default 15 s) if no EOF came. With the overlay
  off or in text mode the picture ends with the file, so a local file ends by EOF as before. In scene mode
  (the DUT's) it never does: the scene overlay ends with its longest input (`shortest=1` only for a YouTube
  video+audio pair, `buildSceneOverlayFilterComplex`) and the scene pipe never ends, so from M96 on every
  probed local file, the global fallback and boundary bridges included, ends by the bound at duration +
  margin, its last frame frozen over padded audio, as-run end reason `duration-bound`. Before M96 such a file
  had no duration and ended through the feed-audio watchdog once the pad ran out. Corrected after the
  2026-10-05 review (R15; until then this note said local files normally end by EOF well before the bound):
  an improvement, but the main on-air effect of M96, and measured only by the DUT check above. The global
  fallback still plays once per start, not looped. And a live picture-in-picture source's sound is now
  mixed over local programmes, as the design in `docs/deployment.md` says for programmes of known length
  (before: picture only over local files).
- **Tests.** `tests/unit/local-durations.test.ts`: real ffprobe on a generated two-minute file reads
  120 s; a spy sees three probes on the first scan, none on the second, one after a touch; budget,
  failed probe and failed stat; the Day lens reads "Unique library: 6m" for three such files (90m before).
  `tests/integration/local-durations-worker.test.ts`: the built worker against PostgreSQL 16 stores 120 s for
  three generated files, its second scan probes nothing, and the Day lens from the stored state reads 6m.
  `tests/integration/db-roundtrip.test.ts`: the migration on an old `assets` table, and the key and duration
  through a scan write, an unrelated app-state write, a write without a key and a replaced file.
- **Not in CI.** CI's `validate` job has no host ffmpeg (its optional install runs after `pnpm test`), so
  the real-ffprobe tests skip there (`runIf`, as in the ticker tests) and ran locally; the stubbed tests run
  everywhere. Moving the install before the tests is left to the owner: that apt step has hung before.
- **Review (fresh subagent).** All items met. Fixed: a failed scan no longer probes (its results were lost
  and repeated every cycle); the budget follows the cycle-await ceiling. Noted above: the PiP audio side
  effect and the CI gap.
- **Review 2026-10-05 (R14), fixed in M105.** The decision above stored a timeout or an ffprobe that could
  not start like an unreadable file, so a good file kept duration 0 until touched. Now only an answer
  (ffprobe ran and found no duration, or refused the file) stores the key; a probe without an answer
  stores nothing and the file waits 30 minutes before the next try, taking no scan budget meanwhile
  (`isUnansweredDurationProbe`, `ExecFileTextError` in `apps/worker/src/process-utils.ts`,
  `tests/unit/local-durations-retry.test.ts`).

### M97 Week View Tells The Truth

- **U5, rotation.** `buildMaterializedProgrammingWeek` walks the week's blocks in time order and hands each
  pool's rotation state (and its items since the last insert) from one block of the pool to the next,
  through `createPoolRotation`, the function the worker picks with (`packages/core/src/pool-rotation.ts`).
  A test compares five blocks' items with `walkPoolRotation` item by item. Each block is projected to its
  end (at most 5 000 items; 48 are listed), so a 24 h block of 2-minute clips hands on the right item.
- **Now.** `getMaterializedProgrammingWeekPreview` passes the minute of today: a block that has ended
  reads *Aired earlier today* and takes nothing from the rotation; the block on air is projected from now.
  Its fill label can therefore change during the block (an item that will run past the end).
- **Display.** Day headers *Sat 3 Oct*, *24 h scheduled*; block times *20:00 → 22:00*, a block past
  midnight once on its start day as *23:00 → 01:00 Sun* (the next day still counts its hours; the first
  day keeps one that started the evening before, *23:00 Sat → 01:00*). *Repeats inside block* gets a reason
  with numbers (*6 min of video for a 24 h block: plays ≈ 240 times. Add videos to <pool>.*), or names the
  source that runs out first when a pool alternates sources.
- **M93 follow-up taken.** A weekly block cut by a dated block is projected over its air windows: the item
  running at the cut ends there, the next starts when the weekly block resumes; projected minutes follow.
  Left: when the dated block uses the same pool, the weekly block's two parts take their items before the
  dated block's (the projection goes block by block).
- **U6.** *Edit block* in an opened block jumps to its form in the Day lens (`#schedule-block-<id>`); one
  *Add block* above the week opens *Add schedule block* on today's weekday (`add=1` presets the day and
  "One weekday, every week"). One button, not one per day: `control-density.spec.ts` holds the page at 14
  controls. *Replace existing schedule blocks* asks `window.confirm` with the number of blocks; *Cancel*
  sends nothing (component test, and an e2e in `admin-smoke.spec.ts` that checks the block ids before and
  after).
- **Tests changed, not weakened.** Three assertions pinned the carry-over as a second card on the next day
  (`programming-week-minutes`, `schedule-midnight` C3/B2 and C6): they now assert the block on its start
  day only, with the next day's minutes unchanged. `source-breaker-api` read the lens's old props; it now
  checks that the week is built with the breaker and that the lens no longer picks titles itself.
- **Baselines.** The day cards say what plays from now on, so their content follows the weekday and the
  server clock: the wording baseline replaces the grid's text with `<week days>` (its wording is pinned by
  `tests/unit/program-week-view.test.ts`), and the design baseline leaves the grid out of the
  program-schedule picture (a style tag added before the height is measured): the number of cards per day, the aired
  blocks and the block running over from yesterday change the grid's height with the date and time, which
  a mask cannot absorb (first CI run: 6619 px expected, 6841 px received on mobile). Re-recorded with
  `scripts/design-baseline.sh --update`, web from its standalone build on the host with the dev stack's
  environment (images cannot be built in the cloud).
- **Review (fresh subagent).** All items met, no test weakened. Fixed: a one-source pool's repeat reason
  said "alternates between its sources"; an empty block on air counted its elapsed time as filled;
  `docs/architecture.md` still said the previews start every block from the stored position. Left: the
  dated block of the same pool (above); the 5 000-item cap stops a 24 h block of clips of a few seconds
  early; the block on air starts its next item now, not when the running item ends (order is right).
- **Not built.** The Twitch VOD cache cooldown (M94's finding) is not known to the week view; the Day lens
  still counts minutes (*1440m scheduled*) and keeps its internal words (U6's Day-lens rework is not in this
  row).

### M98 The Production Path Has A Smoke

- **What runs.** `pnpm test:broadcast-path` (`scripts/broadcast-path-smoke.sh`), a CI step after runtime
  parity, bounded at 20 minutes; about seven minutes locally. It starts the compose stack with the relay on
  and the uplink reading the HLS program feed (the `.env.production.example` values), the primary output
  pointed at an RTMP sink on a second, internal network (`outside`, `198.51.100.0/24`). The sink is ffmpeg
  listening in the worker image, not MediaMTX: MediaMTX refuses the uplink's first connection ("unable to
  parse H264 config: invalid size 1", the tee/fifo muxer's empty sequence header), and after that refusal
  the fifo's recovery never publishes again (`extract_extradata: A non-NULL packet sent after an EOF`).
  Measured with the stand-in images below (ffmpeg 6.1, 7.1 and 8.0), not with the Alpine image; Twitch
  accepts the header on the DUT.
- **U15.** Over 60 s, `program.m3u8`'s `MEDIA-SEQUENCE` and the bytes the sink wrote both grow. Mutation
  run: with `compose stop uplink` the same measurement must fail, and does (sink bytes unchanged while the
  feed still grows). Local run: `MEDIA-SEQUENCE 0 -> 22`, sink bytes `524288 -> 1835008`; mutated:
  `2020370 -> 2020370`.
- **Broken source (M75), owner's question of 2026-10-02 15:28, cases as Release answered 15:34.** Three
  items of one source on a stub answer 404, refuse the connection and hang; `playout.source-breaker.opened`
  names all three. The stub heals, the stored opening time is moved back 31 minutes (the 30-minute cooldown
  is not waited out; the playout decides half-open from that stored time alone), and the trial probe closes
  the breaker (`playout.source-breaker.closed`). Two deviations from the answer, both forced by the code:
  - the items are YouTube-shaped URLs on the stub (`/youtube.com/watch?v=…`), not direct-media URLs: a
    direct-media URL is never probed (`resolvePlayableMedia` passes it to ffmpeg as is), so it cannot feed
    the breaker. They belong to a direct-media source whose own URL does not validate, so the sync keeps
    the inserted rows;
  - a local item is pinned while the broken pool is scheduled: the playout probes a pool's next items only
    while one of its items or an operator item is on air; behind a failed pick the fallback airs and
    nothing is probed (follow-up 1).
- **Network outage (M82).** The playout is disconnected from `outside` only, so PostgreSQL stays reachable
  as on the DUT when its internet drops. For 90 s the pool is three never-probed remote items: two
  `playout.probe.network_outage` lines (`198.51.100.10:1935 unreachable (connect ETIMEDOUT)`), no breaker
  opened, zero counted probe failures. Reconnected and the Pin resumed, a remote item goes on air and the
  path grows again (`MEDIA-SEQUENCE 158 -> 188`).
- **Why a documentation range.** The outage check skips private and single-label hosts ("no public publish
  host to ask"); `198.51.100.0/24` is neither, and an `internal: true` network leaks nothing.
- **Local runs.** The stream247 images cannot be built in the cloud container (Alpine's package CDN is
  refused), so the script ran against stand-in images built from the same source tree on Ubuntu with its
  ffmpeg 6.1 (mwader's static ffmpeg links librtmp, whose handshake the sink rejects). The pull request's CI
  run is the one against the real images.
- **Review (fresh subagent).** All items met. Fixed: the probe-failure count is read right after the
  reconnect (a clean probe resets it, so read later it could hide a counted failure); the mutation run waits
  for the sink to stop writing before it measures and requires the uplink alone to be what did not grow; an
  early exit no longer deletes a developer's own root `.env`.
- **DUT checks.** None new: M82's check after a nightly blip and M75's breaker on real sources stay as they
  are.
- **Follow-ups (not changed here).**
  1. A pool whose next pick fails to resolve stays on that pick: the fallback bridges every boundary, the
     rotation does not move on, the queue is not probed, so the breaker learns one item and per-item
     quarantine none (inline resolves count for neither). Measured: a pool of three broken items picked
     the 404 item for over four minutes, breaker at one failed item.
  2. Every ffmpeg stderr chunk of the playout fires an unawaited runtime write and, for a line with
     "error", an incident upsert. A noisy input (an mp4 read without Range support: about 800 AAC error lines
     a minute) exhausted the connection pool (`timeout exceeded when trying to connect`, 578 times) and
     crashed the playout loop (`worker.loop.crashed`).
  3. The uplink's tee/fifo output sends an empty H.264 sequence header first; MediaMTX refuses it and the
     fifo never recovers (stand-in images only, see above). Matters for anyone pointing the uplink at their
     own RTMP server.

### M99 Wizard To First Programme

- **U1 (decided 5.1 Q9).** `/setup` has a step 5, *Where the stream goes*, after *Twitch accounts*: the
  built-in primary destination with *Twitch* (`rtmp://live.twitch.tv/app`, `TWITCH_INGEST_URL`) preselected,
  or *Another RTMP service* when the destination already points elsewhere, and a masked key field
  (`type="password"`, `autocomplete="new-password"`, empty after saving). It saves through
  `PUT /api/destinations`, so the key is stored encrypted as before and never comes back. The forms moved
  from `Live -> Status` to `Studio -> Output` (panel `#output-destinations`, the add form folded as
  *Add another destination* so the page keeps one primary action); Status lists each destination's state
  with a link there. The old section had no anchor of its own; `/live?tab=status#output-destinations` is
  sent on in the browser (`LegacyAnchorRedirect`, a fragment never reaches the server), and readiness's
  *Live destination* links to `Studio -> Output`.
- **U2.** Step 6, *First programme*: the enabled sources with their count of playable videos (the schedule
  preview's eligibility: ready, included, not quarantined) as picks, a pool name (*Programme*), then
  `POST /api/pools` (now answering with the pool's `id`) and `POST /api/schedule/templates` with
  `always-on-single-pool`. A week that already has blocks gets a *Replace the blocks already in the week*
  switch with M97's confirmation. Without a ready video the step says how media gets in and carries the
  library upload form. A pool is made of sources, so "chosen media" means chosen sources; single videos
  cannot be picked.
- **M105, review finding R17.** Without *Replace* the template's seven all-day blocks overlap every weekly
  block, so on a week with one every press failed after creating the pool and left one more pool named
  *Programme*. The step's writes moved to `apps/web/lib/setup-first-programme.ts`: with weekly blocks and
  *Replace* unticked it stops before writing anything and says why; a pool a failed press created is used
  again; dated blocks are no obstacle. The hint says which case applies; the guide sentence is corrected.
  Tests in `tests/unit/setup-first-programme.test.ts` run it against the real routes.
- **Completion.** Steps 5 and 6 are done exactly when readiness says so (*Live destination*; *Program pools*
  and *Weekly schedule*); *Review* is done only when all six before it are.
- **R2 U3.** `LibraryEmptyState`: an empty library says the three ways in (upload on the page, `data/media`,
  a source); a library the filters hide says how many assets it holds and offers *Clear all filters*. The
  list was not moved above curated sets and bulk edit (R2 suggested it; not in this row).
- **Tests.** `tests/unit/setup-first-programme.test.ts` renders both steps, the Output page and the library
  states and runs the wizard's three writes through the real routes against an in-memory state, ending with
  the three readiness lines ready and seven *Done* badges. `tests/e2e/setup-wizard.spec.ts` does it on a
  fresh stack (CI step *Setup wizard to first programme*: `E2E_FRESH_DESTINATION=1` leaves the key out of
  the environment, `E2E_MEDIA_FIXTURE=1` puts a 20 s video into the library). Changed, not weakened: the
  wizard tests now pass readiness and expect seven steps; the guide test names the new place of the form;
  admin-smoke adds its destination in `Studio -> Output`; the control budgets of Status and Output follow the
  move.

- **Review (fresh subagent).** All items met; the anchor redirect only nominally, since the old section had
  no anchor (above). Fixed: the e2e opened the folded add form before asserting its button; the CI step got
  a 15-minute bound; the library's empty state links through the workspace helper. Left as is: saving a key
  in the wizard enables the primary destination (the step's purpose is to go on air), a regional Twitch
  ingest shows as *Another RTMP service*, and sources that become playable after a reload are not ticked
  until the step is opened again.
- **Not in this milestone's scope, needed for its e2e:** `scripts/e2e-smoke.sh` (two switches) and the CI
  step.
- **Review 2026-10-05 (R19), fixed in M105.** The move of the destination forms to Studio → Output missed the
  incident catalogue: the action of `playout.start.failed` still sent the operator to Live → Status for
  the address and stream key. It names Studio → Output → Output destinations now, and
  `tests/unit/incident-actions.test.ts` fails on any action that sends an address or key edit to Live →
  Status. A later move of a form checks `packages/core/src/incident-actions.ts` as well.

### M100 Public Programme For Viewers

- **Projection.** `/channel` reads `programme` from the public snapshot (`apps/web/lib/public-programme.ts`):
  `buildMaterializedProgrammingWeek` (M97's projection, the worker's rotation) with every item listed
  (`maxListedItemsPerBlock`; items now carry `startSecond`/`endSecond`), turned into UTC instants. Items are
  placed by elapsed seconds from their block's first air window, block windows by wall clock. One zone lookup
  per block: per item it took 1.25 s for a week of 2-minute clips, now about 5 ms (plus 10-25 ms projection);
  tabs asking within five seconds of an unchanged playout and schedule share one result.
- **Now.** The item on air when the playout runs an asset: start from `processStartedAt`, end from the asset's
  length; a start older than the item could be (a stale runtime) or the playout down falls back to the block
  on air. The block on air continues after the item on air: the projection starts its next item now, so its
  items are moved to the current item's end. Progress and *12:34 left* tick every second in the browser.
- **V2.** With the playout not on air the card is headed *Scheduled now*.
- **Next 24 h.** Consecutive items of one block are one card (its next item, *N more videos* in a fold, at
  most 25 listed, the count exact); one list across midnight; a block without playable items is listed by its
  window. The operator's queue (Play now, inserts) is not in the list, only in *Now* once it airs.
- **Week.** Each block's air windows for seven days, grouped by the viewer's day (*Today*, *Tomorrow*,
  *Sat 10 Oct*), dated blocks marked *Special*. Weekday and month names come from the catalogue, so server
  render and hydrated page agree.
- **Zones (R2 Q7).** Server render and first paint in the channel zone; once hydrated the browser's zone, with
  *… channel time* beside each time and both zones in the note when the clocks differ.
- **`/channel.ics`.** RFC 5545, one event per air window, UTC, folded at 75 octets; parsed back with
  `ical.js` (new dev dependency) in `tests/unit/public-programme.test.ts`. Linked from the page in a new tab.
- **V7.** `overlayNextTimeLabel(block, locale, startsInMinutes)` adds *· in N min* under an hour and *· in N h*
  under a day (`getScheduleStartsInMinutes`); worker and studio preview pass it. The widest German heading
  fits the next card (`viewer-language-fit.test.ts`).
- **Tests changed, not weakened.** `viewer-language-public-page.test.ts` pinned the three block cards; it now
  pins the Now card, the groups and the week in both languages with the same states (scheduled, empty,
  translated standby title, no playout message, language switch). The literal guard's mutations moved to the
  new fields and gained one. Control density on `/channel` 1 → 2 (the calendar link). Design baseline: the
  two lists are hidden and the Now card's content masked (clock data, as M97's grid); wording baseline
  replaces the lists with placeholders. Re-recorded for `channel` only, against a stand-in web image built from
  the host's standalone build (the Alpine image cannot be built in the cloud); in that image the studio
  preview has no fonts, so `studio-scene` and the two drag specs fail there and were not touched.
- **Review (fresh subagent).** All items met. Fixed: `;` in calendar text was not escaped (`"\;"` is `";"` in
  JS; a raw-line assertion now pins it); the item on air moved the items of every window of its block, so after
  a dated block the weekly block resumed late (only the window on now moves now, test); a block whose items
  all fell behind a long item on air was listed as one without material (test); items starting after their
  block's end on a clock-change night are dropped; the cache key includes the source breakers; "in N h" counts
  whole hours (1430 min is "in 23 h", not "in 24 h"). V1's "After that" card and its test left with the page
  it described: the *Up next* list replaces it and lists blocks without material the same way; V1's case is pinned again
  in `tests/unit/ops-state.test.ts` ("V1 since M100"): a channel scheduled around the clock with nothing ready
  lists its next blocks, the block on air only in *Now*.
- **Left.** `laterScheduleItems` stays in the snapshot (its tests stay) but the page no longer reads it; a
  daily 24 h block gives one *Up next* card per day (each day is its own block); when the item on air
  outlasts its block, the next block's items are still listed from the block's start; local files have
  no cover image (2.5a, follow-up).
- **Review 2026-10-05 (R24), fixed in M105.** *Up next* listed a pool's own inserts (an ident every N
  items) as programme videos, counted them in "N more videos" and could make one a card's headline. They
  are left out of the list and the count and keep their time, so the video after one starts when it ends
  (`apps/web/lib/public-programme.ts`; test with the review's probe pool). The *Now* card still names an
  insert while it airs.

### M101 Schedule Across DST, Wall Clock Kept

- **Rule (owner decision R3 Q4).** Blocks keep their wall-clock times; a block in 02:00-03:00 is skipped in
  March and airs twice in October. `docs/operations.md`, "The clock change", states it. Only counts change.
- **Mapping.** `toUtcIsoForLocalDateTime` (and `getScheduleInstant`) tries the offsets a day before and a day
  after the time. A time in the gap maps forward with the earlier offset (02:30 on 2026-03-29 → `01:30Z`;
  before: `00:30Z`, the old three-step search oscillated). A time shown twice maps to its first occurrence by
  default (02:30 on 2026-10-25 → `00:30Z`; before: `01:30Z`), `ambiguous: "later"` to the second. The first
  is where a block starting there begins to air; the second is where one ending there stops.
- **Cuepoints.** `getScheduleRunElapsedSeconds` counts real seconds from the run's start instant (a
  carry-over from the evening before included); worker (`apps/worker/src/cuepoints.ts`) and the live summary
  (`apps/web/lib/server/state.ts`) use it. With the occurrence's date and the zone, the worker's air windows of
  a block cut by a dated one are real seconds too. Without a date both fall back to the wall-clock count.
- **Twitch.** A segment lasts from its start instant to its end instant (`getScheduleEndInstant`: an end inside
  the repeated hour is its second occurrence, an end at exactly 02:00 the first; review finding):
  Sunday 01:00-04:00 is 120 min in March, 240 in October; 02:00-03:00 is 0 min (skipped, counted in
  `skippedCount`) in March and 120 in October. `/channel` and `/channel.ics` read window ends the same way.
- **Tests.** `tests/unit/schedule-dst.test.ts` (mapping, cuepoints incl. the acceptance's 5 400 s, Twitch),
  one case in `tests/unit/public-programme.test.ts`.
- **Left.** A block starting inside the skipped hour starts airing at the switch (03:00 CEST: the wall clock is
  past its start), while its Twitch segment and its cuepoint count start at the forward-mapped time (02:30 →
  03:30, so its cuepoints fire up to 30 minutes late that night), as the acceptance asks; a block that ends inside the skipped hour is posted that much too long (02:00-02:30 gets a
  30-minute segment although it never airs). The week
  view and the day lens keep wall-clock lengths; the live summary's cuepoint count does not apply a dated
  block's air windows (the worker does, since M93).
- **M105, review finding R8.** A block ending in the repeated hour comes back after the block that followed
  it, and the run change had emptied its fired cuepoint keys, so it fired every cuepoint again. The keys of
  the run before the change now stay with the new run's (`carryCuepointFiredKeys`; every key names its run,
  so readers take the whole list); a test in `tests/unit/schedule-dst.test.ts` walks the night minute by
  minute, three fires before and none after.

### M102 Standby Shows Standby

- **Cause (R3 W8).** The scene renderer draws the cached payload, and only `writeOnAirOverlay` (a
  programme or a Live Bridge) cached one; `writeStandbySlate` wrote only the text slate. In scene mode a
  standby or reconnect kept the previous item's lower third, its title under "Now Playing".
- **Fix.** `writeStandbySlate` builds its fields from the schedule alone (`buildStandbySlateSceneInput`,
  `apps/worker/src/standby-slate.ts`) and caches the payload for the picture. The two refresh branches
  that only rewrite the text file under a running programme (overlay off, or an asset missing from state)
  pass `{ scene: false }`. A slate is drawn as standby, reconnect or live; a queue head of `asset` or
  `insert` no longer turns it into "Now Playing" (`resolveStandbySlateQueueKind`). A programme that starts
  over a cached slate payload builds its own before the first frame (`shouldPrimeScenePayload`; a guard,
  since the cycle already writes the programme's payload before the start), and a slate that starts with
  nothing cached primes with its own payload instead of `writeOnAirOverlay`, whose fallback is the playout
  row's last title (review finding). With the overlay off the slate leaves the scene payload alone, so no
  ticker staleness incident is raised while no scene is drawn.
- **Side effect.** The slate's picture is rebuilt on every cycle, so the M80 follow-up "a language or zone
  change during a standby or reconnect slate reaches the picture only with the next programme" is gone
  (`docs/operations.md`, `docs/architecture.md`). A ticker edit during a slate now raises the ticker
  staleness incident like it does under a programme.
- **Baseline.** The standby frame's baseline is the texts its layout draws, in order, in
  `tests/unit/baselines/standby-frame.txt` and `standby-frame-de.txt` (vitest file snapshots, portable
  unlike pixels); the PNG is rasterised as a smoke. Update with `pnpm vitest run tests/unit/standby-slate.test.ts -u`.
- **Tests.** `tests/unit/standby-slate.test.ts`: payload (preset, label, title, never the previous item),
  priming rule, worker wiring, frame baseline.

### M103 Backoff And Health Restarts

- **H7, backoff.** `apps/worker/src/restart-backoff.ts`: the first restart of a streak is immediate (as
  before), each further one waits 15 s, 30 s, 1 min, 2 min, 4 min, then 5 min; a streak ends ten minutes
  after its last restart without a new trigger. Crash-loop protection's reset waits out the pause once a
  playable item is selected; the four uplink watchdog restarts (never encoded, discontinuity storm,
  encoder stall, destination stall) hold that output profile stopped until its pause ends, and the uplink
  reads `failed` while every profile waits. The state lives in the process's memory (no migration): a new
  process starts the sequence again, which costs at most one immediate restart.
- **Crash-loop text.** M90 had already removed "Manual intervention is required"; the message now opens
  with whether playout restarts by itself (a playable item is selected; with the UTC restart time while
  the backoff runs) or waits for a playable item, followed by the catalogue's action as before.
- **H8, self-restart (owner Q7).** `apps/worker/src/health-self-restart.ts`: after every cycle each
  process evaluates `decideHealthcheck` for its own mode (at most once a minute) and exits after five
  minutes of consecutive failures; `restart: unless-stopped` brings it back. Not counted: a playout whose programme advances
  (HLS: the feed on disk is fresh; direct mode: an ffmpeg is running, since nothing else can be
  measured), crash-loop protection, an uplink holding for backoff or without an output, the uplink's
  "Program feed is failed", and a check that cannot read the database (M86's rule owns the outage).
  Incident `<mode>.health.self-restart` (warning, event).
- **Limits.** A frozen process (SIGSTOP, a blocked event loop) cannot exit itself; a hung await is still
  the loop stall guard's. A relay healthcheck (R3's optional part of H8) was not added.
- **Tests.** `tests/unit/restart-backoff.test.ts` (sequence, streak, quiet reset, UTC wording, the
  crash-loop message with and without a playable item, wiring) and `tests/unit/health-self-restart.test.ts`
  (worker exits at five minutes and not before, streak reset, a playing playout with an advancing feed
  never exits over three hours, a stalled one exits at five minutes, holds and the feed verdict never
  count, wiring).
- **Review 2026-10-05 (R4 and R35), fixed in M105.** Two corrections of H7 for the uplink, in
  `apps/worker/src/uplink-watchdog.ts` (`UplinkWatchdog`, pure; the M103 maps in index.ts are gone).
  R4: a timestamp storm is a picture still on air, and holding it stopped turned a few seconds' reconnect
  into up to five minutes of dark air; its repeat now waits on air for its pause and restarts then only if
  the storm lasts (no hold, incident *Uplink input timeline came apart*). R35: the nightly network blip
  built the backoff up (production: an encoder-stall restart about 47 s after the uplink's I/O error, a
  destination-stall restart about 20 s later, which was attempt 2 and held 15 s), so the uplink could stay
  stopped after the network was back. The uplink now asks the M82 publish-host check while a running
  profile has a destination in error, while a profile is held, until an outage it saw is over, and before
  each dark-fault restart; a dark-fault restart while every publish host is unreachable, or after an
  outage was seen since the fault began, restarts at once and is neither counted nor held, and the end of
  such an outage ends every hold and streak (in uplink mode a destination goes back to *ready* only when
  the uplink starts it, so a reachable publish host is the first sign). Encoder-stall restarts count as
  dark faults here too: the production pattern begins with one. A hold also ends when the profile's
  output changes (destinations, address or key), the operator path the review asked for, besides a
  restart of the uplink container. A simulated 220 s blip held the uplink until 45 s after the network
  was back under M103 and holds nothing now (`tests/unit/uplink-watchdog.test.ts`). Not covered: a
  destination with no public publish host (a LAN restreamer) has nothing to ask, so its restarts count
  as before.

### M104 Wording Pass And Chat Answers

- **V5/V6 (owner 5.1 Q7).** `packages/core/src/chat-replies.ts` holds the answers and their rules; the
  catalogue has them in en + de. `!commands` lists the enabled commands under their configured names,
  `!now` and `!next` answer from what the worker's last chat cycle read (`apps/worker/src/chat-programme-info.ts`:
  the playout row's titles while a programme plays, else today's next block with its start time) and end
  with `<APP_URL>/channel`, and every `!request` gets one answer (queued with its position, no match,
  cooldown, queue full, already queued). Four switches, one per answer, in the additive migration
  `20261004_001_chat_reply_switches` (on by default; the viewer-control master switch still gates all).
  Every answer names the viewer first: Twitch drops a line identical to one sent in the last 30 s (review
  finding).
- **Cooldowns, a reading of the row (decided without the owner).** The 60 s per viewer and 10 s in the room
  apply to `!commands`, `!now` and `!next` together. Request answers are not under the room's 10 s, because
  "one reply per `!request`" would otherwise drop answers whenever two viewers request within ten seconds:
  an accepted request is always confirmed (the request cooldown, at least 30 s, and the queue cap already
  bound them), a refusal is said to a viewer once a minute. Behind everything the bridge writes at most 15
  lines in 30 s (Twitch allows 20 for a non-moderator) and drops the rest (`chat.say.dropped`); it also
  turns line breaks in a line into spaces, so a title cannot end the IRC line.
- **U13.** The two Engagement texts that named M32 say what to do, with a link to Admin → Settings →
  Twitch accounts. `tests/unit/admin-wording-pass.test.ts` scans the web app's text (JSX text and string
  literals, not comments) and the recorded wording baselines for `\bM\d{2,3}\b`; the wording baseline spec
  fails on one in any rendered page.
- **U14.** The four headline (i)s name the catalogue's default in the channel language, a stored built-in
  default shows *Viewers see: …* under its field, and the Scene summaries and Live → Control's overlay
  panel show the headlines as they air (`BroadcastSnapshot.locale` is new).
- **S19.** The Scene tab opens with a banner saying whether overlay output is on as published (and that a
  draft changes it); before a first publish it says *Not published yet* where it said `unknown` / `never`,
  in the form and on the page around it (review finding).
- **Baselines.** Re-recorded with `scripts/design-baseline.sh --update` against a stand-in web image (the
  host's standalone build on `node:22-slim` with the host's DejaVu fonts; the Alpine image cannot be built
  in the cloud). The verify run before the change failed only on the surfaces this milestone changes
  (studio-scene and studio-engagement pictures and text, live-control text), so the stand-in draws like CI.
- **Review (fresh subagent).** Items met except S19 on the page around the form; fixed. Also taken: the
  `@name` lead, the DUT check's order, a refusal formatted before its cooldown is claimed, German wording
  of two answers, a code-point cut of long lines, `\bM\d{2,3}\b`. Left: `!now` reads a recovering playout
  as a break (documented).
- **Tests.** `tests/unit/chat-answers.test.ts` (parsing and switches, each reply en + de, cooldowns,
  the runtime's effect, the programme info, send budget, sanitiser, worker wiring),
  `tests/unit/admin-wording-pass.test.ts` (U13, U14, S19 render tests), the migration in
  `tests/integration/db-roundtrip.test.ts`; `viewer-language-worker-wiring` knows the four new reply builders.
- **Review 2026-10-05 (R22, R23, R27), fixed in M105.** R22: `!now` and `!next` answered from the chat step,
  second to last in a cycle of over two minutes plus 30 s of sleep, so after an item change they named the
  previous video; they read the playout row when asked now (`readPlayoutProgrammeTitles`,
  `readChatProgrammeInfoNow`, 2 s bound, the last cycle's info as fallback). R23: refusals had no room
  limit, so about fifteen accounts typing `!request zz` filled the send budget and dropped accepted
  requests, moderator check-ins and `!game`; at most five refusals in 30 s now (`claimRefusal`), sent as
  low-priority lines that leave the budget's last five slots to the rest. R27: the answers moved out of
  index.ts into `apps/worker/src/chat-answers.ts`; `tests/unit/chat-answers.test.ts` drives them with the
  chat runtime and the bridge with a fake socket (`!now` twice gives one line, at most 15 PRIVMSG writes in
  30 s, each one IRC line, a raid of refusals leaves the other lines theirs) instead of grepping the
  worker's source. The M80 language guard knows the three new helpers.

### M106 Release 2.3.0

- 2026-10-05: the review of M84-M104 (eight groups, each finding re-checked by a skeptic; 45 findings, 35
  confirmed) and its fixes are M105, merged as #32 (`46b2c8d`). `283d31c` gave the first-run bootstrap test
  the time limit its neighbours have (5004 ms against the default 5 s under the full suite).
- 2026-10-05 23:59 UTC: `release: v2.3.0-rc.1` (`65ac201`), push CI green; tag `v2.3.0-rc.1` pushed by the
  lead from the local checkout. The release workflow published the three images and, for the first time,
  created the GitHub release itself ("Stream247 2.3.0-rc.1", pre-release; v2.1.0 stays Latest).
- 2026-10-06 00:02:37 UTC, the nightly blip: the uplink restarted once (SIGKILL) and healed. In the same
  second the lead's workstation lost an open HTTPS connection to GitHub (`connection reset by peer`), so
  the blip cuts existing connections across the home network, not only the DUT's way in. Together with
  2026-10-02 (new outbound connections from the playout container succeeded throughout) this fits a daily
  forced reconnect of the internet line (new public IP; long-lived connections such as the RTMP uplink die;
  the way in via Cloudflare returns only after the tunnel follows). Not proven: compare the public IP before
  and after the next blip. If it holds, the owner can move the reconnect to a fixed quiet hour in the router.
- 2026-10-06 00:05 UTC: `pg_dump` to `~/backups/stream247-pre-v2.3.0-rc.1.dump` (39 tables), `repin.sh
  v2.3.0-rc.1` (dry run first: the three app pins `v2.1.0` -> `v2.3.0-rc.1`, 62 env vars, `prune=False`; then
  `PUT ok: stack 148`). All six containers healthy after 19 s; relay `mediamtx:1.15.4` untouched. Programme:
  4 s of the global fallback at boot, then the Twitch archive `v2883427989` as `scheduled_match` (the item
  that ran before the repin is not resumed: M77). `jimpanse247` live.
- Checks after the repin: the seven migrations of *Upgrading To 2.3* present
  (`20261001_002_source_breakers` … `20261004_001_chat_reply_switches`), the new tables and columns present,
  `as_run_log` written from the first start (the boot fallback ended `switch`), no source breaker, no dated
  block, pool positions kept; no new critical incident (the open warnings date from the 00:02 blip).
- 2026-10-06 00:07:44 UTC: 24-h soak started from a checkout of the tag on the DUT
  (`~/stream247-v2.3.0-rc.1`: `scripts/` and `docker-compose.yml` from `git archive v2.3.0-rc.1`), `tmux`
  session `soak`, run log `~/stream247-v2.3.0-rc.1/logs/soak-20261006-000744.log`. Its baseline line has
  numbers for the first time (`web=0 worker=0 playout=0 uplink=0 relay=0`), so a container restart is seen.
  First sample `status=ok broadcastReady=true`. It ends 2026-10-07 00:07:44 UTC and includes the next blip.
- Two corrections for `docs/deployment.md` step 10 of *Safe Upgrade Flow*, found while starting it:
  - the Portainer stack does not publish `web`'s port on the host, so `CHECK_BASE_URL=http://127.0.0.1:3000`
    fails (`Failed to connect`); the soak measures `web`'s address on the stack network instead
    (`docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}' stream247-web-1`; here
    `http://172.22.0.6:3000`). It changes only when the container is recreated, which fails the soak anyway.
  - the tmux log name has minute precision, so two starts in one minute append to one file
    (`~/logs/soak-20261006-0007.log` holds the failed first start and the real one); the run log the
    script writes itself is per second and is the one to read.
- Open: the soak result; set `Admin → Settings → Channel language` to German (owner; until then the poll
  and the skip bar are English); the DUT checks under *DUT checks for the next release candidate*; then
  2.3.0 as `HANDOFF.md` describes.

### M107 The Overlay Shows The Next Video

- **Cause.** The scene payload's next card came from the next schedule block (`getNextScheduleItem`: its
  pool's first video as the title, the block's window `16:00-00:00` as the time), the Live Bridge's from the
  same; `!next` came from the playout row's next queue item. During a multi-hour archive the picture
  announced the programme at 16:00 and the chat the next video (owner, 2026-10-06).
- **The rule** (`apps/worker/src/next-on-air.ts`, one pure prediction): a pending Play now / Insert; else,
  while something plays, what the selection does when the item on air ends at its start plus its length: a
  dated block that takes the air before that cuts it (its first pick, from its start; a takeover with
  nothing to pick waits as in the worker); a Move next; the queue's next item when the item ends in its own
  block (or one with the same pool); else the pick of the block current at its end (the worker's
  `selectPoolAsset` / source pick under the skip and Remove next holds). Unknown end (no length, a Live
  Bridge, past its length): the queue's next item without a time. Nothing plays or nothing predictable:
  today's next block, as before. A candidate equal to the item on air is stepped over (a row of the cycle
  before it started). The card shows `about 17:30` / `ca. 17:30` (new keys `overlay.next.expectedAt`,
  `chat.next.around`) or the label alone; `buildOverlayScenePayload` now reads an empty time label as "no
  time" and only a missing one as `Nothing scheduled`.
- **Wiring.** `writeOnAirOverlay` predicts from the item on air (the running process's start) and, in the
  cycle, from the queue it is about to write; the cycle now also writes the overlay after it started or
  switched an item, so a new item's card does not wait 15 s for the next cycle. The slate takes the
  prediction when it names a video. `!next` reads `readPlayoutProgrammeTitles` (now with the start, the
  queue's head and next item, Move next and the pending insert) at ask time (R22 kept) and predicts with
  the last chat cycle's state; while nothing plays it names the card's block title (the pool's first video,
  where M104 named the block's own title).
- **Tests.** `tests/unit/next-on-air.test.ts` (the prediction as a table, the card and the payload, text mode
  and the drawn heading in en and de, the card and `!next` agree), `chat-answers.test.ts` (the new inputs,
  `about`), the M80 fit test (the heading with `ca. 20:00` under every label), the label and language
  guards know the new file. Golden frames unchanged: their fixtures build the payload view by hand.
- **Review fixes** (the prediction followed the schedule where the worker's operator arms decide):
  a Pin or Temporary fallback that holds the air (core `resolveOperatorOverrideHold`) names no video, the
  card shows today's next block, as `!next` did, and a Play now pending under it is not next (the arm drops
  it as preempted); a Play now / Insert on air is cut by no dated block (its arm returns first), so the
  block current at its end picks; a dated block's start or end is judged against the run the cycle recorded
  (`cuepointWindowKey`, now in `readPlayoutProgrammeTitles` with the override fields), so a takeover that
  waits for its pick does not announce a cut at the dated block's end, and one whose pick exists is next
  without a time; the next block's pool picking the video on air (a second pool on the same source) is
  named, since the worker starts it again, and a block card is never titled with the video on air; `!next`
  counts `recovering` as playing for the prediction (`isPlayingForPrediction`), as the card does, while
  `!now` keeps its wording. Deferred: the admin's scene preview (`buildActiveScenePayload`, `/api/scenes`)
  still shows the queue's next item under the next block's window; it needs the worker's picks in the web
  app (documented in `docs/operations.md`).
- **DUT check:** under *DUT checks for the next release candidate*.
