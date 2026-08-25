// Resolving the broadcast channel's Helix user id.
//
// Chat-settings writes (emote-only and friends) address the channel by user id, not by login, and
// the only id the connection state carries is the connected identity's own. When the broadcast
// channel is a different channel, its id has to come from a Helix users lookup by login. The
// mapping is cached for the process lifetime: a Twitch login maps to the same id for as long as
// the account exists, and re-resolving it on every reconciliation cycle would spend rate limit on
// an answer that cannot change. A rename changes the login, which is a different cache key, so a
// stale entry cannot be served for a renamed channel.

type FetchLike = typeof fetch;

export type TwitchUserIdResolver = {
  resolve(args: { login: string; accessToken: string; clientId: string; fetchImpl?: FetchLike }): Promise<string>;
};

export function createTwitchUserIdResolver(): TwitchUserIdResolver {
  const idsByLogin = new Map<string, string>();

  return {
    async resolve(args) {
      const login = args.login.trim().toLowerCase();
      if (!login) {
        throw new Error("Cannot resolve a Twitch user id for an empty login.");
      }

      const cached = idsByLogin.get(login);
      if (cached) {
        return cached;
      }

      const fetchImpl = args.fetchImpl ?? fetch;
      const response = await fetchImpl(`https://api.twitch.tv/helix/users?login=${encodeURIComponent(login)}`, {
        headers: {
          Authorization: `Bearer ${args.accessToken}`,
          "Client-Id": args.clientId
        }
      });

      if (!response.ok) {
        throw new Error(`Twitch user lookup for ${login} failed with status ${response.status}.`);
      }

      const payload = (await response.json()) as { data?: Array<{ id?: string }> };
      const id = payload.data?.[0]?.id;
      if (!id) {
        // An empty result is a real answer, not a transient fault: the login does not exist. It is
        // still not cached, so fixing a typo in the setting takes effect on the next cycle.
        throw new Error(`Twitch user lookup for ${login} returned no user.`);
      }

      idsByLogin.set(login, id);
      return id;
    }
  };
}
