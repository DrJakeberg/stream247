# Deployment

## Production Defaults

- CPU-first Linux host
- Docker Compose
- Reverse proxy in front of `web`
- Persistent volumes for PostgreSQL, Redis, and app state in `data/app`

## Deployment Steps

1. Copy `.env.example` to `.env`.
2. Set `APP_URL` to the externally reachable base URL.
3. Set `APP_SECRET` to a long random secret.
4. Optionally pin `STREAM247_WEB_IMAGE` to a specific GHCR release tag.
5. Add `TWITCH_CLIENT_ID` and `TWITCH_CLIENT_SECRET` if OAuth should work from the browser UI.
6. Run `docker compose up -d`.
7. Open `/setup` and create the owner account.
8. Sign in and finish Twitch connection from the dashboard.

## Release Channel

- Production Compose should pull from `ghcr.io/drjakeberg/stream247-web:<tag>`.
- Development should use `docker-compose.dev.yml` with local builds.
