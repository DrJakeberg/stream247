# Stream247 Product Reset — UI Spec

Updated: 2026-04-22

This is the design contract for the redesign that ships in Phase 5B (M43–M48). It is how every new surface is built and how every existing surface is brought into line. It is not a pixel spec — it is a rules spec that Codex can implement without a designer in the loop.

Companions: `docs/product-reset-audit.md` (why), `docs/product-reset-target-state.md` (product model), `docs/product-reset-kill-list.md` (what leaves + terminology migration), `docs/product-reset-docs-plan.md` (docs hygiene). Implementation milestones in `PLANS.md` Phase 5.

---

## React-first direction

The admin app is a Next.js 15 App Router product. Every navigation interaction must behave like a single-page app until a hard reload is explicitly needed.

- **All internal navigation uses `next/link` `<Link>`**. Never `<a href="/…">` for an in-app route. The current regression at `apps/web/components/admin-navigation.tsx:20` is the anti-example: `<a href>` forces a full document reload, which drops every SSE subscription (broadcast feed, live overlay, readiness stream) on every click. M37 fixes this; the rule becomes permanent.
- **Default to React Server Components for data fetch.** A page's top-level component is a server component unless it needs interactivity. Fetch data in the server component; pass it down. Do not hydrate a large tree just to read one piece of state.
- **Client components are opt-in for interactivity.** Forms, buttons with handlers, SSE subscribers, editors. The `"use client"` directive is the marker — keep it at the leaves.
- **SSE-bound surfaces must survive internal navigation.** The broadcast feed, engagement feed, and live overlay preview all subscribe via `EventSource`. Because navigation is now SPA-style, the subscription persists across links that do not remount the shared layout. If a subscription must live across workspaces, hoist it into the admin layout, not a page.
- **No route-level suspense boundaries that wipe sidebar state.** The shell (sidebar + header + SSE clients) lives in `apps/web/app/(admin)/layout.tsx` and does not re-render on workspace switch.

---

## Navigation rules

Navigation is one sidebar, four workspaces, each with its own internal tabs. The model is in `product-reset-target-state.md`; the UI rules here apply regardless of which final route strings M43 picks.

- **One sidebar, four top-level entries**: Live, Program, Studio, Admin. No second navigation layer in the sidebar itself.
- **Workspace internal nav is tabs inside the workspace**, rendered with the `Tabs` primitive (new, added in M44). Tabs live in the workspace's `PageHeader`, not in the sidebar.
- **Active state is derived from `usePathname()`.** Never from prop-drilled state, never from a URL substring the parent computes. Each link computes its own active state.
- **No section headers in the sidebar beyond the four workspace names.** The current "LIVE / PROGRAMMING / STREAM STUDIO / WORKSPACE" grouping disappears; workspaces *are* the top-level entries.
- **Long nav labels wrap to a second line; they never truncate with an ellipsis in the sidebar.** Use `word-break: break-word` and a two-line clamp. The `title` attribute still holds the full text for hover. The nav-link CSS block in `apps/web/app/globals.css` is updated in M37.
- **Sidebar badges render with `StatusChip`, not inline spans.** Twitch live status, playout status, incident count — all go through the primitive.
- **Operator shortcuts (skip, pause, go-live) are never in the sidebar.** The sidebar navigates; it does not act.

---

## Layout rules

Every admin page follows the same skeleton. Deviations require a written reason in the PR description.

- **Every page uses the `PageHeader` primitive.** The header is the top band of the page: title, subtitle (optional), status rail (status chips), action rail (primary + secondary buttons). No page renders its own bespoke header.
- **Workspace body is a two-column grid: main + aside.** The aside is an optional right-hand rail for live state (what's on air, what's up next, active presence window). If a workspace does not need live state on the right, it collapses to a single column — but the grid template is the same so layout does not shift.
- **Nested panels never go deeper than two.** A card inside a tab panel is fine. A card inside a card inside a panel is not.
- **Sticky headers on operator surfaces.** The Live workspace and the Now+Next lens of Program keep their header visible while the body scrolls. Admin screens do not.
- **Content width is capped at 1400px.** Above that, the workspace is centered. This matches what the current admin layout already does and stays.
- **Spacing comes from a token scale, not ad-hoc pixels.** The app already uses `--space-*` CSS variables; new components use them instead of literal `px` for padding/margin.

---

## Component primitives

The canonical primitives live in `apps/web/components/ui/`. Everything is built from them. Pages do not style base HTML directly.

### Existing, keep

- **`Button`** — single component, variants `primary` / `secondary` / `ghost` / `danger`, sizes `sm` / `md` / `lg`. No `<button>` styled ad-hoc; no bespoke action components that re-implement button styling.
- **`Badge`** — for short static labels on chips, list rows, and table cells. The `resolveBadgeContent` guard at `apps/web/components/ui/Badge.tsx:9` is canonical: it strips empty and `"[]"` content. Every text rendering that might show a placeholder uses the same pattern.
- **`StatusChip`** — for live/offline/ready/warning/error state. Includes an optional dot and an optional count. Used by the sidebar Twitch chip, the playout chip, the destination health badges, and the readiness list.
- **`Card`** — container with consistent border, padding, and header slot. Every actionable grouping on a page is a Card.
- **`Input`** — single text-input component; label above, helper text below, error message inline. No bespoke styled inputs.
- **`Select`** — single dropdown component; used for category, show profile, output profile, destination type. No bespoke `<select>` styling.
- **`PageHeader`** — the header band described above.

### New, added in M44

- **`Tabs`** — the internal nav for workspaces. Keyboard-accessible (Left/Right arrow keys, Home/End), URL-synced (tab selection updates a `?tab=` query param or the pathname segment, depending on route shape from M43), and visually distinct from the sidebar. One `Tabs` per workspace.
- **`EmptyState`** — for empty queues, empty pools, empty libraries, empty schedules. Title + body + optional primary action. No empty surface renders a blank card or a raw "No items" string.
- **`Toast`** — non-blocking feedback for save / publish / error events. Replaces the current ad-hoc banner approach. Stacked top-right, auto-dismiss with configurable duration, accessible live region.
- **`Textarea`** — multi-line text input with the same label/helper/error shape as `Input`. Used for asset notes, incident notes, scene text layers. No bespoke styled textareas.

Shipped files:

- `apps/web/components/ui/Tabs.tsx`
- `apps/web/components/ui/EmptyState.tsx`
- `apps/web/components/ui/Toast.tsx`
- `apps/web/components/ui/Textarea.tsx`

Reference adoption in M44:

- Program workspace tabs now render through `Tabs` via `apps/web/components/workspace-tabs.tsx`.
- Program empty states in schedule, pools, and sources now render through `EmptyState`.
- Program save flows now emit `Toast` notifications from the admin shell.
- Show-profile editing now uses `Textarea` for the multi-line description field.

### Sanitation at the render boundary

Every text value that reaches the UI from a DB column or an API response flows through one utility: `stripInvisibleCharacters()` (added to `packages/core` in M36). The `resolveBadgeContent` pattern at `Badge.tsx:9` is the existing example — extend it everywhere text is rendered.

- Titles, prefixes, notes, hashtags, scene layer text, destination labels, source names — all sanitized.
- Sanitation is a display concern as much as a storage concern. Even if M36 also sanitizes at write, the render layer still sanitizes, because history rows and legacy data pre-date the write sanitizer.

---

## Form rules

Every form in the admin app follows these rules. If a form currently violates them, M44–M46 brings it into line.

- **Vertically stacked fields.** Label above, input below, helper text below, inline error below. No horizontal two-column layouts for forms that handle user-entered titles, prefixes, or URLs — those forms read top-to-bottom.
- **Labels always visible.** Placeholder-only inputs are banned.
- **Inline errors, not blocking dialogs.** A failed submit highlights the field and shows the error inline. Toasts announce the error for screen readers.
- **Primary submit button is right-bottom.** Secondary (cancel, reset) sits to its left. Destructive actions are separated visually and use the `danger` variant.
- **Disabled state carries a reason.** A disabled submit button has a `title` tooltip explaining why (missing field, unsaved dependency, permission).
- **Hashtags are a chip input, never a raw JSON textarea.** The `Textarea` approach on the current per-video metadata form is replaced with a chip input that adds on Enter, removes with Backspace, and strips invisible characters at insertion time.
- **Category is a `Select` bound to the show profile.** Operators pick from the show's configured categories. Per-video override is allowed, but the value must exist on the show profile — no free-text overrides.
- **Replay is a boolean toggle, not a typed `"Replay: "` string.** The system composes the broadcast title via `buildTwitchMetadataTitle` at `apps/worker/src/twitch-metadata.ts:21` — the toggle feeds that function, operators never hand-type the prefix.
- **Autosave is opt-in per form.** Default is explicit save. Draft/publish workflows (Scene, Program schedule) use explicit publish, not autosave.
- **Every form submit shows a `Toast` on success.** No silent saves.

---

## Table vs card rules

Pick based on shape of data. Do not mix both in the same view.

- **Tables** for homogeneous sortable lists. Rows represent the same kind of thing and are scannable column-by-column. Examples: schedule rows, destinations, incident history, readiness checks, drift history.
- **Cards** for heterogeneous actionable items. Each card is a unit of action with its own controls. Examples: assets in the library, pools, scenes, engagement alerts.
- **A table row never contains a card. A card never contains a table.** If you need a nested list, use a definition list or an inline list, not a second primitive.
- **Tables are keyboard-accessible.** Column headers are `<th>` with sort semantics where sortable; rows are focusable where actionable.
- **Cards declare their actions in a consistent slot.** The bottom-right of the card is the primary-action slot. Secondary actions go in a menu.

---

## Long-title behavior

This is the rule for every title-like string in the app: asset titles, pool names, scene names, source names, destination names.

- **Wrap, don't truncate.** CSS: `word-break: break-word` + `overflow-wrap: anywhere` where CJK-safe; a two-line clamp via `-webkit-line-clamp: 2` is acceptable for card headers where vertical space is bounded.
- **Never `text-overflow: ellipsis` on navigation items.** The current sidebar ellipsis behavior is removed in M37.
- **The full value is always available in `title`.** So a hover tooltip still shows the complete string even when the clamp trims it.
- **Cards do not get wider to accommodate a long title.** The clamp handles it; the grid does not reflow.
- **Broadcast `PageHeader` is the one exception where wrapping is preferred over clamping.** Operators need to see the full current and next title. The `Live` workspace header allows the title to wrap to three lines before any clamping.

---

## Online-studio UX rules

Studio is one workspace with three tabs: Scene, Engagement, Output. (See `product-reset-target-state.md` for the full model.)

- **One workspace header across all three tabs.** The header carries the publish state (Draft / Published / Dirty), the publish button, and the emergency-banner toggle.
- **Publish is a single explicit action with a diff preview.** Click "Review changes" → modal shows the diff between current draft and live scene (added layers, removed layers, changed positions, changed text) → confirm publishes. No one-click-apply without a review step.
- **Scene tab is the layer-based editor.** Safe-area boundaries are visually overlaid on the canvas at 5% inset. Layers outside the safe area show a warning chip unless the operator toggled "allow outside safe area" for that layer.
- **Emergency banner is the top-right action on the Scene tab.** One-click to activate, one-click to deactivate. Active state is visually unmistakable (red border on the workspace header).
- **Engagement tab contains chat, alerts, and the chatter-participation game.** One tab, three sections. No duplicate engagement settings in other workspaces; the current overlap between `/overlays` and the chat-settings form collapses here.
- **Output tab contains the output profile and the destination list.** Per-destination output profile overrides live inline on each destination row. Destination health badges use `StatusChip`.

---

## Planning UX rules

Program is one workspace with three lenses: Week, Day, Now+Next.

- **Video-level granularity is the default view.** Every lens shows the actual asset about to play, not just the pool name. Operators switch to a pool-level collapse as a visual option, not a separate page.
- **Week lens is a seven-day grid.** Each block shows its first resolved video title (from `lookaheadVideoTitleFromPool` at `packages/core/src/index.ts:1943`) with an expand affordance to reveal the full video-level sequence.
- **Day lens is a vertical timeline.** Every asset slot is rendered with its runtime, category, and Replay flag.
- **Now+Next lens matches what the Live workspace shows in its header chip.** Currently playing + next two + fallback chain. The two surfaces agree because they read the same resolver.
- **Next-title resolution is real, not a placeholder.** No "next: (upcoming)" strings. If the resolver returns null, the UI renders an `EmptyState` explaining why (empty pool, no source assigned) with a link to fix it.
- **Schedule block editing is inline.** Click a block → popover form on the grid. No route change for a minor edit. Deeper edits (pool rotation rules, repeat sets) open a drawer on the same page.
- **Per-video metadata editing is inline inside whichever lens the operator is in.** Click an asset → metadata drawer opens on the right. The drawer contains Replay toggle, hashtag chips, category `Select`, and notes `Textarea`. Operators never leave the Program workspace to edit a video's metadata.
- **The Program workspace preserves scroll position and active lens across tab switches.** Revisiting Program lands where it was left.

---

## Responsive behavior

The app targets a desktop operator station first. Responsiveness is a degradation, not a re-architecture.

- **Sidebar collapses to an icon rail below 900px viewport width.** Workspace name shown as a tooltip on hover.
- **Workspace tabs collapse to a horizontal scrollable strip below 900px.** Active tab is auto-scrolled into view.
- **Forms render every field full-width below 600px.** Two-column fields collapse to one column.
- **No horizontal scroll on operator surfaces.** Tables that would overflow get a scrollable body with a fixed header.
- **Mobile is not a target use case.** No phone-specific layouts, no touch-first gestures. Below 600px the app remains usable but not optimized.

---

## Consistency rules Codex can implement

These are the enforceable rules. A PR that violates one should fail review. Ordered roughly by how often they come up.

1. **Use `<Link>` for every internal route.** Never `<a href="/…">`.
2. **Use `PageHeader` for every page's top band.** No bespoke page headers.
3. **Use `StatusChip` for every live/offline/ready/warning/error indicator.** No inline styled spans.
4. **Use `Badge.resolveBadgeContent` for every string that might be empty or `"[]"`.** Do not bypass it by rendering the raw value.
5. **Use the `Input`, `Select`, `Textarea`, and new `Tabs` primitives.** No bespoke styled HTML form controls.
6. **Sanitize every displayed text through `stripInvisibleCharacters()` at the render boundary.** Titles, notes, prefixes, hashtags, scene text, destination labels.
7. **Forms are vertically stacked; labels above inputs; primary action right-bottom.** No exceptions without a PR reason.
8. **Hashtags are chip input, not JSON blobs or freeform text.**
9. **Category is a `Select` bound to the show profile, not free-text.**
10. **Replay is a boolean toggle; the worker composes the title.** Operators never type `"Replay: "`.
11. **Publish is always explicit with a diff preview; there is no autosave-publish.**
12. **Empty surfaces render `EmptyState`; they never render a blank card or a raw "No items" string.**
13. **Save / publish / error feedback goes through `Toast`, not through inline banners or page-level alerts.**
14. **Long titles wrap; they do not truncate with ellipsis in the sidebar or in card headers.**
15. **Workspace state (scroll position, active tab) persists across internal navigation within that workspace.**
16. **SSE subscriptions are declared in the admin shell, not in leaf pages.** Leaf pages read from context.
17. **Every nav link computes its own active state from `usePathname()`.**
18. **Disabled interactive elements carry a `title` tooltip reason.**
19. **Nested panels never go deeper than two levels.**
20. **No bespoke colors; every color comes from a token.** If a new color is needed, it goes in the token palette first.

---

## Out of scope for the UI spec

- Icon set overhaul. Current icon usage is adequate.
- Dark-mode / light-mode duality. The app is dark-mode only.
- Animation library. Subtle CSS transitions are fine; no framer-motion introduction.
- Accessibility audit beyond the rules listed. WCAG AA is the target where practical; a full a11y pass is a future milestone.
- Typography scale rework. The existing scale is fine.
- i18n. Single-language UI per `product-reset-target-state.md` non-goals.
