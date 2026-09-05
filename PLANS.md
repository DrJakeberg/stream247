# Stream247 Execution Plan

## Problem Statement

Stream247 already ships a capable self-hosted Twitch-first 24/7 automation stack, but it still trails the public behavior of Upstream in the highest-value product areas: true on-air scene rendering, continuous queue control, richer library and scheduling workflows, multi-output delivery, and lower-friction operator UX. The repo also carries architecture concentration risk in the worker, database, and server-state layers, plus limited automated coverage for live runtime behavior.

This plan closes those gaps while preserving Stream247's existing self-hosted architecture, naming, and conventions. The product target is the best self-hosted alternative to Upstream for 24/7 cloud-style channel automation, without copying Upstream branding, UI, or text.

## Current State

- Monorepo with `apps/web`, `apps/worker`, `packages/core`, and `packages/db`
- Delivery is Docker / Docker Compose / GHCR with CI, release, upgrade rehearsal, soak monitor, and smoke scripts
- Runtime already supports:
  - local/direct/YouTube/Twitch sources
  - local library uploads
  - pools, weekly schedule blocks, show profiles, templates, duplication, and day cloning
  - SSE-driven broadcast control room and live public overlay/channel surfaces
  - overlay draft/publish, scene presets, layer order/visibility, positioned layers, and built-in typography presets
  - manual override, fallback, skip, reconnect, insert, and backup RTMP failover
  - pool-scoped replace-mode audio lanes and safe-boundary cuepoint inserts
  - incidents, drift, alerts, readiness, and encrypted managed secrets
- Main constraints from the repo:
  - use explicit SQL and `pg`, not an ORM rewrite
  - prefer extending the current monorepo modules over replacing working subsystems
  - validation canon is `pnpm validate`
  - important targeted checks already exist:
    - `pnpm test:fresh-db`
    - `pnpm test:fresh-compose`
    - Docker image builds
    - `./docker/smoke-test.sh`
    - `pnpm release:preflight`
    - `./scripts/upgrade-rehearsal.sh`
    - `./scripts/soak-monitor.sh`
- Main current technical risks:
  - `apps/worker/src/index.ts` is still very large and mixes ingest, queueing, FFmpeg supervision, alerts, and Twitch sync
  - `packages/db/src/index.ts` remains a large persistence surface
  - automated coverage is still thin for runtime continuity and admin workflows

## Target State

Stream247 becomes an original, self-hosted 24/7 broadcast automation platform with:

- `Scene Studio` as the unified scene system for browser overlays and on-air rendering
- `On-Air Controls` for current/next/queue/transition-safe operator workflow
- `Programming Workspace` with materialized fill visibility, repeat behavior, inserts, and faster weekly authoring
- `Library` with uploads, bulk curation, richer metadata, and reusable channel assets
- `Multi-Output` delivery for one channel to multiple RTMP targets
- `Live Bridge` for controlled live ingress takeover and return to scheduled playback
- stronger runtime continuity, release safety, and automated regression coverage

## Milestones

| Milestone | Type | Priority | Status | Goal | Acceptance | Touched Areas | Risk | Rollback |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| M0 Planning And Execution Guardrails | Ops | Now | Complete | Create canonical agent, plan, runbook, gap, and roadmap docs | Files exist, are internally consistent, and `pnpm validate` passes | repo root docs, `docs/` | low | revert docs-only commit |
| M1 Scene Studio Contract | Parity + Architecture | Now | Complete | Unify browser overlay, draft/live scene state, and on-air render contract under one scene model | Scene payload is canonical for browser and playout surfaces, no behavior regression | `packages/core`, `packages/db`, `apps/web`, `apps/worker` | medium | retain current text-overlay compatibility path |
| M2 On-Air Scene Renderer V1 | Parity + UX | Now | Complete | Render branded scene layers on air from the published scene, not only via FFmpeg text lines | On-air visuals match Scene Studio and publish without taking the stream offline | `apps/worker`, `apps/web`, Docker worker image | medium-high | feature-flag or compatibility fallback to current text overlay |
| M3 Queue Engine And Transition Controller | Architecture + Ops | Now | Complete | Promote queue/transition handling to a deterministic persistent engine with fewer hard restarts | Queue continuity across short assets, bad next assets skipped before cutover, inserts/reconnect/standby are first-class | `apps/worker`, `packages/db`, `apps/web/lib/server` | high | keep current playout strategy as fallback mode until continuity checks pass |
| M4 Programming Workspace V2 | Parity + UX | Next | Complete | Materialized fill view, repeat behavior, queue-aware preview, and faster schedule editing | Operators can author a full week with low friction and clear underfill/overflow signals | `apps/web`, `packages/core`, `packages/db` | medium | revert UI/API changes, preserve existing block CRUD |
| M5 Library And Channel Blueprints | Parity + UX | Next | Complete | Expand library operations and add reusable full-channel export/import | Assets are easier to manage, and channel setups can be replicated safely | `apps/web`, `packages/db`, `apps/worker` | medium | additive schema only, import/export stays opt-in |
| M6 Multi-Output V1 | Parity + Ops | Next | Complete | Extend from primary/backup to multiple RTMP outputs per channel | Multiple outputs can run from one channel with health-aware routing | `packages/db`, `apps/worker`, `apps/web` | high | preserve current primary/backup mode as default |
| M7 Live Bridge | Parity + Architecture | Later | Complete | Add controlled live ingress takeover and return to queue | Live source can replace scheduled playback and return safely | `apps/worker`, `apps/web`, Docker/runtime | high | keep feature disabled by default |
| M8 Audio Lanes, Cuepoints, Advanced Inserts | Parity + Architecture | Later | Complete | Add separate audio/video lanes, timed inserts, and richer transition logic | Secondary audio and timed inserts work without destabilizing the queue engine | `apps/worker`, `packages/core`, `packages/db`, `apps/web` | very high | preserve default program-audio and existing insert flows as the safe fallback |
| M9 Security And Release Hardening | Ops | Now | Complete | Add browser E2E, continuity smoke, stronger soak gates, and 2FA | Admin/UI/runtime regressions are caught before release and local auth is stronger | tests, CI, `apps/web`, docs | medium | additive checks, 2FA optional at first |
| M10 Truth And Safety Fixes | Reliability + Ops | Now | Complete | Remove stale-write admin races, fix update-center version resolution, and bring docs back in sync with the actual product state | Asset curation and source admin flows only update intended fields, update center resolves the repo version safely in container and local layouts, regression tests exist for each bug class, and docs stop implying full parity | `apps/web/app/api/assets/*`, `apps/web/app/api/sources/*`, `apps/web/app/api/library/uploads/route.ts`, `apps/web/lib/server/update-center.ts`, `packages/db`, tests, docs | medium | revert to previous route handlers if needed; DB changes remain additive targeted writers |
| M11 Scene Studio V2 | Parity + UX | Next | Complete | Deepen Scene Studio beyond presets and fixed layer types | Richer positioned image/logo/embed/widget/text layers, safer font handling, and conservative public parity claims | `packages/core`, `packages/db`, `apps/web`, `apps/worker` | high | preserve current Scene Studio v1 payload and text/image fallback path |
| M12 Continuity And Recovery V2 | Architecture + Ops | Next | Complete | Strengthen output recovery and reduce restart-heavy normal transitions | Continuity and multi-output recovery improve measurably without regressing queue or live-bridge visibility | `apps/worker`, `packages/db`, `apps/web/lib/server`, tests | very high | keep current queue engine and output routing available as the safe fallback |
| M13 Library And Blueprints V2 | Parity + UX | Next | Complete | Deepen library operations and make blueprints safer to reuse across installs | Thumbnails, grouped browsing, curated sets, and selective blueprint import/remap guidance are available without overpromising media portability | `apps/web`, `apps/worker`, `packages/db`, docs | medium | keep current folder/tag curation and replace-style blueprint import path intact |
| M14 Operator UX V2 | UX | Next | Complete | Resolve admin IA drift and make the control-room model more consistent | Broadcast, Dashboard, Scene Studio, Sources/Library, and Settings have clearer roles and more consistent naming | `apps/web`, docs, tests | medium | keep current routes and navigation labels working until the new IA is proven |
| M15 Coverage And Release Proof V2 | Ops | Next | Complete | Prove the highest-risk parity features with broader automated coverage | Multi-output, Live Bridge, audio/cuepoint flows, and scene publish safety have direct runtime/browser proof beyond unit tests | tests, CI, scripts, docs | high | additive coverage only; do not remove current gates until replacements are green |
| M59 Scene Studio Layout Repair And Field Explanations | UX + Reliability | Now | In progress | Make the scene studio usable on large displays and explain every operator control in place | The preview column is as tall as its content and stays in view while the form scrolls; the published-state aside sits beside the controls from 1560px; every field, panel and page header can carry an (i) explanation through one primitive, and the studio carries them; the layout is asserted by measurement, not only by screenshot | `apps/web`, tests, docs | low-medium | drop the `grid-aside`/`workspace-wide` classes and the `info` props; the primitives stay additive |
| M60 Truthful Controls | UX + Reliability | Now | Complete | Every visible setting does what it says or is gone | Scene clock/next toggles drive the on-air picture; schedule-teaser/queue-preview toggles, embed/widget fields and engagement chat mode/style/alert position leave the UI (storage kept, additive); the library upload accepts only what the worker scan ingests, or the scan ingests audio; tests prove each | `packages/core`, `apps/web`, `apps/worker`, tests, docs | medium | re-add the form fields; stored values were never read so nothing else moves |
| M61 Boundary A/V Skew Instrumentation | Ops | Now | Complete | Measure the seam instead of theorising about storms | Every boundary logs the outgoing feed's last video/audio PTS lead and the reader's per-stream offsets; a query lists seam skew against discontinuity line count | `apps/worker`, `packages/db`, docs | low | drop the event; nothing consumes it |
| M62 Cache Policy | Ops + Reliability | Now | Planned | Downloads that fit the content and a cache that keeps what airs next | Download time limit scales with the estimated size (floor kept); assets scheduled within the retention horizon are not released after airing; an asset with an incomplete file is not selected as ready | `apps/worker`, `packages/core`, tests, docs | medium | revert to fixed limit and release-after-play |
| M63 Stack Alignment | Ops | Now | Planned | The deployed stack equals the repo compose | Portainer stack file no longer defines redis; `docs/deployment.md` matches; DUT verified | Portainer stack, docs | low | re-add the service block |
| M64 Getting Started | Docs | Now | Planned | One page from zero to a green channel | `docs/getting-started.md` walks `.env.production.example` → `/setup` → `Live → Status` with the known traps in one place; README points at it; fresh-compose smoke follows it | docs, README | low | docs-only |
| M65 Measured Layout Specs | Reliability | Now | Planned | Layout asserted by measurement on every workspace | Live, Program and Admin get specs in the style of `studio-layout.spec.ts`: no horizontal overflow, sticky/aside rules where they apply, control budgets | tests, scripts | low | remove specs |
| M66 Live Bridge Rehearsal | Ops | Next | Planned | The live bridge has run under supervision before 2.0 names it | Live-bridge takeover and release observed on the DT stack with the operator present; findings recorded | DUT, docs | medium | none — observation only |
| M67 Release 2.0.0 | Release | Next | Planned | Major because the stack drops a service and the UI drops controls | 2.0.0 tagged after M60–M66 are complete and the soak is clean | release, docs | medium | pin 1.5.x images |

## Phase 3 — Product Depth, Metadata, Overlay, And Redesign

This phase addresses the concrete product-quality problems identified in the 2026-04-20 audit: wrong labels visible to stream viewers, missing metadata editing, pool-level schedule blindness, hardcoded output settings, missing engagement features, and the need for a modern UI. The surviving reset references are `docs/full-product-reset-audit.md`, `docs/full-product-reset-plan.md`, and `docs/ui-redesign-spec.md`.

| Milestone | Type | Priority | Status | Goal | Acceptance | Touched Areas | Risk | Rollback |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| M21 Overlay Text Correctness | Reliability + UX | Now | Complete | Fix pool names and empty brackets visible in the live stream, add title prefix and hashtags schema | Overlay never shows raw pool names or `[]` brackets to viewers, `nextTitle` resolves to an actual video title, `desiredTitle` for Twitch uses `titlePrefix + title + hashtags`, new asset schema fields exist | `apps/worker`, `packages/core`, `packages/db`, `apps/web/app/overlay`, tests, docs | low–medium | schema changes are additive; fallback remains neutral as "Coming up next" if lookahead fails |
| M22 Metadata V2 And Per-Video Edit | UX + Data | Now | Complete | Add per-video metadata edit form in library; wire title prefix, hashtags, and category override to Twitch sync and overlay display | Operators can edit title, title_prefix, category, hashtags per video from the library UI; saved values appear in the overlay and Twitch title; PATCH route uses targeted writers | `apps/web`, `packages/db`, tests | low | additive schema only; PATCH route falls back to existing values if new fields are absent |
| M23 Schedule Video-Level Visibility | UX + Data | Next | Complete | Expand schedule preview to include per-block video-level lookahead titles; add video-level timeline expansion on the schedule page | Schedule preview API returns `videoSlots` per block; schedule page shows expandable video title timeline; broadcast snapshot `nextTitle` uses pool lookahead instead of block title | `apps/web`, `packages/core`, tests | medium | API change is additive; UI expansion falls back to block title if pool has no eligible assets |
| M24 Output Profiles And Stream Settings | Architecture + UX | Next | Complete | Add first-class resolution/FPS settings, output profiles, and tie overlay viewport to output dimensions | Admin output settings page with profile selector (720p30, 1080p30, 480p30, 360p30, custom); `STREAM_OUTPUT_WIDTH/HEIGHT/FPS` env vars drive standby slate, renderer viewport, and FFmpeg scale filter; 360p overlay scales legibly | `apps/worker`, `apps/web`, `packages/db`, `docker-compose.yml`, `.env*.example`, tests, docs | medium | all new env vars have safe defaults matching current hardcoded values; scale filter is opt-in; full safe-area clamping is not yet implemented |
| M25 In-Stream Engagement Layer | Parity + UX | Later | Complete | Add chat overlay and follow/sub alerts composited into the live stream output | Twitch IRC chat appears as scrollable overlay in the stream; follow/sub EventSub alerts show as timed animations in the stream; engagement admin section controls position, style, and rate; works at 360p | `apps/worker`, `apps/web`, `packages/db`, overlay page, tests, docs | high | engagement layer is additive and disabled by default; EventSub auto-registration was completed in the M28 audit follow-up |
| M26 UI Redesign V1 | UX | Later | Complete | Modernize the admin UI with consistent navigation, form ergonomics, stacked field layouts, and long-title safety across all surfaces | Navigation matches redesign IA (`Control Room`, `Programming`, `Stream Studio`, `Workspace`); no layout breakage from long titles; all multi-field forms use stacked layout; existing routes preserved; browser smoke confirms redesigned surfaces | `apps/web`, tests, docs | medium | keep current route structure intact; redesign is UI layer only |
| M27 Container Reliability And Ops | Ops | Later | Complete | Audit and harden container health, SSE connection tracking, and long-run memory behavior | SSE connections in `web` are tracked and cleaned up on disconnect; soak monitor reports container restart counts; long-run playout memory baseline is documented; health check intervals are tuned | `apps/web`, `apps/worker`, `docker-compose.yml`, scripts, tests, docs | low–medium | additive health and monitoring changes only; no playout pipeline changes |

## Stabilization Pass — Post-M15 Review

| Milestone | Type | Priority | Status | Goal | Acceptance | Touched Areas | Risk | Rollback |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| M16.1 Schedule Gap Fixes | Reliability | Now | Complete | Correct current/next schedule handling across web snapshots and worker standby paths | Schedule gaps return no current block, next picks the first future block by wall-clock time, standby slate preview shows the actual upcoming block, and regression tests cover before-first, mid-gap, and after-last behavior | `packages/core`, `apps/web`, `apps/worker`, tests | medium | revert schedule-selection helper changes if snapshot regressions appear |
| M16.2 Streaming Upload Hardening | Reliability | Now | Complete | Replace buffered upload writes with streamed local-disk ingest | Large-media and concurrent uploads do not require buffering the full file in memory, and regression coverage proves the streaming path | `apps/web`, tests | medium | revert to prior upload handler if streamed writes regress local ingest |
| M16.3 Release Preflight Hardening | Ops | Now | Complete | Reject placeholder production configs before release | Release preflight fails on blank/example values, regression tests cover the gate, and docs describe the stricter checks accurately | scripts, tests, docs | low | revert preflight validation tightening if it blocks valid pinned configs |
| M16.4 Final Stabilization Fixes | Reliability + Ops | Now | Complete | Resolve the remaining overnight-schedule and release-preflight review regressions | Overnight current blocks keep the correct next/upcoming teasers, quoted-empty env values fail preflight, proxy example values fail preflight when present, and regression coverage proves both behaviors | `packages/core`, `apps/web`, `apps/worker`, scripts, tests, docs | medium | revert helper/preflight tightening if an undiscovered deployment edge case appears |
| M17.1 Scene Studio V2 Follow-Up Fixes | Reliability + Docs | Now | Complete | Resolve the post-M17 Scene Studio review regressions without widening feature scope | Metadata widgets keep canonical label fallback when no override is set, dedicated YouTube/Twitch embed endpoints remain allowed while normal page URLs stay blocked, agent workflow stops when no incomplete milestone remains, and gap-analysis docs no longer contradict shipped milestone status | `packages/core`, `apps/web`, tests, docs | low-medium | revert the follow-up helper and docs tightening if a new embed or workflow edge case appears |
| M17.2 Scene Studio V2 Final Follow-Up Fixes | Reliability | Now | Complete | Close the remaining fresh-widget and protocol-relative Scene Studio review regressions | Fresh widget layers switch into metadata-card mode without carrying a default label override, protocol-relative remote URLs follow the same provider boundary rules as absolute remote URLs, and regression coverage proves both behaviors | `packages/core`, `apps/web`, tests, docs | low | revert the follow-up helper tightening if a new frame-source edge case appears |
| M18 Release Workflow Preflight Alignment | Ops | Now | Complete | Align CI and release workflows with the hardened release-preflight gate | CI and tagged release workflows validate a staged non-placeholder production env instead of copying untouched example values, regression coverage proves the staged env passes preflight, and release docs remain accurate | `.github/workflows`, `scripts`, tests, `PLANS.md` | low | revert workflow/helper changes if the staged env path proves runner-specific |
| M18.1 Release Preflight Compose Env Alignment | Ops | Now | Complete | Align compose config validation with `RELEASE_PREFLIGHT_ENV_FILE` in CI and other staged checks | `pnpm release:preflight` succeeds with a staged env file even when the repo root lacks `.env`, compose validation uses the selected env safely, placeholder checks stay strict, and regression coverage proves both staged and placeholder paths | `scripts`, tests, `PLANS.md` | low | revert the temporary compose-env mirroring if it causes an undiscovered local edge case |
| M19 Release Readiness Hardening | Ops | Now | Complete | Close the remaining release-readiness gaps across tagged publishing, rehearsal/soak gates, image pinning, and production restarts | Tagged release artifacts are smoke-validated before push, rehearsal and soak gates require actual broadcast readiness, quoted `:latest` image refs fail preflight, production Compose services restart automatically, and regression coverage proves the tightened release path | `.github/workflows`, `docker-compose.yml`, `scripts`, tests, docs, `PLANS.md` | medium | revert workflow/runbook tightening if a documented deployment edge case appears and keep the stricter checks disabled only with an explicit follow-up |
| M19.1 Release Artifact Parity And Proxy Restart Hardening | Ops | Now | Complete | Ensure tagged release publishing pushes the already-tested artifacts and that the proxy deployment path restarts cleanly | Tagged releases retag and push the smoke-tested local candidate images instead of rebuilding, Traefik has restart coverage in the proxy profile, release docs describe only the tested guarantees, and regression coverage proves the tightened workflow shape | `.github/workflows`, `docker-compose.yml`, tests, docs, `PLANS.md` | medium | revert the release retag/push flow and proxy restart note only if runner-local publishing proves incompatible with GHCR |
| M19.2 Release Rehearsal Pre-Tag Artifact Alignment | Ops | Now | Complete | Align pre-tag rehearsal with a real artifact source that exists before version tags are created | `upgrade-rehearsal.sh` uses published `main-<sha>` snapshot artifacts when the target release tag is not available yet, tagged releases promote those same tested `main-<sha>` images instead of rebuilding, and docs plus regression coverage describe the pre-tag flow accurately | `scripts`, `.github/workflows`, tests, docs, `PLANS.md` | medium | revert to the previous tag-only rehearsal path only if pre-release `main-<sha>` publication disappears and document the release limitation explicitly |
| M19.3 Main Artifact Publication Parity | Ops | Now | Complete | Prove that successful `main` publishes expose the full rehearsal artifact set, including playout, under the exact `main-<sha>` tags that pre-tag rehearsal consumes | `main` CI publishes and then verifies registry-visible `web`, `worker`, and `playout` `main-<sha>` images, regression coverage proves that contract, and release guidance remains aligned with the same snapshot naming model | `.github/workflows`, tests, `PLANS.md` | low-medium | revert the post-push registry visibility check only if GHCR proves incompatible with deterministic snapshot verification and document the limitation explicitly |
| M19.4 DUT Long-Run Playout Stability | Reliability + Ops | Now | Complete | Resolve the DUT long-run process leak and make soak failures more actionable | Worker-family images run under an init process to reap Chromium scene-renderer children, Chromium capture avoids crashpad/zygote helpers, worker/playout healthchecks tolerate CPU-heavy playout windows, soak failures include playout restart diagnostics, and regression coverage proves the contracts | `docker/worker.Dockerfile`, `docker-compose.yml`, `apps/worker`, `apps/web`, `scripts`, tests, docs, `PLANS.md` | medium | revert the image entrypoint and healthcheck timeout changes if the init process is incompatible with GHCR runtime images, then disable scene rendering while investigating |
| M20.1 Twitch VOD Cache Prefetch | Reliability + Ops | Now | Complete | Make Twitch archive playback local/cache-backed before playout uses a VOD | Twitch VOD assets keep original URLs while queue/current prefetch stores verified local media, local-library scans ignore internal cache files, failed cache prep sends playout to standby instead of unstable remote VOD playback, and regression coverage proves cache metadata and path behavior | `apps/worker`, `packages/db`, tests, docs, `PLANS.md` | high | disable Twitch cache via env and fall back to previous remote-resolution behavior |
| M20.2 Persistent Relay Uplink | Reliability + Ops | Now | Complete | Decouple program playout from the Twitch RTMP session | Production Compose includes a pinned local relay and an uplink worker mode, playout publishes to the relay, uplink owns real destinations and scheduled 48h reconnects, program input failures fall back to standby without closing Twitch, and runtime/smoke coverage proves the separation | `docker-compose.yml`, `apps/worker`, `packages/db`, scripts, tests, docs, `PLANS.md` | very high | turn relay mode off and use the previous direct playout-to-destination path |
| M20.3 Persistent Program Feed | Reliability + Ops | Now | Complete | Keep the external Twitch RTMP session alive across normal asset boundaries | Playout publishes a rolling local HLS program feed by default, uplink reads that buffered feed instead of a disappearing RTMP relay input, RTMP relay input remains an explicit rollback, readiness/soak report uplink and feed health, and regression coverage proves the new contracts | `apps/worker`, `apps/web`, `packages/db`, `docker-compose.yml`, scripts, tests, docs, `PLANS.md` | very high | set `STREAM247_UPLINK_INPUT_MODE=rtmp` to restore the MediaMTX relay input or `STREAM247_RELAY_ENABLED=0` to restore direct output |
| M20.4 Persistent Program Feed Upgrade Migration | Reliability + Ops | Now | Complete | Make existing databases receive the M20.3 runtime columns during upgrade | Existing databases with the baseline migration already recorded add the uplink/program-feed `playout_runtime` columns before workers write runtime state, and integration coverage proves the upgrade path | `packages/db`, tests, docs, `PLANS.md` | medium | revert the dedicated migration only if a replacement migration preserves the same additive columns |
| M20.5 Program Feed Handoff Stability | Reliability + Ops | Now | Complete | Reduce local input and HLS handoff noise without hiding real Twitch/uplink failures | HLS program-feed writes use handoff-tolerant flags, uplink demuxing tolerates local feed discontinuities, clean asset/insert exits are natural boundaries instead of incidents, readiness/soak tolerate short local playout transients only while uplink/feed/destination remain healthy, and regression coverage proves the contracts | `apps/worker`, `apps/web`, scripts, tests, docs, `PLANS.md` | high | restore the previous HLS args or set `STREAM247_UPLINK_INPUT_MODE=rtmp` if the hardened local HLS feed path regresses |

## M17 Scene Studio V2

The historical `M11 Scene Studio V2` implementation completed on 2026-04-06. `M17` is the follow-on pass that deepens the same product area without reopening or rewriting the completed `M11` record. The scope remains bounded and does not claim full upstream parity.

Status: complete 2026-04-08

**Scope**

- add metadata-driven `Scene Studio` widgets for current, next, or queue-facing broadcast data from the existing canonical snapshot contract
- deepen typography controls and conservative custom-font handling without weakening the current publish-safe path
- clarify browser-safe embed and widget behavior where CSP, iframe, or third-party provider limits prevent broader compatibility
- deepen scene authoring only where it fits the current original `Scene Studio` model and existing on-air contract

**Acceptance Criteria**

- at least one additional metadata-driven scene widget path exists beyond the current static positioned layers
- any new font or typography behavior has an explicit safe loading and fallback policy for browser and on-air use
- embed and widget behavior is explicit about supported and unsupported provider cases in code, tests, and docs
- published-scene browser and on-air consumers still share one canonical scene contract
- docs remain conservative and avoid implying full public-feature parity with Upstream

**Touched Areas**

- `packages/core`
- `packages/db`
- `apps/web`
- `apps/worker`
- browser and unit/integration tests
- `README.md` and scene-related docs

**Validation Commands**

```bash
pnpm validate
pnpm test:fresh-db
pnpm test:fresh-compose
pnpm test:e2e:smoke
docker build -f docker/web.Dockerfile -t stream247-web:test .
docker build -f docker/worker.Dockerfile -t stream247-worker:test .
```

Use additional targeted widget/font/browser tests if the implementation adds them.

**Done Criteria**

- code complete for the scoped `Scene Studio` work only
- regression coverage added for each new widget, font, or embed behavior
- docs updated anywhere supported provider scope, font behavior, or parity wording changes
- `pnpm validate` and milestone-relevant smoke/browser checks pass
- summary records supported scope, known provider limits, and any deliberate follow-up gaps

## M18 Release Workflow Preflight Alignment

Status: complete 2026-04-08

**Scope**

- align CI and tagged release workflows with the already-hardened release-preflight contract
- stop feeding untouched `.env.production.example` values directly into `pnpm release:preflight`
- add a small reusable helper that prepares a valid staged env file for automation-only preflight runs
- keep operator-facing production docs conservative and unchanged unless the shipped behavior really differs

**Acceptance Criteria**

- CI and release workflows no longer rely on `cp .env.production.example .env` before `pnpm release:preflight`
- a staged env file derived from `.env.production.example` is populated with explicit non-placeholder required values for workflow preflight use
- regression coverage proves the staged env helper output passes `pnpm release:preflight` with `RELEASE_PREFLIGHT_SKIP_VALIDATE=1`
- local operator guidance still requires replacing real production placeholders manually before live deployment

**Touched Areas**

- `.github/workflows`
- `scripts`
- release-preflight regression tests
- `PLANS.md`

**Validation Commands**

```bash
pnpm exec vitest run tests/unit/release-preflight.test.ts
RELEASE_PREFLIGHT_ENV_FILE="$(./scripts/prepare-release-preflight-env.sh)" RELEASE_PREFLIGHT_SKIP_VALIDATE=1 pnpm release:preflight
pnpm validate
```

**Done Criteria**

- workflow code complete for the scoped release-preflight alignment only
- regression coverage added for the staged env helper path
- docs remain accurate and do not imply placeholder configs should pass release preflight
- `pnpm validate` and milestone-targeted release-preflight checks pass

## M18.1 Release Preflight Compose Env Alignment

Status: complete 2026-04-08

**Scope**

- make `scripts/release-preflight.sh` handle `RELEASE_PREFLIGHT_ENV_FILE` consistently during `docker compose config`
- avoid CI-only failures when the selected env file is valid but the repo root `.env` is absent
- preserve the stricter placeholder and blank-value checks already shipped in `release-preflight.sh`
- keep the fix local to release-preflight and its regression coverage

**Acceptance Criteria**

- `pnpm release:preflight` can validate a staged env file via `RELEASE_PREFLIGHT_ENV_FILE` even if the repo root `.env` does not exist
- `docker compose config` runs against the selected env values instead of failing on missing root `.env`
- strict rejection of placeholder, quoted-empty, and example production values remains intact
- CI and release workflows can continue using the staged temporary env path added in `M18`

**Touched Areas**

- `scripts/release-preflight.sh`
- release-preflight regression tests
- `PLANS.md`

**Validation Commands**

```bash
pnpm exec vitest run tests/unit/release-preflight.test.ts
backup_env="$(mktemp "${TMPDIR:-/tmp}/stream247-root-env-backup.XXXXXX")"; mv .env "$backup_env"; tmp_env="$(./scripts/prepare-release-preflight-env.sh)"; cleanup(){ rm -f "$tmp_env"; if [ -f "$backup_env" ]; then mv "$backup_env" .env; fi; }; trap cleanup EXIT; RELEASE_PREFLIGHT_ENV_FILE="$tmp_env" RELEASE_PREFLIGHT_SKIP_VALIDATE=1 pnpm release:preflight
pnpm validate
```

**Done Criteria**

- release-preflight compose validation is self-contained for staged env-file runs
- regression coverage proves the missing-root-`.env` case and placeholder rejection case
- no production checks are weakened
- `pnpm validate` and milestone-targeted preflight checks pass

## M19 Release Readiness Hardening

Status: complete 2026-04-08

**Scope**

- gate tagged GHCR publishing behind local smoke validation of the exact release-candidate images
- require `broadcastReady=true` in release rehearsal and soak gates instead of treating field presence as success
- normalize quoted image refs before rejecting mutable `:latest` tags in release preflight
- add restart policies for the production Compose services used in the documented 24/7 deployment path
- keep release docs aligned with the stricter gates and always-on deployment posture

**Acceptance Criteria**

- `.github/workflows/release.yml` smoke-validates local release-candidate images before any final tagged push step
- `scripts/upgrade-rehearsal.sh` fails until `/api/system/readiness` reports `broadcastReady=true`
- `scripts/soak-monitor.sh` fails on non-ready broadcast state or non-ready destinations instead of logging them only
- `scripts/release-preflight.sh` rejects quoted and unquoted `:latest` image refs equally
- `docker-compose.yml` includes restart policies for `web`, `worker`, `playout`, `postgres`, and `redis`

**Touched Areas**

- `.github/workflows/release.yml`
- `docker-compose.yml`
- `scripts/release-preflight.sh`
- `scripts/upgrade-rehearsal.sh`
- `scripts/soak-monitor.sh`
- release-readiness regression tests
- release and deployment docs
- `PLANS.md`

**Validation Commands**

```bash
pnpm exec vitest run tests/unit/release-preflight.test.ts tests/unit/release-readiness.test.ts
tmp_env="$(./scripts/prepare-release-preflight-env.sh)"; trap 'rm -f "$tmp_env"' EXIT; RELEASE_PREFLIGHT_ENV_FILE="$tmp_env" RELEASE_PREFLIGHT_SKIP_VALIDATE=1 pnpm release:preflight
docker build -f docker/web.Dockerfile -t stream247-web:release-candidate .
docker build -f docker/worker.Dockerfile -t stream247-worker:release-candidate .
docker build -f docker/worker.Dockerfile -t stream247-playout:release-candidate .
chmod +x docker/smoke-test.sh && ./docker/smoke-test.sh stream247-web:release-candidate
STREAM247_FRESH_COMPOSE_WEB_IMAGE=stream247-web:release-candidate STREAM247_FRESH_COMPOSE_WORKER_IMAGE=stream247-worker:release-candidate STREAM247_FRESH_COMPOSE_PLAYOUT_IMAGE=stream247-playout:release-candidate pnpm test:fresh-compose
pnpm validate
```

**Done Criteria**

- tagged release publishing is gated by local candidate-image smoke validation
- rehearsal/soak scripts fail on non-broadcast-ready states
- mutable quoted image refs no longer bypass release preflight
- production Compose services restart automatically after daemon or host restarts
- docs stay accurate about the stricter release path and restart behavior

## M19.1 Release Artifact Parity And Proxy Restart Hardening

Status: complete 2026-04-08

**Scope**

- push the exact smoke-tested local release-candidate images for tagged releases instead of rebuilding them after validation
- add restart coverage for `traefik` so the documented proxy deployment path matches the Compose recovery guarantees
- keep release docs precise about what the workflow actually proves and publishes

**Acceptance Criteria**

- `.github/workflows/release.yml` no longer rebuilds release-tag artifacts after the candidate smoke gates pass
- the tagged publish path retags and pushes the already-tested local candidate images, or otherwise proves artifact identity before publish
- `docker-compose.yml` includes restart coverage for `traefik` alongside the existing always-on production services
- `README.md` and `docs/deployment.md` describe the published release artifacts and proxy restart guarantees accurately without overclaiming

**Touched Areas**

- `.github/workflows/release.yml`
- `docker-compose.yml`
- release-readiness regression tests
- release docs
- `PLANS.md`

**Validation Commands**

```bash
pnpm exec vitest run tests/unit/release-preflight.test.ts tests/unit/release-readiness.test.ts
docker build -f docker/web.Dockerfile -t stream247-web:release-candidate .
docker build -f docker/worker.Dockerfile -t stream247-worker:release-candidate .
docker build -f docker/worker.Dockerfile -t stream247-playout:release-candidate .
chmod +x docker/smoke-test.sh && ./docker/smoke-test.sh stream247-web:release-candidate
STREAM247_FRESH_COMPOSE_WEB_IMAGE=stream247-web:release-candidate STREAM247_FRESH_COMPOSE_WORKER_IMAGE=stream247-worker:release-candidate STREAM247_FRESH_COMPOSE_PLAYOUT_IMAGE=stream247-playout:release-candidate pnpm test:fresh-compose
docker image tag stream247-web:release-candidate stream247-web:release-parity-check && test "$(docker image inspect stream247-web:release-candidate --format '{{.Id}}')" = "$(docker image inspect stream247-web:release-parity-check --format '{{.Id}}')" && docker image rm stream247-web:release-parity-check
docker image tag stream247-worker:release-candidate stream247-worker:release-parity-check && test "$(docker image inspect stream247-worker:release-candidate --format '{{.Id}}')" = "$(docker image inspect stream247-worker:release-parity-check --format '{{.Id}}')" && docker image rm stream247-worker:release-parity-check
docker image tag stream247-playout:release-candidate stream247-playout:release-parity-check && test "$(docker image inspect stream247-playout:release-candidate --format '{{.Id}}')" = "$(docker image inspect stream247-playout:release-parity-check --format '{{.Id}}')" && docker image rm stream247-playout:release-parity-check
pnpm validate
```

**Done Criteria**

- tagged release publishing is artifact-identical to the smoke-tested candidate images
- proxy-profile Traefik ingress now matches the documented restart guarantees
- release docs stay conservative about tested artifact identity and automatic recovery scope
- `pnpm validate` and milestone-targeted release checks pass

## M19.2 Release Rehearsal Pre-Tag Artifact Alignment

Status: complete 2026-04-09

**Scope**

- make `scripts/upgrade-rehearsal.sh` resolve a pre-release artifact source that exists before `v*` tags are created
- keep tagged publishing aligned with the same artifact identity model instead of rebuilding different artifacts later
- document the pre-tag rehearsal path conservatively so the release runbook stays internally consistent

**Acceptance Criteria**

- `scripts/upgrade-rehearsal.sh <target-version>` no longer requires `ghcr.io/...:vX.Y.Z` to exist before the release tag is created
- unreleased targets rehearse against CI-published `main-<sha>` snapshot images for the current commit unless an explicit override is supplied
- published release tags still rehearse against the real `v*` images when those tags already exist
- `.github/workflows/release.yml` smoke-tests and promotes the same `main-<sha>` snapshot images instead of rebuilding from source after the rehearsal model has switched
- release docs explain the `main-<sha>` pre-tag snapshot path without overstating release safety

**Touched Areas**

- `scripts/upgrade-rehearsal.sh`
- `.github/workflows/release.yml`
- release-readiness regression tests
- release docs
- `PLANS.md`

**Validation Commands**

```bash
pnpm exec vitest run tests/unit/release-readiness.test.ts
pnpm validate
pnpm release:preflight
./scripts/upgrade-rehearsal.sh 1.1.0
```

**Done Criteria**

- pre-tag rehearsal uses a real pre-release artifact source that already exists before tagging
- tagged publishing promotes the same rehearsed artifact lineage instead of rebuilding different digests
- docs stay internally consistent about pre-tag rehearsal and release publication
- `pnpm validate`, release preflight, and the milestone-targeted rehearsal checks pass

## M19.3 Main Artifact Publication Parity

Status: complete 2026-04-09

**Scope**

- ensure the normal `main` publication path proves all three pre-release snapshot artifacts are registry-visible after publish
- keep the `main-<sha>` naming contract aligned with `scripts/upgrade-rehearsal.sh` for `web`, `worker`, and `playout`
- add regression coverage so the `playout` snapshot path cannot silently drift from the rehearsal lookup contract

**Acceptance Criteria**

- `.github/workflows/ci.yml` publishes `web`, `worker`, and `playout` under `main-<short-sha>` on successful `main` pushes
- the `main` CI run now fails if any of those just-pushed `main-<short-sha>` tags are not registry-resolvable after publish
- `tests/unit/release-readiness.test.ts` proves the `main` workflow publishes and verifies the full rehearsal artifact set
- release guidance remains accurate without claiming more than the workflow now proves

**Touched Areas**

- `.github/workflows/ci.yml`
- release-readiness regression tests
- `PLANS.md`

**Validation Commands**

```bash
pnpm exec vitest run tests/unit/release-readiness.test.ts
pnpm validate
```

Use GitHub Actions logs or direct `docker manifest inspect` checks as additional evidence when investigating a specific `main-<sha>` publication mismatch.

**Done Criteria**

- successful `main` publishes now prove the full `main-<sha>` rehearsal artifact set is registry-visible
- workflow naming stays aligned with `upgrade-rehearsal.sh`
- regression coverage protects the `web`/`worker`/`playout` snapshot contract
- `pnpm validate` and milestone-targeted release-readiness tests pass

## Phase 2 — Post-M9 Audit Follow-Up

The first milestone set shipped meaningful parity progress, but a fresh audit found three categories of follow-up work:

- truth and safety fixes that correct review-found stale-write races and deployment-specific bugs
- parity gaps where the code is real but still partial, especially Scene Studio depth, runtime continuity, and recovery behavior
- docs that need to stay conservative and aligned with what the code and automated coverage actually prove

Phase 2 starts with `M10 Truth And Safety Fixes` and then continues into deeper parity, UX, and release-proof milestones.

## Parity Work

- `Now` M1 Scene Studio Contract
- `Now` M2 On-Air Scene Renderer V1
- `Now` M3 Queue Engine And Transition Controller
- `Complete` M4 Programming Workspace V2
- `Complete` M5 Library And Channel Blueprints
- `Complete` M6 Multi-Output V1
- `Complete` M7 Live Bridge
- `Complete` M8 Audio Lanes, Cuepoints, Advanced Inserts
- `Now` M10 Truth And Safety Fixes
- `Complete` M11 Scene Studio V2
- `Complete` M17 Scene Studio V2
- `Complete` M13 Library And Blueprints V2
- `Not Planned` visual cloning of Upstream UI or branding

## Architecture Work

- `Now` split runtime concerns inside `apps/worker/src/index.ts` into queue, transition, ingest, destination, Twitch sync, and scene modules without a rewrite-first approach
- `Now` move scene rendering behind an explicit scene payload and published-scene render contract
- `Now` keep DB changes additive and continue using targeted writers instead of broad state rewrites
- `Next` move from baseline-style migration growth to clear sequential SQL migrations
- `Next` make queue persistence and scene renderer caches explicit and observable
- `Later` add richer mixed audio routing, crossfades, and deeper live-ingest controls beyond the first shipped M7/M8 contracts
- `Complete` improve continuity and recovery semantics after the first queue/multi-output/live-bridge milestones land
- `Not Planned` ORM migration or abandoning Docker/Compose delivery

## UX Work

- `Now` keep `Broadcast` as the control-room anchor and evolve it into original `On-Air Controls`
- `Now` rename/position overlay work as `Scene Studio` in docs and future UI copy
- `Complete` upgrade schedule editing into a denser `Programming Workspace` with materialized fill, repeats, queue-aware preview, and insert rules
- `Complete` expand `Library` with folders, tags, bulk curation, and safer reusable catalog organization
- `Complete` add `Channel Blueprints` as the original import/export system for full stream setups
- `Complete` resolve IA drift between `Broadcast`, `Dashboard`, `Scene Studio`, `Library`, and `Settings`
- `Complete` deepen Scene Studio beyond fixed preset composition while keeping original naming and UI
- `Complete` deepen Library and `Channel Blueprints` with thumbnails, grouped browsing, curated sets, and selective import warnings
- `Later` add tablet-friendly layout refinements and richer operator shortcuts
- `Not Planned` copying Upstream labels like “Stream Designer” or “Live Studio”

## Ops Work

- `Now` keep `pnpm validate` as the mandatory baseline after every milestone
- `Now` add milestone-specific smoke coverage when runtime, DB, or delivery code changes
- `Now` append dated progress notes to this file after each completed milestone
- `Next` add Playwright smoke coverage for setup, sources, scheduling, overlay publish, and broadcast controls
- `Next` add queue continuity and scene publish safety checks to CI
- `Next` expand structured runtime logging and incident fingerprints
- `Now` fix stale-write admin paths and deployment-specific safety bugs surfaced by review/audit
- `Next` expand runtime/browser proof for Multi-Output, Live Bridge, and cuepoint/audio flows
- `Later` broaden soak and upgrade rehearsal coverage for major runtime milestones
- `Not Planned` unattended production auto-upgrades by default

## Validation Commands

Default for every milestone:

```bash
pnpm validate
```

Add targeted checks when the touched area requires them:

```bash
pnpm test:fresh-db
pnpm test:fresh-compose
docker build -f docker/web.Dockerfile -t stream247-web:test .
docker build -f docker/worker.Dockerfile -t stream247-worker:test .
./docker/smoke-test.sh stream247-web:test
pnpm release:preflight
./scripts/upgrade-rehearsal.sh <target-version>
./scripts/soak-monitor.sh --hours 24
```

Use the targeted checks only when the milestone changes runtime, persistence, delivery, or release behavior.

## M21 Overlay Text Correctness

Status: complete

**Scope**

- Fix `nextTitle` in `buildWorkerScenePayload` to resolve one step forward from the next schedule block's pool cursor instead of using the schedule block title or the "Scheduling next item" literal
- Fix `currentTitle` to include `title_prefix` when set on the current asset
- Fix `desiredTitle` in the Twitch metadata sync to use `[titlePrefix + " " + title]` and append hashtags from the new `hashtags_json` field
- Fix empty `[]` bracket containers in the overlay page renderer by guarding every badge/label component with a non-empty content check
- Fix the text-based overlay fallback to never emit lines that are prefix-only (e.g. `"Next: "` with no value, `"Queue: []"`)
- Add additive schema migrations: `title_prefix TEXT NOT NULL DEFAULT ''` and `hashtags_json TEXT NOT NULL DEFAULT '[]'` and `platform_notes TEXT NOT NULL DEFAULT ''` to the `assets` table
- Add a `lookaheadVideoTitleFromPool` helper in `packages/core` or `apps/worker`

**Acceptance Criteria**

- Overlay text never shows a raw pool name or a raw JSON array `[]` to viewers
- `nextTitle` in the broadcast snapshot and overlay payload resolves to the first predicted video title in the next schedule block's pool (or the pool cursor lookahead for the current block if within it), never to the block title
- Twitch `desiredTitle` is `[prefix] title [#hashtag1 #hashtag2]` when prefix and hashtags are set, truncated to 140 characters
- All badge, chip, and label containers in the overlay page conditionally render only when their content is non-empty
- New `title_prefix`, `hashtags_json`, and `platform_notes` columns exist in the `assets` table after migration
- A unit test proves that `buildOverlayTextLinesFromScenePayload` with empty `queueTitles`, empty `categoryName`, and empty `sourceName` produces no line containing `"[]"`

**Touched Areas**

- `apps/worker/src/index.ts`
- `packages/core/src/index.ts`
- `packages/db/src/index.ts` (schema migration)
- `apps/web/app/overlay/page.tsx` (overlay page component guards)
- tests: unit tests for overlay text lines, lookahead helper, and Twitch title construction
- docs: update the active audit and product docs to reflect the fix

**Dependencies**

- None. This is the first milestone in Phase 3 and has no predecessors.

**Risks**

- The pool lookahead may return a stale cursor prediction if the pool cursor was recently advanced; this is acceptable as an estimate (label text, not authoritative playout state)
- If the assets list in `AppState` is not loaded when building the overlay, the lookahead falls back to the block title gracefully

**Validation**

```bash
pnpm validate
pnpm test:fresh-db
pnpm exec vitest run tests/unit/overlay-scenes.test.ts
pnpm --filter worker build
pnpm --filter db build
```

---

## M22 Metadata V2 And Per-Video Edit

Status: complete

**Scope**

- Extend `PATCH /api/assets/[id]` to accept `title`, `titlePrefix`, `categoryName`, `hashtagsJson`, `platformNotes`, `includeInProgramming`, `fallbackPriority` using targeted SQL writers
- Add a per-video metadata edit panel to the assets/library page with stacked form fields: title, title prefix, category, hashtags (tag input), operator notes, include in programming toggle, fallback priority
- Ensure the edit panel never uses inline compressed layout — all fields are stacked
- Verify that saving the panel does not overwrite unrelated fields (targeted writer safety from M10)

**Acceptance Criteria**

- Operators can open a per-video edit panel from the library and save title, titlePrefix, categoryName, hashtagsJson, platformNotes
- The `PATCH /api/assets/[id]` route uses targeted UPDATE SET for only the fields included in the request body
- Long video titles do not break the edit panel layout
- After saving, the Twitch metadata sync picks up the updated prefix and hashtags on the next sync cycle
- Browser smoke includes opening the asset edit panel and saving a title prefix

**Touched Areas**

- `apps/web/app/api/assets/[id]/route.ts`
- `apps/web/app/(admin)/assets/` page and components
- tests: unit tests for targeted asset update, browser smoke update
- docs: update the active product docs for the library workflow

**Dependencies**

- M21 must be complete (provides `title_prefix`, `hashtags_json` schema fields)

**Risks**

- The existing asset curation UI may have state management that needs reworking to support the new panel; scope carefully to avoid rewriting the full page
- Stale-write safety: ensure the PATCH handler does not accept a full asset object and write every field — only accept a subset

**Validation**

```bash
pnpm validate
pnpm test:fresh-db
pnpm test:e2e:smoke
pnpm --filter web typecheck
```

---

## M23 Schedule Video-Level Visibility

Status: complete

**Scope**

- Extend the schedule preview API (`/api/schedule/preview`) to include a `videoSlots` array per block: asset id, predicted title, estimated duration, predicted start offset within the block
- The lookahead is computed from the pool cursor, wrapping as needed to fill the block duration; use the same `lookaheadVideoTitleFromPool` helper from M21
- Add a timeline expansion toggle to the schedule page: when expanded, each block row shows a horizontal timeline with video slot segments (proportional width, title truncated with tooltip)
- Update the broadcast snapshot's `nextTitle` to use the pool cursor lookahead result (aligns with M21 fix, this milestone adds the schedule page UI)
- Long video titles in the timeline use truncate + tooltip, never overflow the block container

**Acceptance Criteria**

- The schedule preview API returns `videoSlots` for blocks backed by a pool with eligible assets
- The schedule page can expand any block to show a video-level timeline
- Video titles in the timeline are truncated at the segment boundary with full title shown in a tooltip
- Empty pools or pools with no eligible assets show a "No videos in pool" message in the timeline
- The broadcast page "Next" card shows a video title, not a block title

**Touched Areas**

- `apps/web/app/api/schedule/preview/route.ts`
- `apps/web/app/(admin)/schedule/` page and components
- `packages/core/src/index.ts` (lookahead helper reuse)
- tests: unit tests for the extended preview API, schedule timeline component

**Dependencies**

- M21 (lookahead helper), M22 (per-video titles available in library)

**Risks**

- Pool cursor is a live value; the predicted video sequence may differ from actual playback if the cursor advances between preview generation and playout
- Very large pools with many assets may produce slow lookahead computation; bound the lookahead to a maximum of 20 slots

**Validation**

```bash
pnpm validate
pnpm test:fresh-db
pnpm exec vitest run tests/unit/schedule-preview.test.ts
pnpm --filter web typecheck
```

---

## M24 Output Profiles And Stream Settings

Status: complete

**Scope**

- Add `STREAM_OUTPUT_WIDTH`, `STREAM_OUTPUT_HEIGHT`, and `STREAM_OUTPUT_FPS` env vars with safe defaults matching the current hardcoded values (1280, 720, 30)
- Replace the hardcoded `1280x720:r=30` standby slate with values derived from these vars
- Update `getSceneRendererViewport` to read `STREAM_OUTPUT_WIDTH/HEIGHT` in addition to `SCENE_RENDER_WIDTH/HEIGHT` (with `SCENE_RENDER_*` taking precedence for explicit overrides)
- Add a `-vf scale=${width}:${height}` filter to the main video playout FFmpeg commands so input videos at any resolution are normalized to the output resolution (with letterbox padding for mismatched aspect ratios)
- Add named output profiles (720p30, 1080p30, 480p30, 360p30) as a channel-level setting stored in the database
- Add an Output settings admin page with a profile selector and custom mode fields
- Add CSS scaling variables to the overlay page so text and badges scale proportionally when `STREAM_OUTPUT_HEIGHT` is less than 720
- Update `stack.env.example` and deployment docs with the new env vars

**Acceptance Criteria**

- Setting `STREAM_OUTPUT_WIDTH=1920 STREAM_OUTPUT_HEIGHT=1080` produces a 1080p standby slate and a 1080p scene renderer viewport
- Setting `STREAM_OUTPUT_HEIGHT=360` results in a legible overlay (no text smaller than ~10px effective size)
- Input videos at 360p are scaled to the configured output resolution with letterbox padding
- The Output admin page shows a profile dropdown; selecting a profile stores it and the worker applies it on next start
- `pnpm release:preflight` still passes with the new env vars defaulted
- No regression in `pnpm test:fresh-compose` or queue continuity smoke

**Touched Areas**

- `apps/worker/src/on-air-scene.ts`
- `apps/worker/src/index.ts` (FFmpeg commands)
- `apps/web/app/(admin)/` (new Output settings page)
- `apps/web/app/overlay/page.tsx` (CSS scaling variables)
- `packages/db/src/index.ts` (output profile channel setting)
- `stack.env.example`, `docs/deployment.md`
- tests: unit tests for viewport resolution, FFmpeg command builder, profile storage

**Dependencies**

- M21 (overlay viewport alignment needed before safe area fix)

**Risks**

- The scale filter adds a small CPU overhead per frame; on low-spec hosts this may increase latency; provide a `STREAM_SCALE_ENABLED=1` opt-in flag
- Aspect ratio padding changes the visual appearance of content that was previously passed through at native resolution; document this clearly

**Validation**

```bash
pnpm validate
pnpm test:fresh-db
pnpm test:fresh-compose
pnpm test:queue-continuity
pnpm exec vitest run tests/unit/on-air-scene.test.ts
pnpm --filter worker build
```

---

## M25 In-Stream Engagement Layer

Status: complete

**Scope**

- Add a Twitch IRC chat connection in the worker (reuse existing Twitch auth) that pushes incoming messages to a short in-memory ring buffer
- Add `/api/overlay/events` SSE endpoint that streams chat messages and alert events to the overlay page
- Add a chat overlay component to the overlay page that renders incoming messages, with quiet/active/flood display modes
- Add Twitch EventSub webhook handling for `channel.follow` and `channel.subscribe` events; automatic registration is covered by M28
- Add an alert animation component to the overlay page for follow and sub alerts
- Add an `Overlays` admin section with controls for chat overlay and alert settings (position, style, rate, enable/disable)
- Engagement features are disabled by default (`STREAM_CHAT_OVERLAY_ENABLED=0`, `STREAM_ALERTS_ENABLED=0`)

**Acceptance Criteria**

- Chat messages from Twitch IRC appear in the composited stream overlay within 3 seconds of being sent
- Follow alerts show a timed animation in the stream on Twitch EventSub `channel.follow` events
- Sub alerts show a timed animation in the stream on Twitch EventSub `channel.subscribe` events
- Chat and alerts work at 360p output (no text clipping or layout breakage)
- All engagement features are disabled by default and require explicit opt-in
- The Overlays admin section shows current state (connected/disconnected, recent events)
- Disabling chat overlay or alerts takes effect within one Chromium capture cycle (max `SCENE_RENDER_INTERVAL_MS`)

**Touched Areas**

- `apps/worker/src/index.ts` (IRC chat)
- `apps/web/app/api/overlay/events/route.ts` (SSE endpoint and EventSub webhook receiver)
- `apps/web/app/(admin)/overlays/` (new admin section)
- `apps/web/app/overlay/page.tsx` (chat and alert components)
- `packages/db/src/index.ts` (engagement settings)
- `stack.env.example`, `docs/deployment.md`, `docs/twitch-setup.md`
- tests: unit tests for IRC message buffer, EventSub handler, SSE event routing; browser smoke for overlay events

**Dependencies**

- M21 (overlay pipeline must be clean before adding engagement layer)
- M24 (360p scaling must be in place before engagement layer rendering is tested at low resolution)

**Risks**

- EventSub requires a publicly reachable HTTPS `APP_URL`; document that localhost installs cannot receive EventSub webhooks
- IRC and EventSub connections add two new persistent outgoing connections from the worker; monitor for connection leak
- Rate-limiting chat messages is critical to prevent overlay spam during busy streams; implement the flood protection mode before shipping

**Validation**

```bash
pnpm validate
pnpm test:fresh-db
pnpm test:fresh-compose
pnpm test:e2e:smoke
pnpm --filter worker build
pnpm --filter web typecheck
```

---

## M26 UI Redesign V1

Status: complete

**Scope**

- Implement the updated navigation structure from `docs/ui-redesign-spec.md`: `Control Room`, `Programming`, `Stream Studio`, `Workspace` top-level groups
- Add `Overlays` page under `Stream Studio` (built in M25)
- Add `Output` page under `Stream Studio` (built in M24)
- Apply consistent long-title safety across all admin surfaces: `truncate` for single-line labels, `line-clamp-2` for card content, stacked layout for all multi-field forms
- Modernize card, table, and form styles: cleaner spacing, consistent color usage, better contrast
- Fix all known layout breakage sites: overlay designer layer names, schedule block editor, source list long names
- Preserve all existing routes (no breaking URL changes)
- Update browser smoke to cover redesigned navigation paths

**Acceptance Criteria**

- Navigation matches the redesign IA groupings
- No layout overflow, breakage, or clipping with video titles of 80–140 characters
- All multi-field forms use stacked layout (label above input, full width)
- Existing browser smoke passes on all redesigned pages
- `pnpm validate` and Docker image builds pass

**Touched Areas**

- `apps/web/app/(admin)/` (navigation layout, all page components)
- `apps/web/components/` (shared card, form, badge components)
- tests: browser smoke update
- docs: update `docs/ui-redesign-spec.md` and active product docs with completed redesign notes

**Dependencies**

- M22, M23, M24, M25 should be complete or nearly complete to avoid redesign churn

**Risks**

- Scope creep: define "V1" strictly as layout/navigation/typography/safety, not a full component library rewrite
- Test coverage: the browser smoke must cover enough pages to catch regressions early

**Validation**

```bash
pnpm validate
docker build -f docker/web.Dockerfile -t stream247-web:test .
pnpm test:e2e:smoke
pnpm --filter web typecheck
```

---

## M27 Container Reliability And Ops

Status: complete

**Scope**

- Audit SSE connection handling in `apps/web`: ensure every SSE response sets appropriate `Connection: close` behavior on client disconnect and that the Node.js process does not accumulate unclosed file descriptors under connection churn
- Add SSE connection count to the `/api/system/readiness` response so operators can see how many active overlay/broadcast connections exist
- Extend the soak monitor to report per-container restart counts and flag unexpected restarts as soak failures
- Document the long-run Chromium memory growth baseline from existing DUT soak runs
- Tune worker and playout health check intervals based on DUT soak observations

**Acceptance Criteria**

- SSE connections are explicitly cleaned up on `res.on('close', ...)` in all SSE route handlers
- `/api/system/readiness` includes `sseConnections: number` in its response
- `scripts/soak-monitor.sh` reports container restart counts and fails if `web`, `worker`, or `playout` restarted more than once during the soak window
- Long-run Chromium memory profile is documented in `docs/operations.md`

**Touched Areas**

- `apps/web/app/api/broadcast/stream/route.ts` and other SSE routes
- `apps/web/lib/server/` (SSE connection tracking)
- `scripts/soak-monitor.sh`
- `docs/operations.md`
- tests: SSE cleanup unit test

**Dependencies**

- None (can run alongside any product milestone)

**Risks**

- Low risk — all changes are additive monitoring and cleanup; no playout pipeline changes

**Validation**

```bash
pnpm validate
pnpm --filter web typecheck
pnpm exec vitest run tests/unit/
./scripts/soak-monitor.sh --hours 1    # abbreviated local check
```

---

## M28 Phase 3 Audit Stabilization

Status: complete

**Scope**

- Add automatic Twitch EventSub webhook registration for `channel.follow` and `channel.subscribe` when alert runtime is enabled, Twitch is connected, `APP_URL` is public HTTPS, and `TWITCH_EVENTSUB_SECRET` plus Twitch client credentials are configured
- Verify existing EventSub subscriptions before creating new ones, and delete only Stream247-owned follow/sub webhook subscriptions when alerts are disabled
- Replace the final viewer-facing "Scheduling next item" fallback with "Coming up next"
- Align Phase 3 docs with the shipped M21-M27 state and caveats found in the acceptance audit

**Caveats**

- Twitch accounts connected before M28 may need to reconnect once so the app receives `moderator:read:followers` and `channel:read:subscriptions`; no manual Twitch CLI subscription step is required after that
- Safe-area clamping shipped later in M31; M24 still only covered output profiles, viewport alignment, and scaling at the time it landed

**Validation**

```bash
pnpm exec vitest run tests/unit/engagement.test.ts
pnpm exec vitest run tests/unit/overlay-scenes.test.ts
pnpm validate
```

---

## Phase 4 — Cleanup, Component System, And Remaining Features

Phase 4 addresses the gaps identified in the 2026-04-21 product reset audit. Milestones are ordered by risk and dependency: critical behavior fixes first, navigation second, component system third, docs cleanup fourth, then feature additions.

Reference documents:
- `docs/full-product-reset-audit.md` — what exists and what is broken
- `docs/full-product-reset-plan.md` — target product state
- `docs/legacy-removal-list.md` — remove/keep/replace decisions
- `docs/ui-redesign-spec.md` — component and navigation implementation spec
- `docs/docs-reset-plan.md` — doc cleanup plan

| Milestone | Type | Priority | Status | Goal |
| --- | --- | --- | --- | --- |
| M29 | Feature fix | Now | Complete | React component primitives + `!here` chat command dispatch |
| M30 | UX | Now | Complete | Navigation cleanup shipped: split Library and Pools, moved Sources to Workspace, removed sidebar descriptions |
| M31 | Feature fix | Now | Complete | Overlay safe-area clamping and CSS variable wiring |
| M32 | Feature | Next | Complete | Donation and bits alerts shipped: Twitch EventSub `channel.cheer` + channel-point redemptions |
| M33 | Feature | Later | Complete | Multi-quality simultaneous RTMP output |
| M34 | Docs | Now | Complete | Delete legacy docs, merge redundant docs, final doc set |
| M35 | Feature | Next | Complete | Twitch LIVE badge with viewer count in Broadcast page |

---

## M29 React Component Primitives And Chat Command Dispatch

Status: complete 2026-04-21

**Goal**

Create the typed React component primitive layer (`Button`, `Card`, `Badge`, `Input`, `Select`, `PageHeader`, `StatusChip`) that makes the existing CSS system safe to use. Simultaneously fix the broken `!here` moderation command by implementing the IRC chat command parser in `TwitchChatBridge`.

These are bundled because both are "the thing that was promised but doesn't actually work" fixes.

**Scope**

- Create `apps/web/components/ui/Badge.tsx` — never renders when content is empty, whitespace, or `"[]"`; all variants map to existing CSS classes
- Create `apps/web/components/ui/Button.tsx` — primary/secondary/danger/ghost variants; loading state; maps to existing CSS classes
- Create `apps/web/components/ui/Card.tsx` — padding variants, optional header/footer
- Create `apps/web/components/ui/Input.tsx` — stacked label layout, hint/error, optional char count
- Create `apps/web/components/ui/Select.tsx` — stacked label layout, native `<select>`
- Create `apps/web/components/ui/PageHeader.tsx` — title, subtitle, optional actions slot
- Create `apps/web/components/ui/StatusChip.tsx` — status variants (ok/degraded/not-ready/unknown/live/offline)
- Update `apps/web/components/overlay-scene-canvas.tsx` to use `Badge` primitive
- Add a command parser to `apps/worker/src/twitch-engagement.ts` that scans incoming IRC messages for command patterns
- Wire the `!here [minutes]` command to update the moderation presence window in the DB
- The IRC bridge does not need to send chat replies for M29 — update the DB state only

**Touched areas**

- `apps/web/components/ui/` (new directory, 7 new files)
- `apps/web/components/overlay-scene-canvas.tsx`
- `apps/worker/src/twitch-engagement.ts`
- `apps/worker/src/index.ts` (wire command handler registration)
- `packages/db/src/index.ts` (verify updatePresenceWindow or equivalent exists)

**Acceptance criteria**

- All 7 primitives exist in `apps/web/components/ui/`
- `Badge` never renders when children is empty/whitespace/`"[]"`
- `Input` and `Select` always use stacked label layout
- `overlay-scene-canvas.tsx` uses `Badge` primitive
- An operator sending `!here 30` in Twitch chat updates the moderation presence window in the DB
- `/api/moderation/presence` reflects the updated window after the command fires
- Existing emote-only automation triggers correctly after a presence update via chat command
- `pnpm validate` passes
- Existing browser smoke tests pass
- Unit test for the command parser (valid command, invalid command, wrong prefix, missing minutes)

**Validation**

```bash
pnpm exec vitest run tests/unit/
pnpm validate
```

**Risks**

- Low for component primitives. The CSS classes already exist. Components are wrappers.
- Low for chat command dispatch. IRC connection exists. DB logic exists. This is wiring.
- Risk of regression: existing badge rendering in `overlay-scene-canvas.tsx` must not change behavior — the `Badge` primitive enforces the same guard that `visibleOverlayText` currently provides.

---

## M30 Navigation Cleanup

Status: complete 2026-04-21

**Goal**

Implement the target navigation structure from `docs/ui-redesign-spec.md`: split the Library nav item, move Sources to Workspace, add Pools as a standalone Programming item, remove the Operations nav item (merge incidents into Dashboard), remove sidebar section description paragraphs.

**Scope**

- Remove the `description` field from all nav section objects in `apps/web/components/admin-navigation.tsx`
- Add `title` attribute to all nav link elements for tooltip on truncation
- Implement the new 4-section, 11-link navigation structure
- Create `/library` route serving asset and upload management (currently at `/sources`)
- Create `/pools` route serving pool management (currently nested inside the sources page)
- Narrow `/sources` to ingest pipeline management only (YouTube, Twitch, direct URL, upload sources)
- Add 301 redirect from `/ops` to `/dashboard`
- Move incidents display from the Operations page to Dashboard page
- Update `apps/web/(admin)/dashboard/page.tsx` to include an incidents section

**Touched areas**

- `apps/web/components/admin-navigation.tsx`
- `apps/web/app/(admin)/layout.tsx`
- `apps/web/app/(admin)/dashboard/page.tsx` (add incidents)
- `apps/web/app/(admin)/ops/page.tsx` (replace content with redirect)
- `apps/web/app/(admin)/library/` (new route, move asset/upload content from `/sources`)
- `apps/web/app/(admin)/pools/` (new route, move pool content from `/sources`)
- `apps/web/app/(admin)/sources/` (narrow to ingest pipeline content only)

**Acceptance criteria**

- Sidebar has no description paragraphs under section headers
- All nav items have `title` attribute
- Navigation matches the 11-link spec: Broadcast, Dashboard (Live); Schedule, Pools, Library (Programming); Scene Studio, Overlays, Output (Stream Studio); Sources, Team, Settings (Workspace)
- `/ops` redirects to `/dashboard`
- Incidents are visible on the Dashboard page
- `/pools` shows pool management and works correctly
- `/library` shows asset and upload management and works correctly
- `/sources` shows ingest pipeline management only
- No broken links or navigation dead-ends
- `pnpm validate` passes
- Browser smoke test covers all 12 navigation items

**Validation**

```bash
pnpm exec vitest run tests/browser/
pnpm validate
```

**Risks**

- Medium. Route changes require updating all internal links that reference `/sources` for assets. Audit all `href="/sources"` references before creating the new routes.
- Redirect from `/ops` must not break any existing bookmark or external link. Use 301.
- Pool management page may need to be extracted from the sources page component — check component coupling before splitting.

**Progress Notes**

- Completed 2026-04-21. The sidebar now uses the 4-section, 11-link IA from `docs/ui-redesign-spec.md`, `/library` and `/pools` are standalone admin routes, `/sources` is narrowed to ingest pipelines, Dashboard owns incident history, and `/ops` permanently redirects to `/dashboard`.

---

## M31 Overlay Safe-Area Clamping

Status: complete 2026-04-21

**Goal**

Implement the safe-area CSS variables that were planned in M24 but deferred. Wire up `--overlay-output-width` and `--overlay-output-height` in `globals.css`. Ensure all positioned overlay layers and engagement widgets respect safe-area boundaries by default.

**Scope**

- Add `--safe-area-top/right/bottom/left` CSS custom properties to `:root` in `apps/web/app/globals.css`, computed from `--overlay-height` and `--overlay-width`
- Verify `--overlay-output-width` and `--overlay-output-height` (set in `live-overlay.tsx`) are consumed in the CSS
- Audit all positioned overlay components and add safe-area-aware container defaults
- Verify all overlay text components use `calc(Xpx * var(--overlay-scale))` for font sizes — fix any that do not
- Enforce minimum font size floor: `max(12px, calc(14px * var(--overlay-scale)))`
- Engagement layer (chat overlay, alerts) positions must respect safe-area containers

**Touched areas**

- `apps/web/app/globals.css`
- `apps/web/components/live-overlay.tsx`
- `apps/web/components/overlay-scene-canvas.tsx`
- `apps/web/components/engagement-overlay.tsx`
- `apps/web/app/overlay/page.tsx`

**Acceptance criteria**

- Safe-area CSS variables exist in `:root` and are computed correctly for all output profiles
- `--overlay-output-width` and `--overlay-output-height` are consumed by the CSS (not just set)
- No positioned overlay layer renders outside the safe area by default on any output profile (720p, 480p, 360p, 1080p)
- At 360p output, all overlay text is legible (minimum 12px rendered)
- Chat overlay and alert components render within the safe area
- `pnpm validate` passes
- Visual review at 360p, 720p, and 1080p output profiles

**Validation**

```bash
pnpm exec vitest run tests/unit/overlay-scenes.test.ts
pnpm validate
```

**Risks**

- Medium. CSS changes to the overlay can cause visual regressions in the in-stream output. Test all output profiles.
- Engagement layer position options (bottom-left, bottom-right, top-left, top-right) must still work after safe-area containers are applied.

**Progress Notes**

- Completed 2026-04-21. `globals.css` now computes safe-area variables from the active output width and height, consumes `--overlay-output-width` and `--overlay-output-height` in the public overlay layout, and enforces a 12px minimum text floor through `calc(... * var(--overlay-scale))` font sizing.
- Positioned custom Scene Studio layers now clamp into the safe-area coordinate space by default, and engagement chat/alert positions use the same safe-area insets instead of raw card padding.

---

## M32 Donation And Bits Alerts

Status: complete

**Goal**

Implement Twitch EventSub `channel.cheer` and `channel.channel_points_custom_reward_redemption.add` alerts. Add a "donations/bits" section to the Overlays admin page.

**Scope**

- Add `channel.cheer` and `channel.channel_points_custom_reward_redemption.add` to `REQUIRED_TWITCH_EVENTSUB_SUBSCRIPTIONS` in `apps/worker/src/twitch-eventsub.ts`
- Add webhook handling for these event types in `apps/web/app/api/overlay/events/route.ts`
- Add alert rendering in `apps/web/components/engagement-overlay.tsx` for cheer and channel-point events
- Add controls in `apps/web/app/(admin)/overlays/page.tsx` for cheer and channel-point alerts (enable/disable, shared position/style)
- Store alert preferences per-type in `engagement_settings` (add `donations_enabled` and `channel_points_enabled` columns)
- Additive schema migration

**Progress notes**

- Completed on 2026-04-21.
- Added per-type `donations_enabled` and `channel_points_enabled` settings with additive migration coverage.
- EventSub sync now registers and safely cleans up cheer/channel-point subscriptions without creating duplicates.
- Broadcasters connected before M32 must reconnect once so `bits:read` and `channel:read:redemptions` are granted.

**Touched areas**

- `apps/worker/src/twitch-eventsub.ts`
- `apps/web/app/api/overlay/events/route.ts`
- `apps/web/components/engagement-overlay.tsx`
- `apps/web/(admin)/overlays/page.tsx`
- `packages/db/src/index.ts` (additive migration for `donations_enabled`, `channel_points_enabled`)

**Acceptance criteria**

- Cheer events received from Twitch EventSub display as alerts in the in-stream overlay
- Channel-point redemption events display as alerts
- Overlays admin page has controls for donation/channel-point alerts
- Existing follow/sub alerts continue to work
- `pnpm validate` passes
- `pnpm test:fresh-compose` passes (behavioral parity)

**Validation**

```bash
pnpm exec vitest run tests/unit/engagement.test.ts
pnpm test:fresh-compose
pnpm validate
```

**Risks**

- Medium. New EventSub subscription types require new broadcaster OAuth scopes. Document the reconnect requirement clearly.
- `channel.channel_points_custom_reward_redemption.add` requires a custom reward to be configured on the Twitch channel. Test with a real Twitch broadcaster account.

---

## M33 Multi-Quality Simultaneous Output

Status: complete 2026-04-21

**Goal**

Support sending the stream to multiple destinations at different output profiles simultaneously (e.g., 720p to Twitch + 360p to YouTube).

**Scope**

- Add per-destination output profile assignment in destination settings
- When multiple destinations have different output profiles, spawn a separate scale+encode process per destination (or use a transcoding relay layer)
- Update the admin Output page to show per-destination profile configuration
- Update the multi-output pipeline in `apps/worker/src/multi-output.ts`

**Note:** This is the most architecturally complex Phase 4 milestone. The correct approach depends on whether parallel FFmpeg encode processes or a MediaMTX relay fanout is used. Scope this milestone carefully before starting implementation.

**Design note**

- Keep the existing relay/program-feed fanout as the shared source of truth.
- Each destination resolves to either the inherited stream profile or a fixed named destination profile.
- Destinations that resolve to the same effective rendition share one uplink FFmpeg process and one tee muxer output.
- Mixed effective renditions spawn parallel uplink FFmpeg processes from the shared relay/program feed.
- The single-rendition path remains the default when every active destination inherits the same output settings.
- Pinning a destination above the stream profile upscales the shared feed and increases CPU cost; prefer inherit or lower fixed presets unless there is a clear reason.

**Touched areas**

- `apps/worker/src/multi-output.ts`
- `apps/worker/src/ffmpeg-runtime.ts`
- `apps/worker/src/index.ts`
- `packages/db/src/index.ts` (per-destination output profile storage)
- `apps/web/(admin)/output/page.tsx`

**Acceptance criteria**

- Two active destinations can run at different output profiles simultaneously
- Stream quality to each destination matches its configured profile
- Admin UI shows per-destination profile selection
- Primary/backup routing continues to work with per-destination profiles
- `pnpm test:fresh-compose` passes

**Validation**

```bash
pnpm test:fresh-compose
pnpm validate
```

**Risks**

- High. Architectural change to the playout pipeline. Plan carefully before implementing.
- CPU/resource impact of multiple simultaneous encode processes must be documented.
- Rollback: keep single-profile path as the default; per-destination profiles are additive.

**Progress Notes**

- Completed 2026-04-21. Destinations now persist `outputProfileId`, the admin Output page exposes per-destination rendition selection, and the worker groups active destinations by effective output settings so mixed renditions can run in parallel from the shared relay/program feed.
- The default path is still single-rendition `inherit`, and fixed profiles below the stream profile are the intended production use. Pinning a destination above the stream profile works but upscales the shared feed and increases encoder CPU cost.

---

## M34 Documentation Cleanup

Status: complete 2026-04-21

**Goal**

Execute the doc reset defined in `docs/docs-reset-plan.md`. Delete legacy docs, merge redundant docs, produce the minimal final doc set.

**Scope**

- Delete: `docs/stream247-upstream-gyre-gap-analysis.md`, `docs/redesign-and-product-plan.md`, `docs/video-planning-and-metadata-model.md`, `docs/in-stream-overlay-and-output-strategy.md`, `docs/upstream-gap-analysis.md`, `docs/upstream-roadmap.md`
- Merge `docs/backup-and-restore.md` content into `docs/operations.md`, then delete `docs/backup-and-restore.md`
- Merge `docs/upgrading.md` content into `docs/deployment.md`, then delete `docs/upgrading.md`
- Merge `docs/versioning.md` content into `docs/deployment.md`, then delete `docs/versioning.md`
- Audit `README.md` and remove any language suggesting `/overlay` can be used as an OBS overlay URL
- Audit remaining docs for references to deleted files and update or remove those references
- Update `docs/upstream-gap-analysis.md` replacement language in any files that reference it, pointing to `docs/full-product-reset-audit.md` instead

**Touched areas**

- `docs/` (11 files deleted or merged)
- `README.md`

**Acceptance criteria**

- `docs/` contains the final doc set from `docs/docs-reset-plan.md`
- No doc references another doc that no longer exists
- `README.md` does not suggest `/overlay` is an OBS overlay URL
- `pnpm validate` passes (no code changes, but validate confirms nothing broke)

**Validation**

```bash
pnpm validate
```

**Risks**

- Low. Pure documentation changes. The only risk is breaking a link that another doc depends on.

**Progress Notes**

- Completed 2026-04-21. The final `/docs` set now keeps the active operator references plus the Phase 4 reset artifacts, with legacy planning and competitive-analysis files removed from the shipped documentation surface.
- `docs/operations.md` now owns backup/restore guidance, `docs/deployment.md` now owns release-channel and upgrade guidance, and `README.md` no longer presents `/overlay` as an external OBS/browser-source surface.

---

## M35 Twitch Live Status Widget

Status: complete 2026-04-21

**Goal**

Show a prominent "LIVE" badge with viewer count in the Broadcast page when the connected Twitch broadcaster is currently live. Show "OFFLINE" when not live.

**Scope**

- Add a Twitch API poll in the worker: `GET /helix/streams?user_id=${broadcasterId}` every 60 seconds
- Store the result (`live | offline | unknown`) in broadcast state (app state or broadcast snapshot)
- Expose it through the broadcast state SSE snapshot
- Add a `StatusChip` component (using the M29 primitive) to `apps/web/components/broadcast-control-room.tsx` showing live status and viewer count
- Use the existing Twitch app access token for the poll — no new auth flow

**Touched areas**

- `apps/worker/src/index.ts` (add poll loop) or extract to `apps/worker/src/twitch-sync.ts`
- `packages/db/src/index.ts` (add `twitchLiveStatus` and `twitchViewerCount` to broadcast snapshot)
- `apps/web/components/broadcast-control-room.tsx`

**Acceptance criteria**

- Broadcast page shows "LIVE [viewer count]" when the Twitch channel is live
- Broadcast page shows "OFFLINE" when the Twitch channel is not live
- State reflects actual Twitch status within 2 minutes of a go-live or go-offline event
- Shows "unknown" when Twitch is not connected — never an error state
- `pnpm validate` passes

**Validation**

```bash
pnpm exec vitest run tests/unit/
pnpm validate
```

**Risks**

- Low. Read-only Twitch API call. Uses existing app token pattern.
- Rate limit: `GET /helix/streams` allows 800 requests per minute per app token. A 60-second poll is well within limits.
- Must not affect broadcast reliability if the Twitch API is slow or unavailable — poll must be non-blocking and fail silently.

**Progress Notes**

- Completed 2026-04-21. The worker now polls Twitch `helix/streams` with the existing client-credentials app-token flow every 60 seconds and persists a lightweight `live | offline | unknown` snapshot plus viewer count on the Twitch connection state.
- Broadcast SSE snapshots now expose that live-state summary, and the Broadcast header renders a `StatusChip` showing `LIVE <count>`, `OFFLINE`, or `UNKNOWN` without adding a new auth flow or operator-only error mode.

---

## Phase 5 — Broadcast-Kanal, Wizard, Kapitel, Chat-Spiele, Selbstschutz

Phase 5 captures the product vision confirmed on 2026-08-25. Ordering follows dependency: the
broadcast-channel split first, because chat, metadata, chapters and games all land on the wrong
channel until it exists.

Context that motivates M51: the stream key sends video to **jimpanse247**, but the connected OAuth
account is **3jakec** (a moderator there). Verified in code: the chat bridge joins the connected
account's own channel, metadata sync PATCHes the connected account's channel, and the public watch
link points at it. Everything Twitch-facing therefore talks to the wrong room today.

| Milestone | Type | Priority | Status | Goal |
| --- | --- | --- | --- | --- |
| M51 | Architecture fix | Now | Done | Separate the broadcast channel from the connected identity; chat and moderation work via the mod account now, metadata via a broadcaster connection later. Verified live 2026-08-25: chat bridge rejoined #jimpanse247 within one cycle of the setting change |
| M52 | UX | Now | Done | First-run wizard covering everything that lives in `.env` today |
| M53 | Feature | Next | Done | Chapters per video: category and stream title per chapter, auto-ingested from VOD metadata, synced at chapter boundaries |
| M54 | Feature | Next | Done | Chat game framework with Snake as the first game (emote-per-direction, moves only on input); Minesweeper (chat digs by coordinates like "b3") and 2048 (snake's emote map on a fixed 4x4 board) follow on the same framework |
| M55 | Ops | Later | Done | Global disk watermark self-protection with staged cache eviction |
| M56 | UX | Now | Done | Every operational decision configurable in the GUI, `.env` demoted to fallback. Part 1 done: encoder quality, disk watermark, engagement/schedule-sync feature switches, EventSub secret. Part 2 done: replay (VOD) cache family, watchdog/stall thresholds, reconnect + program-feed tuning — clamped resolvers in core, three folded admin groups with partial routes; SMTP/alert family confirmed already GUI-complete. Deliberately env-only: cache root, relay topology, loop stall guard. Part 3 done: the unused redis service is out of compose, the stack scripts, the env examples and the docs |
| M57 | Feature | Now | In progress | Embedded video sources as scene layers. Stage 1 done: source layer kind (placement + reference), encrypted feed store, snapshot sampler at managed cadence rendering through the native overlay — plus logo/image/text layers on air. Stage 2 in progress: ingest foundation + attach decision (A+B) and the live attach itself (C+D) done — push ingest via relay with HTTP auth, publish keys, derived internal read URLs, presence poll, and the third ffmpeg input wired as a PiP under the scene with audio mixed at the configured gain, breaker armed on a failed attach; Etappe E done — the audited owner/admin reveal of the relay rollback lines (the emergency path relay auth had made unusable), the live source gain field with the known-duration caveat, and the last attach decision shown per pushed source (migration `20260826_004`); open: a mandatory DT soak gate before any deploy, plus per-layer cadence |
| M58 | Ops | Now | Done | Make the incident list truthful: classify every fingerprint family as a lasting state or a finished event, close event incidents once their area is provably healthy, and stop the per-asset fingerprint explosion |

## M51 Broadcast Channel Split

Introduce a broadcast-channel concept (`jimpanse247`) distinct from the connected identity
(`3jakec`). Decision 2026-08-25: both connections must be possible — the identity connection for
chat and moderation, an optional broadcaster connection for channel metadata. The broadcaster
account is not accessible today but will be again; until it is connected, metadata sync must
visibly wait instead of silently patching the identity's channel.

- Add a broadcast-channel setting (login), editable in the workspace; default empty means "same as
  connected identity" for setups without the split
- Chat bridge joins the broadcast channel with the identity token; emote-only and chat settings go
  through Helix with `broadcaster_id=<channel>&moderator_id=<identity>`, which a moderator token is
  allowed to do
- Title/category/schedule sync runs only through a broadcaster-scoped connection (second OAuth slot,
  minimal scopes `channel:manage:broadcast` + schedule); absent that connection the sync reports
  "waiting for broadcast channel connection" as a visible state, not an error
- Live status, viewer counts and every public link (watch link, overlay hints) use the broadcast
  channel
- Acceptance: with only 3jakec connected, chat interaction and `!here` work in `#jimpanse247`, and
  no Helix write ever targets 3jakec's channel; connecting jimpanse247 later flips metadata sync on
  without a restart
- Rollback: broadcast-channel setting empty restores the previous single-account behaviour

**Progress Notes**

- 2026-08-25: The split is in place. `twitchBroadcastChannelLogin` lives in the managed config
  (validated as a Twitch login, empty = identity = rollback), the chat bridge joins the broadcast
  channel while authenticating as the identity, emote-only goes through Helix chat-settings with
  `broadcaster_id=<channel>&moderator_id=<identity>` (channel id resolved by login, cached), and
  live status, viewer count and the watch link follow the broadcast channel via login-based
  streams lookup. Title/category/schedule writes are gated: with a split and no matching
  broadcaster connection they skip every Helix write and report "waiting for broadcast channel
  connection" as an info incident, on the dashboard, and in the connection panel. The second OAuth
  slot exists as `twitch_broadcaster_connection` (additive table) plus a dashboard entry naming
  the required account and scopes; once a matching connection exists the sync writes with its
  token, so connecting later flips metadata on without a restart.
- 2026-08-25 (later): the broadcaster-slot OAuth flow is built, separate from the identity flow
  end to end so the existing callback can never store into the wrong slot: its own start route
  (`/api/integrations/twitch/connect-broadcaster`, only the two metadata scopes), its own
  namespaced single-use state cookie, and its own callback that — before storing anything —
  verifies the authorised Twitch login matches the configured broadcast channel
  (case-insensitive) and rejects mismatches (most likely the identity signing in again) with a
  message naming both accounts. The waiting entry in the connection panel is now the actual
  connect link, a connected slot gets a disconnect button, and the worker refreshes the slot
  token ahead of expiry and on 401 exactly like the identity's. Exercised through unit tests
  with mocked Twitch endpoints (the wrong-account guard is mutation-tested); a live end-to-end
  run still waits on the broadcaster account becoming accessible again.

## M52 Setup Wizard

A guided first-run that replaces manual `.env` editing for everything except what Compose itself
provides. Decision 2026-08-25: all of it — the theoretical target is a stack that starts with no
hand-written env file; source/schedule/destination remain ordinary workspace tasks after setup.

- `APP_SECRET` is generated on first boot and persisted (data volume / managed config), never typed
- `DATABASE_URL` stays an internal Compose default pointing at the bundled Postgres
- Wizard steps: instance basics (`APP_URL`, timezone) → Twitch app credentials (already encrypted
  managed config) → identity connection → optional broadcaster connection (M51) → done; each step
  skippable and resumable, with the go-live checklist reflecting wizard completion
- Acceptance: a fresh `docker compose up` with no `.env` beyond compose defaults reaches a working,
  connected workspace entirely through the browser
- Rollback: env variables keep overriding wizard-written values, so existing installs are untouched

## M53 Chapters Per Video

Per-asset chapters, each carrying its own category and stream title. Decision 2026-08-25: multiple
categories per source with chapter switches inside a VOD, and both category and title settable per
chapter.

- Schema: chapter list per asset `[{offsetSeconds, categoryName, title}]`, additive column
- Ingest fills chapters from VOD metadata where the source provides it (yt-dlp chapter data for
  Twitch/YouTube); single-chapter fallback is today's per-video category
- Library UI: chapter editor per video (add/remove/edit offset, category, title)
- Playout emits chapter-boundary events; the Twitch metadata sync (via M51 broadcaster connection)
  applies category and title at each boundary, throttled to Twitch's tolerance
- Acceptance: a VOD with three chapters changes category and title on the broadcast channel at the
  right offsets; a video without chapter data behaves exactly as today
- Rollback: empty chapter lists disable the whole path

## M54 Chat Game Framework And Snake

An extensible framework for chat-driven games rendered into the on-air overlay, with Snake first.
Decision 2026-08-25: every emote maps to a direction (configurable mapping, one emote = one
direction), and the snake does not move on its own — it moves only when chat inputs arrive. More
games follow on the same framework.

- Framework: a game is an engagement module with chat-input intake, a tick/state model, an overlay
  layer for rendering (native renderer runs at one frame per second, which suits input-driven
  games), and per-game settings in the studio
- Snake: configurable emote→direction map, grid size, and reset behaviour; moves exactly one cell
  per accepted chat input; scoreboard line optional
- Games are enabled per scene like other layers, and the moderation presence model applies (games
  can run in emote-only, since emotes are the input)
- Acceptance: an operator enables Snake, maps four emotes, and chat in the broadcast channel steers
  it on air; disabling the layer removes all game state cleanly
- Rollback: game layers off = no game code in the render path

## M55 Global Disk Self-Protection

Extend the existing per-cache guardrails (VOD cache min-free-bytes, feed segment sweep) into one
disk watermark monitor. When free space crosses a threshold: staged eviction — unused VOD cache
first, then orphaned feed segments beyond the live window, then oldest thumbnails — with an
incident naming what was freed and why. Never touches media the schedule still references.

## M56 Operational Settings In The GUI

Product vision: a GUI in which everything is configurable, `.env` unimportant. Every family moves
on the managed-config pattern the Twitch credentials established: an encrypted managed value that
wins when set, the env variable as fallback, one shared resolver in `packages/core` so web and
worker can never drift. An empty managed value must never change what an existing env-driven
install does — including the historical `=== "1"` semantics of the engagement runtime gates.

Part 1 (done): encoder quality (speed preset, video bitrate ceiling, buffer size, audio bitrate)
folded into the studio output tab; disk watermark (enabled, trigger, recover — pair validated
before saving, rejected whole like the worker does) and the chat/alerts/schedule-sync feature
switches folded into admin settings; the EventSub webhook secret in the managed credentials form
with keep-on-empty secret semantics. The dead `packages/config` (`getConfig`: REDIS_URL,
MOD_PRESENCE_*) is deleted.

Part 2 (done): the replay (Twitch VOD) cache family, the watchdog/stall thresholds and the
reconnect/program-feed tuning, as three folded groups in the admin settings operations panel,
each with its own partial update route. These families configure guards, so every managed number
is bounded: the API refuses out-of-range values with the reason, the shared resolver clamps a
corrupted store, the feed-stall floor is pinned above the longest configurable segment, and a
managed download timeout still passes the cycle-budget clamp. The SMTP/alert family was checked
and is already fully GUI-capable (managed credentials form + `getManagedAlertConfig` /
`getSmtpConfig`, both managed-first) — nothing was duplicated.

Deliberately env-only, documented as such: `TWITCH_VOD_CACHE_ROOT` and
`STREAM247_PROGRAM_FEED_DIR` (mount points are infrastructure), the relay topology
(`STREAM247_RELAY_ENABLED`, relay URLs, `STREAM247_UPLINK_INPUT_MODE` — deploy wiring, and a GUI
value contradicting the running compose file would be a lie with a save button), and
`STREAM247_LOOP_STALL_TIMEOUT_SECONDS` (the process's own self-protection; the GUI must not be
able to lower the guard that catches a wedged worker).

Closed the last open part: the redis service compose provisioned although no code read it is
gone from both compose files, the five stack-generating scripts, both env examples and the docs.

- Acceptance: an operator changes the encoder preset in the studio, the next encoder start uses
  it; clearing the field returns the install to its env-driven behaviour bit for bit
- Acceptance (part 2): a watchdog threshold saved in the GUI is in effect on the next cycle
  without a container restart; a value outside the safe bounds never persists
- Rollback: clear the managed fields (empty = follow env) — no schema migration was involved

## M57 Embedded Video Sources As Scene Layers

Architecture decision (stage 1, settled): the playout ffmpeg keeps exactly two video inputs —
programme feed and the overlay PNG pipe. An embedded camera/feed reaches the frame as an overlay
panel at snapshot cadence: a short-lived capture process grabs one frame per interval, the native
renderer inlines it as an image, and the encode can never stall on a third live input. No relay
change, no additional ffmpeg input in stage 1.

- The `source` custom layer carries placement plus a reference into `overlay_video_sources`; the
  feed URL is encrypted at rest (app-secret key, destination stream-key custody: one writer, one
  reader — the playout sampler), and only presence is ever listed
- Away-behaviour (owner default): the layer is hidden on air, no frozen last picture; the studio
  shows the outage as status. The visibility decision is one predicate in the layout so a later
  "last picture + offline mark" stays a local change
- Runtime gate `sourceLayerEnabled` defaults off; capture cadence is managed with env fallback
  (default 5s); the sampler runs on the renderer loop, detached, timeout pinned under the cycle
  stall budget; its directory is the cheapest disk-watermark stage
- Stage 2 (in progress): the relay joins the loop. Etappen A+B are done — push ingest (RTMP +
  SRT host ports, both owner-approved), relay HTTP auth against the web app, per-source publish
  keys, the self-generating internal relay key, derived (never stored) internal read URLs, and
  the per-cycle attach decision with presence poll and circuit breaker, logged but never acted
  on. Etappen C-E stay open: the actual ffmpeg attach/detach path (which also arms the breaker),
  the audio gain wiring (the resolver exists), and whatever operator surface the attach needs
  beyond the feature switch

## M58 Truthful Incident List

The incident list is the surface an operator opens during an outage. Measured on the running
channel on 2026-08-27 it held 50+ open entries, 40+ of them `critical`, the oldest from 5 July, and
every single one described something that had finished long ago.

- Classify every fingerprint family once, in one registry, as a **state** (a condition that holds
  until it stops holding; the raising code already knows when that is) or an **event** (something
  that happened and is over the moment it is written). A new reporting site must land in the
  registry or the test suite refuses it
- Close event incidents from outside, on proof that their area has been healthy and quiet for a
  fixed window, using only measurements the runtime already writes
- Collapse the per-asset ffmpeg-exit fingerprint into one family and clear the rows the old shape
  left behind

## Rollback Notes

- Docs-only milestones roll back by reverting the doc commit.
- Schema changes must be additive first, with a clear downgrade note before any destructive migration is considered.
- Scene rendering work must preserve the current text-overlay path until the new renderer is proven stable.
- Queue/transition milestones must preserve a safe compatibility path until continuity tests are green.
- Multi-output milestones must keep current primary/backup delivery usable as the default fallback mode.
- Phase 3 schema changes (M21: `title_prefix`, `hashtags_json`, `platform_notes`) are additive only; rollback by reverting migration and worker/web code while leaving the DB columns in place.
- Output profile feature (M24) is fully opt-in; `STREAM_OUTPUT_*` env vars default to current hardcoded values so no behavioral change without explicit configuration.
- Engagement layer (M25) is disabled by default; rollback by setting `STREAM_CHAT_OVERLAY_ENABLED=0` and `STREAM_ALERTS_ENABLED=0`.

## Strict Done Definition

- code complete
- tests updated
- `pnpm validate` passes
- any needed smoke checks are run
- docs updated
- summary written with changed files, risks, and follow-up items

## Progress Notes

### 2026-08-27 — M58: The Incident List Says What Is Broken Now

- **What was measured.** 50+ open incidents, 40+ `critical`, oldest 5 July. Verified in code: of
  the ~45 fingerprint families the worker raises, only some called `resolveIncident` at all, and the
  ones that never did were exactly the ones describing finished events — `playout.feed-audio`,
  `playout.feed-stall`, `playout.ffmpeg.exit.*`, `playout.ffmpeg.stderr`, `playout.start.failed`,
  `playout.switch.failed`, `uplink.ffmpeg.stderr`, `uplink.process.exit`, the four keyed
  `uplink.*-stall` / `no-progress` / `discontinuity-storm` families, and both loop watchdogs. The
  survey also corrected the starting assumption: the state families (disk watermarks, system volume,
  every `twitch.*`, every `source.*`, `playout.no-asset`, `playout.output.missing`, the per-
  destination cooldown) all already resolve themselves. The bug was never "resolution is missing",
  it was "one of the two kinds of incident has no possible resolver at its reporting site".
- **The registry.** `apps/worker/src/incident-classes.ts` holds every family with its kind, its
  area and a written reason. Keyed families are allowed only where the key names a bounded,
  configured thing — a destination, an output profile, a stored source. `tests/unit/incident-classes.test.ts`
  reads every `fingerprint:` expression out of the worker source, including the literal prefix of a
  template, and fails on anything unclassified: a new reporting site cannot avoid the decision.
  Chosen over a branded-type wrapper because the repo already scans source in a dozen tests and
  rewriting ~48 call sites for the same guarantee is diff, not safety. The first version of that
  scanner had a hole exactly where it mattered: it took `raw.split("${")[0]` as the family prefix
  and dropped empty results, so a template *beginning* with an interpolation vanished — and both
  loop watchdogs are written `` `${mode}.loop.stalled` ``. The guard skipped the two families whose
  incidents are the loudest thing in the list. A leading slot is now expanded when its values are an
  enumerable union we know (`RuntimeMode`), and otherwise emitted as an unresolvable marker that no
  registry entry can match, so the check goes red instead of quiet. Three tests cover it, including
  one that feeds the scanner an invented `` `${somethingNew}.foo.bar` `` and proves it comes back
  unclassified.
- **The health proof, and the two versions of it that were wrong.** An adversarial review took the
  first version apart with two demonstrations against the real module, both correct:
  - `programFeedStatus` is written *only* by the playout and uplink processes (`updateProgramFeedRuntimeStatus`).
    The worker, which runs the sweep, never recomputes it. Stop both processes and the last "fresh"
    stands in the database forever — so a check on that word alone declared playout permanently
    healthy and closed `playout.loop.crashed` and `playout.start.failed` *because* playout had died.
    The direct-output branch had always checked heartbeat freshness; the asymmetry was the bug. Feed
    mode now needs all three: the word, the playlist mtime (`programFeedUpdatedAt`, which keeps
    ageing when nobody recomputes it) inside the same allowance `readProgramFeedRuntimeStatus` uses,
    and a live playout heartbeat.
  - a running uplink proved nothing. In hls mode `canBlameUplinkForStall` disarms every stall
    watchdog while the feed is not fresh, so nothing restarts the process, `uplinkStartedAt` ages
    past any window, and the cycle tail still writes status `running` with a fresh heartbeat. That
    is verbatim the outage our own comment documents — 65 minutes running without encoding a frame
    while the channel was dark — and the first version would have closed `uplink.no-progress.*` and
    `uplink.process.exit` in the middle of it. The claim in that docstring, that every uplink event
    restarts the process, is false on exactly this path. Uplink health now asks
    `canBlameUplinkForStall` first (no armed watchdogs, no conclusion), then requires destinations
    out of error and uptime longer than the *resolved* watchdog windows rather than a fixed ten
    minutes — those are managed and can be raised to hours, and uptime is only evidence because a
    watchdog would have fired.
  - `getRunningUplinkStartedAt` took the oldest running process, so with several output profiles one
    permanently crash-looping profile read as "up for 45 minutes" on its sibling's number. It now
    takes the youngest, via `pickUplinkGroupStartedAt` in `uplink-progress.ts`. Everything that asks
    "has the uplink been stable" — the sweep and the scheduled reconnect — means all of it.
  - the worker area is the honest exception and the docstring now says so: the pass runs immediately
    after the `worker.cycle` line it reads, so "the worker is alive" is close to a tautology. It is
    kept for the case it does catch (a stale snapshot, or an audit write that is failing), not as
    independent evidence. A relay that is switched off still counts as healthy: no uplink process
    runs, so nothing there can be failing.
- **Quiet has to outlast the fault's own cycle.** Ten minutes of silence says nothing about a fault
  on a fifteen-minute cycle: it would be closed in every gap and reported again in every burst, and
  the list would read green for ten minutes out of every fifteen while the channel kept falling
  over. `upsertIncident` preserves `created_at` across a reopen, so first-to-last report is exactly
  how long the family has been recurring, and the quiet demanded is `max(base, min(span, 6h))`. The
  cap is where the requirement stops adding safety — an area measurably healthy and silent for six
  hours is not mid-incident — and it is what keeps the July backlog closeable. A genuine one-off has
  a span of zero and is unaffected.
- **Ten minutes, fixed.** Longer than any recovery the runtime performs on its own — the longest
  default watchdog window is the uplink's 300s "never encoded a frame" restart — so a channel that
  restarts every few minutes cannot clear its own list between restarts and look calm while it
  flaps. Short enough that an operator who fixed something watches the list clear. Deliberately not
  a managed setting: this is the honesty threshold of a reporting surface, not plant tuning, and a
  field would invite setting it to thirty seconds and getting the lying list back. A test asserts
  both constants and that neither reached `managed-runtime.ts`.
- **Noise that is not evidence.** `playout.ffmpeg.stderr` and `uplink.ffmpeg.stderr` are raised by
  `line.toLowerCase().includes("error")`, and a healthy encode prints "Error while decoding stream"
  over a single corrupt packet. Letting one gate an area would have frozen the whole list on a
  channel that is fine, which is the same failure in a new costume. They are marked `noisy`: still
  closed themselves, still made to wait out their own repeats, but they do not speak for their area.
- **The fingerprint explosion.** `playout.ffmpeg.exit.<assetId>` gave every asset that ever failed
  its own permanently open critical row. The `upsertIncident` dedupe was working the whole time —
  it upserts on fingerprint and refreshes `updated_at` — the fingerprint was simply too granular for
  it to help. Collapsed to `playout.ffmpeg.exit`; the asset id and input summary were already in the
  message and stay there.
- **No migration, on purpose.** `20260827_001` was verified free (the 2026-08-26 sequence runs _001
  through _004 and nothing later is registered) and deliberately left unused. The cleanup condition
  the milestone needs is "the area is healthy now", and a SQL migration cannot see that: it runs at
  schema time, on a container that has just started, where the persisted runtime says whatever it
  said before the restart. It would either close the backlog blindly or, on exactly the install
  worth cleaning, close nothing. The sweep therefore lives in the worker cycle, where the health
  proof is real. The retired `playout.ffmpeg.exit.<assetId>` shape is recognised by
  `RETIRED_INCIDENT_FINGERPRINTS` and closed once it is past a seven-day grace and playout is
  healthy — the grace is not about those rows being finished (no running code can raise them) but
  about a rollback to the previous image, which would write that shape again.
- **Unclassified fingerprints are left open.** A string the registry does not own is more likely a
  state incident from another build than a finished event, and guessing wrong hides a real problem.
- **Resolving overwrites.** `resolveIncident` sets `message` to whatever it is handed, so the
  automatic note prefixes the original text rather than replacing it. Otherwise the sweep would
  delete the exit code, the stderr tail and the asset from forty entries at the exact moment they
  become history — the only thing a post-mortem would have wanted from them.
- **Surfaces.** Both incident panels now carry the age of each open entry — last reported first,
  because that is what separates the channel's current problem from July's — and say how many
  further open incidents a capped panel is not showing. The admin status chip counted the capped
  list, so it read "5" while forty were open; it now counts them all. Text only, so the
  control-density budgets (`live-status` 27/1, `admin-settings` 31/1) are untouched. The e2e fixture
  seeds no incidents, so the empty-state branch still renders and no wording or design baseline
  moves. The clock for the ages lives outside the render — a server helper for the dashboard, the
  snapshot's own `generatedAt` for the control room — because eslint's `react-hooks/purity` rejects
  `Date.now()` there, and the snapshot timestamp also makes the server and hydrated renders agree.

### 2026-08-27 — M57 Stage 2, Etappe E: The Operator Surfaces

- **The regression this stage exists for.** Making the relay check credentials turned the two
  documented emergency rollback paths (`STREAM247_RELAY_ENABLED=1` publishing to `live/program`,
  `STREAM247_UPLINK_INPUT_MODE=rtmp` reading it back) into paths nobody could walk: they need the
  internal relay key inside `STREAM247_RELAY_OUTPUT_URL` / `_INPUT_URL`, that key generates itself
  into `managed_secrets` and is deliberately never printed, and the runbooks therefore said to
  treat the rollback as unavailable. A real operational regression in a failure path, fixed here.
- **Relay access** (new folded group, Settings → Operations). `deriveRelayProgramRollbackUrl` and
  `buildRelayRollbackEnvLines` live in `packages/core/src/relay-ingest.ts` — pure, fail-closed on
  an empty key (a URL with an empty password authenticates against nothing and would read as a
  working line), percent-encoded because the value is pasted into an environment file. The reveal
  is `POST /api/settings/relay-access`: `requireApiRoles(["owner","admin"])` before anything reads
  the key; POST rather than GET so it is an action rather than a prefetchable, linkable,
  access-logged URL that returns a secret; the settings page ships the button and nothing else, so
  the value is absent from the server-rendered HTML and therefore from the wording baseline; one
  `relay.internal_key.revealed` audit line per reveal naming the actor and never the value, written
  before the answer leaves; `RELAY_ACCESS_REVEAL_RATE_LIMIT` (10 per 15 min, keyed on the account,
  not the peer — the role check already gates the peer, what is left is a stolen session harvesting
  the key); `cache-control: no-store` on every answer; and one identical 503 for every "no key to
  give you", carrying neither the key nor the driver error.
- **The reveal must not be a write.** `readRelayInternalKey` is self-generating: on an install with
  no key it mints one, and on an install whose `APP_SECRET` has rotated it blindly overwrites the
  stored row and returns the NEW value. Wiring the button to it made clicking "show" a key rotation —
  every already-running container keeps the old value in its process cache, so every relay read and
  publish would start failing as "wrong password" until each one restarted, during the exact incident
  the button exists for. It also made the 503 branch unreachable outside tests. Fixed with
  `readRelayInternalKeyIfPresent` in `packages/db`: one SELECT, no INSERT, no UPDATE, and no
  interaction with the process cache either, so "does not write" holds for the whole call. Missing
  row and undecryptable row both return `""`, and the route does not distinguish them to the caller.
  Proven in `tests/integration/db-roundtrip.test.ts` against a real database — empty table stays at
  zero rows, and a deliberately poisoned ciphertext comes back byte-for-byte unchanged — plus a unit
  test where the generating reader is mocked to throw, so reaching it fails loudly.
- **Who may see the button.** `/admin?tab=settings` has no role gate of its own (the admin layout
  only requires a session), so every signed-in account including viewer and moderator was shown a
  control labelled as the way to obtain the relay's credentials. The key never leaked — the route
  answers them 403 — but a surface should not advertise the existence and retrieval path of a
  credential to people who cannot have it. The group is now rendered only for owner/admin, checked
  inline rather than with `requireRoles` (which redirects, and the rest of the page is legitimately
  readable by anyone signed in). The e2e fixture signs in as owner, so the group still appears there
  and the `admin-settings` baselines move exactly as described below.
- **Fail closed on an unnameable session.** The route reads the user a second time to name the
  actor; if that came back null (deleted or demoted between the two reads) it used to reveal anyway,
  audit it as "an unnamed session", and collapse every such caller into one shared rate-limit
  bucket. It now answers 403 before touching the key.
- **Honest about what the rate limit does.** The earlier comment claimed it protected the audit
  trail. It does not: `appendAuditEvent` keeps only the newest 100 entries and roughly thirty other
  routes write into the same ring unthrottled, so an actor can push their own reveal line out of it
  with ordinary settings traffic. Fixing that means changing the audit mechanic, which is out of
  scope; the claim is corrected rather than the mechanic patched. Also accepted and now stated: the
  401/403 answers come from `requireApiRoles` and carry no `cache-control`, and a second privileged
  account is a second bucket.
- **Wording gate.** The env names appear only inside the copied `KEY=value` lines, never in prose,
  and the fold's contents never reach `wording-baseline` (it records summaries, not fold contents)
  nor the visual baseline (nothing is fetched until someone clicks). No test was weakened.
- **Sound from live video sources** (new folded group). `resolveSourceLiveGainPercent` had been
  managed since Etappe D with no field. `isValidSourceLiveGainPercent` (whole 0..200) is enforced
  in the form and again in `/api/settings/operations` as its own key family — refused rather than
  clamped, because the resolver clamps so a stored value cannot break playout while a typed 500 is
  a mistake worth showing. The group carries the C+D invariant in plain words: a live source's
  sound is mixed only into items whose duration is known in advance, so on anything else the camera
  is embedded picture-only and the feed-audio watchdog stays meaningful.
- **Live attach state, visible.** Chosen as a field on the existing source rather than a runtime
  singleton row: the decision is per source, the studio already lists sources, and M57 stage 2
  extended this same table the same way. Migration `20260826_004_overlay_video_source_live_state`
  (next free in that day's sequence — `_001` … `_003` were verified as the whole of 2026-08-26 and
  nothing later is registered), mirrored in the base schema block: `live_state`, `live_state_at`,
  `live_retry_at`, all additive, all empty on existing rows, none of them a credential.
  `describeSourceLiveState` in core turns the stored decision word into the sentence; unrecognised
  values return "" so a surface shows nothing rather than inventing a state.
- **Deciding to attach is not attaching.** The first cut wrote the state from the decision edge, so
  a source whose read URL did not resolve — or whose intent was never consumed, because the cycle
  deliberately does not restart a running process just to attach — left the studio saying "Live in
  the programme" while nothing had been attached at all. The truth condition is now split in two:
  `buildSourceLiveStateWrite` returns `null` for an ATTACH and only ever records skips (true the
  moment they are decided), and `buildStartedSourceLiveStateWrite` owns the live state, fed from
  `playoutLiveSourceInputActive` — the flag C+D introduced to mean "a live PiP input was really
  placed in the running command". An intent that did not become an input records
  `attach-unavailable`, not silence. Two further holes closed: an attach decided but with no
  resolvable address records `attach-unavailable` at the point that becomes final, and a non-asset
  selection (live bridge, standby slate) records `not-asset-playout` instead of leaving a stale
  "live" standing for the whole stretch. `apps/worker/src/index.ts` is not importable — it starts a
  worker — so the wiring is pinned by reading the source: the started state must be derived from
  `playoutLiveSourceInputActive`, and the decision function must not contain `"publishing"` at all.
- **The observation write left the broadcast path.** It had been an inline `await` inside
  `resolveLiveSourceAttach`, which is awaited before `startOrSwitchPlayout` — under the global
  state-write lock, with no timeout, right beside the comment warning not to await anything
  expensive there. It is now fire-and-forget through `recordSourceLiveState`, deduped on the whole
  write and tail-chained on one promise so submission order survives (the lock is a Postgres
  advisory lock, not an in-process queue, so two loose writes could otherwise commit out of order).
  Failures still log `playout.source-live.state_write_failed` and are dropped — an observation store
  must never decide whether a camera goes on air, nor how fast it gets there.
- Budgets unchanged: both new admin groups are folded (`<summary>` is not a counted control), and
  studio-scene gained text only. `studio-scene` 56/1 and `admin-settings` 31/1 stand as recorded;
  no ratchet comment was needed.
- Still open: the mandatory DT soak gate before any deploy, and per-layer snapshot cadence.

### 2026-08-27 — M57 Stage 2, Etappen C+D: The Third Input And The Audio Mix

- Etappe C wires the pushed source as a live PiP input. `getFfmpegCommand` and
  `startOrSwitchPlayout` gained an optional `liveSource`; the PiP is always the LAST ffmpeg input,
  so the scene pipe keeps its index and the builder derives `pipInputIndex = sceneInputIndex + 1`.
  Video graph (scene mode): `[L:v]fps=<fps>,scale=W:H:force_original_aspect_ratio=increase,crop=W:H,setpts=PTS-STARTPTS[pipv]; [base][pipv]overlay=X:Y:eof_action=pass[vpip]; [vpip][scene:v]overlay=0:0:format=auto[vout]` —
  the PiP sits UNDER the scene PNG, `eof_action=pass` so a lost source never freezes the frame.
  X/Y/W/H come from `resolveSourceLayerPixelBox`, exported from `overlay-layout.ts` as a thin
  wrapper over the renderer's own `resolvePlacementBox` (parity test pins bit-identical boxes), so
  the live window lands exactly where the snapshot panel would. The RTSP read is pinned to TCP with
  a 4 s timeout, held strictly under the smallest duration-bound margin (5 s) as a pinned invariant.
- Renderer skip: while a source is live-attached, the scene renderer nulls its source frame so the
  opaque snapshot panel never renders over the live video (v1 draws no chrome around the window).
  A process-scoped flag set before the first frame, so no panel flash on attach.
- Attach wiring: the Etappe B decision now drives the parameter — `resolveLiveSourceAttach` logs on
  change AND, on an attach, resolves the read URL + placement. A failed attach start (unplanned,
  non-clean exit of a process that actually carried a PiP) opens the attach breaker, arming the
  trigger B prepared. Attach is consumed only when a process (re)starts, so a source going live
  mid-asset waits for the next natural boundary (`isNaturalPlayoutBoundary`).
- Etappe D mixes audio: `[prog]volume=<v>[prog_a]; [L:a]aresample=async=1:first_pts=0,volume=<gain>[pip_a]; [prog_a][pip_a]amix=inputs=2:duration=first:dropout_transition=2:normalize=0[aout]`.
  Pins: `normalize=0` (no programme level jump on source EOF), programme/lane FIRST at
  `duration=first`, no `apad` on the PiP branch (amix drops the ended input — the only way "source
  gone" is acoustically folgenlos). `-shortest` is set, but note it bounds the encode to the
  PROGRAMME's own stream ([vout] follows the programme video, [aout] is duration=first); the ever-fed
  scene PNG pipe never EOFs, so `-shortest` does NOT end a programme that never delivers EOF — the
  watchdogs are the net there. Gain from `resolveSourceLiveGainPercent` (default 40 → 0.40).
- BLOCKER fixed from the adversarial ffmpeg review (real ffmpeg-6.1.1 runs): PiP audio would MASK the
  feed-audio watchdog. The playout encode IS the program-feed writer, and `enforceProgramFeedAudio`
  counts the audio packets of the newest segment to catch a source that runs dry without EOF (the fps
  filter keeps video flowing; audio is the honest signal). Folding live PiP audio in masks a silent
  programme. Fix: `decideLiveSourceAudio` builds the mix ONLY when the programme asset has a known
  finite duration (duration-bound is then the net, masking harmless); unknown duration → PiP
  video-only, programme audio stays the sole track, watchdog honest. Proven against the REAL state
  machine (`observeFeedAudio`/`isFeedAudioStalled`), not the mix string.
- MINOR fixed: the `[L:a]` reference no longer trusts the relay's advisory `tracks` flag alone (a
  lying/racing publisher would crash ffmpeg at graph init, exit 234 → breaker). The source's audio is
  now probe-confirmed (`probeInputHasAudio`, RTSP pinned to TCP, fresh each attach — never cached, so
  no stale-verdict TOCTOU); an unconfirmed source falls back to video-only. Programme-audio (no-lane)
  stays a bounded, asset-id-cached probe.
- NOTE fixed: the relay presence poll is now gated on the upcoming selection being an ASSET, so a live
  bridge or standby slate (which can never carry a PiP) costs zero relay traffic.
- Guardian proofs as tests (`source-live-watchdog-proof.test.ts`): feed-audio proven against the real
  watchdog state machine (silent programme fires; mixed-in PiP audio would mask it; the duration gate
  keeps them connected); a lying-relay source → video-only, no graph-init crash; feed-stall/uplink
  (eof_action=pass keeps the frame flowing); duration-bound (clamp invariant); loop-stall (probes
  clamped to the cycle-await ceiling); crash-loop (a failed attach makes the next start attach-free,
  so a PiP alone cannot reach the threshold of 3).
- Deliberately left for E and the soak gate: operator surfaces beyond the switch (gain UI,
  revealing/threading the internal key for rollback), per-layer cadence, and the mandatory DT soak
  before any deploy — attach latency, breaker behaviour under a flapping feed, the audio mix on a real
  programme with and without its own audio track, and confirming the feed-audio watchdog still fires
  on a silent unknown-duration source with an active PiP.
- Affected baselines: none — every change is worker-side (ffmpeg command, filter graphs, exit
  wiring) with no studio surface touched.

### 2026-08-27 — M57 Stage 2, Etappen A+B: Push Ingest Foundation And The Attach Decision

- Schema additive on `overlay_video_sources`: `ingest_kind` (default `'pull'`, so every existing
  row keeps its meaning) and `encrypted_publish_key` — base block plus migration
  `20260826_002_overlay_video_source_push_ingest`; new `managed_secrets` table
  (`20260826_003_managed_secrets`) for the self-generating internal relay key (app-secret
  first-boot semantics with `ON CONFLICT DO NOTHING` as the exclusive-create flag, value
  encrypted like every stored credential). Numbers verified free: 2026-08-26 held only `_001`.
- The internal read URL of a push source is derived, never stored:
  `rtsp://reader:<internal-key>@relay:8554/src-<id>` out of `readOverlayVideoSourceUrls`, so the
  stage-1 snapshot sampler covers pushed cameras for free. Pinned in the db roundtrip.
- Relay auth as a pure core function (`evaluateRelayAuth`): publish on `src-<id>` only with that
  push source's key, read anywhere and publish on `live/program` only with the internal key,
  everything else 403 — with exactly one constant-time comparison per decision (hand-built,
  because `node:crypto` must not enter the client-shared core barrel; the constant-read property
  is pinned structurally via instrumented inputs). The web endpoint `/api/relay/auth` carries no
  session (mediamtx calls it server-side), answers every refusal with the same bare 403,
  rate-limits per reported address and audits rejected publishes only.
- `docker/mediamtx.yml` (mounted, validated against mediamtx 1.15.4): authMethod http toward the
  web app with the default api/metrics/pprof exclusions, RTSP read side and control API
  container-internal, host ports only RTMP 1935/tcp + SRT 8890/udp (owner: both).
- Studio source manager: arrival choice (fetched address vs pushed), publish key issued
  server-side and shown exactly once, rotation button, kind switches retire the other kind's
  secret. All inside the existing fold — studio-scene budget 56/1 untouched.
- Etappe B: `relay-presence.ts` with the I/O-free `decideSourceLiveAttach` (every uncertain
  input decides skip), the three-minute in-memory attach breaker (trigger arrives with C, state
  machine tested now) and the 2s-bounded presence fetch against `relay:9997`; the playout cycle
  logs `playout.source-live.attach_decision` on change and acts on nothing. New resolvers
  `resolveSourceLiveEnabled` (default off) and `resolveSourceLiveGainPercent` (clamp 0..200,
  default 40, zero means attach muted); the switch joins the feature-switches fold
  (admin-settings budget 31/1 untouched), the gain waits for its stage.
- Rollback note: with relay auth active the rtmp relay rollback URLs need the internal key
  embedded; documented in deployment/operations docs as unavailable-until-surfaced rather than
  a reason to weaken the auth config.
- Deliberately left for C-E: any ffmpeg change (attach/detach, the third input, gain filter),
  arming the breaker, revealing the internal key to operators, and any per-layer cadence work.
- Affected baselines: none expected to move — every new control and sentence sits inside a
  closed fold (closed `<details>` content is excluded from the control count and the wording
  text alike); re-record only if a run proves otherwise.

### 2026-08-26 — M56 Part 2: Replay Cache, Watchdogs And Feed Tuning Into The GUI

- Three new resolver families in `packages/core/src/managed-runtime.ts` (replay cache, watchdog
  thresholds, feed tuning), each with exported bounds (`VOD_CACHE_LIMITS`, `WATCHDOG_LIMITS`,
  `FEED_TUNING_LIMITS`) shared by resolver, API route and form. Managed numbers clamp; the env
  path keeps its historical semantics bit for bit. Clamp derivations live next to the bounds and
  are pinned as tests, including the cross-family invariant that the feed-stall floor (15 s)
  stays above the longest configurable segment (10 s).
- Twenty-three new keys on the encrypted `ManagedConfigRecord` — no migration, JSON payload with
  read-time defaults. Byte sizes are stored as GB because that is what the form asks for.
- Worker: `getTwitchVodCacheConfig`, the four watchdog option readers,
  `getPlayoutReconnectConfig` and `getProgramFeedConfig` all take managed input and delegate to
  the core resolvers; the playout and uplink modes refresh `latestManagedConfig` at each cycle
  start (each mode is its own process). The reconnect cadence became a per-cycle read instead of
  module-level constants. The cycle-budget clamp is applied after managed resolution, so a
  managed 7200 s download timeout can never outlive the loop stall guard — pinned by a test.
- Web: three folded groups in the operations panel ("Replay cache", "Watchdog thresholds",
  "Feed tuning"), each saving through its own partial route (`/api/settings/replay-cache`,
  `/watchdogs`, `/feed-tuning`). Admin-settings control budget stays 31/1: all twenty-six new
  controls sit behind summaries. The per-replay-ceiling-inside-cache pair rule is validated whole
  against resolved values, form and API alike.
- SMTP/alert family audited: already fully GUI-capable since the managed-credentials work
  (`getManagedAlertConfig` web-side, `getSmtpConfig` worker-side, both managed-first with env
  fallback; all fields present in the credentials form). Nothing duplicated.
- Deliberate omissions, with reasons in code and PLANS: cache root and feed directory (mount
  points), relay topology (deploy wiring), `STREAM247_LOOP_STALL_TIMEOUT_SECONDS` (the GUI must
  not be able to lower the process's own self-protection).
- Affected baselines (not re-recorded here): admin-settings wording baseline gains the three new
  fold summaries and the reworded operations intro; the admin-settings design screenshot moves
  with the added summaries. No other surface changes.

### 2026-08-26 — M57 Stage 1: Embedded Video Sources As Overlay Panels

- Stage 1a: `source` layer kind in core (placement + sanitised source reference, any URL a caller
  smuggles into the layer is dropped in the normaliser), `overlay_video_sources` table (base
  schema + migration `20260826_001_overlay_video_sources` — 006 of 2026-08-25 stayed reserved for
  parallel M56 work, so the next day's sequence was used), destination-style encrypted upsert with
  keep-on-empty, admin-gated write-only API route, studio placeholder tile and source manager,
  managed switch `sourceLayerEnabled` (default off). Proof test pins that stage 1a changed nothing
  on air.
- Stage 1b: `buildSourcePanel` renders the capture as a data-URI image inside the game panel's
  placement/clamping rules (extracted into one shared helper); the frame cache key carries capture
  status and timestamp, never image bytes. Side gain: logo, image and text layers render on air
  with the existing ink/surface vocabulary — no new colour literals; embeds stay browser-only and
  the studio says so. Measured through the real satori/resvg path: ~76ms for a 1280x720 frame with
  a 640x360 capture, warm (budget: well under the 1s frame interval).
- Stage 1c: `apps/worker/src/source-snapshot.ts` — I/O-free policy (cadence resolver clamped
  2..300s, capture timeout under the cycle stall budget, three-interval staleness grace, failure
  threshold 3) plus a temp+rename spawner; wired into the renderer refresh loop behind an
  in-flight guard, never the reconciliation path. Incident `playout.source-snapshot.failed` raises
  after repeated failures and auto-resolves on the next good frame. Snapshot directory is the new
  first (cheapest) disk-watermark stage.
- Affected design/wording surfaces: the overlay studio page gained the video source manager and
  new layer-editor copy — studio-scene screenshot baselines will move; on-air baselines only move
  for scenes that already carry text/logo/image layers.

### 2026-08-25 — M56 Part 1: Operational Settings Into The GUI

- New `packages/core/src/managed-runtime.ts`: one resolver per family (encoder quality, disk
  watermark, feature switches, EventSub secret), all managed-first with env fallback, plus the
  validation helpers the settings forms and routes share. Tests pin that an empty managed value
  reproduces the pre-M56 env behaviour exactly, `=== "1"` quirks included.
- Eleven new keys on the encrypted `ManagedConfigRecord` — no migration, the payload is JSON and
  the defaults merge in on read.
- Worker: playout/live-bridge/standby/uplink ffmpeg commands, the disk watermark monitor, the
  chat/alerts/schedule-sync gates and the EventSub subscription sync all resolve through the
  shared resolvers; `getDiskWatermarkConfig` and `isTwitchScheduleSyncEnabled` folded into core.
- Web: encoder quality as a folded group on the studio output tab; disk watermark and feature
  switches as folded groups in admin settings (partial-update route so the two forms cannot blank
  each other); EventSub secret in the managed credentials form with keep-on-empty semantics.
- Deleted `packages/config` whole — `getConfig` had no importers.
- Deliberately left for later M56 parts: VOD cache family, watchdog thresholds, relay topology,
  reconnect tuning, and the unused redis service in compose.

### 2026-08-28 — M59 Follow-Up: The Same Deletion Shape In Four More Places

- Audit after the v1.5.33 sync wipe, looking for the same shape everywhere: a failure that
  produces no data, and a caller that reads "no data" as "the data is gone". Four hits, one of them
  worse than the original.
- **A1, the serious one.** `walkMediaFiles` wrapped the entire recursive scan in
  `catch { return []; }`. An unmounted volume, an NFS timeout, EACCES, EMFILE or one unreadable
  subdirectory all produced an empty list, and `syncLocalMediaLibrary` handed that straight to
  `replaceAssetsForSourceIds(["source-local-library"], [])`. Worse than the Twitch incident,
  because the local library is where the global fallback lives (`isGlobalFallback` is derived from
  the filename): the Twitch wipe dropped the channel onto the standby video, this one deletes the
  standby video as well. It also cascades — an emptied `state.assets` defeats
  `collectDiskProtectedAssetIds`, so the watermark sweep is free to evict the VOD cache and
  thumbnails of assets the schedule still references. `scanMediaFiles` (in `local-library.ts`, with
  an injectable readdir so the failure modes are testable) now reports whether the walk completed;
  a partial failure counts, not just a failure at the root. The sync feeds that in as
  `ingestFailed` and reuses `decideSourceAssetReplacement` — no second special case.
- **The last line of defence.** `replaceAssetsForSourceIds` checked only `sourceIds.length === 0`
  and never looked at the incoming asset list, which is why each of these bugs reached the
  database. It now refuses to empty a populated source unless the caller passes
  `allowEmptyReplacement`. Deliberately keyed on zero, not on a percentage: a source shrinking from
  49 items to 1 is an ordinary playlist edit, and blocking that would pin stale rows on air with no
  way out. Zero is the only count that is both catastrophic and never distinguishable from a
  failure that produced no listing. A genuinely emptied source stays emptiable — the syncs that
  built both lists from the same evidence opt in. It refuses rather than throws: reaching it means
  a caller's scope decision was wrong, and failing the cycle would hurt the broadcast the guard
  exists to protect, so it warns instead.
- **A2.** `syncDirectMediaSources` skipped asset building for an invalid URL but left the source id
  in the delete list. `planDirectMediaSync` derives the usable entries and the unusable ids in one
  pass, so the two lists cannot drift. The Twitch invalid-URL branch had the same gap, saved only
  by the keep-empty-result rule catching it by accident; it is now explicit.
- **B2.** The status write knew nothing about the preservation, so a protected source and a wiped
  one both read `Ingestion failed`. `describeSourceSyncStatus` derives status, a `assetsPreserved`
  flag and the count still playable from the same outcome the replacement decision uses. Writing
  its test surfaced a wart worth keeping fixed: the replacement rule holds a failed source back
  even when it stores nothing, and the status must not round that into "assets preserved" when
  there were none.
- **B1.** A valid chapter probe that found nothing wrote `chaptersProbeStatus: "ok"` — absorbing,
  with no re-probe path and no reset in the UI. A rate limit, a geo/subscriber-only variant and a
  yt-dlp extractor regression all answer exactly that, and the consequence is on-air: wrong
  category, wrong title. The asymmetry was the tell — `"failed"` healed through its cooldown,
  `"ok"` never did. An empty result now gets its own, much longer interval
  (`CHAPTER_BACKFILL_EMPTY_RECHECK_SECONDS`, default one week, `0` disables) and rechecks sort
  behind never-probed assets and failure retries, so `CHAPTER_BACKFILL_PER_CYCLE` and the
  cycle-await ceiling are untouched. No schema change was needed and none was made:
  `chapters_probe_status` is already TEXT, and `"ok"` with an empty `chapters_json` is exactly and
  only the empty-result case — a new status value would have needed a data migration to heal rows
  that now heal by themselves on their next recheck. Assets that have chapters are still never
  selected, so operator edits keep winning outright.
- **C1.** `ensureLocalAssetThumbnail` deleted the existing thumbnail and let `ffmpeg -y` write
  straight to the target, so an OOM kill or disk pressure left nothing, or a torn file readers
  would serve. Adopted the temp+rename that `captureSourceSnapshot` already used; the disk sweep
  now also collects `.jpg.tmp` leftovers, which can only come from a process that died between
  render and rename.
- **C2.** YouTube incident resolution hung off a global `hadFailure`, so one failing source kept
  every healthy sibling's incident open — and with a permanently broken source, forever. The
  per-source set was already being built two lines away.
- Deliberately not done: no UI work at all (the sources health display is a parallel change; the
  worker side keeps its data shape plain and self-describing — a status string plus a preserved
  note — so the display needs no new contract). The extension set and the direct-media URL check
  moved out of `index.ts` because the new modules needed them, not as a wider refactor of that
  file. No baseline updates.

### 2026-08-27 — M59 Boundary Continuity: Source Wipe, Lost Wake, Silent Stops

- Started from a viewer-visible symptom — ~18s of fallback slate at two of three asset boundaries —
  and ended at a more serious one the measurement exposed: the running programme being cut every
  60-90 seconds. Both are fixed; the cut had priority.
- **Root cause of the cutting.** `syncTwitchVodSources` / `syncYoutubePlaylistSources` end with
  `replaceAssetsForSourceIds(allSourceIds, collected)` (`apps/worker/src/index.ts`), a
  delete-then-reinsert under one transaction. The per-source `catch` records an incident and
  contributes zero assets but leaves the source id in the delete list, so a transient yt-dlp error
  deletes that source's whole archive. Consequences chain exactly as observed on v1.5.31: the pool
  empties, so `choosePlaybackCandidate` finds no `preferredAsset` and falls to `global_fallback`;
  the on-air asset's row is gone, so neither stickiness guard (`runningScheduledAsset`,
  `currentPoolAsset`) can re-select it; `isMatchingRunningSelection` compares asset ids and
  mismatches, so the cycle cuts the running item via `stopPlayoutProcess("switch")`; the next
  worker sync restores the rows and playout switches back. Eight starts in eight minutes, strictly
  alternating fallback and programme.
- New pure `apps/worker/src/source-sync-scope.ts` decides per source whether a wholesale replace is
  safe. The rule is deliberately asymmetric in the direction that protects the broadcast: only
  positive evidence that a source holds its content permits deletion. A throw keeps the rows; so
  does an unexpectedly empty listing for a source that currently has assets, because that is far
  more often a soft failure (rate limit, empty playlist response, auth blip) than a channel that
  genuinely lost its archive. Held-back sources emit `source.sync.assets_preserved` rather than
  skipping silently, and the decision is per source so one failure never blocks a healthy sibling.
- **Root cause of the ~18s gap.** `requestImmediatePlayoutCycle` read a `wakePlayoutLoop` handle
  that `waitForNextLoop` installs only while the loop sleeps; a wake requested from inside a cycle
  found it null and returned. Both in-cycle callers were dead code in effect — the boundary
  fallback bridge and the deferred-prefetch follow-up. That is 15s of the ~18s (the playout loop
  delay); the remaining ~3s is the follow-up cycle's own work, including the inline resolve that
  returns a local Twitch cache path quickly. New `apps/worker/src/loop-wake.ts` latches a wake with
  no waiter armed and the loop consumes it before sleeping. Edge-triggered, and burst-limited to
  three consecutive immediate cycles so a future unconditional caller degrades to normal polling
  instead of spinning — `cycle-budget.ts`, `getCycleAwaitCeilingMs` and the loop-stall guard are
  untouched.
- **Diagnosability.** `stopPlayoutProcess(reason)` consumed its reason as a boolean and discarded
  it, and five of eight stop paths (`switch`, `destination-missing`, `scheduled-reconnect`,
  `crash-loop-reset`, `restart-requested`) logged nothing of their own, so `planned: true` covered
  both a deliberate kill and a clean end-of-asset. `playout.process.exit` now carries
  `plannedReason` and `ranForMs`.
- **Prefetch safety.** `decideBoundaryPlaybackInput` relied on call-site discipline for key
  correctness. It now takes the selected asset id and the probe carries its own `assetId`, so a
  probe for a different asset is ignored — a queue change between prefetch and boundary (skip vote,
  operator insert, schedule flip) cannot redirect playout to stale content. Tests pin the dangerous
  direction explicitly: a stale probe must yield `resolve` with an empty input, never the stale one.
- **Measurement.** New `apps/worker/src/playout-gap.ts` emits `playout.boundary.gap` with `gapMs`
  and `bridgeStarts` per boundary, so the improvement is measurable on the device instead of
  believed. Observation only; nothing it produces feeds a decision.
- Hypotheses tested and rejected, kept here so they are not re-run: the chapter backfill writing
  `chaptersJson` / probe-status columns cannot restart playout (`isMatchingRunningSelection`
  compares asset ids only, and the affected rows had empty probe columns); `duration-bound`,
  `feed-stalled` and `feed-audio-stalled` all log before stopping and none appeared; the
  delete-then-reinsert runs inside `withSerializedStateWrite` (BEGIN/COMMIT plus an advisory lock),
  so readers never observe the empty window — the wipe is persisted, not transient.
- Deliberately left alone: the watchdog family, the fallback chain, the cycle-budget invariant, and
  the four remaining silent stop paths' own events (the exit event now names them, which was the
  diagnostic gap). Not attempted: pre-start detection of a dead remote source — a deleted VOD is
  still only discovered when `resolveAssetPlaybackInput` throws at the boundary, which the fallback
  chain already handles; `queueProbeCache` failures still do not feed selection eligibility.

### 2026-08-25 — M53 Chapters Per Video

- Added the pure `packages/core/src/asset-chapters.ts` model: normalisation (sort, drop
  negatives/duplicates/empty rows, cap), chapter-at-elapsed lookup, and boundary detection over
  (elapsed seconds, chapter list, fired set) — the cuepoint pattern one level down, offsets within
  the asset. An empty list is exactly the pre-chapter behaviour and stays the rollback path.
- Schema stayed additive: `assets.chapters_json` (default `'[]'`) exists in the base schema and in
  migration `20260825_002_asset_chapters` for existing databases. Re-ingest fills chapters only
  while the stored list is empty (`chooseStoredAssetChaptersJson`), so operator edits survive
  every sync; Twitch VOD ingest maps yt-dlp chapters with the chapter title doubling as the
  category candidate, because Twitch names chapters after the game on air.
- The playout cycle emits `playout.chapter.boundary` once per crossed offset, keyed on
  (asset, process start) so restarts re-fire from second zero; the event fires and is recorded
  even while the M51 metadata gate waits for the broadcaster. The overlay hero title and the
  Twitch sync both derive the active chapter from elapsed playback (level-based), so a
  broadcaster connected mid-video catches up on the next cycle without a restart.
- `decideTwitchChannelMetadataWrite` is the single decision point in front of the helix/channels
  PATCH: waiting mode never writes, unchanged state skips, and a due write within 30 seconds of
  the previous one is deferred with the last-synced fields left untouched so the next cycle
  retries.
- Library UI: a chapter editor on the asset detail page (offset as seconds/mm:ss/hh:mm:ss, title,
  category per row; add/remove/edit) through the existing PATCH `/api/assets/[id]` route, which
  rejects offsets at or beyond a known duration.
- Validation completed: `pnpm validate` passed; the normalisation sort, the retention rule, the
  route's duration bound and the write throttle were each counter-verified by mutating the
  implementation and watching the matching test fail.

### 2026-08-25 — M54 Chat Game Framework And Snake

- Added the pure chat-game framework in `packages/core/src/chat-game.ts`: a game is settings plus
  `createInitialState` / `applyInput` / `renderModel` / `parseState`, with deliberately no tick —
  the contract has no way to advance a game by time, and tests pin that a round is byte-identical
  after hours without input.
- Snake is the first game: a configurable emote→direction map (four distinct single-token emotes,
  validated in the studio form and rejected with reasons at the API), a configurable grid
  (default 16x9), exactly one cell of movement per accepted chat message applied in arrival
  order, food/growth, and wall/self collision into a "Game over · Score N" card that the next
  input restarts.
- The worker consumes broadcast-channel chat before the display rate limiter (emote-only rooms
  steer fine), persists the round with its settings in the new `chat_game_runtime` table —
  created in both the base schema and the idempotent `20260825_003_chat_game` migration — and a
  restarted worker adopts the persisted round instead of wiping it. Flushes are throttled to one
  per second; the playout container re-derives the render model from one read per render
  interval, gated on the scene actually carrying a game layer.
- A new "game" custom layer kind places the panel per scene; the native renderer draws the cell
  grid within the safe-area and clamping rules, with the accent-or-white heading rule and
  measured chip ink, and no operator vocabulary in on-air text. Disabling the layer stops the
  intake and clears all game state.
- Validation completed: `pnpm validate` passed; counter-verified the one-cell rule (a two-cell
  mutation fails five snake tests) and the heading contrast rule (raw accent instead of
  `accentTextColor` fails the dark-accent cases).

### 2026-08-25 — M54 More Games: Minesweeper And 2048

- Two more games on the unchanged four-function contract, chosen to differ from Snake in both
  input and feel: Minesweeper (chat types coordinates like "b3"; the seeded board commits on the
  first dig and never under it, digs flood-reveal to the numbered frontier, a mine ends the
  round, clearing every safe cell wins) and 2048 (the snake's emote→direction map unchanged on a
  fixed four-by-four board; slide-and-merge with one merge per tile per move, seeded spawns,
  round over when no move remains). Tic-tac-toe was passed over because a correct minimax engine
  never loses — chat could at best draw, forever; hangman fits the cell-grid panel worst and
  needs a curated embedded word list.
- One resolver dispatches chat per game vocabulary, so a coordinate can never move the snake and
  an emote never digs; determinism tests pin same-seed-same-inputs-same-board for both games. The
  panel gained in-cell labels and a coordinate gutter (letters/numbers) that only coordinate
  games request, rasterised through the same satori smoke as Snake. No schema change: the
  settings row already stored `game_id` with snake as its default, and unknown ids normalise back
  to snake on old rows. The studio picker offers all three games within the existing select and
  folds away fields the selected game ignores, so the engagement control budget is untouched.

### 2026-08-25 — M55 Global Disk Self-Protection

- Added the pure `apps/worker/src/disk-watermark.ts` ladder: below 10% free the worker starts an
  eviction episode, runs one stage per cycle (unused VOD cache, then orphaned feed segments, then
  oldest thumbnails), and stops at 15% free rather than emptying everything; a misordered
  watermark override falls back to the defaults whole.
- Every stage composes an existing safety mechanism — the VOD cache eviction behind its
  `canReleaseVodCache` gate and partial/lock rules, the capped boundary feed sweep, and a new
  capped oldest-first thumbnail selection — and receives an explicit protection set covering every
  asset the schedule blocks, pools, broadcast queue and global fallback tier reference.
- Eviction that freed space raises a `disk.watermark.evicted` warning incident naming what went
  and why; a full ladder still below the recovery watermark raises the critical
  `disk.watermark.exhausted` incident that demands operator action.
- Validation completed: `pnpm validate` passed; the recovery-watermark hysteresis test was
  counter-verified by mutating the mid-episode comparison to the trigger and watching it fail.

### 2026-08-25 — M52 Setup Wizard

- `APP_SECRET` is now resolved in `@stream247/db` for web sessions and managed-config encryption alike: generated on first boot (64 chars, exclusive create so racing containers agree) and persisted mode-600 at `data/media/.stream247-app-secret`; env overrides everything, production still refuses the published dev constant and weak values, and the old silent dev-constant fallback inside `getEncryptionKey` is gone.
- `APP_URL` and `CHANNEL_TIMEZONE` moved into managed config with env-first resolvers (`resolveAppBaseUrl`, `resolveChannelTimeZone`); every reader in web and worker goes through them, with the scene renderer base URL as the one documented env-only exception (internal address, not the public one).
- `/setup` is a resumable wizard — owner → instance basics → Twitch app credentials → Twitch connect → review — with completion derived from actual configuration instead of a stored step counter; the go-live checklist links `APP_URL`/`APP_SECRET` to their wizard steps, and `DATABASE_URL` stopped gating the secret step because the compose-internal default points at the bundled Postgres.
- Compose marks `.env` as optional for web/worker/playout/uplink, so a fresh `docker compose up` with no env file reaches `/setup`; env examples and docs describe env values as pins/rollback rather than requirements.
- Validation completed: `pnpm validate` (lint, css tokens, typecheck, 778 unit + 33 integration tests, build) and the containerised e2e admin smoke via `scripts/e2e-smoke.sh` after rebuilding the test images. The first smoke run caught a real race in the updated spec — the post-bootstrap wait targeted the step rail, which renders before the session cookie lands — fixed by waiting on the owner summary that only exists after bootstrap; second run green.

### 2026-04-22 — M50 Portainer/DT Rollout Flow And Stack Check

- Rewrote `docs/deployment.md` so the repo → GHCR → Portainer on DT → DUT validation sequence is now the canonical deployment flow instead of an implicit assumption.
- Added the read-only `scripts/portainer-stack-check.sh` helper to resolve the pinned image digests from `.env.production.example` and compare them to the running Portainer-managed stack through the Portainer API and Docker-proxy endpoints.
- Validation completed: `./scripts/portainer-stack-check.sh --dry-run` and `pnpm validate` passed.

### 2026-04-22 — M49 Docs Finalization

- Collapsed the tracked product docs to the final six-file set: `architecture.md`, `deployment.md`, `moderation-policies.md`, `operations.md`, `twitch-setup.md`, and `ui.md`.
- Merged the durable reset content into the permanent docs, removed the tracked reset and Phase 4 archive docs from `docs/`, and updated `README.md` to point only at the permanent doc set.
- Moved the three user-owned local planning files out of `docs/` and into `planning/archive/` unchanged so the six-doc collapse could complete without deleting local work.
- Validation completed: `test "$(ls docs/*.md | wc -l)" = "6"` and `pnpm validate` passed.

### 2026-04-21 — M29 React Component Primitives And Chat Command Dispatch

- Added the first typed `apps/web/components/ui/` primitive layer with `Badge`, `Button`, `Card`, `Input`, `Select`, `PageHeader`, and `StatusChip`, keeping the existing CSS system as the source of truth instead of introducing a new design dependency.
- Switched `overlay-scene-canvas.tsx` to the guarded `Badge` primitive for widget/embed badges so empty or placeholder badge text is centrally suppressed.
- Wired Twitch IRC moderator commands into the existing moderation presence model: `!here`/`here` now update presence windows from chat, are restricted to moderator/broadcaster messages, and are consumed before viewer-facing chat overlay storage.
- Added unit coverage for the badge guard and chat-command parsing, and re-ran unit, validate, and browser smoke coverage after the worker/web changes.

### 2026-04-20 — M28 Phase 3 Audit Stabilization

- Added worker-side Twitch EventSub synchronization for follow/sub alert webhooks with duplicate detection and safe cleanup when alert runtime is disabled.
- Replaced the remaining on-air fallback string with "Coming up next" and covered it with focused overlay text tests.
- Marked M21-M27 complete after their implementation commits and documented the acceptance-audit caveats: EventSub requires the new OAuth scopes on reconnect, and safe-area clamping was still pending at that point.

### 2026-04-20 — M27 Container Reliability And Ops

- Added shared SSE connection tracking and included `sseConnections` in readiness output so web connection churn is observable.
- Extended the soak monitor to report container restart counts and fail on unexpected web/worker/playout restarts.
- Documented the current long-run memory and FD baseline in operations docs.

### 2026-04-20 — M26 UI Redesign V1

- Refreshed admin navigation into the Phase 3 IA groups while preserving existing routes.
- Added long-title safety and shared layout polish across the redesigned admin shell.
- Extended the admin smoke flow to cover Output and Overlays navigation.

### 2026-04-20 — M25 In-Stream Engagement Layer

- Added opt-in Twitch IRC chat ingest, engagement settings, `/api/overlay/events` SSE, and composited chat/alert overlay rendering.
- Added EventSub webhook receiving for follow/sub alerts and an Overlays admin section for runtime controls.
- Caveat closed by M28: webhook subscription registration is now automatic when the Twitch connection and public callback config are valid.

### 2026-04-20 — M24 Output Profiles And Stream Settings

- Added output profile persistence, admin controls, `STREAM_OUTPUT_WIDTH/HEIGHT/FPS`, viewport alignment, and optional FFmpeg scale/pad behavior.
- Updated overlay scaling for lower output heights and added persistence/runtime tests.
- Caveat at ship time: full safe-area container/clamping for arbitrary positioned layers was not yet implemented; resolved later in M31.

### 2026-04-20 — M23 Schedule Video-Level Visibility

- Added `videoSlots` lookahead to schedule preview and displayed expandable video timelines on the schedule page.
- Updated broadcast snapshot next-title behavior to prefer pool lookahead titles.

### 2026-04-20 — M22 Metadata V2 And Per-Video Edit

- Added per-asset metadata editing for title, title prefix, category, hashtags, notes, programming inclusion, and fallback priority.
- Extended targeted asset updates and Twitch title formatting tests to cover the new fields.

### 2026-04-20 — M21 Overlay Text Correctness

- Added title prefix, hashtag, and platform notes asset schema fields and preserved them through persistence.
- Fixed overlay next-title lookahead, Twitch title formatting, and empty/`[]` label rendering.
- Added focused overlay text and Twitch metadata tests.

### 2026-04-09 — M19.3 Main Artifact Publication Parity

- Tightened `.github/workflows/ci.yml` so successful `main` publishes now wait for GHCR to resolve the just-pushed `stream247-web`, `stream247-worker`, and `stream247-playout` `main-<sha>` tags before the run can complete green.
- Added release-readiness regression coverage that proves the `main` workflow still emits all three `main-<sha>` snapshot tags and verifies those exact rehearsal tags after publish.
- Verified the current `76a0ed0` publication shape from repo logic and GitHub Actions logs: the `main` publish path names and pushes `web`, `worker`, and `playout` under `main-76a0ed0`, and the workflow now fails if any of those refs are not registry-visible after push.
- Validation completed: `pnpm exec vitest run tests/unit/release-readiness.test.ts`, `pnpm validate`, and direct `docker manifest inspect` checks for `ghcr.io/drjakeberg/stream247-{web,worker,playout}:main-76a0ed0` passed.

### 2026-04-09 — M19.2 Release Rehearsal Pre-Tag Artifact Alignment

- Reworked `scripts/upgrade-rehearsal.sh` so unreleased target versions now resolve to the CI-published `main-<sha>` snapshot for the current commit, while already-published releases continue to rehearse against their `v*` tags and operators can still force an explicit image tag when needed.
- Reworked `release.yml` so tagged releases now pull, smoke-test, and promote the same `main-<sha>` snapshot artifacts instead of rebuilding new local candidates after the pre-tag rehearsal model has moved to commit snapshots.
- Tightened the release-readiness regression coverage so it now proves both unreleased-target rehearsal against `main-<sha>` and published-tag rehearsal against `v*`, while also asserting that the release workflow no longer rebuilds candidate images in the tag job.
- Validation completed: `pnpm exec vitest run tests/unit/release-readiness.test.ts`, `pnpm validate`, `pnpm release:preflight`, and `./scripts/upgrade-rehearsal.sh 1.1.0` passed.

### 2026-04-08 — M19.1 Release Artifact Parity And Proxy Restart Hardening

- Reworked `release.yml` so tagged publishes now retag and push the already-smoke-tested local candidate images instead of rebuilding from source after the smoke gate, which closes the remaining mutable-base and package-drift gap between rehearsal and release.
- Added `restart: unless-stopped` for `traefik` so the documented `docker compose --profile proxy up -d` deployment path now matches the restart guarantees described in the release and deployment docs.
- Tightened the release-readiness regression checks so they assert the workflow no longer uses `docker/build-push-action` for tagged publishing and that proxy-profile restart coverage includes `traefik`.
- Validation completed: `pnpm exec vitest run tests/unit/release-preflight.test.ts tests/unit/release-readiness.test.ts`, candidate `docker build` checks for `web`, `worker`, and `playout`, `./docker/smoke-test.sh stream247-web:release-candidate`, candidate-image `pnpm test:fresh-compose`, local retag parity checks for `web`, `worker`, and `playout`, and `pnpm validate` passed.

### 2026-04-08 — M19 Release Readiness Hardening

- Reworked the tagged release workflow so local release-candidate `web`, `worker`, and `playout` images are built and smoke-validated before any final versioned GHCR push step runs.
- Tightened `upgrade-rehearsal.sh` and `soak-monitor.sh` so both gates now require `/api/system/readiness` to report `broadcastReady=true` and a ready destination instead of treating those fields as informational only.
- Hardened `release-preflight.sh` so quoted and unquoted mutable `:latest` image refs fail equally, and added `restart: unless-stopped` to the documented always-on production Compose services.
- Validation completed: `pnpm exec vitest run tests/unit/release-preflight.test.ts tests/unit/release-readiness.test.ts`, `RELEASE_PREFLIGHT_ENV_FILE=<temp> RELEASE_PREFLIGHT_SKIP_VALIDATE=1 pnpm release:preflight`, candidate `docker build` checks for `web`, `worker`, and `playout`, `./docker/smoke-test.sh stream247-web:release-candidate`, candidate-image `pnpm test:fresh-compose`, and `pnpm validate` passed.

### 2026-04-05 — M0 Planning And Execution Guardrails

- Completed the planning baseline by creating `AGENTS.md`, `PLANS.md`, `IMPLEMENT.md`, and the initial audit/roadmap docs that were later superseded by the Phase 4 reset set.
- Marked these docs as the canonical execution surface for non-trivial work.
- Superseded the older gap-analysis path so there is one authoritative roadmap direction going forward.
- Validation completed: `pnpm validate` passed.

### 2026-04-05 — M1 Scene Studio Contract

- Added a canonical `Scene Studio` payload in `packages/core` so browser overlays, scene APIs, and worker/playout text consumers resolve from the same published scene contract.
- Updated broadcast and public channel snapshots to carry the active scene payload alongside the scene summary.
- Updated `/api/scenes` to return target-aware live and draft scene payloads, preserving the existing draft/live publish workflow.
- Kept the existing text-overlay path as the compatibility fallback while routing it through the new payload builder.
- Validation completed: `pnpm validate`, `pnpm test:fresh-db`, and `pnpm test:fresh-compose` passed.

### 2026-04-05 — M2 On-Air Scene Renderer V1

- Added an on-air scene renderer v1 in the worker that captures the published public overlay page headlessly and feeds transparent PNG frames into the FFmpeg playout path.
- Added a chromeless public overlay capture mode so the worker can render Scene Studio output without page background chrome.
- Preserved the existing FFmpeg text-overlay path as the compatibility fallback when Chromium capture is unavailable.
- Added worker-side helper coverage for scene capture URLs and Chromium invocation arguments.
- Validation completed: `pnpm validate`, `pnpm test:fresh-compose`, and `docker build -f docker/worker.Dockerfile -t stream247-worker:test .` passed.

### 2026-04-05 — M3 Queue Engine And Transition Controller

- Added deterministic queue helpers and persistent queue/transition state so operator queue surgery and scheduled advancement are visible in runtime state instead of being implicit worker behavior.
- Hardened local-library rotation with stable hashed asset ids, running-process-aware selection, and a bootstrap guard that no longer reseeds the database merely because the `users` table is empty.
- Added a dedicated `pnpm test:queue-continuity` smoke that boots a fresh compose stack, seeds a local-library pool/schedule, and proves short-asset queue advancement end to end.
- Validation completed: `pnpm validate`, `pnpm test:fresh-db`, `pnpm test:fresh-compose`, `pnpm test:queue-continuity`, `docker build -f docker/web.Dockerfile -t stream247-web:test .`, and `docker build -f docker/worker.Dockerfile -t stream247-worker:test .` passed.

### 2026-04-05 — M9 Security And Release Hardening

- Added optional TOTP-based two-factor authentication for local owner accounts, including setup, confirm, disable, and the second-step login challenge.
- Added browser smoke coverage for setup bootstrap, local 2FA login, Scene Studio publish, and broadcast action safety against a fresh Compose stack.
- Added structured worker runtime event logging plus release workflow gates for queue continuity, browser smoke, and release preflight before tagged images publish.
- Validation completed: `pnpm validate`, `pnpm test:fresh-db`, `pnpm test:fresh-compose`, `pnpm test:queue-continuity`, `pnpm test:e2e:smoke`, and `pnpm release:preflight` passed.

### 2026-04-06 — M9 Browser Smoke Stabilization

- Hardened grid panel layouts against long unbroken URLs and provisioning URIs so adjacent cards do not spill across click targets during headless browser runs.
- Updated the admin browser smoke to assert the published channel name where the public overlay actually renders it, instead of assuming it is the main overlay heading.
- Validation completed: `pnpm test:e2e:smoke` and `pnpm validate` passed.

### 2026-04-05 — M4 Programming Workspace V2

- Added explicit repeat-set metadata for schedule blocks so operators can create daily, weekday, weekend, or custom repeat behavior and safely update whole repeat sets from the editor.
- Added materialized programming previews that simulate pool rotation, insert rules, and natural durations to flag balanced windows, repeat risk, overflow, and empty blocks.
- Upgraded the schedule page, week overview, and timeline/editor surfaces so fill status, queue preview, and live runtime context are visible directly inside the Programming Workspace.
- Validation completed: `pnpm validate`, `pnpm test:fresh-db`, and `pnpm test:fresh-compose` passed.

### 2026-04-05 — M5 Library And Channel Blueprints

- Added folder and tag metadata to catalog assets, plus bulk library curation actions for folder assignment and tag management across the asset browser and asset detail surfaces.
- Extended the worker so local-library scans retain relative folder structure and remote sources land in stable source-scoped library folders without overwriting manual curation tags on re-ingest.
- Added opt-in `Channel Blueprints` export/import for Scene Studio, sources, programming, moderation, and destination metadata while intentionally excluding secrets, incidents, sync history, and media binaries.
- Validation completed: `pnpm validate`, `pnpm test:fresh-db`, and `pnpm test:fresh-compose` passed.

### 2026-04-05 — M6 Multi-Output V1

- Extended destination persistence with encrypted managed per-destination stream keys while preserving legacy env-key fallback for the built-in primary and backup outputs.
- Updated the worker to fan one channel out to multiple active RTMP outputs through health-aware primary/backup routing and tee-muxer delivery, without breaking the existing primary/backup compatibility path.
- Expanded the admin output management surfaces with destination creation, managed-key editing, delete protection for built-in outputs, and live visibility into the active output group.
- Validation completed: `pnpm validate`, `pnpm test:fresh-db`, and `pnpm test:fresh-compose` passed.

### 2026-04-05 — M7 Live Bridge

- Added a `Live Bridge` contract to the playout runtime so operators can hand off from scheduled playback to RTMP/RTMPS or HLS live inputs without breaking the existing Multi-Output path.
- Extended the worker queue/runtime so Live Bridge becomes a first-class on-air target with safe release back to the scheduled queue, preserved queue preview, and sanitized live-input visibility in the control room.
- Added broadcast actions, control-room UI, snapshot summaries, tests, and a targeted `pnpm test:live-bridge-smoke` check for the new takeover path.
- Validation completed: `pnpm validate`, `pnpm test:live-bridge-smoke`, `pnpm test:fresh-db`, and `pnpm test:fresh-compose` passed.

### 2026-04-05 — M8 Audio Lanes, Cuepoints, Advanced Inserts

- Added pool-scoped replace-mode audio lanes so scheduled playback can loop a dedicated local/direct media bed without affecting existing live, standby, reconnect, or insert paths.
- Added schedule-block cuepoint offsets plus deterministic runtime tracking so inserts arm after the configured offset and fire on the next safe asset boundary without refiring after worker cycles.
- Extended the broadcast snapshot, control room, blueprints, schedule editor, and programming previews so operators can see audio lane state and cuepoint progress directly in the UI.
- Validation completed: `pnpm validate`, `pnpm test:audio-cuepoint-smoke`, `pnpm test:fresh-db`, and `pnpm test:fresh-compose` passed.

### 2026-04-05 — M10 Truth And Safety Fixes

- Replaced stale full-row asset curation writes with targeted asset-catalog updates so operator edits no longer risk rolling back fresh ingest metadata such as titles, paths, and status.
- Replaced stale whole-source admin upserts with targeted source field updates across edit, bulk enable/disable, manual sync, and local-upload rescan flows so unrelated source state is preserved.
- Fixed update-center version discovery so `/settings` resolves the real repo package version from both repo-root and containerized working-directory layouts.
- Updated docs to stop implying full parity or a finished roadmap where the code is still partial.
- Validation completed: `pnpm validate` and `pnpm test:fresh-db` passed.

### 2026-04-06 — M11 Scene Studio V2

- Extended the canonical Scene Studio contract with built-in typography presets plus positioned text, logo, image, website-embed, and widget-embed layers that stay shared across browser and on-air consumers.
- Added additive overlay persistence for typography and positioned layers, updated blueprint/state wiring, and kept the publish/live draft workflow intact.
- Expanded the admin studio, public overlay renderer, and browser smoke so the new typography/layer controls are operator-visible and publish-safe.
- Updated conservative docs to stop claiming these richer layer types are still fully missing while keeping third-party embed limitations explicit.
- Validation completed: `pnpm validate`, `pnpm test:fresh-db`, `docker build -f docker/web.Dockerfile -t stream247-web:test .`, `docker build -f docker/worker.Dockerfile -t stream247-worker:test .`, `pnpm test:fresh-compose`, and `pnpm test:e2e:smoke` passed.

### 2026-04-06 — M12 Continuity And Recovery V2

- Reduced restart-heavy recovery behavior by staging recovered destinations outside the active output group until the next natural transition or an explicit operator recovery request.
- Added clearer multi-output operator visibility with per-destination recovery state, cooldown timing, retained failure attribution, and a dedicated `Recover outputs now` control.
- Kept Live Bridge and queue visibility intact while tightening destination recovery semantics in the worker and shared broadcast snapshots.
- Validation completed: `pnpm validate`, `pnpm test:multi-output-smoke`, `pnpm test:live-bridge-smoke`, `pnpm test:fresh-db`, `docker build -f docker/web.Dockerfile -t stream247-web:test .`, `docker build -f docker/worker.Dockerfile -t stream247-worker:test .`, `pnpm test:fresh-compose`, and `pnpm test:queue-continuity` passed.

### 2026-04-06 — M13 Library And Blueprints V2

- Added generated library thumbnails with deterministic metadata-card fallbacks, grouped asset browsing, and reusable curated sets with bulk membership actions across the admin catalog.
- Extended `Channel Blueprints` to include curated sets plus selective import sections, safer asset-reference remapping, and explicit warnings when referenced media is not present locally.
- Kept the existing replace-style import behavior available per enabled section while documenting that media files themselves never move with the blueprint.
- Validation completed: `pnpm validate`, `pnpm test:fresh-db`, and `pnpm test:fresh-compose` passed.

### 2026-04-06 — M14 Operator UX V2

- Grouped the admin workspace into `Control room`, `Programming`, and `Workspace` sections so `Broadcast`, `Dashboard`, `Library`, `Scene Studio`, and `Settings` have clearer operator roles without changing their routes.
- Updated hero copy and page framing across the primary admin surfaces so readiness, live control, media preparation, viewer-scene publishing, and workspace-wide settings are described consistently.
- Tightened sidebar, card, and mobile/tablet ergonomics, and expanded the browser smoke to prove the new operator IA before 2FA and Scene Studio publish actions continue.
- Validation completed: `pnpm validate`, `docker build -f docker/web.Dockerfile -t stream247-web:test .`, and `pnpm test:e2e:smoke` passed.

### 2026-04-06 — M15 Coverage And Release Proof V2

- Added a runtime parity smoke that boots a fresh Compose stack and proves Multi-Output fanout, replace-mode audio-lane playback, cuepoint inserts, and `Live Bridge` takeover/release with real playout outputs.
- Expanded the admin browser smoke and Compose harness so secondary-output creation is covered before the existing local 2FA and Scene Studio publish path.
- Added production-config release preflight gates to CI and release workflows after outer `pnpm validate`, and updated docs to state exactly which runtime/browser/release checks are now proven automatically.
- Validation completed: `pnpm test:runtime-parity`, `pnpm test:e2e:smoke`, `pnpm validate`, `pnpm test:fresh-compose`, and `pnpm release:preflight` passed.

### 2026-04-07 — M16.1 Schedule Gap Fixes

- Added shared schedule-occurrence helpers that keep `current`, `next`, and upcoming schedule selection anchored to the actual wall clock instead of falling back to the first block of the day.
- Updated web snapshots and worker standby-slate previews so programming gaps show no current block, keep the next teaser on the first future block, and stop wrapping the queue teaser back to earlier items after the final block.
- Added regression coverage for before-first-block gaps, mid-gap periods, and after-last-block behavior across schedule helpers and broadcast snapshots.
- Validation completed: `pnpm validate` and `pnpm test:fresh-compose` passed.

### 2026-04-07 — M16.2 Streaming Upload Hardening

- Replaced `arrayBuffer()`-based local-library ingest with streamed writes so large media files no longer need to be materialized fully in the web process before landing on disk.
- Hardened duplicate-name handling with exclusive file creation and retry-on-collision semantics so concurrent uploads do not overwrite each other when they target the same folder and filename.
- Added regression coverage that proves the upload path consumes chunked streams, never relies on `arrayBuffer()`, and preserves both files when duplicate names collide.
- Validation completed: `pnpm exec vitest run tests/unit/sources-api-safety.test.ts` and `pnpm validate` passed.

### 2026-04-07 — M16.3 Release Preflight Hardening

- Tightened release preflight validation so required production settings must be present, non-blank, and no longer match copied `.env.example` or `.env.production.example` placeholder values.
- Added an env-file override path for staged release checks, and made the Compose validation step follow that same selected env file instead of always reading the repository default `.env`.
- Added shell-level regression coverage for blank secrets, copied example env files, and a successful pinned production config, then updated operator docs to describe the stricter gate accurately.
- Validation completed: `pnpm exec vitest run tests/unit/release-preflight.test.ts`, `RELEASE_PREFLIGHT_ENV_FILE=<temp> RELEASE_PREFLIGHT_SKIP_VALIDATE=1 pnpm release:preflight`, and `pnpm validate` passed.

### 2026-04-08 — M16.4 Final Stabilization Fixes

- Reworked schedule next/upcoming selection to stay anchored to the actual wall clock instead of occurrence index order, which preserves daytime next-teasers when the current block crosses midnight.
- Added overnight regression coverage for helper selection plus broadcast snapshot behavior so web and worker standby consumers keep the correct upcoming block after `23:00-01:00` style schedules.
- Tightened release preflight again so quoted-empty required values fail like blank values, and Traefik proxy settings fail when they still carry documented example defaults.
- Validation completed: `pnpm exec vitest run tests/integration/schedule-preview.test.ts tests/unit/ops-state.test.ts tests/unit/release-preflight.test.ts`, `RELEASE_PREFLIGHT_ENV_FILE=<temp> RELEASE_PREFLIGHT_SKIP_VALIDATE=1 pnpm release:preflight`, `pnpm test:fresh-compose`, and `pnpm validate` passed.

### 2026-04-08 — M17 Scene Studio V2

- Added metadata-driven Scene Studio widgets for current, next, and queue-facing broadcast data so published scenes can display canonical snapshot data without relying on third-party iframes.
- Added conservative local font-stack overrides for positioned text layers with explicit fallback behavior; Stream247 still does not download remote fonts and only resolves font family names already present on the browser host or worker image.
- Tightened embed and browser-widget guidance so local paths are treated as the reliable self-hosted path, generic third-party frames are marked limited, and known unsupported YouTube/Twitch page URLs render as blocked placeholders instead of pretending to be supported.
- Validation completed: targeted `overlay-scenes` regression tests, `pnpm test:fresh-db`, `pnpm test:fresh-compose`, `pnpm test:e2e:smoke`, Docker image builds, and `pnpm validate` passed.

### 2026-04-08 — M17.1 Scene Studio V2 Follow-Up Fixes

- Preserved metadata-widget label fallback by keeping empty metadata titles empty during normalization, so the canonical current/next/later labels can appear whenever operators clear the manual override.
- Refined provider detection so dedicated YouTube embed URLs and `player.twitch.tv` endpoints stay available as limited browser-frame sources, while normal YouTube and Twitch page URLs remain blocked as unsupported Scene Studio frame sources.
- Restored an explicit terminal stop condition in `AGENTS.md` for the case where `PLANS.md` has no incomplete milestone remaining, and reconciled the gap-analysis missing-features list with the milestones already marked complete.
- Validation completed: `pnpm exec vitest run tests/unit/overlay-scenes.test.ts` and `pnpm validate` passed.

### 2026-04-08 — M17.2 Scene Studio V2 Final Follow-Up Fixes

- Updated fresh widget-layer defaults so switching a new widget into Scene data card mode no longer carries a placeholder label override; canonical `Now Playing`, `Next`, and `Later` labels can appear immediately unless the operator explicitly sets an override.
- Reclassified protocol-relative frame URLs as remote sources, so `//youtube...`, `//player.twitch.tv...`, and other protocol-relative providers now follow the same supported, limited, or unsupported boundary rules as absolute remote URLs.
- Validation completed: `pnpm exec vitest run tests/unit/overlay-scenes.test.ts tests/unit/overlay-settings-form.test.ts` and `pnpm validate` passed.

### 2026-04-08 — M18 Release Workflow Preflight Alignment

- Replaced the stale CI and tagged-release workflow pattern that copied `.env.production.example` directly into release preflight, because that workflow drifted out of sync with the stricter placeholder rejection already shipped in `scripts/release-preflight.sh`.
- Added `scripts/prepare-release-preflight-env.sh` so automation can derive a temporary non-placeholder env file from `.env.production.example` without weakening the production gate or changing operator-facing deployment guidance.
- Added regression coverage that proves the staged workflow env helper produces a release-preflight-safe env file and that the resulting file passes `pnpm release:preflight` with `RELEASE_PREFLIGHT_SKIP_VALIDATE=1`.
- Validation completed: `pnpm exec vitest run tests/unit/release-preflight.test.ts`, `RELEASE_PREFLIGHT_ENV_FILE="$(./scripts/prepare-release-preflight-env.sh)" RELEASE_PREFLIGHT_SKIP_VALIDATE=1 pnpm release:preflight`, and `pnpm validate` passed.

### 2026-04-08 — M18.1 Release Preflight Compose Env Alignment

- Updated `scripts/release-preflight.sh` so staged `RELEASE_PREFLIGHT_ENV_FILE` runs temporarily mirror the selected env file into the repo-root `.env` path only for the duration of `docker compose config`, then restore or remove that temporary file on exit.
- This keeps Compose validation aligned with the selected staged env file even when CI has no root `.env`, without weakening placeholder, quoted-empty, or proxy-example rejection in the earlier preflight checks.
- Added regression coverage for the missing-root-`.env` case, including a compose-validation path that now passes with the staged env file and a placeholder path that still fails before Compose validation can weaken the gate.
- Validation completed: `pnpm exec vitest run tests/unit/release-preflight.test.ts`, `backup_env="$(mktemp "${TMPDIR:-/tmp}/stream247-root-env-backup.XXXXXX")"; mv .env "$backup_env"; tmp_env="$(./scripts/prepare-release-preflight-env.sh)"; cleanup(){ rm -f "$tmp_env"; if [ -f "$backup_env" ]; then mv "$backup_env" .env; fi; }; trap cleanup EXIT; RELEASE_PREFLIGHT_ENV_FILE="$tmp_env" RELEASE_PREFLIGHT_SKIP_VALIDATE=1 pnpm release:preflight`, and `pnpm validate` passed.

### 2026-04-19 — M20.1 Twitch VOD Cache Prefetch

- Added cache metadata to asset persistence so Twitch VODs keep their original URL while the worker records verified local cache path, status, timestamp, and failure details.
- Added a Twitch VOD cache preparer that downloads archives into `MEDIA_LIBRARY_ROOT/.stream247-cache/twitch`, verifies them with `ffprobe`, excludes the internal cache from local-library scans, and lets queue/current prefetch use the local file.
- Changed playout selection so a Twitch VOD cache failure produces a warning incident and standby slate instead of direct remote archive playback unless remote fallback is explicitly enabled.
- Validation completed: `pnpm --filter db build`, `pnpm --filter worker build`, and `pnpm exec vitest run tests/unit/twitch-vod-cache.test.ts tests/integration/db-roundtrip.test.ts` passed.

### 2026-04-19 — M20.2 Persistent Relay Uplink

- Added a pinned MediaMTX relay service plus an `uplink` worker mode to production Compose so program playout publishes to the local relay while the uplink owns external primary/backup output delivery.
- Added relay-mode runtime wiring that keeps direct playout-to-destination output as a rollback path, moves scheduled 48-hour reconnects to the uplink, and records independent uplink heartbeat/process incidents.
- Extended release preflight, env examples, smoke coverage, and operator docs for `STREAM247_RELAY_ENABLED`, relay input/output URLs, and the pinned relay image.
- Validation completed: `pnpm exec vitest run tests/unit/ffmpeg-runtime.test.ts tests/unit/release-preflight.test.ts tests/unit/release-readiness.test.ts`, `docker compose --env-file <temp .env.example copy> config`, `docker build -f docker/web.Dockerfile -t stream247-web:test .`, `docker build -f docker/worker.Dockerfile -t stream247-worker:test .`, `pnpm test:fresh-compose`, and `pnpm validate` passed.

### 2026-04-19 — M20.3 Persistent Program Feed

- Replaced the default uplink input with a buffered local HLS program feed so normal asset boundaries no longer remove the stream that the external RTMP uplink reads.
- Kept the previous MediaMTX RTMP relay input as `STREAM247_UPLINK_INPUT_MODE=rtmp` rollback while preserving `STREAM247_RELAY_ENABLED=0` as the older direct-output rollback.
- Added persisted uplink/program-feed runtime state, readiness output, and soak-monitor checks for unplanned uplink restarts and stale feed state.
- Validation completed: `pnpm exec vitest run tests/unit/ffmpeg-runtime.test.ts tests/unit/release-readiness.test.ts`, `pnpm --filter db build`, `pnpm --filter worker build`, `pnpm --filter web typecheck`, `pnpm exec vitest run tests/integration/db-roundtrip.test.ts`, `pnpm validate`, and `RELEASE_PREFLIGHT_ENV_FILE=<prepared env> RELEASE_PREFLIGHT_SKIP_VALIDATE=1 pnpm release:preflight` passed.

### 2026-04-20 — M20.5 Program Feed Handoff Stability

- Hardened the local HLS program-feed handoff with temporary segment files, epoch-based segment numbers, and discontinuity markers, and made the uplink demuxer tolerate corrupt/discontinuous local feed packets.
- Classified clean asset/insert FFmpeg exits as natural playout boundaries instead of incidents, while keeping non-clean exits such as code `128` or `8` as structured per-asset failures with last stderr and sanitized input context.
- Updated readiness and the soak monitor so short local playout failures are tolerated only when the persistent uplink is running, the program feed is fresh, the destination is ready, and crash-loop protection is not active.
- Validation completed: `pnpm exec vitest run tests/unit/ffmpeg-runtime.test.ts tests/unit/release-readiness.test.ts`, `pnpm --filter worker build`, `pnpm --filter web typecheck`, and `pnpm validate` passed.

---

## Phase 5 — Product Reset & Redesign

Phase 5 executes the full product reset. It has two sub-phases: Phase 5A (M36–M42) corrects surface drift and hardens the text pipeline so the redesign has a clean foundation; Phase 5B (M43–M50) ships the redesign — new information architecture, planning UX, online-studio UX, design system, engagement model, live-status visibility, and final documentation.

Reference documents:
- `docs/product-reset-audit.md` — executive verdict, requirement-by-requirement audit, square-box pipeline map, deployment reality
- `docs/product-reset-target-state.md` — future product shape, four-workspace model, non-goals
- `docs/product-reset-kill-list.md` — remove/keep/replace verdicts, terminology migration table
- `docs/product-reset-ui-spec.md` — React-first design contract, canonical primitives, consistency rules
- `docs/product-reset-docs-plan.md` — final six-doc set, merge/delete sequence

**Operating rules for every Phase 5 milestone:**

- The repo holds source of code. Portainer on DT is the deployment control plane. DUT is the runtime validation target. Editing the local `docker-compose.yml` alone does not change production.
- Every milestone that changes a shipped image specifies (1) the new tag to pin in `.env.production.example`, (2) the Portainer stack update step on DT, (3) the DUT validation command(s), and (4) the rollback path.
- Every milestone states its non-goals. If a milestone is silent on something, that thing is out of scope.
- Route path strings are not committed ahead of M43. Milestones before M43 refer to workspaces (Live / Program / Studio / Admin), not URL paths.

| Milestone | Phase | Type | Status | Goal |
| --- | --- | --- | --- | --- |
| M36 | 5A | Feature fix | Complete | Text-pipeline hardening — strip invisible Unicode at write, read, and render |
| M37 | 5A | Feature fix | Complete | Navigation regression + orphaned Moderation surface |
| M38 | 5A | Feature | Complete | Moderation presence — full chatter + operator workflow with clamp feedback |
| M39 | 5A | Cleanup | Complete | Remove external-overlay legacy from copy + `noindex` the overlay route |
| M40 | 5A | Cleanup | Complete | Apply terminology migration table to all surface labels |
| M41 | 5A | UX | Complete | Consolidate playout actions on the Live surface; Dashboard becomes read-only |
| M42 | 5A | Docs | Complete | Quarantine Phase-4 planning artifacts out of `docs/` |
| M43 | 5B | UX | Complete | IA reset — four-workspace model in code, final route strings chosen |
| M44 | 5B | UX | Complete | Design-system rollout — `Tabs`, `EmptyState`, `Toast`, `Textarea` primitives |
| M45 | 5B | UX | Complete | Planning UX V2 — Program workspace with Week/Day/Now+Next lenses |
| M46 | 5B | UX | Complete | Online Studio UX V2 — Scene/Engagement/Output tabs, publish with diff |
| M47 | 5B | Feature | Complete | Engagement V2 — chatter-participation game with adaptive modes |
| M48 | 5B | UX | Complete | Live-status visibility upgrade — chip in sidebar + Live header |
| M49 | 5B | Docs | Complete | Docs finalization — collapse to the six-doc set |
| M50 | 5B | Ops | Complete | Portainer/DT rollout flow baked into `deployment.md` + stack-check script |

---

## M36 Text-Pipeline Hardening (Square-Box Fix)

**Goal**

Eliminate the square-box tofu glyphs in overlay text, chat output, and broadcast titles by sanitizing text at every pipeline layer — form input, DB write, DB read, API response, render — not just trimming whitespace.

**Scope**

- Add `stripInvisibleCharacters(value: string): string` to `packages/core/src/index.ts`. Strips zero-width characters (U+200B–U+200D), BOM (U+FEFF), C0/C1 control chars (U+0000–U+001F except `\n\t`; U+007F–U+009F), bidi overrides (U+202A–U+202E, U+2066–U+2069), soft hyphen (U+00AD). Applies NFC normalization. Preserves printable non-ASCII (emoji, CJK, accents).
- Replace `normalizeText` at `apps/web/app/api/assets/[id]/route.ts:19` (currently `.trim().slice()`) with a wrapper around `stripInvisibleCharacters` + length clamp.
- Apply the same sanitizer at the normalize-body helpers in the shows, pools, overlay, and sources API routes.
- Replace `visibleOverlayText` at `apps/web/components/overlay-scene-canvas.tsx:20` (currently `.trim()`) with `stripInvisibleCharacters`.
- Wrap `buildTwitchMetadataTitle` at `apps/worker/src/twitch-metadata.ts:21` with the sanitizer on every concatenated segment (prefix, title, category token, hashtags).
- Add regression coverage in `tests/unit/strip-invisible-characters.test.ts` covering U+200B/C/D, U+FEFF, U+0000–1F, U+007F–9F, U+202A–E, U+00AD, combining marks, emoji preservation, CJK preservation.
- Add focused route regressions plus a fresh-DB roundtrip proving polluted text is cleaned before persistence, title generation, and overlay rendering.

**Touched files**

- `packages/core/src/index.ts`
- `apps/web/app/api/assets/[id]/route.ts`
- `apps/web/app/api/shows/route.ts`
- `apps/web/app/api/pools/route.ts`
- `apps/web/app/api/overlay/route.ts`
- `apps/web/app/api/sources/route.ts`
- `apps/web/components/overlay-scene-canvas.tsx`
- `apps/worker/src/twitch-metadata.ts`
- `tests/unit/strip-invisible-characters.test.ts` (new)

**Acceptance**

- `stripInvisibleCharacters` exists in `packages/core` and is exported.
- All five API routes route text through it at write time.
- Overlay render sanitizes at display time.
- `buildTwitchMetadataTitle` produces strings with no invisible characters even when DB source contains them (legacy data safety).
- Unit tests cover every invisible category and assert normalized NFC output.
- Focused route regressions plus the fresh-DB roundtrip prove the full pipeline is clean end-to-end.

**Validation**

```bash
pnpm exec vitest run tests/unit/strip-invisible-characters.test.ts
pnpm exec vitest run tests/integration/
pnpm validate
```

**DUT validation**

- Push seed asset titles containing every control-char category to DUT via `/api/assets`.
- Capture overlay frames via existing Chromium capture path.
- Assert no tofu glyphs in captured frames; assert title in Twitch API reflects the sanitized string.

**Portainer/DT rollout**

- Build web + worker images, push to `ghcr.io/drjakeberg/stream247-{web,worker}:v1.6.0-M36`.
- Pin tag in `.env.production.example`.
- Redeploy Portainer-managed stack on DT.
- Run seed-title DUT validation before promoting to production.

**Rollback**

- Revert tag in `.env.production.example` to previous release; redeploy previous stack in Portainer.

**Non-goals**

- No font swap to address glyph-set gaps.
- No on-air banner changes.
- No historical-data backfill sweep; the render-layer sanitizer handles legacy rows on display.

**Progress notes**

- Completed with centralized invisible-character stripping in core, route-level write sanitization on assets/shows/pools/overlay/sources, DB normalization for overlay preset and asset metadata writes, render-time overlay cleanup, and Twitch/overlay title-path sanitization.
- Validation completed: `pnpm exec vitest run tests/unit/strip-invisible-characters.test.ts tests/unit/twitch-metadata.test.ts tests/unit/assets-api-safety.test.ts tests/unit/sources-api-safety.test.ts tests/unit/overlay-scenes.test.ts`, `pnpm exec vitest run tests/integration/`, and `pnpm validate` passed.

---

## M37 Navigation Regression And Orphaned Moderation Surface

**Goal**

Fix the three concrete nav defects: `<a href>` in `admin-navigation.tsx:20` (drops SSE on every click), the dead `/ops` redirect, and the Moderation surface not being reachable from the sidebar.

**Scope**

- Convert every internal link in `apps/web/components/admin-navigation.tsx` from `<a href>` to `next/link` `<Link>`.
- Delete `apps/web/app/(admin)/ops/page.tsx` and remove any nav entry still pointing at `/ops`.
- Surface the Moderation page in the sidebar (temporary placement; final placement under the Live workspace happens in M43).
- Update the nav-link CSS block in `apps/web/app/globals.css` so long labels wrap (`word-break: break-word`, two-line clamp) instead of truncating with `text-overflow: ellipsis`.

**Touched files**

- `apps/web/components/admin-navigation.tsx`
- `apps/web/lib/admin-navigation.ts`
- `apps/web/app/(admin)/ops/page.tsx` (delete)
- `apps/web/app/globals.css`

**Acceptance**

- No `<a href="/…">` for internal routes anywhere in `apps/web/components/admin-navigation.tsx`.
- `/ops` route no longer exists; any lingering link targeting it is removed.
- Sidebar contains a visible Moderation entry.
- Long label "Moderation Presence Window" wraps to two lines in the sidebar at default width; no ellipsis.
- SSE event counter on `/api/broadcast/stream` does not reset when clicking between nav items.

**Validation**

```bash
pnpm validate
pnpm --filter web build
```

**DUT validation**

- Open the admin app on DUT.
- Subscribe to `/api/broadcast/stream` in a side tab; click every sidebar entry; confirm event counter is continuous.
- Confirm Moderation is reachable from the sidebar.

**Portainer/DT rollout**

- Build web image; tag `v1.6.0-M37`; pin in `.env.production.example`; redeploy Portainer stack; smoke-check SSE persistence after deploy.

**Rollback**

- Revert tag; redeploy previous stack.

**Non-goals**

- No IA rename. Workspace consolidation is M43.
- No redesign of individual pages. This milestone is a regression fix.

---

## M38 Moderation Presence — Full Operator + Chatter Flow

**Goal**

Close the feedback gap on `!here`. The parser at `apps/worker/src/twitch-engagement.ts:70` and `parseModeratorCheckIn` at `packages/core/src/index.ts:1782` already clamp requested values to the configured `min`/`max`/`default`. Today the clamp is silent — operators and chatters never know why `!here 5` produced a 10-minute window. This milestone makes the clamp visible across chat, the Live workspace, the Moderation page, and the settings form.

**Scope — chatter flow**

- When a moderator runs `!here` or `!here N`, the IRC bridge sends a chat reply confirming the resulting window. If the requested value was clamped, the reply explains the clamp explicitly: `"received !here 5, minimum is 10 — window set to 10 min"`. If the value was accepted as-is: `"presence window set to 30 min"`.
- Reply text is generated by a pure helper in `packages/core` (new `formatPresenceClampReply`) so it is unit-testable without the IRC bridge.

**Scope — operator UI**

- Live workspace header shows a presence chip (`StatusChip`) while a window is active. Chip shows remaining minutes; clicking it opens the Moderation detail page.
- Moderation page shows active + recent windows with three columns: *requested value*, *applied value*, *clamp reason*.
- Moderation settings form exposes `min`, `max`, `default` with inline helper text describing the clamp rule.
- Sidebar badge shows a dot when a window is active.

**Scope — docs**

- `docs/moderation-policies.md` gets a subsection stating: the exact clamp rule, the IRC reply format, the min/max/default semantics, how to change them.

**Touched files**

- `apps/worker/src/twitch-engagement.ts` (call new reply helper + send IRC message)
- `packages/core/src/index.ts` (add `formatPresenceClampReply`; keep `parseModeratorCheckIn` unchanged)
- `apps/web/components/moderation-settings-form.tsx`
- `apps/web/app/(admin)/moderation/page.tsx`
- `apps/web/components/admin-navigation.tsx` (sidebar dot)
- `apps/web/app/(admin)/broadcast/page.tsx` (or wherever the Live header renders — presence chip)
- `tests/unit/engagement.test.ts` (extend)
- `tests/unit/format-presence-clamp-reply.test.ts` (new)
- `docs/moderation-policies.md`

**Acceptance**

- `!here 5` with min=10 produces chat reply mentioning the clamp; DB window is 10 minutes.
- `!here 30` with min=10/max=60 produces chat reply confirming 30 minutes; no clamp language.
- `!here 9999` with max=60 produces chat reply mentioning the max-clamp; DB window is 60 minutes.
- Moderation page shows requested vs applied values for each of the above.
- Sidebar dot and Live header chip reflect the active window in real time.
- Settings form explains the clamp rule inline.
- `docs/moderation-policies.md` describes the clamp rule and the reply format.

**Validation**

```bash
pnpm exec vitest run tests/unit/engagement.test.ts tests/unit/format-presence-clamp-reply.test.ts
pnpm validate
```

**DUT validation**

- IRC test harness sends `!here`, `!here 1`, `!here 9999`, `!here 10` against the DUT bot; assert chat reply strings and DB window values.
- Operator walkthrough on DUT: confirm chip + Moderation page + sidebar dot reflect each window.

**Portainer/DT rollout**

- Build web + worker; tag `v1.6.0-M38`; pin in `.env.production.example`; redeploy Portainer stack; soak `!here` harness on DUT before production promote.

**Rollback**

- Revert tag; redeploy previous stack. Chat replies stop; clamp behavior reverts to silent but functionally unchanged.

**Non-goals**

- No new chat commands beyond `!here`.
- No automation changes triggered by presence state.
- No Twitch API calls to auto-set chat mode during presence (separate future milestone if pursued).

---

## M39 External-Overlay Legacy Removal

**Goal**

Remove every trace of the "external overlay / browser source / third-party stream embed" framing from copy and search indexing. Align the overlay's product-surface language with the target-state statement: *the overlay is internal output for Stream247's own 24/7 broadcast*.

**Scope**

- Strip "external", "browser source", "third-party", and "OBS source" phrasing from admin copy, Studio descriptions, and onboarding text.
- Update `docs/legacy-removal-list.md` — the explicit "external stream overlay" language at `docs/legacy-removal-list.md:111` is rewritten or the file is merged and deleted per M42.
- Add `noindex` meta to the `/overlay` route's layout and set the HTTP response header `X-Robots-Tag: noindex` on `/overlay` and `/overlay?chromeless=1`.
- Add the explicit internal-overlay statement to `README.md` product description.

**Touched files**

- `apps/web/app/overlay/layout.tsx` (or equivalent)
- `apps/web/app/overlay/page.tsx`
- `apps/web/middleware.ts` (or response-header wiring) for `X-Robots-Tag`
- `docs/legacy-removal-list.md` (updated or deleted)
- `README.md`
- Various UI copy files touched by grep for the old phrasing

**Acceptance**

- `curl -I http://<dut>/overlay` returns `X-Robots-Tag: noindex` in the response.
- `curl http://<dut>/overlay` HTML contains `<meta name="robots" content="noindex">`.
- `grep -ri "external overlay\|browser source\|third-party" apps/web docs` returns zero hits (or only the product-reset docs where the migration is explained).
- Chromium capture still renders `/overlay?chromeless=1` correctly.
- `README.md` contains the one-sentence internal-overlay statement.

**Validation**

```bash
pnpm --filter web build
pnpm validate
```

**DUT validation**

- `curl -I` the overlay URL on DUT; assert header.
- View-source on `/overlay`; assert meta.
- Restart Chromium capture; confirm overlay still renders and frame pipeline is unaffected.

**Portainer/DT rollout**

- Build web image; tag `v1.6.0-M39`; pin; redeploy.

**Rollback**

- Revert tag; redeploy previous stack. Headers revert.

**Non-goals**

- No URL change for `/overlay`.
- No capture flow change.

---

## M40 Surface-Language Terminology Cleanup

**Goal**

Apply the terminology migration table from `docs/product-reset-kill-list.md` to every surface label, section header, `PageHeader` title, form label, button label, and doc copy string. Route paths do not move in this milestone — that's M43.

**Scope — replace, in UI copy only**

- "Broadcast" / "Dashboard" (nav labels) → "Live" — applied to sidebar labels, page titles, and copy referring to the live surface collectively.
- "Overlays" (nav label for chat/alerts) → "Engagement" — in the sidebar and any internal references.
- "Scene Studio" / "Overlay Studio" labels → "Scene" — as a tab name once tabs land in M44; as a label prior.
- "Stream Studio" (section header) → "Studio".
- "Workspace" (section header) → "Admin".
- "Programming" (section header) → "Program".
- "in-stream overlay" / "browser source" (already covered partially by M39) → "overlay".
- "pool block" → "schedule block" (where the reference is to a block on the schedule).
- "Go Live Checklist" vs "readiness" — unify on "Readiness".
- "presence window" / "mod presence" / "!here window" — unify on "Moderation presence".

**Touched files**

- `apps/web/lib/admin-navigation.ts` (section labels; routes unchanged)
- `apps/web/components/admin-navigation.tsx` (rendered labels)
- Every `PageHeader` usage in `apps/web/app/(admin)/**/page.tsx`
- Form label strings across the admin app
- `docs/architecture.md`, `docs/deployment.md`, `docs/operations.md`, `docs/moderation-policies.md`, `docs/twitch-setup.md`

**Acceptance**

- `grep -ri "Stream Studio\|Workspace (section)\|Programming (section)" apps/web` returns zero hits.
- Sidebar reads `Live`, `Program`, `Studio`, `Admin` as top-level labels (grouping remains; workspace consolidation is M43).
- Docs use the new terms consistently.

**Validation**

```bash
pnpm --filter web build
pnpm validate
```

**DUT validation**

- Visual walkthrough of every admin page on DUT.
- Screenshot compare vs pre-M40 baseline; only label strings should differ.

**Portainer/DT rollout**

- Build web image; tag `v1.6.0-M40`; pin; redeploy.

**Rollback**

- Revert tag; redeploy previous stack.

**Non-goals**

- No route rename. Routes move in M43.
- No IA consolidation. Workspaces consolidate in M43.
- No layout or content changes. Copy only.

---

## M41 Broadcast/Dashboard Control Consolidation

**Goal**

Remove the duplicate playout action forms from `/dashboard` so `/broadcast` is the single surface with live actions. `/dashboard` becomes read-only status. No route rename in this milestone — that's M43's job.

**Scope**

- Remove skip/override/restart/fallback/insert form components from `/dashboard`; replace with status-only rendering.
- Keep all incident and drift content on `/dashboard` (the Operations consolidation from M34 stands).
- Ensure `/broadcast` is the only surface with action buttons that mutate playout state.

**Touched files**

- `apps/web/app/(admin)/dashboard/page.tsx`
- Any control-form component imports that become unused (delete cleanly; no re-export stubs)

**Acceptance**

- `/dashboard` renders no `<form>` or action button that calls a playout-mutation endpoint.
- `/broadcast` retains all five action categories.
- No operator workflow requires visiting `/dashboard` to act on the stream.

**Validation**

```bash
pnpm --filter web build
pnpm validate
```

**DUT validation**

- Operator performs one go-live and one pause on DUT via `/broadcast`; confirm `/dashboard` shows the new state as status only.

**Portainer/DT rollout**

- Build web image; tag `v1.6.0-M41`; pin; redeploy.

**Rollback**

- Revert tag; redeploy previous stack.

**Non-goals**

- No redesign of either page layout. Layout redesign lives in M43/M44.
- No IA change.

---

## M42 Quarantine Phase-4 Planning Artifacts

**Goal**

Move the five Phase-4 planning artifacts out of `docs/` so the product doc set is not mixed with superseded plans. Files go to `docs/archive/` until M49 deletes them outright.

**Scope**

- Move `docs/full-product-reset-audit.md`, `docs/full-product-reset-plan.md`, `docs/legacy-removal-list.md`, `docs/docs-reset-plan.md`, `docs/ui-redesign-spec.md` to `docs/archive/`.
- Update `README.md` doc list to reflect the new structure.
- Update any cross-links that reference the moved files.

**Touched files**

- `docs/archive/` (new directory)
- `docs/full-product-reset-audit.md` → `docs/archive/full-product-reset-audit.md`
- `docs/full-product-reset-plan.md` → `docs/archive/full-product-reset-plan.md`
- `docs/legacy-removal-list.md` → `docs/archive/legacy-removal-list.md`
- `docs/docs-reset-plan.md` → `docs/archive/docs-reset-plan.md`
- `docs/ui-redesign-spec.md` → `docs/archive/ui-redesign-spec.md`
- `README.md`

**Acceptance**

- Top level of `docs/` contains only current product docs + the five product-reset files (which themselves are scheduled for M49 absorption).
- `docs/archive/` contains the five moved files.
- No dead cross-links.

**Validation**

```bash
pnpm validate
```

**DUT validation**

- None (docs-only).

**Portainer/DT rollout**

- None (docs-only).

**Non-goals**

- No content rewrite. This is a move, not an edit.
- No new docs.

---

## M43 IA Reset — Workspace Model In Code

**Goal**

Commit the four-workspace information architecture from `docs/product-reset-target-state.md` to code. This is where final route path strings are chosen and recorded.

**Scope**

- Rewrite `apps/web/lib/admin-navigation.ts` as four workspace entries: Live, Program, Studio, Admin.
- Create the workspace route shells. Final path strings (for example `/live` vs `/broadcast`, `/program` vs `/schedule`, `/studio` vs `/overlay-studio`, `/admin` vs `/settings`) are chosen during implementation and recorded in an addendum at the end of `docs/product-reset-target-state.md`.
- Set up redirects from every old route to the new workspace + internal tab.
- Keep old routes aliased for one soak cycle before deletion (cleanup milestone after M50, or folded into M49).
- Apply the `Tabs` primitive from M44 as it lands — M43 can ship the shell even with interim tab styling if M44 is not yet complete.

**Touched files**

- `apps/web/lib/admin-navigation.ts`
- `apps/web/app/(admin)/layout.tsx`
- New workspace page files (paths decided at implementation)
- Route redirects via `next.config.js` or route-level `redirect()`
- `docs/product-reset-target-state.md` (addendum recording final paths)

**Acceptance**

- Four workspace entries in the sidebar; no other top-level entries.
- Every old admin URL redirects to its new workspace + tab.
- SSE subscription survives workspace switches.
- Final path strings recorded in target-state addendum.

**Validation**

```bash
pnpm --filter web build
pnpm validate
```

**DUT validation**

- Operator walkthrough on DUT: visit every old URL; confirm redirect to new workspace; confirm tab selection is correct.
- SSE event counter on `/api/broadcast/stream` stays continuous through workspace switches.

**Portainer/DT rollout**

- Build web image; tag `v1.6.0-M43`; pin; redeploy; soak for at least 24h with redirects live before deleting aliases.

**Rollback**

- Revert tag; redeploy previous stack. Old routes still serve pre-M43 surfaces.

**Non-goals**

- No internal layout redesign. Layouts inside workspaces can remain pre-reset shapes until M44–M46 land.
- No primitive changes. Primitives roll out in M44.
- No data-model changes.

---

## M44 Design-System Rollout

**Goal**

Add the four new primitives (`Tabs`, `EmptyState`, `Toast`, `Textarea`) specified in `docs/product-reset-ui-spec.md`, then apply them incrementally starting with the Program workspace.

**Scope**

- Create `apps/web/components/ui/Tabs.tsx` — keyboard-accessible, URL-synced, visually distinct from sidebar.
- Create `apps/web/components/ui/EmptyState.tsx` — title + body + optional primary action slot.
- Create `apps/web/components/ui/Toast.tsx` — stacked top-right, auto-dismiss, accessible live region.
- Create `apps/web/components/ui/Textarea.tsx` — same label/helper/error shape as `Input`.
- Document each in `docs/product-reset-ui-spec.md`.
- Apply to the Program workspace first as the reference adoption.
- Set up Playwright screenshot baselines for the Program workspace after the design-system pass.

**Touched files**

- `apps/web/components/ui/Tabs.tsx` (new)
- `apps/web/components/ui/EmptyState.tsx` (new)
- `apps/web/components/ui/Toast.tsx` (new)
- `apps/web/components/ui/Textarea.tsx` (new)
- `apps/web/app/(admin)/program/**` (primitive adoption)
- `docs/product-reset-ui-spec.md`
- `tests/e2e/program-screenshot.spec.ts` (new)

**Acceptance**

- Four new primitives exist and are documented.
- Program workspace uses all four where applicable.
- Screenshot baseline captures the Program workspace's clean state.

**Validation**

```bash
pnpm --filter web build
pnpm exec playwright test tests/e2e/program-screenshot.spec.ts
pnpm validate
```

**DUT validation**

- Playwright screenshot compare against DUT-rendered Program workspace.

**Portainer/DT rollout**

- Build web image; tag `v1.6.0-M44`; pin; redeploy.

**Rollback**

- Revert tag; redeploy previous stack.

**Non-goals**

- No wholesale rewrite of every form. Adoption is incremental across M44–M46.
- No new primitives beyond the four listed.

---

## M45 Planning UX V2

**Goal**

Ship the Program workspace per `docs/product-reset-target-state.md` and `docs/product-reset-ui-spec.md`. Three lenses (Week, Day, Now+Next). Video-level default. Structured Replay toggle, hashtag chip input, category `Select`.

**Scope**

- Program workspace with three internal tabs (Week / Day / Now+Next), all using the `Tabs` primitive.
- Week lens: seven-day grid; each block shows its first resolved video via `lookaheadVideoTitleFromPool` at `packages/core/src/index.ts:1943`; expandable to reveal the full video sequence.
- Day lens: vertical timeline; every asset slot shown with runtime, category, Replay flag.
- Now+Next lens: currently playing + next two + fallback chain; matches Live header chip.
- Inline per-video metadata drawer: Replay boolean toggle, hashtag chip input (no JSON), category `Select` bound to show profile, notes `Textarea`.
- Worker composes broadcast title from the Replay flag via `buildTwitchMetadataTitle` at `apps/worker/src/twitch-metadata.ts:21` — UI never handles the `"Replay: "` prefix literally.
- Next-item resolution is real; nil resolutions render `EmptyState` with a fix link.

**Touched files**

- `apps/web/app/(admin)/program/week/page.tsx` (or equivalent)
- `apps/web/app/(admin)/program/day/page.tsx`
- `apps/web/app/(admin)/program/now-next/page.tsx`
- `apps/web/components/schedule-block-editor.tsx`
- `apps/web/components/asset-metadata-drawer.tsx` (new or consolidated)
- `apps/web/components/hashtag-chip-input.tsx` (new)
- `apps/worker/src/twitch-metadata.ts` (verify Replay composition)
- `packages/core/src/index.ts` (verify `lookaheadVideoTitleFromPool` wiring)

**Acceptance**

- All three lenses exist, reachable via tabs.
- Video-level granularity is the default view in every lens.
- Hashtag input is chip-based; no raw JSON.
- Replay is a toggle; broadcast title composition happens in the worker.
- Category is a `Select` bound to the show profile.
- "Next" resolution shows a real title end-to-end (overlay + chat + Twitch title).

**Validation**

```bash
pnpm exec vitest run tests/unit/
pnpm --filter web build
pnpm --filter worker build
pnpm validate
```

**DUT validation**

- Seed a schedule on DUT with multiple pools, a Replay asset, and hashtags.
- Confirm Week lens shows correct first-resolved title per block.
- Confirm broadcast title has `Replay: <title>` prefix and no invisible characters (validates M36 + M45 together).
- Confirm hashtags reach Twitch title and chat without becoming JSON noise.

**Portainer/DT rollout**

- Build web + worker; tag `v1.6.0-M45`; pin; redeploy.

**Rollback**

- Revert tag; redeploy previous stack. Program workspace reverts to M44 shell.

**Non-goals**

- No change to pool rotation algorithm.
- No calendar export.
- No multi-week template features beyond what exists.

---

## M46 Online Studio UX V2

**Goal**

Ship the Studio workspace per `docs/product-reset-target-state.md` and `docs/product-reset-ui-spec.md`. Three tabs (Scene / Engagement / Output). One publish action with diff preview. Emergency banner prominent on Scene.

**Scope**

- Studio workspace with three tabs via `Tabs` primitive.
- Scene tab: layer-based overlay editor; safe-area boundaries visible at 5% inset; per-layer "allow outside safe area" toggle.
- Publish flow: "Review changes" → diff modal (added/removed/changed layers, text, positions) → confirm publishes.
- Emergency banner toggle is top-right on the Scene tab; active state = red border on workspace header.
- Engagement tab: chat overlay settings, follow/sub/cheer/channel-points alert settings, chatter-participation game settings (UI scaffolding only; behavior in M47).
- Output tab: output profile `Select`, destination list, per-destination output profile override, `StatusChip` for destination health.
- Collapse the duplicate engagement-settings surface that currently exists across `/overlays` and the chat-settings form.

**Touched files**

- `apps/web/app/(admin)/studio/scene/page.tsx`
- `apps/web/app/(admin)/studio/engagement/page.tsx`
- `apps/web/app/(admin)/studio/output/page.tsx`
- `apps/web/components/scene-publish-dialog.tsx` (new)
- `apps/web/components/emergency-banner-toggle.tsx`
- `apps/web/components/engagement-settings-form.tsx`
- `apps/web/components/destination-output-profile-form.tsx` (already exists; integrate)

**Acceptance**

- Studio has exactly three tabs.
- Publish always shows a diff; no one-click publish without review.
- Emergency banner toggle reaches the overlay in under 5s.
- Engagement settings live in one place only.
- Output tab shows per-destination health chips.

**Validation**

```bash
pnpm exec vitest run tests/unit/
pnpm --filter web build
pnpm validate
```

**DUT validation**

- Publish a draft scene on DUT; confirm Chromium capture picks up the change.
- Toggle emergency banner; measure time-to-overlay; assert under 5s.
- Edit engagement settings; confirm overlay reflects changes.

**Portainer/DT rollout**

- Build web image; tag `v1.6.0-M46`; pin; redeploy.

**Rollback**

- Revert tag; redeploy previous stack.

**Non-goals**

- No new scene primitives (text/image/logo/embed set is unchanged).
- No new output profiles.
- No new destination types.

---

## M47 Engagement + Interaction Model V2

**Goal**

Ship the chatter-participation game per `docs/product-reset-target-state.md`. Three adaptive modes driven by active-chatter count: solo, small-group, crowd. Single configuration surface in Studio → Engagement. Overlay rendering alongside chat and alerts.

**Scope**

- Add active-chatter rolling-window tracker in `apps/worker/src/twitch-engagement.ts`. Window length configurable; default 10 minutes.
- Mode selector: ≈1 chatter → solo; 2–10 → small-group; 10+ → crowd. Hysteresis to prevent flapping.
- Solo mode: call-and-response prompts, reactive emote challenges.
- Small-group mode: emoji-vote prompts, lightweight prediction rounds.
- Crowd mode: voting / prediction / trivia with on-overlay aggregation.
- Engagement overlay renders game state alongside chat and alerts.
- Settings UI in Studio → Engagement: enable/disable, per-mode toggles, window length.

**Touched files**

- `apps/worker/src/twitch-engagement.ts`
- `apps/worker/src/engagement-game.ts` (new)
- `apps/web/components/engagement-overlay.tsx`
- `apps/web/components/engagement-settings-form.tsx`
- `packages/core/src/index.ts` (active-chatter window logic, pure helpers)
- `tests/unit/engagement-game.test.ts` (new)

**Acceptance**

- Mode switches correctly at boundaries with hysteresis.
- Overlay renders each mode's widget inside safe area.
- Settings form controls all three modes independently.
- Game does not interfere with existing chat overlay or alerts.

**Validation**

```bash
pnpm exec vitest run tests/unit/engagement-game.test.ts
pnpm --filter web build
pnpm --filter worker build
pnpm validate
```

**DUT validation**

- IRC harness on DUT simulates 1, 5, 15, 30 chatters over a 30-minute window.
- Confirm mode switches occur at documented thresholds.
- Capture overlay frames; confirm game widget renders correctly in each mode.

**Portainer/DT rollout**

- Build web + worker; tag `v1.6.0-M47`; pin; redeploy.

**Rollback**

- Revert tag; redeploy previous stack. Engagement overlay reverts to pre-M47 behavior (chat + alerts only).

**Non-goals**

- No custom per-stream game scripting.
- No external game platform integration.
- No changes to existing follow/sub/cheer/channel-points alerts.

---

## M48 Live-Status Visibility Upgrade

**Goal**

Make Twitch channel live state visible in every operator surface. Sidebar chip + Live workspace header chip. Video preview is explicitly deferred.

**Scope**

- Sidebar shows `StatusChip` for Twitch live status (live / offline / unknown).
- Live workspace header shows live + uptime + viewer count.
- Playout live status remains a separate chip (is the worker playing content right now?).
- State flows from existing polling at `apps/worker/src/twitch-live-status.ts` through the existing SSE feed.
- Deferred-decision rationale captured in a subsection of `docs/product-reset-target-state.md`: an embedded Twitch player is bandwidth-heavy, it flashes the operator's own viewership, and an overlay snapshot is not a substitute. Revisit only against measured operator need.

**Touched files**

- `apps/web/components/admin-navigation.tsx` (sidebar chip)
- `apps/web/app/(admin)/live/page.tsx` (or whichever route lands as Live after M43)
- `apps/worker/src/twitch-live-status.ts` (verify emit shape)
- `docs/product-reset-target-state.md` (deferred-decision rationale)

**Acceptance**

- Sidebar chip updates within 30s of a Twitch live state change.
- Live header shows live/offline + uptime + viewer count.
- Polling source is unchanged.

**Validation**

```bash
pnpm --filter web build
pnpm validate
```

**DUT validation**

- Go live on the DUT-connected Twitch channel; confirm sidebar chip flips within 30s.
- End the stream; confirm chip flips back.

**Portainer/DT rollout**

- Build web image; tag `v1.6.0-M48`; pin; redeploy.

**Rollback**

- Revert tag; redeploy previous stack.

**Non-goals**

- No small video preview. Explicitly deferred.
- No viewer analytics dashboard.

---

## M49 Docs Finalization

**Goal**

Collapse Phase-4 and Phase-5 documentation artifacts into the final six-doc set defined in `docs/product-reset-docs-plan.md`. Delete the artifacts.

**Scope**

- Merge the permanent parts of `docs/product-reset-target-state.md` (overlay-is-internal statement, non-goals list, four-workspace model) into `architecture.md` and `README.md`.
- Merge the terminology migration table from `docs/product-reset-kill-list.md` into `ui.md` as a "canonical terms" section.
- Rename `docs/product-reset-ui-spec.md` → `docs/ui.md`. Delete the old `docs/ui-redesign-spec.md` when `ui.md` lands.
- Delete `docs/product-reset-audit.md`, `docs/product-reset-target-state.md`, `docs/product-reset-kill-list.md`, `docs/product-reset-docs-plan.md`, and everything in `docs/archive/` (the five Phase-4 artifacts moved in M42).
- Final `docs/` listing: `architecture.md`, `deployment.md`, `moderation-policies.md`, `operations.md`, `twitch-setup.md`, `ui.md`.
- Verification step: `ls docs/*.md` returns exactly those six files.

**Touched files**

- `docs/architecture.md` (content additions)
- `docs/ui.md` (renamed from `docs/product-reset-ui-spec.md`; content additions)
- `README.md` (final product description)
- Deletions: `docs/product-reset-audit.md`, `docs/product-reset-target-state.md`, `docs/product-reset-kill-list.md`, `docs/product-reset-docs-plan.md`, `docs/ui-redesign-spec.md`, `docs/archive/*`

**Acceptance**

- `docs/` contains exactly six `.md` files, all named per the plan.
- No load-bearing content was lost; each deleted file's content either lives in a permanent doc or was ephemeral planning.
- `README.md` contains the internal-overlay statement.
- No dead cross-links in the repo.

**Validation**

```bash
test "$(ls docs/*.md | wc -l)" = "6"
pnpm validate
```

**DUT validation**

- None (docs-only).

**Portainer/DT rollout**

- None (docs-only).

**Non-goals**

- No new doc topics.
- No content rewrites beyond the specific merges listed.

---

## M50 Portainer/DT Rollout Flow + Stack-Check Script

**Goal**

Bake the "repo → GHCR → Portainer on DT → DUT soak → production promote" flow into `deployment.md` as the canonical deployment rhythm. Add a script that verifies the running Portainer stack's image digests match `.env.production.example`.

**Scope**

- Write the full deployment flow in `deployment.md` as a step-by-step procedure operators follow for every release. Includes: build via CI on `v*` tag push, image digests in GHCR, Portainer stack update on DT, `.env.production.example` pin, DUT validation commands, production promote, rollback steps.
- Add `scripts/portainer-stack-check.sh` that reads the running Portainer stack's image digests (via Portainer API with read-only credentials) and asserts they match the pinned tags in `.env.production.example`. Reports a pass/fail summary.
- Script is read-only. It does not call any deploy-changing endpoint.

**Touched files**

- `docs/deployment.md`
- `scripts/portainer-stack-check.sh` (new)

**Acceptance**

- `docs/deployment.md` contains the canonical flow with every step labeled.
- `scripts/portainer-stack-check.sh` exists, is executable, and runs against a configured DT Portainer endpoint.
- Script reports expected digests when the stack matches the env file; reports mismatch otherwise.

**Validation**

```bash
./scripts/portainer-stack-check.sh --dry-run
pnpm validate
```

**DUT validation**

- Run `scripts/portainer-stack-check.sh` on DUT against the DUT Portainer instance; confirm it reports the expected digests.

**Portainer/DT rollout**

- Script is read-only; no deploy change.

**Non-goals**

- No Portainer API automation for deployment itself.
- No changes to the CI pipeline.
- No auto-promote from DUT to production.

## M59 Scene Studio Layout Repair And Field Explanations

Requested by the operator on 2026-09-05: the scene studio "is not displayed correctly, even on large
screens", every control should carry an (i) with an explanation, and a 2.0 release should be prepared.

### What was measured before changing anything

- The committed baseline screenshot `studio-scene-desktop` shows the fault as the expected state: the
  "Scene Preview" label at the top of its column, its select a screen lower, the rendered picture in
  the middle, the drag help at the bottom, and blank space between them. `.scene-designer-preview` is
  a grid without `align-content`, so its rows stretched to the height of the ~4700px form beside it.
- The admin content column had no width cap at all, against the layout rule in `docs/ui.md`.
- `.stack-form .grid.two` forces one column everywhere inside a form, so the studio's
  "Published scene state" aside always sat below the whole form.
- The pixel baseline's `maxDiffPixelRatio: 0.01` (~23,000px at 1440x1600) cannot see a 16px control
  appear; four new (i) buttons passed it unnoticed.

### Shipped

- `.scene-designer-preview { align-content: start }` plus sticky positioning from 901px, so the
  picture stays in view while the form scrolls.
- `--workspace-max` cap on `.content-stack` (1440px), `workspace-wide` (1800px) for the studio.
- `grid-aside` opt-in: from 1560px viewport the aside takes a 280-360px column beside the controls.
  A viewport query, not a container query — inline-size containment on `.content-stack` let the
  content column grow past the viewport on every admin page.
- `InfoTip` primitive; `info` prop on `Input`, `Select`, `Textarea`, `Panel`, `AdminPageHeader`;
  first explanations on the studio header, both panels and the preview toolbar.
- `tests/e2e/studio-layout.spec.ts` asserts the layout by measurement and the (i) by focus.
- Control-density budget excludes `.info-tip-button`; wording baseline masks the clock-dependent
  block coverage minutes that took the 1.5.47 release run down.

### Explanation sweep (2026-09-05, second commit of M59)

Fifteen writer agents, one per label-balanced file group, each required to derive every explanation
from the code that consumes the value (route, core, worker) and to list what it could not prove.
Two skeptics per group (code evidence; operator intelligibility) tried to refute each text; a fixer
applied the corrections. 254 explanations across 38 files; 33 labels left bare with a stated
reason (section headings with their own paragraph, read-only status rows, a per-card checkbox, a
`<summary>`); 228 objections raised and applied — among them "Off, the worker never deletes
anything for space" (false: the switch gates only pressure eviction), "its old media disappear"
(the sweep deletes database rows only), "the broadcaster account needs no grant" (wrong in a split
setup). The fix stage itself was spot-checked, not re-verified in full.

The first verification run after the sweep failed every authenticated test at sign-in: `InfoTip`
rendered a `<button>`, a `<button>` is a labelable element, and most labels here are implicit —
`<label><span class="label">…</span><input/></label>` — so the label bound the (i) instead of the
field and "Owner email" became an unnamed textbox. The trigger is now `<span role="button"
tabIndex={0}>`: focusable and announced as a button, not labelable, clicks stopped before the label.
The second run then failed on `getByLabel('Password')` resolving to two fields: the hidden tooltip
element sat inside the "Owner email" label and its text mentioned the password — a label's text is
everything under it, hidden or not, and Playwright matches labels by text. The explanation is now a
`data-tip` attribute drawn with CSS `::after` and exposed through `aria-description`; no tooltip
element exists in the DOM. Both mechanisms were proven in a two-field harness before the fix went in.
One component change for 254 sites; the four studio tips on headings were never affected.

### Found on the way: settings that nothing reads

The writers had to find the consumer of every value, and for these they found none — the value is
stored and displayed back, and the picture or the worker never looks at it:

- Scene: `Show clock`, `Show next item`, `Show schedule teaser`, `Show queue preview` only flip
  `scene.layers[*].enabled`, which the on-air layout does not read (clock and next card are drawn
  unconditionally; there is no schedule or queue panel). `Alt text`, `Widget mode`, `Scene data`,
  `Widget label override`, `Frame title`: embed/widget layers are never drawn by the shared renderer
  and `buildOverlaySceneMetadataWidgetContent` has no caller.
- Engagement: `Chat mode`, `Style`, `Alert position` are persisted and never read by layout,
  renderer or worker; alerts are logged, not drawn.
- Library upload accepts `.mp3/.aac/.flac/.wav` that the worker's library scan does not pick up.

Each of these is either a missing feature wearing a working control's clothes, or a control to
remove. Both are product decisions; neither belongs in a stability release unresolved.

### Open

- Decide, per setting above: wire it or remove it.
- The pixel gate's tolerance is a deliberate flakiness trade-off; lowering it is an operator decision.
- Explanation texts run two to three sentences; a tighter house style is a wording pass, not a code change.

## M60 Truthful Controls

Point 1 of the operator's 2.0 list (2026-09-05): every visible setting does what it says, or it goes.
Decided per setting from what the code consumes, as found by the M59 sweep:

- **Wired.** `Show clock` and `Show next item`: the studio flipped `scene.layers[*].enabled`, which the
  on-air layout never read. `OverlayScenePayloadView` now carries `showClock` / `showNextItem`
  (optional — a payload cached before M60 keeps drawing both), `buildNextCard` returns nothing when
  the item is hidden, and the clock cell is left empty so the top bar keeps its shape. Tested
  failing-first by mutation: 2 red against the old layout, 23 green with the new.
- **Removed from the studio, storage kept.** `Show schedule teaser` (no schedule panel exists anywhere),
  `Show queue preview` and `Queue preview count` (no queue panel in the scene renderer; the text
  fallback lists the queue regardless, as it always did), the website-embed and widget layer kinds
  (satori cannot draw an iframe and there is no browser overlay; the "Add … Embed" buttons are gone,
  an existing layer of those kinds shows a note instead of fields), and the engagement `Chat mode`,
  `Style`, `Alert position` (persisted, never read by layout, renderer or worker). The API keeps
  accepting the fields; the control room no longer reports the queue preview.
- **One extension list.** `LIBRARY_MEDIA_FILE_EXTENSIONS` in `@stream247/core` feeds the worker's
  library scan, the upload route and the upload form. The upload used to accept `.avi` and four audio
  types the scan never picked up.

Not done here: drawing alerts on air, a schedule/queue panel, browser embeds — those are features,
and this milestone removes only the pretence that they exist.

## M61 Boundary A/V Skew Instrumentation

Point 2 of the 2.0 list: measure the seam instead of theorising about storms. Two numbers, logged
where they arise, both described in `docs/operations.md` (*Seam Skew At Boundaries*):

- `uplink.seam.skew` — the uplink supervisor parses ffmpeg's `timestamp discontinuity … new offset=`
  lines per stream (`vist`/`aist`, microseconds) and pairs a video and an audio line that arrive
  within five seconds; the absolute difference is the skew that separated storms (11.84–13.45 s)
  from quiet boundaries (1.07–6.69 s) when read by hand on 2026-09-05. One line per seam, with the
  discontinuity count of the current window. Pure functions in `uplink-progress.ts`, tests first.
- `playout.feed.av_lead` — at every duration-bound cut, the last audio and video packet time of the
  newest feed segment and their difference: the writer's view of the same seam, bounded to three
  seconds so a slow probe never holds the boundary.

Nothing decides on these numbers yet. They exist so that `-dts_delta_threshold 60` (1.5.47) can be
judged against evidence: a seam above 10 s with a single-digit discontinuity count is the proof.
