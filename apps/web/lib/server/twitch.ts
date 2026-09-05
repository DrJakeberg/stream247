import {
  TWITCH_BROADCASTER_SLOT_SCOPES,
  TWITCH_IDENTITY_SCOPES,
  evaluateBroadcasterConnectLogin,
  twitchFailureDowngradesStatus,
  type TwitchConnectionFailureKind
} from "@stream247/core";
import { resolveAppBaseUrl } from "@stream247/db";
import { issueOAuthState, type OAuthFlowKind } from "./oauth-state";
import {
  appendAuditEvent,
  findTeamGrantByLogin,
  getManagedTwitchConfig,
  readAppState,
  updateTwitchBroadcasterConnectionRecord,
  updateTwitchConnectionRecord,
  upsertUserRecord,
  type AppState,
  type UserRecord,
  type UserRole
} from "./state";

type StateWithManagedConfig = Pick<AppState, "managedConfig">;

export function getTwitchRedirectUri(state: StateWithManagedConfig): string {
  return getAbsoluteAppUrl(state, "/api/integrations/twitch/callback");
}

/**
 * The broadcaster slot has its own callback URL. Sharing the identity callback would mean one
 * route deciding which slot to store into from request data an attacker can shape; two routes
 * with two state cookies keep the flows apart end to end.
 */
export function getTwitchBroadcasterRedirectUri(state: StateWithManagedConfig): string {
  return getAbsoluteAppUrl(state, "/api/integrations/twitch/callback-broadcaster");
}

export function getAppBaseUrl(state: StateWithManagedConfig): string {
  // The localhost default keeps unconfigured local installs working; the resolver decides between
  // env and the wizard-written managed value, in that order.
  return resolveAppBaseUrl(state.managedConfig) || "http://localhost:3000";
}

export function getAbsoluteAppUrl(state: StateWithManagedConfig, pathname: string): string {
  return `${getAppBaseUrl(state)}${pathname.startsWith("/") ? pathname : `/${pathname}`}`;
}

/**
 * Whether a Twitch sign-in link is worth showing at all.
 *
 * Separate from getTwitchAuthorizeUrl because building that URL mints a single-use state and writes
 * it to a cookie, and Next.js forbids setting cookies while rendering a page. A Server Component
 * that merely wants to decide whether to show the button must not take that path — it returned a
 * 500 on /login for every workspace that had Twitch configured, while every workspace without it
 * (including the test stack) returned early and looked fine.
 */
export async function isTwitchAuthorizeConfigured(): Promise<boolean> {
  const state = await readAppState();
  return Boolean(getManagedTwitchConfig(state).clientId);
}

/**
 * Builds the authorize URL and issues the state cookie that binds it.
 *
 * Callable only from Route Handlers and Server Actions: it writes a cookie. Pages link to a route
 * that calls this, which also means the state is minted when the user clicks rather than when the
 * page was rendered.
 */
export async function getTwitchAuthorizeUrl(kind: OAuthFlowKind = "broadcaster-connect"): Promise<string | null> {
  const state = await readAppState();
  const clientId = getManagedTwitchConfig(state).clientId;
  if (!clientId) {
    return null;
  }

  // Per-flow scope and callback. The broadcaster slot asks for the two metadata scopes and
  // nothing else — it exists to write title, category and schedule, and a narrow grant is easier
  // to hand to the broadcast channel's owner than a second all-powerful one.
  const scope =
    kind === "team-login"
      ? ["user:read:email"].join(" ")
      : kind === "broadcast-channel-connect"
        ? TWITCH_BROADCASTER_SLOT_SCOPES.join(" ")
        : // The same constant the heal path measures a stored token against, so "reconnect to fix
          // this" and "the token in hand is already good enough" can never disagree.
          TWITCH_IDENTITY_SCOPES.join(" ");
  const redirectUri =
    kind === "team-login"
      ? getAbsoluteAppUrl(state, "/api/auth/twitch/callback")
      : kind === "broadcast-channel-connect"
        ? getTwitchBroadcasterRedirectUri(state)
        : getTwitchRedirectUri(state);

  // A random, single-use, cookie-bound state. Previously this was the literal flow name, which no
  // callback ever verified — see lib/server/oauth-state.ts for what that allowed.
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope,
    state: await issueOAuthState(kind)
  });

  return `https://id.twitch.tv/oauth2/authorize?${params.toString()}`;
}

type TwitchCodeExchangeResult = {
  tokenData: { access_token: string; refresh_token?: string; expires_in?: number };
  twitchUser: { id: string; login: string; display_name: string; email?: string };
};

/**
 * Authorization-code exchange plus the /helix/users lookup for who was actually authorised.
 *
 * Shared by all three flows (identity connect, broadcaster-slot connect, team login) because the
 * HTTP mechanics are identical; what differs — redirect URI, which slot the result may be stored
 * in, and what "the right account" means — stays in the callers. `errorLabel` keeps each flow's
 * failure messages distinguishable in the audit log.
 */
async function exchangeTwitchCodeForUser(args: {
  code: string;
  redirectUri: string;
  clientId: string;
  clientSecret: string;
  errorLabel: string;
}): Promise<TwitchCodeExchangeResult> {
  const tokenParams = new URLSearchParams({
    client_id: args.clientId,
    client_secret: args.clientSecret,
    code: args.code,
    grant_type: "authorization_code",
    redirect_uri: args.redirectUri
  });

  const tokenResponse = await fetch("https://id.twitch.tv/oauth2/token", {
    method: "POST",
    body: tokenParams
  });

  if (!tokenResponse.ok) {
    throw new Error(`${args.errorLabel} token exchange failed with status ${tokenResponse.status}.`);
  }

  const tokenData = (await tokenResponse.json()) as TwitchCodeExchangeResult["tokenData"];

  const userResponse = await fetch("https://api.twitch.tv/helix/users", {
    headers: {
      Authorization: `Bearer ${tokenData.access_token}`,
      "Client-Id": args.clientId
    }
  });

  if (!userResponse.ok) {
    throw new Error(`${args.errorLabel} user lookup failed with status ${userResponse.status}.`);
  }

  const userData = (await userResponse.json()) as {
    data?: Array<TwitchCodeExchangeResult["twitchUser"]>;
  };

  const twitchUser = userData.data?.[0];
  if (!twitchUser?.id) {
    throw new Error(`${args.errorLabel} user lookup did not return a Twitch user.`);
  }

  return { tokenData, twitchUser };
}

export async function exchangeTwitchCode(code: string) {
  const state = await readAppState();
  const { clientId, clientSecret } = getManagedTwitchConfig(state);

  if (!clientId || !clientSecret) {
    throw new Error("Missing TWITCH_CLIENT_ID or TWITCH_CLIENT_SECRET.");
  }

  const { tokenData, twitchUser } = await exchangeTwitchCodeForUser({
    code,
    redirectUri: getTwitchRedirectUri(state),
    clientId,
    clientSecret,
    errorLabel: "Twitch connect"
  });

  const broadcasterId = twitchUser.id;
  const broadcasterLogin = twitchUser.login;

  await updateTwitchConnectionRecord({
    status: "connected",
    broadcasterId,
    broadcasterLogin,
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token ?? "",
    connectedAt: new Date().toISOString(),
    tokenExpiresAt: tokenData.expires_in ? new Date(Date.now() + tokenData.expires_in * 1000).toISOString() : "",
    lastRefreshAt: "",
    lastMetadataSyncAt: "",
    lastSyncedTitle: "",
    lastSyncedCategoryName: "",
    lastSyncedCategoryId: "",
    lastScheduleSyncAt: "",
    liveStatus: "unknown",
    viewerCount: 0,
    startedAt: "",
    error: ""
  });

  await appendAuditEvent("twitch.connected", `Connected Twitch broadcaster ${broadcasterId}.`);
}

/**
 * Failure bookkeeping for the identity connection.
 *
 * The `kind` is the whole decision — see twitchFailureDowngradesStatus for why. It defaults to
 * the connect-attempt reading because every caller today is an OAuth callback: a flow that
 * failed before it produced anything, which is no evidence about the token already stored. A
 * caller that does hold that evidence — a refresh that came back 401, a grant the operator
 * revoked — passes "existing-connection" and still takes the connection down. The audit trail
 * records the failure either way, so nothing goes missing when the status is left alone.
 */
export async function recordTwitchError(message: string, kind: TwitchConnectionFailureKind = "connect-attempt") {
  const state = await readAppState();

  if (twitchFailureDowngradesStatus({ currentStatus: state.twitch.status, kind })) {
    await updateTwitchConnectionRecord({
      ...state.twitch,
      status: "error",
      error: message
    });
  }

  await appendAuditEvent("twitch.error", message);
}

/**
 * Completes the broadcaster-slot OAuth: exchange the code, verify the authorised account owns the
 * configured broadcast channel, and only then fill the slot. The verification runs before any
 * write on purpose — the identity callback stores whoever shows up, and reusing that behaviour
 * here would let a stray identity sign-in overwrite the broadcaster slot with a token the sync
 * gate must never use.
 */
export async function exchangeTwitchBroadcasterCode(code: string) {
  const state = await readAppState();
  const { clientId, clientSecret, broadcastChannelLogin } = getManagedTwitchConfig(state);

  if (!clientId || !clientSecret) {
    throw new Error("Missing TWITCH_CLIENT_ID or TWITCH_CLIENT_SECRET.");
  }

  const { tokenData, twitchUser } = await exchangeTwitchCodeForUser({
    code,
    redirectUri: getTwitchBroadcasterRedirectUri(state),
    clientId,
    clientSecret,
    errorLabel: "Twitch broadcaster connect"
  });

  const verdict = evaluateBroadcasterConnectLogin({
    configuredLogin: broadcastChannelLogin,
    identityLogin: state.twitch.broadcasterLogin,
    authenticatedLogin: twitchUser.login
  });

  if (!verdict.ok) {
    throw new Error(verdict.message);
  }

  await updateTwitchBroadcasterConnectionRecord({
    status: "connected",
    broadcasterId: twitchUser.id,
    broadcasterLogin: twitchUser.login,
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token ?? "",
    connectedAt: new Date().toISOString(),
    tokenExpiresAt: tokenData.expires_in ? new Date(Date.now() + tokenData.expires_in * 1000).toISOString() : "",
    lastRefreshAt: "",
    error: ""
  });

  await appendAuditEvent(
    "twitch.broadcaster.connected",
    `Connected broadcast channel ${verdict.broadcastChannelLogin} as broadcaster ${twitchUser.id}.`
  );
}

/**
 * Failure bookkeeping for the broadcaster slot. Every caller is a rejected connect attempt
 * (wrong account, cancelled consent, forged state), which must not flip a working broadcaster
 * connection into an error and silently stop metadata sync. The rule itself now lives beside the
 * identity's — the two slots were drifting apart, and only one of them had the guard.
 */
export async function recordTwitchBroadcasterError(message: string) {
  const state = await readAppState();

  if (twitchFailureDowngradesStatus({ currentStatus: state.twitchBroadcaster.status, kind: "connect-attempt" })) {
    await updateTwitchBroadcasterConnectionRecord({
      ...state.twitchBroadcaster,
      status: "error",
      error: message
    });
  }

  await appendAuditEvent("twitch.broadcaster.error", message);
}

export async function exchangeTwitchLoginCode(code: string): Promise<UserRecord> {
  const state = await readAppState();
  const { clientId, clientSecret } = getManagedTwitchConfig(state);

  if (!clientId || !clientSecret) {
    throw new Error("Missing TWITCH_CLIENT_ID or TWITCH_CLIENT_SECRET.");
  }

  const { twitchUser } = await exchangeTwitchCodeForUser({
    code,
    redirectUri: getAbsoluteAppUrl(state, "/api/auth/twitch/callback"),
    clientId,
    clientSecret,
    errorLabel: "Twitch team login"
  });

  let authenticatedUser: UserRecord | null = null;
  const grant = findTeamGrantByLogin(state, twitchUser.login);
  const isBroadcasterOwner =
    state.twitch.broadcasterId !== "" && state.twitch.broadcasterId === twitchUser.id;

  if (!grant && !isBroadcasterOwner) {
    throw new Error(`Twitch user ${twitchUser.login} is not authorized for this workspace.`);
  }

  const role: UserRole = isBroadcasterOwner ? "owner" : grant?.role ?? "viewer";
  const existing = state.users.find((user) => user.twitchUserId === twitchUser.id);

  const nextUser: UserRecord = existing
    ? {
        ...existing,
        displayName: twitchUser.display_name,
        email: twitchUser.email ?? existing.email,
        role,
        twitchLogin: twitchUser.login,
        lastLoginAt: new Date().toISOString()
      }
    : {
        id: `user_${Math.random().toString(36).slice(2, 10)}`,
        email: twitchUser.email ?? `${twitchUser.login}@twitch.local`,
        displayName: twitchUser.display_name,
        authProvider: "twitch",
        role,
        twitchUserId: twitchUser.id,
        twitchLogin: twitchUser.login,
        createdAt: new Date().toISOString(),
        lastLoginAt: new Date().toISOString()
      };

  authenticatedUser = nextUser;
  await upsertUserRecord(nextUser);

  await appendAuditEvent("auth.twitch", `Twitch SSO login succeeded for ${twitchUser.login}.`);
  if (!authenticatedUser) {
    throw new Error("Could not persist Twitch SSO user.");
  }

  return authenticatedUser;
}
