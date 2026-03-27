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
4. Add `TWITCH_CLIENT_ID` and `TWITCH_CLIENT_SECRET` if OAuth should work from the browser UI.
5. Run `docker compose up -d --build`.
6. Open `/setup` and create the owner account.
7. Sign in and finish Twitch connection from the dashboard.
