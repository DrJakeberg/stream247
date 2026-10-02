import { fetchWithTimeout } from "./http-timeout.js";

// The refresh-grant exchange with Twitch, and what its failure means (M87, R3 H1, owner Q3).
//
// R3's S2 run: a refresh token Twitch no longer accepts made the proactive refresh throw out of the
// whole worker cycle, every 30 s, for good. No heartbeat, no incident sweep, no live status, no chat,
// and the connection still read "connected" with no Twitch incident at all; the only trace was
// `worker.loop.crashed`. The refresh now fails as one step, and a refused token is told apart from
// a Twitch that is merely down: only the first needs the operator, so only the first sets the
// connection to error and asks for a reconnect.

/** A token this close to its expiry is refreshed ahead of time. */
export const TWITCH_TOKEN_REFRESH_WINDOW_MS = 5 * 60_000;

/**
 * The error text stored on a connection whose refresh token Twitch refused. Stable on purpose: the
 * connection heal reads it to leave such a record alone (see `decideTwitchConnectionHeal`).
 */
export const TWITCH_REFRESH_REFUSED_ERROR =
  "Twitch refused the stored refresh token. Reconnect the account under Admin → Settings → Twitch accounts.";

export function isTwitchRefreshRefusedError(error: string): boolean {
  return error === TWITCH_REFRESH_REFUSED_ERROR;
}

export class TwitchTokenRefreshError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** Twitch answered that the refresh token itself is no good: only a reconnect helps. */
    readonly refused: boolean,
    /** Whose refresh token it was: the bot account (`identity`) or the broadcast channel's own. */
    readonly account: TwitchRefreshAccount
  ) {
    super(message);
    this.name = "TwitchTokenRefreshError";
  }
}

/**
 * Whether a failed refresh response means the refresh token is dead.
 *
 * OAuth says `400 {"error":"invalid_grant"}`; Twitch answers a revoked or expired refresh token
 * with `400 {"status":400,"message":"Invalid refresh token"}`. Both count. Anything else -- a 5xx,
 * a 429, a 400 about the client credentials -- says nothing about the token, so the connection is
 * left as it is and the next cycle tries again.
 */
export function isRefusedRefreshResponse(status: number, body: string): boolean {
  if (status !== 400 && status !== 401) {
    return false;
  }

  return /invalid_grant|invalid refresh token/i.test(body);
}

/**
 * Whether a refresh failure means the bot account (the identity) must be reconnected. The 401 retries
 * refresh both accounts in one try; a refused broadcast channel account must not put the bot account,
 * whose own refresh worked, into error.
 */
export function isIdentityRefreshRefusal(error: unknown): error is TwitchTokenRefreshError {
  return error instanceof TwitchTokenRefreshError && error.refused && error.account === "identity";
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export type TwitchRefreshAccount = "identity" | "broadcaster";

/**
 * The refresh-grant HTTP exchange, shared by the identity and the broadcaster-slot refresh. What
 * differs between the two -- which record holds the refresh token and where the result is stored --
 * stays in the callers; copying the exchange instead would let the two flows drift apart on
 * exactly the error handling that 401 recovery depends on.
 */
export async function requestTwitchTokenRefresh(args: {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  errorLabel: string;
  account: TwitchRefreshAccount;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}): Promise<{ access_token: string; refresh_token?: string; expires_in?: number }> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: args.refreshToken,
    client_id: args.clientId,
    client_secret: args.clientSecret
  });

  const response = await fetchWithTimeout(
    "https://id.twitch.tv/oauth2/token",
    { method: "POST", body },
    { fetchImpl: args.fetchImpl, timeoutMs: args.timeoutMs }
  );

  if (!response.ok) {
    const responseText = await response.text().catch(() => "");
    const refused = isRefusedRefreshResponse(response.status, responseText);
    throw new TwitchTokenRefreshError(
      refused
        ? `${args.errorLabel} failed with status ${response.status}: Twitch refused the refresh token.`
        : `${args.errorLabel} failed with status ${response.status}.`,
      response.status,
      refused,
      args.account
    );
  }

  return (await response.json()) as { access_token: string; refresh_token?: string; expires_in?: number };
}
