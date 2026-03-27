# Deployment

## Production Defaults

- CPU-first Linux host
- Docker Compose
- Reverse proxy in front of `web`
- Persistent volumes for PostgreSQL, Redis, and media files in `data/media`

## Deployment Steps

1. Copy `.env.example` to `.env`.
2. Set `APP_URL` to the externally reachable base URL.
3. Set `APP_SECRET` to a long random secret.
4. Set `POSTGRES_PASSWORD` and update the password inside `DATABASE_URL` to match.
5. Set `TWITCH_STREAM_KEY` and keep `TWITCH_RTMP_URL=rtmp://live.twitch.tv/app` unless another RTMP destination is required.
6. Set `CHANNEL_TIMEZONE` to the timezone the schedule should follow.
7. Optionally pin `STREAM247_WEB_IMAGE`, `STREAM247_WORKER_IMAGE`, and `STREAM247_PLAYOUT_IMAGE` to specific GHCR release tags.
8. Add `TWITCH_CLIENT_ID` and `TWITCH_CLIENT_SECRET` if OAuth should work from the browser UI.
9. Run `docker compose up -d`.
10. Open `/setup` and create the owner account.
11. Sign in and finish Twitch connection from the dashboard.
12. Put playable files into `data/media` or add direct media URL sources so the worker can ingest them.

## Secrets And Runtime Settings

- `POSTGRES_PASSWORD` belongs in `.env`.
- `TWITCH_CLIENT_SECRET` belongs in `.env`.
- `TWITCH_STREAM_KEY` belongs in `.env`.
- `CHANNEL_TIMEZONE` belongs in `.env` for now.
- Moderator presence policy does not belong in `.env`; it is edited live in the admin UI and stored in PostgreSQL.
- The setup wizard currently does not persist third-party client secrets because browser-entered secrets would otherwise be stored in plaintext.

## Release Channel

- Production Compose should pull from `ghcr.io/drjakeberg/stream247-web:<tag>`.
- Worker should pull from `ghcr.io/drjakeberg/stream247-worker:<tag>`.
- Playout should pull from `ghcr.io/drjakeberg/stream247-playout:<tag>`.
- Development should use `docker-compose.dev.yml` with local builds.

## Current Capability Notes

- Local media and direct media URLs are ingestible today.
- YouTube playlist and Twitch VOD sources are stored and shown in the UI, but are not yet ingested into assets.
- Discord alert dispatch exists; SMTP email delivery is not implemented yet.
