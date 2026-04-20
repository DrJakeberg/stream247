# Stream247 Redesign And Product Plan

Updated: 2026-04-20

This document is the primary planning reference for the next development phase. It covers the full product direction, UX strategy, information architecture, and milestone rationale. The companion documents `docs/video-planning-and-metadata-model.md` and `docs/in-stream-overlay-and-output-strategy.md` expand the two most complex topic areas. The milestone sequence in `PLANS.md` (M21 onward) is the canonical implementation queue.

---

## A. Current State Summary

### What Exists Today

The current codebase is a capable self-hosted 24/7 stream automation platform. The following features are confirmed working:

- Local and remote source ingestion (local uploads, YouTube playlists, Twitch VODs)
- Weekly schedule blocks with pools, show profiles, templates, and repeat sets
- Materialized fill preview simulating pool rotation and natural durations
- FFmpeg-based playout with RTMP delivery to primary/backup destinations
- Multi-output fanout with per-destination recovery
- SSE-driven broadcast control room with current/next/queue visibility
- Scene Studio with draft/publish workflow, positioned layers, metadata widgets, typography presets
- On-air scene renderer compositing Chromium-captured overlay into the FFmpeg stream
- `Live Bridge` for live RTMP/HLS takeover and return to queue
- Pool-scoped replace-mode audio lanes and safe-boundary cuepoint inserts
- Asset folders, tags, thumbnails, grouped browsing, and curated sets
- Channel Blueprints for export/import of scene, programming, and source config
- Optional 2FA, team roles, Twitch SSO
- Incidents, readiness, upgrade rehearsal, soak monitor, and release preflight gates
- Persistent program feed / uplink split for external RTMP continuity

### Phase 3 Status After Implementation

**Fixed in M21-M28:**

- The in-stream overlay no longer shows raw pool names, empty `[]` containers, or the old "Scheduling next item" fallback
- Asset metadata now includes `title_prefix`, `hashtags_json`, and `platform_notes`
- The media library includes per-video metadata editing for title, prefix, category, hashtags, notes, programming inclusion, and fallback priority
- Schedule preview includes video-level `videoSlots`, and the schedule page has an expandable timeline view
- Broadcast and overlay "next" copy prefer video-level pool lookahead
- Output profiles, output resolution/FPS settings, overlay viewport alignment, and optional FFmpeg scale/pad behavior are implemented
- Chat overlay, follow/sub alerts, EventSub receiving, EventSub auto-registration, and the Overlays admin page are implemented and disabled by default
- Admin navigation and layout now follow the Phase 3 information architecture, with improved long-title safety and stacked form ergonomics
- SSE connection tracking and soak restart monitoring are implemented

**Remaining caveats:**

- Full safe-area clamping for arbitrary positioned overlay layers is still future work; M24 delivered sizing and scaling, not clamping
- Twitch accounts connected before EventSub auto-registration shipped may need to reconnect once to grant `moderator:read:followers` and `channel:read:subscriptions`
- Donation/bits/channel-point alerts are not implemented yet
- Twitch timestamp-derived per-segment category changes during a long video are not implemented yet
- Multi-quality output is still future work; M24 added one active output profile at a time

### What Is Misleading in the Current Docs or UI

- Historical docs that describe M21-M27 as future work are now stale; `PLANS.md` is the canonical completed-state reference after M28.
- Safe-area language must be read as target behavior only. M24 shipped output sizing/scaling, but not full safe-area clamping for arbitrary positioned layers.
- The `category_name` on assets flows to Twitch as an asset/block-level category. Timestamp-derived category changes during a long video are still future work.

---

## B. Product Goals

### What The Product Should Become

Stream247 should be the operator's single control surface for everything visible inside the live stream and everything that drives the automation behind it. The product direction has two clear axes:

1. **Reliability axis**: the stream should always be on air, the operator should always know what is happening, and the overlay should never show placeholder text to viewers.

2. **Control axis**: the operator should be able to see and edit every detail that affects the stream — from which specific video plays next to what the in-stream overlay displays and how the Twitch title and category are set.

### What The Overlay Is And Is Not

The overlay is **not** an external product, a widget builder for third-party tools, or an OBS-style scene compositor for live streaming from a browser.

The overlay **is** the visual layer composited directly into the automated 24/7 stream output. Its job is to show viewers what is currently playing, what is coming next, and any channel-level branding the operator wants. Everything in Scene Studio is ultimately rendered into the FFmpeg output that goes to Twitch/YouTube.

Engagement features (chat overlay, alerts) also belong here — as in-stream widgets that are part of the composited output, not as an external overlay product.

### What Planning Should Show

Planning should move from pool-level to video-level visibility:

- Today: schedule block "Morning Rotation" (2h), pool "TwitchPool", 4 slots filled
- Target: schedule block "Morning Rotation" (2h), pool "TwitchPool", videos: ["Tarkov Day 47", "Battlefield Night", "Warzone Highlights"], next predicted start times visible

This does not require executing the full pool rotation in advance. A lookahead preview from the current pool cursor is sufficient and realistic.

### What Metadata Editing Should Support

In the media library, operators should be able to edit per-video:

- Display title (override the ingested title)
- Title prefix (e.g. "Replay:", "Music:", "VOD:")
- Category (override the ingested Twitch/YouTube category)
- Hashtags (a new field, distinct from library tags)
- Notes (for operator reference)

These fields feed directly into: what gets sent as the Twitch stream title, what appears in the in-stream overlay, and what categories are synced to the Twitch schedule.

### What Operator Experience Should Feel Like

- The broadcast control room should make it immediately obvious: what is on air, is the streamer currently live, what plays next (by title), and whether anything is degraded
- The schedule should be legible without needing to mentally translate "pool + block duration = estimated videos"
- The metadata library should feel like a proper media manager, not a diagnostic surface
- No label or title should ever be a raw pool name, a JSON array literal, or a placeholder text visible to stream viewers

---

## C. Information Architecture and UX Direction

### Recommended Navigation Structure

Keep the current top-level sections but clarify their roles and fix internal page structure:

```
Control Room
  ├── Broadcast         (live controls, current/next/queue, destination status)
  └── Dashboard         (readiness, health, incidents, system overview)

Programming
  ├── Schedule          (week view + video-level timeline)
  ├── Pools             (pool membership, playback mode, insert rules)
  └── Library           (media browser, per-video metadata editor)

Stream Studio
  ├── Scene Studio      (in-stream overlay editor)
  ├── Overlays          (chat overlay, alerts, engagement widgets)
  └── Output            (output profiles, resolution, FPS, destinations)

Workspace
  ├── Sources           (source management and sync)
  ├── Team              (access control)
  └── Settings          (channel config, Twitch/YouTube integration)
```

The key change from today: `Overlays` becomes a first-class section distinct from `Scene Studio`. Scene Studio controls the visual composition (background layers, branding, widgets). Overlays controls the dynamic engagement layer (chat, alerts). Output gets promoted to a named section with real settings.

### Recommended Page Structure

**Broadcast page:**
- Top row: on-air status card (current video title, thumbnail if available, elapsed/remaining time)
- Second row: next-up card (actual video title, NOT a pool name), then queue preview (3–5 items by title)
- Live-state widget: clearly indicates if the connected Twitch channel is currently live (LIVE badge, viewer count if available)
- Destination group: all outputs with health indicators
- Action bar at bottom: standard operator actions (skip, insert, fallback, reconnect)

**Schedule page:**
- Week grid at top (current view — keep)
- Below the grid: timeline expansion per day showing video-level slots (see Section D)
- Side panel: block editor (opens inline, not modal) with stacked form fields

**Library page:**
- Grid/list view with thumbnail, title, source, duration, category
- Click to open per-video edit panel (stacked fields: title, prefix, category, hashtags, notes)
- No layout breakage: all edit fields are stacked, not inline

**Scene Studio page:**
- Canvas preview area (not editable by drag-drop yet — keep form-based)
- Layer list on the left
- Properties panel on the right, with stacked field groups
- Critical fix: long layer names must not overflow the panel or the canvas label

**Output page (new):**
- Output profile selector (resolution, FPS, bitrate preset names)
- Per-destination settings (RTMP URL, stream key, role)
- Resolution and FPS as first-class dropdowns, not env vars

### How To Avoid Long-Title Layout Breakage

The root cause is that long text strings are placed in flex or grid cells that can overflow horizontally. The fix is a set of consistent CSS rules applied across all admin surfaces:

- All text labels in cards, lists, and form rows use `truncate` (single-line, text-overflow: ellipsis) with a fixed max-width
- Multi-line title display uses `line-clamp-2` or `line-clamp-3` with explicit overflow hidden
- Form fields for title entry use `w-full` with max-character feedback, not inline compressed layout
- The overlay designer layer list enforces a max-width per layer name entry with tooltip on hover
- Stacked form layout is the default for any group of more than two fields: label above, input below, full width

This is a styling discipline issue, not an architectural one. It can be applied milestone by milestone across pages.

---

## D. Scheduling and Metadata Model

Full detail in `docs/video-planning-and-metadata-model.md`. Summary:

### Pool-to-Video Visibility

The schedule block knows its `pool_id`. The pool knows its `cursor_asset_id` (the last played asset). A lookahead preview can simulate forward rotation from the cursor to produce a predicted video title list for the next N slots within a schedule block duration.

This does not require storing the predicted titles permanently — it can be computed on-demand by the schedule preview API and materialized into the broadcast snapshot for the "next" label.

**Implemented in M21/M28**: When building `nextTitle` for the overlay text and broadcast snapshot, Stream247 walks one step forward from the pool cursor to find the predicted next asset title instead of using the schedule block title or the old placeholder fallback. The neutral empty state is "Coming up next".

**Deeper fix** (M23): Show the full video-level lookahead in the schedule timeline UI, allowing operators to see predicted video titles within each schedule slot.

### Title Prefix

Add `title_prefix TEXT NOT NULL DEFAULT ''` to the `assets` table. When Twitch metadata is synced, the sent title becomes `[title_prefix + " " + title]` if a prefix is set, otherwise just `title`. The in-stream overlay uses the prefixed title as the display title for the current item.

### Hashtags

Add `hashtags_json TEXT NOT NULL DEFAULT '[]'` to the `assets` table (distinct from `tags_json` which is library curation). Hashtags are appended to the Twitch stream title during metadata sync. The empty-container `[]` visual bug in the overlay is related to empty tag/label containers being rendered — fix by conditionally hiding containers when content is empty.

### Category Improvements

The current `category_name` on assets and schedule blocks is a single static value. This is correct and sufficient for most use cases. The Twitch timestamp-based category support would require storing per-timestamp segments with start-offset and category-name pairs on the asset. This is a data model change that is valuable but not urgent.

Implemented in M22: the library edit form allows per-video category override. The category from the asset is preferred over the schedule block category when syncing Twitch metadata.

For later: if Twitch timestamp data is ingested (Twitch VODs have chapter markers), those can be stored as a `timestamps_json` field on assets and used to update the live Twitch category as the video progresses. This is complex and belongs in a later milestone.

### Per-Video Metadata Editing in the Library

The library assets page now includes a per-video edit panel with these writable fields:
- `title` (override display title)
- `title_prefix` (new field, M21 schema)
- `category_name` (override Twitch/YouTube category)
- `hashtags_json` (new field, M21 schema)
- `include_in_programming` (already exists)
- `fallback_priority` (already exists)

The API route `PATCH /api/assets/[id]` writes these fields with targeted updates.

---

## E. Overlay and Output Model

Full detail in `docs/in-stream-overlay-and-output-strategy.md`. Summary:

### In-Stream Widgets

The current Scene Studio already has custom layers (text, logo, image, embed, widget). The engagement layer (chat, alerts) is a separate concern — these are dynamic real-time widgets that need a live data feed, not a static scene layer.

Recommended model: add an `Overlays` section that manages engagement widgets independently from Scene Studio scenes. These widgets are injected as additional DOM elements on the public overlay page and composited into the stream by the existing Chromium renderer. They do not replace Scene Studio — they layer on top.

### Chat Overlay

The chat overlay reads from Twitch's EventSub or IRC API and renders incoming chat messages as a scrolling ticker or bubble list in the composited overlay. It must work with 1 active chatter (quiet single-message display) and 30+ active chatters (scrolling with rate limiting). This requires:

1. A new server-side Twitch chat connection (EventSub or IRC) in the worker or a dedicated process
2. A real-time feed to the overlay page (via SSE or WebSocket)
3. A chat overlay DOM component on the overlay page
4. Controls in the Overlays admin section (position, style, message count, rate limit)

### Alerts

Follow/sub/donation alerts are triggered by Twitch EventSub events. They require:
1. Twitch EventSub webhook subscription for follows, subscriptions, and channel point redeems
2. A real-time event queue piped to the overlay page
3. Alert animation components on the overlay page
4. Controls in the Overlays admin section (alert type, duration, sound, animation)

For M25, start with follow and subscription alerts. Donation/bits can follow.

### Safe Area Strategy

The overlay page should define a `data-safe-area` container with configurable inset margins (default: 5% on all sides for 1080p). Scene Studio layers and engagement widgets should be positioned relative to this safe area, not the raw viewport. This remains a caveat after M24; output sizing and scaling are implemented, but full clamping is not.

### 360p Behavior

When the output is 360p (either because the source video is 360p or `SCENE_RENDER_HEIGHT` is set to 360), the overlay must remain legible. The fix:
- Scale font sizes relative to viewport height (CSS `vh` units or a CSS variable `--overlay-scale`)
- Minimum font size floor at readable sizes
- Chat overlay and alerts must have a minimum line height

### Output Resolution and FPS

Add first-class env vars and admin settings for:
- `STREAM_OUTPUT_WIDTH` (default: 1280)
- `STREAM_OUTPUT_HEIGHT` (default: 720)
- `STREAM_OUTPUT_FPS` (default: 30)

These drive: the standby slate dimensions, the scene renderer viewport, and optionally a `-vf scale=WxH` filter in the FFmpeg output pipeline.

### Output Profiles

An output profile is a named preset combining resolution, FPS, and bitrate settings. Examples:
- `720p30` (1280x720, 30fps, 4500k/9000k)
- `1080p30` (1920x1080, 30fps, 6000k/12000k)
- `360p30` (640x360, 30fps, 1500k/3000k)

For M24, output profiles are stored as a channel-level setting and drive the FFmpeg args. Multi-quality output (e.g., publishing 1080p to one destination and 720p to another) is a later milestone.

### What Is Realistic Now Versus Later

**Shipped in M21-M28:**
- Empty `[]` brackets and old fallback copy fixed
- Title prefix and hashtags schema added
- Per-video metadata edit form added
- Video-level schedule lookahead and timeline added
- First-class resolution/FPS settings and output profiles added
- Chat overlay and follow/sub alerts added
- EventSub follow/sub auto-registration added
- Full Phase 3 admin navigation/layout redesign added
- SSE connection tracking and soak restart monitoring added

**Later:**
- Full overlay safe-area clamping
- Donation/bits/channel-point alerts
- Multi-quality output (multiple FFmpeg outputs at different resolutions)
- Twitch timestamp-derived category updates during playback

---

## F. Reliability and Operational Work

### Unhealthy Containers

Several containers can become unhealthy over time, particularly the `web` process (file descriptor leaks from SSE connections), the `worker` (process leak from Chromium children, already partially addressed in M19.4), and `playout` (HLS handoff edge cases addressed in M20.5).

Remaining known risks:
- Long-run Chromium memory growth still needs more production-duration samples beyond the documented baseline
- `redis` and `postgres` containers have restart policies and health checks, but no dedicated alerting channel beyond readiness/soak monitoring
- EventSub registration depends on public HTTPS `APP_URL` and the broadcaster granting the new scopes

M27 added SSE cleanup/connection counts, soak restart-count checks, and the initial long-run memory/FD baseline.

### What Must Be Hardened Before Release Work Continues

Before the next release or DUT soak, verify:
- M28 EventSub auto-registration on a public HTTPS deployment
- no regression in overlay fallback text
- `pnpm validate` and release preflight remain green

### Product Milestones vs Ops Milestones

Product milestones (M21-M26) delivered user-visible improvements and can ship incrementally. Each milestone must pass `pnpm validate` and the existing smoke/release checks.

Ops milestones (M27 and later) address underlying reliability and should run in parallel or between product milestones when the product is stable enough to merit it.

---

## G. Milestone Proposal

See `PLANS.md` M21-M28 for the canonical completed milestone definitions, caveats, and validation commands.

Summary sequence and rationale:

| Milestone | Name | Why This Order |
|---|---|---|
| M21 | Overlay Text Correctness | Visible bugs in the live stream — highest immediate damage to credibility. Quick win. |
| M22 | Metadata V2 And Per-Video Edit | Foundation for correct Twitch title/category sync. Unlocks M23 title display. |
| M23 | Schedule Video-Level Visibility | Builds on M22 metadata model. Pool-to-video lookahead. |
| M24 | Output Profiles And Stream Settings | Unblocks overlay safe areas and 360p fix. Relatively independent. |
| M25 | In-Stream Engagement Layer | Adds chat and alerts. Requires stable overlay pipeline from M21/M24. |
| M26 | UI Redesign V1 | Wraps all previous improvements in a coherent visual design. Last. |
| M27 | Container Reliability And Ops | Adds SSE cleanup, soak restart monitoring, and baseline docs. |
| M28 | Phase 3 Audit Stabilization | Adds EventSub auto-registration, fallback copy fix, and docs alignment after acceptance audit. |

---

## H. Recommended Next Step

Validate the M28 stabilization on a public deployment:

1. Confirm `APP_URL` is HTTPS and `TWITCH_EVENTSUB_SECRET` is set.
2. Reconnect Twitch once if the channel was connected before the new EventSub scopes were added.
3. Enable alerts and verify the worker creates `channel.follow` and `channel.subscribe` subscriptions without manual Twitch CLI steps.

After that validation, the next scoped product candidate is the safe-area clamping caveat. Do not start mini-game or live-status-widget work until explicitly selected.
