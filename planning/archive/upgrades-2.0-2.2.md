# Upgrade Notes For 2.0, 2.1 And 2.2

The sections *Upgrading To 2.0*, *Upgrading To 2.1* and *Upgrading To 2.2* of `docs/deployment.md`, moved here
unchanged on 2026-11-25 (order audit); *above* and *below* in them point into `docs/deployment.md` as it was then.

### Upgrading To 2.0

2.0 is a major because three things an existing installation may notice change at once:

- **The `redis` service leaves the stack.** Nothing ever connected to it (see *Removed Redis Service*
  below). A stack that still defines it — the Portainer stack did until 2.0 — loses one container at
  the update, and the four services that declared `depends_on: redis` are recreated once. `./data/redis`
  stays on disk as an empty directory and can be deleted by hand. `REDIS_URL` is ignored.
- **Controls that never did anything are gone from the studio** (M60): the scene's schedule-teaser and
  queue-preview toggles, website-embed and widget layers, the engagement chat mode, style and alert
  position. Stored values are kept and the API still accepts the fields, so a blueprint or a saved
  draft from 1.5 imports unchanged; the fields simply no longer appear. "Show clock" and "Show next
  item" now do what they say — an installation that had them switched off will see the clock and
  the next card disappear from the picture after the upgrade. Switch them back on in `Studio → Scene`
  if that was not the intent.
- **The library upload accepts only what the scan ingests** — mp4, mkv, mov, m4v, webm. `.avi` and
  audio files used to be copied to disk and ignored; they are now refused at upload with the list of
  accepted formats.

Also new, not breaking: every field carries an (i) explanation; the uplink tolerates a boundary seam
of up to 60 s (`-dts_delta_threshold 60`) and logs the seam skew; a replay download gets at least the
content's running time; a replay that airs again within the retention horizon stays cached.

Automatic programming also stops choosing an item whose source will not serve it. Three consecutive
failed prefetch probes take an item out of automatic selection; one clean probe puts it back, and the
asset page grows a **Clear probe failures and retry** button while an item is out. A warning incident
per source (`playout.source-unplayable.<sourceId>`) names how many of its items are being skipped and
stays open until the source serves them again. `include_in_programming` is never touched: what the
operator chose stays theirs. Expect this incident to appear at the upgrade if a source has rotted —
that is the point of it, the items were already being skipped silently.

Upgrade path: back up PostgreSQL, repin the three `STREAM247_*_IMAGE` tags to `v2.0.0`, redeploy.
Rollback is the reverse repin; the schema changes in 2.0 are additive.

### Upgrading To 2.1

2.1 changes no stack file; it is a repin of the three `STREAM247_*_IMAGE` tags. It adds one column,
`pools.source_cursors` (migration `20261001_001_pool_source_cursors`, additive, applied on the first
start), so back up PostgreSQL before the repin. One new managed setting (`twitchBotLogin`, env fallback
`TWITCH_BOT_LOGIN`) lives in the existing managed configuration. Rollback is the reverse repin: an older
image ignores the new column; see *Pool source alternation* below for what a rollback and a later
re-upgrade do to a pool's position.

- **Twitch accounts.** Admin → Settings has a new *Twitch accounts* panel that separates the broadcast
  channel (where the stream key sends video and viewers watch) from the bot account (chat,
  moderation). The broadcast channel login moved there from *Managed credentials*; its stored value is
  kept. The existing bot connection keeps working without reconnecting. New:
  - the bot connect refuses another account than the configured bot login, and the broadcast channel
    itself while a split is set up (nothing stored, token revoked, audited as `twitch.bot.rejected`);
    both connect flows make Twitch show which account is signing in;
  - alerts target the broadcast channel: follow with the bot as moderator; sub, cheer and
    channel-points only once the channel owner is connected, whose connection now also asks for their
    read scopes — **a channel owner connected before 2.1 must reconnect once** to grant them (the panel
    and the info incident `twitch.eventsub.waiting-for-channel-owner` say so). Stream247's old
    subscriptions on the bot account's own channel are removed on the first sync;
  - labels that called the bot "broadcaster" say "bot account"; the live header shows both accounts.

- **YouTube playback.** A YouTube item is resolved through ordered format candidates (split
  H.264+AAC, any split tracks, a combined file, split tracks at any height) instead of
  `--format best`, which YouTube no longer serves for most uploads, and may play as two ffmpeg inputs
  (video and audio). A candidate that resolves but cannot be opened is skipped for that item for
  30 minutes. `STREAM247_YOUTUBE_PLAYBACK_FORMATS` overrides the list (yt-dlp selectors separated by
  `|`). A live-source PiP over a split YouTube item attaches video-only, since the programme sound
  is its own input.
- **The programme on air keeps its input.** Playout no longer re-resolves the item it is playing
  every cycle; before 2.1 a failed re-resolve switched a running YouTube item to the fallback after
  about 18 seconds.
- **Quarantine.** The counters behind *three failed probes take an item out of automatic selection*
  now survive whole-state writes (before 2.1 any of them reset every counter) and count each probe
  result once. Expect items that were silently rotating back onto the air to stay out after the
  upgrade; the asset page's **Clear probe failures and retry** puts one back by hand.
- **Item order.** Each source of a pool plays its own items oldest first by publish date, else by the
  date Stream247 first saw the item; a Twitch channel's archives first seen in the same sync follow
  their VOD id, and then the title and the asset id decide. Which source plays next is the *Pool source
  alternation* below. Before 2.1 every source sync stamped its items with the sync time and no listing
  carried a date, so a pool really played each source alphabetically. A sync now keeps an item's first-seen date, a publish date once known and a
  known duration. YouTube channel and playlist listings ask yt-dlp for approximate publish dates
  (`youtubetab:approximate_date`): YouTube's relative age ("3 months ago") counted back from the sync
  time, so older items fall into shared month or year buckets and order by title inside one; the first
  value seen is kept. Items already in the catalog keep the time of their last 2.0 sync as their
  first-seen date, and a Twitch archive that drops out of a listing and comes back is first seen again
  and plays after the newer ones. Expect the order, and so the next item, to change once after the
  upgrade. A finished VOD download now writes only its cache columns instead of reverting the item's
  title, category, dates and include flag to what they were when it started. When a Twitch VOD cannot
  be prepared and there is no global fallback, the bridge is still a library file before a remote item
  of the same fallback priority, whatever their dates.
- **Pool source alternation.** A pool with several sources now alternates between them: the next item
  comes from the next source in the order the pool lists them, and each source plays its own items
  oldest first, looping from its own position (stored in the new `pools.source_cursors` column, added
  by migration `20261001_001_pool_source_cursors`). A TwitchYoutube-style pool that played one long
  source block after the other switches to Twitch, YouTube, Twitch, ... on its first pick after the
  upgrade: its stored cursor is a Twitch archive, so the first pick is the oldest YouTube item, and
  Twitch then carries on after that archive. A pool with one source plays as before. Skip, a
  quarantined or cooling-down item and an excluded item no longer send the pool back to its oldest
  item; it carries on after them. Editing a pool keeps where it stands (an edit used to write back the
  position it had read, which could undo an item the worker had just started). The schedule preview
  and the week lens show the alternation, and an insert asset whose cadence is 0 appears there as the
  ordinary item it plays as. An item that has left the catalog (a Twitch archive that dropped out of a
  listing) cannot be continued after: its source restarts at its oldest item, while the alternation
  goes on. **Rollback and re-upgrade:** an image older than 2.1 moves only the pool's cursor and leaves
  `source_cursors` as it was (or empties it on a whole-state write). Back on 2.1, the source of the
  cursor carries on after the cursor; the pool's other sources carry on from where 2.1 last left them,
  or from their oldest item if the map was emptied, so they may repeat items the older image aired in
  between.
- **Operator controls.** Play now and Play insert switch straight to the chosen item at the next
  playout cycle; before 2.1 they put the reconnect slate on air for one cycle, dropped the insert
  without a trace and started a different pool item from its beginning. With the relay no operator
  action shows the slate any more (direct RTMP mode keeps it for restarts); Pin and Fallback switch at
  the next cycle without a restart, Force reconnect is refused and Recover outputs leaves the programme
  alone, because the uplink owns the connection. Play now refuses the item on air, an item under a
  skip hold, any item while a Pin or Fallback runs, and a Twitch archive that is neither downloaded nor
  allowed to play from Twitch; a dropped insert is logged (`playout.insert.dropped`, runtime event and
  audit row), an insert ended by its duration bound or a feed watchdog no longer replays, Resume
  cancels a Play now, Replay previous has an item again (shown as *Previous item*), and a Move next or
  Replay previous item from outside the running pool plays to its end instead of being cut after one
  cycle. After an insert the pool continues with its next item; the interrupted item is not resumed.
  See `docs/operations.md`, *Operator controls*.

### Upgrading To 2.2

2.2.0 was not released (*Upgrading To 2.3* below): these notes describe the six changes of
2.2.0-rc.1, which ship with 2.3.0, and still apply to that upgrade.

The release after 2.1.0 carries six changes at once (M75, M76, M78, M79, M80, M82). As one upgrade:

- **Stack and schema.** No stack file changes; it is a repin of the three `STREAM247_*_IMAGE` tags. Two
  tables are added: `source_breakers` (migration `20261001_002_source_breakers`) and `as_run_log` with
  its two indexes, `as_run_log_started_at_idx` and the partial `as_run_log_open_idx` (migration
  `20261001_003_as_run_log`). Both migrations are additive and applied on the first start, and the same
  statements are in the base schema for a fresh install. Back up PostgreSQL once before the repin. Both
  tables start empty.
- **After the repin.** The next-item poll and the skip bar are English until the channel language is
  set; a channel that relied on the German panels sets it to German (*Viewer Language* below). Where
  egress from the playout container is filtered, allow it to reach the output hosts (*A Network Outage
  Is Not A Source Fault* below).
- **Rollback** is the reverse repin. An older image ignores both tables and the language setting and
  restores the old behaviour. Two things it leaves for the operator: an open
  `playout.source-breaker.<sourceId>` incident, which it never resolves, and the as-run row that was on
  air, which stays open until a re-upgrade (*Source Circuit Breaker* and *As-Run Log* below).

The six notes below say what each change does, and what a rollback does to it.

#### Source Circuit Breaker (M75)

Adds the table `source_breakers`. It starts empty, which means every source is in play, exactly as
before.

- **What changes.** When the playout's probes fail on three different items of one source with no clean
  probe of it in between (a Twitch archive still downloading does not count), every pool passes that
  source over for 30 minutes (doubling on every failed
  retry, at most 6 h) and then tries one item of it; a clean probe brings it back. One incident per held
  source, `playout.source-breaker.<sourceId>`, which stands in for that source's
  `playout.source-unplayable` incident while it is open. The source page shows the hold and offers owners
  and admins **Close breaker now**. See `docs/operations.md`, *A source is held out of programming*.
- **Rollback.** An older image ignores the table, so a held source is in play again at once; per-item
  quarantine is unchanged. It does not know the breaker's incident either: a
  `playout.source-breaker.<sourceId>` incident that is open at the rollback stays open, although the
  source is back in the rotation, until it is resolved by hand under `Live → Status`. A later re-upgrade
  reads the rows as they were left: a breaker whose cooldown ran out in between is half-open and tries
  one item at the next pick, and an incident still open is resolved by itself once its breaker is
  closed.

#### As-Run Log (M76)

Adds the table `as_run_log` with two indexes: `as_run_log_started_at_idx` and the partial
`as_run_log_open_idx` (the open row, which every start closes). The table starts empty; the first
playout start after the upgrade writes the first row.

- **What changes.** Every playout process run leaves one row: what aired, how, and why it ended. The
  *On air, last 24 hours* panel on `/live?tab=status` and `GET /api/as-run` read it; see
  `docs/operations.md`, *What was on air at a given time?*. The playout writes it without waiting for the
  database, so a slow or failing write (logged as `as_run.write_failed`) never delays a switch. Rows are
  kept 90 days; at a few hundred starts a day that is a few tens of thousands of rows, a few megabytes.
- **After the repin.** The playout container's restart closes nothing (the table is empty); from the
  second redeploy on, the run that was on air is closed as `process-gone` at the new playout's boot.
- **Rollback.** An older image ignores the table and writes no rows; the rows written so far stay. The
  row that was on air at the rollback stays open (the panel shows it as on air) until a later re-upgrade
  closes it as `process-gone` at its first boot, with that boot as its end: a `process-gone` end is
  only an upper bound.

#### Operator Precedence (M78)

Behaviour only: no table, no migration. Operator actions end what they replace,
and viewers never override the operator:

- **Skip during a Pin or Fallback** ends the override (the audit row says so) and the schedule
  continues; before, the pinned item started again from its beginning. Pinning an item a Skip holds out
  lifts that hold.
- **A Live Bridge takeover** ends an operator insert: one on air is not replayed after the release, a
  pending one is dropped (`playout.insert.dropped`, `live-bridge`). Play now is refused while the bridge
  is pending or on air.
- **Chat skip votes** neither start nor count while a Pin or Fallback holds the air; the bot says why,
  at most once a minute. A vote that passed is dropped when its item has left the air before the worker
  applies it, or a Skip already holds it out (`chat.skip.stale`); before, it overwrote the skip hold and
  restarted whatever was on air.
- **Rollback.** An older image restores the old behaviour; nothing is stored that it would misread.

See `docs/operations.md`, *Operator controls*.

#### Chat Never Skips An Operator Insert (M79)

Behaviour only: no table, no migration. Chat skip votes neither start nor count
while the operator's Play now / Insert is pending or on air, a vote that passed just before is not
applied (`chat.skip.paused` with `hold: insert`, audit row `chat.skip.refused`), and the bot says why at
most once a minute, sharing the cooldown with the Pin and Fallback lines. Before, a passed vote cut the
insert. A pool's automatic insert and a cue point insert stay skippable. The pause follows what is on
air: an insert that could not be prepared again after a Soft restart or a redeploy of the playout
container, with the fallback covering it, pauses nothing, and the next cycle ends it
(`playout.insert.ended`, `prepare-failed`, runtime event and audit row) so the schedule continues;
before, it was resolved again on every cycle with the fallback on air until Resume schedule. An older
image restores the old behaviour; nothing is stored. See `docs/operations.md`, *Operator controls*.

#### Viewer Language (M80)

No table, no migration. The new channel language lives in the managed config
next to the time zone and is English until someone sets it, so an upgraded channel keeps speaking
English. To switch a channel to German, choose `German (Deutsch)` under `Admin → Settings → Channel
language`. That route needs no restart: the chat bot, the Twitch title and the public page follow with
their next refresh, and the picture with the next playout cycle while a programme is on air (during a
standby or reconnect slate the picture changes when the next programme starts, as with the time zone).
`CHANNEL_LANGUAGE=de` in the environment does the same and beats the saved value, but it is an
environment change like any other: the running containers do not see an edited `stack.env` until they
are recreated (`docker compose up -d`, or a redeploy in Portainer). The admin interface stays English.

What changes on air without touching the setting:

- The next-item poll and the skip bar were German on every channel. They now follow the channel
  language, so a channel that relied on the German panels must be set to German after the upgrade.
- English wording, fixed on purpose: `No next block configured` and `Nothing scheduled next` are now
  `Nothing scheduled`; the standby state reads `Stand by` everywhere (was `Standby`, `Replay standby`
  and `Please wait, restream is starting`, now `Stand by, we’ll be right back`); the bot's no-room
  reply says `1 layer`. In German, `1 von 1 Stimmen` is now `1 von 1 Stimme`.
- The public page `/channel` names the time zone (`Central European Time`) instead of printing its
  IANA id, and shows a viewer's status line where it printed the playout's status message.

Stored values are not migrated. The studio's six built-in headlines stay in the database in English;
a value still equal to its English default is shown in the channel language, anything you wrote is
shown as written (`docs/operations.md`, *What Viewers Read*). An older image ignores the setting and
restores the old texts.

#### A Network Outage Is Not A Source Fault (M82)

Behaviour only: no table, no migration, no new setting. A probe that fails with a
network error (name resolution, connecting, a timeout) while the channel's own way out is down is
counted neither by per-item quarantine nor by the source breaker (M75); the log has
`playout.probe.network_outage` instead. See `docs/operations.md`, *The channel's own network was down*.

One thing the playout container does that it did not do before: when such a failure is about to be
counted, it resolves the host of each enabled output (`live.twitch.tv:1935` for the default Twitch
output, at most two hosts) and opens one TCP connection to it, closed at once, at most once per ten
seconds. In relay mode only the uplink container talked to that host until now. Where egress from the
playout container is filtered, allow it to reach the output hosts: if it cannot, every network-looking
probe failure reads as an outage and goes uncounted, so a remote host that is really down is no longer
quarantined or held for that kind of error. An older image counts every failed probe again; nothing is
stored.
