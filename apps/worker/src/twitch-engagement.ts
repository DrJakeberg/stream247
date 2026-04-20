import tls from "node:tls";
import { randomUUID } from "node:crypto";
import { isEngagementChatRuntimeEnabled } from "@stream247/core";
import type { AppState, EngagementEventRecord } from "@stream247/db";
import { appendEngagementEventRecord } from "@stream247/db";

export type TwitchChatMessage = {
  id: string;
  actor: string;
  message: string;
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
  if (!message) {
    return null;
  }

  return {
    id: tags.id || `chat-${randomUUID()}`,
    actor,
    message
  };
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

  getRecentMessages(): EngagementEventRecord[] {
    return this.messages.values();
  }

  async sync(state: AppState, env: NodeJS.ProcessEnv): Promise<void> {
    const enabled = isEngagementChatRuntimeEnabled(state.engagement, env);
    const channel = state.twitch.broadcasterLogin.toLowerCase();
    const accessToken = state.twitch.accessToken;
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

      if (!this.limiter.allow(Date.now())) {
        continue;
      }

      const event: EngagementEventRecord = {
        id: message.id,
        kind: "chat",
        actor: message.actor,
        message: message.message,
        createdAt: new Date().toISOString()
      };
      this.messages.push(event);
      void appendEngagementEventRecord(event);
    }
  }
}
