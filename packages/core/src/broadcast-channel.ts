// The broadcast channel as a concept of its own.
//
// The stream key can send video to a channel the connected OAuth account does not own — a
// moderator account keeps chat and moderation working while the broadcaster account is out of
// reach. Everything here assumed connected account == broadcast channel, so chat joined the
// moderator's own empty room and Helix writes patched the moderator's channel while the audience
// watched somewhere else. These helpers make the split explicit and keep the decision logic pure,
// so worker and web resolve the same channel from the same inputs.

// Twitch logins are a narrow shape: four to twenty-five characters, letters, digits and
// underscores. The configured value ends up in an IRC JOIN, in Helix query parameters, and in a
// public href, so anything outside that shape is rejected outright rather than escaped.
const TWITCH_LOGIN_PATTERN = /^[a-zA-Z0-9_]{4,25}$/;

export function isValidTwitchLogin(value: string): boolean {
  return TWITCH_LOGIN_PATTERN.test(value.trim());
}

/**
 * Which channel the product broadcasts to.
 *
 * Empty or invalid configuration falls back to the connected identity — exactly the old
 * single-account behaviour, which is also the documented rollback path. An invalid value is
 * treated the same as an empty one because joining a malformed channel or building a broken watch
 * link would be worse than the previous wrong-but-working behaviour.
 */
export function resolveBroadcastChannelLogin(args: {
  configuredLogin: string;
  identityLogin: string;
}): string {
  const configured = args.configuredLogin.trim();
  return isValidTwitchLogin(configured) ? configured : args.identityLogin.trim();
}

/**
 * Whether the broadcast channel is a different channel than the connected identity.
 *
 * Case-insensitive because Twitch logins are case-insensitive: configuring "Jimpanse247" while
 * the identity is "jimpanse247" is not a split, and treating it as one would silently stop
 * metadata sync on a channel we can in fact write to.
 */
export function isBroadcastChannelSplit(args: { configuredLogin: string; identityLogin: string }): boolean {
  const resolved = resolveBroadcastChannelLogin(args);
  return resolved.toLowerCase() !== args.identityLogin.trim().toLowerCase();
}

export const TWITCH_METADATA_WAITING_MESSAGE = "Waiting for broadcast channel connection.";

// Exactly the writes the broadcaster slot exists for — title/category and schedule. Asking for
// more would turn a narrowly scoped metadata connection into a second fully privileged account
// for no benefit; the identity connection keeps every other scope.
export const TWITCH_BROADCASTER_SLOT_SCOPES = ["channel:manage:broadcast", "channel:manage:schedule"];

export type TwitchMetadataSyncGate =
  | { mode: "identity" }
  | { mode: "waiting-for-broadcaster"; broadcastChannelLogin: string }
  | { mode: "broadcaster"; broadcastChannelLogin: string };

/**
 * Who is allowed to write title, category and schedule — and whether anyone currently can.
 *
 * Channel metadata writes require the broadcaster's own token; a moderator token cannot patch
 * another channel's title. When the configured broadcast channel differs from the connected
 * identity, writing with the identity token would land on the identity's channel — the exact
 * failure this split exists to end. So the sync either uses the identity (no split), uses a
 * separately connected broadcaster account that matches the broadcast channel, or visibly waits.
 * A broadcaster connection for some other channel counts as waiting too: writing there would be
 * wrong in the same way writing to the identity was.
 */
export function resolveTwitchMetadataSyncGate(args: {
  configuredLogin: string;
  identityLogin: string;
  broadcasterConnection: { status: string; broadcasterLogin: string; accessToken: string };
}): TwitchMetadataSyncGate {
  if (!isBroadcastChannelSplit(args)) {
    return { mode: "identity" };
  }

  const broadcastChannelLogin = resolveBroadcastChannelLogin(args);
  const connection = args.broadcasterConnection;
  const connectionMatchesChannel =
    connection.status === "connected" &&
    connection.accessToken !== "" &&
    connection.broadcasterLogin.trim().toLowerCase() === broadcastChannelLogin.toLowerCase();

  return connectionMatchesChannel
    ? { mode: "broadcaster", broadcastChannelLogin }
    : { mode: "waiting-for-broadcaster", broadcastChannelLogin };
}

export type BroadcasterConnectVerdict =
  | { ok: true; broadcastChannelLogin: string }
  | { ok: false; reason: "no-split" | "wrong-account"; message: string };

/**
 * Whether a completed broadcaster-slot OAuth may be stored.
 *
 * The dangerous outcome is a token for the wrong channel sitting in the broadcaster slot: the
 * sync gate would either flip on and patch a channel nobody broadcasts to, or keep waiting while
 * the dashboard claims a connection exists. The likeliest wrong account is the identity itself —
 * the operator is usually signed in to Twitch as the moderator, and Twitch happily authorises
 * whoever holds the session. So the decision runs before anything is persisted, compares logins
 * case-insensitively (Twitch logins are), and rejects with a message that names both accounts,
 * because "connect failed" without the names would send the operator straight back into the same
 * mistake.
 */
export function evaluateBroadcasterConnectLogin(args: {
  configuredLogin: string;
  identityLogin: string;
  authenticatedLogin: string;
}): BroadcasterConnectVerdict {
  if (!isBroadcastChannelSplit(args)) {
    return {
      ok: false,
      reason: "no-split",
      message:
        "No broadcast channel split is configured, so there is no broadcaster slot to fill — the identity connection already covers metadata sync."
    };
  }

  const broadcastChannelLogin = resolveBroadcastChannelLogin(args);
  const authenticated = args.authenticatedLogin.trim();

  if (authenticated.toLowerCase() !== broadcastChannelLogin.toLowerCase()) {
    return {
      ok: false,
      reason: "wrong-account",
      message: `Twitch authorised ${authenticated || "an unknown account"}, but the broadcast channel is ${broadcastChannelLogin}. Nothing was stored — sign in to Twitch as ${broadcastChannelLogin} and connect again.`
    };
  }

  return { ok: true, broadcastChannelLogin };
}
