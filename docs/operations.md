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
- skip current asset
- resume schedule control
- acknowledge and resolve incidents

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
- if the playout container accumulates zombie Chromium or crashpad processes, recreate it after deploying an image that runs Node under the configured init process
- if the soak monitor reports `container-restart-check-failed`, inspect `docker compose ps`, `docker inspect --format '{{.RestartCount}}'`, and recent logs for `web`, `worker`, and `playout` before restarting the soak

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
  while cutting real content is not

### Crash-loop protection active

- inspect the latest playout incidents
- verify stream destination and selected asset
- request a manual restart only after the cause is understood

### Destination cooling down or staged

- inspect the destination panel in `/broadcast` for cooldown timers, staged outputs, and the latest failure sample
- let the next natural transition bring staged outputs back when continuity is more important than immediate fanout recovery
- use `Recover outputs now` only when an immediate encoder restart is acceptable

### Twitch sync unhealthy

- confirm broadcaster connection
- check managed credentials or `.env` fallback
- review Twitch incidents in `/live?tab=status`

### No playable asset

- verify local media exists or remote sources ingest correctly
- confirm source incidents
- for Twitch VOD assets, inspect `playout.twitch-cache.failed` incidents and confirm `MEDIA_LIBRARY_ROOT/.stream247-cache/twitch` is writable with enough free space
- if playout stays on the reconnect slate while a Twitch VOD is still downloading, inspect the playout container for active `yt-dlp` work and prune leftover `.part-*` files for the same VOD; the production timeout should stay low enough that playout falls through to local fallback instead of waiting for a multi-minute cache prep
- keep at least one curated local fallback asset under `data/media` with `fallback` or `standby` in the file name so the local-library source promotes it to a global fallback automatically
- confirm the Twitch cache guardrail env values are present in the active stack:
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

## Long-Run Container Baseline

Existing DUT soak notes after the persistent program-feed rollout showed the `web`, `worker`, `playout`, and `uplink` containers staying healthy with Docker restart counts at zero during the observed long run. The remaining failures were playout-runtime transients, not container restarts or Twitch uplink reconnects.

For future long runs, treat the baseline as:

- `web`, `worker`, and `playout` Docker restart counts should remain unchanged; the soak monitor fails if any of them increases by more than one during the soak window.
- `uplink.unplannedRestartCount` should remain unchanged; any increase means the Twitch-facing RTMP session probably reconnected outside the planned 48-hour reconnect.
- `sseConnections` may rise while operators keep Live, Channel, or Overlay pages open, but it should return to zero after those clients disconnect.
- Chromium renderer memory should be checked from the playout container with `docker stats` during multi-day soaks; sustained growth plus stale scene renderer children is actionable, while stable RSS with no restart-count increase is the expected baseline.

## Backup And Restore

### What To Back Up

- PostgreSQL database
- active deployment env file such as `.env` or `stack.env`
- `data/media`

Redis is not a primary durability source and does not need to be treated as a release-critical backup target.

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
