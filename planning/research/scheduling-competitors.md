# R1 — Scheduling and competitors

Status: research; the owner answered Q1-Q7 on 2026-10-02 (see "Owner decisions" at the end). Nothing here is implemented, nothing in product code, `PLANS.md` or
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
the DST fix (milestone C, Q6). Changing the channel zone re-reads every date in the new zone
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
| B Public Programme | viewers see what plays now and next at the level of single videos, and the coming days | `/channel` (1.6): *on air* with title, source, start-end, time left and a progress bar; *after that* as runs of consecutive items of one source, each run collapsed to its first item plus "N more", across midnight with day labels; built from `buildSchedulePreviewVideoSlots` (`packages/core/src/index.ts:2797`) for the next 24 h; dated items marked; `/channel.ics` with one entry per block; both catalogues; layout spec at 375 px | M | low (read-only; predicted times are estimates and must say so) |
| C Schedule Across DST | the 02:00-03:00 hour is counted right on both changes | **Adjusted to R3's decided Q4 (2026-10-01): the schedule follows the wall clock across DST; only the counts are fixed** — cuepoint timing and Twitch segment start and end (the spring start no longer goes to Twitch an hour early, B4). The "airs once, matched on UTC" variant written first is dropped. Tests for Europe/Berlin 2027-03-28 and 2026-10-25 | S-M | low-medium |
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


### 1.6 GronkhTV (viewer reference): read from the owner's screenshots

The owner attached two screenshots in the thread on 2026-10-02 (gronkh.tv "GTV Programmplan" panel and
twitch.tv/gronkhtv/schedule). They are not copied into the repo (third-party UI). What they show, and
what Stream247 can take as **ideas** (no texts, names or layout copied):

- **gronkh.tv, side panel.** Two parts: what runs now, then what comes after.
  - *Now*: cover image, episode number and title, the game, "running since 11:54 until 12:38", the time
    left ("19:16") and a progress bar.
  - *After*: one card per **run of consecutive episodes of the same game**, showing the first episode
    (cover, number and title, game, "12:38 to 13:18") and a collapsed "N more episodes" toggle. The
    runs go on past midnight into the next morning (01:58, 05:04, 09:02); the screenshot shows no day
    headers.
  - Granularity is the single video, with predicted start and end times. The schedule's blocks are not
    shown at all.
- **twitch.tv/gronkhtv/schedule.** A week view with **one coarse segment per day** (00:00-23:00 GMT+2) and
  a generic title ("all day Let's Plays") that points viewers to a chat command for the detailed
  programme; one day carries a different title (old streams). The live day shows the current video.
- **Consequences for Stream247:**
  - Row B moves from "7-day list of blocks" to **item-level now/next**: the data exists (predicted video
    slots with start offsets, `SchedulePreviewVideoSlot`, `packages/core/src/index.ts:899-905`), the
    public page does not use it (`apps/web/lib/public-channel-view.ts:64-88` reads blocks and the queue).
    Predicted times are estimates (`estimatedDuration`), so the page should say "approx." for anything
    after the current item.
  - Grouping consecutive items of one source matches M73's source alternation poorly: an alternating
    pool would produce runs of length 1. Group by source *and* show single items when runs are short.
  - Covers: assets have a thumbnail route, but only for the admin (`apps/web/app/api/assets/[id]/thumbnail/route.ts`).
    The route requires a signed-in role (`requireApiRoles([...])`,
    `apps/web/app/api/assets/[id]/thumbnail/route.ts:10`), so a public cover needs its own cache-friendly
    route that serves only assets on the public programme.
  - Twitch: coarse segments with a pointer to the channel's own programme are a valid pattern. Stream247's
    per-block sync already gives more detail; no change needed. The chat-command pointer supports the
    `!next` / `!schedule` idea from the 2026-10-01 list (`HANDOFF.md:109-111` on `main`).

---

## Part 2 — Competitors

Builds on the comparison of 2026-10-01 (M75 source breaker, M76 as-run log, M77 resume, and the
"not planned" list in `HANDOFF.md` on `main`, lines 109-111). Those are not repeated; where a service
confirms one of them it is one line at the end.

Method: every page was read with WebFetch (it returns a model-written digest of the page, so short
phrases may be lightly paraphrased). I re-read two load-bearing pages myself (LiveReacting advanced
scheduling, Castr TV Playout scheduling); both matched. Markers: **(docs)** help-centre text describing
behaviour; **(changelog)** vendor release notes; **(marketing)** home, feature or pricing pages — treat
those as claims. One page failed (`https://gyre.pro/faq`, the fetch permission timed out); nothing below
relies on it. No statement here is from memory. Every idea was checked against the Stream247 code, and
ideas Stream247 already has are dropped or marked.

### 2.1 What the services do, by area (only what goes beyond Stream247 today)

**Planning**

- Dated entries and end conditions are standard. LiveReacting: one-time, multi-date (several distinct
  dates) and repeat with "stop after a certain number of runs or days", up to four weeks ahead
  (https://help.livereacting.com/en/live-reacting-studio-1/advanced-scheduling, docs). Upstream: one-time,
  recurring daily/weekly/monthly, back-to-back cycles
  (https://help.upstream.so/en/article/how-to-schedule-a-youtube-live-stream-579qai/, docs). OneStream:
  once, several custom times, daily/weekly, up to 59 days ahead
  (https://helpdesk.onestream.live/en-us/article/what-are-the-available-advanced-scheduling-options-in-mobile-app-a75wh2/, docs).
  Castr TV Playout: loop mode with an end date
  (https://docs.castr.com/en/articles/8001118-introducing-tv-playout-what-is-it-how-to-create-one, docs).
  → Confirms Part 1, row A.
- The schedule preview flags overlaps and wrong dates **before** saving (LiveReacting, same URL, docs).
  Stream247 refuses on save with one generic message (`route.ts:276`). → the takeover notice in 1.3 step 8.
- Time zone per schedule (Livepush, https://livepush.io/features/livestream-scheduling.html, marketing;
  OneStream, https://helpdesk.onestream.live/en-us/article/how-to-schedule-a-stream-for-later-1cnd76l/, docs).
  Stream247 has one zone per channel, which is enough for one channel; the gap is DST (B4, row C).
- Calendar with month/week/day views (Gyre,
  https://gyre.pro/blog/update-from-gyre--stream-scheduler-for-planning-looped-streams, changelog).
  Stream247 has a week lens and a day view, no month. A month view only pays once dated items exist.
- Exact start times via "breaks" that fill up to the start, across days
  (https://docs.castr.com/en/articles/10766134-how-to-schedule-contents-for-24-7-with-tv-playout, docs).
  Stream247 already ends an item at the block boundary (as-run end reason `duration-bound`,
  `apps/worker/src/as-run.ts:125`), so no gap there.
- The program guide as JSON through an API (Castr, TV Playout URL above, docs). → `/channel.ics` and a
  JSON feed in row B.
- Edits as a **draft**, published on demand and applied at the end of the current clip
  (Streamloop, https://streamloop.app/docs/build-and-schedule-your-playlist, docs; Upstream "unpublished
  changes", https://upstream.so/blog/fall-update-kick-connect-destinations-demo-streams/, changelog).
  Stream247 writes schedule edits straight to the live table. Fits; see idea I3.
- Declarative rotation rules ("3 videos, then a bumper", "a sting at minute 0 of every hour in zone X"),
  dry-run before activation, fall back to plain order after 3 failures
  (https://streamloop.app/docs/custom-playlist-order, docs; the rules are generated by an AI service there).
  Stream247 has timed cuepoint inserts per block and a pool insert asset, not count-based rules.
- A warning when the next 7 days exceed capacity (Upstream, fall-update URL above, changelog). Stream247's
  week lens counts underfilled and empty blocks (`packages/core/src/index.ts:3236`) but nothing warns
  outside that page.

**Reliability** (most of it Stream247 already has: backup output, destination cooldown
`packages/core/src/index.ts:3655`, probe quarantine, source breaker, Discord and email alerts
`apps/worker/src/alerts.ts:29`, `/api/health`, `/api/ready`)

- Upstream retries a failing multistream destination 5 times, then pauses only that one (fall-update URL,
  changelog); Livepush lets the operator switch one destination off mid-stream
  (https://livepush.io/features/real-time-stream-monitoring.html, marketing). Stream247 has a per-destination
  failure cooldown; whether a permanently failing secondary is ever parked is a question for R3.
- Streamloop keeps retrying a destination that refuses during platform maintenance
  (https://streamloop.app/docs/reliability-guarantees, docs); LiveReacting retries Steam for up to 3 h
  (https://livereacting.com/changelog, changelog).
- Castr fires webhooks on stream start and end
  (https://docs.castr.com/en/articles/7831580-how-to-use-webhooks-for-your-streams, docs) and sends an SMS when
  a stream is down (https://docs.castr.com/en/articles/6816008-setting-up-sms-alerts-for-when-stream-is-down,
  docs). Stream247 posts alerts to Discord and email only; a generic webhook would reach ntfy, Gotify,
  Home Assistant and SMS gateways.
- Livepush keeps health charts per past session (monitoring URL above, marketing).
- Gyre compares every file's resolution, FPS and audio before launch
  (https://gyre.pro/blog/gyre-update-full-automation-of-live-streams-via-the-youtube-api, changelog).
  Stream247 re-encodes to one output profile, so a mismatch costs CPU, not a broken stream (SUSPICION,
  not measured); low value.

**Setup**

- Upstream's wizard ends on a summary with exact counts and can be left and resumed
  (https://upstream.so/blog/live-studio-better-overlays-and-smarter-queue-control/, changelog); its Twitch
  24/7 guide tells users to turn on Twitch's Disconnect Protection
  (https://help.upstream.so/en/article/how-to-start-a-247-twitch-live-stream-1nn24y9/, docs).
- Upstream ships 30 paused demo streams with stock media (fall-update URL, changelog).
- Streamloop: six steps to first air (https://streamloop.app/docs/quickstart, docs); StreamHouse: three steps
  with a pre-launch checklist (https://streamhouse.co/getting-started, docs).
- These overlap with R2 (install and first run); listed here only as competitor evidence.

**Viewer retention**

- Countdown layers, and status banners "Starting soon" / "Ending soon" driven by state (Upstream, overlay
  changelog URL above; LiveReacting countdown
  https://help.livereacting.com/en/countdown/how-to-launch-a-countdown-clock-before-a-live-stream, docs).
  Stream247's overlay has a countdown only for chat polls (`packages/core/src/overlay-layout.ts:782`).
  With dated specials a "Special starts in 12 min" banner becomes meaningful.
- Pin a chat note that this is a rerun and when the real live shows are
  (https://streamhouse.co/blog/stream-to-twitch-24-7-pre-recorded, guidance/marketing). Differs from the
  listed `!schedule` command: it is pushed, not asked for.
- Platform announcement posts ahead of a scheduled run (LiveReacting,
  https://help.livereacting.com/en/live-reacting-studio-1/how-to-schedule-a-live-stream, docs). For Twitch
  the existing schedule sync is the equivalent.
- Chat-keyword polls (LiveReacting, https://help.livereacting.com/en/polls/how-does-live-poll-work-1, docs):
  Stream247 already has a "what plays next" poll (`packages/core/src/chat-interaction.ts:17-21`). Dropped.

Confirms existing ideas: resume an interrupted item (Upstream summer update
https://upstream.so/blog/summer-update-playout-recording-live-studio-v2/, StreamHouse
https://streamhouse.co/live-streaming-faq, LiveReacting "keep stream progress", advanced-scheduling URL);
the 48-hour Twitch restart (Upstream Twitch 24/7 help URL above).

### 2.2 Ideas that fit a self-hosted product

| # | Idea | Seen at | Fit | Why | Effort | Risk |
| --- | --- | --- | --- | --- | --- | --- |
| I1 | Dated / one-off items with end dates | LiveReacting, Upstream, OneStream, Castr (URLs in 2.1) | yes | local data and resolver only | M | medium — = row A |
| I2 | Public programme feed: `/channel` week list, `.ics`, JSON | Castr EPG JSON (TV Playout URL) | yes | served by the web container; feeds websites, bots, calendars | S-M | low — = row B |
| I3 | Schedule drafts: edit freely, *Publish* applies at the next block or item boundary | Streamloop, Upstream (URLs in 2.1) | yes | protects the air from half-done edits; no external service | M | medium (two copies of the schedule; every reader must read the published one) |
| I4 | 7-day coverage check: empty or underfilled time in the next 7 days as a readiness warning and on the dashboard | Upstream capacity warning (fall-update URL) | yes | computed from data the week lens already has | S | low |
| I5 | Generic outbound webhook for incidents and on-air start/stop, next to Discord and email | Castr webhooks + SMS (URLs in 2.1) | yes | one URL reaches any notifier a self-hoster runs; Discord-only code exists to copy | S | low (must never carry a stream key) |
| I6 | "Starting soon" banner / countdown to the next dated special, in the scene | Upstream, LiveReacting (URLs in 2.1) | yes | overlay and schedule are local; only useful once I1 exists | S | low |
| I7 | Periodic chat note "this is a rerun channel; live shows are on …" by the bot | StreamHouse guidance | yes | bot exists; Twitch audiences expect the transparency | S | low (rate limit; channel language) |
| I8 | Top-of-hour sting (an insert at minute 0 in the channel zone) | Streamloop custom order | partly | the count-based half already exists: a pool's `insertAssetId` + `insertEveryItems` (`apps/worker/src/index.ts:5407-5408`, correction 2026-10-02); the time-based half would be new; the AI-generated picker does not belong in a self-hosted box | S-M | medium (seam chain) |
| I9 | Wizard: summary step and a Disconnect Protection hint | Upstream (URLs in 2.1) | yes | text and UI only | S | low — hand to R2 |
| I10 | Park a destination that keeps failing for hours, keep the others | Upstream, Livepush | partly | cooldown exists; whether parking is needed is R3's call | S | low |
| I11 | Month view of the schedule | Gyre | partly | only worth it once dated items exist; the week lens covers a 24/7 grid | M | low |

Not taken: per-schedule time zones (one channel, one zone is right), SMS and demo media (paid
provider, media licensing), file-format pre-check (Stream247 re-encodes), keyword polls (exist).

---

## Five most important findings

1. **The owner's sentence cannot be saved today**, for two reasons, not one: blocks have no dates
   (1.1), and on a 24/7 grid any 20:00 block is refused as an overlap (probe
   `PROBE conflicts ["grid-day","evening-special"]`). The design needs both a date window and a rule that
   a dated item wins over the weekly grid (1.3, row A, Q1).
2. **"Single day" means every week.** The label invites the wrong belief that it airs once
   (`packages/core/src/index.ts:1026-1029`, probe on 2027-10-06). Rename with row A.
3. **B1: phantom Twitch segment a day late for every block that crosses midnight** (BUG, command output
   in 1.2). The design baseline's own grid has such blocks.
4. **B2: the overlap check gets midnight wrong in both directions** (BUG): refuses a block 23 h away,
   accepts a real collision.
5. **Competitors confirm dated items, a public programme feed and schedule drafts** as the gaps that
   matter for planning (2.2 I1-I3); most reliability features they advertise Stream247 already has.

## Questions for the owner (each with a recommendation; Q1-Q7)

1. **Precedence.** May a dated item take over the weekly block it overlaps, with the weekly block
   continuing around it? Or stay refused as today? *Recommendation:* take over; otherwise "every evening
   at 20:00" can never be saved on a channel that runs 24/7.
2. **After expiry.** Keep ended dated items listed (greyed, "ended 10 Oct", re-usable) until deleted by
   hand, or delete them automatically after N days? *Recommendation:* keep; no cleanup job to get wrong.
3. **Playlist position.** When the dated playlist comes back the next evening, should it continue where
   it stopped the evening before (today's pool behaviour, M73), or start from its first item every
   evening? *Recommendation:* continue — it is today's behaviour and a 10-evening run then shows 10
   evenings of different content. (Routine assumption made: "playlist" = a pool.)
4. **GronkhTV.** gronkh.tv and twitch.tv are blocked from the cloud (1.5), and there are no screenshots
   under `/mnt/project-files/`. Can you put two screenshots there (the gronkh.tv Sendeplan and
   twitch.tv/gronkhtv/schedule), or say in a sentence what you like about it (week grid, list per day,
   highlighted specials, thumbnails)? *Recommendation:* screenshots; row B's layout waits for them,
   row A does not.
5. **Twitch status of jimpanse247.** Non-recurring schedule segments need an affiliate or partner
   account (1.3, Twitch). Is jimpanse247 one? Check: `Admin → Settings → Twitch accounts` shows a schedule
   sync error "requires the broadcaster to be an affiliate or partner" if not; or look at
   `https://www.twitch.tv/jimpanse247/schedule`. *Recommendation:* if it is not, keep the sync as is and
   do not build a recurring-segment variant until the channel needs it.
6. **DST.** May the DST fix (row C) come after dated items, since your 20:00 programme never meets the
   02:00-03:00 hour? *Recommendation:* yes, separate milestone.
7. **Order of the four scheduling rows and the competitor ideas.** *Recommendation:* D (midnight fixes,
   small, two real bugs) → A (dated items, with B1) → B (public programme, after Q4) → I4 coverage check
   → C (DST); I3 drafts and I5 webhook as candidates for the stage after.

## What I could not verify

- GronkhTV's schedule (blocked; 1.5).
- Twitch's API reference schedule sections (WebFetch returned a truncated page): segment limits,
  overlap rules and the affiliate rule are from the repo code and a forum quote (1.3).
- B1 against the live jimpanse247 schedule on Twitch (blocked; Q5 has the check).
- Competitor pages are read through WebFetch digests; vendor changelogs and marketing pages describe
  claims, not tested behaviour. `https://gyre.pro/faq` could not be fetched.
- Whether a permanently failing secondary destination is ever parked (I10): left to R3.
- `pnpm validate` on this branch (the branch only adds this file): lint and typecheck pass, integration
  `Tests 63 passed (63)`, build exit 0; unit tests `3 failed | 2612 passed`. The three failures do not
  come from this branch: `process-utils` is the known cloud-only process-group test, and
  `viewer-messages` / `ops-state` expect "Coordinated Universal Time" where this container's Node
  (22.22.0, ICU 77.1) prints "GMT". CI is green on the same base commit (`gh api
  repos/DrJakeberg/stream247/commits/ab42e11/check-runs` → `validate success`).

## Outside this brief (fixed on this branch on 2026-10-02 at the owner's request)

Fixed in `d789981` (time-zone name), `7891a85` (week lens), `a41d327` + `51e69ee` (public page), baselines
in `81f0eb6`. The midnight-counting finding below is the week lens fix; projected minutes still count a
midnight block on both days (admin only, not changed).


- The two time-zone-name unit tests depend on the ICU version of the Node build
  (`tests/unit/viewer-messages.test.ts:115`): they fail on Node 22.22.0 / ICU 77.1 here. If CI's
  `node-version: 22` moves to such a build, `validate` turns red without a code change.
- Week lens: "Repeats inside block" badges are clipped at the card edge, and a block crossing midnight
  is counted on both days ("1500m scheduled" on Sat and Sun) —
  `tests/e2e/design-baseline.spec.ts-snapshots/program-schedule-desktop-chromium-linux.png`. For R2.
- `/channel` "After that" reads the playout queue, so a 24/7 grid shows "Nothing further is scheduled
  yet" (`apps/web/lib/public-channel-view.ts:82-88`, channel baseline screenshot). Row B fixes it; R2 may
  list it too.

## Owner decisions (2026-10-02)

Benjamin answered in the thread on 2026-10-02: "Deine Empfehlungen klingen super!" — so every
recommendation of Q1-Q7 is decided as written:

1. A dated item takes over the weekly block it overlaps; the weekly block continues around it.
2. Ended dated items stay listed (greyed, re-usable) until deleted by hand.
3. A dated playlist continues each evening where it stopped (pool cursor, M73).
4. GronkhTV: answered with two screenshots; evaluated in 1.6, row B rewritten accordingly.
5. Twitch: keep the non-recurring sync; no recurring-segment variant now. jimpanse247 is an affiliate
   (owner's answer of 2026-10-01, recorded in `planning/proposal-2026-10.md:337` on
   `claude/vorschlag-2026-10-6a60z9`), so non-recurring segments work for the channel.
6. DST comes after dated items, as its own milestone; row C follows R3's decided Q4 (wall clock, counts
   fixed).
7. Order: D (midnight fixes) → A (dated items, with B1) → B (public programme) → I4 (7-day coverage
   check) → C (DST); I3 (drafts) and I5 (webhook) as candidates for the stage after.

He also asked for the three items under "Outside this brief" to be fixed; that work is on this branch as
separate commits (see the thread's report).
