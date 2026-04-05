# Upstream Gap Analysis For Stream247

Updated: 2026-04-05

## Goal And Method

This document compares Stream247 against public Upstream product behavior and help documentation only. It does not copy Upstream branding, UI, wording, or implementation details. The goal is to identify the capability gap that a self-hosted platform should close in order to become the best original self-hosted alternative for 24/7 channel automation.

Public evidence reviewed:

- Upstream features pages and blog
- Upstream help articles about:
  - 24/7 setup
  - custom RTMP
  - multistreaming
  - backup stream behavior
  - stream designer layers, custom fonts, current-video overlays, website embeds, alerts, and presets
  - scheduling repeat behavior
  - playback/reliability controls
  - platform limits and operational guidance

Repo source of truth reviewed:

- `README.md`
- package scripts and workspace manifests
- docs, Docker files, Compose files, and CI workflows
- `apps/web`, `apps/worker`, `packages/*`, and current tests

## Stream247 Baseline

Current Stream247 repo truth:

- self-hosted monorepo with Next.js admin/public app, worker/playout runtime, PostgreSQL, Redis, Docker Compose, GHCR delivery, and CI/release workflows
- current product already includes:
  - sources from local uploads/library, direct media, YouTube playlists/channels, and Twitch VODs/channels
  - pools, weekly scheduling, show profiles, templates, duplication, day cloning, and search/filtering
  - SSE-driven broadcast control room and live public overlay/channel pages
  - operator actions for restart, hard reload, fallback, insert, skip, resume, reconnect, and asset override
  - persistent queue state with current, next, previous, and transition-target visibility
  - operator queue actions for play now, move next, remove next, and replay previous
  - overlay draft/publish, scene presets, layer order/visibility, ticker/badge controls, and a canonical scene payload shared by browser and playout consumers
  - optional two-factor authentication for local owner accounts
  - browser smoke coverage for setup bootstrap, local 2FA login, on-air controls, and Scene Studio publish
  - incidents, drift, readiness, alerts, encrypted managed secrets, and backup RTMP failover
- current architectural risks remain concentrated in:
  - `apps/worker/src/index.ts`
  - `packages/db/src/index.ts`
  - limited automated coverage for runtime continuity and browser workflows

## Capability Matrix

| Capability | Public Upstream Evidence | Stream247 Status | Repo Evidence | Gap | Recommended Milestone | Constraints / Notes |
| --- | --- | --- | --- | --- | --- | --- |
| 24/7 prerecorded streaming | Public product positioning and help docs clearly center on permanent pre-recorded live channels | Parity | README, worker runtime, playout docs | keep strengthening reliability | M3 | Must stay self-hosted, Docker-first |
| Scheduling and repeat behavior | Public docs/blog describe scheduling, repeat every day, and reliable automation | Partial parity | schedule blocks, templates, repeat sets, materialized fill preview, queue-aware editor, show profiles | needs denser week operations and timed insert/cuepoint automation | M4, M8 | Preserve current weekly block model and extend it |
| Live playback controls | Public pages and docs show live controls, refresh/hard reload, and playlist control | Partial parity | broadcast workspace and broadcast actions | needs richer queue surgery, play-now, move-next, replay previous | M3 | Keep original naming as `On-Air Controls` |
| Stream designer / overlay designer | Public designer supports layered overlays, custom fonts, current media metadata, and more | Partial parity | overlay studio with presets, layer order, publish workflow, shared scene payload contract, and an on-air scene renderer v1 | missing richer layer types such as images, websites, and widget embeds | M3, M4 | Do not copy Upstream visual design or naming |
| Websites and widget embeds | Public help covers website embeds and StreamElements-style widgets/alerts | Missing | no on-air scene embed engine today | add safe embed-capable scene layer system | M2 | Respect CSP, iframe, and X-Frame-Options limits |
| Reusable playlists / designer presets | Public help supports saving and loading playlists and designer settings | Partial parity | overlay scene preset library and Channel Blueprint export/import now exist | still missing broader reusable programming packages and cross-install media remapping helpers | M5 | Use original `Channel Blueprints` naming |
| RTMP destinations | Public docs cover custom RTMP and platform-specific outputs | Partial parity | built-in primary/backup outputs plus additional managed RTMP outputs | still needs richer per-output operator controls and deeper platform-specific guidance | M6 | Keep current primary/backup flow functional |
| Multistream outputs | Public help says one stream can be sent to many platforms | Partial parity | multi-output delivery groups with health-aware primary/backup routing now exist | still missing broader operator UX and non-RTMP platform workflows | M6 | Must not assume cloud delivery infrastructure |
| Backup stream / uninterrupted failover | Public docs describe synchronized backup stream behavior | Partial parity | backup slot, cooldown-aware failover | needs stronger failover semantics and operator visibility | M6 | Preserve simple fallback mode first |
| Live ingest / live studio equivalent | Public product exposes live studio/live source workflows | Missing | no live ingress path today | add `Live Bridge` takeover mode | M7 | High-risk runtime milestone |
| Separate audio and video playlists / secondary audio | Public product advertises separate audio/video and secondary audio channel | Missing | current queue is single-track media-first | add audio lanes and secondary audio later | M8 | High complexity, later milestone |
| Timed inserts / stings / ads | Public product exposes stings/jingles/ads and cuepoint concepts | Partial parity | manual and pool-based inserts exist | needs timed insert rules and cuepoint-like automation | M4, M8 | Build on current insert runtime instead of replacing it |
| Advanced media library | Public blog/help shows advanced media library and upload-oriented workflows | Partial parity | uploads, sources, asset library, folder/tag curation, bulk source actions, bulk asset curation | still missing thumbnails, richer grouping, and deeper asset ops | M5 | Stay local-disk-first, later optional object storage |
| Team / operator workflow | Public product highlights team access and collaborative operations | Partial parity | team roles, Twitch SSO, broadcast workspace | needs richer operator-centric flows and better mobile/tablet support | M4, M9 | Do not clone UI, keep original control-room model |
| Reliability and recovery | Public docs cover refresh/hard reload, backup streams, platform limits, and guidance | Partial parity | incidents, drift, health, upgrade rehearsal, soak, backup destination | needs queue continuity gates, scene publish safety, richer structured recovery flows | M3, M9 | Keep release rehearsal and soak scripts as baseline |
| Platform integration guidance | Public help includes platform-specific RTMP, YouTube setup, stream key changes, duration limits | Partial parity | deployment, twitch-setup, versioning docs | add stronger destination-specific runbooks and UI guidance | M6, M9 | Avoid unsupported platform claims |

## Current Parity

- self-hosted Docker / Compose / GHCR delivery
- 24/7 prerecorded output with FFmpeg-based RTMP delivery
- browser-based admin UI with live broadcast state
- Scene Studio payload shared by browser overlays and playout scene consumers
- on-air scene renderer v1 driven from the published Scene Studio output with text-overlay fallback
- team roles and Twitch SSO
- local and remote source ingestion
- weekly schedule authoring with pools and show profiles
- explicit repeat-set authoring for daily, weekday, weekend, and custom recurring blocks
- materialized fill preview that simulates pool rotation, insert rules, and natural asset duration
- operator actions for restart, fallback, reconnect, skip, insert, and asset override
- operator queue actions for play now, move next, remove next, and replay previous
- queue continuity smoke coverage for short local-library rotations plus browser smoke coverage for critical operator workflows
- encrypted secrets, incidents, alerts, readiness, and upgrade rehearsal
- structured worker runtime event logging
- asset folders/tags plus bulk curation workflows inside the library
- `Channel Blueprints` for opt-in export/import of scenes, sources, programming, moderation, and destination metadata

## Partial Parity

- scene/overlay system
- scene contract unification across browser and playout consumers
- reusable presets
- media library and uploads
- scheduling and repeat workflows
- queue and playback control
- operator-safe queue surgery
- deterministic short-asset queue continuity with smoke coverage
- destination management and failover
- Multi-Output RTMP fanout with health-aware primary/backup routing
- operator UX polish
- reliability and validation gates
- local account security

## Missing Features

Top missing product capabilities:

1. richer scene layers: images, logos, widgets, websites, metadata blocks, richer typography
2. deeper persistent queue and transition controller with less reliance on hard encoder restarts
3. `Live Bridge` live ingest cutover and return-to-queue workflow
4. thumbnails, richer grouping, and reusable curated sets inside the library
5. deeper `Channel Blueprints` support such as cross-install media remapping and richer reusable programming packages
6. cuepoint-style timed insert automation inside longer blocks
7. richer browser-driven embeds and widget layers with CSP-safe handling
8. stronger per-output operator controls and destination-specific recovery UI
9. secondary audio lanes and richer audio routing
10. longer-running soak coverage and broader browser E2E depth beyond the current critical-path smoke suite

## Legal Constraints

- Do not copy Upstream branding, UI, marketing language, or proprietary terminology.
- Derive capabilities from public behavior only.
- Use original product names in Stream247:
  - `Scene Studio`
  - `On-Air Controls`
  - `Multi-Output`
  - `Live Bridge`
  - `Channel Blueprints`
- Do not reintroduce permanent YouTube embed playback behavior that public Upstream documentation now discourages or marks discontinued.
- Respect third-party widget and website embedding restrictions such as CSP, iframe policies, and licensing terms.

## Technical Constraints

- Preserve the current self-hosted architecture and monorepo layout.
- Prefer extending `apps/web`, `apps/worker`, `packages/core`, and `packages/db` over rewrites.
- Keep SQL + `pg` as the current persistence stack.
- Use additive migrations and targeted writers first.
- Reuse existing validation and release tooling:
  - `pnpm validate`
  - `pnpm test:fresh-db`
  - `pnpm test:fresh-compose`
  - Docker smoke builds
  - release preflight / upgrade rehearsal / soak monitor
- Maintain compatibility fallbacks for runtime-critical changes until continuity checks are proven green.

## Recommended Implementation Order

1. Planning guardrails and canonical docs
2. `Scene Studio` contract unification
3. On-air scene renderer V1
4. Queue engine and transition controller
5. Programming Workspace V2
6. Library expansion plus deeper `Channel Blueprints`
7. `Multi-Output` RTMP delivery
8. `Live Bridge`
9. audio lanes, cuepoints, and advanced inserts
10. E2E, continuity, soak, and security hardening
