# Stream247

Stream247 is a self-hosted platform for running a Twitch-first 24/7 channel from managed video sources such as local media, direct media URLs, YouTube playlists or channels, and Twitch VODs or channels.

It ships as Docker / Docker Compose, publishes images through GitHub Actions and GHCR, and gives operators a browser-based admin UI for scheduling, playout control, Twitch sync, moderation policy, and incident handling.

There is no standalone overlay page. The on-air overlay is drawn by the playout worker's own renderer from the published scene, and the studio preview is the same drawing. Stream247 is not an overlay product or a reusable embed surface.

## License Model

Stream247 is source-available software. It is not open source or OSI-approved.

Non-commercial use is allowed under the license in `LICENSE`. You may copy,
fork, modify, self-host, and redistribute modified forks for non-commercial
use.

Commercial use requires a separate written commercial license from the project
owner. Commercial use includes monetized streams, ad-supported streams, paid
services, managed hosting or SaaS, agency use, consulting-for-pay use, and
internal business use that supports commercial operations. See
`COMMERCIAL-LICENSE.md`.

Every public stream produced, automated, scheduled, controlled, or otherwise
operated with Stream247 must include a visible repository link. The minimum
acceptable location is the stream description, a channel panel, or an
equivalent always-visible public page associated with the stream. See
`ATTRIBUTION.md`.

The current repository state and future releases use this source-available
non-commercial license unless a later release says otherwise. Earlier
Stream247 releases that were already published under Apache-2.0 remain
governed by the terms under which they were published; those earlier grants
are not retroactively revoked.

## What It Does Today

- Docker-first self-hosted deployment with published GHCR images
- setup wizard with owner account bootstrap and optional Twitch client credential capture
- local session-based login with optional TOTP two-factor authentication for the local owner account, plus the
  Twitch bot account and channel owner OAuth connections and Twitch SSO team access
- role-based access with `owner`, `admin`, `operator`, `moderator`, `viewer`, and team access grants by Twitch login
- PostgreSQL-backed runtime state and asset catalog
- operator workspace IA with:
  - `Live` for control, status, and moderation
  - `Program` for schedule, pools, library, and sources
  - `Studio` for scene, engagement, and output configuration
  - `Admin` for access, secrets, releases, and blueprints
- source ingestion for:
  - local media library scanned from `data/media`, keeping its relative folder structure in the catalog
  - local media uploads from the admin UI into the shared library
  - direct media URLs
  - YouTube playlists and channels via `yt-dlp`
  - Twitch VODs and channels via `yt-dlp`, with local cache-backed playout for Twitch archives
  - guided source templates for local library, direct URLs, YouTube, and Twitch inputs
  - source metadata capture for title, natural duration, publish time, and source category where available
- source operations with:
  - source edit, enable/disable, and delete controls
  - source detail pages with programming references, incidents, audit trail, and manual sync actions
  - bulk source actions for enable, disable, and sync queueing
  - persisted per-source sync runs with success/error summaries and last ingestion results
  - source library health snapshots with latest sync outcome and open issue counts
  - connector-specific troubleshooting hints for source and asset diagnostics
  - source-side asset counts and ready counts
- library operations with:
  - generated local thumbnails with deterministic metadata-card fallbacks
  - grouped browsing by source, folder, tag, curated set, or status
  - reusable curated sets with bulk add/remove workflows
  - per-asset folder, tag, fallback, and programming curation
  - searchable asset library by title, source, status, and programming inclusion
  - bulk asset actions for include, exclude, fallback promotion, folder assignment, and tag management
  - asset detail pages with source origin, pool context, and runtime visibility
- schedule management with:
  - weekly pool-based blocks
  - explicit repeat sets for daily, weekday, weekend, or custom recurring blocks
  - minute-accurate blocks
  - duration and overlap validation
  - reusable show profiles with default title/category/duration/color
  - weekly coverage overview
  - quick-start program templates
  - drag-and-drop day timeline editing
  - resize-to-change-duration editing
  - duplicate existing blocks onto other weekdays
  - clone a full programming day onto additional empty weekdays
  - materialized fill preview with repeat risk, overflow, empty-window, and insert-rule visibility
  - queue-aware schedule preview alongside the live runtime queue
  - search, pool filters, show filters, and conflict-only views in the programming editor
- pool management with:
  - source grouping
  - round-robin across the selected sources: the next item from each source in turn, each source oldest
    first and looping from its own persistent position
  - optional audio-lane beds that replace program audio during scheduled pool playback
- playout operations with:
  - FFmpeg RTMP output foundation with worker-managed playout runtime state
  - local RTMP relay plus persistent uplink mode so program playout is separated from the external Twitch/output session;
    in production Compose the uplink reads a buffered local program feed and owns the external output sessions
    and scheduled reconnects
  - Multi-Output RTMP delivery with multiple primary outputs plus backup outputs
  - per-destination managed stream keys with legacy env fallback for the built-in primary and backup outputs
  - health-aware destination fanout that keeps healthy primaries together and falls back to backups when needed,
    with a readiness state per destination
  - staged output recovery that keeps recovered destinations out of the active group until the next natural transition or an explicit operator recovery request, with cooldown visibility
  - a source circuit breaker that holds a source out of the pools after its probes fail on three different items,
    retries one item after a cooldown and shows the hold on the source page
  - probes that fail while the channel's own network is down count against neither the item nor its source
  - an as-run log: one row per playout run (what aired, how it was fed, why it ended), kept 90 days and read in
    `Live → Status` or through `GET /api/as-run`
  - standby replay slate when no playable asset is available
  - scheduled 48-hour reconnect window with controlled standby mode
  - Live Bridge takeover from RTMP/RTMPS or HLS inputs with controlled release back to scheduled playback
  - deterministic queue state with current, next, previous, and transition-target visibility
  - queue-aware next-asset probe and prefetch, with current, next and queued assets and the transition state
    visible in the admin UI
  - operator queue actions for play now, move next, remove next, and replay previous; play now and
    insert switch straight to the chosen item once the next playout cycle has resolved it, keep the
    item on air until then, and never show the reconnect slate (after the insert the pool continues
    with its next item; the interrupted item is not resumed); a move next or replay previous item plays
    to its end
  - graceful schedule handoff so running scheduled items can finish before the next weekly block takes
    over; a dated or one-off block cuts the item on air at its start, and its own item at its end when a
    block follows
  - safe-boundary cuepoint inserts inside schedule blocks using either pool insert assets or block-specific insert assets
  - fallback asset selection, with fallback asset priority and global fallback support
  - manual restart (with the relay the item on air starts again from its beginning; without it the
    reconnect slate shows, then a running pin or insert starts again, else a queued move next, else the
    pool's next item)
  - refresh-overlays and rebuild-queue controls
  - temporary fallback override
  - pin asset on air
  - skip current asset, which also ends a pin or temporary fallback holding it on air; chat skip votes
    are paused while one does, and while an operator play now / insert is pending or on air (the bot
    says why)
  - resume schedule control, which also cancels a pending or running play now / insert
  - force reconnect and recover outputs for direct RTMP mode; with the relay force reconnect is
    refused (the uplink reconnects by itself) and recover outputs leaves the programme alone (the
    uplink restarts the recovered output's rendition, so the outputs sharing it reconnect once)
  - one broadcast action API for restart, refresh, queue rebuild, fallback, skip, resume, and pin-on-air actions
  - live admin status rail with on-air, next, destination, incident, and update state across admin pages
- Twitch automation with:
  - title sync from active asset metadata or schedule override
  - category lookup and sync from active asset metadata or schedule override
  - upcoming Twitch schedule segment sync
- moderation with:
  - explicit moderation presence windows such as `!here 30`
  - configurable moderation policy in the admin UI
  - emote-only fallback when no active moderator window is present
- ops tooling with:
  - incidents created from runtime failures
  - incident history with status / severity / scope filters
  - acknowledge / resolve actions
  - runtime drift checks for worker, playout, schedule alignment, destination readiness, and Twitch metadata
  - recent audit trail visibility and audit events
  - worker/playout healthcheck commands
  - Discord webhook alerts
  - SMTP email alerts
  - readiness and health endpoints
- encrypted-at-rest managed secret storage for Twitch and alert credentials, with `.env` fallback
- `Channel Blueprints` with:
  - export/import of Scene, sources, curated sets, program data, moderation, and destination metadata, without
    exporting secrets or media files
  - selective import sections for library, program data, Scene, and operations
  - explicit import warnings when referenced media is not present locally
- viewer-facing pages with:
  - public schedule page at `/channel`
- one channel language (English or German) for everything viewers see or read: the on-air picture, the standby
  and reconnect texts, polls, the skip bar, chat games, every chat bot reply and the public page; operator content
  is never translated and the admin interface stays English (`docs/operations.md`, *What Viewers Read*; adding a
  language: `docs/architecture.md`, *Viewer Language*)
- one canonical Scene payload shared across the studio preview, scene APIs, and the playout renderer, with:
  - on-air scene renderer that draws the published scene natively into the FFmpeg playout path, with a text-overlay fallback; the studio preview is the same drawing
  - overlay studio with draft-save, reusable scene preset library, preview, per-mode scene presets/headlines, layer ordering, layer visibility toggles, built-in typography presets, conservative local font-stack overrides, positioned text/logo/image/game/source layers, and publish-live scene controls (embed and widget layers from older scenes are kept but not drawn on air)
  - admin-managed replay branding, scene presets, and ticker/badge styling
  - `Scene` in the Studio workspace, with a configurable replay label, channel name, headline, accent color,
    emergency banner, and now/next teaser toggles
- guided setup and launch with:
  - a guided readiness view in setup and status, with launch guidance for destination, assets, pools, schedule,
    and overlay
  - a settings-side update center with pinned-tag visibility, release channel hints, and preflight/runbook guidance

## What Is Not Done Yet

Open milestones and known gaps are tracked in [PLANS.md](PLANS.md) (*Open*, *Owner-gated and deferred*,
*Known follow-ups*) and in [docs/architecture.md](docs/architecture.md) (*Major Known Gaps*).


## Quick Start

The one-page path from an empty host to a green channel, with the traps where they bite, is
[`docs/getting-started.md`](docs/getting-started.md). The steps below are what a first run needs; the guide
has the rest: the two Twitch accounts, the Twitch application, the optional settings, the stream key, media
and a first programme.

1. Get `docker-compose.yml` and `docker/mediamtx.yml` from the newest release tag on
   <https://github.com/DrJakeberg/stream247/releases>, either with
   `git clone --depth 1 --branch vX.Y.Z https://github.com/DrJakeberg/stream247.git` or by downloading the
   two files into a directory of their own (keeping `docker/`); the guide's section 1 has the commands.
   A release's compose file starts that release's images.
2. A `.env` is optional. Without one the app secret is generated and persisted under
   `data/media/.stream247-app-secret`, the bundled database configures itself, and the `/setup`
   wizard asks for the public URL. To pin values yourself, copy `.env.production.example` (not
   `.env.example`, which is the development file and would switch the stack into development mode)
   and set them **before the first start**:
   - `APP_URL`
   - `APP_SECRET` (32+ random characters; the example placeholder is refused)
   - `POSTGRES_PASSWORD` and the same password inside `DATABASE_URL`
3. The database password is fixed when `data/postgres` is first created. Changing it later leaves
   every service failing with "password authentication failed" and a bare error page; either keep
   the password or remove `data/postgres` before real data exists.
4. Start the stack:
   ```bash
   docker compose up -d
   ```
   With the built-in Traefik HTTPS profile, set `TRAEFIK_HOST` (and `TRAEFIK_ACME_EMAIL` for Let's Encrypt)
   first and start it with `docker compose --profile proxy up -d`; the guide's section 5.
5. Open:
   - `http://localhost:3000/setup` on the host itself. Port 3000 is published on `127.0.0.1` only; from
     another machine use HTTPS (`--profile proxy` or your own proxy) or an SSH tunnel
     (`ssh -L 3000:localhost:3000 <user>@<host>`), see the guide's section 5
6. Create the owner account; that signs you in. The wizard then walks through the public URL,
   Twitch app credentials, the Twitch connection, the stream key and a first programme (a pool from your
   media that plays all week), each step skippable, and ends in a readiness checklist that links to
   wherever something is still missing.
7. `Live → Status` shows the same readiness afterwards.

After the first run, the guide continues: Twitch client credentials from an application registered at
<https://dev.twitch.tv/console/apps> (section 3, or later in `/settings`), the broadcast channel and the bot
account under `Admin → Settings → Twitch accounts` (section 6, `docs/twitch-setup.md`), the stream key
(section 7), media in `data/media` or as sources (section 8), and pools and weekly schedule blocks
(section 9).

## Configuration

### Required Environment Variables

- `APP_URL`: externally reachable base URL, for example `https://stream247.example.com`
- `APP_SECRET`: session-signing secret
- `POSTGRES_PASSWORD`: password used by PostgreSQL
- `DATABASE_URL`: must use the same PostgreSQL password as `POSTGRES_PASSWORD`

### Required Only For The Traefik Profile

- `TRAEFIK_HOST`: public hostname for Traefik routing
- `TRAEFIK_ACME_EMAIL`: email used for Let's Encrypt when the built-in ACME resolver is active

### Common Optional Environment Variables

- `TWITCH_CLIENT_ID`: Twitch application client id
- `TWITCH_CLIENT_SECRET`: Twitch application client secret
- `TWITCH_SCHEDULE_SYNC_ENABLED`: set to `0` to skip Twitch schedule sync when the account writing the schedule (the channel owner, or the bot in a single-account setup) cannot create non-recurring Twitch schedule segments; defaults to `1`
- `TWITCH_STREAM_KEY`: Twitch stream key for RTMP output
- `TWITCH_RTMP_URL`: defaults to `rtmp://live.twitch.tv/app`
- `TWITCH_VOD_CACHE_ENABLED`: cache Twitch VOD media locally before playout; defaults to `1`
- `TWITCH_VOD_CACHE_ALLOW_REMOTE_FALLBACK`: allow direct remote Twitch playback if cache preparation fails; defaults to `0`
- `TWITCH_VOD_CACHE_DOWNLOAD_TIMEOUT_SECONDS`: floor for a Twitch VOD cache download's time limit; default `120`. Since M62 the effective limit is at least the VOD's duration (24 h ceiling), so a long replay is not abandoned mid-download; the production example uses `1800`
- `STREAM247_RELAY_ENABLED`: split program production from external publishing; defaults to `1` in the example Compose env
- `STREAM247_UPLINK_INPUT_MODE`: `hls` keeps the uplink on a buffered local program feed; set `rtmp` only to roll back to the older MediaMTX relay input
- `STREAM247_PROGRAM_FEED_DIR`: local HLS program-feed directory shared by `playout` and `uplink`
- `STREAM247_PROGRAM_FEED_TARGET_SECONDS`: target HLS segment length; defaults to `2`
- `STREAM247_PROGRAM_FEED_LIST_SIZE`: live playlist segment count; defaults to `30` for about 60 seconds of buffer
- `STREAM247_PROGRAM_FEED_FAILOVER_SECONDS`: extra stale-feed grace before health reports the feed as stale; defaults to `10`
- `STREAM247_PLAYOUT_TRANSIENT_GRACE_SECONDS`: readiness/soak grace for short local playout failures while the HLS program feed, uplink, and destination remain healthy; defaults to the larger of `20` or `STREAM247_PROGRAM_FEED_FAILOVER_SECONDS`
- `STREAM247_RELAY_OUTPUT_URL`: legacy local relay publish URL used by the playout process when `STREAM247_UPLINK_INPUT_MODE=rtmp`
- `STREAM247_RELAY_INPUT_URL`: legacy local relay read URL used by the uplink process when `STREAM247_UPLINK_INPUT_MODE=rtmp`
- `STREAM_OUTPUT_URL`: built-in primary RTMP output URL override
- `STREAM_OUTPUT_KEY`: built-in primary RTMP key override
- `BACKUP_STREAM_OUTPUT_URL`: built-in backup RTMP output URL
- `BACKUP_STREAM_OUTPUT_KEY`: built-in backup RTMP key
- `BACKUP_TWITCH_RTMP_URL`: built-in backup Twitch-style RTMP URL
- `BACKUP_TWITCH_STREAM_KEY`: built-in backup Twitch-style stream key
- `DESTINATION_FAILURE_COOLDOWN_SECONDS`: how long a failed destination stays on hold before the worker will retry it automatically
- `PLAYOUT_RECONNECT_HOURS`: interval for planned Twitch/output reconnect windows; defaults to `48`
- `PLAYOUT_RECONNECT_SECONDS`: duration of the planned reconnect standby window; defaults to `20`
- `SCENE_RENDERER_ENABLED`: set to `0` to keep production on the text overlay path when the scene renderer is unstable
- `SCENE_RENDER_INTERVAL_MS`: how often the worker redraws the on-air scene frame; defaults to `2000`
- `CHANNEL_TIMEZONE`: schedule timezone, for example `Europe/Berlin`
- `CHANNEL_LANGUAGE`: the language of everything viewers see or read, `en` (default) or `de`; overrides the language saved in the wizard or under `Admin → Settings → Channel language`; any other value counts as `en`
- `DISCORD_WEBHOOK_URL`: Discord alert target
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`, `ALERT_EMAIL_TO`: email alerting
- `TRAEFIK_CERT_RESOLVER`: Traefik certificate resolver name, defaults to `letsencrypt`
- `STREAM247_WEB_BIND`: host address port 3000 is published on; default `127.0.0.1`, `0.0.0.0` opens it to the LAN
- `STREAM247_WEB_MEMORY_LIMIT`: memory limit of `web`; default `2g`
- `STREAM247_UPLOAD_MAX_BYTES`: per-file upload limit; unset means no limit
- `TWITCH_BROADCAST_CHANNEL_LOGIN`, `TWITCH_BOT_LOGIN`: env fallbacks for the two Twitch account logins (`docs/twitch-setup.md`)
- `STREAM247_SUPERVISOR_MARKER_DIR`: see `docs/deployment.md`, *Upgrading To 2.4*
- `SOAK_DOCKER_TIMEOUT_SECONDS`: read by `scripts/soak-monitor.sh`, see `docs/deployment.md`

### What Belongs In `.env`

- infrastructure secrets
- RTMP stream keys
- optional fallback OAuth application credentials
- optional fallback SMTP / Discord credentials
- deployment-level defaults such as `CHANNEL_TIMEZONE` and `CHANNEL_LANGUAGE`

### What Does Not Belong In `.env`

- moderation presence policy
- schedule blocks
- operator overrides
- sources and assets
- incidents and acknowledgements

Those are runtime settings stored in PostgreSQL and managed from the admin UI.

### Managed Secrets In The Admin UI

Stream247 can now store these credentials encrypted at rest in PostgreSQL:

- `TWITCH_CLIENT_ID`
- `TWITCH_CLIENT_SECRET`
- default Twitch category id
- Discord webhook URL
- SMTP host / port / user / password
- SMTP from address
- alert recipient email

Behavior:

- setup can capture Twitch client id and secret during bootstrap
- `/settings` can update managed credentials later
- blank password/secret fields keep the existing stored value
- `.env` values still work as fallback if no managed value exists

### Multi-Output Routing

Stream247 now supports multiple simultaneous RTMP outputs from one channel.

- healthy enabled `primary` destinations are used together as the active output group
- `backup` destinations only take over when no healthy primary group is available
- the built-in `destination-primary` and `destination-backup` records can use `.env` fallback keys
- additional outputs use managed per-destination stream keys stored encrypted at rest
- destination failures enter a cooldown hold so the worker can continue on healthier outputs and retry later

### Live Bridge

Stream247 now supports a `Live Bridge` takeover path for temporary live input.

- operators can start a live bridge from RTMP/RTMPS or HLS URLs in the broadcast workspace
- the worker keeps the scheduled queue visible while the live input is on air
- releasing the bridge returns the output to scheduled playback on the next safe transition
- the takeover ends an operator play now / insert: one on air is not replayed after the release, a
  pending one is dropped and logged, and play now is refused while the bridge is up
- the existing Multi-Output RTMP fanout and destination health routing remain active during the bridge
- live snapshots expose only a sanitized input summary instead of the raw bridge URL

### Audio Lanes And Cuepoints

Stream247 now supports two additional programming controls for longer-form channels:

- pools can define an optional replace-mode audio lane using a ready `local-library` or `direct-media` asset
- audio lanes loop independently and replace the scheduled pool asset's native audio during normal scheduled playback
- schedule blocks can define cuepoint offsets in seconds from block start
- cuepoints never cut mid-file; they arm an insert and fire it on the next safe asset boundary
- a block running past midnight fires each cuepoint once; the after-midnight part does not start them over
- cuepoints can use either a block override insert asset or the pool's automatic insert asset
- the broadcast control room shows both the active audio lane state and cuepoint progress

## Twitch App Credentials

The bot, the channel owner connection and Twitch sign-in need a Twitch application (`TWITCH_CLIENT_ID`,
`TWITCH_CLIENT_SECRET`). [docs/twitch-setup.md](docs/twitch-setup.md) walks through it, including the three
redirect URLs. Both values can be stored as encrypted managed settings in Stream247; `.env` remains the
bootstrap and deployment fallback.


## Deployment

### Production Defaults

- Linux host
- Docker Compose
- reverse proxy in front of `web`
- optional built-in Traefik profile for HTTPS and Let's Encrypt
- persistent storage for:
  - PostgreSQL
  - `data/media`

See [docs/deployment.md](docs/deployment.md) for the deployment-focused guide.

### Published Images

- `ghcr.io/drjakeberg/stream247-web`
- `ghcr.io/drjakeberg/stream247-worker`
- `ghcr.io/drjakeberg/stream247-playout`
- `bluenviron/mediamtx` for the local RTMP relay service

The default `.env.example` already points Compose at the `latest` GHCR tags.
For production pinning, use `.env.production.example` or set the image tags explicitly to the target release.

### Release Behavior

- `push` to `main` validates, runs fresh-stack bootstrap checks, the real ffmpeg/ffprobe tests, queue continuity, resume, runtime parity, the relay-on broadcast path smoke, production-config release preflight, browser smoke checks and the design and wording baselines, and then publishes current images
- `push` of `v*` tags pulls the CI-published `main-<sha>` candidate images for the tagged commit, smoke-validates them, and only then retags and publishes those same tested images as versioned GHCR artifacts
- the Dockerfiles take `node:22-alpine` from `public.ecr.aws`; CI test builds pull the same image from `mirror.gcr.io` and retag it, because `public.ecr.aws` rate-limits for hours at a time (M125)
- production should pin explicit release tags and not follow `latest`
- release rehearsal helpers are available:
  - `pnpm release:preflight`
  - `pnpm test:runtime-parity`
  - `pnpm test:e2e:smoke`
  - `./scripts/upgrade-rehearsal.sh <target-version>`
  - `./scripts/soak-monitor.sh --hours 24`

Operational docs:

- [docs/architecture.md](docs/architecture.md)
- [docs/deployment.md](docs/deployment.md)
- [docs/operations.md](docs/operations.md)
- [docs/twitch-setup.md](docs/twitch-setup.md)
- [docs/moderation-policies.md](docs/moderation-policies.md)
- [docs/ui.md](docs/ui.md)

## Release Readiness Workflow

Before tagging a production release run `pnpm release:preflight`, `./scripts/upgrade-rehearsal.sh <target-version>`
and a 24-hour soak (`./scripts/soak-monitor.sh --hours 24`), and tag only after the rehearsal and the soak
are clean. The full order, the script settings (`CHECK_BASE_URL`, `--follow-web`, `SESSION_COOKIE`,
`RELEASE_PREFLIGHT_ENV_FILE`, `UPGRADE_REHEARSAL_IMAGE_TAG`) and what a `v*` tag publishes are in
[docs/deployment.md](docs/deployment.md) (*Canonical Release And Rollout Flow*, *Safe Upgrade Flow*,
*Release Flow*).


## Local Development

1. Copy `.env.example` to `.env`.
2. Install dependencies:
   ```bash
   pnpm install
   ```
3. Build the test images the development stack runs (the worker image only for `--with-runtime`):
   ```bash
   docker build -f docker/web.Dockerfile -t stream247-web:test .
   docker build -f docker/worker.Dockerfile -t stream247-worker:test .
   ```
4. Start the development stack (`scripts/dev-stack.sh` lists `seed`, `status`, `logs`, `reset`, `down`):
   ```bash
   scripts/dev-stack.sh up
   ```
   It serves the app on `http://localhost:3020` (`DEV_STACK_PORT`) and publishes its PostgreSQL on
   `127.0.0.1:55432` (`DEV_STACK_DB_PORT`). The production compose `postgres` publishes no port, so
   `docker compose up -d postgres` alone does not serve a host `pnpm dev`.
5. To run the web app on the host instead, point `DATABASE_URL` in `.env` at the stack's PostgreSQL,
   `postgresql://stream247:stream247@127.0.0.1:55432/stream247`, and `APP_SECRET` at the stack's value
   (`STREAM247_DEV_APP_SECRET` in `scripts/dev-stack.sh`), then:
   ```bash
   pnpm dev
   ```

For local-development builds with plain Compose instead of GHCR images:

```bash
docker compose -f docker-compose.dev.yml up -d --build
```

## Validation

The intended validation path is:

- `pnpm validate`
- `pnpm test:fresh-db`
- `pnpm test:fresh-compose`
- `pnpm test:media` (the tests with real ffmpeg and ffprobe, required; without host ffmpeg they use the worker image `stream247-worker:test`)
- `pnpm test:queue-continuity`
- `pnpm test:resume`
- `pnpm test:runtime-parity`
- `pnpm test:broadcast-path`
- `pnpm test:e2e:smoke`
- `scripts/design-baseline.sh` (design and wording baselines, needs Docker; `pnpm test:design-baseline` builds the web image first; `--update` or `pnpm test:design-baseline:update` re-records them, on a fresh `DEV_STACK_STATE_DIR` with no dev stack already running)
- `pnpm release:preflight`
- Docker image build
- container smoke test

Current validation covers:

- lint (ESLint on `apps/web` only)
- CSS token lint
- typecheck
- unit tests
- integration tests
- production build
- fresh database bootstrap smoke
- fresh compose bootstrap smoke
- queue continuity smoke across short local-library assets
- resume smoke
- runtime parity smoke for Multi-Output fanout, audio-lane playback, cuepoint inserts, and Live Bridge takeover/release on a fresh Compose stack
- broadcast path smoke with the relay on: the program feed and the uplink output both grow over 60 s (and the check fails with the uplink stopped), a broken source opens and closes its circuit breaker, and a 90 s network outage of the playout is counted neither by the breaker nor by quarantine
- browser smoke for bootstrap, operator IA navigation, secondary-output creation, local 2FA login, live controls, and Scene publish
- design and wording baselines
- production-config release preflight against pinned image tags and required Compose settings
- Docker builds
- smoke test for the web image

## Troubleshooting

### Twitch OAuth does not work

- check that `APP_URL` matches the externally reachable URL exactly
- confirm all three redirect URLs from `docs/twitch-setup.md` (*Required Redirect URLs*) are registered in the Twitch developer application
- verify `TWITCH_CLIENT_ID` and `TWITCH_CLIENT_SECRET`

### No assets are available

- put files into `data/media`
- or add a direct media URL / YouTube playlist / YouTube channel / Twitch VOD / Twitch channel source
- check worker incidents if ingestion failed

### Twitch VOD stays on standby

- keep `TWITCH_VOD_CACHE_ENABLED=1` so Twitch archives are downloaded and verified before playout
- `TWITCH_VOD_CACHE_DOWNLOAD_TIMEOUT_SECONDS` is a floor, not a cap: the effective limit is at least the VOD's duration. An unfinished download does not stall the feed — the replay plays from Twitch directly for that airing (`TWITCH_VOD_CACHE_ALLOW_REMOTE_FALLBACK`)
- inspect worker/playout incidents for Twitch cache failures
- confirm the media volume has enough free space for `data/media/.stream247-cache/twitch`
- use `TWITCH_VOD_CACHE_ALLOW_REMOTE_FALLBACK=1` only as a temporary rollback because it restores unstable remote VOD playback

### Stream output is not ready

- verify `TWITCH_STREAM_KEY` or `STREAM_OUTPUT_KEY`
- verify `TWITCH_RTMP_URL` or `STREAM_OUTPUT_URL`
- inspect destination state and incidents in `Live → Status`

### Email alerts do not send

- verify `SMTP_HOST`
- verify `SMTP_FROM`
- verify `ALERT_EMAIL_TO`
- verify SMTP auth settings if your server requires them

## Monorepo Layout

- `apps/web`: Next.js admin UI, public pages (`/channel`, `/channel.ics`), and API routes
- `apps/worker`: background ingestion, reconciliation, and playout logic, plus the uplink, chat and the worker loop
- `packages/core`: scheduling, rotation, moderation, scene and viewer-language logic
- `packages/db`: PostgreSQL-backed application state layer
- `packages/render`: native on-air scene renderer (`@stream247/overlay-render`)
- `scripts`: smoke tests, release preflight, upgrade rehearsal, soak monitor, dev stack
- `docker`: Dockerfiles, mediamtx config, image smoke test
- `tests`: unit, integration, e2e tests and their support code
- `docs`: getting started, architecture, deployment, operations, Twitch setup, UI, moderation
- `PLANS.md`, `planning/`: the plan and milestone notes; `AGENTS.md`: rules for contributors and agent sessions (imported by `CLAUDE.md`); `.claude/`: agent skills, hooks, settings
- `.github`: CI, release, issues, and PR templates

## License

Stream247 Source-Available Non-Commercial License 1.0. See `LICENSE`,
`COMMERCIAL-LICENSE.md`, and `ATTRIBUTION.md`.
