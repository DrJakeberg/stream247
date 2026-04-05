# Upstream Parity Roadmap For Stream247

Updated: 2026-04-05

## Roadmap Principles

- self-hosted first
- original product identity, naming, and UI
- extend current modules before rewriting stable parts
- additive schema and compatibility paths first
- use repo-native validation and release tooling
- keep milestones independently shippable where possible

## M0 — Planning And Execution Guardrails

**Objective**  
Establish canonical instructions and execution artifacts before higher-risk parity work begins.

**Capabilities Added**

- strict agent rules for non-trivial work
- canonical execution plan and runbook
- public Upstream capability matrix grounded in current repo truth
- milestone roadmap for future work

**Touched Subsystems**

- repo root docs
- `docs/`

**Dependencies**

- none

**Acceptance Criteria**

- `AGENTS.md`, `PLANS.md`, `IMPLEMENT.md`, `docs/upstream-gap-analysis.md`, and `docs/upstream-roadmap.md` exist
- the files are internally consistent
- milestone ordering matches repo constraints and real scripts

**Validation**

- `pnpm validate`

**Rollback Posture**

- revert docs-only commit

## M1 — Scene Studio Contract

Status: completed 2026-04-05

**Objective**  
Make one canonical scene payload the source of truth for browser overlay surfaces and on-air scene rendering.

**Capabilities Added**

- unified scene contract
- explicit scene render target model
- stable publish path for all scene consumers
- browser overlays, scene APIs, and playout text consumers now read from the same scene payload

**Touched Subsystems**

- `packages/core`
- `packages/db`
- `apps/web`
- `apps/worker`

**Dependencies**

- M0

**Acceptance Criteria**

- one published scene payload drives browser and playout consumers
- draft/live flow remains intact
- existing overlay presets migrate forward cleanly

**Validation**

- `pnpm validate`
- `pnpm test:fresh-db`
- `pnpm test:fresh-compose`

**Rollback Posture**

- keep current text-overlay compatibility path available

## M2 — On-Air Scene Renderer V1

Status: completed 2026-04-05

**Objective**  
Render published scenes on-air as branded visuals rather than relying primarily on text overlay lines.

**Capabilities Added**

- Scene Studio rendered output for on-air use
- branded on-air scene capture from the published browser overlay
- publish-live workflow without taking the stream offline
- safe text-overlay fallback when Chromium capture is unavailable

**Touched Subsystems**

- `apps/worker`
- `apps/web`
- Docker worker runtime

**Dependencies**

- M1

**Acceptance Criteria**

- on-air scene matches published scene settings
- publish updates scene output without requiring a full stream restart
- renderer failure falls back safely to a minimal on-air scene

**Validation**

- `pnpm validate`
- `pnpm test:fresh-compose`
- `docker build -f docker/worker.Dockerfile -t stream247-worker:test .`

**Rollback Posture**

- switch back to the text-overlay fallback path

## M3 — Queue Engine And Transition Controller

Status: completed 2026-04-05

**Objective**  
Promote queue and transition handling into a deterministic runtime with stronger continuity guarantees.

**Capabilities Added**

- persistent queue model
- explicit transition controller
- richer on-air controls
- safer bad-next-asset handling
- lower restart pressure during normal queue advancement
- operator queue actions for play now, move next, remove next, and replay previous
- queue continuity smoke coverage for short rotating local-library assets

**Touched Subsystems**

- `apps/worker`
- `packages/db`
- `apps/web/lib/server`

**Dependencies**

- M1
- M2

**Acceptance Criteria**

- queue advancement occurs only after confirmed transition success
- bad next assets are skipped before they become current
- standby, reconnect, and insert remain first-class queue items
- operator queue actions are safe and visible

**Validation**

- `pnpm validate`
- `pnpm test:fresh-db`
- `pnpm test:fresh-compose`
- Docker image builds
- queue continuity smoke

**Rollback Posture**

- keep compatibility mode for the current playout path until continuity checks are stable

## M4 — Programming Workspace V2

Status: completed 2026-04-05

**Objective**  
Make schedule authoring fast, dense, and queue-aware for real weekly channel operations.

**Capabilities Added**

- materialized fill preview
- repeat behavior
- underfill/overflow signals
- queue-aware schedule preview
- insert rules and house assets
- faster copy/duplicate flows
 - repeat-set editing across linked weekday blocks

**Touched Subsystems**

- `apps/web`
- `packages/core`
- `packages/db`

**Dependencies**

- M3

**Acceptance Criteria**

- operators can plan a week with low friction
- preview aligns with actual queue behavior
- repeat behavior is explicit and deterministic

**Validation**

- `pnpm validate`
- schedule-focused tests

**Rollback Posture**

- preserve current weekly block CRUD while new UX lands incrementally

## M5 — Library Expansion And Channel Blueprints

Status: completed 2026-04-05

**Objective**  
Turn the media catalog into a richer reusable library and make full stream configurations portable.

**Capabilities Added**

- asset folders and tags with bulk curation workflows
- local-library folder preservation and source-scoped remote library organization
- Channel Blueprint export/import for Scene Studio, sources, programming, moderation, and destination metadata

**Touched Subsystems**

- `apps/web`
- `packages/db`
- `apps/worker`

**Dependencies**

- M4

**Acceptance Criteria**

- assets are easier to curate at scale
- blueprints can recreate a stream safely inside another workspace/install

**Validation**

- `pnpm validate`
- blueprint roundtrip tests
- `pnpm test:fresh-db`
- `pnpm test:fresh-compose`

**Rollback Posture**

- keep import/export opt-in and additive

## M6 — Multi-Output V1

Status: completed 2026-04-05

**Objective**  
Extend the delivery model from primary/backup to multiple concurrent outputs.

**Capabilities Added**

- multiple RTMP outputs per channel
- health-aware routing across outputs
- clearer operator visibility for output groups
- managed per-destination stream keys for non-default outputs
- legacy env fallback preserved for the built-in primary and backup outputs

**Touched Subsystems**

- `packages/db`
- `apps/worker`
- `apps/web`

**Dependencies**

- M3

**Acceptance Criteria**

- one channel can deliver to multiple outputs
- failures in one output do not corrupt queue state
- current primary/backup flow still works

**Validation**

- `pnpm validate`
- `pnpm test:fresh-db`
- `pnpm test:fresh-compose`
- `pnpm test:multi-output-smoke`

**Rollback Posture**

- preserve current primary/backup mode as default fallback

## M7 — Live Bridge

**Objective**  
Allow safe live ingress takeover and controlled return to scheduled playback.

**Capabilities Added**

- RTMP/HLS live ingress
- temporary live takeover
- return-to-queue workflow

**Touched Subsystems**

- `apps/worker`
- `apps/web`
- Docker/runtime support

**Dependencies**

- M3
- M6

**Acceptance Criteria**

- live source can replace scheduled content and return without corrupting the queue
- operator state stays clear during takeover and release

**Validation**

- `pnpm validate`
- targeted ingress smoke tests
- longer soak on candidate builds

**Rollback Posture**

- feature disabled by default until proven stable

## M8 — Audio Lanes, Cuepoints, And Advanced Inserts

**Objective**  
Support richer audio/video composition and timed insert behavior without destabilizing the channel.

**Capabilities Added**

- separate audio/video lanes
- optional ambient audio lane
- cuepoint-like timed inserts
- more advanced transition behavior

**Touched Subsystems**

- `apps/worker`
- `packages/core`
- `packages/db`

**Dependencies**

- M3
- M7

**Acceptance Criteria**

- advanced inserts and secondary audio work predictably
- long-running queue continuity remains stable

**Validation**

- `pnpm validate`
- continuity smoke
- soak run

**Rollback Posture**

- keep behind feature flags until soak-tested

## M9 — Security And Release Hardening

Status: completed 2026-04-05

**Objective**  
Strengthen release confidence, browser workflow safety, and account security.

**Capabilities Added**

- Playwright smoke coverage
- queue continuity and scene publish checks in CI
- stronger structured runtime logging
- optional 2FA for local accounts
- release workflow gates for queue continuity, browser smoke, and release preflight

**Touched Subsystems**

- tests
- CI
- `apps/web`
- docs

**Dependencies**

- M1 through M6 for meaningful coverage

**Acceptance Criteria**

- critical admin and broadcast workflows are covered by browser/runtime tests
- local auth can be hardened with 2FA
- release candidate confidence improves materially

**Validation**

- `pnpm validate`
- Playwright smoke
- fresh DB / fresh compose
- release preflight
- upgrade rehearsal / soak when relevant

**Rollback Posture**

- additive checks and optional security settings first
