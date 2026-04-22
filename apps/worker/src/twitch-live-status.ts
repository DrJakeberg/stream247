type FetchLike = typeof fetch;

export type TwitchLiveStatusSnapshot = {
  liveStatus: "live" | "offline" | "unknown";
  viewerCount: number;
  startedAt: string;
};

const TWITCH_LIVE_STATUS_REQUEST_TIMEOUT_MS = 10_000;

function getRequestSignal(): AbortSignal | undefined {
  if (typeof AbortSignal === "undefined" || typeof AbortSignal.timeout !== "function") {
    return undefined;
  }

  return AbortSignal.timeout(TWITCH_LIVE_STATUS_REQUEST_TIMEOUT_MS);
}

async function createAppAccessToken(args: {
  clientId: string;
  clientSecret: string;
  fetchImpl: FetchLike;
}): Promise<string> {
  const response = await args.fetchImpl("https://id.twitch.tv/oauth2/token", {
    method: "POST",
    body: new URLSearchParams({
      client_id: args.clientId,
      client_secret: args.clientSecret,
      grant_type: "client_credentials"
    }),
    signal: getRequestSignal()
  });

  if (!response.ok) {
    throw new Error(`Twitch live-status app token request failed with status ${response.status}.`);
  }

  const payload = (await response.json()) as { access_token?: string };
  if (!payload.access_token) {
    throw new Error("Twitch live-status app token response did not include an access token.");
  }

  return payload.access_token;
}

export function parseTwitchLiveStatusPayload(payload: {
  data?: Array<{
    type?: string;
    viewer_count?: number;
    started_at?: string;
  }>;
}): TwitchLiveStatusSnapshot {
  const stream = payload.data?.find((entry) => entry.type === "live");
  if (!stream) {
    return {
      liveStatus: "offline",
      viewerCount: 0,
      startedAt: ""
    };
  }

  return {
    liveStatus: "live",
    viewerCount: Math.max(0, Number(stream.viewer_count) || 0),
    startedAt: String(stream.started_at ?? "")
  };
}

export async function fetchTwitchLiveStatus(args: {
  broadcasterId: string;
  clientId: string;
  clientSecret: string;
  fetchImpl?: FetchLike;
}): Promise<TwitchLiveStatusSnapshot> {
  const fetchImpl = args.fetchImpl ?? fetch;
  const accessToken = await createAppAccessToken({
    clientId: args.clientId,
    clientSecret: args.clientSecret,
    fetchImpl
  });
  const response = await fetchImpl(
    `https://api.twitch.tv/helix/streams?user_id=${encodeURIComponent(args.broadcasterId)}`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Client-Id": args.clientId
      },
      signal: getRequestSignal()
    }
  );

  if (!response.ok) {
    throw new Error(`Twitch live-status lookup failed with status ${response.status}.`);
  }

  const payload = (await response.json()) as {
    data?: Array<{
      type?: string;
      viewer_count?: number;
      started_at?: string;
    }>;
  };

  return parseTwitchLiveStatusPayload(payload);
}
