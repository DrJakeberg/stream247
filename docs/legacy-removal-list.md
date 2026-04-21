# Legacy Removal List

Updated: 2026-04-21

This document is the hard remove/keep/replace list for Phase 4. It covers documentation files, navigation items, UI surfaces, and settings patterns that should be cleaned up. Actual deletion and refactoring happen in the implementation milestones (M34 for docs, M30 for navigation). This list is the decision record.

---

## Documentation Files

| File | Decision | Reason |
|---|---|---|
| `docs/stream247-upstream-gyre-gap-analysis.md` | **DELETE IMMEDIATELY** | Two-paragraph redirect stub. Contains no content. References `upstream-gap-analysis.md` and `upstream-roadmap.md`. |
| `docs/redesign-and-product-plan.md` | **DELETE** (M34) | Phase 3 planning artifact. All milestones shipped. Mixes future and past tense. Actively misleads readers about what is built vs planned. Replace with `docs/full-product-reset-plan.md`. |
| `docs/video-planning-and-metadata-model.md` | **DELETE** (M34) | Implementation notes for M21/M22/M23. All shipped. Replace with accurate product docs in `docs/overlay-model.md` and `docs/stream-configuration.md` when those are written. |
| `docs/in-stream-overlay-and-output-strategy.md` | **DELETE** (M34) | Implementation notes for M21/M24/M25. All shipped. Same replacement path as above. |
| `docs/upstream-gap-analysis.md` | **DELETE** (M34) | Internal competitive analysis. Not product documentation. Should not be in a public repo's docs folder. |
| `docs/upstream-roadmap.md` | **DELETE** (M34) | Internal competitive roadmap through M17. Now superseded by PLANS.md which goes to M28+. |
| `docs/architecture.md` | **KEEP** | Accurate service topology and persistence model. Operational reference. |
| `docs/operations.md` | **KEEP** | Active operator runbook. Include backup-and-restore content. |
| `docs/deployment.md` | **KEEP** | Active deployment guide. Merge versioning and upgrading content. |
| `docs/backup-and-restore.md` | **MERGE INTO `operations.md`** (M34) | Adds a "Backup" section to the operations runbook. File becomes redundant after merge. |
| `docs/twitch-setup.md` | **KEEP** | Active Twitch setup guide. May eventually merge into a broader `integrations.md`. |
| `docs/upgrading.md` | **MERGE INTO `deployment.md`** (M34) | Adds an "Upgrading" section. File becomes redundant after merge. |
| `docs/versioning.md` | **MERGE INTO `deployment.md`** (M34) | Adds a "Release Channels" section. File becomes redundant after merge. |
| `docs/moderation-policies.md` | **KEEP** | Active policy reference for the `!here` command and presence windows. |
| `docs/full-product-reset-audit.md` | **KEEP** (this file) | Current audit. Should be revisited after Phase 4 ships. |
| `docs/full-product-reset-plan.md` | **KEEP** | Phase 4 target state. Active planning reference. |
| `docs/legacy-removal-list.md` | **KEEP** (this file) | Decision record for Phase 4 cleanup. |
| `docs/ui-redesign-spec.md` | **KEEP** | Implementation spec for M29/M30 component and navigation work. |
| `docs/docs-reset-plan.md` | **KEEP** | Defines the final doc set. Active reference for M34. |

---

## Navigation Items and Routes

| Item | Decision | Reason |
|---|---|---|
| `Operations` nav item (`/ops`) | **REPLACE** (M30) | Merge incidents and drift into Dashboard. `/ops` redirects to `/dashboard`. |
| `Library` nav item (at `/sources`) | **REPLACE** (M30) | Split into separate `Library` (assets/uploads at `/library`) and move `Sources` to Workspace section. |
| `Moderation` nav item (`/moderation`) | Not currently in nav (it's in Workspace > Settings). If a standalone item exists anywhere, remove it. | Moderation is a Settings subsection, not a top-level destination. |
| `Sources` as a hidden subsection of Library | **REPLACE** (M30) | Move `Sources` to the Workspace section as a top-level nav item. Ingest pipeline management belongs with integrations, not with content browsing. |
| `Pools` as a hidden subsection of Library | **REPLACE** (M30) | Move `Pools` to the Programming section as a top-level nav item. Pools are programming primitives, not library items. |
| Sidebar section description paragraphs | **REMOVE** (M30) | The `description` field in nav sections renders explanatory text under each section header. Remove it. Brand + nav items + logout only. |

### Target navigation structure (post-M30)

```
CONTROL ROOM
  Broadcast     /broadcast
  Dashboard     /dashboard      (absorbs incidents from /ops)

PROGRAMMING
  Schedule      /schedule
  Pools         /pools          (currently nested in /sources)
  Library       /library        (currently /sources, assets/uploads only)

STREAM STUDIO
  Scene Studio  /overlay-studio
  Overlays      /overlays
  Output        /output

WORKSPACE
  Sources       /sources        (ingest pipelines — currently mixed into Library)
  Team          /team
  Settings      /settings
```

This is 12 items across 4 sections, but each item has a clear and distinct purpose.

---

## UI Surfaces

| Surface | Decision | Reason |
|---|---|---|
| Sidebar "Operator model" description card | **REMOVE** (M30) | Renders explanatory paragraphs for each nav section. Wastes vertical space. Experienced operators do not need it. |
| `Operations` page as a standalone admin page | **MERGE** (M30) | Incidents and drift content moves to Dashboard. `/ops` redirects. |
| "Channel Blueprints" as a nav/section headline | **DOWNGRADE** | Blueprints are a Settings feature. Remove from any nav label or top-level callout. |
| Donation/bits alert placeholder in Overlays admin | **ADD** (M32) | Currently absent. Add a visible "not yet available" section so operators understand the scope. |
| `!here` moderation command in Settings UI | **FIX OR REMOVE** (M29) | The UI exists, the doc exists, the code does not work. Either implement the command parser (correct path) or remove the UI and doc entry. |

---

## Settings Page Conflation

The Settings page currently mixes several distinct concern areas. These should be split into named sections or subsections:

| Current location | Should be | Priority |
|---|---|---|
| Owner credentials / 2FA | Settings > Security | Keep as-is |
| Twitch OAuth connection | Settings > Integrations | Move to visible sub-section |
| Discord webhook / SMTP alerts | Settings > Integrations | Move to same sub-section as Twitch |
| Secrets management | Settings > Secrets | Keep as-is |
| Team access | `/team` (already separate) | Keep as-is |
| Channel Blueprints | Settings > Blueprints | Keep as-is |
| Moderation policy | Settings > Moderation | Add as subsection; remove as standalone nav page |

This is a visual/tab organization change, not a data model change.

---

## External Overlay Assumptions

Stream247's overlay is an in-stream visual layer captured by Chromium and composited by FFmpeg. It is not an OBS overlay URL product.

The following assumptions should be cleaned up:

| Assumption | Where | Fix |
|---|---|---|
| `/overlay` page is usable as an external stream overlay | docs and URL availability | Add `noindex` meta. Remove from any public-facing docs. Keep URL for Chromium capture. |
| Overlay page is "accessible at `/overlay` for external use" | `docs/in-stream-overlay-and-output-strategy.md` | This doc will be deleted (M34). New overlay-model doc should state clearly: in-stream only. |
| Overlay can be "pasted into OBS" | README or docs | Audit README and remove any such language. |

---

## Dead Weight Summary

Items that exist, create confusion or maintenance burden, and have near-zero value:

1. `docs/stream247-upstream-gyre-gap-analysis.md` — delete today
2. Section description paragraphs in sidebar nav — remove in M30
3. Three Phase 3 planning docs (`redesign-and-product-plan.md`, `video-planning-and-metadata-model.md`, `in-stream-overlay-and-output-strategy.md`) — delete in M34
4. Two competitive analysis docs (`upstream-gap-analysis.md`, `upstream-roadmap.md`) — delete in M34
5. Standalone `Operations` nav route — merge into Dashboard in M30
6. Library nav item conflation — split in M30
