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

## 1.0.0 Release Flow

1. Ensure `main` is green in CI.
2. Run:
   ```bash
   pnpm release:preflight
   ./scripts/upgrade-rehearsal.sh v1.0.0
   ./scripts/soak-monitor.sh --hours 24
   ```
3. Commit any final release-note or versioning adjustments.
4. Create and push the release tag:
   ```bash
   git tag -a v1.0.0 -m "Stream247 1.0.0"
   git push origin v1.0.0
   ```
5. Let the `release.yml` workflow publish the pinned GHCR images for `v1.0.0`.
