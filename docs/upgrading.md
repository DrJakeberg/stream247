# Upgrading

## Production Default

Use pinned GHCR image tags in production.

Example:

- `ghcr.io/drjakeberg/stream247-web:v1.0.0`
- `ghcr.io/drjakeberg/stream247-worker:v1.0.0`
- `ghcr.io/drjakeberg/stream247-playout:v1.0.0`

Do not use `latest` for unattended production deployments.

## Safe Upgrade Flow

1. Read the changelog and release notes.
2. Create a PostgreSQL backup.
3. Back up `.env`.
4. Confirm `data/media` is intact.
5. Update the pinned image tags in your Compose configuration.
6. Pull the new images.
7. Restart the stack.
8. Check:
   - `/api/health`
   - `/api/system/readiness`
   - `/ops`
   - current broadcast state

## Patch vs Minor Upgrades

- Patch upgrades should be the default production path.
- Minor upgrades may require reading upgrade notes carefully.
- Downgrades are not guaranteed unless explicitly documented in the release notes.

## Rollback

If the new version is unhealthy:

1. Stop the stack.
2. Restore the previous pinned image tags.
3. Restart.
4. If the database schema is incompatible, restore the PostgreSQL backup as well.
