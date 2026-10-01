# Proposal 2026-10 — the next stage after 2.2.0

Status: proposal for owner review. Nothing here is implemented. Base: branch `m75-source-breaker` at `ab42e11` (the coming 2.2.0). Brief: `planning/research-brief.md`. All code references are `path:line` on that commit. "BUG" means reproduced by a test or a command output quoted here; everything else is "SUSPICION".

## Summary

_(written last)_

## 1. Scheduling

Method: read the code; bundled `packages/core` with the repo's esbuild and called `buildScheduleOccurrences` and `toUtcIsoForLocalDateTime` directly with fixed dates (decisive output lines are quoted below). No repo change.

### Findings: today's model (verified)

**The claim is true.** A block has a weekday, a start minute, a duration and a repeat label. It has no date, no start date and no end date anywhere in the stack.
- DB baseline: `packages/db/src/index.ts:2695-2711` defines `schedule_blocks`. Its columns are `id, title, category_name, day_of_week, start_hour, start_minute_of_day, duration_minutes, show_id, pool_id, source_name, repeat_mode ('single'), repeat_group_id, cuepoint_*`. ALTER block: `:3106-3113`. Manifest: `packages/db/src/schema-manifest.ts:36`. Record type: `packages/db/src/index.ts:414-428`. Mapper: `:5723-5737`. Whole-state writer (`DELETE FROM schedule_blocks` + INSERT): `:4797-4817`. Block writers: `:8706-8722` and `:8733-8754`.
- Core type `ScheduleBlock`: `packages/core/src/index.ts:855-869`, again with no date fields.
- **What "single" means:** it does not mean one-off. It means "one weekday, every week". See `packages/core/src/index.ts:1026-1031` ("Keep this block on one weekday only"), `getRepeatDaysForMode` `:2435-2451` and `describeScheduleRepeatMode` `:2453-2466`. Repeat modes are expanded when a block is saved, into one row per weekday that share a `repeat_group_id`. Single on several days becomes custom: `apps/web/app/api/schedule/blocks/route.ts:248-269`. After saving, `repeat_mode` is only a label. Recurrence comes from `day_of_week` alone.
- **One choke point.** `buildScheduleOccurrences({date, blocks})` (`packages/core/src/index.ts:3457-3480`) keeps the blocks whose `dayOfWeek` matches `date`'s weekday, plus blocks carried over from the previous weekday. Every consumer goes through this function:
  - worker current/next: `apps/worker/src/index.ts:4644-4680`
  - standby slate: `:3494-3510`
  - Twitch sync: `:8630-8644`
  - cache retention: `apps/worker/src/vod-cache-release-policy.ts:28`
  - web now/next: `apps/web/lib/server/state.ts:414-441`
  - day preview: `packages/core/src/index.ts:2694-2702`
  - week lens: `:3201-3219`

  A date filter added here therefore reaches all of them.
- **Overlap:** blocks that overlap are refused on the same weekday (`findScheduleConflicts`, `packages/core/src/index.ts:3308-3356`, weekday test at `:3331`). The check runs on create (`apps/web/app/api/schedule/blocks/route.ts:273-277`) and on edit (`:390-392`). If an overlap exists anyway, the occurrence that started latest wins (`packages/core/src/index.ts:3505-3522`).
- **Time zone:** one IANA zone per channel. `resolveChannelTimeZone` (`packages/db/src/instance-config.ts:30-35`) takes env `CHANNEL_TIMEZONE`, then the wizard value, then `UTC`. Web reads it in `apps/web/lib/server/state.ts:286` and the worker in `apps/worker/src/index.ts:4645`. Occurrences are matched on local wall-clock minutes (`getCurrentScheduleMoment` `packages/core/src/index.ts:3244`; `findCurrentScheduleOccurrence` `:3508`). Only the Twitch sync converts to UTC (`toUtcIsoForLocalDateTime` `:3607-3636`).
- **DST today** (measured for Europe/Berlin; output `date minuteOfDay -> UTC`: `2027-03-28 120 2027-03-28T00:00:00.000Z`, `2027-03-28 150 2027-03-28T00:30:00.000Z`, `2027-03-28 180 2027-03-28T01:00:00.000Z`; and for autumn `2026-10-25T00:30:00Z {"date":"2026-10-25","time":"02:30"}` and `2026-10-25T01:30:00Z {"date":"2026-10-25","time":"02:30"}`):
  - Spring, 2027-03-28: local 02:00 and 02:30 do not exist. They resolve to 00:00Z and 00:30Z, which is 01:00/01:30 CET, so the Twitch segment is **one hour early**. 03:00 resolves correctly (01:00Z).
  - Spring, on air: the worker never sees wall clock 02:xx, so a 02:00-03:00 block never airs and a 01:30-02:30 block is cut at 01:59.
  - Autumn, 2026-10-25: wall clock 02:30 occurs at 00:30Z and again at 01:30Z (both read `"02:30"`). The worker treats a 02:00-03:00 block as current for two real hours. A block ending at 02:30 is current again from the second 02:00 (latest-start rule), while Twitch gets only the later (CET) instance.
  - 20:00 is unaffected.
- **Twitch sync:** `syncTwitchSchedule`, `apps/worker/src/index.ts:8613-8762`, called at `:9108` with the channel zone (`:9116`). It already writes **one-off segments**, not recurring ones:
  - Window: a rolling 7 local days (`:8630`), skipping starts less than 5 minutes ahead (`:8643`).
  - Each occurrence is POSTed or PATCHed with `is_recurring: false` (`:8685`, `:8701`). The segment is keyed by the occurrence key `date:blockId:start:duration` (`packages/core/src/index.ts:3406`) and stored in `twitch_schedule_segments` (`packages/db/src/index.ts:2685`).
  - Durations under 30 or over 1380 min are skipped (`apps/worker/src/index.ts:8660`). Stale keys are DELETEd (`:8748`). A 403 is reported as "affiliate or partner needed" (`:8712`).
- **BUG B1 (reproduced by command output: the filter at `apps/worker/src/index.ts:8630-8644` copied verbatim and run against the real `buildScheduleOccurrences`, zone Europe/Berlin; output `2026-10-05:b1:1380:120 carry=false -> start_time 2026-10-05T21:00:00.000Z` and `2026-10-06:b1:1380:120:carry carry=true -> start_time 2026-10-06T21:00:00.000Z`; re-checked by reading: the filter passes `occurrence.startMinuteOfDay` with the carry date, `:8638-8641`).** The sync does not drop carry-over occurrences. A Monday 23:00 block of 120 min yields a second desired segment `2026-10-06:b1:1380:120:carry`, posted as **Tuesday 23:00** (2026-10-06T21:00Z). The result is a phantom Twitch segment, 24 h late, for every block that crosses midnight.
- **Public /channel:** `apps/web/app/channel/page.tsx:20-46` shows a time-zone note (`:40`). `apps/web/components/live-channel-page.tsx:36-50` shows only *on air*, *next* and *after*; there is no day or week list. Next comes from `findNextScheduleOccurrenceAcrossDays` (`packages/core/src/index.ts:3539`).
- **Editor:** `apps/web/components/schedule-block-form.tsx`. A new block defaults to `weekdays` (`:39`). There is a repeat select (`:182-202`), a weekday select when the mode is single (`:204-219`), custom chips (`:222`), and start hour/minute, duration and pool from `:258`. The weekday workspace flags conflicts per weekday (`apps/web/components/schedule-editor-workspace.tsx:154`). Blueprints carry `repeatMode` (`apps/web/lib/server/channel-blueprints.ts:413-440`, `:643`).
- **Schema convention (M73/M75/M76):**
  - A new column goes in the baseline CREATE, an `ALTER ... ADD COLUMN IF NOT EXISTS` line, and a named migration pushed onto `schemaMigrations` (`packages/db/src/index.ts:930`). Example: `poolSourceCursorsMigration` `:4069-4080`, id `20261001_001_...`.
  - A new table goes in the baseline plus a migration, with no ALTER (`:4089`, `:4118`).
  - The manifest is checked by `tests/unit/schema-manifest.test.ts`.

### Design

**Data model** (the smallest additive change: two columns on the existing row, no new table):
- Add `schedule_blocks.valid_from TEXT NOT NULL DEFAULT ''` and `valid_until TEXT NOT NULL DEFAULT ''`, both local calendar dates `YYYY-MM-DD` in the channel zone, inclusive. An empty value means unbounded, so every existing row keeps behaving exactly as today.
- Ship it in the baseline CREATE, ALTER lines, migration `2026xxxx_001_schedule_block_validity`, the manifest, the mapper, the three writers and the blueprint export/import.
- Core `ScheduleBlock` gains `validFrom?` and `validUntil?`. `ScheduleOccurrence` gains `dated: boolean`.
- A date bounds the **start date** of an occurrence. A block on 10-10 at 23:00-01:00 still carries into 10-11.
- A one-off is `validFrom = validUntil = D` with `dayOfWeek` derived from D on the server, so the operator never picks a weekday for it.
- "10 days daily" stays the existing expansion: 7 rows in one repeat group, all with the same `validFrom`/`validUntil`. Days 8-10 recur on their weekday rows.
- Assumption (routine): I use columns, not a separate `schedule_specials` table. The occurrence pipeline, conflict check, blueprints and editor then all keep working on one row type.

**Filter:** `buildScheduleOccurrences` keeps a same-day block only if `date ∈ [validFrom, validUntil]`. It keeps a carry-over only if `date - 1 ∈ [...]`. This one change reaches every consumer listed above. One effect is that the cache policy pre-fetches only material for dated runs that are still live.

**Precedence** (recommended; owner question 1). A dated block sits on a layer above the weekly grid. The 24/7 grid usually already covers 20:00, so without this the owner's sentence could never be saved.
- `findScheduleConflicts` compares two blocks only if they are on the same layer (both undated, or both dated with intersecting date ranges). Dated over undated is allowed. Dated over dated stays refused.
- A new pure step `applyScheduleLayers(occurrences)` in core runs inside `buildScheduleOccurrences`. It cuts an undated occurrence around every dated one on the same date. Example: weekly 18:00-22:00 plus dated 20:00-21:00 gives 18:00-20:00, the dated item 20:00-21:00, and 21:00-22:00.
- The fragments keep `blockId` and `poolId`, so the weekly pool resumes at its own cursor (M73). Their keys stay unique, because the key already includes start and duration.
- Downstream, every consumer sees non-overlapping occurrences: worker, preview, week lens, Twitch and /channel. The latest-start tiebreak (`:3505`) is no longer needed for this case.
- The playlist's own pool walks on night after night from its cursor; it does not restart each evening (M73 behaviour, unchanged).

**Expiry:**
- An expired block yields no occurrences, so it disappears from the air, previews, Twitch and /channel by itself.
- The row stays. The editor shows it greyed as "ended <date>" behind an "Ended" filter, so it can be duplicated or re-dated.
- There is no auto-delete in this milestone (owner question 2).
- `valid_until < valid_from` is refused in `validateScheduleBlock` (`packages/core/src/index.ts:3260`). A block whose window already lies entirely in the past is also refused on create.

**Time zone and DST:**
- Dates and times are always in the channel zone. The form names that zone next to the date fields, as the /channel note already does.
- Rule for a time that does not exist (spring): the occurrence starts at the first valid minute after the gap (02:30 → 03:00) and keeps its end. Today the Twitch sync moves it an hour early instead. Proposed fix: make `toUtcIsoForLocalDateTime` resolve forward, and make the worker match spring-gap minutes to 03:00.
- Rule for a doubled hour (autumn): an occurrence airs only once, in the first instance. The worker needs a UTC-based "already aired" check, which means matching occurrences on UTC instants instead of wall-clock minutes. That is the larger change. I recommend putting it in its own milestone (row 3) and not blocking dated items on it, since 20:00 never hits DST.
- Changing the channel zone re-interprets every date as a local date in the new zone (documented, not migrated).

**Twitch sync:**
- A dated occurrence maps to exactly what is sent today: one non-recurring segment per occurrence within the rolling 7 days.
- For the 10-day run, Twitch shows days 1-7 at once. Days 8-10 appear as the window rolls, and nothing is sent after `valid_until`. Weekly fragments are synced as fragments, and a fragment shorter than 30 min is skipped by the existing rule (`:8660`).
- I would not use Twitch recurring segments, because recurrence is computed locally and the sync is already idempotent per key.
- Fix the carry-over phantom by filtering `!occurrence.carriesOverFromPreviousDay` in the same milestone. Extract the desired-segment list into a pure `planTwitchScheduleSegments(...)` so it can be tested.
- Not verified externally: dev.twitch.tv was blocked by the egress proxy (proxy answered 403 to CONNECT). Twitch's own rules on overlapping segments, the segment limits and the 30-1380 bounds are therefore taken from the repo code (`:8660`, `:8712`), not from the API reference.

**/channel:**
- Dated items appear through the existing *next* and *after* lines with no extra work.
- Add-on (row 2): a "this week" list built from `buildMaterializedProgrammingWeek`-style occurrences for 7 days, grouped per day, in the channel language (M80 catalogue).
- A dated item gets a small "special" marker and its last date ("until Sat 10 Oct"). Viewer-facing words go into both catalogues.

**Editor walk-through for "next 10 days, every evening at 20:00, this playlist"** (proposed form, additions marked *new*):
1. Schedule → *Add block* (same form as today).
2. Show profile: optional. Title "Evening playlist". Category.
3. Pool: pick the playlist's pool.
4. Repeat behavior: **Daily**.
5. Start hour **20**, minute **00**. Duration e.g. **120**.
6. *new* "Runs" select: **Always** (default, today's behaviour) / **Between dates** / **Once**.
7. Choose **Between dates**. *From* defaults to today (channel zone). *Until* can be typed, or filled by the helper "for [10] days", which sets it to from + 9 = 10 Oct for a 1 Oct start.
8. *new* inline notice computed from `applyScheduleLayers`: "Takes over 20:00-22:00 from *Weekly block X* on 10 evenings; X continues after 22:00."
9. Save. The server creates 7 rows (repeat group) with the dates. Toast: "created across 7 days, 1 Oct to 10 Oct". The week lens shows the dated item on top with the weekly block cut around it.

For **Once**, a single *Date* field replaces Repeat and Weekday.

### Viewer model (GronkhTV)

- **Failed, so no screenshots exist.** Chromium launched (Playwright 1.56.1 from `node_modules/.pnpm/playwright@1.56.1`, `/opt/pw-browsers/chromium-1194`).
  - `https://gronkh.tv` failed with `net::ERR_TUNNEL_CONNECTION_FAILED`.
  - `https://www.twitch.tv/gronkhtv/schedule` failed the same way.
  - The agent proxy status shows `connect_rejected ... gateway answered 403 to CONNECT (policy denial)` for `gronkh.tv:443` and `www.twitch.tv:443` (2026-10-01T22:34:42Z). `curl` gets the same 403.
  - Per proxy rules I did not route around it.
- I am not describing GronkhTV's layout from memory (owner question 4). The /channel add-on in row 2 is therefore built only on repo conventions: a day-grouped week list, now/next, the zone note and a marker for specials.

### Proposed milestones (topic 1)

| M? Dated And One-Off Schedule Blocks | Behavior + Data | Next | Planned | Say "for the next 10 days at 20:00 this pool runs", or "once on 10 Oct", and have air, previews and Twitch agree | `schedule_blocks.valid_from`/`valid_until` (local dates, inclusive, empty = always) ship in the baseline, ALTER and migration; manifest, mapper, writers and blueprints carry them; `buildScheduleOccurrences` drops occurrences outside the window, so the worker, preview, week lens, cache policy, /channel next and Twitch sync follow; a dated block layers over the weekly grid: `applyScheduleLayers` cuts weekly occurrences around it, conflicts are checked per layer, and dated-vs-dated overlap is refused; an expired block yields nothing and stays listed as ended; the form has Runs = Always / Between dates (with "for N days") / Once and the takeover notice; the Twitch sync drops carry-over occurrences (phantom segment fix) through a pure `planTwitchScheduleSegments`. Proved by `tests/unit/schedule-validity.test.ts` (10-day daily run: day 10 present, day 11 absent; once-block; carry-over past `valid_until`), `tests/unit/schedule-layers.test.ts` (18-22 weekly + 20-21 dated gives 3 occurrences, the weekly pool keeps its cursor), `tests/unit/twitch-schedule-plan.test.ts` (no `:carry` keys; a dated run yields 7 segments then rolls), `tests/unit/schema-manifest.test.ts`, `tests/integration/db-roundtrip.test.ts` (round-trip of both fields), and `pnpm validate`; docs/operations.md schedule section updated | core, worker, db, web, tests, docs | medium | revert commit; the columns stay, are empty for old rows and are ignored |
| M? Public Week Programme | UX + i18n | Later | Planned | Viewers see the coming week, not only now/next | /channel lists 7 days grouped per day in the channel zone and language, with dated items marked and their last date shown; built from the same occurrences as the week lens; both catalogues gain the keys. Proved by `tests/unit/public-channel-view.test.ts` (day grouping, dated marker, key parity) and a measured layout check in `tests/e2e/layout-stability.spec.ts` (no horizontal overflow at 375 px) | web, core, tests, docs | low | revert commit |
| M? Schedule Across DST | Reliability | Later | Planned | A block in the 02:00-03:00 hour airs once, at the right time, on both DST changes | Spring: a start in the gap begins at the first valid minute and keeps its end, on air and on Twitch; autumn: an occurrence airs once (first instance), matched on UTC instants instead of wall-clock minutes. Proved by `tests/unit/schedule-dst.test.ts` (Europe/Berlin 2027-03-28 02:30 and 2026-10-25 02:00-03:00, `toUtcIsoForLocalDateTime` resolves forward) and `pnpm validate` | core, worker, tests, docs | medium | revert commit |

### Questions raised (topic 1)

1. **Precedence:** should a dated item override the weekly block it overlaps, with the weekly block continuing around it? Or should overlaps be refused as today? *Recommendation:* override with cutting. Otherwise "every evening at 20:00" cannot be saved on a channel that is filled 24/7.
2. **Expiry:** should ended dated blocks stay listed under an "Ended" filter until deleted by hand? Or should they be auto-deleted after N days? *Recommendation:* keep them; there is no retention job to get wrong, and they can be reused.
3. **DST:** can the DST fix (row 3) wait until after dated blocks, given the channel's programme does not use 02:00-03:00? *Recommendation:* yes, keep it as a separate milestone.
4. **GronkhTV:** the egress proxy blocks gronkh.tv and twitch.tv from this environment. Can you attach two screenshots (the gronkh.tv Sendeplan and twitch.tv/gronkhtv/schedule), or name what you like there (week grid? per-day list? special events highlighted?), before row 2 is designed? *Recommendation:* send the screenshots; row 2 stays "Later" until then.

## 2. Competitors

_(in progress)_

## 3. Usability

_(in progress)_

## 4. Self-healing

_(in progress)_

## 5. Installation

_(in progress)_

## 6. Bugs (adversarial review)

_(in progress)_

## 7. One plan

_(in progress)_

