# Architecture

## Service Topology

- `web`: Next.js admin UI, public pages, and API routes
- `worker`: ingestion, Twitch reconciliation, incidents, alerts, and playout supervision
- `playout`: playout runtime image used for FFmpeg-oriented broadcast execution
- `postgres`: durable relational state
- `redis`: transient runtime support and queue/lock-oriented infrastructure

## Persistence Model

Stream247 now uses PostgreSQL as the primary application store through `@stream247/db`.

Persisted domains include:

- initialization and owner bootstrap state
- users, Twitch identities, and team access grants
- moderation settings and presence windows
- overlay settings
- sources and assets
- schedule blocks
- Twitch connection state
- Twitch-managed schedule segment mappings
- stream destinations
- incidents and audit events
- playout runtime state

Legacy `data/app/state.json` is only treated as a one-time migration source when the database is empty.

## Delivery Model

- production Compose is image-based and intended to pull from GHCR
- development Compose remains build-based
- `main` pushes publish current GHCR images after validation
- `v*` tags publish versioned GHCR images

## Runtime Model

Stream247 works around three high-level state concepts:

- desired state:
  - schedule intent
  - moderation policy
  - Twitch metadata targets
  - operator overrides
- actual state:
  - currently selected asset
  - destination readiness
  - FFmpeg process metadata
  - Twitch connection state
  - open incidents
- reconciled state:
  - worker/playout logic continuously moves actual state toward desired state

## Broadcast Runtime

The current playout model is FFmpeg-based and supervisor-driven.

Persisted playout runtime fields include:

- status
- current asset
- desired asset
- current destination
- restart requests
- heartbeat timestamp
- process pid
- process start time
- last exit code
- restart count
- last error
- last stderr sample
- override mode
- override asset id
- override expiry
- skipped asset id
- skip expiry

Current playout status values:

- `idle`
- `starting`
- `running`
- `switching`
- `degraded`
- `recovering`
- `failed`

Asset selection precedence is currently:

1. active operator override
2. active scheduled source mapping
3. global fallback asset
4. any ready asset

## Source Ingestion

Current source connectors:

- local media library scan
- direct media URL normalization
- YouTube playlist ingestion via `yt-dlp`
- Twitch VOD ingestion via `yt-dlp`

Assets are normalized into a PostgreSQL-backed catalog and then selected by the playout runtime.

## Scheduling

The schedule model is block-based and timezone-aware.

Current schedule capabilities:

- minute-accurate block start times
- duration validation
- overlap detection
- public schedule preview
- drag/drop day timeline repositioning

The scheduler is deterministic and explainable: schedule preview items carry explicit source/reason information.

## Twitch Integration

Current Twitch domains:

- broadcaster OAuth connection
- team SSO login
- title sync from active schedule block
- category lookup and sync from active schedule block
- Twitch schedule segment sync for upcoming blocks
- moderation-related chat mode updates

When Twitch reconciliation fails, Stream247 raises incidents instead of failing silently.

## Operator Controls

Current operator controls include:

- restart encoder
- temporary fallback
- pin specific asset on air
- skip current asset
- resume schedule control

Those controls are persisted in the playout runtime state and picked up by the worker/playout reconciliation loop.

## Overlay Model

Overlay is currently implemented as a browser-source page, not native FFmpeg scene composition.

Current overlay capabilities:

- channel name
- headline
- accent color
- emergency banner
- clock toggle
- now/next teaser toggle
- schedule teaser toggle

The admin UI manages these settings; the public overlay page renders them for OBS/browser-source usage.

## Alerting And Incidents

Current operational domains:

- incidents
- acknowledgements
- resolution state
- audit events
- Discord alerts
- SMTP email alerts
- health/readiness endpoints

## Major Known Gaps

- encrypted secret management from the admin/setup UI
- richer multi-scene overlay composition
- more advanced playout transitions and switchovers
- deeper incident history and analytics views
- richer schedule authoring directly in the timeline
