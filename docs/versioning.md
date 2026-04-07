# Versioning

## Channels

- `latest`: development and evaluation
- `v*` tags: production releases
- `main-<sha>`: CI-published build snapshots from `main`

## Production Recommendation

Pin exact versions in Compose.

Do not auto-track `latest` for a 24/7 production channel.

## Update Strategy

- use staged stable releases
- back up before upgrading
- verify readiness and ops state after every upgrade
- keep rollback instructions and the previous image tags available

## 1.0.3 Release Flow

1. Ensure `main` is green in CI.
   CI now covers fresh DB/Compose bootstrap, queue continuity, runtime parity, production-config release preflight, and browser smoke before `main` images publish.
2. Copy `.env.production.example` to `.env`, replace the required placeholder values, and then run:
   ```bash
   cp .env.production.example .env
   pnpm release:preflight
   pnpm test:runtime-parity
   pnpm test:e2e:smoke
   ./scripts/upgrade-rehearsal.sh v1.0.3
   ./scripts/soak-monitor.sh --hours 24
   ```
3. Commit any final release-note or versioning adjustments.
4. Create and push the release tag:
   ```bash
   git tag -a v1.0.3 -m "Stream247 1.0.3"
   git push origin v1.0.3
   ```
5. Let the `release.yml` workflow publish the pinned GHCR images for `v1.0.3`.

Notes:

- `pnpm release:preflight` rejects blank required settings plus untouched `.env.example` and `.env.production.example` placeholder values
- local `pnpm release:preflight` should keep its default full-validation behavior
- CI and `release.yml` set `RELEASE_PREFLIGHT_SKIP_VALIDATE=1` only after the outer workflow job has already completed `pnpm validate`
