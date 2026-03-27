import { appendAuditEvent, updateAppState } from "./state";

export function getTwitchRedirectUri(): string {
  const appUrl = process.env.APP_URL || "http://localhost:3000";
  return `${appUrl.replace(/\/$/, "")}/api/integrations/twitch/callback`;
}

export function getTwitchAuthorizeUrl(): string | null {
  const clientId = process.env.TWITCH_CLIENT_ID;
  if (!clientId) {
    return null;
  }

  const scope = [
    "channel:manage:broadcast",
    "channel:manage:schedule",
    "moderator:manage:chat_settings"
  ].join(" ");

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: getTwitchRedirectUri(),
    response_type: "code",
    scope
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
    data?: Array<{ id: string }>;
  };

  const broadcasterId = userData.data?.[0]?.id;

  if (!broadcasterId) {
    throw new Error("Twitch user lookup did not return a broadcaster id.");
  }

  await updateAppState((state) => ({
    ...state,
    twitch: {
      status: "connected",
      broadcasterId,
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token ?? "",
      connectedAt: new Date().toISOString(),
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

