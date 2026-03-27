import { appendAuditEvent, findTeamGrantByLogin, updateAppState, type UserRecord, type UserRole } from "./state";

export function getTwitchRedirectUri(): string {
  const appUrl = process.env.APP_URL || "http://localhost:3000";
  return `${appUrl.replace(/\/$/, "")}/api/integrations/twitch/callback`;
}

export function getTwitchAuthorizeUrl(kind: "broadcaster-connect" | "team-login" = "broadcaster-connect"): string | null {
  const clientId = process.env.TWITCH_CLIENT_ID;
  if (!clientId) {
    return null;
  }

  const scope =
    kind === "team-login"
      ? ["user:read:email"].join(" ")
      : ["channel:manage:broadcast", "channel:manage:schedule", "moderator:manage:chat_settings"].join(" ");

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri:
      kind === "team-login"
        ? `${(process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "")}/api/auth/twitch/callback`
        : getTwitchRedirectUri(),
    response_type: "code",
    scope,
    state: kind
  });

  return `https://id.twitch.tv/oauth2/authorize?${params.toString()}`;
}

export async function exchangeTwitchCode(code: string) {
  const clientId = process.env.TWITCH_CLIENT_ID;
  const clientSecret = process.env.TWITCH_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("Missing TWITCH_CLIENT_ID or TWITCH_CLIENT_SECRET.");
  }

  const tokenParams = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    grant_type: "authorization_code",
    redirect_uri: getTwitchRedirectUri()
  });

  const tokenResponse = await fetch("https://id.twitch.tv/oauth2/token", {
    method: "POST",
    body: tokenParams
  });

  if (!tokenResponse.ok) {
    throw new Error(`Token exchange failed with status ${tokenResponse.status}.`);
  }

  const tokenData = (await tokenResponse.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
  };

  const userResponse = await fetch("https://api.twitch.tv/helix/users", {
    headers: {
      Authorization: `Bearer ${tokenData.access_token}`,
      "Client-Id": clientId
    }
  });

  if (!userResponse.ok) {
    throw new Error(`User lookup failed with status ${userResponse.status}.`);
  }

  const userData = (await userResponse.json()) as {
    data?: Array<{ id: string; login: string }>;
  };

  const broadcasterId = userData.data?.[0]?.id;
  const broadcasterLogin = userData.data?.[0]?.login ?? "";

  if (!broadcasterId) {
    throw new Error("Twitch user lookup did not return a broadcaster id.");
  }

  await updateAppState((state) => ({
    ...state,
    twitch: {
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
      error: ""
    }
  }));

  await appendAuditEvent("twitch.connected", `Connected Twitch broadcaster ${broadcasterId}.`);
}

export async function recordTwitchError(message: string) {
  await updateAppState((state) => ({
    ...state,
    twitch: {
      ...state.twitch,
      status: "error",
      error: message
    }
  }));

  await appendAuditEvent("twitch.error", message);
}

export async function exchangeTwitchLoginCode(code: string): Promise<UserRecord> {
  const clientId = process.env.TWITCH_CLIENT_ID;
  const clientSecret = process.env.TWITCH_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("Missing TWITCH_CLIENT_ID or TWITCH_CLIENT_SECRET.");
  }

  const redirectUri = `${(process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "")}/api/auth/twitch/callback`;
  const tokenParams = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    grant_type: "authorization_code",
    redirect_uri: redirectUri
  });

  const tokenResponse = await fetch("https://id.twitch.tv/oauth2/token", {
    method: "POST",
    body: tokenParams
  });

  if (!tokenResponse.ok) {
    throw new Error(`Twitch team login token exchange failed with status ${tokenResponse.status}.`);
  }

  const tokenData = (await tokenResponse.json()) as {
    access_token: string;
  };

  const userResponse = await fetch("https://api.twitch.tv/helix/users", {
    headers: {
      Authorization: `Bearer ${tokenData.access_token}`,
      "Client-Id": clientId
    }
  });

  if (!userResponse.ok) {
    throw new Error(`Twitch team login user lookup failed with status ${userResponse.status}.`);
  }

  const userData = (await userResponse.json()) as {
    data?: Array<{ id: string; login: string; display_name: string; email?: string }>;
  };

  const twitchUser = userData.data?.[0];
  if (!twitchUser) {
    throw new Error("Twitch login did not return a user profile.");
  }

  let authenticatedUser: UserRecord | null = null;
  await updateAppState((state) => {
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

    return {
      ...state,
      users: existing
        ? state.users.map((user) => (user.id === existing.id ? nextUser : user))
        : [nextUser, ...state.users]
    };
  });

  await appendAuditEvent("auth.twitch", `Twitch SSO login succeeded for ${twitchUser.login}.`);
  if (!authenticatedUser) {
    throw new Error("Could not persist Twitch SSO user.");
  }

  return authenticatedUser;
}
