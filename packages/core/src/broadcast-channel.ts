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

/**
 * Everything the identity connection is asked to grant.
 *
 * Lives here rather than inline in the authorize URL because two places need the same list: the
 * connect flow that requests it, and the heal path that has to decide whether a token already in
 * hand is as capable as reconnecting would make it. Reading it from one constant is what keeps
 * those two answers from drifting apart.
 */
export const TWITCH_IDENTITY_SCOPES = [
  "channel:manage:broadcast",
  "channel:manage:schedule",
  "bits:read",
  "channel:read:redemptions",
  "moderator:manage:chat_settings",
  "moderator:read:followers",
  "channel:read:subscriptions",
  // The IRC bridge authenticates with this token. Without chat:read Twitch refuses the login
  // outright ("Login unsuccessful") and closes the socket, which is not distinguishable from a
  // network fault at the socket level -- chat simply never arrived, and every poll closed with no
  // votes. chat:edit is what lets the bridge answer a moderator check-in in the room it is reading.
  "chat:read",
  "chat:edit"
];

/**
 * Which of the required scopes a reported grant does not carry, in the order they are required.
 *
 * Returns the names rather than a boolean because "reconnect, the grant is short" is not an
 * instruction anyone can act on — the missing scope is what tells an operator which capability
 * they lost. Whitespace and empty entries are tolerated: Twitch reports the grant as a JSON array
 * here and as a space-separated string elsewhere, and a split of the latter leaves both behind.
 */
export function findMissingTwitchIdentityScopes(grantedScopes: readonly string[]): string[] {
  const granted = new Set(grantedScopes.map((scope) => scope.trim()).filter((scope) => scope !== ""));
  return TWITCH_IDENTITY_SCOPES.filter((scope) => !granted.has(scope));
}

/** What a failure says something about: the attempt that just failed, or the stored connection. */
export type TwitchConnectionFailureKind = "connect-attempt" | "existing-connection";

/**
 * Whether a failure may flip a Twitch connection record into the error status.
 *
 * One rule for both slots. The broadcaster slot has always refused to downgrade a working
 * connection; the identity slot did not, so a rejected second callback — a double-clicked connect
 * button, a stale tab — marked a healthy connection broken. Metadata sync, moderation sync and
 * event registration are all gated on the connected status, so three features stopped at once
 * while the token itself kept working and chat kept flowing. The operator saw a check-in command
 * that appeared to do nothing.
 *
 * The distinction the guard turns on is what the failure is evidence *about*. A rejected connect
 * attempt says nothing about the token already stored, so it must not touch the status. A failure
 * of the stored connection itself — a revoked or expired token, the shape a refresh reports as a
 * 401 — is exactly that evidence, and suppressing it would leave the dashboard claiming a
 * connection that cannot do any work. Callers state which one they hold; the audit trail records
 * every failure either way.
 */
export function twitchFailureDowngradesStatus(args: {
  currentStatus: string;
  kind: TwitchConnectionFailureKind;
}): boolean {
  if (args.kind === "existing-connection") {
    return true;
  }

  return args.currentStatus !== "connected";
}

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
