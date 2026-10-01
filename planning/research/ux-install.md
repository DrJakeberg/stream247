# Research R2 — Operation and installation (2026-10-01)

Scope: walk Stream247 as a streamer (first setup, plan a week, understand a fault at 3 a.m.) and as a
viewer (`/channel`, the on-air picture, chat commands), and follow `docs/getting-started.md` as a
stranger would. Base: branch `m75-source-breaker` at `ab42e11` (the coming 2.2.0). Nothing was fixed;
no product code, `PLANS.md` or `CHANGELOG.md` was touched.

Labels used below:

- **Bug (shown)** — reproduced by a command or a browser run whose output is quoted.
- **Gap (shown)** — the behaviour is real and shown the same way, but it is missing function or
  misleading text rather than broken code.
- **Suspicion** — read in code or docs only; not reproduced.

Effort: S = up to half a day, M = 1–3 days, L = more. Risk = risk of the change, not of the problem.

## Top five

1. **A fresh install is "Ready" with demo data the operator never created, and turns red within
   two minutes** (I1). Three placeholder sources without URLs, one pool and two schedule blocks are
   seeded into every empty database; the readiness checklist counts them as "Ready", and the first
   worker cycles raise two **critical** incidents for them.
2. **Plain HTTP from another machine: the owner is created, then every sign-in silently bounces to
   `/login`** (I2). That is the default home-server path (`docker compose up -d`, open
   `http://<server-ip>:3000`). The UI says nothing; only the docs mention it.
3. **A dead worker is not a problem in the UI** (U7). With the worker stopped for more than four
   minutes, "Open problems" still lists only the source incidents, the rail shows a raw ISO
   timestamp, and "stale" appears in the last panel of the page (y ≈ 6 100 px of 6 256 px on a phone).
   With no incidents the status page even says the worker "is now active" (U8).
4. **Planning with local files is off by a factor of fifteen** (U4). Local-library assets carry no
   duration, so every file counts as 30 minutes: three 2-minute files show as "Unique library: 90m"
   and the week preview plays the same first video every day (U3).
5. **The install docs lead a stranger to the wrong version and leave out two steps** (I3, I4).
   `docker-compose.yml` defaults to the `v2.0.0` images on main and on the 2.2.0 branch, whose wizard
   has no channel-language step that the guide describes; the guide never says how to get the
   compose file, and never has a step for the stream key, which `broadcastReady` needs.

## Method and environment

- **Docker could not run a Stream247 stack in this cloud container.** `dockerd` started, but the
  GHCR image blobs are refused by the network policy
  (`pkg-containers.githubusercontent.com … Forbidden`), the Dockerfiles' base image comes from
  `public.ecr.aws` whose CDN is refused too, and with `node:22-alpine` from Docker Hub retagged
  locally the build stops at `apk add` (`dl-cdn.alpinelinux.org … TLS: server certificate not
  trusted`). Docker Hub itself answered `429 Too Many Requests` several times before
  `postgres:16-alpine` and `bluenviron/mediamtx:1.15.4` pulled. So neither the literal
  `docker compose up -d` from `docs/getting-started.md` nor `scripts/dev-stack.sh` (which needs
  locally built `stream247-web:test`/`stream247-worker:test`) could run.
- **Substitute, closest to a fresh stack:** `pnpm build` of the branch, then the production web
  server (`NODE_ENV=production pnpm start` in `apps/web`, the same Next build the image ships) against
  an empty PostgreSQL 16 database, with **no `.env`, no `APP_SECRET`** and `MEDIA_LIBRARY_ROOT` on an
  empty directory — the "no `.env`" path of getting-started §3. The secret generated itself
  (`.stream247-app-secret`, mode `-rw-------`). Later the worker ran from `apps/worker/dist` against
  the same database. Playout, uplink and relay did not run, so the on-air picture is judged from code.
- **Browser:** Playwright (Chromium) scripts drove `/setup`, every workspace tab, `/login` and
  `/channel` at 1440 px and 390 px, captured text and full-page screenshots, and measured positions.
- **Also read:** the 28 design baselines in `tests/e2e/design-baseline.spec.ts-snapshots/`,
  `docs/ui.md`, `docs/getting-started.md`, `README.md` (Quick Start), the setup, onboarding, schedule,
  control-room, public-page and chat code.
- **Leads:** the earlier partial proposal on `claude/proposal-2026-10-te1vlg` (section 3). Each lead
  used here was re-checked; the table at the end says which.

## A. Installation (following `docs/getting-started.md`)

| # | Where | Finding | Evidence | Proposal | Effort | Risk |
|---|---|---|---|---|---|---|
| I1 | `/setup` step 5, `Live → Status` Readiness, `Live → Control` | **Bug (shown). Demo data is seeded into every new install and readiness counts it as done; it raises critical incidents.** After creating only the owner and the public URL, the checklist reads "Content sources · Ready · 3 source(s) configured", "Program pools · Ready · 1 pool(s)", "Weekly schedule · Ready · 2 schedule block(s)". The database holds `source-youtube` / `source-twitch` with empty `external_url`, `pool-archive`, and blocks "Morning Twitch VOD Rotation" (Mon 06:00, 4 h) and "Prime Time YouTube Playlist" (Fri 18:00, 6 h). Two minutes after the worker starts: `CRITICAL · source · Twitch Archive has stopped delivering` and the same for "YouTube Playlist", shown in the rail of every page. | Browser text of `/setup?step=done` and `/live?tab=control`; `psql … select id,name,external_url from sources` → 3 rows, URLs empty; `select fingerprint,severity from incidents` → `source.twitch-vod.source-twitch critical`, `source.youtube-playlist.source-youtube critical`. Seed: `packages/db/src/index.ts:2054-2130`, applied on an empty database at `:5944-5947`. Readiness counts rows only: `apps/web/lib/server/onboarding.ts:41-43,147-172`. | Start empty (keep the local-library source, which the worker manages anyway). Readiness counts only what can play: a pool is ready when a block uses it and it has a ready asset; the schedule is ready when the coming week has no unplayable block (the Week view already computes "Unresolved blocks"). Existing installs keep their rows. | S | low — only `isDatabaseEmpty` installs change; a test pins the empty seed |
| I2 | `/setup` → `/login` over `http://<lan-ip>:3000` | **Bug (shown). Over plain HTTP from another machine the owner is created and then nobody can sign in, without a word.** Fresh database, browser on `http://192.0.2.2:3001/`: `landing: …/setup`, owner created, `after create: http://192.0.2.2:3001/login`; signing in with the right password on the other instance: `URL after sign-in: http://192.0.2.2:3000/login`. The page shows no error. | Playwright runs `lanowner.mjs`, `loginip.mjs` (output above). Cause: session cookie `secure: process.env.NODE_ENV === "production"` (`apps/web/lib/server/auth.ts:158`), which browsers drop on `http://` except `localhost`. The trap is only in prose: getting-started §4, README Quick Start step 5. | Detect it and say it on `/setup` and `/login`: when the page is served over `http:` on a host that is not `localhost`/`127.0.0.1`, show one sentence with the two ways out (HTTPS via the `proxy` profile, or an SSH tunnel to `localhost:3000`). Product question Q2 decides whether a deliberate insecure mode is offered. | S | low |
| I3 | `docker-compose.yml`, getting-started §4 | **Gap (shown). The compose file installs 2.0.0, and the guide describes 2.2.0.** `image: ${STREAM247_WEB_IMAGE:-ghcr.io/drjakeberg/stream247-web:v2.0.0}` on `origin/main` and on `m75-source-breaker` (all three app images). `git show v2.0.0:apps/web/app/setup/page.tsx \| grep -c -i language` → `0`, while getting-started §4 names "Instance basics (public URL, time zone, channel language)". No release script rewrites the default (grep for `stream247-web:v` in `scripts/`, `.github/workflows/` finds nothing). | `docker-compose.yml:39,79,118,143`; `docs/deployment.md:173` | Make the default tag part of the release commit, with a unit test that the compose defaults equal `package.json`'s version on a release commit (or a preflight check). The Release thread owns the actual bump; nothing here changes main. | S | low |
| I4 | getting-started §0, §2, §5–§7 | **Gap (shown). Three steps a stranger needs are missing from the guide.** (a) How to get the compose file: no `git clone` or download in getting-started, README Quick Start or `docs/deployment.md` (`grep -n -i clone` → only unrelated hits); the stack also needs `docker/mediamtx.yml`. (b) The Twitch developer console has no link anywhere (`grep dev.twitch.tv` in docs, setup page and setup forms → nothing). (c) The stream key has no step: it appears only in the §3 variable table, and §5 says `broadcastReady` needs "a destination … (sections 6 and 7)", but §6 is media and §7 is programme. | `docs/getting-started.md:33,79,166-167`; `apps/web/app/setup/page.tsx:132`; `apps/web/components/setup-twitch-app-form.tsx:43` | Add §0 "Get the files" (clone a release tag, or download the compose file and `docker/mediamtx.yml`), a link to `https://dev.twitch.tv/console/apps` in the guide and in wizard step 3, and a numbered step "Stream key" pointing at the destination form (and see U1). | S | low (docs) |
| I5 | `/setup` step 4 vs getting-started §1 | **Gap (shown). Wizard and guide disagree on the one-account setup.** Wizard: "Stream247 works with two Twitch accounts, which may be the same one". Guide: "Do not run the app as the broadcast channel to 'make it simpler'". | `apps/web/app/setup/page.tsx:170`; `docs/getting-started.md:26` | One sentence, the same in both places. Product question Q6. | S | low |
| I6 | `/setup` step 2 | **Gap (shown). The public URL starts empty and the time zone is free text.** The wizard is open in a browser at `http://localhost:3000`, but "Public app URL" is empty; "Channel timezone" is a text field (placeholder "UTC"). A wrong value is caught ("\"Berlin\" is not a usable IANA timezone name"), but the user must know IANA names. The step summary says "Set the public URL and the channel timezone" and omits the language that the step also sets. | Browser run `step2.mjs`; `apps/web/components/setup-instance-form.tsx:18,60,75`; `apps/web/app/setup/page.tsx` step list | Prefill the URL from the request origin (marked "detected, check it"); a searchable zone list prefilled from the browser (`Intl.DateTimeFormat().resolvedOptions().timeZone`); add "language" to the summary. | S | low |
| I7 | `/setup` step 1, `Admin → Settings → Security` | **Gap (shown). The owner password can never be changed or reset in the product**, and the wizard does not say so. Settings → Security offers only 2FA ("CURRENT PASSWORD · Start two-factor setup"); `apps/web/app/api/auth/` has `2fa`, `login`, `logout`, `twitch` only. The warning exists only in getting-started §4. | Browser text of `/admin?tab=settings`; `ls apps/web/app/api/auth/` | Short term: one line under the password field ("cannot be changed later — store it"). Product question Q5 for a change-password form and a documented CLI reset. | S / M | low / medium |
| I8 | `/login` (390 px and 1440 px) | **Gap (shown). The Twitch sign-in hint is cut off mid-sentence and names `APP_URL`, a word the wizard never uses.** "…if the streamer has…", "…either in `.env` or…". It also says "Configure APP_URL" although the URL was set in the wizard (the actual missing part was the Twitch client credentials). | Screenshot `anon-_login.png`; `apps/web/components/twitch-login-panel.tsx` | Do not clamp instructions; say exactly what is missing ("Twitch app credentials are not saved yet — `/setup` step 3"). Rename "LOCAL BOOTSTRAP" to "Owner sign-in". | S | low |

## B. Operation — streamer

### B1. First setup

| # | Page | Finding | Evidence | Proposal | Effort | Risk |
|---|---|---|---|---|---|---|
| U1 | `Live → Status` "Output destinations" | **Gap (shown). The stream key is entered in a tab that calls itself read-only.** The status page holds the "Add output / RTMP URL / STREAM KEY" form and two pre-made destinations, and in the same view says "This status view stays read-only." `Studio → Output` shows the destinations again for profiles only. The wizard never asks for the key. | Browser text `fresh-_live_tab_status.txt`; `apps/web/app/(admin)/dashboard/page.tsx` | Add a skippable wizard step "Where the stream goes" (Twitch preset, paste stream key, mask it). Move the form to `Studio → Output`; Status keeps a one-line summary with a link. | M | medium — moves a form operators know; keep the old anchor redirecting |
| U2 | `/setup` → done, `Program` | **Gap (shown). The wizard ends before the programme.** Step 5 says "Sources, the schedule, and stream destinations are ordinary workspace tasks". To reach air a stranger must discover source → library → pool → schedule block on their own; "pool" is explained as "the scheduler's programming units". | `apps/web/app/setup/page.tsx` (done panel); browser text of `/program?tab=pools` | A skippable step "First programme": pick or upload media, a pool is created from it, the "Always-on single pool" template is applied. Pool lead sentence: "A pool is a playlist the schedule plays from." | M | low |
| U3 | `/program?tab=library` (empty) | **Gap (shown). The empty library says the filters are wrong.** Fresh install: "No assets match the current filters — Try a different source, curated set, folder, or search query." The first asset card sits below upload, 8 filter fields, curated sets and bulk edit. | Browser text `fresh-_program_tab_library.txt`; `apps/web/components/asset-library-browser.tsx:748` | Distinguish "library is empty" (say how to add media: upload, drop into `data/media`, add a source) from "filters hide everything". Put the list before curated sets and bulk edit. | S | low |

### B2. Planning a week

Run: a pool "Abendprogramm" from the local library (three 2-minute test files), then
`Program → Schedule → Day → Quick-start templates → Always-on single pool`, replace existing blocks.

| # | Page | Finding | Evidence | Proposal | Effort | Risk |
|---|---|---|---|---|---|---|
| U4 | `Program → Schedule` Day, Week | **Bug (shown). Local files have no duration, so planning numbers are wrong.** After ingest: `select title,status,duration_seconds from assets` → `Folge 1 \| ready \| 0` (all three). The Day lens: "Unique library: 90m · Projected: 1440m … 48 items use a 30-minute estimate because natural length is missing." Real content: 6 minutes. The library card says "Natural duration" instead of a length. The worker code itself says every local-library file is unknown-duration. | `psql` output above; browser text `day2-*.txt`; `packages/core/src/index.ts:3152`; comment at `apps/worker/src/index.ts:2408` | Probe the duration once at scan time (`ffprobe -show_entries format=duration`, bounded timeout, cached by file size + mtime) and store it like remote sources do. | M | medium — a scan of a large library gets slower; probe incrementally |
| U5 | `Program → Schedule` Week | **Gap (shown). The week preview does not show what will play.** After the template: every day Fri–Thu shows "Folge 1" as the first video, "1440m scheduled", "00:00 TO 00:00", and "Repeats inside block". The baseline shows the same with "Folge 12" on all 21 blocks, and the Sat 23:00–01:00 block twice (on Sat, and on Sun labelled "Saturday"), so Sat and Sun read "1500m scheduled". The "Repeats inside block" pill is cut off at the card edge in the baseline. The Week view has no dates and starts at today, while "Weekly coverage" starts at Sunday. | Browser text `week-after.txt`; baseline `program-schedule-desktop`; code comment `packages/core/src/index.ts:2811-2813` (lead S1) | Carry each pool's rotation forward across blocks in time order (reuse the worker's rotation walk); show an overnight block once with "→ 01:00 Sun"; hours, not minutes; dates on the day headers; say why a block repeats ("6 min of video for a 24 h block — plays ≈ 240 times; add videos to Abendprogramm"). | M | medium — the preview must not drift from the worker; share one function |
| U6 | `Program → Schedule` Day | **Gap (shown). The Day editor is 8 872 px of panels with internal words.** "Materialized fill preview", "Live queue context", "Video-level timeline", "Open day lens", "1 materialized block", "240m scheduled · 0m projected". Applying a template with "Replace existing schedule blocks" asks no confirmation (no dialog appeared in the run). | `tour.mjs` → `/program?tab=schedule&lens=day` `height 8872`; browser text; `apps/web/app/(admin)/schedule/page.tsx` | Editor first, numbers folded into the block row; plain words; confirm before replacing blocks. "Edit block" and "+ Add block" on the Week view (lead S4). | M | low |

### B3. A fault at 3 a.m.

Run: worker started, then killed (`pkill -f apps/worker/dist/index.js` at 23:01 UTC); pages read at
23:04:56 (heartbeat older than the 240 s threshold).

| # | Page | Finding | Evidence | Proposal | Effort | Risk |
|---|---|---|---|---|---|---|
| U7 | `Live → Control`, every rail | **Bug (shown). A dead worker raises no problem.** At 23:04:56: "Open problems" lists only the two source incidents; the rail shows `UPDATES · Live · 2026-10-01T23:00:55.140Z`; the only sign is the last panel "Behind the scenes · stale · Worker heartbeat is stale. Reconciliation may be stuck." The worker cannot report its own death, and the web side only colours a panel. Before the first heartbeat the panel says "missing" while "Open problems" says "No open incidents". | `measure.mjs` text dump `dead-live-control.txt`; `apps/web/lib/server/state.ts:1538-1563`; `apps/web/components/broadcast-control-room.tsx:333,369` | Web-side alert: a stale or missing worker (and playout) heartbeat becomes the first entry of "Open problems" and turns the rail red, with the age in words and what to do ("restart the worker container: `docker compose restart worker`"). | S | low |
| U8 | `Live → Status` Incidents | **Bug (shown). The status page claims the worker is running when it never ran.** With no open incidents and no worker ever started: "System readiness — Database persistence, background worker reconciliation, and playout heartbeat are now active." It is a fixed sentence for "no incidents". | Browser text `fresh-_live_tab_status.txt`; `apps/web/app/(admin)/dashboard/page.tsx:265-271` | Build the sentence from the worker and playout heartbeat states, or drop it. | S | low |
| U9 | `Live → Control` on a phone (390 px) | **Gap (shown). What a tired operator needs is at the bottom.** Measured: page 6 256 px; "Current and next" at y = 2 910; "Open problems" at y = 5 723; "Behind the scenes" at y = 6 095. FEED/CURRENT/NEXT/DESTINATION repeat three times (global rail, Live header, Control header). `Live → Status` is 9 476 px tall at 390 px. No page overflows horizontally (all 13 routes: `scrollWidth 390`). | `measure.mjs` output `{"total":6256,"currentAndNext":2910,"openProblems":5723,…}`; `tour.mjs` at `W=390` | On narrow screens one rail, then verdict, open problems and current/next, then the safe actions. Product question Q4 (mobile is a stated non-goal in `docs/ui.md`). | M | medium — control-density and layout specs need new budgets |
| U10 | `Live → Control` "Current and next", incident cards | **Gap (shown). Engine words instead of answers, and frozen relative times.** "Transition idle · queue reason none · version 0", "Transition target none · ready not ready", "Prefetch idle · last probe never". An incident card reads "Last reported 4m ago · first seen 6m ago" above "The last 5 checks failed, the first of them 2 minutes ago" — the message stores "2 minutes ago" at write time. A critical card says what is wrong but not what to press. | `dead-live-control.txt`; `psql … select message from incidents` → "…the first of them 2 minutes ago…" | One plain line ("Next: Folge 2 at 22:00 — ready"); engine fields behind "Details". Store timestamps, not relative phrases, in incident messages. Add a "what to do" line per incident family (lead S12). | M | low |
| U11 | `Live → Control` "If something is stuck" | **Gap (shown). Restart and hard reload fire on one tap.** No confirmation in the component; other destructive forms (pool delete, destination, source actions) do confirm. | `apps/web/components/playout-action-form.tsx:94,125` (no `confirm` in the file); `grep -l "confirm(" apps/web/components/*.tsx` → destination, pool-delete, show-profile-delete, source-actions | Confirm the actions that cut the picture, and state per button whether viewers see a cut. | S | low |
| U12 | Sidebar "Live" chip | **Gap (shown). "Checking" forever.** Without a connected bot account the Live chip reads "Checking" for the whole session (seen for >10 min); the code comment calls it a temporary state. | Browser text; `apps/web/components/broadcast-live-status.ts:12-22` | "Not connected to Twitch" with a link to the Twitch accounts settings. | S | low |

### B4. Wording leaks

| # | Page | Finding | Evidence | Proposal | Effort | Risk |
|---|---|---|---|---|---|---|
| U13 | `Studio → Engagement` | **Gap (shown). Milestone ids in admin copy.** "missing the post-M32 Twitch reconnect", "Broadcasters connected before M32 must reconnect", "An owner connected before 2.1 must reconnect once". | Browser text `fresh-_studio_tab_engagement.txt:70,96,98,104`; `apps/web/app/(admin)/overlays/page.tsx:69,77,102` | Say what to do, with a link; a unit test that fails on `\bM\d{2}\b` in rendered admin text. | S | low |
| U14 | `Studio → Scene`, `Live → Control` "What the overlay shows" | **Gap (shown). The admin shows a standby text viewers never see.** The admin summary and the field's (i) say "Please wait, restream is starting" (the stored default); on air it is replaced by the catalogue's "Stand by, we'll be right back" because the stored value equals the old default. | Browser text `fresh-_live_tab_control.txt`; `packages/db/src/index.ts:1762,2465`; mapping `packages/core/src/viewer-messages/index.ts:218`; (i) text `apps/web/components/overlay-settings-form.tsx:977` | Show the localized text in the admin preview and in the (i), or migrate the stored default. | S | low |

## C. Viewer

| # | Where | Finding | Evidence | Proposal | Effort | Risk |
|---|---|---|---|---|---|---|
| V1 | `/channel` | **Bug (shown). "After that: Nothing further is scheduled yet." on a channel scheduled 24/7.** Run with the daily 24 h template: "On air now — Abendprogramm All Day · 00:00 to 00:00", "Up next — Abendprogramm All Day · 00:00 to 00:00", "After that — Nothing further is scheduled yet." The baseline shows the same with a full week. The line reads the playout queue, not the schedule. | Browser text `fresh-_channel.txt`; baseline `channel-desktop`; `apps/web/lib/public-channel-view.ts:81-88` | Fill it from the schedule (next 3–5 blocks, rest of today and tomorrow); write "all day" for a 24 h block. A week list is R1's topic (dated programme). | S–M | low |
| V2 | `/channel` | **Gap (shown). "Off air" next to "On air now".** With playout down the chip says "Off air" while the first card is headed "On air now" with the scheduled block. | `fresh-_channel.txt` | When playout is not running, head the card "Scheduled now" or show the standby line. | S | low |
| V3 | `/channel` | **Suspicion. The page names the block, not the episode on screen.** Title comes from the schedule item first (`nextScheduleItem?.title || nextAsset?.title`, same pattern for now); the lower third shows the video title. Not compared with a running picture here. | `apps/web/lib/public-channel-view.ts:71-78` | Title = what is on screen; block and time as the subtitle. | S | low |
| V4 | `/channel` | **Gap (shown). Times only in the channel zone.** "All times are shown in Central European Time." No conversion for viewers elsewhere. | `fresh-_channel.txt`; `apps/web/app/channel/page.tsx` | Convert in the browser, channel zone second. Product question Q7. | S | low |
| V5 | Chat | **Gap (shown). Viewers cannot ask the bot anything.** `parseChatCommand` with every feature on: `"!help" -> none`, `"!commands" -> none`, `"!now" -> none`, `"!next" -> none`, `"!schedule" -> none`, `"!request" -> none` (no title, silently ignored); only `!request <title>`, `!skip` and `!1…` act. | `node -e` against `packages/core/dist` (output quoted); `packages/core/src/chat-interaction.ts:72-104` | `!commands` (only enabled ones, configured names), `!now` / `!next` with a link to `/channel`, in the channel language, with per-viewer and global cooldowns. Product question Q3. | S | medium — chat volume and Twitch rate limits |
| V6 | Chat `!request` | **Gap (shown in code, not in chat). A request gets no reply.** Accepted requests are queued and logged; rejected ones only log `chat.request.rejected`. The worker sends chat lines only for the paused skip (`grep -c "twitchChatBridge.say" apps/worker/src/index.ts` → `2`, both skip). Not run against Twitch (no credentials, twitch.tv blocked by the proxy). | `apps/worker/src/index.ts:9522-9546` | One reply per request: queued (with position), no match, cooldown, queue full. | S | medium (as V5) |
| V7 | On-air picture | **Suspicion. The next card shows a bare "20:00-00:00" with no zone and no "in N min".** From `overlay.next.timeRange` "{start}-{end}". Not rendered here (no playout). | `packages/core/src/viewer-messages/en.ts:29` | Add a relative "in 25 min" from the catalogue (en + de). | S | low |

## D. Suspicions not proven here

- The design baselines lag the code: `program-schedule-desktop` still has the old Week-lens sentence
  ("…from the current pool cursor"), `channel-desktop` shows "Europe/Berlin" where the code now says
  "Central European Time". The 1 % pixel tolerance hides wording changes; the wording baselines are
  the reliable ones. (Seen by comparing the images with this run; not re-recorded.)
- `/api/system/readiness` reported `"uplink":"ok"` with no uplink ever running. In this run that is
  explained by `STREAM247_RELAY_ENABLED` being unset (`apps/web/lib/server/readiness.ts:61-63`), so it
  is likely an artefact of the substitute environment, not a product bug.
- The Traefik `proxy` profile, Let's Encrypt and the Twitch OAuth round trips were not run (no public
  hostname, no Twitch application, twitch.tv blocked).

## Proposed milestones (for the Vorschlag thread to merge)

| Title | Goal | Acceptance (proof) | Findings | Effort |
|---|---|---|---|---|
| Honest first run | A fresh install starts empty, readiness counts only what can air, and the wizard explains plain HTTP | Unit test: empty database bootstraps with no pool, no schedule block and no URL-less source; `tests/unit/onboarding*.test.ts`: "pool used by a block with 0 ready assets is action", "week with an unplayable block is action"; e2e on a fresh stack: `/setup?step=done` shows Content sources/Pools/Schedule as "Needs action"; a rendered-copy test for the HTTP hint; `pnpm validate` | I1, I2, I6, I7 (line), I8 | M |
| Getting started that a stranger can follow | The guide covers getting the files, the Twitch console link, the stream key step, and the compose default matches the release | Doc review against a fresh clone; a test or preflight check that the compose default tags equal the package version on a release commit; `pnpm test:fresh-compose` follows the guide's commands | I3, I4, I5 | S |
| Wizard to first programme | `/setup` ends with a stream key and a playing week | e2e: a fresh owner completes "Where the stream goes" and "First programme" and readiness shows destination, pools and schedule ready; destination form lives in `Studio → Output` | U1, U2, U3 | M |
| Local file durations | Local-library assets carry their real length | Unit test of the probe on a generated 2-minute file → `durationSeconds ≈ 120`; Day lens shows "Unique library: 6m" for three such files; scan of an unchanged file does not probe again | U4 | M |
| Week view tells the truth | The Week view shows the projected video per block, dates, overnight blocks once, hours, the reason for repeats | (as lead S1–S5 in the earlier proposal) unit tests in `program-week-projection`; baselines re-recorded | U5, U6 | M |
| The 3 a.m. answer | A dead worker or playout is the first open problem, with what to do; engine words behind Details; confirmations on cuts; a narrow-screen order | Unit test: stale/missing heartbeat → open-problem entry; e2e at 390 px: "Open problems" above y = 1 400; `grep -rn "ready not ready\|are now active" apps/web` → 0; incident messages carry no relative time | U7–U12 | M |
| Wording pass | No milestone ids, the admin shows the standby text viewers see | Rendered-copy test for `\bM\d{2}\b`; standby (i) and summary show the catalogue text | U13, U14 | S |
| Viewers get answers | `/channel` lists real upcoming blocks; chat answers `!commands`, `!now`, every `!request` | `tests/unit/public-channel-view*.test.ts`: "after that lists upcoming schedule blocks when the queue is empty"; chat unit tests per reply, en + de; catalogue parity test green | V1, V2, V4–V7 | M |

## Questions for Benjamin

1. **Q1 — Fresh installs without demo data?** Recommendation: yes. Start empty except the local
   library source; existing installs keep their rows. The demo rows are what turns a new channel red.
2. **Q2 — Plain HTTP on a home network.** Options: (a) only a clear message, cookies stay `Secure`;
   (b) an explicit opt-in (env switch) for non-`Secure` cookies on a trusted LAN. Recommendation:
   (a) now; (b) not at all — the bot account sign-in gives the owner role, so a sniffable session is
   a real risk.
3. **Q3 — May the bot write more in chat** (`!commands`, `!now`, request replies)? Recommendation: yes,
   each with its own switch under `Studio → Engagement`, 60 s per viewer and 10 s global cooldown.
4. **Q4 — May `docs/ui.md` stop calling mobile a non-goal for `Live` only?** Recommendation: yes, an
   "on-call" order for Live → Control and Status; Program and Studio stay desktop-first.
5. **Q5 — Owner password change and reset.** Recommendation: a change-password form under
   Admin → Settings → Security (current password required) and a documented one-line container
   command for a reset; no e-mail reset.
6. **Q6 — One Twitch account or two?** The wizard says the bot and the broadcast channel "may be the
   same one", the guide says not to. Recommendation: allow it but recommend two, and say the same
   sentence in both places.
7. **Q7 — Which time leads on `/channel`?** Recommendation: the viewer's local time first, the channel
   zone second; computed in the browser.
8. **Q8 — Stream key in the wizard?** Recommendation: yes, a skippable step with the Twitch preset;
   the key is stored encrypted like the other secrets and never shown again.

## What I could not check

- The literal `docker compose up -d` and `--profile proxy` paths of the guide, and
  `scripts/dev-stack.sh`: images could not be pulled or built in this container (see Method). The
  first-run code was exercised through the same production web build instead; `pnpm
  test:fresh-compose` in CI covers the compose wiring.
- The on-air picture and everything playout, uplink and relay do (no RTMP target, no relay started).
- Twitch: OAuth for bot and channel owner, live status, chat commands in a real room, EventSub
  (no credentials; twitch.tv blocked by the proxy).
- Upload through `Program → Library` (files were placed into the media directory instead).
- Behaviour after days of running (cache, incidents closing themselves, the as-run log).

## Leads from the earlier proposal (`claude/proposal-2026-10-te1vlg`, section 3)

| Lead | Status here |
|---|---|
| S1 week shows same video | confirmed in this run (U5) |
| S2 overnight block twice, minutes | confirmed in the baseline (U5) |
| S3 "Repeats inside block" without reason | confirmed (U5) |
| S4 Week view has no path to editing | confirmed by reading (U6) |
| S5 Day editor jargon | confirmed (U6) |
| S6 setup stops before programme | confirmed (U2) |
| S7 readiness counts records | confirmed, worse than described: seeded rows count (I1) |
| S8 destinations in a status tab | confirmed (U1) |
| S9 milestone ids | confirmed (U13) |
| S10 pool jargon | confirmed wording ("programming units"), part of U2 |
| S11 library list far down | confirmed in the empty state (U3); positions not re-measured |
| S12 incidents without action | confirmed (U10) |
| S13 no verdict chip | confirmed as part of U7 |
| S14 dead worker is a word at the bottom | confirmed by killing the worker (U7) |
| S15 engine state first | confirmed (U10) |
| S16 no confirmation | confirmed (U11) |
| S17 mobile order | confirmed with fresh measurements (U9) |
| S18 login hint cut off | confirmed (I8) |
| S19 overlay off by default | not re-checked |
| V1–V7 | V1, V5 confirmed by run; V6 by code; V2 kept as suspicion (V3 here); V3 → V4; V4 → V7 |
