# Stream247 Execution Plan

## Problem Statement

Stream247 already ships a capable self-hosted Twitch-first 24/7 automation stack, but it still trails the public behavior of Upstream in the highest-value product areas: true on-air scene rendering, continuous queue control, richer library and scheduling workflows, multi-output delivery, and lower-friction operator UX. The repo also carries architecture concentration risk in the worker, database, and server-state layers, plus limited automated coverage for live runtime behavior.

This plan closes those gaps while preserving Stream247's existing self-hosted architecture, naming, and conventions. The product target is the best self-hosted alternative to Upstream for 24/7 cloud-style channel automation, without copying Upstream branding, UI, or text.

## Current State

- Monorepo with `apps/web`, `apps/worker`, `packages/core`, `packages/db`, and `packages/config`
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

## Phase 3 — Product Depth, Metadata, Overlay, And Redesign

This phase addresses the concrete product-quality problems identified in the 2026-04-20 audit: wrong labels visible to stream viewers, missing metadata editing, pool-level schedule blindness, hardcoded output settings, missing engagement features, and the need for a modern UI. The full product direction, UX strategy, and supporting data model designs live in `docs/redesign-and-product-plan.md`, `docs/video-planning-and-metadata-model.md`, and `docs/in-stream-overlay-and-output-strategy.md`.

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
- `README.md`, `docs/deployment.md`, and `docs/versioning.md` describe the published release artifacts and proxy restart guarantees accurately without overclaiming

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
- docs: update `docs/upstream-gap-analysis.md` to reflect fix

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
- docs: update library section in `docs/redesign-and-product-plan.md`

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
- `stack.env.example`, `docs/deployment.md`, `docs/in-stream-overlay-and-output-strategy.md`
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
- `stack.env.example`, `docs/in-stream-overlay-and-output-strategy.md`
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

- Implement the updated navigation structure from `docs/redesign-and-product-plan.md` section C: `Control Room`, `Programming`, `Stream Studio`, `Workspace` top-level groups
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
- docs: update `docs/redesign-and-product-plan.md` with completed redesign notes

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
- Full overlay safe-area clamping for arbitrary positioned layers remains future work; M24 shipped output profiles, viewport alignment, and scaling

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
| M31 | Feature fix | Next | Incomplete | Overlay safe-area clamping and CSS variable wiring |
| M32 | Feature | Next | Incomplete | Donation and bits alerts (Twitch EventSub `channel.cheer` + channel-point) |
| M33 | Feature | Later | Incomplete | Multi-quality simultaneous RTMP output |
| M34 | Docs | Now | Incomplete | Delete legacy docs, merge redundant docs, final doc set |
| M35 | Feature | Next | Incomplete | Twitch LIVE badge with viewer count in Broadcast page |

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

Status: incomplete

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

---

## M32 Donation And Bits Alerts

Status: incomplete

**Goal**

Implement Twitch EventSub `channel.cheer` and `channel.channel_points_custom_reward_redemption.add` alerts. Add a "donations/bits" section to the Overlays admin page. Until M32 ships, add a "not yet available" placeholder in the Overlays UI.

**Scope**

- Add `channel.cheer` and `channel.channel_points_custom_reward_redemption.add` to `REQUIRED_TWITCH_EVENTSUB_SUBSCRIPTIONS` in `apps/worker/src/twitch-eventsub.ts`
- Add webhook handling for these event types in `apps/web/app/api/overlay/events/route.ts`
- Add alert rendering in `apps/web/components/engagement-overlay.tsx` for cheer and channel-point events
- Add controls in `apps/web/(admin)/overlays/page.tsx` for cheer and channel-point alerts (enable/disable, position, style)
- Store alert preferences per-type in `engagement_settings` (add `donations_enabled` and `channel_points_enabled` columns)
- Additive schema migration

**Before M32 ships:** Add a visible "Donation and bits alerts — coming soon" placeholder in the Overlays admin section. Do not leave the section entirely absent.

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

Status: incomplete

**Goal**

Support sending the stream to multiple destinations at different output profiles simultaneously (e.g., 720p to Twitch + 360p to YouTube).

**Scope**

- Add per-destination output profile assignment in destination settings
- When multiple destinations have different output profiles, spawn a separate scale+encode process per destination (or use a transcoding relay layer)
- Update the admin Output page to show per-destination profile configuration
- Update the multi-output pipeline in `apps/worker/src/multi-output.ts`

**Note:** This is the most architecturally complex Phase 4 milestone. The correct approach depends on whether parallel FFmpeg encode processes or a MediaMTX relay fanout is used. Scope this milestone carefully before starting implementation. A design note should be added to this section before work begins.

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

---

## M34 Documentation Cleanup

Status: incomplete

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

---

## M35 Twitch Live Status Widget

Status: incomplete

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

---

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

### 2026-04-21 — M29 React Component Primitives And Chat Command Dispatch

- Added the first typed `apps/web/components/ui/` primitive layer with `Badge`, `Button`, `Card`, `Input`, `Select`, `PageHeader`, and `StatusChip`, keeping the existing CSS system as the source of truth instead of introducing a new design dependency.
- Switched `overlay-scene-canvas.tsx` to the guarded `Badge` primitive for widget/embed badges so empty or placeholder badge text is centrally suppressed.
- Wired Twitch IRC moderator commands into the existing moderation presence model: `!here`/`here` now update presence windows from chat, are restricted to moderator/broadcaster messages, and are consumed before viewer-facing chat overlay storage.
- Added unit coverage for the badge guard and chat-command parsing, and re-ran unit, validate, and browser smoke coverage after the worker/web changes.

### 2026-04-20 — M28 Phase 3 Audit Stabilization

- Added worker-side Twitch EventSub synchronization for follow/sub alert webhooks with duplicate detection and safe cleanup when alert runtime is disabled.
- Replaced the remaining on-air fallback string with "Coming up next" and covered it with focused overlay text tests.
- Marked M21-M27 complete after their implementation commits and documented the acceptance-audit caveats: EventSub requires the new OAuth scopes on reconnect, and full safe-area clamping is still future work.

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
- Caveat: full safe-area container/clamping for arbitrary positioned layers is not yet implemented.

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

- Completed the planning baseline by creating `AGENTS.md`, `PLANS.md`, `IMPLEMENT.md`, `docs/upstream-gap-analysis.md`, and `docs/upstream-roadmap.md`.
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
