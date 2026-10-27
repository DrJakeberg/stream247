# Milestone notes

Sections for milestones in **Open** of `PLANS.md` that need more than their row, appended in milestone order.
Moved out of `PLANS.md` in M121, text unchanged. When a release ships, its sections move to an archive file
under `planning/archive/`, text unchanged.

### M111 The Soak Monitor Follows The Web Container

- Evidence: on 2026-10-18 at 22:15:15 UTC an `apt-get dist-upgrade` on the DUT upgraded `containerd.io`;
  the Docker daemon restarted and every container with it, on air again 16 s later. `web` came back as
  `172.22.0.5` and `172.22.0.7` went to `worker`, so the soak with `CHECK_BASE_URL=http://172.22.0.7:3000`
  read `curl: (7) Failed to connect to 172.22.0.7 port 3000 after 0 ms` for 6 min and ended
  `outage-exceeded` (M110 notes). `http://127.0.0.1:3000`, the address step 10 gave until now, fails on
  the Portainer stack too, which does not publish `web`'s port (M106 notes in the archive).
- Did the monitor see the daemon restart? No. Its restart check compares only `RestartCount`
  (`docker compose ps -q <service>`, then `docker inspect`), which counts the restart policy's restarts;
  a daemon restart starts the same containers again and leaves it at 0 (the counts stayed `web=0 …`).
  Only a readiness sample could catch the gap, and at one sample a minute a 16 s gap at an address that
  stays the same passes unseen.
- Rule: `--follow-web` (without `CHECK_BASE_URL`; no `.env` needed) measures `http://<web address>:3000`,
  the address from `docker inspect` of the project's `web` container, on the network named after the
  project when it is on several. On a refused connection (curl exit 7, the 2026-10-18 shape; only `web`
  listens on 3000, so an address handed to another service refuses) it reads the address again; when it
  moved it logs `web-address-changed old=… new=… network=…` and takes the same sample there. No `web`
  container or no address at the start stops it (`Cannot follow the web container: …`); mid-run the
  sample counts as failed and its line carries `web-address-lookup-failed: …`. `CHECK_BASE_URL` alone
  keeps the old behaviour exactly; the two exclude each other.
- Decision on the daemon restart (the brief's safer reading): record and report, the outage rules
  unchanged. After each healthy sample, and once more when an outage ends the soak, the monitor reads
  every service's `State.StartedAt` (never while an outage runs, see the next point): all moved is logged
  once as `docker-daemon-restart startedAt=<time> services=…`, some moved as `container-started-again …`,
  and the completion line adds `dockerRestarts=N containersStartedAgain=N`; a pass with either above 0 is
  "passed with failure". Recommendation: keep it so rather than failing the soak like a container
  restart. The restart of 2026-10-18 cost 16 s of air, less than the nightly reconnect the outage window
  carries; a host upgrade is not an app fault, and the samples still fail the soak when the stack does not
  heal within the window. A restart by the restart policy still fails the soak as before.
- Docker calls on the failure path (review of the first draft): with socket activation (`docker.socket`,
  `TimeoutStartUSec=infinity` on the development host, which has the DUT's apt packaging) a docker call made while `dockerd` is
  stopped or starting waits instead of failing. The draft read the start times before every sample, so a
  monitor stuck there took no samples, and a long off-air time with `dockerd` down could end as a pass.
  Rule: every docker call goes through `timeout $SOAK_DOCKER_TIMEOUT_SECONDS` (10 s; a call that does not
  answer reads `unknown`, the follow lookup `web-address-lookup-failed: docker did not answer within …`);
  the start times are read only after a healthy sample and at the `outage-exceeded` exit, so with
  `CHECK_BASE_URL` the failure path asks docker nothing, as at `2ee0866`, and with `--follow-web` only the
  one bounded lookup. The exit read lets the log of a soak that a daemon restart ended name it (the
  2026-10-18 run would have read `docker-daemon-restart` right above `outage-exceeded`).
- Tests in `tests/unit/release-readiness.test.ts`, with stubbed `docker` and `curl` on `PATH` and the
  `SOAK_CLOCK_FILE` clock: the address moves mid-run (one changed line, no failed sample, no outage); a
  public `CHECK_BASE_URL` (no `NetworkSettings` lookup, a refused connection counted as before); no `web`,
  no address, both options (a clear message, no sample); `web` without an address at the refused sample
  (counted, followed at the next); a daemon restart (one line, `dockerRestarts=1`); one container started
  again (`containersStartedAgain=1`); the 2026-10-18 replay with `--follow-web` (no outage, both lines).
  All seven fail against the script of `2ee0866`. Three more with a docker stub that hangs from the second
  sample on (`SOAK_DOCKER_TIMEOUT_SECONDS=0.2`): `--follow-web` keeps sampling and ends `outage-exceeded` at
  360 s (one bounded lookup per refused sample, then the closing read); an explicit `CHECK_BASE_URL` asks
  docker nothing during the outage (only the five closing calls); the 2026-10-18 run as it ran (old address
  in `CHECK_BASE_URL`) logs `docker-daemon-restart` right above `outage-exceeded`. Against the first draft
  the two hanging ones hang until the test's 60 s limit and the third misses its line; against `2ee0866`
  the first and the third fail, the second only on the closing read (that script's failure path asked
  docker nothing, the behaviour it pins).
- Not measured in this session: `curl`'s exit code at a real stale container address (the session's
  sandbox times out on every container address, curl 28); the DUT log of 2026-10-18 shows 7. The
  monitor's `curl` calls still have no timeout of their own (unchanged). The docker timeout is tested with
  a hanging stub only, not against a stopped socket-activated `dockerd`. The first `--follow-web` soak is
  under *DUT checks for the next release candidate*.
- Merge PR (2026-10-21): the unit run exited 1 with every test green, `[vitest-worker]: Timeout calling
  "onTaskUpdate"` (CI job 118956625641, and twice in the cloud). The root-env lock's poll and hand-over pause
  used `Atomics.wait`, so release-readiness kept its worker's event loop blocked for its whole synchronous
  run (about 160 s alone); both release test files now wait on timers. 51 tests unchanged, no error line.

### M112 A Broken Source Neither Crashes Nor Stalls The Loop

- Checked against `main` at `abc4676` first: none of the three was fixed by M105-M111.
  `planning/review-2026-10-05.md` has no entry for them; at `abc4676` the playout's stderr handler still
  fired `void updatePlayoutRuntime(` and `void upsertIncident(` per chunk (`apps/worker/src/index.ts`,
  the handler after the M105 comment on listeners), `selectPoolAsset` knew no failed pick, and the two
  source syncs passed `SOURCE_SYNC_YTDLP_TIMEOUT_MS` to every call.
- **1, the noisy ffmpeg (M98 follow-up 2).** Each stderr chunk of the playout fired a runtime write
  (`updatePlayoutRuntime`: a whole state read under the state write lock), each line with "error" an
  incident upsert, each output error a destination write (`markDestinationFailure`, another whole state
  read); the uplink the same minus the runtime write, plus a feed-status write per feed input error. All
  unawaited. `CoalescingWriter` (`apps/worker/src/coalescing-writer.ts`) keeps one write in flight per
  kind and keeps only the latest value meanwhile; the first of a burst is written at once (an incident
  opens on its first line), the last always. Intervals: runtime sample 2 s, each stderr incident 10 s
  (keyed by fingerprint: `playout.ffmpeg.stderr`, `uplink.ffmpeg.stderr`, `program-feed.input`),
  destination failure per destination with no interval (`markDestinationFailure` keeps its own 15 s
  dedup), feed status 5 s. The log line per chunk is unchanged. A failed write is logged once as
  `ffmpeg.stderr.write_failed` with its writer instead of an unhandled rejection. Not measured with the
  real mp4 in the cloud (the stack's images do not build here); the test models it with a pg-like pool
  (10 connections, a caller waiting longer than the timeout fails with pg's message).
- **2, the pool on a broken pick (M98 follow-up 1).** A failed inline resolve of a `scheduled_match` pick
  is written to the probe cache as a failed, already-counted probe (`recordSelectionResolveFailure`) and
  added to the list quarantine counts, after the same network-outage filter (`dropNetworkOutageOutcomes`,
  path `selection`) and not twice for an item the queue probed in the same cycle; the breaker keeps
  hearing it from `recordSelectionResolveOutcome` only, so no outcome is counted twice. `selectPoolAsset`
  passes over an item whose fresh cache entry is a failure (`isPassedOverPoolPick`), for the minute the
  cache keeps a failure (`NEXT_ASSET_PROBE_FAILED_TTL_MS`). While a fresh failure is cached, a further
  failure of the same item neither refreshes its time nor counts again, so quarantine counts at most
  one failure a minute per item, as for the queue's probes. Not passed over and not recorded: a Twitch
  archive still downloading (`TwitchVodCachePendingError`), and every pick that is not the schedule's
  (inserts, Move next, Pin, fallbacks).
  - Decision (within the suggestion's "do it"): the pass-over also applies to a failure the queue's
    prefetch found, not only the inline resolve's. Both are the same probe-cache entry, and before M112
    the boundary picked such an item and resolved it inline again. Cost: an item whose probe failed once
    by chance in the minute before its turn loses that turn in this pass of the rotation.
  - A dated block's takeover whose pick fails to resolve (review T1, M105) still holds the item on air
    for that cycle; from the next cycle the takeover's pick is the pool's next item, so a pool with one
    broken item takes the air with its second one instead of waiting the minute.
  - Not changed: the schedule preview, the week view and the overlay's next title come from core's
    rotation and do not know the worker's probe cache; for up to a minute they can name an item the
    worker passes over.
- **3, the dead host (M87 limit).** One deadline per cycle (`apps/worker/src/remote-call-budget.ts`):
  80 % of the stall guard after the start of `runWorkerCycle` (`RemoteCallBudget.forCycle`, 240 s by
  default), the rest kept for the steps after the calls. The YouTube and Twitch syncs (listing and
  Twitch VOD metadata) and the chapter probes start a call only when its whole own timeout still ends
  before the deadline (`fitsWhole`); no timeout is ever cut short. A source without room is left out of
  that cycle's sync entirely (no run, no status, no replace, no incident: as if the sync had not reached
  it) and goes first in its sync's next run, longest waiting first (`orderDeferredFirst`,
  `source.sync.deferred`), so an overloaded sync takes turns. When a Twitch source was deferred, the
  YouTube sync's calls after its first keep one call's timeout for it (`reserveMs`), and its first call
  too when the Twitch sync's last run started no call at all behind a YouTube call
  (`twitchSyncHeldBack`): the two syncs take turns whenever the cycle has room for one call after the
  earlier steps. The deferred sources are
  kept per sync step and replaced by each run, so a source disabled while deferred drops out. A call that runs out of its timeout is reported as failed as before and its source
  is paused for 10 min (`SourceSyncPauses`, process memory, keyed by source id and URL,
  `source.sync.paused`).
  - Worst case with the defaults: two whole listings of 120 s per cycle, ending by 240 s, against the
    300 s stall guard. Each dead host costs one call per 10 min.
  - Not covered: the steps after the calls (Twitch requests, 10 s each, chat) get the remaining 20 %
    (60 s by default, 12 s at the 60 s minimum); a Twitch API that hangs on every request on top of dead
    source hosts can still reach a stall guard set near its minimum, as before M112. With a stall guard
    near 60 s and earlier steps that leave less than one call's 30 s, the syncs wait for a faster cycle.
    The chapter backfill runs after both syncs and has no reserve of its own: while slow listings fill
    every cycle, chapters wait (they are a backfill, nothing airs from them).
- Reviews (fresh subagents, six rounds). Item 3 changed design each round and ended at the simplest
  rules: the first shared budget let a dead YouTube host take every cycle's time from Twitch and
  chapters; cutting a timeout short to what was left reported healthy slow sources as failed; step
  budgets with a deferral after one cut-short timeout still reported a recovered or slow healthy source
  (walked last, or cut short twice), starved Twitch at a 60 s stall guard, and documented a pause cost
  that was twice the real one. Now no timeout is cut short, so none of these can happen; overload is
  handled by deferring and taking turns. The fourth round found that the Twitch reserve, asked for
  every YouTube call, held back the YouTube sync entirely under a heavy Twitch load, and that a Twitch
  source disabled while deferred kept it so until a restart (now the first YouTube call has no reserve
  and the deferred sets are per step). The fifth found that a first YouTube call that leaves less than
  one call's time (a 115 s listing after 10 s of earlier steps, a dead host) then kept Twitch waiting
  for good (now the first call keeps the reserve too after a Twitch run without a call). The sixth (60,000
  random cycle mixes, no healthy source reported failed) found that a Twitch sync that could not fit even
  alone then held YouTube back too (now only a Twitch run held back behind a YouTube call counts). Also found and fixed: chapter probes could get a cut-short
  timeout (now whole only); a pause outlived a fixed URL (now keyed by the URL too); the
  `program-feed.input` upsert held back 10 s could reopen the incident the uplink had just resolved
  (that key writes one at a time, without the interval); a throwing error reporter could leave an
  unhandled rejection (caught). Left as they are, documented in `docs/operations.md`: the runtime queue
  still lists (and labels as prefetched) a passed-over item, and warms the items after it, the actual
  pick; a destination's failure count grows per coalesced write, not per line; a pick that failed during
  the channel's own network outage is passed over for up to a minute after the network is back (not
  counted). Left, not documented for operators: the outage check runs once for the breaker's record and
  once for quarantine's, so a verdict that changes between the two can count a failure for one and not
  the other (the same can already happen between two cycles); a cycle that ends early after the pick's
  failure was cached (the crash-loop hold, a throwing step) loses that one count for quarantine, the
  breaker keeps it.
- Tests: `tests/unit/coalescing-writer.test.ts`, `tests/unit/selection-pass-over.test.ts`,
  `tests/unit/remote-call-budget.test.ts`; pins updated in `tests/unit/probe-network-outage.test.ts`,
  `tests/unit/source-breaker-wiring.test.ts` (the new lines after the breaker's record of the failed
  resolve) and `tests/unit/source-listing.test.ts` (the listing takes the budget's timeout).
- `CHANGELOG.md` is not touched: per `AGENTS.md` the release commit writes its section.

### M113 Overlay Data And Twitch Segments That Do Not Go Unnoticed

- Checked against `main` at `85de666` first: neither was fixed by M105-M112, and
  `planning/review-2026-10-05.md` has no entry for them. At `85de666` `mapOverlayRowToRecord` parsed
  `layer_order_json`, `disabled_layers_json`, `scenes_json` and `panel_placements_json` bare
  (`packages/db/src/index.ts:1140-1148`, only `custom_layers_json` guarded), the preset reader
  `overlay_json` (`:1250`), and `syncTwitchSchedule` awaited the stale DELETE without reading its answer
  and then wrote only the planned segments (`apps/worker/src/index.ts:10164-10183`).
- **4, overlay columns.** One helper per shape, `parseStoredJsonArray` and `parseStoredJsonObject`: text
  that is not JSON, or JSON of the other shape, reads as the empty column. The normalizer after them
  handles wrong entries inside a list or an object, except `disabledLayers` of a preset that is not a
  list, which now reads as none. No warning is
  raised for such a row, as with M85: the studio shows the fallback, and saving writes the column anew.
- **5, stale segments.** `apps/worker/src/twitch-schedule-cleanup.ts`. Decisions: a 404 counts as deleted
  (the segment is not there); a segment whose start has passed is dropped after a failed delete, because
  it is no longer an upcoming entry and keeping it would hold the warning open with no way to clear it;
  the retry rides on the regular sync (15 min) instead of every worker cycle, because the stored keys
  would otherwise never equal the plan and every cycle would resend the whole schedule. The set of kept
  keys is held in memory, so after a worker restart the first sync runs once at once. A stored segment
  whose PATCH answers 404 is created anew with a POST (found by the review: a delete Twitch carried out
  without confirming it keeps a dead id, and a block planned again would otherwise fail every sync; the
  same was true before for a segment deleted by hand). A 401 on a delete
  does not trigger the token refresh by itself; the channel and schedule writes of the same cycle do.
- Not measured: Twitch's real answer to a DELETE of a past segment (the proxy blocks twitch.tv); the
  code does not depend on it. The M113 entry under *DUT checks for the next release candidate* covers the live path.
- `CHANGELOG.md` is not touched: per `AGENTS.md` the release commit writes its section.

### M114 A Frozen Process Restarts And The Relay Is Watched

- Checked against `main` at `21f0646` first: still open. The M103 self-restart runs in the process's own
  loop (`enforceHealthSelfRestart`, `apps/worker/src/index.ts:11661`), and the stall guard
  (`runWithStallGuard`, `:11588`) is a timer on the same event loop, so neither runs in a blocked or
  stopped process; only `traefik` mounted the Docker socket (`docker-compose.yml:30`), and `relay` was the
  one service without a healthcheck. `planning/review-2026-10-05.md` has no entry for it.
- **The relay image.** `bluenviron/mediamtx:1.15.4` holds `/mediamtx` and `LICENSE`, nothing else
  (`docker export` of a container of it, listed with `tar -t`): no shell, no HTTP client, no health
  subcommand (`/mediamtx --help` names only `--version` and `--upgrade`). A Compose healthcheck cannot run
  inside it, and the pin stays.
- **Owner's choice (2026-10-21 08:11 UTC, two cards in the M114 thread).** "Wer soll eingefrorene worker-,
  playout- und uplink-Prozesse neu starten?" → "A: Aufpasser im Container" (no Docker socket). "Was soll
  passieren, wenn das Relay nicht mehr antwortet?" → "2: Melden und neu starten". Restarting the relay
  needs the Docker socket, which A leaves out; the follow-up question is in the thread, and until it is
  answered M114 reports the relay (part of every option).
- **Supervisor.** `apps/worker/src/process-supervisor.ts`, entry `apps/worker/src/supervisor.ts`. The
  child sends `stream247.heartbeat` over the IPC channel every 10 s from an unref'd timer; the supervisor
  checks every 5 s and kills the child with SIGKILL after five minutes (the M103 bound) without one, writes
  `stream247-frozen-<mode>.json` to the temp directory (kept across a container restart) and exits 1; the
  next process reads it and raises `<mode>.health.frozen-restart` (the marker stays until the incident is written, so a database that is not up yet only postpones it to the next start) (warning, event, closed by the
  area's health like the M103 incident). A child that ends by itself ends the supervisor with its code;
  SIGTERM, SIGINT and SIGHUP are passed on, so `docker stop` ends the child as before (it has no handler of its own; the supervisor then exits 143). Tini
  stays PID 1.
- **Relay watch.** `apps/worker/src/relay-watch.ts`, worker cycle step `relay`: while relay mode or live
  sources are on, `GET http://relay:9997/v3/paths/list?itemsPerPage=1` (5 s); any HTTP answer is alive.
  Two minutes without one raise `relay.unreachable` (critical, state, action `docker compose restart
  relay`); the first answer closes it, and so does switching both uses off.
- **Run by hand** (built worker, PostgreSQL 16 in Docker, 2026-10-21): `node apps/worker/dist/supervisor.js
  worker` showed two processes (`supervisor.js worker`, `index.js worker`); `kill -STOP` of the child at
  08:19:59 UTC, at 08:24:57 the log had `{"event":"worker.supervisor.frozen","mode":"worker","silentForMs":304974}`,
  supervisor and child were gone; the next start logged `worker.health.frozen_restart` and the incidents
  table had `worker.health.frozen-restart|warning|open`.
- **Review without prior knowledge** (subagent, on `fabb5cd`): no high or medium finding. Fixed: a heartbeat
  on a closed IPC channel reached the uncaught-exception handler (now `process.connected` and a send
  callback, test added and seen failing first), the marker was dropped before its incident was written,
  and the "never sends a heartbeat" stand-in sent one. Left as is: a one-off `index.js <cmd>` in the
  container falls through to worker mode as before and would report the marker too; SIGUSR1/2 and SIGQUIT
  are not passed on; `docker pause` is not covered (stated above).
- **Relay watch by hand** (same run, `STREAM247_RELAY_ENABLED=1`, no relay at first): `relay.unreachable`
  logged at 08:27:15 UTC with `unreachableForMs` 125240, row `relay.unreachable|critical|open`; with a
  stand-in answering on `relay:9997` the next cycle logged `relay.reachable` (08:29:20) and the row read
  `resolved|The relay answers again.`
- `CHANGELOG.md` is not touched: per `AGENTS.md` the release commit writes its section.
- **Follow-up: relay watchdog (owner's choice 2026-10-22 20:34 UTC).** Card "Wie passen „A: Aufpasser im
  Container“ und „Relay neu starten“ zusammen?" → "A und kleiner Relay-Wächter": the supervisor stays, and a
  service of its own with the Docker socket restarts only the relay. `apps/worker/src/relay-restart.ts`
  (`RelayRestartPolicy`, the Docker calls, one round), entry `apps/worker/src/relay-watchdog.ts`, service
  `relay-watchdog` from the worker image. It finds its own container by `HOSTNAME`, the project by its
  `com.docker.compose.project` label, the relay by that label and `com.docker.compose.service=relay`.
  No database, so it works while the rest is down; the worker's `relay.unreachable` (two minutes) tells
  the operator first, and its action now names the watchdog. Restarts back off 5, 10, 20, 40, 60 min and
  reset after 30 min of answers; a relay that is stopped or paused is left alone (someone's decision).
- **Run with the real image** (2026-10-22, Compose project with `bluenviron/mediamtx:1.15.4` and the
  watchdog from the built worker on `node:22-alpine`): `docker kill -s STOP m114wd-relay-1` at 20:38:19
  UTC; at 20:41:59 `{"event":"relay.watchdog.restart","unreachableForMs":210186,"attempt":1}`, the relay
  started again at 20:42:09 and `GET http://relay:9997/v3/paths/list` answered 200.
  Then `docker pause m114wd-relay-1` at 20:42:39: at 20:47:41 still `paused`, start time unchanged, no
  further `relay.watchdog.restart` line.
- **Review of the follow-up** (subagent without prior knowledge, on `5b3974f`): no blocking finding. Fixed:
  a relay that never answers (another network, `api: no`) would have been restarted every hour, so a
  restart now needs an answer since the start or the last restart (`relay.watchdog.never_answered`);
  one-off `docker compose run relay` containers are filtered out and a running container is preferred;
  the round loop catches errors and the response stream has an error handler (a crash would have lost
  the backoff); the restart call waits up to 60 s; answers from before a stop no longer count towards the
  30-minute reset; hold lines are logged once per streak; the incident action uses `logCommand`. Left as
  is, documented in `docs/operations.md`: the watchdog does nothing with a `hostname:` override,
  `network_mode: host` or `docker stack deploy`.
  Run again with the real image after these fixes: SIGSTOP at 20:55:07 UTC, `relay.watchdog.restart` at
  20:59:02 (`unreachableForMs` 210202, attempt 1), relay running again from 20:59:13.

### M115 A Stock RTMP Server Takes The Uplink

- Checked against `main` at `5d2d08a` first: still open. `buildTeeOutputOptions`
  (`apps/worker/src/multi-output.ts:171`) gives every destination `f=flv` behind `tee` with the fifo, and
  neither the uplink's encoded command (`buildUplinkFfmpegCommand`, `apps/worker/src/ffmpeg-runtime.ts`)
  nor the playout's three encoded commands (`apps/worker/src/index.ts`, relay off) asked the encoder for a
  global header. M105 to M114 did not touch it; `planning/review-2026-10-05.md` has no entry for it.
- **Measured in the cloud container** (2026-10-21, Ubuntu ffmpeg 6.1, `bluenviron/mediamtx:1.15.4` pulled
  through `mirror.gcr.io`, the uplink's encoder and tee options, 30 s): without the flag 34 connections,
  the first closed `unable to parse H264 config: invalid size 1`, the next 28 ended with
  `extract_extradata: A non-NULL packet sent after an EOF`, the path never ready. With `-flags:v
  +global_header`: one connection, path ready, `bytesReceived` 4704648; a `docker restart` of the server
  10 s in was reconnected by the fifo and the path was ready again. The real worker image cannot be pulled
  here (its blob host answers 403), so the broadcast smoke's phase 5 measures it in the pull request's CI,
  with a mutation run of the same image's ffmpeg without the flag.
- **Owner's choice** (2026-10-22 20:34 UTC, card in the M115 thread): "Soll ein eigener RTMP-Server (nicht
  Twitch) als Ziel zuverlässig gehen?" → "Ja, reparieren".
- **Measured with the real images** (pull request CI, run 39580526227 on `dc13a34`, broadcast smoke):
  `Stock RTMP server: closed connections 0 -> 0 over 60s; refused headers 0; a reader got 17257 bytes in
  5 s`; mutation with the worker image's ffmpeg: `refused headers 0 -> 1 without the global header`. The
  bug is confirmed on the Alpine image, not only on the stand-in.
- **Review without prior knowledge** (subagent, on `dc13a34`): no high finding. Fixed in `b086d61`: one
  uplink restart for another reason during the measurement no longer fails phase 5, a refused header is
  named while waiting for the first publish, the `PHASES` comment names phase 5. Left as is: two of the four
  unit tests guard against regressions and pass on `main` too; the source pin in the fourth reads calls with
  a regular expression.
- **Why only encoded outputs.** With `-c copy` the header comes from the input, and ffmpeg warns that the
  option was used for no stream; the uplink's copy command (relay input, no output profile) passes
  `streamCopy`.
- `CHANGELOG.md` is not touched: per `AGENTS.md` the release commit writes its section.

### M117 A Password Change Signs The Old Sessions Out

- Checked against `main` at `22b6b13` first: still open. `parseSessionValue` (`apps/web/lib/server/auth.ts`)
  checked only the signature and the 30-day age, `setOwnerPasswordHash` changed nothing a session carries,
  and `apps/web/app/api/setup/bootstrap/route.ts` checked `password.length < 10` while the change route and
  the reset command used `MIN_OWNER_PASSWORD_LENGTH`. M105 to M116 did not touch it.
- **How.** No new table or column: the cookie carries a 16-hex stamp, `HMAC(app secret, "password:" +
  stored hash)`, inside the signed payload, and `getAuthenticatedUser` compares it with the stamp of the
  user's current hash (`sessionPasswordHash`: the user row's hash, else the `system_state` one, as the
  sign-in reads it; empty for Twitch sign-ins). A change or reset writes a new hash, so every older stamp
  stops matching. The stamp does not reveal the hash: it is keyed with the app secret and truncated.
  `getAuthenticatedUserId` (the database-free pre-check of the scene preview) still checks only signature
  and age; the role check after it reads the user and the stamp.
- **Choices made without asking** (the suggestion answers them, or they follow the usual practice): the
  session that changes the password stays signed in; the reset command signs out every owner session;
  team members signed in with Twitch are not touched, they have no password. Cookies from before M117 have
  no stamp and are refused, so the update signs everyone out once rather than keeping old sessions that a
  change could not end.
- **Minimum length.** The two forms take it as a prop from their server pages (`MIN_OWNER_PASSWORD_LENGTH`
  from `@stream247/db`), since a client component cannot import that package.
- **Review without prior knowledge** (subagent, on `c1d2bba`): no high finding; every reader of the cookie
  goes through the stamp check, and all five `setSessionCookie` callers pass the right hash. Fixed: the
  forged-stamp case now builds a correctly signed cookie with another password's stamp (before, it failed
  on the signature). Left as is, outside this milestone: a 2FA challenge issued in the five minutes before
  a change still completes with a valid one-time code (the challenge is not bound to the password);
  `upsertUserRecord` writes `password_hash` from the copy it read, so a sign-in racing a change can write the
  old hash back (older than M117, which now also revives the old sessions in that window); a Twitch
  identity linked to the local owner row would keep `authProvider: "local"` and change its e-mail, which
  `setOwnerPasswordHash` matches on (not possible today).
- `CHANGELOG.md` is not touched: per `AGENTS.md` the release commit writes its section.

### M118 The Week View And /channel Plan With What Really Airs

- Checked against `main` at `caf3d40` first: all four still open. `materializePoolWindow` used only
  quarantine and the breaker (no cooldown), filled the block on air from `nowMinuteOfDay`, filled each
  block whole in block order, stopped at 5 000 items, started every block at its own start;
  `getPublicProgrammeCurrentItem` returned null without a length; `summarizeCuepoints` called
  `getCuepointProgress` without air windows. M105 to M117 did not touch them.
- **How.** The projection is now `createBlockProjection`: a block filled one air window at a time.
  `buildMaterializedProgrammingWeek` walks every window of the week in time order with one rotation state
  per pool, and a "busy until" time: the item on air (`onAirItemEndMinute`) or an item that ran over its
  block's last window. A window waits for it unless it takes the air with a cut (a dated block, or the
  block after one ends, R7); the window on air now always does. Cuepoints before now count as fired, as
  before; cuepoints of a block delayed by the item before do not (the worker fires them at the next
  boundary). The item bound is the window's length over the shortest item it can play (at least 1 s),
  capped at 200 000.
- **Cooldown.** The rule moved to core (`getTwitchVodCacheCooldownEndMs`, the worker's
  `isTwitchVodCacheCoolingDown` calls it). `getProjectionClock` (web) turns each end into a minute of the
  week (`itemHolds`), with the cooldown from `resolveVodCacheTuning`, as the worker. The projection asks at
  each pick, so the item comes back once its cooldown has ended; when every item of the pool is held it
  waits for the first to end. An insert or cuepoint item in its cooldown is not inserted then, like the
  worker's insert checks.
- **Choices made without asking** (the suggestions say "do it", the rest follows the worker): an item of
  unknown length is planned with the 30-minute estimate the week view already uses for such items, or with
  now once that has passed; `/channel`'s *Now* then shows "since HH:MM" (new viewer text, en and de) and
  no progress bar. A block that the item before covers completely reads *Covered by the item before*
  (status `balanced`, not `empty`: it has material). `nowMinuteOfDay` now carries the seconds, so the
  item times on `/channel` no longer round to the minute.
- **Tests changed, not weakened.** `pool-rotation.test.ts` pinned `function materializePoolWindow(` to
  contain `createPoolRotation(`; the function is `createBlockProjection` now, same assertion.
  `schedule-midnight.test.ts` pinned `occurrenceKey: getScheduleOccurrenceRunKey(currentScheduleItem)` in
  `state.ts`; it now pins that worker and web call `getOccurrenceCuepointProgress` with the occurrence and
  that the core function keys by the run.
- **Review without prior knowledge** (subagent, on `0103c03`): acceptance met. Fixed: without an item on
  air (standby, a live input) a part of the block on air that had already ended was filled from its own
  start and moved the pool on (weekly 10-14 cut by a dated 11-12, 12:30: a1-a3 at 10:00-10:40, then a4);
  every window of the block on air now starts at now at the earliest (test). The item bound gets one spare
  turn per hold. Left as is: the end of the item on air and of a cooldown are turned into wall-clock minutes
  in a straight line from now, so one that crosses the clock change is placed an hour off that night; a
  week of 1-second clips takes about half a second to project (the admin week view has no cache; `/channel`
  keeps its 5-second one).
- `CHANGELOG.md` is not touched: per `AGENTS.md` the release commit writes its section.

### M119 The Day Lens Speaks Plainly And Dated Blocks Say What They Take Over

- Checked against `main` at `9493e8a` first: both still open. The editor's day card read
  `${totalScheduledMinutes}m scheduled · ${totalProjectedMinutes}m projected` and "materialized block(s)";
  the page's *Video-level timeline* came from `getSchedulePreview` → `buildSchedulePreviewVideoSlots`, which
  starts every block at the pool's stored position; the block form had no notice and no day count; `PUT`
  checked a repeat-set edit's dates against the edited copy's weekday only. M105 to M118 did not touch them.
- **Day lens (18).** The page's lower panel is now *What this day plays*: one row per block of the chosen
  day from the week projection (the week view's data), with its fill, its numbers in words, the repeat
  reason, the notes and *Show videos*, whose bar is drawn from the projected items' air times. The separate
  *Live queue context* and *Video-level timeline* items are gone (the editor's *On air now* card keeps the
  queue). Words: hours through `formatScheduleHours` (as the week view), "blocks" not "materialized blocks",
  "repeats videos" / "runs past the end" / "with nothing to play" for the three counts (also in *Weekly
  coverage*), "of different videos" and "planned" for unique and projected minutes, "timed insert" for
  cuepoints, "Overlaps another block", and three fill notes reworded (pool insert, timed inserts,
  estimated length), a fill pill "Ends 40 min late" (was "40m", also in the week view; three test
  expectations follow the text) and "90 min default" for show profiles. The dashboard is unchanged.
- **Dated blocks (19).** `describeScheduleTakeover` (core) gives the notice R1 1.3 step 8 designed, from the
  form's live values: per weekly block title and span, the dates it is cut, and where it goes on. It follows
  the layer rule (a dated block's start date bounds it; the evening before and the next morning count) and
  leaves dated blocks out: those are conflicts, refused on save. Lines with the same title and span are
  grouped, so a weekly daily set reads as one line. *For how many days* sits next to the two dates and sets
  the last date from the first. Start hour, start minute and the edit form's day are controlled now, so the
  notice follows them. With *Apply to repeat set* and short dates the form names the weekdays that would be
  refused.
- **Choices made without asking** (the list says "do it"): a repeat-set edit whose dates leave out a copy's
  weekday is refused with those weekdays named, rather than saving copies that never air or deleting them
  (the same rule Duplicate and Clone day follow since M93). The notice is a hint, not a gate: nothing is
  asked before saving.
- **Review without prior knowledge** (subagent, on `7999882`): acceptance met. Fixed: the part of a dated
  block past midnight named its start date instead of the morning it cuts (test now says *Sat 3 Oct*);
  the bar drew the videos after a dated block's cut right after the cut (a gap now keeps them at their
  time, test); a block covered by the item before said its pool had nothing to play; "Ends 12m late",
  "90m default", *Overflow* and "No playable video slots" kept minutes or internal words; a stored start
  off the quarter hour made the notice and the save disagree (the form now starts it at :00, as the select
  always saved); *For how many days* is off without a first date and capped at 3660. Left as is: a run
  longer than a year is described by its first 366 days.
- `CHANGELOG.md` is not touched: per `AGENTS.md` the release commit writes its section.

### M120 Operator Actions Are Visible And Stay Done

- Checked against `main` at `3336b81` first: all four parts still open. The control room showed only a
  Move next; Resume was disabled unless `overrideMode` was not `schedule` or an insert was pending or
  active (`playout-action-form.tsx`); `broadcast.ts` wrote `pendingAction: ""` in nine actions and
  `"rebuild_queue"` over a waiting Refresh in four; `decideInputOpenRetry` asked for `failed` and nothing
  running, so a Restart's `recovering` or the reconnect slate's running process ended the retry without a
  line. M105 to M119 did not touch them.
- **Visible (M89 "Not changed").** `apps/web/lib/operator-holds.ts` lists every hold Resume clears, in
  words with the time left measured against the snapshot's time (no clock zone needed), and the waiting
  Refresh or rebuild; the control room shows them as *Operator holds* under the next item. The summary
  now carries `removeNextAssetId` and `removeNextUntil`. Resume is enabled while any hold is in effect.
- **Choice made without asking** (the list says "do it"): Resume of a skip hold, a Remove next or a Move
  next alone restarts nothing, also without the relay. Those change what comes next; the old direct-mode
  restart on every Resume would have cut the picture to clear a hold. A Pin, Fallback or insert restarts
  as before.
- **Never lost (M89 "Not changed").** No admin action writes the pending action except Refresh and the
  four that rebuild the queue, and those add theirs (`addPendingPlayoutAction`; new value
  `refresh_and_rebuild_queue` in the existing text column). The worker carries out both parts in one
  cycle, the rebuild's write clearing the request with `decideCycleEndPendingAction` as before.
- **Retry (M94 review "Left as is").** `decideInputOpenRetryAtSlate` runs right after the slate step of
  every cycle: a reconnect slate that replaces the retry keeps it owed (`coveredBySlate`, the selection's
  reason code kept), and the retry arm picks it while nothing is named on air, so the first cycle after
  the slate's window starts it; any other slate or standby, or another item after the slate, drops it
  with a log line. A Restart, Skip or Force reconnect pressed after the failure writes `recovering` or
  `reconnecting`; those now count like `failed` for the retry (a Skip still holds the item out).
- **Review without prior knowledge** (subagent, on `6c1cde8`): acceptance met. Fixed: a retry the slate
  kept survived a Live Bridge that took the air after the slate (now dropped, `reason: live-bridge`, test);
  operations.md said a Skip no longer cancels the retry (a Skip of the failed item still holds it out).
  Left as is: *Operator holds* reads a Pin from its mode, item and minutes, not from core's
  `resolveOperatorOverrideHold` (a Pin of an unready item or under a Live Bridge is listed, and Resume
  restarts for it without the relay, as before M120); a Pin that ran out but is not yet cleared by the
  worker's next cycle makes Resume restart nothing; a `dropped` line can name a retry the selection had
  already passed over, when a later slate or standby comes within its ten minutes.
- Not measured: the direct-mode slate path on a playing channel; the DUT runs the relay, where no slate
  takes a cycle.
- `CHANGELOG.md` is not touched: per `AGENTS.md` the release commit writes its section.

### M122 The Wizard Keeps Regional Twitch And Finds The Zone

- **Checked against `main` first (a0c1f65).** None of the three was done: M105 (R16, R17) and M116 changed the
  instance and programme steps' hints and writes, not these. The search label of the zone field and the
  programme step's preselection were as M91 and M99 left them.
- **10a, regional Twitch ingest.** `isTwitchIngestUrl` (`apps/web/lib/destination-wording.ts`) knows
  `live.twitch.tv`, `live-<region>.twitch.tv` and `<server>.contribute.live-video.net`, over rtmp or rtmps, on
  `/app`. Such an address preselects *Twitch*, the hint names it, and saving as *Twitch* keeps it; before, saving
  would have moved the channel to the global ingest. Switching from another service to *Twitch* still writes
  `rtmp://live.twitch.tv/app`. Studio → Output was not changed: its form shows the address as it is.
- **10b, preselection.** The step keeps the sources the owner unticked instead of the ticked ones, so a source
  that becomes playable under a mounted form (the step's own "check again" link, a refresh after a failed press)
  arrives ticked. The case: one source plays, a second gets its first ready video, and the form is refreshed
  rather than mounted again (a refresh after a failed press, the router keeping the step); before, the second
  stayed unticked. With no ready video at all the page shows the upload box instead of the form, and "check
  again" mounts a new form, so that case was already right.
- **11, zone list.** A native `<datalist>` from `Intl.supportedValuesOf("timeZone")` (UTC first; zones with an
  underscore get a spaced label, for browsers that match a typed "New York" on the label; not tried in a browser), read on the client only like the browser zone, since
  the server's ICU may list other zones. No new dependency; the field stays a text field, so a saved or typed
  zone outside the list still works and the route still checks it (`isUsableTimeZone`). A browser without
  `Intl.supportedValuesOf` gets the plain field. The hint adds "Type a city or region to pick from the list."
  While `CHANNEL_TIMEZONE` pins the zone there is neither list nor hint. `isTwitchIngestUrl` refuses other
  ports than 1935 and 443 and a user name in the address.
- **Baselines.** `/setup` past the owner step is in neither the design nor the wording baseline
  (`tests/e2e/design-baseline.spec.ts` only creates the owner there), so none was re-recorded.
- `CHANGELOG.md` is not touched: per `AGENTS.md` the release commit writes its section.

### M123 The Clock Change In March, /channel Details And !now In A Short Recovery

- **Checked against `main` first (68bea7b).** None of the three was done. M118 (suggestion 17) had already
  given the live summary's cuepoint count a dated block's air windows, the last part of M101's "Left"; the
  rest of it stood: `toUtcIsoForLocalDateTime` mapped 02:30 on the spring night to 03:30 CEST, the week
  projection had no zone at all, `/channel` grouped by block per day, and `buildChatProgrammeInfo` counted
  `recovering` as nothing on air.
- **20a, the skipped hour.** A wall-clock time in the gap is now the switch itself (03:00 CEST, `01:00Z`),
  the first instant the clock is past it, found by a search between the two offsets (zones with a 30-minute
  gap work the same). Blocks keep their written times (owner decision R3 Q4); only where they are counted
  from changed: the Twitch segment and the cuepoint count of a block from 02:30 start at 03:00, where the
  worker starts airing it, and a block ending at 02:30 ends at the switch (01:00-02:30 is posted for the
  hour it airs). `getScheduleEndInstant` needed nothing: its minute before an end in the gap is in the gap
  too. Two assertions of `tests/unit/schedule-dst.test.ts` pinned M101's mapping and were changed to the
  new one (P4; the Twitch case of a block starting at 02:30, now 01:00Z for 90 minutes), with the old values
  in a comment.
- **20b, the week view and the Day lens.** `buildMaterializedProgrammingWeek` takes the channel zone and
  now (`timeZone`, `now`; `apps/web/lib/server/state.ts` passes both) and projects in real minutes of the
  week: entries, windows, now, the item on air's end and the cache holds are moved onto a real-time axis
  (`createWeekClock`: windows through `getScheduleInstant`/`getScheduleEndInstant`, the way back through
  the week's switches, found once, so an item's clock time costs no zone lookup). A block's fill, overrun,
  cuepoints and holds run on that axis; items carry the clock time they air at (the October night shows
  02:00-02:30 twice); `startSecond` is the block's wall start plus real seconds, which is what `/channel`
  already read; the block gets `lengthMinutes` (real) for the Day lens bar, and its `durationLabel`,
  `projectedMinutes`, the day's scheduled and projected minutes are real (1380 / 1500 on those Sundays).
  Without a zone everything is wall clock as before, so every other projection test is unchanged. In the
  repeated autumn hour the wall-clock minute alone is ambiguous; with `now` the instant decides.
- **21.** *Up next* keeps one group while the next item belongs to the same title and pool and the block's
  window starts where the day before's ends (a daily series is one block per weekday, each with its own id
  and `repeatGroupId`, so the id could not tell it). A daily evening block stays one card per evening.
  `laterScheduleItems` and `getLaterScheduleItems` are gone (no reader since M100); the two `ops-state`
  tests that pinned the field now pin its absence and the *Up next* list that replaced it. Covers on
  `/channel`: the premise is gone, local files have frame-grab thumbnails since 1.x (Library), but `/channel`
  shows no cover for any item; adding covers is a new public feature, asked in the thread.
- **23.** `ChatProgrammeInfo` gets `nowSwitching`; `readPlayoutProgrammeTitles` also reads `skip_asset_id`
  and `skip_until`. Under `recovering` with a programme title, `!now` names it unless it is about to leave
  the air (`isLeavingTheAir`: a running Skip of that item, a Pin or Fallback of another item, a pending
  *Play now* of another item); then "switching to the next video: <next>" / "gleich geht’s weiter mit:
  <next>", or without a known next video "switching to the next video right now." / "das nächste Video
  startet gerade." The assertion in `tests/unit/next-on-air.test.ts` that `!now` is empty under
  `recovering` (M104's documented "Left") now expects the title.
- **Review (fresh subagent).** Acceptance confirmed (10 of 13 failing on `main`'s source, the three named
  passing). Fixed: a week starting on a day whose midnight the clock skips (America/Santiago, Asia/Beirut)
  showed every item an hour early, as `wall` took real minute 0 for 00:00 (it now reads the zone's offset);
  *Up next* compared a third block of one programme with the first and opened a second card; a second inside
  the skipped hour mapped past the switch (02:59:30 after 03:00); an override of another item without a
  running end made `!now` say "switching". Left: on the autumn night, a block boundary strictly inside the
  repeated hour (00:00-02:30, then 02:30-06:00) lets both blocks span the hour, as the worker airs the first
  again from the second 02:00 and M101's Twitch plan posts it; the projection counts that hour for both
  (480 scheduled minutes for 420), a split of each block's windows by the wall clock would be needed.

### M124 An Interrupted Item Continues Where It Was Cut

- **Checked against `main` first (5f41696).** Nothing resumed: `currentPoolAsset` kept an item only while
  its process ran, so any cut lost it, and the pool cursor (written at the start) moved on after it.
- **Owner's rules (2026-10-26 09:55 UTC, "Ja, wie empfohlen").** Every unwanted cut keeps the position;
  Skip, Restart and the natural end do not. A point holds until the pool is on air again, at most 24 h.
  Continue 10 s before the cut; under 2 min aired starts from 0, under 2 min left takes the next item.
  Only local files and cached Twitch archives; chat, titles and `/channel` unchanged, the as-run log says
  "resumed at h:mm:ss".
- **Deviation from the question's wording.** The question said remote items "fangen weiter von vorn an".
  As built, a remote archive or a YouTube video keeps no point at all, as before M124: the pool goes on
  after it, it does not start the cut item again from 0. Seeking a remote HLS input is not reliable
  enough to build on without the DUT.
- **Where the position lives.** `playout_runtime.resume_points` (JSON, one point per pool, newest first,
  at most 16) and `current_start_offset_seconds`; `as_run_log.start_offset_seconds`. Every playout cycle
  writes the position of the pool's item on air as a checkpoint, because a container killed with ffmpeg
  (repin, host restart, OOM) writes no exit; the exit handler then writes the exact position. After a
  kill the point is as old as the last cycle (15 s plus the cycle's own run, up to a minute), so the
  continuation repeats the 10 s rewind plus that age; it never skips. The position is wall-clock time
  since the spawn, exact while ffmpeg reads at 1.0x (`-re`), the same measure as the duration bound.
- **Seek.** `-ss` before `-i` (input seek): exact to the frame for the tested H.264 file with one
  keyframe, and timestamps start at 0, so the duration bound, chapters, the overlay and the programme row
  measure from the item's position 0 (`onAirItemZeroAt`: the process start minus the offset).
- **No loops.** A continued item that fails before it aired 2 min drops its point. Every continuation
  counts as a short start of the point (`shortStarts`, once per run: at the start write, a checkpoint or
  the exit, whichever comes first) until the item has aired 2 min; at two the pick gives the point up and
  the pool takes the next item. That bounds a file that stopped opening (the continuation and its M94
  retry, which keeps the offset and takes only its own pool's point) and a spot that takes the container
  down, where no exit handler runs.
- **Review (fresh subagent).** No blocker on the main paths. Fixed: a file that stopped opening, or a spot
  that kills the container, came back for up to 24 h (the short-start count above); a feed watchdog's end
  dropped the position (now kept like a crash); the M94 retry took any pool's point of the item (now its
  own pool's); a *Play now* or Pin of the cut item that ran to its end left the point, and the pool
  played the end again; a continuation whose archive had left the cache started from 0 at every later cut
  (the point is now given up at that start); the note on the checkpoint age said "skip" where it repeats.
- **Left, as decided or documented.** In direct mode Hard reload, Force reconnect and Recover outputs reach
  the playout as the same restart request as Restart and drop the point (the DUT runs the relay, where
  only Restart restarts the playout). A dated block of the same pool takes the pool's next item, and the
  cut item is not continued. The week view and `/channel`'s *Up next* do not plan a pending point; they
  show the pool's next item until the continued one is on air. One point per pool: two cuts in one pool
  keep only the latest.

### M125 The Security Audit's Findings Are Closed

- **Source.** The security audit of 2026-10-27 on `main` 9a6df7e (research/security-audit-2026-10.md and
  research/security-audit-2026-10/ in the project files, not in this repository): 3 confirmed findings and 7 leads that needed
  facts outside the repository. The owner asked for all of them ("alle findings schließen", 2026-10-27
  15:10 UTC). The audit's 47 hardening notes are not findings; those closed here are the ones on the same
  code paths (listed below), the rest is the list at the end.
- **3.1 Team roles.** `resolveSessionUser` derives a Twitch sign-in's role on every request:
  owner while its Twitch id is the bound broadcaster, otherwise its current grant, without one no session.
  Admin → Team has *Remove access* (`DELETE /api/team/access`). Local sign-ins keep the M117 password stamp.
- **Login name lead.** `team_access_grants.twitch_user_id` (migration `20261027_001_team_grant_twitch_user_id`,
  empty for existing grants): the first sign-in binds the grant to the Twitch user id and later sign-ins
  follow the id, a rename moves the login along, another id with the released login matches nothing.
- **3.2 Readiness.** `/api/health`, `/api/ready` and `/api/system/readiness` show the lead destination as
  provider, role, priority, status and `streamKeyPresent`; the feed's playlist path and the database's error
  text are gone (the error goes to the web log). The renderer and font routes answer fixed texts too.
- **3.3 Chat game.** Two cooldowns: the room's (info, refusals) and the moderators' (start, stop).
- **Admin pages lead.** Every `page.tsx` under `(admin)` awaits `requireAuthenticatedUser` (or
  `requireRoles`) itself; a unit test fails for a new page without one. No middleware: the session check
  needs the app secret from the data volume and the database.
- **Scene preview lead.** satori fetched every http(s) picture itself, from any address, following
  redirects. `packages/render/src/safe-image-fetch.ts` now fetches every remote `src` before satori runs:
  http and https, every resolved address public (loopback, private, link-local, CGNAT, multicast,
  reserved, IPv4-mapped, NAT64 and 6to4 forms refused), the connection pinned to the checked address,
  up to 3 redirects each checked again, 5 s, 4 MiB, `image/*`; refused or failed pictures are a
  transparent pixel. Cached 10 min, 256 entries. This covers the worker's stored image layers too (audit
  section 7, item 2). The http scheme stays allowed for image layers so no existing layer goes dark.
- **X-Forwarded-For leads.** The client key is the last entry (written by the nearest proxy). Next.js
  fills a missing header with the socket address, so mediamtx's own call is keyed on the relay's
  address. Direct access without a proxy: the shipped compose publishes 3000 on `127.0.0.1` only
  (`STREAM247_WEB_BIND`), see Decisions.
- **Relay check.** The limit counts refusals only and is consulted after the check, so a correct key always
  passes; stored credentials are read at most once a second (`relay-credentials.ts`).
- **Upload lead.** One file per request, streamed to disk; `Content-Length` required and enforced; 507 when
  the upload would leave less free than the disk watermark's trigger; optional `STREAM247_UPLOAD_MAX_BYTES`.
  The name is reserved (`wx`, waiting for `open`) before the body is read, because the body can be read once.
- **Release tag lead.** `ci.yml`'s `validate` job holds `packages: read`; images are built and pushed by a
  new `publish` job that runs for pushes to `main` only, after `validate`. Pull-request runs can no longer
  write `main-<sha>`.
- **Review (fresh subagent).** No blocker. Fixed: the picture fetch had only an idle timeout, so a host
  dripping bytes held a frame for hours (now 5 s for the whole fetch); only the first resolved address was
  tried (now each checked address in turn); the picture cache could grow to about 1.4 GB and kept a failed
  picture blank for 10 min (now 32 MiB and one minute for failures); an open broadcast event stream outlived
  a removed grant (it re-checks the session with every snapshot now); the cold rebuild in the `publish`
  job can take longer than the Release workflow waited for `main-<sha>`, so it waits 60 min instead of 30.
  Left: a rotated ingest key works up to one second longer (the credential cache); re-granting a login that a bound
  member renamed away from, before their next sign-in, edits their grant.
- **Decisions.** Upload: free space only, no per-file limit by default (owner's choice 2026-10-27 18:02 UTC,
  "Nur Platz-Grenze"; `STREAM247_UPLOAD_MAX_BYTES` stays as an opt-in). Web memory: 2 GiB, changeable by env
  (owner's choice 2026-10-27 18:03 UTC; `mem_limit: ${STREAM247_WEB_MEMORY_LIMIT:-2g}` in
  `docker-compose.yml`). Direct access without a proxy: port 3000 on `127.0.0.1` only, `STREAM247_WEB_BIND=0.0.0.0`
  opens it (owner's choice 2026-10-27 18:03 UTC, "Port nur auf 127.0.0.1"); no per-account login limit.
- **Not done (hardening notes, for a later milestone if wanted).** Containers as root and the read-write
  Docker socket of `relay-watchdog`; `--frozen-lockfile=false`, actions and base images not pinned by
  digest, `latest` from main; `.dockerignore` without `.env`; Postgres password fallback; mediamtx API
  without auth on the compose network; Twitch OAuth tokens in plaintext; `authTagLength`, SMTP `requireTLS`,
  APP_SECRET on the media volume; logout without server-side revocation, session/2FA key separation,
  `timingSafeEqual` for HMACs, 2FA setup without TOTP, TOTP and challenge reuse; non-atomic bootstrap and
  the first-run owner claim; EventSub replay window, body cap and order of checks; no SSE connection cap;
  the yt-dlp `--` separator and the YouTube host check; tee delimiters in destination URLs; CSP
  `frame-ancestors` and an Origin check; owner-only admin grants; the audit's six uncovered areas.
