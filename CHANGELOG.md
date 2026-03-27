# Changelog

## Unreleased

- Added encrypted managed secret storage with `.env` fallback.
- Added a dedicated ops workspace with incident filters, drift checks, and recent audit visibility.
- Added worker/playout healthcheck commands and Docker Compose healthchecks.
- Added playout crash-loop protection metadata and richer readiness output.

## Versioning Policy

- `latest` is for evaluation and non-production testing.
- Production deployments should pin explicit version tags such as `v1.0.0`.
- Read `docs/upgrading.md` before upgrading between versions.
