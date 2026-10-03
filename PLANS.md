# Stream247 Plan

What to build next. The rules for every session are in `AGENTS.md`. Everything up to and including
2.2.0 (M0-M83: milestone sections, progress notes, DUT checks, follow-up lists) is kept verbatim in
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
| M83 Release 2.2.0 | Release | Now | Planned | Ship M64, M75, M76, M78, M79, M80 and M82 (owner decision 2026-10-01: the version is 2.2.0, not 2.1.1 - two new tables, a new setting and a visible default change are more than a patch) | After v2.1.0 is tagged: this branch merged, `v2.2.0-rc.1` on the DUT with a PostgreSQL backup first, the channel language set to German, the DUT checks of each milestone section run, the two measurements of the nightly outage read (M82), a 24-h soak, then 2.2.0 tagged with its GitHub release and repinned; `docs/deployment.md` names the upgrade section *Upgrading To 2.2* (earlier sections of this file still say *Upgrading Past 2.1.0*); details, the DUT checks of each milestone and the soak go into `planning/archive/plans-m0-m83.md` (sections M71 and M75-M82; the release thread adds the M83 section there) | release, docs | medium | repin v2.1.0 |
| M84 One Plan And A Reference Check | Docs + Ops | Now | Complete | One short plan, one rule file, history archived, and no doc can point at a missing file | `wc -l < PLANS.md` < 300; `wc -l < AGENTS.md` ≤ 120; `test ! -e IMPLEMENT.md && test ! -e planning/next-session-prompt.md && ! ls -d release-prune-backup-*`; `git log --follow --oneline planning/archive/plans-m0-m83.md \| wc -l` > 1; the new PLANS.md lists M57, M66, M77, M81 under "Owner-gated and deferred"; `grep -c "recovery-stack\|full-product-reset-audit\|automatically continue" AGENTS.md` = 0; each of the 12 items of 3.3 is found by a keyword grep on AGENTS.md (`jimpanse247`, `mediamtx:1.15.4`, `passed with failure`, `its own milestone`, `M66`, `M77`, `force`, `pnpm validate`, `deleted or weakened`, `German`, `texts, names`, `Hard blockers`), each ≥ 1; new `tests/unit/doc-refs.test.ts` fails on a backticked repo path in `AGENTS.md`, `PLANS.md`, `README.md`, `CONTRIBUTING.md` or `docs/*.md` that does not exist (mutation: adding `` `docs/nope.md` `` to AGENTS.md turns it red) and is green on the tree (fixes `docs/architecture.md:331`) | `AGENTS.md`, `PLANS.md`, IMPLEMENT.md (deleted), `planning/**`, release-prune-backup-* (deleted), `docs/architecture.md`, `.github/pull_request_template.md`, `tests/unit/` | low; losing an open follow-up is the risk, checked by comparing the old open rows and follow-up blocks with the new plan | revert the commit |
| M85 Safe Configuration And Secrets | Reliability + Security | Now | Complete | A stream key never stays in the audit log, and a zone typo never breaks the schedule | M4: `appendAuditEvent` redacts like `upsertIncident`; a new migration id redacts existing `audit_events` rows; integration test: a synthetic `rtmp://…/live_…` key written through `appendAuditEvent` and one seeded before the migration both read back as `<redacted>`. C4: `resolveChannelTimeZone({}, {CHANNEL_TIMEZONE:"Europe/Berln"})` returns the managed zone or `UTC` and a state incident is raised; unit test. M5: the `custom_layers_json` cast is guarded; integration test boots a DB with one malformed row | `packages/db`, `apps/worker`, tests, `docs/operations.md` | low; the redaction migration is one-way (it removes secrets on purpose) | revert the commit; redacted rows stay redacted |
| M86 A Database Blip Does Not Take The Channel Off Air | Reliability | Now | Complete | A Postgres restart or short outage leaves ffmpeg and the uplink running; web recovers by itself | H2: the failed-cycle branch is guarded; a process exits only after 5 min of consecutive failed cycles (owner Q2); pool `connectionTimeoutMillis` set. Unit test of a pure counter (below 5 min no exit, at 5 min exit). H3: a rejected `__stream247DbReady` is cleared; retry on `40P01`/`55P03`; migrations run with `SET LOCAL lock_timeout`; integration test: `ensureDatabase` fails with Postgres down, succeeds after Postgres starts, no reset helper called. R3's S1 probe (appendix of `planning/research/robustness.md`) becomes an integration test: Postgres stopped for 45 s, the worker process in all three modes is still running afterwards. DUT check (owner): `docker compose stop postgres; sleep 45; docker compose start postgres` during air, playout and uplink `StartedAt` unchanged | `apps/worker`, `packages/db`, `apps/web/lib/server`, tests, `docs/operations.md` | medium: a half-dead process for at most 5 min | revert the commit |
| M87 An External Failure Costs One Step, Not The Cycle | Reliability | Now | Complete | A refused Twitch token or a hanging call never stops heartbeat, sweep, live status or chat | H1: each integration step of the worker cycle is isolated; a refresh throw writes `twitch.refresh.failed`; HTTP 400 `invalid_grant` sets the identity status `error` with a state incident "reconnect Twitch" (owner Q3). H6: yt-dlp calls get `timeoutMs`, the six worker `fetch` calls `AbortSignal.timeout`. Tests: refresh throws → heartbeat written, sweep ran, no `worker.loop.crashed`; `invalid_grant` → status `error`; a fetch stub that never answers is aborted within its timeout. R3's S2 probe becomes an integration test: with the token endpoint stubbed to HTTP 400, `healthcheck worker` exits 0 after two cycles | `apps/worker`, `packages/core`, tests, `docs/operations.md` | low | revert the commit |
| M88 Schedule Maths Across Midnight | Bug | Now | Complete | A block past midnight behaves like one block everywhere | C1: fired cuepoints keyed by block and start date; test: Sat 23:00+120 with cuepoints at 900 s and 2700 s, at 00:05 `getCuepointInsertPlan` returns null. C2/B1: no carry-over segments in the Twitch plan, extracted as pure `planTwitchScheduleSegments`, each created segment recorded before the next request; test: Monday 23:00+120 over 7 days gives 1 segment, no `:carry` key. C3/B2: overlap on a 7-day minute line; test: Mon 23:00+120 vs Mon 00:00+30 → `[]`, vs Tue 00:00+30 → both ids (the probe in 1.1 shows today's opposite); `tests/unit/schedule-template-conflicts.test.ts:62-68` pins today's wrong model (both blocks on weekday 1); its fixture moves to weekday 1 + 2, it still asserts the conflict and gains the false-positive case, so it is strengthened, not weakened (the owner is told in the report). B3: keep-rule uses the effective start; test with horizon 60 at Tue 00:30 returns the pool. C6: day totals count only the part inside the day; test: 120 + 120 = 240 over two days becomes 60 + 60. Owner decision 2026-10-02 11:35 UTC: R1's three corrections reach main only with M88 and stay on `claude/r1-scheduling-competitors-v5o5zi` until then; M88 takes them over from that branch at `97f4037`: the bare "GMT" zone name (`d789981`), the week lens counting a midnight block once with its fill pill inside the card (`7891a85`, covers C6), `/channel` "After that" from the schedule (`a41d327`, `51e69ee`, covers V1, which then leaves M100) and their re-recorded baselines (`81f0eb6`); their tests pass unchanged in M88 | `packages/core`, `apps/worker`, tests, `docs/operations.md` | low; hidden overlaps in saved schedules show up in the editor, saved schedules stay loadable (test) | revert the commit |
| M89 Operator Actions Are Never Lost | Behavior | Now | Complete | Restart, Hard reload, Recover outputs, Refresh and Remove next do what the operator pressed | H4: pure `decideCycleEndRestartFlag` (same value → clear, newer → keep, reconnect window → keep) and the same for `pendingAction` and `insertAssetId`; table test. W2: a separate Remove-next hold that Skip and passed votes do not overwrite (owner Q5); test: B on air, C removed, passed vote on B → next is D. R3's W2 and W4 probes become tests. DUT check (owner): a Restart pressed during a cycle restarts, in direct and relay mode, as the M76 combination review in `planning/archive/plans-m0-m83.md` asks | `apps/worker`, `apps/web`, `packages/db` (additive column), tests, `docs/operations.md` | medium: direct-mode reconnect reuses the field | revert the commit; the additive column stays unused |
| M90 The 3 A.M. Answer | UX + Reliability | Next | Complete | A tired operator sees what is wrong and what to press, first | U7: a stale or missing worker or playout heartbeat is the first "Open problems" entry with its age in words and the restart command; unit test. U8: the status sentence follows the heartbeats; `grep -rn "are now active" apps/web` → no output. U10: incident messages store no relative time (test on the writer); engine fields behind "Details" (`grep -rn "ready not ready" apps/web` → no output). U11: all three interrupting actions of "If something is stuck" confirm, Soft restart, Force reconnect and Hard reload (`apps/web/components/playout-action-form.tsx:97,105,128`; in direct mode Force reconnect drops the uplink); component test per button. Every critical incident fingerprint maps to one operator action in a catalogue (`IncidentRecord` has no such field today, `packages/db/src/index.ts:399-412`); a unit test collects all `fingerprint:` literals in `apps/worker/src` and fails on a critical one without an action; the crash-loop text no longer says only "Manual intervention is required" (`apps/worker/src/index.ts:7486`). U12: render test: without a connected bot account the Live chip reads "Not connected to Twitch", never "Checking". audit U3/U30: one heartbeat constant and one effective-heartbeat function used by state, readiness and worker; test that a 50 s old heartbeat gives the same verdict everywhere. U9 (default R2 Q4 in 5.2): Playwright at 390 px, "Open problems" above y = 1 400 | `apps/web`, `apps/worker`, `packages/core`, tests, baselines, `docs/ui.md` | low | revert the commit |
| M91 Honest First Run | UX + Data | Next | Complete | A fresh install starts empty, readiness counts only what can air, and plain HTTP is explained | I1 (decided 5.1 Q5): an empty DB bootstraps with no pool, no schedule block and no URL-less source (unit test on `createInitialSeedState`); existing installs keep their rows (integration test); readiness: a pool is ready only when a block uses it and it has a ready asset, the schedule only when the coming week has no unplayable block (`tests/unit/onboarding*.test.ts`). I2 (decided 5.1 Q6): over `http:` on a host other than `localhost`/`127.0.0.1`, `/setup` and `/login` show the two ways out; render test. I6: component test: the URL field is prefilled with the request origin and the zone field with the browser zone. I7: render test of the password warning under the field plus, per decided 5.1 Q8, a change-password form under Admin → Settings → Security that requires the current password (API test: wrong current password refused, right one changes it) and a one-line container command for a reset documented in `docs/operations.md` (integration test: the reset entry point run against a test database sets a new password and sign-in with it succeeds); no e-mail reset. I8: render test: the login hint has no line clamp and, without Twitch app credentials, contains "Twitch app credentials" and the link to `/setup` step 3 | `packages/db` seed, `apps/web`, tests, baselines, `docs/getting-started.md` | low: only `isDatabaseEmpty` installs change | revert the commit |
| M92 Getting Started A Stranger Can Follow | Docs + Ops | Next | Complete | The guide leads a stranger from an empty host to air without a gap | I4: `docs/getting-started.md` gets "Get the files" (clone a release tag, or download `docker-compose.yml` and `docker/mediamtx.yml`), the link `https://dev.twitch.tv/console/apps` (also in wizard step 3) and a numbered stream-key step; `grep -c "dev.twitch.tv/console" docs/getting-started.md` ≥ 1. I3: unit test that the four compose image defaults equal the newest non-rc `## X.Y.Z` heading in `CHANGELOG.md`, so a release commit that forgets them fails. I5: the same one-or-two-accounts sentence in wizard and guide (decided 5.1 Q9). `pnpm test:fresh-compose` green | `docs/`, `apps/web/app/setup`, `tests/unit/`, `README.md` | low | revert the commit |
| M93 Dated And One-Off Schedule Blocks | Feature | Next | Planned | "The next 10 days at 20:00 this playlist" and "once on 10 Oct" can be saved on a 24/7 grid, and air, previews, `/channel` and Twitch agree | R1 row A (decided 5.1 Q1, Q2): `valid_from`/`valid_until` in baseline, ALTER, migration, manifest, mapper, writers and blueprints; filter in `buildScheduleOccurrences`; dated layer ranks first in `findCurrentScheduleOccurrence`; `applyScheduleLayers` with `airWindows`; conflicts per layer; ended rows listed as ended; form field *Runs*; "Single day" renamed to "One weekday, every week". Tests: a 10-day run has day 10 and not day 11; a once-block airs once; a carry-over past `valid_until` still ends; weekly 18-22 + dated 20-21 gives three windows with one key; a cuepoint is not re-fired; the 24/7 grid + dated 20:00 block saves (today `["grid","special"]`); schema-manifest and DB round-trip tests | `packages/core`, `packages/db`, `apps/web`, `apps/worker`, tests, baselines, `docs/` | medium: touches the one function every schedule consumer uses; additive columns | revert the commit; old images ignore the columns |
| M94 Inserts From Remote Sources Air | Bug | Next | Planned | A YouTube or Twitch insert airs, or is skipped once with an incident, never retried forever | W1: the due insert is warmed in the queue scan; a failed or bridged insert counts as consumed and raises an incident naming it (owner Q6); both insert checks apply quarantine and breaker. W5: one shared "cuepoint asset of a block" helper used by worker and preview; test: `insertEveryItems: 0` with a pool insert asset gives the same cuepoint count in both. W6: an item that failed to open is retried once; `failed` treated like an empty current item in the Move next and insert checks. R3's W1 probe becomes a test | `apps/worker`, `packages/core`, tests | low–medium: crash-loop interplay | revert the commit |
| M95 Self-Healing Fills The Gaps | Reliability | Next | Planned | No stale incident, no orphan encoder, no permanently lost item | H5: disk and system-volume flags re-armed from open incidents on the first cycle; `secrets.key-mismatch` resolved at a boot where every secret decrypts; tests. W7: the playout exit handler returns when the exiting child is not current (static test as R3's); the uplink handler checked for the same pattern. H9: one re-probe per quarantined item per 24 h, one per source per cycle, only with the breaker closed and no outage verdict (owner Q1); test. U18: `scripts/soak-monitor.sh` counts uplink and relay restarts; shell test or `bash -n` plus a fixture run | `apps/worker`, `scripts/`, tests, `docs/operations.md` | low | revert the commit |
| M96 Local File Durations | Data | Next | Planned | Local-library assets carry their real length, so planning numbers are right | U4: `ffprobe` duration at scan time, bounded timeout, cached by size + mtime; unit test on a generated 2-minute file → `durationSeconds` within 1 s of 120; an unchanged file is not probed again (spy); Day lens shows "Unique library: 6m" for three such files | `apps/worker`, `packages/db`, tests | medium: a large first scan is slower, so probing is incremental | revert the commit; stored durations are harmless to old images |
| M97 Week View Tells The Truth | UX | Next | Planned | The week view shows what will play, with dates, overnight blocks once, and why a block repeats | U5: each pool's rotation carried across blocks in time order through the worker's rotation function (shared, not copied); dates on day headers; hours, not minutes; an overnight block shown once with "→ 01:00 Sun"; repeat reason with numbers. U6: confirmation before "Replace existing schedule blocks"; "Edit block" and "Add block" on the week view. Tests in `program-week-projection`: three items, two blocks, the second block starts with item 2, not item 1; a 24 h block reads "24 h"; a block with 6 min of video in 24 h carries the reason "plays ≈ 240 times"; an overnight block appears on one day only. e2e: "Replace existing schedule blocks" opens a confirmation and Cancel leaves the blocks unchanged | `packages/core`, `apps/web`, tests, baselines | medium: preview must not drift from the worker, so one shared function | revert the commit |
| M98 The Production Path Has A Smoke | Test | Next | Planned | CI exercises playout → HLS → uplink with the relay on | U15: a CI job starts the stack with the relay on and asserts that `program.m3u8` MEDIA-SEQUENCE grows and the uplink output grows over 60 s; the job fails when the uplink is stopped (mutation run) | `.github/workflows/ci.yml`, `scripts/`, `docker-compose*.yml` | low (CI only) | revert the commit |
| M99 Wizard To First Programme | UX | Later | Planned | `/setup` ends with a stream key and a playing week | U1 (decided 5.1 Q9): skippable step "Where the stream goes" with the Twitch preset, the key stored encrypted and masked; the destination form moves to Studio → Output, the old anchor redirects. U2: skippable step "First programme" creates a pool from chosen media and applies the "Always-on single pool" template. R2 U3: render test: an empty library says how to add media, a filtered-empty library says the filters hide everything. e2e: a fresh owner completes both steps and readiness shows destination, pools and schedule ready | `apps/web`, tests, baselines, `docs/getting-started.md` | medium: moves a form operators know | revert the commit |
| M100 Public Programme For Viewers | Feature | Later | Planned | Viewers see what comes next and the coming week, in their own time | V1 ("After that" from the schedule) comes with M88 through R1's commits `a41d327` and `51e69ee` and is not built again here. V2: "Scheduled now" when playout is down. R1 row B: a 7-day list on `/channel` per day, dated items marked; `/channel.ics` validated by a parser test; times per default R2 Q7 in 5.2 (viewer's zone first; unit test with a browser zone other than the channel zone). Layout per 2.5a: a *Now* card with progress bar and remaining time (unit test on the remaining-time and progress values for a fixed clock), a *Next* list of the next 24 h at item level from the shared week projection, consecutive items of one block grouped with "N more" (test: 3 blocks × 5 items give 3 groups with "4 more" each), crossing midnight without a break (test); Playwright at 390 px: the *Now* card is above the fold. R2 V7: the on-air Next card adds "in N min" to its bare time range (`packages/core/src/viewer-messages/en.ts:29`) through the catalogue, en + de, unit test for a fixed clock. Catalogue parity en/de green | `apps/web`, `packages/core`, tests, baselines, `docs/` | low | revert the commit |
| M101 Schedule Across DST, Wall Clock Kept | Bug | Later | Planned | Twice a year the counts are right while blocks keep their wall-clock times (owner Q4) | C5: cuepoint elapsed time from real instants (test: block from 01:00, at 03:30 local on 2027-03-28 reports 5 400 s, not 9 000 s); a non-existent local time maps forward (02:30 on 2026-03-29 → `01:30Z`, not `00:30Z`); the Twitch segment end follows real minutes; `docs/operations.md` states the wall-clock rule (skipped in March, twice in October) | `packages/core`, `apps/worker`, tests, docs | low | revert the commit |
| M102 Standby Shows Standby | Bug | Later | Planned | The standby or reconnect slate never shows the previous item's title | W8: `writeStandbySlate` sets the standby scene payload; unit test on the payload; a design-baseline check of the standby frame | `apps/worker`, tests, baselines | medium: changes the on-air picture | revert the commit |
| M103 Backoff And Health Restarts | Reliability | Later | Planned | Repeated restarts slow down; a hung worker or uplink restarts itself | H7: growing backoff up to 5 min for the crash-loop reset and the uplink watchdog; the crash-loop incident no longer says "Manual intervention is required" when playable media exists (unit test on the message). H8 (owner Q7): worker and uplink exit after 5 min of failing their own healthcheck; playout only while its feed does not advance. Tests: backoff sequence; a playing playout with an advancing feed never exits | `apps/worker`, `docker-compose.yml`, tests, docs | medium: dark time grows with backoff; a wrong rule could restart a playing channel | revert the commit |
| M104 Wording Pass And Chat Answers | UX | Later | Planned | Admin text names no milestone ids; viewers can ask the bot | U13: render test fails on `\bM\d{2}\b` in admin text. U14: the admin preview and (i) show the localized standby text. S19 (lead from the stopped planning branch, re-checked): overlay output is one checkbox among many (`apps/web/components/overlay-settings-form.tsx:890`) and the Scene tab shows "unknown" / "never" before a first publish; Scene gets an on/off banner at the top and "Not published yet"; render test. V5/V6 (decided 5.1 Q7): `!commands` (only enabled commands), `!now`, `!next` with the `/channel` link, one reply per `!request` (queued with position, no match, cooldown, queue full), each with its own switch, 60 s per viewer and 10 s global cooldown, en + de; unit tests per reply | `apps/web`, `apps/worker`, `packages/core`, tests, baselines | medium: chat volume and Twitch rate limits | revert the commit |

M84-M104 were approved by the owner on 2026-10-02 (all 21, as written). Their source is `planning/proposal-2026-10.md`: references in these rows such as "decided 5.1 Q5", "2.5a", "3.3" and finding ids (S1, C3, I1, U7, …) point into that file and the research files under `planning/research/`. Order: M84 first, then the table order with M88 before M93, M93 before M100 and M91 before M99; one milestone per thread, the next starts after the previous one is merged.

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
  first items (M73).
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
- A language or zone change during a standby or reconnect slate reaches the picture only with the next
  programme (M80). Related to M102.
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
  and the entry is gone within a minute of the restart. Then press *Soft restart* once and answer
  *Cancel*: no `playout.restart.requested` audit row may appear.

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

- (The checks for 2.2.0 are in the archive, sections M75-M82.)

## Shipped

| Release | Date | Milestones | Where |
| --- | --- | --- | --- |
| 2.2.0 | 2026-10-02 (release commit `e81b6f4`; tag pending, M83) | M64, M75, M76, M78, M79, M80, M82 | archive, sections M64, M75, M76, M78-M80, M82 and the M83 row; `CHANGELOG.md` |
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
  duplicate, edit and a template laid over the week), so an overlap that was already saved and is now
  revealed is marked in the editor without locking every other edit. An edit of one of the two blocks (even a
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
  page's "Needs attention" panel, which computed the same list inline.
- **I2.** `InsecureHttpNotice` on `/setup` and `/login`: in production, over `http:` on a host other than
  `localhost`, `127.0.0.1` or `::1`, one notice with the two ways out (HTTPS via the `proxy` profile or
  one's own, or an SSH tunnel to `localhost:3000`). The server renders it from the request's forwarded
  protocol and host; after hydration the browser's own address decides. Cookies stay `Secure` (decided
  5.1 Q6).
- **I6.** The instance step prefills the public URL with the request origin and the zone with the
  browser's (`useSyncExternalStore`, so the server's zone never shows), each with "check it" in its hint,
  while nothing is saved and the environment does not pin it. The step summary names the language too.
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
