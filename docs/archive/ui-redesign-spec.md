# UI Redesign Specification

Updated: 2026-04-21

This document is the concrete implementation spec for the Phase 4 UI cleanup. It is intended to be specific enough that Codex can implement from it without ambiguity. The companion navigation changes are in `docs/archive/full-product-reset-plan.md`. The milestone that implements this is M29 (component primitives) and M30 (navigation cleanup).

---

## Philosophy

Stream247 is an operator product. The primary user is a person managing a live stream, often under time pressure. Design decisions should optimize for:

1. **Scannability** — the operator should be able to assess broadcast health in under 3 seconds
2. **No surprises** — status, labels, and actions should be predictable
3. **Keyboard-friendly** — forms and actions should work without a mouse
4. **Long-title safety** — no UI element should break or overflow due to a long title

The existing CSS design language (warm brown/green color scheme, frosted glass cards, IBM Plex Mono for code) is retained. The redesign is about structure and consistency, not visual identity.

---

## What "React-First" Means Here

**NOT:**
- Switching to Tailwind CSS
- Adding shadcn/ui or any external component library
- Replacing `globals.css`
- Rewriting the styling from scratch

**YES:**
- Creating typed React component primitives (`Button`, `Card`, `Badge`, `Input`, `Select`, `PageHeader`, `StatusChip`) in `apps/web/components/ui/`
- These components encapsulate the existing CSS classes and enforce usage rules
- `Badge` always wraps a content check — never renders when `children` is empty or whitespace
- Consistent prop interfaces so components can be refactored without touching all pages
- `globals.css` remains the authoritative style source; components standardize how it's applied

The goal is to make the existing CSS classes safe to use through a typed API, not to replace them.

---

## Component Primitives (M29)

All primitives live in `apps/web/components/ui/`. They are imported and used by page components. They do not introduce new styles — they wrap existing CSS classes.

### `Button`

```tsx
type ButtonProps = {
  variant: "primary" | "secondary" | "danger" | "ghost";
  size?: "sm" | "md" | "lg";
  disabled?: boolean;
  loading?: boolean;
  type?: "button" | "submit" | "reset";
  onClick?: () => void;
  children: React.ReactNode;
};
```

Maps to existing CSS button classes. `loading` shows a spinner and disables interaction. `danger` maps to the destructive action style.

### `Card`

```tsx
type CardProps = {
  padding?: "sm" | "md" | "lg";
  header?: React.ReactNode;
  footer?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
};
```

Always a `<section>` with the card CSS class. `header` renders above children with a divider. `footer` renders below children with a divider.

### `Badge`

```tsx
type BadgeProps = {
  variant?: "ready" | "warning" | "danger" | "neutral" | "live";
  children: React.ReactNode;
};
```

**Critical rule:** `Badge` must never render when `children` is empty, whitespace-only, or the literal string `"[]"`. Implementation:

```tsx
export function Badge({ variant = "neutral", children }: BadgeProps) {
  const text = typeof children === "string" ? children.trim() : children;
  if (!text || text === "[]") return null;
  return <span className={`badge badge-${variant}`}>{text}</span>;
}
```

This is the permanent fix for the `[]` bug pattern. Every badge in the product should use this component.

### `Input`

```tsx
type InputProps = {
  label: string;
  hint?: string;
  error?: string;
  placeholder?: string;
  value: string;
  onChange: (value: string) => void;
  maxLength?: number;
  showCharCount?: boolean;
  fullWidth?: boolean;
  disabled?: boolean;
};
```

Always stacked: label above, input below, hint/error below input. `showCharCount` displays `{current}/{max}` when `maxLength` is set. Never inline label + input.

### `Select`

```tsx
type SelectProps = {
  label: string;
  hint?: string;
  error?: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string; disabled?: boolean }[];
  fullWidth?: boolean;
  disabled?: boolean;
};
```

Always stacked. Never a custom dropdown — uses native `<select>` for accessibility.

### `Textarea`

```tsx
type TextareaProps = {
  label: string;
  hint?: string;
  error?: string;
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  maxLength?: number;
  showCharCount?: boolean;
  fullWidth?: boolean;
  disabled?: boolean;
};
```

### `PageHeader`

```tsx
type PageHeaderProps = {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
};
```

Renders the page title area. `title` uses the `.hero h2` style. `actions` renders to the right (flex row, gap 8px). Never overflows on long titles — uses `truncate`.

### `StatusChip`

```tsx
type StatusChipProps = {
  status: "ok" | "degraded" | "not-ready" | "unknown" | "live" | "offline";
  label: string;
};
```

Maps to existing status-color CSS classes. Always shows an icon + label. Never truncates — status labels are short by design.

---

## Layout Rules

### Admin shell

```
┌──────────────────────────────────────────┐
│  Sidebar (304px fixed)  │  Main content  │
│                         │                │
│  [Brand]                │  [PageHeader]  │
│                         │                │
│  [Nav sections]         │  [Content]     │
│                         │                │
│  [Status rail]          │                │
│  [Logout]               │                │
└──────────────────────────────────────────┘
```

- Sidebar: 304px, fixed position, full viewport height
- Main: flex-1, scrolls independently
- Status rail: pinned to bottom of sidebar (current on-air status)
- No top navigation bar

### Content area widths

- Forms: max-width 560px (never full-width on desktop)
- Wide content (tables, schedules, broadcast workspace): max-width 1200px
- Text-heavy content (architecture docs rendered in admin, if any): max-width 760px
- Content area padding: 32px horizontal, 24px vertical

### Responsive behavior

- Desktop (>900px): sidebar fixed 304px, content area fills remaining space
- Tablet (640–900px): sidebar collapses to top-bar with nav items in auto-fit grid; content area full width
- Mobile (<640px): sidebar at top (static), reduced padding 18px, nav items stacked in column
- The overlay page (`/overlay`) has its own layout and must not be affected by admin responsive breakpoints

---

## Navigation Rules (M30)

### Sidebar structure

```
[Brand / Logo]

LIVE
  · Broadcast
  · Dashboard

PROGRAMMING
  · Schedule
  · Pools
  · Library

STREAM STUDIO
  · Scene Studio
  · Overlays
  · Output

WORKSPACE
  · Sources
  · Team
  · Settings

[Status rail]
[Logout]
```

### Rules

- Section headers: uppercase, 11px, letter-spacing 0.08em, muted color — NO description paragraph beneath them
- Nav items: 14px medium, full-width, 36px height, left-padded 12px
- Active item: highlighted background, full-width
- Inactive item: transparent background, hover highlight
- All nav item labels: `truncate` with `title` attribute for full text on hover
- The `description` field in the nav data structure: **remove entirely**

### Route migration

| Old route | New route | Type |
|---|---|---|
| `/sources` (asset library) | `/library` | New route |
| `/sources` (ingest pipelines) | `/sources` | Unchanged URL, narrowed scope |
| `/ops` | Redirect to `/dashboard` | 301 redirect |
| Pools (currently nested in /sources) | `/pools` | New route |

---

## Card / Table / Form Rules

### When to use a Card

- Single primary metric + supporting details: use Card (e.g., "Current playing: [title]", "Destination: Twitch [status]")
- Status widgets with 1–4 data points
- Settings sections with 2–5 related fields

### When to use a Table

- Lists of things with 3+ properties: assets, sources, destinations, incidents, team members
- Always wrap in `overflow-x: auto` container
- Use sticky headers when list may scroll
- Max 2 lines of text per cell; overflow truncates with ellipsis and tooltip

### When to use a Form/Panel

- Any form with more than 3 fields: use a dedicated panel or page, never a modal
- Short forms (1–3 fields): can appear inline in a Card
- Modals: confirmation dialogs ONLY (delete confirmation, destructive action confirmation)

### Form field rules

- Label above input, always — never inline label + input
- Label: 14px medium, 4px bottom margin
- Helper text: 12px, muted color, 4px top margin
- Error text: 12px, danger color, 4px top margin — replaces helper text when error is present
- All fields full-width within their form container
- Form container: max-width 560px
- Section dividers: 1px border with 24px margin, section heading 16px semibold

---

## Typography Rules

### Font stack

- Admin UI: Aptos, Avenir Next, Gill Sans, Trebuchet MS, sans-serif (existing stack — keep)
- Code/mono: IBM Plex Mono, ui-monospace, SFMono-Regular, Menlo, monospace (existing stack — keep)
- No web font loading in the admin UI

### Scale

| Usage | Size | Weight |
|---|---|---|
| Nav section labels | 11px | 700 |
| Nav item labels | 14px | 500 |
| Form labels | 14px | 500 |
| Body text | 14–15px | 400 |
| Helper/error text | 12px | 400 |
| Card titles | 15–16px | 600 |
| Page titles | 2rem | 700 |
| Display metrics | 1.5–2rem | 700 |
| Code | 13px | 400 |

### Minimum sizes

- No UI text below 12px
- No code text below 12px
- Status chips: minimum 12px

---

## Long-Title Handling

This is a non-negotiable rule: **no UI element should ever cause layout overflow or wrapping due to a long title.**

### Rules by context

| Context | Rule |
|---|---|
| Nav item labels | `truncate` (overflow: hidden, text-overflow: ellipsis, white-space: nowrap), `title` attribute for full text |
| Card titles | `truncate-title` class (same as above), `title` attribute |
| Card subtitles / descriptions | `line-clamp-2` (max 2 lines, overflow clipped), tooltip on hover |
| Table cells (text) | `truncate` with `title` attribute |
| Form inputs | Native `<input>` scrolls internally; no truncation needed |
| Form labels | `truncate` at container width |
| Status chips | Short strings by design; no truncation rules needed |
| Overlay layer list (Scene Studio) | `truncate` with tooltip for layer name display |
| Video slot segments (schedule timeline) | `truncate` within the segment width; tooltip on hover for full title |

### Implementation pattern

For any text that may overflow:
```tsx
<span className="truncate-title" title={fullTitle}>{displayTitle}</span>
```

The `truncate-title` CSS class must set: `overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%;`

---

## Spacing Rules

The existing spacing system in `globals.css` is acceptable. Standardize on these values for Phase 4 work:

| Usage | Value |
|---|---|
| Nav item padding (horizontal) | 12px |
| Nav item height | 36px |
| Card padding | 20px |
| Form field gap (vertical) | 20px |
| Card gap (in a grid) | 16px |
| Section gap | 32px |
| Page content padding (horizontal) | 32px |
| Page content padding (vertical) | 24px |

---

## Specific Fixes Required

These are not optional. Each is a concrete bug or regression that must be addressed in M29 or M30.

### M29: Component primitives

1. Create `apps/web/components/ui/Badge.tsx` with the empty-content guard pattern (see above)
2. Create `apps/web/components/ui/Button.tsx` wrapping existing button CSS classes
3. Create `apps/web/components/ui/Card.tsx` wrapping existing card CSS classes
4. Create `apps/web/components/ui/Input.tsx` with stacked label layout
5. Create `apps/web/components/ui/Select.tsx` with stacked label layout
6. Create `apps/web/components/ui/PageHeader.tsx`
7. Create `apps/web/components/ui/StatusChip.tsx`
8. Update `apps/web/components/overlay-scene-canvas.tsx` to use `Badge` primitive (eliminates direct `visibleOverlayText` dependency — the primitive enforces the same rule)

### M30: Navigation cleanup

1. Remove `description` field from all nav section objects in `admin-navigation.tsx`
2. Add `title` attribute to all nav link elements
3. Implement the new 4-section, 11-link navigation structure
4. Add `title` attribute to all truncated text elements across the layout
5. Add 301 redirect from `/ops` to `/dashboard`
6. Move incidents display to `dashboard/page.tsx`
7. Create `/pools` route (currently nested in sources page)
8. Create `/library` route (currently at `/sources` but for assets)
9. Narrow `/sources` to ingest pipeline management only

---

## Acceptance Checklist

Before M29 is considered complete:

- [ ] All 7 primitives exist in `apps/web/components/ui/`
- [ ] `Badge` never renders when children is empty/whitespace/`"[]"`
- [ ] `Input` and `Select` always use stacked label layout
- [ ] `overlay-scene-canvas.tsx` uses `Badge` primitive
- [ ] `pnpm validate` passes
- [ ] Existing browser smoke tests pass

Before M30 is considered complete:

- [ ] Sidebar has no description paragraphs under section headers
- [ ] All nav items have `title` attribute
- [ ] Navigation matches the 11-link spec above
- [ ] `/ops` redirects to `/dashboard`
- [ ] Incidents are visible on the Dashboard page
- [ ] `/pools` route works and shows pool management
- [ ] `/library` route works and shows asset/upload management
- [ ] `/sources` route shows ingest pipeline management only
- [ ] No broken links anywhere in admin navigation
- [ ] `pnpm validate` passes
- [ ] Browser smoke test covers all navigation items
