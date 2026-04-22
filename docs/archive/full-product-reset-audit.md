# Stream247 Full Product Reset Audit

Updated: 2026-04-21

This document is the honest audit that precedes the Phase 4 reset. It does not describe plans. It describes what exists today, what works, what is broken, what is legacy, and what is confusing. The companion planning document is `docs/archive/full-product-reset-plan.md`.

---

## Product Status Overview

Stream247 is a functional, self-hosted 24/7 broadcast automation platform. The core runtime — pool rotation, FFmpeg playout, RTMP delivery, worker supervision, and the Scene Studio overlay pipeline — works correctly and has been hardened through M19 reliability work and Phase 3 (M21–M28) correctness fixes.

Phase 3 shipped significant improvements:

- Per-video metadata editing (title prefix, hashtags, category, notes)
- Correct overlay text (no pool names, no empty `[]` containers)
- Schedule video-level timeline (video slots per block)
- Output profiles (720p/1080p/480p/360p)
- Chat overlay and follow/sub alerts
- EventSub auto-registration
- Navigation IA refresh

The product is substantially better than it was before Phase 3. The remaining gaps are real but addressable.

---

## What Is Good

### Core runtime

The FFmpeg playout pipeline is solid. Program feed → relay → uplink architecture gives the external RTMP delivery stable input. Playout supervision handles crashes, reconnects, fallback destinations, and crash-loop protection correctly. The soak monitor and release rehearsal gates provide real runtime validation.

### Overlay pipeline

The rendering model is correct: Scene Studio publishes a scene payload, Chromium captures `/overlay?chromeless=1`, FFmpeg composites the PNG frame. This is a clean architecture for in-stream overlay. The engagement layer (chat, alerts) sits inside this same capture — no second pipeline.

### Phase 3 correctness fixes

All of these are confirmed shipped and correct:

- `visibleOverlayText` guards prevent `[]` from rendering
- `lookaheadVideoTitleFromPool` prevents pool names from reaching viewers
- `buildAssetDisplayTitle` and `buildTwitchMetadataTitle` handle prefix and hashtags correctly
- `syncTwitchEventSubSubscriptions` handles registration, duplicate prevention, and cleanup
- `title_prefix`, `hashtags_json`, `platform_notes` schema fields are live

### Release and ops tooling

`pnpm validate`, `pnpm test:fresh-db`, `pnpm test:fresh-compose`, `docker/smoke-test.sh`, `scripts/upgrade-rehearsal.sh`, `scripts/soak-monitor.sh`, and `scripts/release-preflight.sh` collectively provide a strong release safety baseline. These are a genuine differentiator for a self-hosted product.

### Worker modularization

The worker is no longer a single monolith. Separate modules exist for: broadcast-queue, audio-lanes, cuepoints, ffmpeg-runtime, on-air-scene, output-settings, twitch-engagement, twitch-eventsub, twitch-metadata, twitch-vod-cache, asset-display-title, multi-output, runtime-log. `index.ts` still orchestrates everything but is no longer the only file.

### Navigation IA (post-M26)

The four-section navigation (Control Room, Programming, Stream Studio, Workspace) is correct in its high-level organization. The section names are clear and the groupings make sense for operator workflows.

---

## What Is Bad

### No React component primitives

The web app has 50+ components but no shared primitive layer. There is no typed `Button`, `Card`, `Badge`, `Input`, or `Select` component. Every component invents its own CSS class usage. This means:

- Bugs like empty badge rendering can recur because there is no central `Badge` that enforces the `visibleOverlayText` guard pattern
- Refactoring any shared UI behavior requires touching 50 files
- New components cannot compose from a stable base

### `Library` navigation item conflates three concepts

The `Library` nav item at `/sources` combines source ingestion pipelines (YouTube channels, Twitch VOD sources, direct URLs), asset browsing, uploads, pools, and curated sets. These are distinct operator concepts:

- **Sources** = where media comes from (ingest pipelines)
- **Library** = the actual video files and their metadata
- **Pools** = programming logic (which assets get scheduled together)

Putting all three under one nav item creates confusion for operators trying to understand why "adding a source" and "editing a video" are on the same page.

### The `!here` command does not work

`TwitchChatBridge` in `apps/worker/src/twitch-engagement.ts` connects to Twitch IRC and maintains a ring buffer of incoming messages. It does not parse commands. The message text is stored for the chat overlay but never inspected for command patterns.

The moderation presence feature (`!here 30`) has a complete settings UI, a complete database schema, and a complete doc (`docs/moderation-policies.md`). None of it fires because the IRC bridge never dispatches commands.

This is a broken promise, not a missing feature.

### Streamer live status is not surfaced

`/api/channel/live/route.ts` exists. The Broadcast page does not show a LIVE badge with viewer count. The Dashboard does not show whether the broadcaster is currently live on Twitch. Operators must leave the admin UI to check this.

### Safe-area clamping is now implemented

`live-overlay.tsx` sets `--overlay-output-width` and `--overlay-output-height` CSS custom properties, and `globals.css` now consumes them for the public overlay layout. The safe-area variables (`--safe-area-top/right/bottom/left`) are defined from the active output dimensions, engagement widgets use those insets, and positioned Scene Studio layers clamp into the 90% safe-area coordinate space.

The result: positioned Scene Studio layers and engagement widgets now stay inside the visible frame area by default across the shipped output profiles.

### Donation and bits alerts are absent

The Overlays admin section has no placeholder for donation/bits alerts. There is no "coming soon" indication. Operators who expect full alert coverage will not find it.

### Multi-quality output is not implemented

M24 added output profiles, which let the operator select one quality preset. Simultaneous multi-quality (sending 720p to Twitch and 360p to YouTube at the same time) is not implemented. There is no error message, no placeholder, and no documentation explaining the current limitation.

### The sidebar has an "Operator model" description card

The current sidebar renders a description paragraph beneath each navigation section header. Example: "Compose viewer scenes, dynamic overlays, and output shape." This takes up vertical space without adding navigation utility. Operators who use the product daily do not need to read what "Stream Studio" does every time they open the sidebar.

---

## What Is Legacy

### Three "completed planning" docs in `/docs`

`docs/redesign-and-product-plan.md`, `docs/video-planning-and-metadata-model.md`, and `docs/in-stream-overlay-and-output-strategy.md` were written during Phase 3 planning to describe the target state. The features described in them are now shipped. These documents are implementation notes for completed work. They do not describe the current product correctly (they mix future tense with present tense) and should not be part of the permanent documentation set.

### `docs/stream247-upstream-gyre-gap-analysis.md`

This file is a two-paragraph stub that says "this file has been superseded, see `upstream-gap-analysis.md`." It provides no value and should be deleted immediately.

### `docs/upstream-gap-analysis.md` and `docs/upstream-roadmap.md`

These are internal competitive analysis documents. They compare Stream247 against a specific commercial competitor. They do not belong in a public repository's documentation set. They are useful as internal references but should be removed from `/docs` and not treated as product documentation.

### The "Channel Blueprints" headline

Channel Blueprints export/import lives under Settings and works correctly. The name does not need to appear in navigation labels, section descriptions, or doc headlines. It is a Settings feature, not a product identity.

---

## What Is Confusing

### Library vs Sources naming

In the navigation, "Library" at `/sources` is the route for all media management. The URL says `sources`, the nav label says `Library`. Inside the page, the content includes source ingestion forms, asset browsing, pool management, and upload forms. None of these activities have a consistent visual separation. An operator who wants to "upload a video" and an operator who wants to "add a YouTube playlist source" both go to the same page and must figure out which section applies.

### Long PLANS.md

`PLANS.md` is the canonical milestone and execution plan. It now contains M0 through M28 — 28 milestones across three major phases, plus rollback notes, validation commands, and progress notes covering years of development. The progress notes section alone runs from M0 to M19 to M21–M28 in reverse chronological order. A new contributor reading PLANS.md to understand the current state of the product will find it nearly impenetrable.

### Operations vs Dashboard separation

The navigation has both `Dashboard` (readiness and overview) and `Operations` (incidents and drift) as separate pages. From an operator's perspective, these answer the same question: "is everything okay?" Having two pages means checking two places to get a complete picture of broadcast health.

### Settings conflation

The Settings page mixes: owner credentials, 2FA, Twitch OAuth connection, Discord webhook, SMTP alerts, team access, secrets management, Channel Blueprints, and moderation policy. Some of these (Twitch OAuth, moderation policy) belong in integration-focused flows. Others (team access, secrets) are workspace administration. Grouping everything as "Settings" makes the page long and unfocused.

---

## User Wish Evaluation

| Wish | Status | Evidence |
|---|---|---|
| `!here 5` does not work in chat | **MET** | `TwitchChatBridge` now parses moderator/broadcaster `!here` commands and updates the moderation presence window. |
| Overlay for 24/7 stream, not external | **MET** | Rendering pipeline is in-stream. `/overlay` page positioning is ambiguous but the actual model is correct. |
| Control what is shown in-stream | **PARTIALLY MET** | Scene Studio layers, engagement controls, and safe-area defaults exist. Donation alerts are still missing. |
| Planning shows which video runs when | **MET** | M23 `videoSlots` and `schedule-video-timeline` component. |
| Visible live status when streamer is live | **PARTIALLY MET** | API exists (`/api/channel/live`). No admin UI surface shows this. |
| Category handling wrong | **PARTIALLY MET** | Per-video category override (M22) done. Timestamp-based category changes not done. |
| Title prefix like "Replay:" | **MET** | `title_prefix` field, `buildAssetDisplayTitle`, edit form — all shipped in M21/M22. |
| Hashtags wrong | **MET** | `hashtags_json`, `buildTwitchMetadataTitle`, edit form — all shipped in M21/M22. |
| Overlay too large at 360p on YouTube | **MET** | The public overlay now consumes `--overlay-output-width/height`, clamps positioned layers into the 90% safe area, and enforces a 12px text floor at 360p. |
| Next item shows real title | **MET** | M21/M28 fixed with `lookaheadVideoTitleFromPool`. Fallback is "Coming up next". |
| Menus break with long titles | **MET** | M26 added `truncate-title`, `line-clamp-2`, and stacked form layout. |
| Chat overlay and follow/sub alerts | **PARTIALLY MET** | Chat + follow/sub alerts implemented (M25/M28). Donation/bits not implemented. |
| Fun interaction/mini-game for chat | **UNMET** | No implementation. No foundation (chat commands don't work). Defer. |
| Containers unhealthy | **SUBSTANTIALLY MET** | M19.4/M27 improved. Soak monitor and restart tracking in place. Chromium long-run memory still monitored. |
| Full React-first redesign | **PARTIALLY MET** | Navigation IA and first typed React primitives are shipped. No design system and no full visual-language rollout yet. |
| `[]` empty bracket bug | **MET** | M21/M28 fixed via `visibleOverlayText` guard. |
| Missing resolution/FPS settings | **MET** | M24 output profiles and admin Output page. |
| Multiple quality support | **UNMET** | One output profile per stream. No simultaneous multi-quality. |
| Categories editable per video | **MET** | M22 per-video category edit. |
| Video metadata editable per video | **MET** | M22 per-video metadata edit panel. |

---

## Concrete Findings

**Finding 1 (resolved 2026-04-21)**: The `!here` moderation command is now wired through the Twitch IRC bridge, restricted to moderator/broadcaster messages, and updates the moderation presence window without requiring a parallel UI action.

**Finding 2 (resolved 2026-04-21)**: The safe-area CSS variables now exist, the public overlay consumes the output-dimension vars in CSS, engagement widgets respect safe-area insets, and positioned custom layers clamp into the safe area by default.

**Finding 3 (resolved 2026-04-21)**: The admin navigation now separates Sources (ingest), Library (assets/uploads), and Pools (programming), which removes the main IA ambiguity without changing the underlying data model.

**Finding 4**: `docs/stream247-upstream-gyre-gap-analysis.md` is a two-paragraph redirect stub. It should have been deleted when the actual file was superseded. Delete it.

**Finding 5**: Four docs in `/docs` are implementation planning artifacts for completed work (redesign-and-product-plan, video-planning-and-metadata-model, in-stream-overlay-and-output-strategy, upstream-roadmap/gap-analysis). They create confusion because they describe Phase 3 targets in future tense, making it hard to know what is real. They should be deleted and replaced by accurate present-tense product docs.

**Finding 6**: The Broadcast page does not show whether the broadcaster is currently live on Twitch. This information is a click away in the Twitch dashboard but is not surfaced in Stream247. For a product whose core job is managing a live stream, this is a meaningful gap.

**Finding 7 (resolved 2026-04-21)**: A first typed primitive layer (`Badge`, `Button`, `Card`, `Input`, `Select`, `PageHeader`, `StatusChip`) now exists, which centralizes the empty-content guard and reduces UI drift across admin surfaces.
