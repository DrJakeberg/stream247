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
- if the playout container accumulates zombie Chromium or crashpad processes, recreate it after deploying an image that runs Node under the configured init process
- if the soak monitor reports `container-restart-check-failed`, inspect `docker compose ps`, `docker inspect --format '{{.RestartCount}}'`, and recent logs for `web`, `worker`, and `playout` before restarting the soak

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
- keep remote Twitch fallback disabled unless you intentionally accept direct remote VOD playback risk
- confirm fallback assets exist

### Uplink is not publishing

- confirm `STREAM247_RELAY_ENABLED=1` and the `relay`, `playout`, and `uplink` containers are running
- confirm `STREAM247_UPLINK_INPUT_MODE=hls` unless you intentionally rolled back to the older MediaMTX relay input
- if an upgraded worker logs `column "uplink_status" of relation "playout_runtime" does not exist`, deploy a build that includes the persistent program-feed upgrade migration before restarting the soak
- inspect `program-feed.input`, `uplink.output.missing`, `uplink.process.exit`, and `uplink.ffmpeg.stderr` incidents
- check `/api/system/readiness` for `uplink.unplannedRestartCount` and `programFeed.status`
- if HLS warnings mention corrupt packets, discontinuities, or non-monotonic DTS but `uplink.unplannedRestartCount` stays unchanged and the feed remains fresh, investigate the local asset/input that caused the playout exit instead of reconnecting Twitch manually
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
