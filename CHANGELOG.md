# Changelog

## Unreleased

- No unreleased changes currently tracked.

## 1.5.18 - 2026-08-18

Emergency production fix. DUT had been in a playout restart loop for ~38 hours: 423 restarts,
one every ~5 minutes, with the program pinned to fallback content the whole time.

The boundary-stability work in 1.5.11–1.5.17 assumed an expensive remote resolve stays within
"~60-120s" (queue-prefetch.ts). That assumption was documented in comments but never enforced in
code, and production ran with `TWITCH_VOD_CACHE_DOWNLOAD_TIMEOUT_SECONDS=7200` — 24x the 300s
loop stall guard. `raceResolveAgainstDeath` did not help, because it only unblocks when the
covering playout process dies, and that process was healthily playing the fallback.

### Fixed

- take Twitch VOD downloads off the playout reconciliation cycle entirely: cycles now do a
  read-only cache lookup (`peekTwitchVodCache`) and hand uncached assets to a detached job
  runner, so an unbounded download can no longer consume the cycle's stall budget (v1.5.18)
- resume interrupted VOD downloads instead of restarting them: background jobs use a stable part
  path with `--continue`. The previous per-attempt random path meant a multi-GB VOD restarted
  from zero on every container restart, so with a 5-minute restart cycle it could never finish
  no matter how large the configured timeout was (v1.5.18)
- clamp every timeout awaited on a reconciliation cycle to half the loop stall budget, so an
  operator-configured value can no longer outlive the watchdog that is supposed to catch it
  (v1.5.18)

### Added

- `cycle-budget.ts` as the single source of truth for the loop stall budget and the derived
  ceiling for awaited cycle operations, making the previously implicit timing contract explicit
  and testable (v1.5.18)
- advisory file lock with heartbeat and stale-holder takeover, so the worker and playout
  containers sharing the media volume cannot both write the same resume file (v1.5.18)

## 1.5.17 - 2026-06-12

Accepted runtime-stable production baseline. A clean 24h DUT soak completed naturally
(1415/1415 healthy samples; 100% scheduled_match; 0 readiness failures, 0 programFeed=stale,
0 broadcastReady=false, 0 destination=degraded, 0 uplink unplanned-restart delta) with multiple
clean playout boundaries and no boundary-coupled uplink restarts. Scheduled-path acceptance
granted. Caps the boundary-stability campaign whose fixes all held simultaneously in the soak.

### Fixed

- never block the post-boundary start path on queue prefetch: while no playout process is running, the per-cycle expensive-resolve budget is forced to 0, and an expensive resolve already in flight when the playout process exits is abandoned within milliseconds (the background resolve still populates the probe cache, with in-flight dedup) — closing a ~94s no-playout gap that drained the program-feed buffer (v1.5.17)
- keep the program-feed HLS `EXT-X-MEDIA-SEQUENCE` continuous across playout runs by dropping the per-run `-hls_start_number_source` override, so the persistent uplink demuxer no longer sees a per-boundary sequence jump ("skipping … segments ahead, expired from playlists"), hits EOF, and restarts once per asset boundary into destination degradation (v1.5.16)
- bridge to the local fallback immediately on a clean natural boundary (not only a failed exit) when the next scheduled asset needs a cold expensive remote resolve, so coverage is never dark during the resolve (v1.5.15)
- bridge to local fallback on a failure-driven dark gap and invalidate the probe cache after an immediate ffmpeg input-open failure so a dead/expired resolved URL is re-resolved instead of reused (v1.5.14)
- cap remote queue prefetch to one expensive resolve per playout cycle so a cascade of uncached remote queue assets cannot exceed the loop stall guard and force-restart the playout container (v1.5.13)

### Changed

- bound the single-destination recovery window by lowering the destination-failure cooldown and uplink destination-stall restart defaults to 60s (v1.5.12)

## 1.1.2 - 2026-04-19

### Added

- added cache-backed Twitch VOD playback so archive assets are verified locally before playout uses them
- added a persistent local relay/uplink publishing mode so program playout failures no longer directly own the external RTMP session

### Changed

- moved scheduled output reconnect ownership to the uplink path, keeping the default Twitch reconnect cadence at 48 hours
- updated production pins and release guidance for the relay/uplink runtime

## 1.0.3 - 2026-04-03

### Fixed

- fixed Twitch channel archive ingestion so channel connectors sync archive VODs instead of failing on offline channel pages
- fixed Twitch archive playback URL normalization for `v<id>` entries emitted by `yt-dlp`
- fixed worker/playout healthchecks by marking ESM worker packages explicitly as modules
- fixed source validation for real YouTube handle/channel URLs and repaired the sources UI for long names and URLs
- fixed playout state recovery so valid assets can automatically clear crash-loop protection
- blocked destructive source deletion while sources are still referenced by pools or schedule blocks
- fixed standby-to-asset switching so the old FFmpeg process is fully stopped before a new one starts
- fixed pool playout selection so the currently running asset stays active instead of rotating every worker cycle

## 1.0.2 - 2026-04-03

### Fixed

- fixed `playout_runtime` persistence SQL so worker and playout no longer crash on PostgreSQL-backed state writes
- stable production env example now points at `v1.0.2`

## 1.0.1 - 2026-03-27

### Added

- added `.env.production.example` with pinned `v1.0.0` image tags for stable deployment
- clarified README and deployment docs to distinguish evaluation envs from production-pinned envs

## 1.0.0 - 2026-03-27

First stable self-hosted release for running a Twitch-first 24/7 channel with Docker, GHCR images, scheduling, source ingestion, playout control, Twitch sync, overlays, and operator tooling.

### Added

- Docker / GHCR delivery with `web`, `worker`, and `playout` images
- setup wizard with owner bootstrap and local login
- Twitch broadcaster connect and Twitch SSO for team access
- encrypted-at-rest managed secret storage with `.env` fallback
- PostgreSQL-backed runtime state and persistent operational data
- local media, direct media URL, YouTube playlist, and Twitch VOD ingestion
- minute-accurate schedule editing with drag-and-drop timeline repositioning
- FFmpeg-based playout foundation with fallback selection and operator overrides
- browser-source overlay page and overlay studio
- Twitch title, category, and schedule segment sync
- moderation policy, incidents, drift checks, Discord alerts, and SMTP email alerts
- worker/playout healthchecks, crash-loop protection, release preflight, upgrade rehearsal, and soak-monitor tooling

### Operational Notes

- `latest` is for evaluation and non-production testing.
- Production deployments should pin explicit version tags such as `v1.0.0`.
- Read `docs/upgrading.md`, `docs/backup-and-restore.md`, and `docs/operations.md` before production upgrades.

## Versioning Policy

- `latest` is for evaluation and non-production testing.
- Production deployments should pin explicit version tags such as `v1.0.0`.
- Read `docs/upgrading.md` before upgrading between versions.
