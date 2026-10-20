# Stream247 Plan: 2.3.1 (M107, M108 and M110)

Archived on 2026-10-20, when v2.3.1 shipped (release M110). This file holds what `PLANS.md` kept for
2.3.1, text unchanged: the rows of M107, M108 and M110 from its **Open** table, the two M108 entries of
*DUT checks for the next release candidate*, which passed on v2.3.1-rc.1, and the milestone notes of
M107, M108 and M110. The M110 notes were completed with the release and the repin before the move. The
M107 entry of the DUT checks did not run (owner decision 2026-10-20) and stayed in `PLANS.md`. 2.3.0
(M84-M106 and M109) is in `planning/archive/plans-m84-m109.md`, everything up to and including
2.2.0-rc.1 (M0-M83) in `planning/archive/plans-m0-m83.md`.

## Milestones

| Milestone | Type | Priority | Status | Goal | Acceptance | Touched Areas | Risk | Rollback |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| M107 The Overlay Shows The Next Video | UX | Now | Complete | The on-air "Next" card names the video that airs next, as `!next` does (owner request 2026-10-06: "the overlay shows the next programme block, what comes at 16:00, but what interests me is what !next says, the next video") (ships in 2.3.1 after 2.3.0; owner decision 2026-10-06, so the running 2.3.0-rc.1 soak is not reset) | One prediction of the item that will actually air next serves the scene payload, text mode and `!next`: the playout's next queue item while something plays, from the block that will be current when the item on air ends (the next block's pool when the item runs past the block end, a dated block's first pick when it takes over first), with its expected start time; the next block only when nothing plays or no next item is known; both languages; tests that the card and `!next` agree | core, worker, tests, docs | low | revert the merge |
| M108 Twitch Archives Get Their Whole Chapter List | Reliability | Now | Complete | A Twitch archive whose chapter probe found only its first chapter (one chapter at offset 0) is probed again until the list is stable, and chapters that arrive while the item is on air move the category to the chapter that is current, not through every past boundary at once (found on the DUT 2026-10-06: the overlay said "Just Chatting" for a VOD that had moved on to another game) | A probe-filled single chapter at offset 0 of a `twitch-channel` asset is re-probed after a cooldown, a bounded number of times, oldest probe first, inside the existing per-cycle budget; a longer list replaces it, two equal answers make it final; chapters an operator edited are never re-probed or replaced; when an asset on air gains chapters, only the boundary containing the current offset fires (one category update, one runtime log line); unit tests for the selection and the boundary, docs updated | worker (chapter backfill, chapter boundary), db if a marker is needed, tests, docs | low: a few more yt-dlp probes per hour | revert the merge |
| M110 Release 2.3.1 | Release | Now | Complete | Ship M107 and M108 as 2.3.1 (owner decisions 2026-10-06 and 2026-10-15: after 2.3.0, directly as 2.3.1-rc.1) | `v2.3.1-rc.1` deployed on the DUT and its 24-h soak passed (an outage is "passed with failure"); the M107/M108 DUT checks run; then `release: v2.3.1`, its tag and repin | release commit, docs | low: two additive migrations, an older image ignores them | reverse repin to `v2.3.0` |

## DUT checks of 2.3.1 (run)

The entries whose checks passed on the DUT, with the command of each; the results are in the M110 notes
below. The M107 entry, still open for the owner, stayed in `PLANS.md`.

- M108, before the repin: the first command lists the Twitch archives whose chapter list is marked `ok`
  although an operator saved the asset's metadata (a pre-M108 probe that finished while the operator saved
  chapters marked the operator's list `ok`, and M108 would ask it again). For each row whose chapters are the
  operator's (a probe-filled list has the same category and title in every chapter), save the list once more
  under the asset's *Chapters* panel. Passes when every listed row is either probe-filled or re-saved.
- M108, after the repin: both migrations ran (the second command prints `2`), and every Twitch archive's
  probe-filled list is asked once more. Run the third command right after the repin and again three hours
  later: then no provisional row (any `chapters` at `level` 0, `chapters` = 1 at `level` 1 or 2, `capped`
  false) has its `oldest` probe more than two and a half hours old (UTC; a VOD still being recorded stays at
  0 with recent probes), and an archive that spans several games has its whole list (the overlay names the
  game the archive is in). A `capped` row is one whose source kept failing or answering empty or shorter;
  expect none in the first hours (six counted rechecks take ten hours at least: a list stored before M108
  gets its first right after the repin, the other five two hours apart). When a list arrives for the item
  on air, or replaces what its chapter on air says, the last command shows one `playout.chapter.boundary`
  line for that asset at that moment, not one per past chapter; each line shows time, asset and offset.

  ```sh
  ssh dut 'docker exec -i stream247-postgres-1 psql -U stream247 -d stream247' <<'SQL'
  SELECT a.id, a.chapters_json FROM assets a JOIN sources s ON s.id = a.source_id
   WHERE s.connector_kind = 'twitch-channel' AND a.chapters_probe_status = 'ok' AND a.chapters_json <> '[]'
     AND EXISTS (SELECT 1 FROM audit_events e WHERE e.type = 'asset.metadata.updated'
                 AND e.message = 'Updated asset metadata for ' || a.id || '.');
  SQL
  ssh dut 'docker exec -i stream247-postgres-1 psql -U stream247 -d stream247 -At' <<'SQL'
  SELECT COUNT(*) FROM schema_migrations
   WHERE id IN ('20261006_001_asset_chapter_probe_settle_level', '20261006_002_asset_chapter_probe_rechecks');
  SQL
  ssh dut 'docker exec -i stream247-postgres-1 psql -U stream247 -d stream247' <<'SQL'
  SELECT a.chapters_probe_settle_level AS level, jsonb_array_length(a.chapters_json::jsonb) AS chapters,
         a.chapters_probe_rechecks >= 6 AS capped, COUNT(*), MIN(a.chapters_probed_at) AS oldest
    FROM assets a JOIN sources s ON s.id = a.source_id
   WHERE s.connector_kind = 'twitch-channel' AND a.chapters_probe_status = 'ok'
   GROUP BY 1, 2, 3 ORDER BY 1, 2, 3;
  SQL
  ssh dut 'docker logs --since 6h stream247-playout-1 2>&1 | grep playout.chapter.boundary | grep -oE "\"(ts|assetId|offsetSeconds)\":(\"[^\"]*\"|[0-9]+)" | paste - - -'
  ```

## Milestone notes

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
- Evidence for the rule (2026-10-06): yt-dlp's Twitch extractor (`_extract_chapters`) yields one chapter
  named after the VOD's current game when Twitch returns no "moments", and yt-dlp gives it offset 0 and the
  VOD's length as its end; the three DUT archives checked returned exactly that with `is_live` false,
  `was_live` true. yt-dlp 2026.08.19 (`_extract_info_gql`, read in a local copy of that version) sets
  `is_live` true for an archive whose preview is Twitch's `404_processing` picture, only for broadcast type
  ARCHIVE (the highlight false positive of yt-dlp issue 14455).
- Built: a probe-filled list (status `ok`) of a source whose chapter titles name the category
  (`twitch-channel`) is provisional while it is one chapter at offset 0 below the settled level, or while no
  answer taken after the recording ended backs it (level 0, any shape, an empty list included). It is probed
  again `CHAPTER_BACKFILL_PROVISIONAL_RECHECK_SECONDS` after its last probe (default 7200, `0` off, parsed
  like `CHAPTER_BACKFILL_EMPTY_RECHECK_SECONDS`), in one recheck bucket with the empty rechecks behind
  never-probed assets and failure retries, oldest probe first, inside the unchanged per-cycle budget.
- Built: a new additive column `assets.chapters_probe_settle_level` (migration
  `20261006_001_asset_chapter_probe_settle_level`, default 0, downgrade note in `docs/deployment.md`,
  *Upgrading To 2.3.1*) counts the answers taken after the recording ended that produced, replaced or
  repeated the stored list: 0 = none yet, 1-2 = that many, 3 = final. A finished answer that repeats a list a
  finished answer produced makes it final; the third finished answer that produces or replaces it does too,
  so a single-game archive probed after its stream ended costs one recheck and a list whose answers keep
  changing at most two. An empty or shorter answer and a failed probe keep the list and its level: they say
  nothing about the list, and counting them let a throttled hour make a partial list final (review of
  2026-10-06). Such a list is asked again every interval until an answer confirms or replaces it, six
  counted rechecks at most (next bullet). An empty answer while recording stays at 0 and is asked again
  on the provisional interval, not after the week. yt-dlp's `is_live` counts only within 48 hours of the
  asset's `created_at` (`isRecordingAnswerPossible`; Twitch's longest broadcast, and an archive is listed
  only once its broadcast started), so a preview picture that never changes cannot keep a list at 0.
  A column, not a new status value: an older image maps an unknown status to `""`, which reads as an
  operator edit; it ignores the column. Existing rows read 0, not 1 (review of 2026-10-06): nobody noted
  whether they were probed while their VOD was recording, and the lead's re-probe of the 41 cleared lists
  ran while the channel may have been live, so each Twitch list is asked once more (a single chapter twice):
  some 70 probes on the DUT, behind new items.
- Built after the gate (2026-10-06): the acceptance asks for "a bounded number of times", but an empty or
  shorter answer and a failed probe keep the list and its level (a failed recheck keeps `ok`), so a
  provisional list whose rechecks never answered properly was asked every interval forever: a broken
  yt-dlp extractor or a deleted VOD would have cost a call per provisional archive every two hours, from the
  address the archives are also played from. A second additive column `assets.chapters_probe_rechecks`
  (migration `20261006_002_asset_chapter_probe_rechecks`, default 0) counts the rechecks of a stored
  non-empty probe list that came back finished (same, replacing, empty, shorter) or failed, except answers
  yt-dlp marks as recording and failures while a recording answer is still possible
  (`isRecordingAnswerPossible`), which the 48-hour window bounds already. At `CHAPTER_PROBE_RECHECK_CAP` = 6
  the list is settled whatever its level (`isProvisionalProbedChapterList`), the stored list kept. Six: the
  longest chain that settles a list is three finished answers (three replacements reach level 3; the
  confirmations get there sooner), and as many again leaves room for answers that say nothing. The count is
  raised in the same compare-and-swap as the level, carried by every whole-state write, upsert and hydrate
  like the level, and starts anew when a probe fills an empty list (an operator who deletes every chapter
  hands the archive back with a fresh count); the first probe and the weekly empty-answer recheck are not
  counted. A migration of its own rather than a second statement in `20261006_001`: that one never shipped,
  but a migration id that ran anywhere (a dev stack, a test database) never runs again.
- Correction to the row (gate of 2026-10-06): the acceptance said "one as-run/audit line"; chapter
  boundaries have no as-run or audit row, only the runtime log line `playout.chapter.boundary`, so the row
  now says one runtime log line. The behaviour is unchanged.
- Built: the write decides inside `withSerializedStateWrite` against the row as it is then
  (`decideAssetChapterProbeWrite` in `packages/db`): the backfill passes the list and status the candidate
  was selected with, and a row that differs (an operator edit resets the status to `""`; an ingest fill
  changes the list) is left untouched, also on a first probe. A longer answer replaces the stored list, an
  answer of the same length that differs replaces it too (the newer word; a recording VOD's game moves on),
  the same answer keeps it, an empty or shorter answer and a failed probe never wipe it; a failed recheck
  keeps the list, its level and `ok`, moves the probe time and counts towards `CHAPTER_PROBE_RECHECK_CAP`
  unless a recording answer is still possible. `chooseStoredAssetChaptersJson`'s only-fill-empty rule is
  unchanged for every other caller (source syncs, writes without a selection snapshot). A list an operator
  saved while a pre-M108 probe ran carries `ok` (the old write marked it so); the DUT check before the repin
  finds those.
- Built: `getDueAssetChapterBoundaries` returns at most the chapter that contains the elapsed offset and
  marks every crossed boundary fired, so chapters arriving mid-item, a worker restart mid-item and two
  boundaries within one cycle log one `playout.chapter.boundary`; one crossing per cycle is unchanged. The
  fired set is keyed on a chapter's offset, category and title (`buildAssetChapterKey`), so a recheck that
  changes what the chapter on air says (the stand-in at 0 replaced in the first hour) logs it once. The
  runtime log is the event's only consumer (no as-run row, no audit row, no other reader in the
  repository); the Twitch category and title follow the current chapter by elapsed time and did not burst.
- Tests: `tests/unit/chapter-backfill-provisional.test.ts` (selection table, empty answers while recording,
  lists from before M108, payload parser, setting), `tests/unit/chapter-probe-settle.test.ts` (settle rule,
  degraded answers, the recording window, write decision), six new boundary cases in
  `tests/unit/asset-chapters.test.ts`, and the integration block "provisional Twitch chapters (M108)" in
  `tests/integration/db-roundtrip.test.ts` (migration on an old database, replace and keep, the recording
  window against `created_at`, operator edit between selection and write). The cap: "the recheck cap" in
  `chapter-probe-settle.test.ts` (what counts, the recording window, a fresh count on a fill) and in
  `chapter-backfill-provisional.test.ts`, plus "rechecks of a source that never answers properly end" there
  (selection and write decision interval by interval: failing, empty and shorter rechecks stop after six, a
  list from before M108 capped ten hours after its first recheck, which comes right after the repin,
  recording answers and failures in the window do not count, the normal and the longest chain are
  unaffected), and two integration cases (migration on an old database; the counter through the
  compare-and-swap, a whole-state write and a sync up to the cap). Existing tests changed with the
  behaviour: the stall test in `asset-chapters.test.ts` now expects only the later boundary (the brief's
  rule) and builds its fired keys from the chapters, the operator-edit fixture in
  `chapter-backfill-recheck.test.ts` now carries status `""`, which is what an operator edit stores (it said
  `ok`, which only a probe writes); a second case keeps a probe-filled list of several chapters from a
  finished VOD (level 1) final.
- Follow-ups, not in this milestone: the `twitch-vod` connector stores chapters at ingest from the same
  extractor and may store the same stand-in, which nothing rechecks; the admin's chapter editor shows no
  sign that a list is provisional, nor that one was capped; an empty list whose probes keep failing is
  marked `failed` and retried every 30 minutes for as long as it is listed, as before M108 (the cap counts
  only stored non-empty lists; M108's two-hour recheck of an empty list at level 0 reaches that state
  sooner than the weekly one did). `.env.example` and `.env.production.example` list
  `CHAPTER_BACKFILL_PROVISIONAL_RECHECK_SECONDS` since the gate; `docker-compose.yml` passes the `.env`
  file whole and lists none of the backfill settings.

### M110 Release 2.3.1

- 2026-10-18: #33 (M107) and #34 (M108, retargeted to `main` by the REST API: `gh pr edit` fails on the
  Projects (classic) GraphQL deprecation) merged; `main` equals the green M108 head. A docs fix
  (`e8e7de3`): the M108 rollback note names the extra step back to 2.1.0. `release: v2.3.1-rc.1`
  (`08f2376`); its push CI failed first in `docker build` (`public.ecr.aws` answered the `node:22-alpine`
  manifest with an unexpected status, the second time since 2026-10-14), the re-run of the failed job went
  green; tag `v2.3.1-rc.1`, the pre-release "Stream247 2.3.1-rc.1".
- 2.3.0 from its repin (2026-10-15 13:33 UTC) to 2026-10-18: each nightly reconnect (00:03:23, 00:03:25 and
  00:03:38 UTC) cost one restart that the reconnect grace took (`faultAgeMs` 54107-56310), no backoff, the
  uplink back 5 s later; no incident created. The owner restarted every Proxmox node on 2026-10-18 (to renew
  the SSH certificate); the DUT came back at 14:54 UTC and the stack started by itself, on air again 4 s
  later.
- 2026-10-18 16:10 UTC: the M108 pre-repin query printed no row (no operator ever saved chapters on the DUT);
  backup `~/backups/stream247-pre-v2.3.1-rc.1.dump` (41 tables); `~/repin.sh v2.3.1-rc.1` (dry run: the three
  app pins only, 62 env vars, `prune=False`), all six containers healthy 16 s after the start, relay
  untouched. Both M108 migrations present (the 2.3 count prints 9), both columns present, no breaker, no
  incident, `jimpanse247` live; the chapter rechecks began at once (3 archives at settle level 1 within a
  minute). The web container's address is `172.22.0.7` again.
- 2026-10-18 16:11:06 UTC: 24-h soak from `~/stream247-v2.3.1-rc.1` (`git archive v2.3.1-rc.1 scripts
  docker-compose.yml`), `tmux` session `soak`, `CHECK_BASE_URL=http://172.22.0.7:3000`, run log
  `~/stream247-v2.3.1-rc.1/logs/soak-20261018-161106.log`, baseline `web=0 worker=0 playout=0 uplink=0
  relay=0`, uplink unplanned restarts 3963; first sample `status=ok broadcastReady=true`.
- M101 (the clock change on 2026-10-25) cannot run on the DUT: the Twitch metadata sync, which writes the
  schedule, waits for `jimpanse247` to connect as the broadcast channel (open incident
  `twitch.metadata.waiting-for-broadcaster` since 2026-08-25; only the bot `3jakec` is connected). The same
  holds for the Twitch-schedule part of M93. Owner step: connect `jimpanse247` itself under the admin's
  Twitch settings; then save the M101 test block.
- 2026-10-18 22:21:40 UTC: that soak ended `outage-exceeded` (6 min of `Failed to connect to 172.22.0.7 port
  3000`). The owner ran `apt-get dist-upgrade` on the DUT at 22:14:45 UTC; it upgraded `containerd.io`, so
  the Docker daemon restarted (22:15:15) and every container with it, back on air 16 s later (uplink start
  22:15:30). The containers kept their state but not their addresses: `web` came back as `172.22.0.5` and
  `172.22.0.7` went to `worker`, so the monitor asked the wrong container. Not an app fault; the soak counts
  as failed and starts over. Seen in the 13 h on rc.1: the nightly reconnect (2026-10-19 00:03:48 UTC) cost
  one restart the grace took (`faultAgeMs` 50017), no backoff, no incident since the repin; the chapter
  rechecks reached every archive but one: 29 now hold a whole list (24 before), 16 gave the same single
  chapter twice and are final (settle level 3).
- 2026-10-19 11:09:52 UTC: 24-h soak again, `CHECK_BASE_URL=http://172.22.0.5:3000`, run log
  `~/stream247-v2.3.1-rc.1/logs/soak-20261019-110952.log`, baseline `web=0 worker=0 playout=0 uplink=0
  relay=0`, uplink unplanned restarts 3964, first sample `status=ok`. Follow-up (owner to decide): the
  monitor takes a container address that any Docker restart may hand to another container; it could
  re-read `web`'s address on a failed fetch, or ask through `docker exec stream247-web-1`.
- 2026-10-20 11:10:46 UTC, the soak of 2.3.1-rc.1 **passed with failure**: `soak-monitor-complete outages=1
  outageSecondsMax=180 outageSecondsTotal=180`, 1428 samples `status=ok`; the outage was the nightly
  reconnect (00:04:12 to 00:07:12 UTC), `uplinkUnplannedRestartsDelta=2` (3964 -> 3966), container restarts
  0, no incident created in the window. Both restarts were the reconnect grace's
  (`uplink.watchdog.reconnect_grace.uncounted`, `faultAgeMs` 52075 at 00:05:04 and 72392 at 00:05:25), no
  `uplink.watchdog.backoff`: M109 held a two-restart night.
- M108 DUT checks pass (2026-10-18/20): the pre-repin query listed no row; both migrations ran; the state
  query on 2026-10-20 13:20 UTC: settle level 1 with 2-8 chapters 29 archives, level 3 with one chapter 16,
  level 0 with two chapters 1 (probed 11:30 UTC), none capped, no provisional row older than two and a half
  hours; 18 `playout.chapter.boundary` lines since the repin, at most one per asset and minute.
- M107 DUT check not run: it needs an archive that runs past its block and `!next` typed in the chat. On
  2026-10-20 the text mode read "Als Nächstes: Wir essen Surströmming (und machen alles falsch)", the
  queue's next video, not a block. Owner decision 2026-10-20: ship 2.3.1 with the M107 check open; it stays
  under *DUT checks for the next release candidate*.
- 2026-10-20: docs commit 5ec3427 renamed *Upgrading Past 2.3.0* to *Upgrading To 2.3.1*; `release: v2.3.1`
  (49d9160), push CI green at 14:14 UTC on the first attempt; tag v2.3.1; the release workflow published the
  images and the GitHub release "Stream247 2.3.1" as Latest (14:19:12 UTC).
- Backup ~/backups/stream247-pre-v2.3.1.dump (41 tables). ~/repin.sh v2.3.1: dry run (the three app pins
  v2.3.1-rc.1 -> v2.3.1, 62 env vars, prune=False), PUT ok; all six containers healthy 18 s after the start
  (14:20:03 UTC), relay mediamtx:1.15.4 untouched; 9 migrations since 20261001_002, no breaker open, no
  incident; 4 s of the global fallback, then a Twitch archive; jimpanse247 live at 14:20:22; readiness ok; the
  web container's address on stream247_net is 172.22.0.6.
- M110 is complete; the M107 DUT check stays open by the owner's decision of 2026-10-20.
