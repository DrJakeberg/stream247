# Deployment

## Production Profile

Recommended production shape:

- Linux host
- Docker Compose managed through Portainer on DT
- reverse proxy in front of `web`
- optional built-in Traefik profile for HTTPS and Let's Encrypt
- persistent storage for:
  - PostgreSQL
  - `data/media`

Stream247 is currently designed as a self-hosted single-workspace deployment.

## Deployment Control Planes

Stream247 uses three distinct control surfaces:

- the repo is the source of truth for code, Compose files, scripts, and pinned example image refs
- Portainer on DT is the deployment control plane that applies stack changes
- DT is the validation/testing environment for readiness checks, rehearsals, long soaks, release candidates, and destructive validation
- DUT is the production/stable environment running the accepted baseline

Editing the local `docker-compose.yml` or `.env.production.example` does not change production by itself. Production changes happen when the DT Portainer stack is updated and redeployed with the intended image refs.

## Operating Policy (since v1.5.19)

- **v1.5.19 is the accepted production baseline.** DUT runs v1.5.19.
- v1.5.19 was rolled to DUT directly as an emergency fix under the clause below: v1.5.17 had left
  the playout container in a restart loop (423 restarts, one every ~5 minutes) with the program
  pinned to fallback content. See the 1.5.18 entry in `CHANGELOG.md`.
- **DUT is production/stable.** Do NOT use DUT for experiments, soak tests, release candidates, or risky/destructive validation.
- **All future testing, release candidates, experiments, and destructive validation happen on DT only.**
- **DUT may be touched only for** explicit production maintenance, emergency fixes, or an approved final release rollout *after* it has passed validation on DT.
- Release surface: `v1.5.17` (previous baseline) and `v1.5.19` (current baseline; the `v1.5.18` tag exists but published no images), one Git tag and one GitHub Release each, with matching GHCR package versions per image (`stream247-web/worker/playout`).

## Deploy Steps

1. Optionally choose a base env file. Since M52 the stack also starts with no `.env` at all: the
   app secret is generated on first boot and persisted on the data volume, the bundled Postgres
   uses its compose-internal defaults, and the `/setup` wizard covers the public URL, timezone,
   and Twitch credentials. An env file remains the way to pin any of these — env values always
   override wizard-written ones.
   - evaluation: no env file. Start the stack and open `/setup`.
   - production, or anything you want pinned:
     ```bash
     cp .env.production.example .env
     ```
   `.env.example` is the development file for `pnpm dev`: it sets `NODE_ENV=development` and
   `change-me` secrets. The compose file pins `NODE_ENV=production` for the app services and the
   example placeholders are refused in production, so that file is not a way to start the Docker stack.
2. If you use an env file, set what you want pinned:
   - `APP_URL` (otherwise the wizard manages it)
   - `APP_SECRET` (otherwise generated and persisted on first boot)
   - `POSTGRES_PASSWORD` and a matching `DATABASE_URL` (otherwise the bundled defaults apply)
   - `TRAEFIK_HOST`, plus `TRAEFIK_ACME_EMAIL` if using the built-in Traefik Let's Encrypt profile
3. Optional but recommended:
   - `TWITCH_STREAM_KEY`
   - `CHANNEL_TIMEZONE` (otherwise the wizard manages it)
   - `CHANNEL_LANGUAGE` (`en` or `de`; otherwise the wizard and `Admin → Settings` manage it)
   - Discord / SMTP alert settings
   - Twitch client credentials if you do not want to enter them later in setup or `/settings`
4. Optionally pin:
   - `STREAM247_WEB_IMAGE`
   - `STREAM247_WORKER_IMAGE`
   - `STREAM247_PLAYOUT_IMAGE`
   Recommended for production:
   - explicit version tags, not `latest`
5. Start the stack:
   ```bash
   docker compose up -d
   ```
   Or with built-in Traefik and automatic HTTPS:
   ```bash
   docker compose --profile proxy up -d
   ```
6. Open `/setup` and follow the wizard: owner account → instance basics (public URL, timezone, channel
   language) → Twitch app credentials → Twitch connection → review. Every step after the owner account
   is skippable and the wizard resumes at the first unfinished step, because completion is derived
   from what is actually configured rather than from a stored counter.
7. Any skipped value can be finished later: reopen `/setup` while signed in, or use `/settings`
   for the Twitch credentials.
8. Open `Admin → Settings → Twitch accounts`: set the broadcast channel (where the stream key sends video) and connect the bot account (chat, moderation, team SSO); connect the channel owner too if you want title, category and schedule sync. Only leave Twitch schedule sync enabled when the account writing the schedule can create non-recurring Twitch schedule segments. See `docs/twitch-setup.md`.
9. Add playable media:
   - files in `data/media`
   - direct media URL sources
   - YouTube playlist sources
   - Twitch VOD sources
10. Build schedule blocks and let the worker ingest and reconcile.

## Reverse Proxy And URL Notes

- `APP_URL` must be the real externally reachable base URL.
- Twitch OAuth will fail if `APP_URL` and the registered Twitch redirect URLs do not match.
- In real production, HTTPS is strongly recommended because Twitch OAuth and browser sessions should not run over plain HTTP on the public internet.
- If you use the built-in Traefik profile, set:
  - `APP_URL=https://<TRAEFIK_HOST>`
  - `TRAEFIK_HOST=<same-hostname>`
  - `TRAEFIK_ACME_EMAIL=<your-email>` when the built-in ACME resolver is active
- The built-in Traefik profile leaves direct port `3000` publishing enabled for easier first-time recovery and debugging. If you want a proxy-only surface, remove the `web.ports` entry locally.

## Secrets And Runtime Settings

Belongs in `.env` (since M52 as pins, not requirements: `APP_URL` and `CHANNEL_TIMEZONE` are
wizard-managed and `APP_SECRET` is generated and persisted on the data volume when unset —
`data/media/.stream247-app-secret`, mode 600, shared by all service containers):

- `POSTGRES_PASSWORD`
- `TWITCH_STREAM_KEY`
- `STREAM_OUTPUT_KEY`
- `CHANNEL_TIMEZONE`
- `CHANNEL_LANGUAGE` (since M80; a pin like the time zone — the saved setting applies when unset)
- `APP_URL`
- `APP_SECRET`
- `TRAEFIK_HOST`
- `TRAEFIK_ACME_EMAIL` when the built-in ACME resolver is active
- optional fallback Twitch client credentials
- optional fallback SMTP credentials
- optional fallback Discord webhook URL
- optional deployment-level output overrides (`STREAM_OUTPUT_WIDTH`, `STREAM_OUTPUT_HEIGHT`, `STREAM_OUTPUT_FPS`)
- optional engagement flags (`STREAM_CHAT_OVERLAY_ENABLED`, `STREAM_ALERTS_ENABLED`, `TWITCH_EVENTSUB_SECRET`)

Does not belong in `.env`:

- moderation presence settings
- schedule blocks
- sources and assets
- operator overrides
- overlay settings
- incidents and acknowledgements
- saved output profile settings

Those are runtime settings managed from the UI and stored in PostgreSQL.

Important current limitation:

- external-service secrets can now be stored encrypted at rest in PostgreSQL from the admin UI
- `.env` is still supported as bootstrap/fallback input for self-hosted deployments
- stream keys are stored encrypted in PostgreSQL from the setup wizard (*Where the stream goes*) or
  `Studio → Output`; `TWITCH_STREAM_KEY` / `STREAM_OUTPUT_KEY` (and the `BACKUP_*` pair) stay an env
  fallback for the built-in primary and backup outputs, and a stored key overrides them
- infrastructure and reverse-proxy settings always stay in `.env`

## Media And Persistence

- local media is read from `data/media`
- PostgreSQL must use a persistent volume
- deleting your database volume resets workspace state
- deleting `data/media` removes locally mounted playable files

### Removed Redis Service

Stacks deployed before this release ran a `redis` container. No part of Stream247
ever connected to it — it was provisioned in Compose but never had a client. It is
gone from `docker-compose.yml`.

What an operator sees at the next stack update: the `redis` container is stopped and
removed, and the stack comes up with one service fewer. Its bind mount `./data/redis`
stays behind on disk as an empty leftover directory and can be deleted by hand at any
time. There is no data migration and no backup step, because nothing ever wrote to it.
`REDIS_URL` is no longer read anywhere; leaving it in an existing `stack.env` or `.env`
is harmless, and it can be dropped at the next edit.

## GHCR Images

Production Compose is intended to pull from:

- `ghcr.io/drjakeberg/stream247-web:<tag>`
- `ghcr.io/drjakeberg/stream247-worker:<tag>`
- `ghcr.io/drjakeberg/stream247-playout:<tag>`
- `bluenviron/mediamtx:<tag>` for the local RTMP relay

`docker-compose.yml` carries its own default tags; `.env.production.example` pins `v2.1.0` for a stable
deployment, and the defaults move with each release.
See `docs/operations.md` for the runbook and backup procedures.

## Canonical Release And Rollout Flow

Every release follows the same order:

1. **Prepare and validate in the repo**
   - run `pnpm validate`
   - run `pnpm release:preflight`
   - run `./scripts/upgrade-rehearsal.sh <target-version>`
   - fix failing gates before tagging
2. **Publish GHCR artifacts**
   - `main` publishes `main-<sha>` snapshot images
   - `v*` tags publish the versioned release images
3. **Update the DT Portainer stack**
   - change the stack environment so the image refs match the intended release tags
   - redeploy the stack from Portainer on DT
4. **Verify DT matches the pinned release**
   - run `./scripts/portainer-stack-check.sh` with read-only Portainer API credentials
   - confirm the running DT stack resolves to the same image digests as `.env.production.example`
5. **Validate on DUT**
   - SSH to DUT and run readiness checks against the active deployment path
   - run `./scripts/upgrade-rehearsal.sh <target-version>` from the DUT repo path against the active stack
   - start the 24-hour soak in `tmux` on DUT from the repository checkout, measured through the host's own
     port (`CHECK_BASE_URL=http://127.0.0.1:3000`; step 10 of *Safe Upgrade Flow* below has the command)
6. **Promote or roll back**
   - keep the Portainer deployment only after DUT stays healthy
   - if DUT fails, read the release's rollback notes first (since 2.3, dated and one-off blocks are deleted
     before a reverse repin: *Rollback to 2.1.0* below), then restore the prior pinned image refs in
     Portainer and redeploy the previous known-good stack

## Release Channels And Tags

- `latest`: development and evaluation only
- `v*` tags: stable release images intended for pinned production deployment
- `main-<sha>`: CI-published snapshots from the current `main` commit

Production deployments should pin exact `v*` tags in Compose and should not auto-track `latest`.

Recommended pre-release commands:

- `pnpm release:preflight`
- `./scripts/upgrade-rehearsal.sh <target-version>`
- `CHECK_BASE_URL=http://127.0.0.1:3000 ./scripts/soak-monitor.sh --hours 24` on the DUT, from the
  repository checkout (step 10 of *Safe Upgrade Flow*)

## Upgrading

### Production Default

Use pinned GHCR image tags in production.

Example:

- `ghcr.io/drjakeberg/stream247-web:v1.5.19`
- `ghcr.io/drjakeberg/stream247-worker:v1.5.19`
- `ghcr.io/drjakeberg/stream247-playout:v1.5.19`
- `bluenviron/mediamtx:1.15.4`

Do not use `latest` for unattended production deployments.

### Safe Upgrade Flow

1. Read the changelog and release notes.
2. Create a PostgreSQL backup.
3. Back up `.env` or the active deployment env file.
4. Confirm `data/media` is intact.
5. In the repo, run:
   ```bash
   pnpm release:preflight
   ```
   The preflight rejects blank or quoted-empty required settings plus untouched `.env.example` and `.env.production.example` placeholder values, including Traefik host defaults whenever proxy settings are present and ACME email placeholders when the built-in Let's Encrypt resolver is configured, so replace those first.
6. Rehearse the target version with:
   ```bash
   ./scripts/upgrade-rehearsal.sh v1.5.7
   ```
   Before a new release tag exists, the rehearsal automatically uses the CI-published `main-<sha>` snapshot for the current commit instead of requiring `ghcr.io/...:v1.5.7` to exist already.
   On an empty rehearsal stack, the script bootstraps a rehearsal owner and seeds one tiny local media fixture so the current broadcast-readiness gate does not depend on stale local state. Set `UPGRADE_REHEARSAL_SEED_LOCAL_MEDIA=0` when the target media library already contains real playable media and you want to prevent fixture creation.
7. After the release images exist, update the DT Portainer stack image refs to the target release tags and redeploy the stack from Portainer.
8. Verify the DT stack matches the intended pinned refs:
   ```bash
   PORTAINER_URL=https://portainer.example.com \
   PORTAINER_API_KEY=... \
   PORTAINER_ENVIRONMENT_ID=1 \
   PORTAINER_STACK_NAME=stream247 \
   ./scripts/portainer-stack-check.sh
   ```
9. On DUT, check:
   - `/api/health`
   - `/api/system/readiness` and confirm `broadcastReady=true`
   - `Live → Status`
   - current broadcast state
10. For production candidates, run on DUT from the repo path:
    ```bash
    CHECK_BASE_URL=http://127.0.0.1:3000 ./scripts/soak-monitor.sh --hours 24
    ```
    On the DUT, start it in `tmux` so that it outlives the SSH session, with its output in the log file the
    soak result is read from (`~/logs/soak-<stamp>.log`), from the checkout of the release (`<checkout>`):
    ```bash
    cd <checkout> && tmux new-session -d -s soak "COMPOSE_PROJECT_NAME=stream247 CHECK_BASE_URL=http://127.0.0.1:3000 ./scripts/soak-monitor.sh --hours 24 >> ~/logs/soak-$(date -u +%Y%m%d-%H%M).log 2>&1"; tmux ls
    ```
    Measure through the host's own port (`web` publishes `3000:3000`), not the public URL: the public route
    measures the way in as well, and the 2.1.0 soak's only outage was a 220 s Cloudflare `522` while the
    channel stayed on air. With `CHECK_BASE_URL` set the script needs no `.env`. Run it from the
    repository checkout so `scripts/lib/soak-readiness-classifier.cjs` is found, or copy `scripts/` as a
    whole. Before trusting a pass, read two lines of its log:
    - the first, `Starting soak monitor for 24h at <url>`, names what was measured;
    - `Baseline container restarts: web=… worker=… playout=… uplink=… relay=…` must show numbers. The
      counts come from `docker compose ps` in the directory above `scripts/`; where that directory is not
      the stack's compose project (a Portainer stack, a copied `scripts/`), every count reads `unknown` and
      a container restart goes unseen. Run it from a checkout, whose `docker-compose.yml` names the
      services, with `COMPOSE_PROJECT_NAME` set to the stack's project (`stream247` for containers named
      `stream247-web-1`), and check the line again. `relay=unknown` is expected with the relay off.

    Without `SESSION_COOKIE` (below) every sample logs `openCriticalIncidents=skipped(no-session-cookie)`
    and open critical incidents do not fail the soak; read them afterwards instead:
    ```bash
    docker compose exec -T postgres psql -U stream247 -d stream247 -At -c "SELECT created_at, fingerprint, status, resolved_at FROM incidents WHERE severity = 'critical' AND updated_at > to_char(now() - interval '25 hours', 'YYYY-MM-DD\"T\"HH24:MI:SS') ORDER BY created_at"
    ```
    The soak gate fails if broadcast readiness never becomes ready, or drops and does not come back
    within the outage window (five minutes by default, below). A healed outage does not fail the soak
    but is logged as `outage-recovered duration=…s` and counted in the completion line
    (`soak-monitor-complete outages=N outageSecondsMax=… outageSecondsTotal=…`), so a pass with outages
    never reads like a clean one.

Useful overrides:

- `CHECK_BASE_URL=http://127.0.0.1:3000` for a soak on the stack's own host (step 10), and whenever `APP_URL` is externally routed and not directly reachable from the host
- `SOAK_OUTAGE_TOLERANCE_SECONDS` (default 300): how long an outage may last, counted from its first bad
  sample, before the soak fails with `outage-exceeded`. Any bad sample opens the outage — a failed fetch,
  a not-ready service, `broadcastReady=false` — and the next healthy sample closes it. Written for the
  DUT's nightly path interruption: every night at 23:31 UTC the stack loses its destination for one to
  three minutes and heals itself, and two 24 h soaks on v2.0.0 died on it without any application fault.
  Never carried by the window, whatever its age: a playout crash loop, a runaway uplink restart count
  (`SOAK_UPLINK_RESTART_RUNAWAY_DELTA`) and a container restart. `0` restores the strict per-sample rules
  below exactly.
- `SOAK_TOLERATE_FETCH_FAILED_SAMPLES` (default 2): with the window at `0`, consecutive readiness fetches
  that fail outright (DNS, TLS, connection reset) before the soak fails; the log keeps each tolerated one
  as `readiness-fetch-failed-tolerated`. With the window open it only decides when a run of failed fetches
  starts being logged as `outage-tolerated`.
- `SESSION_COOKIE="stream247_session=..."` if the soak monitor should also fail on open critical incidents from the authenticated incidents API
- `RELEASE_PREFLIGHT_ENV_FILE=/path/to/production.env` if you want `pnpm release:preflight` to validate a staged env file without replacing the current `.env`
- `UPGRADE_REHEARSAL_IMAGE_TAG=main-<sha>` if you need to force a specific pre-release snapshot tag during rehearsal
- `PORTAINER_URL`, `PORTAINER_API_KEY`, `PORTAINER_ENVIRONMENT_ID`, and `PORTAINER_STACK_NAME` for `./scripts/portainer-stack-check.sh`

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

### Upgrading To 2.3

2.2.0 was never released: `v2.2.0-rc.1` was tagged but never deployed, its release commit was never
tagged, and no 2.2.0 images exist. 2.3.0 is the first release after 2.1.0. It carries the changes of
2.2.0-rc.1 (M75, M76, M78, M79, M80, M82; the notes under *Upgrading To 2.2* above apply unchanged) and
M84-M105. This section is that one upgrade from 2.1.0, and the way back.

- **Before the repin.** Back up PostgreSQL and keep the dump: restoring it is one of the two ways back
  (*Rollback to 2.1.0* below).

  ```bash
  umask 077; docker compose exec -T postgres pg_dump -U stream247 -d stream247 -Fc > stream247-pre-2.3.dump
  ```

- **Stack.** No stack file changes; it is a repin of the three `STREAM247_*_IMAGE` tags. One new optional
  variable, `CHANNEL_LANGUAGE` (*Viewer Language* above).
- **Schema.** Seven migrations, applied on the first start; the base schema has the same statements for a
  fresh install. All are additive except the scrub, which is one-way on purpose:

  | Migration | Milestone | Change |
  | --- | --- | --- |
  | `20261001_002_source_breakers` | M75 | table `source_breakers`, empty: every source is in play |
  | `20261001_003_as_run_log` | M76 | table `as_run_log` and two indexes, empty |
  | `20261002_001_redact_stored_secrets_again` | M85 | removes credential-shaped text from incidents, the audit trail and destination and runtime errors |
  | `20261002_002_remove_next_hold` | M89 | `playout_runtime.remove_next_asset_id`, `remove_next_until`; empty is no hold |
  | `20261003_001_schedule_block_dates` | M93 | `schedule_blocks.valid_from`, `valid_until`; empty keeps every block weekly |
  | `20261003_002_asset_duration_probe_key` | M96 | `assets.duration_probe_key`; empty means each local file is probed once |
  | `20261004_001_chat_reply_switches` | M104 | four answer switches on `chat_interaction_settings`, all on |

  After the first start this prints `7`:

  ```bash
  docker compose exec -T postgres psql -U stream247 -d stream247 -At -c "SELECT COUNT(*) FROM schema_migrations WHERE id >= '20261001_002'"
  ```

- **After the repin, the operator.** Set `Admin → Settings → Channel language` (a channel speaks English
  until it is set; *Viewer Language* above). Where egress from the playout container is filtered, let it
  reach the output hosts (*A Network Outage Is Not A Source Fault* above). With *Viewer control* on
  (`Studio → Engagement`) the chat bot now answers `!commands`, `!now`, `!next` and every `!request`; each
  answer has its own switch there, all on after the upgrade. The stream key the install already has stays
  where it is; `Studio → Output` now shows and edits it (M99).

What changes on air in the first cycles, without touching a setting (besides the 2.2.0-rc.1 changes):

- **M85.** A channel time zone that `Intl` rejects (a typo in `CHANNEL_TIMEZONE` or the saved zone) no
  longer breaks the schedule: the next usable value applies, then `UTC`, and the incident
  `config.channel-timezone.invalid` stays open until the value is fixed.
- **M86.** A PostgreSQL outage shorter than five minutes leaves every process, ffmpeg and the uplink
  running.
- **M88, M101.** The first Twitch sync deletes the phantom segment a block crossing midnight left a day
  late, and a segment touching a clock change carries the length it really airs.
- **M95.** Within the first cycles each quarantined item whose last probe is more than 24 hours old gets
  one trial, one per source per cycle and none while its source's breaker is open; a clean trial puts it
  back in play.
- **M96.** The local library's files are probed with `ffprobe` over the first scans (at most 30 s of
  probes per scan). From then on a local file with a known length is ended by the duration bound, and with
  the overlay in scene mode that is how every local file ends: at its length plus the margin (15 s), the
  last frame held over padded audio, as-run end reason `duration-bound`, where it used to end through the
  feed-audio watchdog.
- **M100.** `/channel` names what airs now and next, and `/channel.ics` serves the programme as a calendar.
- **M102.** The standby and reconnect slates show the current block's title or `Stand by`, never the
  title that aired before.
- **M103.** Worker, playout and uplink exit after five minutes of failing their own healthcheck (the
  playout only while its feed does not advance), and `restart` starts a fresh one; crash-loop and
  uplink-watchdog restarts back off, up to five minutes.
- **M105 (review fixes on air).** A pool or cuepoint insert plays to its end also when its item comes from
  a source outside the block's pool (2.1.0 cut it after one cycle, 15 s in); a scheduled insert whose
  input cannot be opened is started once more with the next format candidate; the trial of a quarantined
  Twitch archive that is not in the cache asks Twitch only and downloads nothing (the M95 trials of the
  first cycles included). The uplink watchdog does not count a restart while the hosts it publishes to
  cannot be reached and ends every hold once one answers again, so the nightly network blip adds no
  backoff wait after the network is back; a timestamp storm keeps the picture on air while its restart
  waits. `/channel` lists no pool insert as a video, `!now` and `!next` name what plays when asked, and a
  step that fails for 30 minutes or a refused Twitch token sends an alert.

#### Rollback to 2.1.0

The way back is the reverse repin to `v2.1.0` (no stack file change), after the step for dated blocks
below, or a restore of the pre-upgrade dump instead. 2.2.0-rc.1 is no target: it never ran in production,
and it reads dated blocks exactly as 2.1.0 does.

1. **Dated and one-off blocks first (M93).** An image older than M93 does not know `valid_from` and
   `valid_until`. A block saved as *Once* or *Between dates* is stored as a weekly block on its weekday
   (`repeat_mode` `single`) that only its dates bound, so 2.1.0 airs it every week on that weekday,
   ended blocks included. The latest-starting block on air wins, so on a channel filled around the clock
   it takes the air from the weekly grid every week, and the Twitch sync posts it as a weekly segment.
   2.1.0 also refuses every schedule create and edit while any two blocks overlap, and a dated block
   always overlaps the weekly block it cuts, so the editor stays locked. Its whole-state write (`DELETE
   FROM schedule_blocks`, then every row again without the two columns; a moderator's `!game` start or
   stop or a blueprint apply runs it) erases the dates, so the blocks stay weekly after a later roll
   forward too. Therefore, still on 2.3: back up (this dump keeps the dates), list the dated blocks, and
   delete them, ended ones included. The listing must then print `(0 rows)`:

   ```bash
   umask 077; docker compose exec -T postgres pg_dump -U stream247 -d stream247 -Fc > stream247-pre-rollback.dump
   docker compose exec -T postgres psql -U stream247 -d stream247 -c "SELECT id, title, day_of_week, start_minute_of_day, duration_minutes, valid_from, valid_until FROM schedule_blocks WHERE valid_from <> '' OR valid_until <> '' ORDER BY valid_from, start_minute_of_day"
   docker compose exec -T postgres psql -U stream247 -d stream247 -c "DELETE FROM schedule_blocks WHERE valid_from <> '' OR valid_until <> ''"
   ```

   Deleting each one under `Program → Schedule → Day` does the same. Let one worker cycle pass so the
   Twitch schedule drops their segments too, then repin. After a later roll forward, save them again from
   the listing.
2. **Repin** `v2.1.0`, redeploy, and confirm that readiness is green.

The other way back, instead of both steps, is the pre-upgrade dump: the database as it was before the
upgrade, so everything written since goes (as-run rows, breaker state, blocks, settings) and no dated
block is left. It is a custom-format archive, which `pg_restore` reads (`psql` cannot), and it goes into
an empty database: `pg_restore --clean` into the upgraded one drops and recreates only what the dump
holds, so the tables only 2.3 has (`as_run_log`, `source_breakers`) would keep their rows. Stop everything
that writes, keep PostgreSQL running, recreate the database, restore, then repin `v2.1.0`, which starts the
stopped services again on the old images:

```bash
docker compose stop web worker playout uplink
docker compose exec -T postgres dropdb -U stream247 stream247
docker compose exec -T postgres createdb -U stream247 -O stream247 stream247
docker compose exec -T postgres pg_restore -U stream247 -d stream247 --no-owner < stream247-pre-2.3.dump
```

What 2.1.0 then does with what 2.3 left behind; none of it needs a step:

- **M75, M76.** As under *Upgrading To 2.2*: a held source is in play at once, and an open
  `playout.source-breaker.<sourceId>` incident and the as-run row that was on air stay open.
- **M85.** The scrub is one-way: redacted text stays redacted. 2.1.0's audit sink does not redact, so a
  stream key quoted into an audit entry after the rollback stays there. A channel time zone that `Intl`
  rejects breaks the schedule again.
- **M86, M103.** A short PostgreSQL outage can take the processes down again, ffmpeg with the playout; a
  failing healthcheck restarts nothing, and restarts do not back off.
- **M88, M101.** 2.1.0's Twitch sync replaces the segments with its own plan: a block crossing midnight
  gets its phantom next-day segment back, and a segment touching a clock change is an hour off again.
- **M89.** 2.1.0 does not see a *Remove next* pressed on 2.3 (it holds for 60 minutes), so the removed item
  can air next; skip it if it does. A Skip or a chat skip vote lifts a Remove next again, and a Restart
  pressed while a playout cycle runs can be lost again.
- **M96.** 2.1.0 keeps the probed lengths, and with them the duration bound on local files, but its writes
  empty `duration_probe_key`, so after a roll forward each local file is probed once more.
- **M100.** `/channel.ics` answers 404; calendars subscribed to it stop updating.
- **M104.** The bot no longer answers `!commands`, `!now` and `!next`, and answers `!request` as 2.1.0
  did; the four switches stay stored.
- **Incidents only 2.3 raises.** 2.1.0 never closes `config.channel-timezone.invalid`,
  `worker.step.failed.<step>`, `twitch.reconnect.required`, `playout.insert.skipped`,
  `playout.health.self-restart`, `worker.health.self-restart` or `uplink.health.self-restart`: one that is
  open at the rollback stays open until it is resolved by hand under `Live → Status`.
- **M105.** No schema. The fired cuepoints of the run before the one on air, which 2.3 keeps beside the
  current run's, name their run, so 2.1.0 counts none of them for its block and empties the list at the
  next block change. The rest of M105 is behaviour (the cut at a dated block's start and end, the hold and
  retry of a scheduled insert, the restart-flag rule, the uplink backoff, the alerts), and 2.1.0 brings its
  own back.
- Everything else (M84, M87, M90-M92, M94, M95, M97-M99, M102) changes behaviour
  only: 2.1.0 brings the old behaviour back and misreads nothing that 2.3 stored.

### Patch vs Minor Upgrades

- Patch upgrades should be the default production path.
- Minor upgrades may require reading upgrade notes carefully.
- Downgrades are not guaranteed unless explicitly documented in the release notes.

### Rollback

If the new version is unhealthy, read the rollback part of the release's upgrade section first: an older
image can misread rows the new one stored, and since 2.3 a reverse repin needs a step before it
(*Rollback to 2.1.0* above). Then:

1. Revert the DT Portainer stack image refs to the previous known-good release tags.
2. Redeploy the stack from Portainer.
3. Confirm DUT returns to green readiness.
4. If the database schema is incompatible, restore the PostgreSQL backup as well.

## Release Flow

- `push` to `main`:
  - validate
  - build
  - smoke-test
  - publish `latest` and branch/SHA-tagged images
- `push` of `v*` tags:
  - pull the CI-published `main-<sha>` snapshot images for the tagged commit
  - smoke-test them before push
  - retag and publish those same tested images as the versioned GHCR artifacts

`./scripts/upgrade-rehearsal.sh <target-version>` follows the same artifact model. If the requested `v*` images already exist, it rehearses against them directly. Before the version tag exists, it falls back to the CI-published `main-<sha>` snapshot for the current commit. Set `UPGRADE_REHEARSAL_IMAGE_TAG=main-<sha>` if you need to force a specific pre-release snapshot explicitly. Empty-stack rehearsals bootstrap a rehearsal owner and seed one tiny local media fixture by default; set `UPGRADE_REHEARSAL_SEED_LOCAL_MEDIA=0` to disable fixture seeding.

## Portainer Stack Check

`./scripts/portainer-stack-check.sh` is a read-only verification step for the DT control plane.

It compares the image refs pinned in `.env.production.example` against the image digests actually running in the named Portainer-managed stack. The script checks:

- `web` against `STREAM247_WEB_IMAGE`
- `worker` and `uplink` against `STREAM247_WORKER_IMAGE`
- `playout` against `STREAM247_PLAYOUT_IMAGE`
- `relay` against `STREAM247_RELAY_IMAGE`

Required environment variables for a real check:

- `PORTAINER_URL`
- `PORTAINER_API_KEY`
- `PORTAINER_ENVIRONMENT_ID`
- `PORTAINER_STACK_NAME`

Dry-run example:

```bash
./scripts/portainer-stack-check.sh --dry-run
```

Real check example:

```bash
PORTAINER_URL=https://portainer.example.com \
PORTAINER_API_KEY=... \
PORTAINER_ENVIRONMENT_ID=1 \
PORTAINER_STACK_NAME=stream247 \
./scripts/portainer-stack-check.sh
```

The script does not update, redeploy, or restart anything. It only reports whether the currently running DT stack matches the pinned release env file.

Production `traefik`, `web`, `worker`, `relay`, `playout`, `uplink`, and `postgres` services now use `restart: unless-stopped` in `docker-compose.yml`, so the documented always-on Compose paths, including `docker compose --profile proxy up -d`, recover their stack processes after daemon and host restarts.

The worker-family image runs Node under `tini` so long-running playout containers reap short-lived FFmpeg and yt-dlp children. Worker, playout, and uplink Docker healthchecks use 45-second intervals/timeouts and a 60-second start period because FFmpeg and the in-process scene renderer (satori → resvg) can briefly saturate the playout container during normal broadcast operation. Compose itself never restarts an unhealthy container; since M103 the worker and uplink exit by themselves after five minutes of failing that same healthcheck, and the playout only while its programme feed does not advance, so `restart: unless-stopped` brings up a fresh process (`docs/operations.md`, "A process stops proving it is alive").

Planned output reconnects default to every 48 hours. Set `PLAYOUT_RECONNECT_HOURS` only when the deployment needs a different Twitch reconnect cadence; `PLAYOUT_RECONNECT_SECONDS` controls the short standby window used during that planned reconnect.

Production Compose enables the program-feed/uplink split by default. `playout` writes a rolling HLS feed under `STREAM247_PROGRAM_FEED_DIR`, and the `uplink` worker reads that local feed before publishing to the configured primary/backup outputs. The default `STREAM247_PROGRAM_FEED_TARGET_SECONDS=2` and `STREAM247_PROGRAM_FEED_LIST_SIZE=30` keep about 60 seconds of feed buffer so normal asset boundaries do not close the external RTMP session. HLS segments are written with temporary files, epoch-based segment numbers, and discontinuity markers so the uplink can continue across normal item handoffs. Set `STREAM247_UPLINK_INPUT_MODE=rtmp` only to roll back to the older MediaMTX relay input, and set `STREAM247_RELAY_ENABLED=0` only as a rollback to the previous direct playout-to-destination path.

Pushed video sources (M57 stage 2) enter through the relay's two ingest host ports: RTMP on `1935/tcp` and SRT on `8890/udp`. The relay runs the mounted `docker/mediamtx.yml` instead of image defaults and checks every publish and read against the web app at `/api/relay/auth`. Publishing to `src-<source-id>` requires that source's publish key — issued once when the source is saved as a pushed source in the studio's video source manager, rotatable there, never shown again. The relay's control API (`:9997`) and RTSP read side (`:8554`) stay container-internal; internal reads and any publish to the legacy `live/program` path require the internal relay key, a secret that generates itself into the database on first use and is deliberately never printed. Publisher settings that work with the auth scheme: OBS RTMP — server `rtmp://<host>:1935`, stream key `src-<source-id>?user=publisher&pass=<publish-key>`; SRT — `srt://<host>:8890?streamid=publish:src-<source-id>:publisher:<publish-key>`.

The live attach itself stays behind `STREAM247_SOURCE_LIVE_ENABLED` (and the managed switch that wins over it), and is still awaiting its DT soak gate. Two operator surfaces cover it: `STREAM247_SOURCE_LIVE_GAIN_PERCENT` (0-200, default 40) is settable under Settings → Operations → **Sound from live video sources**, and the studio's video source manager shows the worker's last attach decision per pushed source in words. That decision is persisted by migration `20260826_004_overlay_video_source_live_state` (`live_state`, `live_state_at`, `live_retry_at` on `overlay_video_sources`, all additive and empty on existing rows) and written only when the decision changes, mirroring the `playout.source-live.attach_decision` runtime event. A live source's audio is mixed only into items whose duration is known in advance; on anything else the source is embedded as picture only so the feed-audio watchdog stays meaningful.

Consequence for the two rollback paths above: with relay auth active, `STREAM247_RELAY_ENABLED=1` and `STREAM247_UPLINK_INPUT_MODE=rtmp` publish and read `live/program` on the relay and therefore only work when `STREAM247_RELAY_OUTPUT_URL` / `STREAM247_RELAY_INPUT_URL` carry the internal relay key as credentials (`rtmp://relay:1935/live/program?user=internal&pass=<internal-relay-key>`). Both lines, with the key already embedded, are available to an owner or admin under Settings → Operations → **Relay access**: the group ships only a button, the value is fetched on click from `POST /api/settings/relay-access`, and each reveal writes a `relay.internal_key.revealed` audit event naming the actor. Copy both lines into the deployment environment and restart before taking either rollback path. Never weaken the relay auth config to avoid the key: the same path is reachable from the internet through the published ingest port.

Readiness and the soak monitor now separate Twitch/output continuity from short local playout failures in HLS program-feed mode. If `uplink` is running, the destination is ready, the program feed is fresh, and crash-loop protection is not active, a local `playout` failure is treated as a transient for `STREAM247_PLAYOUT_TRANSIENT_GRACE_SECONDS` seconds. The default grace is the larger of 20 seconds or `STREAM247_PROGRAM_FEED_FAILOVER_SECONDS`. Crash loops, a runaway unplanned uplink restart count, and Docker restarts for `web`, `worker`, `playout`, `uplink` or `relay` (the last two since M95) fail the soak at once. Uplink failures, stale program feeds, destination degradation and new unplanned uplink restarts fail it when they outlast the outage window (`SOAK_OUTAGE_TOLERANCE_SECONDS`, five minutes by default); healed sooner, they are logged as an outage and counted in the completion line. The readiness API also reports `sseConnections` so long-running installs can see whether browser or overlay event streams are being cleaned up after clients disconnect.

Twitch VOD playback is cache-backed by default. The worker stores verified Twitch archive media under `MEDIA_LIBRARY_ROOT/.stream247-cache/twitch`, preserves the original Twitch URL on the asset record, and keeps the internal cache out of local library scans. Before each retry it deletes leftover transient partials for the same VOD, enforces the cache byte guardrail against both ready files and transient download artifacts, and times Twitch cache preparation out after `TWITCH_VOD_CACHE_DOWNLOAD_TIMEOUT_SECONDS` so playout falls back locally instead of stalling the program feed. Production pins that timeout to `8` seconds; keep it short unless a separate background warm-cache path exists. If a Twitch VOD cannot be cached, playout skips that asset for a cooldown window and falls through to the normal global-fallback / generic-fallback ladder before it ever drops to the standby slate. Keep at least one curated local fallback asset in `data/media` with `fallback` or `standby` in the file name so the local-library source promotes it to a global fallback automatically. Set `TWITCH_VOD_CACHE_ALLOW_REMOTE_FALLBACK=1` only as a temporary rollback.

The Twitch cache also enforces basic retention and disk guardrails:

- `TWITCH_VOD_CACHE_RETENTION_HOURS`
- `TWITCH_VOD_CACHE_PARTIAL_MAX_AGE_HOURS`
- `TWITCH_VOD_CACHE_DOWNLOAD_TIMEOUT_SECONDS`
- `TWITCH_VOD_CACHE_MAX_BYTES`
- `TWITCH_VOD_CACHE_MIN_FREE_BYTES`
- `TWITCH_VOD_CACHE_FAILURE_COOLDOWN_SECONDS`
- `TWITCH_SCHEDULE_SYNC_ENABLED`
- `SCENE_RENDERER_ENABLED`

The defaults prune stale partial downloads, evict older cached VOD files when the cache exceeds its byte budget, and refuse a new download when free disk falls below the configured floor.

Chapters for assets whose listing ingest cannot deliver them (YouTube playlist/channel items, Twitch channel archives, direct media) are backfilled by a budgeted per-cycle probe: `CHAPTER_BACKFILL_PER_CYCLE` metadata-only yt-dlp/ffprobe calls per reconciliation cycle (default 3, `0` disables), with failed probes held for `CHAPTER_BACKFILL_FAILURE_COOLDOWN_SECONDS` (default 1800) before the next attempt. A probe that finds chapters is never repeated. A probe that comes back valid but empty is trusted for `CHAPTER_BACKFILL_EMPTY_RECHECK_SECONDS` (default 604800, one week; `0` disables rechecks) and then probed once more — a rate limit, a geo- or subscriber-restricted variant and a yt-dlp extractor regression all report "no chapters" as well, and an asset stuck on that answer goes on air with the wrong category and title. Rechecks come last in the per-cycle budget, behind never-probed assets and failure retries, so they never delay a newly ingested item. Operator-edited chapter lists are never overwritten and never re-probed.

Output settings are available in `/output` with built-in profiles for 720p30, 1080p30, 480p30, and 360p30 plus a custom mode. The saved stream profile is stored in PostgreSQL and applies when the playout worker starts its next FFmpeg process. Each destination can either inherit that stream profile or pin one of the fixed named presets. Destinations that resolve to the same effective rendition share one persistent uplink process; mixed renditions spawn parallel uplink processes from the shared relay/program feed. Deployment-level `STREAM_OUTPUT_WIDTH`, `STREAM_OUTPUT_HEIGHT`, and `STREAM_OUTPUT_FPS` override the saved stream profile for standby slate generation, scene-renderer capture size, and inherited uplink output normalization. `SCENE_RENDER_WIDTH` and `SCENE_RENDER_HEIGHT` still have precedence for scene capture if you need a temporary render-specific override. Set `STREAM_SCALE_ENABLED=0` only as a rollback if the scale/pad/fps filter causes unexpected encoder load. Avoid pinning a destination above the stream profile unless you explicitly want to pay the CPU cost of upscaling the shared feed.

In-stream engagement is configured from Studio → Engagement (legacy `/overlays` redirects there) and is disabled by default. Both the database setting and the deployment flag must be enabled: set `STREAM_CHAT_OVERLAY_ENABLED=1` for Twitch IRC chat and the chatter-participation game (drawn in the on-air overlay), and set `STREAM_ALERTS_ENABLED=1` for follow / sub / cheer / channel-point alerts (recorded and listed under Studio → Engagement; not drawn on air yet). EventSub webhooks post to `/api/overlay/events`; production deployments should set `TWITCH_EVENTSUB_SECRET` and must expose `APP_URL` over reachable HTTPS for Twitch to deliver follow/sub notifications. Since 2.1 the subscriptions are about the broadcast channel: the worker registers `channel.follow` with the bot account as moderator (scope `moderator:read:followers` on the bot) whenever alerts are enabled and the bot is connected, and `channel.subscribe`, `channel.cheer` and `channel.channel_points_custom_reward_redemption.add` only with one account, or once the channel owner connection grants `channel:read:subscriptions`, `bits:read` and `channel:read:redemptions` (owner connections made before 2.1 must reconnect). Types that are switched on but withheld raise the info incident `twitch.eventsub.waiting-for-channel-owner`. Stream247 owns every subscription on its own callback URL; it verifies them before creating duplicates and deletes the ones no longer wanted, including 2.0's on the bot account's own channel. See `docs/twitch-setup.md`. The IRC chat bridge authenticates with the same identity token and needs `chat:read` (and `chat:edit` to reply to moderator check-ins); a token without them is refused by Twitch with `Login unsuccessful`, and the worker then raises the `Twitch chat login refused` incident and stops retrying for five minutes instead of reconnecting every cycle. Connections made before those scopes were requested must reconnect the Twitch account once — no chat, poll or chat-game input arrives until they do. Localhost-only installs can use the admin preview and chat settings, but cannot receive Twitch EventSub webhooks from the public internet.

CI currently builds against the public ECR mirror for `node:22-alpine` to avoid Docker Hub rate limits on GitHub-hosted runners.

## Current Capability Notes

- Admin navigation is grouped by operator workflow: `Live` for control, status, and moderation, `Program` for schedule/library work, `Studio` for scene/engagement/output, and `Admin` for settings, moderation policy, and team access.
- local media, direct media URLs, YouTube playlists/channels, and Twitch VODs/channels are ingestible today
- Twitch VOD playout uses verified local cache files by default and falls back to standby when cache preparation fails
- program-feed/uplink mode separates program playout restarts and asset boundaries from the external RTMP publishing worker
- YouTube and Twitch ingestion rely on `yt-dlp`
- schedule blocks support weekly CRUD, reusable show profiles, multi-day creation, overlap validation, drag/drop repositioning, resize-to-change-duration editing, weekly coverage summaries, and quick-start program templates
- pools are first-class programming units for round-robin playout selection that alternates between a pool's sources, each in a stable date order (see `docs/architecture.md`, *Scheduling*); a source whose probes fail on three different items is held out of the rotation for a cooldown and retried with one item (source circuit breaker, `docs/operations.md`); probes that fail while the channel's own network is down count against neither the item nor its source
- sources can be edited in place and the asset catalog can be searched by title, source, and status
- playout supports operator restart, temporary fallback, asset pinning, play now / insert, skip-current, and resume-schedule actions (`docs/operations.md`, *Operator controls*)
- every playout run is recorded in the as-run log (table `as_run_log`, 90 days), read in `Live → Status` and through `GET /api/as-run` (`docs/operations.md`, *What was on air at a given time?*)
- overlay is drawn by the playout renderer, with replay labeling, current/next context, and admin-managed branding
- optional chat, chatter-participation, and Twitch alert overlays render through the same on-air overlay when explicitly enabled
- email and Discord alert delivery are both implemented
- managed secret storage in `/settings` is implemented for Twitch and alert credentials
- setup and status expose a guided readiness view based on the current workspace state
