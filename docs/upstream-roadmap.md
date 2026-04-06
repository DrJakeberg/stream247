# Upstream Parity Roadmap For Stream247

Updated: 2026-04-06

This roadmap is not finished. `M0` through `M9` established the first parity wave, but a follow-up audit found remaining safety fixes, partial-parity gaps, and coverage work that still need to ship before Stream247 can claim stronger self-hosted parity against the public Upstream feature set.

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

Status: completed 2026-04-05

**Objective**  
Allow safe live ingress takeover and controlled return to scheduled playback.

**Capabilities Added**

- RTMP/RTMPS and HLS Live Bridge inputs from the broadcast workspace
- temporary live takeover that preserves queue visibility and multi-output fanout
- safe return-to-queue workflow with explicit release state and operator visibility

**Touched Subsystems**

- `apps/worker`
- `apps/web`
- `packages/core`
- `packages/db`

**Dependencies**

- M3
- M6

**Acceptance Criteria**

- live source can replace scheduled content and return without corrupting the queue
- operator state stays clear during takeover and release
- Live Bridge status is visible in the broadcast snapshot and control room without exposing raw input URLs

**Validation**

- `pnpm validate`
- `pnpm test:fresh-db`
- `pnpm test:fresh-compose`
- `pnpm test:live-bridge-smoke`

**Rollback Posture**

- feature disabled by default until proven stable

## M8 — Audio Lanes, Cuepoints, And Advanced Inserts

Status: completed 2026-04-05

**Objective**  
Support richer audio/video composition and timed insert behavior without destabilizing the channel.

**Capabilities Added**

- pool-scoped replace-mode audio lanes for scheduled playback
- schedule-block cuepoints that arm inserts and fire them at the next safe asset boundary
- broadcast snapshot and control-room visibility for audio lanes and cuepoint progress
- deterministic cuepoint runtime state that survives worker cycles without refiring old offsets

**Touched Subsystems**

- `apps/worker`
- `apps/web`
- `packages/core`
- `packages/db`

**Dependencies**

- M3
- M7

**Acceptance Criteria**

- replace-mode audio lanes work predictably during scheduled playback without breaking existing live, standby, insert, or multi-output behavior
- cuepoint-triggered inserts fire deterministically at safe boundaries and stay visible to operators
- queue continuity and runtime safety remain stable

**Validation**

- `pnpm validate`
- `pnpm test:audio-cuepoint-smoke`
- `pnpm test:fresh-db`
- `pnpm test:fresh-compose`

**Rollback Posture**

- keep the default program-audio path active whenever no valid audio lane is configured and preserve manual/pool inserts as the safe fallback

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

## M10 — Truth And Safety Fixes

Status: completed 2026-04-05

**Objective**  
Fix review-found stale-write admin races, correct the update-center version lookup, and bring the docs back in sync with the real product state.

**Capabilities Added**

- targeted asset-catalog curation updates instead of stale full-row asset rewrites
- targeted source admin field updates instead of stale whole-source upserts
- repo-version resolution in the update center that works from repo-root and containerized working directories
- regression coverage for all three bug classes
- conservative roadmap and gap-analysis wording that no longer implies the work is finished

**Touched Subsystems**

- `apps/web/app/api/assets/*`
- `apps/web/app/api/sources/*`
- `apps/web/app/api/library/uploads/route.ts`
- `apps/web/lib/server/update-center.ts`
- `packages/db`
- tests
- docs

**Dependencies**

- M0 through M9

**Acceptance Criteria**

- asset curation updates only touch intended curation fields
- source edit, bulk, sync, and upload-rescan flows only touch intended source fields
- update center resolves the repo package version safely in supported deployment layouts
- regression tests exist for the asset, source, and update-center bug classes
- docs no longer imply full parity or a finished roadmap

**Validation**

- `pnpm validate`
- `pnpm test:fresh-db`

**Rollback Posture**

- keep DB changes additive and revert the targeted admin routes if needed

## M11 — Scene Studio V2

Status: completed 2026-04-06

**Objective**  
Deepen Scene Studio beyond fixed preset composition while keeping the product original and self-hosted.

**Capabilities Added**

- richer positioned text/logo/image/embed/widget scene layers
- safer image/logo/embed/widget handling with sanitized URLs and sandboxed iframe rendering
- built-in typography presets with conservative public parity claims

**Touched Subsystems**

- `packages/core`
- `packages/db`
- `apps/web`
- `apps/worker`

**Dependencies**

- M10

**Acceptance Criteria**

- Scene Studio supports richer layer composition without regressing the current publish-safe path
- browser and on-air consumers still share one canonical scene contract
- docs continue to describe the feature set conservatively

**Validation**

- `pnpm validate`
- `pnpm test:fresh-db`
- `docker build -f docker/web.Dockerfile -t stream247-web:test .`
- `docker build -f docker/worker.Dockerfile -t stream247-worker:test .`
- `pnpm test:fresh-compose`
- `pnpm test:e2e:smoke`

**Rollback Posture**

- preserve the existing Scene Studio v1 contract and fallback path

## M12 — Continuity And Recovery V2

Status: completed 2026-04-06

**Objective**  
Strengthen queue continuity and output recovery beyond the first shipped queue and multi-output milestones.

**Capabilities Added**

- lower restart pressure on normal transitions
- clearer multi-output failure attribution and recovery visibility
- stronger operator-safe recovery flows without changing the original control-room model
- staged recovered destinations that rejoin on natural transitions unless operators request an immediate recovery cycle
- per-destination cooldown and recovery summaries in broadcast snapshots and control-room output health

**Touched Subsystems**

- `apps/worker`
- `packages/db`
- `apps/web/lib/server`
- tests

**Dependencies**

- M10
- M11

**Acceptance Criteria**

- continuity and recovery behavior improves measurably without regressing Live Bridge or queue visibility
- output failures are easier for operators to attribute and recover from
- docs still describe continuity and recovery as proven only where coverage exists

**Validation**

- `pnpm validate`
- `pnpm test:multi-output-smoke`
- `pnpm test:live-bridge-smoke`
- `pnpm test:fresh-db`
- `docker build -f docker/web.Dockerfile -t stream247-web:test .`
- `docker build -f docker/worker.Dockerfile -t stream247-worker:test .`
- `pnpm test:fresh-compose`
- `pnpm test:queue-continuity`

**Rollback Posture**

- preserve the current queue engine and output routing as the safe fallback

## M13 — Library And Blueprints V2

Status: completed 2026-04-06

**Objective**  
Deepen library organization and make blueprint reuse safer across installs.

**Capabilities Added**

- thumbnails and richer library grouping
- curated sets and safer bulk operations
- selective or merge-aware blueprint import/remap guidance

**Touched Subsystems**

- `apps/web`
- `apps/worker`
- `packages/db`
- docs

**Dependencies**

- M10

**Acceptance Criteria**

- library operations are materially deeper than folders/tags alone
- blueprint workflows remain explicit about what is and is not portable
- operator documentation explains remap and media-presence constraints clearly

**Validation**

- `pnpm validate`
- `pnpm test:fresh-db`
- `pnpm test:fresh-compose`

**Rollback Posture**

- keep current folder/tag curation and replace-style blueprint import available

## M14 — Operator UX V2

Status: completed 2026-04-06

**Objective**  
Resolve admin information-architecture drift and make the control-room experience more consistent.

**Capabilities Added**

- clearer separation between Broadcast, Dashboard, Scene Studio, Library/Sources, and Settings
- more consistent terminology and operator affordances
- improved tablet/mobile operator ergonomics

**Touched Subsystems**

- `apps/web`
- docs
- browser tests

**Dependencies**

- M10
- M11
- M13

**Acceptance Criteria**

- major admin surfaces have clear roles and less overlap
- UI wording and docs align on the same original product terms
- the control-room workflow is clearer without copying Upstream layout or language

**Validation**

- `pnpm validate`
- browser smoke/E2E coverage

**Rollback Posture**

- keep existing routes and navigation operable while the IA shifts

## M15 — Coverage And Release Proof V2

Status: planned

**Objective**  
Increase direct automated proof for the highest-risk parity features and release paths.

**Capabilities Added**

- broader browser workflow coverage
- deeper runtime smokes for Multi-Output, Live Bridge, and audio/cuepoint flows
- longer continuity and scene-publish proof before claiming stronger parity

**Touched Subsystems**

- tests
- CI
- scripts
- docs

**Dependencies**

- M10 through M14

**Acceptance Criteria**

- critical parity features are covered by direct browser/runtime proof, not only unit tests
- release docs and CI state exactly what has been proven automatically
- parity claims stay bounded by actual automated coverage

**Validation**

- `pnpm validate`
- expanded browser/runtime smokes
- release preflight
- soak/upgrade rehearsal where relevant

**Rollback Posture**

- add coverage incrementally without removing existing guards until replacements are green
