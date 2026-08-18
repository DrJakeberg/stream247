# Changelog

## Unreleased

- No unreleased changes currently tracked.

## 1.5.19 - 2026-08-18

Emergency production release. Supersedes the 1.5.18 tag, whose release build failed before
publishing any image (the Release workflow ran before CI had pushed the `main-<sha>` snapshots it
pulls from). No 1.5.18 images exist; 1.5.19 is the artifact to deploy.

Carries the 1.5.18 playout fix below plus a critical, remotely exploitable authentication flaw and
four runtime failure modes, all found by an adversarially-verified audit pass over the product.

### Breaking

- **`APP_SECRET` must be at least 32 characters in production and may not be the published
  `stream247-dev-secret` constant.** A deployment that does not satisfy this now fails instead of
  silently signing sessions with a guessable key. `pnpm release:preflight` checks it before rollout
  and prints the remedy (`openssl rand -base64 48`). Rotating the value invalidates existing
  sessions, so everyone signs in again once.

### Security

- close a full workspace takeover via the Twitch OAuth connect callback. The route had no auth
  guard, `middleware.ts` only matches `/overlay`, and the OAuth `state` was the literal flow name
  that no callback read back. An attacker could authorise their own Twitch account against the
  publicly discoverable client_id, hand the code to the callback to overwrite the workspace's
  broadcasterId and tokens, then complete SSO — which grants "owner" to whoever matches that
  broadcasterId — and hold an owner session without ever knowing a password. State is now random,
  single-use, flow-scoped and bound to an HttpOnly cookie, and the connect callback requires an
  owner/admin session (v1.5.19)
- stop falling back to the published `stream247-dev-secret` constant when `APP_SECRET` is unset in
  production. This project is source-available, so that fallback let anyone forge a session cookie
  for any user id. Startup now fails loudly and rejects secrets under 32 characters (v1.5.19)
- expire session cookies. The issue timestamp was already inside the signed payload but was never
  checked, so a leaked cookie was valid forever. Default 30 days via `SESSION_MAX_AGE_SECONDS`
  (v1.5.19)

### Fixed

- escalate to SIGKILL when stopping playout. The guard also required `!currentProcess.killed`, but
  Node sets `killed` as soon as SIGTERM is delivered, so escalation was unreachable and an ffmpeg
  blocked on a dead input never died — turning a 5s stop into a 300s stall and a container restart.
  A hard stop deadline now bounds the wait even for a child that survives SIGKILL (v1.5.19)
- clear `plannedStopReason` on the early-return path of `stopPlayoutProcess`, so the next genuine
  crash is no longer recorded as an operator-planned stop (v1.5.19)
- handle unhandled promise rejections instead of dying. The fire-and-forget state writes in the
  ffmpeg stderr handler could reject during a transient Postgres outage and kill the broadcast with
  no incident, no alert and no log entry (v1.5.19)
- attach an 'error' listener to both spawned ffmpeg processes; a spawn failure was rethrown
  asynchronously as an uncaught exception the caller's try/catch could not see (v1.5.19)
- split liveness from readiness. Every check in the project used `/api/health`, which returned 200
  unconditionally, so a rollout with Postgres unreachable passed its gates and reported healthy.
  `/api/health` stays liveness (200 while the process serves — restarting the web container does
  not fix a dead database and only removes the UI needed to diagnose it), and the new `/api/ready`
  fails closed with 503 when persistence is unreachable or the workspace was never initialised.
  `upgrade-rehearsal.sh` now gates on `/api/ready` (v1.5.19)
- escape operator-configured chat commands and vote tokens before interpolating them into regular
  expressions run against every IRC message; a command containing "(" threw inside the socket data
  handler and took the worker down (v1.5.19)

## 1.5.18 - 2026-08-18 (unreleased; no images published)

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
