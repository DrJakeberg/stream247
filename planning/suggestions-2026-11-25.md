# Suggestions from the nonstopvod.com comparison (2026-11-25)

Ideas taken from the public pages of nonstopvod.com, a hosted service that replays a creator's Twitch VODs
on a second channel. This file holds 47 ideas. Items 1 to 22 come from a comparison of their pages with
our product; every claim about their product was checked on their pages, and every statement about our
code was checked in the repository. Items 23 to 47 come from a look at the design of their public pages
only (61 screenshots, desktop and phone, not logged in; nothing behind the login was seen). Ideas only,
design included: no texts, names, colours, logos, layouts, interfaces or code were taken (`AGENTS.md`,
"Never"). The owner received items 1 to 22 in German with the same numbers on 2026-11-25.
**Nobody starts an item before the owner names its number.** Recommended first package: 2, 3 and 4, because
they are small, security- or correctness-related and fit the owner's security audit. 1 should come next.
For the design part only: 23, 24 and 25 together (one header, state badges, the existing button tiers),
because they reuse tokens and classes that already exist.

Status: on 2026-11-25 the owner asked for the list to be filed here, and for 23 to 47 to be appended;
no item is named yet.

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

## Design: admin surfaces

Items 23 to 47 come from a review of the public pages only. Every item that changes UI text or layout needs
the design and wording baselines re-recorded on a fresh stack through `scripts/design-baseline.sh`
(`AGENTS.md`, "Scope and quality").

23. **One header per admin page.** Goal: the first working card sits higher, and on Live control it moves up
    by about one screen. Acceptance sketch: Live control and Program library each render exactly one page
    header, the duplicated workspace hero and metric row are gone or merged into the top strip, and the
    `live-control-desktop` baseline shows Open problems above the fold at 1440x900. Files:
    `apps/web/app/(admin)/layout.tsx`, the Live control and Library page components,
    `apps/web/app/globals.css`, baselines.
24. **State badge at the start of each output and source row.** Goal: the state is readable before the detail
    lines. Acceptance sketch: every output row in Sending to Twitch and every source row starts with an
    existing `.badge` variant (ok / needs setup / failing) built from the tone tokens; no new pill class; unit
    or e2e checks assert the badge for each state. Files: the Live control destination components, the
    `sources/[id]` page and the sources list, `apps/web/app/globals.css:375-397` (reuse only). Note from the
    check: today only `.badge-ready`, `.badge-action` and `.badge-optional` exist (positive, caution and
    neutral tone); a "failing" state has no variant yet, so the item must either map it to `.badge-action` or
    add one variant on the existing `--tone-critical-*` tokens in `tokens.css`. The owner picks.
25. **Apply the existing button tiers.** Goal: destructive actions look destructive, and disabled buttons look
    disabled. Acceptance sketch: `apps/web/components/asset-library-browser.tsx:652` (Delete curated set) and
    `apps/web/components/playout-action-form.tsx:360` (Remove next) use `.button-danger`; disabled buttons
    have lower contrast and no border; one primary per action group. Files: those two components,
    `apps/web/app/globals.css:886-888` (`.button-danger`) and `:539` (`.button:disabled`), baselines.
29. **Compact table view for outputs and the library.** Goal: outputs and assets can be compared at a glance.
    Acceptance sketch: at desktop width the outputs render as a table (name, role, priority, state badge,
    recovery) and the library has a list view, with the on-air row tinted; phone width keeps the cards;
    keyboard and screen-reader table semantics are verified in the a11y tree. Files: the Live control
    destination components, `apps/web/components/asset-library-browser.tsx`, `apps/web/app/globals.css`,
    baselines.
34. **Numeric metrics as large tabular figures.** Goal: numbers can be read from across the room. Acceptance
    sketch: viewers, uptime, queue length and open incidents render as a larger numeral with
    `font-variant-numeric: tabular-nums` and a muted caption; text states stay at body size; a small live dot
    appears next to viewers when on air. Files: the metric strip component (the `.metric` rules in
    `apps/web/app/globals.css`), `apps/web/app/styles/tokens.css`.
37. **Extend the M90 phone treatment to all workspaces (owner decision).** Goal: the page heading is on the
    first phone screen. Acceptance sketch: below 640 px, brand and workspaces sit in two compact columns, the
    sidebar explanation card is hidden, and the shared rail collapses to one line; in the
    `program-library-mobile` baseline the heading is above the fold. CSS only. Files:
    `apps/web/app/globals.css` (the M90 comment and media query at `:1892-1901`), mobile baselines.
40. **Type tokens and a font-size ratchet.** Goal: 21 font sizes become 5-6 steps with meaning. Acceptance
    sketch: tokens (display, heading, subheading, body, small, eyebrow) in `tokens.css`; near-duplicate sizes
    folded in; `scripts/css-token-lint.sh` and its baseline (today they ratchet raw colour literals only) also
    ratchet raw `font-size` literals. Files: `apps/web/app/styles/tokens.css`, `apps/web/app/globals.css`,
    `scripts/css-token-lint.sh`.
41. **At most two nesting levels.** Goal: a card means one item of a set. Acceptance sketch: section card,
    then plain rows with dividers for outputs, incidents and queue; bordered sub-cards only for selectable
    asset tiles; Curated sets is no longer a card inside a card inside a card. Files: Live control and Library
    components, `apps/web/app/globals.css`.
42. **Show the readiness checklist where the gap is.** Goal: setup gaps become numbered steps instead of stray
    text. Acceptance sketch: extend `apps/web/components/go-live-checklist.tsx` (no new component) with step
    numbers and a compact variant shown in Live control while steps are open; data from
    `apps/web/lib/server/onboarding.ts`. Files: those, plus the Live control page.
43. **Dark scheme from tokens (owner decision on timing).** Goal: easier on the eyes at night, following the
    system preference. Today the repository has no `prefers-color-scheme` rule; the interface is light only.
    Acceptance sketch: a dark token set under `prefers-color-scheme: dark`, starting with the admin shell,
    contrast checked for secondary text, baselines recorded in both schemes. Files:
    `apps/web/app/styles/tokens.css`, `apps/web/app/globals.css`, the baseline spec
    (`tests/e2e/design-baseline.spec.ts`).
44. **Group the readiness list; fold the filters on the phone.** Goal: blockers first, and the first asset
    sooner. Acceptance sketch: the Live status readiness list has three group headings (Twitch, Output,
    Content) with blocking items first; below 640 px the Library filters sit behind one "Filters (n active)"
    disclosure. Files: the Live status page, `apps/web/components/asset-library-browser.tsx`,
    `apps/web/app/globals.css`.
46. **One line per workspace in the sidebar.** Goal: no truncated explanation. Acceptance sketch: the sidebar
    card at `apps/web/app/(admin)/layout.tsx:33-39` (explanation text at line 37) becomes one labelled line
    per workspace, with one consistent icon family of our own. Files: that layout, `apps/web/app/globals.css`.
47. **Readable measure in admin cards.** Goal: long help lines are easier to read. Acceptance sketch:
    paragraphs inside admin cards are capped at about 70ch, and controls keep full width. Files:
    `apps/web/app/globals.css`.

## Design: first contact and documentation

26. **README opening and first-run reassurance.** Goal: within five seconds a newcomer knows what stream247
    does, what it needs and where to start. Acceptance sketch: `README.md` starts with one outcome sentence,
    one prerequisites line (Linux host with Docker, public HTTPS hostname, Twitch account), a Getting started
    link and a What it does today link; the licence block ("License Model", now at the top) moves below; Quick
    Start says in our own words that a first start broadcasts nothing until an output is configured, and links
    the exact Twitch scopes in `docs/twitch-setup.md`. Files: `README.md`, `docs/getting-started.md` section
    0.
27. **What stream247 does not do today.** Goal: an operator learns the limits before investing time.
    Acceptance sketch: `README.md:134-137` ("What Is Not Done Yet", today two lines pointing to `PLANS.md` and
    `docs/architecture.md`) becomes 5-8 plain bullets, each checked against the code and `PLANS.md` (nothing
    assumed) and linked to an open milestone or a known gap. Files: `README.md`.
28. **SECURITY.md and SUPPORT.md answer the trust questions.** Goal: one clear way to report a vulnerability
    and an honest expectation of a reply. Acceptance sketch: `SECURITY.md` links the repository's private
    advisory form, has a table of supported versions (latest release plus the previous minor) and a response
    target the owner picks; `SUPPORT.md` names the maintainer role, what answers to expect and what to include
    (version, `docker compose ps`, log lines without secrets). Files: `SECURITY.md`, `SUPPORT.md`.
30. **Disk sizing in hours.** Goal: an operator can size the host before installing. Acceptance sketch:
    `docs/deployment.md` gets a "Disk you need" table (library hours against GB at the default output bitrate,
    plus PostgreSQL and log growth), marked as an estimate measured on the DUT (DUT check in
    `planning/dut-checks.md`, no guessed numbers); it links the existing watermark text
    (`docs/deployment.md:158-160`, `docs/operations.md:1303-1322`, "Media disk filling up") instead of
    restating it; getting-started section 8 gets one worked sentence. Optionally, an "about N hours left" line
    next to free space in the library. Files: `docs/deployment.md`, `docs/getting-started.md`,
    `planning/dut-checks.md`.
31. **Stage summary above the getting-started guide.** Goal: setup looks doable, and "done" is named.
    Acceptance sketch: 3-4 stages (for example Deploy, Connect Twitch, Add media, Plan the week) with links to
    the 12 sections (0 to 11) and an end state (Live -> Status green); the wizard rail groups its steps under
    the same stage names. Files: `docs/getting-started.md`, `apps/web/app/setup/page.tsx`.
32. **Decide the content before the tooling.** Goal: a newcomer picks a source kind for a reason. Acceptance
    sketch: getting-started section 9 ("Programme") opens with a short paragraph in our own wording and three
    bold-led options (own Twitch archive, YouTube playlist or channel, local files), each with one line on
    rights and reliability, then the existing steps. Files: `docs/getting-started.md`.
33. **Login says which card is whose.** Goal: team members and the owner each find their sign-in. Acceptance
    sketch: a one-line heading explains Twitch sign-in for the team and the local account for setup and
    recovery; the most-used card is visually primary; when Twitch sign-in is not configured, a short state
    replaces the truncated setup text and points to Admin. Files: `apps/web/app/login/page.tsx` and its
    components (`login-form.tsx`, `twitch-login-panel.tsx`), viewer/UI texts, baselines (`login-desktop`,
    `login-mobile`).
35. **Version stamp on operator docs.** Goal: an operator can tell whether a guide matches the pinned image.
    Acceptance sketch: `docs/getting-started.md`, `docs/deployment.md` and `docs/twitch-setup.md` each carry
    "Checked against vX.Y.Z on <date>"; the release skill's checklist updates it in the release commit. Files:
    those three docs, `.claude/skills/release/SKILL.md`.
36. **Spell out every deleting default.** Goal: nothing is removed by surprise. Acceptance sketch: for the
    VOD/Twitch cache, incident history and logs, one sentence each in the docs and the UI hint: the default,
    what it removes, what it never removes, and where to switch it off; the Twitch cache list at
    `docs/deployment.md:1190-1201` (variable names without values) gets concrete values. Files:
    `docs/operations.md`, `docs/deployment.md`, `apps/web/components/disk-watermark-form.tsx` and related
    settings forms.

## Design: public channel page

38. **Optional operator footer on /channel (owner decision).** Goal: the operator can meet a legal duty to
    publish an imprint without putting personal data on the page by default. Acceptance sketch: Admin settings
    for an imprint URL and a privacy URL, read by `/channel` and hidden when empty; wired end to end with a
    test that reads the stored value on the public page; additive schema with a downgrade note in
    `docs/deployment.md`. Files: `apps/web/app/channel/page.tsx`, Admin settings,
    `apps/web/lib/public-channel-view.ts`, docs.
39. **Honest "on air since" line.** Goal: proof that the channel keeps running, from our own data only.
    Acceptance sketch: next to the On air badge, one line with the start of the current broadcast from worker
    data; the line is absent when off air; no aggregate counters; tests cover live and off-air. Files:
    `apps/web/app/channel/page.tsx`, `apps/web/lib/public-channel-view.ts`, the worker's state export, viewer
    texts.
45. **Keep the watch action reachable on /channel.** Goal: one tap to the stream from anywhere on the page.
    Acceptance sketch: either a compact sticky bar with the channel name and the watch button, or the button
    repeated after the 7-day list; it must not cover content. Files: `apps/web/app/channel/page.tsx`,
    `apps/web/components/live-channel-page.tsx`, CSS; baselines `channel-desktop`, `channel-mobile`.
