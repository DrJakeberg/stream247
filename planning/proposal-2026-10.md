# Proposal 2026-10: the stage after 2.2.0

- Date: 2026-10-01 (UTC). Base: `m75-source-breaker` at `ab42e11` (the coming 2.2.0) plus the three research branches
  `claude/r1-scheduling-competitors-v5o5zi` (`ac7f2dc`), `claude/r2-ux-install-06u7b8` (`bfaecda`) and
  `claude/r3-robustness-e26toj` (`f36fd3e`, including the owner's decisions on R3's questions), merged into
  `claude/vorschlag-2026-10-6a60z9`.
- Sources: `planning/research/scheduling-competitors.md` (R1), `planning/research/ux-install.md` (R2),
  `planning/research/robustness.md` (R3). Finding ids below (B1, I1, U7, S1, …) are theirs; R2's U3 (empty library) and the audit's U3 (heartbeat thresholds, triaged by R3) share an id and are written "R2 U3" and "audit U3"; this file condenses, checks and
  orders them. The earlier, stopped planning branch `claude/proposal-2026-10-te1vlg` was used as a lead for section 3 only.
- Nothing was fixed. No product code, `PLANS.md` or `CHANGELOG.md` was changed.
- Wording: **Confirmed** = shown by a test, probe or command output; **Reproduction** = R3 copied worker lines into a probe
  (the worker entry file cannot be imported); **Suspicion** = code reading only.

## Summary

1. The three research files hold up. Of 22 load-bearing claims I re-checked (probe, `path:line`, two competitor URLs), 22
   held; none had to be struck. Five stay reproductions or suspicions and are worded so (see 1.4).
2. Robustness comes first. A Postgres stop takes the channel off air (S1), a refused Twitch refresh token stalls the worker
   forever (S2), the web never recovers from a failed first boot (S3), and the audit log keeps stream keys verbatim (M4).
   All four are small, local fixes.
3. Midnight is a bug cluster: cuepoints fire twice (C1), Twitch gets a phantom segment a day late (C2 = B1), the overlap check
   is wrong in both directions (C3 = B2), and the week view counts overnight blocks twice (C6). One milestone fixes all.
4. The owner's sentence "the next 10 days at 20:00 this playlist" cannot be saved today for two reasons: blocks have no dates,
   and on a 24/7 grid any 20:00 block is refused as an overlap. Dated blocks need an answer to Q1 (precedence).
5. A stranger fails at install: demo data turns a new channel red within two minutes (I1), plain HTTP on the LAN silently
   blocks sign-in (I2), the compose file installs 2.0.0 (I3), and the guide skips three steps (I4).
6. At 3 a.m. a dead worker is not listed as a problem (U7) and the status page says it is active (U8).
7. The plan files contradict each other and the owner's rules (section 3). The first milestone makes one short plan and one
   rule file and adds a test against dead references.
8. Proposed: 21 milestones, M84 to M104, ordered by value and risk. M66, the soak part of M57, M77 and M81 stay deferred.
9. Ten questions to the owner in section 5; all are decided (2026-10-01 23:34 UTC and 2026-10-02 10:22 UTC, every recommendation, jimpanse247 is an affiliate), as are R3's seven (2026-10-01 23:13 UTC).

## 1. Check of the research findings

### 1.1 Method

I did not trust the files. For each research file I picked the findings that drive a milestone and checked them myself on
this branch:

- **Probe** (throw-away `tests/unit/zz-vorschlag-probe.test.ts` against the real `@stream247/core`, deleted afterwards;
  `pnpm exec vitest run tests/unit/zz-vorschlag-probe.test.ts` → `Tests 1 passed (1)`):

  ```
  PROBE C3 mon23+120 vs mon00+30 (no real overlap): ["mon-late","mon-early"]
  PROBE C3 mon23+120 vs tue00+30 (real overlap): []
  PROBE 24/7 thu + thu20-22: ["grid","special"]
  PROBE C2 tue occ 2026-10-06:mon-late:1380:120:carry start 2026-10-06T21:00:00.000Z
  PROBE single 2027-10-06: 2027-10-06:wed:1200:60
  PROBE C4 RangeError: Invalid time zone specified: Europe/Berln
  ```

- **Code at the cited line**, read on `ab42e11`.
- **Competitor URLs**: `curl` is refused by the proxy (`CONNECT tunnel failed, response 403`), so I read two load-bearing
  pages through WebFetch.

### 1.2 R1 (scheduling and competitors)

| Claim | Check | Verdict |
|---|---|---|
| Blocks have no date; "Single day" airs every week | `packages/core/src/index.ts:1026-1030` label "Single day", "Keep this block on one weekday only"; probe `single 2027-10-06` yields an occurrence a year later | holds |
| A 20:00 block cannot be saved on a 24/7 grid | probe `["grid","special"]` | holds |
| B1 phantom Twitch segment a day late | probe: the Tuesday carry-over gets `start 2026-10-06T21:00Z` (= Tuesday 23:00 Berlin); `apps/worker/src/index.ts:8630-8644` feeds carry-overs into `toUtcIsoForLocalDateTime(date, startMinuteOfDay)` (`:8665-8669`) | holds |
| B2 overlap check wrong across midnight | probe: false positive and missed overlap; `packages/core/src/index.ts:3331` compares same weekday only | holds |
| B3 cache keep-rule start 23 h late | `apps/worker/src/vod-cache-release-policy.ts:32` `dayOffset * 1440 + occurrence.startMinuteOfDay` | holds (impact only with retention < ~23 h, as R1 says) |
| LiveReacting: one-time / multi-date / repeat with end after N runs or days, up to four weeks, overlaps highlighted before saving | WebFetch of https://help.livereacting.com/en/live-reacting-studio-1/advanced-scheduling: "scheduled live streams up to four weeks in advance"; "Any overlaps or incorrect schedule dates will be highlighted" | holds |
| Streamloop: edits are a draft, applied at the end of the current clip | WebFetch of https://streamloop.app/docs/build-and-schedule-your-playlist: "Nothing changes on air yet — your edits are a draft"; "updates at the end of the current clip" | holds |

### 1.3 R2 (operation and installation)

| Claim | Check | Verdict |
|---|---|---|
| I1 demo data seeded into every empty DB | `packages/db/src/index.ts:5944-5948` `if (empty) … persistState(client, legacy ?? createInitialSeedState())`; seed rows "Morning Twitch VOD Rotation" `:2077`, "Prime Time YouTube Playlist" `:2087`, `source-youtube` `:2098` | holds |
| I2 session cookie is `Secure` in production | `apps/web/lib/server/auth.ts:158` `secure: process.env.NODE_ENV === "production"` | holds (the browser behaviour is R2's run, not re-run) |
| I3 compose installs 2.0.0 | `docker-compose.yml:39,79,118,143` default `…:v2.0.0`; `package.json:4` `2.1.0-rc.2` | holds |
| I4 no "get the files" step, no Twitch console link | `grep -n -i "git clone\|dev.twitch.tv" docs/getting-started.md README.md docs/deployment.md` → no output | holds |
| U8 fixed "are now active" sentence | `apps/web/app/(admin)/dashboard/page.tsx:269` | holds |
| U11 Restart / Hard reload without confirmation | `grep -c "confirm(" apps/web/components/playout-action-form.tsx` → `0` | holds |
| V6 the bot answers nothing but the skip | `grep -c "twitchChatBridge.say" apps/worker/src/index.ts` → `2` | holds |

### 1.4 R3 (self-healing and adversarial review)

| Claim | Check | Verdict |
|---|---|---|
| S1 failed-cycle branch has no catch | `apps/worker/src/index.ts:9913-9928`: `await upsertIncident` and `await sendAlert` unguarded, while the stalled branch (`:9899-9909`) has `try … catch` | holds in code; the live kill is R3's run, not re-run here |
| S2 proactive refresh unguarded | `apps/worker/src/index.ts:8847-8848` `twitchAccessToken = await refreshIdentityAccessToken();` without try | holds in code; live run is R3's |
| S3 rejected bootstrap promise cached | `packages/db/src/index.ts:5935-5960`: `__stream247DbReady` is set once and only awaited afterwards | holds |
| M4 audit messages not redacted | `packages/db/src/index.ts:6057-6065` inserts `message` as given | holds |
| C4 env zone never validated | `packages/db/src/instance-config.ts:31-36`; probe `RangeError: Invalid time zone specified: Europe/Berln` | holds; "the channel goes dark" stays a **Suspicion** (R3 marks it so) |
| W5 cuepoint asset differs between worker and preview | `apps/worker/src/cuepoints.ts:71` `block.cuepointAssetId \|\| pool.insertAssetId`; `packages/core/src/index.ts:3008-3021` falls back only when `insertEveryItems > 0` | holds (R3 cited `:76`; the line is `:71`) |
| C6 overnight block counted on both days | `packages/core/src/index.ts:3233` sums `block.durationMinutes` | holds |
| audit U3 two heartbeat thresholds | `apps/web/lib/server/state.ts` uses `45_000`; `apps/web/lib/server/readiness.ts:7,97` uses `60_000` | holds |

Downgrades (wording, not substance):

- **W2, W4, W6** are reproductions of worker lines, not runs against a playing channel. Their milestones (M88, M93) therefore
  carry a DUT check in the acceptance.
- **C2 follow-on** ("if Twitch rejects the duplicate, every sync re-creates segments") stays a **Suspicion**; Twitch was
  unreachable.
- **V3** (R2: `/channel` names the block, not the episode) stays a **Suspicion**.

Nothing was struck. Cross-file duplicates are merged: B1 = C2, B2 = C3 = audit U21, W3 = C1, R2 U5 overlaps C6, R2 V1 overlaps
R1 row B, R2's "Week view" leads S1-S5 overlap R3 C6.

**One conflict between the files:** R1 row C wanted an autumn-repeated hour to air once, on UTC instants. R3 Q4, which the
owner accepted, keeps the wall clock (a block in 02:00-03:00 is skipped in March and airs twice in October) and fixes only
the counts. This proposal follows the owner's decision (M101); R1's question Q6 is therefore closed.

## 2. Findings by topic (condensed)

### 2.1 Self-healing and failure handling (R3)

What already recovers by itself is broad (R3 1.1, 26 rows: stall guard, ffmpeg exits, feed and audio stalls, source
breaker, network-outage verdict, destination cooldown, uplink watchdogs, 48 h cut, disk watermark, incident sweep, schema
drift). The gaps:

| Id | Finding | Evidence level | Owner decision |
|---|---|---|---|
| S1 | Postgres stop or crash ≥ one cycle: playout, uplink and worker exit, ffmpeg dies with them | Confirmed (live run) | Q2: give up only after 5 min |
| S2 | Refused Twitch refresh token: `worker.loop.crashed` every 30 s, no heartbeat, sweep, live status, EventSub or chat; status still "connected" | Confirmed (live run) | Q3: status "error", incident "reconnect Twitch" |
| S3 / M1 | Web never retries a failed first bootstrap; `/api/health` stays 200 | Confirmed (probe) | — |
| M2 | Upgrade boot can lose a deadlock to an old container still writing; no `lock_timeout` | Confirmed (synthetic lock order) | — |
| M4 | Audit log stores stream keys verbatim; the old redaction migration does not cover new rows | Confirmed (synthetic key) | — |
| C4 | A typo in `CHANNEL_TIMEZONE` throws in every schedule read | Confirmed (throw) / Suspicion (channel dark) | — |
| W4 / H4 | Restart, Hard reload, Recover outputs, Refresh pressed during a cycle are erased by the cycle-end write | Reproduction | — |
| W2 | "Remove next" is undone by a later Skip or a passed vote | Reproduction | Q5: Remove next survives |
| W1 | A remote (YouTube/Twitch) insert never airs; the fallback flashes at every boundary | Reproduction | Q6: skip once, count as played, incident |
| W5 | Week view and worker disagree on the cuepoint asset | Confirmed | — |
| W6 | Item dropped after an input-open failure; queued Move next slips | Reproduction / Suspicion | — |
| W7 / W8 | Late exit of an abandoned ffmpeg wipes its replacement; standby slate keeps the old overlay | Confirmed (static probe) | — |
| H5 | Disk / system-volume / key-mismatch incidents never close after a restart | Suspicion / code reading | — |
| H6 | yt-dlp and six Twitch `fetch` calls without timeout use up the 300 s stall budget | Suspicion | — |
| H7 / H8 | No growing backoff; Compose ignores "unhealthy" | code reading | Q7: worker and uplink self-restart after 5 min unhealthy; playout only when its feed stalls |
| H9 | Quarantine is permanent | intended so far | Q1: re-probe once per item per 24 h |
| audit U3 / U30 / U18 / U15 | Heartbeat thresholds declared several times with different values; soak ignores uplink restarts; no CI smoke over playout → HLS → uplink | Confirmed | — |

Sound by probe: pool rotation, migrations from v1.5.17, v1.5.43, v2.0.0 and v2.1.0-rc.2 (0 catalog differences), 8
concurrent bootstraps, failure atomicity, downgrade.

### 2.2 Scheduling (R1, R3)

- Model: weekday + start minute + duration; repeat modes are expanded into one row per weekday on save. One choke point,
  `buildScheduleOccurrences`, feeds every consumer, so a date filter there reaches all of them (R1 1.1).
- Midnight cluster: C1 cuepoints twice, C2/B1 phantom Twitch segment, C3/B2 overlap check, B3 cache keep-rule, C6 double count.
- DST: wall clock stays (owner decision); fix cuepoint elapsed time, forward mapping of non-existent times and the Twitch
  segment end (R3 C5).
- Dated blocks: R1 1.3 designs the smallest additive change: `valid_from` / `valid_until` (local dates, inclusive, empty =
  unbounded), a dated layer above the weekly grid, `airWindows` so cuepoints keep the block's key, expired rows kept and
  shown as ended, a *Runs* field in the form, and "Single day" renamed. I checked the design against the code paths it
  names and found no gap; it waits only for Q1 and Q2.

### 2.3 Installation and first run (R2)

- I1 demo data counts as "Ready" and raises two critical incidents; I2 plain-HTTP sign-in loop; I3 compose default 2.0.0;
  I4 missing steps (get the files, Twitch console link, stream key); I5 wizard and guide disagree on one Twitch account; I6
  empty URL and free-text zone; I7 the owner password cannot be changed; I8 cut-off login hint.
- R2 could not run the literal `docker compose up -d` (images blocked in the cloud); it ran the same production web build
  on PostgreSQL 16 instead. `pnpm test:fresh-compose` in CI covers the compose wiring.

### 2.4 Operation (R2)

- Planning: local files have no duration, so every file counts 30 min (U4); the week view shows the same first video every
  day and overnight blocks twice (U5); the Day editor is 8 872 px of internal words (U6).
- 3 a.m.: dead worker not a problem (U7), "are now active" without a worker (U8), the important panels at y ≈ 5 700 px on a
  phone (U9), engine words and frozen "2 minutes ago" in incident text (U10), restart without confirmation (U11), Live chip
  "Checking" forever (U12).
- Wording: milestone ids in admin text (U13); the admin shows a standby text viewers never see (U14).

### 2.5 Viewers (R1, R2)

- `/channel` "After that" reads the playout queue, so a 24/7 grid says "Nothing further is scheduled yet" (V1); "Off air"
  next to "On air now" (V2); times only in the channel zone (V4); no week programme or calendar feed (R1 row B).
- Chat: `!help`, `!commands`, `!now`, `!next`, `!schedule` do nothing; a request gets no reply (V5, V6).

### 2.5a Viewer reference: GronkhTV (owner screenshots, 2026-10-02)

The owner supplied two screenshots (kept outside the repo, in the project folder `research/gronkhtv/`, because they show a
third party's site). Described by structure only; per the project rule, Stream247 takes the ideas, never texts, names or
the interface.

- **The channel's own programme panel (phone width, 657 px).** Two sections. *Now*: one card with cover image, episode
  number and title, the category (game), the time range, a "running since / remaining mm:ss" line and a progress bar.
  *Then*: a continuous list across midnight without day headers (entries from midday to the next morning). Consecutive
  episodes of the same series collapse into one card that shows only the next episode, with an expander "N more episodes".
  Each card: cover, episode title, category, start and end time.
- **The Twitch schedule of the same channel (desktop).** A week grid: one row per day (weekday + date), columns 00:00 to
  24:00 with the zone label (`GMT+2`), a marker at the current hour, buttons *Today* / previous / next week, a date picker and
  the week's date range. Each entry is a bar across its time with title and "date · start-end zone"; the live entry is
  highlighted with "live now" and the viewer count. All other days carry one generic 24/7 entry.

Conclusions for Stream247:

1. The Twitch grid is what the existing schedule sync (M88 fixes it, M93 adds dated items) already produces on Twitch. The
   public page does not need to rebuild it; it needs what Twitch cannot show: the **item level**, i.e. which video runs
   now and which come next.
2. So `/channel` gets a *Now* card with progress and remaining time, and a *Next* list of the coming items, grouped by
   block or pool with "N more", times in the viewer's zone (default R2 Q7). The 7-day overview stays, but as a compact
   list per day of blocks, not a grid.
3. The item level needs the same rotation projection as the week view (M97). M100 therefore depends on M97, and the
   projection must be the worker's own function, or the public page promises videos that will not air.
4. Covers: Stream247 has asset thumbnails for YouTube and Twitch items; local files have none today (a frame grab is a
   follow-up, not part of M100).

### 2.6 Competitors (R1 part 2)

Dated items, a public programme feed and schedule drafts are the gaps that matter (I1-I3); most advertised reliability
features Stream247 already has. Not planned in this stage, listed for later: schedule drafts with *Publish* (I3), a 7-day
coverage warning (I4), a generic outbound webhook (I5), a "starting soon" banner (I6), a periodic rerun note in chat (I7),
count-based rotation rules (I8), a month view (I11).

## 3. One plan: inventory of plan and agent files

### 3.1 Inventory

Checked on this branch (`ab42e11` + research) and on `origin/main` (`1533c7b`). The clone is shallow
(`git rev-parse --is-shallow-repository` → `true`).

| File | Size | Purpose | State (evidence) | Proposed fate |
|---|---|---|---|---|
| `AGENTS.md` | 102 lines | agent rules + DUT workflow | `:3` requires `docs/full-product-reset-audit.md`, which does not exist (deleted with `docs/archive/*` in M49, `PLANS.md:2869,2876`); `:32` "automatically continue with the next incomplete milestone" while M66 (`PLANS.md:78`) and M57 (`PLANS.md:1346`) stand "In progress" and are owner-gated; `:39-102` DUT section assumes the agent runs SSH on `/root/stream247/recovery-stack` | **rewrite** (3.3) |
| `IMPLEMENT.md` | 69 lines | runbook | `:11` the same dead reference; hard blockers `:61-69` repeat `AGENTS.md:13-19` | **merge into AGENTS.md, delete** |
| `PLANS.md` | 5 223 lines (main 4 171) | milestones + history | `AGENTS.md:3` makes every session read it; head `:3-49` is the April 2026 "Current State / Target State" against Upstream; 96 milestone rows in six tables (`grep -c "^| M" PLANS.md` → 102 including the six header rows), M16-M58 missing from the main table; 900 lines of "Progress Notes" (`:1553-2451`); two "Phase 5" headings (`:1327`, `:2452`) | **archive whole, replace by a short plan** |
| `HANDOFF.md` (main only) | 118 lines | release handoff for 2.1.0 / 2.2.0 | says of itself "Delete this file when the two releases below are out" (`:3-4`); holds rules that exist nowhere else (`:11-28`, `:96-101`, `:113-118`) | **delete after v2.2.0** (the Release thread's brief already says so); its rules move to AGENTS.md |
| `planning/next-session-prompt.md` | 121 lines | German prompt for a follow-up session | describes production on v1.5.22 (`:13`) and a local checkout path (`:7`) | **delete**; keep its still-valid traps in AGENTS.md |
| `planning/audit-2026-09-02.md` | 968 lines | code audit of v1.5.38 | R3 triaged 9 of its findings (R3 2.4); 30 remain unverified | **move to `planning/archive/`** with one follow-up line in the new plan |
| `planning/archive/product-reset-*.md` | 3 files | April 2026 reset artifacts | historical | keep, excluded from the reference check |
| `planning/research/*.md`, `planning/proposal-2026-10.md` | 4 files | this stage's research and proposal | current | keep until the milestones they feed ship, then archive |
| `release-prune-backup-20260614T000908Z/` | 9 small files | snapshot before a June tag/release prune | its own `git-status.txt` lists itself as untracked when written, so it was committed by accident; referenced nowhere else (`grep -rn release-prune-backup` outside itself and `planning/` → nothing); no secret values (the matches for "token" are the gh scope note) | **delete** |
| `package-lock.json` | 210 KB | npm lockfile | added in M64 (`git log --diff-filter=A` → `d304c8e`) next to `pnpm-lock.yaml`; the project uses pnpm (`.github/workflows/ci.yml:35`) | outside this brief; listed in section 6 |
| `.claude/launch.json` | 14 lines | dev preview config | current | keep |
| `.github/pull_request_template.md` | 18 lines | PR checklist | lists lint/typecheck/unit/integration/build, not `pnpm validate` or the baselines | add one line in M84 |
| `CLAUDE.md` | — | — | does not exist | do not create; AGENTS.md stays the single rule file |

Branches (`git ls-remote --heads origin`; `git merge-base --is-ancestor <branch> origin/main`):

| Branch | Head | In main | Status |
|---|---|---|---|
| `claude/project-thread-o8lia9` | `f122c12` | no | PR #4, waits for the owner's merge word |
| `claude/retire-program-screenshot-spec` | `76b8b58` | no | ancestor of PR #4's head; delete together with PR #4 |
| `claude/proposal-2026-10-te1vlg` | `4172d4d` | no | stopped planning thread, replaced by this proposal; holds the 81-line AGENTS.md draft M84 starts from (its `planning/proposal-2026-10.md`, section 7), so delete only after M84 has copied it |
| `claude/release-2.1-2.2-xm0ud7` | `1533c7b` | yes | Release thread, live |
| `rc2-pool-order-play-now` | `05549ee` | yes | merged M74 branch; delete |
| `review/v1.5.19-baseline` | `17cf16d` | no | base of the closed PR #2; its tree equals `743b6ec` (`git diff --quiet` → equal); delete |
| `m75-source-breaker` | `ab42e11` | no | PR #3, release train |
| `claude/r1-…`, `claude/r2-…`, `claude/r3-…`, `claude/vorschlag-…` | | no | this stage; delete once the proposal is on main |

The brief's "two claude/ branches not in main" are `claude/project-thread-o8lia9` and `claude/retire-program-screenshot-spec`
(PR #4 and its pre-merge copy). Deleting remote branches is the owner's step.

### 3.2 Target layout

- `AGENTS.md`: the only rule file, ≤ 120 lines, read in full by every session.
- `PLANS.md`: < 300 lines. One purpose line; table "Open"; table "Owner-gated and deferred" with a gate column (M66, M57 soak
  part, M77, M81); "Known follow-ups" (from `HANDOFF.md:103-111` and the "Follow-ups" blocks of M73-M82); "Shipped" index, one
  row per release with a link into the archive. New milestone sections are appended and moved to the archive when their
  release ships.
- `planning/archive/plans-m0-m83.md`: today's `PLANS.md` via `git mv`, so `git log --follow` keeps its history.
- `planning/archive/`: reset artifacts, `audit-2026-09-02.md`, and later the research files.
- Removed: `IMPLEMENT.md`, `planning/next-session-prompt.md`, `release-prune-backup-20260614T000908Z/`; `HANDOFF.md` by
  the release that ends it.
- Order: nothing before v2.2.0 is tagged. Then the proposal PR (owner's step 1), then M84 as the first milestone, so every
  later milestone thread reads the short plan.

### 3.3 What the new AGENTS.md must carry

Rules that today live only in `HANDOFF.md` or in the project instructions, made permanent:

1. Reading list: `AGENTS.md` and `PLANS.md` only.
2. A session implements exactly the milestone it was given and stops; it never continues into another milestone. Replaces
   `AGENTS.md:32,36`.
3. Owner-gated: M66 and the soak part of M57 never without the owner; M77 and M81 only on the owner's word.
4. No cloud session reaches the DUT or the Portainer host; the owner runs DUT commands, the session gives the exact command
   and waits for the output; never guess a result. The table of owner commands from `HANDOFF.md:19-25` (soak result, repin,
   DB backup, soak start, live check). Replaces `AGENTS.md:39-102`.
5. Releases: no release before the owner hands over the soak result; a soak with a failure is "passed with failure", never
   "clean"; the release commit changes `package.json`, the compose image defaults, `.env.production.example`,
   `docs/deployment.md` and the CHANGELOG section; tags only on a main commit whose push CI run is green.
6. Git: feature branches only; never force-push; never push, merge or tag `main` unless the brief says so; merge only on the
   owner's word; never resolve a PLANS.md or CHANGELOG.md conflict by deduplicating identical lines.
7. `pnpm validate` before every commit, with the decisive output line in the report; in a cloud container start `dockerd`
   first, and name the known cloud-only test failures (process-group test, ICU "GMT" tests).
8. Tests: none is deleted or weakened to get green; changed behaviour needs tests; UI text changes need the design and
   wording baselines, and a session without Docker says that CI checks them.
9. Report: German, short, result first, evidence (command + decisive line); product decisions go to the owner, each with a
   recommendation.
10. Never print or commit a secret or stream key; never change the relay pin `bluenviron/mediamtx:1.15.4`; broadcast
    channel `jimpanse247`, bot `3JakeC`, live status only on the channel.
11. Ideas from other products, never their texts, names, interfaces or code.
12. Hard blockers as today (`AGENTS.md:13-19`) plus "the next step needs the owner".

The stopped branch `claude/proposal-2026-10-te1vlg` has an 81-line draft that covers most of this; M84 can start from it and
add items 2, 7, 8 and 11.

## 4. Proposed milestones

Numbering continues after M83, the highest number on `m75-source-breaker`. Priority: **Now** = before new features, **Next**,
**Later**. Every row's acceptance includes `pnpm validate` passing (cloud runs name the three known cloud-only failures) and
docs updated; it is not repeated per row. Test file names are proposals. Rows that change what viewers see re-record the
design and wording baselines. Each row is one commit, rollback = revert that commit, unless the row says otherwise.

| Milestone | Type | Priority | Status | Goal | Acceptance | Touched Areas | Risk | Rollback |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| M84 One Plan And A Reference Check | Docs + Ops | Now | Proposed | One short plan, one rule file, history archived, and no doc can point at a missing file | `wc -l < PLANS.md` < 300; `wc -l < AGENTS.md` ≤ 120; `test ! -e IMPLEMENT.md && test ! -e planning/next-session-prompt.md && ! ls -d release-prune-backup-*`; `git log --follow --oneline planning/archive/plans-m0-m83.md \| wc -l` > 1; the new PLANS.md lists M57, M66, M77, M81 under "Owner-gated and deferred"; `grep -c "recovery-stack\|full-product-reset-audit\|automatically continue" AGENTS.md` = 0; each of the 12 items of 3.3 is found by a keyword grep on AGENTS.md (`jimpanse247`, `mediamtx:1.15.4`, `passed with failure`, `its own milestone`, `M66`, `M77`, `force`, `pnpm validate`, `deleted or weakened`, `German`, `texts, names`, `Hard blockers`), each ≥ 1; new `tests/unit/doc-refs.test.ts` fails on a backticked repo path in `AGENTS.md`, `PLANS.md`, `README.md`, `CONTRIBUTING.md` or `docs/*.md` that does not exist (mutation: adding `` `docs/nope.md` `` to AGENTS.md turns it red) and is green on the tree (fixes `docs/architecture.md:331`) | `AGENTS.md`, `PLANS.md`, `IMPLEMENT.md`, `planning/**`, `release-prune-backup-*`, `docs/architecture.md`, `.github/pull_request_template.md`, `tests/unit/` | low; losing an open follow-up is the risk, checked by comparing the old open rows and follow-up blocks with the new plan | revert the commit |
| M85 Safe Configuration And Secrets | Reliability + Security | Now | Proposed | A stream key never stays in the audit log, and a zone typo never breaks the schedule | M4: `appendAuditEvent` redacts like `upsertIncident`; a new migration id redacts existing `audit_events` rows; integration test: a synthetic `rtmp://…/live_…` key written through `appendAuditEvent` and one seeded before the migration both read back as `<redacted>`. C4: `resolveChannelTimeZone({}, {CHANNEL_TIMEZONE:"Europe/Berln"})` returns the managed zone or `UTC` and a state incident is raised; unit test. M5: the `custom_layers_json` cast is guarded; integration test boots a DB with one malformed row | `packages/db`, `apps/worker`, tests, `docs/operations.md` | low; the redaction migration is one-way (it removes secrets on purpose) | revert the commit; redacted rows stay redacted |
| M86 A Database Blip Does Not Take The Channel Off Air | Reliability | Now | Proposed | A Postgres restart or short outage leaves ffmpeg and the uplink running; web recovers by itself | H2: the failed-cycle branch is guarded; a process exits only after 5 min of consecutive failed cycles (owner Q2); pool `connectionTimeoutMillis` set. Unit test of a pure counter (below 5 min no exit, at 5 min exit). H3: a rejected `__stream247DbReady` is cleared; retry on `40P01`/`55P03`; migrations run with `SET LOCAL lock_timeout`; integration test: `ensureDatabase` fails with Postgres down, succeeds after Postgres starts, no reset helper called. R3's S1 probe (appendix of `planning/research/robustness.md`) becomes an integration test: Postgres stopped for 45 s, the worker process in all three modes is still running afterwards. DUT check (owner): `docker compose stop postgres; sleep 45; docker compose start postgres` during air, playout and uplink `StartedAt` unchanged | `apps/worker`, `packages/db`, `apps/web/lib/server`, tests, `docs/operations.md` | medium: a half-dead process for at most 5 min | revert the commit |
| M87 An External Failure Costs One Step, Not The Cycle | Reliability | Now | Proposed | A refused Twitch token or a hanging call never stops heartbeat, sweep, live status or chat | H1: each integration step of the worker cycle is isolated; a refresh throw writes `twitch.refresh.failed`; HTTP 400 `invalid_grant` sets the identity status `error` with a state incident "reconnect Twitch" (owner Q3). H6: yt-dlp calls get `timeoutMs`, the six worker `fetch` calls `AbortSignal.timeout`. Tests: refresh throws → heartbeat written, sweep ran, no `worker.loop.crashed`; `invalid_grant` → status `error`; a fetch stub that never answers is aborted within its timeout. R3's S2 probe becomes an integration test: with the token endpoint stubbed to HTTP 400, `healthcheck worker` exits 0 after two cycles | `apps/worker`, `packages/core`, tests, `docs/operations.md` | low | revert the commit |
| M88 Schedule Maths Across Midnight | Bug | Now | Proposed | A block past midnight behaves like one block everywhere | C1: fired cuepoints keyed by block and start date; test: Sat 23:00+120 with cuepoints at 900 s and 2700 s, at 00:05 `getCuepointInsertPlan` returns null. C2/B1: no carry-over segments in the Twitch plan, extracted as pure `planTwitchScheduleSegments`, each created segment recorded before the next request; test: Monday 23:00+120 over 7 days gives 1 segment, no `:carry` key. C3/B2: overlap on a 7-day minute line; test: Mon 23:00+120 vs Mon 00:00+30 → `[]`, vs Tue 00:00+30 → both ids (the probe in 1.1 shows today's opposite); `tests/unit/schedule-template-conflicts.test.ts:62-68` pins today's wrong model (both blocks on weekday 1); its fixture moves to weekday 1 + 2, it still asserts the conflict and gains the false-positive case, so it is strengthened, not weakened (the owner is told in the report). B3: keep-rule uses the effective start; test with horizon 60 at Tue 00:30 returns the pool. C6: day totals count only the part inside the day; test: 120 + 120 = 240 over two days becomes 60 + 60. Owner decision 2026-10-02 11:35 UTC: R1's three corrections reach main only with M88 and stay on `claude/r1-scheduling-competitors-v5o5zi` until then; M88 takes them over from that branch at `97f4037`: the bare "GMT" zone name (`d789981`), the week lens counting a midnight block once with its fill pill inside the card (`7891a85`, covers C6), `/channel` "After that" from the schedule (`a41d327`, `51e69ee`, covers V1, which then leaves M100) and their re-recorded baselines (`81f0eb6`); their tests pass unchanged in M88 | `packages/core`, `apps/worker`, tests, `docs/operations.md` | low; hidden overlaps in saved schedules show up in the editor, saved schedules stay loadable (test) | revert the commit |
| M89 Operator Actions Are Never Lost | Behavior | Now | Proposed | Restart, Hard reload, Recover outputs, Refresh and Remove next do what the operator pressed | H4: pure `decideCycleEndRestartFlag` (same value → clear, newer → keep, reconnect window → keep) and the same for `pendingAction` and `insertAssetId`; table test. W2: a separate Remove-next hold that Skip and passed votes do not overwrite (owner Q5); test: B on air, C removed, passed vote on B → next is D. R3's W2 and W4 probes become tests. DUT check (owner): a Restart pressed during a cycle restarts, in direct and relay mode, as `PLANS.md:4569-4573` asks | `apps/worker`, `apps/web`, `packages/db` (additive column), tests, `docs/operations.md` | medium: direct-mode reconnect reuses the field | revert the commit; the additive column stays unused |
| M90 The 3 A.M. Answer | UX + Reliability | Next | Proposed | A tired operator sees what is wrong and what to press, first | U7: a stale or missing worker or playout heartbeat is the first "Open problems" entry with its age in words and the restart command; unit test. U8: the status sentence follows the heartbeats; `grep -rn "are now active" apps/web` → no output. U10: incident messages store no relative time (test on the writer); engine fields behind "Details" (`grep -rn "ready not ready" apps/web` → no output). U11: all three interrupting actions of "If something is stuck" confirm, Soft restart, Force reconnect and Hard reload (`apps/web/components/playout-action-form.tsx:97,105,128`; in direct mode Force reconnect drops the uplink); component test per button. Every critical incident fingerprint maps to one operator action in a catalogue (`IncidentRecord` has no such field today, `packages/db/src/index.ts:399-412`); a unit test collects all `fingerprint:` literals in `apps/worker/src` and fails on a critical one without an action; the crash-loop text no longer says only "Manual intervention is required" (`apps/worker/src/index.ts:7486`). U12: render test: without a connected bot account the Live chip reads "Not connected to Twitch", never "Checking". audit U3/U30: one heartbeat constant and one effective-heartbeat function used by state, readiness and worker; test that a 50 s old heartbeat gives the same verdict everywhere. U9 (default R2 Q4 in 5.2): Playwright at 390 px, "Open problems" above y = 1 400 | `apps/web`, `apps/worker`, `packages/core`, tests, baselines, `docs/ui.md` | low | revert the commit |
| M91 Honest First Run | UX + Data | Next | Proposed | A fresh install starts empty, readiness counts only what can air, and plain HTTP is explained | I1 (decided 5.1 Q5): an empty DB bootstraps with no pool, no schedule block and no URL-less source (unit test on `createInitialSeedState`); existing installs keep their rows (integration test); readiness: a pool is ready only when a block uses it and it has a ready asset, the schedule only when the coming week has no unplayable block (`tests/unit/onboarding*.test.ts`). I2 (decided 5.1 Q6): over `http:` on a host other than `localhost`/`127.0.0.1`, `/setup` and `/login` show the two ways out; render test. I6: component test: the URL field is prefilled with the request origin and the zone field with the browser zone. I7: render test of the password warning under the field plus, per decided 5.1 Q8, a change-password form under Admin → Settings → Security that requires the current password (API test: wrong current password refused, right one changes it) and a one-line container command for a reset documented in `docs/operations.md` (integration test: the reset entry point run against a test database sets a new password and sign-in with it succeeds); no e-mail reset. I8: render test: the login hint has no line clamp and, without Twitch app credentials, contains "Twitch app credentials" and the link to `/setup` step 3 | `packages/db` seed, `apps/web`, tests, baselines, `docs/getting-started.md` | low: only `isDatabaseEmpty` installs change | revert the commit |
| M92 Getting Started A Stranger Can Follow | Docs + Ops | Next | Proposed | The guide leads a stranger from an empty host to air without a gap | I4: `docs/getting-started.md` gets "Get the files" (clone a release tag, or download `docker-compose.yml` and `docker/mediamtx.yml`), the link `https://dev.twitch.tv/console/apps` (also in wizard step 3) and a numbered stream-key step; `grep -c "dev.twitch.tv/console" docs/getting-started.md` ≥ 1. I3: unit test that the four compose image defaults equal the newest non-rc `## X.Y.Z` heading in `CHANGELOG.md`, so a release commit that forgets them fails. I5: the same one-or-two-accounts sentence in wizard and guide (decided 5.1 Q9). `pnpm test:fresh-compose` green | `docs/`, `apps/web/app/setup`, `tests/unit/`, `README.md` | low | revert the commit |
| M93 Dated And One-Off Schedule Blocks | Feature | Next | Proposed | "The next 10 days at 20:00 this playlist" and "once on 10 Oct" can be saved on a 24/7 grid, and air, previews, `/channel` and Twitch agree | R1 row A (decided 5.1 Q1, Q2): `valid_from`/`valid_until` in baseline, ALTER, migration, manifest, mapper, writers and blueprints; filter in `buildScheduleOccurrences`; dated layer ranks first in `findCurrentScheduleOccurrence`; `applyScheduleLayers` with `airWindows`; conflicts per layer; ended rows listed as ended; form field *Runs*; "Single day" renamed to "One weekday, every week". Tests: a 10-day run has day 10 and not day 11; a once-block airs once; a carry-over past `valid_until` still ends; weekly 18-22 + dated 20-21 gives three windows with one key; a cuepoint is not re-fired; the 24/7 grid + dated 20:00 block saves (today `["grid","special"]`); schema-manifest and DB round-trip tests | `packages/core`, `packages/db`, `apps/web`, `apps/worker`, tests, baselines, `docs/` | medium: touches the one function every schedule consumer uses; additive columns | revert the commit; old images ignore the columns |
| M94 Inserts From Remote Sources Air | Bug | Next | Proposed | A YouTube or Twitch insert airs, or is skipped once with an incident, never retried forever | W1: the due insert is warmed in the queue scan; a failed or bridged insert counts as consumed and raises an incident naming it (owner Q6); both insert checks apply quarantine and breaker. W5: one shared "cuepoint asset of a block" helper used by worker and preview; test: `insertEveryItems: 0` with a pool insert asset gives the same cuepoint count in both. W6: an item that failed to open is retried once; `failed` treated like an empty current item in the Move next and insert checks. R3's W1 probe becomes a test | `apps/worker`, `packages/core`, tests | low–medium: crash-loop interplay | revert the commit |
| M95 Self-Healing Fills The Gaps | Reliability | Next | Proposed | No stale incident, no orphan encoder, no permanently lost item | H5: disk and system-volume flags re-armed from open incidents on the first cycle; `secrets.key-mismatch` resolved at a boot where every secret decrypts; tests. W7: the playout exit handler returns when the exiting child is not current (static test as R3's); the uplink handler checked for the same pattern. H9: one re-probe per quarantined item per 24 h, one per source per cycle, only with the breaker closed and no outage verdict (owner Q1); test. U18: `scripts/soak-monitor.sh` counts uplink and relay restarts; shell test or `bash -n` plus a fixture run | `apps/worker`, `scripts/`, tests, `docs/operations.md` | low | revert the commit |
| M96 Local File Durations | Data | Next | Proposed | Local-library assets carry their real length, so planning numbers are right | U4: `ffprobe` duration at scan time, bounded timeout, cached by size + mtime; unit test on a generated 2-minute file → `durationSeconds` within 1 s of 120; an unchanged file is not probed again (spy); Day lens shows "Unique library: 6m" for three such files | `apps/worker`, `packages/db`, tests | medium: a large first scan is slower, so probing is incremental | revert the commit; stored durations are harmless to old images |
| M97 Week View Tells The Truth | UX | Next | Proposed | The week view shows what will play, with dates, overnight blocks once, and why a block repeats | U5: each pool's rotation carried across blocks in time order through the worker's rotation function (shared, not copied); dates on day headers; hours, not minutes; an overnight block shown once with "→ 01:00 Sun"; repeat reason with numbers. U6: confirmation before "Replace existing schedule blocks"; "Edit block" and "Add block" on the week view. Tests in `program-week-projection`: three items, two blocks, the second block starts with item 2, not item 1; a 24 h block reads "24 h"; a block with 6 min of video in 24 h carries the reason "plays ≈ 240 times"; an overnight block appears on one day only. e2e: "Replace existing schedule blocks" opens a confirmation and Cancel leaves the blocks unchanged | `packages/core`, `apps/web`, tests, baselines | medium: preview must not drift from the worker, so one shared function | revert the commit |
| M98 The Production Path Has A Smoke | Test | Next | Proposed | CI exercises playout → HLS → uplink with the relay on | U15: a CI job starts the stack with the relay on and asserts that `program.m3u8` MEDIA-SEQUENCE grows and the uplink output grows over 60 s; the job fails when the uplink is stopped (mutation run) | `.github/workflows/ci.yml`, `scripts/`, `docker-compose*.yml` | low (CI only) | revert the commit |
| M99 Wizard To First Programme | UX | Later | Proposed | `/setup` ends with a stream key and a playing week | U1 (decided 5.1 Q9): skippable step "Where the stream goes" with the Twitch preset, the key stored encrypted and masked; the destination form moves to Studio → Output, the old anchor redirects. U2: skippable step "First programme" creates a pool from chosen media and applies the "Always-on single pool" template. R2 U3: render test: an empty library says how to add media, a filtered-empty library says the filters hide everything. e2e: a fresh owner completes both steps and readiness shows destination, pools and schedule ready | `apps/web`, tests, baselines, `docs/getting-started.md` | medium: moves a form operators know | revert the commit |
| M100 Public Programme For Viewers | Feature | Later | Proposed | Viewers see what comes next and the coming week, in their own time | V1: "After that" filled from the schedule (next 3-5 blocks); test "after that lists upcoming schedule blocks when the queue is empty". V2: "Scheduled now" when playout is down. R1 row B: a 7-day list on `/channel` per day, dated items marked; `/channel.ics` validated by a parser test; times per default R2 Q7 in 5.2 (viewer's zone first; unit test with a browser zone other than the channel zone). Layout per 2.5a: a *Now* card with progress bar and remaining time (unit test on the remaining-time and progress values for a fixed clock), a *Next* list of the next 24 h at item level from the shared week projection, consecutive items of one block grouped with "N more" (test: 3 blocks × 5 items give 3 groups with "4 more" each), crossing midnight without a break (test); Playwright at 390 px: the *Now* card is above the fold. R2 V7: the on-air Next card adds "in N min" to its bare time range (`packages/core/src/viewer-messages/en.ts:29`) through the catalogue, en + de, unit test for a fixed clock. Catalogue parity en/de green | `apps/web`, `packages/core`, tests, baselines, `docs/` | low | revert the commit |
| M101 Schedule Across DST, Wall Clock Kept | Bug | Later | Proposed | Twice a year the counts are right while blocks keep their wall-clock times (owner Q4) | C5: cuepoint elapsed time from real instants (test: block from 01:00, at 03:30 local on 2027-03-28 reports 5 400 s, not 9 000 s); a non-existent local time maps forward (02:30 on 2026-03-29 → `01:30Z`, not `00:30Z`); the Twitch segment end follows real minutes; `docs/operations.md` states the wall-clock rule (skipped in March, twice in October) | `packages/core`, `apps/worker`, tests, docs | low | revert the commit |
| M102 Standby Shows Standby | Bug | Later | Proposed | The standby or reconnect slate never shows the previous item's title | W8: `writeStandbySlate` sets the standby scene payload; unit test on the payload; a design-baseline check of the standby frame | `apps/worker`, tests, baselines | medium: changes the on-air picture | revert the commit |
| M103 Backoff And Health Restarts | Reliability | Later | Proposed | Repeated restarts slow down; a hung worker or uplink restarts itself | H7: growing backoff up to 5 min for the crash-loop reset and the uplink watchdog; the crash-loop incident no longer says "Manual intervention is required" when playable media exists (unit test on the message). H8 (owner Q7): worker and uplink exit after 5 min of failing their own healthcheck; playout only while its feed does not advance. Tests: backoff sequence; a playing playout with an advancing feed never exits | `apps/worker`, `docker-compose.yml`, tests, docs | medium: dark time grows with backoff; a wrong rule could restart a playing channel | revert the commit |
| M104 Wording Pass And Chat Answers | UX | Later | Proposed | Admin text names no milestone ids; viewers can ask the bot | U13: render test fails on `\bM\d{2}\b` in admin text. U14: the admin preview and (i) show the localized standby text. S19 (lead from the stopped planning branch, re-checked): overlay output is one checkbox among many (`apps/web/components/overlay-settings-form.tsx:890`) and the Scene tab shows "unknown" / "never" before a first publish; Scene gets an on/off banner at the top and "Not published yet"; render test. V5/V6 (decided 5.1 Q7): `!commands` (only enabled commands), `!now`, `!next` with the `/channel` link, one reply per `!request` (queued with position, no match, cooldown, queue full), each with its own switch, 60 s per viewer and 10 s global cooldown, en + de; unit tests per reply | `apps/web`, `apps/worker`, `packages/core`, tests, baselines | medium: chat volume and Twitch rate limits | revert the commit |

**Not planned, mentioned only:** M66 Live Bridge rehearsal and the soak part of M57 (owner-gated, never without the owner);
M77 resume an interrupted item and M81 admin interface language (deferred until the owner says so). M94's retry of an item
that never started is not M77 (R3 W6). Also not in this stage: competitor ideas I3-I8 and I11 (2.6), extending the schema
drift check to indexes and types (R3 M3), the 30 untriaged audit findings, the mobile on-call order beyond M90's check.

**Dependencies:** M84 first. M88 before M93 (both touch occurrences). M93 and M97 before M100 (dated items and the item-level projection on `/channel`) and before
competitor idea I6. M91 before M99. Everything else is independent and may be reordered by the owner.

## 5. Questions to the owner

### 5.1 Ten questions, each with a recommendation

**Decided 2026-10-01 23:34 UTC:** the owner accepted every recommendation below and in 5.2 ("Alles was du empfiehlst"),
answered Q4 with "jimpanse247 is an affiliate" (so the non-recurring Twitch segments of M88 and M93 work for the channel),
and asked that the GronkhTV screenshots for Q3 be made by Claude. The cloud cannot reach gronkh.tv or twitch.tv
(`page.goto: net::ERR_TUNNEL_CONNECTION_FAILED`, re-run 23:36 UTC), and the session on the owner's device was declined (23:42 UTC).
On 2026-10-02 10:22 UTC the owner supplied the two screenshots himself and confirmed again "Alles was du empfiehlst"; the reference is in 2.5a and M100.

1. **Dated blocks over the weekly grid.** May a dated block take over the weekly block it overlaps, with the weekly block
   continuing around it? *Recommendation: yes; otherwise "every evening at 20:00" can never be saved on a 24/7 channel (probe
   in 1.1).* (R1 Q1)
2. **After a dated run.** Keep ended blocks listed (greyed, "ended 10 Oct", reusable) until deleted by hand, and let the
   playlist continue where it stopped the evening before? *Recommendation: yes to both; no cleanup job, and ten evenings of
   different content.* (R1 Q2, Q3)
3. **GronkhTV.** gronkh.tv and twitch.tv are blocked from the cloud. Can you put two screenshots in `/mnt/project-files`
   (the gronkh.tv Sendeplan and twitch.tv/gronkhtv/schedule)? *Recommendation: yes; only M100's layout waits for them.* (R1 Q4)
4. **Is jimpanse247 a Twitch affiliate or partner?** Non-recurring schedule segments need it. Check: open
   `https://www.twitch.tv/jimpanse247/schedule`, or look for the sync error under Admin → Settings → Twitch accounts.
   *Recommendation: if not, keep the sync as is and build no recurring-segment variant.* (R1 Q5)
5. **Fresh installs without demo data?** *Recommendation: yes; start empty except the local library source; existing
   installs keep their rows.* (R2 Q1)
6. **Plain HTTP on the home network.** Only a clear message, cookies stay `Secure`? *Recommendation: yes, message only; no
   insecure mode, because a sniffed session is the owner role.* (R2 Q2)
7. **May the bot write more in chat** (`!commands`, `!now`, `!next`, request replies)? *Recommendation: yes, each with its own
   switch, 60 s per viewer, 10 s global cooldown.* (R2 Q3)
8. **Owner password change and reset.** *Recommendation: a change form under Admin → Settings → Security (current password
   required) and a documented one-line container command for a reset; no e-mail reset.* (R2 Q5)
9. **Wizard: stream key and one Twitch account.** Ask for the stream key in a skippable wizard step, and allow one account for
   bot and channel while recommending two, with the same sentence in wizard and guide? *Recommendation: yes to both.*
   (R2 Q8, Q6)
10. **Plan restructure (M84).** Archive the whole current `PLANS.md` as one file, rewrite `AGENTS.md` with the 12 items of
    3.3 (including "a session stops after its own milestone"), merge PR #4 before M84 so its 16 PLANS.md lines do not
    conflict with the archive move, and delete the finished remote branches yourself (`rc2-pool-order-play-now`, `review/v1.5.19-baseline` now; `claude/proposal-2026-10-te1vlg` after M84; `claude/retire-program-screenshot-spec` with PR #4; `claude/release-2.1-2.2-xm0ud7` after v2.2.0; the three research branches and `claude/vorschlag-2026-10-6a60z9` once the proposal is on main)? *Recommendation: yes.*

**Decided 2026-10-02 11:35 UTC (coordinator's card):** R1's three corrections do not go to main as their own pull request
before M84; they come with M88 and stay on `claude/r1-scheduling-competitors-v5o5zi` until then (see the M88 row).

### 5.2 Defaults taken unless you object

These open research questions are routine enough to proceed with the recommendation:

- **R2 Q4 mobile:** `docs/ui.md` stops calling mobile a non-goal for Live → Control and Status only (M90's 390 px check).
- **R2 Q7 time on `/channel`:** the viewer's local time first, the channel zone second (M100).
- **R1 Q6 DST:** closed by your R3 Q4 decision (M101).
- **R1 Q7 order:** replaced by the order in section 4.

## 6. Outside this brief (noted, not changed)

- `package-lock.json` (210 KB, added in M64 `d304c8e`) sits next to `pnpm-lock.yaml`, and CI installs with
  `pnpm install --frozen-lockfile=false` (`.github/workflows/ci.yml:42`), so CI does not catch a lockfile drift. Suspicion
  that the npm lockfile is unused; worth one line in M84 or its own small change.
- Two unit tests assert an ICU-dependent zone name (`tests/unit/viewer-messages.test.ts:115`, `tests/unit/ops-state.test.ts:719`);
  they would turn CI red without a code change if `node-version: 22` moved to an ICU 77 build (R1, R3 O2).
- The design baselines lag the code in wording (R2 D); the 1 % pixel tolerance hides it.

## 7. What I could not check

- Nothing on the DUT or Portainer host; S1 and S2 are R3's live runs in the cloud, not production.
- Twitch and GronkhTV (blocked by the proxy): the C2 follow-on, the affiliate status, the schedule reference.
- I did not re-run R2's browser walk or R3's live harnesses and reproductions; I re-checked their code basis (1.3, 1.4).
- Competitor pages only through WebFetch digests; I read two of R1's sixteen URLs myself.
- `pnpm validate` on this branch (Markdown only) stops at the three known cloud-only unit failures:
  `Tests  3 failed | 2612 passed (2615)` (`process-utils` process-group test, and the two ICU "GMT" zone-name tests in
  `ops-state.test.ts` and `viewer-messages.test.ts`). Run one by one: `pnpm lint` and `pnpm typecheck` exit 0,
  `pnpm test:integration` → `Tests  63 passed (63)`, `pnpm build` exit 0. CI is not run (no pull request, per the brief).
