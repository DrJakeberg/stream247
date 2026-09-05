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
exception: they need the broadcaster's own OAuth connection (`Connect Twitch` under `Live → Status`,
later). Do not run the app as the broadcaster to "make it simpler" — you would hand the channel's
own credentials to an always-on service. See `docs/twitch-setup.md`, *Broadcast Channel*.

## 2. Twitch application

In the Twitch developer console create an application. Two redirect URLs must match your public
base URL **exactly** (scheme, host, no trailing path differences):

- `https://<your-host>/api/auth/twitch/callback`
- `https://<your-host>/api/integrations/twitch/callback`

Note the Client ID and Client Secret. The full list of URLs is in `docs/twitch-setup.md`,
*Required Redirect URLs*.

**Trap:** `APP_URL` in `.env` and these redirect URLs disagreeing is the most common first-run
failure. Twitch says "redirect mismatch"; nothing in Stream247 can fix that for you.

## 3. Environment

```bash
cp .env.production.example .env
```

Set, before first start:

| Variable | What |
|---|---|
| `APP_URL` | the public base URL, `https://<your-host>` |
| `APP_SECRET` | a long random secret; encrypts stored credentials — losing it means re-entering every secret |
| `POSTGRES_PASSWORD` and the same password inside `DATABASE_URL` | database access |
| `TRAEFIK_HOST` (and `TRAEFIK_ACME_EMAIL` if the built-in Let's Encrypt profile is used) | the HTTPS front |
| `TWITCH_STREAM_KEY` | if the channel should go on air immediately; can be entered later in `/settings` |

Everything else — Twitch client credentials, SMTP, Discord — can be entered in the setup wizard or
under `/settings` later, encrypted with `APP_SECRET`.

**Trap:** `pnpm release:preflight` rejects untouched example values, quoted-empty secrets and
placeholder hosts such as `stream247.example.com`. Replace them; do not quote-empty them.

## 4. Start

```bash
docker compose --profile proxy up -d
```

(without the built-in Traefik: `docker compose up -d`, and put your own HTTPS in front of port 3000).

Then open `https://<your-host>/setup`. The wizard runs in this order: **owner account → instance
(public URL) → Twitch app credentials → Twitch connect → done**. Create the owner with an e-mail
address and a password of at least 10 characters — there is no way to change either later without
database access, so store them.

## 5. Sign in and connect

Sign in as the owner. Under `Live → Status`, use `Connect Twitch` with the **moderator** account.
Readiness appears on the same page and at `/api/system/readiness`; the goal is
`broadcastReady=true`.

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
- `/api/health` answers when the web app is up; `/api/system/readiness` when the channel can go on air.
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
