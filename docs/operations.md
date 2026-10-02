# Operations

## Primary Surfaces

- `/live?tab=control` for current broadcast state and operator actions
- `/live?tab=status` for incidents, drift checks, destination health, audit visibility, and the as-run
  log of the last 24 hours (*On air, last 24 hours*)
- `/live?tab=moderation` for moderation presence and check-in history
- `/api/health` for basic service health
- `/api/system/readiness` for broadcast readiness and drift-relevant status
- `/api/as-run` for what was on air in any window of the last 90 days (since M76)

## Watch First

- worker heartbeat freshness
- playout heartbeat freshness
- destination readiness
- current asset selection reason
- transition state and next-asset probe status
- crash-loop protection state
- open critical incidents
- active SSE connections reported as `sseConnections` in `/api/system/readiness`
- container restart deltas in the soak monitor log

## Common Operator Actions

- restart encoder
- refresh overlay/slate payloads without restarting the encoder
- rebuild the visible current / next / queued runtime state on the next playout cycle
- recover staged outputs immediately instead of waiting for the next natural transition
- switch to fallback
- pin asset on air
- skip current asset (the pool carries on after the skipped item; in a pool with several sources the
  next source's next item plays, as it would have at the item's end; skipping a pinned item ends the
  pin, and the pool carries on from its own position, which a pin does not move)
- play an item now, or as an insert, without taking the channel off air
- resume schedule control
- acknowledge and resolve incidents

### Operator controls, with and without the relay (since 2.1)

With the relay (`STREAM247_RELAY_ENABLED=1`) the uplink holds the Twitch connection and the playout
only feeds the relay, so a playout restart reconnects nothing. Without it (direct RTMP) the playout's
own ffmpeg publishes, and a restart puts the reconnect standby slate on air for one playout cycle
(`selectionReasonCode=scheduled_reconnect`). After the slate the playout chooses as if nothing were on
air: a running Pin or Fallback, else a running insert from its beginning, else a queued Move next, else
the pool's next item. Under the relay no operator action shows that slate.

- **Play now** and **Play insert** queue the chosen item as an operator insert (the two differ only in
  their audit entry, `playout.play-now.requested` / `playout.insert.requested`). The next playout cycle
  (within about 15 s) resolves the item and then switches straight to it: `playout.process.start`
  with `reasonCode: operator_insert`, no slate, in either mode. An item that has not been played
  recently can take a minute or more to resolve (yt-dlp, Twitch); the item on air keeps playing
  meanwhile. While the insert plays, the pool's next items are prepared as usual. When the insert ends
  (its end, its duration bound, a feed watchdog) the pool continues with its next item. The interrupted
  item is not resumed at its position — it was the pool's last started item, so the pool goes on after
  it (resuming is M77, deferred). Play now does not move a pool's position either, so a pool item played
  by hand can still come round as the pool's next item. Both take a queued Move next out. Chat cannot
  skip it: skip votes are paused while it is pending or on air (*Chat skip votes* below, since M79).
- Play now and Play insert are refused for the item already on air (with the relay, Restart plays it
  again from its beginning), while a Live Bridge is pending or on air (the takeover ends an insert;
  release it first, also when a Pin is still running under it), while a Pin or Fallback holds the air
  (it comes before an insert; Resume first), for an item held out by a Skip or Remove next (Resume clears the hold), and for a Twitch
  archive that is not downloaded yet while *While a replay is still downloading, play it from Twitch*
  (Settings → Operations → Replay cache) is off: the playout never waits for a download, so it could
  not start it. An archive too large to cache streams from Twitch and is accepted.
- An insert that is cleared before it aired is logged as the runtime event `playout.insert.dropped`
  and an audit row of the same name, with a `reason`: `preempted` (a Pin or Fallback is running),
  `live-bridge` (a Live Bridge took the air), `unavailable` (the item is no longer ready or is
  skip-held), `prepare-failed` (it could not be
  resolved; the item on air stays on air, the error is in the entry), `start-failed`,
  `destination-missing`. The admin adds an audit row (no runtime event) when the operator drops a
  pending insert: `replaced` by a newer Play now, `cancelled` by Resume schedule.
- An insert that is on air and cannot be prepared again (a Soft restart of it, or a redeploy of the
  playout container, while its source does not resolve) is covered by the fallback like any failed item,
  and the cycle after that ends it: runtime event and audit row `playout.insert.ended` with `reason:
  prepare-failed` and the error, then the schedule continues. Before, the insert stayed selected and was
  resolved again on every cycle, with the fallback on air until Resume schedule.
- **Move next** queues an item for the end of the item on air and plays it to its end, also when it is
  not from the running pool's sources. A Skip starts it at once (without the relay after the slate).
  With the relay a Restart restarts the item on air and leaves Move next queued; without the relay the
  slate comes first and the queued item starts right after it. **Replay previous** queues the last item
  that left the air for another one — at its end, or cut short by a Play now or a Skip — as Move next
  (2.1 records it at every switch and natural end; before, it stayed empty). The control room shows it
  as *Previous item*. **Remove next** holds the next item out for an hour.
- **Pin on air** and **Temporary fallback** put the chosen item, or the global fallback, on air for
  the override minutes (fallback: an hour): with the relay the next cycle switches to it, and pinning
  the item on air keeps it running; without the relay the slate comes first. When the pin ends — its
  minutes run out, or Resume with the relay — a pinned item from the running pool's sources plays on to
  its end as the pool's item, and any other item gives way to the pool's next item. Skip current ends
  the pin (below). Pinning an item that a Skip holds out lifts that hold; the pin would not take the air
  otherwise.
- **Resume schedule** clears a Pin or Fallback, a pending or running Play now / insert, a queued Move
  next and a skip hold, and is enabled while a Pin, a Fallback or an insert is in effect. With the relay
  the next cycle hands back to the pool: a running insert gives way to the pool's next item (if that is
  the insert's item itself, it plays on and counts as the pool's item), a pinned pool item plays on.
  Without the relay the slate comes first, then the pool's next item.
- **Skip current** holds the item on air out for the override minutes and moves on to the pool's next
  item (or a queued Move next): with the relay at once, without it after the slate. When a Pin or
  Fallback holds that item on air, Skip also ends the override (since M78; before, the pinned item
  started again from its beginning and only Resume took it off air). The schedule then continues as
  after any Skip: the pool goes on from its position, which a pin does not move, so after a pin of the
  pool's running item that is the item after it, otherwise the pool's next item. The audit row
  `playout.skip.current` says "the Pin was ended by Skip" (or the Fallback). A Pin set but not yet on
  air is left alone: Skip skips the item before it, and the pin then takes the air.
- **Live Bridge** takes the air at the next cycle once it is requested, ahead of every other control.
  The takeover ends an operator insert (since M78): one on air is cut and not resumed after the
  release (runtime event `playout.insert.ended`, `reason: live-bridge`), a pending one is dropped
  (`playout.insert.dropped`, `live-bridge`, with its audit row). Before, the insert on air started
  again from its beginning after the release, and a pending Play now aired whenever the bridge was
  released. On release the schedule continues with the pool's next item; a Pin, Fallback or Move next
  still in effect applies as usual. The planned reconnect of direct mode still restarts a running
  insert from its beginning (unchanged; see Soft restart below).
- **Chat skip votes** (`!skip`, Studio → Engagement, *Viewer control*) apply the same Skip, without
  the override part: while a Pin or Fallback holds the air (since M78), or the operator's Play now /
  Insert is pending or on air (since M79), no skip vote starts or counts, a vote that passed just before
  the worker saw the override or insert is not applied (runtime event `chat.skip.paused` with `hold`
  `asset`, `fallback` or `insert`; audit row `chat.skip.refused`), and the bot answers in chat at most
  once a minute (one cooldown for all three), in the channel language (since M80), for example "The
  operator has pinned this item — skip votes are paused until the pin ends." or "The operator is
  playing an insert — skip votes are paused until it ends." Votes count again once the override or insert ends; an insert still ends as before
  (its end, the operator's Skip, Resume schedule, a Live Bridge). An insert that is no longer what is
  on air does not pause votes: while the fallback covers an insert that could not be prepared again,
  `!skip` counts. A pool's automatic insert and a cue
  point insert are the schedule's, not the operator's: chat can skip them as any other item. The worker
  sees a new Pin or insert, and its end, at its next cycle (up to about 30 s): votes in that window count
  or stay paused, and a vote that passes is judged on the row when it is applied. A passed vote is also
  not applied when its item has left the air by the time the worker applies it (up to one worker cycle
  later), or when a Skip already holds that item out (runtime
  event `chat.skip.stale`; nothing is written, so an operator's Skip in between stands). Under a Live
  Bridge nothing is on air to skip: votes do nothing and the bot stays silent, also with a Pin still
  running underneath. The next-item poll (`!1`, `!2`, ...) and viewer requests are not paused.
- **Soft restart** and **Hard reload** restart the encoder. With the relay the item on air (or the
  running pin or insert) starts again from its beginning — there is no resume. Without the relay the
  slate shows and the playout then chooses as described above: the running Pin or insert from its
  beginning, else a queued Move next, else the pool's next item (a pool item on air is not restarted).
  The planned reconnect of direct mode (every few hours) does the same.
- **Force reconnect** restarts the encoder into the reconnect window without the relay. With the relay
  it is refused: the uplink reconnects by itself (the planned reconnect interval, the encoder-stall and
  destination-stall watchdogs).
- **Recover outputs now** marks staged outputs ready. Without the relay it restarts the playout so
  they rejoin (slate, then as above). With the relay the programme is not restarted: the uplink takes
  the outputs back on its next cycle by restarting the uplink process of each output's rendition, so the
  outputs that share that rendition (Twitch, for one) reconnect once.

## What Viewers Read: The Channel Language (since M80)

One setting, the channel language (`Admin → Settings → Channel language`, the setup wizard's instance
step, or `CHANNEL_LANGUAGE` in the environment, which beats the saved value), decides the language of
everything the product itself says to viewers. `en` is the default, `de` is German; any other value
counts as English.

When a change arrives:

- Saved in Settings or the wizard, it needs no restart. The chat bot, the Twitch title and the public
  page pick it up with their next refresh, and the picture with the next playout cycle while a
  programme or a Live Bridge is on air.
- While the standby or reconnect slate is on air with the scene picture, the picture and its poll, skip
  and game panels keep the previous language until the next programme or Live Bridge starts. A time
  zone change behaves the same way: the playout redraws the slate from the picture it built when the
  last programme started. The slate's plain-text lines (overlay off, or text mode) change at once.
- `CHANNEL_LANGUAGE` is an environment value and is read when a container starts. Changing it means
  recreating the containers (`docker compose up -d`, or a redeploy in Portainer), like any other
  environment change.

What follows the language:

- the on-air picture: the chip on the lower third (`Now Playing` / `Läuft gerade`), the next card
  (`Next` / `Als Nächstes`, its time range, `Nothing scheduled` / `Noch nichts geplant`), the countdown,
  the next-item poll and the skip bar, and the chat game panels
- text mode and the standby slate (the `Now:` / `Jetzt:` and `Next:` / `Als Nächstes:` lines ffmpeg draws
  when no scene picture is on air)
- the standby, reconnect and Live Bridge texts the worker writes when nothing titled is on air
- every chat bot reply (`!here`, `!game`, the skip-paused lines)
- the Twitch title when no asset is on air
- the public page `/channel`, including the name of the time zone (`Central European Time` /
  `Mitteleuropäische Zeit` instead of `Europe/Berlin`)

What does not:

- **Your own content is never translated**: asset and block titles, categories, scene text layers, the
  ticker, source names, and any headline you wrote in the studio. One exception follows from the
  built-in rule below: a title, category or source name that is exactly one of the product's own
  English texts is shown in the channel language.
- **Command words** stay as they are in every language: `!here`, `!skip`, `!request`, `!game`, the
  game ids, `stop`, `!1`, `!2`.
- **The admin interface stays English**, including the texts it shares with the air: the as-run log
  and the playout state keep `Replay standby`, `Scheduled reconnect`, `Live Bridge` and `Live input`,
  and the sources list keeps `Local Media Library`; viewers get the channel language's words for them
  on the picture, in the Twitch title and on the public page.

The studio's built-in headlines (`Stream247`, `Replay stream`, `Always on air`, `Insert on air`,
`Scheduled reconnect in progress`, `Please wait, restream is starting`) are stored in the database in
English and are not migrated. A stored value that still equals its built-in English default counts as
not customised and is shown in the channel language; anything else is shown exactly as written. So a
German channel that never touched the headlines gets German headlines, and to keep one of the English
defaults on a German channel, change it by a character.

The same rule covers the names the product writes in English for the admin — `Replay standby`,
`Stand by`, `Scheduled reconnect`, `Live Bridge`, `Live input` and `Local Media Library` (the local
library's source name, which every scan writes again, so it cannot be renamed) — wherever they reach
viewers: as a title, a category or the source label on the picture, in the Twitch title and on the
public page. The rule compares the text, not who wrote it, because the playout and queue state do not
record that. So an asset, a block, a category or a source that you named exactly like one of the texts
in this section is shown in the channel language as well (`Stand by` as an asset title reads `Gleich
geht’s weiter` on a German channel; in English, `Replay standby` reads `Stand by`). Change it by a
character to have it shown as written.

The standby state has one name per language: `Stand by` / `Gleich geht’s weiter` (chip, title, Twitch
title, public page), with the headline `Stand by, we’ll be right back` / `Kurze Pause – gleich geht’s
weiter`. The public page no longer prints the playout's status message, which is written for the
operator (`Crash-loop protection is active.`); it shows `Playing now.`, `The stream is starting, back
in a moment.` or `The channel is off air right now.` instead. The status message is unchanged on the
admin pages.

One text is written once and then kept: an ingested item without a title is stored as
`<source> item` / `Video aus <source>` in the language set at that sync, and a later language change
does not rename it.

## Symptoms And Immediate Actions

### What was on air at a given time?

Since M76 every playout process run writes one row to the as-run log (table `as_run_log`): start and
end in UTC, what aired (title as aired, asset, source, the block on the schedule, and its pool when the
pool's rotation picked the item), why it was picked (`reasonCode`: `scheduled_match`, `global_fallback`,
`operator_insert`, ...), how it was fed (input kind: local file, remote stream, video+audio pair, live
input, generated slate; YouTube's `formatId` and `formatCandidate`), planned seconds (the item's known
duration) against aired seconds, and why it ended (`natural-end`, `duration-bound`, `switch`, `skip`,
`operator-restart`, `feed-watchdog`, `scheduled-reconnect`, `crash-loop-reset`, `destination-missing`,
`stopped`, `failed` with the exit code, `process-gone`). Rows are kept 90 days and survive redeploys,
which the container logs do not. Start every incident analysis here instead of in `docker logs`.

- Console: `/live?tab=status`, panel *On air, last 24 hours*, newest first; times in UTC with the
  channel's time zone beside them (the schedule's clock, so "19:38" on the schedule is that column).
- API (owner, admin, operator, moderator, viewer): `GET /api/as-run?from=<ISO>&to=<ISO>&limit=<n>`,
  default the last 24 hours and 200 rows, at most 1000; `truncated: true` means narrow the window.
  `from` and `to` set to the same moment answer the question directly:
  `/api/as-run?from=2026-10-01T19:38:00%2B02:00&to=2026-10-01T19:38:00%2B02:00`.
- SQL on the host (read-only; timestamps are ISO text in UTC and compare as text):

  ```bash
  docker compose exec -T postgres psql -U stream247 -d stream247 -c "
    SELECT started_at, ended_at, target_kind, title, source_id, pool_id, reason_code, input_kind,
           format_id, planned_seconds, aired_seconds, end_reason, exit_code
    FROM as_run_log
    WHERE started_at <= '2026-10-01T17:38:00.000Z'
      AND (ended_at = '' OR ended_at >= '2026-10-01T17:38:00.000Z')
    ORDER BY started_at DESC;"
  ```

Reading the rows:

- `ended_at = ''` is the run on air now. There is never more than one: a row a crash or a redeploy left
  open is closed as `process-gone` when the playout comes back up (or at the next start), so its end is
  the boot time and its aired seconds are an upper bound.
- `target_kind = 'fallback'` where a programme was expected is the fallback bridge, a fallback tier or
  the operator's Fallback; `reason_code` says which (`generic_fallback` or `global_fallback` for the
  bridge and the tiers, `operator_override` for the Fallback button; a Pin is `operator_override` with
  `target_kind = 'asset'`). A run of short `failed` rows with the same `exit_code` is a crash loop; the
  matching `playout.process.exit` log line, while it still exists, has the stderr. A spawn that failed
  (no ffmpeg binary, `EAGAIN` under process pressure) is a `failed` row with the error code
  (`ENOENT`, `EAGAIN`) as `exit_code` and no aired time.
- `pool_id` is set only when the pool's rotation picked the item (`reason_code = 'scheduled_match'`). A
  fallback, an insert, a Pin or a Move next inside the block carries the block but no pool, even when
  the item comes from one of the pool's sources.
- `aired_seconds` of an ended row matches `ranForMs` of its `playout.process.exit` line to the second.
- A row's `end_reason = 'switch'` after a Pin, Play now or fallback, `skip` after a Skip or a chat skip
  vote, `operator-restart` after Restart or hard reload (and, without the relay, Recover outputs and
  Force reconnect): the web asks the playout for all of them with one restart request, and the row
  tells them apart. Without the relay the reconnect slate comes first: the item's row ends as above,
  then a short `reconnect` row ends as `switch` when the next item starts. A Skip written while a
  playout cycle is still running can lose its restart request to that cycle's last write; the next cycle
  then moves off the skipped item as a plain switch (`plannedReason: switch` on its exit line), and the
  row ends `skip` all the same.

### Playout degraded

- open `/live?tab=status`
- inspect `selectionReasonCode`
- inspect `fallbackTier`
- inspect destination readiness
- inspect last FFmpeg stderr sample
- inspect `restartCount`, `lastExitCode`, and `crashCountWindow` in `/api/system/readiness` or the soak monitor log
- distinguish planned reconnects from recovery: planned reconnects report `selectionReasonCode=scheduled_reconnect`, while FFmpeg failures usually increment `restartCount` with a signal or exit code such as `SIGBUS`, `128`, or `8`
- in HLS program-feed mode, treat `playoutTransient=true` as a local playout recovery window, not a Twitch reconnect, as long as `uplinkStatus=running`, `programFeed=fresh`, `destination=ok`, and `uplinkUnplannedRestarts` has not increased
- when relay/HLS is enabled, a fresh `programFeed.updatedAt` now counts as active playout liveness for `running`, `recovering`, and `switching`; do not treat a quiet FFmpeg stderr stream by itself as an outage while `programFeed=fresh` and `uplinkStatus=running`
- if the playout container accumulates zombie FFmpeg or yt-dlp processes, recreate it: the image runs Node under `tini`, which reaps them, so an accumulation means the container is not running the shipped entrypoint
- if the soak monitor reports `container-restart-check-failed`, inspect `docker compose ps`, `docker inspect --format '{{.RestartCount}}'`, and recent logs for `web`, `worker`, and `playout` before restarting the soak
- for what aired around the failure, read the as-run log first (*What was on air at a given time?*
  above): it survives the container restart that the logs do not

### Replay cache: what the log says since M62

- `vod.cache.job.start` carries `timeoutMs` (effective), `configuredTimeoutMs` and `durationSeconds`:
  a background download gets at least the replay's running time, capped at one day, so a five-hour
  VOD is not killed at the two-hour floor.
- `vod.cache.kept` with `reason: scheduled-within-retention` means a replay that just finished stays on
  disk because a block within `retentionHours` draws from its pool; `vod.cache.released` is the old
  path and still runs for everything else.
- `playout.twitch-cache.failed` with "Command timed out" now means the download could not keep up with
  real time for the whole running length of the content — a network problem, not a short fuse.

### Remote VOD reaches its end without EOF

- remotely streamed VODs (CloudFront-backed Twitch assets too large to cache) can reach their end
  without ffmpeg receiving EOF; when the asset's duration is known, the playout ends it
  deliberately once elapsed playback passes duration plus a margin, on the same planned-transition
  path a natural boundary takes
- a `playout.duration_bound.end` runtime event at an asset end is that planned transition, not a
  fault; no incident accompanies it
- `uplink.encoder_stall.restart` or `playout.feed_audio.restart` firing at almost every asset end
  means the bound is not firing for those assets — check that their `durationSeconds` metadata is
  present; assets with an unknown duration fall back to the watchdogs by design
- tuning: `PLAYOUT_DURATION_BOUND_MARGIN_SECONDS` (default 15) — seconds past the known duration
  before the deliberate end; keep it generous, because cutting duplicated last-frame is invisible
  while cutting real content is not. Since M56 part 2 this margin — like every watchdog threshold —
  is also settable in Admin → Settings → Operations ("Watchdog thresholds"); a value saved there
  wins over the env variable, and the GUI enforces the safe range (5–120 s here)

### Crash-loop protection active

- inspect the latest playout incidents
- verify stream destination and selected asset
- request a manual restart only after the cause is understood

### Destination cooling down or staged

- inspect the destination panel in `/broadcast` for cooldown timers, staged outputs, and the latest failure sample
- let the next natural transition bring staged outputs back when continuity is more important than immediate fanout recovery
- without the relay, use `Recover outputs now` only when an immediate encoder restart is acceptable;
  with the relay it leaves the programme alone, but the uplink restarts the process of each recovered
  output's rendition on its next cycle, so the outputs sharing that rendition reconnect once

### Twitch sync unhealthy

- confirm the bot account is connected and the broadcast channel is set (Admin → Settings → Twitch
  accounts); `twitch.metadata.waiting-for-broadcaster` is expected in a split setup until the channel
  owner connects — chat and moderation keep running through the bot meanwhile
- check managed credentials or `.env` fallback
- review Twitch incidents in `/live?tab=status`

### Channel timezone is not valid (since M85)

- the incident `config.channel-timezone.invalid` (warning, system) means `CHANNEL_TIMEZONE` in the
  environment, or the zone saved in the setup wizard, is not a name the runtime knows (a typo such as
  `Europe/Berln`); the message names the value and the zone the schedule runs on instead
- the channel stays on air: the bad value is skipped and the schedule falls back to the saved zone, then
  to `UTC`, so every block can run hours off until the value is fixed
- fix the value in the deployment environment (or unset it and let the wizard manage the zone) and
  restart; the next worker cycle closes the incident

### No playable asset

- verify local media exists or remote sources ingest correctly
- confirm source incidents
- for Twitch VOD assets, inspect `playout.twitch-cache.failed` incidents and confirm `MEDIA_LIBRARY_ROOT/.stream247-cache/twitch` is writable with enough free space
- if playout stays on the reconnect slate while a Twitch VOD is still downloading, inspect the playout container for active `yt-dlp` work and prune leftover `.part-*` files for the same VOD; the production timeout should stay low enough that playout falls through to local fallback instead of waiting for a multi-minute cache prep
- keep at least one curated local fallback asset under `data/media` with `fallback` or `standby` in the file name so the local-library source promotes it to a global fallback automatically
- confirm the Twitch cache guardrails are set — since M56 part 2 the whole family (and the uplink
  watchdog pair below) is managed-first: Admin → Settings → Operations ("Replay cache" and
  "Watchdog thresholds") wins over these env values, which remain the fallback for an untouched
  install. Only `TWITCH_VOD_CACHE_ROOT` stays env-only, because a mount point is infrastructure:
  - `TWITCH_VOD_CACHE_DOWNLOAD_TIMEOUT_SECONDS`
  - `TWITCH_VOD_CACHE_RETENTION_HOURS`
  - `TWITCH_VOD_CACHE_PARTIAL_MAX_AGE_HOURS`
  - `TWITCH_VOD_CACHE_MAX_ASSET_BYTES` — per-VOD ceiling. A VOD above it is never downloaded and is
    played straight from Twitch (`cacheStatus: "too-large"`, event `vod.cache.too_large`); this is a
    settled decision, not a failure, so nothing retries it. Keep `TWITCH_VOD_CACHE_MAX_BYTES` above
    it, or the prune evicts the very file being downloaded.
  - `TWITCH_VOD_CACHE_MAX_BYTES`
  - `TWITCH_VOD_CACHE_MIN_FREE_BYTES`
  - `UPLINK_STALL_TIMEOUT_MS` / `UPLINK_STALL_GRACE_MS` — how long the uplink may run without
    advancing `out_time` before it is restarted, and the quiet period after start. A stalled ffmpeg
    stays alive and keeps its destinations in `ready`, so process liveness alone does not catch it;
    watch for the `uplink.encoder_stall.restart` and `uplink.encoder.no_progress` events.
  - `TWITCH_VOD_CACHE_LIMIT_RATE` — caps download bandwidth (yt-dlp notation, e.g. `8M`). Unset means
    unlimited, which lets a background download saturate the same line the uplink pushes through.
  - `TWITCH_VOD_CACHE_FAILURE_COOLDOWN_SECONDS`
- keep remote Twitch fallback disabled unless you intentionally accept direct remote VOD playback risk
- confirm fallback assets exist

### A YouTube item leaves the air after a few seconds

Since 2.1 a YouTube item is resolved through ordered format candidates and may play as a video+audio
pair. To see what happened to one item:

- Start in the as-run log (*What was on air at a given time?*): each run of the item is a row with
  `input_kind` (`pair` or `remote`), `format_id`, `format_candidate`, how long it aired and its exit code,
  even after a redeploy. The log lines below carry the detail while they still exist.
- `playout.process.start` names `formatId` (e.g. `299+140`), `formatCandidate` and, for a pair, the
  `audioInput`; `playout.input.format_fallback` lists the candidates yt-dlp reported as unavailable;
  `playout.input.reresolve` with a `formatCandidate` means that candidate resolved but could not be
  opened and is skipped for the item for 30 minutes.
- Ask yt-dlp directly, in the playout container (the playout process resolves playback, not the
  worker): `docker exec stream247-playout-1 yt-dlp -F <watch URL>` lists what YouTube offers right
  now; `yt-dlp --version` shows the version the image carries. yt-dlp comes from the image's Alpine
  packages, so a newer one arrives with a rebuilt image.
- If YouTube changes again, `STREAM247_YOUTUBE_PLAYBACK_FORMATS` (yt-dlp selectors separated by `|`)
  replaces the candidate list without a release.
- An item that keeps failing leaves automatic selection after three failed prefetch probes and raises
  `playout.source-unplayable.<sourceId>`; its asset page can clear the failures once it is fixed. A
  probe that failed because the channel's own network was down is not one of the three (see *The
  channel's own network was down* below).
- When probes fail on three different items of one source, the whole source is held out instead; see
  *A source is held out of programming* below.

### A source is held out of programming (source breaker)

Incident `playout.source-breaker.<sourceId>`, *<source> is held out of programming*. The probes of the
playout's queue (and the resolve of the item it starts) failed on three different items of that source
with no clean probe of it in between. A Twitch archive whose download is still queued or running does
not count: with remote fallback off it is refused until its file is there, and that says nothing about
the source. Neither does a probe that failed because the channel's own network was down (M82, *The
channel's own network was down* below). Why the breaker exists: the YouTube SABR change of 2026-09-28
left 0 of 11 items resolvable, and per-item quarantine needed three failures per item, about 33 failed
boundaries, before the source was out of play. What it does:

- Every pool passes the source over: a pool with several sources alternates between the others, a pool
  with only this source plays the fallback, as when nothing is playable. The generic fallback (any
  ready asset, and the bridge after a failed preparation) passes the source's items over too; a global
  fallback asset is the operator's own pick and plays even if it belongs to the held source. An item
  already on air plays to its end. The schedule preview, the week lens and the overlay's next title show
  the pool without it; a week block whose pool has only held sources says so in its notes and is not
  listed under *Needs attention*.
- After the cooldown (30 minutes, doubled after every failed retry, at most 6 h) the source is
  half-open: the next pool pick from it is one trial item, and only that one is probed. A clean probe
  closes the breaker and the incident and resets the cooldown; a failed one holds the source again for
  twice as long. Nothing else counts while the cooldown runs.
- Per-item quarantine and *include in programming* are untouched. While the breaker holds a source,
  its `playout.source-unplayable.<sourceId>` incident is resolved and its quarantine count is in the
  breaker incident's message instead, so one broken source is one entry; it comes back once the
  breaker closes if items are still quarantined.
- When no pool could pick an item of the source anyway (every item quarantined, excluded or cooling
  down, or the source in no pool), the playout closes the breaker by itself: there is nothing to hold,
  and no trial could ever start. Its incident is resolved (*No pool could pick an item of this source
  anyway ...*), and the source's quarantine incident comes back with the action that helps: clear the
  quarantined items once the source is fixed. Deleting the source resolves its breaker incident too.
- The source page (*Held out of programming*) and the sources list show since when, the next probe
  and the last error. The asset page of an item of the source says so too.

What to do:

1. Read the last error on the source page. For YouTube, ask yt-dlp in the playout container
   (*A YouTube item leaves the air after a few seconds* above); for Twitch, check the archive and the
   VOD cache incidents.
2. Fix the cause (a newer image with a newer yt-dlp, `STREAM247_YOUTUBE_PLAYBACK_FORMATS`, a changed
   URL), then press **Close breaker now** on the source page (owner or admin; audit row
   `source.breaker.closed`). The pools take the source back at the next cycle; if it is still broken,
   the next three different failed items hold it again.
3. Or leave it: the breaker retries by itself and closes on the first clean probe.

An outage of the channel's own network does not hold a source (M82, next section): its failed probes
are not counted, and a trial that fails for that reason leaves a half-open breaker as it was, cooldown
not doubled, trial still available. What can still hold a healthy source is a network-looking failure
the playout could not attribute to the channel: the remote host down while the channel's output
connects, or a channel with no public output to ask. If the last error on the source page is a
name-resolution or connection error and the source answers again, press **Close breaker now**;
otherwise the hold costs one cooldown and closes by itself on the first clean probe. Log events:
`playout.source-breaker.opened`, `.reopened`, `.closed` (`sourceId`, `failedAssetIds`,
`cooldownSeconds`, `error`; a close because nothing was left to hold adds `reason: "no-pool-candidate"`).

### The channel's own network was down (probe outage)

Log event `playout.probe.network_outage`; no incident. While the host has no way out, every remote
probe fails (yt-dlp for YouTube and for a Twitch archive played from Twitch). Until M82 each of those
failures counted against the item and its source: a failed probe is retried after a minute, so an
outage of three minutes quarantined a healthy item for good, and three different items held their
source for 30 minutes. Now such a failure is counted by neither, when both of these hold:

- The error is a network one: name resolution, connecting, a timeout (including the playout's own
  `Command timed out after ...ms`), a TLS handshake that ended in nothing, or yt-dlp's
  `<urlopen error ...>` / `TransportError`. The image is Alpine, so the container words the first two
  the musl way: `[Errno -3] Try again` and `Name does not resolve` for a name that could not be
  resolved, `Network unreachable` and `Host is unreachable` for a host that could not be reached (yt-dlp
  2026.08.19 without a network: `Unable to download API page: [Errno -3] Try again (caused by
  TransportError(...))`). The glibc texts are recognised as well (`Temporary failure in name
  resolution`, `Name or service not known`, `Network is unreachable`, `No route to host`), and so are
  `getaddrinfo`, `Connection refused` and `Connection reset`. A bare `try again` is not: that is
  YouTube's rate limit answering. Anything the remote said is not: `Requested format is not available`,
  `Video unavailable`, private, removed, members-only, every HTTP status (403, 404, 410, 429 and 5xx
  alike), `Unsupported URL`, `Invalid data found`.
- The output the channel publishes to cannot be reached at that moment. The playout resolves the host
  of each enabled output (at most two, e.g. `live.twitch.tv:1935`) and opens one TCP connection to it,
  closed at once, 2.5 seconds at most. Only when none of them connects or answers is it an outage. It
  asks only when a network-looking failure is about to be counted, at most once per ten seconds, so a
  healthy channel never opens that connection. Outputs on the channel's own side (the relay, `localhost`,
  a private address, a name without a dot) are never asked: they prove nothing about the way out.
  "At that moment" is the moment the failure is counted, which is later than the moment its request
  failed: a resolve whose packets just vanish ends by the playout's own timeout, 60 seconds after it
  started (`STREAM247_PLAYABLE_INPUT_RESOLVE_TIMEOUT_SECONDS`). So an outage the check saw stands for
  that long after the output connects again, and the `corroboration` then names both
  (`live.twitch.tv:1935 connected, 45 s after live.twitch.tv:1935 unreachable (connect ETIMEDOUT)`).

What it changes and what it does not:

- `playback_probe_failures` of the item and the breaker of its source keep their values. The failure
  is not a success either: it resets nothing and closes no breaker.
- On air nothing changes. An item that could not be prepared is still not played, the fallback still
  covers, and `playout.prefetch.failed` still opens for the duration.
- A network-looking failure while an output connects counts as before: YouTube unreachable while
  Twitch takes the stream is a fault of the YouTube source. So does everything when the channel has no
  public output to ask.
- The output host stands for the way out. If that host alone is down (the ingest unreachable while
  the rest of the internet works), network-looking failures of every source go uncounted for as long
  as it lasts; a channel with two outputs on different hosts needs both unreachable.
- Not covered: a Twitch archive refused because its download failed during the outage. The refusal
  says *not cached yet*, whatever made the download fail, and counts as before (such an archive is
  normally passed over for the cache failure cooldown anyway).
- Not covered: a blip shorter than one resolve, with packets vanishing rather than refused. The one
  resolve it catches ends by its timeout when the output connects again, and nothing asked while the
  way out was down, so that one failure is counted: `playback_probe_failures` 1 with a `Command timed
  out` error on one item, no `playout.probe.network_outage` line for it. One failure reaches neither
  threshold (an item already at two is quarantined by it), and the next clean probe, a minute or two
  later, resets it. In the minute after an outage the reverse holds: a network-looking failure of a
  remote host that really is down goes uncounted until the grace has run out.

Reading the log, in the playout container:

```
docker compose logs --since 24h playout | grep '"playout.probe.network_outage"'
```

Each line has `assetId`, `sourceId`, `path` (`queue` for a prefetch probe, `selection` for the resolve
of the item about to start), `reason` (`dns`, `connect`, `timeout`, `tls`, `transport`),
`corroboration` (what the output said, e.g. `live.twitch.tv:1935 unreachable (connect ETIMEDOUT)`),
the first 300 characters of the `error`, and `unloggedSinceLastLine`: one line per item per five
minutes, the rest counted there. On the DUT expect `reason` `dns` or `connect` when the failure was
quick and `timeout` when packets vanished. After a nightly blip expect a few such lines, no
`playout.source-breaker.opened` in the same minutes, and unchanged `playback_probe_failures` on the
items named.

`playout.probe.network_outage.check_failed` (`error`, `unloggedSinceLastLine`; one line per five
minutes) means the check itself broke, not that the output was unreachable: there was no evidence
either way, so every failure was counted, as before M82. If an outage quarantined an item or held a
source although M82 is deployed, look for this line first.

### Is the broadcast channel live?

Check the **broadcast channel**, never the bot account's channel — the bot's channel is empty by design,
and its "offline" says nothing about the stream. Admin → Settings → Twitch accounts shows the broadcast
channel's live state; from the DUT:

```bash
docker exec stream247-playout-1 yt-dlp --simulate --print "%(is_live)s" https://www.twitch.tv/<broadcast channel>
```

Before touching the uplink because "the channel is offline", repeat that check against the broadcast
channel. The worker's `twitch.chat_settings.written` line names both accounts (`channelLogin`/`channelId`,
`botLogin`/`botId`); a refused bot connect is in the audit trail as `twitch.bot.rejected`.

### Secrets in the audit trail and incidents

Incidents and the audit trail store text through `redactSecrets`: a publish URL keeps its host and
path but loses the stream key (`rtmp://live.twitch.tv/app/<redacted>`), and passphrases, passwords and
tokens become `<redacted>`. Since M85 the audit trail redacts at the sink too, and the upgrade migration
`20261002_001_redact_stored_secrets_again` scrubs entries stored verbatim before. The scrub is one-way on
purpose; a rollback keeps the redacted rows.

### Media disk filling up

The worker watches free space on the media volume as a whole, above the per-cache guardrails.
Below the trigger watermark it evicts in stages, at most one stage per worker cycle: unused
Twitch VOD cache entries first, then orphaned program-feed segments, then the oldest thumbnails.
Eviction stops as soon as free space is back above the recovery watermark, and media the schedule,
queue or fallback tier still references is never touched.

- a `disk.watermark.evicted` warning incident names what was freed and why; no action is needed —
  the system is protecting itself
- a `disk.watermark.exhausted` critical incident means every stage ran and free space is still
  below the recovery watermark: nothing evictable is left, so free space manually (grow the
  volume, remove local media, or shrink the schedule's VOD footprint) before playout, feed
  segments or downloads start failing writes
- runtime events: `disk.watermark.stage`, `disk.watermark.recovered`, `disk.watermark.exhausted`,
  and `disk.watermark.check_failed` when the volume could not be measured
- tuning: `STREAM247_DISK_WATERMARK_TRIGGER_PERCENT` (default 10, percent free that starts an
  episode), `STREAM247_DISK_WATERMARK_RECOVER_PERCENT` (default 15, where it stops; must be above
  the trigger or both fall back to defaults), `STREAM247_DISK_WATERMARK_ENABLED=0` to disable

### Uplink is not publishing

- confirm `STREAM247_RELAY_ENABLED=1` and the `relay`, `playout`, and `uplink` containers are running
- confirm `STREAM247_UPLINK_INPUT_MODE=hls` unless you intentionally rolled back to the older MediaMTX relay input
- if an upgraded worker logs `column "uplink_status" of relation "playout_runtime" does not exist`, deploy a build that includes the persistent program-feed upgrade migration before restarting the soak
- inspect `program-feed.input`, `uplink.output.missing`, `uplink.process.exit`, and `uplink.ffmpeg.stderr` incidents
- check `/api/system/readiness` for `uplink.unplannedRestartCount` and `programFeed.status`
- if HLS warnings mention corrupt packets, discontinuities, or non-monotonic DTS but `uplink.unplannedRestartCount` stays unchanged and the feed remains fresh, investigate the local asset/input that caused the playout exit instead of reconnecting Twitch manually
- single-output and multi-output RTMP uplinks both run through tee/fifo buffering now; a short Twitch-side write failure should recover inside the same FFmpeg process when FFmpeg can re-open the output, and a real `uplink.process.exit` still means the Twitch-facing publisher actually restarted
- verify at least one enabled primary or backup destination has a valid RTMP URL and stream key
- use `STREAM247_RELAY_ENABLED=0` only as a rollback because it returns external publishing to the playout process
- since the relay checks credentials (M57 stage 2), the rtmp rollback paths (`STREAM247_RELAY_ENABLED=1`, `STREAM247_UPLINK_INPUT_MODE=rtmp`) additionally require the internal relay key embedded in `STREAM247_RELAY_OUTPUT_URL` / `STREAM247_RELAY_INPUT_URL`; get both lines ready to paste from Settings → Operations → **Relay access** (owner/admin, one click, audited as `relay.internal_key.revealed`), copy them into the deployment environment, then restart — see the push ingest section in `docs/deployment.md`
- the key never appears in a listing, a log, a scene payload or an error message, so a lost copy is re-fetched from that same group rather than recovered from anywhere else; if the group answers that the lines are unavailable, the workspace database is unreachable and that is the incident to fix first

## Seam Skew At Boundaries (since M61)

At every programme boundary the uplink's ffmpeg derives a new timestamp offset per stream. Measured
by hand across nine boundaries on 2026-09-05, the difference between the video offset and the audio
offset at the same seam was the one number that separated a discontinuity storm from a quiet
boundary: storms 11.84–13.45 s, quiet 1.07–6.69 s, with ffmpeg's `dts_delta_threshold` default of
10 s in the gap. Since 1.5.47 the uplink input carries `-dts_delta_threshold 60`; since M61 the
number is logged instead of read off `docker logs` by hand:

- `uplink.seam.skew` — `skewSeconds`, both offsets in microseconds, and the discontinuity line count
  of the current 60 s window. One line per seam.
- `playout.feed.av_lead` — at every duration-bound cut, the last audio and video packet times in the
  newest segment the outgoing encoder wrote, and `audioLeadSeconds`. This is the writer's view of the
  same seam; if it is near zero while the uplink reports a large skew, the seam is the reader's doing.

The boundaries themselves (when, which item handed over to which, natural end or duration bound) are
in the as-run log (*What was on air at a given time?*), so a storm in the uplink log can be put against
the seam that caused it after the playout logs are gone. To judge whether the 60 s threshold is doing
its job:

```bash
docker logs stream247-uplink-1 2>&1 | grep -E "uplink.seam.skew|discontinuity-storm" | tail -20
docker logs stream247-playout-1 2>&1 | grep "playout.feed.av_lead" | tail -20
```

A seam with `skewSeconds` above 10 and a `discontinuityCount` that stays in single digits is the
evidence the threshold works. A seam below 10 s proves nothing either way.

## Long-Run Container Baseline

Existing DUT soak notes after the persistent program-feed rollout showed the `web`, `worker`, `playout`, and `uplink` containers staying healthy with Docker restart counts at zero during the observed long run. The remaining failures were playout-runtime transients, not container restarts or Twitch uplink reconnects.

For future long runs, treat the baseline as:

- `web`, `worker`, and `playout` Docker restart counts should remain unchanged; the soak monitor fails if any of them increases by more than one during the soak window.
- `uplink.unplannedRestartCount` should remain unchanged; any increase means the Twitch-facing RTMP session probably reconnected outside the planned 48-hour reconnect.
- `sseConnections` may rise while operators keep Live, Channel, or Studio pages open, but it should return to zero after those clients disconnect.
- playout container memory should be checked with `docker stats` during multi-day soaks; the scene renderer runs in-process (satori → resvg, no child processes), so sustained RSS growth is actionable, while stable RSS with no restart-count increase is the expected baseline.

## Backup And Restore

### What To Back Up

- PostgreSQL database
- active deployment env file such as `.env` or `stack.env`
- `data/media`

### Before Every Upgrade

Create a PostgreSQL dump and copy the active env file.

Minimum expectation:

- database backup exists
- current image tags are known
- media library is preserved

### Restore Flow

1. Stop the stack.
2. Restore the active env file.
3. Restore the PostgreSQL dump.
4. Restore `data/media` if needed.
5. Start the previously known-good image tags.
6. Confirm:
   - setup is not shown again
   - `/api/system/readiness` returns expected service states
   - `/live?tab=control` and `/live?tab=status` show the prior runtime state
