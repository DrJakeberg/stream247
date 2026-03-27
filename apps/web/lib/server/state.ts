import { promises as fs } from "node:fs";
import path from "node:path";
import { buildSchedulePreview, createDefaultModerationConfig, describePresenceStatus } from "@stream247/core";

export type OwnerAccount = {
  email: string;
  passwordHash: string;
  createdAt: string;
};

export type TwitchConnection = {
  status: "not-connected" | "connected" | "error";
  broadcasterId: string;
  accessToken: string;
  refreshToken: string;
  connectedAt: string;
  error: string;
};

export type ModeratorPresenceWindowRecord = {
  actor: string;
  minutes: number;
  createdAt: string;
  expiresAt: string;
};

export type AuditEvent = {
  id: string;
  type: string;
  message: string;
  createdAt: string;
};

export type SourceRecord = {
  id: string;
  name: string;
  type: string;
  status: string;
};

export type ScheduleBlockRecord = {
  id: string;
  title: string;
  categoryName: string;
  startHour: number;
  durationMinutes: number;
  sourceName: string;
};

export type AppState = {
  initialized: boolean;
  owner: OwnerAccount | null;
  moderation: ReturnType<typeof createDefaultModerationConfig>;
  presenceWindows: ModeratorPresenceWindowRecord[];
  twitch: TwitchConnection;
  scheduleBlocks: ScheduleBlockRecord[];
  sources: SourceRecord[];
  auditEvents: AuditEvent[];
};

const stateDir = path.join(process.cwd(), "data", "app");
const statePath = path.join(stateDir, "state.json");

function defaultState(): AppState {
  return {
    initialized: false,
    owner: null,
    moderation: createDefaultModerationConfig(),
    presenceWindows: [],
    twitch: {
      status: "not-connected",
      broadcasterId: "",
      accessToken: "",
      refreshToken: "",
      connectedAt: "",
      error: ""
    },
    scheduleBlocks: [
      {
        id: "morning-vods",
        title: "Morning Twitch VOD Rotation",
        categoryName: "Just Chatting",
        startHour: 6,
        durationMinutes: 240,
        sourceName: "Twitch Archive"
      },
      {
        id: "playlist-prime",
        title: "Prime Time YouTube Playlist",
        categoryName: "Music",
        startHour: 18,
        durationMinutes: 360,
        sourceName: "YouTube Playlist"
      }
    ],
    sources: [
      { id: "source-youtube", name: "YouTube Playlist", type: "Managed ingestion", status: "Ready" },
      { id: "source-twitch", name: "Twitch Archive", type: "Twitch VOD sync", status: "Ready" },
      { id: "source-fallback", name: "Fallback Slate", type: "Local media", status: "Standby" }
    ],
    auditEvents: []
  };
}

async function ensureStateFile(): Promise<void> {
  await fs.mkdir(stateDir, { recursive: true });

  try {
    await fs.access(statePath);
  } catch {
    await fs.writeFile(statePath, JSON.stringify(defaultState(), null, 2), "utf8");
  }
}

export async function readAppState(): Promise<AppState> {
  await ensureStateFile();
  const raw = await fs.readFile(statePath, "utf8");
  return JSON.parse(raw) as AppState;
}

export async function writeAppState(state: AppState): Promise<void> {
  await ensureStateFile();
  await fs.writeFile(statePath, JSON.stringify(state, null, 2), "utf8");
}

export async function updateAppState(updater: (state: AppState) => AppState | Promise<AppState>): Promise<AppState> {
  const current = await readAppState();
  const next = await updater(current);
  await writeAppState(next);
  return next;
}

export async function appendAuditEvent(type: string, message: string): Promise<void> {
  await updateAppState((state) => ({
    ...state,
    auditEvents: [
      {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        type,
        message,
        createdAt: new Date().toISOString()
      },
      ...state.auditEvents
    ].slice(0, 50)
  }));
}

export function getSchedulePreview(state: AppState) {
  return buildSchedulePreview({
    date: new Date().toISOString().slice(0, 10),
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

