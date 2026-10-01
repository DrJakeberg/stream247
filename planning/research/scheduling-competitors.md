# R1 — Scheduling and competitors

Status: research for owner review. Nothing here is implemented, nothing in product code, `PLANS.md` or
`CHANGELOG.md` was changed. Base: branch `m75-source-breaker` at `ab42e11` (the coming 2.2.0). Every
`path:line` refers to that commit.

Wording: **BUG** means shown by a test or a command output quoted here. **SUSPICION** means read in the
code or inferred, not demonstrated. Probes were throw-away vitest files run against the real
`@stream247/core` and worker modules (`npx vitest run tests/unit/zz-r1-probe*.test.ts`) and deleted
afterwards; their decisive output lines are quoted.

An earlier planning thread left partial notes on `claude/proposal-2026-10-te1vlg`
(`planning/proposal-2026-10.md`). I used them as leads only; every claim below was re-checked on
`ab42e11`, and where I disagree with them it is said.

---

## Part 1 — Scheduling

Goal (owner): "For the next 10 days, every evening at 20:00, this playlist runs."

### 1.1 Today's model (verified)

**The owner's description is correct.** A block has a weekday, a start minute, a duration and a repeat
label, and no date of any kind.

- Table: `packages/db/src/index.ts:2695-2710` (`id, title, category_name, day_of_week, start_hour,
  start_minute_of_day, duration_minutes, show_id, pool_id, source_name, repeat_mode DEFAULT 'single',
  repeat_group_id, cuepoint_asset_id, cuepoint_offsets_seconds`); ALTER lines `:3106-3113`; manifest
  `packages/db/src/schema-manifest.ts:36`. Writers: whole-state `:4797-4817`, `:8706`, `:8733-8754`,
  updates `:8768`, `:8819`. `grep -n "valid_from|validFrom|start_date|end_date"` over
  `packages/db/src/index.ts` and `packages/core/src/index.ts` finds nothing.
- Core type `ScheduleBlock`: `packages/core/src/index.ts:855-869`, no date fields.
- **"Single day" is not "once".** `SCHEDULE_REPEAT_MODE_OPTIONS` labels it "Single day" with the help
  text "Keep this block on one weekday only" (`packages/core/src/index.ts:1026-1029`); the editor's tip
  says "Single day makes one block on its own" (`apps/web/components/schedule-block-form.tsx:183`).
  Probe: `getRepeatDaysForMode("single", 3)` → `[3]`, and the same Wednesday block yields an occurrence on
  `2026-10-07`, `2026-10-14` and `2027-10-06` (`PROBE single on 2027-10-06 2027-10-06:w:1200:60`). It
  airs every Wednesday forever.
- Repeat modes are expanded on save into one row per weekday sharing a `repeat_group_id`
  (`apps/web/app/api/schedule/blocks/route.ts:248-269`); afterwards `repeat_mode` is only a label and
  recurrence comes from `day_of_week` alone.
- **One choke point.** `buildScheduleOccurrences({ date, blocks })` (`packages/core/src/index.ts:3457-3477`)
  keeps blocks whose weekday matches `date`, plus carry-overs from the day before. Every consumer goes
  through it: worker current/next (`apps/worker/src/index.ts:4644-4680`), standby (`:3498`), Twitch sync
  (`:8630`), cache retention (`apps/worker/src/vod-cache-release-policy.ts:28`), web now/next
  (`apps/web/lib/server/state.ts:414-441`), day preview (`packages/core/src/index.ts:2702`), week lens
  (`:3216`), next-across-days (`:3545`, `:3554`). A date filter added there reaches all of them.
- **Overlap is refused per weekday** (`findScheduleConflicts`, `packages/core/src/index.ts:3308-3356`),
  on create (`route.ts:274-278`), duplicate (`:142-146`) and edit (`:390-393`). Probe on a 24/7 Thursday
  grid plus a Thursday 20:00-22:00 block: `PROBE conflicts ["grid-day","evening-special"]`. **So on a
  channel filled around the clock, the owner's sentence cannot be saved today**, whatever the date
  question. If an overlap reaches the air anyway, the most recently started occurrence wins
  (`packages/core/src/index.ts:3519-3521`; probe `PROBE current at 20:30 evening-special`).
- **Time zone:** one IANA zone per channel (`resolveChannelTimeZone`, `packages/db/src/instance-config.ts:30`;
  web `apps/web/lib/server/state.ts:286-289`, worker `apps/worker/src/index.ts:4645`). Occurrences match
  on local wall-clock minutes; only the Twitch sync converts to UTC (`toUtcIsoForLocalDateTime`,
  `packages/core/src/index.ts:3607-3636`).
- **Twitch sync** (`apps/worker/src/index.ts:8613-8762`): rolling 7 local days (`:8630`), starts less
  than 5 min ahead dropped (`:8643`), one **non-recurring** segment per occurrence (`is_recurring: false`,
  `:8685`), keyed by the occurrence key, stale keys deleted (`:8738-8755`), durations under 30 or over
  1380 min skipped (`:8660`), a 403 reported as "requires affiliate or partner" (`:8712`).
- **Public `/channel`:** `apps/web/app/channel/page.tsx`, `apps/web/components/live-channel-page.tsx`:
  only *On air now*, *Up next* and *After that*. *After that* is the playout queue, not the schedule
  (`apps/web/lib/public-channel-view.ts:82-88`). The design baseline
  (`tests/e2e/design-baseline.spec.ts-snapshots/channel-desktop-chromium-linux.png`) shows a 24/7 grid
  whose page says "After that: Nothing further is scheduled yet."

### 1.2 Bugs found on the way (scheduling only)

**B1 — BUG: the Twitch sync posts a phantom segment one day late for every block that crosses
midnight.** The sync's filter and mapping (`apps/worker/src/index.ts:8630-8644`, `:8667-8671`) pass the
carry-over occurrence through and send it with the carry date and the block's own start minute. Probe
(Europe/Berlin, Monday 23:00 for 120 min, the 7-day window from 2026-10-05):

```
PROBE twitch segment 2026-10-05:b1:1380:120 carry=false start_time 2026-10-05T21:00:00.000Z
PROBE twitch segment 2026-10-06:b1:1380:120:carry carry=true start_time 2026-10-06T21:00:00.000Z
```

The second line is a Tuesday 23:00 segment that does not exist on air. In a daily repeat set it lands
on top of Tuesday's own 23:00 segment (two segments at the same time). The design baseline itself has
such blocks (Sat 23:00-01:00).
- Proposal: drop `carriesOverFromPreviousDay` in the sync; extract the desired-segment list into a pure
  `planTwitchScheduleSegments` so it is testable.
- Effort: S (hours). Risk: low; existing phantom segments are deleted by the existing stale-key pass.
- Not confirmed against the live jimpanse247 schedule (twitch.tv is blocked here); Benjamin can check:
  open `https://www.twitch.tv/jimpanse247/schedule` and look for an entry a day after any block that
  runs past midnight.

**B2 — BUG: the overlap check treats the after-midnight part of a block as the same weekday.**
`findScheduleConflicts` splits a wrapping block into `[start, 1440]` and `[0, end]` and compares both
with blocks of the **same** `dayOfWeek` only (`packages/core/src/index.ts:3317-3333`, weekday test `:3331`). Probe:

```
PROBE mon 23-01 vs mon 00:00-00:30 (no real overlap): ["mon-23-01","mon-00-0030"]
PROBE mon 23-01 vs tue 00:00-00:30 (real overlap): []
```

A Monday 00:00 block is refused although it is 23 hours away, and the Tuesday 00:00 block that really
collides is accepted; on air the later start then wins at 00:00 (`:3519-3521`). With daily repeat sets both
errors cancel out, which is why it went unnoticed. `tests/unit/schedule-template-conflicts.test.ts:62-68`
pins the current model ("wraps into the next day, where an early block already sits", both blocks on
weekday 1); a fix must move that test to weekday 1 + weekday 2 and add the false-positive case — the
test's intent stays, its fixture changes (owner should know a test fixture moves).
- Proposal: compare the `[0, end]` part with blocks of `(dayOfWeek + 1) % 7`. Effort: S. Risk: low; it
  can reveal existing hidden overlaps, which the editor then flags.

**B3 — BUG (low impact): the cache keep-rule does not see a block that is on air after midnight.**
`collectUpcomingPoolIds` (`apps/worker/src/vod-cache-release-policy.ts:16-45`) computes a carry-over's
start as `dayOffset * 1440 + startMinuteOfDay`, i.e. 23 hours too late. Probe (Monday 23:00-02:00, pool
`night-pool`, Tuesday 00:30):

```
PROBE on-air carry-over, horizon 60 -> []
PROBE on-air carry-over, horizon 360 -> []
PROBE on-air carry-over, horizon 1440 -> ["night-pool"]
```

With the default retention of 72 h (`.env.production.example:70`, `packages/core/src/managed-runtime.ts:541`)
the horizon covers it anyway, so this bites only installs with a retention under about 23 h: a replay
of the night pool that ends after midnight is deleted and re-downloaded. Proposal: use
`effectiveStartMinuteOfDay`. Effort: S. Risk: low.

**B4 — measured: daylight-saving changes.** (Same result as the earlier notes, re-measured.)

```
PROBE toUtc 2027-03-28 120 -> 2027-03-28T00:00:00.000Z     (02:00 does not exist; = 01:00 CET)
PROBE toUtc 2027-03-28 150 -> 2027-03-28T00:30:00.000Z
PROBE toUtc 2027-03-28 180 -> 2027-03-28T01:00:00.000Z     (03:00 CEST, correct)
PROBE moment 2027-03-28T00:59:00Z -> 2027-03-28 01:59
PROBE moment 2027-03-28T01:00:00Z -> 2027-03-28 03:00
PROBE moment 2026-10-25T00:30:00Z -> 2026-10-25 02:30
PROBE moment 2026-10-25T01:30:00Z -> 2026-10-25 02:30
```

- Spring: a start in 02:00-02:59 goes to Twitch one hour early, and on air the worker never sees
  02:xx, so a 02:00-03:00 block never airs.
- Autumn: wall clock 02:00-02:59 happens twice, so a block in that hour is "current" for two real hours;
  Twitch gets one segment at the second instance (`2026-10-25 150 -> 01:30Z`).
- 20:00 is not affected. Proposal and effort in 1.4 (milestone C).

### 1.3 Design: dated and one-off blocks (the smallest additive change)

**Data model.** Two columns on the existing row, no new table:

- `schedule_blocks.valid_from TEXT NOT NULL DEFAULT ''` and `valid_until TEXT NOT NULL DEFAULT ''`:
  local calendar dates `YYYY-MM-DD` in the channel zone, inclusive; empty = unbounded. Every existing
  row keeps behaving exactly as today.
- Shipped like M73/M75: baseline CREATE, `ALTER ... ADD COLUMN IF NOT EXISTS`, a named migration on
  `schemaMigrations` (`packages/db/src/index.ts:930`), the manifest, the mapper (`:5723`), every writer
  listed in 1.1, blueprint export/import (`apps/web/lib/server/channel-blueprints.ts:413-440`, `:633-643`).
- `ScheduleBlock` gains `validFrom?`, `validUntil?`; `ScheduleOccurrence` gains `dated: boolean`.
- The date bounds the **start** of an occurrence: a 23:00-01:00 block dated until 10 Oct still carries
  into 11 Oct.
- *Once* = `validFrom = validUntil = D`, weekday derived from D on the server.
- *For N days daily* = today's expansion (7 rows, one repeat group), all with the same dates. Days 8-10
  recur on their weekday rows. Routine assumption: columns rather than a `schedule_specials` table,
  because conflicts, previews, blueprints and the editor already work on one row type.

**Filter.** `buildScheduleOccurrences` keeps a same-day block only if `date ∈ [validFrom, validUntil]`,
a carry-over only if `date − 1 ∈ [validFrom, validUntil]`. Every consumer in 1.1 follows, including the
cache keep-rule (it stops keeping material for runs that have ended).

**Precedence over the weekly grid** (owner question Q1). Without it the sentence cannot be saved on a
24/7 channel (1.1). Proposal: a dated block is a layer above the undated grid.

- `findScheduleConflicts` compares only blocks on the same layer (both undated, or both dated with
  intersecting date ranges). Dated over undated is allowed, dated over dated stays refused.
- On air, `findCurrentScheduleOccurrence` prefers a dated occurrence over an undated one, then the
  latest start as today. That alone already gives the right air behaviour, because the latest-start
  rule (probe above) almost does it today; the explicit rank covers a weekly block that *starts inside*
  the dated window (dated 20-22, weekly 21-24: without the rank the weekly block would take over at 21:00).
- For everything that lists time ranges (week lens, day preview, *Up next*, Twitch, `/channel`), a pure
  `applyScheduleLayers(occurrences)` returns the undated occurrences **clipped** around the dated ones
  (weekly 18-22 + dated 20-21 → 18-20, dated 20-21, 21-22).
- **Where I differ from the earlier notes:** they proposed cutting the weekly occurrence into fragments
  with new start minutes and keys. That breaks timed inserts: cuepoints are measured from the
  occurrence's `startMinuteOfDay` and remembered by its `key` (`apps/worker/src/cuepoints.ts:88-97`,
  `getScheduleElapsedSeconds` `packages/core/src/index.ts:2923`), so a fragment would fire the block's
  cuepoints again, shifted. Proposal instead: keep `key` and `startMinuteOfDay` of the block and add
  `airWindows: Array<{ start, end }>` to the occurrence; listings and the Twitch plan read the windows,
  cuepoints keep reading the block, and a cuepoint that falls inside the dated window is skipped.
- The weekly pool resumes at its own cursor after the dated item (M73 rotation, unchanged).

**After expiry.** An expired block yields no occurrences, so it disappears from air, previews, Twitch and
`/channel` by itself, and the weekly grid underneath is visible again with nothing to do. The row stays
and is shown greyed as "ended 10 Oct" behind an *Ended* filter, to re-date or duplicate (Q2). Refused on
save: `valid_until < valid_from`, and a window lying entirely in the past (`validateScheduleBlock`,
`packages/core/src/index.ts:3260`).

**Time zone and DST.** Dates and times are always in the channel zone; the form names the zone next to
the date fields, as `/channel` already does. 20:00 never meets a DST gap, so dated blocks do not need
the DST fix (milestone C, Q3). Changing the channel zone re-reads every date in the new zone
(documented, not migrated).

**Twitch.** A dated occurrence becomes exactly what is sent today: one non-recurring segment per
occurrence within the rolling 7 days. For the 10-day run Twitch shows days 1-7 at once, days 8-10 appear
as the window rolls, nothing after `valid_until`. Weekly windows are sent clipped; a window under 30 min
is skipped by the existing rule (`:8660`). Fix B1 in the same milestone.
- Not read first-hand: Twitch's API reference was not reachable as a whole (WebFetch returned a truncated
  page without the schedule sections). That only partners and affiliates may create non-recurring
  segments is quoted from the reference in
  https://discuss.dev.twitch.com/t/why-cant-non-affliates-create-non-re-occuring-stream-segments/64448
  (via web search) and matches the repo's own 403 text (`:8712`) and `docs/deployment.md:85`.
  Whether jimpanse247 is an affiliate is open (Q5).

**`/channel`.** Dated items show up in *On air now* and *Up next* with no extra work. A week programme
for viewers is its own milestone (B below). Its layout should follow the GronkhTV reference the owner
named, which I could not open (1.5, Q4). What can be said without it: a day-grouped list of the next
7 days built from the same occurrences as the week lens, times in the channel zone and language (M80
catalogues), a marker for special (dated) items with their last date, and an `.ics` calendar feed
viewers can subscribe to (Twitch offers the same idea for its own schedule: "Get Channel iCalendar" is
listed in the table of contents of https://dev.twitch.tv/docs/api/reference/).

**Editor walk-through** for "next 10 days, every evening at 20:00, this playlist" (*new* = added):

1. Program → Schedule → *Add block* (today's form, `apps/web/components/schedule-block-form.tsx`).
2. Title "Abendspecial", category; show profile optional.
3. Pool: the playlist's pool. (Assumption: "playlist" = a pool; Stream247 has no other playlist object a
   block can point at.)
4. *new* **Runs**: `Every week` (default, today) / `Between dates` / `Once`. Placed **before** the repeat
   select, because it decides which of the next fields make sense.
5. `Between dates`: *From* defaults to today in the channel zone; *Until* typed, or filled by the helper
   "for [10] days" (from + 9). `Once`: one *Date* field replaces Repeat and Weekday.
6. Repeat behavior: **Daily** (with `Between dates` the label reads "on these days within the dates").
7. Start 20:00, duration e.g. 120.
8. *new* inline notice, computed by `applyScheduleLayers`: "Takes over 20:00-22:00 from *Abendprogramm*
   on 10 evenings (1-10 Oct); *Abendprogramm* continues at 22:00."
9. Save. Toast: "Created on 10 evenings, 1 Oct to 10 Oct." The week lens shows the dated item on top,
   the weekly block clipped around it, and a small "until 10 Oct" tag.
10. Also rename "Single day" to "One weekday, every week" (1.1): the current word invites exactly the
    misunderstanding this feature removes.

### 1.4 Proposed milestones (scheduling)

| Row | Goal | Acceptance (short) | Effort | Risk |
| --- | --- | --- | --- | --- |
| A Dated And One-Off Schedule Blocks | "next 10 days at 20:00" and "once on 10 Oct" can be saved on a 24/7 grid, and air, previews, `/channel` and Twitch agree | `valid_from`/`valid_until` in baseline, ALTER, migration, manifest, mapper, writers, blueprints; filter in `buildScheduleOccurrences`; dated layer rank in `findCurrentScheduleOccurrence`; `applyScheduleLayers` with `airWindows`; conflicts per layer; expired rows stay listed as ended; form *Runs* + takeover notice; "Single day" renamed; B1 fixed via pure `planTwitchScheduleSegments`. Tests: 10-day run (day 10 present, day 11 absent), once-block, carry-over past `valid_until`, 18-22 + 20-21 gives three windows with one key, cuepoint not re-fired, no `:carry` Twitch keys, schema manifest, db round-trip, `pnpm validate` | M (2-3 days) | medium |
| B Public Week Programme | viewers see the coming week, not only now/next | `/channel` lists 7 days per day in channel zone and language, dated items marked; `/channel.ics`; both catalogues; layout spec at 375 px. Layout waits for Q4 | S-M | low |
| C Schedule Across DST | a block in 02:00-03:00 airs once, at the right time, on both changes | spring gap resolves forward on air and on Twitch; autumn repeat airs once (first instance), matched on UTC instants. Tests for Europe/Berlin 2027-03-28 and 2026-10-25 | M | medium (touches the matcher every consumer uses) |
| D Schedule Midnight Fixes | B2 and B3 | conflicts across midnight compare with the next weekday; cache keep-rule uses the effective start; the template test fixture moves to two weekdays | S | low |

B1 rides with A because A rewrites the same sync function; it could also go into D if A waits.

### 1.5 GronkhTV (viewer reference): not reachable

- `/mnt/project-files/` is empty (`ls -la /mnt/project-files/` → only `.` and `..`): no screenshots.
- Playwright 1.56.1 (`node_modules/.pnpm/playwright@1.56.1`), Chromium from `/opt/pw-browsers`:
  `FAIL https://gronkh.tv page.goto: net::ERR_TUNNEL_CONNECTION_FAILED` and the same for
  `https://www.twitch.tv/gronkhtv/schedule`.
- `curl -sS https://gronkh.tv` → `curl: (56) CONNECT tunnel failed, response 403`; the agent proxy
  status lists `connect_rejected ... gronkh.tv:443` and `www.twitch.tv:443`.
- WebFetch of `https://gronkh.tv` returns only "Please enable JavaScript to continue using this
  application."
- Per the brief I do not describe GronkhTV from memory; see Q4.

---

## Part 2 — Competitors

_(in progress)_

---

## Questions for the owner

_(collected at the end)_

## Not verified

_(collected at the end)_
