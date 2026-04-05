# Upstream Gap Analysis For Stream247

Updated: 2026-04-06

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

This document is intentionally conservative. Completed milestones in the repo do not imply full public-feature parity with Upstream, and parity statements below are limited to what the current code and automated coverage actually prove.

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
  - overlay draft/publish, scene presets, layer order/visibility, positioned text/logo/image/embed/widget layers, built-in typography presets, ticker/badge controls, and a canonical scene payload shared by browser and playout consumers
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
| Scheduling and repeat behavior | Public docs/blog describe scheduling, repeat every day, and reliable automation | Partial parity | schedule blocks, templates, repeat sets, materialized fill preview, queue-aware editor, show profiles, and safe-boundary cuepoint inserts | still needs deeper long-form ad rule families, stronger recurring editing, and denser calendar ergonomics | M12, M14 | Preserve current weekly block model and extend it |
| Live playback controls | Public pages and docs show live controls, refresh/hard reload, and playlist control | Partial parity | broadcast workspace and broadcast actions | core controls exist, but deeper queue surgery, jump/rewind-style controls, and denser operator workflow remain partial | M12, M14 | Keep original naming as `On-Air Controls` |
| Stream designer / overlay designer | Public designer supports layered overlays, custom fonts, current media metadata, and more | Partial parity | overlay studio with presets, draft/publish workflow, positioned text/logo/image/embed/widget layers, built-in typography presets, shared scene payload contract, and an on-air scene renderer v1 | richer current-media widgets, remote/custom font handling, and broader designer depth remain partial | M11 | Do not copy Upstream visual design or naming |
| Websites and widget embeds | Public help covers website embeds and StreamElements-style widgets/alerts | Partial parity | sandboxed website/widget scene layers now render inside the published browser overlay and shared scene contract | third-party CSP, iframe, and X-Frame-Options policies still limit real-world provider compatibility | M11 | Respect CSP, iframe, and X-Frame-Options limits |
| Reusable playlists / designer presets | Public help supports saving and loading playlists and designer settings | Partial parity | overlay scene preset library and Channel Blueprint export/import now exist | still missing broader reusable programming packages and cross-install media remapping helpers | M13 | Use original `Channel Blueprints` naming |
| RTMP destinations | Public docs cover custom RTMP and platform-specific outputs | Partial parity | built-in primary/backup outputs plus additional managed RTMP outputs | routing works, but per-output operator controls, failure attribution, and platform-specific guidance remain partial | M12 | Keep current primary/backup flow functional |
| Multistream outputs | Public help says one stream can be sent to many platforms | Partial parity | multi-output delivery groups with health-aware primary/backup routing now exist | concurrent outputs exist, but recovery and operator proof remain partial and RTMP-focused | M12, M15 | Must not assume cloud delivery infrastructure |
| Backup stream / uninterrupted failover | Public docs describe synchronized backup stream behavior | Partial parity | backup slot, cooldown-aware failover | recovery semantics and operator visibility still need hardening before stronger parity claims | M12 | Preserve simple fallback mode first |
| Live ingest / live studio equivalent | Public product exposes live studio/live source workflows | Partial parity | broadcast actions and worker runtime now support `Live Bridge` takeover from RTMP/RTMPS or HLS inputs with safe release back to the scheduled queue | still missing richer ingress source management, live-session recovery, and deeper live-first operator UX | M12, M14 | Keep input URLs sanitized in live admin snapshots |
| Separate audio and video playlists / secondary audio | Public product advertises separate audio/video and secondary audio channel | Partial parity | pool-scoped replace-mode audio lanes can loop dedicated beds over scheduled playback | still missing richer mixing, crossfades, and independently curated full audio playlists | M12 | Keep the first implementation deterministic and self-hosted-friendly |
| Timed inserts / stings / ads | Public product exposes stings/jingles/ads and cuepoint concepts | Partial parity | manual inserts, pool interval inserts, and safe-boundary cuepoint inserts now exist | still missing richer ad-rule families and mid-block creative tooling beyond safe boundaries | M12 | Build on current insert runtime instead of replacing it |
| Advanced media library | Public blog/help shows advanced media library and upload-oriented workflows | Partial parity | uploads, sources, asset library, folder/tag curation, bulk source actions, bulk asset curation | still missing thumbnails, richer grouping, curated sets, and deeper asset ops | M13 | Stay local-disk-first, later optional object storage |
| Team / operator workflow | Public product highlights team access and collaborative operations | Partial parity | team roles, Twitch SSO, broadcast workspace | needs richer operator-centric flows, clearer IA, and better mobile/tablet support | M14 | Do not clone UI, keep original control-room model |
| Reliability and recovery | Public docs cover refresh/hard reload, backup streams, platform limits, and guidance | Partial parity | incidents, drift, health, upgrade rehearsal, soak, backup destination | needs truth/safety bug fixes, deeper continuity proof, and richer structured recovery flows | M10, M12, M15 | Keep release rehearsal and soak scripts as baseline |
| Platform integration guidance | Public help includes platform-specific RTMP, YouTube setup, stream key changes, duration limits | Partial parity | deployment, twitch-setup, versioning docs | add stronger destination-specific runbooks, recovery guidance, and UI hints | M12, M15 | Avoid unsupported platform claims |

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

These parity points are bounded. Stream247 does not yet match public Upstream behavior for deeper scene-composition breadth, broad third-party widget compatibility, deep continuity/recovery semantics, or advanced library and operator ergonomics.

## Partial Parity

- scene/overlay system with positioned layers and built-in typography presets
- scene contract unification across browser and playout consumers
- reusable presets
- media library and uploads
- scheduling and repeat workflows
- queue and playback control
- operator-safe queue surgery
- deterministic short-asset queue continuity with smoke coverage
- destination management and failover
- Multi-Output RTMP fanout with health-aware primary/backup routing
- `Live Bridge` takeover from RTMP/RTMPS or HLS inputs with controlled return to the scheduled queue
- pool-scoped replace-mode audio lanes for scheduled playback
- safe-boundary cuepoint inserts that preserve queue continuity
- operator UX polish
- reliability and validation gates
- local account security

## Missing Features

Top missing product capabilities:

1. stale-write safety fixes for asset/source admin flows and deployment-safe update-center version lookup
2. deeper scene composition: metadata-driven widgets, broader typography control, and richer scene-automation blocks
3. deeper persistent queue and transition controller with less reliance on hard encoder restarts
4. thumbnails, richer grouping, and reusable curated sets inside the library
5. deeper `Channel Blueprints` support such as cross-install media remapping and richer reusable programming packages
6. richer ad-rule families and deeper timed-insert tooling beyond the current safe-boundary cuepoint model
7. broader browser-driven embed compatibility and provider-specific widget guidance beyond the current sandboxed layer model
8. stronger per-output operator controls and destination-specific recovery UI
9. richer audio routing, layered mixing, and crossfade behavior beyond the current replace-mode lanes
10. longer-running soak coverage, broader browser E2E depth, and deeper `Live Bridge` source management

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

1. `M10` truth-and-safety fixes for stale-write admin flows, update-center version resolution, and conservative docs
2. `M11` `Scene Studio` V2 with richer layer composition and safer embed/image support
3. `M12` continuity and recovery hardening for transitions, Multi-Output, and Live Bridge
4. `M13` deeper library and `Channel Blueprints` workflows
5. `M14` operator UX and information-architecture cleanup
6. `M15` broader browser/runtime proof and release confidence
