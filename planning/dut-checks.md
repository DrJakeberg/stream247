# DUT checks for the next release candidate

Moved out of `PLANS.md` in M121, text unchanged; `PLANS.md` points here. A milestone adds the checks that only the
device under test (DUT) can run to the end of this file; the release that runs them records the results in its
notes.

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

- M120, after the repin: in Live → *Operator controls* press *Skip current*. Passes when *Current and
  next* shows *Operator holds* with "Skipped: <the item> stays out for 60 more min.", *Resume schedule* is
  enabled, and pressing it removes the line without a cut in the picture (the item on air keeps playing).

- M123, on the deployed candidate in the week before Sunday 2027-03-28 (after `jimpanse247` writes the
  schedule): save two test blocks "Once" on that Sunday, 01:00-02:30 and 02:30-04:30, let one Twitch sync
  run. Passes when the Twitch dashboard shows the first 01:00-02:00 (one hour) and the second 03:00-04:30
  (90 minutes); `Program → Schedule → Week` lists the second's first video at 03:00, and the day reads 23 h
  scheduled for a channel planned around the clock. Delete both blocks afterwards.

- M123, after the repin, without the relay (the playout restarts after a Skip): press Live → *Skip
  current* and type `!now` in the chat within the next seconds. Passes when the bot answers "gleich geht’s
  weiter mit: <title>" (English: "switching to the next video: <title>") or, once the next video runs, its
  title, and never "gerade läuft nichts".

- The checks of 2.2.0-rc.1 are in the archive, sections M75-M82. That candidate never reached the DUT, so
  the 2.3.0 candidate runs them too.

- M124, on the deployed candidate (it touches the seam chain, so it is soaked like a release): while a
  pool's local file or cached Twitch archive has aired for more than 5 minutes, press Live → *Play now*
  on a short other item. Passes when, after the inserted item, the cut item comes back about 10 s before
  where it was cut (the picture repeats the last seconds), it reads "resumed at h:mm:ss" on
  its row in the as-run log (`/live?tab=status`), and the overlay's chapter title and the Next card's time match the item, not the restart.

  ```sh
  ssh dut 'docker logs --since 30m stream247-worker-1 2>&1 | grep -E "playout\.resume\.(point|start|not_seekable)"'
  ```

- M124, at the repin of the candidate: the item on air when the containers restart continues 10 s before
  the restart (a cut of a local file or cached archive), not from its beginning or with the next item.
  Passes when the first `playout.resume.start` after the repin names the asset that was on air before it.

- M125, after the repin: the public health answer carries no destination details. Passes when the count
  is `0` and the second command prints exactly the five status fields.

  ```sh
  ssh dut 'docker exec stream247-web-1 wget -qO- http://127.0.0.1:3000/api/health' | grep -c -E '"(rtmpUrl|notes|lastError|playlistPath)"'
  ssh dut 'docker exec stream247-web-1 wget -qO- http://127.0.0.1:3000/api/health' | grep -o '"destination":{[^}]*}'
  ```

- M125, after the repin: the relay still accepts its own reads and every push source (the relay check now
  never refuses a correct key). Passes when the channel is on air with `uplink=ok` in readiness and a push
  source in Studio publishes, and the relay log shows no refused read from the uplink since the repin.

  ```sh
  ssh dut 'docker logs --since 30m stream247-relay-1 2>&1 | grep -ci "authentication failed"'
  ```

- M125, after the repin: overlay pictures still draw (the renderer fetches them itself now). Passes when a
  logo or image layer and a chat emote are visible on the picture, and the worker log has no render error.

- M125, once: the Traefik in front of `web` replaces a client's `X-Forwarded-For`. Passes when its static
  configuration has no `forwardedHeaders.insecure` and no `forwardedHeaders.trustedIPs` for the entrypoints
  `web` and `websecure` (no output from the command, run where Traefik's configuration lives).

  ```sh
  ssh dut 'docker ps --format "{{.Names}}" | grep -i traefik | xargs -r -n1 docker inspect --format "{{.Name}} {{join .Args \" \"}}" | grep -o "forwardedHeaders[^ ]*"'
  ```
