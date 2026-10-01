import { findMissingTwitchIdentityScopes } from "@stream247/core";

// Bringing a connection back from the error status without a second trip through OAuth.
//
// The error status is written from memory: something failed once, and the record kept saying so
// afterwards. That was survivable while only a real breakage could write it — it is not, now that
// we know a rejected connect attempt could too. An install was measured sitting on a fresh, fully
// scoped token that chat was actively using, while the record still claimed the connection was
// broken and three features stayed switched off behind that claim.
//
// So the status gets a second source: measurement. Twitch will say whether a token works and what
// it may do, and that answer outranks whatever the record remembers. Same rule the incident list
// was rebuilt on.

/**
 * How long to wait between two re-checks of the same stored token.
 *
 * The worker cycles far faster than this. Without an interval a permanently dead token would mean
 * one validate call per cycle forever, which is the kind of steady background load Twitch
 * rate-limits. Ten minutes keeps a wrongly-errored connection down for at most one advert break
 * while costing at most six requests an hour when the token really is gone.
 */
export const TWITCH_CONNECTION_HEAL_MIN_INTERVAL_MS = 10 * 60_000;

export type TwitchConnectionHealDecision =
  | { attempt: true }
  | { attempt: false; reason: "not-in-error" | "no-token" | "checked-recently" };

/**
 * Whether this cycle should ask Twitch about the stored token.
 *
 * Status is the trigger, not a timer: a healthy connection is never re-validated, so the normal
 * case costs nothing at all. The two remaining brakes are an empty token — an error with no token
 * is a connection that genuinely never completed, and only a reconnect fixes that — and the
 * interval above.
 */
export function decideTwitchConnectionHeal(args: {
  status: string;
  accessToken: string;
  lastAttemptAt: number;
  now: number;
  minIntervalMs?: number;
}): TwitchConnectionHealDecision {
  if (args.status !== "error") {
    return { attempt: false, reason: "not-in-error" };
  }

  if (args.accessToken.trim() === "") {
    return { attempt: false, reason: "no-token" };
  }

  const minIntervalMs = args.minIntervalMs ?? TWITCH_CONNECTION_HEAL_MIN_INTERVAL_MS;
  if (args.lastAttemptAt > 0 && args.now - args.lastAttemptAt < minIntervalMs) {
    return { attempt: false, reason: "checked-recently" };
  }

  return { attempt: true };
}

export type TwitchTokenVerdict =
  | { healthy: true; login: string; userId: string }
  | { healthy: false; reason: "rejected"; status: number }
  | { healthy: false; reason: "missing-scopes"; missingScopes: string[] }
  | { healthy: false; reason: "unreachable"; message: string };

type FetchLike = (url: string, init?: { headers?: Record<string, string> }) => Promise<Response>;

/**
 * What Twitch says about a token we already hold.
 *
 * Three different negatives, because they call for three different things. A rejected token is the
 * case the error status exists for and needs a reconnect. A valid token with a short grant also
 * needs a reconnect, but for a reason the operator can only act on if it is named — healing it
 * would restart a sync that then fails on every cycle. An unreachable Twitch says nothing about
 * the token at all, and reporting that as a broken connection would turn every network blip into a
 * reconnect prompt nobody can act on; it simply leaves the status where it is until next time.
 *
 * A healthy verdict means the token is at least as capable as reconnecting would make it, which is
 * the only bar at which promoting it back to connected is honest.
 */
export async function validateTwitchAccessToken(
  accessToken: string,
  fetchImpl: FetchLike = fetch
): Promise<TwitchTokenVerdict> {
  let response: Response;
  try {
    response = await fetchImpl("https://id.twitch.tv/oauth2/validate", {
      // Twitch's validate endpoint takes the OAuth scheme here, not Bearer; with Bearer it
      // answers 401 for a perfectly good token, which would read as a revoked grant.
      headers: { Authorization: `OAuth ${accessToken}` }
    });
  } catch (error) {
    return { healthy: false, reason: "unreachable", message: error instanceof Error ? error.message : String(error) };
  }

  if (!response.ok) {
    return { healthy: false, reason: "rejected", status: response.status };
  }

  let payload: { login?: string; user_id?: string; scopes?: string[] };
  try {
    payload = (await response.json()) as typeof payload;
  } catch (error) {
    return { healthy: false, reason: "unreachable", message: error instanceof Error ? error.message : String(error) };
  }

  const missingScopes = findMissingTwitchIdentityScopes(payload.scopes ?? []);
  if (missingScopes.length > 0) {
    return { healthy: false, reason: "missing-scopes", missingScopes };
  }

  return { healthy: true, login: payload.login ?? "", userId: payload.user_id ?? "" };
}
