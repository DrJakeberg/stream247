# Twitch Setup

## Two Accounts, Named By Their Role

Stream247 can involve two different Twitch accounts. Since 2.1 every screen, log line and document
names them by their role, because mixing them up is easy and expensive: on 2026-09-28 an operator
checked the bot account's channel for the live status of the broadcast channel and took a running
stream off the air for five minutes.

| Role | What it is | Example | Where it is set |
|---|---|---|---|
| **Broadcast channel** | The channel the video goes to and viewers watch. The stream key belongs to it. | `yourchannel` | Admin → Settings → Twitch accounts (env fallback `TWITCH_BROADCAST_CHANNEL_LOGIN`) |
| **Bot account** | The account Stream247 signs in as for chat and moderation. A moderator in the broadcast channel's chat. | `yourbot` | Connected under Twitch accounts; the expected login is optional (env fallback `TWITCH_BOT_LOGIN`) |
| **Channel owner connection** (optional) | The broadcast channel's own account, connected for what Twitch only accepts from the channel itself. | `yourchannel` | Connected under Twitch accounts |
| **Content source** | A Twitch archive or YouTube channel Stream247 pulls programme from. Never broadcast to. | `twitch.tv/somecreator` | Program → Sources |

One account can be both broadcast channel and bot ("single account"). That is the pre-2.1 setup and
keeps working; the panel then says so instead of assuming it silently. When no broadcast channel is
set, Stream247 assumes the bot account's own channel and shows a warning.

## Is The Channel Live?

Check the **broadcast channel** — `twitch.tv/<broadcast channel>` or, from the playout container,
`yt-dlp --simulate --print "%(is_live)s" https://www.twitch.tv/<broadcast channel>`. Never the bot
account's channel: it is empty by design, and "offline" there says nothing about the stream. The
panel under Admin → Settings → Twitch accounts shows the broadcast channel's live state and repeats
this rule.

## Which Feature Uses Which Account

| Feature | Runs through | Scopes | Without it |
|---|---|---|---|
| Chat rail, `!here` check-ins, chat games | bot account | `chat:read`, `chat:edit` | chat features stay quiet |
| Emote-only and chat moderation on the broadcast channel | bot account (as moderator) | `moderator:manage:chat_settings` | the mode is not switched |
| Follow alerts | bot account (as moderator) | `moderator:read:followers` | no follow events |
| Live status and viewer count of the broadcast channel | bot account + Twitch app | — | shown as unknown |
| Title and category | split: channel owner · single account: bot | `channel:manage:broadcast` | wait, visibly (info incident) |
| Twitch schedule | split: channel owner · single account: bot | `channel:manage:schedule` | waits, visibly |
| Sub, cheer and channel-points alerts | split: channel owner · single account: bot | `channel:read:subscriptions`, `bits:read`, `channel:read:redemptions` | not subscribed; the panel lists them as waiting |
| Sign in to Stream247 with Twitch as owner | bot account | — | owner signs in locally |

The bot account must be a **moderator** in the broadcast channel's chat (`/mod <bot>` there).
Alerts are recorded and listed under Studio → Engagement; they are not drawn on air yet.

## Required Redirect URLs

All three must be registered on the same Twitch application:

- `<APP_URL>/api/integrations/twitch/callback` — bot account connection
- `<APP_URL>/api/auth/twitch/callback` — team sign-in with Twitch
- `<APP_URL>/api/integrations/twitch/callback-broadcaster` — channel owner connection

A missing one ends that connection in Twitch's "redirect mismatch". `<APP_URL>` is the public base
URL of the deployment — the `APP_URL` env variable or the public URL saved in the `/setup` wizard
(env wins when both are set); the wizard's Twitch-credentials step prints all three.

## How To Get Client ID And Secret

1. Sign in to the Twitch developer console.
2. Create a new application or edit the one Stream247 should use.
3. Add the three redirect URLs above.
4. Copy the Client ID into `TWITCH_CLIENT_ID`; generate the Client Secret into `TWITCH_CLIENT_SECRET`.
5. Store them in `.env`, during `/setup`, or later under Admin → Settings → Managed credentials.
   Restart the stack only if you changed `.env`.

## Setting Up The Two Accounts

Admin → Settings → **Twitch accounts** (also step "Twitch accounts" in `/setup`) shows two cards.

1. **Broadcast channel.** Enter the channel's login and save. The card shows where the value came
   from (saved here, or `TWITCH_BROADCAST_CHANNEL_LOGIN`), the channel's live state, and — in a split
   setup — the channel owner connection with what waits for it.
2. **Bot account login** (optional). When set, connecting the bot accepts only this login and the card
   warns if another account is connected. Empty accepts any account, as before 2.1.
3. **Connect bot account.** Twitch shows which account is signing in (`force_verify`) with a
   "Not you?" switch. Stream247 refuses, without storing anything and revoking the token:
   - another account than the configured bot login;
   - the broadcast channel itself while another bot account is connected — storing it would silently
     turn the split into a single account. Connect it under "Channel owner connection" instead, or
     clear the broadcast channel to run with one account.
   On the very first connect (no bot yet, no bot login set) the broadcast channel is accepted and the
   install runs as a single account; set the bot account login first to rule that out.
   A refusal is recorded as `twitch.bot.rejected` and shown on the card.
4. **Connect as `<broadcast channel>`** (optional, split setups). Sign in to Twitch as the broadcast
   channel in this browser first. The callback checks the authorised login against the broadcast
   channel and refuses any other account. On success title, category, schedule and the sub, cheer and
   channel-points alerts switch on within the next worker cycle; `Disconnect channel owner` returns them
   to their visible waiting state.

Both connect flows return to the Twitch accounts panel.

## Where These Settings Live

- The broadcast channel login and the bot account login are stored in the managed configuration
  (encrypted at rest in PostgreSQL). `TWITCH_BROADCAST_CHANNEL_LOGIN` and `TWITCH_BOT_LOGIN` are env
  fallbacks, used only while no value is saved in the UI.
- `TWITCH_CLIENT_ID` and `TWITCH_CLIENT_SECRET` are application credentials; blank secret fields keep
  the stored value.
- The credentials form does not touch the broadcast channel: since 2.1 it is edited only in the Twitch
  accounts panel.

## Names In The Database

The tables predate the split, so their column names do not say "bot":

- `twitch_connection` is the **bot account**. Its `broadcaster_id` / `broadcaster_login` hold the
  bot's id and login. Its `live_status`, `viewer_count` and sync bookkeeping describe the **broadcast
  channel** (the worker measures and writes that channel); they only live on this row.
- `twitch_broadcaster_connection` is the **channel owner connection**.
- The worker log `twitch.chat_settings.written` names `channelLogin`/`channelId` and `botLogin`/`botId`.

Read the roles through the Twitch accounts panel (or `resolveTwitchAccountsForState` in code), never
from these column names.

## Team Access And Twitch SSO

- The owner or an admin grants access by Twitch login in the admin UI; team members then sign in with
  Twitch. Roles: `owner`, `admin`, `operator`, `moderator`, `viewer`.
- The **bot account** is also a sign-in: whoever can log in to Twitch as it becomes workspace owner
  here. Treat it like the owner password — Twitch 2FA on, never shared. Every other account, the
  broadcast channel's owner included, needs a grant.

## RTMP Output

The stream key must belong to the **broadcast channel**:

- `TWITCH_STREAM_KEY` (or the key on the primary output destination under Live → Status)
- optionally `TWITCH_RTMP_URL` (default `rtmp://live.twitch.tv/app`)
- generic overrides: `STREAM_OUTPUT_URL`, `STREAM_OUTPUT_KEY`

## Moderator Presence

Moderators can check in with commands such as `!here 30`. That opens an explicit presence window;
while one is active Stream247 keeps chat out of emote-only mode, and when it expires it returns to the
configured fallback moderation mode.

## Current Limitations

- Twitch integration is Twitch-first, not multi-destination.
- Viewer alerts are recorded and listed, not drawn on air.
- The overlay is Stream247's own on-air overlay, drawn by the playout renderer.
