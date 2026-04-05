# Stream247

Stream247 is a self-hosted platform for running a Twitch-first 24/7 channel from managed video sources such as local media, direct media URLs, YouTube playlists or channels, and Twitch VODs or channels.

It ships as Docker / Docker Compose, publishes images through GitHub Actions and GHCR, and gives operators a browser-based admin UI for scheduling, playout control, Twitch sync, moderation policy, and incident handling.

## What It Does Today

- Docker-first self-hosted deployment with published GHCR images
- setup wizard with owner account bootstrap
- local login with optional two-factor authentication, plus Twitch broadcaster connect and Twitch SSO team access
- PostgreSQL-backed runtime state
- source ingestion for:
  - local media library
  - local media uploads from the admin UI into the shared library
  - direct media URLs
  - YouTube playlists and channels via `yt-dlp`
  - Twitch VODs and channels via `yt-dlp`
  - guided source templates for local library, direct URLs, YouTube, and Twitch inputs
- schedule management with:
  - weekly pool-based blocks
  - explicit repeat sets for daily, weekday, weekend, or custom recurring blocks
  - minute-accurate blocks
  - overlap validation
  - drag-and-drop day timeline editing
  - resize-to-change-duration editing
  - duplicate existing blocks onto other weekdays
  - clone a full programming day onto additional empty weekdays
  - materialized fill preview with repeat risk, overflow, empty-window, and insert-rule visibility
  - queue-aware schedule preview alongside the live runtime queue
  - search, pool filters, show filters, and conflict-only views in the programming editor
- pool management with:
  - source grouping
  - persistent round-robin playback cursors
  - optional audio-lane beds that replace program audio during scheduled pool playback
- playout operations with:
  - FFmpeg RTMP output foundation
  - Multi-Output RTMP delivery with multiple primary outputs plus backup outputs
  - per-destination managed stream keys with legacy env fallback for the built-in primary and backup outputs
  - health-aware destination fanout that keeps healthy primaries together and falls back to backups when needed
  - Live Bridge takeover from RTMP/RTMPS or HLS inputs with controlled release back to scheduled playback
  - deterministic queue state with current, next, previous, and transition-target visibility
  - queue-aware next-asset prefetch
  - operator queue actions for play now, move next, remove next, and replay previous
  - graceful schedule handoff so running scheduled items can finish before the next block takes over
  - safe-boundary cuepoint inserts inside schedule blocks using either pool insert assets or block-specific insert assets
  - fallback asset selection
  - manual restart
  - temporary fallback override
  - pin asset on air
  - skip current asset
  - resume schedule control
- Twitch automation with:
  - title sync from active asset metadata or schedule override
  - category sync from active asset metadata or schedule override
  - upcoming Twitch schedule segment sync
  - moderation policy support for emote-only fallback
- ops tooling with:
  - incidents
  - incident history and filters
  - acknowledge / resolve actions
  - runtime drift checks
  - recent audit trail visibility
  - worker/playout healthcheck commands
  - Discord webhook alerts
  - SMTP email alerts
  - readiness and health endpoints
- encrypted-at-rest managed secret storage for Twitch and alert credentials
- viewer-facing pages with:
  - public schedule page
  - browser-source overlay page with live current/next updates
  - one canonical Scene Studio payload shared across browser overlays, scene APIs, and playout overlay consumers
  - on-air scene renderer v1 that captures the published browser scene into the FFmpeg playout path with safe text-overlay fallback
  - overlay studio with draft-save, reusable scene preset library, preview, per-mode scene presets/headlines, layer ordering, layer visibility toggles, built-in typography presets, positioned text/logo/image/embed/widget layers, and publish-live scene controls
  - admin-managed replay branding, scene presets, and ticker/badge styling

## What Is Not Done Yet

- Scene Studio now supports positioned text/logo/image/embed/widget layers and built-in typography presets, but deeper third-party widget compatibility still depends on CSP / iframe rules and broader cloud-style composition remains partial.
- richer multi-scene composition inside the playout runtime beyond the current scene-presets + draft/publish workflow
- more advanced playout transitions, stronger continuity/recovery behavior, and less restart-heavy normal switchovers
- deeper per-output recovery controls and operator visibility beyond the current Multi-Output v1 routing
- deeper Live Bridge session management and recovery UX
- deeper analytics views and richer incident correlation
- inline override lanes in the schedule editor
- richer audio mixing, crossfades, and layered audio routing beyond the current replace-mode audio lanes
- thumbnails, richer grouped browsing, and more advanced reusable library/blueprint workflows

## Quick Start

1. Copy `.env.example` to `.env`.
2. Set:
   - `APP_URL`
   - `APP_SECRET`
   - `POSTGRES_PASSWORD`
   - the matching password inside `DATABASE_URL`
3. Optional but recommended:
   - `TWITCH_CLIENT_ID`
   - `TWITCH_CLIENT_SECRET`
   - `TWITCH_STREAM_KEY`
   - `CHANNEL_TIMEZONE`
4. Start the stack:
   ```bash
   docker compose up -d
   ```
5. Open:
   - `http://localhost:3000/setup`
6. Create the owner account.
7. Sign in to the admin UI.
8. Optional during bootstrap:
   - enter `TWITCH_CLIENT_ID`
   - enter `TWITCH_CLIENT_SECRET`
9. Or add/update encrypted managed credentials later in:
   - `/settings`
10. Connect Twitch from the dashboard if you want broadcaster sync and Twitch SSO.
11. Add media by either:
   - placing files into `data/media`
   - adding direct media URLs
   - adding a YouTube playlist or channel source
   - adding a Twitch VOD or channel source
12. Build pools and weekly schedule blocks and let the worker ingest assets.

For local-development builds instead of GHCR images:

```bash
docker compose -f docker-compose.dev.yml up -d --build
```

For pinned production deployment, start from:

```bash
cp .env.production.example .env
```

In most cases you only need to set these before first start:

- `APP_URL`
- `APP_SECRET`
- `POSTGRES_PASSWORD`
- `DATABASE_URL`
- `TRAEFIK_HOST` and `TRAEFIK_ACME_EMAIL` if you use the Traefik profile
- `TWITCH_STREAM_KEY` if you want real Twitch output immediately

Twitch client credentials, SMTP, and Discord can also be entered later in the setup wizard or `/settings`.

For Traefik-based HTTPS deployment:

```bash
docker compose --profile proxy up -d
```

## Configuration

### Required Environment Variables

- `APP_URL`: externally reachable base URL, for example `https://stream247.example.com`
- `APP_SECRET`: session-signing secret
- `POSTGRES_PASSWORD`: password used by PostgreSQL
- `DATABASE_URL`: must use the same PostgreSQL password as `POSTGRES_PASSWORD`

### Required Only For The Traefik Profile

- `TRAEFIK_HOST`: public hostname for Traefik routing
- `TRAEFIK_ACME_EMAIL`: email used for Let's Encrypt

### Common Optional Environment Variables

- `TWITCH_CLIENT_ID`: Twitch application client id
- `TWITCH_CLIENT_SECRET`: Twitch application client secret
- `TWITCH_STREAM_KEY`: Twitch stream key for RTMP output
- `TWITCH_RTMP_URL`: defaults to `rtmp://live.twitch.tv/app`
- `STREAM_OUTPUT_URL`: built-in primary RTMP output URL override
- `STREAM_OUTPUT_KEY`: built-in primary RTMP key override
- `BACKUP_STREAM_OUTPUT_URL`: built-in backup RTMP output URL
- `BACKUP_STREAM_OUTPUT_KEY`: built-in backup RTMP key
- `BACKUP_TWITCH_RTMP_URL`: built-in backup Twitch-style RTMP URL
- `BACKUP_TWITCH_STREAM_KEY`: built-in backup Twitch-style stream key
- `DESTINATION_FAILURE_COOLDOWN_SECONDS`: how long a failed destination stays on hold before the worker will retry it automatically
- `SCENE_RENDER_BASE_URL`: optional internal base URL that the worker should use when capturing published Scene Studio overlays for on-air rendering; defaults to `INTERNAL_APP_URL`, then `APP_URL`, then `http://web:3000`
- `SCENE_RENDER_INTERVAL_MS`: how often the worker refreshes captured on-air scene frames; defaults to `2000`
- `SCENE_RENDER_CHROMIUM_PATH`: optional explicit Chromium binary path for the on-air scene renderer
- `CHANNEL_TIMEZONE`: schedule timezone, for example `Europe/Berlin`
- `DISCORD_WEBHOOK_URL`: Discord alert target
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`, `ALERT_EMAIL_TO`: email alerting
- `TRAEFIK_CERT_RESOLVER`: Traefik certificate resolver name, defaults to `letsencrypt`

### What Belongs In `.env`

- infrastructure secrets
- RTMP stream keys
- optional fallback OAuth application credentials
- optional fallback SMTP / Discord credentials
- deployment-level defaults such as `CHANNEL_TIMEZONE`

### What Does Not Belong In `.env`

- moderator presence policy
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
- the existing Multi-Output RTMP fanout and destination health routing remain active during the bridge
- live snapshots expose only a sanitized input summary instead of the raw bridge URL

### Audio Lanes And Cuepoints

Stream247 now supports two additional programming controls for longer-form channels:

- pools can define an optional replace-mode audio lane using a ready `local-library` or `direct-media` asset
- audio lanes loop independently and replace the scheduled pool asset's native audio during normal scheduled playback
- schedule blocks can define cuepoint offsets in seconds from block start
- cuepoints never cut mid-file; they arm an insert and fire it on the next safe asset boundary
- cuepoints can use either a block override insert asset or the pool's automatic insert asset
- the broadcast control room shows both the active audio lane state and cuepoint progress

## Twitch App Credentials

If you need `TWITCH_CLIENT_ID` and `TWITCH_CLIENT_SECRET`, follow this section or the dedicated guide in [docs/twitch-setup.md](docs/twitch-setup.md#how-to-get-client-id-and-secret).

1. Open the Twitch developer console.
2. Create a new application or edit the existing Stream247 application.
3. Register both redirect URLs:
   - `<APP_URL>/api/integrations/twitch/callback`
   - `<APP_URL>/api/auth/twitch/callback`
4. Copy the generated Client ID into `TWITCH_CLIENT_ID`.
5. Generate, reveal, or regenerate the Client Secret and store it in `TWITCH_CLIENT_SECRET`.
6. Restart the stack after changing `.env`.
7. Use the dashboard for:
   - broadcaster connect
   - Twitch SSO sign-in for team members

Important:

- `TWITCH_CLIENT_ID` is public application identity.
- `TWITCH_CLIENT_SECRET` is private application secret.
- both can now be stored as encrypted managed settings in Stream247.
- `.env` remains supported as bootstrap and deployment fallback.

## Deployment

### Production Defaults

- Linux host
- Docker Compose
- reverse proxy in front of `web`
- optional built-in Traefik profile for HTTPS and Let's Encrypt
- persistent storage for:
  - PostgreSQL
  - Redis
  - `data/media`

See [docs/deployment.md](docs/deployment.md) for the deployment-focused guide.

### Published Images

- `ghcr.io/drjakeberg/stream247-web`
- `ghcr.io/drjakeberg/stream247-worker`
- `ghcr.io/drjakeberg/stream247-playout`

The default `.env.example` already points Compose at the `latest` GHCR tags.
For production pinning, use `.env.production.example` or set the image tags explicitly to the target release.

### Release Behavior

- `push` to `main` validates, runs queue continuity and browser smoke checks, and then publishes current images
- `push` of `v*` tags runs the release workflow for versioned images
- CI uses the public ECR mirror for `node:22-alpine` to avoid Docker Hub rate limits on GitHub-hosted runners
- production should pin explicit release tags and not follow `latest`
- release rehearsal helpers are available:
  - `pnpm release:preflight`
  - `./scripts/upgrade-rehearsal.sh v1.0.3`
  - `./scripts/soak-monitor.sh --hours 24`

Operational docs:

- [docs/upgrading.md](docs/upgrading.md)
- [docs/backup-and-restore.md](docs/backup-and-restore.md)
- [docs/operations.md](docs/operations.md)
- [docs/versioning.md](docs/versioning.md)

## Release Readiness Workflow

Before tagging a production release:

1. Pin explicit GHCR version tags in `.env`.
2. Run:
   ```bash
   pnpm release:preflight
   ```
3. Rehearse the target version:
   ```bash
   ./scripts/upgrade-rehearsal.sh v1.0.3
   ```
4. Run an extended soak:
   ```bash
   ./scripts/soak-monitor.sh --hours 24
   ```
5. Review `/ops`, `/api/health`, and `/api/system/readiness`.
6. Tag only after the rehearsal and soak are clean.

Notes:

- set `CHECK_BASE_URL=http://127.0.0.1:3000` if your public `APP_URL` points through an external proxy or domain that is not reachable from the host running the scripts
- set `SESSION_COOKIE="stream247_session=..."` if you want the soak monitor to fail on open critical incidents via the authenticated incidents API

## Feature Overview

### Authentication And Access

- owner bootstrap via setup wizard
- local session-based authentication
- optional TOTP-based two-factor authentication for the local owner account
- Twitch SSO team login
- role-based access with `owner`, `admin`, `operator`, `moderator`, `viewer`
- team access grants by Twitch login
- optional Twitch client credential capture during setup

### Sources And Assets

- local media scan from `data/media`
- direct media URL sources
- YouTube playlist ingestion via `yt-dlp`
- YouTube channel ingestion via `yt-dlp`
- Twitch VOD ingestion via `yt-dlp`
- Twitch channel ingestion via `yt-dlp`
- PostgreSQL-backed asset catalog
- source metadata capture for title, natural duration, publish time, and source category where available
- fallback asset priority and global fallback support
- source edit, enable/disable, and delete controls
- source detail pages with programming references, incidents, audit trail, and manual sync actions
- bulk source actions for enable, disable, and sync queueing
- persisted per-source sync runs with success/error summaries and last ingestion results
- source library health snapshots with latest sync outcome and open issue counts
- connector-specific troubleshooting hints for source and asset diagnostics
- playout runtime visibility for current / next / queued assets in the admin UI
- source-side asset counts and ready counts
- asset detail pages with source origin, pool context, and runtime visibility
- searchable asset library by title, source, status, and programming inclusion
- asset curation controls for include/exclude from automatic programming, folder paths, and tags
- bulk asset actions for include, exclude, fallback promotion, folder assignment, and tag management
- local-library assets retain their relative folder structure in the catalog
- `Channel Blueprints` can export and import Scene Studio, sources, programming, moderation, and destination metadata without exporting secrets or media files

### Scheduling

- weekly schedule block CRUD
- pool-based programming
- minute-accurate start times
- duration validation
- overlap detection
- reusable show profiles with default title/category/duration/color
- multi-day block creation
- weekly coverage overview
- quick-start programming templates
- day timeline with drag-and-drop rescheduling
- resize-to-change-duration editing
- filterable programming editor with search, pool/show filters, and conflict focus
- public-facing schedule page

### Playout And Broadcast Ops

- FFmpeg-based RTMP playout foundation
- pool-based round-robin playout selection
- standby replay slate when no playable asset is available
- scheduled daily reconnect window with controlled standby mode
- Live Bridge RTMP/HLS takeover with safe release back to the scheduled queue
- destination readiness state
- unified broadcast action API for restart, refresh, queue rebuild, fallback, skip, resume, and pin-on-air actions
- live admin status rail with on-air, next, destination, incident, and update state across admin pages
- playout transition state with next-asset probe / prefetch visibility
- operator restart control
- operator refresh-overlays control
- operator rebuild-queue control
- operator pin-asset override
- operator skip-current control
- temporary fallback override
- resume-schedule control
- worker-managed playout runtime state

### Twitch Automation

- broadcaster OAuth connect
- title sync from active asset metadata or schedule override
- category lookup and sync from active asset metadata or schedule override
- Twitch schedule segment sync for upcoming blocks
- Twitch SSO for team members
- moderation policy automation for emote-only fallback windows

### Moderation

- explicit moderator presence windows such as `here 30`
- configurable moderation policy in admin UI
- emote-only fallback when no active moderator window is present

### Alerts And Incident Management

- incident creation from runtime failures
- incident history with status / severity / scope filters
- incident acknowledgement
- incident resolution
- runtime drift reporting for worker, playout, schedule alignment, destination readiness, and Twitch metadata
- recent audit trail visibility in the ops view
- Discord webhook alerts
- SMTP email alerts
- audit events
- encrypted-at-rest managed integration secrets with `.env` fallback

### Overlay And Viewer Pages

- public schedule page at `/channel`
- browser-source overlay at `/overlay`
- overlay studio in admin UI
- configurable replay label, channel name, headline, accent color, emergency banner, and now/next teaser toggles

### Guided Setup And Launch

- owner bootstrap wizard
- optional Twitch client credential capture during setup
- guided go-live checklist in setup and dashboard
- readiness-oriented launch guidance for destination, assets, pools, schedule, and overlay
- settings-side update center with pinned-tag visibility, release channel hints, and preflight/runbook guidance

## Local Development

1. Copy `.env.example` to `.env`.
2. Start dependencies:
   ```bash
   docker compose up -d postgres redis
   ```
3. Install dependencies:
   ```bash
   pnpm install
   ```
4. Start the web app:
   ```bash
   pnpm dev
   ```

## Validation

The intended validation path is:

- `pnpm validate`
- `pnpm test:fresh-db`
- `pnpm test:fresh-compose`
- `pnpm test:queue-continuity`
- `pnpm test:e2e:smoke`
- Docker image build
- container smoke test

Current validation covers:

- lint
- typecheck
- unit tests
- integration tests
- production build
- fresh database bootstrap smoke
- fresh compose bootstrap smoke
- queue continuity smoke across short local-library assets
- browser smoke for bootstrap, local 2FA login, broadcast controls, and Scene Studio publish
- Docker builds
- smoke test for the web image

## Troubleshooting

### Twitch OAuth does not work

- check that `APP_URL` matches the externally reachable URL exactly
- confirm both redirect URLs are registered in the Twitch developer application
- verify `TWITCH_CLIENT_ID` and `TWITCH_CLIENT_SECRET`

### No assets are available

- put files into `data/media`
- or add a direct media URL / YouTube playlist / YouTube channel / Twitch VOD / Twitch channel source
- check worker incidents if ingestion failed

### Stream output is not ready

- verify `TWITCH_STREAM_KEY` or `STREAM_OUTPUT_KEY`
- verify `TWITCH_RTMP_URL` or `STREAM_OUTPUT_URL`
- inspect destination state and incidents on the dashboard

### Email alerts do not send

- verify `SMTP_HOST`
- verify `SMTP_FROM`
- verify `ALERT_EMAIL_TO`
- verify SMTP auth settings if your server requires them

## Monorepo Layout

- `apps/web`: Next.js admin UI, public pages, and API routes
- `apps/worker`: background ingestion, reconciliation, and playout logic
- `packages/core`: scheduling and moderation domain logic
- `packages/config`: runtime config helpers
- `packages/db`: PostgreSQL-backed application state layer
- `docs`: architecture, deployment, and Twitch setup docs
- `.github`: CI, release, issues, and PR templates

## Roadmap

- encrypted secret management from the setup/admin UI
- richer multi-scene overlay composition
- more advanced playout transitions and switchovers
- deeper ops views, filtering, and historical analytics
- more powerful timeline authoring directly in the schedule editor

## License

Apache-2.0
