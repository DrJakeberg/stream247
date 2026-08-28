# Deployment

## Production Profile

Recommended production shape:

- Linux host
- Docker Compose managed through Portainer on DT
- reverse proxy in front of `web`
- optional built-in Traefik profile for HTTPS and Let's Encrypt
- persistent storage for:
  - PostgreSQL
  - `data/media`

Stream247 is currently designed as a self-hosted single-workspace deployment.

## Deployment Control Planes

Stream247 uses three distinct control surfaces:

- the repo is the source of truth for code, Compose files, scripts, and pinned example image refs
- Portainer on DT is the deployment control plane that applies stack changes
- DT is the validation/testing environment for readiness checks, rehearsals, long soaks, release candidates, and destructive validation
- DUT is the production/stable environment running the accepted baseline

Editing the local `docker-compose.yml` or `.env.production.example` does not change production by itself. Production changes happen when the DT Portainer stack is updated and redeployed with the intended image refs.

## Operating Policy (since v1.5.19)

- **v1.5.19 is the accepted production baseline.** DUT runs v1.5.19.
- v1.5.19 was rolled to DUT directly as an emergency fix under the clause below: v1.5.17 had left
  the playout container in a restart loop (423 restarts, one every ~5 minutes) with the program
  pinned to fallback content. See the 1.5.18 entry in `CHANGELOG.md`.
- **DUT is production/stable.** Do NOT use DUT for experiments, soak tests, release candidates, or risky/destructive validation.
- **All future testing, release candidates, experiments, and destructive validation happen on DT only.**
- **DUT may be touched only for** explicit production maintenance, emergency fixes, or an approved final release rollout *after* it has passed validation on DT.
- Release surface: `v1.5.17` (previous baseline) and `v1.5.19` (current baseline; the `v1.5.18` tag exists but published no images), one Git tag and one GitHub Release each, with matching GHCR package versions per image (`stream247-web/worker/playout`).

## Deploy Steps

1. Optionally choose a base env file. Since M52 the stack also starts with no `.env` at all: the
   app secret is generated on first boot and persisted on the data volume, the bundled Postgres
   uses its compose-internal defaults, and the `/setup` wizard covers the public URL, timezone,
   and Twitch credentials. An env file remains the way to pin any of these — env values always
   override wizard-written ones.
   - evaluation:
     ```bash
     cp .env.example .env
     ```
   - production:
     ```bash
     cp .env.production.example .env
     ```
2. If you use an env file, set what you want pinned:
   - `APP_URL` (otherwise the wizard manages it)
   - `APP_SECRET` (otherwise generated and persisted on first boot)
   - `POSTGRES_PASSWORD` and a matching `DATABASE_URL` (otherwise the bundled defaults apply)
   - `TRAEFIK_HOST`, plus `TRAEFIK_ACME_EMAIL` if using the built-in Traefik Let's Encrypt profile
3. Optional but recommended:
   - `TWITCH_STREAM_KEY`
   - `CHANNEL_TIMEZONE` (otherwise the wizard manages it)
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
6. Open `/setup` and follow the wizard: owner account → instance basics (public URL, timezone) →
   Twitch app credentials → Twitch connection → review. Every step after the owner account is
   skippable and the wizard resumes at the first unfinished step, because completion is derived
   from what is actually configured rather than from a stored counter.
7. Any skipped value can be finished later: reopen `/setup` while signed in, or use `/settings`
   for the Twitch credentials.
8. Open `Live → Status` and use `Connect Twitch` if you want Twitch metadata sync or team SSO. Only leave Twitch schedule sync enabled when the broadcaster account can create non-recurring Twitch schedule segments.
9. Add playable media:
   - files in `data/media`
   - direct media URL sources
   - YouTube playlist sources
   - Twitch VOD sources
10. Build schedule blocks and let the worker ingest and reconcile.

## Reverse Proxy And URL Notes

- `APP_URL` must be the real externally reachable base URL.
- Twitch OAuth will fail if `APP_URL` and the registered Twitch redirect URLs do not match.
- In real production, HTTPS is strongly recommended because Twitch OAuth and browser sessions should not run over plain HTTP on the public internet.
- If you use the built-in Traefik profile, set:
  - `APP_URL=https://<TRAEFIK_HOST>`
  - `TRAEFIK_HOST=<same-hostname>`
  - `TRAEFIK_ACME_EMAIL=<your-email>` when the built-in ACME resolver is active
- The built-in Traefik profile leaves direct port `3000` publishing enabled for easier first-time recovery and debugging. If you want a proxy-only surface, remove the `web.ports` entry locally.

## Secrets And Runtime Settings

Belongs in `.env` (since M52 as pins, not requirements: `APP_URL` and `CHANNEL_TIMEZONE` are
wizard-managed and `APP_SECRET` is generated and persisted on the data volume when unset —
`data/media/.stream247-app-secret`, mode 600, shared by all service containers):

- `POSTGRES_PASSWORD`
- `TWITCH_STREAM_KEY`
- `STREAM_OUTPUT_KEY`
- `CHANNEL_TIMEZONE`
- `APP_URL`
- `APP_SECRET`
- `TRAEFIK_HOST`
- `TRAEFIK_ACME_EMAIL` when the built-in ACME resolver is active
- optional fallback Twitch client credentials
- optional fallback SMTP credentials
- optional fallback Discord webhook URL
- optional deployment-level output overrides (`STREAM_OUTPUT_WIDTH`, `STREAM_OUTPUT_HEIGHT`, `STREAM_OUTPUT_FPS`)
- optional engagement flags (`STREAM_CHAT_OVERLAY_ENABLED`, `STREAM_ALERTS_ENABLED`, `TWITCH_EVENTSUB_SECRET`)

Does not belong in `.env`:

- moderation presence settings
- schedule blocks
- sources and assets
- operator overrides
- overlay settings
- incidents and acknowledgements
- saved output profile settings

Those are runtime settings managed from the UI and stored in PostgreSQL.

Important current limitation:

- external-service secrets can now be stored encrypted at rest in PostgreSQL from the admin UI
- `.env` is still supported as bootstrap/fallback input for self-hosted deployments
- stream keys remain deployment-time secrets in `.env`
- infrastructure and reverse-proxy settings always stay in `.env`

## Media And Persistence

- local media is read from `data/media`
- PostgreSQL must use a persistent volume
- deleting your database volume resets workspace state
- deleting `data/media` removes locally mounted playable files

### Removed Redis Service

Stacks deployed before this release ran a `redis` container. No part of Stream247
ever connected to it — it was provisioned in Compose but never had a client. It is
gone from `docker-compose.yml`.

What an operator sees at the next stack update: the `redis` container is stopped and
removed, and the stack comes up with one service fewer. Its bind mount `./data/redis`
stays behind on disk as an empty leftover directory and can be deleted by hand at any
time. There is no data migration and no backup step, because nothing ever wrote to it.
`REDIS_URL` is no longer read anywhere; leaving it in an existing `stack.env` or `.env`
is harmless, and it can be dropped at the next edit.

## GHCR Images

Production Compose is intended to pull from:

- `ghcr.io/drjakeberg/stream247-web:<tag>`
- `ghcr.io/drjakeberg/stream247-worker:<tag>`
- `ghcr.io/drjakeberg/stream247-playout:<tag>`
- `bluenviron/mediamtx:<tag>` for the local RTMP relay

`.env.example` uses `latest` for evaluation.
`.env.production.example` pins the current baseline (`v1.5.19`) for stable deployment.
See `docs/operations.md` for the runbook and backup procedures.

## Canonical Release And Rollout Flow

Every release follows the same order:

1. **Prepare and validate in the repo**
   - run `pnpm validate`
   - run `pnpm release:preflight`
   - run `./scripts/upgrade-rehearsal.sh <target-version>`
   - fix failing gates before tagging
2. **Publish GHCR artifacts**
   - `main` publishes `main-<sha>` snapshot images
   - `v*` tags publish the versioned release images
3. **Update the DT Portainer stack**
   - change the stack environment so the image refs match the intended release tags
   - redeploy the stack from Portainer on DT
4. **Verify DT matches the pinned release**
   - run `./scripts/portainer-stack-check.sh` with read-only Portainer API credentials
   - confirm the running DT stack resolves to the same image digests as `.env.production.example`
5. **Validate on DUT**
   - SSH to DUT and run readiness checks against the active deployment path
   - run `./scripts/upgrade-rehearsal.sh <target-version>` from the DUT repo path against the active stack
   - start `./scripts/soak-monitor.sh --hours 24` in `tmux` on DUT
6. **Promote or roll back**
   - keep the Portainer deployment only after DUT stays healthy
   - if DUT fails, restore the prior pinned image refs in Portainer and redeploy the previous known-good stack

## Release Channels And Tags

- `latest`: development and evaluation only
- `v*` tags: stable release images intended for pinned production deployment
- `main-<sha>`: CI-published snapshots from the current `main` commit

Production deployments should pin exact `v*` tags in Compose and should not auto-track `latest`.

Recommended pre-release commands:

- `pnpm release:preflight`
- `./scripts/upgrade-rehearsal.sh <target-version>`
- `./scripts/soak-monitor.sh --hours 24`

## Upgrading

### Production Default

Use pinned GHCR image tags in production.

Example:

- `ghcr.io/drjakeberg/stream247-web:v1.5.19`
- `ghcr.io/drjakeberg/stream247-worker:v1.5.19`
- `ghcr.io/drjakeberg/stream247-playout:v1.5.19`
- `bluenviron/mediamtx:1.15.4`

Do not use `latest` for unattended production deployments.

### Safe Upgrade Flow

1. Read the changelog and release notes.
2. Create a PostgreSQL backup.
3. Back up `.env` or the active deployment env file.
4. Confirm `data/media` is intact.
5. In the repo, run:
   ```bash
   pnpm release:preflight
   ```
   The preflight rejects blank or quoted-empty required settings plus untouched `.env.example` and `.env.production.example` placeholder values, including Traefik host defaults whenever proxy settings are present and ACME email placeholders when the built-in Let's Encrypt resolver is configured, so replace those first.
6. Rehearse the target version with:
   ```bash
   ./scripts/upgrade-rehearsal.sh v1.5.7
   ```
   Before a new release tag exists, the rehearsal automatically uses the CI-published `main-<sha>` snapshot for the current commit instead of requiring `ghcr.io/...:v1.5.7` to exist already.
   On an empty rehearsal stack, the script bootstraps a rehearsal owner and seeds one tiny local media fixture so the current broadcast-readiness gate does not depend on stale local state. Set `UPGRADE_REHEARSAL_SEED_LOCAL_MEDIA=0` when the target media library already contains real playable media and you want to prevent fixture creation.
7. After the release images exist, update the DT Portainer stack image refs to the target release tags and redeploy the stack from Portainer.
8. Verify the DT stack matches the intended pinned refs:
   ```bash
   PORTAINER_URL=https://portainer.example.com \
   PORTAINER_API_KEY=... \
   PORTAINER_ENVIRONMENT_ID=1 \
   PORTAINER_STACK_NAME=stream247 \
   ./scripts/portainer-stack-check.sh
   ```
9. On DUT, check:
   - `/api/health`
   - `/api/system/readiness` and confirm `broadcastReady=true`
   - `Live → Status`
   - current broadcast state
10. For production candidates, run on DUT from the repo path:
    ```bash
    ./scripts/soak-monitor.sh --hours 24
    ```
    The soak gate fails if broadcast readiness drops or never becomes ready.

Useful overrides:

- `CHECK_BASE_URL=http://127.0.0.1:3000` if `APP_URL` is externally routed and not directly reachable from the host
- `SESSION_COOKIE="stream247_session=..."` if the soak monitor should also fail on open critical incidents from the authenticated incidents API
- `RELEASE_PREFLIGHT_ENV_FILE=/path/to/production.env` if you want `pnpm release:preflight` to validate a staged env file without replacing the current `.env`
- `UPGRADE_REHEARSAL_IMAGE_TAG=main-<sha>` if you need to force a specific pre-release snapshot tag during rehearsal
- `PORTAINER_URL`, `PORTAINER_API_KEY`, `PORTAINER_ENVIRONMENT_ID`, and `PORTAINER_STACK_NAME` for `./scripts/portainer-stack-check.sh`

### Patch vs Minor Upgrades

- Patch upgrades should be the default production path.
- Minor upgrades may require reading upgrade notes carefully.
- Downgrades are not guaranteed unless explicitly documented in the release notes.

### Rollback

If the new version is unhealthy:

1. Revert the DT Portainer stack image refs to the previous known-good release tags.
2. Redeploy the stack from Portainer.
3. Confirm DUT returns to green readiness.
4. If the database schema is incompatible, restore the PostgreSQL backup as well.

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

`./scripts/upgrade-rehearsal.sh <target-version>` follows the same artifact model. If the requested `v*` images already exist, it rehearses against them directly. Before the version tag exists, it falls back to the CI-published `main-<sha>` snapshot for the current commit. Set `UPGRADE_REHEARSAL_IMAGE_TAG=main-<sha>` if you need to force a specific pre-release snapshot explicitly. Empty-stack rehearsals bootstrap a rehearsal owner and seed one tiny local media fixture by default; set `UPGRADE_REHEARSAL_SEED_LOCAL_MEDIA=0` to disable fixture seeding.

## Portainer Stack Check

`./scripts/portainer-stack-check.sh` is a read-only verification step for the DT control plane.

It compares the image refs pinned in `.env.production.example` against the image digests actually running in the named Portainer-managed stack. The script checks:

- `web` against `STREAM247_WEB_IMAGE`
- `worker` and `uplink` against `STREAM247_WORKER_IMAGE`
- `playout` against `STREAM247_PLAYOUT_IMAGE`
- `relay` against `STREAM247_RELAY_IMAGE`

Required environment variables for a real check:

- `PORTAINER_URL`
- `PORTAINER_API_KEY`
- `PORTAINER_ENVIRONMENT_ID`
- `PORTAINER_STACK_NAME`

Dry-run example:

```bash
./scripts/portainer-stack-check.sh --dry-run
```

Real check example:

```bash
PORTAINER_URL=https://portainer.example.com \
PORTAINER_API_KEY=... \
PORTAINER_ENVIRONMENT_ID=1 \
PORTAINER_STACK_NAME=stream247 \
./scripts/portainer-stack-check.sh
```

The script does not update, redeploy, or restart anything. It only reports whether the currently running DT stack matches the pinned release env file.

Production `traefik`, `web`, `worker`, `relay`, `playout`, `uplink`, and `postgres` services now use `restart: unless-stopped` in `docker-compose.yml`, so the documented always-on Compose paths, including `docker compose --profile proxy up -d`, recover their stack processes after daemon and host restarts.

The worker-family image uses a small init process before Node so long-running playout containers reap short-lived Chromium scene-renderer children. Worker, playout, and uplink Docker healthchecks use 45-second intervals/timeouts and a 60-second start period because FFmpeg and scene rendering can briefly saturate the playout container during normal broadcast operation.

Planned output reconnects default to every 48 hours. Set `PLAYOUT_RECONNECT_HOURS` only when the deployment needs a different Twitch reconnect cadence; `PLAYOUT_RECONNECT_SECONDS` controls the short standby window used during that planned reconnect.

Production Compose enables the program-feed/uplink split by default. `playout` writes a rolling HLS feed under `STREAM247_PROGRAM_FEED_DIR`, and the `uplink` worker reads that local feed before publishing to the configured primary/backup outputs. The default `STREAM247_PROGRAM_FEED_TARGET_SECONDS=2` and `STREAM247_PROGRAM_FEED_LIST_SIZE=30` keep about 60 seconds of feed buffer so normal asset boundaries do not close the external RTMP session. HLS segments are written with temporary files, epoch-based segment numbers, and discontinuity markers so the uplink can continue across normal item handoffs. Set `STREAM247_UPLINK_INPUT_MODE=rtmp` only to roll back to the older MediaMTX relay input, and set `STREAM247_RELAY_ENABLED=0` only as a rollback to the previous direct playout-to-destination path.

Pushed video sources (M57 stage 2) enter through the relay's two ingest host ports: RTMP on `1935/tcp` and SRT on `8890/udp`. The relay runs the mounted `docker/mediamtx.yml` instead of image defaults and checks every publish and read against the web app at `/api/relay/auth`. Publishing to `src-<source-id>` requires that source's publish key — issued once when the source is saved as a pushed source in the studio's video source manager, rotatable there, never shown again. The relay's control API (`:9997`) and RTSP read side (`:8554`) stay container-internal; internal reads and any publish to the legacy `live/program` path require the internal relay key, a secret that generates itself into the database on first use and is deliberately never printed. Publisher settings that work with the auth scheme: OBS RTMP — server `rtmp://<host>:1935`, stream key `src-<source-id>?user=publisher&pass=<publish-key>`; SRT — `srt://<host>:8890?streamid=publish:src-<source-id>:publisher:<publish-key>`.

The live attach itself stays behind `STREAM247_SOURCE_LIVE_ENABLED` (and the managed switch that wins over it), and is still awaiting its DT soak gate. Two operator surfaces cover it: `STREAM247_SOURCE_LIVE_GAIN_PERCENT` (0-200, default 40) is settable under Settings → Operations → **Sound from live video sources**, and the studio's video source manager shows the worker's last attach decision per pushed source in words. That decision is persisted by migration `20260826_004_overlay_video_source_live_state` (`live_state`, `live_state_at`, `live_retry_at` on `overlay_video_sources`, all additive and empty on existing rows) and written only when the decision changes, mirroring the `playout.source-live.attach_decision` runtime event. A live source's audio is mixed only into items whose duration is known in advance; on anything else the source is embedded as picture only so the feed-audio watchdog stays meaningful.

Consequence for the two rollback paths above: with relay auth active, `STREAM247_RELAY_ENABLED=1` and `STREAM247_UPLINK_INPUT_MODE=rtmp` publish and read `live/program` on the relay and therefore only work when `STREAM247_RELAY_OUTPUT_URL` / `STREAM247_RELAY_INPUT_URL` carry the internal relay key as credentials (`rtmp://relay:1935/live/program?user=internal&pass=<internal-relay-key>`). Both lines, with the key already embedded, are available to an owner or admin under Settings → Operations → **Relay access**: the group ships only a button, the value is fetched on click from `POST /api/settings/relay-access`, and each reveal writes a `relay.internal_key.revealed` audit event naming the actor. Copy both lines into the deployment environment and restart before taking either rollback path. Never weaken the relay auth config to avoid the key: the same path is reachable from the internet through the published ingest port.

Readiness and the soak monitor now separate Twitch/output continuity from short local playout failures in HLS program-feed mode. If `uplink` is running, the destination is ready, the program feed is fresh, and crash-loop protection is not active, a local `playout` failure is treated as a transient for `STREAM247_PLAYOUT_TRANSIENT_GRACE_SECONDS` seconds. The default grace is the larger of 20 seconds or `STREAM247_PROGRAM_FEED_FAILOVER_SECONDS`. Uplink failures, stale program feeds, destination degradation, crash loops, new unplanned uplink restarts, and repeated Docker restarts for `web`, `worker`, or `playout` still fail the soak. The readiness API also reports `sseConnections` so long-running installs can see whether browser or overlay event streams are being cleaned up after clients disconnect.

Twitch VOD playback is cache-backed by default. The worker stores verified Twitch archive media under `MEDIA_LIBRARY_ROOT/.stream247-cache/twitch`, preserves the original Twitch URL on the asset record, and keeps the internal cache out of local library scans. Before each retry it deletes leftover transient partials for the same VOD, enforces the cache byte guardrail against both ready files and transient download artifacts, and times Twitch cache preparation out after `TWITCH_VOD_CACHE_DOWNLOAD_TIMEOUT_SECONDS` so playout falls back locally instead of stalling the program feed. Production pins that timeout to `8` seconds; keep it short unless a separate background warm-cache path exists. If a Twitch VOD cannot be cached, playout skips that asset for a cooldown window and falls through to the normal global-fallback / generic-fallback ladder before it ever drops to the standby slate. Keep at least one curated local fallback asset in `data/media` with `fallback` or `standby` in the file name so the local-library source promotes it to a global fallback automatically. Set `TWITCH_VOD_CACHE_ALLOW_REMOTE_FALLBACK=1` only as a temporary rollback.

The Twitch cache also enforces basic retention and disk guardrails:

- `TWITCH_VOD_CACHE_RETENTION_HOURS`
- `TWITCH_VOD_CACHE_PARTIAL_MAX_AGE_HOURS`
- `TWITCH_VOD_CACHE_DOWNLOAD_TIMEOUT_SECONDS`
- `TWITCH_VOD_CACHE_MAX_BYTES`
- `TWITCH_VOD_CACHE_MIN_FREE_BYTES`
- `TWITCH_VOD_CACHE_FAILURE_COOLDOWN_SECONDS`
- `TWITCH_SCHEDULE_SYNC_ENABLED`
- `SCENE_RENDERER_ENABLED`

The defaults prune stale partial downloads, evict older cached VOD files when the cache exceeds its byte budget, and refuse a new download when free disk falls below the configured floor.

Chapters for assets whose listing ingest cannot deliver them (YouTube playlist/channel items, Twitch channel archives, direct media) are backfilled by a budgeted per-cycle probe: `CHAPTER_BACKFILL_PER_CYCLE` metadata-only yt-dlp/ffprobe calls per reconciliation cycle (default 3, `0` disables), with failed probes held for `CHAPTER_BACKFILL_FAILURE_COOLDOWN_SECONDS` (default 1800) before the next attempt. A probe that finds chapters is never repeated. A probe that comes back valid but empty is trusted for `CHAPTER_BACKFILL_EMPTY_RECHECK_SECONDS` (default 604800, one week; `0` disables rechecks) and then probed once more — a rate limit, a geo- or subscriber-restricted variant and a yt-dlp extractor regression all report "no chapters" as well, and an asset stuck on that answer goes on air with the wrong category and title. Rechecks come last in the per-cycle budget, behind never-probed assets and failure retries, so they never delay a newly ingested item. Operator-edited chapter lists are never overwritten and never re-probed.

Output settings are available in `/output` with built-in profiles for 720p30, 1080p30, 480p30, and 360p30 plus a custom mode. The saved stream profile is stored in PostgreSQL and applies when the playout worker starts its next FFmpeg process. Each destination can either inherit that stream profile or pin one of the fixed named presets. Destinations that resolve to the same effective rendition share one persistent uplink process; mixed renditions spawn parallel uplink processes from the shared relay/program feed. Deployment-level `STREAM_OUTPUT_WIDTH`, `STREAM_OUTPUT_HEIGHT`, and `STREAM_OUTPUT_FPS` override the saved stream profile for standby slate generation, scene-renderer capture size, and inherited uplink output normalization. `SCENE_RENDER_WIDTH` and `SCENE_RENDER_HEIGHT` still have precedence for scene capture if you need a temporary render-specific override. Set `STREAM_SCALE_ENABLED=0` only as a rollback if the scale/pad/fps filter causes unexpected encoder load. Avoid pinning a destination above the stream profile unless you explicitly want to pay the CPU cost of upscaling the shared feed.

In-stream engagement is configured from Studio → Engagement (legacy `/overlays` redirects there) and is disabled by default. Both the database setting and the deployment flag must be enabled before anything renders in the captured overlay: set `STREAM_CHAT_OVERLAY_ENABLED=1` for Twitch IRC chat and the chatter-participation game, and set `STREAM_ALERTS_ENABLED=1` for follow / sub / cheer / channel-point alerts. EventSub webhooks post to `/api/overlay/events`; production deployments should set `TWITCH_EVENTSUB_SECRET` and must expose `APP_URL` over reachable HTTPS for Twitch to deliver follow/sub notifications. The worker automatically registers `channel.follow` and `channel.subscribe` EventSub subscriptions when alerts are enabled and Twitch is connected, verifies existing subscriptions before creating duplicates, and deletes matching Stream247-owned subscriptions when alerts are disabled. Twitch channels connected before this behavior shipped may need to reconnect once to grant `moderator:read:followers` and `channel:read:subscriptions`. Localhost-only installs can use the admin preview and chat settings, but cannot receive Twitch EventSub webhooks from the public internet.

CI currently builds against the public ECR mirror for `node:22-alpine` to avoid Docker Hub rate limits on GitHub-hosted runners.

## Current Capability Notes

- Admin navigation is grouped by operator workflow: `Live` for control, status, and moderation, `Program` for schedule/library work, `Studio` for scene/engagement/output, and `Admin` for settings, moderation policy, and team access.
- local media, direct media URLs, YouTube playlists/channels, and Twitch VODs/channels are ingestible today
- Twitch VOD playout uses verified local cache files by default and falls back to standby when cache preparation fails
- program-feed/uplink mode separates program playout restarts and asset boundaries from the external RTMP publishing worker
- YouTube and Twitch ingestion rely on `yt-dlp`
- schedule blocks support weekly CRUD, reusable show profiles, multi-day creation, overlap validation, drag/drop repositioning, resize-to-change-duration editing, weekly coverage summaries, and quick-start program templates
- pools are first-class programming units for round-robin playout selection
- sources can be edited in place and the asset catalog can be searched by title, source, and status
- playout supports operator restart, temporary fallback, asset pinning, skip-current, and resume-schedule actions
- overlay is Stream247's internal browser capture surface with replay labeling, current/next context, and admin-managed branding
- optional chat, chatter-participation, and Twitch alert overlays render through the same captured browser overlay when explicitly enabled
- email and Discord alert delivery are both implemented
- managed secret storage in `/settings` is implemented for Twitch and alert credentials
- setup and status expose a guided readiness view based on the current workspace state
