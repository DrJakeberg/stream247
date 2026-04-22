# Stream247 Product Reset — Target State

Updated: 2026-04-22

This is the product's destination after Phase 5 completes. It is a model, not a list of URLs. Route paths and final names are decided during M43 implementation, guided by this model — not ahead of it.

Companions: `docs/product-reset-audit.md` (why), `docs/product-reset-kill-list.md` (what leaves), `docs/product-reset-ui-spec.md` (how the UI is built), `docs/product-reset-docs-plan.md` (how the docs stay clean). Implementation milestones in `PLANS.md` Phase 5.

---

## Future product shape

Stream247 is a **single-operator 24/7 broadcast automation** for one Twitch channel (and optional YouTube mirror). One operator (or a small team) owns one channel, feeds it a library of video assets, schedules pools and blocks, and lets the product run continuously with a live overlay, engagement layer, and Twitch metadata automation.

It is:

- A 24/7 stream automation engine.
- An **internal** overlay compositor for the channel's own output.
- A schedule + programming tool for video pools and blocks.
- A Twitch / YouTube integration surface (OAuth, EventSub, IRC bridge, metadata).
- A self-hosted, Docker-Compose-deployable, Portainer-managed product.

It is not a multi-tenant platform, not an external overlay SaaS, not a cloud delivery service, not a video editing tool, not a Kubernetes-native workload. Every design decision after the reset honors this shape.

---

## Information architecture — four workspaces, not a route list

The reset replaces the current flat "sections + links" model with **four workspaces**. Each workspace owns a coherent operator concern and the tabs inside it. Final route paths are decided at M43 — the model drives the routes, not the other way around.

1. **Live** — what is happening right now.
   - Now + next + queue.
   - Playout controls (skip, override, restart, fallback, insert).
   - Destination health.
   - Open incidents + readiness checks (absorbs what `/ops` and `/dashboard` try to cover today).
   - Active moderation presence window (from `!here`).
   - Twitch channel live status + viewer count.

2. **Program** — what will air.
   - One workspace, three lenses: **Week**, **Day**, **Now + Next**.
   - Video-level granularity by default — every lens shows the actual asset about to play, not just the pool or block.
   - Sub-surfaces for schedule blocks, pools, library, and ingest sources — tabs inside one workspace, not separate routes.
   - Per-video metadata editing (structured Replay toggle, hashtag chips, category `Select`, notes) lives inline where the operator is working, not in a separate "library" detour.

3. **Studio** — what the viewer sees.
   - **Scene** tab — layer-based overlay editor with draft → publish.
   - **Engagement** tab — chat overlay, follow / sub / cheer / channel-point alerts, chatter-participation game configuration, active engagement history.
   - **Output** tab — output profile (720p30 / 1080p30 / 480p30 / 360p30 / custom), destination list with per-destination health badges, per-destination output profile overrides.
   - Emergency banner lives at the top of the Scene tab, one click to activate.

4. **Admin** — how the product itself is configured.
   - Team + roles.
   - Credentials + secrets + 2FA.
   - Twitch OAuth / EventSub / IRC bridge settings.
   - Moderation policy (presence min/max/default, chat-mode rules).
   - Channel Blueprints export/import.
   - Release channel.

This is four workspaces, not four sections plus eleven links. Every operator concern has exactly one home.

### What this replaces

The current four-section navigation (`Live` / `Programming` / `Stream Studio` / `Workspace`) with eleven links is an intermediate state. It successfully grouped surfaces, but it still treats each surface as its own page. The target model:

- **Collapses** the two live-control pages (Broadcast + Dashboard) into one Live workspace.
- **Collapses** the four-route programming flow (Schedule + Pools + Library + Sources) into one Program workspace with tabs.
- **Collapses** the three studio surfaces (Scene Studio + Overlays + Output) into one Studio workspace with tabs.
- **Renames** the "Workspace" section to **Admin** to reflect what it actually does.

### What is not decided yet

- Final URL paths (e.g. `/live` vs `/on-air` vs keeping `/broadcast` as the Live alias). The target is one URL per workspace; which URL is a naming question for M43.
- Whether the Live workspace also contains the Moderation presence detail page as a tab or as a separate route within the workspace.
- Whether Sources (ingest) is a tab inside Program or a tab inside Admin. Current lean: inside Program, because adding a new source is a programming task; but the decision is recorded in M43's addendum.

---

## Future planning model

**Program is one workspace. Video-level is the default view. Pool-level is a lens, not a destination.**

- **Week lens** — seven-day grid, blocks filled with their first resolved asset plus an expandable video-level list per block. The schedule preview resolves next-asset titles via `lookaheadVideoTitleFromPool` (the logic exists, the surface does not yet show it inline).
- **Day lens** — vertical timeline for a single day, every asset slot visible with runtime, category, Replay flag.
- **Now + Next lens** — the operator-at-work view: currently playing, next two assets, fallback chain. Matches what the Live workspace shows in its header chip.

Structured data for overlay + metadata:

- **Replay** is a boolean field on the asset or block, not a typed string. The system composes `Replay: <title>` automatically into the broadcast title.
- **Hashtags** are a chip array on the asset, not a JSON blob. The chip input prevents invisible Unicode at the client boundary in addition to the server-side strip.
- **Category** is a `Select` tied to the show profile, not a free-text override (operators can still override per asset, but only with a value that exists on the show profile).
- **Notes** are editable per asset, never surface to the viewer.

---

## Future online-studio model

**Studio is one workspace. Scene, Engagement, and Output are tabs, not separate routes.**

- The workspace header shows draft/published state plus the emergency-banner toggle.
- Publish is one explicit action with a diff preview of what changed vs the live scene.
- Engagement settings (chat, alerts, game) are co-located in one tab. No duplicate settings surfaces across overlay-studio and overlays.
- Output profiles and destinations are co-located — operators setting up a new destination do not leave the workspace.

---

## Future overlay model

**The overlay is internal output for Stream247's own 24/7 broadcast. It is not an external overlay product and is not intended for third-party stream embedding.**

- `/overlay?chromeless=1` remains the Chromium-capture source. No URL change.
- `/overlay` gets `noindex` plus `X-Robots-Tag: noindex` headers. Search engines do not index it.
- UI copy, docs, and product language drop every "external", "browser source", and "third-party" phrasing. Overlay is one word, qualified only when absolutely necessary.
- Safe-area clamping (5% inset on all sides) stays the default. Engagement widgets and scene layers honor it.
- The engagement layer (chat, alerts, game) renders inside the same `/overlay` page. There is no second pipeline.

---

## Future stream / output model

- One **output profile** per stream for now (width / height / FPS / bitrate from env vars + runtime overrides via the Output tab).
- **Per-destination overrides** exist — a destination can request a smaller profile (`apps/web/components/destination-output-profile-form.tsx` already supports this; UI surfaces it under Studio → Output).
- **Multi-quality simulcast** (one encode fanned out to several renditions) is a future consideration and **not a reset deliverable**. Rationale: requires a second encoder or a transcode service; current local-playout → MediaMTX relay → destination uplink architecture is intentionally simple.
- **MediaMTX relay + persistent uplink** remain; they are not reset targets.

---

## Future live-status model

- **Twitch channel live status** is always visible in the sidebar (chip: live / offline / unknown) and in the Live workspace header (live + uptime + viewer count).
- **Playout live status** (is the worker playing content right now?) is a separate chip in the Live workspace header.
- **Small live video preview is deferred**, not scheduled. Rationale: an embedded Twitch player is bandwidth-heavy and flashes the operator's own viewership, and an overlay snapshot is not a substitute. A future milestone can justify it against measured operator need. Until then, the text status chip + viewer count + uptime is v1.
- **Live status polling** continues via `apps/worker/src/twitch-live-status.ts`. State flows through the existing SSE feed.

---

## Future engagement model

**Chat + alerts + chatter-participation game as a single coherent feature, configured in one place.**

- **Chat overlay** — configurable messages, position, rate, style. Already shipped.
- **Follow / Subscribe / Cheer / Channel-points alerts** — already shipped via EventSub. Stay.
- **Chatter-participation game** — new feature. Auto-switches modes based on rolling active-chatter count:
  - **Solo mode** (≈1 active chatter) — call-and-response prompts, reactive emote challenges. The game works with an audience of one.
  - **Small-group mode** (≈2–10 active chatters) — emoji-vote prompts, lightweight prediction rounds.
  - **Crowd mode** (10+ active chatters) — voting / prediction / trivia with on-overlay aggregation.
  - Auto-switch uses a rolling window of chatters who have sent ≥1 message in the last N minutes.
- All engagement settings live in Studio → Engagement. The engagement overlay renders game state alongside chat and alerts.

---

## Deployment target model

The **repo** holds the source of code. **Portainer on DT** is the deployment control plane. **DUT** is the runtime validation target.

```
repo (code, compose, scripts)
    ↓ CI on push to main
ghcr.io/drjakeberg/stream247-*: main-<sha>
    ↓ CI on v* tag
ghcr.io/drjakeberg/stream247-*: v<version>
    ↓ operator pins tag in .env.production.example
Portainer stack on DT (deployment control plane)
    ↓ operator triggers stack redeploy in Portainer
DUT runtime
    ↓ scripts/upgrade-rehearsal.sh + scripts/soak-monitor.sh
DUT validated → production promote
```

**Rules that every deployment-affecting Phase 5 milestone follows:**

1. Codex must not assume that editing the local `docker-compose.yml` alone changes production. The Portainer-managed stack is the authoritative runtime config.
2. The milestone names the new image tag to pin in `.env.production.example`.
3. The milestone describes the Portainer stack update step (usually: bump image tag, redeploy stack).
4. The milestone specifies the DUT validation command(s) that must pass before promoting.
5. The milestone states how to roll back if DUT validation fails (usually: revert the tag in Portainer and redeploy the previous stack).

---

## Non-goals

These are out of scope for the reset. Naming them explicitly keeps Codex from overbuilding.

- **No multi-tenant or multi-channel product direction.** One operator, one channel.
- **No external-overlay product direction.** The overlay is internal output, not a SaaS surface.
- **No live video preview** in the reset. A deferred decision, not a hidden requirement.
- **No multi-quality simulcast** beyond per-destination output profiles that already exist.
- **No in-app video editing, re-encoding, or trimming.** Content is sourced, not produced.
- **No fan-tier / VIP features** beyond what Twitch's own subscriber system provides.
- **No scheduled-publish / marketing-automation** beyond the current schedule model.
- **No migration away from Docker Compose + Portainer.** No Kubernetes, no Helm charts, no cloud-native rewrite.
- **No runtime architecture rewrite.** The program-feed → relay → uplink pipeline is not reset scope.
- **No REST-API-as-product direction.** APIs exist to serve the web client. They are not a customer-facing surface.
- **No alternative authentication provider** beyond Twitch OAuth + local owner account.
- **No i18n.** Single-language UI.
- **No analytics dashboard beyond what EventSub + live-status already provide.** Viewer counts and engagement counters are enough.

---

## Explicit statement on overlay purpose

_The overlay is internal output for Stream247's own 24/7 broadcast. It is not an external overlay product and is not intended for third-party stream embedding._

This sentence belongs in `docs/ui.md` after Phase 5 completes, in the product description of the README, and in any copy that describes the `/overlay` route.

---

## M43 route addendum

Final workspace paths chosen in M43:

- `Live` → `/live`
  - `?tab=control`
  - `?tab=status`
  - `?tab=moderation`
- `Program` → `/program`
  - `?tab=schedule`
  - `?tab=pools`
  - `?tab=library`
  - `?tab=sources`
- `Studio` → `/studio`
  - `?tab=scene`
  - `?tab=engagement`
  - `?tab=output`
- `Admin` → `/admin`
  - `?tab=settings`
  - `?tab=team`

Recorded decisions:

- Sources live under `Program`, not `Admin`, because ingest setup is part of the programming workflow.
- Moderation lives under `Live`, not `Admin`, because `!here` presence affects the current on-air run.
- Legacy admin routes redirect to the workspace URLs above for one soak cycle before deletion.
