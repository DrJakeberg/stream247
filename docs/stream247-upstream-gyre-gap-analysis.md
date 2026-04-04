# Stream247 Upstream/Gyre Gap Analysis

Updated: 2026-04-04

## Goal

This document defines what Stream247 still needs in order to compete with:

- [Upstream](https://upstream.so/)
- [Upstream Quick Start](https://help.upstream.so/en/article/streaming-quick-start-guide-start-a-247-livestream-with-upstream-u9og2y/)
- [Upstream Comparisons & Alternatives](https://help.upstream.so/en/article/upstream-comparisons-alternatives-1his3hk/)
- [Gyre](https://gyre.pro/)
- [Gyre stream scheduler article](https://gyre.pro/pt/blog/update-from-gyre--stream-scheduler-for-planning-looped-streams)

Chosen product direction:

- single-channel self-hosted V1
- Twitch-first broadcast automation
- modern control-room admin UI
- low-friction setup for less technical operators

## What Upstream And Gyre Do Well

### Upstream

Upstream is strongest where creators immediately feel “this is a finished product”:

- strong stream-designer story with overlays, widgets, logos, track names, video names, and visualizer support
- content can be changed while the stream is live
- live playback controls
- multistreaming and backup stream positioning
- separate playlist/control concepts for audio and video
- simple guided quick-start for low-tech users

### Gyre

Gyre is strongest where simplicity wins:

- obvious 24/7 pre-recorded streaming product story
- playlist-first mental model
- continuous replay behavior
- low-tech onboarding
- simple scheduling/calendar UX
- multi-stream positioning

## Current Stream247 Strengths

Stream247 already has a stronger technical base than many small OSS projects:

- self-hosted Docker/GHCR delivery
- setup flow and local owner auth
- Twitch broadcaster connect and Twitch SSO
- encrypted managed secrets with `.env` fallback
- pool-based weekly scheduling
- source ingestion from YouTube, Twitch, direct media, and local library
- FFmpeg playout runtime with queue preview, standby, reconnect, and operator overrides
- incidents, ops page, drift checks, and health endpoints
- Twitch title/category and schedule sync

## Current Product Gaps

These are the most important gaps found after reviewing the code and comparing the product to Upstream and Gyre.

### Live broadcast surfaces were too static

Before the current live-state slice, the public overlay and public channel pages were rendered as server snapshots and did not live-update without a reload. For a 24/7 stream product, that is not acceptable.

### Overlay architecture is still split

The product currently has:

- a browser-source overlay page
- persisted overlay settings
- an FFmpeg text overlay path in playout

This is not yet a real unified scene system. Upstream’s designer is clearly ahead here.

### Admin UX is still too form- and reload-driven

The admin panel is useful, but it still leans heavily on individual forms and manual page-level refresh behavior instead of behaving like a live control room.

### Scheduling is still block-centric

Pools, show profiles, drag-and-drop, and templates exist, but the programming workflow is still behind modern scheduler products:

- not enough visual planning density
- no true materialized fill view
- no duplicate/copy lane UX
- no queue-aware programming view

### Runtime architecture is still mid-transition

The playout runtime is much better than before, but still not yet a full continuous queue engine with scene-aware transitions and persistent on-air control.

### Migrations are safer, but not fully mature

The project now has `schema_migrations` and fresh-DB boot tests, but the migration structure is still closer to a robust baseline than a long-lived historical migration tree.

### Test coverage is still too thin

The current automated tests catch some real regressions, but coverage is still small compared to the risk in:

- queue continuity
- scene updates
- public/live surfaces
- source sync edge cases
- long-running broadcast behavior

## Bugs And Weak Implementations To Address

### High-confidence current weaknesses

- the scene/overlay model is not unified
- runtime logic is still concentrated in `apps/worker/src/index.ts`
- the admin UI lacked live updates and relied too much on hard reloads
- there is still no dedicated upload manager for less technical users
- there is still no first-class backup destination model
- the programming editor still needs better duplication, search, and materialized preview

### Recently fixed in the current implementation slice

The following product gaps are now addressed:

- public overlay now has a live update path
- public channel page now has a live update path
- admin now has a first-class Broadcast workspace
- hard `window.location.reload()` usage in admin forms has been removed in favor of router refresh/navigation
- the UI now exposes hard reload directly in broadcast controls
- the local-library connector is now visible in source forms
- overlay settings now include first-class scene presets and richer presentation controls
- browser overlay and on-air text overlay now share the same scene-oriented text composition logic
- overlay studio now supports draft-save, reset-to-live, and publish-live scene changes
- overlay studio now has a reusable scene preset library that can save draft scenes and re-apply them later
- scheduled playout now has a graceful handoff path so a running item can finish before the next schedule block takes over
- scene definitions now have a first-class layer order and a dedicated `/api/scenes` read path
- scene presets can now be assigned separately for asset, insert, standby, and reconnect modes
- scene headlines can now be assigned separately for asset, insert, standby, and reconnect modes
- scene designer controls now support hiding layers in addition to reordering them
- the schedule editor can now duplicate existing blocks onto multiple additional weekdays
- the schedule editor can now clone a full programming day onto additional empty weekdays
- the schedule editor now has search, pool/show filters, and conflict-only focus inside the programming workspace
- source creation and editing now use guided connector templates instead of only raw connector/url fields
- operators can now upload local media directly from the admin UI into the shared library path
- the broadcast runtime now distinguishes between primary and backup RTMP destinations, marks failed outputs with a cooldown window, and can fail over to the next healthy target

## Implementation Roadmap

### Phase 1: Live Control Room Foundation

Status: shipped.

Deliverables:

- dedicated `Broadcast` admin page
- `GET /api/broadcast/state`
- `GET /api/broadcast/stream` via SSE
- public `GET /api/channel/live`
- public `GET /api/channel/live/stream` via SSE
- live-updating public overlay
- live-updating public channel page
- no more hard reloads in admin forms

### Phase 2: Scene System

Status: in progress, presets plus draft/publish workflow implemented.

Deliverables:

- first-class `SceneDefinition`
- layered scene model:
  - replay badge
  - current title
  - next title
  - clock
  - emergency banner
  - logo/image layers
  - background shapes
- draft vs live scenes
- live scene preview
- scene presets:
  - replay
  - standby
  - reconnect
  - gaming archive
  - radio/music
- one scene model used by both public overlay pages and the actual on-air playout renderer

### Phase 3: Continuous Queue Runtime

Deliverables:

- refactor worker runtime into queue, transition, ingest, destination, and scene modules
- persistent queue model:
  - current
  - next
  - queued
  - transition state
  - active scene
  - reconnect plan
- deterministic queue advancement only after confirmed transition success
- bad next assets skipped before they become current
- standby/reconnect/bumper content treated as real queue items

### Phase 4: Better Programming UX

Deliverables:

- true Programming workspace
- improved weekly/day planning views
- search, duplicate, copy-to-day, clone-week
- materialized fill view based on natural asset lengths
- underfill and overflow warnings
- queue-aware schedule preview
- insert rules and house assets

### Phase 5: Library UX And Low-Tech Setup

Deliverables:

- guided source creation wizard
- upload manager for local content
- richer asset detail:
  - thumbnail
  - tags
  - playability
  - last played
  - source health
- bulk actions for source and asset library
- more guided setup language and better validation

### Phase 6: Stability And Operations

Deliverables:

- primary + backup destination model
- structured runtime logs
- scene publish safety tests
- queue continuity smoke tests
- 24h soak tests for release candidates
- split baseline migration into historical migration files

## Public Interfaces To Introduce Or Expand

- `GET /api/broadcast/state`
- `GET /api/broadcast/stream`
- `GET /api/channel/live`
- `GET /api/channel/live/stream`
- future:
  - `GET/POST/PUT /api/scenes`
  - `POST /api/scenes/:id/publish`
  - `GET/POST /api/presets`
  - `GET /api/programming/materialize`
  - `POST /api/library/uploads`

Core new shared types:

- `BroadcastSnapshot`
- `PublicChannelSnapshot`
- future:
  - `SceneDefinition`
  - `SceneLayer`
  - `BroadcastQueueItem`
  - `DestinationHealth`
  - `MaterializedProgramWindow`

## Test Plan

### Immediate automated coverage

- unit tests for live snapshot shaping
- integration tests for live state routes
- browser/E2E tests for:
  - broadcast workspace loads
  - overlay updates without reload
  - channel page updates without reload
- smoke test that operator actions update live state without hard reload

### Next stability layer

- queue continuity tests across multiple short assets
- scene publish while live
- reconnect scene insertion and resume
- bad next asset skip
- source resync while on air
- backup destination failover

## Acceptance Criteria

The product should be considered meaningfully closer to Upstream/Gyre parity when all of the following are true:

- operators can watch current, next, queue, and destination state live in one place
- overlay graphics are designed as scenes and reflected directly in the 24/7 stream
- viewers see live current/next data on the public overlay and channel pages
- programming can be edited visually at week scale without repetitive form churn
- less technical users can add content without understanding connector internals
- release candidates prove fresh boot, compose boot, queue continuity, and scene update safety

## Notes

This document is intentionally product- and implementation-oriented. It should stay in sync with:

- `README.md`
- `docs/architecture.md`
- `docs/operations.md`
- `docs/upgrading.md`

Whenever one of the roadmap phases is implemented, this file should be updated to mark:

- shipped
- in progress
- not started
