# Stream247 Product Reset — Kill List

Updated: 2026-04-22

What leaves, what stays, what gets replaced. This is a decision register, not a roadmap. All decisions are final for the Phase 5 scope; if a line here conflicts with a prior planning doc (Phase 4 artifacts in `docs/`), this one wins.

Companions: `docs/product-reset-audit.md` (why), `docs/product-reset-target-state.md` (what to build), `docs/product-reset-ui-spec.md` (how to build it), `docs/product-reset-docs-plan.md` (final docs set). Implementation in `PLANS.md` Phase 5.

---

## Remove / Keep / Replace — at a glance

| Surface / artifact | Verdict | Where |
|---|---|---|
| Hard-coded `<a href>` nav | **Replace with `<Link>`** | `apps/web/components/admin-navigation.tsx` |
| `/ops` route | **Remove** | `apps/web/app/(admin)/ops/page.tsx` |
| Moderation orphaned from nav | **Replace — surface in Live workspace** | `apps/web/lib/admin-navigation.ts` |
| Duplicate playout actions on Dashboard | **Remove from `/dashboard`, keep on `/broadcast`** | dashboard page |
| `/overlays` and `/overlay-studio` as separate routes | **Replace — both absorbed into Studio workspace** | route + nav rewrite at M43 |
| "Stream Studio" / "Workspace" / "Programming" nav section headers | **Replace — Live / Program / Studio / Admin workspaces** | M40 copy + M43 IA reset |
| External-overlay language in docs & UI | **Remove** | `docs/legacy-removal-list.md:111` and any UI copy matching |
| Engagement settings form duplicated across overlay-studio and overlays | **Replace — consolidate in Studio → Engagement** | M46 |
| Destination settings duplicated in `/dashboard` and `/settings` | **Replace — Admin workspace only** | M41 + M43 |
| Text sanitization via `.trim().slice()` only | **Replace — central `stripInvisibleCharacters()` helper** | `packages/core`, applied at all write + render boundaries (M36) |
| Nav-link `text-overflow: ellipsis; white-space: nowrap` | **Replace — wrap + clamp** | nav-link CSS block in `apps/web/app/globals.css` (M37) |
| Phase 4 planning artifacts in `docs/` | **Remove after content merged** | see doc delete list below |
| `apps/web/components/ui/` primitive set (Button, Badge, StatusChip, Card, Input, Select, PageHeader) | **Keep + extend** | add `Tabs`, `EmptyState`, `Toast`, `Textarea` at M44 |
| `apps/web/app/api/integrations/` | **Keep** | `twitch/callback` + `twitch/connect` routes are in active use — **not** on the kill list |
| `apps/web/app/api/asset-collections/` | **Decide at M42/M45** | consumer audit needed; may be live or may be stranded |
| Pool rotation logic, `lookaheadVideoTitleFromPool` | **Keep** | `packages/core/src/index.ts:1943` is correct |
| `resolveBadgeContent` empty-content guard | **Keep + apply everywhere** | `apps/web/components/ui/Badge.tsx:9` is the canonical pattern |
| `parseModeratorCheckIn` + chat-bridge dispatch | **Keep + surface clamp** | parser works, user-visible feedback missing (M38) |
| EventSub subscription set (follow, subscribe, cheer, channel-points) | **Keep** | complete for current needs |
| Per-destination output profiles | **Keep** | surface inside Studio → Output at M46 |
| `/overlay?chromeless=1` Chromium capture | **Keep** | add `noindex` headers at M39 |
| Release + soak scripts (`release-preflight.sh`, `upgrade-rehearsal.sh`, `soak-monitor.sh`) | **Keep** | extend with Portainer stack check at M50 |
| `docker-compose.yml` + `.env.production.example` pinned GHCR tags | **Keep** | deployment source of truth |

---

## Old files to delete

**Immediate (Phase 5A):**

- `apps/web/app/(admin)/ops/page.tsx` — dead `permanentRedirect`. Remove route directory entirely (M37).

**After content is merged into the six product-reset docs (Phase 5A/5B sequence):**

- `docs/full-product-reset-audit.md` — superseded by `docs/product-reset-audit.md` (M42 archive, M49 delete).
- `docs/full-product-reset-plan.md` — superseded by `docs/product-reset-target-state.md` (M42 archive, M49 delete).
- `docs/legacy-removal-list.md` — superseded by this file (M42 archive, M49 delete).
- `docs/docs-reset-plan.md` — superseded by `docs/product-reset-docs-plan.md` (M42 archive, M49 delete).
- `docs/ui-redesign-spec.md` — superseded by `docs/product-reset-ui-spec.md` and eventually by the permanent `docs/ui.md` (M42 archive, M49 delete).

**Not on the delete list despite appearing on earlier ones:**

- `apps/web/app/api/integrations/` — **active routes** (`twitch/callback`, `twitch/connect`). Keep.

---

## Outdated docs to delete or merge

| Doc | Action |
|---|---|
| `docs/full-product-reset-audit.md` | Merge remaining truth into `docs/product-reset-audit.md` (already done for the parts worth preserving); then delete. |
| `docs/full-product-reset-plan.md` | Merge into `docs/product-reset-target-state.md`; then delete. Note: this doc locked in the current 4-section nav as the target. The new target-state doc explicitly reopens that decision. |
| `docs/legacy-removal-list.md` | Merge into this file; then delete. The external-overlay language in `legacy-removal-list.md:111` exits with it. |
| `docs/docs-reset-plan.md` | Merge into `docs/product-reset-docs-plan.md`; then delete. |
| `docs/ui-redesign-spec.md` | Merge into `docs/product-reset-ui-spec.md`, and later into the permanent `docs/ui.md` once the redesign ships; then delete. |

**Docs that stay (after merge / cleanup):**

- `docs/architecture.md` — service topology, data model, SSE/IPC. Keep.
- `docs/deployment.md` — Compose + GHCR + Portainer/DT + env + DUT validation. Keep, expand with the Portainer/DT rollout flow at M50.
- `docs/operations.md` — runbook, incidents, backup, upgrade. Keep.
- `docs/moderation-policies.md` — `!here`, presence, chat mode. Keep, expand with clamp-feedback rule at M38.
- `docs/twitch-setup.md` — OAuth, EventSub, live status. Keep.

---

## Routes and UI surfaces to demote, rename, or remove

**Immediate (Phase 5A, no route rename):**

- `/ops` → **remove** (M37).
- Moderation surface → **promote into nav** (M37; final placement inside Live workspace at M43).
- `/dashboard` → **demote to read-only status**; playout actions move to `/broadcast` (M41).
- `/overlay` headers → add `noindex` + `X-Robots-Tag: noindex` (M39). No URL change.

**Phase 5B, IA reset with route decisions (M43):**

- Live workspace gathers what is today on `/broadcast`, `/dashboard`, and `/moderation`. Final URL path decided at M43.
- Program workspace gathers what is today on `/schedule`, `/pools`, `/library`, `/sources`. Tabs inside one workspace. Final URL path decided at M43.
- Studio workspace gathers what is today on `/overlay-studio`, `/overlays`, `/output`. Tabs inside one workspace. Final URL path decided at M43.
- Admin workspace gathers what is today on `/team`, `/settings` (plus the "Workspace" section header). Final URL path decided at M43.

**Rule for M43 route decisions:**

- New canonical URL per workspace, plus redirects from every old path for at least one soak cycle.
- Inside a workspace, tabs use query params or hash routes so deep-linking to a tab is possible without an SSE tear-down.
- Old paths are removed only after a soak cycle confirms the redirects are in use without regressions.

---

## External-overlay legacy to remove

Every trace of the overlay framed as an external product. Concrete items:

- Delete the phrase in `docs/legacy-removal-list.md:111` when that file is merged (M42).
- Scan `docs/` for "external overlay", "browser source", "OBS overlay", "stream embed" — rewrite to "overlay" where accurate, remove where speculative (M39).
- Scan `apps/web/` for the same strings in UI copy. Replace with internal-output language (M39 + M40 surface-language cleanup).
- Add `noindex` and `X-Robots-Tag: noindex` to the `/overlay` route response (M39).
- Remove any public-doc link or README mention of `/overlay` as a usable URL for external consumers (M39).

---

## Duplicate or confusing menus to collapse

- **Engagement settings appear twice** today — once inside Scene Studio / overlay settings, once inside `/overlays`. Collapse into one tab (Studio → Engagement) at M46.
- **Destination settings appear twice** today — once on `/dashboard`, once on `/settings`. Collapse into Admin workspace at M41 + M43.
- **Playout actions appear on both `/broadcast` and `/dashboard`** — M41 removes them from `/dashboard` and keeps Live as the single action surface.
- **"Operations" / incidents detail** was removed from the nav but its content lives in scattered components on Dashboard. M41 consolidates into Live → incidents tab (or panel).

---

## Terminology migration table — one authoritative language map

Apply this during Phase 5A M40 (surface labels + doc copy) and during Phase 5B as workspace surfaces are rebuilt. The "Old" column is the term used somewhere today; the "New" column is the single word Codex should use going forward.

| Old term (current) | New term (future) | Notes |
|---|---|---|
| "Broadcast" (nav label) + "Dashboard" (nav label) | **Live** (workspace) | One authoritative operator surface for on-air control + readiness. Route naming at M43. |
| "Control Room" (section header in Phase 3 docs) | **Live** (workspace) | Unify on "Live"; retire "Control Room". |
| "Overlays" (nav label, routes to chat + alerts) | **Engagement** (tab inside Studio) | Engagement = chat + alerts + game. |
| "Scene Studio" (label) + "Overlay Studio" (URL segment, description) | **Scene** (tab inside Studio) | Scene is a tab inside Studio, not a standalone product. |
| "Stream Studio" (nav section header) | **Studio** (workspace) | Drop the "Stream" qualifier. |
| "Workspace" (nav section header) | **Admin** (workspace) | Team, settings, integrations, credentials, release channel. |
| "Programming" (nav section header) | **Program** (workspace) | Singular noun; one workspace with three lenses. |
| "Ops" / "Operations" (hidden route + legacy tab) | (deleted) | Its content moves to Live workspace. |
| "in-stream overlay" / "browser source" / "external overlay" / "OBS overlay" | **overlay** (always internal) | No qualifier. The overlay is internal output. |
| "pool block" / "block" (ambiguous) | **schedule block** backed by a **pool** | A schedule block always airs from a pool. |
| "emergency banner" / "emergency message" / "breaking banner" | **emergency banner** (pick one) | Single term everywhere: UI, docs, code identifiers. |
| "Go Live Checklist" / "readiness" / "readiness checks" | **readiness** | Readiness is the noun for the state; the checklist is a view. |
| "presence window" / "mod presence" / "!here window" / "check-in" | **moderation presence** | One term across chat response, docs, UI labels. |
| "release channel" / "deployment mode" | **release channel** | Already near-consistent; confirm single usage. |
| "Channel Blueprints" in nav/section labels | (demote to Admin feature) | Keep the feature name when describing it inside Admin; remove it from top-level navigation and section headers. |
| "Control room" / "Live ops" / "On-air" copy in UI | **Live** | Match the workspace name. |
| "Next up" / "Up next" / "Coming up" / "Coming up next" | **Up next** | One phrase across the overlay, Live workspace, Program lens, and Twitch title composition. |
| "Output profile" / "stream profile" / "encoding profile" | **output profile** | Settle on this in UI + docs + env-var documentation. |

This table is the reference for M40 (surface-language cleanup first pass) and binds for all subsequent milestones. A grep for the "Old" terms in `apps/web/` and `docs/` should return zero hits after M40 ships, excluding migration-history notes in `PLANS.md`.

---

## Ambiguous items — decide during implementation

These items are surfaced here so Codex doesn't silently choose. The decision record goes into the milestone that touches them.

- **`apps/web/app/api/asset-collections/`** — decide at M42 or M45 whether any UI consumes it. If yes, keep and document. If not, delete.
- **Legacy SSE fallback at `/broadcast`** — if Live workspace migration (M43) breaks the SSE consumer pattern, decide whether to keep the old SSE endpoint as a compatibility shim for one soak cycle or cut over immediately.
- **Curated sets vs pools overlap** — the Library has "curated sets"; the Program has "pools". Decide at M45 whether curated sets are a separate abstraction or just a preset for pool membership.
- **Scene metadata widgets** — the Scene Studio has metadata-driven widgets (current / next / later). Decide at M46 whether these stay as widgets or become standard "scene blocks" with a unified config surface.
