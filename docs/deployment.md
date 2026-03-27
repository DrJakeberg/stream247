# Deployment

## Production Profile

Recommended production shape:

- Linux host
- Docker Compose
- reverse proxy in front of `web`
- persistent storage for:
  - PostgreSQL
  - Redis
  - `data/media`

Stream247 is currently designed as a self-hosted single-workspace deployment.

## Deploy Steps

1. Copy `.env.example` to `.env`.
2. Set:
   - `APP_URL`
   - `APP_SECRET`
   - `POSTGRES_PASSWORD`
   - matching `DATABASE_URL`
3. Optional but recommended:
   - `TWITCH_STREAM_KEY`
   - `CHANNEL_TIMEZONE`
   - Discord / SMTP alert settings
4. Optionally pin:
   - `STREAM247_WEB_IMAGE`
   - `STREAM247_WORKER_IMAGE`
   - `STREAM247_PLAYOUT_IMAGE`
5. Start the stack:
   ```bash
   docker compose up -d
   ```
6. Open `/setup`.
7. Create the owner account.
8. Sign in to the admin UI.
9. Optional:
   - enter `TWITCH_CLIENT_ID` and `TWITCH_CLIENT_SECRET` during setup
   - or add them later in `/settings`
10. Connect Twitch from the dashboard if you want Twitch metadata sync, Twitch schedule sync, or team SSO.
11. Add playable media:
   - files in `data/media`
   - direct media URL sources
   - YouTube playlist sources
   - Twitch VOD sources
12. Build schedule blocks and let the worker ingest and reconcile.

## Reverse Proxy And URL Notes

- `APP_URL` must be the real externally reachable base URL.
- Twitch OAuth will fail if `APP_URL` and the registered Twitch redirect URLs do not match.
- In real production, HTTPS is strongly recommended because Twitch OAuth and browser sessions should not run over plain HTTP on the public internet.

## Secrets And Runtime Settings

Belongs in `.env`:

- `POSTGRES_PASSWORD`
- `TWITCH_STREAM_KEY`
- `STREAM_OUTPUT_KEY`
- `CHANNEL_TIMEZONE`
- optional fallback Twitch client credentials
- optional fallback SMTP credentials
- optional fallback Discord webhook URL

Does not belong in `.env`:

- moderator presence settings
- schedule blocks
- sources and assets
- operator overrides
- overlay settings
- incidents and acknowledgements

Those are runtime settings managed from the UI and stored in PostgreSQL.

Important current limitation:

- third-party secrets can now be stored encrypted at rest in PostgreSQL from the admin UI
- `.env` is still supported as bootstrap/fallback input for self-hosted deployments
- stream keys remain deployment-time secrets in `.env`

## Media And Persistence

- local media is read from `data/media`
- PostgreSQL and Redis must use persistent volumes
- deleting your database volume resets workspace state
- deleting `data/media` removes locally mounted playable files

## GHCR Images

Production Compose is intended to pull from:

- `ghcr.io/drjakeberg/stream247-web:<tag>`
- `ghcr.io/drjakeberg/stream247-worker:<tag>`
- `ghcr.io/drjakeberg/stream247-playout:<tag>`

Default `.env.example` uses `latest`.
Pinning explicit tags is safer for stable deployments.

## Release Flow

- `push` to `main`:
  - validate
  - build
  - smoke-test
  - publish `latest` and branch/SHA-tagged images
- `push` of `v*` tags:
  - release workflow
  - versioned GHCR images

CI currently builds against the public ECR mirror for `node:22-alpine` to avoid Docker Hub rate limits on GitHub-hosted runners.

## Current Capability Notes

- local media, direct media URLs, YouTube playlists, and Twitch VODs are ingestible today
- YouTube and Twitch ingestion rely on `yt-dlp`
- schedule blocks support CRUD, overlap validation, and drag/drop day timeline repositioning
- playout supports operator restart, temporary fallback, asset pinning, skip-current, and resume-schedule actions
- overlay is currently a browser-source page, not native FFmpeg scene composition
- email and Discord alert delivery are both implemented
- managed secret storage in `/settings` is implemented for Twitch and alert credentials
