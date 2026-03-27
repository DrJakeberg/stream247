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
5. Run:
   ```bash
   pnpm release:preflight
   ```
6. Update the pinned image tags in your Compose configuration, or rehearse the target version with:
   ```bash
   ./scripts/upgrade-rehearsal.sh v1.0.0
   ```
7. Pull the new images.
8. Restart the stack.
9. Check:
   - `/api/health`
   - `/api/system/readiness`
   - `/ops`
   - current broadcast state
10. For production candidates, run:
    ```bash
    ./scripts/soak-monitor.sh --hours 24
    ```

Useful overrides:

- `CHECK_BASE_URL=http://127.0.0.1:3000` if `APP_URL` is externally routed and not directly reachable from the host
- `SESSION_COOKIE="stream247_session=..."` if the soak monitor should also fail on open critical incidents from the authenticated incidents API

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
