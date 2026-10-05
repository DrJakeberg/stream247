# Architecture

## Product Boundaries

Stream247 is a self-hosted single-channel 24/7 broadcast product. It is built for one operator or a small internal team running one always-on channel, not for multi-tenant hosting or a reusable overlay service.

Explicit non-goals:

- no multi-tenant or multi-channel control plane
- no external overlay SaaS or third-party embed product
- no in-app video editing or post-production workflow
- no Kubernetes-native rewrite or cloud-control-plane redesign
- no public API product direction beyond the internal web client

## Service Topology

- `web`: Next.js admin UI, public pages, and API routes
- `worker`: ingestion, Twitch reconciliation, incidents, alerts, and playout supervision
- `playout`: playout runtime image used for FFmpeg-oriented broadcast execution
- `postgres`: durable relational state

## Persistence Model

Stream247 now uses PostgreSQL as the primary application store through `@stream247/db`.

Persisted domains include:

- initialization and owner bootstrap state
- managed encrypted integration credentials
- users, Twitch identities, and team access grants
- moderation settings and moderation presence
- overlay settings
- sources and assets
- schedule blocks
- Twitch connection state
- Twitch-managed schedule segment mappings
- stream destinations
- incidents and audit events
- playout runtime state
- the as-run log (`as_run_log`, since M76; see *Live Runtime*)

Legacy `data/app/state.json` is only treated as a one-time migration source when the database is empty.

## Delivery Model

- production Compose is image-based and intended to pull from GHCR
- development Compose remains build-based
- `main` pushes publish current GHCR images after validation
- `v*` tags publish versioned GHCR images

## Operator Workspaces

The admin UI is organized around four workspaces:

- `Live` at `/live`
  - `?tab=control`
  - `?tab=status`
  - `?tab=moderation`
- `Program` at `/program`
  - `?tab=schedule`
  - `?tab=pools`
  - `?tab=library`
  - `?tab=sources`
- `Studio` at `/studio`
  - `?tab=scene`
  - `?tab=engagement`
  - `?tab=output`
- `Admin` at `/admin`
  - `?tab=settings`
  - `?tab=team`

Legacy routes remain as redirects where needed, but the workspace URLs above are the canonical surfaces.

## Runtime Model

Stream247 works around three high-level state concepts:

- desired state:
  - schedule intent
  - moderation policy
  - Twitch metadata targets
  - operator overrides
- actual state:
  - currently selected asset
  - destination readiness
  - FFmpeg process metadata
  - Twitch connection state
  - open incidents
- reconciled state:
  - worker/playout logic continuously moves actual state toward desired state

## Live Runtime

The current playout model is FFmpeg-based and supervisor-driven. In relay mode, program playout publishes to a buffered local HLS program feed by default, while a separate uplink worker reads that feed and owns the external RTMP destinations. HLS feed handoffs use temporary segment writes, discontinuity markers, and epoch-based segment numbers; the uplink demuxer tolerates corrupt or discontinuous local feed packets so normal asset boundaries do not close the external RTMP session. `STREAM247_UPLINK_INPUT_MODE=rtmp` keeps the older MediaMTX relay input available as an explicit rollback path.

Persisted playout runtime fields include:

- status
- current asset
- desired asset
- current destination
- active output group
- restart requests
- heartbeat timestamp
- process pid
- process start time
- last successful start
- last successful asset
- last exit code
- restart count
- crash count window
- crash-loop protection state
- last error
- last stderr sample
- selection reason code
- fallback tier
- override mode
- override asset id
- override expiry
- skipped asset id
- skip expiry

The runtime fields hold the present only. Since M76 every playout process run also leaves one row in
the as-run log, table `as_run_log`: `started_at` and `ended_at` (ISO, UTC; `ended_at = ''` while on
air), `target_kind` (asset, insert, fallback, live, standby, reconnect; `fallback` covers the fallback
tiers, the bridge and the operator's Fallback), `asset_id`, `title` as aired, `source_id`, `pool_id`
(the block's pool, only when the pool's rotation picked the item, `scheduled_match` from one of its
sources), `block_id`, `reason_code` (the selection reason code), `queue_kind`, `input_kind` (local,
remote, pair, live, slate), `format_id`, `format_candidate`, `planned_seconds`, `aired_seconds`,
`end_reason` and `exit_code`; indexed by `started_at`. Only the playout writes it
(`apps/worker/src/as-run.ts`): a row at every successful start in `startOrSwitchPlayout` (every path:
programme, insert, fallback bridge, slate, live bridge) and its completion from the child's own `exit`
event, watched from right after the spawn (`watchAsRunEnd`; the main exit handler is attached only after
the start's awaited writes, which an early exit does not wait for), at the same instant
`playout.process.exit` measures `ranForMs` to. A spawn that fails emits no `exit` at all; its row ends as
`failed` with the error code and no aired time. The writes are queued on one promise chain and not
awaited, so they cost a switch nothing; a failed write is logged as `as_run.write_failed` and never
reaches the cycle or the exit handler. A row nobody saw end (a redeploy kills the playout without an exit
handler running) is closed as `process-gone` at the next playout boot or the next start, so at most one
row is ever open. The web
reads it (`GET /api/as-run`, the *On air, last 24 hours* panel of `Live → Status`); it is not part of the
application state, `persistState` never writes it, and rows older than 90 days
(`AS_RUN_RETENTION_DAYS`) are deleted in the write that adds a start, the way `audit_events` is pruned in
its append.

Current playout status values:

- `idle`
- `starting`
- `running`
- `switching`
- `degraded`
- `recovering`
- `failed`

Asset selection precedence is currently:

1. active operator override
2. active scheduled source mapping
3. global fallback asset
4. any ready asset

## Source Ingestion

Current source connectors:

- local media library scan
- direct media URL normalization
- YouTube playlist ingestion via `yt-dlp`
- YouTube channel ingestion via `yt-dlp`
- Twitch VOD ingestion via `yt-dlp`
- Twitch channel ingestion via `yt-dlp`

Assets are normalized into a PostgreSQL-backed catalog and then selected by the playout runtime.

A source sync writes a source's assets again from its listing, but keeps what the listing cannot know
better: the first-seen `created_at`, a `published_at` once one was observed (fill-only, because
YouTube's approximate dates move with every sync), a known duration when the listing reports none, the
cache columns, and the operator's curation (folder, tags, title prefix, hashtags, notes, chapters,
include flag, fallback settings). The listing's title and category still replace the stored ones on
every sync. YouTube channel and playlist listings ask yt-dlp for `youtubetab:approximate_date`: yt-dlp
counts YouTube's relative age ("5 hours ago", "3 months ago") back from the sync time and rounds to its
unit, so a recent upload gets a time to the hour or minute, while older items that share a label share one day and order by
title within it; the first value seen is the one kept. Twitch channel archive listings carry no date. A
finished VOD download writes only the asset's cache columns. The local media library has no listing
that knows lengths, so its scan asks `ffprobe` for each file's duration and stores it with the file
version it belongs to (`assets.duration_probe_key`, size and modification time); an unchanged file is
not probed again (`apps/worker/src/local-durations.ts`).

Ingest lists items; it does not decide how they play. Playback URLs are resolved by the playout
process (the `playout` container), just before an item airs and in the queue prefetch. A YouTube item
is resolved through ordered format candidates (`apps/worker/src/playable-input.ts`) and may play as a
video+audio pair, which playout opens as two ffmpeg inputs.

Twitch VOD assets keep their original Twitch URL as the source path, but the worker prepares a verified local cache file before using the asset for playout. Cache metadata is stored on the asset record, and the internal `.stream247-cache` tree is excluded from local-library discovery so cached archive files do not become duplicate programming assets.

## Scheduling

The schedule model is block-based and timezone-aware.

Current schedule capabilities:

- weekly block-based scheduling
- dated and one-off blocks (M93): a block may run only between two dates or once on one date; it sits on a
  layer above the weekly grid and takes over the part it overlaps, the weekly block continuing around it
- pool-based programming
- minute-accurate block start times
- duration validation
- overlap detection
- reusable show profiles above raw blocks
- multi-day block creation
- weekly coverage summaries
- quick-start program templates
- public schedule preview
- drag/drop day timeline repositioning
- resize-to-change-duration editing

The scheduler is deterministic and explainable: schedule preview items carry explicit source/reason information.

A pool walks its sources in turn (M73, `packages/core/src/pool-rotation.ts`): the next item comes from
the source after the one the last started item came from, in the pool's `sourceIds` order, skipping a
source with nothing playable, and within that source it is the first playable item after that source's
own position, looping. A pool with one source therefore plays that source in order. The positions are
stored per pool: `cursor_asset_id` (the last started item) and `source_cursors` (sourceId -> the last
item started from that source). The cursor always counts as its own source's position: a pool from
before 2.1 has only the cursor, and an older image running after a rollback moves only the cursor, so
the map entry for that source can be missing or stale, never newer. Positions are taken in the source's full ordered list,
playable or not, so a skipped, quarantined, cooling-down or excluded item is stepped over; before 2.1 the
cursor was looked up in the filtered list, and every Skip (which holds exactly the cursor item) sent the
pool back to its oldest item. An item that vanished from the catalog restarts its source at the oldest
item. The worker's selection and runtime queue, the overlay lookahead, the schedule preview and the
materialized week all use this one rotation. Since M97 the materialized week (week view, Day lens fill
preview) carries each pool's rotation from one block to the next in time order, as the worker does; the
Day lens's video timeline still starts every block from the stored position. The runtime queue walks on from the running
item only in the cycle that starts and stores it; an item the pool never stored (one another pool on the
same source started, or a manual next) leaves the queue on the stored position, where the next pick comes
from. A started pool item stores the cursor and
its source's position in one serialized write; an insert moves neither, and a pool edit keeps both
(it drops only the positions of sources it removed).

Two holds keep unplayable items out of the rotation. Per-item quarantine (`asset-probe-quarantine.ts`)
counts consecutive failed prefetch probes on the asset (`playback_probe_failures`, `_error`,
`playback_probed_at`); at three the item is passed over until a clean probe or the operator clears it. Since M95 the playout
gives each quarantined item one trial a day, at most one per source per cycle, only while its source's
breaker is closed and no network outage of the channel was seen in the last ten minutes
(`selectQuarantineReprobes`); the trial runs after the queue's own probes and with the budget they left,
a clean one clears the quarantine, a failed one only records when it was tried, and the breaker hears
neither. A Twitch archive that is not in the cache is tried without its download: the trial only asks
whether it still resolves on Twitch (`apps/worker/src/quarantine-trial.ts`, since M105).
The source circuit breaker (M75, `packages/core/src/source-circuit-breaker.ts`) judges the source: when
probes fail on three different items of one source with no clean probe of it in between, the source is
open and the rotation treats its whole lane as having nothing eligible, so the pool alternates between
its other sources (or finds nothing, and the fallback plays). The breaker learns from the outcomes
quarantine counts, each probe once (`takeUncountedProbeOutcome`, `planAssetProbeUpdates`), and from the
inline resolve of the selected item, which the queue never probes (it lists the items after the
selection and is empty while a fallback is on air): without it a trial item picked straight away, in a
pool with only that source, would never be judged. It leaves out one failure: a Twitch archive whose
download is queued or running (`TwitchVodCachePendingError`, `apps/worker/src/source-breaker-outcomes.ts`),
which is not playable yet but says nothing about its source; a single-source Twitch pool queues several
of them while the runner downloads one at a time.
An outage of the channel's own network is kept away from both holds (M82). The list of probe outcomes
that feeds `planAssetProbeUpdates` and the breaker is first passed through `dropNetworkOutageOutcomes`
(`apps/worker/src/index.ts`), and so is the inline resolve's outcome. It takes out a failed outcome when
two things hold. The error text names a failure that got no answer (`classifyProbeFailure` in
`packages/core/src/probe-network-outage.ts`: name resolution, connecting, a timeout, a TLS handshake
ending in nothing, yt-dlp's transport errors; a format that is not offered, a removed or private video
and every HTTP status are `other`). And the channel's way out is down at that moment: the playout
resolves the host of each enabled output (`publishHostTargetsOf`, at most two, local hosts left out)
and opens one TCP connection to it (`apps/worker/src/probe-network-outage.ts`, 2.5 s at most, asked
only when a network-looking failure is about to be counted, one verdict per ten seconds), and
`decideNetworkOutage` says outage only when none connects or answers. The question is asked when the
failure is counted, which is up to one resolve timeout (60 s) after its request went out, so an outage
the check saw stands for that long after the output connects again (`carryRecentNetworkOutage`); a blip
shorter than one resolve that nothing asked about is not seen. A check that itself breaks is no
evidence: everything counts and `playout.probe.network_outage.check_failed` says so. The classifier
knows both libc wordings, since the image is Alpine and musl says `Try again` and `Network unreachable`
where glibc says `Temporary failure in name resolution` and `Network is unreachable`. The output is
asked rather than the uplink's state in `playout_runtime` read, because that state carries no time (the
exit reason is cleared by the next start), follows a silent drop only at the encoder-stall restart, and
fails for reasons that are not the network; in relay mode the playout feeds the local relay, so the
check is the only view it has of the way out. An outcome taken out is neither a failure nor a success:
counters keep their value, a half-open breaker keeps its trial, and each one is logged
(`playout.probe.network_outage`, one line per item per five minutes). Without corroboration a
network-looking failure counts as any other, since a host that is down while the channel's output
connects is a source fault.
An open breaker lasts a cooldown of 30 minutes that doubles on every re-open up to 6 h; once it has run
out the source is half-open, which is not stored but read from `opened_at` plus the cooldown, so no
process has to be up at that moment. Half-open gives one trial item per walk (the first the rotation
reaches; an item this cycle starts counts as it), and the first counted outcome of the source decides:
clean closes the breaker and resets the cooldown, failed re-opens it. Outcomes while the cooldown runs
are ignored. The breakers live in their own table, `source_breakers` (one row per source that ever failed
a probe: `state` closed/open, `failed_asset_ids`, `opened_at`, `cooldown_seconds`, `last_error`), because
a whole-state write deletes and re-inserts every source row; they are read with the state and written
only by the playout's serialized read-modify-write (`recordSourceBreakerOutcomes`, which takes the
state-write lock only when an outcome changes a row: most are clean probes of a healthy source) and the
source page's *Close breaker now* (`closeSourceBreakerRecord`). The previews apply the breaker as it stands when they
are drawn. The generic fallback tiers (any ready asset in the selection, the recovery and bridge plans
after a failed preparation) pass a held source's items over too: the hold keeps them out of the queue,
so their quarantine counters stop, and they would fail there instead. A block mapped to a source by
name and the operator's global fallback asset are not gated. A held source that no pool could pick
anyway (every item quarantined, excluded or cooling down, or the source in no pool) is closed by the
playout, which leaves the case to quarantine; an incident left without a row (the source deleted) is
resolved from its fingerprint.

Each source's items play in one order, `compareProgrammingAssets` in `packages/core`. It compares one
fixed key: `publishedAt`, else the first-seen `createdAt`, oldest first; then the source id, so items
with the same date stay grouped by source; then, within that source, items with a numeric VOD id first, by id; then
the title; then the asset id. The key is fixed because a comparator that used VOD ids only for some
pairs and titles for others formed cycles, and the sort then depended on the database's read order.
A Twitch channel's archives, whose listing has no date, therefore play by first-seen time, and by VOD
id among archives first seen in the same sync. An archive that drops out of a listing and comes back is
first seen again and plays after the newer ones. Each source's position walks that order and loops. The
fallback ladder uses the same order within one fallback priority, after putting library files ahead of
remote items, because a library file plays without a remote resolution.

## Twitch Integration

Two Twitch accounts, resolved in one place (`packages/core/src/twitch-accounts.ts`, read from state
through `resolveTwitchAccountsForState`): the **broadcast channel** (stream key, viewers, every target
of chat, moderation, live status, metadata and alerts) and the **bot account** (the OAuth connection
chat and moderation run as; table `twitch_connection`, whose `broadcaster_*` columns are legacy names
for the bot). The optional **channel owner connection** (`twitch_broadcaster_connection`) carries the
writes Twitch only accepts from the channel itself. See `docs/twitch-setup.md`.

Current Twitch domains:

- bot account OAuth connection, and the optional channel owner connection
- team SSO login
- title sync from the active schedule block, the current video, or the video's current chapter
- category lookup and sync from the same three levels — per-video chapters (auto-filled from VOD
  metadata, editable in the library) switch category and title at offsets inside one video,
  gated behind the channel owner connection (or the bot account when it is the channel itself) and
  throttled to one channel write per 30 seconds
- Twitch schedule segment sync for upcoming blocks
- moderation-related chat mode updates

When Twitch reconciliation fails, Stream247 raises incidents instead of failing silently.

## Chat Games

Chat-driven games render into the on-air overlay through an extensible framework:

- a game is a pure state machine in `packages/core/src/chat-game.ts`: settings, `applyInput`, and `renderModel` — deliberately no tick, so a game only ever advances on accepted chat input
- Snake is the first game: every emote maps to one direction (configurable, four distinct emotes), and the snake moves exactly one cell per accepted message
- the worker consumes broadcast-channel chat, applies inputs in arrival order, and persists the round in `chat_game_runtime`, so a worker restart resumes the round
- the playout container re-derives the render model from that record and draws it wherever a scene has an enabled `Chat Game` layer; disabling the layer stops the intake and clears the round
- game rules (game choice, grid, emote mapping) are configured once under `Engagement`, because the same round continues across scene changes

## Operator Controls

Current operator controls include:

- restart encoder
- temporary fallback
- pin specific asset on air
- play now / insert, move next, replay previous
- skip current asset
- resume schedule control

Those controls are persisted in the playout runtime state and picked up by the worker/playout reconciliation loop.
Play now and Insert only queue the insert (`insertStatus: pending`); the next cycle's insert branch
selects it and switches to it. Restart, Hard reload and Skip (also by chat vote), and without the relay
also Pin, Fallback, Resume, Force reconnect and Recover outputs, set `restartRequestedAt`; the
reconnect standby slate follows that flag only in direct RTMP mode, because under the relay the uplink
owns the destination connection (`shouldShowReconnectSlate` in `apps/worker/src/playout-boundary.ts`).
Under the relay Pin, Fallback and Resume change the item through the ordinary switch at the next cycle,
and an item already on air keeps running (`runningAssetTargetMatches`). Operator actions end what they
replace (M78): a Skip of the item a Pin or Fallback holds on air clears the override in the same write,
and the override arm leaves out an item under a skip hold; which override holds the air is one rule
(`resolveOperatorOverrideHold` in `packages/core/src/operator-precedence.ts`; none under a Live Bridge,
whose arm comes first) that the override arm, the admin and the worker's chat all call. In the chat a
skip vote neither starts nor counts while an override holds, or the operator's Play now / Insert is
pending or on air (M79, `resolveOperatorHold`: the override rule, then the insert arm's conditions, and
for an insert that has aired, that no other item is on air; pool and cue point inserts never set the
insert fields and stay skippable), and a vote that passed is applied only to the item still on air and
not already held out (`decidePassedSkipVote`). A live selection ends an operator insert like any other
selection (`decideInsertAfterSelection` in `playout-boundary.ts`), and an insert that aired and cannot be
prepared again is ended once the fallback covers it (`decideInsertAfterPrepareFailure`). What each
control does is listed in `docs/operations.md`, *Operator controls*.

## Multi-Output Delivery

The runtime now supports multiple concurrent RTMP outputs per channel.

- healthy enabled `primary` destinations are treated as the active delivery group
- `backup` destinations take over only when no healthy primary group is available
- every destination, the built-in `destination-primary` and `destination-backup` included, stores its managed stream key encrypted at rest in PostgreSQL (setup wizard or `Studio → Output`)
- the two built-in records can still use env-based stream keys as a fallback; a stored key overrides the env key (`resolveDestinationStreamTarget`)
- direct mode lets playout resolve the active destination group and build a tee-muxer output when more than one destination is active
- relay mode moves that destination-group output to the uplink worker, keeping playout focused on producing the buffered local program feed

## Overlay Model

The overlay is drawn by the playout worker's own renderer from the published scene; the studio preview is the same drawing. There is no browser page to capture.

The overlay is internal output for Stream247's own 24/7 broadcast. It is not an external overlay product or a reusable third-party embed surface.

Current overlay capabilities:

- channel name
- headline
- accent color
- emergency banner
- clock toggle
- now/next teaser toggle
- schedule teaser toggle

The admin UI manages these settings; the playout renderer draws them onto the picture.

## Viewer Language

Everything the product itself says to viewers is written in one channel language (M80; `en` and `de`).
Operator content is never translated, and the admin interface is English.

- **The setting** is `channelLanguage` in the managed config, next to the channel time zone, and is
  resolved the same way by `resolveChannelLanguage` (`packages/db/src/instance-config.ts`): the env
  variable `CHANNEL_LANGUAGE` first, then the saved value, then English; an unknown value is English.
  The web app reads it through `getViewerLocale`, the worker, playout and uplink through the managed
  config each cycle refreshes.
- **The catalogue** is `packages/core/src/viewer-messages/`: `en.ts` is the reference (its keys are the
  catalogue's type), `de.ts` its German twin, `index.ts` the formatter. `viewerText(locale, key,
  params)` fills `{placeholders}`, chooses plural forms with `Intl.PluralRules` on `count`, and prints
  numbers without grouping; the on-air clock, upper-casing and the time zone's name are formatted for
  the language as well. Formatters are cached, because the renderer draws many frames. A lookup never
  throws: an unknown language or a key missing from one language is English, an unknown key is an
  empty string.
- **The picture** gets the language as `OverlayScenePayload.locale`, set where the time zone is set, so
  the studio preview and the playout renderer agree. The playout container rebuilds the poll, the skip
  bar and the game panels from database rows and passes the payload's locale there. The playout
  refreshes that payload on every cycle, whatever is on air. The standby and reconnect slate builds its
  payload from the schedule alone (`apps/worker/src/standby-slate.ts`) and caches it for the scene
  picture as well as writing the text slate (M102), so the slate never shows the item that played
  before it, and a language or time zone change made during a slate reaches the picture at once.
- **Shared words are split.** Where the admin and the viewers read the same state, the state keeps the
  admin's English (`Replay standby`, `Live Bridge`, the local library's source name `Local Media
  Library`, the playout message, the chat games' labels) and the viewer's text is taken from the
  catalogue on the way out: `localizeViewerBuiltInText` maps a built-in English text to its catalogue
  key and leaves everything else as written. The same rule makes a stored headline that still equals
  its English default follow the channel language without a migration. It compares the text, not the
  author — state does not record who wrote a title — so an operator's title, category or source name
  equal to a built-in text is shown in the channel language too (`docs/operations.md`, *What Viewers
  Read*).
- **The public page** `/channel` builds every word in `apps/web/lib/public-channel-view.ts` from the
  snapshot, which carries the language and the zone's name; the page sets `lang` on its own container,
  because the root layout's `<html lang="en">` also serves the admin. Since M100 the snapshot carries
  `programme` (`apps/web/lib/public-programme.ts`): the item on air (from the playout's process start and
  the asset's length), the next 24 hours item by item and the week block by block, all as UTC instants,
  built from `buildMaterializedProgrammingWeek` with every item listed (`maxListedItemsPerBlock`), so the
  page and the week view share the worker's rotation. The view writes the times in the browser's zone once
  the page has hydrated and in the channel zone before (server render and first paint agree); weekday and
  month names come from the catalogue, not from `Intl`, whose names differ between ICU builds.
  `/channel.ics` writes the week as RFC 5545 events (`apps/web/lib/public-programme-calendar.ts`).

### Adding a viewer language

1. Copy `packages/core/src/viewer-messages/en.ts` to `<code>.ts`, type it as `ViewerMessageCatalogue`
   (see `de.ts`) and translate every value. Keep the `{placeholders}` and the command words (`!game`,
   `!skip`, `!here`, `stop`, the game ids); give a message plural forms (`{ one, other }`, or the forms
   the language needs) wherever a number decides the wording.
2. Add the code to `VIEWER_LOCALES` in `types.ts`, and the catalogue, its `Intl` tag and its name in the
   picker to `VIEWER_MESSAGES`, `INTL_TAGS` and `VIEWER_LOCALE_LABELS` in `index.ts`. The compiler asks
   for each of them. The settings form, the setup wizard and `PUT /api/settings/instance` read
   `VIEWER_LOCALES` and need no change.
3. Run `pnpm vitest run tests/unit/viewer-messages.test.ts`: the parity test fails for a key that is
   missing or extra and for a placeholder that differs from English in any plural form.
4. Measure the texts that share a row on the picture. `tests/unit/viewer-language-fit.test.ts` lays the
   German poll, skip and game headers out in the renderer's fonts and fails when one needs more room
   than its panel; extend it to the new language rather than counting characters. Then add the language
   to the surface tests (`viewer-language-surfaces`, `viewer-language-chat`,
   `viewer-language-public-page`), which read every viewer surface in each language.

## Alerting And Incidents

Current operational domains:

- incidents
- incident history and readiness context in `Live → Status`
- the as-run log of the last 24 hours in `Live → Status` (M76)
- acknowledgements
- resolution state
- runtime drift checks
- recent audit trail visibility
- audit events
- Discord alerts
- SMTP email alerts
- health/readiness endpoints

## Secret Management

Stream247 now supports encrypted-at-rest managed credentials in PostgreSQL for:

- Twitch client id and client secret
- default Twitch category id
- Discord webhook URL
- SMTP host, port, user, password, sender, and recipient

Implementation model:

- values are encrypted before persistence
- setup can optionally capture Twitch client credentials
- `/settings` can update managed credentials later
- blank secret fields preserve the currently stored secret
- `.env` remains a fallback source when no managed value exists

## Major Known Gaps

- richer multi-scene overlay composition
- more advanced playout transitions and switchovers
- deeper analytics and incident correlation views
- richer schedule authoring directly in the timeline
