# Twitch Setup

## OAuth Configuration

- `APP_URL` must match the URL that Twitch redirects back to.
- `TWITCH_CLIENT_ID` and `TWITCH_CLIENT_SECRET` must be configured in the environment.
- The Twitch application redirect URL should point to `/api/integrations/twitch/callback`.
- Twitch team sign-in uses `/api/auth/twitch/callback`.
- Stream247 expects both redirect URLs to be registered on the same Twitch application.

## How To Get Client ID And Secret

1. Sign in to the Twitch developer console with the broadcaster account or the account that owns the Twitch application.
2. Create a new application or open an existing application for Stream247.
3. Add the redirect URLs for broadcaster connect and team SSO:
   - `<APP_URL>/api/integrations/twitch/callback`
   - `<APP_URL>/api/auth/twitch/callback`
4. Copy the Client ID into `TWITCH_CLIENT_ID`.
5. Create, reveal, or regenerate the Client Secret and store it in `TWITCH_CLIENT_SECRET`.
6. Restart the containers after updating `.env`.
7. Open the Stream247 dashboard and use `Connect Twitch` or `Sign in with Twitch`.

## Why This Stays In `.env`

- The Twitch client secret is an application credential, not a normal per-user preference.
- Stream247 keeps moderator presence and operational settings inside PostgreSQL because they are runtime state.
- Stream247 keeps OAuth client secrets in `.env` because that is the safer place for deployment-time secrets until encrypted secret storage exists.

## Current API Usage

- Channel metadata updates for title and category from the active schedule block
- Schedule segment sync for upcoming schedule blocks
- Chat settings updates for emote-only mode
- RTMP output using `TWITCH_RTMP_URL` and `TWITCH_STREAM_KEY`

## Still Planned

- richer drag/drop schedule authoring and operator override flows

## Team Access And SSO

- The streamer or an admin can grant access to moderators and operators by Twitch login in the admin UI.
- Team members then authenticate with Twitch SSO.
- The broadcaster account can be treated as owner when its Twitch user id matches the connected broadcaster identity.

## Moderator Presence

If enabled, moderators can check in with `here 30` or a configured variant.
The system treats this as an explicit presence window and can disable emote-only mode until the window expires.
