import { buildSchedulePreview, describePresenceStatus, getCurrentScheduleMoment } from "@stream247/core";
import {
  appendAuditEvent,
  findTeamGrantByLogin,
  findUserByEmail,
  findUserById,
  readAppState,
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
  type UserRole
} from "@stream247/db";

export type {
  AppState,
  AssetRecord,
  AuditEvent,
  IncidentRecord,
  ModeratorPresenceWindowRecord,
  OwnerAccount,
  PlayoutRuntimeRecord,
  ScheduleBlockRecord,
  SourceRecord,
  StreamDestinationRecord,
  TeamAccessGrant,
  TwitchConnection,
  UserRecord,
  UserRole
};

export { appendAuditEvent, findTeamGrantByLogin, findUserByEmail, findUserById, readAppState, updateAppState, writeAppState };

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
