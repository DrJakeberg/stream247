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
5. Optionally pin `STREAM247_WEB_IMAGE`, `STREAM247_WORKER_IMAGE`, and `STREAM247_PLAYOUT_IMAGE` to specific GHCR release tags.
6. Add `TWITCH_CLIENT_ID` and `TWITCH_CLIENT_SECRET` if OAuth should work from the browser UI.
7. Run `docker compose up -d`.
8. Open `/setup` and create the owner account.
9. Sign in and finish Twitch connection from the dashboard.
10. Put playable files into `data/media` so the worker can ingest them.

## Secrets And Runtime Settings

- `POSTGRES_PASSWORD` belongs in `.env`.
- `TWITCH_CLIENT_SECRET` belongs in `.env`.
- Moderator presence policy does not belong in `.env`; it is edited live in the admin UI and stored in PostgreSQL.
- The setup wizard currently does not persist third-party client secrets because browser-entered secrets would otherwise be stored in plaintext.

## Release Channel

- Production Compose should pull from `ghcr.io/drjakeberg/stream247-web:<tag>`.
- Worker and playout should pull from `ghcr.io/drjakeberg/stream247-worker:<tag>`.
- Development should use `docker-compose.dev.yml` with local builds.
