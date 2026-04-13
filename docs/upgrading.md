# Upgrading

## Production Default

Use pinned GHCR image tags in production.

Example:

- `ghcr.io/drjakeberg/stream247-web:v1.1.0`
- `ghcr.io/drjakeberg/stream247-worker:v1.1.0`
- `ghcr.io/drjakeberg/stream247-playout:v1.1.0`

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
   The preflight rejects blank or quoted-empty required settings plus untouched `.env.example` and `.env.production.example` placeholder values, including Traefik example defaults when proxy settings are present, so replace those first.
6. Update the pinned image tags in your Compose configuration, or rehearse the target version with:
   ```bash
   ./scripts/upgrade-rehearsal.sh v1.1.0
   ```
   Before a new release tag exists, the rehearsal automatically uses the CI-published `main-<sha>` snapshot for the current commit instead of requiring `ghcr.io/...:v1.1.0` to exist already.
7. Pull the new images.
8. Restart the stack.
9. Check:
   - `/api/health`
   - `/api/system/readiness` and confirm `broadcastReady=true`
   - `/ops`
   - current broadcast state
10. For production candidates, run:
    ```bash
    ./scripts/soak-monitor.sh --hours 24
    ```
    The soak gate now fails if broadcast readiness drops or never becomes ready.

Useful overrides:

- `CHECK_BASE_URL=http://127.0.0.1:3000` if `APP_URL` is externally routed and not directly reachable from the host
- `SESSION_COOKIE="stream247_session=..."` if the soak monitor should also fail on open critical incidents from the authenticated incidents API
- `RELEASE_PREFLIGHT_ENV_FILE=/path/to/production.env` if you want `pnpm release:preflight` to validate a staged env file without replacing the current `.env`
- `UPGRADE_REHEARSAL_IMAGE_TAG=main-<sha>` if you need to force a specific pre-release snapshot tag during rehearsal

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
