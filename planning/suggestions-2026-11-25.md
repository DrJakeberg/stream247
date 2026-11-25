# Suggestions from the nonstopvod.com comparison (2026-11-25)

Ideas taken from the public pages of nonstopvod.com, a hosted service that replays a creator's Twitch VODs
on a second channel. Every claim about their product was checked on their pages, and every statement about
our code was checked in the repository. Ideas only: no texts, names, interfaces or code were taken
(`AGENTS.md`, "Never"). The owner received this list in German with the same numbers on 2026-11-25.
**Nobody starts an item before the owner names its number.** Recommended first package: 2, 3 and 4, because
they are small, security- or correctness-related and fit the owner's security audit. 1 should come next.

Status: on 2026-11-25 the owner asked for the list to be filed here; no item is named yet.

## Viewers and platform rules

1. **Rerun label as a channel default.** Goal: every Twitch title that metadata sync writes carries a rerun
   marker in the channel language, so the operator no longer ticks it per asset. Today the marker is a
   per-asset toggle and the English "Replay:" is fixed. Acceptance sketch: a channel setting (default on for
   archive sources, overridable per source and per asset) gives the title "<marker> <title> <hashtags>" with
   the German marker on a German channel. An asset that already has a prefix gets no second one. Titles
   still respect the 140-character cap. Optional, after checking Helix: set the content classification
   labels. Files: `apps/web/lib/asset-metadata.ts`, `apps/worker/src/twitch-metadata.ts`,
   `packages/core/src/viewer-messages/{en,de}.ts`, a settings form and route, `packages/db` (additive
   column), tests, `docs/operations.md`. Note: Twitch's own rerun rules are known only secondhand and must
   be checked first.
2. **Security headers on the web app.** Goal: clickjacking and downgrade protection for an admin that holds
   stream keys and tokens. Acceptance sketch: every response carries HSTS, `frame-ancestors`/`X-Frame-Options`,
   `nosniff` and a strict `Referrer-Policy`, pinned by a test against the built app. A nonce-based CSP is
   added in report-only mode, first on `/channel`. Overlay and preview pages still render; the design
   baseline is unchanged. Files: `apps/web/next.config.ts` or `apps/web/middleware.ts` (the latter does not
   exist yet), possibly the Traefik labels in `docker-compose.yml`, tests, `docs/deployment.md`.
3. **Fix the broken runbook links in Admin settings.** Goal: in-product help leads to pages that exist.
   Acceptance sketch: `apps/web/app/(admin)/settings/page.tsx:120` names only existing docs or anchors
   (upgrade flow in `docs/deployment.md`, Backup And Restore in `docs/operations.md`).
   `tests/unit/doc-refs.test.ts` or a new test fails on a missing target. Wording baselines are re-recorded.
   Files: that page, a test, possibly `docs/`.
4. **Harden and document the public status JSON.** Goal: `/api/channel/live` cannot load the database, and
   its fields form a small documented contract that only ever gains fields. Acceptance sketch: a shared
   cache of a few seconds. A per-address limit through `apps/web/lib/server/rate-limit.ts` answers 429
   beyond N uncached reads a minute. `playout.message` is no longer in the answer (closes the follow-up in
   `PLANS.md`, "Known follow-ups", "`/api/channel/live` still carries `playout.message`"). The SSE stream
   stays uncached. Fields and states are documented. Files: `apps/web/app/api/channel/live/route.ts`,
   `apps/web/lib/server/state.ts` (`getPublicChannelSnapshot`), tests, `docs/operations.md`.
5. **React when the creator goes live (product decision).** Goal: a rerun channel does not compete with its
   creator. Already listed as an unplanned idea (`PLANS.md`, "Ideas from the competitor comparison, not
   planned", "a reaction when the creator goes live"). Acceptance sketch: a configured creator login (never
   the bot, never the broadcast channel) is polled with hysteresis. When it goes live, the operator's chosen
   reaction runs: keep airing with an on-air/chat notice, or hold on a standby slate, and optionally raid
   (extra scope). When it ends, the pool resumes through M124. The reaction respects operator holds and the
   Live Bridge. Files: `apps/worker/src/twitch-live-status.ts`, `apps/worker/src/index.ts`, settings,
   `packages/db` (additive), tests, `docs/operations.md`, `docs/twitch-setup.md`. Owner question: does
   jimpanse247 replay one specific creator?
6. **Write down the platform rules for a 24/7 replay channel.** Goal: fewer strikes, which take a channel
   off air longer than any fault. Acceptance sketch: a short docs section covers rerun labelling, music and
   DMCA risk, the repeat-infringer rule, content classification labels, the 48-hour limit and the operator's
   responsibility for rights. Each point links to Twitch's own pages rather than restating them. It is
   linked from `docs/getting-started.md`, and `doc-refs` stays green. Files: `docs/twitch-setup.md` or a new
   docs page, `docs/getting-started.md`.
7. **"Just aired" on `/channel`.** Goal: late viewers see what they missed. Acceptance sketch: the last 3-5
   as-run items show with titles only and times in the viewer's zone. No as-run reasons or operator text
   reach the public snapshot (test). Files: `apps/web/lib/public-channel-view.ts`,
   `apps/web/components/live-channel-page.tsx`, `apps/web/lib/server/state.ts`, tests, design baselines.
8. **Original air date of a replay.** Goal: viewers know a replay's age. Acceptance sketch: a "from <date>"
   line in the lower third, `!now` and the `/channel` Now card, shown only when the date is known
   (`publishedAt` from a reliable source). It is never shown for a first-seen time. Files:
   `apps/web/lib/live-broadcast.ts`, `apps/web/lib/public-programme.ts`,
   `apps/worker/src/chat-programme-info.ts`, `packages/core/src/viewer-messages/*`, overlay, tests.
9. **Chat command with the original video's link (off by default).** Goal: mid-replay joiners find the
   source. Acceptance sketch: the answer is the Twitch VOD or YouTube URL of the item on air, or a "no link"
   text for local files. It uses the existing cooldowns. Files: `packages/core/src/chat-replies.ts`,
   `packages/core/src/viewer-messages/*`, chat settings, tests, `docs/operations.md`.
10. **Recurring chat notice.** Goal: point replay viewers at the main channel or `/channel` with nobody at
    the desk. Acceptance sketch: one or a few operator texts post on a minimum interval, only after chat
    activity since the last post, within the existing send budget. Off by default. Files:
    `apps/worker/src` (chat), `packages/db` (additive), settings UI, tests, `docs/operations.md`.
11. **Operator-defined text commands.** Goal: answer standard questions without a second bot. Acceptance
    sketch: up to N commands with fixed text and length limits. They cannot shadow built-in names, are
    listed by `!commands` and are throttled like `!now`. Files: `packages/db/src/index.ts` (additive table
    or field and a downgrade note), `packages/core/src/chat-replies.ts`, chat settings UI, tests,
    `docs/operations.md`.
12. **Read-only vote on `/channel`.** Goal: the running vote is visible off-stream. Acceptance sketch:
    options, counts and how to vote in chat are shown while a vote runs. The page offers no ballot. Files:
    public snapshot, `apps/web/components/live-channel-page.tsx`, tests, baselines.

## Operations and storage

13. **Storage overview and projection.** Goal: see what fills the disk before a watermark incident.
    Acceptance sketch: Admin shows usage split into local media, Twitch cache, feed segments and
    thumbnails. It shows measured GB per hour of library files and an estimate of days until the eviction
    watermark at the current growth, labelled as an estimate. The figures are measured rarely and cached.
    Files: `apps/worker/src/system-volume.ts` or a new module, `apps/web/app/(admin)/settings/page.tsx`,
    `apps/web/components/disk-watermark-form.tsx`, tests, `docs/operations.md`.
14. **Planned reconnect at an item boundary.** Goal: the 48-hour cut falls between items. Already listed as
    an unplanned idea (`PLANS.md`, "Ideas from the competitor comparison, not planned", "the 48-hour
    reconnect at an item boundary"). Acceptance sketch: if the next item cannot end before the deadline
    minus a margin, the reconnect happens at the current item's end. An item longer than the window is
    still cut and resumed (M124). Items of unknown length keep a hard deadline below Twitch's limit. The
    blip grace is unchanged. Files: `apps/worker/src/index.ts`, `apps/worker/src/playout-boundary.ts`,
    `packages/core/src/managed-runtime.ts`, tests, `docs/operations.md`.
15. **Audience and airtime from the as-run log.** Goal: feedback for scheduling decisions. Extends the open
    follow-up in `PLANS.md`, "Known follow-ups", "Daily on-air percentage and per-item audience" (M76).
    Acceptance sketch: peak and average viewers are stored per as-run row (additive columns). The as-run
    panel shows per-item and per-day audience, the on-air share per day, cumulative hours on air and the
    longest unbroken run. A running total survives `AS_RUN_RETENTION_DAYS`. Files:
    `apps/worker/src/as-run.ts`, `apps/worker/src/index.ts`, `apps/web/app/api/as-run/route.ts`, as-run UI,
    `packages/db`, tests.
16. **Undo for schedule deletes and template applies.** Goal: a wrong click no longer takes programming off
    air for good. Acceptance sketch: a deleted block or a replaced schedule goes to a trash kept for 7
    days. Restore runs the same validation as a new block. Before the delete, a preview names what leaves
    the coming week. Files: `apps/web/app/api/schedule/blocks/route.ts`,
    `apps/web/components/programming-template-form.tsx`, schedule UI, `packages/db` (additive and a
    downgrade note), tests.
17. **Opt-in durable keep for Twitch archives (product decision).** Goal: the programme does not shrink as
    Twitch expires VODs (7/14/60 days). Acceptance sketch: archives of chosen sources, or pinned archives,
    are kept as library files under their own size budget. The oldest unpinned roll off first; pinned,
    scheduled, queued and on-air items never do. The library shows which items exist only on Twitch and
    when they likely expire. Off by default. Files: `apps/worker/src/twitch-vod-cache.ts`,
    `apps/worker/src/disk-watermark.ts`, library UI, `packages/db`, tests, `docs/operations.md`. Disk on
    the DUT is tight; owner decides.
18. **Fill or skip Twitch-muted ranges.** Goal: no long silences on air. Acceptance sketch: first measure
    in the playout container whether yt-dlp exposes muted ranges for our sources. If it does, a pool's
    audio bed plays during those ranges, or the range is skipped, as the operator chooses, and the library
    shows the muted share per item. Files: Twitch ingest in `apps/worker/src`, ffmpeg seam chain, pool
    form, tests, `docs/operations.md`. Rights to the bed stay the operator's.
19. **Category variety in a pool.** Goal: fewer long single-game runs. Acceptance sketch: an optional rule
    defers an item whose category matches the last N, in favour of the next item of another category. The
    week projection (`walkPoolRotation`) gives the same order as playout (test). Files:
    `packages/core/src/pool-rotation.ts`, pool form, tests.

## Repository and support

20. **Bug report checklist.** Goal: actionable reports, no leaked keys. Acceptance sketch: `SUPPORT.md` and
    `.github/ISSUE_TEMPLATE/bug_report.yml` ask for version and image tags, a UTC window, the item or
    source, the incident ID and log lines, with an explicit warning never to paste keys or tokens. Files:
    those two.
21. **Opt-in new-release notice in the update center.** Goal: fewer long-stale installs. Acceptance sketch:
    when switched on, the update center shows the newest stable version, a CHANGELOG link and whether the
    release has a schema change that needs a backup first. The check sends no identifying data. Updates
    stay manual. Files: `apps/web/lib/server/update-center.ts`, settings page, tests.
22. **First stream with a test card in the setup wizard.** Goal: a new install proves uplink and Twitch
    link before any library exists. Acceptance sketch: an explicit wizard action airs a built-in test card
    for a bounded time and never by default. `docs/getting-started.md` states a measured time to first
    stream. Files: `apps/web/app/setup/page.tsx`, worker test-card source, `docs/getting-started.md`,
    tests, baselines.
