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

Most installations run with **two** accounts:

- the **broadcaster** — the channel viewers watch; its stream key receives the video;
- a **moderator** account on that channel — connected to Stream247, used for chat presence,
  emote-only automation and team sign-in.

Everything in Stream247 works with **moderator** rights. Title, category and schedule sync are the
exception: they need the broadcaster's own OAuth connection (`Connect broadcast channel` under
`Live → Status`, section 5). Do not run the app as the broadcaster to "make it simpler" — you would hand the channel's
own credentials to an always-on service. See `docs/twitch-setup.md`, *Broadcast Channel*.

## 2. Twitch application

In the Twitch developer console create an application. Two redirect URLs must match your public
base URL **exactly** (scheme, host, no trailing path differences):

- `https://<your-host>/api/auth/twitch/callback`
- `https://<your-host>/api/integrations/twitch/callback`
- `https://<your-host>/api/integrations/twitch/callback-broadcaster` — used by `Connect broadcast channel`; without it
  the broadcaster connect ends in Twitch's "redirect mismatch" even when the other two are right

Note the Client ID and Client Secret. The full list of URLs is in `docs/twitch-setup.md`,
*Required Redirect URLs*.

**Trap:** `APP_URL` in `.env` and these redirect URLs disagreeing is the most common first-run
failure. Twitch says "redirect mismatch"; nothing in Stream247 can fix that for you.

## 3. Environment — optional, but decide before the first start

The stack boots without a `.env`: the app secret is generated on first boot and persisted at
`data/media/.stream247-app-secret` (owner-only file), the bundled PostgreSQL configures itself, and
the wizard asks for the public URL. Verified on a fresh checkout: `docker compose up -d` with no
`.env` comes up healthy and `/` redirects to `/setup`.

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
| `CHANNEL_TIMEZONE` | leave unset to let the wizard manage it; the example file no longer pins a zone, because an env value always beats the wizard's field |

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

Create the owner immediately: until it exists, anyone who can reach the host can claim the workspace,
so firewall the port if you cannot open the browser right away. Over plain HTTP a sign-in only holds on
`localhost`; from any other machine use HTTPS, or the session cookie is dropped and every sign-in bounces
back to `/login` without a message.

Then open `https://<your-host>/setup`. The wizard runs in this order: **owner account → instance
(public URL) → Twitch app credentials → Twitch connect → done**. Creating the owner signs you in; the
wizard's "done" means the credentials are in place, not that the channel can air — its readiness
checklist lists what is still missing. Reopening `/setup` later requires being signed in and continues at
the first unfinished step. Create the owner with an e-mail
address and a password of at least 10 characters — there is no way to change either later without
database access, so store them.

## 5. Sign in and connect

If not still signed in, sign in as the owner. Under `Live → Status`, use `Connect Twitch` with the
**moderator** account. The connected account is also a sign-in: anyone who can log in to Twitch as it
gets the owner role here, so treat it like the owner password (Twitch 2FA on, never shared).

For title, category and schedule sync, first set `Admin → Settings → Managed credentials → Broadcast
channel login` to the broadcaster's login; only then does `Live → Status` show `Connect broadcast
channel`. Click that while signed in to Twitch as the broadcaster.

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

`Program → Pools` groups assets for round-robin selection; `Program → Schedule` places weekly blocks
that draw from a pool. A block on every weekday, including one across midnight, is the shape that
exercises everything. `Studio → Scene` is the on-air picture; every control there carries an (i)
that says what it does.

## 8. Know it is running

- `Live → Status`: readiness, destinations, incidents with their age.
- `/api/health` answers when the web app is up. `/api/system/readiness` always answers 200 — read
  `broadcastReady` from the body; `/api/ready` returns 503 only when the database or the initialization is
  missing.
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
