# Stream247 Plan

What to build next. The rules for every session are in `AGENTS.md`. Everything up to and including
2.2.0-rc.1 (M0-M83: milestone sections, progress notes, DUT checks, follow-up lists) is kept verbatim in
`planning/archive/plans-m0-m83.md`; `git log --follow` on that file shows its history.
2.3.0 (M84-M106 and M109, and the superseded M83 row: rows, notes and the DUT checks it ran) is in
`planning/archive/plans-m84-m109.md`.

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
| M107 The Overlay Shows The Next Video | UX | Now | Complete | The on-air "Next" card names the video that airs next, as `!next` does (owner request 2026-10-06: "the overlay shows the next programme block, what comes at 16:00, but what interests me is what !next says, the next video") (ships in 2.3.1 after 2.3.0; owner decision 2026-10-06, so the running 2.3.0-rc.1 soak is not reset) | One prediction of the item that will actually air next serves the scene payload, text mode and `!next`: the playout's next queue item while something plays, from the block that will be current when the item on air ends (the next block's pool when the item runs past the block end, a dated block's first pick when it takes over first), with its expected start time; the next block only when nothing plays or no next item is known; both languages; tests that the card and `!next` agree | core, worker, tests, docs | low | revert the merge |
| M108 Twitch Archives Get Their Whole Chapter List | Reliability | Now | Planned | A Twitch archive whose chapter probe found only its first chapter (one chapter at offset 0) is probed again until the list is stable, and chapters that arrive while the item is on air move the category to the chapter that is current, not through every past boundary at once (found on the DUT 2026-10-06: the overlay said "Just Chatting" for a VOD that had moved on to another game) | A probe-filled single chapter at offset 0 of a `twitch-channel` asset is re-probed after a cooldown, a bounded number of times, oldest probe first, inside the existing per-cycle budget; a longer list replaces it, two equal answers make it final; chapters an operator edited are never re-probed or replaced; when an asset on air gains chapters, only the boundary containing the current offset fires (one category update, one as-run/audit line); unit tests for the selection and the boundary, docs updated | worker (chapter backfill, chapter boundary), db if a marker is needed, tests, docs | low: a few more yt-dlp probes per hour | revert the merge |

Waiting for the owner: the findings outside the milestones in `planning/suggestions-2026-10-04.md`
(nobody starts one before the owner names its number), and for M86 the confirmation that only cycles
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
- Readiness says `broadcastReady=false` while only the worker is stopped, although the channel airs, so a
  soak would count a worker stop as an outage (M106).
- Step 10 of *Safe Upgrade Flow* in `docs/deployment.md` lacks the two corrections of the M106 notes: the
  Portainer stack does not publish `web`'s port on the host, so the soak measures `web`'s address on the
  stack network (it changed with the 2.3.0 repin), not `http://127.0.0.1:3000`; and the tmux log name has
  minute precision, so two starts in one minute share a file (M106).

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
| 2.3.0 | 2026-10-15 | M84-M105, M109 (release M106; M83 superseded by M106) | archive `planning/archive/plans-m84-m109.md`, sections M85-M104, M106 and M109; `CHANGELOG.md` |
| (2.2.0) | Not released: release commit `e81b6f4` never tagged, `v2.2.0-rc.1` never deployed; these milestones shipped with 2.3.0 (M106, owner decision 2026-10-05) | M64, M75, M76, M78, M79, M80, M82 | archive, sections M64, M75, M76, M78-M80, M82 and the M83 row; `CHANGELOG.md`, *2.2.0-rc.1* |
| 2.1.0 | 2026-10-02 | M68, M69, M70, M72, M73, M74 (release M71) | archive, sections M68-M74; `CHANGELOG.md` |
| 2.0.0 | 2026-09-09 | M59, M60, M61, M62, M63, M65 (release M67) | archive, sections M59-M67; `CHANGELOG.md` |
| 1.x | 2026-03-27 (1.0.0) to 2026-09-05 (1.5.47) | M0-M58 | archive, milestone tables, phase sections and *Progress Notes*; `CHANGELOG.md` |

## Milestone notes

Sections for milestones in **Open** that need more than their row, appended in milestone order.
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

### M108 Twitch Archives Get Their Whole Chapter List

- 2026-10-06, on the DUT (v2.3.0-rc.1): the overlay named "Just Chatting" for a Twitch archive that had moved on
  to another game. 41 of the 46 archives of the `twitch-channel` source held exactly one chapter at offset 0,
  filled by the chapter backfill's earlier probes; a fresh `yt-dlp --dump-single-json` returned the whole list
  for most of them. The backfill treats any stored chapters as final (`chapter-backfill.ts`, "operator edits and
  earlier fills are final"), so it never asked again.
- Owner decision 2026-10-06 ("Ja, jetzt zurücksetzen"): the 41 lists were cleared on the DUT
  (`chapters_json = '[]'`, status and probe time empty, under the state write lock; audit
  `assets.chapters.reset`). The backfill probed them again within 8 minutes (3 per worker cycle): 25 archives now
  hold a full list, 21 still one chapter (a single category, or the same incomplete answer again; M108 must tell
  these apart by asking again later). The overlay showed the right game right after.
- Seen in the same hour: when the item on air gained its chapters, every boundary between offset 0 and the
  current offset fired at once (several category changes in one cycle). Only the current one should.
- Twitch archives from `--flat-playlist` carry no publish date (`published_at` is empty), so "recent" cannot be
  read from it; use the probe count and probe time, or the VOD id order the stable comparator already uses.

