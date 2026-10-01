# Operations

## Primary Surfaces

- `/live?tab=control` for current broadcast state and operator actions
- `/live?tab=status` for incidents, drift checks, destination health, and audit visibility
- `/live?tab=moderation` for moderation presence and check-in history
- `/api/health` for basic service health
- `/api/system/readiness` for broadcast readiness and drift-relevant status

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
  next source's next item plays, as it would have at the item's end)
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
  by hand can still come round as the pool's next item. Both take a queued Move next out.
- Play now and Play insert are refused for the item already on air (with the relay, Restart plays it
  again from its beginning), while a Pin or Fallback holds the air (it comes before an insert; Resume
  first), for an item held out by a Skip or Remove next (Resume clears the hold), and for a Twitch
  archive that is not downloaded yet while *While a replay is still downloading, play it from Twitch*
  (Settings → Operations → Replay cache) is off: the playout never waits for a download, so it could
  not start it. An archive too large to cache streams from Twitch and is accepted.
- An insert that is cleared before it aired is logged as the runtime event `playout.insert.dropped`
  and an audit row of the same name, with a `reason`: `preempted` (a Pin or Fallback is running),
  `unavailable` (the item is no longer ready or is skip-held), `prepare-failed` (it could not be
  resolved; the item on air stays on air, the error is in the entry), `start-failed`,
  `destination-missing`. The admin adds an audit row (no runtime event) when the operator drops a
  pending insert: `replaced` by a newer Play now, `cancelled` by Resume schedule.
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
  its end as the pool's item, and any other item gives way to the pool's next item.
- **Resume schedule** clears a Pin or Fallback, a pending or running Play now / insert, a queued Move
  next and a skip hold, and is enabled while a Pin, a Fallback or an insert is in effect. With the relay
  the next cycle hands back to the pool: a running insert gives way to the pool's next item (if that is
  the insert's item itself, it plays on and counts as the pool's item), a pinned pool item plays on.
  Without the relay the slate comes first, then the pool's next item.
- **Skip current** holds the item on air out for the override minutes and moves on to the pool's next
  item (or a queued Move next): with the relay at once, without it after the slate. Skip does not end a
  running Pin or Fallback: the pinned item starts again from its beginning (also after a passed chat
  skip vote), so Resume first.
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

## Symptoms And Immediate Actions

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
  `playout.source-unplayable.<sourceId>`; its asset page can clear the failures once it is fixed.

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

To judge whether the 60 s threshold is doing its job:

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
