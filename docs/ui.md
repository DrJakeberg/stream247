# UI

Updated: 2026-04-22

This document defines the permanent UI contract for the shipped admin app. It describes the current workspace model, the component rules new surfaces must follow, and the canonical product language used across the UI and docs.

## Product Framing

The admin UI exists for Stream247's internal 24/7 stream product.

- The overlay is internal output for Stream247's own broadcast.
- The admin UI is a single-page operator surface, not a public product shell.
- Workspace navigation is optimized for desktop operator use, not for touch-first mobile operation.

## Workspace Model

The app has four top-level workspaces and uses tabs inside each workspace.

- `Live` at `/live`
  - `control`
  - `status`
  - `moderation`
- `Program` at `/program`
  - `schedule`
  - `pools`
  - `library`
  - `sources`
- `Studio` at `/studio`
  - `scene`
  - `engagement`
  - `output`
- `Admin` at `/admin`
  - `settings`
  - `team`

Legacy admin routes may continue to redirect, but the workspace URLs above are the canonical entry points.

## Navigation Rules

- All internal navigation uses Next.js `Link`, never raw `<a href>` for in-app routes.
- The sidebar contains only the four workspace entries.
- Workspace-internal navigation is rendered as tabs inside the page body, not as a second sidebar.
- Active state is derived from `usePathname()` and the current tab value.
- Long sidebar labels wrap; they do not ellipsize.
- Sidebar and page status indicators use `StatusChip`.
- The sidebar navigates only. Operator actions do not live there.

## Layout Rules

- Every admin page uses a `PageHeader`-style top band for title, subtitle, state, and actions.
- Workspace content defaults to a stacked form layout, with a two-column grid only when the surface needs a supporting aside.
- Nested panels do not go deeper than two levels.
- The admin shell stays mounted across internal navigation so SSE-backed surfaces survive route changes.
- Content width stays capped instead of stretching arbitrarily on wide displays.

## Component Primitives

Canonical primitives live in `apps/web/components/ui/`.

Keep using:

- `Button`
- `Badge`
- `StatusChip`
- `Card`
- `Input`
- `Select`
- `PageHeader`

Required current additions:

- `Tabs`
- `EmptyState`
- `Toast`
- `Textarea`

New surfaces should build from those primitives instead of bespoke styled HTML controls.

## Text Handling Rules

- Sanitize text at both write and render boundaries.
- UI rendering must not show empty placeholder strings or raw `"[]"`.
- Long titles wrap or clamp safely; they do not force layout growth.
- The full unclamped value stays available via `title` where the surface needs bounded height.
- Replay labels, hashtags, notes, scene text, source names, destination names, and queue titles all follow the same sanitation rules.

## Form Rules

- Forms are vertically stacked by default.
- Labels stay visible; placeholder-only fields are not used as labels.
- Errors render inline with the field.
- Success and failure feedback use `Toast`.
- Primary save actions sit at the lower right of the form action row.
- Disabled actions carry a reason through a tooltip or `title`.
- Hashtags are chip inputs, not raw JSON blobs.
- Category selection uses the shipped `Select` model.
- Replay is a boolean operator control; the worker composes the outward-facing title.

## Program Workspace Rules

- `Program` is the canonical workspace for schedule, pools, library, and sources.
- Video-level visibility is the default operator model.
- `Week`, `Day`, and `Now + Next` are lenses inside the schedule surface, not separate products.
- Metadata editing stays inside the workspace instead of sending the operator to a separate detour page.
- “Up next” copy is consistent across Program, Live, and overlay output.

## Studio Workspace Rules

- `Scene`, `Engagement`, and `Output` are tabs inside one Studio workspace.
- Publish is explicit and reviewable.
- Emergency banner controls stay prominent inside `Scene`.
- Chat, alerts, and engagement behavior live together under `Engagement`.
- Output profile and destination management live together under `Output`.

## Responsive Rules

- Desktop is the primary target.
- The sidebar can collapse, but the workspace model stays the same.
- Workspace tabs can scroll horizontally on narrower screens.
- Forms collapse to one column on narrow layouts.
- No operator surface should require horizontal page scrolling.

## Canonical Terms

Use these terms consistently in UI copy, docs, and review comments.

| Old term | Canonical term | Notes |
|---|---|---|
| Broadcast + Dashboard | `Live` | One workspace for on-air control and current-state visibility. |
| Programming | `Program` | The workspace that owns schedule, pools, library, and sources. |
| Stream Studio | `Studio` | The workspace for scene, engagement, and output. |
| Workspace | `Admin` | The workspace for settings, team access, credentials, blueprints, and release posture. |
| Overlays | `Engagement` | Chat, alerts, and active audience interactions. |
| Scene Studio / Overlay Studio | `Scene` | The scene editor tab inside Studio. |
| browser source / external overlay / OBS overlay | `overlay` | Always treated as Stream247's internal broadcast output. |
| pool block / block | `schedule block` | A schedule block airs from a pool. |
| emergency message / breaking banner | `emergency banner` | One consistent operator-facing term. |
| presence window / !here window / mod presence | `moderation presence` | One consistent term across chat replies, docs, and UI. |
| stream profile / encoding profile | `output profile` | The rendering and delivery profile for the stream or destination. |
| Next up / Coming up / Coming up next | `Up next` | One phrase across Live, Program, and overlay output. |

## Non-goals

- No mobile-first redesign.
- No public overlay product.
- No second design system alongside the shipped UI primitives.
- No speculative route split beyond the current four-workspace model.
