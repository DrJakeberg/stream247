# Stream247 Full Product Reset Plan

Updated: 2026-04-21

This document defines the target state for Stream247 after Phase 4. It describes what the product should be, how it should be organized, and how the key systems should work. The audit that motivated this plan is in `docs/full-product-reset-audit.md`. The implementation milestones are in `PLANS.md` under Phase 4.

---

## Product Identity

Stream247 is a single-operator or small-team self-hosted platform for running a 24/7 automated broadcast channel. The operator has video content. The operator wants it to stream continuously to Twitch and/or YouTube with professional-looking on-air graphics, correct metadata, viewer engagement features, and reliable automation.

**What it is:**
- A 24/7 stream automation engine
- An in-stream overlay compositor
- A schedule and programming management tool
- A Twitch/YouTube integration layer

**What it is not:**
- An external OBS overlay product
- A cloud delivery platform
- A multi-workspace SaaS product
- A video editing or transcoding tool

This distinction must be clear in docs, UI copy, and every design decision.

---

## Future Product Areas

### Live (formerly "Control Room")

One unified view of what is happening right now. Combines what today is split across Broadcast and Dashboard.

**Broadcast** — the active operator surface:
- Current and next asset with real titles
- Queue state (up to 10 items ahead)
- Action bar: skip, override, restart, fallback, insert
- Twitch LIVE badge with viewer count (when Twitch is connected and channel is live)
- Open incident count with severity indicator
- Destination health chips (primary, backup, and any additional outputs)

**Dashboard** — broadcast readiness and health:
- Readiness checks (worker heartbeat, playout status, destination state, uplink status)
- Open incidents list (absorbs what was on the Operations page)
- Drift check history
- SSE connection count
- Container restart delta (from last baseline)

The Operations nav item disappears. Its content lives on Dashboard.

### Programming

Three distinct concepts, three distinct nav items:

**Schedule** — weekly block authoring:
- Block creation, edit, delete
- Show profiles and repeat sets
- Video-level timeline expansion (already shipped in M23)
- Template duplication and day cloning

**Pools** — programming logic:
- Pool creation and configuration
- Source assignment to pools
- Cursor position and asset eligibility
- Audio lane assignment

**Library** — actual media:
- Asset browsing with thumbnails
- Per-video metadata editing (title, prefix, category, hashtags, notes)
- Include/exclude from programming
- Fallback priority
- Curated sets

Sources (ingest pipelines) are not part of the programming workflow. They belong in Workspace.

### Stream Studio

**Scene Studio** — compose what viewers see:
- Layer-based overlay editor (text, logo, image, embed, widget)
- Layer order, visibility, position
- Typography presets
- Draft/publish workflow
- Safe-area visualization in the editor

**Overlays** — dynamic engagement layer:
- Chat overlay (enable, position, style, rate)
- Follow alerts (enable, position, style)
- Subscription alerts (enable, position, style)
- Donation/bits alerts (future — show "not available yet" placeholder)
- Engagement event history

**Output** — stream delivery shape:
- Output profile selection (720p30, 1080p30, 480p30, 360p30, custom)
- Destination management (primary, backup, additional outputs)
- Per-destination stream key and URL
- Bitrate and buffer configuration

### Workspace

**Sources** — ingest pipelines (moved from Library):
- YouTube channel/playlist sources
- Twitch VOD/channel sources
- Direct URL sources
- Upload management
- Source sync and status

**Team** — access grants:
- Team member list and roles
- Invite and revoke

**Settings** — workspace configuration (organized into subsections):
- Security: owner credentials, 2FA
- Integrations: Twitch OAuth, Discord webhook, SMTP alerts
- Secrets: encrypted managed credentials
- Moderation: presence policy, `!here` command configuration
- Blueprints: Channel Blueprint export/import

---

## Future Navigation IA

```
LIVE
  Broadcast        /broadcast
  Dashboard        /dashboard

PROGRAMMING
  Schedule         /schedule
  Pools            /pools
  Library          /library

STREAM STUDIO
  Scene Studio     /overlay-studio
  Overlays         /overlays
  Output           /output

WORKSPACE
  Sources          /sources
  Team             /team
  Settings         /settings
```

11 links, 4 sections. Each item has a single clear purpose. No item conflates two operator workflows.

**Migration notes:**
- `/sources` currently serves the Library content. After M30, `/sources` serves ingest pipelines only. Library content moves to `/library`.
- `/ops` redirects to `/dashboard`.
- Pools are accessible from `/pools` (new route) and no longer nested inside `/sources`.

---

## Future Overlay Model

The overlay is an in-stream visual layer. It is not an external OBS overlay URL. It should not be documented or marketed as one.

**Architecture (unchanged from current):**
```
Scene Studio (admin UI)
    ↓ draft/publish
/overlay?chromeless=1
    ↓ Chromium headless capture
PNG frame pipe (fd 3)
    ↓ FFmpeg overlay filter
Output stream (RTMP)
```

**Safe-area clamping (M31 target):**

All positioned layers default to the safe area (90% of frame, 5% inset on all sides). The Scene Studio editor shows safe-area boundaries visually. An "allow outside safe area" toggle is available per layer for operators who need it.

Safe-area CSS variables in `globals.css`:
```css
:root {
  --safe-area-top:    calc(var(--overlay-height, 720px) * 0.05);
  --safe-area-right:  calc(var(--overlay-width, 1280px) * 0.05);
  --safe-area-bottom: calc(var(--overlay-height, 720px) * 0.05);
  --safe-area-left:   calc(var(--overlay-width, 1280px) * 0.05);
}
```

**360p legibility:**

The existing scaling formula (`Math.min(1, Math.max(0.62, height/720))`) is correct. All overlay text components must use `calc(Xpx * var(--overlay-scale))` for font sizes. Minimum rendered font size: 12px. The engagement layer (chat, alerts) respects these constraints.

**Engagement layer:**

The engagement layer (chat overlay, alerts) renders inside the same `/overlay` page as the Scene Studio output. It is positioned using safe-area-aware containers. Chat and alert settings are in the Overlays admin section.

---

## Future Planning Model

The schedule and planning model is correct after Phase 3. No structural changes needed.

**What exists and works:**
- Weekly block authoring with pools
- Show profiles and repeat sets
- Video-level timeline (videoSlots lookahead)
- Broadcast next-title using pool cursor lookahead
- Per-video metadata (title, prefix, category, hashtags)

**What remains:**
- Timestamp-based category changes during long videos (deferred, not a Phase 4 item)
- Pools split out as a dedicated nav item (M30 navigation change)

---

## Future Output Model

**Current state:** One active output profile per stream. Profiles: 720p30, 1080p30, 480p30, 360p30, custom. Correct and working.

**Multi-quality path (M33, later):**

Simultaneous multi-quality output (e.g., 720p to Twitch + 360p to YouTube simultaneously) requires multiple parallel FFmpeg processes or a transcoding layer. The correct architecture:

1. FFmpeg produces a single high-quality master output to the local MediaMTX relay
2. A second process (or second MediaMTX instance) reads from the relay and produces multiple renditions at different qualities
3. Each rendition goes to a separate destination

This is not a near-term item. Until M33 ships, the admin UI should state clearly: one output profile per stream.

**Destination management (current, keep):**

Multi-output RTMP fanout with primary/backup routing is working correctly. Per-destination health tracking, cooldown, and staged rejoin all work. Keep this architecture.

---

## Future Operations Model

The current operations model is substantially correct. Key components:

- Soak monitor (`scripts/soak-monitor.sh`) — keep, actively maintained
- Release rehearsal (`scripts/upgrade-rehearsal.sh`) — keep
- Release preflight (`scripts/release-preflight.sh`) — keep
- Readiness API (`/api/system/readiness`) — keep
- Incident system — keep, merge into Dashboard page

**Changes in Phase 4:**
- Operations nav item disappears. Incidents and drift live on Dashboard.
- Backup documentation moves into `docs/operations.md`.

---

## Future Documentation Model

Target: 6 core operational docs + 3 planning files = 9 permanent files. Phase 4 planning docs are temporary.

The full target doc set and merge/delete plan is in `docs/docs-reset-plan.md`.

Key principle: docs describe what exists. Planning docs describe what is planned. The two must never be mixed. After Phase 4, no doc in `/docs` should describe an incomplete feature as if it were real.

---

## Known Deferred Items

These are real product gaps. They are not in Phase 4 scope. They should not be implied as "coming soon" in any UI or doc without a concrete milestone assigned.

| Gap | Why Deferred | When to Revisit |
|---|---|---|
| Timestamp-based Twitch category changes | Complex implementation, small use case | After M33 |
| Donation/bits/channel-point alerts | Requires `channel.cheer` EventSub + overlay component | M32 target |
| Chat interaction mini-game | Requires working `!here` command infrastructure first | After M29 ships and is stable |
| Simultaneous multi-quality output | Architectural change to playout pipeline | M33 |
| Longer `PLANS.md` progress notes archive | Non-urgent cleanup | Anytime |
