import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CHAT_REPLY_GLOBAL_COOLDOWN_MS,
  CHAT_REPLY_VIEWER_COOLDOWN_MS,
  CHAT_REFUSAL_ROOM_LINES,
  CHAT_REFUSAL_ROOM_WINDOW_MS,
  CHAT_SEND_BUDGET_LINES,
  CHAT_SEND_BUDGET_RESERVED_LINES,
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
  type RequestVerdict,
  type ScheduleOccurrence
} from "@stream247/core";
import { ChatControlRuntime } from "../../apps/worker/src/chat-control.js";
import { answerChatEffect, replyToChatRequest } from "../../apps/worker/src/chat-answers.js";
import { buildChatProgrammeInfo, readChatProgrammeInfoNow, type ChatPlayoutRow } from "../../apps/worker/src/chat-programme-info.js";
import type { NextOnAirPlayout, NextOnAirPrediction } from "../../apps/worker/src/next-on-air.js";
import { TwitchChatBridge } from "../../apps/worker/src/twitch-engagement.js";

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
  nextExpectedAt: "",
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

  it("!next names when the next video is expected to start, as an estimate (M107)", () => {
    expect(formatChatNextReply("Ada", programme({ nextExpectedAt: "17:30" }), "en")).toBe(
      "@Ada next at about 17:30: Coding Marathon. Programme: https://tv.example.org/channel"
    );
    expect(formatChatNextReply("Ada", programme({ nextExpectedAt: "17:30" }), "de")).toBe(
      "@Ada als Nächstes um ca. 17:30: Coding Marathon. Programm: https://tv.example.org/channel"
    );
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

  it("explains a refused request to each viewer once a minute, not bound by the answers' ten seconds", () => {
    const cooldown = new ChatReplyCooldown();
    expect(cooldown.claimRefusal("ada", 0)).toBe(true);
    expect(cooldown.claimRefusal("bob", 1)).toBe(true);
    expect(cooldown.claimRefusal("ada", CHAT_REPLY_VIEWER_COOLDOWN_MS - 1)).toBe(false);
    expect(cooldown.claimRefusal("ada", CHAT_REPLY_VIEWER_COOLDOWN_MS)).toBe(true);
  });

  it("explains at most five refusals in the room every 30 seconds, whoever is refused (R23)", () => {
    const cooldown = new ChatReplyCooldown();
    const granted = Array.from({ length: 20 }, (_, index) => cooldown.claimRefusal(`raider${index}`, index * 10)).filter(Boolean);
    expect(granted).toHaveLength(CHAT_REFUSAL_ROOM_LINES);
    // A refusal the room turned down took nothing from that viewer: heard once the window moves on.
    expect(cooldown.claimRefusal("raider7", CHAT_REFUSAL_ROOM_WINDOW_MS - 1)).toBe(false);
    expect(cooldown.claimRefusal("raider7", CHAT_REFUSAL_ROOM_WINDOW_MS)).toBe(true);
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
  // The row as packages/db readPlayoutProgrammeTitles returns it.
  const row = (overrides: Partial<ChatPlayoutRow> = {}): ChatPlayoutRow => ({
    status: "running",
    currentTitle: "Retro Night",
    currentAssetId: "a1",
    processStartedAt: "",
    queueKind: "asset",
    nextAssetId: "a2",
    nextTitle: "Coding Marathon",
    manualNextAssetId: "",
    insertAssetId: "",
    insertStatus: "",
    overrideAssetId: "",
    overrideUntil: "",
    cuepointWindowKey: "",
    ...overrides
  });
  // !next asks the worker's prediction (next-on-air.ts, M107; its own table is next-on-air.test.ts): here
  // one that names the queue's next item while a programme plays, and the evening block while none does.
  const evening = { title: "Evening block", startTime: "20:00" } as ScheduleOccurrence;
  const predictNext = vi.fn((playout: NextOnAirPlayout): NextOnAirPrediction =>
    playout.playing && playout.nextTitle
      ? { kind: "item", assetId: playout.nextAssetId, title: playout.nextTitle, startsAt: null }
      : { kind: "block", title: evening.title, block: evening }
  );
  const base = { playout: row(), predictNext, timeZone: "UTC", appUrl: "https://tv.example.org/", locale: "en" };

  it("takes the playout's titles while a programme plays, and links /channel", () => {
    expect(buildChatProgrammeInfo(base)).toEqual({
      nowTitle: "Retro Night",
      nextTitle: "Coding Marathon",
      nextStartsAt: "",
      nextExpectedAt: "",
      channelUrl: "https://tv.example.org/channel"
    });
    expect(predictNext).toHaveBeenLastCalledWith(expect.objectContaining({ playing: true, currentAssetId: "a1", nextAssetId: "a2" }));
  });

  it("gives the prediction's expected start in the channel zone", () => {
    const info = buildChatProgrammeInfo({
      ...base,
      timeZone: "Europe/Berlin",
      predictNext: () => ({ kind: "item", assetId: "a2", title: "Coding Marathon", startsAt: new Date("2026-10-06T15:30:00.000Z") })
    });
    expect(info).toMatchObject({ nextTitle: "Coding Marathon", nextStartsAt: "", nextExpectedAt: "17:30" });
  });

  it("counts the standby slate as nothing on air and names the next block with its time", () => {
    const info = buildChatProgrammeInfo({ ...base, playout: row({ status: "standby", currentTitle: "Replay standby", nextTitle: "" }) });
    expect(info).toMatchObject({ nowTitle: "", nextTitle: "Evening block", nextStartsAt: "20:00", nextExpectedAt: "" });
    // A running slate is still a slate, and the prediction is told nothing plays.
    expect(buildChatProgrammeInfo({ ...base, playout: row({ currentTitle: "Stand by" }) }).nowTitle).toBe("");
    expect(predictNext).toHaveBeenLastCalledWith(expect.objectContaining({ playing: false }));
  });

  it("puts built-in titles into the channel language and leaves the link out without an app URL", () => {
    const info = buildChatProgrammeInfo({
      ...base,
      appUrl: "",
      locale: "de",
      playout: row({ status: "running", currentTitle: "Live Bridge", nextTitle: "Local Media Library" })
    });
    expect(info.channelUrl).toBe("");
    expect(info.nowTitle).not.toBe("Live Bridge");
    expect(info.nextTitle).not.toBe("Local Media Library");
  });

  it("has nothing next when the prediction knows nothing", () => {
    expect(
      buildChatProgrammeInfo({ ...base, playout: row({ status: "idle", currentTitle: "", nextTitle: "" }), predictNext: () => ({ kind: "none" }) })
    ).toMatchObject({ nowTitle: "", nextTitle: "", nextStartsAt: "", nextExpectedAt: "" });
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

// R27: the wiring used to be proven by finding strings in index.ts. The answers are now decided by
// chat-answers.ts with the runtime's effects, and the bridge is driven with a fake socket, so a second
// path that ignores the cooldown or a line that skips the budget fails here.
const HERE = "@display-name=3JakeC;id=chat-9;mod=1 :3jakec!3jakec@3jakec.tmi.twitch.tv PRIVMSG #jimpanse247 :!here 30\r\n";

function fakeBridge() {
  const write = vi.fn();
  const bridge = new TwitchChatBridge({ onModeratorPresenceCheckIn: async () => undefined });
  bridge["socket"] = { write, destroyed: false } as never;
  bridge["channel"] = "jimpanse247";
  const lines = () => write.mock.calls.map((call) => String(call[0]));
  return { bridge, write, lines };
}

describe("the bridge writes every line through the budget and the sanitiser", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("writes at most the budget's PRIVMSG lines in any 30 seconds, each a single IRC line", () => {
    vi.useFakeTimers({ toFake: ["Date"], now: Date.parse("2026-10-05T20:00:00.000Z") });
    const { bridge, lines } = fakeBridge();
    for (let index = 0; index < 40; index += 1) {
      bridge.say(`Now on air: Evil ${index}\r\nPRIVMSG #other :hi`);
      vi.advanceTimersByTime(500);
    }
    expect(lines()).toHaveLength(CHAT_SEND_BUDGET_LINES);
    for (const line of lines()) {
      expect(line).toMatch(/^PRIVMSG #jimpanse247 :[^\r\n]*\r\n$/);
    }
    vi.advanceTimersByTime(CHAT_SEND_BUDGET_WINDOW_MS);
    bridge.say("later");
    expect(lines().at(-1)).toBe("PRIVMSG #jimpanse247 :later\r\n");
  });

  it("leaves the reserve to everything else: a low line is dropped while a normal one still goes out", () => {
    vi.useFakeTimers({ toFake: ["Date"], now: Date.parse("2026-10-05T20:00:00.000Z") });
    const { bridge, lines } = fakeBridge();
    for (let index = 0; index < CHAT_SEND_BUDGET_LINES - CHAT_SEND_BUDGET_RESERVED_LINES; index += 1) {
      bridge.say(`answer ${index}`);
    }
    bridge.say("refusal", "low");
    expect(lines()).toHaveLength(CHAT_SEND_BUDGET_LINES - CHAT_SEND_BUDGET_RESERVED_LINES);
    for (let index = 0; index < CHAT_SEND_BUDGET_RESERVED_LINES; index += 1) {
      bridge.say(`moderator ${index}`);
    }
    expect(lines()).toHaveLength(CHAT_SEND_BUDGET_LINES);
    expect(lines().some((line) => line.includes("refusal"))).toBe(false);
  });
});

describe("a flood of refused requests cannot crowd out the bot's other lines (R23)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("says five refusals, then every confirmation, the moderator's check-in and a game answer", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: Date.parse("2026-10-05T20:00:00.000Z") });
    const { bridge, lines } = fakeBridge();
    const runtime = new ChatControlRuntime({ now: () => new Date() });
    const reply = (actor: string, requestVerdict: RequestVerdict, position: number) =>
      replyToChatRequest({
        actor,
        verdict: requestVerdict,
        position,
        config: config({ requestsEnabled: true }),
        locale: "en",
        claimRefusal: (who) => runtime.claimRequestRefusalReply(who),
        say: bridge.say.bind(bridge)
      });
    // A raid typing "!request zz", drained in one cycle: before M105 fifteen of these filled the budget.
    for (let index = 0; index < 30; index += 1) {
      reply(`raider${index}`, verdict({ reason: "no-match" }), 0);
    }
    expect(lines()).toHaveLength(CHAT_REFUSAL_ROOM_LINES);
    for (let index = 0; index < 8; index += 1) {
      reply(`fan${index}`, verdict({ accepted: true, assetId: `a${index}`, title: `Item ${index}` }), index + 1);
    }
    bridge["handleChunk"](HERE);
    await new Promise((resolve) => setImmediate(resolve));
    bridge.say("game answer");
    expect(lines()).toHaveLength(CHAT_REFUSAL_ROOM_LINES + 8 + 2);
    expect(lines().filter((line) => /Item \d/.test(line))).toHaveLength(8);
    expect(lines().some((line) => /presence window/i.test(line))).toBe(true);
    expect(lines().at(-1)).toContain("game answer");
  });

  it("says nothing with the request replies switched off, and never a refusal without the claim", () => {
    const said: string[] = [];
    const base = { actor: "ada", position: 0, locale: "en" as const, say: (line: string) => said.push(line) };
    replyToChatRequest({ ...base, verdict: verdict({ reason: "no-match" }), config: config({ requestRepliesEnabled: false }), claimRefusal: () => true });
    replyToChatRequest({ ...base, verdict: verdict({ reason: "no-match" }), config: config(), claimRefusal: () => false });
    expect(said).toEqual([]);
    // A verdict with nothing to say does not ask for the claim at all.
    const claim = vi.fn(() => true);
    replyToChatRequest({ ...base, verdict: verdict({ reason: "disabled" }), config: config(), claimRefusal: claim });
    expect(claim).not.toHaveBeenCalled();
  });
});

describe("the IRC handler's answers (chat-answers.ts)", () => {
  const nowPlaying = programme({ nowTitle: "Retro Night", nextTitle: "Coding Marathon" });
  const playoutRow = (overrides: Partial<ChatPlayoutRow>): ChatPlayoutRow => ({
    status: "running",
    currentTitle: "",
    currentAssetId: "a1",
    processStartedAt: "",
    queueKind: "asset",
    nextAssetId: "a2",
    nextTitle: "",
    manualNextAssetId: "",
    insertAssetId: "",
    insertStatus: "",
    overrideAssetId: "",
    overrideUntil: "",
    cuepointWindowKey: "",
    ...overrides
  });
  const queueNext = (playout: NextOnAirPlayout): NextOnAirPrediction =>
    playout.nextTitle ? { kind: "item", assetId: playout.nextAssetId, title: playout.nextTitle, startsAt: null } : { kind: "none" };

  function answerer() {
    let nowMs = Date.parse("2026-10-05T20:00:00.000Z");
    const runtime = new ChatControlRuntime({ now: () => new Date(nowMs) });
    const said: string[] = [];
    const ask = async (actor: string, message: string, read: () => Promise<ChatProgrammeInfo> = async () => nowPlaying) => {
      const effect = runtime.handleMessage({ actor, message, currentAssetId: "a1", config: config() });
      await answerChatEffect({ effect, say: (line) => said.push(line), config: config(), locale: "en", programme: read });
    };
    return { ask, said, advance: (ms: number) => (nowMs += ms), runtime };
  }

  it("answers !now twice from one viewer exactly once, and the room once in ten seconds", async () => {
    const { ask, said, advance } = answerer();
    await ask("ada", "!now");
    await ask("ada", "!now");
    advance(5_000);
    await ask("bob", "!next");
    expect(said).toEqual([formatChatNowReply("ada", nowPlaying, "en")]);
    advance(5_000);
    await ask("bob", "!next");
    expect(said).toHaveLength(2);
    expect(said[1]).toBe(formatChatNextReply("bob", nowPlaying, "en"));
  });

  it("lists the commands without reading the programme", async () => {
    const { ask, said } = answerer();
    const read = vi.fn(async () => nowPlaying);
    await ask("ada", "!commands", read);
    expect(read).not.toHaveBeenCalled();
    expect(said).toEqual([formatChatCommandsReply({ actor: "ada", config: config(), gameCommand: true, locale: "en" })]);
  });

  it("names the item on air when asked, not the one the last cycle read (R22)", async () => {
    // The cycle read "Retro Night"; the playout has since started "Coding Marathon".
    const cycleRead = buildChatProgrammeInfo({
      playout: playoutRow({ currentTitle: "Retro Night", nextTitle: "Coding Marathon" }),
      predictNext: queueNext,
      timeZone: "UTC",
      appUrl: "",
      locale: "en"
    });
    const { ask, said } = answerer();
    const readNow = () =>
      readChatProgrammeInfoNow({
        readTitles: async () => playoutRow({ currentTitle: "Coding Marathon", nextTitle: "Late Show" }),
        predictNext: queueNext,
        timeZone: "UTC",
        appUrl: "",
        locale: "en",
        fallback: cycleRead
      });
    await ask("ada", "!now", readNow);
    expect(said).toHaveLength(1);
    expect(said[0]).toContain("Coding Marathon");
    expect(said[0]).not.toContain("Retro Night");
    // !next predicts from the row read now as well (M107), not from the row the cycle read.
    expect((await readNow()).nextTitle).toBe("Late Show");
  });

  it("answers from what the cycle read when the row cannot be read in time", async () => {
    const fallback = programme({ nowTitle: "Retro Night" });
    const failing = await readChatProgrammeInfoNow({
      readTitles: async () => {
        throw new Error("connection refused");
      },
      predictNext: queueNext,
      timeZone: "UTC",
      appUrl: "",
      locale: "en",
      fallback
    });
    expect(failing).toBe(fallback);
    const hanging = await readChatProgrammeInfoNow({
      readTitles: () => new Promise(() => undefined),
      predictNext: queueNext,
      timeZone: "UTC",
      appUrl: "",
      locale: "en",
      fallback,
      timeoutMs: 20
    });
    expect(hanging).toBe(fallback);
  });

  it("tells the room once why its skip vote did nothing", async () => {
    const said: string[] = [];
    const say = (line: string) => said.push(line);
    await answerChatEffect({ effect: { kind: "skip-paused", hold: "pin", announce: true }, say, config: config(), locale: "en", programme: async () => nowPlaying });
    await answerChatEffect({ effect: { kind: "skip-paused", hold: "pin", announce: false }, say, config: config(), locale: "en", programme: async () => nowPlaying });
    await answerChatEffect({ effect: { kind: "info", info: "now", actor: "ada", answer: false }, say, config: config(), locale: "en", programme: async () => nowPlaying });
    expect(said).toHaveLength(1);
  });
});

describe("the worker hands its effects to these answers", () => {
  // What is left as source text: index.ts starts the worker when imported, so only its calls are pinned.
  const worker = readFileSync(new URL("../../apps/worker/src/index.ts", import.meta.url), "utf8").replace(/\s+/g, " ");

  it("answers every message's effect, and every request's verdict, through chat-answers.ts", () => {
    expect(worker).toContain("void answerChatEffect({ effect, say: twitchChatBridge.say.bind(twitchChatBridge), config: latestChatInteractionConfig, locale: viewerLanguage(), programme: readChatProgrammeForAnswer })");
    expect(worker.match(/replyToChatRequest\(\{/g)).toHaveLength(2);
    expect(worker).toContain("claimRefusal: (actor) => chatControl.claimRequestRefusalReply(actor),");
    expect(worker).toContain("readTitles: readPlayoutProgrammeTitles,");
  });
});
