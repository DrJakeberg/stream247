# Deployment

## Production Profile

Recommended production shape:

- Linux host
- Docker Compose
- reverse proxy in front of `web`
- optional built-in Traefik profile for HTTPS and Let's Encrypt
- persistent storage for:
  - PostgreSQL
  - Redis
  - `data/media`

Stream247 is currently designed as a self-hosted single-workspace deployment.

## Deploy Steps

1. Choose your base env file:
   - evaluation:
     ```bash
     cp .env.example .env
     ```
   - production:
     ```bash
     cp .env.production.example .env
     ```
2. Set:
   - `APP_URL`
   - `APP_SECRET`
   - `POSTGRES_PASSWORD`
   - matching `DATABASE_URL`
   - `TRAEFIK_HOST` and `TRAEFIK_ACME_EMAIL` if using the built-in Traefik profile
3. Optional but recommended:
   - `TWITCH_STREAM_KEY`
   - `CHANNEL_TIMEZONE`
   - Discord / SMTP alert settings
   - Twitch client credentials if you do not want to enter them later in setup or `/settings`
4. Optionally pin:
   - `STREAM247_WEB_IMAGE`
   - `STREAM247_WORKER_IMAGE`
   - `STREAM247_PLAYOUT_IMAGE`
   Recommended for production:
   - explicit version tags, not `latest`
5. Start the stack:
   ```bash
   docker compose up -d
   ```
   Or with built-in Traefik and automatic HTTPS:
   ```bash
   docker compose --profile proxy up -d
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
- If you use the built-in Traefik profile, set:
  - `APP_URL=https://<TRAEFIK_HOST>`
  - `TRAEFIK_HOST=<same-hostname>`
  - `TRAEFIK_ACME_EMAIL=<your-email>`
- The built-in Traefik profile leaves direct port `3000` publishing enabled for easier first-time recovery and debugging. If you want a proxy-only surface, remove the `web.ports` entry locally.

## Secrets And Runtime Settings

Belongs in `.env`:

- `POSTGRES_PASSWORD`
- `TWITCH_STREAM_KEY`
- `STREAM_OUTPUT_KEY`
- `CHANNEL_TIMEZONE`
- `APP_URL`
- `APP_SECRET`
- `TRAEFIK_HOST`
- `TRAEFIK_ACME_EMAIL`
- optional fallback Twitch client credentials
- optional fallback SMTP credentials
- optional fallback Discord webhook URL
- optional deployment-level output overrides (`STREAM_OUTPUT_WIDTH`, `STREAM_OUTPUT_HEIGHT`, `STREAM_OUTPUT_FPS`)
- optional engagement flags (`STREAM_CHAT_OVERLAY_ENABLED`, `STREAM_ALERTS_ENABLED`, `TWITCH_EVENTSUB_SECRET`)

Does not belong in `.env`:

- moderator presence settings
- schedule blocks
- sources and assets
- operator overrides
- overlay settings
- incidents and acknowledgements
- saved output profile settings

Those are runtime settings managed from the UI and stored in PostgreSQL.

Important current limitation:

- third-party secrets can now be stored encrypted at rest in PostgreSQL from the admin UI
- `.env` is still supported as bootstrap/fallback input for self-hosted deployments
- stream keys remain deployment-time secrets in `.env`
- infrastructure and reverse-proxy settings always stay in `.env`

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
- `bluenviron/mediamtx:<tag>` for the local RTMP relay

`.env.example` uses `latest` for evaluation.
`.env.production.example` pins `v1.1.2` for stable deployment.
See:

- `docs/versioning.md`
- `docs/upgrading.md`
- `docs/backup-and-restore.md`
- `docs/operations.md`

Recommended pre-release commands:

- `pnpm release:preflight`
- `./scripts/upgrade-rehearsal.sh <target-version>`
- `./scripts/soak-monitor.sh --hours 24`

## Release Flow

- `push` to `main`:
  - validate
  - build
  - smoke-test
  - publish `latest` and branch/SHA-tagged images
- `push` of `v*` tags:
  - pull the CI-published `main-<sha>` snapshot images for the tagged commit
  - smoke-test them before push
  - retag and publish those same tested images as the versioned GHCR artifacts

`./scripts/upgrade-rehearsal.sh <target-version>` follows the same artifact model. If the requested `v*` images already exist, it rehearses against them directly. Before the version tag exists, it falls back to the CI-published `main-<sha>` snapshot for the current commit. Set `UPGRADE_REHEARSAL_IMAGE_TAG=main-<sha>` if you need to force a specific pre-release snapshot explicitly.

Production `traefik`, `web`, `worker`, `relay`, `playout`, `uplink`, `postgres`, and `redis` services now use `restart: unless-stopped` in `docker-compose.yml`, so the documented always-on Compose paths, including `docker compose --profile proxy up -d`, recover their stack processes after daemon and host restarts.

The worker-family image uses a small init process before Node so long-running playout containers reap short-lived Chromium scene-renderer children. Worker, playout, and uplink Docker healthchecks use 45-second intervals/timeouts and a 60-second start period because FFmpeg and scene rendering can briefly saturate the playout container during normal broadcast operation.

Planned output reconnects default to every 48 hours. Set `PLAYOUT_RECONNECT_HOURS` only when the deployment needs a different Twitch reconnect cadence; `PLAYOUT_RECONNECT_SECONDS` controls the short standby window used during that planned reconnect.

Production Compose enables the program-feed/uplink split by default. `playout` writes a rolling HLS feed under `STREAM247_PROGRAM_FEED_DIR`, and the `uplink` worker reads that local feed before publishing to the configured primary/backup outputs. The default `STREAM247_PROGRAM_FEED_TARGET_SECONDS=2` and `STREAM247_PROGRAM_FEED_LIST_SIZE=30` keep about 60 seconds of feed buffer so normal asset boundaries do not close the external RTMP session. HLS segments are written with temporary files, epoch-based segment numbers, and discontinuity markers so the uplink can continue across normal item handoffs. Set `STREAM247_UPLINK_INPUT_MODE=rtmp` only to roll back to the older MediaMTX relay input, and set `STREAM247_RELAY_ENABLED=0` only as a rollback to the previous direct playout-to-destination path.

Readiness and the soak monitor now separate Twitch/output continuity from short local playout failures in HLS program-feed mode. If `uplink` is running, the destination is ready, the program feed is fresh, and crash-loop protection is not active, a local `playout` failure is treated as a transient for `STREAM247_PLAYOUT_TRANSIENT_GRACE_SECONDS` seconds. The default grace is the larger of 20 seconds or `STREAM247_PROGRAM_FEED_FAILOVER_SECONDS`. Uplink failures, stale program feeds, destination degradation, crash loops, new unplanned uplink restarts, and repeated Docker restarts for `web`, `worker`, or `playout` still fail the soak. The readiness API also reports `sseConnections` so long-running installs can see whether browser or overlay event streams are being cleaned up after clients disconnect.

Twitch VOD playback is cache-backed by default. The worker stores verified Twitch archive media under `MEDIA_LIBRARY_ROOT/.stream247-cache/twitch`, preserves the original Twitch URL on the asset record, and keeps the internal cache out of local library scans. If a Twitch VOD cannot be cached, playout uses the standby slate instead of attempting unstable remote archive playback. Set `TWITCH_VOD_CACHE_ALLOW_REMOTE_FALLBACK=1` only as a temporary rollback.

Output settings are available in `/output` with built-in profiles for 720p30, 1080p30, 480p30, and 360p30 plus a custom mode. The saved profile is stored in PostgreSQL and applies when the playout worker starts its next FFmpeg process. Deployment-level `STREAM_OUTPUT_WIDTH`, `STREAM_OUTPUT_HEIGHT`, and `STREAM_OUTPUT_FPS` override the saved profile for standby slate generation, scene-renderer capture size, and FFmpeg output normalization. `SCENE_RENDER_WIDTH` and `SCENE_RENDER_HEIGHT` still have precedence for scene capture if you need a temporary render-specific override. Set `STREAM_SCALE_ENABLED=0` only as a rollback if the scale/pad/fps filter causes unexpected encoder load.

In-stream engagement is available from `/overlays` and is disabled by default. Both the database setting and the deployment flag must be enabled before anything renders in the captured overlay: set `STREAM_CHAT_OVERLAY_ENABLED=1` for Twitch IRC chat and `STREAM_ALERTS_ENABLED=1` for follow/sub alerts. EventSub webhooks post to `/api/overlay/events`; production deployments should set `TWITCH_EVENTSUB_SECRET` and must expose `APP_URL` over reachable HTTPS for Twitch to deliver follow/sub notifications. Localhost-only installs can use the admin preview and chat settings, but cannot receive Twitch EventSub webhooks from the public internet.

CI currently builds against the public ECR mirror for `node:22-alpine` to avoid Docker Hub rate limits on GitHub-hosted runners.

## Current Capability Notes

- Admin navigation is grouped by operator workflow: `Control Room` for live operations and health, `Programming` for schedule/library work, `Stream Studio` for scenes/overlays/output, and `Workspace` for settings, moderation, and team access.
- local media, direct media URLs, YouTube playlists/channels, and Twitch VODs/channels are ingestible today
- Twitch VOD playout uses verified local cache files by default and falls back to standby when cache preparation fails
- program-feed/uplink mode separates program playout restarts and asset boundaries from the external RTMP publishing worker
- YouTube and Twitch ingestion rely on `yt-dlp`
- schedule blocks support weekly CRUD, reusable show profiles, multi-day creation, overlap validation, drag/drop repositioning, resize-to-change-duration editing, weekly coverage summaries, and quick-start programming templates
- pools are first-class programming units for round-robin playout selection
- sources can be edited in place and the asset catalog can be searched by title, source, and status
- playout supports operator restart, temporary fallback, asset pinning, skip-current, and resume-schedule actions
- overlay is currently a browser-source page with replay labeling, current/next context, and admin-managed branding
- optional chat and follow/sub engagement overlays render through the same captured browser overlay when explicitly enabled
- email and Discord alert delivery are both implemented
- managed secret storage in `/settings` is implemented for Twitch and alert credentials
- setup and dashboard expose a guided go-live checklist based on the current workspace state
