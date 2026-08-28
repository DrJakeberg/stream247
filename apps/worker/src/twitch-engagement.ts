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
import { logRuntimeEvent } from "./runtime-log.js";

// Twitch pings roughly every five minutes; silence past six means the connection is gone even if
// the socket still reports itself open.
export const CHAT_IDLE_TIMEOUT_MS = 6 * 60_000;

/**
 * How long the bridge waits before trying a login Twitch already refused.
 *
 * A refused login is not a transient fault: the token is missing a scope, or it is expired or
 * revoked. Retrying it on the worker cycle reconnected roughly every fifteen seconds forever,
 * which is a login flood against Twitch that cannot succeed and buries the one line that explains
 * why. The cooldown is keyed to the token, so reconnecting the account retries immediately rather
 * than waiting this out.
 */
export const CHAT_LOGIN_REJECTED_COOLDOWN_MS = 5 * 60_000;

/** What the bridge is actually doing, as opposed to whether a socket happens to be open. */
export type ChatConnectionPhase = "idle" | "connecting" | "connected" | "login-rejected" | "waiting";

/**
 * The connection phase as a sentence for the operator.
 *
 * "disconnected" was the only word chat ever had, and it covered a refused login just as happily
 * as a network blip -- so the one state that needs an operator action looked like the one that
 * needs nothing.
 */
export function describeChatConnectionPhase(phase: ChatConnectionPhase): string {
  switch (phase) {
    case "connected":
      return "Chat connected";
    case "connecting":
      return "Chat connecting";
    case "login-rejected":
      return "Chat login refused by Twitch — reconnect the Twitch account to grant chat access";
    case "waiting":
      return "Chat waiting before the next login attempt";
    default:
      return "Chat idle";
  }
}

/**
 * Reads a NOTICE line. Twitch reports a refused login only this way -- there is no numeric and no
 * error frame -- and it then closes the socket a few seconds later without further explanation.
 */
export function parseTwitchIrcNotice(line: string): { target: string; message: string } | null {
  const match = line.match(/^(?:@[^ ]+ )?:[^ ]+ NOTICE (?<target>[^ ]+) :(?<message>.*)$/);
  if (!match?.groups) {
    return null;
  }

  return { target: match.groups.target, message: match.groups.message.trim() };
}

/** The wordings Twitch uses to refuse a login. All of them mean: this token will never work. */
export function isTwitchLoginFailureNotice(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("login unsuccessful") ||
    normalized.includes("login authentication failed") ||
    normalized.includes("improperly formatted auth") ||
    normalized.includes("invalid nick")
  );
}

export function isChatLoginRejectedCoolingDown(args: {
  rejectedAt: number | null;
  now: number;
  cooldownMs?: number;
}): boolean {
  if (args.rejectedAt === null) {
    return false;
  }

  return args.now - args.rejectedAt <= (args.cooldownMs ?? CHAT_LOGIN_REJECTED_COOLDOWN_MS);
}

export type TwitchChatMessage = {
  id: string;
  actor: string;
  /** The account's lowercase login, from the IRC source prefix. Display names can be localised
   * strings unrelated to the login, and moderation lines (CLEARCHAT) name the login — so removal
   * has to match on this, never on the display name. */
  login: string;
  message: string;
  isModerator: boolean;
};

/**
 * A moderation line the bridge must mirror into its own buffer. Twitch sends CLEARMSG when one
 * message is deleted and CLEARCHAT when a user is banned or timed out (or, with no target, when
 * the whole room is cleared). A message a moderator removed from chat must not keep playing on
 * the broadcast, which is the one surface the moderator cannot refresh.
 */
export type TwitchChatModerationAction =
  | { kind: "clear-message"; targetMessageId: string }
  | { kind: "clear-user"; login: string }
  | { kind: "clear-all" };

export function parseTwitchChatModerationLine(line: string): TwitchChatModerationAction | null {
  const clearMsg = line.match(/^@(?<tags>[^ ]+) :[^ ]+ CLEARMSG #[^ ]+ :.*$/);
  if (clearMsg?.groups) {
    const targetMessageId =
      clearMsg.groups.tags
        .split(";")
        .map((entry) => entry.split("="))
        .find(([key]) => key === "target-msg-id")?.[1] ?? "";
    return targetMessageId ? { kind: "clear-message", targetMessageId } : null;
  }

  const clearChat = line.match(/^(?:@[^ ]+ )?:[^ ]+ CLEARCHAT #[^ ]+(?: :(?<login>.+))?$/);
  if (clearChat) {
    const login = (clearChat.groups?.login ?? "").trim().toLowerCase();
    return login ? { kind: "clear-user", login } : { kind: "clear-all" };
  }

  return null;
}

type ModeratorPresenceWindow = NonNullable<ReturnType<typeof resolveModeratorCheckIn>>;

type TwitchChatBridgeOptions = {
  onModeratorPresenceCheckIn?: (window: ModeratorPresenceWindow) => Promise<void> | void;
  onChatMessage?: (message: TwitchChatMessage & { createdAt: string }) => Promise<void> | void;
  /** Fired whenever the overlay-facing message buffer changes: a display-worthy message arrived,
   * a moderation line removed something, or a disconnect cleared the buffer. The worker throttles
   * the resulting flush, so firing per change is cheap. */
  onOverlayMessagesChanged?: () => void;
  /** Fired when the bridge changes phase, so the worker can raise or clear the operator incident.
   * `detail` carries the server's own words on a refusal — never the token. */
  onConnectionPhaseChanged?: (phase: ChatConnectionPhase, detail: string) => void;
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
    },
    /** Removes every matching entry and reports how many went — the moderation path. */
    remove(predicate: (entry: T) => boolean): number {
      let removed = 0;
      for (let index = entries.length - 1; index >= 0; index -= 1) {
        if (predicate(entries[index]!)) {
          entries.splice(index, 1);
          removed += 1;
        }
      }
      return removed;
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
  const login = (match.groups.source.split("!")[0] || "").toLowerCase();
  const actor = (tags["display-name"] || "").replace(/\\s/g, " ").trim() || login || "Viewer";
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
    login,
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

async function appendChatStatus(
  status: "connected" | "disconnected" | "login-rejected",
  message: string
): Promise<void> {
  // The status line is a report about the connection, so it must never be able to break the
  // connection: a database that is briefly unreachable would otherwise reject straight out of
  // sync() and skip the reconnect this line was only describing.
  await appendEngagementEventRecord({
    id: `chat-status-${status}`,
    kind: "status",
    actor: "chat",
    message,
    createdAt: new Date().toISOString()
  }).catch(() => undefined);
}

export class TwitchChatBridge {
  private socket: tls.TLSSocket | null = null;
  private channel = "";
  private buffer = "";
  // Entries carry the login alongside the display event: CLEARCHAT names the login, and a
  // localised display name may share no characters with it. The login never leaves this buffer —
  // getRecentMessages and everything downstream see only the display record.
  private readonly messages = createRingBuffer<EngagementEventRecord & { login: string }>(50);
  private limiter = createChatRateLimiter(30);
  private moderationConfig: AppState["moderation"] = createDefaultModerationConfig();
  /** Last time the socket produced anything; 0 while never connected. */
  private lastActivityAt = 0;
  private phase: ChatConnectionPhase = "idle";
  /** When Twitch last refused a login, and the token it refused. Null once a login succeeds. */
  private loginRejectedAt: number | null = null;
  private loginRejectedToken = "";
  private loginRejectedReason = "";
  /** The token the current connection authenticated with, so a refusal can be pinned to it. */
  private activeToken = "";
  /** How many handshake lines still get logged on the current connection. Twitch answers the
   * handshake in a handful of lines and then streams chat forever; logging the whole stream would
   * be both useless and a privacy problem, so only the opening lines are kept. */
  private handshakeLogBudget = 0;
  private readonly onModeratorPresenceCheckIn?: TwitchChatBridgeOptions["onModeratorPresenceCheckIn"];
  private readonly onChatMessage?: TwitchChatBridgeOptions["onChatMessage"];
  private readonly onOverlayMessagesChanged?: TwitchChatBridgeOptions["onOverlayMessagesChanged"];
  private readonly onConnectionPhaseChanged?: TwitchChatBridgeOptions["onConnectionPhaseChanged"];

  constructor(options: TwitchChatBridgeOptions = {}) {
    this.onModeratorPresenceCheckIn = options.onModeratorPresenceCheckIn;
    this.onChatMessage = options.onChatMessage;
    this.onOverlayMessagesChanged = options.onOverlayMessagesChanged;
    this.onConnectionPhaseChanged = options.onConnectionPhaseChanged;
  }

  getConnectionPhase(): ChatConnectionPhase {
    return this.phase;
  }

  /** The refusal in the server's own words, for the incident the operator reads. */
  getLoginRejectedReason(): string {
    return this.loginRejectedReason;
  }

  private setPhase(phase: ChatConnectionPhase, detail = ""): void {
    if (this.phase === phase) {
      return;
    }
    this.phase = phase;
    this.onConnectionPhaseChanged?.(phase, detail);
  }

  /**
   * True while a refusal of *this same token* is still cooling down. A different token means the
   * operator reconnected the account, which is exactly the fix — so it retries at once.
   */
  private isLoginCoolingDown(accessToken: string, nowMs = Date.now()): boolean {
    if (this.loginRejectedToken !== accessToken) {
      return false;
    }

    return isChatLoginRejectedCoolingDown({ rejectedAt: this.loginRejectedAt, now: nowMs });
  }

  getRecentMessages(): EngagementEventRecord[] {
    return this.messages.values().map(({ login: _login, ...event }) => event);
  }

  async sync(state: AppState, env: NodeJS.ProcessEnv): Promise<void> {
    const enabled = isEngagementChatRuntimeEnabled(state.engagement, env, state.managedConfig);
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

    // A login Twitch already refused must not be retried on every cycle. Without this the bridge
    // reconnected roughly every fifteen seconds around the clock: TLS came up, Twitch answered
    // "Login unsuccessful", closed the socket, and the next cycle started over.
    if (this.isLoginCoolingDown(accessToken)) {
      this.setPhase("login-rejected", this.loginRejectedReason);
      return;
    }

    await this.disconnect("reconnecting");
    this.setPhase("connecting");
    this.activeToken = accessToken;
    this.channel = channel;
    this.limiter = createChatRateLimiter(state.engagement.rateLimitPerMinute);
    this.socket = tls.connect({ host: "irc.chat.twitch.tv", port: 6697, servername: "irc.chat.twitch.tv" }, () => {
      this.socket?.write("CAP REQ :twitch.tv/tags twitch.tv/commands\r\n");
      this.socket?.write(`PASS oauth:${accessToken.replace(/^oauth:/, "")}\r\n`);
      // The nick authenticates, the channel is joined: with a broadcast channel configured these
      // differ, and sending the channel as NICK would fail the login outright.
      this.socket?.write(`NICK ${nick}\r\n`);
      this.socket?.write(`JOIN #${channel}\r\n`);
      // Deliberately no "connected" status here. A completed TLS handshake says only that the
      // socket opened; Twitch has not yet looked at the token. Reporting success at this point is
      // what made a permanently refused login read as a healthy connection that kept dropping.
    });
    this.handshakeLogBudget = 8;

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
      this.noteDisconnected();
    });
    this.socket.on("close", () => {
      this.noteDisconnected();
    });
  }

  /**
   * The socket ended. A close that follows a refusal must keep the refused phase: Twitch closes a
   * refused connection a few seconds after the NOTICE, and letting that close overwrite the phase
   * would hide the reason behind a generic disconnect again.
   */
  private noteDisconnected(): void {
    if (this.phase === "login-rejected") {
      return;
    }
    this.setPhase("waiting");
    void appendChatStatus("disconnected", "disconnected");
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
    // The cleared buffer must reach the on-air row too: while disconnected the bridge cannot see
    // moderation lines, so stale messages must not keep playing on the broadcast. The panel goes
    // blank on a reconnect and refills as the room talks.
    this.onOverlayMessagesChanged?.();
    if (reason === "disabled") {
      // Turning chat off must also clear a refusal: the incident asks the operator to reconnect
      // the account, and that is no longer something they need to do once chat is disabled.
      this.loginRejectedAt = null;
      this.loginRejectedToken = "";
      this.loginRejectedReason = "";
      this.setPhase("idle");
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

      // The opening lines of a connection, kept so the next failure is readable from the log.
      // Only the handshake, and only lines the server sends about the session -- never chat, and
      // never anything carrying the token, which is only ever written and never echoed back.
      if (this.handshakeLogBudget > 0 && !line.includes("PRIVMSG")) {
        this.handshakeLogBudget -= 1;
        logRuntimeEvent("chat.handshake", { line: line.slice(0, 200) });
      }

      // Twitch reports a refused login as a NOTICE and nothing else, then closes the socket a few
      // seconds later. Until this was read, the refusal fell through the PRIVMSG-only parser and
      // the bridge saw only an unexplained disconnect.
      const notice = parseTwitchIrcNotice(line);
      if (notice) {
        if (isTwitchLoginFailureNotice(notice.message)) {
          this.loginRejectedAt = Date.now();
          this.loginRejectedToken = this.activeToken;
          this.loginRejectedReason = notice.message;
          this.setPhase("login-rejected", notice.message);
          void appendChatStatus("login-rejected", describeChatConnectionPhase("login-rejected"));
          // Closing here rather than waiting for Twitch keeps the cooldown anchored to the refusal.
          this.socket?.destroy();
        }
        continue;
      }

      // 001 is the first thing Twitch sends once it has accepted the token: the only honest
      // "connected" signal there is.
      if (/^:[^ ]+ 001 /.test(line)) {
        this.loginRejectedAt = null;
        this.loginRejectedToken = "";
        this.loginRejectedReason = "";
        this.setPhase("connected", "");
        void appendChatStatus("connected", describeChatConnectionPhase("connected"));
        continue;
      }

      const moderation = parseTwitchChatModerationLine(line);
      if (moderation) {
        const removed = this.messages.remove((entry) => {
          if (moderation.kind === "clear-message") {
            return entry.id === moderation.targetMessageId;
          }
          if (moderation.kind === "clear-user") {
            return entry.login === moderation.login;
          }
          return true;
        });
        if (removed > 0) {
          this.onOverlayMessagesChanged?.();
        }
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
      this.messages.push({ ...event, login: message.login });
      this.onOverlayMessagesChanged?.();
      void appendEngagementEventRecord(event).catch(() => undefined);
    }
  }
}
