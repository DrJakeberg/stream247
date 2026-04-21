import {
  isEngagementAlertsRuntimeEnabled,
  isEngagementChannelPointsRuntimeEnabled,
  isEngagementDonationAlertsRuntimeEnabled
} from "@stream247/core";
import type { AppState } from "@stream247/db";

type FetchLike = typeof fetch;

type EventSubSubscriptionType =
  | "channel.follow"
  | "channel.subscribe"
  | "channel.cheer"
  | "channel.channel_points_custom_reward_redemption.add";

type EventSubSubscriptionDefinition = {
  type: EventSubSubscriptionType;
  version: string;
  condition: (broadcasterId: string) => Record<string, string>;
};

type TwitchEventSubSubscription = {
  id?: string;
  type?: string;
  version?: string;
  status?: string;
  condition?: Record<string, string | undefined>;
  transport?: {
    method?: string;
    callback?: string;
  };
};

export type TwitchEventSubSyncResult = {
  status: "registered" | "cleaned-up" | "skipped";
  enabled: boolean;
  reason?: string;
  created: EventSubSubscriptionType[];
  deleted: string[];
  existing: EventSubSubscriptionType[];
};

export const REQUIRED_TWITCH_EVENTSUB_SUBSCRIPTIONS: EventSubSubscriptionDefinition[] = [
  {
    type: "channel.follow",
    version: "2",
    condition: (broadcasterId) => ({
      broadcaster_user_id: broadcasterId,
      moderator_user_id: broadcasterId
    })
  },
  {
    type: "channel.subscribe",
    version: "1",
    condition: (broadcasterId) => ({
      broadcaster_user_id: broadcasterId
    })
  },
  {
    type: "channel.cheer",
    version: "1",
    condition: (broadcasterId) => ({
      broadcaster_user_id: broadcasterId
    })
  },
  {
    type: "channel.channel_points_custom_reward_redemption.add",
    version: "1",
    condition: (broadcasterId) => ({
      broadcaster_user_id: broadcasterId
    })
  }
];

function resolveDesiredEventSubSubscriptions(args: {
  state: AppState;
  env: Record<string, string | undefined>;
}): EventSubSubscriptionDefinition[] {
  if (!isEngagementAlertsRuntimeEnabled(args.state.engagement, args.env)) {
    return [];
  }

  return REQUIRED_TWITCH_EVENTSUB_SUBSCRIPTIONS.filter((definition) => {
    if (definition.type === "channel.cheer") {
      return isEngagementDonationAlertsRuntimeEnabled(args.state.engagement, args.env);
    }
    if (definition.type === "channel.channel_points_custom_reward_redemption.add") {
      return isEngagementChannelPointsRuntimeEnabled(args.state.engagement, args.env);
    }
    return true;
  });
}

function emptyResult(enabled: boolean, reason: string): TwitchEventSubSyncResult {
  return {
    status: "skipped",
    enabled,
    reason,
    created: [],
    deleted: [],
    existing: []
  };
}

export function resolveTwitchEventSubCallbackUrl(env: Record<string, string | undefined>): string {
  const appUrl = (env.APP_URL || "").trim().replace(/\/$/, "");
  if (!appUrl || !appUrl.startsWith("https://")) {
    return "";
  }

  return `${appUrl}/api/overlay/events`;
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
    })
  });

  if (!response.ok) {
    throw new Error(`Twitch EventSub app token request failed with status ${response.status}.`);
  }

  const payload = (await response.json()) as { access_token?: string };
  if (!payload.access_token) {
    throw new Error("Twitch EventSub app token response did not include an access token.");
  }

  return payload.access_token;
}

async function listEventSubSubscriptions(args: {
  accessToken: string;
  clientId: string;
  fetchImpl: FetchLike;
}): Promise<TwitchEventSubSubscription[]> {
  const subscriptions: TwitchEventSubSubscription[] = [];
  let cursor = "";

  for (let page = 0; page < 10; page += 1) {
    const url = new URL("https://api.twitch.tv/helix/eventsub/subscriptions");
    if (cursor) {
      url.searchParams.set("after", cursor);
    }

    const response = await args.fetchImpl(url.toString(), {
      headers: {
        Authorization: `Bearer ${args.accessToken}`,
        "Client-Id": args.clientId
      }
    });

    if (!response.ok) {
      throw new Error(`Twitch EventSub subscription lookup failed with status ${response.status}.`);
    }

    const payload = (await response.json()) as {
      data?: TwitchEventSubSubscription[];
      pagination?: {
        cursor?: string;
      };
    };
    subscriptions.push(...(payload.data ?? []));
    cursor = payload.pagination?.cursor ?? "";
    if (!cursor) {
      break;
    }
  }

  return subscriptions;
}

function callbackMatches(subscription: TwitchEventSubSubscription, callbackUrl: string): boolean {
  return (
    subscription.transport?.method === "webhook" &&
    (subscription.transport.callback || "").replace(/\/$/, "") === callbackUrl.replace(/\/$/, "")
  );
}

function subscriptionMatchesDefinition(args: {
  subscription: TwitchEventSubSubscription;
  definition: EventSubSubscriptionDefinition;
  broadcasterId: string;
  callbackUrl: string;
}): boolean {
  if (
    args.subscription.type !== args.definition.type ||
    args.subscription.version !== args.definition.version ||
    !callbackMatches(args.subscription, args.callbackUrl)
  ) {
    return false;
  }

  const desiredCondition = args.definition.condition(args.broadcasterId);
  return Object.entries(desiredCondition).every(([key, value]) => args.subscription.condition?.[key] === value);
}

function listOwnedEventSubSubscriptions(args: {
  subscriptions: TwitchEventSubSubscription[];
  broadcasterId: string;
  callbackUrl: string;
}): TwitchEventSubSubscription[] {
  return args.subscriptions.filter((subscription) =>
    REQUIRED_TWITCH_EVENTSUB_SUBSCRIPTIONS.some((definition) =>
      subscriptionMatchesDefinition({
        subscription,
        definition,
        broadcasterId: args.broadcasterId,
        callbackUrl: args.callbackUrl
      })
    )
  );
}

async function createEventSubSubscription(args: {
  definition: EventSubSubscriptionDefinition;
  broadcasterId: string;
  callbackUrl: string;
  secret: string;
  accessToken: string;
  clientId: string;
  fetchImpl: FetchLike;
}): Promise<void> {
  const response = await args.fetchImpl("https://api.twitch.tv/helix/eventsub/subscriptions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${args.accessToken}`,
      "Client-Id": args.clientId,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      type: args.definition.type,
      version: args.definition.version,
      condition: args.definition.condition(args.broadcasterId),
      transport: {
        method: "webhook",
        callback: args.callbackUrl,
        secret: args.secret
      }
    })
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `Twitch EventSub ${args.definition.type} subscription create failed with status ${response.status}${detail ? `: ${detail}` : ""}.`
    );
  }
}

async function deleteEventSubSubscription(args: {
  id: string;
  accessToken: string;
  clientId: string;
  fetchImpl: FetchLike;
}): Promise<void> {
  const url = new URL("https://api.twitch.tv/helix/eventsub/subscriptions");
  url.searchParams.set("id", args.id);
  const response = await args.fetchImpl(url.toString(), {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${args.accessToken}`,
      "Client-Id": args.clientId
    }
  });

  if (!response.ok && response.status !== 404) {
    throw new Error(`Twitch EventSub subscription delete failed with status ${response.status}.`);
  }
}

export async function syncTwitchEventSubSubscriptions(args: {
  state: AppState;
  env: Record<string, string | undefined>;
  clientId: string;
  clientSecret: string;
  fetchImpl?: FetchLike;
}): Promise<TwitchEventSubSyncResult> {
  const fetchImpl = args.fetchImpl ?? fetch;
  const enabled = isEngagementAlertsRuntimeEnabled(args.state.engagement, args.env);
  const broadcasterId = args.state.twitch.broadcasterId.trim();
  const callbackUrl = resolveTwitchEventSubCallbackUrl(args.env);
  const secret = (args.env.TWITCH_EVENTSUB_SECRET || "").trim();
  const desiredSubscriptions = resolveDesiredEventSubSubscriptions(args);

  if (args.state.twitch.status !== "connected" || !broadcasterId) {
    return emptyResult(enabled, "twitch-not-connected");
  }

  if (!args.clientId || !args.clientSecret) {
    return emptyResult(enabled, "missing-twitch-client-credentials");
  }

  if (!callbackUrl) {
    return emptyResult(enabled, "missing-public-https-app-url");
  }

  if (enabled && !secret) {
    return emptyResult(enabled, "missing-eventsub-secret");
  }

  const accessToken = await createAppAccessToken({
    clientId: args.clientId,
    clientSecret: args.clientSecret,
    fetchImpl
  });
  const subscriptions = await listEventSubSubscriptions({
    accessToken,
    clientId: args.clientId,
    fetchImpl
  });
  const ownedSubscriptions = listOwnedEventSubSubscriptions({
    subscriptions,
    broadcasterId,
    callbackUrl
  });

  if (!enabled) {
    const deleted: string[] = [];
    for (const subscription of ownedSubscriptions) {
      if (!subscription.id) {
        continue;
      }
      await deleteEventSubSubscription({
        id: subscription.id,
        accessToken,
        clientId: args.clientId,
        fetchImpl
      });
      deleted.push(subscription.id);
    }

    return {
      status: "cleaned-up",
      enabled,
      created: [],
      deleted,
      existing: []
    };
  }

  const existing: EventSubSubscriptionType[] = [];
  const created: EventSubSubscriptionType[] = [];
  const deleted: string[] = [];
  for (const subscription of ownedSubscriptions) {
    const stillDesired = desiredSubscriptions.some((definition) =>
      subscriptionMatchesDefinition({
        subscription,
        definition,
        broadcasterId,
        callbackUrl
      })
    );
    if (stillDesired || !subscription.id) {
      continue;
    }
    await deleteEventSubSubscription({
      id: subscription.id,
      accessToken,
      clientId: args.clientId,
      fetchImpl
    });
    deleted.push(subscription.id);
  }

  for (const definition of desiredSubscriptions) {
    const hasExisting = ownedSubscriptions.some((subscription) =>
      subscriptionMatchesDefinition({
        subscription,
        definition,
        broadcasterId,
        callbackUrl
      })
    );

    if (hasExisting) {
      existing.push(definition.type);
      continue;
    }

    await createEventSubSubscription({
      definition,
      broadcasterId,
      callbackUrl,
      secret,
      accessToken,
      clientId: args.clientId,
      fetchImpl
    });
    created.push(definition.type);
  }

  return {
    status: "registered",
    enabled,
    created,
    deleted,
    existing
  };
}
