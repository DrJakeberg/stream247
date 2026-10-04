import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CHAT_REPLY_GLOBAL_COOLDOWN_MS,
  CHAT_REPLY_VIEWER_COOLDOWN_MS,
  CHAT_SEND_BUDGET_LINES,
  CHAT_SEND_BUDGET_WINDOW_MS,
  ChatReplyCooldown,
  ChatSendBudget,
  createDefaultChatInteractionConfig,
  formatChatCommandsReply,
  formatChatNextReply,
  formatChatNowReply,
  formatChatRequestReply,
  normalizeChatInteractionConfig,
  parseChatCommand,
  sanitizeChatLine,
  type ChatInteractionConfig,
  type ChatProgrammeInfo,
  type RequestVerdict
} from "@stream247/core";
import { ChatControlRuntime } from "../../apps/worker/src/chat-control.js";
import { buildChatProgrammeInfo } from "../../apps/worker/src/chat-programme-info.js";

// M104 V5/V6 (owner decision 5.1 Q7): viewers can ask the bot !commands, !now and !next, and every
// !request gets one answer -- each with its own switch, 60 s per viewer and 10 s in the room, en + de.

function config(overrides: Partial<ChatInteractionConfig> = {}): ChatInteractionConfig {
  return { ...createDefaultChatInteractionConfig(), enabled: true, ...overrides };
}

const verdict = (overrides: Partial<RequestVerdict>): RequestVerdict => ({
  accepted: false,
  reason: "",
  retryAfterSeconds: 0,
  assetId: "",
  title: "",
  ...overrides
});

describe("the answer commands are parsed only while their switch is on", () => {
  it("knows !commands, !now and !next, case-insensitively", () => {
    expect(parseChatCommand("!commands", config())).toEqual({ kind: "info", info: "commands" });
    expect(parseChatCommand("!NOW", config())).toEqual({ kind: "info", info: "now" });
    expect(parseChatCommand("  !next please", config())).toEqual({ kind: "info", info: "next" });
  });

  it("ignores each one whose switch is off, and all of them with viewer control off", () => {
    expect(parseChatCommand("!commands", config({ commandsReplyEnabled: false }))).toEqual({ kind: "none" });
    expect(parseChatCommand("!now", config({ nowReplyEnabled: false }))).toEqual({ kind: "none" });
    expect(parseChatCommand("!next", config({ nextReplyEnabled: false }))).toEqual({ kind: "none" });
    expect(parseChatCommand("!now", config({ enabled: false }))).toEqual({ kind: "none" });
  });

  it("leaves the operator's own command names first", () => {
    expect(parseChatCommand("!next", config({ skipCommand: "next" }))).toEqual({ kind: "skip" });
    expect(parseChatCommand("!now Retro", config({ requestCommand: "now" }))).toEqual({ kind: "request", query: "Retro" });
  });

  it("keeps a stored switch and defaults a missing one to on", () => {
    expect(normalizeChatInteractionConfig({ nextReplyEnabled: false }).nextReplyEnabled).toBe(false);
    const defaults = normalizeChatInteractionConfig({});
    expect([defaults.commandsReplyEnabled, defaults.nowReplyEnabled, defaults.nextReplyEnabled, defaults.requestRepliesEnabled]).toEqual([
      true,
      true,
      true,
      true
    ]);
  });
});

describe("!commands lists only what answers", () => {
  it("names every enabled command under its configured name", () => {
    expect(formatChatCommandsReply({ actor: "Ada", config: config({ requestCommand: "wunsch", skipCommand: "weiter" }), gameCommand: true, locale: "en" })).toBe(
      "@Ada commands: !commands · !now · !next · !wunsch title · !weiter · !1–!3 during a poll · !game"
    );
  });

  it("leaves out what is switched off", () => {
    const reply = formatChatCommandsReply({
      actor: "Ada",
      config: config({ nowReplyEnabled: false, requestsEnabled: false, skipEnabled: false, votingEnabled: false }),
      gameCommand: false,
      locale: "en"
    });
    expect(reply).toBe("@Ada commands: !commands · !next");
    expect(reply).not.toMatch(/!now|!request|!skip|!1|!game/);
  });

  it("speaks German on a German channel", () => {
    expect(formatChatCommandsReply({ actor: "Ada", config: config({ voteOptionCount: 2 }), gameCommand: false, locale: "de" })).toBe(
      "@Ada Befehle: !commands · !now · !next · !request Titel · !skip · !1–!2 während einer Abstimmung"
    );
  });
});

const programme = (overrides: Partial<ChatProgrammeInfo> = {}): ChatProgrammeInfo => ({
  nowTitle: "Retro Night",
  nextTitle: "Coding Marathon",
  nextStartsAt: "",
  channelUrl: "https://tv.example.org/channel",
  ...overrides
});

describe("!now and !next", () => {
  it("!now names the title on air and links the programme", () => {
    expect(formatChatNowReply("Ada", programme(), "en")).toBe("@Ada now on air: Retro Night. Programme: https://tv.example.org/channel");
    expect(formatChatNowReply("Ada", programme(), "de")).toBe("@Ada gerade läuft: Retro Night. Programm: https://tv.example.org/channel");
  });

  it("!now says so when nothing plays, and has no link without an app URL", () => {
    expect(formatChatNowReply("Ada", programme({ nowTitle: "", channelUrl: "" }), "en")).toBe(
      "@Ada nothing is playing right now — stand by, we’ll be right back."
    );
    expect(formatChatNowReply("Ada", programme({ nowTitle: "", channelUrl: "" }), "de")).toBe("@Ada gerade läuft nichts – kurze Pause, gleich geht’s weiter.");
  });

  it("!next names the next item, with its start time when it is a block, and the /channel link", () => {
    expect(formatChatNextReply("Ada", programme(), "en")).toBe("@Ada up next: Coding Marathon. Programme: https://tv.example.org/channel");
    expect(formatChatNextReply("Ada", programme({ nextStartsAt: "20:00" }), "en")).toBe(
      "@Ada next at 20:00: Coding Marathon. Programme: https://tv.example.org/channel"
    );
    expect(formatChatNextReply("Ada", programme({ nextStartsAt: "20:00" }), "de")).toBe(
      "@Ada als Nächstes um 20:00: Coding Marathon. Programm: https://tv.example.org/channel"
    );
    expect(formatChatNextReply("Ada", programme({ nextTitle: "" }), "de")).toBe("@Ada als Nächstes ist noch nichts geplant. Programm: https://tv.example.org/channel");
  });
});

describe("one answer per !request", () => {
  it("confirms a queued request with its position", () => {
    const accepted = verdict({ accepted: true, assetId: "a1", title: "Retro Night" });
    expect(formatChatRequestReply({ actor: "Ada", verdict: accepted, position: 3, locale: "en" })).toBe(
      "@Ada “Retro Night” is in the queue at position 3."
    );
    expect(formatChatRequestReply({ actor: "Ada", verdict: accepted, position: 1, locale: "de" })).toBe(
      "@Ada „Retro Night“ steht in der Warteschlange auf Platz 1."
    );
  });

  it("says no match without repeating what the viewer typed", () => {
    const reply = formatChatRequestReply({ actor: "Ada", verdict: verdict({ reason: "no-match" }), position: 0, locale: "en" });
    expect(reply).toBe("@Ada no requestable video matches that title.");
    expect(formatChatRequestReply({ actor: "Ada", verdict: verdict({ reason: "no-match" }), position: 0, locale: "de" })).toBe(
      "@Ada dazu finde ich kein Video, das du dir wünschen kannst."
    );
  });

  it("names the cooldown's wait in seconds under a minute and in minutes above", () => {
    const at = (seconds: number, locale: string) =>
      formatChatRequestReply({ actor: "Ada", verdict: verdict({ reason: "cooldown", retryAfterSeconds: seconds }), position: 0, locale });
    expect(at(45, "en")).toBe("@Ada you can request again in 45 seconds.");
    expect(at(1, "en")).toBe("@Ada you can request again in 1 second.");
    expect(at(61, "en")).toBe("@Ada you can request again in 2 minutes.");
    expect(at(60, "de")).toBe("@Ada du kannst dir in 1 Minute wieder etwas wünschen.");
    expect(at(540, "de")).toBe("@Ada du kannst dir in 9 Minuten wieder etwas wünschen.");
  });

  it("says the queue is full, and that the title is already queued", () => {
    expect(formatChatRequestReply({ actor: "Ada", verdict: verdict({ reason: "queue-full" }), position: 0, locale: "en" })).toBe(
      "@Ada the request queue is full — try again once a request has played."
    );
    expect(
      formatChatRequestReply({ actor: "Ada", verdict: verdict({ reason: "already-queued", title: "Retro Night" }), position: 0, locale: "de" })
    ).toBe("@Ada „Retro Night“ steht schon in der Warteschlange.");
  });

  it("has nothing to say for a request that was never parsed", () => {
    expect(formatChatRequestReply({ actor: "Ada", verdict: verdict({ reason: "disabled" }), position: 0, locale: "en" })).toBeNull();
  });
});

describe("the cooldowns: 60 s per viewer, 10 s in the room", () => {
  it("answers a viewer once a minute", () => {
    const cooldown = new ChatReplyCooldown();
    expect(cooldown.claimInfo("ada", 0)).toBe(true);
    expect(cooldown.claimInfo("Ada", CHAT_REPLY_VIEWER_COOLDOWN_MS - 1)).toBe(false);
    expect(cooldown.claimInfo("ada", CHAT_REPLY_VIEWER_COOLDOWN_MS)).toBe(true);
  });

  it("answers the room once every ten seconds, whoever asks", () => {
    const cooldown = new ChatReplyCooldown();
    expect(cooldown.claimInfo("ada", 0)).toBe(true);
    expect(cooldown.claimInfo("bob", CHAT_REPLY_GLOBAL_COOLDOWN_MS - 1)).toBe(false);
    // The refused question took no slot: bob is answered as soon as the room's ten seconds are over.
    expect(cooldown.claimInfo("bob", CHAT_REPLY_GLOBAL_COOLDOWN_MS)).toBe(true);
  });

  it("explains a refused request to each viewer once a minute, not bound by the room", () => {
    const cooldown = new ChatReplyCooldown();
    expect(cooldown.claimViewer("ada", 0)).toBe(true);
    expect(cooldown.claimViewer("bob", 1)).toBe(true);
    expect(cooldown.claimViewer("ada", CHAT_REPLY_VIEWER_COOLDOWN_MS - 1)).toBe(false);
    expect(cooldown.claimViewer("ada", CHAT_REPLY_VIEWER_COOLDOWN_MS)).toBe(true);
  });

  it("is what the chat runtime hands the worker with each answer command", () => {
    let nowMs = Date.parse("2026-10-04T12:00:00.000Z");
    const runtime = new ChatControlRuntime({ now: () => new Date(nowMs) });
    const ask = (actor: string, message: string) => runtime.handleMessage({ actor, message, currentAssetId: "a1", config: config() });

    expect(ask("ada", "!now")).toEqual({ kind: "info", info: "now", actor: "ada", answer: true });
    nowMs += 5_000;
    expect(ask("bob", "!next")).toEqual({ kind: "info", info: "next", actor: "bob", answer: false });
    nowMs += 5_000;
    expect(ask("bob", "!next")).toEqual({ kind: "info", info: "next", actor: "bob", answer: true });
    nowMs += 20_000;
    expect(ask("ada", "!commands")).toEqual({ kind: "info", info: "commands", actor: "ada", answer: false });
    nowMs += 30_000;
    expect(ask("ada", "!commands")).toEqual({ kind: "info", info: "commands", actor: "ada", answer: true });

    expect(runtime.claimRequestRefusalReply("cy")).toBe(true);
    expect(runtime.claimRequestRefusalReply("cy")).toBe(false);
  });
});

describe("what !now and !next answer from", () => {
  const base = {
    playout: { status: "running", currentTitle: "Retro Night", nextTitle: "Coding Marathon" },
    nextScheduleItem: { title: "Evening block", startTime: "20:00" },
    appUrl: "https://tv.example.org/",
    locale: "en"
  };

  it("takes the playout's titles while a programme plays, and links /channel", () => {
    expect(buildChatProgrammeInfo(base)).toEqual({
      nowTitle: "Retro Night",
      nextTitle: "Coding Marathon",
      nextStartsAt: "",
      channelUrl: "https://tv.example.org/channel"
    });
  });

  it("counts the standby slate as nothing on air and names the next block with its time", () => {
    const info = buildChatProgrammeInfo({ ...base, playout: { status: "standby", currentTitle: "Replay standby", nextTitle: "" } });
    expect(info).toMatchObject({ nowTitle: "", nextTitle: "Evening block", nextStartsAt: "20:00" });
    // A running slate is still a slate.
    expect(buildChatProgrammeInfo({ ...base, playout: { ...base.playout, currentTitle: "Stand by" } }).nowTitle).toBe("");
  });

  it("puts built-in titles into the channel language and leaves the link out without an app URL", () => {
    const info = buildChatProgrammeInfo({
      ...base,
      appUrl: "",
      locale: "de",
      playout: { status: "running", currentTitle: "Live Bridge", nextTitle: "Local Media Library" }
    });
    expect(info.channelUrl).toBe("");
    expect(info.nowTitle).not.toBe("Live Bridge");
    expect(info.nextTitle).not.toBe("Local Media Library");
  });

  it("has nothing next when neither the playout nor today's schedule knows", () => {
    expect(buildChatProgrammeInfo({ ...base, playout: { status: "idle", currentTitle: "", nextTitle: "" }, nextScheduleItem: null })).toMatchObject({
      nowTitle: "",
      nextTitle: ""
    });
  });
});

describe("the bot cannot flood chat or break its own line", () => {
  it("sends at most the budget's lines in any 30 seconds", () => {
    const budget = new ChatSendBudget();
    const sent = Array.from({ length: CHAT_SEND_BUDGET_LINES + 5 }, (_, index) => budget.claim(index * 100)).filter(Boolean).length;
    expect(sent).toBe(CHAT_SEND_BUDGET_LINES);
    expect(CHAT_SEND_BUDGET_LINES).toBeLessThan(20);
    expect(budget.claim(CHAT_SEND_BUDGET_WINDOW_MS)).toBe(true);
  });

  it("names the viewer first, so two viewers asking the same are not sent one identical line twice", () => {
    expect(formatChatNowReply("Ada", programme(), "en")).not.toBe(formatChatNowReply("Bob", programme(), "en"));
  });

  it("cuts a long line by code point, never inside an emoji", () => {
    expect(Array.from(sanitizeChatLine("😀".repeat(500)))).toHaveLength(480);
    expect(sanitizeChatLine("😀".repeat(500))).toBe("😀".repeat(480));
  });

  it("turns a line break in a title into a space", () => {
    expect(sanitizeChatLine("Now on air: Evil\r\nPRIVMSG #other :hi")).toBe("Now on air: Evil PRIVMSG #other :hi");
  });
});

describe("the worker wiring", () => {
  const worker = readFileSync(new URL("../../apps/worker/src/index.ts", import.meta.url), "utf8");
  const bridge = readFileSync(new URL("../../apps/worker/src/twitch-engagement.ts", import.meta.url), "utf8");
  const flat = (text: string) => text.replace(/\s+/g, " ");

  it("answers the three commands only when the runtime grants the cooldown", () => {
    expect(flat(worker)).toContain('if (effect.kind === "info" && effect.answer) {');
  });

  it("confirms every accepted request and explains a refusal once a minute, both behind the request switch", () => {
    expect(flat(worker)).toContain("if (config.requestRepliesEnabled) { // Formatted before the claim");
    expect(flat(worker)).toContain("const refusal = formatChatRequestReply({ actor: effect.actor, verdict, position: 0, locale: viewerLanguage() });");
    expect(flat(worker)).toContain("if (refusal && chatControl.claimRequestRefusalReply(effect.actor)) {");
    expect(flat(worker)).toMatch(/position = queuedAssetIds\.length;[\s\S]*if \(config\.requestRepliesEnabled\) \{ const reply = formatChatRequestReply\(\{ actor: effect\.actor, verdict, position,/);
  });

  it("rebuilds what !now and !next answer from on every chat cycle", () => {
    expect(flat(worker)).toContain("latestChatProgrammeInfo = buildChatProgrammeInfo({");
  });

  it("passes every line through the send budget and the line sanitiser before the socket", () => {
    expect(flat(bridge)).toContain("message = sanitizeChatLine(message);");
    expect(flat(bridge)).toContain("if (!this.sendBudget.claim(Date.now())) {");
  });
});
