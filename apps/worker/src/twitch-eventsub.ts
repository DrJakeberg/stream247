import {
  TWITCH_CHANNEL_OWNER_CAPABILITY_SCOPES,
  isEngagementAlertsRuntimeEnabled,
  isEngagementChannelPointsRuntimeEnabled,
  isEngagementDonationAlertsRuntimeEnabled,
  resolveTwitchEventSubSecret
} from "@stream247/core";
import { resolveAppBaseUrl, type AppState, type ManagedConfigRecord } from "@stream247/db";

type FetchLike = typeof fetch;

type EventSubSubscriptionType =
  | "channel.follow"
  | "channel.subscribe"
  | "channel.cheer"
  | "channel.channel_points_custom_reward_redemption.add";

// Who the subscriptions are about (2.1, M69). Until 2.1 every condition used the connected account's
// own id, which in a split setup is the BOT (3JakeC on the reference install): alerts were subscribed
// on the bot's empty channel while viewers followed and subscribed on the broadcast channel.
export type EventSubTarget = {
  // The broadcast channel's user id: every event is about this channel.
  channelId: string;
  // The bot account's user id: channel.follow v2 needs a moderator, and the bot is one.
  botId: string;
  // Whether the broadcast channel itself has granted what sub, cheer and channel-points events need:
  // true with one account (the bot IS the channel) or a connected channel owner in a split.
  channelOwnerCovers: boolean;
  // The channel owner token's measured grant in a split; null when not measured or not needed. An owner
  // connected before 2.1 lacks the alert scopes, and subscribing without them fails with 403.
  channelOwnerScopes?: readonly string[] | null;
};

type EventSubSubscriptionDefinition = {
  type: EventSubSubscriptionType;
  version: string;
  condition: (target: EventSubTarget) => Record<string, string>;
  // Twitch only delivers this type for a broadcaster who granted this scope; a moderator cannot.
  ownerScope: string | null;
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
  // Types left out because the broadcast channel has not granted them (split without channel owner).
  waitingForChannelOwner?: EventSubSubscriptionType[];
  created: EventSubSubscriptionType[];
  deleted: string[];
  existing: EventSubSubscriptionType[];
};

export const REQUIRED_TWITCH_EVENTSUB_SUBSCRIPTIONS: EventSubSubscriptionDefinition[] = [
  {
    type: "channel.follow",
    version: "2",
    condition: (target) => ({
      broadcaster_user_id: target.channelId,
      moderator_user_id: target.botId
    }),
    ownerScope: null
  },
  {
    type: "channel.subscribe",
    version: "1",
    condition: (target) => ({
      broadcaster_user_id: target.channelId
    }),
    ownerScope: TWITCH_CHANNEL_OWNER_CAPABILITY_SCOPES.subAlerts
  },
  {
    type: "channel.cheer",
    version: "1",
    condition: (target) => ({
      broadcaster_user_id: target.channelId
    }),
    ownerScope: TWITCH_CHANNEL_OWNER_CAPABILITY_SCOPES.cheerAlerts
  },
  {
    type: "channel.channel_points_custom_reward_redemption.add",
    version: "1",
    condition: (target) => ({
      broadcaster_user_id: target.channelId
    }),
    ownerScope: TWITCH_CHANNEL_OWNER_CAPABILITY_SCOPES.redemptionAlerts
  }
];

// Whether the broadcast channel itself grants `scope`: covered at all (one account, or a connected owner)
// and, when the owner's grant was measured, containing the scope.
function channelOwnerGrants(target: EventSubTarget, scope: string): boolean {
  if (!target.channelOwnerCovers) {
    return false;
  }
  return !target.channelOwnerScopes || target.channelOwnerScopes.includes(scope);
}

function resolveDesiredEventSubSubscriptions(args: {
  state: AppState;
  env: Record<string, string | undefined>;
  target: EventSubTarget;
}): EventSubSubscriptionDefinition[] {
  if (!isEngagementAlertsRuntimeEnabled(args.state.engagement, args.env, args.state.managedConfig)) {
    return [];
  }

  return REQUIRED_TWITCH_EVENTSUB_SUBSCRIPTIONS.filter((definition) => {
    if (definition.ownerScope && !channelOwnerGrants(args.target, definition.ownerScope)) {
      return false;
    }
    if (definition.type === "channel.cheer") {
      return isEngagementDonationAlertsRuntimeEnabled(args.state.engagement, args.env, args.state.managedConfig);
    }
    if (definition.type === "channel.channel_points_custom_reward_redemption.add") {
      return isEngagementChannelPointsRuntimeEnabled(args.state.engagement, args.env, args.state.managedConfig);
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

export function resolveTwitchEventSubCallbackUrl(
  managedConfig: Partial<Pick<ManagedConfigRecord, "appUrl">> | undefined,
  env: Record<string, string | undefined>
): string {
  // Twitch will only deliver webhooks to a public https URL, so the wizard-managed app URL is as
  // valid a source as the env variable — env first, per the instance-config precedence.
  const appUrl = resolveAppBaseUrl(managedConfig, env);
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

/**
 * Statuses in which a subscription still delivers, or is about to.
 *
 * Twitch keeps a subscription listed after it has stopped working — `authorization_revoked` once
 * the broadcaster withdraws the grant, `notification_failures_exceeded` after our callback was
 * unreachable, `version_removed` when Twitch retires a schema. Matching on type and condition alone
 * counts those as present, so the sync neither replaces nor removes them and the channel silently
 * stops receiving events, with every health surface reporting the subscription as configured.
 *
 * `webhook_callback_verification_pending` is healthy on purpose: it resolves within seconds, and
 * treating it as dead would create a duplicate on every sync pass while verification is in flight.
 */
const HEALTHY_EVENTSUB_STATUSES = new Set(["enabled", "webhook_callback_verification_pending"]);

export function isHealthyEventSubStatus(status: string | undefined): boolean {
  // An absent status is not evidence of a dead subscription; reading it that way would delete and
  // recreate working subscriptions on every pass.
  if (!status) {
    return true;
  }
  return HEALTHY_EVENTSUB_STATUSES.has(status);
}

function subscriptionMatchesDefinition(args: {
  subscription: TwitchEventSubSubscription;
  definition: EventSubSubscriptionDefinition;
  target: EventSubTarget;
  callbackUrl: string;
}): boolean {
  if (
    args.subscription.type !== args.definition.type ||
    args.subscription.version !== args.definition.version ||
    !callbackMatches(args.subscription, args.callbackUrl)
  ) {
    return false;
  }

  const desiredCondition = args.definition.condition(args.target);
  return Object.entries(desiredCondition).every(([key, value]) => args.subscription.condition?.[key] === value);
}

/**
 * Ours: one of our types on OUR callback URL, whatever channel it is about. Until 2.1 ownership also
 * required the condition to match the current target, so a subscription for another channel -- the
 * bot's own, after the retarget -- was nobody's and stayed registered for ever, still delivering that
 * channel's events to our webhook. One install owns its callback, so the callback is the proof.
 */
function listOwnedEventSubSubscriptions(args: {
  subscriptions: TwitchEventSubSubscription[];
  callbackUrl: string;
}): TwitchEventSubSubscription[] {
  return args.subscriptions.filter(
    (subscription) =>
      callbackMatches(subscription, args.callbackUrl) &&
      REQUIRED_TWITCH_EVENTSUB_SUBSCRIPTIONS.some(
        (definition) => subscription.type === definition.type && subscription.version === definition.version
      )
  );
}

async function createEventSubSubscription(args: {
  definition: EventSubSubscriptionDefinition;
  target: EventSubTarget;
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
      condition: args.definition.condition(args.target),
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
  // Resolved by the worker from the Twitch accounts (packages/core/src/twitch-accounts.ts).
  target: EventSubTarget;
  fetchImpl?: FetchLike;
}): Promise<TwitchEventSubSyncResult> {
  const fetchImpl = args.fetchImpl ?? fetch;
  const enabled = isEngagementAlertsRuntimeEnabled(args.state.engagement, args.env, args.state.managedConfig);
  const target = args.target;
  const callbackUrl = resolveTwitchEventSubCallbackUrl(args.state.managedConfig, args.env);
  const secret = resolveTwitchEventSubSecret(args.state.managedConfig, args.env);
  const desiredSubscriptions = resolveDesiredEventSubSubscriptions(args);

  if (args.state.twitch.status !== "connected" || !target.botId.trim()) {
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

  // Only registration needs the channel's id; the cleanup above works from ownership (our callback)
  // alone, so switching alerts off still removes everything while the id cannot be resolved (M69 review).
  if (!target.channelId.trim()) {
    return emptyResult(enabled, "broadcast-channel-unresolved");
  }

  const existing: EventSubSubscriptionType[] = [];
  const created: EventSubSubscriptionType[] = [];
  const deleted: string[] = [];
  for (const subscription of ownedSubscriptions) {
    const stillDesired = desiredSubscriptions.some((definition) =>
      subscriptionMatchesDefinition({
        subscription,
        definition,
        target,
        callbackUrl
      })
    );
    // A dead subscription is removed even while still desired: it is replaced further down, and
    // leaving it in place would both keep the channel deaf and consume one of the account's
    // subscription slots forever.
    const healthy = isHealthyEventSubStatus(subscription.status);
    if ((stillDesired && healthy) || !subscription.id) {
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
    const hasExisting = ownedSubscriptions.some(
      (subscription) =>
        isHealthyEventSubStatus(subscription.status) &&
        subscriptionMatchesDefinition({
          subscription,
          definition,
          target,
          callbackUrl
        })
    );

    if (hasExisting) {
      existing.push(definition.type);
      continue;
    }

    await createEventSubSubscription({
      definition,
      target,
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
    existing,
    // Wanted (alerts and their per-type toggles on) but withheld because the broadcast channel itself has
    // not granted them. Surfaced by the worker as twitch.eventsub.waiting-for-channel-owner.
    waitingForChannelOwner: resolveDesiredEventSubSubscriptions({
      ...args,
      target: { ...target, channelOwnerCovers: true, channelOwnerScopes: null }
    })
      .filter((definition) => definition.ownerScope && !channelOwnerGrants(target, definition.ownerScope))
      .map((definition) => definition.type)
  };
}
