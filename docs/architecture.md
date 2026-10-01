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
finished VOD download writes only the asset's cache columns.

Ingest lists items; it does not decide how they play. Playback URLs are resolved by the playout
process (the `playout` container), just before an item airs and in the queue prefetch. A YouTube item
is resolved through ordered format candidates (`apps/worker/src/playable-input.ts`) and may play as a
video+audio pair, which playout opens as two ffmpeg inputs.

Twitch VOD assets keep their original Twitch URL as the source path, but the worker prepares a verified local cache file before using the asset for playout. Cache metadata is stored on the asset record, and the internal `.stream247-cache` tree is excluded from local-library discovery so cached archive files do not become duplicate programming assets.

## Scheduling

The schedule model is block-based and timezone-aware.

Current schedule capabilities:

- weekly block-based scheduling
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
materialized week all use this one rotation; the previews start every block from the stored position
rather than from where the previous block's preview ended. The runtime queue walks on from the running
item only in the cycle that starts and stores it; an item the pool never stored (one another pool on the
same source started, or a manual next) leaves the queue on the stored position, where the next pick comes
from. A started pool item stores the cursor and
its source's position in one serialized write; an insert moves neither, and a pool edit keeps both
(it drops only the positions of sources it removed).

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

- a game is a pure state machine in `packages/core/chat-game.ts`: settings, `applyInput`, and `renderModel` — deliberately no tick, so a game only ever advances on accepted chat input
- Snake is the first game: every emote maps to one direction (configurable, four distinct emotes), and the snake moves exactly one cell per accepted message
- the worker consumes broadcast-channel chat, applies inputs in arrival order, and persists the round in `chat_game_runtime`, so a worker restart resumes the round
- the playout container re-derives the render model from that record and draws it wherever a scene has an enabled `Chat Game` layer; disabling the layer stops the intake and clears the round
- game rules (game choice, grid, emote mapping) are configured once under `Engagement`, because the same round continues across scene changes

## Operator Controls

Current operator controls include:

- restart encoder
- temporary fallback
- pin specific asset on air
- skip current asset
- resume schedule control

Those controls are persisted in the playout runtime state and picked up by the worker/playout reconciliation loop.

## Multi-Output Delivery

The runtime now supports multiple concurrent RTMP outputs per channel.

- healthy enabled `primary` destinations are treated as the active delivery group
- `backup` destinations take over only when no healthy primary group is available
- the built-in `destination-primary` and `destination-backup` records can still use env-based stream keys
- additional destinations store managed stream keys encrypted at rest in PostgreSQL
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

## Alerting And Incidents

Current operational domains:

- incidents
- incident history and readiness context in `Live → Status`
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
