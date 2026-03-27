# Deployment

## Production Defaults

- CPU-first Linux host
- Docker Compose
- Reverse proxy in front of `web`
- Persistent volumes for PostgreSQL, Redis, and media cache

## Deployment Steps

1. Copy `.env.example` to `.env`.
2. Fill Twitch and alert credentials.
3. Run `docker compose up -d --build`.
4. Open the admin UI and complete first-run setup.

