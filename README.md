# Stream247

Stream247 is a self-hosted platform for operating a 24/7 Twitch-first channel from managed video sources such as YouTube playlists, Twitch VODs, and local media libraries.

## Goals

- Run a continuous playout channel with fallback content.
- Manage sources, playlists, schedules, moderation policies, alerts, and Twitch automation from a polished admin UI.
- Publish a public-facing schedule page for viewers.
- Ship as Docker and Docker Compose with validation gates before images are released.

## Planned Capabilities

- Source ingestion for YouTube playlists, Twitch VODs, local media, and direct media URLs
- Timeline-based scheduling with deterministic playout queue generation
- Drag/drop timeline editing and operator override lanes
- Moderator presence windows such as `here 30` to disable emote-only mode temporarily
- Discord and email alerting
- Audit logging, incidents, and health checks

## Monorepo Layout

- `apps/web`: Next.js admin UI, public schedule pages, and API routes
- `packages/core`: domain types and scheduling/moderation logic
- `packages/config`: runtime config helpers
- `docs`: architecture and operational docs
- `.github`: issue templates, pull request template, and CI workflows

## Deploy With Docker

1. Copy `.env.example` to `.env`.
2. Set `APP_URL`, `APP_SECRET`, `POSTGRES_PASSWORD`, and the matching password inside `DATABASE_URL`.
3. Set `TWITCH_CLIENT_ID` and `TWITCH_CLIENT_SECRET` if you want browser-based Twitch OAuth and Twitch SSO.
4. Set `TWITCH_STREAM_KEY` and optionally override `TWITCH_RTMP_URL` or the generic `STREAM_OUTPUT_URL` / `STREAM_OUTPUT_KEY` pair if playout should push RTMP output.
5. Set `CHANNEL_TIMEZONE` to the timezone the schedule should follow.
6. Optionally pin `STREAM247_WEB_IMAGE`, `STREAM247_WORKER_IMAGE`, and `STREAM247_PLAYOUT_IMAGE` to specific GHCR tags.
7. Start the stack with `docker compose up -d`.
8. For local development builds, use `docker compose -f docker-compose.dev.yml up -d --build`.
9. Open `http://localhost:3000/setup`.
10. Create the owner account in the setup wizard.
11. Sign in to the admin UI and connect Twitch from the dashboard.
12. Drop local media files into `data/media` or add direct media URL sources so the worker can ingest them into the asset catalog.

## Environment Model

- Put infrastructure and secret values in `.env`.
- Keep `POSTGRES_PASSWORD` in `.env`, not hardcoded in Compose.
- Keep `TWITCH_CLIENT_SECRET` in `.env`, not in normal runtime settings.
- Keep RTMP stream keys such as `TWITCH_STREAM_KEY` in `.env`.
- Keep `CHANNEL_TIMEZONE` in `.env` until timezone management is exposed in the admin UI.
- Do not keep moderator presence policy in `.env`; it is runtime state managed from the admin UI.
- `MEDIA_LIBRARY_ROOT` should normally stay `/app/data/media` inside containers.

## Twitch App Credentials

1. Open the Twitch developer console and create or edit an application.
2. Add both redirect URLs:
   - `<APP_URL>/api/integrations/twitch/callback`
   - `<APP_URL>/api/auth/twitch/callback`
3. Copy the generated Client ID into `TWITCH_CLIENT_ID`.
4. Generate or reveal the Client Secret and place it into `TWITCH_CLIENT_SECRET`.
5. Restart the stack if you changed `.env`.
6. Use the setup/dashboard UI to complete broadcaster connect and team SSO flows.

## Local Development

1. Copy `.env.example` to `.env`.
2. Start dependencies with `docker compose up -d postgres redis`.
3. Install dependencies with `pnpm install`.
4. Start the app with `pnpm dev`.

## Validation

Every release image should be gated by:

- lint
- typecheck
- unit tests
- integration tests
- build
- Docker image build
- container smoke test

## Release Images

- Production images are published to `ghcr.io/drjakeberg/stream247-web`.
- Background worker images are published to `ghcr.io/drjakeberg/stream247-worker`.
- Playout images are published to `ghcr.io/drjakeberg/stream247-playout`.
- CI builds use the public ECR mirror of the Docker Official `node:22-alpine` image to avoid Docker Hub rate-limit failures on GitHub-hosted runners.
- Tagging `v*` on GitHub triggers the release workflow to validate, build, smoke-test, and publish the image.

## Current Feature Status

- Implemented now:
  - local media library ingestion
  - direct media URL ingestion
  - YouTube playlist ingestion via yt-dlp
  - Twitch VOD ingestion via yt-dlp
  - minute-accurate schedule block editing from the admin UI
  - Twitch broadcaster connect and Twitch SSO team login
  - Twitch metadata sync for title and category from the active schedule block
  - Twitch schedule sync for upcoming schedule blocks
  - FFmpeg-based RTMP playout foundation
  - incident tracking, readiness checks, Discord webhook alerts, and SMTP email alerts
- Not implemented yet:
  - browser-stored third-party secrets from the setup wizard
  - drag/drop timeline editing and operator override lanes

## License

Apache-2.0
