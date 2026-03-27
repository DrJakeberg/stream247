# Architecture

## Services

- `web`: Next.js admin UI, public schedule pages, lightweight API endpoints
- `worker`: background jobs for ingestion, Twitch sync, alerts, and reconciliation
- `playout`: FFmpeg-based stream process manager
- `postgres`: relational state
- `redis`: queues, locks, transient runtime state

## Current Alpha Persistence

- The installable alpha persists initialization state, owner account, moderation settings, active moderator windows, and Twitch connection metadata in `data/app/state.json`.
- PostgreSQL and Redis remain in the stack for the planned runtime architecture, but the onboarding slice currently uses file-backed persistence so the setup wizard can run end to end before the full data layer is introduced.

## Core Runtime Model

- Desired state: generated schedule, moderation policy, Twitch metadata targets
- Actual state: currently running playout item, platform settings, active incidents
- Reconciler: background logic that drives actual state toward desired state

## Key Domains

- Users and roles
- Sources and source credentials
- Assets, playlists, and schedule blocks
- Playout queue and operator overrides
- Alerts, incidents, and audit events
- Twitch destination and moderation policies
