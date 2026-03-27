import {
  buildScheduleOccurrences,
  buildSchedulePreview,
  describePresenceStatus,
  getCurrentScheduleMoment,
  isCurrentScheduleTime
} from "@stream247/core";
import {
  appendAuditEvent,
  acknowledgeIncident,
  findTeamGrantByLogin,
  findUserByEmail,
  findUserById,
  readAppState,
  resolveIncident,
  updateAppState,
  writeAppState,
  type AppState,
  type AssetRecord,
  type AuditEvent,
  type IncidentRecord,
  type ModeratorPresenceWindowRecord,
  type OwnerAccount,
  type PlayoutRuntimeRecord,
  type ScheduleBlockRecord,
  type SourceRecord,
  type StreamDestinationRecord,
  type TeamAccessGrant,
  type TwitchConnection,
  type UserRecord,
  type UserRole,
  type OverlaySettingsRecord,
  type ManagedConfigRecord
} from "@stream247/db";

export type {
  AppState,
  AssetRecord,
  AuditEvent,
  IncidentRecord,
  ModeratorPresenceWindowRecord,
  OwnerAccount,
  PlayoutRuntimeRecord,
  OverlaySettingsRecord,
  ManagedConfigRecord,
  ScheduleBlockRecord,
  SourceRecord,
  StreamDestinationRecord,
  TeamAccessGrant,
  TwitchConnection,
  UserRecord,
  UserRole
};

export { acknowledgeIncident, appendAuditEvent, findTeamGrantByLogin, findUserByEmail, findUserById, readAppState, resolveIncident, updateAppState, writeAppState };

export function getWorkspaceTimeZone(): string {
  return process.env.CHANNEL_TIMEZONE || "UTC";
}

export function getSchedulePreview(state: AppState) {
  const scheduleMoment = getCurrentScheduleMoment({
    now: new Date(),
    timeZone: getWorkspaceTimeZone()
  });

  return buildSchedulePreview({
    date: scheduleMoment.date,
    blocks: state.scheduleBlocks
  });
}

export function getPresenceStatus(state: AppState) {
  return describePresenceStatus({
    activeWindows: state.presenceWindows.map((window) => ({
      actor: window.actor,
      minutes: window.minutes,
      createdAt: new Date(window.createdAt),
      expiresAt: new Date(window.expiresAt)
    })),
    now: new Date(),
    fallbackEmoteOnly: state.moderation.fallbackEmoteOnly
  });
}

export function getActivePresenceWindows(state: AppState): ModeratorPresenceWindowRecord[] {
  const now = new Date();
  return state.presenceWindows.filter((window) => new Date(window.expiresAt) > now);
}

export function getManagedConfigValue<K extends keyof ManagedConfigRecord>(
  state: AppState,
  key: K,
  envFallback = ""
): ManagedConfigRecord[K] {
  const value = state.managedConfig[key];
  return ((typeof value === "string" && value !== "" ? value : envFallback) as ManagedConfigRecord[K]);
}

export function getManagedTwitchConfig(state: AppState) {
  return {
    clientId: getManagedConfigValue(state, "twitchClientId", process.env.TWITCH_CLIENT_ID || ""),
    clientSecret: getManagedConfigValue(state, "twitchClientSecret", process.env.TWITCH_CLIENT_SECRET || ""),
    defaultCategoryId: getManagedConfigValue(
      state,
      "twitchDefaultCategoryId",
      process.env.TWITCH_DEFAULT_CATEGORY_ID || ""
    )
  };
}

export function getManagedAlertConfig(state: AppState) {
  return {
    discordWebhookUrl: getManagedConfigValue(state, "discordWebhookUrl", process.env.DISCORD_WEBHOOK_URL || ""),
    smtpHost: getManagedConfigValue(state, "smtpHost", process.env.SMTP_HOST || ""),
    smtpPort: getManagedConfigValue(state, "smtpPort", process.env.SMTP_PORT || ""),
    smtpUser: getManagedConfigValue(state, "smtpUser", process.env.SMTP_USER || ""),
    smtpPassword: getManagedConfigValue(state, "smtpPassword", process.env.SMTP_PASSWORD || ""),
    smtpFrom: getManagedConfigValue(state, "smtpFrom", process.env.SMTP_FROM || ""),
    alertEmailTo: getManagedConfigValue(state, "alertEmailTo", process.env.ALERT_EMAIL_TO || "")
  };
}

export function getCurrentScheduleItem(state: AppState) {
  const scheduleMoment = getCurrentScheduleMoment({
    now: new Date(),
    timeZone: getWorkspaceTimeZone()
  });
  const occurrences = buildScheduleOccurrences({
    date: scheduleMoment.date,
    blocks: state.scheduleBlocks
  });

  return (
    occurrences.find((item) =>
      isCurrentScheduleTime({
        startTime: item.startTime,
        endTime: item.endTime,
        currentTime: scheduleMoment.time
      })
    ) ?? occurrences[0] ?? null
  );
}

export function getNextScheduleItem(state: AppState) {
  const current = getCurrentScheduleItem(state);
  const scheduleMoment = getCurrentScheduleMoment({
    now: new Date(),
    timeZone: getWorkspaceTimeZone()
  });
  const occurrences = buildScheduleOccurrences({
    date: scheduleMoment.date,
    blocks: state.scheduleBlocks
  });

  if (occurrences.length === 0) {
    return null;
  }

  if (!current) {
    return occurrences[0] ?? null;
  }

  const currentIndex = occurrences.findIndex((item) => item.key === current.key);
  if (currentIndex === -1) {
    return occurrences[0] ?? null;
  }

  return occurrences[(currentIndex + 1) % occurrences.length] ?? null;
}
