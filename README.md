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
- Twitch metadata sync for title, category, and schedule
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
2. Set `APP_URL` and `APP_SECRET`.
3. Set `TWITCH_CLIENT_ID` and `TWITCH_CLIENT_SECRET` if you want browser-based Twitch OAuth.
4. Start the stack with `docker compose up -d --build`.
5. Open `http://localhost:3000/setup`.
6. Create the owner account in the setup wizard.
7. Sign in to the admin UI and connect Twitch from the dashboard.

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

## License

Apache-2.0
