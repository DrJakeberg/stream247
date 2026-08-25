import tls from "node:tls";
import { randomUUID } from "node:crypto";
import {
  createDefaultModerationConfig,
  formatPresenceClampReply,
  isEngagementChatRuntimeEnabled,
  resolveBroadcastChannelLogin,
  resolveModeratorCheckIn
} from "@stream247/core";
import type { AppState, EngagementEventRecord } from "@stream247/db";
import { appendEngagementEventRecord } from "@stream247/db";

// Twitch pings roughly every five minutes; silence past six means the connection is gone even if
// the socket still reports itself open.
export const CHAT_IDLE_TIMEOUT_MS = 6 * 60_000;

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

/**
 * Which IRC room to join, and as whom.
 *
 * The two were the same value until the broadcast-channel split: the bridge joined the connected
 * account's own room, which is empty when the stream key sends video to a different channel. The
 * nick must stay the identity's login — Twitch rejects a connection whose NICK does not match the
 * token — while the JOIN targets the broadcast channel, which any account may enter and a
 * moderator may speak in. IRC channel names are lowercase, so both come back lowercased.
 */
export function resolveChatConnectionTarget(args: {
  identityLogin: string;
  configuredBroadcastLogin: string;
}): { nick: string; channel: string } {
  const nick = args.identityLogin.trim().toLowerCase();
  const channel = resolveBroadcastChannelLogin({
    configuredLogin: args.configuredBroadcastLogin,
    identityLogin: args.identityLogin
  }).toLowerCase();

  return { nick, channel };
}

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
  /** Last time the socket produced anything; 0 while never connected. */
  private lastActivityAt = 0;
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
    const { nick, channel } = resolveChatConnectionTarget({
      identityLogin: state.twitch.broadcasterLogin,
      configuredBroadcastLogin: state.managedConfig.twitchBroadcastChannelLogin || env.TWITCH_BROADCAST_CHANNEL_LOGIN || ""
    });
    const accessToken = state.twitch.accessToken;
    this.moderationConfig = state.moderation;
    if (!enabled || !nick || !channel || !accessToken) {
      await this.disconnect("disabled");
      return;
    }

    if (this.socket && this.channel === channel && !this.socket.destroyed && !this.isConnectionStale()) {
      return;
    }

    await this.disconnect("reconnecting");
    this.channel = channel;
    this.limiter = createChatRateLimiter(state.engagement.rateLimitPerMinute);
    this.socket = tls.connect({ host: "irc.chat.twitch.tv", port: 6697, servername: "irc.chat.twitch.tv" }, () => {
      this.socket?.write("CAP REQ :twitch.tv/tags twitch.tv/commands\r\n");
      this.socket?.write(`PASS oauth:${accessToken.replace(/^oauth:/, "")}\r\n`);
      // The nick authenticates, the channel is joined: with a broadcast channel configured these
      // differ, and sending the channel as NICK would fail the login outright.
      this.socket?.write(`NICK ${nick}\r\n`);
      this.socket?.write(`JOIN #${channel}\r\n`);
      void appendChatStatus("connected", "connected");
    });

    this.socket.setEncoding("utf8");
    this.lastActivityAt = Date.now();

    // Twitch sends a PING roughly every five minutes, so silence well past that means the
    // connection is gone even though the socket still looks open. Without this a half-open
    // connection -- a NAT timeout, a silent drop -- was never noticed: sync() only reconnected on
    // a *destroyed* socket, so chat stayed dead until the process restarted.
    this.socket.setKeepAlive(true, 30_000);
    this.socket.setTimeout(CHAT_IDLE_TIMEOUT_MS, () => {
      void appendChatStatus("disconnected", "idle-timeout");
      this.socket?.destroy();
    });

    this.socket.on("data", (chunk) => {
      this.lastActivityAt = Date.now();
      this.handleChunk(String(chunk));
    });
    this.socket.on("error", () => {
      void appendChatStatus("disconnected", "disconnected");
    });
    this.socket.on("close", () => {
      void appendChatStatus("disconnected", "disconnected");
    });
  }

  /**
   * True when the socket looks open but has produced nothing for longer than Twitch's own ping
   * interval. The next sync() then tears it down and reconnects.
   */
  private isConnectionStale(nowMs = Date.now()): boolean {
    return this.lastActivityAt > 0 && nowMs - this.lastActivityAt > CHAT_IDLE_TIMEOUT_MS;
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
        void Promise.resolve(this.onModeratorPresenceCheckIn?.(presenceWindow)).catch(() => undefined);
        continue;
      }

      // Command handling runs before the limiter. The limiter bounds how much chat reaches the
      // on-air overlay and the event log; it must not decide who gets to vote. During a poll
      // dozens of viewers answer within seconds, and rate-limiting that path would silently
      // discard most ballots and quietly corrupt the result.
      void Promise.resolve(
        this.onChatMessage?.({
          ...message,
          createdAt: now.toISOString()
        })
      ).catch(() => undefined);

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
      void appendEngagementEventRecord(event).catch(() => undefined);
    }
  }
}
