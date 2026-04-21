# In-Stream Overlay And Output Strategy

Updated: 2026-04-20

This document covers the overlay rendering pipeline, engagement layer, safe area strategy, output resolution model, and output profiles. It is the implementation reference for M21 (overlay correctness), M24 (output profiles), and M25 (engagement layer).

---

## What The Overlay Pipeline Does Today

```
Scene Studio (admin UI)
    ↓ draft/publish
Overlay page (/overlay?chromeless=1)
    ↓ Chromium headless capture (every SCENE_RENDER_INTERVAL_MS)
PNG frame pipe (file descriptor 3)
    ↓ FFmpeg overlay filter
Output stream (RTMP to Twitch/YouTube)
```

The overlay page is a browser page. Chromium renders it and takes a screenshot. FFmpeg composites that screenshot as an alpha-channel overlay on top of the video output. This is the core rendering chain and it works.

Phase 3 fixed the highest-impact upstream data issues:
1. Title data now prefers video-level pool lookahead and uses the neutral fallback "Coming up next"
2. The overlay page and text builders suppress empty strings and raw `[]` values
3. Output profiles align the overlay viewport with the configured output dimensions
4. Chat plus follow/sub/cheer/channel-point alert widgets are injected into the same captured overlay page

Remaining caveat: full safe-area clamping for arbitrary positioned layers is not implemented yet. Output sizing and scaling are implemented; safe-area constraints should be handled in a later focused milestone.

---

## Problem 1 — Wrong Label Data

### Root Cause

Before M21/M28, `buildOverlayTextLinesFromScenePayload` and `buildWorkerScenePayload` could receive a `nextTitle` value sourced from the next schedule block title instead of the next video title, and one worker fallback used the string `"Scheduling next item"`.

Similarly, queue items in the overlay show pool-derived titles when the queue is populated with schedule-block-level entries rather than asset-level entries.

### Fix (M21)

In `buildWorkerScenePayload` (or its callers in `apps/worker/src/index.ts`), replace the `nextTitle` fallback path with a pool lookahead:

```typescript
// Current behavior
nextTitle: overrides.nextTitle
         || lookaheadVideoTitleFromPool(nextScheduleItem?.poolId, state)
         || nextScheduleItem?.title
         || "Coming up next"
```

`"Coming up next"` is the correct empty state — neutral and never pool-specific. Never show a raw pool name or a JSON array to viewers.

Similarly, `currentTitle` should use the prefixed display title when a `titlePrefix` is set:

```typescript
const displayTitle = [asset?.titlePrefix, asset?.title].filter(Boolean).join(" ");
currentTitle: overrides.currentTitle || displayTitle || state.playout.currentTitle || "On air"
```

---

## Problem 2 — Empty `[]` Bracket Containers

### Root Cause

The overlay page has badge/label UI components that always render their container element even when the content string is empty. The default `tags_json` value is `'[]'` and this string may be reaching the overlay rendering path without being parsed.

There are two likely sources:
1. A badge component renders `<span class="badge">{value}</span>` where `value` is `""` or `"[]"` — the container is visible even with no text, because it has padding and background
2. The `queueTitleLine` or some field is being passed as the raw JSON string `"[]"` instead of an empty string

### Fix (M21)

**Component-level fix**: All badge, chip, and label components in the overlay page must conditionally render:

```tsx
// Guard pattern for every label/badge container
{value?.trim() ? <span className="badge">{value.trim()}</span> : null}
```

**Data-level fix**: Audit every field that flows from the database through the scene payload to the overlay page renderer. Specifically:
- `tags_json` must NEVER flow to the overlay renderer — it is a library curation field only
- `queueTitles` must always be filtered to non-empty strings before being passed to the payload builder (already does `.filter(Boolean)` but verify the raw JSON path)
- Any field with default `'[]'` in the DB must be parsed before use; never pass the string `"[]"` to a display function

**Test coverage**: Add a unit test that passes an empty `queueTitles`, empty `categoryName`, empty `sourceName`, and verifies that no line in the output of `buildOverlayTextLinesFromScenePayload` contains `"[]"`.

---

## Overlay Safe Area Strategy (M24)

### Concept

A safe area is the region of the video frame that is guaranteed to be fully visible on all output devices. In broadcast convention this is typically 90% of the frame (5% inset on all sides). For a 1280x720 output this is a 1216x648 region centered at (32, 36).

Stream247 should define a safe area CSS variable on the overlay page that all positioned layers respect. This is still future work; M24 shipped output profile sizing, viewport alignment, and scaling, but not safe-area clamping:

```css
:root {
  --safe-area-top:    calc(var(--overlay-height) * 0.05);
  --safe-area-right:  calc(var(--overlay-width)  * 0.05);
  --safe-area-bottom: calc(var(--overlay-height) * 0.05);
  --safe-area-left:   calc(var(--overlay-width)  * 0.05);
}
```

Target behavior: the overlay page's root container should use these to inset its layout. Scene Studio custom layers that use `position: absolute` coordinates should be clamped to the safe area by default, with an explicit "allow outside safe area" toggle for operators who know what they are doing.

### 360p Behavior

When `SCENE_RENDER_HEIGHT` is set to 360 (or the output is 360p due to a low-bitrate profile), the overlay content must remain legible. The approach:

1. Define a CSS scaling variable based on viewport height:

```css
:root {
  --overlay-scale: min(1, calc(var(--overlay-height) / 720));
}
```

2. Use `calc(Xpx * var(--overlay-scale))` for all font sizes and spacing in the overlay components
3. Set a minimum font size floor: `max(10px, calc(14px * var(--overlay-scale)))`

This ensures that at 360p the overlay scales down proportionally without becoming illegibly small.

### Viewport Alignment

The overlay viewport (from `getSceneRendererViewport`) now resolves from output settings and env overrides. After M24:

- `STREAM_OUTPUT_WIDTH` and `STREAM_OUTPUT_HEIGHT` are the canonical source of truth for output dimensions
- `getSceneRendererViewport` reads these values
- The standby slate uses `color=c=...:s=${width}x${height}:r=${fps}` constructed from these values
- The FFmpeg video filter adds `-vf scale=${width}:${height}` to normalize input video to the target output resolution

---

## Output Resolution and FPS Settings (M24)

### New Environment Variables

Add these to `stack.env.example` and document them in the deployment guide:

```bash
# Output resolution and frame rate
STREAM_OUTPUT_WIDTH=1280
STREAM_OUTPUT_HEIGHT=720
STREAM_OUTPUT_FPS=30

# Output bitrate (can override per-profile)
FFMPEG_VIDEO_BITRATE=4500k    # replaces implicit 4500k in FFMPEG_MAXRATE
FFMPEG_BUFFER_SIZE=9000k      # replaces implicit 9000k in FFMPEG_BUFSIZE
```

### Output Profile Admin Setting

Add a channel-level setting `output_profile` to the `managed_config` or overlay settings table. Profiles are named presets:

| Profile | Width | Height | FPS | Video Bitrate | Buffer |
|---|---|---|---|---|---|
| `720p30` | 1280 | 720 | 30 | 4500k | 9000k |
| `1080p30` | 1920 | 1080 | 30 | 6000k | 12000k |
| `480p30` | 854 | 480 | 30 | 2500k | 5000k |
| `360p30` | 640 | 360 | 30 | 1200k | 2400k |
| `custom` | (use STREAM_OUTPUT_* env vars) | | | | |

In the admin Output settings page, a dropdown selects the profile. Custom mode exposes text fields for width, height, FPS, and bitrate. The profile selection is stored in the database and read by the worker at startup.

### FFmpeg Pipeline Changes

When a profile is active, the playout FFmpeg commands receive:

1. A scale filter to normalize input video: `-vf scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`
2. The correct standby slate dimensions: `color=c=0x0b1f18:s=${width}x${height}:r=${fps}`
3. The profile bitrate values in `-maxrate` and `-bufsize`

The scale filter uses `pad` to letterbox content that does not match the target aspect ratio, rather than distorting it.

### Rollback

Profile feature is behind the existing `FFMPEG_*` env vars. If `STREAM_OUTPUT_WIDTH` is not set, the behavior is identical to today (defaults to 1280x720). The scale filter is added only when a profile is explicitly active. This is a safe additive change.

---

## In-Stream Engagement Layer (M25)

### Architecture

The engagement layer is a set of dynamic overlay components that run on top of the Scene Studio output. They are injected into the same public overlay page (`/overlay?chromeless=1`) that Chromium already captures. This means no change to the capture or compositing pipeline.

```
Overlay page structure:
┌─────────────────────────────────────────┐
│  Scene Studio output (static composition) │
│  ┌───────────────────────────────────┐   │
│  │  Engagement layer (dynamic)       │   │
│  │  ┌────────────────────────────┐   │   │
│  │  │  Chat overlay              │   │   │
│  │  └────────────────────────────┘   │   │
│  │  ┌────────────────────────────┐   │   │
│  │  │  Alert container           │   │   │
│  │  └────────────────────────────┘   │   │
│  └───────────────────────────────────┘   │
└─────────────────────────────────────────┘
```

The engagement layer components receive their data via a new SSE endpoint: `/api/overlay/events`. This endpoint pushes real-time events (new chat messages, new follower alerts, etc.) to the overlay page.

### Chat Overlay

**Data source**: Twitch IRC via the existing Twitch connection. The worker connects to Twitch IRC when a Twitch broadcaster is authenticated. Incoming messages are:
1. Stored in a short in-memory ring buffer (last 50 messages)
2. Pushed to `/api/overlay/events` via SSE
3. Rendered in the chat overlay component on the overlay page

**Display modes**:
- Quiet mode (0–5 messages/min): each message shows for 8 seconds, fades out
- Active mode (5–30 messages/min): scrolling list, 8–12 lines visible
- Flood protection (>30 messages/min): rate-limit to 1 message/second display

**Chat overlay component controls** (in Overlays admin section):
- Enable/disable toggle
- Position: bottom-left (default), bottom-right, top-left, top-right
- Display mode: quiet, active, flood
- Style: compact or card
- Max visible lines: 5, 8, 12
- Rate limit per minute

Font-size presets, background variants, username toggles, and badge toggles remain future UI polish.

**Design constraint**: The chat overlay must look good at 360p. Minimum line height 24px unscaled.

### Follow and Subscription Alerts

**Data source**: Twitch EventSub webhook for `channel.follow`, `channel.subscribe`, `channel.cheer`, and `channel.channel_points_custom_reward_redemption.add` events.

EventSub requires a public HTTPS webhook endpoint. Stream247 uses `${APP_URL}/api/overlay/events` as the callback and `TWITCH_EVENTSUB_SECRET` for webhook signature verification. The worker auto-registers the enabled engagement subscriptions when all of these are true:

- alerts are enabled in the database and `STREAM_ALERTS_ENABLED=1`
- Twitch is connected with a broadcaster ID
- Twitch client ID and secret are configured
- `APP_URL` starts with `https://`
- `TWITCH_EVENTSUB_SECRET` is set

The worker lists existing EventSub subscriptions before creating anything, so it does not create duplicates for the same callback/type/condition. If alerts are turned off, or a per-type toggle is turned off, it deletes only matching Stream247-owned engagement webhook subscriptions for the configured callback and broadcaster.

Twitch webhook EventSub APIs require an app access token for create/list/delete calls. The connected broadcaster must also have granted the app the required scopes: `moderator:read:followers` for `channel.follow`, `channel:read:subscriptions` for `channel.subscribe`, `bits:read` for `channel.cheer`, and `channel:read:redemptions` for `channel.channel_points_custom_reward_redemption.add`. Accounts connected before M32 may need to reconnect once to grant the new scopes. No manual Twitch CLI subscription step is required for normal operation.

**Alert component behavior**:
- New follow/sub/cheer/channel-point event arrives at `/api/overlay/events` via Twitch EventSub webhook
- The web route verifies the signature, stores an engagement event, and the SSE endpoint streams the updated engagement snapshot
- Overlay page receives the event snapshot and shows an alert animation
- Alert displays for 5 seconds (configurable), then dismisses
- If multiple alerts queue up, they show in sequence with a 1-second gap

**Alert component controls** (in Overlays admin section):
- Enable/disable alerts as one feature gate
- Enable/disable bits / cheer alerts
- Enable/disable channel point redemption alerts
- Position: bottom-left, bottom-right, top-left, top-right
- Style: compact or card

Custom sounds, custom animation styles, and duration controls remain future UI work.

### Engagement Widget Status in Overlay Admin

The `Overlays` page in admin navigation includes:
- Chat overlay section (on/off, settings)
- Alerts section (on/off, per-type settings)
- Recent engagement events and runtime status. A miniature preview is still future UI polish.

### What M25 Does Not Include

- Stream interaction games or polls (later milestone)
- Custom alert media (images, sound files — later)
- OBS-compatible overlay URL mode (the overlay page is already accessible at `/overlay` for external use, but it is not the primary design target)

---

## Summary: What Changes In Each Milestone

### M21 — Overlay Text Correctness
- Fix pool name in `nextTitle` via pool lookahead
- Fix empty `[]` containers in overlay page and text renderer
- Add `title_prefix` and `hashtags_json` schema fields (additive)
- Fix `desiredTitle` Twitch sync to use prefixed title + hashtags

### M24 — Output Profiles And Stream Settings
- Add `STREAM_OUTPUT_WIDTH/HEIGHT/FPS` env vars
- Add output profile concept with named presets
- Tie overlay viewport to output resolution
- Add scale filter to FFmpeg pipeline
- Admin output settings page with profile selector
- Fix standby slate hardcoded resolution

### M25 — In-Stream Engagement Layer
- Twitch IRC chat connection in worker
- `/api/overlay/events` SSE endpoint
- Chat overlay component on overlay page
- Twitch EventSub webhook receiving for follow/sub alerts
- Alert component on overlay page
- Overlays admin section with per-feature controls

### M28 — EventSub Auto-Registration Follow-Up

- Worker auto-registers `channel.follow` and `channel.subscribe` webhook subscriptions when alert runtime is enabled and Twitch/public callback config is valid
- Worker verifies existing subscriptions before creating new ones
- Worker safely deletes Stream247-owned follow/sub subscriptions when alerts are disabled

### M32 — Cheer And Channel-Point Alerts

- Worker extends EventSub sync to `channel.cheer` and `channel.channel_points_custom_reward_redemption.add`
- Overlays admin exposes bits / cheer and channel point toggles on top of the shared alert position/style controls
- Webhook ingestion stores cheer and channel-point engagement events, and the in-stream overlay renders them with the same alert pipeline
- Broadcasters connected before M32 must reconnect once so `bits:read` and `channel:read:redemptions` are granted
