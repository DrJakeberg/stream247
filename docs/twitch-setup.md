# Twitch Setup

## OAuth Configuration

- `APP_URL` must match the URL that Twitch redirects back to.
- `TWITCH_CLIENT_ID` and `TWITCH_CLIENT_SECRET` must be configured in the environment.
- The Twitch application redirect URL should point to `/api/integrations/twitch/callback`.
- Twitch team sign-in uses `/api/auth/twitch/callback`.

## Planned API Usage

- Channel metadata updates
- Stream schedule sync
- Chat settings updates for emote-only mode

## Team Access And SSO

- The streamer or an admin can grant access to moderators and operators by Twitch login in the admin UI.
- Team members then authenticate with Twitch SSO.
- The broadcaster account can be treated as owner when its Twitch user id matches the connected broadcaster identity.

## Moderator Presence

If enabled, moderators can check in with `here 30` or a configured variant.
The system treats this as an explicit presence window and can disable emote-only mode until the window expires.
