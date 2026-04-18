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

## Rollback Notes

- Docs-only milestones roll back by reverting the doc commit.
- Schema changes must be additive first, with a clear downgrade note before any destructive migration is considered.
- Scene rendering work must preserve the current text-overlay path until the new renderer is proven stable.
- Queue/transition milestones must preserve a safe compatibility path until continuity tests are green.
- Multi-output milestones must keep current primary/backup delivery usable as the default fallback mode.

## Strict Done Definition

- code complete
- tests updated
- `pnpm validate` passes
- any needed smoke checks are run
- docs updated
- summary written with changed files, risks, and follow-up items

## Progress Notes

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
