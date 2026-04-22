import tls from "node:tls";
import { randomUUID } from "node:crypto";
import {
  createDefaultModerationConfig,
  formatPresenceClampReply,
  isEngagementChatRuntimeEnabled,
  resolveModeratorCheckIn
} from "@stream247/core";
import type { AppState, EngagementEventRecord } from "@stream247/db";
import { appendEngagementEventRecord } from "@stream247/db";

export type TwitchChatMessage = {
  id: string;
  actor: string;
  message: string;
  isModerator: boolean;
};

type ModeratorPresenceWindow = NonNullable<ReturnType<typeof resolveModeratorCheckIn>>;

type TwitchChatBridgeOptions = {
  onModeratorPresenceCheckIn?: (window: ModeratorPresenceWindow) => Promise<void> | void;
  onChatMessage?: (message: TwitchChatMessage & { createdAt: string }) => Promise<void> | void;
};

export function createRingBuffer<T>(capacity: number) {
  const max = Math.max(1, Math.round(capacity));
  const entries: T[] = [];

  return {
    push(entry: T) {
      entries.push(entry);
      while (entries.length > max) {
        entries.shift();
      }
    },
    values() {
      return [...entries];
    },
    clear() {
      entries.splice(0, entries.length);
    }
  };
}

export function parseTwitchIrcMessage(line: string): TwitchChatMessage | null {
  const match = line.match(/^@(?<tags>[^ ]+) :(?<source>[^ ]+) PRIVMSG #[^ ]+ :(?<message>.*)$/);
  if (!match?.groups) {
    return null;
  }

  const tags = Object.fromEntries(
    match.groups.tags.split(";").map((entry) => {
      const [key, ...value] = entry.split("=");
      return [key, value.join("=")];
    })
  );
  const actor = (tags["display-name"] || "").replace(/\\s/g, " ").trim() || match.groups.source.split("!")[0] || "Viewer";
  const message = match.groups.message.trim();
  const badges = String(tags.badges || "");
  const isModerator =
    tags.mod === "1" ||
    badges.split(",").some((badge) => badge.startsWith("broadcaster/") || badge.startsWith("moderator/"));
  if (!message) {
    return null;
  }

  return {
    id: tags.id || `chat-${randomUUID()}`,
    actor,
    message,
    isModerator
  };
}

export function parseModeratorPresenceWindowFromChatMessage(args: {
  chatMessage: TwitchChatMessage;
  now: Date;
  config: AppState["moderation"];
}): ModeratorPresenceWindow | null {
  if (!args.chatMessage.isModerator) {
    return null;
  }

  return resolveModeratorCheckIn({
    actor: args.chatMessage.actor,
    input: args.chatMessage.message,
    now: args.now,
    config: args.config
  });
}

export function createChatRateLimiter(limitPerMinute: number) {
  const max = Math.max(1, Math.round(limitPerMinute));
  const timestamps: number[] = [];

  return {
    allow(now = Date.now()) {
      const windowStart = now - 60_000;
      while (timestamps[0] !== undefined && timestamps[0] < windowStart) {
        timestamps.shift();
      }
      if (timestamps.length >= max) {
        return false;
      }
      timestamps.push(now);
      return true;
    },
    reset() {
      timestamps.splice(0, timestamps.length);
    }
  };
}

async function appendChatStatus(status: "connected" | "disconnected", message: string): Promise<void> {
  await appendEngagementEventRecord({
    id: `chat-status-${status}`,
    kind: "status",
    actor: "chat",
    message,
    createdAt: new Date().toISOString()
  });
}

export class TwitchChatBridge {
  private socket: tls.TLSSocket | null = null;
  private channel = "";
  private buffer = "";
  private readonly messages = createRingBuffer<EngagementEventRecord>(50);
  private limiter = createChatRateLimiter(30);
  private moderationConfig: AppState["moderation"] = createDefaultModerationConfig();
  private readonly onModeratorPresenceCheckIn?: TwitchChatBridgeOptions["onModeratorPresenceCheckIn"];
  private readonly onChatMessage?: TwitchChatBridgeOptions["onChatMessage"];

  constructor(options: TwitchChatBridgeOptions = {}) {
    this.onModeratorPresenceCheckIn = options.onModeratorPresenceCheckIn;
    this.onChatMessage = options.onChatMessage;
  }

  getRecentMessages(): EngagementEventRecord[] {
    return this.messages.values();
  }

  async sync(state: AppState, env: NodeJS.ProcessEnv): Promise<void> {
    const enabled = isEngagementChatRuntimeEnabled(state.engagement, env);
    const channel = state.twitch.broadcasterLogin.toLowerCase();
    const accessToken = state.twitch.accessToken;
    this.moderationConfig = state.moderation;
    if (!enabled || !channel || !accessToken) {
      await this.disconnect("disabled");
      return;
    }

    if (this.socket && this.channel === channel && !this.socket.destroyed) {
      return;
    }

    await this.disconnect("reconnecting");
    this.channel = channel;
    this.limiter = createChatRateLimiter(state.engagement.rateLimitPerMinute);
    this.socket = tls.connect({ host: "irc.chat.twitch.tv", port: 6697, servername: "irc.chat.twitch.tv" }, () => {
      this.socket?.write("CAP REQ :twitch.tv/tags twitch.tv/commands\r\n");
      this.socket?.write(`PASS oauth:${accessToken.replace(/^oauth:/, "")}\r\n`);
      this.socket?.write(`NICK ${channel}\r\n`);
      this.socket?.write(`JOIN #${channel}\r\n`);
      void appendChatStatus("connected", "connected");
    });

    this.socket.setEncoding("utf8");
    this.socket.on("data", (chunk) => {
      this.handleChunk(String(chunk));
    });
    this.socket.on("error", () => {
      void appendChatStatus("disconnected", "disconnected");
    });
    this.socket.on("close", () => {
      void appendChatStatus("disconnected", "disconnected");
    });
  }

  async disconnect(reason: string): Promise<void> {
    if (this.socket && !this.socket.destroyed) {
      this.socket.end();
      this.socket.destroy();
    }
    this.socket = null;
    this.channel = "";
    this.buffer = "";
    this.messages.clear();
    if (reason === "disabled") {
      await appendChatStatus("disconnected", "disabled");
    }
  }

  private sendChatMessage(message: string): void {
    if (!this.socket || this.socket.destroyed || !this.channel) {
      return;
    }

    this.socket.write(`PRIVMSG #${this.channel} :${message}\r\n`);
  }

  private handleChunk(chunk: string): void {
    this.buffer += chunk;
    const lines = this.buffer.split(/\r?\n/);
    this.buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (line.startsWith("PING ")) {
        this.socket?.write(line.replace("PING", "PONG") + "\r\n");
        continue;
      }

      const message = parseTwitchIrcMessage(line);
      if (!message) {
        continue;
      }

      const now = new Date();
      const presenceWindow = parseModeratorPresenceWindowFromChatMessage({
        chatMessage: message,
        now,
        config: this.moderationConfig
      });
      if (presenceWindow) {
        this.sendChatMessage(
          formatPresenceClampReply({
            commandInput: message.message,
            requestedMinutes: presenceWindow.requestedMinutes,
            appliedMinutes: presenceWindow.appliedMinutes,
            clampReason: presenceWindow.clampReason,
            config: this.moderationConfig
          })
        );
        void this.onModeratorPresenceCheckIn?.(presenceWindow);
        continue;
      }

      if (!this.limiter.allow(now.getTime())) {
        continue;
      }

      const event: EngagementEventRecord = {
        id: message.id,
        kind: "chat",
        actor: message.actor,
        message: message.message,
        createdAt: now.toISOString()
      };
      this.messages.push(event);
      void this.onChatMessage?.({
        ...message,
        createdAt: event.createdAt
      });
      void appendEngagementEventRecord(event);
    }
  }
}
