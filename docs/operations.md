# Operations

## Primary Surfaces

- `/dashboard` for current broadcast state and operator actions
- `/ops` for incidents, drift checks, and audit visibility
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

- open `/ops`
- inspect `selectionReasonCode`
- inspect `fallbackTier`
- inspect destination readiness
- inspect last FFmpeg stderr sample
- inspect `restartCount`, `lastExitCode`, and `crashCountWindow` in `/api/system/readiness` or the soak monitor log
- distinguish planned reconnects from recovery: planned reconnects report `selectionReasonCode=scheduled_reconnect`, while FFmpeg failures usually increment `restartCount` with a signal or exit code such as `SIGBUS`, `128`, or `8`
- in HLS program-feed mode, treat `playoutTransient=true` as a local playout recovery window, not a Twitch reconnect, as long as `uplinkStatus=running`, `programFeed=fresh`, `destination=ok`, and `uplinkUnplannedRestarts` has not increased
- if the playout container accumulates zombie Chromium or crashpad processes, recreate it after deploying an image that runs Node under the configured init process

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
- review Twitch incidents in `/ops`

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
