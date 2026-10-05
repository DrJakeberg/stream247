# Getting Started — from nothing to a green channel

One page, in order, with the traps where they bite. Everything here is also in the README, the
deployment notes and the Twitch setup guide; this page is the path through them.

## 0. What you are setting up

Stream247 is a 24/7 channel: a **web** app (admin UI + API), a **worker** (ingest, schedule,
Twitch sync), a **playout** (renders the programme and the on-air scene into an HLS feed) and an
**uplink** (pushes that feed to Twitch over RTMP), with **PostgreSQL** and a small **relay**
(`bluenviron/mediamtx`) for live sources. Everything runs from one Compose file.

You need: a Linux host with Docker, a public hostname with HTTPS (Twitch OAuth refuses plain HTTP
on the public internet), and a Twitch account that will **operate** the channel.

## 1. Get the files

The stack needs two files from the repository, `docker-compose.yml` and `docker/mediamtx.yml` (the
relay's configuration), in a directory that becomes the install: the compose file creates `data/` next
to itself and keeps the database, the media and the generated app secret there. Take both from a
release tag, the newest one on <https://github.com/DrJakeberg/stream247/releases> that is not marked
*Pre-release*: a release's compose file starts exactly that release's images, while the files on `main`
may be ahead of every published image. Either clone the tag:

```bash
git clone --depth 1 --branch vX.Y.Z https://github.com/DrJakeberg/stream247.git
cd stream247
```

or download only what the stack reads, keeping the `docker/` folder:

```bash
mkdir -p stream247/docker && cd stream247
TAG=vX.Y.Z
curl -fsSL -o docker-compose.yml "https://raw.githubusercontent.com/DrJakeberg/stream247/$TAG/docker-compose.yml"
curl -fsSL -o docker/mediamtx.yml "https://raw.githubusercontent.com/DrJakeberg/stream247/$TAG/docker/mediamtx.yml"
curl -fsSL -o .env.production.example "https://raw.githubusercontent.com/DrJakeberg/stream247/$TAG/.env.production.example"
```

Replace `vX.Y.Z` with the release's tag. The third download is only needed if you want a `.env`
(section 4). Every later command on this page runs in that directory.

## 2. The two Twitch accounts — decide this first

One Twitch account can be both the broadcast channel and the bot account, but two are recommended: a
separate bot account keeps chat and moderation off the channel's own login.

Stream247 names the two roles the same way everywhere:

- the **broadcast channel** — the channel viewers watch; its stream key receives the video;
- the **bot account** — a moderator on that channel, connected to Stream247 for chat, emote-only
  automation, follow alerts and owner sign-in.

Chat and moderation work with the bot account alone. Title, category, schedule and sub, cheer and
channel-points alerts need the broadcast channel's own account: with two accounts through the optional
**channel owner connection** (section 6), with one account through the bot connection itself, which then
holds the channel's own login for chat, moderation and owner sign-in as well. When you check whether the
stream is live, check the broadcast channel, never the bot account's channel. See `docs/twitch-setup.md`,
*Two Accounts, Named By Their Role*.

## 3. Twitch application

In the Twitch developer console, <https://dev.twitch.tv/console/apps>, register an application with the
client type *Confidential*: Stream247 needs its client secret. Three redirect URLs must match your
public base URL **exactly** (scheme, host, no trailing path differences):

- `https://<your-host>/api/integrations/twitch/callback` — bot account connection
- `https://<your-host>/api/auth/twitch/callback` — team sign-in with Twitch
- `https://<your-host>/api/integrations/twitch/callback-broadcaster` — channel owner connection; without
  it that connection ends in Twitch's "redirect mismatch" even when the other two are right

Note the Client ID and Client Secret. The full list of URLs is in `docs/twitch-setup.md`,
*Required Redirect URLs*.

**Trap:** `APP_URL` in `.env` and these redirect URLs disagreeing is the most common first-run
failure. Twitch says "redirect mismatch"; nothing in Stream247 can fix that for you.

## 4. Environment — optional, but decide before the first start

The stack boots without a `.env`: the app secret is generated on first boot and persisted at
`data/media/.stream247-app-secret` (owner-only file), the bundled PostgreSQL configures itself, and
the wizard asks for the public URL. `docker compose up -d` with no `.env` comes up healthy and `/`
redirects to `/setup`. That is not a one-time observation: `pnpm test:fresh-compose` starts exactly
that stack in CI and before every release, and fails if the redirect, the secret file or its
owner-only mode is missing.

Two things to know on that path:

- Compose prints `The "TRAEFIK_HOST" variable is not set. Defaulting to a blank string.` (and the
  same for `TRAEFIK_ACME_EMAIL`) on every command. Without a Traefik in front — the `proxy` profile,
  or your own one reading the container labels — nothing reads either value and the warning is
  harmless; with the profile, see section 5.
- The compose file needs Docker Compose 2.24 or newer (`docker compose version`), with or without a
  `.env`: older releases cannot read a file that marks its `.env` as optional and stop before
  starting anything.

Set values yourself when you want them pinned — for a restore, a rollback, or because the public URL
must be right before Twitch OAuth is configured:

```bash
cp .env.production.example .env
```

| Variable | What |
|---|---|
| `APP_URL` | the public base URL, `https://<your-host>` |
| `APP_SECRET` | 32+ random characters, set before the first start or left unset (then generated at `data/media/.stream247-app-secret` — back that file up together with PostgreSQL). Never change it later: it encrypts every stored credential and signs every session. To pin the generated one, copy the file's contents |
| `POSTGRES_PASSWORD` and the same password inside `DATABASE_URL` | database access |
| `TRAEFIK_HOST` (and `TRAEFIK_ACME_EMAIL` if the built-in Let's Encrypt profile is used) | the HTTPS front |
| `TWITCH_STREAM_KEY` | if the channel should go on air immediately; otherwise entered later in the wizard's *Where the stream goes* step or as the primary destination's stream key under `Studio → Output → Output destinations` (`/settings` has no stream-key field) |
| `CHANNEL_TIMEZONE` | leave unset to let the wizard manage it; the example file no longer pins a zone, because a valid env value always beats the wizard's field (an invalid one is skipped and raises the incident `config.channel-timezone.invalid`) |
| `CHANNEL_LANGUAGE` | `en` or `de`; leave unset to choose the language in the wizard or under `Admin → Settings → Channel language`. Like the time zone, an env value always beats the saved one; anything else than `de` counts as `en` |

Everything else — Twitch client credentials, SMTP, Discord — can be entered in the setup wizard or
under `/settings` later, encrypted with the app secret.

**Trap:** the database password is fixed when `data/postgres` is first created. If you start once
and set `POSTGRES_PASSWORD` afterwards, every service fails with `password authentication failed for
user "stream247"` and the browser shows a bare error page. Keep the password, or stop the stack and
remove `data/postgres` while it still holds nothing you need.

**Trap:** `.env.example` is the development file (`NODE_ENV=development`, `change-me` secrets). It is
not for the Docker stack; the compose file pins `NODE_ENV=production`, and the placeholder secrets from
both example files are refused in production.

**Trap:** `pnpm release:preflight` rejects untouched example values, quoted-empty secrets and
placeholder hosts such as `stream247.example.com`. Replace them; do not quote-empty them.

## 5. Start

```bash
docker compose --profile proxy up -d
```

(without the built-in Traefik: `docker compose up -d`, and put your own HTTPS in front of port 3000).

The `proxy` profile is the built-in Traefik with Let's Encrypt. It takes its hostname and its ACME
address from `TRAEFIK_HOST` and `TRAEFIK_ACME_EMAIL` in `.env`, so it is the one form that does not
work with nothing configured: with both unset Compose substitutes empty strings, the router rule is
built from an empty host name and Traefik has no host to answer for. Set the two first, or start
without the profile.

Create the owner immediately: until it exists, anyone who can reach the host can claim the workspace.
Port 3000 is published on every interface in both forms — the proxy is added in front of it, it does
not replace it — so firewall it if you cannot open the browser right away. Over plain HTTP a sign-in only holds on
`localhost`; from any other machine the browser drops the session cookie and every sign-in bounces back to
`/login`. `/setup` and `/login` say so when they are opened that way, with the two ways out: HTTPS (the
`proxy` profile, or your own HTTPS in front of port 3000), or an SSH tunnel
(`ssh -L 3000:localhost:3000 <user>@<host>`) and `http://localhost:3000`.

Then open `https://<your-host>/setup` (`/` leads there as long as no owner exists). The wizard runs
in this order, under these names: **Owner account → Instance basics (public URL, time zone, channel
language) → Twitch app credentials → Twitch accounts → Where the stream goes (the stream key, section 7)
→ First programme (a pool from your media that plays all week, section 9) → Review**. Creating the owner
signs you in; every later step can be skipped and stays open. **Review** is marked "Done" only when every
step before it is; its readiness checklist lists what is still missing. Reopening `/setup` later requires being signed in and continues at
the first unfinished step. Create the owner with an e-mail
address and a password of at least 10 characters, and store the password: the e-mail address cannot be
changed later, the password only under `Admin → Settings → Security` (with the current one). There is no
e-mail reset; a lost password is reset on the host with the command in `docs/operations.md`, *Owner
password lost*. The instance step comes prefilled with the address the wizard is open under and your
browser's time zone; check both before saving. The zone is only prefilled on a first run: once the
public URL was saved or the schedule has a block, an empty zone shows as empty and the hint says the
channel runs on UTC, because a new zone moves every block to that zone's clock.

A new install starts empty: the local media library is its only source, and there is no pool and no
schedule block until you create them. The readiness checklist counts what can air, not what exists: a
pool is ready once a block of the coming week uses it and it holds a ready video, the schedule once the
coming week has a block and every one of them has something to play (dated blocks that have ended or
start after the week do not count).

### Channel language

The channel language is the language your viewers are addressed in — one setting for everything they
see or read: the on-air picture (what plays now and next, polls, the skip bar, chat games), the
standby, reconnect and live-bridge texts, every chat bot reply, and the public page `/channel`.
`English` is the default; `German (Deutsch)` is the second language.

- Choose it in the wizard's instance step, or change it later under `Admin → Settings → Channel
  language`. It takes effect without a restart: the chat bot, the Twitch title and the public page pick
  it up with their next refresh, and the picture with the next playout cycle while a programme is on
  air. During a standby or reconnect slate the picture keeps the previous language until the next
  programme starts, as it does for a time zone change.
- `CHANNEL_LANGUAGE=de` in `.env` pins it and beats the saved value (the form says so when it is set).
  It is read when the containers start, so setting or changing it means recreating them
  (`docker compose up -d`).
- What you wrote yourself is never translated: asset and block titles, scene text layers, the ticker,
  a headline you changed in the studio. Only texts the product itself writes follow the language —
  including the studio's headline defaults (`Always on air`, `Insert on air`, …) for as long as you
  have not changed them. The rule compares the text: a title, category or source name that is exactly
  one of the product's own English texts (`Stand by`, `Live input`, …) is shown in the channel language
  too; `docs/operations.md`, *What Viewers Read*, lists them.
- The admin interface stays English.

## 6. Sign in and connect

If not still signed in, sign in as the owner. Open `Admin → Settings → Twitch accounts` (also the
"Twitch accounts" step in `/setup`):

1. **Broadcast channel** — enter the channel's login and save.
2. **Bot account login** — optional; when set, only that account can be connected as bot.
3. **Connect bot account** — Twitch shows which account is signing in; switch to the bot account if
   it shows another. With a bot account login set (step 2), or once a bot is connected, Stream247 refuses
   any other account here, the broadcast channel included. For one account (section 2), leave the bot
   account login empty and connect the broadcast channel here as the very first bot: that first connect
   is accepted, and the install runs as a single account.
   The bot account is also a sign-in: anyone who can log in to Twitch as it gets the owner role here,
   so treat it like the owner password (Twitch 2FA on, never shared).
4. **Connect as `<broadcast channel>`** — optional, for title, category, schedule and sub, cheer and
   channel-points alerts. Click it while signed in to Twitch as the broadcast channel.

Readiness appears on the same page and at `/api/system/readiness`. `broadcastReady` stays `false` until
a destination has a stream key and one asset is ready (sections 7 and 8); the Twitch connection is a
separate `hasTwitchConnection` field.

## 7. Stream key

Without a stream key nothing goes on air. The key belongs to the **broadcast channel**, never to the bot
account:

1. Sign in to Twitch as the broadcast channel and open the Creator Dashboard: *Settings → Stream*.
2. Copy the *Primary Stream key*. It is a password for your channel: never paste it into chat, a
   screenshot or an issue.
3. In Stream247 paste it into the wizard's *Where the stream goes* step (`/setup`), with *Twitch* as the
   service, and save. Later, or for another service, open `Studio → Output → Output destinations`, open
   *Change this destination* under **Primary Twitch Output**, paste the key into *Managed stream key* and
   save; the RTMP URL is already `rtmp://live.twitch.tv/app`. Either way the key is stored encrypted and
   never shown again; the forms only say whether one is present.
4. Check the readiness checklist on `Live → Status` (or the wizard's *Review*): its *Live destination*
   line turns ready.

`TWITCH_STREAM_KEY` in `.env` (section 4) does the same from the environment; a key saved in the form
is used ahead of it.

## 8. Media

Three ways in, all end up as library assets the worker scans within a few minutes:

- put files into `data/media` (formats: mp4, mkv, mov, m4v, webm — nothing else is picked up),
- add a direct media URL, a YouTube playlist/channel or a Twitch VOD/channel as a **source** under
  `Program → Sources`,
- upload through `Program → Library` (or in the wizard's *First programme* step while no video is
  ready yet).

Twitch VODs are downloaded to a local cache before airing. A download that outlives its time limit
is abandoned and the replay plays from Twitch directly for that airing; see `docs/operations.md`,
*Remote VOD reaches its end without EOF*.

## 9. Programme

The quickest start is the wizard's *First programme* step (`/setup`): tick the sources whose videos
should play (each with its number of ready videos), name the pool and press *Create the pool and fill
the week*. It creates the pool and applies the *Always-on single pool* template, one block from 00:00
to 24:00 on every day. With blocks already in the week it shows *Replace the blocks already in the week*:
weekly blocks are only replaced with it ticked (after a confirmation), since the new all-day blocks
would overlap them, and without it the step stops before it creates anything; dated blocks may stay. The readiness
lines *Program pools* and *Weekly schedule* then turn ready. Everything after that is done here:

`Program → Pools` groups sources for round-robin selection: a pool with several sources takes the next
item from each source in turn, in the order the pool lists them, and each source plays its own items
oldest first (publish date, else the date Stream247 first saw the item; a Twitch channel's archives
first seen together by VOD id), looping; a pool with one source plays it in order, and Skip carries on
after the skipped item;
`Program → Schedule` places weekly blocks that draw from a pool. A block on every weekday, including
one across midnight, is the shape that exercises everything. `Studio → Scene` is the on-air picture;
every control there carries an (i) that says what it does.

## 10. Know it is running

- `Live → Status`: readiness, destinations, incidents with their age.
- `/api/health` answers when the web app is up. `/api/system/readiness` always answers 200 — read
  `broadcastReady` from the body; `/api/ready` returns 503 only when the database or the initialization is
  missing, which includes a fresh install until its owner exists.
- Incidents close themselves once their area has been healthy for a while; a count that rises and
  does not fall again is the signal.

## 11. Upgrades and rollback

Production pins exact `v*` image tags. Upgrade by changing the three `STREAM247_*_IMAGE` tags and
redeploying; roll back by putting the previous tags back, after reading the release's rollback notes
first (since 2.3, dated and one-off blocks are deleted before a reverse repin: *Rollback to 2.1.0* in
`docs/deployment.md`). Take a PostgreSQL backup before every upgrade. The full flow, including the
rehearsal and soak scripts, is in `docs/deployment.md`.

## Where things are

| Topic | Page |
|---|---|
| Twitch application, redirect URLs, accounts | `docs/twitch-setup.md` |
| Deploying, upgrading, rollback, Portainer | `docs/deployment.md` |
| Day-to-day operation, symptoms and actions | `docs/operations.md` |
| Architecture | `docs/architecture.md` |
| Every configuration variable | `README.md`, *Configuration* |
