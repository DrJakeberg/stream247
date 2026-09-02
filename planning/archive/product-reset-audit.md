# Stream247 Product Reset — Audit

Updated: 2026-04-22

This is the honest ground-truth audit that opens the reset. It does not describe plans, and it does not describe what the prior Phase 4 planning docs claimed to have shipped. It describes what is in the repo today. Its companions are `docs/product-reset-target-state.md` (what to become), `docs/product-reset-kill-list.md` (what to remove), `docs/product-reset-ui-spec.md` (how to rebuild it), and `docs/product-reset-docs-plan.md` (how to keep docs clean).

The reset plan itself lives in `PLANS.md` under Phase 5.

---

## Executive verdict

Stream247 runs. The core runtime — pool rotation, FFmpeg playout, program feed, MediaMTX relay, destination fanout, Scene Studio → Chromium capture overlay — is solid and has survived extended soak runs. v1.5.1 ships cleanly.

But the product surface has drifted. The operator-facing UI layers a 2025-era React shell over a 2024-era information architecture, with three different names for roughly the same "studio" concept (Scene Studio, Overlay Studio, Overlays), two pages that answer the same question ("am I live and healthy?"), orphan routes that never made it into the sidebar, and a navigation that regressed from client-side routing back to full page loads. Text data flows from form inputs to an overlay canvas and Twitch metadata with almost no sanitization — which is why we still see the occasional tofu glyph on-air.

**The current information architecture is an intermediate state, not the long-term product model.** Phase 3 did the right cleanup to survive. Phase 4 planning docs rubber-stamped that cleanup as the target. The reset takes the next step: treat the four current nav sections as workspaces, collapse the duplicated surfaces inside them, and redesign the studio and programming experiences as first-class tasks — not side effects of label changes.

---

## What is good

- **Pool rotation and next-title resolution.** `packages/core/src/index.ts:1943` — `lookaheadVideoTitleFromPool` resolves the next broadcast title from a pool cursor with a correct wrap and eligibility filter. No pool name ever reaches the viewer through this path.
- **EventSub coverage.** The worker subscribes to four Twitch event types (follow, subscribe, cheer, channel-points) and feeds them into the engagement overlay. Donation/bits are covered by `channel.cheer`. Channel-points are covered by `channel.channel_points_custom_reward_redemption.add`.
- **Moderator-presence parser.** `packages/core/src/index.ts:1782` — `parseModeratorCheckIn` accepts `!here` and `!here N`, clamps N into a configured min/max/default. `apps/worker/src/twitch-engagement.ts:70` and `:204` wire it to the IRC bridge. The parser *works* — see the bad list below for why users still perceive it as broken.
- **Scene draft/publish semantics.** Scene Studio keeps drafts isolated until explicit publish. Chromium capture picks up the published scene via the chromeless overlay route.
- **Per-destination output profiles.** Output profiles (720p30, 1080p30, 480p30, 360p30, custom) work and are wired through `STREAM_OUTPUT_WIDTH/HEIGHT/FPS`. The Output page exposes this to operators.
- **Release + soak tooling.** `scripts/release-preflight.sh`, `scripts/upgrade-rehearsal.sh`, `scripts/soak-monitor.sh` produce real runtime evidence. 24-hour soak on DUT is a normal release gate, not a stretch goal.
- **Safe-area clamping.** `globals.css` defines `--safe-area-top/right/bottom/left` from the active output dimensions, and positioned scene layers plus engagement widgets honor them.
- **Component-primitive layer exists.** `apps/web/components/ui/` holds `Button`, `Badge`, `StatusChip`, `Card`, `Input`, `Select`, `PageHeader`. The `Badge.tsx:9` `resolveBadgeContent` guard prevents `[]` and empty content from rendering — the pattern is right; it's just not applied everywhere yet.
- **Deployment model is documented and reproducible.** Source of truth is the repo's `docker-compose.yml` plus `.env.production.example` pinning GHCR image tags. Portainer on DT redeploys the stack; DUT at `/root/stream247/recovery-stack` validates before production promote.

## What is bad

- **Navigation regressed to full page loads.** `apps/web/components/admin-navigation.tsx:20` renders `<a href={item.href}>` instead of Next.js `<Link>`. Every sidebar click does a full document navigation, tearing down the SSE streams on `/broadcast` and the live overlay and rebuilding them. This defeats the Live Bridge + continuous-queue UX the backend supports.
- **Text pipeline does not strip invisible Unicode.** `apps/web/app/api/assets/[id]/route.ts:19` — `normalizeText` does only `String(value ?? "").trim().slice(0, maxLength)`. No control chars, no zero-width characters (U+200B/C/D/FEFF), no bidi marks (U+202A–E), no soft hyphens (U+00AD), no NFC normalization. The same gap exists in the normalize-body helpers in the shows, pools, overlay, and sources API routes. `apps/worker/src/twitch-metadata.ts:21` — `buildTwitchMetadataTitle` only trims and slices. `apps/web/components/overlay-scene-canvas.tsx:20` — `visibleOverlayText` only trims. Every layer trusts every other layer. When an operator pastes a title from a browser that inserts a directional mark or the copy includes a BOM, the tofu glyph ends up on-air. **This is the root of the square-box bug.**
- **`/ops` is a dead redirect.** `apps/web/app/(admin)/ops/page.tsx` is three lines of `permanentRedirect("/dashboard")`. It exists because the old "Operations" nav item was removed without deleting the route.
- **Moderation is orphaned from the nav.** `apps/web/app/(admin)/moderation/page.tsx` is a live, functional surface but not linked from `apps/web/lib/admin-navigation.ts`. Operators have to type the URL.
- **Broadcast and Dashboard both host playout actions.** Both pages render the live queue plus action forms (skip, override, restart, fallback, insert). Two surfaces answering the same "is everything okay, and if not what do I press?" question. Operators end up reaching for whichever tab they last had open.
- **"Scene Studio" has three names.** The nav label is "Scene Studio", the URL segment is `/overlay-studio`, the CSS treats it like "the overlay". Meanwhile "Overlays" is a different nav item that routes to `/overlays` and owns chat + alerts. New operators reliably get lost.
- **No regression tests for invisible Unicode.** `tests/` has no `zero-width`, `BOM`, `FEFF`, or `control.*char` coverage. A future contributor who adds a new text input route has no test to remind them to sanitize.
- **`!here N` clamp is silent.** The parser clamps `N` into `[min, max]` around `default`, but the bot does not tell the chatter or the operator that the clamp happened. A moderator typing `!here 5` with a 10-minute minimum sees no confirmation, no "requested 5, used 10" feedback. This is the user's "!here 5 does not work" complaint: it works, but it's silent.

## What is legacy

- **Phase-4 planning artifacts living in `docs/`.** `docs/full-product-reset-audit.md`, `docs/full-product-reset-plan.md`, `docs/legacy-removal-list.md`, `docs/docs-reset-plan.md`, `docs/ui-redesign-spec.md` were written to drive Phase 4 and now describe a target state that is itself being revised. They sit alongside product docs with no visible marker that they are ephemeral. This audit supersedes the first one; the rest will be merged or deleted in Phase 5.
- **External-overlay language.** `docs/legacy-removal-list.md:111` still describes `/overlay` as "usable as an external stream overlay" in the "what we will remove" column. The language needs to exit the repo: `/overlay` is internal output for Stream247's own 24/7 broadcast. It should not be indexed by search engines and should not be framed as a product surface for third-party stream embedding.
- **"Stream Studio" / "Workspace" section headers.** The admin nav uses section titles whose meaning has to be explained every time. "Stream Studio" bundles Scene Studio + Overlays + Output. "Workspace" bundles Sources + Team + Settings. These are filing cabinets, not product surfaces.
- **Asset collection API.** `apps/web/app/api/asset-collections/` exists but its UI consumers are unclear after M13's library/blueprints rework. Needs a consumer audit before it goes on a kill list — may or may not be legacy.

## What is confusing

- **Three "studio" words.** See above — Scene Studio, Overlay Studio, Overlays.
- **Two live-control surfaces.** Broadcast vs Dashboard, each with overlapping action bars.
- **Programming is a four-route workflow.** Creating a broadcast week means jumping between `/schedule` (blocks + templates), `/pools` (rotation logic), `/library` (asset metadata), and `/sources` (ingest). No cross-route context. No "here's what will air in the next 12 hours" view that ties them together.
- **Long titles truncate instead of wrapping.** The nav-link CSS block in `apps/web/app/globals.css` sets `overflow: hidden; text-overflow: ellipsis; white-space: nowrap` on the nav title. Long show or asset names disappear into `…`. Forms elsewhere already use `overflow-wrap: anywhere`. Inconsistent overflow rules.
- **Engagement settings live in two places.** Scene Studio exposes an "Overlay" settings form and `/overlays` exposes an "Engagement" settings form. There is overlap.
- **`PLANS.md` is 1615 lines.** It carries M0 through M35 with progress notes interleaved chronologically, then reverse-chronologically in places. A new contributor cannot use it as an index of current state.

---

## Requirement-by-requirement audit (user wishes)

| Wish | Verdict | Evidence in repo |
|---|---|---|
| `!here 5` does not work in chat | **Feedback gap, not missing feature** | Parser works at `packages/core/src/index.ts:1782` and is dispatched at `apps/worker/src/twitch-engagement.ts:204`. `!here 5` is silently clamped into the configured min/max/default without a chat response or operator-visible trace. Redesign needed (M38). |
| Overlay is for the current 24/7 stream, not external | **Met in architecture, not in language** | Scene Studio → Chromium capture → FFmpeg overlay is strictly internal. `docs/legacy-removal-list.md:111` still calls it "external stream overlay". No `noindex` on `/overlay`. Needs copy + header fix (M39). |
| Control what is shown in-stream (chat, followers, subs) | **Partial** | Chat + follow + sub + cheer + channel-points alerts exist via the engagement overlay. Configurable via the engagement settings form. Chatter-participation game is missing (M47). |
| Planning shows which video runs when, not only which pool | **Met, but UX is fragmented** | `packages/core/src/index.ts:1943` resolves next titles; schedule-video-timeline components show per-video slots inside a block. Planning UX is spread across 4 routes (M45 unifies). |
| See when current streamer is live, maybe small live preview | **Status yes, preview no** | Worker polls `/helix/streams` via `apps/worker/src/twitch-live-status.ts`; UI consumes it as a status badge. No video preview. Preview is deferred — see target-state doc for justification. |
| Category handling is wrong | **Partial** | Per-video category override exists; timestamp-based category changes during long assets are not implemented. Deferred beyond the reset. |
| Titles should have a prefix like "Replay:" | **Met as data, not as UX** | `title_prefix` schema field and `buildAssetDisplayTitle` exist. `apps/worker/src/twitch-metadata.ts:21` concatenates prefix + title + hashtags. Operators still type "Replay:" manually as a string. M45 turns it into a structured toggle. |
| Hashtags are wrong | **Met as data, awkward as UX** | `hashtags_json` schema + parse helpers work. Operators edit a JSON-like string. M45 makes it a chip input. |
| Next item always shows real title, never a pool name | **Met** | `lookaheadVideoTitleFromPool` at `packages/core/src/index.ts:1943` never returns a pool name. Worker falls back to the schedule item title if the pool is empty. Live channel page prefers the schedule item title. |
| Menus break with long titles; fields should stack vertically | **Nav still truncates; forms are better** | Nav-link CSS truncates with ellipsis. Form layouts are already stacked. M37 fixes nav wrap. |
| Chat overlay and alerts for follows, subs, donations | **Met** | Chat overlay renders recent messages; alerts render follows / subs / cheers (donations via bits) / channel-points. Conditional on engagement toggles. |
| Fun interaction or game, works with 1 or 30 chatters | **Missing** | No game exists. Requires new worker handlers + overlay components + settings surface. First-class M47. |
| Complete redesign into clean, modern, React-first | **Intermediate** | Primitive layer exists in `apps/web/components/ui/`. Not applied uniformly. No `Tabs`, `EmptyState`, `Toast` primitives yet. M44 rolls out the design system; M45/M46 apply it to planning + studio workspaces. |
| Intuitive operation for online studio and planning | **No** | Both workflows span multiple routes with overlapping settings surfaces. M45 and M46 consolidate. |
| `[]` empty-bracket bug | **Met** | `apps/web/components/ui/Badge.tsx:9` `resolveBadgeContent` rejects empty, whitespace-only, and `"[]"` content. `apps/web/components/overlay-scene-canvas.tsx:20` `visibleOverlayText` applies the same guard. |
| Square boxes at end of overlay text lines | **Unresolved, has a clear root cause** | See the pipeline map below. Text flows from form inputs to the overlay canvas and Twitch metadata with `.trim().slice()` as the only filter. Zero-width, BOM, bidi, control chars all survive. M36 fixes this as a pipeline task with regression tests. |
| Multiple quality support | **Single profile per stream** | M24 shipped one profile at a time. Parallel multi-quality is out of scope for the reset. |
| Resolution / FPS settings | **Met** | Output profiles via env vars + Output page. |
| Menu sometimes breaks when titles are too long | **Covered by long-title wrap above** | M37 wraps nav labels, M45 ensures programming card titles wrap. |

---

## Square-box bug — pipeline map

The tofu glyphs at end of lines are not a font bug. Text reaches the overlay canvas and Twitch API carrying invisible characters that the font cannot render, so Chromium draws replacement boxes. The fix is pipeline-wide sanitization, not a cosmetic tweak.

Layers from source to glass:

1. **Form input** — the web admin forms (asset metadata, show profile, pool, overlay settings) accept any Unicode the browser allows. No filter client-side by design; sanitization is a server concern.
2. **API write boundary** — the five normalize helpers: `normalizeText` at `apps/web/app/api/assets/[id]/route.ts:19`, the normalize-body helpers in the shows, pools, overlay, and sources API routes. Every one of them does only `String(value ?? "").trim().slice(0, maxLength)`. **Gaps:** zero-width (U+200B/C/D), BOM (U+FEFF), C0/C1 control chars (U+0000–1F, U+007F–9F), bidi marks (U+202A–E), soft hyphens (U+00AD), no NFC normalization.
3. **DB storage** — PostgreSQL text columns accept whatever the API wrote. There is no DB-level constraint.
4. **API read boundary** — API handlers return the stored text as-is. No re-sanitization at read.
5. **Worker composition** — `apps/worker/src/twitch-metadata.ts:21` `buildTwitchMetadataTitle` concatenates prefix + title + hashtags with `.trim()` on each component and `.trim().slice(0, 140)` on the result. Invisible characters from any source survive.
6. **Render (overlay)** — `apps/web/components/overlay-scene-canvas.tsx:20` `visibleOverlayText` does `String(value ?? "").trim()` and rejects only the literal string `"[]"`. Everything else prints.
7. **Chromium capture → FFmpeg** — the capture path has no text involvement; it just rasterizes what React painted.
8. **Tests** — `tests/unit/` has no regression coverage for invisible-Unicode categories. A grep for `zero.width`, `BOM`, `FEFF`, `control.*char` returns nothing.

The fix is a single `stripInvisibleCharacters()` utility in `packages/core/src/index.ts`, applied at the API write boundary (authoritative) and the render boundary (defense in depth), with NFC normalization and regression tests per Unicode category. Full milestone scope is in `PLANS.md` M36.

---

## Deployment reality — repo vs Portainer on DT vs DUT runtime

The three layers must stay distinct. The reset docs and every deployment-affecting milestone assume this model.

**Repository (source of code)**
- `docker-compose.yml` — canonical service topology.
- `.env.production.example` — pinned GHCR image tags for the production profile.
- `.env.example` — evaluation defaults using `latest` tags.
- `docker/*.Dockerfile` — image build recipes.
- `scripts/release-preflight.sh` / `upgrade-rehearsal.sh` / `soak-monitor.sh` — validation, not deployment.

CI on `main` publishes `main-<sha>` snapshot images to GHCR. On a `v*` tag push, CI retags the matching `main-<sha>` images as the versioned release.

**Deployment control plane — Portainer on DT**
- Operators manage the live stack through Portainer on DT.
- The active compose definition + `stack.env` live under `/root/stream247/recovery-stack` on DT (per `AGENTS.md`).
- A new release is promoted by updating the image tag in the Portainer stack and triggering a stack redeploy. Portainer pulls the new image from GHCR and recreates the affected services.
- Editing `docker-compose.yml` locally does **not** change production. The Portainer-managed stack definition is the authoritative runtime config. Changes to the repo-level compose file must be reflected into the Portainer stack before they take effect.

**Runtime validation target — DUT**
- DUT is the test-environment host that mirrors production topology.
- Release rehearsal + soak run on DUT via `upgrade-rehearsal.sh <version>` and `soak-monitor.sh`.
- Readiness endpoints (`/api/health`, `/api/system/readiness`) and the 24h soak gate are the concrete evidence before promoting a version to production.

Every Phase 5 milestone that ships code to production explicitly specifies (1) the new image tag to pin in `.env.production.example`, (2) the Portainer stack update step, and (3) the DUT validation check. Milestones that are docs-only skip those notes.

---

## Non-goals of this audit

- No attempt to tally claims in prior planning docs against the repo. Where the prior `docs/full-product-reset-audit.md` conflicts with current findings (e.g. it says `!here` is fully met), this audit supersedes it. M42 quarantines the prior planning artifacts.
- No speculative roadmap work beyond what's needed to motivate the reset phases. Feature planning belongs in `docs/product-reset-target-state.md` and `PLANS.md`.
- No grading of past milestones. The question is "what is true in the repo today", not "did M28 ship on time".
