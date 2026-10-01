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

### Method

- **No Docker and no live UI.** I started no stack and clicked nothing. The live walk on a fresh install is section 3b below. Everything below comes from images, docs and code at `ab42e11`.
- **Screenshots.** I read all 28 design baselines in `tests/e2e/design-baseline.spec.ts-snapshots/` (14 surfaces × desktop 1440px / mobile 390px) as images. I cropped the tall mobile ones to measure positions.
- **What the screenshots show.** Fixture state per `tests/e2e/design-baseline.spec.ts`: frozen clock Wed 2026-04-08 14:30Z, a seeded gapless week (pools Abendprogramm / Nachtschleife / Archive Pool, 2 ready assets) and the worker stopped. Runtime regions are masked magenta, including the scene preview, so I took the on-air picture from code: `packages/core/src/overlay-layout.ts` and `packages/core/src/viewer-messages/en.ts`.
- **The pixel baselines are partly stale.** `program-schedule-desktop` still shows the old Week-lens sentence ("…from the current pool cursor"). Code and `tests/e2e/wording-baseline.spec.ts-snapshots/program-schedule-chromium-linux.txt:40` have the new one. The 1 % pixel tolerance absorbed the change, so for current wording I used the wording baselines.
- **Docs.** `docs/ui.md`, `docs/getting-started.md`, `docs/operations.md`.
- **Code.** `apps/web` (pages, components, lib), `packages/core` (viewer catalogue, chat parsing, schedule projection), `apps/worker` (chat replies, incidents).
- **Deferred, not planned here.** M66, M57 soak, M77 and M81 (admin language). Every admin-copy finding below is about English wording only.

### Findings — Streamer (S = hours, M = 1–3 days, L = more)

| # | Role | Page/route | Problem | Evidence | Proposal | Effort |
|---|---|---|---|---|---|---|
| S1 | Streamer (b) | `/program?tab=schedule` Week | **The Week view does not show what will actually play.** All 21 blocks show "Abendprogramm — Folge 12", Mon–Sun. Every block's preview restarts from the pool's *current* position. The code says so itself, while the panel text promises "Shows the first video each block would play". A streamer checking Thursday sees today's episode. | `program-schedule-desktop/-mobile`; `packages/core/src/index.ts:2811-2813` (comment: "Every block starts from the pool's stored position… two blocks of one pool… preview the same first item"); `apps/web/components/program-week-lens.tsx:35-42` | Carry the rotation forward block by block in date order, using the same `walkPoolRotation` the worker uses. Mark items after the first day "estimated". | M |
| S2 | Streamer (b) | Week | **A block that crosses midnight is shown on both days.** Sat 23:00–01:00 appears on Sat *and* at the top of Sun (labelled "Saturday"), so Sat and Sun both read "1500m scheduled", more than a day has. Minutes are not a planning unit either. | `program-schedule-desktop` (SAT/SUN cards); `program-week-lens.tsx:29` (`{totalScheduledMinutes}m scheduled`) | Show the overnight block once, on its start day, with a "→ 01:00 Sun" tail. Say "24 h covered" / "2 h gap at 03:00" instead of minutes. | S |
| S3 | Streamer (b) | Week | **"Repeats inside block" is on every block, in an alarm colour, without a reason.** It means the pool holds less video than the block length. There is no number and no fix. | `program-schedule-desktop`; `packages/core/src/index.ts:3164-3171` | Say why and what to do: "Pool has 1 h 45 of video for a 6 h block — plays ~3×. Add videos to *Abendprogramm*." Link to the pool. | S |
| S4 | Streamer (b) | Week → Day | **The Week view is read-only and has no path to editing.** A block opens only its predicted items, which link to an asset. "Add schedule block", templates and "Clone a day" live in the *Day* tab, and the empty state says "Open day lens". "Lens" is an internal word. | `program-week-lens.tsx:45-56,120-122`; `apps/web/app/(admin)/schedule/page.tsx:158-162,204-215` | Put "Edit block" on each block (→ Day editor with the block selected). Add "+ Add block" per day. Rename the tabs to "Week / Day editor / Now & next". | S |
| S5 | Streamer (b) | Day | **The Day editor is buried under internal jargon.** "Materialized fill preview", "Unique library: Xm · Projected: Ym", "Live queue context", "Video-level timeline" are internal terms. The editor itself comes after six panels. | `schedule/page.tsx:217-236,259,277,289` | Put the editor first. Fold fill numbers into the block row (see S3). Drop "materialized". | M |
| S6 | Streamer (a) | `/setup` → done | **Setup stops before the programme.** The wizard ends at Twitch. Media → pool → schedule → destination are left to the "readiness checklist" as "ordinary workspace tasks". A new streamer must find out that pools sit between sources and schedule. | `apps/web/app/setup/page.tsx:204-208`; `docs/getting-started.md` §7 | Add a skippable wizard step, "First programme": choose a source, auto-create a pool, apply a 24/7 template. | M |
| S7 | Streamer (a) | `/live?tab=status` Readiness | **The checklist counts records, not whether the channel can air.** "Program pools: Ready — 3 pool(s)" while *Archive Pool* has 0 assets. "Weekly schedule: Ready — 20 blocks" says nothing about gaps or blocks that cannot play. | `live-status-desktop`, `program-pools-desktop` ("0 total assets · 0 ready"); `apps/web/lib/server/onboarding.ts:158-172` | Pools: "action" when a pool used by a block has 0 ready assets. Schedule: check for week gaps and unresolved blocks; `emptyWeekBlocks` already exists in `schedule/page.tsx`. | S |
| S8 | Streamer (a) | Live → Status vs Studio → Output | **Stream key and destinations are configured in a *status* tab.** The "Output destinations" form (RTMP URL, stream key) sits in Live → Status. Studio → Output shows the same destinations again for profiles only, and the docs have to point people there. | `live-status-desktop` ("Output destinations" form); `apps/web/app/(admin)/dashboard/page.tsx:172,208`; `studio-output-desktop`; `docs/getting-started.md` §3 table | Move the form to Studio → Output, next to the renditions. Status keeps a read-only line with a link. | M |
| S9 | Streamer (a) | `/studio?tab=engagement` | **The UI shows internal milestone ids.** "missing the post-M32 Twitch reconnect", "Broadcasters connected before M32 must reconnect". Users cannot know what M32 is. | `studio-engagement-desktop`; `apps/web/app/(admin)/overlays/page.tsx:69,77,102`; `apps/web/components/engagement-settings-form.tsx:142` ("before 2.1") | Say "Reconnect the channel owner under Admin → Settings → Twitch accounts", with a link. Add a test that fails on `M\d\d` in rendered copy. | S |
| S10 | Streamer (a) | `/program?tab=pools` | **Pool form jargon.** "programming units", "round-robin", "INSERT EVERY N SCHEDULED ITEMS" defaulting to 0, "REPLACEMENT AUDIO". There is no warning on a pool with 0 ready assets. | `program-pools-desktop`; `apps/web/components/pool-form.tsx` | Add a lead sentence: "A pool is a playlist the schedule draws from." Badge empty pools "Nothing to play". Hide inserts/audio under "Extras". | S |
| S11 | Streamer (a) | `/program?tab=library` | **The first asset sits ~2 400 px down on desktop and ~4 000 px on mobile.** Before it come upload, eight filter fields, the curated-set editor and bulk edit. The asset cards show internal states ("No global fallback flag"). | `program-library-desktop/-mobile` | Show the list first, filters in one row, curated sets and bulk as a drawer that opens on selection. | M |
| S12 | Streamer (c) | `/live?tab=control` | **Incidents name the problem but not the action.** The cards show "CRITICAL · playout · title" plus a message. Crash-loop says "Manual intervention is required" but not which button. The incident record has no field for an action. | `apps/web/components/broadcast-control-room.tsx:335-355`; `apps/worker/src/index.ts:7483-7488`; `packages/db/src/index.ts:399-412`; `docs/operations.md:321-325` | Store a "What to do" line plus a target (button / settings anchor / `operations.md` anchor) per fingerprint family, next to `apps/worker/src/incident-classes.ts`. Show it on the card. | M |
| S13 | Streamer (c) | All admin pages (status rail) | **No single "is the channel OK?" answer.** Six chips, raw values ("idle", severity in lowercase). The worker heartbeat is only the *Updates* subtitle, as an ISO timestamp. None of the chips are links. | `admin-status-rail.tsx:18-58`; all `*-desktop` (rail) | Lead with one verdict chip: On air / Degraded / Off air / Worker down, with age. Make each chip a link to its panel. | S |
| S14 | Streamer (c) | Live → Control | **A dead worker is a lowercase word at the bottom of the page.** "missing — No worker heartbeat" appears while "Open problems" says "No open incidents". The worker cannot raise its own death. | `live-control-desktop` (last panel); `broadcast-control-room.tsx:366-376` | Add a web-side "worker heartbeat stale > N s" alert to Open problems and the rail verdict. Test: stale heartbeat → alert visible. | S |
| S15 | Streamer (c) | Live → Control "Current and next" | **The first card a tired operator reads is raw engine state.** "Transition idle · queue reason … · version 0", "Prefetch idle · last probe never", "Transition target none · ready not ready". | `live-control-desktop`; `broadcast-control-room.tsx:111-121` | One plain line: "Next: Folge 13 at 22:00 — ready ✓ / not loaded yet". Move engine fields behind "Details". | S |
| S16 | Streamer (c) | Live → Control "If something is stuck" | **Actions that interrupt the stream have no confirmation and no consequence text.** Soft restart, Force reconnect and Hard reload fire on one tap, on mobile as well. The hint only says to try them "in the order they appear". | `apps/web/components/playout-action-form.tsx:68-128` (no `confirm`; other forms do, e.g. `pool-delete-form.tsx:17`) | Add one line per button saying whether viewers see a cut. Ask for confirmation on actions that interrupt the stream. | S |
| S17 | Streamer (c) | Live, mobile 390px | **On a phone, "Current and next" starts at ≈2 900 px of 6 339.** The global rail, the Live hero rail and the Control hero rail repeat FEED/CURRENT/NEXT/DESTINATION three times. Status mobile is 9 321 px tall. The docs call mobile a non-goal, but the baseline spec calls 390px "the width an operator actually has when something breaks". | `live-control-mobile`, `live-status-mobile`; `docs/ui.md:13,157-159` vs `tests/e2e/design-baseline.spec.ts:169` | On narrow screens: one rail, no hero stats, Current/next + Open problems + 3 safe actions first. | M |
| S18 | Streamer (a) | `/login` | **The Twitch SSO hint is cut off with "…" mid-instruction** ("or…"). Nothing says the owner password cannot be reset, although the getting-started guide warns about it. | `login-mobile`, `login-desktop`; `apps/web/components/twitch-login-panel.tsx:6-19` | Do not clamp instructions. Link to `docs/twitch-setup.md`. | S |
| S19 | Streamer (a) | `/studio?tab=scene` | **The overlay is off by default and the Scene page doesn't make that visible.** "Enable overlay output" is an unchecked box among 40+ fields. The status shows "Draft is based on live scene updated at unknown", "Published never". | `studio-scene-desktop/-mobile`; Live → Status "Overlay output: Overlay is currently disabled" | Show an on/off banner at the top of Scene with a preview of what viewers see now. Replace "unknown"/"never" with "Not published yet". | S |

### Findings — Viewer

| # | Role | Page/route | Problem | Evidence | Proposal | Effort |
|---|---|---|---|---|---|---|
| V1 | Viewer | `/channel` | **"After that" says the programme ends now, although the week is full.** It shows "Nothing further is scheduled yet." because it reads the playout *queue* (usually empty), not the schedule. Only now and next are shown, and there is no day or week guide. | `channel-desktop/-mobile`; `apps/web/lib/public-channel-view.ts:81-88`; `en.ts:142` | Fill "After that" with the next 3–5 schedule blocks (rest of today and tomorrow). Add an optional "This week" list. | M |
| V2 | Viewer | `/channel` | **The page never shows which episode is playing.** It names the *block* ("Abendprogramm"); the on-air lower third shows the video ("Folge 12"). | `public-channel-view.ts:71-73` (schedule item title wins); `apps/web/components/schedule-block-form.tsx:138` (overlay puts video title first) | Title = video, subtitle = block · time · category, matching the picture. | S |
| V3 | Viewer | `/channel` | **All times are in the channel's zone only.** A viewer in New York must convert "20:00 to 00:00" Central European Time in their head. | `channel-*`; `public-channel-view.ts:44,62`; `apps/web/components/live-channel-page.tsx:22` | Convert on the client with `Intl` to the browser zone ("20:00 CET · 14:00 your time"). The server stays canonical. | S |
| V4 | Viewer | On-air picture (Next card) | **The next block's time is drawn without a zone or relative time.** Example: "Next 20:00-00:00". Twitch audiences are international. | `packages/core/src/overlay-layout.ts:415-422`; `en.ts:30` | Add "in 25 min" (zone-free) next to or instead of the range, from the viewer catalogue (en+de). | S |
| V5 | Viewer | Chat | **No `!help` / `!commands`.** The only self-describing command is `!game`, and it covers games only. Votes (`!1…`), `!skip`, `!request <title>` and the moderators' `here 30` cannot be discovered in chat. | `packages/core/src/chat-game.ts:81-94`; `packages/core/src/chat-interaction.ts:72-104`; no `!help`/`!commands` in `apps/worker/src`, `packages/core/src` (grep) | Add a `!commands` reply listing only the *enabled* commands with their configured names, in the channel language, with a per-viewer cooldown. | S |
| V6 | Viewer | Chat `!request` | **A request gets no answer in chat.** No match, cooldown, queue full and accepted are all only logged. `!request` with no title is silently ignored. The viewer cannot tell typo, cooldown and success apart, or which titles exist. | `apps/worker/src/index.ts:9536-9546`; `chat-interaction.ts:101,330`; no `chat.request.*` keys in `packages/core/src/viewer-messages/en.ts` | Reply once per request: "@x queued: Folge 13 (2 ahead)" / "no title matches 'folge 99'" / "try again in 7 min". Point to `/channel` for titles. | S |
| V7 | Viewer | Chat | **There is no `!now` / `!next` / `!schedule`.** Viewers in chat cannot ask what is playing or when the next show starts. The answer exists (`/channel`), but the bot never points to it. | Grep as V5; `public-channel-view.ts` | `!now` replies "Now: Folge 12 · next: Nachtschleife in 25 min · full schedule: <APP_URL>/channel". | S |

### Proposed milestones (topic 3)

**Title:** Schedule shows what will actually air
- **Type / Priority:** UX / P1
- **Goal:** A streamer can plan a week from the Week view alone. The view shows the projected video per block across the week, fill in hours with the reason and a fix, overnight blocks once, a today marker with dates, and "Edit block" / "+ Add block" on the Week view.
- **Acceptance:**
  - New `tests/unit/program-week-projection.test.ts` cases: "two consecutive blocks of one pool preview different first items", "a block across midnight counts once, on its start day", and "fill label names the pool and its runtime".
  - `grep -rnE "Repeats inside block|m scheduled" apps/web packages/core/src` returns 0.
  - Wording + design baselines for `program-schedule` re-recorded with `scripts/design-baseline.sh --update`.
  - `pnpm validate` passes.
- **Touched areas:** `packages/core/src/index.ts` (`buildSchedulePreviewVideoSlots`, `buildMaterializedProgrammingWeek`), `apps/web/components/program-week-lens.tsx`, `apps/web/app/(admin)/schedule/page.tsx`, tests, `docs/ui.md`.
- **Risk:** The preview drifts from the worker's real picks if the projection does not reuse `walkPoolRotation`. Many lines of baseline churn.
- **Rollback:** Revert the commit. The change is preview only; no data or worker changes.

**Title:** 3 a.m. answer: verdict, action, confirm
- **Type / Priority:** UX / P1
- **Goal:** At 3 a.m., in under 30 s on a phone, an operator knows whether the channel is up and what to press:
  - a single verdict chip in the rail that links to its panel;
  - a "What to do" line and target per incident family;
  - a stale-worker alert raised by the web app;
  - a plain current/next line;
  - confirmation for actions that interrupt the stream;
  - a compact mobile Live control.
- **Acceptance:**
  - `tests/unit/incident-classes.test.ts` extended: "every incident family has an operator action".
  - New unit test "stale worker heartbeat yields an open-problem entry".
  - `tests/e2e/admin-smoke.spec.ts` new case: "Live control on 390px shows Current and next above the fold" (bounding box < 1 400 px).
  - `grep -rn "ready not ready" apps/web` returns 0.
  - Baselines `live-*` re-recorded.
  - `pnpm validate` passes.
- **Touched areas:** `apps/worker/src/incident-classes.ts` (or a shared core map keyed by fingerprint, so no DB migration), `apps/web/components/{admin-status-rail,broadcast-control-room,playout-action-form}.tsx`, `apps/web/app/globals.css`, `docs/operations.md`, `docs/ui.md` (narrow the "mobile non-goal").
- **Risk:**
  - Action texts drift from the real buttons. Mitigation: action targets are ids checked by a test.
  - The control-density e2e budget.
  - Baseline churn on 6 surfaces.
- **Rollback:** Revert. The mapping is additive, with no schema change.

**Title:** Viewers can see the lineup and get chat help
- **Type / Priority:** Feature (viewer) / P2
- **Goal:** `/channel` shows the playing video, the next 3–5 *schedule* blocks and local-time conversion. On air, the next card adds "in N min". The bot answers `!commands`, `!now` and every `!request` outcome, in the channel language, with cooldowns.
- **Acceptance:**
  - `tests/unit/viewer-language-public-page.test.ts`: "after that lists upcoming schedule blocks when the queue is empty" and "on-air title is the video title".
  - `tests/unit/chat-interaction.test.ts`: "!commands lists only enabled commands".
  - New `tests/unit/chat-request-replies.test.ts`: one reply per outcome (en + de).
  - The catalogue parity test and `tests/unit/viewer-language-literals.test.ts` stay green.
  - Wording/design baseline `channel` re-recorded.
  - `pnpm validate` passes.
- **Touched areas:** `apps/web/lib/public-channel-view.ts`, `apps/web/components/live-channel-page.tsx`, `packages/core/src/{chat-interaction.ts,viewer-messages/*,overlay-layout.ts}`, `apps/worker/src/index.ts` (drainChatEffects), `docs/operations.md` *What Viewers Read*, `docs/twitch-setup.md`.
- **Risk:**
  - Bot chat volume and Twitch rate limits. Mitigation: per-viewer and global cooldowns, each reply switchable off.
  - The `/channel` public read now exposes more schedule (titles only).
- **Rollback:** Feature switches off; revert.

**Title:** First programme without a manual
- **Type / Priority:** UX / P2
- **Goal:**
  - `/setup` gets a skippable step, "First programme" (source → auto pool → 24/7 template).
  - Readiness checks semantics: pools used by blocks have ready assets, and the week has no gaps or unplayable blocks.
  - Destinations move to Studio → Output.
  - Milestone ids and jargon (lens, materialized, round-robin, cursor) are removed from admin copy (English only, not M81).
- **Acceptance:**
  - `tests/unit/onboarding*.test.ts`: "pool referenced by a block with 0 ready assets is action" and "week with a gap is action".
  - New `tests/unit/admin-copy-no-milestone-ids.test.ts` scans rendered JSX text for `\bM\d{2}\b`.
  - `tests/e2e/admin-smoke.spec.ts`: "fresh owner can complete First programme and readiness shows schedule ready".
  - Wording baselines re-recorded.
  - `pnpm validate` passes.
- **Touched areas:** `apps/web/app/setup/page.tsx`, `apps/web/lib/server/onboarding.ts`, `apps/web/app/(admin)/{overlays,dashboard}/page.tsx`, `apps/web/components/{pool-form,destination-settings-form,engagement-settings-form}.tsx`, `docs/getting-started.md`, `docs/ui.md` (Canonical Terms).
- **Risk:**
  - Moving the destination form breaks docs links and operator habit. Mitigation: a status link to the new place.
  - The wording pass touches most baselines.
- **Rollback:** Revert. The wizard step is skippable and writes only ordinary pool and block records.

### Questions raised (topic 3)

1. **Which time should `/channel` lead with: the viewer's local time or the channel zone?**
   Recommendation: local time first, channel zone second, both shown. It is computed in the browser only, so nothing server-side changes.
2. **May the bot post more in chat (`!commands`, `!now`, request replies)?**
   Recommendation: yes. Each one gets a switch under Engagement, plus a per-viewer cooldown (60 s) and a global one (10 s). Silence after a request reads as "broken".
3. **May `docs/ui.md` stop calling mobile a non-goal, for Live only?**
   Recommendation: yes, a narrow "on-call" layout for Live → Control/Status (verdict, current/next, problems, safe actions). Program and Studio stay desktop-first.

### 3b. Live UI walk

_(in progress, from the fresh-install stack of topic 5)_

## 4. Self-healing

_(in progress)_

## 5. Installation

_(in progress)_

## 6. Bugs (adversarial review)

_(in progress)_

## 7. One plan

Scope: every plan/agent file on `claude/proposal-2026-10-te1vlg` (= `m75-source-breaker` `ab42e11` + `planning/research-brief.md`)
and on `origin/main` (`1533c7b`). The repo is a shallow clone (`git rev-parse --is-shallow-repository` -> `true`, graft root
`d304c8e`), so history older than 2026-09-05 is not visible locally; facts older than that come from `PLANS.md` text.
Reference checker used below: a throwaway shell script (not committed) that extracts every backticked repo-relative path and
tests it against the repo root and the file's own directory; the proposed milestone "Reference Check" makes it permanent.

### Inventory

| File | Lines | Purpose | Current? (evidence) | Contradictions / stale refs | Fate |
|---|---|---|---|---|---|
| `AGENTS.md` | 102 | agent rules, DUT workflow | partly: rules L5-37 hold; DUT section L39-102 predates Portainer/`repin.sh` | dead ref L3; DUT section vs HANDOFF (see below); L32/L36 "continue until no incomplete milestone" vs owner gates | **rewrite** (draft below) |
| `IMPLEMENT.md` | 69 | runbook | duplicate of AGENTS (hard blockers L61-69 = AGENTS L11-19; done list L39-53 ~ AGENTS L21-28) | dead ref L11; L3 "PLANS.md is the source of truth" | **merge into AGENTS, delete** |
| `PLANS.md` | 5223 (main: 4171) | milestones + 900 lines of progress notes | head L1-50 is April 2026 ("Current State", "Target State" against "Upstream") | 145 dead path refs (all historical, e.g. L917, L1246 `docs/full-product-reset-audit.md`, L4478 `lib/server/state.ts` = `apps/web/lib/server/state.ts`); two different "Phase 5" headings L1327, L2452; M66 "In progress" L78 and M57 "In progress" L1346 although owner-gated | **shrink + archive** |
| `HANDOFF.md` (main only) | 118 | transient release handoff for 2.1.0/2.2.0 | yes, dated 2026-10-01 (L1) | self-expiring: "Delete this file when the two releases below are out" (L3-4); deleted on this branch (`git diff --name-status origin/main HEAD` -> `D HANDOFF.md`) | **delete after v2.2.0**; rules L13-28, L96-118 move to AGENTS |
| `planning/next-session-prompt.md` | 121 | German prompt for a follow-up session | no: "Produktion läuft auf **v1.5.22**" (L13); local path `/home/benjamin/code/stream247` (L7) | L114 "Nach jeder abgeschlossenen Aufgabe committen und pushen" conflicts with the cloud push rule; L102-110 traps (SSH cert ~8 h, CI concurrency, snapshot portability, compose `!override`) still useful | **delete**; move L102-110 traps to AGENTS/docs |
| `planning/audit-2026-09-02.md` | 968 | reconstructed code audit (51 findings, 12 confirmed) | no: status "Stand 13:00 UTC, v1.5.38" (L3); B1 "IN ARBEIT" (L10) | 39 findings "unverifiziert" (L3/L5) never triaged in PLANS | **archive** (`planning/archive/`), one PLANS follow-up line "39 unverified findings untriaged" |
| `planning/archive/product-reset-{audit,docs-plan,kill-list}.md` | 139/184/162 | April 2026 reset artifacts | historical; added at graft `d304c8e` | point to `docs/product-reset-*.md` deleted by M49 (PLANS.md:3286); `product-reset-audit.md:122` cites `/root/stream247/recovery-stack` "per AGENTS.md" | **keep as archive**, excluded from ref check |
| `planning/research-brief.md` | 96 | this proposal's brief | branch only | - | keep until proposal is decided, then archive |
| `README.md` / `CONTRIBUTING.md` | 670 / 22 | human docs | no agent instructions (`grep -n 'PLANS\|AGENTS\|planning/' README.md` -> empty) | `CONTRIBUTING.md:12` "all repository-facing content in English" vs `planning/*.md` in German | keep |
| `.claude/launch.json` | 14 | `pnpm run dev` on :3000 for the preview tool | yes | none | keep |
| `.github/pull_request_template.md` | 18 | PR checklist | partly: lists lint/typecheck/unit/integration/build, not `pnpm validate` or baselines | - | keep (optional: add baselines line) |
| `CLAUDE.md` | - | - | does not exist (`wc` -> No such file) | - | do not create; AGENTS.md is the single file |
| `release-prune-backup-20260614T000908Z/` | 127 lines, 9 files, 40K | 2026-06-14 snapshot before a tag/release prune: tag lists, tag->sha, two release JSONs, DT `stack.env` image refs (v1.5.17), note that GHCR was not pruned | no: superseded, all 39 releases were backfilled (HANDOFF-main.md:43) | referenced nowhere outside itself (`grep -rn release-prune-backup` -> only its own `git-status.txt:5`); its own `git-status.txt:3-5` shows it and `planning/` were untracked when written, i.e. committed by accident; no secret values (only scope names in `GHCR-NOT-PRUNED.txt:3`) | **delete** |

### Verified stale or contradicting items

1. **Dead mandatory reading.** `AGENTS.md:3` and `IMPLEMENT.md:11` require `docs/full-product-reset-audit.md`. M42 moved it to
   `docs/archive/` (PLANS.md:2869, 2876) and M49 deleted `docs/archive/*` (PLANS.md:3286, 3295). Checker over
   AGENTS/IMPLEMENT/PLANS/README/CONTRIBUTING/docs/*: 149 dead refs; outside PLANS.md only four:
   `AGENTS.md:3`, `IMPLEMENT.md:11`, `docs/architecture.md:331` (`packages/core/chat-game.ts` -> really
   `packages/core/src/chat-game.ts`), `docs/architecture.md:42` (`data/app/state.json`, a runtime path, false positive).
2. **PLANS.md size vs reading rule.** `AGENTS.md:3-4` makes every session read PLANS.md; it is 5223 lines on the branch
   (`wc -l`), 4171 on main. 899 lines are "Progress Notes" (L1553-2451); M59+ sections are L3370-5223 (1853 lines);
   largest sections M75 219 lines (L4183), M80 183 (L4821), M76 173 (L4402).
3. **AGENTS.md DUT section vs HANDOFF-main.md**, line by line:

| Topic | AGENTS.md | HANDOFF-main.md / docs | Reality |
|---|---|---|---|
| who runs DUT work | L41-43 "Always use the DUT host over SSH" (agent does it) | L15-17 no way from outside the LAN; "Ask the owner ... never guess a result" | owner runs |
| deployment path | L54-57 `/root/stream247/recovery-stack`, `stack.env` | L22 repin via `ssh dt '~/repin.sh <tag> --dry-run'`; `docs/deployment.md:8,22,189-191` Portainer on DT is the control plane | Portainer stack on DT; container names `stream247-*-1` (HANDOFF L23, L25) imply compose project `stream247`, not a `recovery-stack` dir (inference) |
| soak start | L93-95 run `soak-monitor.sh` from a discovered DUT repo path | L24 `ssh dut 'cd ~ && ~/scripts/start-soak.sh 24; tmux ls'` | wrapper in owner's home, not in repo (`ls scripts` has no `start-soak.sh`) |
| soak log | L66 "write soak output to a log file" (unspecified) | L21 `~/logs/soak-20261001-034108.log`, pass = `soak-monitor-complete` (L55) | `~/logs/soak-*.log` |
| image pins | L61 "use the images already pinned in stack.env" | L22 repin with `repin.sh`, dry run first | repin is an owner step |
| DB backup | absent | L23 `pg_dump` before a schema change | owner step |
| done definition | L97-102 agent started the soak, readiness green | L55-56 owner reports result; "a pass with an outage is never called clean" | owner hands over result |
| discovery | L73-89 `find /root -maxdepth 5 ...`, `cd /root/stream247/recovery-stack && docker compose ps` | not used anywhere since M50 (PLANS.md:3613, 3781, 3803 all use `repin.sh`) | obsolete |
| reading list | L3 AGENTS+PLANS+IMPLEMENT+dead audit | L115 "Read `AGENTS.md` and `PLANS.md` first" | AGENTS+PLANS |

4. **Workflow rules that would start owner-gated work.** `AGENTS.md:32,36` "automatically continue with the next incomplete
   milestone"; PLANS.md:78 (M66 "In progress") and PLANS.md:1346 (M57 "In progress") are incomplete, yet HANDOFF-main.md:98-101
   says never start them (and M77/M81) without the owner. `AGENTS.md:35` "Push the current branch after each ... commit" has no
   main/force restriction.
5. **next-session-prompt.md** describes v1.5.22 (L13) and a local checkout (L7); current release line is 2.1/2.2.
6. **PLANS.md head is April 2026**: "Current State"/"Target State" (L9-49) still frame the product against "Upstream" and
   name `apps/worker/src/index.ts` size as the risk; two "Phase 5" sections (L1327 German, L2452 English).

### PLANS.md structure (branch)

- 6 milestone tables (header rows at L53, L101, L113, L923, L1338, L2470), **96 milestone rows**, no duplicate IDs
  (`grep -oE '^\| M[0-9.]+' PLANS.md | sort -u | wc -l` -> 96). Main table L53-96: 42 rows, but M16-M58 live only in the five
  phase tables.
- Status over all rows: 82 Complete, 7 Done, 1 "Done 2026-09-09" (M67), 2 In progress (M66 L78, M57 L1346),
  2 Planned (M71 L86, M83 L95), 2 Deferred (M77 L89, M81 L93).
- Phases: "Phase 2 Post-M9" L444, "Phase 3" L97, "Phase 4" L912, "Phase 5 Broadcast-Kanal" L1327, "Phase 5 Product Reset" L2452
  (ordering in the file is not chronological). Generic blocks: Validation Commands L507, Rollback Notes L1533,
  Strict Done Definition L1544 (= AGENTS.md:21-28).
- A short current plan needs only: M71/M83 (until shipped), M66 and M57-soak (owner-gated), M77/M81 (deferred, owner
  start), the follow-ups listed in HANDOFF-main.md:105-111 plus the "Follow-ups:" blocks at PLANS.md:4006, 4161, 4370, 4550,
  4701, 4814, 4980, 5101, the per-milestone DUT checks for 2.2.0 (PLANS.md:3993-5085), and one index row per shipped release.

### Branches (`git ls-remote --heads origin`, each fetched, `merge-base --is-ancestor` vs `origin/main` `1533c7b`)

| Branch | Head | In main? | Ahead/behind | What it is | Proposed |
|---|---|---|---|---|---|
| `claude/project-thread-o8lia9` | `f122c12` | no | 3/1 | **the head of PR #4** (`gh api repos/DrJakeberg/stream247/pulls` -> `4 open head=claude/project-thread-o8lia9`): `5e828d9`+`76b8b58` (retire Program screenshot spec, e2e gate test) + merge of main `743b6ec`; +16 lines in PLANS.md | merge or close after v2.2.0 (it touches PLANS.md; see rule on soaked code) |
| `claude/retire-program-screenshot-spec` | `76b8b58` | no | 2/4 | pre-merge copy of PR #4's commits (ancestor of `f122c12`); not itself a PR head | delete with PR #4 |
| `claude/proposal-2026-10-te1vlg` | `bd78404` | no | 13/1 | this session: m75 + research brief | proposal only |
| `m75-source-breaker` | `ab42e11` | no | 12/1 | PR #3 (draft), 2.2.0 | release train |
| `claude/release-2.1-2.2-xm0ud7` | `1533c7b` | yes | 0/0 | = main (handoff commit) | delete |
| `rc2-pool-order-play-now` | `05549ee` | yes | 0/9 | M74 branch, merged | delete |
| `review/v1.5.19-baseline` | `17cf16d` | no (merge commit) | 200*/1 | base of PR #2 (closed, merged 2026-10-01); tree == `743b6ec` (`git diff --quiet` -> equal), i.e. main minus HANDOFF; *ahead count inflated by shallow graft | delete |

Remote branch deletion is an owner action (cloud sessions do not push deletes).

### Target layout and migration order

Target: `AGENTS.md` (single rule file, <= 120 lines) - `PLANS.md` (current + next, < 300 lines) -
`planning/archive/plans-m0-m83.md` (verbatim old PLANS.md via `git mv`, so `git log --follow` keeps history) -
`planning/archive/` (reset artifacts, audit-2026-09-02) - `HANDOFF.md` only while a release is in flight, deleted by the
release commit that ends it. Removed: `IMPLEMENT.md`, `planning/next-session-prompt.md`, `release-prune-backup-*/`.

New PLANS.md skeleton: 1 purpose line + pointer to AGENTS.md; table "Open" (open/planned milestones); table "Owner-gated
and deferred" with gate column (M66, M57 soak part, M77, M81); "Known follow-ups" (not milestones); "Shipped" index (one
row per release: version, date, milestones, archive anchor); new milestone sections appended below and moved to the
archive when their release ships.

Order (nothing before v2.2.0 is tagged; main, PLANS.md and CHANGELOG.md are frozen for the train):
1. v2.1.0 tag -> merge PR #3 -> v2.2.0-rc.1 -> soak -> v2.2.0 tag (HANDOFF steps 2-5). PR #4 is decided by the owner
   before or after, never merged between rc and tag.
2. Release commit of v2.2.0 (or the first commit after it) deletes `HANDOFF.md` (its L3-4).
3. Milestone A (docs only, one commit): `git mv PLANS.md planning/archive/plans-m0-m83.md`; new PLANS.md; new AGENTS.md;
   `git rm IMPLEMENT.md planning/next-session-prompt.md -r release-prune-backup-20260614T000908Z`;
   `git mv planning/audit-2026-09-02.md planning/archive/`; fix `docs/architecture.md:331`.
4. Milestone B (one commit): reference checker + unit test inside `pnpm validate`.
5. Owner deletes the four stale remote branches.

### Draft AGENTS.md

```markdown
# Agent Rules

Single source of rules for every session (human-run, local or cloud). `PLANS.md` holds what to build;
history is in `planning/archive/`. If a rule here and a plan disagree, this file wins; flag the conflict.

## Start of a session
- Read this file and `PLANS.md` (both short). Read an archive file only when a milestone points to it.
- Pick exactly one milestone from `PLANS.md` "Open". Restate its acceptance before changing code.
- Never start a milestone listed under "Owner-gated and deferred" unless the owner says so in this session.
  Today: M66 Live Bridge rehearsal, the soak part of M57, M77, M81.

## Communication with the owner
- Reply in German, short, result first, then the evidence (command + decisive output or path:line).
- Never guess a result you could not measure; say what was not verified and why.
- A soak with any outage or failure is "passed with failure", never "clean". Report `outages`,
  `outageSecondsMax` and the uplink restart delta with every soak result.

## Scope and quality
- Keep the diff scoped to the milestone; extend working code before rewriting; additive schema first.
- Changed behaviour needs tests, or a written justification in the summary.
- Docs stay in sync with behaviour in the same commit.
- No new dependency without a one-line reason in the summary.
- UI text changes need the design and wording baselines re-recorded on a fresh stack
  (`scripts/design-baseline.sh`). A session without docker relies on CI for that and must say so.
- Repository content is English (`CONTRIBUTING.md`); conversation with the owner is German.

## Commits, branches, pushes
- One commit per completed milestone. `pnpm validate` must pass before every commit.
- Targeted checks when the area needs them: `pnpm test:fresh-db`, `pnpm test:fresh-compose`,
  the docker image builds + `./docker/smoke-test.sh`, `pnpm release:preflight`.
- Push feature branches freely. Pushing to `main` from a cloud session: one fast-forward attempt only;
  if it fails, give the owner the exact command. Never `--force`, never push or merge via the GitHub API.
- Merging any PR into `main` between a release candidate and its tag changes the soaked code:
  flag it to the owner first, do not merge.
- After a push, wait for CI (`gh run watch --exit-status`) instead of assuming the outcome.
- At milestone end: append a dated progress note to the milestone section in `PLANS.md`; summary with
  changed files, risks, follow-ups.

## Releases
- No release (tag, GitHub release, repin) before the owner has handed over the soak result.
- The release commit changes `package.json`, the image defaults in `docker-compose.yml`,
  `.env.production.example`, `docs/deployment.md` and the `CHANGELOG.md` section; then CI, then the tag.
- A release in flight may have a `HANDOFF.md`; the commit that finishes the release deletes it.
- After a release, move the shipped milestone sections from `PLANS.md` to `planning/archive/`.

## Production host (DUT) and Portainer host (DT)
- Both are on the owner's LAN behind a short-lived SSH certificate (~8 h). Cloud sessions cannot reach
  them. `Permission denied (publickey)` from a local session usually means the certificate expired;
  only the owner renews it.
- The deployed stack is the Portainer stack on DT (`docs/deployment.md`). Only the owner runs, or
  explicitly hands to a local session:
  - soak result: `ssh dut 'grep -E "outage|complete" ~/logs/soak-<stamp>.log'`
  - repin: `ssh dt '~/repin.sh <tag> --dry-run'`, then without `--dry-run`
  - PostgreSQL backup before any schema change:
    `ssh dut 'umask 077; docker exec stream247-postgres-1 pg_dump -U stream247 -d stream247 -Fc > ~/backups/stream247-pre-<tag>.dump'`
  - soak start: `ssh dut 'cd ~ && ~/scripts/start-soak.sh 24; tmux ls'`
    (wraps `scripts/soak-monitor.sh --hours 24`; pass = `soak-monitor-complete` in the log)
  - per-milestone DUT checks listed in the milestone section of `PLANS.md`
- Never run a 24-hour soak anywhere except the DUT. Never change DUT secrets or production values.
- Use `CHECK_BASE_URL=http://127.0.0.1:3000` when `APP_URL` is not reachable from the DUT itself.

## Twitch
- Broadcast channel: `jimpanse247`. Bot / moderator account: `3JakeC`.
- Check live status only on the broadcast channel, never on the bot:
  `ssh dut 'docker exec stream247-playout-1 yt-dlp --simulate --print "%(is_live)s" https://www.twitch.tv/jimpanse247'`

## Never
- Print or commit a secret, token or stream key.
- Change the relay pin `bluenviron/mediamtx:1.15.4`.
- Deduplicate identical lines when resolving merge conflicts in `PLANS.md` or `CHANGELOG.md`.

## Known traps
- CI serialises per ref (`concurrency: ci-${{ github.ref }}`); cancel stale runs instead of waiting.
- Visual snapshots are not portable: create and check baselines only via `scripts/design-baseline.sh`.
- Compose merges lists: `ports`, `env_file`, `volumes` need `!override`.

## Hard blockers (the only reasons to stop early)
- missing secret or credential; missing external service or permission (includes DUT/DT access)
- destructive migration without a clear safe path; unresolved legal or licensing issue
- a product decision that cannot be inferred from existing behaviour or conventions -> ask the owner
- the next open milestone is owner-gated
```
(81 lines; replaces AGENTS.md L39-102 and all of IMPLEMENT.md; traps from next-session-prompt.md:102-110.)

### Proposed milestones (topic 7)

| Milestone | Type | Priority | Goal | Acceptance | Touched Areas | Risk | Rollback |
|---|---|---|---|---|---|---|---|
| One Plan | Docs + Ops | Next (after v2.2.0 tag) | One short plan, one rule file, history archived | `wc -l < PLANS.md` < 300; `wc -l < AGENTS.md` <= 120; `test ! -e IMPLEMENT.md && test ! -e HANDOFF.md && test ! -e planning/next-session-prompt.md && ! ls -d release-prune-backup-*`; `git log --follow --oneline planning/archive/plans-m0-m83.md \| wc -l` > 1; every open/deferred row of the old table (M57, M66, M77, M81) appears in the new PLANS.md; `grep -c recovery-stack AGENTS.md` = 0; `pnpm validate` passes | `AGENTS.md`, `PLANS.md`, `IMPLEMENT.md`, `planning/**`, `release-prune-backup-*`, `docs/architecture.md` | low (docs only; risk is losing an open follow-up -> checked by the row comparison) | revert the commit |
| Reference Check | Ops + Tests | Next (after One Plan) | A doc or rule never points at a file that does not exist | `scripts/check-doc-refs.mjs` extracts backticked repo-relative paths from `AGENTS.md`, `PLANS.md`, `README.md`, `CONTRIBUTING.md`, `docs/*.md` (not `planning/archive/**`) and fails on a missing path; `tests/unit/doc-refs.test.ts` runs it, so `pnpm validate` and CI fail on a dead ref; a mutation (add a backticked `docs/nope.md` to AGENTS.md) makes the test fail; zero dead refs on the tree | `scripts/`, `tests/unit/`, docs fixes | low (false positives for runtime paths such as `data/app/state.json` -> explicit allowlist in the script) | revert the commit |

### Questions raised (topic 7)

1. **Archive cut:** archive the whole current PLANS.md as one file `planning/archive/plans-m0-m83.md` (recommended: one
   `git mv`, history intact, no section-level editing) or split per release line (1.x / 2.0 / 2.1 / 2.2)?
2. **PR #4 (`claude/project-thread-o8lia9`)**: merge after v2.2.0 is tagged and before Milestone "One Plan" (recommended:
   it adds 16 lines to PLANS.md and would otherwise conflict with the archive move), or close it?

