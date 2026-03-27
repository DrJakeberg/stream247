# Architecture

## Services

- `web`: Next.js admin UI, public schedule pages, lightweight API endpoints
- `worker`: background jobs for ingestion, Twitch sync, alerts, and reconciliation
- `playout`: FFmpeg-based stream process manager
- `postgres`: relational state
- `redis`: queues, locks, transient runtime state

## Current Persistence

- The runtime persists workspace state in PostgreSQL through the `@stream247/db` package.
- Initialization, users, Twitch SSO/team access, moderation settings, presence windows, sources, assets, incidents, destinations, and playout runtime are all stored in relational tables.
- The old `data/app/state.json` path is only used as a one-time legacy migration source when a database is empty.

## Current Delivery Model

- Production Compose is image-based and intended to pull from GHCR.
- Pushes to `main` publish `latest` and `main-<sha>` images to GHCR after validation and smoke tests succeed.
- GitHub release tags publish versioned images to GHCR.
- Development Compose remains build-based for local iteration.

## Core Runtime Model

- Desired state: generated schedule, moderation policy, Twitch metadata targets
- Actual state: currently running playout item, FFmpeg process metadata, destination readiness, platform settings, active incidents
- Reconciler: background logic that drives actual state toward desired state

## Broadcast Runtime

- `worker` runs reconciliation for local media ingestion, direct-media normalization, Twitch metadata sync, destination validation, and alert generation.
- `playout` runs a supervised FFmpeg loop with a persisted playout state machine:
  - `idle`
  - `starting`
  - `running`
  - `switching`
  - `degraded`
  - `recovering`
  - `failed`
- Asset selection prefers scheduled content first, then global fallback assets, then any ready asset.
- Runtime state stores process PID, start time, restart count, current/desired asset, destination, last exit code, and the last captured stderr sample.

## Key Domains

- Users and roles
- Sources and source credentials
- Assets, playlists, and schedule blocks
- Stream destinations, playout queue, and operator overrides
- Alerts, incidents, and audit events
- Twitch destination and moderation policies
