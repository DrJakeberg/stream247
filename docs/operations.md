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
- crash-loop protection state
- open critical incidents

## Common Operator Actions

- restart encoder
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

### Crash-loop protection active

- inspect the latest playout incidents
- verify stream destination and selected asset
- request a manual restart only after the cause is understood

### Twitch sync unhealthy

- confirm broadcaster connection
- check managed credentials or `.env` fallback
- review Twitch incidents in `/ops`

### No playable asset

- verify local media exists or remote sources ingest correctly
- confirm source incidents
- confirm fallback assets exist
