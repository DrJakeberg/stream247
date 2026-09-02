# Changelog

## Unreleased

## 1.5.37 - 2026-09-01

### Fixed

- A rejected Twitch connect attempt marked a working connection broken, and three features went
  quiet behind it. Measured on the running DUT on 2026-09-01: the identity connection record read
  `status: error` with the message about a callback arriving without a matching state cookie, while
  the token stored beside it had been issued minutes earlier, validated against Twitch with all
  nine scopes including `chat:read` and `chat:edit`, and was carrying a live IRC session that had
  completed its handshake and stayed up. `lastMetadataSyncAt` was empty — it had never run once.

  `recordTwitchError` wrote the error status unconditionally. Directly beside it, the broadcaster
  slot's equivalent has always refused to downgrade a connected slot for exactly this reason; the
  identity slot never got that guard. So a double-clicked connect button, a stale tab, or a second
  callback arriving late was enough to take a healthy connection down. Metadata sync, moderation
  sync and event registration are all gated on the connected status, so all three stopped at once:
  the emote-only switch was never toggled even though the presence calculation correctly asked for
  the normal chat mode from three active windows, Twitch stayed on emote-only, and
  `twitch.eventsub.sync.skipped` reported registration skipped for a connection that was not
  actually missing. To the operator this looked like the check-in command doing nothing, when the
  command had in fact been recognised and had created its presence windows.

  Both slots now share one decision, and it turns on what a failure is evidence *about*. A rejected
  connect attempt says nothing about the token already stored and cannot touch the status. A
  failure of the stored connection itself — a revoked or expired token, the shape a refresh reports
  as a 401 — still marks it broken, because suppressing that would leave the dashboard claiming a
  connection that cannot do any work. Every failure still reaches the audit trail either way.

### Added

- The Twitch connection status now has a second source: measurement. The error status was written
  from memory — something failed once, and the record kept saying so — which left the install above
  with no way back that did not involve another trip through OAuth for a token that was fine the
  whole time. When the record says broken and a token is still stored, the worker now asks Twitch
  whether that token works and what it may do, and puts the connection back to connected when the
  answer is at least as capable as reconnecting would be. It only ever moves in that one direction:
  deciding a connection is broken stays with the code that actually tried to use it. Triggered by
  the error status rather than by a timer, so a healthy connection is never re-checked, and limited
  to one check per ten minutes so a permanently dead token cannot turn into steady background load
  against Twitch's rate limit. Every outcome is logged, including the three different reasons not
  to heal: a rejected token, a valid token whose grant is too short, and an unreachable Twitch that
  told us nothing.

### Changed

- The dashboard's Twitch card speaks. It printed the stored status value directly, so an operator
  read the single word "error" above a raw upstream message, and a workspace that had never
  connected read a hyphenated database token. Neither said the thing that mattered — that title and
  category updates and the emote-only switch had gone quiet behind that one word. The card now
  names the state in ordinary language, names what is paused while it lasts, and distinguishes a
  connection that is repairing itself from one that genuinely needs the account connected again.
  The stored message stays available underneath rather than leading.
### Fixed

- Chat games and emotes, three things the adversarial review of that change found and measured
  before it shipped. A studio already holding its maximum of eight custom layers accepted `!snake`,
  silently dropped the ninth layer the game needed, still flipped the overlay on and still told the
  room "Snake is on air" while nothing was drawn; a start the store has no room for is now refused
  with a reply that says so, and nothing is written. On the broadcast renderer a message at every
  documented limit — a 14-glyph name, six emotes, 40 characters — drew its emote row 84px past the
  chat panel onto bare video and squeezed the chatter's name to 0px; the name is now fixed and the
  row yields. The same measurement showed a fault older than emotes: satori applies `lineClamp`
  only to a block container, and the text label was flex, so a wide message had always drawn two
  lines where the panel's height budget assumes one. And a bare game name typed in passing —
  "2048" — started a round, because the parser copied the check-in's optional "!"; starting or
  stopping now needs the bang, while asking about the games still answers without it.
- The chat overlay drew emote codes as words. Twitch never sends emote pictures: a PRIVMSG carries
  the literal text plus an `emotes` tag naming which ranges of that text are emotes. The bridge's
  IRC parser read `display-name`, `badges`, `mod` and `id` out of the tags and dropped `emotes`
  entirely, so nothing downstream could tell "Kappa" the emote from "Kappa" the word, and the panel
  had no choice but to draw the word.

  The tag is now read into ordered occurrences, split into text runs and emote pictures once per
  message (not per frame), carried through the `chat_overlay_messages` row, and drawn as inline
  `<img>` nodes. Positions are counted in code points, which is Twitch's own unit — slicing the
  raw string would put every emote after an emoji two characters off — and the trim the parser
  already applied shifts them by the same amount.

  Measured against satori 0.29 and resvg on this machine, 1920x1080: a text-only frame rasterises
  in ~81ms (satori 2.9ms, resvg 78ms). One emote by https URL costs satori 61.6ms cold and 12.8ms
  once satori's own image cache is warm; the same emote inlined as a data URI costs 2.0ms. At the
  renderer's one-frame-per-second cadence the URL path is affordable, so no separate image cache
  was added.

  What did need care: satori determines an image's intrinsic size by fetching it, and on a failed
  fetch it throws `Image size cannot be determined` — which loses the whole frame, not just the
  emote. Measured: twelve emote URLs of which two 404 threw the entire render; one unresolvable
  host threw in 2.5ms. Declaring `width` and `height` on the image node makes satori skip the
  unreachable picture and render everything else (~19ms). Every emote node therefore carries a
  declared size, and a smoke test rasterises a frame with a deliberately unresolvable emote host to
  hold that property. The stored emote address is also pinned to `static-cdn.jtvnw.net/emoticons/`
  on the way into and out of the row, so text a stranger typed can never become an outbound request
  to somewhere else. No schema change: the segments live inside the existing `messages` jsonb
  column, and a row written before this change simply has no segments and draws as plain text.

  Twitch sends the `emotes` tag to every member of the room and serves the pictures from an
  unauthenticated CDN, so this works with the moderator account exactly as it would with the
  broadcaster's.

- The chat game's direction emotes did nothing. `reconcileChatGame` treats a game as active only
  while `overlay.enabled` is true *and* some scene layer of kind `game` is enabled — and a fresh
  install has `enabled: false` and `customLayers: []`. Every `⬆` the room sent was resolved against
  a runtime with no settings and no state and was discarded silently. There was no way for a viewer
  to fix that and no way for an operator to guess it: the only cure was adding a Chat Game layer by
  hand in Scene Studio first.

- Chat had no way to ask about games or start one. `!game` now answers in chat with what is
  running, the games there are, and how to steer them; `!snake`, `!minesweeper` and `!2048` start a
  round and `!game stop` ends it. The "!" is optional, matching the moderator check-in, and a
  command must be the whole message — talking about snake cannot start one.

  Starting a round provisions what it needs: it enables the overlay and adds an enabled Chat Game
  layer, using the studio's own default placement so the operator can move, rename or switch off
  afterwards exactly as usual. An existing game layer is re-enabled rather than duplicated, and
  stopping switches the layer off while leaving the overlay published — chat started the game, it
  did not publish the overlay. The reconcile runs immediately rather than on the next 30s cycle, so
  a board appears while the viewer is still looking. Info is open to the room; starting and
  stopping require the moderator badge Twitch puts in the message tags, because they change a live
  broadcast — no broadcaster right and no API call is involved. Commands do real work at most once
  every five seconds, so a room typing in unison cannot become a write storm.

## 1.5.36 - 2026-09-01

### Fixed

- The audit trail held nothing but heartbeats. `audit_events` is a ring buffer capped at 100 rows,
  and the worker and uplink loops each wrote a routine entry into it every 30 seconds. Measured on
  the running DUT on 2026-09-01: all 100 rows were `worker.cycle` (32) and `uplink.cycle` (68), and
  the oldest of them was 17 minutes old. Not one security-relevant entry had survived. Everything
  the trail exists to answer was gone within about a quarter of an hour — Twitch account
  connections and their OAuth callbacks, `relay.internal_key.revealed` (added specifically so that
  reading a secret leaves a mark), rejected relay publishes, sign-ins, settings changes. An earlier
  review had noted that the rate limit bounds repeated harvesting without making the audit line
  durable; this is that gap, measured.

  Routine liveness and security evidence no longer share a table. The worker loop records
  `playout_runtime.worker_heartbeat_at`, beside the playout and uplink heartbeats that were already
  there, and the uplink loop simply stops writing `uplink.cycle` — it had already written
  `uplink_heartbeat_at` on every path it can exit through, so the audit entry was only ever the
  noisier copy of a timestamp the runtime row already held. With no routine writer left, a
  security-relevant entry cannot be displaced by routine traffic at all; the property holds by
  construction rather than by a retention policy that has to keep classifying events correctly.

  All five readers move to the runtime heartbeat: system readiness, `getWorkerHealth`, the incident
  area classifier that decides whether the worker area is healthy, and the worker and uplink
  healthchecks. The scheduled-reconnect path turned out to be the one uplink exit that never
  awaited a heartbeat write of its own — it relied on a fire-and-forget write in the process exit
  handler — so it records one directly now.

  The retention bound rises from 100 to 500 and becomes a single shared constant, because the
  prune, the hydrate `LIMIT` and the persist slice all have to agree or the table silently
  truncates on the next state write. 500 covers weeks to months of operator activity now that the
  routine traffic is gone, and just under an hour of the worst case an attacker can drive — the
  relay throttle caps rejected-publish entries at ten a minute — against ten minutes before. The
  table still travels with the full state serialisation, so it stays bounded; at the 85 bytes a row
  measures, 500 rows is about 42 KB, proportionate to the sync-run and incident tables already
  carried alongside it. The per-row insert in that rewrite became one batched statement so the
  higher bound does not land on every state write.

  Schema: `20260901_001_worker_heartbeat_runtime`, additive. Existing rows keep their data and
  start with an empty heartbeat, which reads as "missing" exactly as an absent `worker.cycle` entry
  did, until the worker completes its next cycle at most 30 seconds later.

  Visible change: the per-source activity panel in the admin UI now shows only real events. It was
  already filtered by source, so in practice it had been showing nothing at all.

## 1.5.35 - 2026-08-28

### Fixed

- Twitch chat never connected, and said it did. The identity OAuth flow asked for seven scopes,
  none of them `chat:read` — but the IRC bridge authenticates with that same token, so Twitch
  refused every login. Measured against the running DUT on 2026-08-28: `/oauth2/validate` returns
  the token's scopes with no chat scope among them, and an IRC handshake using it answers
  `:tmi.twitch.tv NOTICE * :Login unsuccessful` and closes the socket ten seconds later. The bridge
  saw none of that. `parseTwitchIrcMessage` matches PRIVMSG and nothing else, so the refusal fell
  through unread, and `sync()` reconnected into the same refusal on every worker cycle — roughly
  fifteen seconds connected, fifteen seconds gone, around the clock. It also wrote its `connected`
  status from the TLS connect callback, before Twitch had looked at the token at all, so the stored
  status alternated `connected`/`disconnected` and read as a flaky network rather than a login that
  could never succeed. Every poll closed `no-votes` with `voterCount: 0` because no chat line ever
  arrived. Four changes: the flow now requests `chat:read` and `chat:edit`; the bridge reads NOTICE
  and recognises Twitch's refusal wordings; `connected` is reported only on the `001` welcome, the
  one signal that means the token was accepted; and a refused login goes into a five-minute
  cooldown keyed to the token, so it stops hammering Twitch but retries immediately once the
  operator reconnects the account. The refusal is raised as a Twitch incident quoting what Twitch
  said, resolved by the next real login, and the opening handshake lines are logged — capped, and
  never the token — so the next occurrence is readable from the log instead of inferred from socket
  counts. PING/PONG was checked and was already correct; it was not the cause.
  **Existing installs must reconnect the Twitch account once**: tokens already stored carry the old
  grant, and no code change can add a scope to a token Twitch has already issued.

- a source that answers with nothing no longer closes its own incident. v1.5.34 made the resolve
  per source, which was necessary and not sufficient: it keys on `failedSourceIds`, and a listing
  that comes back empty without throwing never enters that set. So both connector syncs still
  finished such a run with `resolveIncident("source.<kind>.<id>")`. A Twitch archive listing that
  comes back empty does not throw, so on 2026-08-27 each 30-second cycle wrote a `skipped` run with
  zero discovered assets and then re-closed the one entry that could have explained the hours of
  filler — and the same call erased entries a genuine failure had raised a cycle earlier. The
  source row said "Ingestion failed" while the incident list said nothing at all. The two halves
  now compose: the per-source gate says whether this cycle's ingest was clean, the run history says
  whether the source is actually delivering, and a resolve needs both. A gate-only resolve still
  closes the entry for a source that answered with nothing; a history-only resolve still closes it
  for a partial `scanMediaFiles` walk that returned files while a directory was unreadable. A
  source that has stopped delivering is reported under the same existing fingerprint, which
  `incident-classes.ts` already registers as a state in the source area: it holds while the drought
  holds and the next delivering run closes it. No new family, so one broken source cannot appear
  twice. Reporting waits for three consecutive barren checks — one empty listing is the blip the
  v1.5.33 asset-preserve rule absorbs correctly, and at the 30s worker cadence three is still under
  two minutes. A source with nothing stored that no pool draws on stays out of the list: that is a
  setting, not an incident, and an entry no action can close is the failure M58 removed
- the Twitch sync reconciles its incidents after the loop, like the YouTube sync. The call sat
  inside the per-source `try`, which the invalid-URL branch `continue`s past — so the one source an
  operator is most likely to be in the middle of fixing was the one whose entry never resolved

### Changed

- the sources page says what it knows instead of printing what it stored. It showed the last run's
  summary next to a raw ISO timestamp, the last-synced stamp again above that, and three counts
  ending in "pool refs" / "schedule refs" — none of which answers "is this happening now" or "does
  the programme care". It now reads "Last checked 4 minutes ago, found 49 videos", or "Nothing came
  back the last 3 times, the first of them 12 minutes ago. The 49 stored videos stay playable.",
  and once a drought is long enough to matter it names the scheduled blocks it reaches and whether
  they still have anything to play. That source → pool → block chain already existed in
  `getSourceReferences` and had never been said out loud; it is what nobody could see on the day.
  The same sentences go into the incident message, so the live status view carries the consequence
  rather than only the fault. Text only — no control was added, so the page's density budget is
  unchanged. This sits one level above v1.5.34's `describeSourceSyncStatus`, which stays the
  authority on what a single sync did to the archive and keeps writing the status badge and the
  source note; the sentence describes the run history the badge cannot see — how long the drought
  has run and what it costs the schedule — and reports the count of still-playable items rather
  than repeating the badge's "(assets preserved)" back at the operator two centimetres away

### Removed

- the `redis` service. It is not being retired after outliving its use — it was never used at all.
  Compose provisioned a `redis:7-alpine` container with a `./data/redis` volume and a `redis-cli
  ping` healthcheck, and `web`, `worker`, `playout` and `uplink` each declared
  `depends_on: redis: condition: service_healthy`, so four services waited on a container no code
  ever opened a connection to. There is no redis client anywhere in `apps/` or `packages/` and no
  `redis` or `ioredis` dependency in any `package.json`. The single thing that ever read `REDIS_URL`
  was `packages/config`'s `getConfig`, deleted outright in M56 part 1 as dead code; the container
  it pointed at outlived it by four milestones. Removing it takes a container, a bind mount, a
  healthcheck and four start-order gates out of every install, and shortens cold start by however
  long the redis healthcheck took to pass. Also gone from `docker-compose.dev.yml`, the five
  scripts that generate their own stacks (`dev-stack.sh`, `e2e-smoke.sh`,
  `fresh-compose-bootstrap-smoke.sh`, `queue-continuity-smoke.sh`, `runtime-parity-smoke.sh`), both
  `.env` examples, and the docs that described it as part of the persistence model. No smoke script
  needed a count adjusted — they all assert on service names, not on how many containers came up.
- for operators, at the next stack update: the `redis` container is stopped and removed and the
  stack starts one service fewer. Its bind mount `./data/redis` remains on disk as an empty
  leftover directory and can be deleted by hand whenever convenient. Nothing to migrate and nothing
  to back up first, because nothing was ever stored in it. A stale `REDIS_URL` left in an existing
  `stack.env` is inert. This does not reach a running install on its own — it lands the next time
  the stack file itself is updated, not when image tags are re-pinned

## 1.5.34 - 2026-08-28

### Fixed

- a broken media mount no longer deletes the local library, the global fallback with it. The audit
  that followed the v1.5.33 sync wipe found the same absence-of-evidence shape four more times, and
  this one was worse than the original: `walkMediaFiles` wrapped the whole recursive scan in
  `catch { return []; }`, so an unmounted volume, an NFS timeout, EACCES, EMFILE or a single
  unreadable subdirectory was indistinguishable from an empty library — and `syncLocalMediaLibrary`
  then handed that empty list to `replaceAssetsForSourceIds` and deleted every local asset. Where
  the Twitch incident dropped the channel onto the standby video, this path deleted the standby
  video too, and the emptied `state.assets` then defeated `collectDiskProtectedAssetIds`, releasing
  the VOD cache and thumbnails of still-scheduled assets to the watermark sweep. `scanMediaFiles`
  now reports whether the walk completed, and a scan that did not is fed to the same
  `decideSourceAssetReplacement` rule the connector syncs use, so the stored rows survive and emit
  `source.sync.assets_preserved`. The source status, notes, incident and sync run name the scan
  failure instead of claiming an empty library
- a direct media source whose URL fails validation keeps its stored asset. The invalid-URL branch
  in `syncDirectMediaSources` skipped asset building but left the source id in the wholesale delete
  list, so a typo or a mid-cycle edit silently deleted the asset. `planDirectMediaSync` now derives
  the usable entries and the unusable source ids in one pass, and the sync routes through the same
  per-source preservation. The Twitch sync's own invalid-URL branch, which relied on the
  keep-empty-result rule catching it by accident, is now explicit as well
- `replaceAssetsForSourceIds` refuses to empty a populated source unless the caller opts in with
  `allowEmptyReplacement`. Its only guard was `sourceIds.length === 0`; the incoming asset list was
  never looked at, which is what let every one of these bugs reach the database. Emptying a source
  is still legitimate — the syncs that computed both lists from the same evidence say so — and a
  merely shrinking result is untouched, because a source going from 49 items to 1 is an ordinary
  playlist edit
- a source status now says whether a failed sync kept its assets. Both the YouTube and Twitch
  status writes reported `Ingestion failed` from the raw incoming count, so a source whose archive
  had just been protected looked identical to one that had been emptied — opposite situations for
  an operator. `describeSourceSyncStatus` derives the status, the preserved flag and the count that
  is actually still playable from the same outcome the replacement decision uses
- a chapter probe that came back empty is no longer a final answer. `chaptersProbeStatus: "ok"` was
  an absorbing state with no re-probe path and no reset in the UI, but a rate limit, a geo- or
  subscriber-restricted variant and a yt-dlp extractor regression all report "no chapters" too — so
  an asset could sit on the wrong category and title on air indefinitely. The asymmetry made it
  worse: `"failed"` healed through its cooldown, `"ok"` never healed. An empty result is now
  trusted for `CHAPTER_BACKFILL_EMPTY_RECHECK_SECONDS` (default one week, `0` disables) and then
  probed once more, sorted behind never-probed assets and failure retries so the per-cycle budget
  and the cycle-await ceiling are unchanged. Assets that have chapters are still never selected, so
  operator edits keep winning outright
- a failed thumbnail render no longer destroys the good thumbnail. `ensureLocalAssetThumbnail`
  deleted the existing file and pointed `ffmpeg -y` straight at the target path, so an OOM kill,
  disk pressure or plain load left the asset with no picture, or a truncated one readers would
  serve. It now renders to a temp path and renames only a finished file, the pattern
  `captureSourceSnapshot` already used; the disk sweep collects `.jpg.tmp` leftovers
- YouTube ingestion incidents resolve per source instead of behind a global `hadFailure` flag. One
  failing source kept every healthy sibling's incident open, and with a permanently broken source
  they never resolved at all

## 1.5.33 - 2026-08-27

### Fixed

- a failed source ingest no longer takes the running programme off air. `syncTwitchVodSources` and
  `syncYoutubePlaylistSources` collect assets from every enabled source and finish with
  `replaceAssetsForSourceIds(allSourceIds, collected)` — a delete-then-reinsert. A source whose
  ingest threw contributed zero assets but stayed in the delete list, so one transient yt-dlp error
  deleted that source's entire archive. Measured on the running channel (v1.5.31): eight process
  starts in the eight minutes after 18:57 against a normal two to three per hour, strictly
  alternating fallback slate and scheduled programme, each programme item cut after 76-91 seconds.
  With the pool emptied, `choosePlaybackCandidate` found no preferred asset and fell to
  `global_fallback`; because the on-air asset's row no longer existed, neither stickiness guard
  could re-select it, and the cycle cut the running item through `stopPlayoutProcess("switch")`.
  The next worker sync re-inserted the rows and playout switched back — hence the alternation. A
  sync may now only delete a source's stored assets when it has positive evidence the source holds
  that content: a throw, or an unexpectedly empty listing for a source that currently has assets,
  keeps the stored rows and emits `source.sync.assets_preserved`. Stale rows are recoverable and
  invisible to viewers; deleted rows take the channel off air
- a deliberate playout stop now says why. `stopPlayoutProcess(reason)` took a reason string,
  consumed it as a boolean and threw it away, and `playout.process.exit` reported only
  `planned: true` — which conflated "a watchdog or a target switch killed it" with "ffmpeg reached
  the end of the asset cleanly". Five of the eight stop paths (`switch`, `destination-missing`,
  `scheduled-reconnect`, `crash-loop-reset`, `restart-requested`) emitted no event of their own, so
  eight consecutive deliberate stops left no trace of their cause and the diagnosis above had to be
  reconstructed from timestamps. The exit event now carries `plannedReason` and `ranForMs`
- the playout loop no longer sleeps through a wake it was explicitly asked for.
  `requestImmediatePlayoutCycle` read a callback handle that `waitForNextLoop` installs only while
  the loop sleeps, so a wake requested from inside a running cycle found it null and was dropped.
  Both in-cycle callers were affected: the boundary fallback bridge and the deferred-prefetch
  follow-up, whose own comment promises the queue warms "immediately instead of waiting out the
  loop delay". It never did. This is the 15 seconds of the ~18s fallback bridge measured at two of
  three asset boundaries; the remaining ~3s is the follow-up cycle's own work. Wakes are now
  latched and consumed before the loop sleeps, edge-triggered and burst-limited so the loop-stall
  guard and the cycle-await budget are untouched
- a stale prefetch is now structurally unable to redirect a boundary. `decideBoundaryPlaybackInput`
  trusted that the caller had looked the probe up under the right key; it now takes the selected
  asset id and the probe carries the asset it was resolved for, so a probe belonging to a different
  asset is ignored. Declining a prefetch costs a few seconds of fallback, while honouring one that
  belongs to a previously queued asset would put the wrong programme on air

### Added

- `playout.boundary.gap` reports, per boundary, how long viewers spent off programme content
  (`gapMs`) and how many fallback processes covered it (`bridgeStarts`). The bridging duration was
  previously only recoverable by hand-subtracting timestamps of two unrelated
  `playout.process.start` events. Observation only — nothing it produces feeds a decision

## 1.5.32 - 2026-08-27

### Fixed

- the incident list tells the truth about what is broken now (M58). Measured on the running
  channel: 50+ open entries, 40+ of them "critical", the oldest from 5 July — and every one of them
  a past event that nothing ever closed. Only a handful of fingerprints ever called `resolveIncident`;
  the rest were reported and then carried forever, so the surface an operator opens during an
  outage answered "what is broken?" with forty corpses. Every fingerprint family is now classified
  in one registry as either a **state** (a condition that is true until it is not — a filling disk,
  a missing destination, a metadata sync waiting for the broadcaster connection; closed by the code
  that knows the condition, as before) or an **event** (something that happened and is over — a
  process exit, a stall the runtime restarted out of, a crashed loop). Event incidents are now
  closed from outside, once their part of the system has been measurably healthy and quiet, with a
  resolution note that says plainly they were closed automatically because they describe a past
  event. The health proof uses only signals the runtime already writes, and weighs each one against
  what it is actually worth: the program feed's status word is believed only beside the playlist
  mtime that ages on its own and a live playout heartbeat, because the worker never recomputes that
  word and a frozen "fresh" would otherwise let it close the incidents that say playout died; a
  running uplink counts only once its input is fresh (with a stale feed every uplink watchdog is
  disarmed, which is exactly the documented outage where the process ran 65 minutes without
  encoding a frame while the channel was dark), its destinations are out of error, and its youngest
  process has stood longer than the operator's own watchdog windows. A new reporting site cannot
  skip the decision: a test reads every `fingerprint:` in the worker — including templates that
  begin with an interpolation, which is how both loop watchdogs are written and how they slipped
  past the first version of the scan — and fails on anything the registry does not classify. The
  windows are deliberately constants and not managed settings: they are the honesty threshold of a
  reporting surface, and a field would invite setting them to nothing
- a fault that keeps coming back is not declared over in the gaps between its bursts. The quiet an
  entry has to prove scales with how long its family has been recurring — `created_at` survives a
  reopen, so first-to-last report is that span — capped at six hours so a bad week does not demand a
  week of silence. Without it a channel failing every quarter of an hour would have read green for
  ten minutes out of every fifteen
- one entry per ffmpeg exit instead of one per asset. `playout.ffmpeg.exit.<assetId>` gave every
  asset that ever failed its own permanently open critical row, which is most of what filled the
  list; the deduplication on fingerprint was working all along, the fingerprint was simply too
  granular. The asset now names itself in the message, where the detail belongs. Old per-asset rows
  are unreachable by any running code, so the sweep closes them by their retired shape once they
  are past the grace and playout is healthy — no migration, because a migration cannot see whether
  the channel is well and would either close them blindly or, on the freshly restarted container it
  runs in, close nothing at all
- both incident panels now say how old each open entry is — last reported first, because that is
  what separates the channel's current problem from July's, then first seen — and a capped panel
  says how many further open incidents it is not showing. The admin status chip counts every open
  incident instead of the five the live snapshot carries, so it no longer reads "5" while forty are
  open. An automatic resolution keeps the original message in front of its note: resolving replaces
  the stored text, and losing the exit code and stderr tail at the moment an entry becomes history
  would be the wrong trade

## 1.5.31 - 2026-08-27

### Added

- the operator surfaces the live-source work had been missing (M57 stage 2, Etappe E). Most
  importantly the emergency rollback path is usable again: since the relay started checking
  credentials, publishing the programme through it (`STREAM247_RELAY_ENABLED=1`) and reading it
  back on the uplink's rtmp input (`STREAM247_UPLINK_INPUT_MODE=rtmp`) only work with the internal
  relay key embedded in the configured URLs, and nothing could produce that string — the runbooks
  said to treat the rollback as unavailable. Settings → Operations → **Relay access** now hands an
  owner or admin both ready-to-paste lines: the group is rendered only for those roles and the route
  enforces them again, POST rather than a page render so the key never reaches the server-rendered
  HTML, one `relay.internal_key.revealed` audit line per reveal naming the actor and never the
  value, rate limited per account, fail-closed when the session can no longer be named, and every
  failure answers identically without the key or the underlying error. The reveal is strictly a
  READ: it uses a new non-generating reader, so clicking it can neither mint a key on an install
  that has none nor overwrite one that the current app secret cannot decrypt — either would have
  invalidated the key every running container still holds, during the incident the button exists
  for. The rate limit bounds repeated harvesting; it does not make the audit line durable, since the
  audit ring keeps only the newest 100 entries across all routes
- **Sound from live video sources** in the same panel: the live source gain (0-200, default 40)
  had been a managed value with no field since Etappe D. Whole percents only, refused rather than
  silently clamped, and carrying the honest caveat that a live source's sound is mixed only into
  items whose length is known in advance — on anything else the camera is embedded as picture only,
  so the feed-audio watchdog stays the safety net
- the studio's video source manager now says in words what playback last did with each pushed
  source — live in the programme, waiting for the camera, paused after a failed attempt with the
  cooldown counted down, or still picture only with the reason. "Live" is reported only from the
  fact that a live input really went into the running command, never from the decision to attach
  one: an intent that never landed (no resolvable address, or a start that took no input) reads as
  picture-only, and a live bridge or standby slate clears the state instead of leaving a stale
  "live" standing. Persisted through migration `20260826_004_overlay_video_source_live_state`
  (three additive columns, empty on existing rows), written only when the state changes, and kept
  off the broadcast path entirely — the write is detached and order-chained, so an observation can
  never slow down or block a camera going on air

## 1.5.30 - 2026-08-27

### Added

- pushed video sources (M57 stage 2, ingest foundation): a stored video source can now receive
  its picture instead of naming an address. The relay runs a mounted config with HTTP auth
  against the web app — publishing `src-<id>` needs that source's publish key (issued once in
  the studio's video source manager, rotatable, stored encrypted, migration `20260826_002`),
  internal reads and the legacy programme path need a self-generating internal relay key (new
  `managed_secrets` table, migration `20260826_003`). Ingest host ports are RTMP `1935/tcp` and
  SRT `8890/udp`; the relay API and RTSP read side stay container-internal. The auth endpoint
  answers every refusal with the same bare 403, rate-limits per address, audits rejected
  publishes, and the policy itself is a pure, constant-time-compared function. A pushed source's
  internal playback URL is derived on read — never stored — so the stage-1 snapshot sampler
  shows pushed cameras with no further configuration
- the live-attach groundwork for pushed sources (decision only): each playout cycle computes
  whether it would attach the scene's pushed source as a live input and logs
  `playout.source-live.attach_decision` (decision + reason, on change) without acting. Presence
  is asked from the relay API with a 2s bound only when the new managed gate (default off, env
  fallback) and the source layer gate are both on and the scene carries a source layer; every
  uncertain answer decides "skip". The three-minute attach circuit breaker exists and is pinned
  by tests; its trigger arrives with the attach stage, as does the starting-gain setting
  (clamped 0–200, default 40) that already resolves through managed config
- pushed video sources can now be attached LIVE, not just sampled (M57 stage 2, Etappen C+D):
  when the feature is on, the upcoming programme is an asset, the scene carries a source layer, and
  the relay reports the source publishing, the playout attaches it as a third ffmpeg input — a
  picture-in-picture window laid under the scene overlay exactly where the snapshot panel would sit,
  with `eof_action=pass` so a feed that drops never freezes the frame. Its audio is mixed under the
  programme at the configured gain (default 40%) with `normalize=0` (no level jump when the source
  comes or goes) and no padding (a lost source simply falls silent). The mix is built only when the
  programme asset has a KNOWN finite duration — an unknown-duration programme keeps its own audio as
  the sole track so the feed-audio watchdog (which reads the programme's audio out of the muxed
  segment to catch a source that runs dry without EOF) is never masked by live PiP sound — and only
  after the source's audio is probe-confirmed, so a relay that advertises a track the pull cannot
  deliver falls back to video-only instead of crashing ffmpeg. The RTSP read is bounded at 4 s, the
  live window is computed bit-identically to the renderer's panel, and a failed attach start opens
  the attach breaker so the next starts go attach-free — a bad feed cannot crash-loop the channel.
  Attach and detach happen only at natural asset boundaries, never mid-asset; the relay presence poll
  runs only while an asset is selected, never during a live bridge or standby slate. Off by default;
  a DT soak gate precedes any deploy

### Changed

- the rtmp relay rollback paths now require the internal relay key embedded in the relay URL
  overrides; until an operator surface reveals that key, treat the rtmp rollback as unavailable
  rather than weakening the relay auth config (see docs/deployment.md)

### Security

- hardened `/api/relay/auth`, which is internet-facing (the `web` port is published and Traefik
  routes the host), against two abuse paths found in review. Its rate limit now keys on the real
  transport peer (`X-Forwarded-For` from our Traefik) instead of the attacker-controlled `ip`
  field in the request body, so the limit can neither be evaded by rotating that value nor turned
  against a legitimate publisher by spoofing its address. Rejected-publish audit writes are now
  throttled — at most one line per source per minute and a hard global ceiling per minute — so a
  flood of bad publishes can no longer erase the security audit trail (each write runs an
  INSERT+DELETE against the 100-row cap) or starve legitimate state writes by holding the
  serialized write lock. A non-object JSON body (literal `null`, a string, an array) now returns
  the same bare 403 as every other refusal instead of a distinguishable 500.

## 1.5.29 - 2026-08-26

### Added

- the self-monitoring now covers the volumes eviction cannot help. A second, observation-only
  watermark watches free space on the worker's root filesystem — the closest measurable stand-in
  for the OS and database volumes, since the database's own volume cannot be statfs'd from the
  worker — and reports `pg_database_size` for context. Crossing below the warning mark raises one
  critical incident plus one alert per breach (fingerprint-deduped), resolved only above the
  higher all-clear mark; nothing is ever evicted there. Thresholds are managed config with env
  fallback (`STREAM247_SYSTEM_VOLUME_TRIGGER_PERCENT` / `STREAM247_SYSTEM_VOLUME_RECOVER_PERCENT`,
  defaults 10/15), editable inside the folded disk group of the admin settings
- a conservative asset-retention sweep against unbounded library growth. Hourly, the worker
  classifies every asset row: kept while its source exists, kept while anything references it
  (pools — cursor, insert, audio lane, or the pool still listing the vanished source; schedule
  cuepoints; curated sets; the entire playout runtime including the queue; chat votes, viewer
  requests and skip campaigns; global fallbacks), and kept until it has been *observed* orphaned
  for the whole protection window (`STREAM247_ASSET_RETENTION_PROTECT_DAYS`, default 7 — the
  clock is the sweep's own first-seen mark in the new `asset_retention_marks` table, migration
  `20260825_006`, so losing a source never makes old assets deletable the same day). Deletion is
  gated behind a managed switch that ships OFF (`STREAM247_ASSET_RETENTION_ENABLED`, only "1"
  enables); the candidate and kept-because counters are logged on every sweep either way, so an
  operator watches first and enables second
- embedded video sources on air (M57, stage 1): a new positioned scene layer shows a slow-refresh
  picture from a stored camera or feed. The playout encode keeps its two video inputs — a
  short-lived capture grabs one frame every few seconds (managed cadence, default 5s, env
  fallback) and the native renderer draws it as an overlay panel, so a dying feed can never stall
  the encode. Feed addresses are stored encrypted in their own table (app-secret key, the managed
  destination stream-key pattern), never appear in the scene payload, any listing, log or
  incident, and the layer itself carries only placement plus a source reference. A feed that goes
  away hides the layer on air instead of freezing; the studio shows the outage as status. The
  whole path sits behind a managed feature switch that defaults off. Repeated capture failures
  raise a warning incident that auto-resolves on the next good frame, and the snapshot directory
  joined the disk-watermark eviction ladder as its cheapest stage
- logo, image and text layers now render on the on-air picture through the same native renderer
  (previously browser overlay only), with the panels' existing ink and surface vocabulary and the
  same safe-area clamping as the game panel. Website/widget embeds stay browser-overlay-only —
  the rasteriser cannot run an iframe — and the studio now says so where those layers are edited

- chapter auto-detection now reaches every remote source, not just single Twitch VODs. Collection
  connectors list their items with `--flat-playlist`, which never carries chapters, so YouTube
  playlist/channel items, Twitch channel archives and direct media always arrived chapterless. A
  budgeted backfill now spends `CHAPTER_BACKFILL_PER_CYCLE` (default 3) metadata-only probes per
  worker cycle on such assets — yt-dlp for YouTube/Twitch, ffprobe for embedded MP4/MKV chapters —
  and stores the result through the same only-fill-empty rule as re-ingest, so operator-edited
  chapter lists always win. A completed probe is final even when it finds no chapters; a failed
  one waits out `CHAPTER_BACKFILL_FAILURE_COOLDOWN_SECONDS` (default 1800). The discovered
  chapters run through the existing boundary emission and Helix sync unchanged
- operational decisions moved from `.env` into the GUI (M56, part 1), on the managed-config
  pattern the Twitch credentials established: a value saved in settings wins, the env variable
  stays as fallback, and web and worker share one resolver per family in `packages/core` so the
  two sides cannot drift. Concretely: encoder quality (speed preset, video bitrate ceiling,
  buffer size, audio bitrate) as a folded group on the studio output tab; the disk watermark
  (on/off, trigger and recovery percent — the pair is validated before saving and rejected whole,
  exactly like the worker treats it) and the chat, alerts and Twitch schedule sync feature
  switches as folded groups in the admin settings; the EventSub webhook secret in the managed
  credentials form, with the same keep-on-empty semantics as every other stored secret. An empty
  managed value changes nothing: existing env-driven installs behave bit for bit as before,
  including the runtime gates' historical only-"1"-enables semantics
- the remaining operational env families followed (M56, part 2), as three more folded groups in
  the admin settings operations panel, each saving through its own partial route so no form can
  blank a sibling's values. "Replay cache": the Twitch VOD cache switch, remote-fallback switch,
  size ceilings in GB (whole cache, minimum free, largest single replay — a per-replay ceiling
  above the cache is rejected whole), retention and partial-download ages, download timeout,
  failure cooldown and the download speed ceiling; the cache root path stays env-only, a mount
  point is infrastructure. "Watchdog thresholds": the feed-silence, frozen-feed and encoder-stall
  watchdogs, the never-started encoder restart and the planned end-of-video margin, all as
  seconds with a spoken description of what each guard does. "Feed tuning": planned reconnect
  cadence and window, program-feed segment length, window size and failover margin; the relay
  topology stays env-only, deploy wiring is not a runtime decision. Because these values steer
  restarts, every managed number is validated against bounds derived from each module's own
  invariants (form and API refuse, the shared resolver additionally clamps a corrupted store),
  the feed-stall floor is pinned above the longest configurable segment, and a managed download
  timeout still passes the cycle-budget clamp, so no GUI value can outlive the loop stall guard.
  The worker's playout and uplink modes now refresh managed config at each cycle start, so a
  saved value reaches a running channel without a restart. The loop stall guard itself stays
  env-only on purpose: the GUI must not be able to lower the process's own self-protection

### Removed

- the dead `packages/config` package. Its `getConfig` (REDIS_URL, MOD_PRESENCE_ENABLED,
  MOD_PRESENCE_COMMAND) was imported by nothing; the workspace dependency, path mappings, build
  steps and Dockerfile copy went with it

## 1.5.28 - 2026-08-25

### Fixed

- the channel page's "Up next" now looks past midnight: after the last block of the evening it
  shows the next occurrence in the weekly grid instead of claiming nothing further is scheduled —
  on a 24/7 channel that answer was wrong whenever any block existed later in the week. This is
  also what made CI's wording baselines fail on every evening run
- "!here 5" works with the default moderation policy. requirePrefix: false treated the bang as
  forbidden rather than optional, so the exact command the spec and the check-in form both show
  was silently ignored on a default install; strict configs still require the prefix
- every compose service now caps its container logs (json-file, 20m × 5). The OS disk is the one
  partition the media-root watermark does not watch, and unbounded ffmpeg stderr was the likeliest
  way to fill it

### Added

- two more chat games on the M54 framework: Minesweeper and 2048. Minesweeper is steered by
  coordinates typed in chat ("b3", case-insensitive, spreadsheet-style columns): the seeded board
  commits on the first dig and never under it, a dig flood-reveals to the numbered frontier, a
  mine ends the round, clearing every safe cell wins it. 2048 reuses the snake's emote→direction
  map unchanged on its own four-by-four board: classic slide-and-merge with each tile merging at
  most once per move, spawns drawn from the state's own seed cursor, round over when no move is
  left. Both keep the framework's promises — no clock, no `Math.random`, same seed plus same
  inputs equals the same board — persist through the same runtime row, and render through the
  same panel, which now draws numbers inside cells and, for coordinate-driven games, column
  letters and row numbers around the grid. The studio picker offers all three games and folds
  away the fields the selected game ignores (the emote map for Minesweeper, the grid for 2048);
  no schema change was needed, because the settings row already stored the game id with snake as
  its default
- the chat window now renders in the broadcast frame, not only in the browser preview. Chat
  messages previously existed solely in the web overlay page, which stopped feeding the encode
  when the native satori renderer replaced the Chromium screenshot path — so "chat on stream" was
  silently preview-only. The worker's chat bridge now flushes its ring buffer (display name,
  text, timestamp; never user ids or logins) to a `chat_overlay_messages` singleton row within a
  second of a change, and the playout render loop projects the row into a chat panel that joins
  the overlay's flex flow at the corner `chatPosition` names — displacing the lower third, the
  vote panel, and the next card instead of ever overlapping them. The panel shows at most eight
  one-line messages (each hard-clamped, control characters and bidi overrides stripped; Twitch
  emote codes stay visible as words since the renderer draws text, not emote images) and a
  message ages off air after five minutes, the same window that defines an active chatter — which
  is also what takes a dead worker's last flush off the broadcast. Moderation reaches the frame
  too: the bridge mirrors CLEARMSG and CLEARCHAT into its buffer, so a deleted or banned
  message leaves the stream on the next flush instead of replaying on the one surface no
  moderator can refresh. Empty or disabled chat renders nothing — no empty panel frame
- skip-vote progress now renders on air, closing the follow-up left by the 1.5.27 poll fix. The
  `!skip` tally lived only in worker memory, so viewers voting to skip rallied nobody: nothing was
  persisted and the playout container had nothing to draw. The worker now flushes the campaign's
  numbers — votes, threshold, window end, never voter identities — to a `chat_skip_vote` singleton
  row within a second of an accepted vote, and the playout render loop projects the row into the
  engagement panel with the same shared-projection pattern as the poll. A row older than its own
  window renders nothing, so a worker restart cannot fabricate progress from a dead campaign; an
  asset boundary or disabling viewer control clears the row instead of letting it linger. When the
  poll and a campaign are live at once, the one panel slot goes to whichever runs out of time
  first (ties to the skip campaign, whose failure mode is silent) — with default settings the poll
  still shows first, then the campaign inherits the slot
- broadcaster-slot OAuth connect (M51 completion): the broadcast channel's own account can now be
  connected from the browser through a flow kept fully separate from the identity connection —
  own start route with only the `channel:manage:broadcast` and `channel:manage:schedule` scopes,
  own namespaced single-use state cookie, and a callback that verifies the authorised Twitch
  login matches the configured broadcast channel before storing anything; connecting the wrong
  account (typically the identity) is rejected with a message naming both accounts and stores no
  token. The dashboard's waiting entry became the actual connect link, a connected slot can be
  disconnected, and the worker refreshes the slot token ahead of expiry and on 401 like the
  identity token, so metadata sync flips on — and stays on — without a restart

## 1.5.27 - 2026-08-25

### Added

- chapters per video (M53): each asset can carry a chapter list — offset, Twitch category, stream
  title — auto-filled from VOD metadata at ingest (Twitch VOD chapters name the game on air, so
  the chapter title doubles as the category candidate) and editable per video in the library.
  During playback the worker emits `playout.chapter.boundary` events as offsets are crossed; the
  on-air hero title and the Twitch metadata sync follow the chapter that is actually playing,
  through the M51 broadcaster gate and throttled to one channel write per 30 seconds. Operator
  edits survive re-ingest; an empty chapter list behaves exactly as before the feature existed

### Fixed

- assets with a known duration end on time instead of being rescued by watchdogs. Remotely
  streamed VODs (CloudFront-backed Twitch assets too large to cache) reach their end without
  ffmpeg receiving EOF: the fps=60 filter manufactured video from the last frame ("More than 1000
  frames dup"), audio went silent, the uplink encoder stalled and its watchdog restarted it after
  ~45s — one viewer-visible discontinuity per asset end — and only at 91s of silence did the
  feed-audio watchdog rotate the asset. The playout now ends the asset deliberately once elapsed
  playback passes its known duration plus a margin (PLAYOUT_DURATION_BOUND_MARGIN_SECONDS, default
  15s), through the same planned-transition path a natural boundary takes: no incident, a
  playout.duration_bound.end runtime event, and the next queue item starting in the same cycle.
  Assets with an unknown duration behave exactly as before, with the feed-audio watchdog as the
  net; live-bridge input is never cut

- the chat poll now renders on air. Voting always worked — ballots counted, the tally flushed to
  Postgres, the winner promoted to the front of the queue — but the playout container never read
  any of it back: the vote panel predates the native scene renderer, and when the overlay moved
  in-process from the Chromium screenshot nothing was wired to feed the engagement view, so
  viewers voted in a poll they could not see. The playout render loop now projects the persisted
  poll row into the vote panel on every render interval, sharing the projection with the
  worker-side tally so the two sides of the process boundary cannot drift; the countdown ticks
  between the worker's change-driven flushes and the deadline inside the row takes an orphaned
  poll off air. Skip-vote progress still cannot be drawn on air — its tally is never persisted —
  and remains a follow-up

## 1.5.26 - 2026-08-25

### Fixed

- live streams no longer outlive the clients that opened them. A run of the visual suite left the
  web process holding 22 SSE connections with zero established sockets on its port; each kept
  polling, Postgres committed 115 transactions a second with nobody connected, and the process took
  16 seconds to answer its own health check at 0% CPU. The disconnect listener now registers before
  the first await, and the stream additionally closes itself when nothing is reading what it
  enqueues. Measured after: 0 connections, 2 transactions a second (v1.5.26)
- local image builds had been failing for five days without anyone noticing, because the dev stack
  kept serving the last image that worked. `.dockerignore` listed `node_modules`, which Docker
  matches only at the context root, so every workspace package's node_modules was copied in from
  the developer's machine — pnpm symlinks into a store the image does not have. The pattern matches
  at any depth now and both builder stages take the whole installed tree from deps. The same change
  broke the worker image, caught by scripts/clean-checkout-build.sh, which now rebuilds every image
  from a pristine clone the way CI does (v1.5.26)
- playout restarts when its process is alive but the feed has stopped advancing. Caught live:
  ffmpeg blocked 3h43m at 0% CPU on a remote source that stopped delivering, reconnect flags set
  and never firing, the uplink exiting "end of input" once a minute, the channel dark for four
  minutes. Same idea as the uplink's encoder-stall watchdog, one stage earlier; a 90-second grace
  period keeps ordinary boundaries out of reach (v1.5.26)
- the on-air label chip picks black or white ink by the accent's luminance instead of always dark —
  a dark accent used to letter it invisibly, on the one surface nobody inside the product looks at.
  Accent-coloured headings on the panel are kept when they clear 4.5:1 and replaced with white when
  they cannot, so safety does not take the channel's colour away from choices that were fine
  (v1.5.26)
- playout logs its ffmpeg stderr to the container log and the overlay pipe reports its open and
  close with frames written, so a failed transition leaves a reason behind instead of an exit code
  beside an empty field. The first incident after deployment was answerable within minutes — and
  the answer corrected the original report: exit 255 with planned:true is the worker's own asset
  switch, not a crash (v1.5.26)

### Changed

- the program feed directory is swept at each boundary: segments no playlist references and older
  than ten minutes are removed, capped at 400 per sweep so the cost of a transition stays constant.
  Measured before: 8878 files, 3.7 GB, the oldest 125 days old, in a directory whose live window is
  six segments — the record of eight thousand playout restarts (v1.5.26)
- the operator surfaces were simplified against measured control counts, each page holding its
  budget as a test: live control 33 to 22, live status 62 to 25, sources 48 to 30, pools 41 to 17,
  scene editor 79 to 54. One primary action per page, held by the same test; repair actions,
  destination/source/pool editors and the live bridge fold away; dead links on the go-live
  checklist are gone. The public channel page gained the one control it lacked: a watch link
  (v1.5.26)
- stored identifiers no longer reach text people read: scheduled_match and its fifteen siblings,
  missing-config, preset and source ids, "pool cursor", "worker-side hysteresis". Cuepoints are
  "Timed inserts" and audio lanes are "Replacement audio", both named from behaviour in core rather
  than guessed. A wording baseline records every surface as reviewable text, and an identifier scan
  with a visible, self-pruning exception list holds the state (v1.5.26)
- the dev fixture seeds a gapless week at fixed times, actually writes its two assets (the previous
  call was an UPDATE that matched nothing and reported success), and files them under a source that
  exists — so the baselines photograph a workspace with content instead of recording empty states
  as truth (v1.5.26)

## 1.5.25 - 2026-08-23

### Fixed

- restart the playout when its source has run dry. A VOD finished and ffmpeg did not exit: the
  `fps=60` filter kept manufacturing frames by duplicating the last one — over ten million of them
  across two and a half days — so video packets kept flowing and every liveness check stayed green.
  The channel was off the air that entire time, because audio cannot be duplicated: the program feed
  carried a silent audio stream, the uplink could not determine its parameters and reported
  "Nothing was written into output file, because at least one of its streams received no packets",
  and nothing ever reached Twitch. Audio is now the signal — a feed carrying video without audio
  past `PLAYOUT_FEED_SILENCE_MS` is treated as an exhausted source. A feed that never carried audio
  is never judged, so a silent clip does not restart forever, and a feed with no video either is
  left to the existing process supervision (v1.5.25)

### Changed

- three visual snapshots now mask their runtime regions rather than asserting content. Pinning the
  schedule day and masking the scene clock both looked right and both failed again two days later
  with no code change: what varies is server state and server time, which `page.clock` cannot
  reach. Narrowing what they assert is the trade — a net that goes red on a calendar rather than on
  a regression is one people stop reading (v1.5.25)

## 1.5.24 - 2026-08-21

### Fixed

- `/login` returned 500 on every workspace with Twitch configured. The page built the authorize URL
  while rendering, which mints a single-use OAuth state and writes it to a cookie — something
  Next.js only permits in a Route Handler or Server Action. `/setup` and the dashboard took the same
  path. Introduced with the OAuth state fix in 1.5.19 and invisible until now, because the visual
  suite runs against a stack with no Twitch credentials, where the function returns early and never
  reaches the cookie write: the one environment that could not reproduce it. Pages now check whether
  sign-in is configured and link to a route that mints the URL on click, so the state is also fresh
  when it is used rather than dating from the page render (v1.5.24)
- stop deleting VODs fetched ahead of their slot. The delete set was derived by elimination —
  everything not on air, in the runtime queue, or still downloading — and a completed download fails
  all three the moment it lands. Measured on the production channel: 19.1GB removed seconds after
  the 52 minutes it took to fetch, then fetched again. Exactly one asset stops playing per
  transition, and that one is now named rather than inferred (v1.5.24)
- restart an uplink that has never encoded anything. This state was reported and deliberately never
  acted on, reasoning that a false positive costs a restart loop while a false negative costs no
  more than the previous behaviour. It cost the channel: the uplink ran 65 minutes without a single
  frame, never opened an RTMP connection, and logged the condition every 15 seconds while nothing
  reached Twitch. `UPLINK_NO_PROGRESS_RESTART_MS` (5 minutes) now bounds it (v1.5.24)
- pin the two visual snapshots that depended on the server's clock. `page.clock` freezes the browser
  only, so the schedule page rendered a different week each morning and the scene preview raced its
  own clock between server paint and hydration — both passed when their baseline was taken and
  failed two days later with no code change (v1.5.24)

## 1.5.23 - 2026-08-20

Design consolidation, and the two gaps the 1.5.22 rollout exposed in production.

### Fixed

- collect abandoned partial downloads. They were left entirely to the prune, which only runs
  immediately before a download starts — and the new size policy makes that a dead end: once every
  scheduled VOD is over the limit no download ever starts, nothing prunes, and the partials stay
  forever. Measured at 13.8GB on the production channel, invisible to a release that skipped every
  transient file. The release now applies the prune's own test: old enough, and no live job holding
  the lock (v1.5.23)

### Changed

- one definition for the five state tones. `status-chip-*`, `badge-*`, `programming-status-*`,
  `schedule-block-*`, `toast-*`, `.warning`/`.danger` and `.field-error` said the same five things in
  their own colours — agreeing on meaning, disagreeing on value, which is how one drifts out of
  contrast while the rest stay fine. They now map onto
  `--tone-{positive,caution,critical,neutral,info}-{fg,bg,border}`; class names are unchanged, so no
  markup moved. Info became a real channel instead of three literals inside one pill. Colour
  literals: 100 → 93 (v1.5.23)
- removed `Card`, `PageHeader` and `Button` from the design-system primitives. Card and PageHeader
  duplicated Panel and AdminPageHeader, which carry 17 and 11 usages against zero for the newer
  pair; Button was never used either. Consolidating onto the incumbents keeps the visual result
  identical (v1.5.23)

### Added

- a fixed playout runtime for the dev stack. It leaves worker/playout/uplink stopped so the UI is
  reproducible, which also left every live surface reporting "nothing on air" — so the pages that
  report on a running channel were outside the visual suite by construction. The runtime the stopped
  worker would own is now seeded through the same `updatePlayoutRuntime` production uses, with fixed
  ids and fixed instants (v1.5.23)
- `/live?tab=status` and `?tab=control` in the visual baseline. They were excluded for flakiness;
  with the runtime pinned rather than masked, two consecutive verification runs pass 28/28. These
  are the pages an operator opens when something is wrong (v1.5.23)
- `tests/unit/design-tones.test.ts`, which resolves the channel syntax
  (`rgb(var(--brand-rgb) / 0.12)`) the existing contrast test cannot read. The token layer is
  finally covered by the standard it was written to serve (v1.5.23)

## 1.5.22 - 2026-08-19

The VOD cache does what it was always meant to, plus the audit findings that were still open.

### Added

- cache a Twitch VOD when it fits, stream it live when it does not. `TWITCH_VOD_CACHE_MAX_ASSET_BYTES`
  (default 20GB) is checked before any bandwidth is spent, and an oversized VOD is marked
  `too-large` and played straight from Twitch — a settled state, so it raises no incident and is
  never retried. Below the limit the VOD is cached and released as soon as it is neither on air nor
  still ahead in the queue. Keyed on what is in use rather than on a playback-ended event, because
  playback ends in more ways than it begins: a skip, a crash, a boundary, an operator override
  (v1.5.22)
- `TWITCH_VOD_CACHE_LIMIT_RATE` caps download bandwidth so caching cannot take the line from the
  live stream (v1.5.22)

### Fixed

- size the VOD from its bitrate and duration. Twitch reports neither `filesize` nor
  `filesize_approx` for its HLS VODs — verified against live VODs on two yt-dlp versions — so the
  first version of the size check was unreachable and the limit did nothing at all. `--max-filesize`
  could not cover for it either: yt-dlp consults it only for progressive HTTP downloads, never for
  fragmented HLS, measured at 95MB downloaded against a 1MiB cap (v1.5.22)
- never read an empty playout selection as "no cached file is needed". The playout reports no
  current asset while reconnecting, in standby, and on a freshly restarted process — in each of
  those the release would have deleted the entire cache, turning a routine restart into a full
  re-download of every scheduled VOD (v1.5.22)
- stop the blueprint import overwriting the live playout runtime. It read the whole app state, spent
  the request building a new one and wrote it back, so importing a blueprint while the channel was
  on air rewound the worker's heartbeats, restart counters and uplink status — without holding the
  state write lock (v1.5.22)
- stop EventSub reporting dead subscriptions as configured. Twitch keeps a subscription listed after
  it stops delivering; matching on type and condition alone counted `authorization_revoked` and
  `notification_failures_exceeded` as present, so the channel silently received nothing. Revocations
  were also processed as notifications, turning "this subscription is dead" into a cheer alert on
  the overlay attributed to "Viewer" (v1.5.22)
- let two moderators check in during the same second. `presence_windows` used `expires_at` as its
  primary key, and that value is the check-in time plus a duration from a short list (v1.5.22)
- refresh the broadcaster token with nothing on air. The refresh sat behind an early return taken
  when no asset and no schedule block were active, but the chat bridge authenticates with the stored
  token on every cycle — so an empty programme expired the token and took chat down with it
  (v1.5.22)
- stop template application locking the schedule editor. It skipped the overlap check every other
  way of creating a block performs, and the editor refuses to save while conflicts exist (v1.5.22)
- fill the schedule video timeline on every day. A preview is built for a date; the page built one
  for today and filtered it by the selected weekday, leaving six days out of seven empty (v1.5.22)
- validate schedule overlaps under the lock that writes them. Two editors saving at once each
  validated against a snapshot without the other's block, and both writes succeeded (v1.5.22)

## 1.5.21 - 2026-08-19

Three production failures found by watching the 1.5.20 channel, plus what an adversarial review of
the first fix turned up.

### Fixed

- stop the on-air overlay throttling the encode to half real time. ffmpeg is told the scene pipe
  delivers 1fps and the `overlay` filter cannot emit a frame until both of its inputs have one, so
  a writer that slept the 2000ms render interval between frames paced the *entire* encode, not just
  the overlay: playout produced 30 seconds of programme per minute of wall clock and the channel
  fell steadily further behind. Writing and rasterising are now independent, and the writer paces
  against the wall clock. Measured on the production channel afterwards: 90 segments in 180s, 100.0%
  of real time (v1.5.21)
- stop scene loop teardown from killing the worker. The fd-3 pipe had no `error` listener — the
  drain wait supplied one by accident — and teardown aborts the loop and SIGTERMs ffmpeg in the same
  turn, so the pipe lost its reader with nothing listening. An unhandled stream error is an uncaught
  exception, which this process answers with `exit(1)`, at every ordinary asset boundary. Reproduced
  against real ffmpeg: 3/3 runs died with ECONNRESET, 3/3 survive with the listener (v1.5.21)
- keep the scene renderer alive when its own error path fails. The incident write inside the
  handler goes through the same database whose failure would have put it there, so one Postgres blip
  could kill the loop and freeze the lower third for the rest of the run with no incident raised
  (v1.5.21)
- detect an uplink that is running but no longer producing. ffmpeg stayed alive while emitting 450
  timestamp discontinuities a minute and handing audio and video opposite ~117s offsets, so the
  tracks audibly drifted apart while every destination still reported `ready` — process liveness
  cannot tell "running" from "working". The supervisor now watches ffmpeg's own `out_time` and
  restarts through the unplanned-stop path, so it lands in the restart tally instead of being
  absorbed silently (v1.5.21)

### Added

- `TWITCH_VOD_CACHE_LIMIT_RATE` caps cache download bandwidth. The cache was measured pulling
  145 Mbit/s on a host whose job is pushing a live stream out. Defaults to unlimited, since the right
  number depends on the link (v1.5.21)
- `UPLINK_STALL_TIMEOUT_MS` / `UPLINK_STALL_GRACE_MS` tune the encoder stall verdict. Watch for
  `uplink.encoder_stall.restart` and `uplink.encoder.no_progress` (v1.5.21)

### Operations

- `docker stats --no-stream` is not usable for judging whether the uplink is encoding. Consecutive
  samples on the same healthy process read 0.05% and 17.43% while its 30-second cgroup average was
  99%. Measure `cpu.stat` usage over a window, or the interface counters, before concluding anything
  from CPU. This is the reason the stall detector watches `out_time` rather than CPU.
- the overlay's staleness is bounded by the writer's lead, not by buffer sizes. `-thread_queue_size`
  cannot provide that bound: frames queue in Node's stream buffer and the OS pipe long before
  ffmpeg's own queue, and the more cheaply a transparent lower third compresses, the deeper that
  backlog runs.
- an uplink stall is only blamed on the uplink when the program feed is `fresh`. Otherwise a playout
  outage would become an uplink restart loop lasting exactly as long as the outage.

## 1.5.20 - 2026-08-19

Follow-up to the 1.5.19 rollout, from watching it run in production.

### Fixed

- stop the Twitch VOD cache prune from deleting a download that is still running. It evicts
  transient files to stay under the cache cap and protected only the target path of the download
  that triggered it, so with several large VODs queued each new job deleted the previous job's
  partial — 21GB of progress removed 15 minutes in, then restarted from zero. That is the same
  "never finishes" failure the 7200s download timeout used to cause, relocated from the playout
  cycle into the background runner: no longer fatal, but an endless loop that burns bandwidth and
  never produces a cached file. The lock a running job maintains now exempts its partial and the
  fragment files yt-dlp writes beside it; a stale lock still frees them (v1.5.20)

### Operations

- `TWITCH_VOD_CACHE_ALLOW_REMOTE_FALLBACK=1` on the production channel. With it at 0 the playout
  refuses to stream a VOD that is not fully cached and bridges to fallback content instead — which,
  combined with VODs larger than the cache cap, meant the channel showed fallback indefinitely even
  with playout healthy. Restart-freedom is not the same as a healthy channel; check the actual
  ffmpeg input, not just the absence of errors.
- `TWITCH_VOD_CACHE_MAX_BYTES` still defaults to 20GB while the scheduled VODs exceed that, so
  nothing stays cached for long. Raise it or run the source as a direct stream deliberately.

## 1.5.19 - 2026-08-18

Emergency production release. Supersedes the 1.5.18 tag, whose release build failed before
publishing any image (the Release workflow ran before CI had pushed the `main-<sha>` snapshots it
pulls from). No 1.5.18 images exist; 1.5.19 is the artifact to deploy.

Carries the 1.5.18 playout fix below plus a critical, remotely exploitable authentication flaw and
four runtime failure modes, all found by an adversarially-verified audit pass over the product.

### Breaking

- **`APP_SECRET` must be at least 32 characters in production and may not be the published
  `stream247-dev-secret` constant.** A deployment that does not satisfy this now fails instead of
  silently signing sessions with a guessable key. `pnpm release:preflight` checks it before rollout
  and prints the remedy (`openssl rand -base64 48`). Rotating the value invalidates existing
  sessions, so everyone signs in again once.

### Security

- close a full workspace takeover via the Twitch OAuth connect callback. The route had no auth
  guard, `middleware.ts` only matches `/overlay`, and the OAuth `state` was the literal flow name
  that no callback read back. An attacker could authorise their own Twitch account against the
  publicly discoverable client_id, hand the code to the callback to overwrite the workspace's
  broadcasterId and tokens, then complete SSO — which grants "owner" to whoever matches that
  broadcasterId — and hold an owner session without ever knowing a password. State is now random,
  single-use, flow-scoped and bound to an HttpOnly cookie, and the connect callback requires an
  owner/admin session (v1.5.19)
- stop falling back to the published `stream247-dev-secret` constant when `APP_SECRET` is unset in
  production. This project is source-available, so that fallback let anyone forge a session cookie
  for any user id. Startup now fails loudly and rejects secrets under 32 characters (v1.5.19)
- expire session cookies. The issue timestamp was already inside the signed payload but was never
  checked, so a leaked cookie was valid forever. Default 30 days via `SESSION_MAX_AGE_SECONDS`
  (v1.5.19)
- stop library uploads escaping `MEDIA_LIBRARY_ROOT`. The subfolder sanitiser kept "." in its
  allowed character class so ordinary names survive, which also let a ".." segment through
  untouched: "../../etc" sanitised to itself. Traversal segments are now dropped, backslashes count
  as separators, and a containment check on the resolved destination backs it up (v1.5.19)
- rate-limit password login and TOTP verification. Neither had a limit or lockout, so both were
  unbounded brute-force surfaces; a six-digit TOTP with a +/-1 step window is well within reach
  unthrottled. Login is keyed on the targeted account and the client, TOTP on the account alone,
  and a success clears the counter (v1.5.19)

### Changed

- blocks that cross midnight stay on the schedule. Occurrences were built by filtering on the
  weekday of the queried date alone, so a block scheduled Monday 23:00 for two hours vanished at
  00:00 and the channel fell out of its programmed pool for the rest of the night. The same block
  also claimed to be on air on its own morning, because matching compared wall-clock strings.
  Occurrences now carry the previous day's overrun explicitly and match on minute ranges (v1.5.19)
### Added

- **Viewer control**: Twitch chat can steer the programme. A poll opens once per programme item and
  closes before the boundary, so viewers see the result before it takes effect; `!request` adds a
  released library item to the queue under a per-viewer cooldown and an outstanding-request cap; and
  a `!skip` vote needs both a share of active chatters and an absolute floor. The live poll renders
  in the on-air overlay. Configure it under Studio → Engagement — it ships **disabled**, because
  enabling it hands programme decisions to anonymous chat (v1.5.19)

  Three properties worth knowing before switching it on:
  - a vote can only reorder what is already queued, so chat influences the running order without
    bypassing the schedule
  - a tie is reported as a tie and leaves the schedule untouched, rather than being broken by
    candidate order that viewers cannot see
  - re-voting moves a viewer's ballot instead of adding one, so a tally can never exceed the number
    of distinct voters

### Fixed

- escalate to SIGKILL when stopping playout. The guard also required `!currentProcess.killed`, but
  Node sets `killed` as soon as SIGTERM is delivered, so escalation was unreachable and an ffmpeg
  blocked on a dead input never died — turning a 5s stop into a 300s stall and a container restart.
  A hard stop deadline now bounds the wait even for a child that survives SIGKILL (v1.5.19)
- clear `plannedStopReason` on the early-return path of `stopPlayoutProcess`, so the next genuine
  crash is no longer recorded as an operator-planned stop (v1.5.19)
- handle unhandled promise rejections instead of dying. The fire-and-forget state writes in the
  ffmpeg stderr handler could reject during a transient Postgres outage and kill the broadcast with
  no incident, no alert and no log entry (v1.5.19)
- attach an 'error' listener to both spawned ffmpeg processes; a spawn failure was rethrown
  asynchronously as an uncaught exception the caller's try/catch could not see (v1.5.19)
- split liveness from readiness. Every check in the project used `/api/health`, which returned 200
  unconditionally, so a rollout with Postgres unreachable passed its gates and reported healthy.
  `/api/health` stays liveness (200 while the process serves — restarting the web container does
  not fix a dead database and only removes the UI needed to diagnose it), and the new `/api/ready`
  fails closed with 503 when persistence is unreachable or the workspace was never initialised.
  `upgrade-rehearsal.sh` now gates on `/api/ready` (v1.5.19)
- escape operator-configured chat commands and vote tokens before interpolating them into regular
  expressions run against every IRC message; a command containing "(" threw inside the socket data
  handler and took the worker down (v1.5.19)

## 1.5.18 - 2026-08-18 (unreleased; no images published)

Emergency production fix. DUT had been in a playout restart loop for ~38 hours: 423 restarts,
one every ~5 minutes, with the program pinned to fallback content the whole time.

The boundary-stability work in 1.5.11–1.5.17 assumed an expensive remote resolve stays within
"~60-120s" (queue-prefetch.ts). That assumption was documented in comments but never enforced in
code, and production ran with `TWITCH_VOD_CACHE_DOWNLOAD_TIMEOUT_SECONDS=7200` — 24x the 300s
loop stall guard. `raceResolveAgainstDeath` did not help, because it only unblocks when the
covering playout process dies, and that process was healthily playing the fallback.

### Fixed

- take Twitch VOD downloads off the playout reconciliation cycle entirely: cycles now do a
  read-only cache lookup (`peekTwitchVodCache`) and hand uncached assets to a detached job
  runner, so an unbounded download can no longer consume the cycle's stall budget (v1.5.18)
- resume interrupted VOD downloads instead of restarting them: background jobs use a stable part
  path with `--continue`. The previous per-attempt random path meant a multi-GB VOD restarted
  from zero on every container restart, so with a 5-minute restart cycle it could never finish
  no matter how large the configured timeout was (v1.5.18)
- clamp every timeout awaited on a reconciliation cycle to half the loop stall budget, so an
  operator-configured value can no longer outlive the watchdog that is supposed to catch it
  (v1.5.18)

### Added

- `cycle-budget.ts` as the single source of truth for the loop stall budget and the derived
  ceiling for awaited cycle operations, making the previously implicit timing contract explicit
  and testable (v1.5.18)
- advisory file lock with heartbeat and stale-holder takeover, so the worker and playout
  containers sharing the media volume cannot both write the same resume file (v1.5.18)

## 1.5.17 - 2026-06-12

Accepted runtime-stable production baseline. A clean 24h DUT soak completed naturally
(1415/1415 healthy samples; 100% scheduled_match; 0 readiness failures, 0 programFeed=stale,
0 broadcastReady=false, 0 destination=degraded, 0 uplink unplanned-restart delta) with multiple
clean playout boundaries and no boundary-coupled uplink restarts. Scheduled-path acceptance
granted. Caps the boundary-stability campaign whose fixes all held simultaneously in the soak.

### Fixed

- never block the post-boundary start path on queue prefetch: while no playout process is running, the per-cycle expensive-resolve budget is forced to 0, and an expensive resolve already in flight when the playout process exits is abandoned within milliseconds (the background resolve still populates the probe cache, with in-flight dedup) — closing a ~94s no-playout gap that drained the program-feed buffer (v1.5.17)
- keep the program-feed HLS `EXT-X-MEDIA-SEQUENCE` continuous across playout runs by dropping the per-run `-hls_start_number_source` override, so the persistent uplink demuxer no longer sees a per-boundary sequence jump ("skipping … segments ahead, expired from playlists"), hits EOF, and restarts once per asset boundary into destination degradation (v1.5.16)
- bridge to the local fallback immediately on a clean natural boundary (not only a failed exit) when the next scheduled asset needs a cold expensive remote resolve, so coverage is never dark during the resolve (v1.5.15)
- bridge to local fallback on a failure-driven dark gap and invalidate the probe cache after an immediate ffmpeg input-open failure so a dead/expired resolved URL is re-resolved instead of reused (v1.5.14)
- cap remote queue prefetch to one expensive resolve per playout cycle so a cascade of uncached remote queue assets cannot exceed the loop stall guard and force-restart the playout container (v1.5.13)

### Changed

- bound the single-destination recovery window by lowering the destination-failure cooldown and uplink destination-stall restart defaults to 60s (v1.5.12)

## 1.1.2 - 2026-04-19

### Added

- added cache-backed Twitch VOD playback so archive assets are verified locally before playout uses them
- added a persistent local relay/uplink publishing mode so program playout failures no longer directly own the external RTMP session

### Changed

- moved scheduled output reconnect ownership to the uplink path, keeping the default Twitch reconnect cadence at 48 hours
- updated production pins and release guidance for the relay/uplink runtime

## 1.0.3 - 2026-04-03

### Fixed

- fixed Twitch channel archive ingestion so channel connectors sync archive VODs instead of failing on offline channel pages
- fixed Twitch archive playback URL normalization for `v<id>` entries emitted by `yt-dlp`
- fixed worker/playout healthchecks by marking ESM worker packages explicitly as modules
- fixed source validation for real YouTube handle/channel URLs and repaired the sources UI for long names and URLs
- fixed playout state recovery so valid assets can automatically clear crash-loop protection
- blocked destructive source deletion while sources are still referenced by pools or schedule blocks
- fixed standby-to-asset switching so the old FFmpeg process is fully stopped before a new one starts
- fixed pool playout selection so the currently running asset stays active instead of rotating every worker cycle

## 1.0.2 - 2026-04-03

### Fixed

- fixed `playout_runtime` persistence SQL so worker and playout no longer crash on PostgreSQL-backed state writes
- stable production env example now points at `v1.0.2`

## 1.0.1 - 2026-03-27

### Added

- added `.env.production.example` with pinned `v1.0.0` image tags for stable deployment
- clarified README and deployment docs to distinguish evaluation envs from production-pinned envs

## 1.0.0 - 2026-03-27

First stable self-hosted release for running a Twitch-first 24/7 channel with Docker, GHCR images, scheduling, source ingestion, playout control, Twitch sync, overlays, and operator tooling.

### Added

- Docker / GHCR delivery with `web`, `worker`, and `playout` images
- setup wizard with owner bootstrap and local login
- Twitch broadcaster connect and Twitch SSO for team access
- encrypted-at-rest managed secret storage with `.env` fallback
- PostgreSQL-backed runtime state and persistent operational data
- local media, direct media URL, YouTube playlist, and Twitch VOD ingestion
- minute-accurate schedule editing with drag-and-drop timeline repositioning
- FFmpeg-based playout foundation with fallback selection and operator overrides
- browser-source overlay page and overlay studio
- Twitch title, category, and schedule segment sync
- moderation policy, incidents, drift checks, Discord alerts, and SMTP email alerts
- worker/playout healthchecks, crash-loop protection, release preflight, upgrade rehearsal, and soak-monitor tooling

### Operational Notes

- `latest` is for evaluation and non-production testing.
- Production deployments should pin explicit version tags such as `v1.0.0`.
- Read `docs/upgrading.md`, `docs/backup-and-restore.md`, and `docs/operations.md` before production upgrades.

## Versioning Policy

- `latest` is for evaluation and non-production testing.
- Production deployments should pin explicit version tags such as `v1.0.0`.
- Read `docs/upgrading.md` before upgrading between versions.
