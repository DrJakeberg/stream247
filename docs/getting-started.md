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

## 1. The two Twitch accounts — decide this first

Most installations run with **two** accounts, and Stream247 names them by role everywhere:

- the **broadcast channel** — the channel viewers watch; its stream key receives the video;
- the **bot account** — a moderator on that channel, connected to Stream247 for chat, emote-only
  automation, follow alerts and owner sign-in.

Chat and moderation work with the bot account alone. Title, category, schedule and sub, cheer and
channel-points alerts need the broadcast channel's own account (the optional **channel owner
connection**, section 5). Do not run the app as the broadcast channel to "make it simpler" — you would
hand the channel's own credentials to an always-on service. When you check whether the stream is
live, check the broadcast channel, never the bot account's channel. See `docs/twitch-setup.md`,
*Two Accounts, Named By Their Role*.

## 2. Twitch application

In the Twitch developer console create an application. Three redirect URLs must match your public
base URL **exactly** (scheme, host, no trailing path differences):

- `https://<your-host>/api/integrations/twitch/callback` — bot account connection
- `https://<your-host>/api/auth/twitch/callback` — team sign-in with Twitch
- `https://<your-host>/api/integrations/twitch/callback-broadcaster` — channel owner connection; without
  it that connection ends in Twitch's "redirect mismatch" even when the other two are right

Note the Client ID and Client Secret. The full list of URLs is in `docs/twitch-setup.md`,
*Required Redirect URLs*.

**Trap:** `APP_URL` in `.env` and these redirect URLs disagreeing is the most common first-run
failure. Twitch says "redirect mismatch"; nothing in Stream247 can fix that for you.

## 3. Environment — optional, but decide before the first start

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
  harmless; with the profile, see section 4.
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
| `TWITCH_STREAM_KEY` | if the channel should go on air immediately; otherwise entered later as the primary destination's stream key under `Live → Status → Output destinations` (`/settings` has no stream-key field) |
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

## 4. Start

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
language) → Twitch app credentials → Twitch accounts → Review**. Creating the owner signs you in; every
later step can be skipped and stays open. **Review** marked "Done" means the credentials are in place,
not that the channel can air — its readiness
checklist lists what is still missing. Reopening `/setup` later requires being signed in and continues at
the first unfinished step. Create the owner with an e-mail
address and a password of at least 10 characters, and store the password: the e-mail address cannot be
changed later, the password only under `Admin → Settings → Security` (with the current one). There is no
e-mail reset; a lost password is reset on the host with the command in `docs/operations.md`, *Owner
password lost*. The instance step comes prefilled with the address the wizard is open under and your
browser's time zone; check both before saving.

A new install starts empty: the local media library is its only source, and there is no pool and no
schedule block until you create them. The readiness checklist counts what can air, not what exists: a
pool is ready once a schedule block uses it and it holds a ready video, the schedule once every block of
the coming week has something to play.

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

## 5. Sign in and connect

If not still signed in, sign in as the owner. Open `Admin → Settings → Twitch accounts` (also the
"Twitch accounts" step in `/setup`):

1. **Broadcast channel** — enter the channel's login and save.
2. **Bot account login** — optional; when set, only that account can be connected as bot.
3. **Connect bot account** — Twitch shows which account is signing in; switch to the bot account if
   it shows another. With a bot account login set (step 2), or once a bot is connected, Stream247 refuses
   any other account here, the broadcast channel included.
   The bot account is also a sign-in: anyone who can log in to Twitch as it gets the owner role here,
   so treat it like the owner password (Twitch 2FA on, never shared).
4. **Connect as `<broadcast channel>`** — optional, for title, category, schedule and sub, cheer and
   channel-points alerts. Click it while signed in to Twitch as the broadcast channel.

Readiness appears on the same page and at `/api/system/readiness`. `broadcastReady` stays `false` until
a destination has a stream key and one asset is ready (sections 6 and 7); the Twitch connection is a
separate `hasTwitchConnection` field.

## 6. Media

Three ways in, all end up as library assets the worker scans within a few minutes:

- put files into `data/media` (formats: mp4, mkv, mov, m4v, webm — nothing else is picked up),
- add a direct media URL, a YouTube playlist/channel or a Twitch VOD/channel as a **source** under
  `Program → Sources`,
- upload through `Program → Library`.

Twitch VODs are downloaded to a local cache before airing. A download that outlives its time limit
is abandoned and the replay plays from Twitch directly for that airing; see `docs/operations.md`,
*Remote VOD reaches its end without EOF*.

## 7. Programme

`Program → Pools` groups sources for round-robin selection: a pool with several sources takes the next
item from each source in turn, in the order the pool lists them, and each source plays its own items
oldest first (publish date, else the date Stream247 first saw the item; a Twitch channel's archives
first seen together by VOD id), looping; a pool with one source plays it in order, and Skip carries on
after the skipped item;
`Program → Schedule` places weekly blocks that draw from a pool. A block on every weekday, including
one across midnight, is the shape that exercises everything. `Studio → Scene` is the on-air picture;
every control there carries an (i) that says what it does.

## 8. Know it is running

- `Live → Status`: readiness, destinations, incidents with their age.
- `/api/health` answers when the web app is up. `/api/system/readiness` always answers 200 — read
  `broadcastReady` from the body; `/api/ready` returns 503 only when the database or the initialization is
  missing, which includes a fresh install until its owner exists.
- Incidents close themselves once their area has been healthy for a while; a count that rises and
  does not fall again is the signal.

## 9. Upgrades and rollback

Production pins exact `v*` image tags. Upgrade by changing the three `STREAM247_*_IMAGE` tags and
redeploying; roll back by putting the previous tags back. Take a PostgreSQL backup before every
upgrade. The full flow, including the rehearsal and soak scripts, is in `docs/deployment.md`.

## Where things are

| Topic | Page |
|---|---|
| Twitch application, redirect URLs, accounts | `docs/twitch-setup.md` |
| Deploying, upgrading, rollback, Portainer | `docs/deployment.md` |
| Day-to-day operation, symptoms and actions | `docs/operations.md` |
| Architecture | `docs/architecture.md` |
| Every configuration variable | `README.md`, *Configuration* |
