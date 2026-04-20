# Video-Level Planning And Metadata Model

Updated: 2026-04-20

This document details the data model and UX design used to move Stream247 from pool-level schedule visibility to video-level schedule visibility, and to support per-video metadata editing that correctly drives Twitch title, category, and hashtag sync.

---

## Problem Statement

The schedule model stores blocks at pool granularity:

```
schedule_block:
  title = "Morning Rotation"
  category_name = "Just Chatting"
  pool_id = "pool_twitch_vods"
  duration_minutes = 120
```

Without the Phase 3 lookahead path, that means:
- The operator knows a pool will play for 2 hours
- The operator does NOT know which videos will play in which order
- The broadcast control room shows "Next: Morning Rotation" or placeholder copy — neither is useful
- The Twitch stream title is set to the schedule block title, not the actual video title
- The in-stream overlay shows pool names to viewers

The fix requires two independent but related changes:

1. **Runtime title resolution**: At any given moment, resolve the actual next video title from the pool cursor instead of using the schedule block title
2. **Preview lookahead**: In the schedule UI, show a predicted video list for each schedule block

---

## Legacy Title Resolution Path

```
nextTitle = overrides.nextTitle
         || nextScheduleItem?.title         // "Morning Rotation" ← wrong
         || "Coming up next"
```

The `nextScheduleItem` is the NEXT SCHEDULE BLOCK, not the next VIDEO. Its title is the human-readable name the operator gave to the block when creating it.

The correct path for `nextTitle` when the next item is a pool-backed schedule block:

```
nextTitle = lookaheadAssetFromPool(nextScheduleItem.poolId, pools, assets)?.title
         || nextScheduleItem.title    // fallback if pool is empty or unknown
         || "Coming up next"
```

The `lookaheadAssetFromPool` function walks one step forward from the pool cursor to find the predicted next video:

```typescript
function lookaheadAssetFromPool(
  poolId: string,
  pools: PoolRecord[],
  assets: AssetRecord[]
): AssetRecord | undefined {
  const pool = pools.find(p => p.id === poolId);
  if (!pool) return undefined;
  const eligible = assets.filter(a =>
    JSON.parse(pool.sourceIds || "[]").includes(a.sourceId) &&
    a.includeInProgramming &&
    a.status === "ready"
  );
  if (eligible.length === 0) return undefined;
  const cursorIndex = eligible.findIndex(a => a.id === pool.cursorAssetId);
  // one step forward from cursor, wrapping
  return eligible[(cursorIndex + 1) % eligible.length];
}
```

This is a read-only, no-persistence operation. It does not advance the cursor. It is suitable for broadcast snapshots and overlay text construction.

---

## Schema Changes Required for M21

These changes are additive migrations. All existing rows get empty defaults.

### assets table

```sql
ALTER TABLE assets ADD COLUMN IF NOT EXISTS title_prefix TEXT NOT NULL DEFAULT '';
ALTER TABLE assets ADD COLUMN IF NOT EXISTS hashtags_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE assets ADD COLUMN IF NOT EXISTS platform_notes TEXT NOT NULL DEFAULT '';
```

- `title_prefix`: e.g. "Replay:", "Music:", "VOD:". Prepended to `title` when building the Twitch stream title and in-stream overlay display title. Max 20 characters recommended.
- `hashtags_json`: JSON array of strings, e.g. `["werbung", "nyfte", "gaming"]`. Appended to the Twitch stream title during sync. Not shown in the overlay by default but configurable.
- `platform_notes`: free-text operator notes about this video (not synced anywhere, operator reference only).

### schedule_blocks table (no changes needed for M21)

The schedule block `category_name` already exists and is correct for block-level Twitch schedule sync. The video-level category override lives on the asset.

---

## Twitch Title Construction After M21

When syncing the Twitch stream title for the current playing asset:

```
prefix = asset.title_prefix (trimmed, e.g. "Replay:")
title  = asset.title
hashtags = JSON.parse(asset.hashtags_json || "[]")
           .map(tag => `#${tag}`)
           .join(" ")

desiredTitle = [prefix, title, hashtags]
               .filter(Boolean)
               .join(" ")
               .slice(0, 140)    // Twitch title max
```

Fallback if no asset:

```
desiredTitle = currentScheduleItem?.title
             || state.playout.currentTitle
             || state.overlay.channelName
             || "Stream247"
```

The `[]` visual bug in the overlay is caused by the `tags_json` value (which contains `"[]"` as its default) being appended to title text somewhere in the overlay text rendering. The fix is to never use `tags_json` for display purposes — it is a library curation field only. The new `hashtags_json` field is the display/sync field.

---

## Empty Bracket Fix

The empty `[]` label backgrounds visible in screenshot 18 are containers in the overlay page component that render with visible background styling even when their text content is empty. The fix pattern:

```tsx
{/* Before: always renders a container */}
<span className="badge">{label}</span>

{/* After: only renders when content exists */}
{label && label.trim() && (
  <span className="badge">{label.trim()}</span>
)}
```

Apply this guard to:
- Queue item labels
- Category badge
- Source name badge
- Hashtag display chips
- Any label/badge container in the overlay renderer that can be empty

Also fix the text-based overlay fallback in `buildOverlayTextLinesFromScenePayload`:
- Lines that produce only a label prefix with no content (e.g. `"Queue: "` or `"Next: "` with empty payload) must be filtered out
- `payload.queueTitleLine` must not be passed as `"[]"` — it should be `""` when `queueTitles` is empty (check: `queueTitles.join(" · ")` is already correct but verify the raw JSON array path does not reach the renderer)

---

## Schedule Video-Level Timeline (M23)

The schedule page currently shows a week grid with blocks. The video-level enhancement adds a timeline expansion beneath each block when clicked.

### Data Flow

The schedule preview API (`/api/schedule/preview`) already materializes pool rotation simulations. Extend it to return per-slot video titles:

```typescript
// Current output
{
  blocks: [
    {
      id: "block_morning",
      title: "Morning Rotation",
      durationMinutes: 120,
      fillStatus: "balanced",
      notes: []
    }
  ]
}

// Target output (add videoSlots)
{
  blocks: [
    {
      id: "block_morning",
      title: "Morning Rotation",
      durationMinutes: 120,
      fillStatus: "balanced",
      notes: [],
      videoSlots: [
        { assetId: "asset_abc", title: "Tarkov Day 47", estimatedDurationSeconds: 3600, predictedStartOffset: 0 },
        { assetId: "asset_def", title: "Battlefield Night", estimatedDurationSeconds: 3200, predictedStartOffset: 3600 },
        { assetId: "asset_ghi", title: "Warzone Highlights", estimatedDurationSeconds: 1800, predictedStartOffset: 6800 }
      ]
    }
  ]
}
```

`videoSlots` is computed by walking the pool rotation forward from the current cursor for as many steps as needed to fill `durationMinutes`. This is deterministic given a fixed cursor position. The `predictedStartOffset` is the predicted time offset within the block (in seconds). This is an estimate — actual playout may vary if asset durations differ.

### Timeline UX

In the schedule page, each block row has an expand toggle. When expanded:
- A horizontal timeline bar replaces the block summary
- Each video slot is rendered as a proportional segment on the timeline
- Video title is shown in the segment (truncated with ellipsis, tooltip on hover)
- Hovering a segment shows: title, estimated duration, predicted start time

This is a UI-only feature once the API returns `videoSlots`. It requires no new DB state.

### Broadcast Snapshot "Next" Resolution

The broadcast snapshot should include the predicted next video title derived from the next schedule block's pool cursor, not the schedule block title. This drives:
- The "next" card on the Broadcast page
- The `nextTitle` in the overlay text and scene payload
- The Twitch schedule segment title (already uses block title — this should stay as the block title for Twitch's schedule, but the overlay should show the video title)

The distinction: Twitch schedule segments use the BLOCK title (operator-authored, meaningful as a program title). The in-stream overlay uses the VIDEO title (what is actually playing now, which is meaningful to viewers watching right now).

---

## Per-Video Metadata Editor (M22)

### API Changes

Extend `PATCH /api/assets/[id]` to accept:

```typescript
{
  title?: string;
  titlePrefix?: string;   // new field from M21 schema
  categoryName?: string;
  hashtagsJson?: string;  // new field from M21 schema, JSON array
  platformNotes?: string; // new field from M21 schema
  includeInProgramming?: boolean;
  fallbackPriority?: number;
}
```

Use targeted writers (UPDATE SET only the changed fields) to avoid overwriting freshly-synced ingestion metadata. The existing stale-write safety from M10 applies here.

### UI: Asset Detail Panel

The assets page currently has a thumbnail endpoint but no dedicated per-video edit form. Add an edit panel (slide-in or inline expansion) with:

```
Title
  [text input, full width, max 200 chars]

Title Prefix
  [text input, full width, max 20 chars, placeholder "e.g. Replay:"]
  Note: prepended to title for stream title and overlay display

Category
  [text input with autocomplete from existing asset categories]
  Note: overrides schedule block category for Twitch metadata sync

Hashtags
  [tag input, comma-separated or individual chips]
  Note: appended to Twitch stream title, e.g. #gaming #replay

Operator Notes
  [textarea, 3 rows, not synced anywhere]

Include In Programming
  [toggle]

Global Fallback Priority
  [number input, 0–1000]
```

All fields are stacked vertically. No inline compression. Save button at the bottom of the panel.

---

## Category Model: Current Limitations and Future Direction

### Current Model

```
asset.category_name = "Just Chatting"
schedule_block.category_name = "Science & Technology"
```

When syncing to Twitch, the worker uses `asset.category_name || schedule_block.category_name`. This is a single static value for the entire video, which is correct for most content but wrong for long Twitch VODs that span multiple categories.

### Timestamp-Based Category (Later)

Twitch VODs with chapter markers have segments with timestamps and categories. If this data is ingested (from the Twitch API chapters endpoint), it can be stored as:

```sql
ALTER TABLE assets ADD COLUMN IF NOT EXISTS category_timestamps_json TEXT NOT NULL DEFAULT '[]';
-- Format: [{"offsetSeconds": 0, "categoryName": "Just Chatting"}, {"offsetSeconds": 1800, "categoryName": "Science & Technology"}]
```

During playback, the worker tracks the current asset playback offset (from playout runtime) and updates the Twitch category when a timestamp boundary is crossed. This is a later milestone (not M21 or M22).

For now: per-video `category_name` override in M22 is sufficient to fix the most common category mismatch problem.
