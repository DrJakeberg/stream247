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
  - overlay draft/publish, scene presets, layer order, and layer visibility
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
| M11 Scene Studio V2 | Parity + UX | Next | Planned | Deepen Scene Studio beyond presets and fixed layer types | Richer positioned image/logo/embed/widget/text layers, safer font handling, and conservative public parity claims | `packages/core`, `packages/db`, `apps/web`, `apps/worker` | high | preserve current Scene Studio v1 payload and text/image fallback path |
| M12 Continuity And Recovery V2 | Architecture + Ops | Next | Planned | Strengthen output recovery and reduce restart-heavy normal transitions | Continuity and multi-output recovery improve measurably without regressing queue or live-bridge visibility | `apps/worker`, `packages/db`, `apps/web/lib/server`, tests | very high | keep current queue engine and output routing available as the safe fallback |
| M13 Library And Blueprints V2 | Parity + UX | Next | Planned | Deepen library operations and make blueprints safer to reuse across installs | Thumbnails, grouped browsing, curated sets, and selective blueprint import/remap guidance are available without overpromising media portability | `apps/web`, `apps/worker`, `packages/db`, docs | medium | keep current folder/tag curation and replace-style blueprint import path intact |
| M14 Operator UX V2 | UX | Next | Planned | Resolve admin IA drift and make the control-room model more consistent | Broadcast, Dashboard, Scene Studio, Sources/Library, and Settings have clearer roles and more consistent naming | `apps/web`, docs, tests | medium | keep current routes and navigation labels working until the new IA is proven |
| M15 Coverage And Release Proof V2 | Ops | Next | Planned | Prove the highest-risk parity features with broader automated coverage | Multi-output, Live Bridge, audio/cuepoint flows, and scene publish safety have direct runtime/browser proof beyond unit tests | tests, CI, scripts, docs | high | additive coverage only; do not remove current gates until replacements are green |

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
- `Next` M11 Scene Studio V2
- `Next` M13 Library And Blueprints V2
- `Not Planned` visual cloning of Upstream UI or branding

## Architecture Work

- `Now` split runtime concerns inside `apps/worker/src/index.ts` into queue, transition, ingest, destination, Twitch sync, and scene modules without a rewrite-first approach
- `Now` move scene rendering behind an explicit scene payload and published-scene render contract
- `Now` keep DB changes additive and continue using targeted writers instead of broad state rewrites
- `Next` move from baseline-style migration growth to clear sequential SQL migrations
- `Next` make queue persistence and scene renderer caches explicit and observable
- `Later` add richer mixed audio routing, crossfades, and deeper live-ingest controls beyond the first shipped M7/M8 contracts
- `Next` improve continuity and recovery semantics after the first queue/multi-output/live-bridge milestones land
- `Not Planned` ORM migration or abandoning Docker/Compose delivery

## UX Work

- `Now` keep `Broadcast` as the control-room anchor and evolve it into original `On-Air Controls`
- `Now` rename/position overlay work as `Scene Studio` in docs and future UI copy
- `Complete` upgrade schedule editing into a denser `Programming Workspace` with materialized fill, repeats, queue-aware preview, and insert rules
- `Complete` expand `Library` with folders, tags, bulk curation, and safer reusable catalog organization
- `Complete` add `Channel Blueprints` as the original import/export system for full stream setups
- `Next` resolve IA drift between `Broadcast`, `Dashboard`, `Scene Studio`, `Sources`, and `Settings`
- `Next` deepen Scene Studio beyond fixed preset composition while keeping original naming and UI
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
